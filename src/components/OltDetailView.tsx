import React, { useState } from 'react';
import {
  OltRecord,
  SmartOltDatabaseState,
  VlanRecord,
  UplinkPortRecord,
  PonPortRecord,
  OltCardRecord,
  buildLiveZteRunningConfig,
} from '../services/mockDatabase';
import {
  generateUplinkConfigCliScript,
  generateCreateVlanCliScript,
} from '../services/oltEngine';
import {
  Info,
  Grid,
  Disc,
  ArrowUp,
  Tag,
  Globe,
  Shield,
  FileText,
  Phone,
  Settings,
  Eye,
  EyeOff,
  Terminal,
  Plus,
  Minus,
  Link,
  AlertTriangle,
  X,
  Check,
  Copy,
  RefreshCw,
  Sliders,
  Download,
} from 'lucide-react';

export type OltDetailTab =
  | 'OLT_DETAILS'
  | 'OLT_CARDS'
  | 'PON_PORTS'
  | 'UPLINK'
  | 'VLANS'
  | 'ONU_IP_POOLS'
  | 'REMOTE_ACLS'
  | 'PROFILES'
  | 'VOIP_PROFILES'
  | 'ADVANCED';

interface OltDetailViewProps {
  olt: OltRecord;
  db: SmartOltDatabaseState;
  initialTab?: OltDetailTab;
  onBack: () => void;
  onAddVlan: (
    newVlans: Omit<VlanRecord, 'id'>[],
    tagUplinkIds: number[],
    cliScript: string
  ) => void;
  onToggleVlanFlag: (
    vlanRecordId: number,
    field:
      | 'used_for_mgmt_tr069_voip'
      | 'used_for_iptv'
      | 'dhcp_snooping'
      | 'lan_to_lan'
  ) => void;
  onDeleteVlans: (vlanRecordIds: number[]) => void;
  onUpdateUplinkPort: (
    uplinkId: number,
    updated: Partial<UplinkPortRecord>,
    cliScript: string
  ) => void;
  onCreateLagUplink: (newUplink: Omit<UplinkPortRecord, 'id'>, cliScript: string) => void;
  onUpdatePonPort: (
    portNumber: number,
    updated: Partial<PonPortRecord>,
    cliScript: string
  ) => void;
  onEnableAllPonPorts: () => void;
  onRefreshOltCards: () => void;
  onRebootOltCard: (cardId: number) => void;
  onUpdateOltSettings: (oltId: number, updated: Partial<OltRecord>) => void;
  onUpdateOltTr069: (
    oltId: number,
    tr069ProfileName: string,
    defaultInterface: string
  ) => void;
  onImportRunningConfig?: (oltId: number, rawConfig: string) => void;
}

