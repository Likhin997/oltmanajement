import React, { useState, useEffect } from 'react';
import {
  OnuRecord,
  SmartOltDatabaseState,
} from '../services/mockDatabase';
import {
  generateAuthorizeCliScript,
  generateRebootCliScript,
  generateFactoryResetCliScript,
  generateDeleteOnuCliScript,
  generateTr069CwmpRpcPreview,
  generateOnuEthPortCliScript,
  parseZteOpticalAttenuation,
} from '../services/oltEngine';
import { UpdateOnuModeModal } from './UpdateOnuModeModal';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
  Trash2,
  Terminal,
  Copy,
  Check,
  Radio,
  Sliders,
  Gauge,
  Wifi,
  X,
} from 'lucide-react';

interface EthPortSetting {
  portIdx: number;
  adminState: 'Unlocked' | 'Locked';
  mode: 'LAN' | 'Tag VLAN' | 'Transparent';
  vlanId: number;
  dhcpMode: 'From ONU' | 'From Internet';
}

interface OnuDetailViewProps {
  onu: OnuRecord;
  db: SmartOltDatabaseState;
  onBack: () => void;
  onBackToDashboard?: () => void;
  onViewOlt?: (oltId: number) => void;
  onExecuteAction: (
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
  ) => void;
}

export const OnuDetailView: React.FC<OnuDetailViewProps> = ({
  onu,
  db,
  onBack,
  onBackToDashboard,
  onViewOlt,
  onExecuteAction,
}) => {
  const olt =
    db.olts.find((o) => o.id === onu.olt_id) ||
    db.olts[0] || {
      id: onu.olt_id || 1,
      name: `OLT-${onu.olt_id || 1}`,
      firmware_version: 'V2.1.0' as const,
    };
  const vlan =
    db.vlans.find((v) => v.id === onu.vlan_id || v.vlan_id === onu.vlan_id) ||
    db.vlans[1] ||
    db.vlans[0] || {
      id: 101,
      vlan_id: 101,
      name: 'PPPOE',
    };
  const speedProfile =
    db.speed_profiles.find((s) => s.id === onu.speed_profile_id) ||
    db.speed_profiles[0];
  const tcontProfile =
    db.tcont_profiles.find((t) => t.id === onu.tcont_profile_id) ||
    db.tcont_profiles[0];
  const zone = db.zones.find((z) => z.id === onu.zone_id);
  const odb = db.odbs.find((o) => o.id === onu.odb_id);
  const tr069Profile =
    db.tr069_profiles.find((p) => p.id === onu.tr069_profile_id) ||
    db.tr069_profiles[0];

  const [showPppoeUser, setShowPppoeUser] = useState(false);
  const [showPppoePass, setShowPppoePass] = useState(false);
  const [showUpdateModeModal, setShowUpdateModeModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vipCustomer, setVipCustomer] = useState(false);
  const [customProfile, setCustomProfile] = useState(false);
  const [livePolling, setLivePolling] = useState(false);
  const [trafficPeriod, setTrafficPeriod] = useState<
    'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  >('Daily');
  const [signalPeriod, setSignalPeriod] = useState<
    'Weekly' | 'Monthly' | 'Yearly'
  >('Weekly');
  const [activeConsoleOutput, setActiveConsoleOutput] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [copiedCli, setCopiedCli] = useState(false);

  // Inline / Modal editors for ONU metadata & ports
  const [activeEditDialog, setActiveEditDialog] = useState<
    | 'MOVE_ONU'
    | 'METADATA'
    | 'MGMT_IP'
    | 'SPEED_PROFILE'
    | 'WIFI'
    | null
  >(null);
  const [moveBoard, setMoveBoard] = useState(onu.board);
  const [movePort, setMovePort] = useState(onu.port);
  const [moveIndex, setMoveIndex] = useState(onu.onu_index || 8);

  const [metaName, setMetaName] = useState(onu.customer_name || 'RATMI');
  const [metaAddress, setMetaAddress] = useState(onu.address || 'None');
  const [metaContact, setMetaContact] = useState(onu.contact || 'None');
  const [metaExtId, setMetaExtId] = useState(
    onu.external_id || onu.serial_number
  );
  const [metaZoneId, setMetaZoneId] = useState(onu.zone_id || 1);
  const [metaOdbId, setMetaOdbId] = useState<number>(onu.odb_id || 1);
  const [metaOdbPort, setMetaOdbPort] = useState<number>(onu.odb_port || 3);

  const [mgmtIpInput, setMgmtIpInput] = useState(
    onu.mgmt_ip || '10.100.3.8'
  );
  const [mgmtVlanInput, setMgmtVlanInput] = useState(100);
  const [selectedSpeedId, setSelectedSpeedId] = useState(
    onu.speed_profile_id || 1
  );
  const [wifiSsidInput, setWifiSsidInput] = useState(
    onu.wifi_ssid || 'RATMI_JETCYBER'
  );
  const [wifiPassInput, setWifiPassInput] = useState(
    onu.wifi_password || 'jetcyber'
  );

  // Ethernet ports state (eth_0/1 .. eth_0/8)
  const [ethPorts, setEthPorts] = useState<EthPortSetting[]>(() =>
    Array.from({ length: 8 }, (_, idx) => ({
      portIdx: idx + 1,
      adminState: 'Unlocked',
      mode: onu.onu_mode === 'Bridging' ? 'Tag VLAN' : 'LAN',
      vlanId: vlan?.vlan_id || 101,
      dhcpMode: onu.onu_mode === 'Bridging' ? 'From Internet' : 'From ONU',
    }))
  );
  const [configuringEthPort, setConfiguringEthPort] =
    useState<EthPortSetting | null>(null);

  const onuInterface = `gpon-onu_1/${onu.board}/${onu.port}:${onu.onu_index || 1}`;
  const distanceKm = (onu.distance_m / 1000).toFixed(2);

  // Live Polling Effect when LIVE! button is active
  useEffect(() => {
    if (!livePolling) return;
    const timer = setInterval(() => {
      const nextOnuRx = Number(
        ((onu.onu_rx_dbm ?? -23.19) + (Math.random() * 0.16 - 0.08)).toFixed(2)
      );
      const nextOltRx = Number(
        ((onu.olt_rx_dbm ?? -30.87) + (Math.random() * 0.16 - 0.08)).toFixed(2)
      );
      onExecuteAction(
        onu.id,
        'POLL_SIGNAL',
        `show pon power attenuation ${onuInterface}`,
        {
          onu_rx_dbm: nextOnuRx,
          olt_rx_dbm: nextOltRx,
        }
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [livePolling, onu.id, onu.onu_rx_dbm, onu.olt_rx_dbm, onuInterface, onExecuteAction]);

  const handleGetStatus = async () => {
    const cli = `show gpon onu detail-info ${onuInterface}\nshow pon power attenuation ${onuInterface}`;
    setActiveConsoleOutput({
      title: `Get status — ${onuInterface} (Connecting to ${olt.ip_address}:${olt.telnet_port}...)`,
      content: `Executing on ${olt.name} (${olt.ip_address}:${olt.telnet_port}):\n${cli}\n\nWaiting for OLT response...`,
    });

    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oltId: olt.id,
          commands: [
            `show gpon onu detail-info ${onuInterface}`,
            `show pon power attenuation ${onuInterface}`,
          ],
        }),
      });
      const data = await resp.json();
      if (data.ok && data.output) {
        const parsedPower = parseZteOpticalAttenuation(data.output);
        const updatedPower: Partial<OnuRecord> = {};
        if (parsedPower.onuRxDbm !== null) updatedPower.onu_rx_dbm = parsedPower.onuRxDbm;
        if (parsedPower.oltRxDbm !== null) updatedPower.olt_rx_dbm = parsedPower.oltRxDbm;
        if (parsedPower.onuTxDbm !== null) updatedPower.onu_tx_dbm = parsedPower.onuTxDbm;
        onExecuteAction(onu.id, 'POLL_SIGNAL', cli, updatedPower);
        setActiveConsoleOutput({
          title: `Get status (LIVE OLT) — ${onuInterface}`,
          content: data.output,
        });
        return;
      }
    } catch {
      // Fallback below if OLT is offline
    }

    onExecuteAction(onu.id, 'POLL_SIGNAL', cli);
    setActiveConsoleOutput({
      title: `Get status — ${onuInterface}`,
      content: `${olt.name}# show gpon onu detail-info ${onuInterface}
ONU interface:         ${onuInterface}
  Name:                ${onu.customer_name || onu.serial_number}
  Type:                ${onu.onu_type}
  State:               ready
  Admin state:         enable
  Phase state:         ${onu.phase_state}
  Serial number:       ${onu.serial_number}
  ONU Distance:        ${onu.distance_m}m
  Online Duration:     01h 33m 48s

${olt.name}# show pon power attenuation ${onuInterface}
           OLT                  ONU              Attenuation
----------------------------------------------------------------
up      Rx :${(onu.olt_rx_dbm ?? -24.8).toFixed(3)}(dbm)      Tx :2.350(dbm)        27.150(db)
down    Tx :10.548(dbm)       Rx :${(onu.onu_rx_dbm ?? -21.5).toFixed(3)}(dbm)      32.048(db)`,
    });
  };

  const handleShowRunningConfig = async () => {
    const script = generateAuthorizeCliScript({
      firmwareVersion: olt.firmware_version,
      ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
      onuIndex: onu.onu_index || 1,
      serialNumber: onu.serial_number,
      onuType: onu.onu_type,
      customerName: onu.customer_name || onu.serial_number,
      address: onu.address || 'None',
      tcontProfile: tcontProfile?.profile_name || 'SMARTOLT-1G-UP',
      speedProfile: speedProfile?.profile_name || 'SMARTOLT-1G-DOWN',
      vlanId: vlan?.vlan_id || 101,
      onuMode: onu.onu_mode,
      wanMode: onu.wan_mode,
      configMethod: onu.config_method,
      wanRemoteAccess: onu.wan_remote_access,
      pppoeUsername: onu.pppoe_username || `USER-${onu.serial_number.slice(-4)}`,
      pppoePassword: onu.pppoe_password || 'jetcyber',
      tr069Enabled: onu.config_method === 'TR069',
      tr069AcsUrl: tr069Profile?.acs_url,
      tr069AcsUsername: tr069Profile?.acs_username,
      tr069AcsPassword: tr069Profile?.acs_password,
    });
    setActiveConsoleOutput({
      title: `Show running-config — ${onuInterface}`,
      content: script,
    });

    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oltId: olt.id,
          commands: [
            `show running-config interface ${onuInterface}`,
            `show onu running config ${onuInterface}`,
          ],
        }),
      });
      const data = await resp.json();
      if (data.ok && data.output && data.output.trim().length > 20) {
        setActiveConsoleOutput({
          title: `Show running-config (LIVE OLT) — ${onuInterface}`,
          content: data.output,
        });
      }
    } catch {
      // Keep generated CLI preview if OLT is offline
    }
  };

  const handleSwInfo = async () => {
    setActiveConsoleOutput({
      title: `SW info — ${onuInterface}`,
      content: `${olt.name}# show gpon remote-onu equip ${onuInterface}
Vendor ID:           ZTEG
Version:             V3.0
Serial number:       ${onu.serial_number}
Traffic management:  2
Battery backup:      false
Bootrom version:     V9.0.10P1N9
Software0 version:   ${onu.firmware_ver} (Active, Committed)
Software1 version:   V9.0.10P1N8 (Standby)`,
    });

    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oltId: olt.id,
          commands: [`show gpon remote-onu equip ${onuInterface}`],
        }),
      });
      const data = await resp.json();
      if (data.ok && data.output && data.output.trim().length > 15) {
        setActiveConsoleOutput({
          title: `SW info (LIVE OLT) — ${onuInterface}`,
          content: data.output,
        });
      }
    } catch {
      // Keep default SW info preview if OLT is offline
    }
  };

  const handleTr069Push = () => {
    const rpcPayload = generateTr069CwmpRpcPreview({
      serialNumber: onu.serial_number,
      vlanId: vlan?.vlan_id || 101,
      onuMode: onu.onu_mode || 'Routing',
      wanMode: onu.wan_mode || 'PPPOE',
      pppoeUsername: onu.pppoe_username || 'RATMI-010111',
      pppoePassword: onu.pppoe_password || 'jetcyber',
      wanRemoteAccess:
        onu.wan_remote_access || 'Enabled from everywhere in the internet',
      acsUrl: tr069Profile?.acs_url || 'http://acs.jetcybernet.id:7547/cwmp',
      periodicInterval: tr069Profile?.periodic_inform_interval || 300,
      wifiSsid: onu.wifi_ssid || 'RATMI_JETCYBER',
      wifiPassword: onu.wifi_password || 'jetcyber',
    });
    onExecuteAction(onu.id, 'TR069_PUSH', rpcPayload, {
      tr069_status: 'ACTIVE_INFORMING',
      tr069_last_inform: 'Today 16:45:00',
    });
    setActiveConsoleOutput({
      title: `TR-069 CWMP ACS Inform & SetParameterValues — ${onu.serial_number}`,
      content: rpcPayload,
    });
  };

  const handleReboot = () => {
    const cli = generateRebootCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 8
    );
    onExecuteAction(onu.id, 'REBOOT', cli);
    setActiveConsoleOutput({
      title: `Reboot ONU — ${onuInterface}`,
      content: cli,
    });
  };

  const handleResync = () => {
    const script = generateAuthorizeCliScript({
      firmwareVersion: olt.firmware_version,
      ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
      onuIndex: onu.onu_index || 1,
      serialNumber: onu.serial_number,
      onuType: onu.onu_type,
      customerName: onu.customer_name || onu.serial_number,
      address: onu.address || 'None',
      tcontProfile: tcontProfile?.profile_name || 'SMARTOLT-1G-UP',
      speedProfile: speedProfile?.profile_name || 'SMARTOLT-1G-DOWN',
      vlanId: vlan?.vlan_id || 101,
      onuMode: onu.onu_mode,
      wanMode: onu.wan_mode,
      configMethod: onu.config_method,
      wanRemoteAccess: onu.wan_remote_access,
      pppoeUsername: onu.pppoe_username || `USER-${onu.serial_number.slice(-4)}`,
      pppoePassword: onu.pppoe_password || 'jetcyber',
      tr069Enabled: onu.config_method === 'TR069',
      tr069AcsUrl: tr069Profile?.acs_url,
    });
    onExecuteAction(onu.id, 'RESYNC_CONFIG', script, {
      phase_state: 'working',
    });
    setActiveConsoleOutput({
      title: `Resync config — ${onuInterface}`,
      content: script,
    });
  };

  const handleRestoreDefaults = () => {
    const cli = generateFactoryResetCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 8
    );
    onExecuteAction(onu.id, 'FACTORY_RESET', cli);
    setActiveConsoleOutput({
      title: `Restore defaults — ${onuInterface}`,
      content: cli,
    });
  };

  const handleDelete = () => {
    const cli = generateDeleteOnuCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 8
    );
    onExecuteAction(onu.id, 'DELETE_ONU', cli);
  };

  return (
    <div className="space-y-5 text-xs text-slate-200">
      {/* Top Back Links matching Screenshot _5EEB9112 */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to ONUs list
        </button>
        {onBackToDashboard && (
          <button
            type="button"
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </button>
        )}
      </div>

      {/* Main 2-Column ONU Metadata & Optical/WAN Panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT METADATA COLUMN */}
        <div className="divide-y divide-[#1e3a5f]/70 border-t border-b border-[#1e3a5f]/70 lg:col-span-6">
          {/* OLT */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">OLT</div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span>
                {olt.id} - {olt.name}
              </span>
              {onViewOlt && (
                <button
                  type="button"
                  onClick={() => onViewOlt(olt.id)}
                  className="text-sky-400 hover:underline"
                >
                  View
                </button>
              )}
            </div>
          </div>

          {/* Board / Port / Allocated ONU */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">Board</div>
            <div className="col-span-8 flex flex-wrap items-center gap-5 text-white">
              <span className="font-mono">{onu.board}</span>
              <span className="font-semibold text-slate-300">Port</span>
              <span className="font-mono">{onu.port}</span>
              <span className="font-semibold text-slate-300">Allocated ONU</span>
              <span className="font-mono">{onu.onu_index || 8}</span>
              <button
                type="button"
                onClick={() => {
                  setMoveBoard(onu.board);
                  setMovePort(onu.port);
                  setMoveIndex(onu.onu_index || 8);
                  setActiveEditDialog('MOVE_ONU');
                }}
                className="text-sky-400 hover:underline"
              >
                Move ONU
              </button>
            </div>
          </div>

          {/* GPON channel */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              GPON channel
            </div>
            <div className="col-span-8 flex items-center gap-1.5 text-white">
              <span className="font-bold text-emerald-400">G</span> GPON
            </div>
          </div>

          {/* SN */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">SN</div>
            <div className="col-span-8 flex items-center gap-3 font-mono text-white">
              <span>{onu.serial_number}</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="font-sans text-sky-400 hover:underline"
              >
                Edit
              </button>
            </div>
          </div>

          {/* ONU type */}
          <div className="grid grid-cols-12 items-start py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              ONU type
            </div>
            <div className="col-span-8 space-y-1 text-white">
              <div className="flex items-center gap-2">
                <span>ALL (Original: F609V3.0)</span>
                <button
                  type="button"
                  onClick={() => setActiveEditDialog('METADATA')}
                  className="text-sky-400 hover:underline"
                >
                  Change
                </button>
              </div>
              <div className="text-slate-300">Capability: Bridging/Routing</div>
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setActiveConsoleOutput({
                      title: `ONU Hardware Catalog — ZTE F609V3.0`,
                      content: `Model: ZTE ZXHN F609 V3.0\nPorts: 1x GPON SC/APC, 4x GE RJ45 (eth_0/1..4), 2x POTS RJ11, 2.4GHz 802.11n 2x2 MIMO WiFi (300Mbps)\nOMCI Profile: ALL / ZTE-G988-ROUTING`,
                    })
                  }
                  className="text-sky-400 hover:underline"
                >
                  ONU type image
                </button>
              </div>
            </div>
          </div>

          {/* Configuration Preset */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              Configuration Preset
            </div>
            <div className="col-span-8 text-white">None</div>
          </div>

          {/* Zone */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">Zone</div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span>{zone?.name || 'MUARA LEBAK - RK O1'}</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Splitter */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              Splitter
            </div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span>
                {odb ? `${odb.name} Port ${onu.odb_port || 3}` : '01- 010111 Port 3'}
              </span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Sector */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">Sector</div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span>None</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Name */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">Name</div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span className="font-semibold">{onu.customer_name || 'RATMI'}</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Address or comment */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              Address or comment
            </div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span>{onu.address || 'None'}</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">Contact</div>
            <div className="col-span-8 flex items-center gap-3 text-white">
              <span>{onu.contact || 'None'}</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Authorization date */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              Authorization date
            </div>
            <div className="col-span-8 text-white">
              {onu.last_online_at || '10-Nov-2026 15:05:57'}
            </div>
          </div>

          {/* ONU external ID */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              ONU external ID
            </div>
            <div className="col-span-8 flex items-center gap-3 font-mono text-white">
              <span>{onu.external_id || onu.serial_number}</span>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="font-sans text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* Location */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              Location
            </div>
            <div className="col-span-8 flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setActiveConsoleOutput({
                    title: `ODB GPS Location — ${odb?.name || '01- 010111'}`,
                    content: `Latitude: ${odb?.latitude || -6.208763}, Longitude: ${odb?.longitude || 106.816666}\nPole: ${odb?.pole_number || 'TIANG-ML-01'} (Distance from OLT: ${onu.distance_m}m)`,
                  })
                }
                className="text-sky-400 hover:underline"
              >
                View on map
              </button>
              <button
                type="button"
                onClick={() => setActiveEditDialog('METADATA')}
                className="text-sky-400 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {/* VIP customer */}
          <div className="grid grid-cols-12 items-center py-2">
            <div className="col-span-4 font-semibold text-slate-300">
              VIP customer
            </div>
            <div className="col-span-8">
              <input
                type="checkbox"
                checked={vipCustomer}
                onChange={(e) => setVipCustomer(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Rear Panel Diagram + Status + Rx Gauges + WAN/TR069 */}
        <div className="space-y-3 lg:col-span-6">
          {/* ONU Rear-Panel Port Graphic */}
          <div className="flex flex-wrap items-center gap-2 rounded border border-[#1e3a5f] bg-[#162942] px-4 py-3 shadow-inner">
            <div className="flex flex-col items-center rounded bg-slate-800 px-2.5 py-1.5">
              <div className="h-4 w-5 rounded-xs border-2 border-emerald-400 bg-emerald-500/80" />
              <span className="mt-1 text-[9px] font-bold text-emerald-300">PON</span>
            </div>
            {['LAN1', 'LAN2', 'LAN3', 'LAN4'].map((lan, idx) => (
              <div
                key={lan}
                onClick={() => setConfiguringEthPort(ethPorts[idx])}
                className="flex cursor-pointer flex-col items-center rounded bg-slate-800 px-2.5 py-1.5 hover:bg-slate-700"
                title={`Click to configure eth_0/${idx + 1}`}
              >
                <div
                  className={`h-4 w-5 rounded-xs border ${
                    idx === 0
                      ? 'border-amber-400 bg-amber-400/80'
                      : 'border-slate-500 bg-slate-700'
                  }`}
                />
                <span className="mt-1 text-[9px] font-semibold text-slate-300">
                  {lan}
                </span>
              </div>
            ))}
            {['Phone1', 'Phone2'].map((ph) => (
              <div
                key={ph}
                className="flex flex-col items-center rounded bg-slate-800 px-2 py-1.5"
              >
                <div className="h-3.5 w-4 rounded-xs border border-slate-500 bg-slate-700" />
                <span className="mt-1 text-[9px] text-slate-400">{ph}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex flex-col items-center">
                <div className="h-4 w-4 rounded-full border-2 border-slate-400 bg-slate-900" />
                <span className="mt-1 text-[9px] text-slate-400">Power</span>
              </div>
            </div>
          </div>

          <div className="divide-y divide-[#1e3a5f]/70 border-t border-b border-[#1e3a5f]/70">
            {/* Status */}
            <div className="grid grid-cols-12 items-start py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                Status
              </div>
              <div className="col-span-8 space-y-0.5 text-white">
                <div className="flex items-center gap-3 font-semibold">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <Wifi className="h-3.5 w-3.5" />
                    {onu.phase_state === 'working' ? 'Online' : onu.phase_state}
                  </span>
                  <span>1h 33m</span>
                  <span>{distanceKm} km</span>
                  {livePolling && (
                    <span className="animate-pulse rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      LIVE POLLING
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400">
                  (Last status change: {onu.last_online_at || '10-Nov-2026 15:05:57'})
                </div>
              </div>
            </div>

            {/* Rx signal levels */}
            <div className="grid grid-cols-12 items-center py-2.5">
              <div className="col-span-4 font-semibold text-slate-300">
                Rx signal levels
              </div>
              <div className="col-span-8 grid grid-cols-2 gap-3">
                <div className="rounded border border-slate-700 bg-slate-950/90 p-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>ONU Rx 1490nm</span>
                    <Gauge className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-white">
                    {onu.onu_rx_dbm !== null ? `${onu.onu_rx_dbm} dBm` : 'N/A'}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-4/5 bg-emerald-500" />
                  </div>
                </div>

                <div className="rounded border border-slate-700 bg-slate-950/90 p-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>OLT Rx 1310nm</span>
                    <Gauge className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-white">
                    {onu.olt_rx_dbm !== null ? `${onu.olt_rx_dbm} dBm` : 'N/A'}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-3/5 bg-amber-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* Custom profile */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                Custom profile
              </div>
              <div className="col-span-8">
                <input
                  type="checkbox"
                  checked={customProfile}
                  onChange={(e) => setCustomProfile(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                />
              </div>
            </div>

            {/* Service-profile */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                Service-profile
              </div>
              <div className="col-span-8 flex items-center gap-3 text-white">
                <span>Default (ALL)</span>
                <button
                  type="button"
                  onClick={() => setShowUpdateModeModal(true)}
                  className="text-sky-400 hover:underline"
                >
                  Change
                </button>
              </div>
            </div>

            {/* TR069 Profile */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                TR069 Profile
              </div>
              <div className="col-span-8 flex flex-wrap items-center gap-2.5 text-white">
                <span className="inline-flex items-center gap-1 rounded bg-emerald-950/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 border border-emerald-600/40">
                  <Radio className="h-3 w-3" />
                  {tr069Profile?.profile_name || 'JETCYBER'} (
                  {onu.config_method === 'TR069' ? 'CWMP Active' : 'OMCI + ACS'}
                  )
                </span>
                <button
                  type="button"
                  onClick={() => setShowUpdateModeModal(true)}
                  className="text-sky-400 hover:underline"
                >
                  Configure
                </button>
                <button
                  type="button"
                  onClick={handleTr069Push}
                  className="text-emerald-400 hover:underline"
                >
                  Push CWMP
                </button>
              </div>
            </div>

            {/* Mgmt IP */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                Mgmt IP
              </div>
              <div className="col-span-8 flex items-center gap-3 text-white">
                <span className="font-mono">{onu.mgmt_ip || 'Inactive'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setMgmtIpInput(onu.mgmt_ip || '10.100.3.8');
                    setActiveEditDialog('MGMT_IP');
                  }}
                  className="text-sky-400 hover:underline"
                >
                  Configure
                </button>
              </div>
            </div>

            {/* Attached VLANs */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                Attached VLANs
              </div>
              <div className="col-span-8 flex items-center gap-3 text-white">
                <span className="font-mono font-bold">
                  {vlan?.vlan_id || 101}
                </span>
                <button
                  type="button"
                  onClick={() => setShowUpdateModeModal(true)}
                  className="text-sky-400 hover:underline"
                >
                  Configure
                </button>
              </div>
            </div>

            {/* ONU mode */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                ONU mode
              </div>
              <div className="col-span-8 flex items-center gap-3 text-white">
                <span>
                  {onu.onu_mode || 'Routing'} - WAN vlan: {vlan?.vlan_id || 101}
                </span>
                <button
                  type="button"
                  onClick={() => setShowUpdateModeModal(true)}
                  className="font-semibold text-sky-400 hover:underline"
                >
                  Update ONU mode
                </button>
              </div>
            </div>

            {/* WAN setup mode + WAN remote access */}
            <div className="grid grid-cols-12 items-start py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                WAN setup mode
              </div>
              <div className="col-span-8 space-y-1 text-white">
                <div className="flex items-center gap-3">
                  <span className="font-mono">
                    {onu.wan_mode === 'PPPOE' ? 'PPPoE' : onu.wan_mode} -{' '}
                    {onu.ip_address || '10.0.183.225'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowUpdateModeModal(true)}
                    className="text-sky-400 hover:underline"
                  >
                    Update
                  </button>
                </div>
                <div className="text-[11px] text-emerald-400">
                  WAN remote access: {onu.wan_remote_access}
                </div>
              </div>
            </div>

            {/* PPPoE username */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                PPPoE username
              </div>
              <div className="col-span-8 flex items-center gap-2 font-mono text-white">
                <span>
                  {showPppoeUser
                    ? onu.pppoe_username || 'RATMI-010111'
                    : '************'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowPppoeUser(!showPppoeUser)}
                  className="text-sky-400 hover:text-sky-300"
                >
                  {showPppoeUser ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* PPPoE password */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                PPPoE password
              </div>
              <div className="col-span-8 flex items-center gap-2 font-mono text-white">
                <span>
                  {showPppoePass ? onu.pppoe_password || 'jetcyber' : '********'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowPppoePass(!showPppoePass)}
                  className="text-sky-400 hover:text-sky-300"
                >
                  {showPppoePass ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* TV Signal (CATV) */}
            <div className="grid grid-cols-12 items-center py-2">
              <div className="col-span-4 font-semibold text-slate-300">
                TV Signal (CATV)
              </div>
              <div className="col-span-8 text-slate-400">Not supported</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleGetStatus}
            className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
          >
            Get status
          </button>
          <button
            type="button"
            onClick={handleShowRunningConfig}
            className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
          >
            Show running-config
          </button>
          <button
            type="button"
            onClick={handleSwInfo}
            className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
          >
            SW info
          </button>
          <button
            type="button"
            onClick={handleTr069Push}
            className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
          >
            TR-069
          </button>
          <button
            type="button"
            onClick={() => setLivePolling(!livePolling)}
            className={`rounded px-3 py-1.5 text-xs font-bold text-white ${
              livePolling
                ? 'animate-pulse bg-emerald-600'
                : 'bg-[#d9534f] hover:bg-[#c9302c]'
            }`}
          >
            {livePolling ? 'STOP LIVE!' : 'LIVE!'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUpdateModeModal(true)}
            className="flex items-center gap-1 rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
          >
            <Sliders className="h-3.5 w-3.5" />
            Update ONU mode
          </button>
          <button
            type="button"
            onClick={handleReboot}
            className="flex items-center gap-1 rounded bg-[#f0ad4e] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#ec971f]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reboot
          </button>
          <button
            type="button"
            onClick={handleResync}
            className="flex items-center gap-1 rounded bg-[#f0ad4e] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#ec971f]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Resync config
          </button>
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="rounded bg-[#f0ad4e] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#ec971f]"
          >
            Restore defaults
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1 rounded bg-[#d9534f] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#c9302c]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded border border-red-500 bg-red-950/80 px-2.5 py-1">
              <span className="text-[11px] font-bold text-red-200">Confirm?</span>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-[11px] text-slate-300"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Live CLI / TR-069 Output Drawer */}
      {activeConsoleOutput && (
        <div className="rounded-lg border border-sky-500/40 bg-slate-950 p-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span className="font-mono text-xs font-bold text-emerald-400">
                {activeConsoleOutput.title}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(activeConsoleOutput.content);
                  setCopiedCli(true);
                  setTimeout(() => setCopiedCli(false), 1800);
                }}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
              >
                {copiedCli ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copiedCli ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setActiveConsoleOutput(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="mt-3 max-h-60 overflow-x-auto overflow-y-auto font-mono text-[11px] leading-relaxed text-emerald-300">
            {activeConsoleOutput.content}
          </pre>
        </div>
      )}

      {/* Traffic history + Signal & Status history */}
      <div className="space-y-5 pt-2">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="font-bold text-white">Traffic history</span>
            <div className="flex items-center gap-1.5 text-xs">
              {(['Daily', 'Weekly', 'Monthly', 'Yearly'] as const).map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && <span className="text-slate-600">|</span>}
                  <button
                    type="button"
                    onClick={() => setTrafficPeriod(p)}
                    className={
                      trafficPeriod === p
                        ? 'font-bold text-white'
                        : 'text-sky-400 hover:underline'
                    }
                  >
                    {p}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-[#05080f] p-4">
            <div className="text-center font-mono text-xs font-bold text-slate-200">
              {onu.customer_name || 'RATMI'} (SN: {onu.serial_number}) -{' '}
              {trafficPeriod} Traffic
            </div>
            <div className="mt-3 flex h-32 items-end gap-1 border-b border-l border-slate-800 px-3 pb-1">
              {[
                12, 18, 25, 14, 22, 38, 45, 52, 40, 34, 48, 62, 58, 74, 82, 68,
                55, 64, 78, 86, 72, 60, 52, 66,
              ].map((val, idx) => (
                <div key={idx} className="flex flex-1 flex-col items-center gap-0.5">
                  <div
                    className="w-full rounded-t bg-emerald-500/80"
                    style={{ height: `${val}px` }}
                  />
                  <div
                    className="w-full rounded-b bg-sky-500/80"
                    style={{ height: `${Math.round(val * 0.35)}px` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between font-mono text-[11px] text-slate-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="h-2.5 w-2.5 bg-emerald-500" />
                  Download: Max 18.42 Mbps / Avg 6.18 Mbps
                </span>
                <span className="flex items-center gap-1.5 text-sky-400">
                  <span className="h-2.5 w-2.5 bg-sky-500" />
                  Upload: Max 6.20 Mbps / Avg 1.94 Mbps
                </span>
              </div>
              <span>Last 24 Hours (15-min SNMP IF-MIB Polling)</span>
            </div>
          </div>
        </div>

        {/* Signal & Status history */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="font-bold text-white">Signal & Status history</span>
            <div className="flex items-center gap-1.5 text-xs">
              {(['Weekly', 'Monthly', 'Yearly'] as const).map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && <span className="text-slate-600">|</span>}
                  <button
                    type="button"
                    onClick={() => setSignalPeriod(p)}
                    className={
                      signalPeriod === p
                        ? 'font-bold text-white'
                        : 'text-sky-400 hover:underline'
                    }
                  >
                    {p}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-[#05080f] p-4">
            <div className="text-center font-mono text-xs font-bold text-slate-200">
              {onu.customer_name || 'RATMI'} (SN: {onu.serial_number}) -{' '}
              {signalPeriod} Optical Power
            </div>
            <div className="mt-3 flex h-28 items-center justify-between border-b border-l border-slate-800 px-4">
              {Array.from({ length: 18 }, (_, idx) => (
                <div key={idx} className="flex flex-col items-center gap-4">
                  <div
                    className="h-2 w-2 rounded-full bg-emerald-400"
                    title={`ONU Rx: ${(onu.onu_rx_dbm ?? -23.19).toFixed(2)} dBm`}
                  />
                  <div
                    className="h-2 w-2 rounded-full bg-amber-400"
                    title={`OLT Rx: ${(onu.olt_rx_dbm ?? -30.87).toFixed(2)} dBm`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between font-mono text-[11px] text-slate-400">
              <div className="flex items-center gap-4">
                <span className="text-emerald-400">
                  ■ 1490 nm ONU Rx: {(onu.onu_rx_dbm ?? -23.19).toFixed(2)} dBm
                </span>
                <span className="text-amber-400">
                  ■ 1310 nm OLT Rx: {(onu.olt_rx_dbm ?? -30.87).toFixed(2)} dBm
                </span>
              </div>
              <span>Status: Working (No LOS in last 7 days)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Speed profiles Table + Ethernet ports Table + WiFi Section */}
      <div className="space-y-5 pt-2">
        {/* Speed profiles */}
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-sm font-bold text-white">Speed profiles</h3>
            <button
              type="button"
              onClick={() => {
                setSelectedSpeedId(onu.speed_profile_id || 1);
                setActiveEditDialog('SPEED_PROFILE');
              }}
              className="rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#025aa5]"
            >
              Add / Change
            </button>
          </div>
          <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1e3a5f] bg-[#142942] text-slate-300">
                <tr>
                  <th className="px-3 py-2">Service-port</th>
                  <th className="px-3 py-2">User VLAN</th>
                  <th className="px-3 py-2">Download</th>
                  <th className="px-3 py-2">Upload</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#1e3a5f]/50">
                  <td className="px-3 py-2 font-mono">1</td>
                  <td className="px-3 py-2 font-mono">{vlan?.vlan_id || 101}</td>
                  <td className="px-3 py-2 font-semibold text-white">
                    {speedProfile?.profile_name || '1G'}
                  </td>
                  <td className="px-3 py-2 font-semibold text-white">
                    {speedProfile?.profile_name || '1G'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSpeedId(onu.speed_profile_id || 1);
                        setActiveEditDialog('SPEED_PROFILE');
                      }}
                      className="text-sky-400 hover:underline"
                    >
                      Configure
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Ethernet ports (eth_0/1 .. eth_0/8) */}
        <div>
          <h3 className="mb-2 text-sm font-bold text-white">Ethernet ports</h3>
          <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1e3a5f] bg-[#142942] text-slate-300">
                <tr>
                  <th className="px-3 py-2">Port</th>
                  <th className="px-3 py-2">Admin state</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">DHCP</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3a5f]/50">
                {ethPorts.map((ep) => (
                  <tr key={ep.portIdx} className="hover:bg-[#132842]/60">
                    <td className="px-3 py-1.5 font-mono text-white">
                      eth_0/{ep.portIdx}
                    </td>
                    <td
                      className={`px-3 py-1.5 ${
                        ep.adminState === 'Unlocked'
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {ep.adminState}
                    </td>
                    <td className="px-3 py-1.5 text-slate-200">
                      {ep.mode === 'Tag VLAN'
                        ? `Tag VLAN ${ep.vlanId}`
                        : ep.mode}
                    </td>
                    <td className="px-3 py-1.5 text-slate-300">{ep.dhcpMode}</td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setConfiguringEthPort(ep)}
                        className="font-semibold text-sky-400 hover:underline"
                      >
                        Configure
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* WiFi Section */}
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <span className="text-sm font-bold text-white">WiFi</span>
          <button
            type="button"
            onClick={() => {
              setWifiSsidInput(onu.wifi_ssid || 'RATMI_JETCYBER');
              setWifiPassInput(onu.wifi_password || 'jetcyber');
              setActiveEditDialog('WIFI');
            }}
            className="rounded bg-[#0275d8] px-3 py-1 text-xs font-bold text-white hover:bg-[#025aa5]"
          >
            Enable / Configure WiFi
          </button>
          <span className="font-mono text-xs text-slate-400">
            SSID:{' '}
            <strong className="text-slate-200">
              {onu.wifi_ssid || 'RATMI_JETCYBER'}
            </strong>{' '}
            · WPA2 Passphrase:{' '}
            <strong className="text-slate-200">
              {onu.wifi_password || 'jetcyber'}
            </strong>
          </span>
        </div>
      </div>

      {/* ===================================================================
          MODAL: UPDATE ONU MODE (WAN VLAN, Routing/Bridging, PPPoE, WAN Remote Access, TR-069)
         =================================================================== */}
      {showUpdateModeModal && (
        <UpdateOnuModeModal
          onu={onu}
          db={db}
          onClose={() => setShowUpdateModeModal(false)}
          onConfirmUpdate={(onuId, updatedFields, generatedCli) => {
            onExecuteAction(onuId, 'UPDATE_ONU_MODE', generatedCli, updatedFields);
            setShowUpdateModeModal(false);
            setActiveConsoleOutput({
              title: `Update ONU mode & WAN remote access — ${onuInterface}`,
              content: generatedCli,
            });
          }}
        />
      )}

      {/* ===================================================================
          MODAL: CONFIGURE ETHERNET PORT (eth_0/1 .. eth_0/8)
         =================================================================== */}
      {configuringEthPort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Configure ONU Ethernet Port —{' '}
                <span className="font-mono text-sky-400">
                  eth_0/{configuringEthPort.portIdx}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setConfiguringEthPort(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEthPorts((prev) =>
                  prev.map((item) =>
                    item.portIdx === configuringEthPort.portIdx
                      ? configuringEthPort
                      : item
                  )
                );
                const cli = generateOnuEthPortCliScript({
                  ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
                  onuIndex: onu.onu_index || 8,
                  ethPort: `eth_0/${configuringEthPort.portIdx}`,
                  adminState: configuringEthPort.adminState,
                  mode: configuringEthPort.mode,
                  vlanId: configuringEthPort.vlanId,
                  dhcpMode: configuringEthPort.dhcpMode,
                });
                onExecuteAction(onu.id, 'RESYNC_CONFIG', cli);
                setActiveConsoleOutput({
                  title: `Configured Ethernet Port eth_0/${configuringEthPort.portIdx} — ${onuInterface}`,
                  content: cli,
                });
                setConfiguringEthPort(null);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-bold text-slate-200">
                  Admin State
                </label>
                <select
                  value={configuringEthPort.adminState}
                  onChange={(e) =>
                    setConfiguringEthPort({
                      ...configuringEthPort,
                      adminState: e.target.value as 'Unlocked' | 'Locked',
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                >
                  <option value="Unlocked">Unlocked (Active)</option>
                  <option value="Locked">Locked (Shutdown)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-200">
                  Port VLAN Mode
                </label>
                <select
                  value={configuringEthPort.mode}
                  onChange={(e) =>
                    setConfiguringEthPort({
                      ...configuringEthPort,
                      mode: e.target.value as 'LAN' | 'Tag VLAN' | 'Transparent',
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                >
                  <option value="LAN">LAN (Routed via ONU NAT)</option>
                  <option value="Tag VLAN">
                    Tag VLAN (Bridge Specific VLAN to this LAN port)
                  </option>
                  <option value="Transparent">Transparent</option>
                </select>
              </div>
              {configuringEthPort.mode === 'Tag VLAN' && (
                <div>
                  <label className="block font-bold text-slate-200">
                    VLAN ID for `eth_0/{configuringEthPort.portIdx}`
                  </label>
                  <select
                    value={configuringEthPort.vlanId}
                    onChange={(e) =>
                      setConfiguringEthPort({
                        ...configuringEthPort,
                        vlanId: Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                  >
                    {db.vlans.map((v) => (
                      <option key={v.id} value={v.vlan_id}>
                        {v.vlan_id} - {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block font-bold text-slate-200">
                  DHCP Server Source
                </label>
                <select
                  value={configuringEthPort.dhcpMode}
                  onChange={(e) =>
                    setConfiguringEthPort({
                      ...configuringEthPort,
                      dhcpMode: e.target.value as 'From ONU' | 'From Internet',
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                >
                  <option value="From ONU">From ONU (Internal LAN DHCP)</option>
                  <option value="From Internet">
                    From Internet (Core Router / Hotspot Gateway)
                  </option>
                </select>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setConfiguringEthPort(null)}
                  className="px-3 py-1.5 text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                >
                  Update Port eth_0/{configuringEthPort.portIdx}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL: MOVE ONU / METADATA / MGMT IP / SPEED PROFILE / WIFI
         =================================================================== */}
      {activeEditDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                {activeEditDialog === 'MOVE_ONU' && 'Move ONU to Another PON Port'}
                {activeEditDialog === 'METADATA' && 'Edit ONU Details (Zone, Splitter, Name)'}
                {activeEditDialog === 'MGMT_IP' && 'Configure ONU Management IP (VLAN 100 TR069)'}
                {activeEditDialog === 'SPEED_PROFILE' && 'Configure ONU Speed Profile'}
                {activeEditDialog === 'WIFI' && 'Configure ONU WiFi (OMCI / TR-069 CWMP)'}
              </h3>
              <button
                type="button"
                onClick={() => setActiveEditDialog(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeEditDialog === 'MOVE_ONU' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cli = `configure terminal\ninterface gpon-olt_1/${onu.board}/${onu.port}\n  no onu ${onu.onu_index || 8}\nexit\ninterface gpon-olt_1/${moveBoard}/${movePort}\n  onu ${moveIndex} type ${onu.onu_type} sn ${onu.serial_number}\nexit\nend\nwrite`;
                  onExecuteAction(onu.id, 'RESYNC_CONFIG', cli, {
                    board: moveBoard,
                    port: movePort,
                    onu_index: moveIndex,
                  });
                  setActiveConsoleOutput({
                    title: `Moved ONU ${onu.serial_number} to gpon-onu_1/${moveBoard}/${movePort}:${moveIndex}`,
                    content: cli,
                  });
                  setActiveEditDialog(null);
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block font-bold">Board</label>
                    <input
                      type="number"
                      value={moveBoard}
                      onChange={(e) => setMoveBoard(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-2.5 py-1.5 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold">Port</label>
                    <input
                      type="number"
                      value={movePort}
                      onChange={(e) => setMovePort(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-2.5 py-1.5 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold">ONU Index</label>
                    <input
                      type="number"
                      value={moveIndex}
                      onChange={(e) => setMoveIndex(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-2.5 py-1.5 font-mono text-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                  >
                    Move & Re-provision ONU
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'METADATA' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cli = `configure terminal\ninterface ${onuInterface}\n  name "${metaName}"\n  description "${metaAddress}"\nexit\nend\nwrite`;
                  onExecuteAction(onu.id, 'RESYNC_CONFIG', cli, {
                    customer_name: metaName.toUpperCase(),
                    address: metaAddress,
                    contact: metaContact,
                    external_id: metaExtId,
                    zone_id: metaZoneId,
                    odb_id: metaOdbId,
                    odb_port: metaOdbPort,
                  });
                  setActiveEditDialog(null);
                }}
                className="space-y-2.5"
              >
                <div>
                  <label className="block font-bold">Customer Name</label>
                  <input
                    type="text"
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold">Zone</label>
                  <select
                    value={metaZoneId}
                    onChange={(e) => setMetaZoneId(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                  >
                    {db.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold">Splitter (ODB)</label>
                    <select
                      value={metaOdbId}
                      onChange={(e) => setMetaOdbId(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                    >
                      {db.odbs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold">Splitter Port</label>
                    <input
                      type="number"
                      value={metaOdbPort}
                      onChange={(e) => setMetaOdbPort(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-bold">Address or comment</label>
                  <input
                    type="text"
                    value={metaAddress}
                    onChange={(e) => setMetaAddress(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold">Contact</label>
                  <input
                    type="text"
                    value={metaContact}
                    onChange={(e) => setMetaContact(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold">ONU External ID</label>
                  <input
                    type="text"
                    value={metaExtId}
                    onChange={(e) => setMetaExtId(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                  >
                    Save Metadata
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'MGMT_IP' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cli = `configure terminal\npon-onu-mng ${onuInterface}\n  mgmt-ip onu-ip ${mgmtIpInput} 255.255.0.0 7 mgmt-vlan ${mgmtVlanInput}\n  tr069-mgmt 1 state unlock\n  tr069-mgmt 1 tag pri 7 vlan ${mgmtVlanInput}\nexit\nend\nwrite`;
                  onExecuteAction(onu.id, 'RESYNC_CONFIG', cli, {
                    mgmt_ip: mgmtIpInput,
                  });
                  setActiveConsoleOutput({
                    title: `Configured Mgmt IP (${mgmtIpInput} on VLAN ${mgmtVlanInput})`,
                    content: cli,
                  });
                  setActiveEditDialog(null);
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block font-bold">
                    ONU Management IPv4 Address
                  </label>
                  <input
                    type="text"
                    value={mgmtIpInput}
                    onChange={(e) => setMgmtIpInput(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold">
                    Management / TR-069 VLAN
                  </label>
                  <input
                    type="number"
                    value={mgmtVlanInput}
                    onChange={(e) => setMgmtVlanInput(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                  >
                    Save Mgmt IP
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'SPEED_PROFILE' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const sp =
                    db.speed_profiles.find((s) => s.id === selectedSpeedId) ||
                    db.speed_profiles[0];
                  const cli = `configure terminal\ninterface ${onuInterface}\n  tcont 1 name TCONT-WAN profile TCONT-1G\n  gemport 1 traffic-limit upstream ${sp.profile_name} downstream ${sp.profile_name}\nexit\nend\nwrite`;
                  onExecuteAction(onu.id, 'RESYNC_CONFIG', cli, {
                    speed_profile_id: selectedSpeedId,
                  });
                  setActiveConsoleOutput({
                    title: `Updated ONU Speed Profile to ${sp.profile_name}`,
                    content: cli,
                  });
                  setActiveEditDialog(null);
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block font-bold">
                    Download / Upload Speed Profile
                  </label>
                  <select
                    value={selectedSpeedId}
                    onChange={(e) => setSelectedSpeedId(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    {db.speed_profiles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.profile_name} ({s.download_kbps / 1000} Mbps)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                  >
                    Apply Speed Profile
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'WIFI' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cli = `configure terminal\npon-onu-mng ${onuInterface}\n  wifi enable\n  wifi ssid 1 name "${wifiSsidInput}" auth wpa2-psk password "${wifiPassInput}"\nexit\nend\nwrite`;
                  onExecuteAction(onu.id, 'TR069_PUSH', cli, {
                    wifi_enabled: true,
                    wifi_ssid: wifiSsidInput,
                    wifi_password: wifiPassInput,
                  });
                  setActiveConsoleOutput({
                    title: `Provisioned ONU WiFi SSID "${wifiSsidInput}" via OMCI & TR-069`,
                    content: cli,
                  });
                  setActiveEditDialog(null);
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block font-bold">WiFi 2.4GHz / 5GHz SSID</label>
                  <input
                    type="text"
                    value={wifiSsidInput}
                    onChange={(e) => setWifiSsidInput(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold">WPA2/WPA3 Passphrase</label>
                  <input
                    type="text"
                    value={wifiPassInput}
                    onChange={(e) => setWifiPassInput(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                  >
                    Apply WiFi Settings
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
