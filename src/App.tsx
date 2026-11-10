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

const STORAGE_KEY = 'smartolt_jetcybernet_db_v4_running_config';

export default function App() {
  const [db, setDb] = useState<SmartOltDatabaseState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore storage error
    }
    return INITIAL_DB_STATE;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      // ignore storage error
    }
  }, [db]);

  const [activeView, setActiveView] = useState<NavigationView>('DASHBOARD');
  const [selectedOltId, setSelectedOltId] = useState<number>(11);
  const [initialOltTab, setInitialOltTab] = useState<OltDetailTab>('OLT_DETAILS');
  const [selectedOnuId, setSelectedOnuId] = useState<number>(2); // RATMI default
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

  // Authorize ONU Handler
  const handleConfirmAuthorize = (
    onuId: number,
    updatedFields: Partial<OnuRecord>,
    generatedCli: string,
    allocatedOnuIndex: number
  ) => {
    const targetOnu = db.onus.find((o) => o.id === onuId);
    if (!targetOnu) return;

    const targetPortNum = updatedFields.port || targetOnu.port || 2;
    const newLog: ProvisioningLogRecord = {
      id: Date.now(),
      olt_id: updatedFields.olt_id || targetOnu.olt_id,
      onu_id: onuId,
      serial_number: targetOnu.serial_number,
      action_type: 'AUTHORIZE',
      interface_target: `gpon-onu_1/${updatedFields.board || 3}/${targetPortNum}:${allocatedOnuIndex}`,
      summary_text: `gpon-onu_1/${updatedFields.board || 3}/${targetPortNum}:${allocatedOnuIndex} authorized`,
      cli_script: generatedCli,
      olt_response: '[OK - ZTE OMCI & TR-069 Provisioned]',
      execution_status: 'SUCCESS',
      executed_by: 'muslikhin997@gmail.com',
      duration_ms: 290,
      created_at: 'Just now',
    };

    setDb((prev) => ({
      ...prev,
      onus: prev.onus.map((item) =>
        item.id === onuId ? { ...item, ...updatedFields } : item
      ),
      pon_ports: prev.pon_ports.map((p) =>
        p.port_number === targetPortNum
          ? {
              ...p,
              online_onus: p.online_onus + 1,
              total_onus: p.total_onus + 1,
            }
          : p
      ),
      provisioning_logs: [newLog, ...prev.provisioning_logs],
    }));

    setAuthorizingOnu(null);
    setSelectedOnuId(onuId);
    setActiveView('ONU_DETAIL');
    showToast(
      `ONU ${targetOnu.serial_number} berhasil di-Authorize pada gpon-onu_1/${updatedFields.board || 3}/${targetPortNum}:${allocatedOnuIndex}`
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

    const onuIf = `gpon-onu_1/${targetOnu.board}/${targetOnu.port}:${targetOnu.onu_index || 8}`;
    const summaryMap: Record<string, string> = {
      UPDATE_ONU_MODE: `${onuIf} Changed WAN mode to ${updatedFields?.wan_mode || 'PPPoE'} & WAN remote access`,
      TR069_PUSH: `${onuIf} TR-069 CWMP Inform & SetParameterValues pushed`,
      REBOOT: `${onuIf} Rebooted ONU`,
      RESYNC_CONFIG: `${onuIf} Resync config`,
      FACTORY_RESET: `${onuIf} Restored factory defaults`,
      UPDATE_PPPOE: `${onuIf} Changed WAN PPPoE authentication data`,
      DELETE_ONU: `${onuIf} Deleted ONU`,
      POLL_SIGNAL: `${onuIf} Polled optical power attenuation`,
    };

    const newLog: ProvisioningLogRecord = {
      id: Date.now(),
      olt_id: targetOnu.olt_id,
      onu_id: onuId,
      serial_number: targetOnu.serial_number,
      action_type: actionType,
      interface_target: onuIf,
      summary_text: summaryMap[actionType] || `${onuIf} ${actionType}`,
      cli_script: cliScript,
      olt_response: '[OK]',
      execution_status: 'SUCCESS',
      executed_by: 'muslikhin997@gmail.com',
      duration_ms: 185,
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
      showToast(`ONU ${targetOnu.serial_number} dihapus dan dikembalikan ke Unconfigured.`);
      return;
    }

    setDb((prev) => ({
      ...prev,
      onus: prev.onus.map((item) =>
        item.id === onuId ? { ...item, ...(updatedFields || {}) } : item
      ),
      provisioning_logs: [newLog, ...prev.provisioning_logs],
    }));

    showToast(`${summaryMap[actionType]} berhasil dieksekusi.`);
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

          {/* Right Utility Icons matching Screenshots */}
          <div className="flex items-center gap-3 text-slate-200">
            <button
              type="button"
              onClick={() =>
                showToast(
                  'Configuration saved to ZTE OLT NVRAM (`write` executed on 5/5 OLTs).'
                )
              }
              title="Save OLT running-config to NVRAM"
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
              title="View Complete SQL Schema & Node.js Telnet/SSH Backend Code"
              className="flex items-center gap-1 rounded bg-emerald-600/20 px-2 py-1 text-[11px] font-semibold text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30"
            >
              <FileCode className="h-3.5 w-3.5" />
              SQL & Code
            </button>
            <button type="button" className="hover:text-white" title="Admin Account">
              <User className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(STORAGE_KEY);
                setDb(INITIAL_DB_STATE);
                showToast('Data di-reset ke state default JETCYBERNET.');
              }}
              className="flex items-center gap-1 text-xs font-medium hover:text-white"
            >
              <Power className="h-3.5 w-3.5" />
              Log out
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

              {/* Card 2: Online (Green) */}
              <div
                onClick={() => {
                  setFilterSignalLevel('ALL');
                  setActiveView('CONFIGURED');
                }}
                className="cursor-pointer rounded-md bg-[#28a745] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Online</span>
                  <span className="text-3xl font-bold leading-none">2396</span>
                </div>
                <div className="mt-4 flex items-center justify-end border-t border-white/20 pt-1.5 text-xs">
                  <span>Total authorized: 2526</span>
                </div>
              </div>

              {/* Card 3: Total offline (Dark Slate) */}
              <div
                onClick={() => setActiveView('CONFIGURED')}
                className="cursor-pointer rounded-md bg-[#343a40] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Total offline</span>
                  <span className="text-3xl font-bold leading-none">130</span>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/20 pt-1.5 text-xs">
                  <span>PwrFail: 88</span>
                  <span>LoS: 30</span>
                  <span>N/A: 12</span>
                </div>
              </div>

              {/* Card 4: Low signals (Orange) */}
              <div
                onClick={() => {
                  setFilterSignalLevel('CRITICAL');
                  setActiveView('CONFIGURED');
                }}
                className="cursor-pointer rounded-md bg-[#e67e22] px-4 py-3 text-white shadow-lg transition hover:brightness-110"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Low signals</span>
                  <span className="text-3xl font-bold leading-none">606</span>
                </div>
                <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/20 pt-1.5 text-xs">
                  <span>Warning: 318</span>
                  <span>Critical: 288</span>
                </div>
              </div>
            </div>

            {/* Middle Row: Network status chart + OLTs 5/5 online */}
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
                    Network status (last 24 hours) — max: 2.51K ONUs
                  </div>
                  <div className="mt-2 flex h-32 items-end gap-0.5 border-b border-l border-slate-700 pt-4">
                    {Array.from({ length: 36 }, (_, i) => (
                      <div
                        key={i}
                        className="flex h-full flex-1 flex-col justify-end"
                      >
                        <div className="h-2 w-full bg-amber-500/80" />
                        <div className="h-24 w-full bg-emerald-500/80" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between font-mono text-[10px] text-slate-300">
                    <span className="text-emerald-400">
                      ■ Good signal: 1.79K avg
                    </span>
                    <span className="text-amber-400">■ Low signal: 606</span>
                    <span className="text-red-400">■ LOS: 30</span>
                    <span className="text-sky-400">■ Power fail: 88</span>
                  </div>
                </div>
              </div>

              {/* OLTs 5/5 online list */}
              <div className="rounded border border-[#1e3a5f] bg-[#0b192c]/90 p-4 lg:col-span-6">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-bold text-white">OLTs</span>
                  <span className="rounded bg-[#28a745] px-2 py-0.5 text-[11px] font-bold text-white">
                    5/5 online
                  </span>
                </div>

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
                          {o.id} - {o.name}
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
              </div>
            </div>

            {/* Bottom Row: PON outage accordions + Info activity feed */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* PON outage */}
              <div className="space-y-2 lg:col-span-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">PON outage</span>
                  <span className="text-xs text-slate-400">
                    Click category to expand
                  </span>
                </div>

                <div className="rounded border border-[#1e3a5f] bg-[#13263e] px-3 py-2 text-xs font-semibold text-white">
                  VIP affected
                </div>

                {/* Expanded Signal variations box matching Screenshot image_eaabc7d1.png */}
                <div className="overflow-hidden rounded border border-[#1e3a5f] bg-[#0c1c30]">
                  <div className="flex items-center justify-between bg-[#162b46] px-3 py-2 text-xs font-semibold text-white">
                    <span>Signal variations</span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px]">
                        4 PONs
                      </span>
                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px]">
                        4 Critical
                      </span>
                    </div>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1e3a5f] text-slate-300">
                      <tr>
                        <th className="px-3 py-1.5">OLT</th>
                        <th className="px-3 py-1.5">PON</th>
                        <th className="px-3 py-1.5">Affected</th>
                        <th className="px-3 py-1.5">Variation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e3a5f]/50">
                      <tr>
                        <td className="px-3 py-1.5">2 - POP KEBAYORAN LAMA C320</td>
                        <td className="px-3 py-1.5 text-sky-400">
                          1/2/2: RK 01 - KBY LAMA
                        </td>
                        <td className="px-3 py-1.5 text-sky-400">21 / 31 ONUs</td>
                        <td className="px-3 py-1.5">
                          <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                            -4.5 dB
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5">5 - POP KARTENG C300</td>
                        <td className="px-3 py-1.5 text-sky-400">
                          1/3/13: RK 13 - METRO PERMATA
                        </td>
                        <td className="px-3 py-1.5 text-sky-400">27 / 32 ONUs</td>
                        <td className="px-3 py-1.5">
                          <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                            +2.4 dB
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5">5 - POP KARTENG C300</td>
                        <td className="px-3 py-1.5 text-sky-400">
                          1/4/3: RK 09 - KARANG TIMUR
                        </td>
                        <td className="px-3 py-1.5 text-sky-400">28 / 38 ONUs</td>
                        <td className="px-3 py-1.5">
                          <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                            -2.9 dB
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5">8 - POP BOGOR C300 MINI</td>
                        <td className="px-3 py-1.5 text-sky-400">
                          1/2/6: RK 06 - SINAR SARI
                        </td>
                        <td className="px-3 py-1.5 text-sky-400">12 / 14 ONUs</td>
                        <td className="px-3 py-1.5">
                          <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                            -5.5 dB
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded border border-[#1e3a5f] bg-[#13263e] px-3 py-2 text-xs font-semibold text-white">
                  Partial LOS
                </div>
                <div className="rounded border border-[#1e3a5f] bg-[#13263e] px-3 py-2 text-xs font-semibold text-white">
                  Full PON LOS
                </div>
                <div className="rounded border border-[#1e3a5f] bg-[#13263e] px-3 py-2 text-xs font-semibold text-white">
                  Power fail
                </div>
              </div>

              {/* Info activity feed */}
              <div className="space-y-2 lg:col-span-6">
                <div className="text-sm font-bold text-white">Info</div>
                <div className="divide-y divide-[#1e3a5f]/60 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 text-xs">
                  {db.provisioning_logs.slice(0, 6).map((log) => {
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
                            on {log.olt_id} - {logOlt?.name || 'POP BOGOR'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          by {log.executed_by} · {log.created_at}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 2: UNCONFIGURED ONUS (Exact match to Screenshot _C1DBB18F)
           =================================================================== */}
        {activeView === 'UNCONFIGURED' && (
          <div className="space-y-5 text-xs">
            {/* Top Row: OLT Selector + Refresh on Left, Auto actions on Right */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">OLT</span>
                <select className="rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white">
                  <option>All selected (5)</option>
                  {db.olts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} - {o.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (unconfiguredOnus.length === 0) {
                      const randomHex = Math.floor(1000 + Math.random() * 9000)
                        .toString(16)
                        .toUpperCase();
                      const discoveredOnu: OnuRecord = {
                        id: Date.now(),
                        olt_id: 11,
                        pon_port_id: 2,
                        board: 3,
                        port: 2,
                        onu_index: null,
                        serial_number: `ZTEGC6A3${randomHex}`,
                        onu_type: 'F609V3.0',
                        is_authorized: false,
                        customer_name: null,
                        address: null,
                        external_id: `ZTEGC6A3${randomHex}`,
                        zone_id: 1,
                        odb_id: 1,
                        odb_port: null,
                        vlan_id: 1,
                        speed_profile_id: 1,
                        tcont_profile_id: 1,
                        onu_mode: 'Routing',
                        wan_mode: 'PPPOE',
                        config_method: 'OMCI',
                        wan_remote_access: 'Enabled from everywhere in the internet',
                        wan_remote_allowed_subnet: '0.0.0.0/0',
                        tr069_profile_id: 1,
                        tr069_status: 'PENDING_INFORM',
                        tr069_last_inform: null,
                        wifi_ssid: null,
                        wifi_password: null,
                        pppoe_username: null,
                        pppoe_password: null,
                        hotspot_bridge_vlan: null,
                        admin_state: 'ENABLED',
                        phase_state: 'Unconfigured',
                        onu_rx_dbm: -20.8,
                        onu_tx_dbm: 2.35,
                        olt_rx_dbm: -23.9,
                        distance_m: 780,
                        temperature_c: 41.2,
                        ip_address: null,
                        firmware_ver: 'V5.2.10P4T2',
                        detected_ago: 'Just now',
                        last_online_at: null,
                        last_offline_reason: 'Waiting Authorization',
                      };
                      setDb((prev) => ({
                        ...prev,
                        onus: [...prev.onus, discoveredOnu],
                      }));
                      showToast(
                        `Polled show gpon onu uncfg: 1 SN baru (${discoveredOnu.serial_number}) terdeteksi di 11 - POP LEBAK C300 MINI!`
                      );
                    } else {
                      showToast(
                        `Polled show gpon onu uncfg across all ${db.olts.length} OLTs: ${unconfiguredOnus.length} ONU waiting authorization.`
                      );
                    }
                  }}
                  className="flex items-center gap-1 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
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
                1-{filteredConfiguredOnus.length} ONUs of 2526 displayed.
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
                              if (db.olts.length <= 1) return;
                              setDb((prev) => ({
                                ...prev,
                                olts: prev.olts.filter((item) => item.id !== o.id),
                              }));
                              showToast(`OLT ${o.name} dihapus.`);
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
              setDb((prev) => ({
                ...prev,
                olts: [
                  ...prev.olts,
                  {
                    ...newOltData,
                    id: nextId,
                  },
                ],
              }));
              showToast(
                `OLT ${newOltData.name} (${newOltData.hardware_model} - ${newOltData.ip_address}) berhasil disimpan & SNMP community dibuat di OLT!`
              );
              setActiveView('OLTS_LIST');
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
                    id: Date.now(),
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-VLAN',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: `vlan ${addedVlanNums.join(',')}`,
                    summary_text: `Created VLAN(s) ${addedVlanNums.join(',')} & tagged on Uplink`,
                    cli_script: cliScript,
                    olt_response: '[OK]',
                    execution_status: 'SUCCESS',
                    executed_by: 'muslikhin997@gmail.com',
                    duration_ms: 165,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(
                `VLAN ${addedVlanNums.join(', ')} berhasil dibuat dan di-tag ke Uplink OLT.`
              );
            }}
            onToggleVlanFlag={(vlanRecordId, field) => {
              setDb((prev) => ({
                ...prev,
                vlans: prev.vlans.map((v) =>
                  v.id === vlanRecordId ? { ...v, [field]: !v[field] } : v
                ),
              }));
              showToast(`Pengaturan ${field} pada VLAN berhasil diperbarui.`);
            }}
            onDeleteVlans={(vlanRecordIds) => {
              setDb((prev) => ({
                ...prev,
                vlans: prev.vlans.filter((v) => !vlanRecordIds.includes(v.id)),
              }));
              showToast(`${vlanRecordIds.length} VLAN dihapus dari OLT.`);
            }}
            onUpdateUplinkPort={(uplinkId, updated, cliScript) => {
              const targetUplink = db.uplink_ports.find((u) => u.id === uplinkId);
              setDb((prev) => ({
                ...prev,
                uplink_ports: prev.uplink_ports.map((u) =>
                  u.id === uplinkId ? { ...u, ...updated } : u
                ),
                provisioning_logs: [
                  {
                    id: Date.now(),
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-UPLINK',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: targetUplink?.name || 'gei_1/19/3',
                    summary_text: `Uplink ${targetUplink?.name || ''} tagged VLANs updated (${updated.tagged_vlans || ''})`,
                    cli_script: cliScript,
                    olt_response: '[OK]',
                    execution_status: 'SUCCESS',
                    executed_by: 'muslikhin997@gmail.com',
                    duration_ms: 145,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(
                `Konfigurasi & Tag VLAN pada Uplink ${targetUplink?.name || ''} berhasil disimpan ke OLT!`
              );
            }}
            onCreateLagUplink={(newUplink, cliScript) => {
              setDb((prev) => ({
                ...prev,
                uplink_ports: [
                  ...prev.uplink_ports,
                  { ...newUplink, id: Date.now() },
                ],
                provisioning_logs: [
                  {
                    id: Date.now(),
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-LAG',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: newUplink.name,
                    summary_text: `Created LACP LAG ${newUplink.name} (${newUplink.tagged_vlans})`,
                    cli_script: cliScript,
                    olt_response: '[OK]',
                    execution_status: 'SUCCESS',
                    executed_by: 'muslikhin997@gmail.com',
                    duration_ms: 190,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(`LAG ${newUplink.name} berhasil dibuat pada Uplink OLT!`);
            }}
            onUpdatePonPort={(portNumber, updated, cliScript) => {
              setDb((prev) => {
                const exists = prev.pon_ports.some(
                  (p) => p.port_number === portNumber
                );
                const nextPonPorts = exists
                  ? prev.pon_ports.map((p) =>
                      p.port_number === portNumber ? { ...p, ...updated } : p
                    )
                  : [
                      ...prev.pon_ports,
                      {
                        id: Date.now(),
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
                      id: Date.now(),
                      olt_id: selectedOlt.id,
                      onu_id: null,
                      serial_number: 'OLT-PON',
                      action_type: 'RESYNC_CONFIG',
                      interface_target: `gpon-olt_1/3/${portNumber}`,
                      summary_text: `Updated PON port gpon-olt_1/3/${portNumber}`,
                      cli_script: cliScript,
                      olt_response: '[OK]',
                      execution_status: 'SUCCESS',
                      executed_by: 'muslikhin997@gmail.com',
                      duration_ms: 130,
                      created_at: 'Just now',
                    },
                    ...prev.provisioning_logs,
                  ],
                };
              });
              showToast(`Port GPON 1/3/${portNumber} berhasil diperbarui.`);
            }}
            onEnableAllPonPorts={() => {
              setDb((prev) => ({
                ...prev,
                pon_ports: prev.pon_ports.map((p) => ({
                  ...p,
                  admin_state: 'ENABLED',
                  oper_status: 'Up',
                })),
              }));
              showToast('Seluruh port GPON pada Slot 3 GTGH diaktifkan (Up).');
            }}
            onRefreshOltCards={() => {
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
              showToast('Informasi kartu OLT (GTGH, SCXM, HUVQ) diperbarui.');
            }}
            onRebootOltCard={(cardId) => {
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
              }));
              showToast('Perintah Reboot-card berhasil dikirim ke sasis OLT.');
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
                      db.vlans.find((v) => v.id === autoAuthVlanId) || db.vlans[0];
                    setDb((prev) => ({
                      ...prev,
                      onus: prev.onus.map((u, idx) =>
                        !u.is_authorized
                          ? {
                              ...u,
                              is_authorized: true,
                              onu_index: 15 + idx,
                              customer_name: `AUTO-${u.serial_number.slice(-6)}`,
                              vlan_id: targetVlan.id,
                              phase_state: 'working',
                              last_offline_reason: 'None',
                              auth_date_label: 'Just now (Auto)',
                            }
                          : u
                      ),
                    }));
                    showToast(
                      `Auto-Authorize selesai: ${unconfiguredOnus.length} ONU berhasil didaftarkan ke VLAN ${targetVlan.vlan_id}!`
                    );
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
    </div>
  );
}