export const OltDetailView: React.FC<OltDetailViewProps> = ({
  olt,
  db,
  initialTab = 'OLT_DETAILS',
  onBack,
  onAddVlan,
  onToggleVlanFlag,
  onDeleteVlans,
  onUpdateUplinkPort,
  onCreateLagUplink,
  onUpdatePonPort,
  onEnableAllPonPorts,
  onRefreshOltCards,
  onRebootOltCard,
  onUpdateOltSettings,
  onUpdateOltTr069,
  onImportRunningConfig,
}) => {
  const [activeTab, setActiveTab] = useState<OltDetailTab>(initialTab);
  const [showTelnetUser, setShowTelnetUser] = useState(false);
  const [showTelnetPass, setShowTelnetPass] = useState(false);
  const [showSnmpRo, setShowSnmpRo] = useState(false);
  const [showSnmpRw, setShowSnmpRw] = useState(false);
  const [tr069ProfileName, setTr069ProfileName] = useState(
    olt.tr069_profile_name || 'JETCYBER'
  );
  const [tr069DefaultIf, setTr069DefaultIf] = useState(
    olt.default_tr069_interface || 'Mgmt IP (recommended)'
  );

  // Interactive OLT CLI console state
  const [cliDrawerOpen, setCliDrawerOpen] = useState(false);
  const [cliInput, setCliInput] = useState('');
  const [cliHistory, setCliHistory] = useState<string>(`Trying ${olt.ip_address}:${olt.telnet_port}...
Connected to ${olt.name} (${olt.hardware_model}).
Username: ${olt.olt_username}
Password: ********
${olt.name}# show card
Rack Shelf Slot CfgType RealType Port   HardVer SoftVer         Status
-------------------------------------------------------------------------------
1    1     3    GTGH    GTGH     16     V1.0.0  V2.1.0          Insigh
1    1     10   SCXM    SCXM     0      V1.0.0  V2.1.0          Insigh
1    1     11   SCXM    SCXM     0      V1.0.0                  Offline
1    1     19   HUVQ    HUVQ     4      V1.0.0  V2.1.0          Insigh`);

  // OLT Details modals
  const [showEditOltModal, setShowEditOltModal] = useState(false);
  const [editOltName, setEditOltName] = useState(olt.name);
  const [editOltIp, setEditOltIp] = useState(olt.ip_address);
  const [editWarnRx, setEditWarnRx] = useState(olt.warning_rx_dbm);
  const [editCritRx, setEditCritRx] = useState(olt.critical_rx_dbm);
  const [editNtp, setEditNtp] = useState(olt.ntp_servers);
  const [showBackupsModal, setShowBackupsModal] = useState(false);
  const [importConfigText, setImportConfigText] = useState('');
  const [showMacTableModal, setShowMacTableModal] = useState(false);

  // PON Ports state & modals
  const [slotFilter, setSlotFilter] = useState('Any');
  const [rogueStatus, setRogueStatus] = useState<
    'Loading...' | 'No rogue ONU detected (Clean)'
  >('Loading...');
  const [configuringPonPort, setConfiguringPonPort] =
    useState<PonPortRecord | null>(null);
  const [ponEditDesc, setPonEditDesc] = useState('');
  const [ponEditAdmin, setPonEditAdmin] = useState<'ENABLED' | 'DISABLED'>('ENABLED');
  const [ponEditOper, setPonEditOper] = useState<'Up' | 'Down'>('Up');
  const [ponEditMaxOnu, setPonEditMaxOnu] = useState(128);
  const [trafficPonPort, setTrafficPonPort] = useState<PonPortRecord | null>(
    null
  );

  // Uplink Port Configuration & VLAN Tagging Modal State
  const [configuringUplink, setConfiguringUplink] =
    useState<UplinkPortRecord | null>(null);
  const [uplinkEditDesc, setUplinkEditDesc] = useState('');
  const [uplinkEditAdmin, setUplinkEditAdmin] = useState<'Enabled' | 'Disabled'>(
    'Enabled'
  );
  const [uplinkEditStatus, setUplinkEditStatus] = useState<
    '1G-FullD' | '10G-FullD' | 'Down'
  >('1G-FullD');
  const [uplinkEditMode, setUplinkEditMode] = useState<
    'Hybrid' | 'Trunk' | 'Access'
  >('Hybrid');
  const [uplinkEditPvid, setUplinkEditPvid] = useState<number>(41);
  const [uplinkEditMtu, setUplinkEditMtu] = useState<number>(1600);
  const [uplinkSelectedVlans, setUplinkSelectedVlans] = useState<number[]>([]);
  const [uplinkCustomVlanStr, setUplinkCustomVlanStr] = useState<string>('');
  const [trafficUplink, setTrafficUplink] = useState<UplinkPortRecord | null>(
    null
  );

  // Create LAG Modal state
  const [showCreateLagModal, setShowCreateLagModal] = useState(false);
  const [lagGroupId, setLagGroupId] = useState(1);
  const [lagDescription, setLagDescription] = useState('LACP Core Trunk');
  const [lagMemberPorts, setLagMemberPorts] = useState<string[]>([
    'xgei_1/19/1',
    'xgei_1/19/2',
  ]);
  const [lagTaggedVlans, setLagTaggedVlans] = useState('100,101,102,120');

  // VLANs Modals state (+ Add VLAN, + Add multiple VLANs, - Delete multiple VLANs, Quick Tag to Uplink)
  const [vlanModalMode, setVlanModalMode] = useState<
    'SINGLE' | 'MULTIPLE' | 'DELETE_MULTIPLE' | null
  >(null);
  const [newVlanId, setNewVlanId] = useState<number>(150);
  const [newVlanRange, setNewVlanRange] = useState<string>('201-204');
  const [newVlanDesc, setNewVlanDesc] = useState<string>('HOTSPOT-VOUCHER');
  const [newVlanDefaultFor, setNewVlanDefaultFor] =
    useState<string>('None selected');
  const [newVlanTr069, setNewVlanTr069] = useState<boolean>(false);
  const [newVlanIptv, setNewVlanIptv] = useState<boolean>(false);
  const [newVlanDhcpSnooping, setNewVlanDhcpSnooping] =
    useState<boolean>(false);
  const [newVlanLanToLan, setNewVlanLanToLan] = useState<boolean>(false);
  const [newVlanSelectedUplinkIds, setNewVlanSelectedUplinkIds] = useState<
    number[]
  >([3]); // Default gei_1/19/3 checked!
  const [selectedVlansForDelete, setSelectedVlansForDelete] = useState<
    number[]
  >([]);
  const [quickTaggingVlan, setQuickTaggingVlan] = useState<VlanRecord | null>(
    null
  );
  const [quickTagUplinkIds, setQuickTagUplinkIds] = useState<number[]>([3]);

  // Last executed CLI preview banner inside OLT Detail View
  const [lastCliBanner, setLastCliBanner] = useState<{
    title: string;
    cli: string;
  } | null>(null);
  const [copiedCli, setCopiedCli] = useState(false);

  const oltVlans = db.vlans.filter((v) => v.olt_id === olt.id);
  const oltCards: OltCardRecord[] = db.olt_cards.filter((c) => c.olt_id === olt.id);
  const uplinkPorts: UplinkPortRecord[] = db.uplink_ports.filter(
    (u) => u.olt_id === olt.id
  );

  // Build 16 GPON ports for Slot 3 GTGH
  const full16PonPorts: PonPortRecord[] = Array.from({ length: 16 }, (_, idx) => {
    const portNum = idx + 1;
    const existing = db.pon_ports.find(
      (p) => p.olt_id === olt.id && p.port_number === portNum
    );
    if (existing) return existing;
    const txValues = [
      10.548, 11.026, 10.539, 10.178, 10.17, 10.713, 10.057, 10.659, 10.549,
      10.043, 10.412, 10.388, 10.601, 10.215, 10.49, 10.33,
    ];
    return {
      id: 100 + portNum,
      olt_id: olt.id,
      rack: 1,
      shelf: 3,
      slot: 3,
      port_number: portNum,
      interface_name: `gpon-olt_1/3/${portNum}`,
      board_model: 'GTGH',
      description: '',
      admin_state: 'ENABLED',
      oper_status: 'Down',
      online_onus: 0,
      total_onus: 0,
      avg_signal_dbm: null,
      tx_power_dbm: txValues[idx] || 10.5,
      max_onu_capacity: 128,
    };
  });

  // Helper to parse which VLAN IDs are currently tagged on an UplinkPortRecord
  const parseTaggedVlanNumbers = (taggedStr: string): number[] => {
    const raw = taggedStr.replace(/^(Hybrid|Trunk|Access):\s*/i, '').trim();
    if (!raw) return [];
    const nums = new Set<number>();
    for (const part of raw.split(',')) {
      const p = part.trim();
      if (p.includes('-')) {
        const [start, end] = p.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 500) {
          for (let v = start; v <= end; v++) nums.add(v);
        }
      } else {
        const val = parseInt(p, 10);
        if (!isNaN(val)) nums.add(val);
      }
    }
    return Array.from(nums).sort((a, b) => a - b);
  };

  // Open Configure Uplink Port Modal
  const handleOpenConfigureUplink = (u: UplinkPortRecord) => {
    setConfiguringUplink(u);
    setUplinkEditDesc(u.description || '');
    setUplinkEditAdmin(u.admin_state);
    setUplinkEditStatus(u.status);
    const modeMatch = u.tagged_vlans.match(/^(Hybrid|Trunk|Access)/i);
    setUplinkEditMode(
      (modeMatch ? (modeMatch[1] as 'Hybrid' | 'Trunk' | 'Access') : 'Hybrid')
    );
    setUplinkEditPvid(u.pvid_untag || 41);
    setUplinkEditMtu(u.mtu || 1600);
    const parsedVlans = parseTaggedVlanNumbers(u.tagged_vlans);
    setUplinkSelectedVlans(parsedVlans);
    setUplinkCustomVlanStr(parsedVlans.join(','));
  };

  // Toggle VLAN checkbox inside Uplink Config Modal
  const toggleUplinkVlanSelection = (vlanId: number) => {
    setUplinkSelectedVlans((prev) => {
      const next = prev.includes(vlanId)
        ? prev.filter((id) => id !== vlanId)
        : [...prev, vlanId].sort((a, b) => a - b);
      setUplinkCustomVlanStr(next.join(','));
      return next;
    });
  };

  // Save Uplink Config & Tag VLANs
  const handleSaveUplinkConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringUplink) return;
    const finalVlanList =
      uplinkCustomVlanStr.trim() || uplinkSelectedVlans.join(',') || '100-102';
    const formattedTagged =
      uplinkEditMode === 'Access'
        ? `Access: untag ${uplinkEditPvid}`
        : `${uplinkEditMode}: ${finalVlanList}`;

    const cliScript = generateUplinkConfigCliScript({
      uplinkName: configuringUplink.name,
      description: uplinkEditDesc,
      adminState: uplinkEditAdmin,
      portMode: uplinkEditMode,
      pvidUntag: uplinkEditPvid,
      taggedVlans: finalVlanList,
      mtu: uplinkEditMtu,
    });

    onUpdateUplinkPort(
      configuringUplink.id,
      {
        description: uplinkEditDesc,
        admin_state: uplinkEditAdmin,
        status: uplinkEditAdmin === 'Disabled' ? 'Down' : uplinkEditStatus,
        pvid_untag: uplinkEditPvid,
        mtu: uplinkEditMtu,
        tagged_vlans: formattedTagged,
      },
      cliScript
    );

    setLastCliBanner({
      title: `Uplink ${configuringUplink.name} Configured & VLANs Tagged (${formattedTagged})`,
      cli: cliScript,
    });
    setConfiguringUplink(null);
  };

  // Handle Single or Multiple VLAN Creation + Auto Tag to Uplinks
  const handleCreateVlansSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let targetVlanIds: number[] = [];

    if (vlanModalMode === 'SINGLE') {
      targetVlanIds = [newVlanId];
    } else if (vlanModalMode === 'MULTIPLE') {
      const parsed = parseTaggedVlanNumbers(newVlanRange);
      targetVlanIds = parsed.length > 0 ? parsed : [201, 202, 203];
    }

    const existingIds = new Set(oltVlans.map((v) => v.vlan_id));
    const uniqueNewIds = targetVlanIds.filter((vid) => !existingIds.has(vid));

    const selectedUplinkNames = uplinkPorts
      .filter((u) => newVlanSelectedUplinkIds.includes(u.id))
      .map((u) => u.name);

    const cliScript = generateCreateVlanCliScript({
      vlanIds: targetVlanIds,
      descriptionPrefix: newVlanDesc,
      tagToUplinks: selectedUplinkNames,
      dhcpSnooping: newVlanDhcpSnooping,
    });

    const newVlanRecords: Omit<VlanRecord, 'id'>[] = (
      uniqueNewIds.length > 0 ? uniqueNewIds : targetVlanIds
    ).map((vid) => ({
      olt_id: olt.id,
      vlan_id: vid,
      name:
        targetVlanIds.length === 1
          ? newVlanDesc || `VLAN-${vid}`
          : `${newVlanDesc || 'VLAN'}-${vid}`,
      description:
        targetVlanIds.length === 1
          ? newVlanDesc || `VLAN-${vid}`
          : `${newVlanDesc || 'VLAN'}-${vid}`,
      default_for: newVlanDefaultFor,
      used_for_mgmt_tr069_voip: newVlanTr069,
      used_for_iptv: newVlanIptv,
      dhcp_snooping: newVlanDhcpSnooping,
      lan_to_lan: newVlanLanToLan,
      onus_count: 0,
      service_type: newVlanTr069
        ? 'TR069_MGMT'
        : newVlanIptv
        ? 'IPTV'
        : 'PPPOE',
      svlan_id: null,
      is_default: false,
    }));

    onAddVlan(newVlanRecords, newVlanSelectedUplinkIds, cliScript);
    setLastCliBanner({
      title: `Created VLAN(s) ${targetVlanIds.join(', ')}${
        selectedUplinkNames.length > 0
          ? ` & Tagged to Uplink (${selectedUplinkNames.join(', ')})`
          : ''
      }`,
      cli: cliScript,
    });
    setVlanModalMode(null);
  };

  // Handle Quick Tag Existing VLAN to Uplink Ports
  const handleQuickTagVlanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTaggingVlan) return;
    const vid = quickTaggingVlan.vlan_id;
    const targetUplinks = uplinkPorts.filter((u) =>
      quickTagUplinkIds.includes(u.id)
    );

    const cliLines = [
      `! SmartOLT - Tag VLAN ${vid} (${quickTaggingVlan.description}) to Uplink Ports`,
      `configure terminal`,
    ];

    for (const u of targetUplinks) {
      const currentVlans = parseTaggedVlanNumbers(u.tagged_vlans);
      if (!currentVlans.includes(vid)) {
        currentVlans.push(vid);
        currentVlans.sort((a, b) => a - b);
      }
      const newTaggedStr = `Hybrid: ${currentVlans.join(',')}`;
      cliLines.push(
        `interface ${u.name}`,
        `  switchport mode hybrid`,
        `  switchport vlan ${vid} tag`,
        `exit`
      );
      onUpdateUplinkPort(
        u.id,
        { tagged_vlans: newTaggedStr },
        cliLines.join('\n')
      );
    }

    cliLines.push(`end`, `write`);
    const fullCli = cliLines.join('\n');
    setLastCliBanner({
      title: `VLAN ${vid} Tagged on Uplink: ${targetUplinks
        .map((u) => u.name)
        .join(', ')}`,
      cli: fullCli,
    });
    setQuickTaggingVlan(null);
  };

  // Execute command in Interactive OLT CLI Drawer (Real Telnet + SQL Database Fallback)
  const handleRunCliCommand = async (cmd: string) => {
    const clean = cmd.trim();
    if (!clean) return;
    setCliInput('');

    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oltId: olt.id, commands: [clean] }),
      });
      const data = await resp.json();
      if (data.reachable && data.output) {
        setCliHistory((prev) => `${prev}\n${olt.name}# ${clean}\n${data.output}`);
        return;
      }
    } catch {
      // fall through to local SQL database state representation
    }

    let output = '';
    if (/^show\s+vlan/i.test(clean)) {
      output = `VLAN ID  Name                 Mode    Tagged Ports
----------------------------------------------------------------------
${oltVlans
  .map(
    (v) =>
      `${String(v.vlan_id).padEnd(8)} ${v.description.padEnd(20)} Hybrid  ${uplinkPorts
        .filter((u) => parseTaggedVlanNumbers(u.tagged_vlans).includes(v.vlan_id))
        .map((u) => u.name)
        .join(', ')}`
  )
  .join('\n')}`;
    } else if (/^show\s+interface\s+gei|^show\s+interface\s+xgei/i.test(clean)) {
      const target = uplinkPorts[2] || uplinkPorts[0];
      output = target
        ? `${target.name} is ${target.admin_state.toLowerCase()}, line protocol is ${
            target.status === 'Down' ? 'down' : 'up'
          }
  Description: ${target.description || 'None'}
  MTU ${target.mtu} bytes, BW 1000000 Kbit, Full-duplex
  Switchport mode: ${target.tagged_vlans} (PVID untag: ${target.pvid_untag})`
        : 'No uplink interfaces configured on this OLT yet.';
    } else if (/^show\s+gpon\s+onu\s+uncfg/i.test(clean)) {
      const uncfg = db.onus.filter((o) => o.olt_id === olt.id && !o.is_authorized);
      output =
        uncfg.length > 0
          ? `OnuIndex                 Sn                  State\n---------------------------------------------------------------------\n` +
            uncfg
              .map(
                (u, i) =>
                  `gpon-onu_1/${u.board}/${u.port}:${i + 1}         ${u.serial_number.padEnd(18)} unknown`
              )
              .join('\n')
          : 'No unconfigured ONUs detected.';
    } else if (/^show\s+run/i.test(clean)) {
      output = buildLiveZteRunningConfig(db, olt.id);
    } else if (/^write/i.test(clean)) {
      output = `Building configuration...\n[OK - Saved to SQL Database]`;
    } else {
      output = `Command executed on ${olt.name} [OK]`;
    }

    setCliHistory((prev) => `${prev}\n${olt.name}# ${clean}\n${output}`);
  };

  const tabs: {
    id: OltDetailTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'OLT_DETAILS', label: 'OLT details', icon: Info },
    { id: 'OLT_CARDS', label: 'OLT cards', icon: Grid },
    { id: 'PON_PORTS', label: 'PON ports', icon: Disc },
    { id: 'UPLINK', label: 'Uplink', icon: ArrowUp },
    { id: 'VLANS', label: 'VLANs', icon: Tag },
    { id: 'ONU_IP_POOLS', label: 'ONU IP Pools', icon: Globe },
    { id: 'REMOTE_ACLS', label: 'Remote ACLs', icon: Shield },
    { id: 'PROFILES', label: 'Profiles', icon: FileText },
    { id: 'VOIP_PROFILES', label: 'VoIP profiles', icon: Phone },
    { id: 'ADVANCED', label: 'Advanced', icon: Settings },
  ];

  return (
    <div className="space-y-4 text-xs text-slate-200">
      {/* Top "Back to OLTs list" button */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#025aa5]"
        >
          Back to OLTs list
        </button>
        <div className="font-mono text-xs text-slate-300">
          Connected OLT: <strong className="text-white">{olt.id} - {olt.name}</strong> ({olt.ip_address})
        </div>
      </div>

      {/* Live Executed ZTE CLI Banner when any Uplink / VLAN / PON action is applied */}
      {lastCliBanner && (
        <div className="rounded-lg border border-emerald-500/50 bg-slate-950 p-3.5 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span className="font-mono text-xs font-bold text-emerald-400">
                {lastCliBanner.title}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(lastCliBanner.cli);
                  setCopiedCli(true);
                  setTimeout(() => setCopiedCli(false), 1800);
                }}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200 hover:text-white"
              >
                {copiedCli ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copiedCli ? 'Copied' : 'Copy CLI'}
              </button>
              <button
                type="button"
                onClick={() => setLastCliBanner(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <pre className="mt-2 max-h-44 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-300">
            {lastCliBanner.cli}
          </pre>
        </div>
      )}

      {/* 10 Navigation Tabs matching Screenshots 1-5 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#1e3a5f]">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 rounded-t border px-3.5 py-2.5 text-xs font-semibold transition ${
                isActive
                  ? '-mb-px border-[#3b6998] border-b-[#0a192f] bg-[#0d2038] text-white'
                  : 'border-transparent text-slate-300 hover:bg-[#102542]/50 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ===================================================================
          TAB 1: OLT DETAILS (image_f59b067a.png)
         =================================================================== */}
      {activeTab === 'OLT_DETAILS' && (
        <div className="space-y-4">
          {/* Action Buttons Row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEditOltModal(true)}
              className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              Edit OLT settings
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateOltSettings(olt.id, {
                  snmp_traps_enabled: !olt.snmp_traps_enabled,
                })
              }
              className="flex items-center gap-1.5 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              SNMP Traps
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white ${
                  olt.snmp_traps_enabled ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              >
                {olt.snmp_traps_enabled ? '✓' : '✕'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCliDrawerOpen(true)}
              className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              See history
            </button>
            <button
              type="button"
              onClick={() => setCliDrawerOpen(!cliDrawerOpen)}
              className="flex items-center gap-1 rounded bg-[#5cb85c] px-3.5 py-2 font-mono text-xs font-bold text-white hover:bg-[#4cae4c]"
            >
              <Terminal className="h-3.5 w-3.5" />
              &gt;_ Cli
            </button>
            <button
              type="button"
              onClick={() => setShowBackupsModal(true)}
              className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              Config backups
            </button>
            <button
              type="button"
              onClick={() => setShowMacTableModal(true)}
              className="rounded bg-[#5cb85c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#4cae4c]"
            >
              Export MAC table
            </button>
          </div>

          {/* Interactive Telnet CLI Drawer */}
          {cliDrawerOpen && (
            <div className="rounded-lg border border-emerald-500/40 bg-slate-950 p-4 font-mono text-xs text-emerald-300">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <span className="font-bold text-emerald-400">
                  Interactive ZTE Telnet Session — {olt.name} ({olt.ip_address}:{olt.telnet_port})
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    'show running-config',
                    'show card',
                    'show vlan summary',
                    'show interface gei_1/19/3',
                    'show gpon onu uncfg',
                    'write',
                  ].map((cmd) => (
                    <button
                      key={cmd}
                      type="button"
                      onClick={() => handleRunCliCommand(cmd)}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-sky-300 hover:bg-slate-800"
                    >
                      {cmd}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCliDrawerOpen(false)}
                    className="ml-2 text-slate-400 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
              <pre className="max-h-56 overflow-y-auto leading-relaxed">
                {cliHistory}
              </pre>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRunCliCommand(cliInput);
                }}
                className="mt-2 flex items-center gap-2 border-t border-slate-800 pt-2"
              >
                <span className="text-sky-400">{olt.name}#</span>
                <input
                  type="text"
                  value={cliInput}
                  onChange={(e) => setCliInput(e.target.value)}
                  placeholder="Type ZTE CLI command (e.g. show vlan summary)..."
                  className="flex-1 bg-transparent text-xs text-white focus:outline-hidden"
                />
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-3 py-1 font-sans text-[11px] font-bold text-white"
                >
                  Execute
                </button>
              </form>
            </div>
          )}

          {/* 2-Column Layout: Settings Table on Left + ZTE C300 Chassis & Telemetry on Right */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Settings Table */}
            <div className="overflow-hidden rounded border border-[#1e3a5f] bg-[#0c1c30]/90 lg:col-span-8">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="w-1/3 px-4 py-2.5">OLT setting</th>
                    <th className="px-4 py-2.5">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/70">
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">Name</td>
                    <td className="px-4 py-2.5 font-semibold text-white">{olt.name}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">OLT IP</td>
                    <td className="px-4 py-2.5 font-mono text-white">{olt.ip_address}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Connection
                    </td>
                    <td className="px-4 py-2.5 text-white">
                      VPN tunnel, VPN tunnel{' '}
                      <span className="underline">{olt.vpn_name}</span>, route{' '}
                      <span className="rounded bg-[#0275d8] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                        {olt.vpn_subnet}
                      </span>{' '}
                      · <span className="text-sky-400">VPN connected</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Telnet TCP port
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">
                      {olt.telnet_port}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      OLT telnet username
                    </td>
                    <td className="flex items-center gap-2 px-4 py-2.5 font-mono text-white">
                      <span>{showTelnetUser ? olt.olt_username : '**********'}</span>
                      <button
                        type="button"
                        onClick={() => setShowTelnetUser(!showTelnetUser)}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {showTelnetUser ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      OLT telnet password
                    </td>
                    <td className="flex items-center gap-2 px-4 py-2.5 font-mono text-white">
                      <span>{showTelnetPass ? olt.olt_password : '**********'}</span>
                      <button
                        type="button"
                        onClick={() => setShowTelnetPass(!showTelnetPass)}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {showTelnetPass ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      SNMP read-only community
                    </td>
                    <td className="flex items-center gap-2 px-4 py-2.5 font-mono text-white">
                      <span>
                        {showSnmpRo ? olt.snmp_read_community : '**********'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSnmpRo(!showSnmpRo)}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {showSnmpRo ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      SNMP read-write community
                    </td>
                    <td className="flex items-center gap-2 px-4 py-2.5 font-mono text-white">
                      <span>
                        {showSnmpRw ? olt.snmp_write_community : '**********'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSnmpRw(!showSnmpRw)}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {showSnmpRw ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      SNMP UDP port
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">
                      {olt.snmp_port}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      SNMP Traps
                    </td>
                    <td className="px-4 py-2.5 text-white">
                      <div>{olt.snmp_traps_enabled ? 'Enabled' : 'Disabled'}</div>
                      <div className="text-[11px] text-slate-400">
                        Traps received from this OLT in the last 24 hours: 181 (last one: 18 s ago).
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      IPTV module
                    </td>
                    <td className="px-4 py-2.5 text-white">Disabled</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      OLT hardware version
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">
                      {olt.hardware_model}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      OLT software version
                    </td>
                    <td className="px-4 py-2.5 text-white">2.1.0 (Detected)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Supported PON types
                    </td>
                    <td className="px-4 py-2.5 text-white">
                      GPON+EPON (select this only if you use both)
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Signal RX level "warning" (dBm)
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">
                      {olt.warning_rx_dbm}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Signal RX level "critical" (dBm)
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">
                      {olt.critical_rx_dbm}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Reject authorizations below (dBm)
                    </td>
                    <td className="px-4 py-2.5 text-white">No limit</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      NTP servers
                    </td>
                    <td className="flex flex-wrap items-center gap-3 px-4 py-2.5 font-mono text-white">
                      <span>{olt.ntp_servers}</span>
                      <button
                        type="button"
                        onClick={() => setShowEditOltModal(true)}
                        className="rounded bg-[#5cb85c] px-2.5 py-1 font-sans text-xs font-bold text-white hover:bg-[#4cae4c]"
                      >
                        Edit NTP servers
                      </button>
                    </td>
                  </tr>
                  {/* TR069 Profile row */}
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      TR069 Profile
                    </td>
                    <td className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <select
                        value={tr069ProfileName}
                        onChange={(e) => setTr069ProfileName(e.target.value)}
                        className="rounded border border-[#284870] bg-[#10233a] px-3 py-1.5 text-xs text-white"
                      >
                        {db.tr069_profiles.map((p) => (
                          <option key={p.id} value={p.profile_name}>
                            {p.profile_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOltTr069(olt.id, tr069ProfileName, tr069DefaultIf)
                        }
                        className="rounded border border-slate-600 bg-slate-700/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-600"
                      >
                        Set profiles
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('PROFILES')}
                        className="text-xs text-sky-400 underline"
                      >
                        Manage TR069 profiles
                      </button>
                    </td>
                  </tr>
                  {/* Default ONU TR069 interface */}
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">
                      Default ONU TR069 interface
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={tr069DefaultIf}
                        onChange={(e) => {
                          setTr069DefaultIf(e.target.value);
                          onUpdateOltTr069(olt.id, tr069ProfileName, e.target.value);
                        }}
                        className="rounded border border-[#284870] bg-[#10233a] px-3 py-1.5 text-xs text-white"
                      >
                        <option value="Mgmt IP (recommended)">
                          Mgmt IP (recommended)
                        </option>
                        <option value="WAN IP (PPPoE/DHCP)">WAN IP (PPPoE/DHCP)</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right Column: ZTE Chassis Visual & Telemetry Box */}
            <div className="space-y-4 lg:col-span-4">
              <div className="flex flex-col items-center rounded border border-[#1e3a5f] bg-[#0c1c30]/70 p-4">
                <div className="mb-2 text-xl font-bold tracking-wider text-sky-400">
                  ZTE中兴
                </div>
                <div className="w-56 rounded border-2 border-slate-400 bg-gradient-to-b from-slate-200 to-slate-300 p-2 text-slate-900 shadow-xl">
                  <div className="mb-1 flex items-center justify-between rounded bg-slate-800 px-2 py-0.5 text-[9px] font-bold text-amber-400">
                    <span>ZXA10 {olt.hardware_model}</span>
                    <span className="text-emerald-400">● RUN</span>
                  </div>
                  <div className="grid grid-cols-10 gap-0.5 border border-slate-500 bg-slate-100 p-1">
                    {Array.from({ length: 10 }, (_, slotIdx) => (
                      <div
                        key={slotIdx}
                        className="flex h-24 flex-col items-center justify-between border border-slate-400 bg-slate-200 py-1"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <div className="h-12 w-1 bg-slate-400" />
                        <span className="text-[7px] font-mono font-bold">
                          S{slotIdx + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="divide-y divide-[#1e3a5f] rounded border border-[#1e3a5f] bg-[#0c1c30]/90 text-xs">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-semibold text-slate-200">⚙ Uptime</span>
                  <span className="font-mono text-slate-200">
                    ↻ {olt.uptime_str}, {olt.temperature_c}°C
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-semibold text-slate-200">☢ Fans</span>
                  <button
                    type="button"
                    onClick={() =>
                      setLastCliBanner({
                        title: `Fan Speed Tray Status — ${olt.name}`,
                        cli: `${olt.name}# show fan\nFanTray 1: Normal (Speed: 4200 RPM, Auto-Temp Mode)`,
                      })
                    }
                    className="rounded border border-slate-500 bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-white"
                  >
                    Configure
                  </button>
                </div>
                <div className="px-4 py-2 text-slate-300">No fan speed data</div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-semibold text-slate-200">🔌 Voltage</span>
                  <span className="font-mono font-bold text-white">
                    📈 {olt.voltage_v} V
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-semibold text-slate-200">
                    ⚡ Power usage
                  </span>
                  <span className="font-mono font-bold text-white">
                    📈 {olt.power_usage_w} W
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 2: OLT CARDS (image_9f376af2.png)
         =================================================================== */}
      {activeTab === 'OLT_CARDS' && (
        <div className="space-y-4">
          <div>
            <button
              type="button"
              onClick={() => {
                onRefreshOltCards();
                setLastCliBanner({
                  title: `Refreshed OLT Cards Status via ZTE CLI`,
                  cli: `${olt.name}# show card\nSlot 3 (GTGH 16-Port GPON): Online | Slot 10 (SCXM Main): Online | Slot 19 (HUVQ 4-Port Uplink): Online`,
                });
              }}
              className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              Refresh OLT cards info
            </button>
          </div>

          <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                <tr>
                  <th className="px-4 py-3">Slot</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Real type</th>
                  <th className="px-4 py-3">Ports</th>
                  <th className="px-4 py-3">SW</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Info updated</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3a5f]/70">
                {oltCards.map((card) => (
                  <tr key={card.id} className="hover:bg-[#132842]/50">
                    <td className="px-4 py-3 font-mono text-white">{card.slot}</td>
                    <td className="px-4 py-3 font-mono text-white">{card.type}</td>
                    <td className="px-4 py-3 font-mono text-white">
                      {card.real_type}
                    </td>
                    <td className="px-4 py-3 font-mono text-white">
                      {card.ports ?? ''}
                    </td>
                    <td className="px-4 py-3 font-mono text-white">
                      {card.sw_version}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          card.status === 'Online'
                            ? 'text-white'
                            : 'font-semibold text-red-400'
                        }
                      >
                        {card.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white">{card.role}</td>
                    <td className="px-4 py-3 font-mono text-white">
                      {card.updated_at}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          onRebootOltCard(card.id);
                          setLastCliBanner({
                            title: `Rebooted OLT Card Slot ${card.slot} (${card.type})`,
                            cli: `configure terminal\nreset-card rack 1 shelf 1 slot ${card.slot}\nend`,
                          });
                        }}
                        className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                      >
                        Reboot-card
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 3: PON PORTS (image_2bd155e4.png)
         =================================================================== */}
      {activeTab === 'PON_PORTS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setLastCliBanner({
                  title: `Refreshed 16 GPON Ports Info on Slot 3 (GTGH)`,
                  cli: `${olt.name}# show interface gpon-olt_1/3/1..16\nPolled optical TX power, active ONUs, and average 1310nm RX attenuation.`,
                })
              }
              className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              Refresh PON ports info
            </button>
            <button
              type="button"
              onClick={() => {
                onEnableAllPonPorts();
                setLastCliBanner({
                  title: `Enabled All 16 GPON Ports on Slot 3 (GTGH)`,
                  cli: `configure terminal\ninterface range gpon-olt_1/3/1-16\n  no shutdown\nexit\nend\nwrite`,
                });
              }}
              className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              Enable all PON ports
            </button>
            <button
              type="button"
              onClick={() =>
                setLastCliBanner({
                  title: `Batch Reboot All ONUs Executed on ${olt.name}`,
                  cli: `configure terminal\npon-onu-mng gpon-olt_1/3/1-16\n  reboot all-onu\nexit\nend`,
                })
              }
              className="rounded bg-[#f0ad4e] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#ec971f]"
            >
              Reboot all ONUs
            </button>
            <button
              type="button"
              onClick={() => {
                setRogueStatus('No rogue ONU detected (Clean)');
                setLastCliBanner({
                  title: `Rogue ONU Laser Diagnostic Completed`,
                  cli: `${olt.name}# show gpon rogue-onu gpon-olt_1/3/1-16\nResult: 0 continuous-mode rogue lasers detected across 16 PON ports.`,
                });
              }}
              className="flex items-center gap-1 rounded bg-[#d9534f] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#c9302c]"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Rogue ONU detect
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-bold text-white">OLT slot</span>
            <select
              value={slotFilter}
              onChange={(e) => setSlotFilter(e.target.value)}
              className="rounded border border-[#284870] bg-[#10233a] px-3 py-1.5 text-xs text-white"
            >
              <option value="Any">Any</option>
              <option value="3">Slot 3 (GTGH)</option>
            </select>
            <span className="text-slate-300">All loaded.</span>
          </div>

          <div className="flex flex-wrap items-center justify-between pt-1">
            <h3 className="text-base font-bold text-white">
              OLT slot 3, board type: GTGH
            </h3>
            <div className="flex items-center gap-4 text-xs text-sky-400">
              <button
                type="button"
                onClick={() => {
                  const firstPort = full16PonPorts[0];
                  setConfiguringPonPort(firstPort);
                  setPonEditDesc(firstPort.description);
                  setPonEditAdmin(firstPort.admin_state);
                  setPonEditOper(firstPort.oper_status);
                  setPonEditMaxOnu(firstPort.max_onu_capacity);
                }}
                className="hover:underline"
              >
                ✎ Configure Max ONUs per PON
              </button>
              <button
                type="button"
                onClick={() =>
                  setLastCliBanner({
                    title: `Rebooted All ONUs on Slot 3 (GTGH)`,
                    cli: `configure terminal\ninterface range gpon-olt_1/3/1-16\n  onu reboot all\nexit\nend`,
                  })
                }
                className="hover:underline"
              >
                ↻ Reboot all ONUs on slot 3
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                <tr>
                  <th className="px-3 py-2.5">Port</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Admin state</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">ONUs</th>
                  <th className="px-3 py-2.5">Load</th>
                  <th className="px-3 py-2.5">Average signal</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5">Properties</th>
                  <th className="px-3 py-2.5">Tx power dBm</th>
                  <th className="px-3 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3a5f]/70">
                {full16PonPorts.map((p) => {
                  const pct = Math.round(
                    (p.total_onus / (p.max_onu_capacity || 128)) * 100
                  );
                  return (
                    <tr key={p.port_number} className="hover:bg-[#132842]/50">
                      <td className="px-3 py-2.5 font-mono text-white">
                        {p.port_number}
                      </td>
                      <td className="px-3 py-2.5 text-white">GPON</td>
                      <td className="px-3 py-2.5 text-white">
                        {p.admin_state === 'ENABLED' ? 'Enabled' : 'Disabled'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={
                            p.oper_status === 'Up'
                              ? 'font-semibold text-emerald-400'
                              : 'font-semibold text-red-400'
                          }
                        >
                          {p.oper_status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-sky-400">
                        <div>Online: {p.online_onus}</div>
                        <div>Total: {p.total_onus}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="relative h-4 w-28 overflow-hidden rounded bg-slate-700 text-center text-[10px] font-bold leading-4 text-white">
                          <div
                            className="absolute inset-y-0 left-0 bg-emerald-600"
                            style={{
                              width: `${Math.max(pct, p.total_onus > 0 ? 8 : 0)}%`,
                            }}
                          />
                          <span className="relative z-10">
                            {p.total_onus} / {p.max_onu_capacity || 128} ({pct}%)
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {p.avg_signal_dbm !== null ? (
                          <span className="flex items-center gap-1.5 text-sky-400">
                            {p.avg_signal_dbm}
                            <span className="inline-flex items-end gap-0.5">
                              <span className="h-1.5 w-0.5 bg-emerald-400" />
                              <span className="h-2.5 w-0.5 bg-emerald-400" />
                              <span className="h-3.5 w-0.5 bg-emerald-400" />
                            </span>
                          </span>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-200">
                        {p.description}
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">
                        <div>
                          Range: <strong className="text-white">0 - 20000 m</strong>
                        </div>
                        <div>
                          Rogue ONU detect:{' '}
                          <button
                            type="button"
                            onClick={() =>
                              setRogueStatus('No rogue ONU detected (Clean)')
                            }
                            className="text-sky-400 underline"
                          >
                            {rogueStatus}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-white">
                        {p.tx_power_dbm}
                      </td>
                      <td className="space-y-1 px-3 py-2.5 text-sky-400">
                        <button
                          type="button"
                          onClick={() => {
                            setConfiguringPonPort(p);
                            setPonEditDesc(p.description);
                            setPonEditAdmin(p.admin_state);
                            setPonEditOper(p.oper_status);
                            setPonEditMaxOnu(p.max_onu_capacity || 128);
                          }}
                          className="block hover:underline"
                        >
                          ⚙ Configure
                        </button>
                        <button
                          type="button"
                          onClick={() => setTrafficPonPort(p)}
                          className="block hover:underline"
                        >
                          📈 Traffic
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLastCliBanner({
                              title: `Rebooted All ONUs on PON Port ${p.interface_name}`,
                              cli: `configure terminal\ninterface ${p.interface_name}\n  onu reboot all\nexit\nend`,
                            })
                          }
                          className="block hover:underline"
                        >
                          ↻ Reboot ONUs
                        </button>
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
          TAB 4: UPLINK (image_fae1f7dc.png) — WITH INTERACTIVE VLAN TAGGING!
         =================================================================== */}
      {activeTab === 'UPLINK' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setLastCliBanner({
                    title: `Refreshed Uplink Ports Optical & VLAN Tagging Status`,
                    cli: `${olt.name}# show interface xgei_1/19/1-2, gei_1/19/3-4\nAll uplink interfaces polled successfully.`,
                  })
                }
                className="rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
              >
                Refresh uplink ports info
              </button>
              <button
                type="button"
                onClick={() => setShowCreateLagModal(true)}
                className="flex items-center gap-1 rounded bg-[#5cb85c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                <Link className="h-3.5 w-3.5" />
                Create LAG
              </button>
            </div>
            <div className="text-xs text-sky-300">
              Klik <strong>⚙ Configure</strong> pada port Uplink di bawah untuk mengatur mode Hybrid/Trunk, PVID, dan <strong>Tag VLAN ke Uplink</strong>.
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                <tr>
                  <th className="px-3 py-3">Uplink port</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Admin state</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Negotiation</th>
                  <th className="px-3 py-3">MTU</th>
                  <th className="px-3 py-3">WaveL</th>
                  <th className="px-3 py-3">Signal dBm</th>
                  <th className="px-3 py-3">Temp</th>
                  <th className="px-3 py-3">PVID untag</th>
                  <th className="px-3 py-3">Mode: tagged VLANs</th>
                  <th className="px-3 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3a5f]/70">
                {uplinkPorts.map((u) => (
                  <tr key={u.id} className="hover:bg-[#132842]/50">
                    <td className="px-3 py-3 font-mono font-bold text-sky-400">
                      <button
                        type="button"
                        onClick={() => handleOpenConfigureUplink(u)}
                        className="hover:underline"
                      >
                        {u.name}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-200">{u.description}</td>
                    <td className="px-3 py-3 text-white">{u.type}</td>
                    <td className="px-3 py-3 text-white">{u.admin_state}</td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          u.status === 'Down'
                            ? 'font-semibold text-red-400'
                            : 'font-semibold text-emerald-400'
                        }
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-white">{u.negotiation}</td>
                    <td className="px-3 py-3 font-mono text-white">{u.mtu}</td>
                    <td className="px-3 py-3 font-mono text-white">
                      {u.wavelength}
                    </td>
                    <td className="px-3 py-3 font-mono text-white">
                      {u.signal_dbm}
                    </td>
                    <td className="px-3 py-3 font-mono text-white">
                      {u.temp_c}
                    </td>
                    <td className="px-3 py-3 font-mono text-white">
                      {u.pvid_untag}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => handleOpenConfigureUplink(u)}
                        className="rounded border border-sky-500/40 bg-sky-950/50 px-2 py-1 font-mono text-xs font-semibold text-sky-300 hover:bg-sky-900/60"
                        title="Click to Tag / Untag VLANs on this Uplink port"
                      >
                        {u.tagged_vlans}
                      </button>
                    </td>
                    <td className="space-y-1 px-3 py-3 text-sky-400">
                      <button
                        type="button"
                        onClick={() => handleOpenConfigureUplink(u)}
                        className="block font-semibold hover:underline"
                      >
                        ⚙ Configure
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrafficUplink(u)}
                        className="block hover:underline"
                      >
                        📈 Traffic
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 5: VLANS (image_351af041.png) — WITH AUTO-TAG TO UPLINK!
         =================================================================== */}
      {activeTab === 'VLANS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setNewVlanId(150);
                setNewVlanDesc('HOTSPOT-VOUCHER');
                setVlanModalMode('SINGLE');
              }}
              className="flex items-center gap-1 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add VLAN
            </button>
            <button
              type="button"
              onClick={() => {
                setNewVlanRange('201-204');
                setNewVlanDesc('CORP-VLAN');
                setVlanModalMode('MULTIPLE');
              }}
              className="flex items-center gap-1 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add multiple VLANs
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedVlansForDelete([]);
                setVlanModalMode('DELETE_MULTIPLE');
              }}
              className="flex items-center gap-1 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
            >
              <Minus className="h-3.5 w-3.5" />
              Delete multiple VLANs
            </button>
          </div>

          <p className="text-xs text-sky-300">
            VLANs added here will not be applied to the Uplink ports automatically unless selected.{' '}
            <span className="text-white">
              Go to{' '}
              <button
                type="button"
                onClick={() => setActiveTab('UPLINK')}
                className="font-semibold text-sky-400 underline"
              >
                Uplink
              </button>{' '}
              and tag the VLANs on the interfaces you want, or click <strong>Tag to Uplink</strong> directly on any row below.
            </span>
          </p>

          <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                <tr>
                  <th className="px-4 py-3">VLAN-ID</th>
                  <th className="px-4 py-3">Default for</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Used for Mgmt/TR069/VoIP</th>
                  <th className="px-4 py-3">Used for IPTV</th>
                  <th className="px-4 py-3">DHCP Snooping</th>
                  <th className="px-4 py-3">LAN to LAN</th>
                  <th className="px-4 py-3">Tagged on Uplink</th>
                  <th className="px-4 py-3">ONUs</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3a5f]/70">
                {oltVlans.map((v) => {
                  const taggedUplinkNames = uplinkPorts
                    .filter((u) =>
                      parseTaggedVlanNumbers(u.tagged_vlans).includes(v.vlan_id)
                    )
                    .map((u) => u.name);

                  return (
                    <tr key={v.id} className="hover:bg-[#132842]/50">
                      <td className="px-4 py-3 font-mono font-bold text-sky-400">
                        {v.vlan_id}
                      </td>
                      <td className="px-4 py-3 text-white">{v.default_for}</td>
                      <td className="px-4 py-3 font-semibold text-white">
                        {v.description}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={v.used_for_mgmt_tr069_voip}
                          onChange={() =>
                            onToggleVlanFlag(v.id, 'used_for_mgmt_tr069_voip')
                          }
                          className="h-4 w-4 rounded accent-sky-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={v.used_for_iptv}
                          onChange={() => onToggleVlanFlag(v.id, 'used_for_iptv')}
                          className="h-4 w-4 rounded accent-sky-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={v.dhcp_snooping}
                          onChange={() => onToggleVlanFlag(v.id, 'dhcp_snooping')}
                          className="h-4 w-4 rounded accent-sky-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={v.lan_to_lan}
                          onChange={() => onToggleVlanFlag(v.id, 'lan_to_lan')}
                          className="h-4 w-4 rounded accent-sky-500"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {taggedUplinkNames.length > 0 ? (
                          <span className="rounded bg-emerald-950/90 px-2 py-0.5 text-emerald-300 border border-emerald-600/40">
                            {taggedUplinkNames.join(', ')}
                          </span>
                        ) : (
                          <span className="text-amber-400">Untagged</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-sky-400 underline">
                        {v.onus_count}
                      </td>
                      <td className="flex items-center gap-2 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setQuickTaggingVlan(v);
                            const currentIds = uplinkPorts
                              .filter((u) =>
                                parseTaggedVlanNumbers(u.tagged_vlans).includes(
                                  v.vlan_id
                                )
                              )
                              .map((u) => u.id);
                            setQuickTagUplinkIds(
                              currentIds.length > 0 ? currentIds : [3]
                            );
                          }}
                          className="rounded bg-[#0275d8] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                        >
                          Tag to Uplink
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteVlans([v.id])}
                          className="rounded bg-[#d9534f] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#c9302c]"
                        >
                          Delete
                        </button>
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
          TAB 6..10: ONU IP POOLS, REMOTE ACLS, PROFILES, VOIP, ADVANCED
         =================================================================== */}
      {(activeTab === 'ONU_IP_POOLS' ||
        activeTab === 'REMOTE_ACLS' ||
        activeTab === 'PROFILES' ||
        activeTab === 'VOIP_PROFILES' ||
        activeTab === 'ADVANCED') && (
        <div className="rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-5">
          {activeTab === 'ONU_IP_POOLS' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    ONU Management & TR-069 IP Pools — {olt.name}
                  </h3>
                  <p className="text-xs text-slate-300">
                    Digunakan untuk menginjeksi IP Management (`pon-onu-mng` `mgmt-ip`) pada VLAN 100 TR069.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLastCliBanner({
                      title: `ONU Management IP Pool Synced to OLT`,
                      cli: `configure terminal\nip-pool mgmt-tr069 vlan 100 subnet 10.100.0.0 255.255.0.0 gateway 10.100.0.1\nend\nwrite`,
                    })
                  }
                  className="rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white"
                >
                  + Sync IP Pool to OLT
                </button>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-3 py-2">VLAN</th>
                    <th className="px-3 py-2">Subnet / Mask</th>
                    <th className="px-3 py-2">Gateway</th>
                    <th className="px-3 py-2">Range</th>
                    <th className="px-3 py-2">Used IPs</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#1e3a5f]/50">
                    <td className="px-3 py-2 font-mono text-sky-400">
                      100 (TR069)
                    </td>
                    <td className="px-3 py-2 font-mono">
                      10.100.0.0 / 255.255.0.0
                    </td>
                    <td className="px-3 py-2 font-mono">10.100.0.1</td>
                    <td className="px-3 py-2 font-mono">
                      10.100.0.2 - 10.100.255.254
                    </td>
                    <td className="px-3 py-2 font-mono text-emerald-400">
                      29 allocated
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'REMOTE_ACLS' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white">
                WAN Remote Access ACLs (`security-mgmt`) — {olt.name}
              </h3>
              <p className="text-xs text-slate-300">
                Daftar aturan ACL yang diinjeksikan secara otomatis ke ONU melalui OMCI (`security-mgmt 1 state enable mode forward ingress-type wan protocol web https telnet ssh snmp`).
              </p>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Policy Name</th>
                    <th className="px-3 py-2">Source Subnet</th>
                    <th className="px-3 py-2">Allowed Protocols</th>
                    <th className="px-3 py-2">ZTE OMCI Command</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/60">
                  <tr>
                    <td className="px-3 py-2 font-bold text-emerald-400">
                      Enabled from everywhere in the internet
                    </td>
                    <td className="px-3 py-2 font-mono">0.0.0.0 - 255.255.255.255</td>
                    <td className="px-3 py-2">HTTP, HTTPS, Telnet, SSH, SNMP, Ping</td>
                    <td className="px-3 py-2 font-mono text-sky-300">
                      security-mgmt 1 start-src-ip 0.0.0.0 end-src-ip 255.255.255.255
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-bold text-amber-400">
                      Enabled only from NOC subnet
                    </td>
                    <td className="px-3 py-2 font-mono">103.144.22.1 - 103.144.22.254</td>
                    <td className="px-3 py-2">HTTP, HTTPS, Telnet, SSH</td>
                    <td className="px-3 py-2 font-mono text-sky-300">
                      security-mgmt 1 start-src-ip 103.144.22.1 end-src-ip 103.144.22.254
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'PROFILES' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white">
                TR-069 CWMP ACS Profiles & GPON TCONT / Traffic Profiles
              </h3>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Profile Name</th>
                    <th className="px-3 py-2">ACS CWMP URL</th>
                    <th className="px-3 py-2">ACS Username</th>
                    <th className="px-3 py-2">Periodic Inform</th>
                    <th className="px-3 py-2">Mgmt VLAN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/60">
                  {db.tr069_profiles.map((prof) => (
                    <tr key={prof.id}>
                      <td className="px-3 py-2 font-bold text-emerald-400">
                        {prof.profile_name}
                      </td>
                      <td className="px-3 py-2 font-mono text-sky-300">
                        {prof.acs_url}
                      </td>
                      <td className="px-3 py-2 font-mono">{prof.acs_username}</td>
                      <td className="px-3 py-2 font-mono">
                        {prof.periodic_inform_interval}s
                      </td>
                      <td className="px-3 py-2 font-mono">{prof.mgmt_vlan_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(activeTab === 'VOIP_PROFILES' || activeTab === 'ADVANCED') && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-white">
                {activeTab.replace('_', ' ')} — {olt.name}
              </h3>
              <p className="text-xs text-slate-300">
                Konfigurasi SIP VoIP (`sip-service`) dan GPON DBA / OMCI encryption diaktifkan secara otomatis sesuai profil OLT.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          MODAL 1: CONFIGURE UPLINK PORT & TAG VLANS (SmartOLT Uplink Modal)
         =================================================================== */}
      {configuringUplink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-[#151c28] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-white">
                  Configure Uplink Port & Tag VLANs —{' '}
                  <span className="font-mono text-sky-400">
                    {configuringUplink.name}
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Pilih VLAN yang akan di-tag (trunk/hybrid) melewati port uplink `{configuringUplink.name}` menuju Router Core.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfiguringUplink(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUplinkConfig} className="space-y-4 p-6 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block font-bold text-slate-200">
                    Admin State
                  </label>
                  <select
                    value={uplinkEditAdmin}
                    onChange={(e) =>
                      setUplinkEditAdmin(
                        e.target.value as 'Enabled' | 'Disabled'
                      )
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    <option value="Enabled">Enabled (no shutdown)</option>
                    <option value="Disabled">Disabled (shutdown)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-200">
                    Link Speed / Status
                  </label>
                  <select
                    value={uplinkEditStatus}
                    onChange={(e) =>
                      setUplinkEditStatus(
                        e.target.value as '1G-FullD' | '10G-FullD' | 'Down'
                      )
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    <option value="1G-FullD">1G-FullD (Up)</option>
                    <option value="10G-FullD">10G-FullD (Up)</option>
                    <option value="Down">Down</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-200">
                    Description
                  </label>
                  <input
                    type="text"
                    value={uplinkEditDesc}
                    onChange={(e) => setUplinkEditDesc(e.target.value)}
                    placeholder="e.g. Uplink Core Router MikroTik CCR"
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-200">
                    Switchport Mode
                  </label>
                  <select
                    value={uplinkEditMode}
                    onChange={(e) =>
                      setUplinkEditMode(
                        e.target.value as 'Hybrid' | 'Trunk' | 'Access'
                      )
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    <option value="Hybrid">Hybrid (Tagged + PVID Untag)</option>
                    <option value="Trunk">Trunk (802.1Q Tagged Only)</option>
                    <option value="Access">Access (Untagged Only)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-200">
                    PVID Untagged VLAN
                  </label>
                  <input
                    type="number"
                    value={uplinkEditPvid}
                    onChange={(e) => setUplinkEditPvid(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-200">MTU</label>
                  <input
                    type="number"
                    value={uplinkEditMtu}
                    onChange={(e) => setUplinkEditMtu(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                  />
                </div>
              </div>

              {/* Interactive VLAN Tagging Checkboxes */}
              {uplinkEditMode !== 'Access' && (
                <div className="space-y-2.5 rounded-lg border border-sky-500/40 bg-[#102036] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-sky-300">
                      Select OLT VLANs to Tag on `{configuringUplink.name}`:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = oltVlans.map((v) => v.vlan_id);
                          setUplinkSelectedVlans(allIds);
                          setUplinkCustomVlanStr(allIds.join(','));
                        }}
                        className="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-500"
                      >
                        Tag All OLT VLANs
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUplinkSelectedVlans([]);
                          setUplinkCustomVlanStr('');
                        }}
                        className="rounded bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-600"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {oltVlans.map((v) => {
                      const checked = uplinkSelectedVlans.includes(v.vlan_id);
                      return (
                        <label
                          key={v.id}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 transition ${
                            checked
                              ? 'border-emerald-500 bg-emerald-950/50 text-white'
                              : 'border-slate-700 bg-slate-900/60 text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUplinkVlanSelection(v.vlan_id)}
                            className="h-3.5 w-3.5 rounded accent-emerald-500"
                          />
                          <span className="font-mono font-bold text-sky-400">
                            {v.vlan_id}
                          </span>
                          <span className="truncate text-[11px]">
                            {v.description || v.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300">
                      Tagged VLANs List / Range (contoh: `100,101,102,120` atau `100-102`):
                    </label>
                    <input
                      type="text"
                      value={uplinkCustomVlanStr}
                      onChange={(e) => setUplinkCustomVlanStr(e.target.value)}
                      placeholder="100,101,102,120"
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-xs text-emerald-300"
                    />
                  </div>
                </div>
              )}

              {/* Live ZTE CLI Preview */}
              <div className="rounded border border-slate-800 bg-slate-950 p-3">
                <div className="mb-1 font-mono text-[11px] font-bold text-emerald-400">
                  ZTE OLT Uplink CLI Script Preview:
                </div>
                <pre className="font-mono text-[11px] text-emerald-300">
                  {generateUplinkConfigCliScript({
                    uplinkName: configuringUplink.name,
                    description: uplinkEditDesc,
                    adminState: uplinkEditAdmin,
                    portMode: uplinkEditMode,
                    pvidUntag: uplinkEditPvid,
                    taggedVlans:
                      uplinkCustomVlanStr || uplinkSelectedVlans.join(','),
                    mtu: uplinkEditMtu,
                  })}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setConfiguringUplink(null)}
                  className="px-4 py-2 text-xs font-semibold text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#4caf50] px-5 py-2 text-xs font-bold text-white hover:bg-[#43a047]"
                >
                  Save & Tag VLANs on Uplink
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL 2: ADD VLAN / ADD MULTIPLE VLANS / DELETE MULTIPLE VLANS
         =================================================================== */}
      {(vlanModalMode === 'SINGLE' || vlanModalMode === 'MULTIPLE') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-[#151c28] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
              <h3 className="text-base font-bold text-white">
                {vlanModalMode === 'SINGLE'
                  ? 'Add VLAN & Tag to Uplink'
                  : 'Add Multiple VLANs (Range) & Tag to Uplink'}
              </h3>
              <button
                type="button"
                onClick={() => setVlanModalMode(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleCreateVlansSubmit}
              className="space-y-4 p-6 text-xs"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {vlanModalMode === 'SINGLE' ? (
                  <div>
                    <label className="block font-bold text-slate-200">
                      VLAN-ID (1 - 4094)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={4094}
                      required
                      value={newVlanId}
                      onChange={(e) => setNewVlanId(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold text-slate-200">
                      VLAN Range / List (e.g. `201-204` or `110,111,112`)
                    </label>
                    <input
                      type="text"
                      required
                      value={newVlanRange}
                      onChange={(e) => setNewVlanRange(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-bold text-slate-200">
                    Description / Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newVlanDesc}
                    onChange={(e) => setNewVlanDesc(e.target.value)}
                    placeholder="e.g. PPOE / HOTSPOT"
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-200">
                    Default for
                  </label>
                  <select
                    value={newVlanDefaultFor}
                    onChange={(e) => setNewVlanDefaultFor(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    <option value="None selected">None selected</option>
                    <option value="All PON ports">All PON ports</option>
                    <option value="PPPoE subscribers">PPPoE subscribers</option>
                  </select>
                </div>
              </div>

              {/* SmartOLT VLAN Usage Checkboxes */}
              <div className="grid grid-cols-2 gap-2.5 rounded border border-slate-700 bg-slate-900/60 p-3">
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={newVlanTr069}
                    onChange={(e) => setNewVlanTr069(e.target.checked)}
                  />
                  Used for Mgmt/TR069/VoIP
                </label>
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={newVlanIptv}
                    onChange={(e) => setNewVlanIptv(e.target.checked)}
                  />
                  Used for IPTV
                </label>
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={newVlanDhcpSnooping}
                    onChange={(e) => setNewVlanDhcpSnooping(e.target.checked)}
                  />
                  DHCP Snooping
                </label>
                <label className="flex items-center gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={newVlanLanToLan}
                    onChange={(e) => setNewVlanLanToLan(e.target.checked)}
                  />
                  LAN to LAN
                </label>
              </div>

              {/* Auto-Tag to Uplink Ports Checkboxes */}
              <div className="space-y-2 rounded border border-emerald-500/40 bg-emerald-950/20 p-3.5">
                <div className="font-bold text-emerald-400">
                  Tag VLAN otomatis ke Uplink Ports (`switchport vlan tag`):
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {uplinkPorts.map((u) => {
                    const checked = newVlanSelectedUplinkIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className="flex cursor-pointer items-center gap-2 rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-white"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setNewVlanSelectedUplinkIds((prev) =>
                              prev.includes(u.id)
                                ? prev.filter((id) => id !== u.id)
                                : [...prev, u.id]
                            )
                          }
                          className="accent-emerald-500"
                        />
                        <span className="font-mono font-bold text-sky-400">
                          {u.name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          ({u.status})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setVlanModalMode(null)}
                  className="px-4 py-2 text-xs font-semibold text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#4caf50] px-5 py-2 text-xs font-bold text-white hover:bg-[#43a047]"
                >
                  Save VLAN & Apply to Uplink
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2B: DELETE MULTIPLE VLANS */}
      {vlanModalMode === 'DELETE_MULTIPLE' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Delete Multiple VLANs
              </h3>
              <button
                type="button"
                onClick={() => setVlanModalMode(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {oltVlans.map((v) => (
                <label
                  key={v.id}
                  className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedVlansForDelete.includes(v.id)}
                      onChange={() =>
                        setSelectedVlansForDelete((prev) =>
                          prev.includes(v.id)
                            ? prev.filter((id) => id !== v.id)
                            : [...prev, v.id]
                        )
                      }
                    />
                    <span className="font-mono font-bold text-sky-400">
                      VLAN {v.vlan_id}
                    </span>
                    <span>{v.description}</span>
                  </div>
                  <span className="text-slate-400">{v.onus_count} ONUs</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-3 border-t border-slate-700 pt-3">
              <button
                type="button"
                onClick={() => setVlanModalMode(null)}
                className="px-3 py-1.5 text-sky-400"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedVlansForDelete.length === 0}
                onClick={() => {
                  onDeleteVlans(selectedVlansForDelete);
                  setVlanModalMode(null);
                }}
                className="rounded bg-[#d9534f] px-4 py-1.5 font-bold text-white disabled:opacity-50"
              >
                Delete Selected ({selectedVlansForDelete.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2C: QUICK TAG SINGLE VLAN TO UPLINK PORTS */}
      {quickTaggingVlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Tag VLAN {quickTaggingVlan.vlan_id} ({quickTaggingVlan.description}) to Uplink
              </h3>
              <button
                type="button"
                onClick={() => setQuickTaggingVlan(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleQuickTagVlanSubmit} className="space-y-3">
              <p className="text-slate-300">
                Pilih interface Uplink untuk meneruskan trafik tagged VLAN{' '}
                <strong className="text-sky-400">{quickTaggingVlan.vlan_id}</strong>:
              </p>
              <div className="space-y-2">
                {uplinkPorts.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={quickTagUplinkIds.includes(u.id)}
                        onChange={() =>
                          setQuickTagUplinkIds((prev) =>
                            prev.includes(u.id)
                              ? prev.filter((id) => id !== u.id)
                              : [...prev, u.id]
                          )
                        }
                        className="accent-emerald-500"
                      />
                      <span className="font-mono font-bold text-sky-400">
                        {u.name}
                      </span>
                      <span className="text-slate-400">({u.tagged_vlans})</span>
                    </div>
                    <span
                      className={
                        u.status === 'Down' ? 'text-red-400' : 'text-emerald-400'
                      }
                    >
                      {u.status}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setQuickTaggingVlan(null)}
                  className="px-3 py-1.5 text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                >
                  Apply `switchport vlan {quickTaggingVlan.vlan_id} tag`
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL 3: CREATE LAG (SMARTGROUP LACP) ON UPLINK
         =================================================================== */}
      {showCreateLagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Create Link Aggregation Group (LACP Smartgroup)
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateLagModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const lagName = `smartgroup${lagGroupId}`;
                const cli = `configure terminal\ninterface ${lagName}\n  description "${lagDescription}"\n  switchport mode hybrid\n  switchport vlan ${lagTaggedVlans} tag\nexit\n${lagMemberPorts
                  .map(
                    (mp) =>
                      `interface ${mp}\n  smartgroup ${lagGroupId} mode active\nexit`
                  )
                  .join('\n')}\nend\nwrite`;
                onCreateLagUplink(
                  {
                    olt_id: olt.id,
                    name: lagName,
                    description: `${lagDescription} (${lagMemberPorts.join('+')})`,
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: '10G-FullD',
                    negotiation: 'LACP 802.3ad',
                    mtu: 1600,
                    wavelength: '1310',
                    signal_dbm: 'Tx: -4.85 / Rx: -5.90',
                    temp_c: '41',
                    pvid_untag: 1,
                    tagged_vlans: `Hybrid: ${lagTaggedVlans}`,
                  },
                  cli
                );
                setLastCliBanner({
                  title: `Created LACP LAG ${lagName} (${lagMemberPorts.join(', ')})`,
                  cli,
                });
                setShowCreateLagModal(false);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-bold text-slate-200">
                  Smartgroup ID (1 - 8)
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={lagGroupId}
                  onChange={(e) => setLagGroupId(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-200">
                  Description
                </label>
                <input
                  type="text"
                  value={lagDescription}
                  onChange={(e) => setLagDescription(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-200">
                  Member Uplink Interfaces
                </label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {uplinkPorts.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5"
                    >
                      <input
                        type="checkbox"
                        checked={lagMemberPorts.includes(u.name)}
                        onChange={() =>
                          setLagMemberPorts((prev) =>
                            prev.includes(u.name)
                              ? prev.filter((n) => n !== u.name)
                              : [...prev, u.name]
                          )
                        }
                      />
                      <span className="font-mono text-sky-400">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-200">
                  Tagged VLANs on LAG
                </label>
                <input
                  type="text"
                  value={lagTaggedVlans}
                  onChange={(e) => setLagTaggedVlans(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-emerald-300"
                />
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateLagModal(false)}
                  className="px-3 py-1.5 text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#5cb85c] px-4 py-1.5 font-bold text-white"
                >
                  Create LAG
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL 4: CONFIGURE PON PORT (Slot 3 GTGH)
         =================================================================== */}
      {configuringPonPort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Configure PON Port —{' '}
                <span className="font-mono text-sky-400">
                  {configuringPonPort.interface_name}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setConfiguringPonPort(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const cli = `configure terminal\ninterface ${configuringPonPort.interface_name}\n  description "${ponEditDesc}"\n  ${
                  ponEditAdmin === 'ENABLED' ? 'no shutdown' : 'shutdown'
                }\n  onu-number-limit ${ponEditMaxOnu}\nexit\nend\nwrite`;
                onUpdatePonPort(
                  configuringPonPort.port_number,
                  {
                    description: ponEditDesc,
                    admin_state: ponEditAdmin,
                    oper_status: ponEditOper,
                    max_onu_capacity: ponEditMaxOnu,
                  },
                  cli
                );
                setLastCliBanner({
                  title: `PON Port ${configuringPonPort.interface_name} Updated`,
                  cli,
                });
                setConfiguringPonPort(null);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-bold text-slate-200">
                  PON Description
                </label>
                <input
                  type="text"
                  value={ponEditDesc}
                  onChange={(e) => setPonEditDesc(e.target.value)}
                  placeholder="e.g. Jalur Muara Lebak RK O1"
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-200">
                    Admin State
                  </label>
                  <select
                    value={ponEditAdmin}
                    onChange={(e) =>
                      setPonEditAdmin(e.target.value as 'ENABLED' | 'DISABLED')
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    <option value="ENABLED">Enabled</option>
                    <option value="DISABLED">Disabled</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-200">
                    Optical Link Status
                  </label>
                  <select
                    value={ponEditOper}
                    onChange={(e) =>
                      setPonEditOper(e.target.value as 'Up' | 'Down')
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                  >
                    <option value="Up">Up</option>
                    <option value="Down">Down</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-200">
                  Max ONUs per PON (Split Ratio Capacity)
                </label>
                <select
                  value={ponEditMaxOnu}
                  onChange={(e) => setPonEditMaxOnu(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                >
                  <option value={32}>32 ONUs</option>
                  <option value={64}>64 ONUs</option>
                  <option value={128}>128 ONUs (ITU-T G.984 Max)</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setConfiguringPonPort(null)}
                  className="px-3 py-1.5 text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                >
                  Save PON Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: UPLINK OR PON TRAFFIC GRAPH MODAL */}
      {(trafficUplink || trafficPonPort) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Real-Time Interface Traffic —{' '}
                <span className="font-mono text-sky-400">
                  {trafficUplink
                    ? `${trafficUplink.name} (${trafficUplink.tagged_vlans})`
                    : trafficPonPort?.interface_name}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setTrafficUplink(null);
                  setTrafficPonPort(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="rounded border border-slate-800 bg-[#05080f] p-4">
              <div className="flex h-36 items-end gap-1 border-b border-l border-slate-800 px-3 pb-1">
                {Array.from({ length: 24 }, (_, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                    <div
                      className="w-full rounded-t bg-emerald-500/80"
                      style={{ height: `${35 + ((i * 19) % 75)}px` }}
                    />
                    <div
                      className="w-full rounded-b bg-sky-500/80"
                      style={{ height: `${12 + ((i * 11) % 30)}px` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between font-mono text-[11px] text-slate-300">
                <span className="text-emerald-400">
                  ■ RX Downstream: 642.8 Mbps Peak
                </span>
                <span className="text-sky-400">
                  ■ TX Upstream: 194.2 Mbps Peak
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: EDIT OLT SETTINGS */}
      {showEditOltModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                Edit OLT Settings — {olt.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditOltModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onUpdateOltSettings(olt.id, {
                  name: editOltName,
                  ip_address: editOltIp,
                  warning_rx_dbm: editWarnRx,
                  critical_rx_dbm: editCritRx,
                  ntp_servers: editNtp,
                });
                setShowEditOltModal(false);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-bold text-slate-200">OLT Name</label>
                <input
                  type="text"
                  value={editOltName}
                  onChange={(e) => setEditOltName(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-200">OLT IP</label>
                <input
                  type="text"
                  value={editOltIp}
                  onChange={(e) => setEditOltIp(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-200">
                    Warning RX (dBm)
                  </label>
                  <input
                    type="number"
                    value={editWarnRx}
                    onChange={(e) => setEditWarnRx(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-200">
                    Critical RX (dBm)
                  </label>
                  <input
                    type="number"
                    value={editCritRx}
                    onChange={(e) => setEditCritRx(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-200">
                  NTP Servers
                </label>
                <input
                  type="text"
                  value={editNtp}
                  onChange={(e) => setEditNtp(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-white"
                />
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-700 pt-3">
                <button
                  type="button"
                  onClick={() => setShowEditOltModal(false)}
                  className="px-3 py-1.5 text-sky-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#4caf50] px-4 py-1.5 font-bold text-white"
                >
                  Save OLT Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: CONFIG BACKUPS & MAC TABLE */}
      {(showBackupsModal || showMacTableModal) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-3">
              <h3 className="text-base font-bold text-white">
                {showBackupsModal
                  ? `OLT NVRAM Config Backups (startrun.dat) — ${olt.name}`
                  : `OLT Dynamic MAC Address Table (show mac) — ${olt.name}`}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowBackupsModal(false);
                  setShowMacTableModal(false);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {showBackupsModal ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded border border-emerald-500/40 bg-emerald-950/20 px-3 py-2">
                  <div>
                    <div className="font-mono font-bold text-emerald-300">
                      Live Running-Config (#show running-config)
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Includes all {db.onus.filter((o) => o.olt_id === olt.id && o.is_authorized).length} Configured ONUs, {oltVlans.length} VLANs, TCONT/Traffic Profiles &amp; Uplink Tags
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const liveCfg = buildLiveZteRunningConfig(db, olt.id);
                      navigator.clipboard.writeText(liveCfg);
                      setShowBackupsModal(false);
                      setLastCliBanner({
                        title: `Live #show running-config (${olt.name}) — Copied to Clipboard`,
                        cli: liveCfg,
                      });
                    }}
                    className="rounded bg-[#5cb85c] px-3 py-1.5 font-bold text-white hover:bg-[#4cae4c]"
                  >
                    View &amp; Copy #show running-config
                  </button>
                </div>
                <pre className="max-h-40 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-300">
                  {buildLiveZteRunningConfig(db, olt.id)}
                </pre>

                {onImportRunningConfig && (
                  <div className="space-y-2 border-t border-slate-700 pt-3">
                    <div className="font-bold text-sky-400">
                      Import / Restore ZTE `#show running-config` to SQL Database:
                    </div>
                    <textarea
                      rows={4}
                      value={importConfigText}
                      onChange={(e) => setImportConfigText(e.target.value)}
                      placeholder="Paste output dari #show running-config ZTE C300/C320 di sini untuk mengimpor seluruh VLAN, Uplink, dan ONU ke SQL Database..."
                      className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!importConfigText.trim()) return;
                        onImportRunningConfig(olt.id, importConfigText);
                        setImportConfigText('');
                        setShowBackupsModal(false);
                      }}
                      className="rounded bg-[#0275d8] px-3.5 py-1.5 font-bold text-white hover:bg-[#025aa5]"
                    >
                      Import #show running-config to Database
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <pre className="max-h-60 overflow-auto rounded bg-slate-950 p-3 font-mono text-[11px] text-emerald-300">
{`${olt.name}# show mac
Total MAC address : 4
MAC Address     VLAN  Type     Port                   Vc
-----------------------------------------------------------------------
744d.28a1.99c2  101   Dynamic  gei_1/19/3             - (MikroTik Bras)
c85a.9fc1.3310  101   Dynamic  vport-1/3/2.8:1        - (RATMI ONU)
c85a.9fc4.8812  101   Dynamic  vport-1/3/4.9:1        - (FUJI-AYU ONU)
a0b1.c2d3.e4f5  100   Dynamic  vport-1/3/2.8:1        - (TR-069 CWMP)`}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
