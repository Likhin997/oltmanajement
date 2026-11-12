import React, { useState, useEffect } from 'react';
import { apiFetch as fetch } from '../services/authSession';
import {
  OnuRecord,
  SmartOltDatabaseState,
} from '../services/mockDatabase';
import {
  generateAuthorizeCliScript,
  generateUpdateOnuModeCliScript,
  generateUpdatePppoeCliScript,
  generateRebootCliScript,
  generateFactoryResetCliScript,
  generateDeleteOnuCliScript,
  generateTr069CwmpRpcPreview,
  generateOnuEthPortCliScript,
  parseZteOpticalAttenuation,
  parseZteOnuDetailInfo,
  parseZteWanIpOutput,
} from '../services/oltEngine';
import { UpdateOnuModeModal } from './UpdateOnuModeModal';
import { PrtgTrafficGraph } from './PrtgTrafficGraph';
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
  AlertTriangle,
  Power,
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
  ) => Promise<{
    ok: boolean;
    output: string;
    error?: string;
    durationMs?: number;
  }> | void;
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
      ip_address: '103.42.242.71',
      telnet_port: 2333,
      firmware_version: 'V2.1.0' as const,
    };
  const vlan =
    db.vlans.find((v) => v.id === onu.vlan_id || v.vlan_id === onu.vlan_id) ||
    db.vlans.find((v) => v.vlan_id === 101) ||
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
  const sector = (db.sectors || []).find((s) => s.id === onu.sector_id);
  const odb = db.odbs.find((o) => o.id === onu.odb_id);
  const tr069Profile =
    db.tr069_profiles.find((p) => p.id === onu.tr069_profile_id) ||
    db.tr069_profiles[0];

  const cleanPppoeUser =
    onu.pppoe_username &&
    onu.pppoe_username.trim().toLowerCase() !== 'zte' &&
    !onu.pppoe_username.includes('%')
      ? onu.pppoe_username.trim()
      : (onu.customer_name || onu.serial_number).toLowerCase();

  const cleanPppoePass =
    onu.pppoe_password &&
    !onu.pppoe_password.includes('%') &&
    !onu.pppoe_password.toLowerCase().includes('not strong')
      ? onu.pppoe_password.trim()
      : 'jetcyber';

  const [showPppoeUser, setShowPppoeUser] = useState(true);
  const [showPppoePass, setShowPppoePass] = useState(true);
  const [editingInlinePppoe, setEditingInlinePppoe] = useState(false);
  const [inlinePppoeUser, setInlinePppoeUser] = useState(cleanPppoeUser);
  const [inlinePppoePass, setInlinePppoePass] = useState(cleanPppoePass);
  const [isPushingToOlt, setIsPushingToOlt] = useState(false);
  const [showUpdateModeModal, setShowUpdateModeModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vipCustomer, setVipCustomer] = useState(false);
  const [customProfile, setCustomProfile] = useState(true);
  const [livePolling, setLivePolling] = useState(false);
  const [trafficPeriod, setTrafficPeriod] = useState<
    'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  >('Live2h');
  const [signalPeriod, setSignalPeriod] = useState<
    'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  >('Live2h');
  const [telemetryData, setTelemetryData] = useState<{
    polledAt: string;
    periods: Record<
      'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly',
      {
        period: 'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
        intervalLabel: string;
        points: Array<{
          timestampMs: number;
          label: string;
          shortLabel: string;
          totalMbps?: number;
          downloadMbps: number;
          uploadMbps: number;
          onuRxDbm: number | null;
          oltRxDbm: number | null;
          onuTxDbm: number | null;
          phaseState: string;
          sampleCount: number;
          isLive: boolean;
        }>;
        curTotalMbps?: number;
        maxTotalMbps?: number;
        minTotalMbps?: number;
        avgTotalMbps?: number;
        maxDownloadMbps: number;
        minDownloadMbps?: number;
        avgDownloadMbps: number;
        curDownloadMbps: number;
        maxUploadMbps: number;
        minUploadMbps?: number;
        avgUploadMbps: number;
        curUploadMbps: number;
        curOnuRxDbm: number | null;
        minOnuRxDbm: number | null;
        maxOnuRxDbm: number | null;
        avgOnuRxDbm: number | null;
        curOltRxDbm: number | null;
        minOltRxDbm: number | null;
        maxOltRxDbm: number | null;
        avgOltRxDbm: number | null;
        losEventsCount: number;
        powerFailEventsCount: number;
        statusSummaryText: string;
      }
    >;
  } | null>(null);
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

  const [metaName, setMetaName] = useState(onu.customer_name || onu.serial_number);
  const [metaSn, setMetaSn] = useState(onu.serial_number);
  const [metaAddress, setMetaAddress] = useState(onu.address || 'none');
  const [metaContact, setMetaContact] = useState(onu.contact || 'None');
  const [metaExtId, setMetaExtId] = useState(
    onu.external_id || onu.serial_number
  );
  const [metaZoneId, setMetaZoneId] = useState<number | 'NONE'>(
    onu.zone_id || 'NONE'
  );
  const [metaSectorId, setMetaSectorId] = useState<number | 'NONE'>(
    onu.sector_id || 'NONE'
  );
  const [metaOdbId, setMetaOdbId] = useState<number | 'NONE'>(
    onu.odb_id || 'NONE'
  );
  const [metaOdbPort, setMetaOdbPort] = useState<number | 'NONE'>(
    onu.odb_port || 'NONE'
  );
  const [metaPppoeUser, setMetaPppoeUser] = useState(cleanPppoeUser);
  const [metaPppoePass, setMetaPppoePass] = useState(cleanPppoePass);
  const [metaRebindAll, setMetaRebindAll] = useState<boolean>(false);

  // Keep inline PPPoE & metadata fields synced when `onu` prop updates
  useEffect(() => {
    setInlinePppoeUser(cleanPppoeUser);
    setInlinePppoePass(cleanPppoePass);
    setMetaName(onu.customer_name || onu.serial_number);
    setMetaSn(onu.serial_number);
    setMetaAddress(onu.address || 'none');
    setMetaContact(onu.contact || 'None');
    setMetaExtId(onu.external_id || onu.serial_number);
    setMetaZoneId(onu.zone_id || 'NONE');
    setMetaSectorId(onu.sector_id || 'NONE');
    setMetaOdbId(onu.odb_id || 'NONE');
    setMetaOdbPort(onu.odb_port || 'NONE');
    setMetaPppoeUser(cleanPppoeUser);
    setMetaPppoePass(cleanPppoePass);
  }, [onu, cleanPppoeUser, cleanPppoePass]);

  const openMetadataDialog = (rebindDefault = false) => {
    setMetaName(onu.customer_name || onu.serial_number);
    setMetaSn(onu.serial_number);
    setMetaAddress(onu.address || 'none');
    setMetaContact(onu.contact || 'None');
    setMetaExtId(onu.external_id || onu.serial_number);
    setMetaZoneId(onu.zone_id || 'NONE');
    setMetaSectorId(onu.sector_id || 'NONE');
    setMetaOdbId(onu.odb_id || 'NONE');
    setMetaOdbPort(onu.odb_port || 'NONE');
    setMetaPppoeUser(cleanPppoeUser);
    setMetaPppoePass(cleanPppoePass);
    setMetaRebindAll(rebindDefault);
    setActiveEditDialog('METADATA');
  };

  const [mgmtIpInput, setMgmtIpInput] = useState(
    onu.mgmt_ip || '10.100.3.8'
  );
  const [mgmtVlanInput, setMgmtVlanInput] = useState(100);
  const [selectedSpeedId, setSelectedSpeedId] = useState(
    onu.speed_profile_id || 1
  );
  const [wifiSsidInput, setWifiSsidInput] = useState(
    onu.wifi_ssid || `${onu.customer_name || 'JETCYBER'}_5G`
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

  // Helper that immediately pushes CLI changes to the OLT via Telnet and displays live output
  const executeAndDisplayLivePush = async (
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
    updatedFields?: Partial<OnuRecord>,
    actionTitle?: string
  ) => {
    const titleLabel = actionTitle || `${actionType} — ${onuInterface}`;
    setIsPushingToOlt(true);
    setActiveConsoleOutput({
      title: `⏳ Pushing to OLT (${olt.ip_address}:${olt.telnet_port}) — ${titleLabel}`,
      content: `[Connecting via Telnet to ${olt.ip_address}:${olt.telnet_port}...]\n\n--- Commands Queued ---\n${cliScript}`,
    });

    try {
      const result = await onExecuteAction(
        onu.id,
        actionType,
        cliScript,
        updatedFields
      );
      if (result && typeof result === 'object') {
        if (result.ok) {
          setActiveConsoleOutput({
            title: `✓ LIVE OLT PUSH SUCCESS (${result.durationMs || 0}ms) — ${titleLabel}`,
            content: `--- Executed CLI Script ---\n${cliScript}\n\n--- Live OLT Terminal Response (${olt.ip_address}:${olt.telnet_port}) ---\n${result.output || '[OK]'}`,
          });
        } else {
          setActiveConsoleOutput({
            title: `⚠ OLT Telnet Push Warning — ${titleLabel}`,
            content: `Error: ${result.error || 'Failed to push via Telnet'}\n\n--- CLI Script ---\n${cliScript}\n\n--- Partial Output ---\n${result.output || ''}`,
          });
        }
      }
    } finally {
      setIsPushingToOlt(false);
    }
  };

  const [onlineDuration, setOnlineDuration] = useState<string>('1h 33m');
  const [refreshingWanIp, setRefreshingWanIp] = useState<boolean>(false);

  const fetchStoredTelemetry = async () => {
    try {
      const resp = await fetch(`/api/onus/${onu.id}/telemetry`);
      const json = await resp.json();
      if (json && json.ok && json.periods) {
        setTelemetryData({
          polledAt: json.polledAt || new Date().toISOString(),
          periods: json.periods,
        });
      }
    } catch {
      // Ignore network error
    }
  };

  const pollLiveOnuStatusAndWanIp = async (showInConsole = false) => {
    const cliCommands = [
      `show interface ${onuInterface}`,
      `show gpon onu detail-info ${onuInterface}`,
      `show pon power attenuation ${onuInterface}`,
      `show gpon remote-onu ip-host ${onuInterface}`,
      `show gpon remote-onu pppoe ${onuInterface}`,
      `show gpon remote-onu wan-ip ${onuInterface}`,
    ];
    const cliJoined = cliCommands.slice(0, 5).join('\n');

    if (showInConsole) {
      setActiveConsoleOutput({
        title: `Get status & WAN IP — ${onuInterface} (Connecting to ${olt.ip_address}:${olt.telnet_port}...)`,
        content: `Executing on ${olt.name} (${olt.ip_address}:${olt.telnet_port}):\n${cliJoined}\n\nWaiting for OLT response...`,
      });
    }

    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oltId: olt.id,
          commands: cliCommands,
        }),
      });
      const data = await resp.json();
      if (data.ok && data.output) {
        const parsedDetail = parseZteOnuDetailInfo(data.output);
        const parsedPower = parseZteOpticalAttenuation(data.output);
        const parsedWan = parseZteWanIpOutput(data.output);

        // Record real-time traffic & optical signal sample and update Daily/Weekly/Monthly/Yearly charts
        try {
          const teleResp = await fetch(`/api/onus/${onu.id}/record-telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawOutput: data.output }),
          });
          const teleJson = await teleResp.json();
          if (teleJson && teleJson.ok && teleJson.periods) {
            setTelemetryData({
              polledAt: teleJson.polledAt || new Date().toISOString(),
              periods: teleJson.periods,
            });
          }
        } catch {
          // Ignore telemetry record error
        }

        const updatedFields: Partial<OnuRecord> = {};
        if (parsedDetail.phaseState) {
          updatedFields.phase_state = parsedDetail.phaseState;
        }
        if (parsedDetail.onlineDuration && parsedDetail.onlineDuration !== '0000h:00m:00s') {
          setOnlineDuration(parsedDetail.onlineDuration);
        }
        if (parsedDetail.distanceM !== null) {
          updatedFields.distance_m = parsedDetail.distanceM;
        }
        if (parsedDetail.lastAuthTime) {
          updatedFields.last_online_at = parsedDetail.lastAuthTime;
        }
        if (parsedDetail.lastOfflineReason) {
          updatedFields.last_offline_reason = parsedDetail.lastOfflineReason;
        }

        if (parsedDetail.phaseState === 'working') {
          if (parsedPower.onuRxDbm !== null) updatedFields.onu_rx_dbm = parsedPower.onuRxDbm;
          if (parsedPower.oltRxDbm !== null) updatedFields.olt_rx_dbm = parsedPower.oltRxDbm;
          if (parsedPower.onuTxDbm !== null) updatedFields.onu_tx_dbm = parsedPower.onuTxDbm;
        } else {
          updatedFields.onu_rx_dbm = null;
          updatedFields.olt_rx_dbm = null;
        }

        // Real PPPoE WAN IP assigned by MikroTik (from show gpon remote-onu ip-host / pppoe / wan-ip)
        if (parsedWan.currentIp) {
          updatedFields.ip_address = parsedWan.currentIp;
        }
        // Auto-repair if DB previously had corrupted Telnet banner strings ('zte' or '% The password...')
        if (
          !onu.pppoe_username ||
          onu.pppoe_username.trim().toLowerCase() === 'zte' ||
          onu.pppoe_username.includes('%')
        ) {
          updatedFields.pppoe_username = parsedWan.username || cleanPppoeUser;
        }
        if (
          !onu.pppoe_password ||
          onu.pppoe_password.includes('%') ||
          onu.pppoe_password.toLowerCase().includes('not strong')
        ) {
          updatedFields.pppoe_password = parsedWan.password || cleanPppoePass;
        }

        void onExecuteAction(onu.id, 'POLL_SIGNAL', cliJoined, updatedFields);
        if (showInConsole) {
          // Clean redundant `%Code 64040-GPONRM : No relate information to show.` from wan-ip when ip-host is used
          const cleanedConsole = data.output
            .replace(
              /[^\r\n]*show\s+gpon\s+remote-onu\s+wan-ip[^\r\n]*[\r\n]+\s*%Code\s+64040-GPONRM\s*:\s*No\s+relate\s+information\s+to\s+show\.?[\r\n]*/gi,
              ''
            )
            .trim();
          const summaryBanner = `\n\n--- [Ringkasan Real-Time OLT & WAN PPPoE MikroTik] ---\nPhase State : ${
            parsedDetail.phaseState || onu.phase_state
          }\nWAN PPPoE IP: ${
            parsedWan.currentIp || '0.0.0.0 (Belum terkoneksi PPPoE / Menunggu dial MikroTik)'
          }${parsedWan.gateway ? `\nWAN Gateway : ${parsedWan.gateway}` : ''}${
            parsedWan.macAddress ? `\nWAN MAC     : ${parsedWan.macAddress}` : ''
          }`;
          setActiveConsoleOutput({
            title: `Get status & Real WAN IP (LIVE OLT) — ${onuInterface}`,
            content: `${cleanedConsole || data.output}${summaryBanner}`,
          });
        }
        return;
      }
    } catch {
      // Fallback below if OLT is temporarily unreachable
    }

    if (showInConsole) {
      setActiveConsoleOutput({
        title: `Get status — ${onuInterface}`,
        content: `${olt.name}# show gpon onu detail-info ${onuInterface}
ONU interface:         ${onuInterface}
  Name:                ${onu.customer_name || onu.serial_number}
  Type:                ALL
  State:               ready
  Admin state:         enable
  Phase state:         ${onu.phase_state}
  Serial number:       ${onu.serial_number}
  ONU Distance:        ${onu.distance_m}m
  Online Duration:     ${onlineDuration}

${olt.name}# show gpon remote-onu ip-host ${onuInterface}
Host ID:               1
CurIP:                 ${onu.ip_address || '0.0.0.0'}
Username:              ${onu.pppoe_username || onu.customer_name || onu.serial_number}`,
      });
    }
  };

  // Automatically fetch real-time status, traffic, signal & MikroTik WAN IP when viewing this ONU
  useEffect(() => {
    void fetchStoredTelemetry();
    void pollLiveOnuStatusAndWanIp(false);
  }, [onu.id, onuInterface]);

  // Continuous real-time polling for Traffic & Signal History (5s when LIVE!, 15s default)
  useEffect(() => {
    const intervalMs = livePolling ? 5000 : 15000;
    const timer = setInterval(() => {
      void pollLiveOnuStatusAndWanIp(false);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [livePolling, onu.id, onuInterface]);

  const handleGetStatus = async () => {
    await pollLiveOnuStatusAndWanIp(true);
  };

  const handleRefreshWanIp = async () => {
    setRefreshingWanIp(true);
    try {
      await pollLiveOnuStatusAndWanIp(true);
    } finally {
      setRefreshingWanIp(false);
    }
  };

  const handleShowRunningConfig = async () => {
    const script = generateAuthorizeCliScript({
      firmwareVersion: olt.firmware_version,
      ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
      onuIndex: onu.onu_index || 1,
      serialNumber: onu.serial_number,
      onuType: 'ALL',
      customerName: onu.customer_name || onu.serial_number,
      address: onu.address || 'none',
      tcontProfile: tcontProfile?.profile_name || 'SMARTOLT-1G-UP',
      speedProfile: speedProfile?.profile_name || 'SMARTOLT-1G-DOWN',
      vlanId: vlan?.vlan_id || 101,
      onuMode: onu.onu_mode,
      wanMode: onu.wan_mode,
      configMethod: onu.config_method,
      wanRemoteAccess: onu.wan_remote_access,
      pppoeUsername: onu.pppoe_username || onu.customer_name || onu.serial_number,
      pppoePassword: onu.pppoe_password || 'jetcyber',
      tr069Enabled: onu.config_method === 'TR069',
      tr069AcsUrl: tr069Profile?.acs_url,
      tr069AcsUsername: tr069Profile?.acs_username,
      tr069AcsPassword: tr069Profile?.acs_password,
    });
    setActiveConsoleOutput({
      title: `Show running-config — ${onuInterface} (Fetching from OLT...)`,
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
    const acsUrl = tr069Profile?.acs_url || 'http://103.42.242.66:7547';
    const acsUser = tr069Profile?.acs_username || 'SmartOLT';
    const acsPass = tr069Profile?.acs_password || 'SmartOLT';
    const cli = [
      `configure terminal`,
      `interface ${onuInterface}`,
      `  tcont 2 profile SMARTOLT-VOIPMNG-10M`,
      `  gemport 2 tcont 2`,
      `  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M`,
      `  service-port 2 vport 2 user-vlan 100 vlan 100`,
      `exit`,
      `pon-onu-mng ${onuInterface}`,
      `  flow 2 pri 2 vlan 100`,
      `  gemport 2 flow 2`,
      `  switchport-bind switch_0/1 iphost 2`,
      `  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable`,
      `  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard`,
      `  vlan-filter iphost 2 pri 2 vlan 100`,
      `  tr069-mgmt 1 state unlock`,
      `  tr069-mgmt 1 acs ${acsUrl} validate basic username ${acsUser} password ${acsPass}`,
      `  tr069-mgmt 1 tag pri 2 vlan 100`,
      `exit`,
      `end`,
      `write`,
    ].join('\n');

    const rpcPreview = generateTr069CwmpRpcPreview({
      serialNumber: onu.serial_number,
      vlanId: vlan?.vlan_id || 101,
      onuMode: onu.onu_mode || 'Routing',
      wanMode: onu.wan_mode || 'PPPOE',
      pppoeUsername: onu.pppoe_username || onu.customer_name || onu.serial_number,
      pppoePassword: onu.pppoe_password || 'jetcyber',
      wanRemoteAccess:
        onu.wan_remote_access || 'Enabled from everywhere in the internet',
      acsUrl,
      periodicInterval: tr069Profile?.periodic_inform_interval || 300,
      wifiSsid: onu.wifi_ssid || undefined,
      wifiPassword: onu.wifi_password || undefined,
    });

    void executeAndDisplayLivePush(
      'TR069_PUSH',
      cli,
      {
        config_method: 'TR069',
        tr069_status: 'ACTIVE_INFORMING',
        tr069_last_inform: `${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')} WIB`,
      },
      `TR-069 CWMP & OMCI Push (${onu.serial_number})\n${rpcPreview}`
    );
  };

  const handleReboot = () => {
    const cli = generateRebootCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 1
    );
    void executeAndDisplayLivePush('REBOOT', cli, undefined, `Reboot ONU — ${onuInterface}`);
  };

  const handleResync = () => {
    const script = generateUpdateOnuModeCliScript({
      firmwareVersion: olt.firmware_version,
      ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
      onuIndex: onu.onu_index || 1,
      serialNumber: onu.serial_number,
      customerName: onu.customer_name || onu.pppoe_username || onu.serial_number,
      address: onu.address || 'none',
      rebindTypeAll: true,
      vlanId: vlan?.vlan_id || 101,
      onuMode: onu.onu_mode || 'Routing',
      wanMode: onu.wan_mode || 'PPPOE',
      configMethod: onu.config_method || 'OMCI',
      wanRemoteAccess:
        onu.wan_remote_access || 'Enabled from everywhere in the internet',
      pppoeUsername: onu.pppoe_username || onu.customer_name || onu.serial_number,
      pppoePassword: onu.pppoe_password || 'jetcyber',
      tr069AcsUrl: tr069Profile?.acs_url,
      tr069AcsUsername: tr069Profile?.acs_username,
      tr069AcsPassword: tr069Profile?.acs_password,
    });
    void executeAndDisplayLivePush(
      'RESYNC_CONFIG',
      script,
      {
        onu_type: 'ALL',
        phase_state: 'working',
      },
      `Full Resync Config (type ALL + PPPoE) — ${onuInterface}`
    );
  };

  const handleRestoreDefaults = () => {
    const cli = generateFactoryResetCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 1
    );
    void executeAndDisplayLivePush(
      'FACTORY_RESET',
      cli,
      undefined,
      `Restore defaults — ${onuInterface}`
    );
  };

  const handleDelete = () => {
    const cli = generateDeleteOnuCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 1
    );
    void executeAndDisplayLivePush('DELETE_ONU', cli, undefined, `Delete ONU — ${onuInterface}`);
  };

  const handleInlinePppoePush = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = inlinePppoeUser.trim().replace(/\s+/g, '-') || onu.serial_number;
    const cleanPass = inlinePppoePass.trim().replace(/\s+/g, '') || 'jetcyber';
    const cli = generateUpdatePppoeCliScript(
      `gpon-olt_1/${onu.board}/${onu.port}`,
      onu.onu_index || 1,
      vlan?.vlan_id || 101,
      cleanUser,
      cleanPass,
      onu.wan_remote_access || 'Enabled from everywhere in the internet'
    );
    setEditingInlinePppoe(false);
    void executeAndDisplayLivePush(
      'UPDATE_PPPOE',
      cli,
      {
        pppoe_username: cleanUser,
        pppoe_password: cleanPass,
      },
      `Push PPPoE (${cleanUser}) — ${onuInterface}`
    );
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
                onClick={() => openMetadataDialog(true)}
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
                  onClick={() => openMetadataDialog(true)}
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
              <span>{zone ? zone.name : 'None'}</span>
              <button
                type="button"
                onClick={() => openMetadataDialog(false)}
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
                {odb
                  ? `${odb.name}${onu.odb_port ? ` Port ${onu.odb_port}` : ''}`
                  : 'None'}
              </span>
              <button
                type="button"
                onClick={() => openMetadataDialog(false)}
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
              <span>{sector ? sector.name : 'None'}</span>
              <button
                type="button"
                onClick={() => openMetadataDialog(false)}
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
                onClick={() => openMetadataDialog(false)}
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
                onClick={() => openMetadataDialog(false)}
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
                onClick={() => openMetadataDialog(false)}
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
                onClick={() => openMetadataDialog(false)}
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
                onClick={() => openMetadataDialog(false)}
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
              <div
                className={`h-4 w-5 rounded-xs border-2 ${
                  onu.phase_state === 'working'
                    ? 'border-emerald-400 bg-emerald-500/80'
                    : onu.phase_state === 'LOS'
                      ? 'border-red-500 bg-red-600/80 animate-pulse'
                      : onu.phase_state === 'DyingGasp'
                        ? 'border-amber-400 bg-amber-500/80'
                        : 'border-slate-500 bg-slate-700'
                }`}
              />
              <span
                className={`mt-1 text-[9px] font-bold ${
                  onu.phase_state === 'working'
                    ? 'text-emerald-300'
                    : onu.phase_state === 'LOS'
                      ? 'text-red-400'
                      : onu.phase_state === 'DyingGasp'
                        ? 'text-amber-300'
                        : 'text-slate-400'
                }`}
              >
                PON
              </span>
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
                    idx === 0 && onu.phase_state === 'working'
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
              {isPushingToOlt && (
                <span className="animate-pulse rounded bg-sky-600 px-2 py-1 text-[10px] font-bold text-white">
                  Pushing to OLT...
                </span>
              )}
              <div className="flex flex-col items-center">
                <div
                  className={`h-4 w-4 rounded-full border-2 ${
                    onu.phase_state === 'DyingGasp'
                      ? 'border-red-500 bg-red-600/80 animate-pulse'
                      : onu.phase_state === 'working'
                        ? 'border-emerald-400 bg-emerald-500/80'
                        : 'border-slate-400 bg-slate-900'
                  }`}
                />
                <span
                  className={`mt-1 text-[9px] ${
                    onu.phase_state === 'DyingGasp'
                      ? 'font-bold text-red-400'
                      : 'text-slate-400'
                  }`}
                >
                  Power
                </span>
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
                <div className="flex flex-wrap items-center gap-3 font-semibold">
                  {onu.phase_state === 'working' ? (
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <Wifi className="h-3.5 w-3.5" />
                      Online
                    </span>
                  ) : onu.phase_state === 'DyingGasp' ? (
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <Power className="h-3.5 w-3.5" />
                      Power fail (DyingGasp)
                    </span>
                  ) : onu.phase_state === 'LOS' ? (
                    <span className="flex items-center gap-1.5 text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      LOS (Loss of Signal)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Offline ({onu.phase_state})
                    </span>
                  )}
                  <span>{onu.phase_state === 'working' ? onlineDuration : '0h 00m'}</span>
                  <span>{distanceKm} km</span>
                  {livePolling && (
                    <span className="animate-pulse rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      LIVE POLLING
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400">
                  (Last status change: {onu.last_online_at || 'Just now'}
                  {onu.last_offline_reason && onu.last_offline_reason !== 'None'
                    ? ` · Cause: ${onu.last_offline_reason}`
                    : ''}
                  )
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
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono">
                    {onu.wan_mode === 'PPPOE' ? 'PPPoE' : onu.wan_mode} -{' '}
                    {onu.ip_address && onu.ip_address !== '0.0.0.0' ? (
                      <span className="font-bold text-emerald-300">{onu.ip_address}</span>
                    ) : (
                      <span className="text-amber-300">0.0.0.0 (Waiting PPPoE / MikroTik IP)</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRefreshWanIp()}
                    className="flex items-center gap-1 rounded border border-sky-500/40 bg-sky-950/60 px-2 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-900"
                    title="Query show gpon remote-onu wan-ip on OLT to read real MikroTik PPPoE IP"
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshingWanIp ? 'animate-spin' : ''}`} />
                    Refresh IP
                  </button>
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

            {/* PPPoE username & password matching SmartOLT UI */}
            {!editingInlinePppoe ? (
              <>
                <div className="grid grid-cols-12 items-center py-2">
                  <div className="col-span-4 font-semibold text-slate-300">
                    PPPoE username
                  </div>
                  <div className="col-span-8 flex items-center gap-2 font-mono text-white">
                    <span>
                      {showPppoeUser ? cleanPppoeUser : '************'}
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

                <div className="grid grid-cols-12 items-center py-2">
                  <div className="col-span-4 font-semibold text-slate-300">
                    PPPoE password
                  </div>
                  <div className="col-span-8 flex items-center gap-2 font-mono text-white">
                    <span>
                      {showPppoePass ? cleanPppoePass : '********'}
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
              </>
            ) : (
              <form
                onSubmit={handleInlinePppoePush}
                className="space-y-2 bg-[#11243b]/80 p-3"
              >
                <div className="grid grid-cols-12 items-center gap-2">
                  <label className="col-span-4 font-semibold text-slate-200">
                    PPPoE username
                  </label>
                  <div className="col-span-8">
                    <input
                      type="text"
                      value={inlinePppoeUser}
                      onChange={(e) => setInlinePppoeUser(e.target.value)}
                      className="w-full rounded border border-sky-500/60 bg-slate-950 px-2.5 py-1 font-mono text-xs text-white"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-12 items-center gap-2">
                  <label className="col-span-4 font-semibold text-slate-200">
                    PPPoE password
                  </label>
                  <div className="col-span-8">
                    <input
                      type="text"
                      value={inlinePppoePass}
                      onChange={(e) => setInlinePppoePass(e.target.value)}
                      className="w-full rounded border border-sky-500/60 bg-slate-950 px-2.5 py-1 font-mono text-xs text-white"
                      required
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingInlinePppoe(false)}
                    className="rounded border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#43a047]"
                  >
                    Simpan & Push PPPoE ke OLT
                  </button>
                </div>
              </form>
            )}

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
        {(() => {
          const activeTraffic =
            telemetryData?.periods?.[trafficPeriod] ||
            telemetryData?.periods?.Daily;

          const activeSignal =
            telemetryData?.periods?.[signalPeriod] ||
            telemetryData?.periods?.Daily;
          const signalPoints = activeSignal?.points || [];

          const watermarkMap: Record<
            'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly',
            string
          > = {
            Live2h: 'Live Graph, 2 hours',
            Daily: 'Live Graph, 24 hours',
            Weekly: 'Weekly Graph, 7 days',
            Monthly: 'Monthly Graph, 30 days',
            Yearly: 'Yearly Graph, 12 months',
          };

          // Map dBm (-12 dBm top .. -35 dBm bottom) to percentage height (8% .. 90%)
          const dbmToTopPercent = (dbm: number | null, fallbackDbm: number) => {
            const v = dbm !== null && !isNaN(dbm) ? dbm : fallbackDbm;
            const clamped = Math.max(-35, Math.min(-12, v));
            return 10 + ((Math.abs(clamped) - 12) / (35 - 12)) * 78;
          };

          return (
            <>
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="font-bold text-white">Traffic history</span>
                  <div className="flex items-center gap-1.5 text-xs">
                    {(
                      [
                        { id: 'Live2h', label: '2 Hours (Live)' },
                        { id: 'Daily', label: 'Daily (24h)' },
                        { id: 'Weekly', label: 'Weekly' },
                        { id: 'Monthly', label: 'Monthly' },
                        { id: 'Yearly', label: 'Yearly' },
                      ] as const
                    ).map((p, i) => (
                      <React.Fragment key={p.id}>
                        {i > 0 && <span className="text-slate-600">|</span>}
                        <button
                          type="button"
                          onClick={() => setTrafficPeriod(p.id)}
                          className={
                            trafficPeriod === p.id
                              ? 'font-bold text-white'
                              : 'text-sky-400 hover:underline'
                          }
                        >
                          {p.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <PrtgTrafficGraph
                  breadcrumbPath={`JetCyber > Local Probe > ${
                    olt?.name || 'ZTE OLT'
                  } > gpon-onu_1/${onu.board}/${onu.port}:${
                    onu.onu_index || 1
                  } - ${onu.customer_name || onu.serial_number}`}
                  watermarkTitle={watermarkMap[trafficPeriod]}
                  series={activeTraffic}
                  sensorId={3000 + onu.id}
                  polledAtStr={telemetryData?.polledAt || 'Asia/Jakarta WIB'}
                  activePeriod={trafficPeriod}
                  onSelectPeriod={(p) => setTrafficPeriod(p)}
                />
              </div>

              {/* Signal & Status history */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="font-bold text-white">
                    Signal & Status history
                  </span>
                  <div className="flex items-center gap-1.5 text-xs">
                    {(
                      [
                        { id: 'Live2h', label: '2 Hours' },
                        { id: 'Daily', label: 'Daily (24h)' },
                        { id: 'Weekly', label: 'Weekly' },
                        { id: 'Monthly', label: 'Monthly' },
                        { id: 'Yearly', label: 'Yearly' },
                      ] as const
                    ).map((p, i) => (
                      <React.Fragment key={p.id}>
                        {i > 0 && <span className="text-slate-600">|</span>}
                        <button
                          type="button"
                          onClick={() => setSignalPeriod(p.id)}
                          className={
                            signalPeriod === p.id
                              ? 'font-bold text-white'
                              : 'text-sky-400 hover:underline'
                          }
                        >
                          {p.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-slate-800 bg-[#05080f] p-4">
                  <div className="text-center font-mono text-xs font-bold text-slate-200">
                    {onu.customer_name || onu.serial_number} (SN:{' '}
                    {onu.serial_number}) - {signalPeriod} Optical Power
                  </div>

                  <div className="relative mt-3 flex h-32 items-stretch justify-between border-b border-l border-slate-800 px-4">
                    {/* Reference dBm horizontal guide lines */}
                    <div className="pointer-events-none absolute inset-x-0 top-[25%] border-t border-dashed border-slate-800/70">
                      <span className="pl-1 font-mono text-[9px] text-slate-600">
                        -18 dBm
                      </span>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 top-[52%] border-t border-dashed border-slate-800/70">
                      <span className="pl-1 font-mono text-[9px] text-slate-600">
                        -24 dBm
                      </span>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 top-[76%] border-t border-dashed border-rose-950/60">
                      <span className="pl-1 font-mono text-[9px] text-rose-500/50">
                        -30 dBm
                      </span>
                    </div>

                    {signalPoints.map((pt, idx) => {
                      const hasRealOnuRx =
                        pt.onuRxDbm !== null && pt.onuRxDbm !== undefined;
                      const hasRealOltRx =
                        pt.oltRxDbm !== null && pt.oltRxDbm !== undefined;
                      const onuTop = hasRealOnuRx
                        ? dbmToTopPercent(pt.onuRxDbm, -21.85)
                        : null;
                      const oltTop = hasRealOltRx
                        ? dbmToTopPercent(pt.oltRxDbm, -25.4)
                        : null;
                      const isLos = pt.phaseState === 'LOS' && pt.sampleCount > 0;
                      const isPwr =
                        pt.phaseState === 'DyingGasp' && pt.sampleCount > 0;
                      return (
                        <div
                          key={idx}
                          title={`${pt.label}\n1490nm ONU Rx: ${
                            hasRealOnuRx ? `${pt.onuRxDbm!.toFixed(2)} dBm` : 'Belum ada sampel pada slot waktu ini'
                          }\n1310nm OLT Rx: ${
                            hasRealOltRx ? `${pt.oltRxDbm!.toFixed(2)} dBm` : 'Belum ada sampel pada slot waktu ini'
                          }\nStatus: ${pt.phaseState}`}
                          className="group relative flex flex-1 flex-col items-center"
                        >
                          {!isLos && onuTop !== null && (
                            <div
                              className={`absolute h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform group-hover:scale-125 ${
                                pt.isLive
                                  ? 'bg-emerald-300 ring-2 ring-emerald-400/60'
                                  : 'bg-emerald-400'
                              }`}
                              style={{ top: `${onuTop}%` }}
                            />
                          )}
                          {!isLos && oltTop !== null && (
                            <div
                              className={`absolute h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform group-hover:scale-125 ${
                                pt.isLive
                                  ? 'bg-amber-300 ring-2 ring-amber-400/60'
                                  : 'bg-amber-400'
                              }`}
                              style={{ top: `${oltTop}%` }}
                            />
                          )}
                          {/* Bottom status indicator dot for LOS / Power Fail / Working */}
                          <div
                            className={`mt-auto mb-1 h-1.5 w-3 rounded-sm ${
                              isLos
                                ? 'bg-rose-500'
                                : isPwr
                                ? 'bg-amber-500'
                                : hasRealOnuRx || pt.isLive
                                ? 'bg-emerald-500/50'
                                : 'bg-slate-800/40'
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* X-axis period labels */}
                  {signalPoints.length > 0 && (
                    <div className="mt-1 flex items-center justify-between px-4 font-mono text-[10px] text-slate-500">
                      {signalPoints.map((pt, idx) => (
                        <span
                          key={idx}
                          className="flex-1 text-center truncate"
                        >
                          {pt.shortLabel}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center justify-between font-mono text-[11px] text-slate-400">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="text-emerald-400">
                        ■ 1490 nm ONU Rx:{' '}
                        {(
                          activeSignal?.curOnuRxDbm ??
                          onu.onu_rx_dbm ??
                          -21.85
                        ).toFixed(2)}{' '}
                        dBm
                        {activeSignal?.avgOnuRxDbm !== null &&
                          activeSignal?.avgOnuRxDbm !== undefined && (
                            <span className="text-slate-400">
                              {' '}
                              (Avg {activeSignal.avgOnuRxDbm.toFixed(2)} dBm)
                            </span>
                          )}
                      </span>
                      <span className="text-amber-400">
                        ■ 1310 nm OLT Rx:{' '}
                        {(
                          activeSignal?.curOltRxDbm ??
                          onu.olt_rx_dbm ??
                          -25.4
                        ).toFixed(2)}{' '}
                        dBm
                        {activeSignal?.avgOltRxDbm !== null &&
                          activeSignal?.avgOltRxDbm !== undefined && (
                            <span className="text-slate-400">
                              {' '}
                              (Avg {activeSignal.avgOltRxDbm.toFixed(2)} dBm)
                            </span>
                          )}
                      </span>
                    </div>
                    <span>
                      {activeSignal?.statusSummaryText ||
                        `Status: ${onu.phase_state === 'working' ? 'Working' : onu.phase_state}`}
                    </span>
                  </div>
                </div>
              </div>
            </>
          );
        })()}
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
                    {speedProfile?.profile_name || 'SMARTOLT-1G-DOWN'}
                  </td>
                  <td className="px-3 py-2 font-semibold text-white">
                    {speedProfile?.profile_name || 'SMARTOLT-1G-UP'}
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
            setShowUpdateModeModal(false);
            void executeAndDisplayLivePush(
              'UPDATE_ONU_MODE',
              generatedCli,
              updatedFields,
              `Update ONU mode & PPPoE — ${onuInterface}`
            );
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
                  onuIndex: onu.onu_index || 1,
                  ethPort: `eth_0/${configuringEthPort.portIdx}`,
                  adminState: configuringEthPort.adminState,
                  mode: configuringEthPort.mode,
                  vlanId: configuringEthPort.vlanId,
                  dhcpMode: configuringEthPort.dhcpMode,
                });
                const portIdx = configuringEthPort.portIdx;
                setConfiguringEthPort(null);
                void executeAndDisplayLivePush(
                  'RESYNC_CONFIG',
                  cli,
                  undefined,
                  `Configure Ethernet Port eth_0/${portIdx} — ${onuInterface}`
                );
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
                  Update & Push Port eth_0/{configuringEthPort.portIdx}
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
                {activeEditDialog === 'METADATA' && 'Edit & Push ONU Details (Name, SN, PPPoE, Zone)'}
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
                  const reAuthCli = generateAuthorizeCliScript({
                    firmwareVersion: olt.firmware_version,
                    ponInterface: `gpon-olt_1/${moveBoard}/${movePort}`,
                    onuIndex: moveIndex,
                    onuType: 'ALL',
                    serialNumber: onu.serial_number,
                    customerName: onu.customer_name || onu.serial_number,
                    address: onu.address || 'none',
                    tcontProfile: tcontProfile?.profile_name || 'SMARTOLT-1G-UP',
                    speedProfile:
                      speedProfile?.profile_name || 'SMARTOLT-1G-DOWN',
                    vlanId: vlan?.vlan_id || 101,
                    onuMode: onu.onu_mode || 'Routing',
                    wanMode: onu.wan_mode || 'PPPOE',
                    configMethod: onu.config_method || 'OMCI',
                    wanRemoteAccess:
                      onu.wan_remote_access ||
                      'Enabled from everywhere in the internet',
                    pppoeUsername:
                      onu.pppoe_username ||
                      onu.customer_name ||
                      onu.serial_number,
                    pppoePassword: onu.pppoe_password || 'jetcyber',
                  });
                  const cli = [
                    'configure terminal',
                    `interface gpon-olt_1/${onu.board}/${onu.port}`,
                    `  no onu ${onu.onu_index || 1}`,
                    'exit',
                    'end',
                    reAuthCli,
                  ].join('\n');
                  setActiveEditDialog(null);
                  void executeAndDisplayLivePush(
                    'RESYNC_CONFIG',
                    cli,
                    {
                      board: moveBoard,
                      port: movePort,
                      onu_index: moveIndex,
                    },
                    `Move & Re-provision ONU ${onu.serial_number} -> gpon-onu_1/${moveBoard}/${movePort}:${moveIndex}`
                  );
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
                    Move & Push to OLT
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'METADATA' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cleanName =
                    metaName.trim().toUpperCase().replace(/\s+/g, '-') ||
                    metaSn.trim().toUpperCase();
                  const cleanSn =
                    metaSn.trim().toUpperCase() || onu.serial_number;
                  const cleanPppoeUser =
                    metaPppoeUser.trim().replace(/\s+/g, '-') || cleanName;
                  const cleanPppoePass =
                    metaPppoePass.trim().replace(/\s+/g, '') || 'jetcyber';
                  const rebindSnOrType =
                    metaRebindAll || cleanSn !== onu.serial_number;

                  const cli = generateUpdateOnuModeCliScript({
                    firmwareVersion: olt.firmware_version,
                    ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
                    onuIndex: onu.onu_index || 1,
                    serialNumber: cleanSn,
                    customerName: cleanName,
                    address: metaAddress.trim() || 'none',
                    rebindTypeAll: rebindSnOrType,
                    vlanId: vlan?.vlan_id || 101,
                    onuMode: onu.onu_mode || 'Routing',
                    wanMode: onu.wan_mode || 'PPPOE',
                    configMethod: onu.config_method || 'OMCI',
                    wanRemoteAccess:
                      onu.wan_remote_access ||
                      'Enabled from everywhere in the internet',
                    pppoeUsername: cleanPppoeUser,
                    pppoePassword: cleanPppoePass,
                  });

                  setActiveEditDialog(null);
                  void executeAndDisplayLivePush(
                    'UPDATE_ONU_MODE',
                    cli,
                    {
                      customer_name: cleanName,
                      serial_number: cleanSn,
                      onu_type: 'ALL',
                      pppoe_username: cleanPppoeUser,
                      pppoe_password: cleanPppoePass,
                      address: metaAddress,
                      contact: metaContact,
                      external_id: metaExtId || cleanSn,
                      zone_id: metaZoneId === 'NONE' ? null : metaZoneId,
                      sector_id: metaSectorId === 'NONE' ? null : metaSectorId,
                      odb_id: metaOdbId === 'NONE' ? null : metaOdbId,
                      odb_port: metaOdbPort === 'NONE' ? null : metaOdbPort,
                    },
                    `Save & Push ONU Config (${cleanName}) — ${onuInterface}`
                  );
                }}
                className="space-y-2.5"
              >
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold">Customer Name</label>
                    <input
                      type="text"
                      value={metaName}
                      onChange={(e) => setMetaName(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold">Serial Number (SN)</label>
                    <input
                      type="text"
                      value={metaSn}
                      onChange={(e) => setMetaSn(e.target.value.toUpperCase())}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-emerald-300">
                      PPPoE Username
                    </label>
                    <input
                      type="text"
                      value={metaPppoeUser}
                      onChange={(e) => setMetaPppoeUser(e.target.value)}
                      className="mt-1 w-full rounded border border-emerald-600/60 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-emerald-300">
                      PPPoE Password
                    </label>
                    <input
                      type="text"
                      value={metaPppoePass}
                      onChange={(e) => setMetaPppoePass(e.target.value)}
                      className="mt-1 w-full rounded border border-emerald-600/60 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold">Zone</label>
                    <select
                      value={metaZoneId}
                      onChange={(e) =>
                        setMetaZoneId(
                          e.target.value === 'NONE'
                            ? 'NONE'
                            : Number(e.target.value)
                        )
                      }
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                    >
                      <option value="NONE">None</option>
                      {db.zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold">Sector</label>
                    <select
                      value={metaSectorId}
                      onChange={(e) =>
                        setMetaSectorId(
                          e.target.value === 'NONE'
                            ? 'NONE'
                            : Number(e.target.value)
                        )
                      }
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                    >
                      <option value="NONE">None</option>
                      {(db.sectors || []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold">Splitter (ODB/ODP)</label>
                    <select
                      value={metaOdbId}
                      onChange={(e) =>
                        setMetaOdbId(
                          e.target.value === 'NONE'
                            ? 'NONE'
                            : Number(e.target.value)
                        )
                      }
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                    >
                      <option value="NONE">None</option>
                      {db.odbs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.splitter_ratio})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold">Splitter Port</label>
                    <select
                      value={metaOdbPort}
                      onChange={(e) =>
                        setMetaOdbPort(
                          e.target.value === 'NONE'
                            ? 'NONE'
                            : Number(e.target.value)
                        )
                      }
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                    >
                      <option value="NONE">None</option>
                      {Array.from(
                        {
                          length:
                            db.odbs.find((o) => o.id === metaOdbId)?.total_ports ||
                            16,
                        },
                        (_, idx) => idx + 1
                      ).map((p) => (
                        <option key={p} value={p}>
                          Port {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={metaRebindAll}
                      onChange={(e) => setMetaRebindAll(e.target.checked)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span>Re-register ONU as type ALL on OLT</span>
                  </label>
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
                <div className="grid grid-cols-2 gap-2">
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
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveEditDialog(null)}
                    className="px-3 py-1.5 text-slate-300 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white hover:bg-[#43a047]"
                  >
                    Save & Push to OLT
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'MGMT_IP' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cli = `configure terminal\npon-onu-mng ${onuInterface}\n  mgmt-ip onu-ip ${mgmtIpInput} 255.255.0.0 7 mgmt-vlan ${mgmtVlanInput}\n  tr069-mgmt 1 state unlock\n  tr069-mgmt 1 tag pri 7 vlan ${mgmtVlanInput}\nexit\nend\nwrite`;
                  setActiveEditDialog(null);
                  void executeAndDisplayLivePush(
                    'RESYNC_CONFIG',
                    cli,
                    {
                      mgmt_ip: mgmtIpInput,
                    },
                    `Configure Mgmt IP (${mgmtIpInput} on VLAN ${mgmtVlanInput}) — ${onuInterface}`
                  );
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
                    Save & Push Mgmt IP
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
                  const downName = sp?.profile_name || 'SMARTOLT-1G-DOWN';
                  const upName = downName.includes('-DOWN')
                    ? downName.replace('-DOWN', '-UP')
                    : 'SMARTOLT-1G-UP';
                  const cli = [
                    'configure terminal',
                    `interface ${onuInterface}`,
                    `  tcont 1 profile ${upName}`,
                    '  gemport 1 tcont 1',
                    `  gemport 1 traffic-limit downstream ${downName}`,
                    'exit',
                    'end',
                    'write',
                  ].join('\n');
                  setActiveEditDialog(null);
                  void executeAndDisplayLivePush(
                    'RESYNC_CONFIG',
                    cli,
                    {
                      speed_profile_id: selectedSpeedId,
                    },
                    `Update Speed Profile (${downName}) — ${onuInterface}`
                  );
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
                    Apply & Push Speed Profile
                  </button>
                </div>
              </form>
            )}

            {activeEditDialog === 'WIFI' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cleanSsid = wifiSsidInput.trim().replace(/\s+/g, '_');
                  const cleanPass = wifiPassInput.trim().replace(/\s+/g, '');
                  const cliLines = [
                    'configure terminal',
                    `pon-onu-mng ${onuInterface}`,
                    '  wifi enable',
                    `  ssid ctrl wifi_0/1 name ${cleanSsid}`,
                  ];
                  if (cleanPass && cleanPass.length >= 8) {
                    cliLines.push(
                      `  ssid auth wpa wifi_0/1 wpa2-psk encrypt aes key ${cleanPass}`
                    );
                  } else if (cleanPass) {
                    cliLines.push(
                      `  ssid auth wpa wifi_0/1 wpa2-psk encrypt aes key ${cleanPass}`
                    );
                  } else {
                    cliLines.push(`  ssid auth wep wifi_0/1 open-system`);
                  }
                  cliLines.push('exit', 'end', 'write');
                  const cli = cliLines.join('\n');
                  setActiveEditDialog(null);
                  void executeAndDisplayLivePush(
                    'TR069_PUSH',
                    cli,
                    {
                      wifi_enabled: true,
                      wifi_ssid: cleanSsid,
                      wifi_password: cleanPass,
                    },
                    `Push ONU WiFi SSID (${cleanSsid}) — ${onuInterface}`
                  );
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
                    Apply & Push WiFi Settings
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
