import express from 'express';
import net from 'net';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  INITIAL_DB_STATE,
  SmartOltDatabaseState,
  PonPortRecord,
  UplinkPortRecord,
  OltCardRecord,
  VlanRecord,
  OnuRecord,
} from './src/services/mockDatabase.js';
import {
  parseZteRunningConfig,
  parseZteUncfgOutput,
  parseZteOnuStateOutput,
  parseZteCardOutput,
} from './src/services/oltEngine.js';

dotenv.config();

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: '25mb' }));

// ============================================================================
// 1. POSTGRESQL CONNECTION CONFIG (Default: localhost:5435, user: likhin)
// ============================================================================
export interface PgConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

let currentPgConfig: PgConnectionConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5435),
  user: process.env.PG_USER || 'likhin',
  password: process.env.PG_PASSWORD || '11013009',
  database: process.env.PG_DATABASE || 'smartolt_db',
};

let pgPool: pg.Pool | null = null;
let activeDbEngine = `PostgreSQL (${currentPgConfig.host}:${currentPgConfig.port})`;
let pgConnected = false;
let pgLastError: string | null = null;

// Local SQLite fallback when running inside cloud preview where user's localhost:5435 is not present
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const sqlitePath =
  process.env.SQLITE_PATH || path.join(dataDir, 'smartolt_live.sqlite');
const sqliteDb = new Database(sqlitePath);
sqliteDb.pragma('journal_mode = WAL');

sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS smartolt_relational_store (
    store_key TEXT PRIMARY KEY,
    json_payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS smartolt_relational_store (
    store_key VARCHAR(64) PRIMARY KEY,
    json_payload TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS olts (
    id INTEGER PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    manufacturer VARCHAR(32) NOT NULL DEFAULT 'ZTE',
    hardware_model VARCHAR(64) NOT NULL DEFAULT 'ZTE-C300M',
    firmware_version VARCHAR(32) NOT NULL DEFAULT 'V2.1.0',
    ip_address VARCHAR(45) NOT NULL,
    vpn_name VARCHAR(64) DEFAULT '',
    vpn_subnet VARCHAR(45) DEFAULT '',
    telnet_port INTEGER NOT NULL DEFAULT 23,
    ssh_port INTEGER NOT NULL DEFAULT 22,
    protocol VARCHAR(16) NOT NULL DEFAULT 'TELNET',
    olt_username VARCHAR(64) NOT NULL,
    olt_password VARCHAR(128) NOT NULL,
    enable_password VARCHAR(128) DEFAULT 'zxr10',
    snmp_read_community VARCHAR(128) NOT NULL,
    snmp_write_community VARCHAR(128) NOT NULL,
    snmp_port INTEGER NOT NULL DEFAULT 161,
    snmp_traps_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    iptv_module BOOLEAN NOT NULL DEFAULT FALSE,
    supported_pon_types VARCHAR(64) NOT NULL DEFAULT 'GPON',
    uplink_interface VARCHAR(64) NOT NULL DEFAULT 'gei_1/19/3',
    warning_rx_dbm NUMERIC(5,2) NOT NULL DEFAULT -28.00,
    critical_rx_dbm NUMERIC(5,2) NOT NULL DEFAULT -30.00,
    ntp_servers VARCHAR(255) DEFAULT '20.101.57.9, 216.239.35.4',
    tr069_profile_name VARCHAR(64) DEFAULT 'DEFAULT-ACS',
    status VARCHAR(32) NOT NULL DEFAULT 'ONLINE',
    last_polled_at VARCHAR(64) DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS pon_ports (
    id INTEGER PRIMARY KEY,
    olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
    rack SMALLINT NOT NULL DEFAULT 1,
    shelf SMALLINT NOT NULL DEFAULT 3,
    slot SMALLINT NOT NULL DEFAULT 3,
    port_number SMALLINT NOT NULL,
    interface_name VARCHAR(32) NOT NULL,
    board_model VARCHAR(32) NOT NULL DEFAULT 'GTGH',
    description VARCHAR(128) DEFAULT '',
    admin_state VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
    oper_status VARCHAR(16) NOT NULL DEFAULT 'Up',
    online_onus INTEGER NOT NULL DEFAULT 0,
    total_onus INTEGER NOT NULL DEFAULT 0,
    avg_signal_dbm NUMERIC(6,2) DEFAULT NULL,
    tx_power_dbm NUMERIC(6,3) NOT NULL DEFAULT 10.500,
    max_onu_capacity INTEGER NOT NULL DEFAULT 128
  );

  CREATE TABLE IF NOT EXISTS vlans (
    id INTEGER PRIMARY KEY,
    olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
    vlan_id INTEGER NOT NULL,
    name VARCHAR(64) NOT NULL,
    description VARCHAR(150) DEFAULT '',
    service_type VARCHAR(32) NOT NULL DEFAULT 'PPPOE',
    used_for_mgmt_tr069_voip BOOLEAN NOT NULL DEFAULT FALSE,
    used_for_iptv BOOLEAN NOT NULL DEFAULT FALSE,
    dhcp_snooping BOOLEAN NOT NULL DEFAULT FALSE,
    lan_to_lan BOOLEAN NOT NULL DEFAULT FALSE,
    onus_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS onus (
    id BIGINT PRIMARY KEY,
    olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
    pon_port_id INTEGER NOT NULL,
    board SMALLINT NOT NULL DEFAULT 3,
    port SMALLINT NOT NULL,
    onu_index SMALLINT DEFAULT NULL,
    serial_number VARCHAR(32) NOT NULL,
    onu_type VARCHAR(50) NOT NULL DEFAULT 'ALL',
    is_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    customer_name VARCHAR(150) DEFAULT NULL,
    address VARCHAR(255) DEFAULT NULL,
    vlan_id INTEGER DEFAULT NULL,
    onu_mode VARCHAR(32) NOT NULL DEFAULT 'Routing',
    wan_mode VARCHAR(64) NOT NULL DEFAULT 'PPPOE',
    config_method VARCHAR(16) NOT NULL DEFAULT 'OMCI',
    wan_remote_access VARCHAR(128) NOT NULL DEFAULT 'Enabled from everywhere in the internet',
    wan_remote_allowed_subnet VARCHAR(64) NOT NULL DEFAULT '0.0.0.0/0',
    pppoe_username VARCHAR(100) DEFAULT NULL,
    pppoe_password VARCHAR(100) DEFAULT NULL,
    phase_state VARCHAR(32) NOT NULL DEFAULT 'working',
    onu_rx_dbm NUMERIC(6,3) DEFAULT NULL,
    onu_tx_dbm NUMERIC(6,3) DEFAULT NULL,
    olt_rx_dbm NUMERIC(6,3) DEFAULT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS provisioning_logs (
    id BIGINT PRIMARY KEY,
    olt_id INTEGER NOT NULL,
    onu_id BIGINT DEFAULT NULL,
    serial_number VARCHAR(32) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    interface_target VARCHAR(64) NOT NULL,
    summary_text VARCHAR(255) DEFAULT NULL,
    cli_script TEXT NOT NULL,
    olt_response TEXT DEFAULT NULL,
    execution_status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    executed_by VARCHAR(64) NOT NULL DEFAULT 'likhin',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at VARCHAR(64) NOT NULL
  );
`;

function formatPgError(err: unknown): string {
  if (!err) return 'Unknown error';
  const anyErr = err as {
    message?: string;
    code?: string;
    errors?: Array<{ message?: string; code?: string; address?: string; port?: number }>;
  };
  if (Array.isArray(anyErr.errors) && anyErr.errors.length > 0) {
    const parts = anyErr.errors.map(
      (e) => `${e.code || 'ERR'} ${e.address || ''}:${e.port || ''}`.trim()
    );
    return `${anyErr.code || 'AggregateError'} (${parts.join(', ')})`;
  }
  return anyErr.message || anyErr.code || String(err);
}

async function tryConnectSingleHost(
  host: string,
  port: number,
  user: string,
  password: string,
  targetDb: string
): Promise<{ pool: pg.Pool; resolvedDb: string }> {
  // 1. Try connecting directly to targetDb first
  const directPool = new Pool({
    host,
    port,
    user,
    password,
    database: targetDb,
    max: 15,
    connectionTimeoutMillis: 2500,
  });

  try {
    await directPool.query('SELECT 1');
    return { pool: directPool, resolvedDb: targetDb };
  } catch (directErr) {
    await directPool.end().catch(() => {});
    const errCode = (directErr as { code?: string }).code;
    // If error is NOT "database does not exist" (3D000), rethrow connection/auth error immediately
    if (errCode !== '3D000') {
      throw directErr;
    }
  }

  // 2. Database does not exist yet (3D000): connect to default maintenance DB ('postgres', user, or 'template1') to create it
  const adminDbs = Array.from(new Set(['postgres', user, 'template1']));
  let lastAdminErr: unknown = null;

  for (const adminDb of adminDbs) {
    const adminPool = new Pool({
      host,
      port,
      user,
      password,
      database: adminDb,
      connectionTimeoutMillis: 2500,
    });
    try {
      const dbCheck = await adminPool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [targetDb]
      );
      if (dbCheck.rowCount === 0) {
        await adminPool.query(`CREATE DATABASE "${targetDb}"`);
        console.log(
          `[PostgreSQL] Created database "${targetDb}" on ${host}:${port}`
        );
      }
      await adminPool.end().catch(() => {});

      const createdPool = new Pool({
        host,
        port,
        user,
        password,
        database: targetDb,
        max: 15,
        connectionTimeoutMillis: 3000,
      });
      await createdPool.query('SELECT 1');
      return { pool: createdPool, resolvedDb: targetDb };
    } catch (adminErr) {
      lastAdminErr = adminErr;
      await adminPool.end().catch(() => {});
    }
  }

  throw lastAdminErr || new Error(`Could not create database ${targetDb}`);
}

async function initPostgresConnection(cfg: PgConnectionConfig): Promise<{
  connected: boolean;
  error?: string;
}> {
  currentPgConfig = cfg;

  // Inside Docker, localhost:5435 on the host or the dedicated smartolt-postgres container (port 5435)
  // is probed automatically when user configures localhost / 127.0.0.1 / host.docker.internal.
  const isLocalTarget = [
    'localhost',
    '127.0.0.1',
    'host.docker.internal',
    'smartolt-postgres',
  ].includes(cfg.host.trim().toLowerCase());
  const candidateHosts = isLocalTarget
    ? Array.from(
        new Set([
          'localhost',
          '127.0.0.1',
          'host.docker.internal',
          'smartolt-postgres',
          '172.17.0.1',
          '172.18.0.1',
          cfg.host.trim(),
        ])
      )
    : [cfg.host.trim()];

  const errorsByHost: string[] = [];

  for (const candidateHost of candidateHosts) {
    try {
      const { pool, resolvedDb } = await tryConnectSingleHost(
        candidateHost,
        Number(cfg.port),
        cfg.user,
        cfg.password,
        cfg.database
      );

      if (pgPool) {
        await pgPool.end().catch(() => {});
      }
      pgPool = pool;
      await pgPool.query(POSTGRES_SCHEMA_SQL);

      const displayHost = isLocalTarget ? 'localhost' : candidateHost;
      currentPgConfig = {
        ...cfg,
        host: displayHost,
        database: resolvedDb,
      };
      pgConnected = true;
      pgLastError = null;
      activeDbEngine = `PostgreSQL (${cfg.user}@${displayHost}:${cfg.port}/${resolvedDb})`;
      console.log(
        `[SmartOLT DB] Connected to ${activeDbEngine} (via ${candidateHost}:${cfg.port})`
      );
      return { connected: true };
    } catch (err) {
      errorsByHost.push(`${candidateHost}:${cfg.port} -> ${formatPgError(err)}`);
    }
  }

  const msg = errorsByHost.join(' | ');
  pgConnected = false;
  pgLastError = msg;
  pgPool = null;
  activeDbEngine = `PostgreSQL Target (${cfg.host}:${cfg.port}) [Local Cache Active]`;
  console.warn(
    `[SmartOLT DB] PostgreSQL at ${cfg.host}:${cfg.port} (user: ${cfg.user}) not reachable (${msg}). Using persistent SQLite cache until PostgreSQL is reachable.`
  );
  return { connected: false, error: msg };
}

async function syncRelationalTablesToPostgres(
  pool: pg.Pool,
  state: SmartOltDatabaseState
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM provisioning_logs');
    await client.query('DELETE FROM onus');
    await client.query('DELETE FROM vlans');
    await client.query('DELETE FROM pon_ports');
    await client.query('DELETE FROM olts');

    for (const o of state.olts) {
      await client.query(
        `INSERT INTO olts (
          id, name, manufacturer, hardware_model, firmware_version, ip_address,
          vpn_name, vpn_subnet, telnet_port, ssh_port, protocol, olt_username,
          olt_password, enable_password, snmp_read_community, snmp_write_community,
          snmp_port, snmp_traps_enabled, iptv_module, supported_pon_types,
          uplink_interface, warning_rx_dbm, critical_rx_dbm, ntp_servers,
          tr069_profile_name, status, last_polled_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
        )`,
        [
          o.id,
          o.name,
          o.manufacturer || 'ZTE',
          o.hardware_model,
          o.firmware_version,
          o.ip_address,
          o.vpn_name || '',
          o.vpn_subnet || '',
          o.telnet_port,
          o.ssh_port || 22,
          o.protocol || 'TELNET',
          o.olt_username,
          o.olt_password,
          o.enable_password || 'zxr10',
          o.snmp_read_community,
          o.snmp_write_community,
          o.snmp_port,
          Boolean(o.snmp_traps_enabled),
          Boolean(o.iptv_module),
          o.supported_pon_types || 'GPON',
          o.uplink_interface || 'gei_1/19/3',
          o.warning_rx_dbm,
          o.critical_rx_dbm,
          o.ntp_servers || '',
          o.tr069_profile_name || 'DEFAULT-ACS',
          o.status || 'ONLINE',
          o.last_polled_at || '',
        ]
      );
    }

    for (const p of state.pon_ports) {
      if (!state.olts.some((o) => o.id === p.olt_id)) continue;
      await client.query(
        `INSERT INTO pon_ports (
          id, olt_id, rack, shelf, slot, port_number, interface_name,
          board_model, description, admin_state, oper_status, online_onus,
          total_onus, avg_signal_dbm, tx_power_dbm, max_onu_capacity
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          p.id,
          p.olt_id,
          p.rack,
          p.shelf,
          p.slot,
          p.port_number,
          p.interface_name,
          p.board_model,
          p.description,
          p.admin_state,
          p.oper_status,
          p.online_onus,
          p.total_onus,
          p.avg_signal_dbm,
          p.tx_power_dbm,
          p.max_onu_capacity,
        ]
      );
    }

    for (const v of state.vlans) {
      if (!state.olts.some((o) => o.id === v.olt_id)) continue;
      await client.query(
        `INSERT INTO vlans (
          id, olt_id, vlan_id, name, description, service_type,
          used_for_mgmt_tr069_voip, used_for_iptv, dhcp_snooping, lan_to_lan, onus_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          v.id,
          v.olt_id,
          v.vlan_id,
          v.name,
          v.description,
          v.service_type,
          Boolean(v.used_for_mgmt_tr069_voip),
          Boolean(v.used_for_iptv),
          Boolean(v.dhcp_snooping),
          Boolean(v.lan_to_lan),
          v.onus_count,
        ]
      );
    }

    for (const u of state.onus) {
      if (!state.olts.some((o) => o.id === u.olt_id)) continue;
      await client.query(
        `INSERT INTO onus (
          id, olt_id, pon_port_id, board, port, onu_index, serial_number,
          onu_type, is_authorized, customer_name, address, vlan_id,
          onu_mode, wan_mode, config_method, wan_remote_access,
          wan_remote_allowed_subnet, pppoe_username, pppoe_password,
          phase_state, onu_rx_dbm, onu_tx_dbm, olt_rx_dbm
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
        )`,
        [
          u.id,
          u.olt_id,
          u.pon_port_id,
          u.board,
          u.port,
          u.onu_index,
          u.serial_number,
          u.onu_type,
          Boolean(u.is_authorized),
          u.customer_name,
          u.address,
          u.vlan_id,
          u.onu_mode,
          u.wan_mode,
          u.config_method,
          u.wan_remote_access,
          u.wan_remote_allowed_subnet,
          u.pppoe_username,
          u.pppoe_password,
          u.phase_state,
          u.onu_rx_dbm,
          u.onu_tx_dbm,
          u.olt_rx_dbm,
        ]
      );
    }

    for (const l of state.provisioning_logs) {
      await client.query(
        `INSERT INTO provisioning_logs (
          id, olt_id, onu_id, serial_number, action_type, interface_target,
          summary_text, cli_script, olt_response, execution_status,
          executed_by, duration_ms, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          l.id,
          l.olt_id,
          l.onu_id,
          l.serial_number,
          l.action_type,
          l.interface_target,
          l.summary_text || '',
          l.cli_script,
          l.olt_response,
          l.execution_status,
          l.executed_by,
          l.duration_ms,
          l.created_at,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.warn('[PostgreSQL Relational Mirror Warning]:', (err as Error).message);
  } finally {
    client.release();
  }
}

async function loadDatabaseState(): Promise<SmartOltDatabaseState> {
  if (pgPool && pgConnected) {
    try {
      const res = await pgPool.query(
        `SELECT json_payload FROM smartolt_relational_store WHERE store_key = 'MAIN_STATE' LIMIT 1`
      );
      if (res.rows.length > 0 && res.rows[0].json_payload) {
        return JSON.parse(res.rows[0].json_payload);
      }
      await saveDatabaseState(INITIAL_DB_STATE);
      return INITIAL_DB_STATE;
    } catch (err) {
      console.warn('[PostgreSQL Load Fallback]:', (err as Error).message);
    }
  }

  const row = sqliteDb
    .prepare(
      `SELECT json_payload FROM smartolt_relational_store WHERE store_key = 'MAIN_STATE'`
    )
    .get() as { json_payload: string } | undefined;

  if (row && row.json_payload) {
    return JSON.parse(row.json_payload);
  }

  await saveDatabaseState(INITIAL_DB_STATE);
  return INITIAL_DB_STATE;
}

async function saveDatabaseState(state: SmartOltDatabaseState): Promise<void> {
  const payload = JSON.stringify(state);
  const now = new Date().toISOString();

  if (pgPool && pgConnected) {
    try {
      await pgPool.query(
        `INSERT INTO smartolt_relational_store (store_key, json_payload, updated_at)
         VALUES ('MAIN_STATE', $1, NOW())
         ON CONFLICT (store_key) DO UPDATE
         SET json_payload = EXCLUDED.json_payload, updated_at = NOW()`,
        [payload]
      );
      await syncRelationalTablesToPostgres(pgPool, state);
    } catch (err) {
      console.warn('[PostgreSQL Save Warning]:', (err as Error).message);
    }
  }

  sqliteDb
    .prepare(
      `INSERT INTO smartolt_relational_store (store_key, json_payload, updated_at)
       VALUES ('MAIN_STATE', ?, ?)
       ON CONFLICT(store_key) DO UPDATE SET json_payload = excluded.json_payload, updated_at = excluded.updated_at`
    )
    .run(payload, now);
}

// ============================================================================
// 2. REAL TCP TELNET CLIENT FOR ZTE / HUAWEI OLT (IAC + PROMPT STATE MACHINE)
// ============================================================================

/**
 * Strip Telnet IAC (0xFF) negotiation sequences from incoming chunk and send
 * standard WONT/DONT/DO replies so ZTE C300/C320 & Huawei Telnet daemons
 * immediately present the Username:/Password: prompt.
 */
function handleTelnetIacAndExtractText(
  socket: net.Socket,
  chunk: Buffer
): string {
  const cleanBytes: number[] = [];
  const replies: number[] = [];
  let i = 0;

  while (i < chunk.length) {
    if (chunk[i] === 0xff) {
      if (i + 1 >= chunk.length) break;
      const cmd = chunk[i + 1];

      // Escaped 0xFF
      if (cmd === 0xff) {
        cleanBytes.push(0xff);
        i += 2;
        continue;
      }

      // Subnegotiation IAC SB (0xFA) ... IAC SE (0xF0)
      if (cmd === 0xfa) {
        i += 2;
        while (i < chunk.length) {
          if (chunk[i] === 0xff && chunk[i + 1] === 0xf0) {
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }

      // 3-byte IAC commands: WILL (0xFB), WONT (0xFC), DO (0xFD), DONT (0xFE)
      if (cmd >= 0xfb && cmd <= 0xfe && i + 2 < chunk.length) {
        const opt = chunk[i + 2];
        if (cmd === 0xfd) {
          // Server says DO <opt> -> Reply WONT <opt>
          replies.push(0xff, 0xfc, opt);
        } else if (cmd === 0xfb) {
          // Server says WILL <opt> -> Accept ECHO (1) & SGA (3), otherwise DONT
          if (opt === 1 || opt === 3) {
            replies.push(0xff, 0xfd, opt);
          } else {
            replies.push(0xff, 0xfe, opt);
          }
        }
        i += 3;
        continue;
      }

      // 2-byte IAC command
      i += 2;
      continue;
    }

    // Strip NULL bytes (0x00) that some Telnet servers send after CR
    if (chunk[i] !== 0x00) {
      cleanBytes.push(chunk[i]);
    }
    i++;
  }

  if (replies.length > 0 && !socket.destroyed) {
    socket.write(Buffer.from(replies));
  }

  return Buffer.from(cleanBytes).toString('utf8');
}

/**
 * Convert multi-line CLI scripts into executable ZTE/Huawei CLI commands.
 * Automatically converts standalone `!` separators inside configuration blocks
 * into `exit` so ZTE sub-modes (`interface gpon-olt_...`, `interface gpon-onu_...`,
 * `pon-onu-mng ...`, `vlan database`, `gpon`, `onu-pnp`) cleanly return to `(config)#`.
 */
export function normalizeCliCommandsForExecution(
  rawCommands: string[] | string
): string[] {
  const inputLines = (
    Array.isArray(rawCommands) ? rawCommands.join('\n') : String(rawCommands)
  ).split(/\r?\n/);

  const hasExplicitExits = inputLines.some((l) => /^exit$/i.test(l.trim()));
  const result: string[] = [];
  let inConfigMode = false;
  let inSubBlock = false;

  // Note: `vlan <id>` is a sub-command inside `vlan database` on ZTE C300, NOT a top-level block!
  const isTopSubBlockStart = (cmd: string): boolean =>
    /^(interface\s+|pon-onu-mng\s+|vlan\s+database\b|gpon\b|epon\b|pon\b|onu-pnp\b)/i.test(
      cmd
    );

  for (const raw of inputLines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^(configure\s+terminal|conf\s+t)$/i.test(line)) {
      inConfigMode = true;
      inSubBlock = false;
      result.push('configure terminal');
      continue;
    }

    if (line === '!') {
      if (inConfigMode && inSubBlock && !hasExplicitExits) {
        result.push('exit');
        inSubBlock = false;
      }
      continue;
    }

    if (/^end$/i.test(line)) {
      inConfigMode = false;
      inSubBlock = false;
      result.push('end');
      continue;
    }

    if (/^exit$/i.test(line)) {
      inSubBlock = false;
      result.push('exit');
      continue;
    }

    if (!hasExplicitExits && inConfigMode && isTopSubBlockStart(line)) {
      if (inSubBlock) {
        result.push('exit');
      }
      inSubBlock = true;
      result.push(line);
      continue;
    }

    result.push(line);
  }

  return result;
}

/**
 * Check if the current trailing line of the Telnet buffer ends with a valid
 * ZTE (`ZXAN#`, `ZXAN(config)#`, `ZXAN(config-if)#`, `ZXAN(gpon-onu-mng)#`) or Huawei CLI prompt.
 */
function hasCliPromptAtEnd(buffer: string): {
  isPrompt: boolean;
  isUserMode: boolean;
} {
  const cleaned = buffer
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  // Split on both LF (\n) and bare CR (\r) used by ZTE horizontal line scrolling
  const lines = cleaned.split(/[\r\n]+/);
  let lastLine = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      lastLine = lines[i].trim();
      break;
    }
  }
  if (!lastLine) return { isPrompt: false, isUserMode: false };

  // Avoid matching comment lines or separator lines
  if (lastLine.startsWith('!') || lastLine.startsWith('#') || lastLine.startsWith('---')) {
    return { isPrompt: false, isUserMode: false };
  }

  // Standard ZTE/Huawei prompt: `ZXAN#`, `ZXAN>`, `ZXAN(config)#`, `ZXAN(config-if)#`, `ZXAN(gpon-onu-mng)#`
  const promptRegex = /^[A-Za-z0-9_.\-]+(?:\([^\r\n()]{1,48}\))?([>#])\s*$/;
  const match = lastLine.match(promptRegex);
  if (!match) {
    return { isPrompt: false, isUserMode: false };
  }
  return {
    isPrompt: true,
    isUserMode: match[1] === '>',
  };
}

async function executeTelnetSession(params: {
  host: string;
  port: number;
  username?: string;
  password?: string;
  enablePassword?: string;
  commands: string[];
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  reachable: boolean;
  output: string;
  commandsExecuted: string[];
  durationMs: number;
  error?: string;
}> {
  const startTime = Date.now();
  const normalizedCmds = normalizeCliCommandsForExecution(params.commands);
  const hasHeavyShow = normalizedCmds.some((c) =>
    /^(show\s+running-config|show\s+gpon|write|wr)/i.test(c)
  );
  const timeout =
    params.timeoutMs ||
    Math.max(hasHeavyShow ? 35000 : 20000, normalizedCmds.length * 450 + 10000);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let fullOutput = '';
    let stepBuffer = '';
    let settled = false;

    type SessionStage =
      | 'WAIT_USER'
      | 'WAIT_PASS'
      | 'WAIT_ENABLE_PASS'
      | 'WAIT_PROMPT'
      | 'EXEC_CMDS'
      | 'DONE';

    let stage: SessionStage = 'WAIT_USER';
    const cmdQueue: string[] = ['terminal length 0', ...normalizedCmds];
    let cmdIndex = 0;
    let currentCmd = '';
    let waitingForPrompt = false;
    let sawOnuRegistration = false;
    let stepTimer: NodeJS.Timeout | null = null;
    let wakeTimer: NodeJS.Timeout | null = null;
    let promptDebounceTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      if (stepTimer) {
        clearTimeout(stepTimer);
        stepTimer = null;
      }
      if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      if (promptDebounceTimer) {
        clearTimeout(promptDebounceTimer);
        promptDebounceTimer = null;
      }
    };

    const finish = (reachable: boolean, output: string, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimers();
      socket.destroy();
      resolve({
        ok: reachable && !error,
        reachable,
        output,
        commandsExecuted: normalizedCmds,
        durationMs: Date.now() - startTime,
        error,
      });
    };

    const armCommandWatchdog = (cmd: string) => {
      if (stepTimer) {
        clearTimeout(stepTimer);
        stepTimer = null;
      }
      const isSlowCmd = /^(write|wr|show\s+running-config|show\s+gpon|show\s+card|reset-card|no\s+onu\s+\d+|onu\s+\d+\s+type)/i.test(
        cmd
      );
      const idleLimitMs = isSlowCmd ? 6500 : 750;
      stepTimer = setTimeout(() => {
        if (waitingForPrompt && stage === 'EXEC_CMDS' && !settled) {
          waitingForPrompt = false;
          sendNextCommand();
        }
      }, idleLimitMs);
    };

    const sendNextCommand = () => {
      if (settled) return;
      if (stepTimer) {
        clearTimeout(stepTimer);
        stepTimer = null;
      }
      if (promptDebounceTimer) {
        clearTimeout(promptDebounceTimer);
        promptDebounceTimer = null;
      }

      if (cmdIndex >= cmdQueue.length) {
        stage = 'DONE';
        setTimeout(() => finish(true, fullOutput), 250);
        return;
      }

      currentCmd = cmdQueue[cmdIndex++];
      if (/^onu\s+\d+\s+type\s+/i.test(currentCmd)) {
        sawOnuRegistration = true;
      }

      // If we just registered a new ONU (`onu <idx> type ALL sn ...`) in this session,
      // pause 1200ms before entering `pon-onu-mng` so the ZTE C300 finishes creating
      // the ONU OMCI MIB context before pushing `pppoe 1 nat enable ...`
      if (sawOnuRegistration && /^pon-onu-mng\s+/i.test(currentCmd)) {
        sawOnuRegistration = false;
        setTimeout(() => {
          if (settled) return;
          stepBuffer = '';
          waitingForPrompt = true;
          socket.write(currentCmd + '\r\n');
          armCommandWatchdog(currentCmd);
        }, 1200);
        return;
      }

      stepBuffer = '';
      waitingForPrompt = true;
      socket.write(currentCmd + '\r\n');
      armCommandWatchdog(currentCmd);
    };

    socket.setTimeout(timeout);

    socket.connect(params.port || 23, params.host, () => {
      // Only send a wakeup CRLF if the OLT sends zero text for 3.5s after TCP connect
      wakeTimer = setTimeout(() => {
        if (stage === 'WAIT_USER' && stepBuffer.trim().length === 0 && !settled) {
          socket.write('\r\n');
        }
      }, 3500);
    });

    socket.on('data', (rawChunk: Buffer) => {
      const text = handleTelnetIacAndExtractText(socket, rawChunk);
      if (!text) return;

      fullOutput += text;
      stepBuffer += text;

      // Handle `--More--` paging automatically and reset watchdog timer
      if (/--\s*More\s*--/i.test(stepBuffer)) {
        stepBuffer = stepBuffer.replace(/--\s*More\s*--/gi, '');
        socket.write(' ');
        if (stage === 'EXEC_CMDS') {
          armCommandWatchdog(currentCmd);
        }
        return;
      }

      // Handle ZTE/Huawei interactive confirmation prompts: `[yes/no]:`, `(y/n)`, `Confirm to`
      if (
        /(\[yes\/no\]|\(y\/n\)|confirm\s+to\s+\w+|are\s+you\s+sure)/i.test(
          stepBuffer
        )
      ) {
        stepBuffer = '';
        socket.write('yes\r\n');
        if (stage === 'EXEC_CMDS') {
          armCommandWatchdog(currentCmd);
        }
        return;
      }

      if (stage === 'WAIT_USER') {
        if (/(username|login|user\s*name)\s*:/i.test(stepBuffer)) {
          if (wakeTimer) {
            clearTimeout(wakeTimer);
            wakeTimer = null;
          }
          stepBuffer = '';
          stage = 'WAIT_PASS';
          socket.write((params.username || 'zte') + '\r\n');
          return;
        }
        if (/password\s*:/i.test(stepBuffer)) {
          if (wakeTimer) {
            clearTimeout(wakeTimer);
            wakeTimer = null;
          }
          stepBuffer = '';
          stage = 'WAIT_PROMPT';
          socket.write((params.password || '') + '\r\n');
          return;
        }
        const promptCheck = hasCliPromptAtEnd(stepBuffer);
        if (promptCheck.isPrompt) {
          if (wakeTimer) {
            clearTimeout(wakeTimer);
            wakeTimer = null;
          }
          if (promptCheck.isUserMode) {
            stepBuffer = '';
            stage = 'WAIT_ENABLE_PASS';
            socket.write('enable\r\n');
          } else {
            stepBuffer = '';
            stage = 'EXEC_CMDS';
            sendNextCommand();
          }
          return;
        }
      } else if (stage === 'WAIT_PASS') {
        if (/password\s*:/i.test(stepBuffer)) {
          stepBuffer = '';
          stage = 'WAIT_PROMPT';
          socket.write((params.password || '') + '\r\n');
          return;
        }
        const promptCheck = hasCliPromptAtEnd(stepBuffer);
        if (promptCheck.isPrompt) {
          stepBuffer = '';
          stage = 'EXEC_CMDS';
          sendNextCommand();
          return;
        }
      } else if (stage === 'WAIT_PROMPT' || stage === 'WAIT_ENABLE_PASS') {
        if (
          /(authentication\s+failed|login\s+incorrect|bad\s+passwords?|access\s+denied)/i.test(
            stepBuffer
          )
        ) {
          finish(false, fullOutput, 'OLT Telnet authentication failed (invalid username/password)');
          return;
        }
        if (stage === 'WAIT_ENABLE_PASS' && /password\s*:/i.test(stepBuffer)) {
          stepBuffer = '';
          stage = 'WAIT_PROMPT';
          socket.write(
            (params.enablePassword || params.password || 'zxr10') + '\r\n'
          );
          return;
        }
        const promptCheck = hasCliPromptAtEnd(stepBuffer);
        if (promptCheck.isPrompt) {
          if (promptCheck.isUserMode) {
            stepBuffer = '';
            stage = 'WAIT_ENABLE_PASS';
            socket.write('enable\r\n');
          } else {
            stepBuffer = '';
            stage = 'EXEC_CMDS';
            sendNextCommand();
          }
          return;
        }
      } else if (stage === 'EXEC_CMDS') {
        // Reset idle watchdog on every incoming data chunk while streaming output
        armCommandWatchdog(currentCmd);

        if (waitingForPrompt) {
          const promptCheck = hasCliPromptAtEnd(stepBuffer);
          if (promptCheck.isPrompt) {
            if (promptDebounceTimer) clearTimeout(promptDebounceTimer);
            promptDebounceTimer = setTimeout(() => {
              if (waitingForPrompt && stage === 'EXEC_CMDS' && !settled) {
                waitingForPrompt = false;
                sendNextCommand();
              }
            }, 65);
          }
        }
      }
    });

    socket.on('timeout', () => {
      if (fullOutput.length > 0 && stage === 'EXEC_CMDS') {
        finish(true, fullOutput);
      } else {
        finish(
          false,
          fullOutput,
          `Connection timed out to ${params.host}:${params.port} (${timeout}ms)`
        );
      }
    });

    socket.on('error', (err) => {
      finish(false, fullOutput, err.message);
    });
  });
}

/**
 * Shared state builder that merges parsed `#show running-config`, `show card`,
 * `show gpon onu state`, and `show gpon onu uncfg` into `SmartOltDatabaseState`.
 */
function applyRunningConfigAndLiveTelemetryToState(params: {
  state: SmartOltDatabaseState;
  oltId: number;
  rawConfig: string;
  rawUncfgOutput?: string;
  rawStateOutput?: string;
  rawCardOutput?: string;
  sourceLabel?: string;
}): {
  nextState: SmartOltDatabaseState;
  summary: {
    vlans: number;
    uplinks: number;
    onus: number;
    uncfgOnus: number;
    cards: number;
  };
} {
  const {
    state,
    oltId,
    rawConfig,
    rawUncfgOutput = '',
    rawStateOutput = '',
    rawCardOutput = '',
    sourceLabel = 'Live Telnet Sync',
  } = params;

  const olt = state.olts.find((o) => o.id === oltId) || state.olts[0];
  const parsed = parseZteRunningConfig(rawConfig);
  const parsedStates = parseZteOnuStateOutput(rawStateOutput || rawConfig);
  const parsedUncfg = parseZteUncfgOutput(rawUncfgOutput || rawConfig);
  const extraCards = rawCardOutput ? parseZteCardOutput(rawCardOutput) : [];

  const stateByIf = new Map<string, (typeof parsedStates)[number]>();
  for (const st of parsedStates) {
    stateByIf.set(st.fullInterface.toLowerCase(), st);
  }

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // 1. Cards
  const otherCards = state.olt_cards.filter((c) => c.olt_id !== oltId);
  const mergedCardList = extraCards.length > 0 ? extraCards : parsed.cards;
  const newCards: OltCardRecord[] =
    mergedCardList.length > 0
      ? mergedCardList.map((c, idx) => ({
          id: oltId * 1000 + c.slot + idx,
          olt_id: oltId,
          slot: c.slot,
          type: c.type,
          real_type: c.realType,
          ports: c.ports,
          sw_version: c.swVersion,
          status: c.status === 'Offline' ? 'Offline' : 'Online',
          role: c.role,
          updated_at: nowStr,
        }))
      : [
          {
            id: oltId * 1000 + 3,
            olt_id: oltId,
            slot: 3,
            type: 'GTGH',
            real_type: 'GTGH',
            ports: 16,
            sw_version: 'V2.1.0',
            status: 'Online',
            role: 'Main',
            updated_at: nowStr,
          },
          {
            id: oltId * 1000 + 10,
            olt_id: oltId,
            slot: 10,
            type: 'SCXM',
            real_type: 'SCXM',
            ports: null,
            sw_version: 'V2.1.0',
            status: 'Online',
            role: 'Main',
            updated_at: nowStr,
          },
          {
            id: oltId * 1000 + 19,
            olt_id: oltId,
            slot: 19,
            type: 'HUVQ',
            real_type: 'HUVQ',
            ports: 4,
            sw_version: 'V2.1.0',
            status: 'Online',
            role: 'Main',
            updated_at: nowStr,
          },
        ];

  // 2. VLANs
  const otherVlans = state.vlans.filter((v) => v.olt_id !== oltId);
  const newVlans: VlanRecord[] = parsed.vlans.map((v) => {
    const onuCount = parsed.onus.filter((o) => o.vlanId === v.vlanId).length;
    const vlanLabel =
      v.vlanId === 101 && (!v.name || v.name === 'VLAN0101')
        ? 'PPPOE'
        : v.name;
    return {
      id: oltId * 10000 + v.vlanId,
      olt_id: oltId,
      vlan_id: v.vlanId,
      name: vlanLabel,
      description: vlanLabel,
      default_for: v.vlanId === 101 ? 'PPPoE / HSI' : 'None selected',
      used_for_mgmt_tr069_voip: v.vlanId === 100 || /tr069|mgmt|mjmt/i.test(v.name),
      used_for_iptv: false,
      dhcp_snooping: /ip\s+dhcp\s+snooping\s+control-port\s+enable/i.test(rawConfig),
      lan_to_lan: false,
      onus_count: onuCount,
      service_type:
        v.vlanId === 100 || /tr069|mgmt|mjmt/i.test(v.name)
          ? 'TR069_MGMT'
          : v.vlanId === 120 || v.vlanId === 140
          ? 'HOTSPOT_BRIDGE'
          : 'PPPOE',
      svlan_id: null,
      is_default: v.vlanId === 101 || v.vlanId === 111,
    };
  });

  // 3. Uplink Ports
  const otherUplinks = state.uplink_ports.filter((u) => u.olt_id !== oltId);
  const newUplinks: UplinkPortRecord[] =
    parsed.uplinks.length > 0
      ? parsed.uplinks.map((u, idx) => ({
          id: oltId * 100 + idx + 1,
          olt_id: oltId,
          name: u.name,
          description: '',
          type: 'Fiber',
          admin_state: u.adminState || 'Enabled',
          status:
            u.adminState === 'Disabled'
              ? 'Down'
              : u.name.startsWith('xgei')
              ? '10G-FullD'
              : '1G-FullD',
          negotiation: u.speed,
          mtu: 1600,
          wavelength: u.name.startsWith('xgei') ? '1310' : '16652',
          signal_dbm: u.name.startsWith('xgei') ? 'Tx: -4.85 / Rx: N/A' : '',
          temp_c: u.name.startsWith('xgei') ? '41.5' : 'N/A',
          pvid_untag: u.pvidUntag,
          tagged_vlans: u.taggedVlans,
        }))
      : state.uplink_ports.filter((u) => u.olt_id === oltId);

  // 4. Configured ONUs
  const otherOnus = state.onus.filter((o) => o.olt_id !== oltId);
  const configuredOnus: OnuRecord[] = parsed.onus.map((o, idx) => {
    const matchedVlan = newVlans.find((v) => v.vlan_id === o.vlanId);
    const fullIfKey = `gpon-onu_1/${o.board}/${o.port}:${o.onuIndex}`.toLowerCase();
    const liveState = stateByIf.get(fullIfKey);
    const phaseState = liveState ? liveState.phaseState : 'working';

    return {
      id: oltId * 100000 + o.port * 1000 + o.onuIndex + idx,
      olt_id: oltId,
      pon_port_id: oltId * 100 + o.port,
      board: o.board,
      port: o.port,
      onu_index: o.onuIndex,
      serial_number: o.serialNumber,
      onu_type: o.onuType,
      is_authorized: true,
      customer_name: o.name,
      address: o.description === 'none' ? '' : o.description,
      external_id: o.serialNumber,
      zone_id: state.zones[0]?.id || null,
      odb_id: state.odbs[0]?.id || null,
      odb_port: o.onuIndex,
      vlan_id: matchedVlan ? matchedVlan.id : o.vlanId,
      speed_profile_id: 1,
      tcont_profile_id: 1,
      onu_mode: 'Routing',
      wan_mode: 'PPPOE',
      config_method: o.tr069Enabled ? 'TR069' : 'OMCI',
      wan_remote_access: o.wanRemoteRestrictedIp
        ? 'Enabled only from NOC subnet'
        : 'Enabled from everywhere in the internet',
      wan_remote_allowed_subnet: o.wanRemoteRestrictedIp || '0.0.0.0/0',
      tr069_profile_id: 1,
      tr069_status: o.tr069Enabled ? 'ACTIVE_INFORMING' : 'DISABLED',
      tr069_last_inform: o.tr069Enabled ? nowStr : null,
      wifi_ssid: null,
      wifi_password: null,
      pppoe_username: o.pppoeUsername || o.name,
      pppoe_password: o.pppoePassword || 'jetcyber',
      hotspot_bridge_vlan: o.extraFlowVlans[0] || null,
      admin_state: liveState ? liveState.adminState : 'ENABLED',
      phase_state: phaseState,
      onu_rx_dbm: phaseState === 'LOS' ? null : -21.85,
      onu_tx_dbm: phaseState === 'LOS' ? null : 2.35,
      olt_rx_dbm: phaseState === 'LOS' ? null : -25.4,
      distance_m: 540,
      temperature_c: 41,
      ip_address: null,
      firmware_ver: 'V2.1.0',
      auth_date_label: nowStr.slice(0, 10),
      last_online_at: nowStr,
      last_offline_reason:
        phaseState === 'LOS'
          ? 'LOS'
          : phaseState === 'DyingGasp'
          ? 'Power Fail'
          : 'None',
    };
  });

  // 5. Unconfigured ONUs from `show gpon onu uncfg`
  const configuredSnSet = new Set(configuredOnus.map((o) => o.serial_number.toUpperCase()));
  const uncfgOnus: OnuRecord[] = [];
  for (let i = 0; i < parsedUncfg.length; i++) {
    const d = parsedUncfg[i];
    if (configuredSnSet.has(d.serialNumber.toUpperCase())) continue;
    configuredSnSet.add(d.serialNumber.toUpperCase());
    uncfgOnus.push({
      id: Date.now() + i + 5000,
      olt_id: oltId,
      pon_port_id: oltId * 100 + d.port,
      board: d.slot,
      port: d.port,
      onu_index: null,
      serial_number: d.serialNumber,
      onu_type: d.onuModel || 'ALL',
      is_authorized: false,
      customer_name: null,
      address: null,
      external_id: d.serialNumber,
      zone_id: null,
      odb_id: null,
      odb_port: null,
      vlan_id: newVlans.find((v) => v.is_default)?.id || newVlans[0]?.id || null,
      speed_profile_id: 1,
      tcont_profile_id: 1,
      onu_mode: 'Routing',
      wan_mode: 'PPPOE',
      config_method: 'OMCI',
      wan_remote_access: 'Enabled from everywhere in the internet',
      wan_remote_allowed_subnet: '0.0.0.0/0',
      tr069_profile_id: 1,
      tr069_status: 'DISABLED',
      tr069_last_inform: null,
      wifi_ssid: null,
      wifi_password: null,
      pppoe_username: null,
      pppoe_password: null,
      hotspot_bridge_vlan: null,
      admin_state: 'ENABLED',
      phase_state: 'Unconfigured',
      onu_rx_dbm: -21.5,
      onu_tx_dbm: 2.3,
      olt_rx_dbm: -24.8,
      distance_m: 480,
      temperature_c: 40,
      ip_address: null,
      firmware_ver: d.firmwareVersion || 'V2.1.0',
      detected_ago: 'Just now',
      last_online_at: null,
      last_offline_reason: 'Waiting Authorization',
    });
  }

  // 6. 16 PON Ports on Slot 3 GTGH
  const otherPonPorts = state.pon_ports.filter((p) => p.olt_id !== oltId);
  const newPonPorts: PonPortRecord[] = Array.from({ length: 16 }, (_, idx) => {
    const portNum = idx + 1;
    const portOnus = configuredOnus.filter((o) => o.port === portNum);
    const onlinePortOnus = portOnus.filter((o) => o.phase_state === 'working');
    return {
      id: oltId * 100 + portNum,
      olt_id: oltId,
      rack: 1,
      shelf: 3,
      slot: 3,
      port_number: portNum,
      interface_name: `gpon-olt_1/3/${portNum}`,
      board_model: 'GTGH',
      description: `PON 1/3/${portNum}`,
      admin_state: 'ENABLED',
      oper_status: portOnus.length > 0 ? 'Up' : 'Up',
      online_onus: onlinePortOnus.length,
      total_onus: portOnus.length,
      avg_signal_dbm: portOnus.length > 0 ? -22.4 : null,
      tx_power_dbm: 10.5,
      max_onu_capacity: 128,
    };
  });

  // 7. Update OLT last_polled_at & status
  const updatedOlts = state.olts.map((o) =>
    o.id === oltId
      ? {
          ...o,
          status: 'ONLINE' as const,
          last_polled_at: nowStr,
        }
      : o
  );

  const nextState: SmartOltDatabaseState = {
    ...state,
    olts: updatedOlts,
    olt_cards: [...otherCards, ...newCards],
    vlans: [...otherVlans, ...newVlans],
    uplink_ports: [...otherUplinks, ...newUplinks],
    pon_ports: [...otherPonPorts, ...newPonPorts],
    onus: [...otherOnus, ...configuredOnus, ...uncfgOnus],
    provisioning_logs: [
      {
        id: Date.now(),
        olt_id: oltId,
        onu_id: null,
        serial_number: 'OLT-SYNC',
        action_type: 'RESYNC_CONFIG',
        interface_target: olt?.name || `OLT-${oltId}`,
        summary_text: `${sourceLabel}: Synced ${newVlans.length} VLANs, ${configuredOnus.length} Configured ONUs, ${uncfgOnus.length} Unconfigured ONUs, ${newUplinks.length} Uplinks`,
        cli_script: `show card\nshow gpon onu uncfg\nshow gpon onu state\nshow running-config`,
        olt_response: `[OK - Synced ${rawConfig.length} bytes to ${activeDbEngine}]`,
        execution_status: 'SUCCESS',
        executed_by: 'likhin',
        duration_ms: 320,
        created_at: 'Just now',
      },
      ...state.provisioning_logs,
    ],
  };

  return {
    nextState,
    summary: {
      vlans: newVlans.length,
      uplinks: newUplinks.length,
      onus: configuredOnus.length,
      uncfgOnus: uncfgOnus.length,
      cards: newCards.length,
    },
  };
}

// ============================================================================
// 3. REST API ENDPOINTS (/api/*)
// ============================================================================

// GET /api/state — Load live database state + PostgreSQL connection status
app.get('/api/state', async (_req, res) => {
  try {
    const state = await loadDatabaseState();
    res.json({
      state,
      meta: {
        dbEngine: activeDbEngine,
        pgConnected,
        pgConfig: {
          host: currentPgConfig.host,
          port: currentPgConfig.port,
          user: currentPgConfig.user,
          database: currentPgConfig.database,
        },
        pgLastError,
        dockerPort: Number(process.env.PORT) || 3004,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/db/config — Test & update PostgreSQL connection (e.g. localhost:5435, user likhin)
app.post('/api/db/config', async (req, res) => {
  try {
    const { host, port, user, password, database } = req.body;
    const nextCfg: PgConnectionConfig = {
      host: host || currentPgConfig.host || 'localhost',
      port: Number(port || currentPgConfig.port || 5435),
      user: user || currentPgConfig.user || 'likhin',
      password: password ?? currentPgConfig.password ?? '11013009',
      database: database || currentPgConfig.database || 'smartolt_db',
    };

    const result = await initPostgresConnection(nextCfg);
    const state = await loadDatabaseState();
    if (result.connected) {
      await saveDatabaseState(state);
    }

    res.json({
      ok: result.connected,
      error: result.error || null,
      meta: {
        dbEngine: activeDbEngine,
        pgConnected,
        pgConfig: {
          host: currentPgConfig.host,
          port: currentPgConfig.port,
          user: currentPgConfig.user,
          database: currentPgConfig.database,
        },
        pgLastError,
        dockerPort: Number(process.env.PORT) || 3004,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/state/sync — Persist updated state to PostgreSQL (and SQLite cache)
app.post('/api/state/sync', async (req, res) => {
  try {
    const nextState = req.body.state as SmartOltDatabaseState;
    if (!nextState || !Array.isArray(nextState.olts)) {
      res.status(400).json({ error: 'Invalid database state payload' });
      return;
    }
    await saveDatabaseState(nextState);
    res.json({ ok: true, dbEngine: activeDbEngine, pgConnected });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/database/reset — Wipe all tables to 100% clean state
app.post('/api/database/reset', async (_req, res) => {
  try {
    await saveDatabaseState(INITIAL_DB_STATE);
    res.json({ ok: true, state: INITIAL_DB_STATE });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/telnet/test — Test TCP Telnet reachability to an OLT IP
app.post('/api/telnet/test', async (req, res) => {
  const { host, port, username, password } = req.body;
  if (!host) {
    res.status(400).json({ error: 'OLT IP or FQDN is required' });
    return;
  }
  const result = await executeTelnetSession({
    host,
    port: Number(port) || 23,
    username,
    password,
    commands: ['show version'],
    timeoutMs: 8000,
  });
  res.json(result);
});

// POST /api/telnet/exec — Execute live CLI commands on OLT via TCP Telnet
app.post('/api/telnet/exec', async (req, res) => {
  const {
    oltId,
    commands,
    ip_address,
    telnet_port,
    olt_username,
    olt_password,
    enable_password,
  } = req.body as {
    oltId: number;
    commands: string[] | string;
    ip_address?: string;
    telnet_port?: number;
    olt_username?: string;
    olt_password?: string;
    enable_password?: string;
  };
  const state = await loadDatabaseState();
  const olt =
    state.olts.find((o) => o.id === Number(oltId)) || state.olts[0];

  const targetHost = ip_address || olt?.ip_address;
  const targetPort = Number(telnet_port || olt?.telnet_port || 23);
  const targetUser = olt_username || olt?.olt_username || 'zte';
  const targetPass = olt_password || olt?.olt_password || '';
  const targetEnablePass =
    enable_password || olt?.enable_password || targetPass || 'zxr10';

  if (!targetHost) {
    res.status(404).json({ ok: false, error: 'OLT IP address not found in database' });
    return;
  }

  const cmdList = Array.isArray(commands) ? commands : [String(commands)];
  console.log(
    `[OLT Telnet Exec] Connecting to ${olt?.name || targetHost} (${targetHost}:${targetPort}) to run ${cmdList.length} command block(s)...`
  );

  const result = await executeTelnetSession({
    host: targetHost,
    port: targetPort,
    username: targetUser,
    password: targetPass,
    enablePassword: targetEnablePass,
    commands: cmdList,
  });

  console.log(
    `[OLT Telnet Exec] ${olt?.name || targetHost} (${targetHost}:${targetPort}) -> ok=${result.ok}, executed=${result.commandsExecuted.length} cmds in ${result.durationMs}ms${result.error ? ` (error: ${result.error})` : ''}`
  );

  res.json(result);
});

// POST /api/olts/:id/sync-live — Automatically fetch `show card`, `show gpon onu uncfg`,
// `show gpon onu state`, and `show running-config` via Telnet and synchronize all tables!
app.post('/api/olts/:id/sync-live', async (req, res) => {
  try {
    const oltId = Number(req.params.id);
    const {
      ip_address,
      telnet_port,
      olt_username,
      olt_password,
      enable_password,
      oltRecord,
    } = (req.body || {}) as {
      ip_address?: string;
      telnet_port?: number;
      olt_username?: string;
      olt_password?: string;
      enable_password?: string;
      oltRecord?: SmartOltDatabaseState['olts'][number];
    };

    let state = await loadDatabaseState();
    let olt = state.olts.find((o) => o.id === oltId);

    // If newly added OLT isn't saved yet in state.olts, insert it right now
    if (!olt && oltRecord) {
      state = {
        ...state,
        olts: [...state.olts, { ...oltRecord, id: oltId }],
      };
      olt = state.olts.find((o) => o.id === oltId);
    }

    const targetHost = ip_address || olt?.ip_address;
    const targetPort = Number(telnet_port || olt?.telnet_port || 23);
    const targetUser = olt_username || olt?.olt_username || 'zte';
    const targetPass = olt_password || olt?.olt_password || '';
    const targetEnablePass =
      enable_password || olt?.enable_password || targetPass || 'zxr10';

    if (!targetHost) {
      res.status(404).json({ ok: false, error: `OLT ID ${oltId} not found` });
      return;
    }

    console.log(
      `[OLT Live Sync] Fetching full configuration & telemetry from ${targetHost}:${targetPort} (user: ${targetUser})...`
    );

    const telnetRes = await executeTelnetSession({
      host: targetHost,
      port: targetPort,
      username: targetUser,
      password: targetPass,
      enablePassword: targetEnablePass,
      commands: [
        'show card',
        'show gpon onu uncfg',
        'show gpon onu state',
        'show running-config',
      ],
      timeoutMs: 40000,
    });

    if (!telnetRes.reachable || !telnetRes.output.trim()) {
      res.json({
        ok: false,
        reachable: false,
        error:
          telnetRes.error ||
          `Could not read configuration from OLT ${targetHost}:${targetPort}`,
        state,
      });
      return;
    }

    const { nextState, summary } = applyRunningConfigAndLiveTelemetryToState({
      state,
      oltId: olt ? olt.id : oltId,
      rawConfig: telnetRes.output,
      rawUncfgOutput: telnetRes.output,
      rawStateOutput: telnetRes.output,
      rawCardOutput: telnetRes.output,
      sourceLabel: 'Live Telnet Auto-Sync',
    });

    await saveDatabaseState(nextState);
    console.log(
      `[OLT Live Sync] Completed for ${targetHost}:${targetPort} -> ${summary.vlans} VLANs, ${summary.onus} Configured ONUs, ${summary.uncfgOnus} Unconfigured ONUs, ${summary.uplinks} Uplinks, ${summary.cards} Cards`
    );

    res.json({
      ok: true,
      reachable: true,
      synced: summary,
      state: nextState,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/olts/:id/import-config — Parse `#show running-config` and populate PostgreSQL
app.post('/api/olts/:id/import-config', async (req, res) => {
  try {
    const oltId = Number(req.params.id);
    const { rawConfig } = req.body as { rawConfig: string };
    if (!rawConfig || !rawConfig.trim()) {
      res.status(400).json({ error: 'rawConfig is empty' });
      return;
    }

    const state = await loadDatabaseState();
    const olt = state.olts.find((o) => o.id === oltId) || state.olts[0];
    if (!olt) {
      res.status(404).json({ error: `OLT ID ${oltId} not found in database` });
      return;
    }

    const { nextState, summary } = applyRunningConfigAndLiveTelemetryToState({
      state,
      oltId: olt.id,
      rawConfig,
      rawUncfgOutput: rawConfig,
      rawStateOutput: rawConfig,
      rawCardOutput: rawConfig,
      sourceLabel: 'Manual Running-Config Import',
    });

    await saveDatabaseState(nextState);
    res.json({
      ok: true,
      imported: summary,
      state: nextState,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/olts/:id/poll-uncfg — Live Telnet poll `show gpon onu uncfg` (and auto-sync config if OLT has no VLANs/ONUs yet)
app.post('/api/olts/:id/poll-uncfg', async (req, res) => {
  try {
    const oltId = Number(req.params.id);
    const { manualCliOutput, fullSync } = (req.body || {}) as {
      manualCliOutput?: string;
      fullSync?: boolean;
    };
    const state = await loadDatabaseState();
    const olt = state.olts.find((o) => o.id === oltId) || state.olts[0];
    if (!olt) {
      res.status(404).json({ error: 'OLT not found in database' });
      return;
    }

    const oltHasVlans = state.vlans.some((v) => v.olt_id === olt.id);
    const oltHasConfiguredOnus = state.onus.some(
      (o) => o.olt_id === olt.id && o.is_authorized
    );
    const shouldRunFullSync =
      fullSync === true || !oltHasVlans || !oltHasConfiguredOnus;

    if (!manualCliOutput && shouldRunFullSync) {
      const syncRes = await executeTelnetSession({
        host: olt.ip_address,
        port: olt.telnet_port,
        username: olt.olt_username,
        password: olt.olt_password,
        enablePassword: olt.enable_password,
        commands: [
          'show card',
          'show gpon onu uncfg',
          'show gpon onu state',
          'show running-config',
        ],
        timeoutMs: 38000,
      });

      if (syncRes.reachable && syncRes.output.includes('interface ')) {
        const { nextState, summary } = applyRunningConfigAndLiveTelemetryToState({
          state,
          oltId: olt.id,
          rawConfig: syncRes.output,
          rawUncfgOutput: syncRes.output,
          rawStateOutput: syncRes.output,
          rawCardOutput: syncRes.output,
          sourceLabel: 'Live Telnet Poll & Sync',
        });
        await saveDatabaseState(nextState);
        res.json({
          ok: true,
          telnetReachable: true,
          discoveredCount: summary.uncfgOnus,
          synced: summary,
          state: nextState,
        });
        return;
      }
    }

    let rawOutput = manualCliOutput || '';
    let telnetReachable = false;

    if (!rawOutput) {
      const telnetRes = await executeTelnetSession({
        host: olt.ip_address,
        port: olt.telnet_port,
        username: olt.olt_username,
        password: olt.olt_password,
        enablePassword: olt.enable_password,
        commands: ['show gpon onu uncfg', 'show gpon onu state'],
        timeoutMs: 12000,
      });
      telnetReachable = telnetRes.reachable;
      rawOutput = telnetRes.output;
    }

    const discovered = parseZteUncfgOutput(rawOutput);
    const parsedStates = parseZteOnuStateOutput(rawOutput);
    const stateByIf = new Map<string, (typeof parsedStates)[number]>();
    for (const st of parsedStates) {
      stateByIf.set(st.fullInterface.toLowerCase(), st);
    }

    const existingSns = new Set(
      state.onus.map((o) => o.serial_number.toUpperCase())
    );
    const newUnconfiguredOnus: OnuRecord[] = [];

    for (const d of discovered) {
      if (existingSns.has(d.serialNumber.toUpperCase())) continue;
      existingSns.add(d.serialNumber.toUpperCase());
      newUnconfiguredOnus.push({
        id: Date.now() + Math.floor(Math.random() * 10000),
        olt_id: olt.id,
        pon_port_id: olt.id * 100 + d.port,
        board: d.slot,
        port: d.port,
        onu_index: null,
        serial_number: d.serialNumber,
        onu_type: d.onuModel || 'ALL',
        is_authorized: false,
        customer_name: null,
        address: null,
        external_id: d.serialNumber,
        zone_id: null,
        odb_id: null,
        odb_port: null,
        vlan_id: null,
        speed_profile_id: 1,
        tcont_profile_id: 1,
        onu_mode: 'Routing',
        wan_mode: 'PPPOE',
        config_method: 'OMCI',
        wan_remote_access: 'Enabled from everywhere in the internet',
        wan_remote_allowed_subnet: '0.0.0.0/0',
        tr069_profile_id: 1,
        tr069_status: 'DISABLED',
        tr069_last_inform: null,
        wifi_ssid: null,
        wifi_password: null,
        pppoe_username: null,
        pppoe_password: null,
        hotspot_bridge_vlan: null,
        admin_state: 'ENABLED',
        phase_state: 'Unconfigured',
        onu_rx_dbm: -21.5,
        onu_tx_dbm: 2.3,
        olt_rx_dbm: -24.8,
        distance_m: 480,
        temperature_c: 40,
        ip_address: null,
        firmware_ver: d.firmwareVersion || 'V2.1.0',
        detected_ago: 'Just now',
        last_online_at: null,
        last_offline_reason: 'Waiting Authorization',
      });
    }

    const updatedExistingOnus = state.onus.map((u) => {
      if (u.olt_id !== olt.id || !u.is_authorized || u.onu_index === null) return u;
      const key = `gpon-onu_1/${u.board}/${u.port}:${u.onu_index}`.toLowerCase();
      const st = stateByIf.get(key);
      if (!st) return u;
      return {
        ...u,
        admin_state: st.adminState,
        phase_state: st.phaseState,
      };
    });

    const nextState: SmartOltDatabaseState = {
      ...state,
      onus: [...updatedExistingOnus, ...newUnconfiguredOnus],
    };
    await saveDatabaseState(nextState);

    res.json({
      ok: true,
      telnetReachable,
      discoveredCount: newUnconfiguredOnus.length,
      state: nextState,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 4. VITE MIDDLEWARE (DEV) OR STATIC ASSETS (PROD / DOCKER PORT 3004)
// ============================================================================
async function startServer() {
  await initPostgresConnection(currentPgConfig);

  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 3000;

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(
      `[JETCYBERNET SmartOLT Server] Running on http://0.0.0.0:${port} | Target DB: ${currentPgConfig.user}@${currentPgConfig.host}:${currentPgConfig.port}/${currentPgConfig.database}`
    );
  });
}

startServer();
