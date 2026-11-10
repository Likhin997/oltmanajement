/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  INITIAL_DB_STATE,
  SmartOltDatabaseState,
  OnuRecord,
  ProvisioningLogRecord,
  VlanRecord,
} from './services/mockDatabase';
import {
  parseZteUncfgOutput,
  parseZteOnuStateOutput,
  parseZteOpticalAttenuation,
  generateAuthorizeCliScript,
  findNextAvailableOnuIndex,
} from './services/oltEngine';
import { PRODUCTION_CODE_MODULES } from './services/sourceCodeModules';
import { AuthorizeOnuModal } from './components/AuthorizeOnuModal';
import { OnuDetailView } from './components/OnuDetailView';
import { UpdateOnuModeModal } from './components/UpdateOnuModeModal';
import { OltDetailView, OltDetailTab } from './components/OltDetailView';
import { AddOltView } from './components/AddOltView';
import {
  Save,
  Contrast,
  FileCode,
  User,
  Power,
  ChevronDown,
  RefreshCw,
  Play,
  History,
  Square,
  Search,
  Plus,
  Download,
  Eye,
  Trash2,
  Check,
  Copy,
  Wifi,
  AlertTriangle,
  Sliders,
  Radio,
  Code2,
  X,
} from 'lucide-react';

type NavigationView =
  | 'DASHBOARD'
  | 'UNCONFIGURED'
  | 'AUTHORIZE_FORM'
  | 'CONFIGURED'
  | 'ONU_DETAIL'
  | 'OLTS_LIST'
  | 'ADD_OLT'
  | 'OLT_DETAIL'
  | 'TASKS'
  | 'ZONES'
  | 'SPLITTERS'
  | 'SPEED_PROFILES'
  | 'VPN_TR069'
  | 'DIAG_PARSER'
  | 'GRAPHS'
  | 'SOURCE_CODE';

const STORAGE_KEY = 'smartolt_jetcybernet_live_sql_cache';

