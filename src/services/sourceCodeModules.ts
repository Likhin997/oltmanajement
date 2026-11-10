/**
 * File: src/services/sourceCodeModules.ts
 * Menyimpan kode konfigurasi Docker (Port 3004) terpisah yang terkoneksi ke
 * PostgreSQL eksternal di localhost:5435 (user: likhin), skema SQL PostgreSQL bersih,
 * dan modul koneksi Telnet/SSH untuk deployment produksi.
 */

export interface CodeModuleFile {
  moduleNumber: 1 | 2 | 3 | 4;
  fileName: string;
  language: 'sql' | 'javascript' | 'typescript' | 'bash';
  description: string;
  code: string;
}

export const PRODUCTION_CODE_MODULES: CodeModuleFile[] = [
  {
    moduleNumber: 1,
    fileName: 'docker-compose.yml',
    language: 'bash',
    description:
      'Docker Compose App Terpisah (Port 3004) -> Konek ke PostgreSQL yang sudah ada di localhost:5435 (user: likhin)',
    code: `# File: docker-compose.yml
# Container SmartOLT dibuat TERPISAH dari container PostgreSQL Anda.
# Menggunakan network_mode: "host" agar aplikasi jalan di Port 3004 dan
# langsung terkoneksi ke PostgreSQL Anda di localhost:5435 (user: likhin).
#
# Jalankan dengan perintah:
#   docker compose up -d --build
# Akses web di:
#   http://localhost:3004

services:
  smartolt-web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: jetcybernet-smartolt-app
    restart: unless-stopped
    network_mode: "host"
    environment:
      - NODE_ENV=production
      - PORT=3004
      - PG_HOST=localhost
      - PG_PORT=5435
      - PG_USER=likhin
      - PG_PASSWORD=11013009
      - PG_DATABASE=smartolt_db
      - SQLITE_PATH=/app/data/smartolt_live.sqlite
    volumes:
      - ./data:/app/data
    extra_hosts:
      - "host.docker.internal:host-gateway"

# -----------------------------------------------------------------------------
# CATATAN: Jika Anda menggunakan Docker Desktop (Windows / Mac) di mana
# network_mode: "host" membatasi port mapping, gunakan konfigurasi alternatif ini:
#
# services:
#   smartolt-web:
#     build: .
#     container_name: jetcybernet-smartolt-app
#     restart: unless-stopped
#     ports:
#       - "3004:3004"
#     environment:
#       - NODE_ENV=production
#       - PORT=3004
#       - PG_HOST=host.docker.internal
#       - PG_PORT=5435
#       - PG_USER=likhin
#       - PG_PASSWORD=11013009
#       - PG_DATABASE=smartolt_db
#     extra_hosts:
#       - "host.docker.internal:host-gateway"
# -----------------------------------------------------------------------------
`,
  },
  {
    moduleNumber: 2,
    fileName: 'Dockerfile',
    language: 'bash',
    description:
      'Dockerfile Node 22 Alpine (Build Vite Frontend + Run Express, PostgreSQL Pool & Telnet Backend di Port 3004)',
    code: `# File: Dockerfile
FROM node:22-alpine

# Install build tools for native drivers
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build frontend production assets into /app/dist
RUN npm run build

# Persist local backup directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3004
ENV PG_HOST=localhost
ENV PG_PORT=5435
ENV PG_USER=likhin
ENV PG_PASSWORD=11013009
ENV PG_DATABASE=smartolt_db

EXPOSE 3004

CMD ["npx", "tsx", "server.ts"]
`,
  },
  {
    moduleNumber: 3,
    fileName: 'database/init.sql',
    language: 'sql',
    description:
      'Skema Database PostgreSQL (Port 5435, User: likhin) — Bersih Tanpa Data Dummy (Otomatis dibuat oleh server.ts)',
    code: `-- File: database/init.sql
-- Database PostgreSQL (localhost:5435 | user: likhin | db: smartolt_db)
-- Catatan: server.ts otomatis membuat database "smartolt_db" dan seluruh tabel ini saat startup!

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
`,
  },
  {
    moduleNumber: 4,
    fileName: 'server.ts (PostgreSQL Pool)',
    language: 'typescript',
    description:
      'Koneksi Pool PostgreSQL (pg) ke localhost:5435 dengan user likhin & Auto-Create Database/Tables',
    code: `import pg from 'pg';
const { Pool } = pg;

// Konfigurasi default koneksi PostgreSQL di server.ts:
export const pgConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5435), // Default 5432 diubah angka belakang jadi 5 -> 5435
  user: process.env.PG_USER || 'likhin',
  password: process.env.PG_PASSWORD || '11013009',
  database: process.env.PG_DATABASE || 'smartolt_db',
};

export const pgPool = new Pool({
  host: pgConfig.host,
  port: pgConfig.port,
  user: pgConfig.user,
  password: pgConfig.password,
  database: pgConfig.database,
  max: 15,
});
`,
  },
];