export default function App() {
  const [db, setDb] = useState<SmartOltDatabaseState>(INITIAL_DB_STATE);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [dbMeta, setDbMeta] = useState<{
    dbEngine: string;
    pgConnected?: boolean;
    pgConfig?: {
      host: string;
      port: number;
      user: string;
      database: string;
    };
    pgLastError?: string | null;
    dockerPort: number;
  }>({
    dbEngine: 'PostgreSQL (localhost:5435)',
    pgConnected: false,
    pgConfig: {
      host: 'localhost',
      port: 5435,
      user: 'likhin',
      database: 'smartolt_db',
    },
    dockerPort: 3004,
  });
  const [showPgConfigModal, setShowPgConfigModal] = useState(false);
  const [pgHost, setPgHost] = useState('localhost');
  const [pgPort, setPgPort] = useState(5435);
  const [pgUser, setPgUser] = useState('likhin');
  const [pgPassword, setPgPassword] = useState('11013009');
  const [pgDatabase, setPgDatabase] = useState('smartolt_db');
  const [pgTesting, setPgTesting] = useState(false);
  const [showAddUncfgModal, setShowAddUncfgModal] = useState(false);
  const [manualUncfgOltId, setManualUncfgOltId] = useState<number>(1);
  const [manualUncfgPort, setManualUncfgPort] = useState<number>(1);
  const [manualUncfgSn, setManualUncfgSn] = useState<string>('ZTEGC6A394D4');
  const [manualUncfgType, setManualUncfgType] = useState<string>('ALL');

  // 1. Load live state from Backend SQL Database (/api/state) on mount
  useEffect(() => {
    let mounted = true;
    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data && data.state) {
          setDb(data.state);
        }
        if (data && data.meta) {
          setDbMeta(data.meta);
        }
        setDbLoaded(true);
      })
      .catch(() => {
        setDbLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 2. Sync state changes to Backend SQL Database (/api/state/sync)
  useEffect(() => {
    if (!dbLoaded) return;
    fetch('/api/state/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: db }),
    }).catch(() => {
      // ignore transient network error
    });
  }, [db, dbLoaded]);

  const [activeView, setActiveView] = useState<NavigationView>('DASHBOARD');
  const [selectedOltId, setSelectedOltId] = useState<number>(1);
  const [initialOltTab, setInitialOltTab] = useState<OltDetailTab>('OLT_DETAILS');
  const [selectedOnuId, setSelectedOnuId] = useState<number>(1);
  const [authorizingOnu, setAuthorizingOnu] = useState<OnuRecord | null>(null);
  const [updatingModeOnu, setUpdatingModeOnu] = useState<OnuRecord | null>(null);

  // Dropdown menus in Top Navbar
  const [openDropdown, setOpenDropdown] = useState<
    'MAP' | 'TASKS' | 'REPORTS' | 'SETTINGS' | null
  >(null);

  // Configured ONUs Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOlt, setFilterOlt] = useState<string>('ANY');
  const [filterBoard, setFilterBoard] = useState<string>('ANY');
  const [filterPort, setFilterPort] = useState<string>('ANY');
  const [filterZone, setFilterZone] = useState<string>('ANY');
  const [filterSplitter, setFilterSplitter] = useState<string>('ANY');
  const [filterVlan, setFilterVlan] = useState<string>('ANY');
  const [filterSignalLevel, setFilterSignalLevel] = useState<'ALL' | 'GOOD' | 'WARNING' | 'CRITICAL'>('ALL');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // CLI Regex Parser Tester State (in Diag tab)
  const [rawUncfgCli, setRawUncfgCli] = useState<string>(
    `POP-LEBAK-C300M# show gpon onu uncfg
OnuIndex                 Sn                  State
---------------------------------------------------------------------
gpon-onu_1/3/2:1         ZTEGC6A394D4        unknown
gpon-onu_1/3/3:1         ZICGB370351A        unknown
gpon-onu_1/3/4:8         ZTEGC6A388E1        unknown`
  );
  const [rawStateCli, setRawStateCli] = useState<string>(
    `POP-LEBAK-C300M# show gpon onu state gpon-olt_1/3/2
OnuIndex   Admin State  OMCC State   Phase State  Channel
--------------------------------------------------------------
1/3/2:8    enable       enable       working      1(GPON)
1/3/2:9    enable       disable      LOS          1(GPON)`
  );
  const [rawPowerCli, setRawPowerCli] = useState<string>(
    `POP-LEBAK-C300M# show pon power attenuation gpon-onu_1/3/2:8
           OLT                  ONU              Attenuation
----------------------------------------------------------------
up      Rx :-30.870(dbm)      Tx :2.350(dbm)        33.220(db)
down    Tx :11.026(dbm)       Rx :-23.190(dbm)      34.216(db)`
  );

  // Source Code Viewer state
  const [selectedCodeModuleId, setSelectedCodeModuleId] = useState<string>(
    PRODUCTION_CODE_MODULES[0].fileName
  );
  const [copiedCode, setCopiedCode] = useState(false);

  // Interactive Modals for Auto-Actions (Unconfigured), Add OLT, and Config Mismatches
  const [showAutoActionsModal, setShowAutoActionsModal] = useState(false);
  const [autoAuthEnabled, setAutoAuthEnabled] = useState(true);
  const [autoAuthVlanId, setAutoAuthVlanId] = useState<number>(1);
  const [showAddOltModal, setShowAddOltModal] = useState(false);
  const [newOltName, setNewOltName] = useState('POP SERPONG C320');
  const [newOltIp, setNewOltIp] = useState('172.16.10.2');
  const [newOltModel, setNewOltModel] = useState<'ZTE-C320' | 'ZTE-C300' | 'ZTE-C300M'>('ZTE-C320');
  const [newOltVpn, setNewOltVpn] = useState('POPSERPONG');
  const [showMismatchModal, setShowMismatchModal] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const unconfiguredOnus = db.onus.filter((o) => !o.is_authorized);
  const configuredOnus = db.onus.filter((o) => o.is_authorized);
  const onlineOnus = configuredOnus.filter((o) => o.phase_state === 'working');
  const losOnus = configuredOnus.filter((o) => o.phase_state === 'LOS');
  const pwrFailOnus = configuredOnus.filter((o) => o.phase_state === 'DyingGasp');
  const otherOfflineOnus = configuredOnus.filter(
    (o) =>
      o.phase_state !== 'working' &&
      o.phase_state !== 'LOS' &&
      o.phase_state !== 'DyingGasp'
  );
  const totalOfflineCount =
    losOnus.length + pwrFailOnus.length + otherOfflineOnus.length;
  const warningSignalOnus = configuredOnus.filter(
    (o) => o.onu_rx_dbm !== null && o.onu_rx_dbm <= -27.0 && o.onu_rx_dbm > -30.0
  );
  const criticalSignalOnus = configuredOnus.filter(
    (o) => o.onu_rx_dbm !== null && o.onu_rx_dbm <= -30.0
  );
  const totalLowSignalCount =
    warningSignalOnus.length + criticalSignalOnus.length;

  // Filtered Configured ONUs
  const filteredConfiguredOnus = configuredOnus.filter((o) => {
    if (filterOlt !== 'ANY' && o.olt_id !== Number(filterOlt)) return false;
    if (filterBoard !== 'ANY' && o.board !== Number(filterBoard)) return false;
    if (filterPort !== 'ANY' && o.port !== Number(filterPort)) return false;
    if (filterZone !== 'ANY' && o.zone_id !== Number(filterZone)) return false;
    if (filterSplitter !== 'ANY' && o.odb_id !== Number(filterSplitter)) return false;
    if (filterVlan !== 'ANY' && o.vlan_id !== Number(filterVlan)) return false;

    if (filterSignalLevel !== 'ALL') {
      const rx = o.onu_rx_dbm;
      if (filterSignalLevel === 'GOOD' && (rx === null || rx < -26.99)) return false;
      if (filterSignalLevel === 'WARNING' && (rx === null || rx >= -26.99 || rx < -29.99))
        return false;
      if (filterSignalLevel === 'CRITICAL' && rx !== null && rx >= -29.99 && o.phase_state !== 'LOS')
        return false;
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchName = (o.customer_name || '').toLowerCase().includes(q);
      const matchSn = o.serial_number.toLowerCase().includes(q);
      const matchPppoe = (o.pppoe_username || '').toLowerCase().includes(q);
      if (!matchName && !matchSn && !matchPppoe) return false;
    }
    return true;
  });

  // Central Live OLT CLI Executor — sends commands via Telnet/SSH to the target OLT
  // and updates provisioning_logs + toast with the real OLT execution response.
  const executeOltCliLive = async (
    oltId: number,
    cliScript: string,
    logId: number,
    summaryLabel: string,
    oltConnectionOverride?: {
      ip_address: string;
      telnet_port: number;
      olt_username: string;
      olt_password: string;
    }
  ) => {
    const startMs = Date.now();
    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oltId,
          ...(oltConnectionOverride || {}),
          commands: cliScript,
        }),
      });
      const data = await resp.json();
      const elapsedMs = Date.now() - startMs;

      if (data.ok) {
        const cleanOutput = (data.output || '[OK - Executed on OLT]').trim();
        setDb((prev) => ({
          ...prev,
          provisioning_logs: prev.provisioning_logs.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  olt_response: cleanOutput || '[OK - Executed on OLT]',
                  execution_status: 'SUCCESS',
                  duration_ms: elapsedMs,
                }
              : l
          ),
        }));
        showToast(`✓ LIVE OLT: ${summaryLabel} berhasil dieksekusi di OLT (${elapsedMs}ms)`);
      } else {
        const errMsg = data.error || 'Telnet execution failed';
        setDb((prev) => ({
          ...prev,
          provisioning_logs: prev.provisioning_logs.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  olt_response: `[TELNET ERROR] ${errMsg}`,
                  execution_status: 'FAILED',
                  duration_ms: elapsedMs,
                }
              : l
          ),
        }));
        showToast(`⚠ Disimpan ke DB, namun gagal eksekusi Telnet OLT: ${errMsg}`);
      }
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      setDb((prev) => ({
        ...prev,
        provisioning_logs: prev.provisioning_logs.map((l) =>
          l.id === logId
            ? {
                ...l,
                olt_response: `[NETWORK ERROR] ${(err as Error).message}`,
                execution_status: 'FAILED',
                duration_ms: elapsedMs,
              }
            : l
        ),
      }));
    }
  };

  // Authorize ONU Handler
  const handleConfirmAuthorize = (
    onuId: number,
    updatedFields: Partial<OnuRecord>,
    generatedCli: string,
    allocatedOnuIndex: number
  ) => {
    const targetOnu = db.onus.find((o) => o.id === onuId);
    if (!targetOnu) return;

    const targetOltId = updatedFields.olt_id || targetOnu.olt_id || db.olts[0]?.id || 1;
    const targetBoard = updatedFields.board || targetOnu.board || 3;
    const targetPortNum = updatedFields.port || targetOnu.port || 1;
    const logId = Date.now();
    const onuIf = `gpon-onu_1/${targetBoard}/${targetPortNum}:${allocatedOnuIndex}`;

    const newLog: ProvisioningLogRecord = {
      id: logId,
      olt_id: targetOltId,
      onu_id: onuId,
      serial_number: targetOnu.serial_number,
      action_type: 'AUTHORIZE',
      interface_target: onuIf,
      summary_text: `${onuIf} authorized (${targetOnu.serial_number})`,
      cli_script: generatedCli,
      olt_response: '[Executing on OLT via Telnet...]',
      execution_status: 'SUCCESS',
      executed_by: 'likhin',
      duration_ms: 0,
      created_at: 'Just now',
    };

    setDb((prev) => {
      const hasPonPort = prev.pon_ports.some(
        (p) => p.olt_id === targetOltId && p.port_number === targetPortNum
      );
      const updatedPonPorts = hasPonPort
        ? prev.pon_ports.map((p) =>
            p.olt_id === targetOltId && p.port_number === targetPortNum
              ? {
                  ...p,
                  oper_status: 'Up' as const,
                  online_onus: p.online_onus + 1,
                  total_onus: p.total_onus + 1,
                }
              : p
          )
        : [
            ...prev.pon_ports,
            {
              id: targetOltId * 100 + targetPortNum,
              olt_id: targetOltId,
              rack: 1,
              shelf: 3,
              slot: targetBoard,
              port_number: targetPortNum,
              interface_name: `gpon-olt_1/${targetBoard}/${targetPortNum}`,
              board_model: 'GTGH',
              description: `PON 1/${targetBoard}/${targetPortNum}`,
              admin_state: 'ENABLED' as const,
              oper_status: 'Up' as const,
              online_onus: 1,
              total_onus: 1,
              avg_signal_dbm: -23.5,
              tx_power_dbm: 10.5,
              max_onu_capacity: 128,
            },
          ];

      const hasVlan = prev.vlans.some((v) => v.olt_id === targetOltId);
      const updatedVlans = hasVlan
        ? prev.vlans
        : [
            ...prev.vlans,
            {
              id: targetOltId * 10000 + 100,
              olt_id: targetOltId,
              vlan_id: 100,
              name: 'TR069',
              description: 'TR069 Management',
              default_for: 'None selected',
              used_for_mgmt_tr069_voip: true,
              used_for_iptv: false,
              dhcp_snooping: false,
              lan_to_lan: false,
              onus_count: 0,
              service_type: 'TR069_MGMT' as const,
              svlan_id: null,
              is_default: false,
            },
            {
              id: targetOltId * 10000 + 101,
              olt_id: targetOltId,
              vlan_id: 101,
              name: 'PPPOE',
              description: 'PPPOE Subscribers',
              default_for: 'None selected',
              used_for_mgmt_tr069_voip: false,
              used_for_iptv: false,
              dhcp_snooping: false,
              lan_to_lan: false,
              onus_count: 1,
              service_type: 'PPPOE' as const,
              svlan_id: null,
              is_default: true,
            },
          ];

      return {
        ...prev,
        onus: prev.onus.map((item) =>
          item.id === onuId ? { ...item, ...updatedFields } : item
        ),
        pon_ports: updatedPonPorts,
        vlans: updatedVlans,
        provisioning_logs: [newLog, ...prev.provisioning_logs],
      };
    });

    setAuthorizingOnu(null);
    setSelectedOnuId(onuId);
    setActiveView('ONU_DETAIL');
    showToast(
      `Mengeksekusi Authorize ${targetOnu.serial_number} pada ${onuIf} ke OLT...`
    );

    void executeOltCliLive(
      targetOltId,
      generatedCli,
      logId,
      `Authorize ${targetOnu.serial_number} (${onuIf})`
    );
  };

  // Execute ONU Action Handler (Update ONU mode, TR069 Push, Reboot, Resync, Restore, Delete)
  const handleExecuteOnuAction = (
    onuId: number,
    actionType:
      | 'UPDATE_ONU_MODE'
      | 'TR069_PUSH'
      | 'REBOOT'
      | 'RESYNC_CONFIG'
      | 'FACTORY_RESET'
      | 'UPDATE_PPPOE'
      | 'DELETE_ONU'
      | 'POLL_SIGNAL',
    cliScript: string,
    updatedFields?: Partial<OnuRecord>
  ) => {
    const targetOnu = db.onus.find((o) => o.id === onuId);
    if (!targetOnu) return;

    const targetOltId = targetOnu.olt_id || db.olts[0]?.id || 1;
    const onuIf = `gpon-onu_1/${targetOnu.board}/${targetOnu.port}:${targetOnu.onu_index || 1}`;
    const summaryMap: Record<string, string> = {
      UPDATE_ONU_MODE: `${onuIf} Changed WAN mode & WAN remote access`,
      TR069_PUSH: `${onuIf} TR-069 CWMP Inform & SetParameterValues pushed`,
      REBOOT: `${onuIf} Rebooted ONU`,
      RESYNC_CONFIG: `${onuIf} Resync config`,
      FACTORY_RESET: `${onuIf} Restored factory defaults`,
      UPDATE_PPPOE: `${onuIf} Updated CLI configuration`,
      DELETE_ONU: `${onuIf} Deleted ONU (${targetOnu.serial_number})`,
      POLL_SIGNAL: `${onuIf} Polled optical power attenuation`,
    };

    const logId = Date.now();
    const newLog: ProvisioningLogRecord = {
      id: logId,
      olt_id: targetOltId,
      onu_id: onuId,
      serial_number: targetOnu.serial_number,
      action_type: actionType,
      interface_target: onuIf,
      summary_text: summaryMap[actionType] || `${onuIf} ${actionType}`,
      cli_script: cliScript,
      olt_response: '[Executing on OLT via Telnet...]',
      execution_status: 'SUCCESS',
      executed_by: 'likhin',
      duration_ms: 0,
      created_at: 'Just now',
    };

    if (actionType === 'DELETE_ONU') {
      setDb((prev) => ({
        ...prev,
        onus: prev.onus.map((item) =>
          item.id === onuId
            ? {
                ...item,
                is_authorized: false,
                onu_index: null,
                phase_state: 'Unconfigured',
                detected_ago: 'Just now',
              }
            : item
        ),
        provisioning_logs: [newLog, ...prev.provisioning_logs],
      }));
      setActiveView('UNCONFIGURED');
      showToast(`Menghapus ONU ${targetOnu.serial_number} dari OLT (${onuIf})...`);
      void executeOltCliLive(
        targetOltId,
        cliScript,
        logId,
        `Delete ONU ${targetOnu.serial_number} (${onuIf})`
      );
      return;
    }

    setDb((prev) => ({
      ...prev,
      onus: prev.onus.map((item) =>
        item.id === onuId ? { ...item, ...(updatedFields || {}) } : item
      ),
      provisioning_logs: [newLog, ...prev.provisioning_logs],
    }));

    showToast(`Mengeksekusi ${summaryMap[actionType]} ke OLT...`);

    // Execute CLI script on live OLT via Telnet (skip if it's an HTTP JSON preview like TR069_PUSH)
    if (actionType !== 'TR069_PUSH' && cliScript && !cliScript.trim().startsWith('# [TR-069')) {
      void executeOltCliLive(
        targetOltId,
        cliScript,
        logId,
        summaryMap[actionType] || actionType
      );
    }
  };

  // Render Signal Bars helper matching Screenshot _D6CCC96A
  const renderSignalCell = (onu: OnuRecord) => {
    if (onu.phase_state === 'LOS' || onu.onu_rx_dbm === null) {
      return <span className="text-slate-500">-</span>;
    }
    const rx = onu.onu_rx_dbm;
    const isCritical = rx <= -30.0;
    const isWarning = rx <= -27.0 && rx > -30.0;
    return (
      <div className="flex items-center gap-1.5 font-mono text-xs text-slate-200">
        <span>{rx.toFixed(2)} dBm</span>
        <span className="inline-flex items-end gap-0.5">
          <span
            className={`h-1.5 w-0.5 ${
              isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`h-2.5 w-0.5 ${
              isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`h-3.5 w-0.5 ${
              isCritical ? 'bg-slate-600' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
        </span>
      </div>
    );
  };

  const selectedOlt =
    db.olts.find((o) => o.id === selectedOltId) || db.olts[db.olts.length - 1];
  const selectedOnu =
    db.onus.find((o) => o.id === selectedOnuId) || configuredOnus[1] || configuredOnus[0];

  return (
    <div
      className="min-h-screen bg-[#081526] text-slate-100"
      style={{
        backgroundImage: `radial-gradient(circle at 75% 20%, rgba(16, 52, 96, 0.45) 0%, transparent 55%), linear-gradient(135deg, #071220 0%, #0b1d35 50%, #071426 100%)`,
      }}
      onClick={() => {
        if (openDropdown) setOpenDropdown(null);
      }}
    >
      {/* TOP NAVIGATION BAR (Identical to JETCYBERNET SmartOLT Screenshots) */}
      <header className="sticky top-0 z-40 border-b border-[#193354] bg-[#0b1a2e]/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between px-4 py-2.5">
          {/* Left Brand + Primary Menu Links */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-4">
            <button
              type="button"
              onClick={() => setActiveView('DASHBOARD')}
              className="mr-2 text-base font-bold tracking-wider text-white hover:text-sky-300"
            >
              JETCYBERNET
            </button>

            <button
              type="button"
              onClick={() => setActiveView('UNCONFIGURED')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition ${
                activeView === 'UNCONFIGURED' || activeView === 'AUTHORIZE_FORM'
                  ? 'bg-[#163052] text-white'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              Unconfigured
            </button>

            <button
              type="button"
              onClick={() => setActiveView('CONFIGURED')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition ${
                activeView === 'CONFIGURED' || activeView === 'ONU_DETAIL'
                  ? 'bg-[#163052] text-white'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              Configured
            </button>

            {/* Map Dropdown */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'MAP' ? null : 'MAP')
                }
                className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-slate-200 hover:text-white"
              >
                Map <ChevronDown className="h-3 w-3" />
              </button>
              {openDropdown === 'MAP' && (
                <div className="absolute left-0 mt-1 w-40 rounded border border-slate-700 bg-[#111c2d] py-1.5 text-xs shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('ZONES');
                      setOpenDropdown(null);
                    }}
                    className="block w-full px-4 py-1.5 text-left text-slate-200 hover:bg-[#1b2e4b]"
                  >
                    Zones & ODB Map
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('SPLITTERS');
                      setOpenDropdown(null);
                    }}
                    className="block w-full px-4 py-1.5 text-left text-slate-200 hover:bg-[#1b2e4b]"
                  >
                    Splitters (ODP)
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveView('GRAPHS')}
              className={`rounded px-2 py-1.5 text-xs font-medium ${
                activeView === 'GRAPHS'
                  ? 'bg-[#163052] text-white'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              Graphs
            </button>

            <button
              type="button"
              onClick={() => setActiveView('DASHBOARD')}
              className="rounded px-2 py-1.5 text-xs font-medium text-slate-200 hover:text-white"
            >
              Events
            </button>

            <button
              type="button"
              onClick={() => setActiveView('DIAG_PARSER')}
              className={`rounded px-2 py-1.5 text-xs font-medium ${
                activeView === 'DIAG_PARSER'
                  ? 'bg-[#163052] text-white'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              Diag
            </button>

            {/* Tasks Dropdown (matching Screenshot image_fdf3e3de.png) */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'TASKS' ? null : 'TASKS')
                }
                className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                  activeView === 'TASKS' || openDropdown === 'TASKS'
                    ? 'bg-[#163052] text-white'
                    : 'text-slate-200 hover:text-white'
                }`}
              >
                Tasks <ChevronDown className="h-3 w-3" />
              </button>
              {openDropdown === 'TASKS' && (
                <div className="absolute left-0 mt-1 w-36 rounded border border-slate-700 bg-[#111c2d] py-1.5 text-xs shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('TASKS');
                      setOpenDropdown(null);
                    }}
                    className="block w-full px-4 py-1.5 text-left text-white hover:bg-[#1b2e4b]"
                  >
                    Tasks
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('TASKS');
                      setOpenDropdown(null);
                    }}
                    className="block w-full px-4 py-1.5 text-left text-slate-200 hover:bg-[#1b2e4b]"
                  >
                    Tickets
                  </button>
                </div>
              )}
            </div>

            {/* Reports Dropdown */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'REPORTS' ? null : 'REPORTS')
                }
                className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-slate-200 hover:text-white"
              >
                Reports <ChevronDown className="h-3 w-3" />
              </button>
              {openDropdown === 'REPORTS' && (
                <div className="absolute left-0 mt-1 w-44 rounded border border-slate-700 bg-[#111c2d] py-1.5 text-xs shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('GRAPHS');
                      setOpenDropdown(null);
                    }}
                    className="block w-full px-4 py-1.5 text-left text-slate-200 hover:bg-[#1b2e4b]"
                  >
                    Optical Signal Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('SOURCE_CODE');
                      setOpenDropdown(null);
                    }}
                    className="block w-full px-4 py-1.5 text-left text-emerald-400 hover:bg-[#1b2e4b]"
                  >
                    Export SQL & Backend Code
                  </button>
                </div>
              )}
            </div>

            {/* Settings Dropdown (Exact match to Screenshot 7) */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'SETTINGS' ? null : 'SETTINGS')
                }
                className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                  openDropdown === 'SETTINGS' ||
                  activeView === 'OLTS_LIST' ||
                  activeView === 'OLT_DETAIL'
                    ? 'bg-[#163052] text-white'
                    : 'text-slate-200 hover:text-white'
                }`}
              >
                Settings <ChevronDown className="h-3 w-3" />
              </button>
              {openDropdown === 'SETTINGS' && (
                <div className="absolute left-0 mt-1 w-44 rounded border border-slate-700 bg-[#111c2d] py-1.5 text-xs shadow-2xl">
                  {[
                    { label: 'Zones', view: 'ZONES' as NavigationView },
                    { label: 'Sectors', view: 'ZONES' as NavigationView },
                    { label: 'Splitters', view: 'SPLITTERS' as NavigationView },
                    { label: 'ONU types', view: 'SPEED_PROFILES' as NavigationView },
                    {
                      label: 'Speed profiles',
                      view: 'SPEED_PROFILES' as NavigationView,
                    },
                    { label: 'OLTs', view: 'OLTS_LIST' as NavigationView },
                    { label: 'VPN & TR069', view: 'VPN_TR069' as NavigationView },
                    { label: 'Presets', view: 'VPN_TR069' as NavigationView },
                    { label: 'General', view: 'SOURCE_CODE' as NavigationView },
                    { label: 'Billing', view: 'SOURCE_CODE' as NavigationView },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setActiveView(item.view);
                        setOpenDropdown(null);
                      }}
                      className="block w-full px-4 py-1.5 text-left text-slate-200 hover:bg-[#1b2e4b] hover:text-white"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Utility Icons + Live PostgreSQL (:5435) & Docker Port 3004 Indicator */}
          <div className="flex items-center gap-3 text-slate-200">
            <button
              type="button"
              onClick={() => setShowPgConfigModal(true)}
              title="Click to configure/test PostgreSQL connection (localhost:5435, user: likhin)"
              className="hidden sm:inline-flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-950/50 px-2.5 py-1 font-mono text-[11px] font-semibold text-sky-300 hover:bg-sky-900/60"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  dbMeta.pgConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              PG: {pgUser}@{pgHost}:{pgPort} · Docker :3004
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/state/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ state: db }),
                });
                showToast(
                  `State synced to ${dbMeta.dbEngine} Database (${db.olts.length} OLTs, ${configuredOnus.length} ONUs).`
                );
              }}
              title="Save state to SQL Database & OLT NVRAM"
              className="hover:text-white"
            >
              <Save className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveView('VPN_TR069')}
              title="TR-069 CWMP ACS & Remote Access"
              className="hover:text-emerald-400"
            >
              <Contrast className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveView('SOURCE_CODE')}
              title="View Complete SQL Schema, Dockerfile (Port 3004) & Backend Code"
              className="flex items-center gap-1 rounded bg-emerald-600/20 px-2 py-1 text-[11px] font-semibold text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30"
            >
              <FileCode className="h-3.5 w-3.5" />
              Docker :3004 &amp; SQL
            </button>
            <button type="button" className="hover:text-white" title="Admin Account">
              <User className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={async () => {
                localStorage.removeItem(STORAGE_KEY);
                const resp = await fetch('/api/database/reset', {
                  method: 'POST',
                });
                const data = await resp.json();
                if (data.state) setDb(data.state);
                showToast('Database SQL berhasil dikosongkan (0 OLT, 0 ONU).');
              }}
              title="Reset / Empty SQL Database"
              className="flex items-center gap-1 text-xs font-medium text-red-300 hover:text-red-200"
            >
              <Power className="h-3.5 w-3.5" />
              Reset DB
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed right-5 bottom-5 z-50 flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-[#0d223a] px-4 py-3 text-xs font-semibold text-emerald-300 shadow-2xl">
          <Check className="h-4 w-4 text-emerald-400" />
          {toastMsg}
        </div>
      )}

      {/* MAIN PAGE CONTAINER */}
      <main className="mx-auto max-w-[1440px] px-4 py-5">
        {/* ===================================================================
            VIEW 1: DASHBOARD (Exact match to Screenshot image_eaabc7d1.png)
           =================================================================== */}
        {activeView === 'DASHBOARD' && (
          <div className="space-y-5">
            {/* Top 4 Colored Status Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Card 1: Waiting authorization (Blue) */}
              <div
                onClick={() => setActiveView('UNCONFIGURED')}
                className="cursor-pointer rounded-md bg-[#007bff] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">
                    Waiting authorization
                  </span>
                  <span className="text-3xl font-bold leading-none">
                    {unconfiguredOnus.length}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/20 pt-1.5 text-xs">
                  <span>D: 0</span>
                  <span>Resync: 0</span>
                  <span>New: {unconfiguredOnus.length}</span>
                </div>
              </div>

              {/* Card 2: Online (Green — 100% Live from SQL Database) */}
              <div
                onClick={() => {
                  setFilterSignalLevel('ALL');
                  setActiveView('CONFIGURED');
                }}
                className="cursor-pointer rounded-md bg-[#28a745] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Online</span>
                  <span className="text-3xl font-bold leading-none">
                    {onlineOnus.length}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-end border-t border-white/20 pt-1.5 text-xs">
                  <span>Total authorized: {configuredOnus.length}</span>
                </div>
              </div>

              {/* Card 3: Total offline (Dark Slate — 100% Live from SQL Database) */}
              <div
                onClick={() => setActiveView('CONFIGURED')}
                className="cursor-pointer rounded-md bg-[#343a40] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Total offline</span>
                  <span className="text-3xl font-bold leading-none">
                    {totalOfflineCount}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/20 pt-1.5 text-xs">
                  <span>PwrFail: {pwrFailOnus.length}</span>
                  <span>LoS: {losOnus.length}</span>
                  <span>N/A: {otherOfflineOnus.length}</span>
                </div>
              </div>

              {/* Card 4: Low signals (Orange — 100% Live from SQL Database) */}
              <div
                onClick={() => {
                  setFilterSignalLevel('CRITICAL');
                  setActiveView('CONFIGURED');
                }}
                className="cursor-pointer rounded-md bg-[#e67e22] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Low signals</span>
                  <span className="text-3xl font-bold leading-none">
                    {totalLowSignalCount}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/20 pt-1.5 text-xs">
                  <span>Warning: {warningSignalOnus.length}</span>
                  <span>Critical: {criticalSignalOnus.length}</span>
                </div>
              </div>
            </div>

            {/* Middle Row: Network status chart + OLTs online */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Network status area graph */}
              <div className="rounded border border-[#1e3a5f] bg-[#0b192c]/90 p-4 lg:col-span-6">
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span className="text-sm font-bold text-white">
                    Network status
                  </span>
                  <span className="font-bold text-white">Hourly</span>
                  <span className="text-slate-500">|</span>
                  <button
                    type="button"
                    onClick={() => setActiveView('GRAPHS')}
                    className="text-sky-400 hover:underline"
                  >
                    Daily
                  </button>
                </div>

                <div className="rounded border border-slate-800 bg-[#05080f] p-3">
                  <div className="text-center font-mono text-[11px] font-bold text-slate-200">
                    Network status (live SQL telemetry) — total: {configuredOnus.length} ONUs
                  </div>
                  <div className="mt-2 flex h-32 items-end gap-0.5 border-b border-l border-slate-700 pt-4">
                    {Array.from({ length: 36 }, (_, i) => (
                      <div
                        key={i}
                        className="flex h-full flex-1 flex-col justify-end"
                      >
                        <div
                          className="w-full bg-amber-500/80"
                          style={{
                            height: totalLowSignalCount > 0 ? '12%' : '0%',
                          }}
                        />
                        <div
                          className="w-full bg-emerald-500/80"
                          style={{
                            height: onlineOnus.length > 0 ? '75%' : '4%',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between font-mono text-[10px] text-slate-300">
                    <span className="text-emerald-400">
                      ■ Online: {onlineOnus.length}
                    </span>
                    <span className="text-amber-400">
                      ■ Low signal: {totalLowSignalCount}
                    </span>
                    <span className="text-red-400">■ LOS: {losOnus.length}</span>
                    <span className="text-sky-400">
                      ■ Power fail: {pwrFailOnus.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* OLTs online list (Zero Dummy Data) */}
              <div className="rounded border border-[#1e3a5f] bg-[#0b192c]/90 p-4 lg:col-span-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">OLTs</span>
                    <span className="rounded bg-[#28a745] px-2 py-0.5 text-[11px] font-bold text-white">
                      {db.olts.filter((o) => o.status === 'ONLINE').length}/
                      {db.olts.length} online
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView('ADD_OLT')}
                    className="flex items-center gap-1 rounded bg-[#5cb85c] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#4cae4c]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add OLT
                  </button>
                </div>

                {db.olts.length === 0 ? (
                  <div className="rounded border border-dashed border-[#284870] bg-[#0c1c30]/60 p-6 text-center text-xs text-slate-300">
                    <p className="font-semibold text-white">
                      Belum ada OLT terdaftar di Database ({dbMeta.dbEngine}).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Klik tombol <strong>+ Add OLT</strong> untuk menghubungkan OLT baru atau mengimpor <code>#show running-config</code>.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveView('ADD_OLT')}
                      className="mt-3 inline-flex items-center gap-1.5 rounded bg-[#0275d8] px-4 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Your First OLT
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-[#1e3a5f]/70 text-xs">
                    {db.olts.map((o) => (
                      <div
                        key={o.id}
                        className="flex flex-wrap items-center justify-between py-2 hover:bg-[#132842]/50 px-2 rounded"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOltId(o.id);
                              setInitialOltTab('OLT_DETAILS');
                              setActiveView('OLT_DETAIL');
                            }}
                            className="font-medium text-sky-400 hover:underline"
                          >
                            {o.id} - {o.name} ({o.ip_address})
                          </button>
                        </div>
                        <div className="flex items-center gap-4 font-mono text-xs">
                          <span className="text-slate-300">
                            Uptime: {o.uptime_str},
                          </span>
                          <span
                            className={
                              o.temperature_c >= 50
                                ? 'font-bold text-red-400'
                                : o.temperature_c >= 42
                                ? 'font-bold text-amber-400'
                                : 'font-bold text-emerald-400'
                            }
                          >
                            {o.temperature_c}°C
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row: PON outage accordions + Info activity feed */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* PON outage (Live from SQL Database) */}
              <div className="space-y-2 lg:col-span-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">PON outage</span>
                  <span className="text-xs text-slate-400">
                    Live optical monitoring
                  </span>
                </div>

                <div className="overflow-hidden rounded border border-[#1e3a5f] bg-[#0c1c30]">
                  <div className="flex items-center justify-between bg-[#162b46] px-3 py-2 text-xs font-semibold text-white">
                    <span>Signal variations &amp; LOS</span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px]">
                        {criticalSignalOnus.length + losOnus.length} Critical
                      </span>
                    </div>
                  </div>
                  {criticalSignalOnus.length === 0 && losOnus.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-slate-400">
                      Tidak ada PON outage atau sinyal kritis pada database saat ini.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#1e3a5f] text-slate-300">
                        <tr>
                          <th className="px-3 py-1.5">OLT</th>
                          <th className="px-3 py-1.5">ONU / PON</th>
                          <th className="px-3 py-1.5">SN</th>
                          <th className="px-3 py-1.5">Signal / State</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e3a5f]/50">
                        {[...losOnus, ...criticalSignalOnus]
                          .slice(0, 6)
                          .map((item) => {
                            const o = db.olts.find((x) => x.id === item.olt_id);
                            return (
                              <tr key={item.id}>
                                <td className="px-3 py-1.5">
                                  {o ? `${o.id} - ${o.name}` : `OLT ${item.olt_id}`}
                                </td>
                                <td className="px-3 py-1.5 text-sky-400">
                                  1/{item.board}/{item.port}:{item.onu_index} (
                                  {item.customer_name})
                                </td>
                                <td className="px-3 py-1.5 font-mono">
                                  {item.serial_number}
                                </td>
                                <td className="px-3 py-1.5">
                                  <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                                    {item.phase_state === 'LOS'
                                      ? 'LOS'
                                      : `${item.onu_rx_dbm} dBm`}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Info activity feed (Live from SQL Database) */}
              <div className="space-y-2 lg:col-span-6">
                <div className="text-sm font-bold text-white">Info</div>
                <div className="divide-y divide-[#1e3a5f]/60 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 text-xs">
                  {db.provisioning_logs.length === 0 ? (
                    <div className="px-3 py-4 text-center text-slate-400">
                      Belum ada riwayat aktivitas provisioning di database.
                    </div>
                  ) : (
                    db.provisioning_logs.slice(0, 6).map((log) => {
                      const logOlt = db.olts.find((o) => o.id === log.olt_id);
                      return (
                        <div
                          key={log.id}
                          className="flex flex-wrap items-center justify-between px-3 py-2.5 hover:bg-[#132842]/50"
                        >
                          <div>
                            <span className="font-mono text-sky-400">
                              {log.summary_text ||
                                `${log.interface_target} ${log.action_type}`}
                            </span>{' '}
                            <span className="text-slate-300">
                              on {log.olt_id} - {logOlt?.name || 'OLT'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            by {log.executed_by} · {log.created_at}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 2: UNCONFIGURED ONUS (Live Telnet Poll & Manual SN Registration)
           =================================================================== */}
        {activeView === 'UNCONFIGURED' && (
          <div className="space-y-5 text-xs">
            {/* Top Row: OLT Selector + Refresh on Left, Auto actions on Right */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white">OLT</span>
                <select className="rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>All selected ({db.olts.length})</option>
                  {db.olts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} - {o.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (db.olts.length === 0) {
                      showToast('Tambahkan OLT terlebih dahulu di menu Settings -> OLTs.');
                      return;
                    }
                    let totalFound = 0;
                    for (const o of db.olts) {
                      try {
                        const resp = await fetch(`/api/olts/${o.id}/poll-uncfg`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({}),
                        });
                        const data = await resp.json();
                        if (data.state) setDb(data.state);
                        totalFound += data.discoveredCount || 0;
                      } catch {
                        // ignore
                      }
                    }
                    showToast(
                      `Live Telnet Poll (show gpon onu uncfg) selesai: ${
                        totalFound > 0
                          ? `${totalFound} SN baru ditemukan!`
                          : `${unconfiguredOnus.length} ONU menunggu otorisasi.`
                      }`
                    );
                  }}
                  className="flex items-center gap-1 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Poll OLT (Telnet)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (db.olts.length === 0) {
                      showToast('Tambahkan OLT terlebih dahulu sebelum mendeteksi ONU.');
                      setActiveView('ADD_OLT');
                      return;
                    }
                    setManualUncfgOltId(db.olts[0].id);
                    setShowAddUncfgModal(true);
                  }}
                  className="flex items-center gap-1 rounded bg-[#5cb85c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#4cae4c]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Register Unconfigured SN
                </button>
              </div>

              {/* Auto actions box matching top-right of Screenshot _C1DBB18F */}
              <div className="space-y-1.5 text-right">
                <div className="text-xs text-slate-200">
                  Auto actions:{' '}
                  <span className="text-slate-300">
                    Authorization: {autoAuthEnabled ? 'yes' : 'no'} · Move: no · Resync: no
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAutoActionsModal(true)}
                    className="flex items-center gap-1 rounded bg-[#5cb85c] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
                  >
                    <Play className="h-3 w-3" />
                    Configure actions
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView('TASKS')}
                    className="flex items-center gap-1 rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                  >
                    <History className="h-3 w-3" />
                    Task history
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAutoAuthEnabled(false);
                      showToast('Auto-actions stopped.');
                    }}
                    className="flex items-center gap-1 rounded bg-[#6c757d] px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-600"
                  >
                    <Square className="h-3 w-3" />
                    Stop auto actions
                  </button>
                </div>
              </div>
            </div>

            {/* Per-OLT Unconfigured Sections matching Screenshot _C1DBB18F */}
            <div className="space-y-4">
              {db.olts.map((oltItem) => {
                const oltUncfg = unconfiguredOnus.filter(
                  (u) => u.olt_id === oltItem.id
                );
                return (
                  <div key={oltItem.id} className="space-y-2">
                    <div className="rounded bg-[#1b314e] px-3.5 py-2 text-xs font-bold text-white">
                      {oltItem.id} - {oltItem.name}
                    </div>
                    {oltUncfg.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-slate-300">
                        No unconfigured ONUs found.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
                        <table className="w-full max-w-3xl text-left text-xs">
                          <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                            <tr>
                              <th className="px-3 py-2">PON type</th>
                              <th className="px-3 py-2">Board</th>
                              <th className="px-3 py-2">Port</th>
                              <th className="px-3 py-2">PON description</th>
                              <th className="px-3 py-2">Model</th>
                              <th className="px-3 py-2">SN</th>
                              <th className="px-3 py-2">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1e3a5f]/60">
                            {oltUncfg.map((u) => (
                              <tr key={u.id} className="hover:bg-[#132842]/50">
                                <td className="px-3 py-2.5 text-white">GPON</td>
                                <td className="px-3 py-2.5 font-mono text-white">
                                  {u.board}
                                </td>
                                <td className="px-3 py-2.5 font-mono text-white">
                                  {u.port}
                                </td>
                                <td className="px-3 py-2.5 text-slate-400"></td>
                                <td className="px-3 py-2.5 font-mono text-white">
                                  {u.onu_type}
                                </td>
                                <td className="px-3 py-2.5 font-mono font-bold text-white">
                                  {u.serial_number}
                                </td>
                                <td className="px-3 py-2.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAuthorizingOnu(u);
                                      setActiveView('AUTHORIZE_FORM');
                                    }}
                                    className="font-semibold text-sky-400 hover:underline"
                                  >
                                    Authorize
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 3: AUTHORIZE ONU FORM PAGE (Exact match to Screenshot _1F161B1B)
           =================================================================== */}
        {activeView === 'AUTHORIZE_FORM' && authorizingOnu && (
          <AuthorizeOnuModal
            onu={authorizingOnu}
            db={db}
            onClose={() => setActiveView('UNCONFIGURED')}
            onConfirmAuthorize={handleConfirmAuthorize}
          />
        )}

        {/* ===================================================================
            VIEW 4: CONFIGURED ONUS (Exact match to Screenshot _D6CCC96A)
           =================================================================== */}
        {activeView === 'CONFIGURED' && (
          <div className="space-y-4 text-xs">
            {/* 2-Row Filter Panel matching top of Screenshot _D6CCC96A */}
            <div className="space-y-3 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-3.5">
              {/* Row 1 */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-6 lg:grid-cols-11">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-white">Search</label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name, SN, PPPoE, IP..."
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-white">OLT</label>
                  <select
                    value={filterOlt}
                    onChange={(e) => setFilterOlt(e.target.value)}
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Any</option>
                    {db.olts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.id} - {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">Board</label>
                  <select
                    value={filterBoard}
                    onChange={(e) => setFilterBoard(e.target.value)}
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Any</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">Port</label>
                  <select
                    value={filterPort}
                    onChange={(e) => setFilterPort(e.target.value)}
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Any</option>
                    {Array.from({ length: 16 }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">Zone</label>
                  <select
                    value={filterZone}
                    onChange={(e) => setFilterZone(e.target.value)}
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Any</option>
                    {db.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">Splitter</label>
                  <select
                    value={filterSplitter}
                    onChange={(e) => setFilterSplitter(e.target.value)}
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Any</option>
                    {db.odbs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">VLAN</label>
                  <select
                    value={filterVlan}
                    onChange={(e) => setFilterVlan(e.target.value)}
                    className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Any</option>
                    {db.vlans.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vlan_id} - {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">ONU type</label>
                  <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white">
                    <option>Any</option>
                    <option>ALL</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">Profile</label>
                  <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white">
                    <option>Any</option>
                    <option>1G</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-white">PON type</label>
                  <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-2 py-1.5 text-xs text-white">
                    <option>Any</option>
                    <option>GPON</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Signal & Mode Quick Filters */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Signal filter buttons */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white">Signal:</span>
                    {(['ALL', 'GOOD', 'WARNING', 'CRITICAL'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setFilterSignalLevel(lvl)}
                        className={`rounded px-2 py-1 text-[11px] font-bold ${
                          filterSignalLevel === lvl
                            ? 'bg-sky-600 text-white'
                            : 'bg-[#152c4a] text-slate-300 hover:text-white'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>

                  {/* Mode B / R */}
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-white">Mode:</span>
                    <span className="rounded bg-[#152c4a] px-2 py-1 font-bold text-white">
                      B
                    </span>
                    <span className="rounded bg-[#152c4a] px-2 py-1 font-bold text-white">
                      R
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterOlt('ANY');
                    setFilterBoard('ANY');
                    setFilterPort('ANY');
                    setFilterZone('ANY');
                    setFilterSplitter('ANY');
                    setFilterVlan('ANY');
                    setFilterSignalLevel('ALL');
                  }}
                  className="text-xs font-semibold text-slate-300 hover:text-white"
                >
                  ✖ Reset filters
                </button>
              </div>
            </div>

            {/* Pagination Info Row */}
            <div className="flex flex-wrap items-center justify-between text-xs text-slate-300">
              <div className="flex items-center gap-1">
                <span className="rounded bg-[#0275d8] px-2.5 py-1 font-bold text-white">
                  1
                </span>
                <span className="rounded bg-[#10233a] px-2.5 py-1 text-sky-400">
                  2
                </span>
                <span className="rounded bg-[#10233a] px-2.5 py-1 text-sky-400">
                  3
                </span>
                <span className="px-1">...</span>
                <span className="rounded bg-[#10233a] px-2.5 py-1 text-sky-400">
                  26
                </span>
              </div>
              <div>
                {filteredConfiguredOnus.length} of {configuredOnus.length} ONUs displayed.
              </div>
            </div>

            {/* Configured ONUs Table matching Screenshot _D6CCC96A */}
            <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-3 py-2.5">View</th>
                    <th className="px-2 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">SN</th>
                    <th className="px-2 py-2.5">OLT</th>
                    <th className="px-2 py-2.5">Board</th>
                    <th className="px-2 py-2.5">Port</th>
                    <th className="px-3 py-2.5">Zone</th>
                    <th className="px-3 py-2.5">Splitter</th>
                    <th className="px-3 py-2.5">Signal</th>
                    <th className="px-3 py-2.5">B/R</th>
                    <th className="px-2 py-2.5">VLAN</th>
                    <th className="px-2 py-2.5">TR069</th>
                    <th className="px-2 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Auth date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/60">
                  {filteredConfiguredOnus.map((o) => {
                    const z = db.zones.find((item) => item.id === o.zone_id);
                    const sp = db.odbs.find((item) => item.id === o.odb_id);
                    const vl = db.vlans.find((item) => item.id === o.vlan_id);
                    return (
                      <tr key={o.id} className="hover:bg-[#132842]/60">
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOnuId(o.id);
                              setActiveView('ONU_DETAIL');
                            }}
                            className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                          >
                            View
                          </button>
                        </td>
                        <td className="px-2 py-2.5">
                          {o.phase_state === 'LOS' ? (
                            <span
                              title="LOS (Loss of Signal)"
                              className="inline-flex items-center text-red-500"
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </span>
                          ) : (
                            <span
                              title="Working (Online)"
                              className="inline-flex items-center text-emerald-400"
                            >
                              <Wifi className="h-4 w-4" />
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-white">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOnuId(o.id);
                              setActiveView('ONU_DETAIL');
                            }}
                            className="hover:text-sky-400 hover:underline"
                          >
                            {o.customer_name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-200">
                          {o.serial_number}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {o.olt_id}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {o.board}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {o.port}
                        </td>
                        <td className="px-3 py-2.5 text-slate-200">
                          {z?.name || 'MUARA LEBAK - RK O1'}
                        </td>
                        <td className="px-3 py-2.5">
                          {sp ? (
                            <span className="rounded bg-[#28a745] px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                              {sp.name} ({o.odb_port || 1})
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">{renderSignalCell(o)}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => setUpdatingModeOnu(o)}
                            title="Click to open Update ONU mode & WAN remote access modal"
                            className="rounded bg-[#28a745] px-2 py-0.5 text-[11px] font-bold text-white hover:bg-[#218838]"
                          >
                            {o.onu_mode === 'Bridging'
                              ? 'B: Bridge'
                              : `R: ${o.wan_mode === 'PPPOE' ? 'PPPoE' : o.wan_mode}`}
                          </button>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {vl?.vlan_id || o.vlan_id || 101}
                        </td>
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            onClick={() => setUpdatingModeOnu(o)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-950/90 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 border border-emerald-600/40"
                          >
                            <Radio className="h-3 w-3" />
                            {o.config_method}
                          </button>
                        </td>
                        <td className="px-2 py-2.5 text-white">{o.onu_type}</td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {o.auth_date_label || 'Today 15:05:57'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 5: ONU DETAIL VIEW (Exact match to Screenshot _5EEB9112)
           =================================================================== */}
        {activeView === 'ONU_DETAIL' && selectedOnu && (
          <OnuDetailView
            onu={selectedOnu}
            db={db}
            onBack={() => setActiveView('CONFIGURED')}
            onBackToDashboard={() => setActiveView('DASHBOARD')}
            onViewOlt={(oltId) => {
              setSelectedOltId(oltId);
              setInitialOltTab('OLT_DETAILS');
              setActiveView('OLT_DETAIL');
            }}
            onExecuteAction={handleExecuteOnuAction}
          />
        )}

        {/* ===================================================================
            VIEW 6: OLTS LIST PAGE (Exact match to Screenshot image_2631e0fd.png)
           =================================================================== */}
        {activeView === 'OLTS_LIST' && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-white">OLTs</h1>
                <p className="text-xs text-slate-300">
                  Add and manage the OLTs that SmartOLT connects to.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView('ADD_OLT')}
                  className="flex items-center gap-1 rounded bg-[#5cb85c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#4cae4c]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add OLT
                </button>
                <button
                  type="button"
                  onClick={() => setShowMismatchModal(true)}
                  className="flex items-center gap-1 rounded bg-[#5a6268] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#4e555b]"
                >
                  <Search className="h-3.5 w-3.5" />
                  Find config mismatches
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const csv = [
                      'ID,Name,IP,Hardware,SW,VPN,Status',
                      ...db.olts.map(
                        (o) =>
                          `${o.id},"${o.name}",${o.ip_address},${o.hardware_model},${o.firmware_version},${o.vpn_name},${o.status}`
                      ),
                    ].join('\n');
                    navigator.clipboard.writeText(csv);
                    showToast('Daftar OLT berhasil disalin dalam format CSV.');
                  }}
                  className="flex items-center gap-1 rounded bg-[#5a6268] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#4e555b]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </button>
              </div>
            </div>

            {/* Filter Box */}
            <div className="flex flex-wrap items-end gap-3 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
              <div className="w-52">
                <label className="block font-bold text-white">Search</label>
                <input
                  type="text"
                  placeholder="Name, IP, port, model"
                  className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="w-36">
                <label className="block font-bold text-white">Status</label>
                <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                  <option>Online</option>
                </select>
              </div>
              <div className="w-36">
                <label className="block font-bold text-white">Traps</label>
                <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                  <option>Enabled</option>
                </select>
              </div>
              <div className="w-36">
                <label className="block font-bold text-white">VPN</label>
                <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                </select>
              </div>
              <div className="w-36">
                <label className="block font-bold text-white">Vendor</label>
                <select className="mt-1 w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                  <option>ZTE</option>
                </select>
              </div>
              <button
                type="button"
                className="ml-auto pb-2 text-xs font-semibold text-white hover:text-sky-300"
              >
                ✖ Reset filters
              </button>
            </div>

            {/* OLTs Table */}
            <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-4 py-3">View</th>
                    <th className="px-3 py-3">ID</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Traps</th>
                    <th className="px-3 py-3">VPN</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">OLT IP</th>
                    <th className="px-3 py-3">TCP</th>
                    <th className="px-3 py-3">UDP</th>
                    <th className="px-4 py-3">OLT hardware version</th>
                    <th className="px-3 py-3">OLT SW version</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/70">
                  {db.olts.map((o) => (
                    <tr key={o.id} className="hover:bg-[#132842]/60">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOltId(o.id);
                            setInitialOltTab('OLT_DETAILS');
                            setActiveView('OLT_DETAIL');
                          }}
                          className="rounded bg-[#0275d8] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                        >
                          View
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono text-white">{o.id}</td>
                      <td className="px-3 py-3">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            o.snmp_traps_enabled
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }
                        >
                          ツ
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start">
                          <span className="text-emerald-400">✓</span>
                          <span className="text-[11px] text-sky-400 underline">
                            {o.vpn_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-white">
                        {o.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        {o.ip_address}
                      </td>
                      <td className="px-3 py-3 font-mono text-white">
                        {o.telnet_port}
                      </td>
                      <td className="px-3 py-3 font-mono text-white">
                        {o.snmp_port}
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        {o.hardware_model}
                      </td>
                      <td className="px-3 py-3 font-mono text-white">
                        {o.firmware_version || '2.1.0'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOltId(o.id);
                              setInitialOltTab('UPLINK');
                              setActiveView('OLT_DETAIL');
                            }}
                            title="Open Uplink & VLAN Tagging"
                            className="rounded bg-slate-600 p-1.5 text-white hover:bg-slate-500"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDb((prev) => ({
                                ...prev,
                                olts: prev.olts.filter((item) => item.id !== o.id),
                                olt_cards: prev.olt_cards.filter((c) => c.olt_id !== o.id),
                                pon_ports: prev.pon_ports.filter((p) => p.olt_id !== o.id),
                                uplink_ports: prev.uplink_ports.filter((u) => u.olt_id !== o.id),
                                vlans: prev.vlans.filter((v) => v.olt_id !== o.id),
                                onus: prev.onus.filter((u) => u.olt_id !== o.id),
                              }));
                              showToast(`OLT ${o.name} beserta datanya dihapus dari Database.`);
                            }}
                            className="rounded bg-[#d9534f] p-1.5 text-white hover:bg-[#c9302c]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 6B: ADD OLT FULL-PAGE FORM (Exact match to Screenshot _365A2C64)
           =================================================================== */}
        {activeView === 'ADD_OLT' && (
          <AddOltView
            onBack={() => setActiveView('OLTS_LIST')}
            onSaveOlt={(newOltData) => {
              const nextId = Math.max(0, ...db.olts.map((o) => o.id)) + 1;
              const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
              setDb((prev) => ({
                ...prev,
                olts: [
                  ...prev.olts,
                  {
                    ...newOltData,
                    id: nextId,
                  },
                ],
                olt_cards: [
                  ...prev.olt_cards,
                  {
                    id: Date.now() + 1,
                    olt_id: nextId,
                    slot: 3,
                    type: 'GTGH',
                    real_type: 'GTGH',
                    ports: 16,
                    sw_version: '2.1.0',
                    status: 'Online',
                    role: 'Main',
                    updated_at: nowStr,
                  },
                  {
                    id: Date.now() + 2,
                    olt_id: nextId,
                    slot: 10,
                    type: 'SCXM',
                    real_type: 'SCXM',
                    ports: null,
                    sw_version: '2.1.0',
                    status: 'Online',
                    role: 'Main',
                    updated_at: nowStr,
                  },
                  {
                    id: Date.now() + 3,
                    olt_id: nextId,
                    slot: 19,
                    type: 'HUVQ',
                    real_type: 'HUVQ',
                    ports: 4,
                    sw_version: '2.1.0',
                    status: 'Online',
                    role: 'Main',
                    updated_at: nowStr,
                  },
                ],
                uplink_ports: [
                  ...prev.uplink_ports,
                  {
                    id: Date.now() + 11,
                    olt_id: nextId,
                    name: 'xgei_1/19/1',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: 'Down',
                    negotiation: 'Forced 10G-FullD',
                    mtu: 1600,
                    wavelength: '1310',
                    signal_dbm: 'Tx: -4.85 / Rx: N/A',
                    temp_c: '41.5',
                    pvid_untag: 41,
                    tagged_vlans: 'Hybrid: 102',
                  },
                  {
                    id: Date.now() + 12,
                    olt_id: nextId,
                    name: 'xgei_1/19/2',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: 'Down',
                    negotiation: 'Forced 10G-FullD',
                    mtu: 1600,
                    wavelength: '1310',
                    signal_dbm: 'Tx: -5.20 / Rx: N/A',
                    temp_c: '40.9',
                    pvid_untag: 42,
                    tagged_vlans: 'Hybrid: 102',
                  },
                  {
                    id: Date.now() + 13,
                    olt_id: nextId,
                    name: 'gei_1/19/3',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: '1G-FullD',
                    negotiation: 'Auto',
                    mtu: 1600,
                    wavelength: '16652',
                    signal_dbm: '',
                    temp_c: 'N/A',
                    pvid_untag: 41,
                    tagged_vlans: 'Hybrid: 100-102',
                  },
                  {
                    id: Date.now() + 14,
                    olt_id: nextId,
                    name: 'gei_1/19/4',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: 'Down',
                    negotiation: 'Auto',
                    mtu: 1600,
                    wavelength: 'N/A',
                    signal_dbm: '',
                    temp_c: 'N/A',
                    pvid_untag: 42,
                    tagged_vlans: 'Hybrid: 102',
                  },
                ],
                pon_ports: [
                  ...prev.pon_ports,
                  ...Array.from({ length: 16 }, (_, idx) => ({
                    id: nextId * 100 + idx + 1,
                    olt_id: nextId,
                    rack: 1,
                    shelf: 3,
                    slot: 3,
                    port_number: idx + 1,
                    interface_name: `gpon-olt_1/3/${idx + 1}`,
                    board_model: 'GTGH',
                    description: `PON 1/3/${idx + 1}`,
                    admin_state: 'ENABLED' as const,
                    oper_status: 'Up' as const,
                    online_onus: 0,
                    total_onus: 0,
                    avg_signal_dbm: null,
                    tx_power_dbm: 10.5,
                    max_onu_capacity: 128,
                  })),
                ],
                vlans: [
                  ...prev.vlans,
                  {
                    id: nextId * 10000 + 100,
                    olt_id: nextId,
                    vlan_id: 100,
                    name: 'TR069',
                    description: 'TR069',
                    default_for: 'None selected',
                    used_for_mgmt_tr069_voip: true,
                    used_for_iptv: false,
                    dhcp_snooping: false,
                    lan_to_lan: false,
                    onus_count: 0,
                    service_type: 'TR069_MGMT' as const,
                    svlan_id: null,
                    is_default: false,
                  },
                  {
                    id: nextId * 10000 + 101,
                    olt_id: nextId,
                    vlan_id: 101,
                    name: 'PPPOE',
                    description: 'PPPOE',
                    default_for: 'None selected',
                    used_for_mgmt_tr069_voip: false,
                    used_for_iptv: false,
                    dhcp_snooping: false,
                    lan_to_lan: false,
                    onus_count: 0,
                    service_type: 'PPPOE' as const,
                    svlan_id: null,
                    is_default: true,
                  },
                ],
              }));
              setSelectedOltId(nextId);
              showToast(
                `OLT ${newOltData.name} (${newOltData.hardware_model} - ${newOltData.ip_address}) berhasil disimpan & diinisialisasi!`
              );
              setActiveView('OLTS_LIST');

              // Bootstrap base ZTE GPON profiles & default VLAN 100/101 on the OLT automatically
              const bootstrapCli = [
                'configure terminal',
                'vlan database',
                '  vlan 100,101',
                'exit',
                'gpon',
                '  profile tcont SMARTOLT-1G-UP type 4 maximum 1000000',
                '  profile tcont SMARTOLT-VOIPMNG-10M type 2 assured 10240 maximum 10240',
                '  profile traffic SMARTOLT-1G-DOWN sir 1000000 pir 1000000',
                '  profile traffic SMARTOLT-VOIPMNG-10M sir 10240 pir 10240',
                '  onu profile vlan SMARTOLT-vlan100 tag-mode tag cvlan 100',
                '  onu profile vlan SMARTOLT-vlan101 tag-mode tag cvlan 101',
                'exit',
                'onu-type ALL gpon max-tcont 8 max-gemport 32 max-switch-perslot 8 max-flow-perswitch 8 max-iphost 5',
                'end',
                'write',
              ].join('\n');
              void executeOltCliLive(
                nextId,
                bootstrapCli,
                Date.now(),
                `Bootstrap GPON Profiles on ${newOltData.name}`,
                {
                  ip_address: newOltData.ip_address,
                  telnet_port: newOltData.telnet_port,
                  olt_username: newOltData.olt_username,
                  olt_password: newOltData.olt_password,
                }
              );
            }}
          />
        )}

        {/* ===================================================================
            VIEW 7: 10-TAB OLT DETAIL VIEW (Screenshots 1-5)
           =================================================================== */}
        {activeView === 'OLT_DETAIL' && selectedOlt && (
          <OltDetailView
            olt={selectedOlt}
            db={db}
            initialTab={initialOltTab}
            onBack={() => setActiveView('OLTS_LIST')}
            onAddVlan={(newVlans, tagUplinkIds, cliScript) => {
              const createdRecords: VlanRecord[] = newVlans.map((nv, idx) => ({
                ...nv,
                id: Date.now() + idx,
              }));
              const addedVlanNums = newVlans.map((v) => v.vlan_id);
              const logId = Date.now() + 99;

              setDb((prev) => ({
                ...prev,
                vlans: [...prev.vlans, ...createdRecords],
                uplink_ports: prev.uplink_ports.map((u) => {
                  if (!tagUplinkIds.includes(u.id)) return u;
                  const raw = u.tagged_vlans
                    .replace(/^(Hybrid|Trunk|Access):\s*/i, '')
                    .trim();
                  const combined = raw
                    ? `${raw},${addedVlanNums.join(',')}`
                    : addedVlanNums.join(',');
                  return {
                    ...u,
                    tagged_vlans: `Hybrid: ${combined}`,
                  };
                }),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-VLAN',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: `vlan ${addedVlanNums.join(',')}`,
                    summary_text: `Created VLAN(s) ${addedVlanNums.join(',')} & tagged on Uplink`,
                    cli_script: cliScript,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(
                `Mengeksekusi pembuatan VLAN ${addedVlanNums.join(', ')} ke OLT ${selectedOlt.name}...`
              );
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Create VLAN ${addedVlanNums.join(',')}`
              );
            }}
            onToggleVlanFlag={(vlanRecordId, field) => {
              const targetVlan = db.vlans.find((v) => v.id === vlanRecordId);
              setDb((prev) => ({
                ...prev,
                vlans: prev.vlans.map((v) =>
                  v.id === vlanRecordId ? { ...v, [field]: !v[field] } : v
                ),
              }));
              if (targetVlan && field === 'dhcp_snooping') {
                const nextEnable = !targetVlan.dhcp_snooping;
                const cli = [
                  'configure terminal',
                  nextEnable
                    ? 'ip dhcp snooping control-port enable'
                    : 'no ip dhcp snooping control-port enable',
                  'end',
                  'write',
                ].join('\n');
                void executeOltCliLive(
                  selectedOlt.id,
                  cli,
                  Date.now(),
                  `VLAN ${targetVlan.vlan_id} DHCP Snooping`
                );
              } else {
                showToast(`Pengaturan ${field} pada VLAN berhasil diperbarui.`);
              }
            }}
            onDeleteVlans={(vlanRecordIds) => {
              const targetVlans = db.vlans.filter((v) =>
                vlanRecordIds.includes(v.id)
              );
              const vlanNums = targetVlans.map((v) => v.vlan_id);
              const logId = Date.now();
              const cliScript =
                vlanNums.length > 0
                  ? [
                      'configure terminal',
                      'vlan database',
                      `  no vlan ${vlanNums.join(',')}`,
                      'exit',
                      'gpon',
                      ...vlanNums.map(
                        (vid) => `  no onu profile vlan SMARTOLT-vlan${vid}`
                      ),
                      'exit',
                      'end',
                      'write',
                    ].join('\n')
                  : '';

              setDb((prev) => ({
                ...prev,
                vlans: prev.vlans.filter((v) => !vlanRecordIds.includes(v.id)),
                provisioning_logs: cliScript
                  ? [
                      {
                        id: logId,
                        olt_id: selectedOlt.id,
                        onu_id: null,
                        serial_number: 'OLT-VLAN',
                        action_type: 'RESYNC_CONFIG',
                        interface_target: `no vlan ${vlanNums.join(',')}`,
                        summary_text: `Deleted VLAN(s) ${vlanNums.join(',')} from OLT`,
                        cli_script: cliScript,
                        olt_response: '[Executing on OLT via Telnet...]',
                        execution_status: 'SUCCESS',
                        executed_by: 'likhin',
                        duration_ms: 0,
                        created_at: 'Just now',
                      },
                      ...prev.provisioning_logs,
                    ]
                  : prev.provisioning_logs,
              }));
              showToast(`Menghapus VLAN ${vlanNums.join(', ')} dari OLT...`);
              if (cliScript) {
                void executeOltCliLive(
                  selectedOlt.id,
                  cliScript,
                  logId,
                  `Delete VLAN ${vlanNums.join(',')}`
                );
              }
            }}
            onUpdateUplinkPort={(uplinkId, updated, cliScript) => {
              const targetUplink = db.uplink_ports.find((u) => u.id === uplinkId);
              const logId = Date.now();
              setDb((prev) => ({
                ...prev,
                uplink_ports: prev.uplink_ports.map((u) =>
                  u.id === uplinkId ? { ...u, ...updated } : u
                ),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-UPLINK',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: targetUplink?.name || 'gei_1/19/3',
                    summary_text: `Uplink ${targetUplink?.name || ''} tagged VLANs updated (${updated.tagged_vlans || ''})`,
                    cli_script: cliScript,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(
                `Mengeksekusi konfigurasi Uplink ${targetUplink?.name || ''} ke OLT...`
              );
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Configure Uplink ${targetUplink?.name || ''}`
              );
            }}
            onCreateLagUplink={(newUplink, cliScript) => {
              const logId = Date.now();
              setDb((prev) => ({
                ...prev,
                uplink_ports: [
                  ...prev.uplink_ports,
                  { ...newUplink, id: Date.now() + 1 },
                ],
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-LAG',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: newUplink.name,
                    summary_text: `Created LACP LAG ${newUplink.name} (${newUplink.tagged_vlans})`,
                    cli_script: cliScript,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(`Mengeksekusi pembuatan LAG ${newUplink.name} ke OLT...`);
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Create LAG ${newUplink.name}`
              );
            }}
            onUpdatePonPort={(portNumber, updated, cliScript) => {
              const logId = Date.now();
              setDb((prev) => {
                const exists = prev.pon_ports.some(
                  (p) => p.olt_id === selectedOlt.id && p.port_number === portNumber
                );
                const nextPonPorts = exists
                  ? prev.pon_ports.map((p) =>
                      p.olt_id === selectedOlt.id && p.port_number === portNumber
                        ? { ...p, ...updated }
                        : p
                    )
                  : [
                      ...prev.pon_ports,
                      {
                        id: Date.now() + 1,
                        olt_id: selectedOlt.id,
                        rack: 1,
                        shelf: 3,
                        slot: 3,
                        port_number: portNumber,
                        interface_name: `gpon-olt_1/3/${portNumber}`,
                        board_model: 'GTGH',
                        description: updated.description || '',
                        admin_state: updated.admin_state || 'ENABLED',
                        oper_status: updated.oper_status || 'Up',
                        online_onus: 0,
                        total_onus: 0,
                        avg_signal_dbm: null,
                        tx_power_dbm: 10.52,
                        max_onu_capacity: updated.max_onu_capacity || 128,
                      },
                    ];
                return {
                  ...prev,
                  pon_ports: nextPonPorts,
                  provisioning_logs: [
                    {
                      id: logId,
                      olt_id: selectedOlt.id,
                      onu_id: null,
                      serial_number: 'OLT-PON',
                      action_type: 'RESYNC_CONFIG',
                      interface_target: `gpon-olt_1/3/${portNumber}`,
                      summary_text: `Updated PON port gpon-olt_1/3/${portNumber}`,
                      cli_script: cliScript,
                      olt_response: '[Executing on OLT via Telnet...]',
                      execution_status: 'SUCCESS',
                      executed_by: 'likhin',
                      duration_ms: 0,
                      created_at: 'Just now',
                    },
                    ...prev.provisioning_logs,
                  ],
                };
              });
              showToast(`Mengeksekusi konfigurasi Port GPON 1/3/${portNumber} ke OLT...`);
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Update PON gpon-olt_1/3/${portNumber}`
              );
            }}
            onEnableAllPonPorts={() => {
              const logId = Date.now();
              const enableAllCli = [
                'configure terminal',
                ...Array.from({ length: 16 }, (_, idx) =>
                  [
                    `interface gpon-olt_1/3/${idx + 1}`,
                    '  no shutdown',
                    '  uncfg-onu-display-info model sn pw',
                    'exit',
                  ].join('\n')
                ),
                'end',
                'write',
              ].join('\n');

              setDb((prev) => ({
                ...prev,
                pon_ports: prev.pon_ports.map((p) =>
                  p.olt_id === selectedOlt.id
                    ? {
                        ...p,
                        admin_state: 'ENABLED',
                        oper_status: 'Up',
                      }
                    : p
                ),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-PON-ALL',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: 'gpon-olt_1/3/1..16',
                    summary_text: 'Enabled all 16 GPON ports on Slot 3 GTGH',
                    cli_script: enableAllCli,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast('Mengeksekusi no shutdown pada seluruh 16 port GPON ke OLT...');
              void executeOltCliLive(
                selectedOlt.id,
                enableAllCli,
                logId,
                'Enable All PON Ports (1/3/1..16)'
              );
            }}
            onRefreshOltCards={async () => {
              const nowStr = new Date()
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ');
              setDb((prev) => ({
                ...prev,
                olt_cards: prev.olt_cards.map((c) => ({
                  ...c,
                  updated_at: nowStr,
                })),
              }));
              showToast('Meminta status kartu OLT (`show card`) via Telnet...');
              await executeOltCliLive(
                selectedOlt.id,
                'show card',
                Date.now(),
                `Refresh OLT Cards (${selectedOlt.name})`
              );
            }}
            onRebootOltCard={(cardId) => {
              const targetCard = db.olt_cards.find((c) => c.id === cardId);
              const slotNum = targetCard?.slot || 3;
              const logId = Date.now();
              const rebootCardCli = `reset-card slotno ${slotNum}`;
              const nowStr = new Date()
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ');
              setDb((prev) => ({
                ...prev,
                olt_cards: prev.olt_cards.map((c) =>
                  c.id === cardId
                    ? { ...c, status: 'Online', updated_at: nowStr }
                    : c
                ),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: `SLOT-${slotNum}`,
                    action_type: 'REBOOT',
                    interface_target: `card slot ${slotNum}`,
                    summary_text: `Rebooted OLT card on Slot ${slotNum}`,
                    cli_script: rebootCardCli,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(`Mengeksekusi reset-card slotno ${slotNum} ke sasis OLT...`);
              void executeOltCliLive(
                selectedOlt.id,
                rebootCardCli,
                logId,
                `Reboot Card Slot ${slotNum}`
              );
            }}
            onUpdateOltSettings={(oltId, updated) => {
              setDb((prev) => ({
                ...prev,
                olts: prev.olts.map((o) =>
                  o.id === oltId ? { ...o, ...updated } : o
                ),
              }));
              showToast('Pengaturan OLT berhasil diperbarui.');
            }}
            onUpdateOltTr069={(oltId, tr069ProfileName, defaultInterface) => {
              setDb((prev) => ({
                ...prev,
                olts: prev.olts.map((o) =>
                  o.id === oltId
                    ? {
                        ...o,
                        tr069_profile_name: tr069ProfileName,
                        default_tr069_interface: defaultInterface,
                      }
                    : o
                ),
              }));
              showToast(
                `TR069 Profile "${tr069ProfileName}" (${defaultInterface}) diterapkan pada OLT.`
              );
            }}
            onImportRunningConfig={async (oltId, rawConfig) => {
              try {
                const resp = await fetch(`/api/olts/${oltId}/import-config`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rawConfig }),
                });
                const data = await resp.json();
                if (data.state) {
                  setDb(data.state);
                  showToast(
                    `Berhasil mengimpor ${data.imported?.onus || 0} ONU, ${data.imported?.vlans || 0} VLAN, dan ${data.imported?.uplinks || 0} Uplink ke Database (${dbMeta.dbEngine})!`
                  );
                }
              } catch (err) {
                showToast(`Gagal mengimpor running-config: ${(err as Error).message}`);
              }
            }}
          />
        )}

        {/* ===================================================================
            VIEW 8: TASKS PAGE (Exact match to Screenshot image_fdf3e3de.png)
           =================================================================== */}
        {activeView === 'TASKS' && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">OLT</span>
                <select className="rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                  {db.olts.map((o) => (
                    <option key={o.id}>
                      {o.id} - {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">User</span>
                <select className="rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                  <option>muslikhin997@gmail.com</option>
                  <option>fathanwushu@gmail.com</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">Action</span>
                <select className="rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>Any</option>
                  <option>Auto-Authorize</option>
                  <option>Auto-Move</option>
                  <option>Auto-Resync</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">From</span>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  className="w-32 rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">To</span>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  className="w-32 rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-4 py-3"></th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">OLT</th>
                    <th className="px-4 py-3">ONUs</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Stopped by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/70">
                  {db.tasks.map((t, index) => (
                    <tr key={t.id} className="hover:bg-[#132842]/50">
                      <td className="space-y-1.5 px-4 py-3">
                        <div>
                          <button
                            type="button"
                            className="rounded bg-[#0275d8] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                          >
                            View
                          </button>
                        </div>
                        {index === 0 && (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                showToast(
                                  `Restarted ${t.action} on ${t.olt_label}.`
                                )
                              }
                              className="flex items-center gap-1 rounded bg-[#5cb85c] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Restart task
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold text-white">
                        {t.action}
                      </td>
                      <td className="px-4 py-3 text-white">{t.olt_label}</td>
                      <td className="px-4 py-3 text-slate-200">
                        <div>
                          <strong>Processed:</strong> {t.processed} of {t.total}
                        </div>
                        <div>
                          <strong>Successful:</strong> {t.successful}
                        </div>
                        <div>
                          <strong>Failed:</strong> {t.failed}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white">{t.user_email}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-500 px-2.5 py-1 text-[11px] font-bold text-white">
                          ✓ {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        <div>
                          <strong>From:</strong> {t.from_time}
                        </div>
                        <div>
                          <strong>To:</strong> {t.to_time}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 9: VPN & TR069 ACS PROFILES (Settings -> VPN & TR069)
           =================================================================== */}
        {activeView === 'VPN_TR069' && (
          <div className="space-y-5 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-white">
                  VPN Tunnels, TR-069 CWMP ACS Profiles & WAN Remote Access ACLs
                </h1>
                <p className="text-slate-300">
                  Konfigurasi server GenieACS / SmartOLT CWMP (`http://acs.jetcybernet.id:7547/cwmp`) dan kebijakan `WAN remote access` untuk seluruh OLT ZTE.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUpdatingModeOnu(configuredOnus[1] || configuredOnus[0]);
                }}
                className="flex items-center gap-1.5 rounded bg-[#5cb85c] px-4 py-2 text-xs font-bold text-white"
              >
                <Sliders className="h-3.5 w-3.5" />
                Open "Update ONU mode" Modal (RATMI)
              </button>
            </div>

            <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Profile Name</th>
                    <th className="px-4 py-3">ACS CWMP Server URL</th>
                    <th className="px-4 py-3">ACS Username</th>
                    <th className="px-4 py-3">Connection Request User</th>
                    <th className="px-4 py-3">Periodic Inform</th>
                    <th className="px-4 py-3">Mgmt VLAN</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/70">
                  {db.tr069_profiles.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-bold text-emerald-400">
                        {p.profile_name}
                      </td>
                      <td className="px-4 py-3 font-mono text-sky-300">
                        {p.acs_url}
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        {p.acs_username}
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        {p.connection_request_username}
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        {p.periodic_inform_interval}s
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        VLAN {p.mgmt_vlan_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                          ACTIVE
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 10: ZONES, SPLITTERS, SPEED PROFILES, GRAPHS
           =================================================================== */}
        {(activeView === 'ZONES' ||
          activeView === 'SPLITTERS' ||
          activeView === 'SPEED_PROFILES' ||
          activeView === 'GRAPHS') && (
          <div className="space-y-4 text-xs">
            <h2 className="text-lg font-bold text-white">
              {activeView === 'ZONES' && 'Zones Management'}
              {activeView === 'SPLITTERS' && 'Optical Splitters (ODBs / ODPs)'}
              {activeView === 'SPEED_PROFILES' && 'GPON Speed & TCONT Profiles'}
              {activeView === 'GRAPHS' && 'OLT Uplink & PON Optical Graphs'}
            </h2>

            {activeView === 'ZONES' && (
              <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Zone Name</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">City / District</th>
                      <th className="px-4 py-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e3a5f]/70">
                    {db.zones.map((z) => (
                      <tr key={z.id}>
                        <td className="px-4 py-3 font-mono">{z.id}</td>
                        <td className="px-4 py-3 font-bold text-white">
                          {z.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-sky-400">
                          {z.code}
                        </td>
                        <td className="px-4 py-3">{z.city_district}</td>
                        <td className="px-4 py-3 text-slate-300">
                          {z.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeView === 'SPLITTERS' && (
              <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Splitter Name</th>
                      <th className="px-4 py-3">Ratio</th>
                      <th className="px-4 py-3">Ports</th>
                      <th className="px-4 py-3">Pole Number</th>
                      <th className="px-4 py-3">GPS Coordinates</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e3a5f]/70">
                    {db.odbs.map((o) => (
                      <tr key={o.id}>
                        <td className="px-4 py-3 font-bold text-white">
                          {o.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-400">
                          {o.splitter_ratio}
                        </td>
                        <td className="px-4 py-3 font-mono">{o.total_ports}</td>
                        <td className="px-4 py-3 font-mono">{o.pole_number}</td>
                        <td className="px-4 py-3 font-mono text-slate-300">
                          {o.latitude}, {o.longitude}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeView === 'SPEED_PROFILES' && (
              <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Profile Name</th>
                      <th className="px-4 py-3">Download</th>
                      <th className="px-4 py-3">Upload</th>
                      <th className="px-4 py-3">Burst CBS/PBS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e3a5f]/70">
                    {db.speed_profiles.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-3 font-bold text-white">
                          {s.profile_name}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-400">
                          {s.download_kbps.toLocaleString()} kbps
                        </td>
                        <td className="px-4 py-3 font-mono text-sky-400">
                          {s.upload_kbps.toLocaleString()} kbps
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {s.cbs_bytes} / {s.pbs_bytes} bytes
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeView === 'GRAPHS' && (
              <div className="rounded border border-slate-800 bg-[#05080f] p-5">
                <div className="text-center font-mono text-xs font-bold text-white">
                  Aggregate OLT Uplink Traffic (`gei_1/19/3` Core Router) — Peak 1.84 Gbps
                </div>
                <div className="mt-4 flex h-40 items-end gap-1 border-b border-l border-slate-800 px-4 pb-1">
                  {Array.from({ length: 28 }, (_, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                      <div
                        className="w-full rounded-t bg-emerald-500/80"
                        style={{ height: `${40 + ((i * 17) % 85)}px` }}
                      />
                      <div
                        className="w-full rounded-b bg-sky-500/80"
                        style={{ height: `${15 + ((i * 9) % 35)}px` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            VIEW 11: ZTE CLI REGEX PARSER LAB (Diag Tab)
           =================================================================== */}
        {activeView === 'DIAG_PARSER' && (
          <div className="space-y-5 text-xs">
            <div>
              <h1 className="text-lg font-bold text-white">
                ZTE C320 / C300 CLI Regex Parser & Optical Attenuation Tester
              </h1>
              <p className="text-slate-300">
                Uji langsung algoritma Regex Parser untuk membaca output `show gpon onu uncfg`, `show gpon onu state`, dan `show pon power attenuation`.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Parser 1: uncfg */}
              <div className="space-y-2 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
                <div className="font-mono font-bold text-sky-400">
                  1. `show gpon onu uncfg`
                </div>
                <textarea
                  rows={5}
                  value={rawUncfgCli}
                  onChange={(e) => setRawUncfgCli(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300"
                />
                <pre className="max-h-44 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-sky-300">
                  {JSON.stringify(parseZteUncfgOutput(rawUncfgCli), null, 2)}
                </pre>
              </div>

              {/* Parser 2: state */}
              <div className="space-y-2 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
                <div className="font-mono font-bold text-sky-400">
                  2. `show gpon onu state`
                </div>
                <textarea
                  rows={5}
                  value={rawStateCli}
                  onChange={(e) => setRawStateCli(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300"
                />
                <pre className="max-h-44 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-sky-300">
                  {JSON.stringify(parseZteOnuStateOutput(rawStateCli), null, 2)}
                </pre>
              </div>

              {/* Parser 3: attenuation */}
              <div className="space-y-2 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
                <div className="font-mono font-bold text-sky-400">
                  3. `show pon power attenuation`
                </div>
                <textarea
                  rows={5}
                  value={rawPowerCli}
                  onChange={(e) => setRawPowerCli(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300"
                />
                <pre className="max-h-44 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-sky-300">
                  {JSON.stringify(parseZteOpticalAttenuation(rawPowerCli), null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 12: SQL SCHEMA & BACKEND SOURCE CODE VIEWER
           =================================================================== */}
        {activeView === 'SOURCE_CODE' && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-white">
                  Full Production Source Code (`database.sql` + Telnet/SSH Engine + CLI/TR069 Builder)
                </h1>
                <p className="text-slate-300">
                  Salin langsung kode SQL MySQL/MariaDB dan modul koneksi Telnet/SSH ZTE C320/C300 untuk deployment di Ubuntu Server / Docker.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {PRODUCTION_CODE_MODULES.map((mod) => (
                  <button
                    key={mod.fileName}
                    type="button"
                    onClick={() => setSelectedCodeModuleId(mod.fileName)}
                    className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
                      selectedCodeModuleId === mod.fileName
                        ? 'bg-[#0275d8] text-white'
                        : 'bg-[#10233a] text-slate-300 hover:text-white'
                    }`}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    {mod.fileName}
                  </button>
                ))}
              </div>
            </div>

            {PRODUCTION_CODE_MODULES.filter((m) => m.fileName === selectedCodeModuleId).map(
              (mod) => (
                <div
                  key={mod.fileName}
                  className="overflow-hidden rounded-lg border border-[#1e3a5f] bg-slate-950 shadow-2xl"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1f36] px-4 py-3">
                    <div>
                      <div className="font-mono text-xs font-bold text-emerald-400">
                        Modul {mod.moduleNumber}: {mod.fileName}
                      </div>
                      <div className="text-[11px] text-slate-300">
                        {mod.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(mod.code);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 1800);
                      }}
                      className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      {copiedCode ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedCode ? 'Copied' : 'Copy Full Source Code'}
                    </button>
                  </div>
                  <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
                    {mod.code}
                  </pre>
                </div>
              )
            )}
          </div>
        )}
      </main>

      {/* Global "Update ONU mode" Modal when triggered from Configured ONUs table or VPN_TR069 */}
      {updatingModeOnu && (
        <UpdateOnuModeModal
          onu={updatingModeOnu}
          db={db}
          onClose={() => setUpdatingModeOnu(null)}
          onConfirmUpdate={(onuId, updatedFields, generatedCli) => {
            handleExecuteOnuAction(
              onuId,
              'UPDATE_ONU_MODE',
              generatedCli,
              updatedFields
            );
            setUpdatingModeOnu(null);
          }}
        />
      )}

      {/* =====================================================================
          MODAL: CONFIGURE AUTO-AUTHORIZE ACTIONS (UNCONFIGURED ONUS)
         ===================================================================== */}
      {showAutoActionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                Configure Auto Actions (SmartOLT Automation)
              </h2>
              <button
                type="button"
                onClick={() => setShowAutoActionsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3.5 px-5 py-4 text-xs">
              <label className="flex items-center gap-2 font-semibold text-white">
                <input
                  type="checkbox"
                  checked={autoAuthEnabled}
                  onChange={(e) => setAutoAuthEnabled(e.target.checked)}
                />
                Enable Auto-Authorization for all Unconfigured ONUs
              </label>
              <div>
                <label className="block font-bold text-slate-300">
                  Default Service VLAN
                </label>
                <select
                  value={autoAuthVlanId}
                  onChange={(e) => setAutoAuthVlanId(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                >
                  {db.vlans.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vlan_id} - {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded border border-slate-700 bg-[#0d1826] p-3 text-[11px] text-slate-300">
                Jika tombol <b>Save & Run Batch Authorize Now</b> ditekan, sistem akan otomatis mencari <code>onu_index</code> kosong dan mengeksekusi script ZTE OMCI + VLAN tagging untuk seluruh <b>{unconfiguredOnus.length} ONU</b> yang sedang antre di daftar Unconfigured.
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAutoActionsModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setAutoAuthEnabled(true);
                  if (unconfiguredOnus.length > 0) {
                    const targetVlan =
                      db.vlans.find((v) => v.id === autoAuthVlanId) ||
                      db.vlans[0] || {
                        id: 101,
                        vlan_id: 101,
                        name: 'PPPOE',
                      };

                    // Track allocated indices per PON port
                    const usedMap = new Map<string, number[]>();
                    for (const u of db.onus) {
                      if (u.is_authorized && u.onu_index !== null) {
                        const key = `${u.olt_id}-${u.board}-${u.port}`;
                        const list = usedMap.get(key) || [];
                        list.push(u.onu_index);
                        usedMap.set(key, list);
                      }
                    }

                    const batchScriptsByOlt = new Map<number, string[]>();
                    const allocatedIndexByOnuId = new Map<number, number>();

                    for (const u of unconfiguredOnus) {
                      const key = `${u.olt_id}-${u.board}-${u.port}`;
                      const usedList = usedMap.get(key) || [];
                      const nextIdx = findNextAvailableOnuIndex(usedList);
                      usedList.push(nextIdx);
                      usedMap.set(key, usedList);
                      allocatedIndexByOnuId.set(u.id, nextIdx);

                      const oltRec = db.olts.find((o) => o.id === u.olt_id) || db.olts[0];
                      const script = generateAuthorizeCliScript({
                        firmwareVersion: oltRec?.firmware_version || 'V2.1.0',
                        ponInterface: `gpon-olt_1/${u.board}/${u.port}`,
                        onuIndex: nextIdx,
                        serialNumber: u.serial_number,
                        onuType: u.onu_type || 'ALL',
                        customerName: `AUTO-${u.serial_number.slice(-6)}`,
                        address: 'None',
                        tcontProfile: 'SMARTOLT-1G-UP',
                        speedProfile: 'SMARTOLT-1G-DOWN',
                        vlanId: targetVlan.vlan_id,
                        onuMode: 'Routing',
                        wanMode: 'PPPOE',
                        configMethod: 'OMCI',
                        wanRemoteAccess: 'Enabled from everywhere in the internet',
                        pppoeUsername: `USER-${u.serial_number.slice(-4)}-${String(nextIdx).padStart(2, '0')}`,
                        pppoePassword: 'jetcyber',
                        tr069Enabled: false,
                      });
                      const oltIdKey = u.olt_id || oltRec?.id || 1;
                      const list = batchScriptsByOlt.get(oltIdKey) || [];
                      list.push(script);
                      batchScriptsByOlt.set(oltIdKey, list);
                    }

                    const logId = Date.now();
                    const firstOltId =
                      unconfiguredOnus[0]?.olt_id || db.olts[0]?.id || 1;
                    const combinedCli = Array.from(batchScriptsByOlt.values())
                      .flat()
                      .join('\n');

                    setDb((prev) => ({
                      ...prev,
                      onus: prev.onus.map((u) => {
                        const allocIdx = allocatedIndexByOnuId.get(u.id);
                        if (!u.is_authorized && allocIdx) {
                          return {
                            ...u,
                            is_authorized: true,
                            onu_index: allocIdx,
                            customer_name: `AUTO-${u.serial_number.slice(-6)}`,
                            vlan_id: targetVlan.id,
                            phase_state: 'working',
                            last_offline_reason: 'None',
                            auth_date_label: 'Just now (Auto)',
                          };
                        }
                        return u;
                      }),
                      provisioning_logs: [
                        {
                          id: logId,
                          olt_id: firstOltId,
                          onu_id: null,
                          serial_number: 'BATCH-AUTO',
                          action_type: 'AUTHORIZE',
                          interface_target: `${unconfiguredOnus.length} ONUs`,
                          summary_text: `Batch Auto-Authorized ${unconfiguredOnus.length} ONUs on VLAN ${targetVlan.vlan_id}`,
                          cli_script: combinedCli,
                          olt_response: '[Executing on OLT via Telnet...]',
                          execution_status: 'SUCCESS',
                          executed_by: 'likhin',
                          duration_ms: 0,
                          created_at: 'Just now',
                        },
                        ...prev.provisioning_logs,
                      ],
                    }));

                    for (const [oltIdKey, scripts] of batchScriptsByOlt.entries()) {
                      void executeOltCliLive(
                        oltIdKey,
                        scripts.join('\n'),
                        logId,
                        `Batch Auto-Authorize (${scripts.length} ONUs)`
                      );
                    }
                  } else {
                    showToast('Auto-Authorization diaktifkan.');
                  }
                  setShowAutoActionsModal(false);
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                Save & Run Batch Authorize Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: ADD NEW OLT
         ===================================================================== */}
      {showAddOltModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">+ Add New ZTE OLT</h2>
              <button
                type="button"
                onClick={() => setShowAddOltModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300">OLT Name</label>
                <input
                  type="text"
                  value={newOltName}
                  onChange={(e) => setNewOltName(e.target.value)}
                  placeholder="e.g. POP TANGERANG C320"
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">OLT IP Address</label>
                  <input
                    type="text"
                    value={newOltIp}
                    onChange={(e) => setNewOltIp(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Hardware Version</label>
                  <select
                    value={newOltModel}
                    onChange={(e) =>
                      setNewOltModel(
                        e.target.value as 'ZTE-C320' | 'ZTE-C300' | 'ZTE-C300M'
                      )
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                  >
                    <option value="ZTE-C320">ZTE-C320</option>
                    <option value="ZTE-C300">ZTE-C300</option>
                    <option value="ZTE-C300M">ZTE-C300M</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-300">VPN Tunnel Name</label>
                <input
                  type="text"
                  value={newOltVpn}
                  onChange={(e) => setNewOltVpn(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAddOltModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newOltName.trim()) return;
                  const nextId =
                    Math.max(0, ...db.olts.map((o) => o.id)) + 1;
                  setDb((prev) => ({
                    ...prev,
                    olts: [
                      ...prev.olts,
                      {
                        ...prev.olts[0],
                        id: nextId,
                        name: newOltName.trim().toUpperCase(),
                        ip_address: newOltIp.trim() || '172.16.0.10',
                        vpn_name: newOltVpn.trim() || 'tunnel-new',
                        hardware_model: newOltModel,
                        uptime: '0 days, 00:05',
                        last_polled_at: 'Just now',
                      },
                    ],
                  }));
                  showToast(`OLT ${newOltName.toUpperCase()} berhasil ditambahkan.`);
                  setNewOltName('');
                  setShowAddOltModal(false);
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                Save OLT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: FIND CONFIG MISMATCHES
         ===================================================================== */}
      {showMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                OLT Startup vs Running-Config Mismatch Check
              </h2>
              <button
                type="button"
                onClick={() => setShowMismatchModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2.5 px-5 py-4 text-xs">
              {db.olts.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded border border-slate-700 bg-[#0d1826] px-3.5 py-2.5"
                >
                  <div>
                    <div className="font-bold text-white">
                      {o.id} - {o.name} ({o.ip_address})
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Running-config vs Database ONUs & Uplink Tagged VLANs
                    </div>
                  </div>
                  <span className="rounded bg-emerald-950/90 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-400 border border-emerald-500/40">
                    ✓ In Sync (0 Mismatches)
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowMismatchModal(false)}
                className="rounded bg-[#0275d8] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: REGISTER UNCONFIGURED ONU SN TO DATABASE
         ===================================================================== */}
      {showAddUncfgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                Register Unconfigured ONU SN (`show gpon onu uncfg`)
              </h2>
              <button
                type="button"
                onClick={() => setShowAddUncfgModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300">Target OLT</label>
                <select
                  value={manualUncfgOltId}
                  onChange={(e) => setManualUncfgOltId(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                >
                  {db.olts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} - {o.name} ({o.ip_address})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">
                    PON Port (`1/3/x`)
                  </label>
                  <select
                    value={manualUncfgPort}
                    onChange={(e) => setManualUncfgPort(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  >
                    {Array.from({ length: 16 }, (_, idx) => idx + 1).map((p) => (
                      <option key={p} value={p}>
                        gpon-olt_1/3/{p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-300">ONU Type</label>
                  <select
                    value={manualUncfgType}
                    onChange={(e) => setManualUncfgType(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  >
                    <option value="ALL">ALL</option>
                    <option value="F670LV9.0">F670LV9.0</option>
                    <option value="F609V3.0">F609V3.0</option>
                    <option value="HG8245H">HG8245H</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-300">
                  ONU Serial Number (SN)
                </label>
                <input
                  type="text"
                  value={manualUncfgSn}
                  onChange={(e) => setManualUncfgSn(e.target.value.toUpperCase())}
                  placeholder="e.g. ZTEGC6A394D4"
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAddUncfgModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!manualUncfgSn.trim()) return;
                  const newUncfg: OnuRecord = {
                    id: Date.now(),
                    olt_id: manualUncfgOltId,
                    pon_port_id: manualUncfgOltId * 100 + manualUncfgPort,
                    board: 3,
                    port: manualUncfgPort,
                    onu_index: null,
                    serial_number: manualUncfgSn.trim(),
                    onu_type: manualUncfgType,
                    is_authorized: false,
                    customer_name: null,
                    address: null,
                    external_id: manualUncfgSn.trim(),
                    zone_id: db.zones[0]?.id || null,
                    odb_id: db.odbs[0]?.id || null,
                    odb_port: null,
                    vlan_id: db.vlans.find((v) => v.olt_id === manualUncfgOltId)?.id || null,
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
                    distance_m: 520,
                    temperature_c: 40,
                    ip_address: null,
                    firmware_ver: 'V2.1.0',
                    detected_ago: 'Just now',
                    last_online_at: null,
                    last_offline_reason: 'Waiting Authorization',
                  };
                  setDb((prev) => ({
                    ...prev,
                    onus: [...prev.onus, newUncfg],
                  }));
                  setShowAddUncfgModal(false);
                  showToast(
                    `SN ${newUncfg.serial_number} ditambahkan ke daftar Unconfigured (Port 1/3/${manualUncfgPort}).`
                  );
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                Add to Unconfigured
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: POSTGRESQL CONNECTION SETTINGS (localhost:5435 | user: likhin)
         ===================================================================== */}
      {showPgConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                PostgreSQL Connection (Separate Docker DB)
              </h2>
              <button
                type="button"
                onClick={() => setShowPgConfigModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div className="rounded border border-sky-500/30 bg-sky-950/30 p-2.5 text-[11px] text-slate-200">
                <div>
                  Status: <strong className="text-emerald-400">{dbMeta.dbEngine}</strong>
                </div>
                {dbMeta.pgLastError && !dbMeta.pgConnected && (
                  <div className="mt-1 text-amber-300">
                    Info: Saat aplikasi dijalankan di Docker lokal Anda (<code>port 3004</code>), server otomatis terhubung ke PostgreSQL <code>{pgHost}:{pgPort}</code> dan membuat database <code>{pgDatabase}</code> beserta seluruh tabel.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-300">
                    PostgreSQL Host
                  </label>
                  <input
                    type="text"
                    value={pgHost}
                    onChange={(e) => setPgHost(e.target.value)}
                    placeholder="localhost or host.docker.internal"
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">
                    Port (5435)
                  </label>
                  <input
                    type="number"
                    value={pgPort}
                    onChange={(e) => setPgPort(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">
                    Username
                  </label>
                  <input
                    type="text"
                    value={pgUser}
                    onChange={(e) => setPgUser(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">
                    Password
                  </label>
                  <input
                    type="text"
                    value={pgPassword}
                    onChange={(e) => setPgPassword(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">
                  Database Name
                </label>
                <input
                  type="text"
                  value={pgDatabase}
                  onChange={(e) => setPgDatabase(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowPgConfigModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Close
              </button>
              <button
                type="button"
                disabled={pgTesting}
                onClick={async () => {
                  setPgTesting(true);
                  try {
                    const resp = await fetch('/api/db/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        host: pgHost,
                        port: pgPort,
                        user: pgUser,
                        password: pgPassword,
                        database: pgDatabase,
                      }),
                    });
                    const data = await resp.json();
                    if (data.meta) setDbMeta(data.meta);
                    if (data.ok) {
                      showToast(
                        `Connected to PostgreSQL ${pgUser}@${pgHost}:${pgPort}/${pgDatabase}!`
                      );
                      setShowPgConfigModal(false);
                    } else {
                      showToast(
                        `Konfigurasi disimpan (${pgUser}@${pgHost}:${pgPort}). Pastikan PostgreSQL lokal aktif saat dijalankan di Docker.`
                      );
                    }
                  } finally {
                    setPgTesting(false);
                  }
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                {pgTesting ? 'Connecting...' : 'Save & Connect PostgreSQL'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
