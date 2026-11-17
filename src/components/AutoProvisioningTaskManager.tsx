import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Copy,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  ShieldCheck,
  Clock,
  ChevronRight,
  ChevronLeft,
  Layers,
  Server,
  Wifi,
  MapPin,
  Globe,
  Network,
  FileText,
  History,
  Check,
  X,
  ArrowUpDown,
  Lock,
  Terminal,
  Activity,
} from 'lucide-react';
import {
  SmartOltDatabaseState,
  AutoProvisioningTaskRecord,
  AutoProvisioningHistoryRecord,
  TaskAuditLogRecord,
  OnuRecord,
} from '../services/mockDatabase';
import {
  generateAuthorizeCliScript,
  findNextAvailableOnuIndex,
  OnuModeOption,
  WanModeOption,
  ConfigMethodOption,
} from '../services/oltEngine';

// ============================================================================
// 1. HELPER ENGINE: VENDOR DETECTION, TASK MATCHING, CONFLICT & CLI BUILDER
// ============================================================================

export function detectOnuVendorFromSn(serialNumber: string, onuType?: string): string {
  const sn = (serialNumber || '').trim().toUpperCase();
  const model = (onuType || '').trim().toUpperCase();
  if (sn.startsWith('ZTEG') || model.startsWith('F6') || model.includes('ZTE')) return 'ZTE';
  if (sn.startsWith('HWTC') || sn.startsWith('HUAWEI') || model.startsWith('HG8') || model.startsWith('EG8')) return 'HUAWEI';
  if (sn.startsWith('FHTT') || model.startsWith('AN55')) return 'FIBERHOME';
  if (sn.startsWith('ALCL') || model.startsWith('G-')) return 'NOKIA';
  if (sn.startsWith('BDCM')) return 'BDCOM';
  if (sn.startsWith('VSOL')) return 'VSOL';
  if (sn.startsWith('CDAT')) return 'C-DATA';
  return 'ZTE';
}

export interface TaskMatchResult {
  matchedTask: AutoProvisioningTaskRecord | null;
  conflictTasks: AutoProvisioningTaskRecord[];
  conflictReason: string | null;
}

/**
 * Matches an Unconfigured ONU against all active Auto Provisioning Tasks
 * Enforces priority ordering & Task Conflict Detection when 2+ tasks share the same top priority
 */
export function matchAutoProvisioningTaskForOnu(
  onu: OnuRecord,
  tasks: AutoProvisioningTaskRecord[]
): TaskMatchResult {
  const activeTasks = (tasks || []).filter(
    (t) => t.status === 'ENABLED' && t.auto_provisioning
  );

  const detectedVendor = detectOnuVendorFromSn(onu.serial_number, onu.onu_type);
  const detectedModel = (onu.onu_type || 'ALL').trim().toUpperCase();

  const matching = activeTasks.filter((t) => {
    // 1. OLT must match
    if (t.olt_id !== onu.olt_id) return false;

    // 2. Board match (ALL wildcard or Specific Board)
    if (
      t.board_selection_mode === 'SPECIFIC' &&
      Array.isArray(t.selected_boards) &&
      !t.selected_boards.includes(onu.board)
    ) {
      return false;
    }

    // 3. PON match (ALL wildcard or Specific PON)
    if (
      t.pon_selection_mode === 'SPECIFIC' &&
      Array.isArray(t.selected_pons) &&
      !t.selected_pons.includes(onu.port)
    ) {
      return false;
    }

    // 4. ONU Vendor filter (if not ALL)
    if (
      t.onu_vendor &&
      t.onu_vendor.toUpperCase() !== 'ALL' &&
      t.onu_vendor.toUpperCase() !== detectedVendor
    ) {
      return false;
    }

    // 5. ONU Model filter (if not ALL)
    if (
      t.onu_model &&
      t.onu_model.toUpperCase() !== 'ALL' &&
      detectedModel !== 'ALL' &&
      t.onu_model.toUpperCase() !== detectedModel
    ) {
      return false;
    }

    return true;
  });

  if (matching.length === 0) {
    return { matchedTask: null, conflictTasks: [], conflictReason: null };
  }

  // Sort by priority ascending (1 = highest priority)
  const sorted = [...matching].sort((a, b) => a.priority - b.priority);
  const topPriority = sorted[0].priority;
  const sameTopPriority = sorted.filter((t) => t.priority === topPriority);

  if (sameTopPriority.length > 1) {
    // Task Conflict Detection: Multiple tasks share the exact same top priority
    const names = sameTopPriority.map((t) => `"${t.name}" (VLAN ${t.vlan_id})`).join(', ');
    return {
      matchedTask: null,
      conflictTasks: sameTopPriority,
      conflictReason: `Konflik Prioritas Task (Priority ${topPriority}): Ditemukan ${sameTopPriority.length} Task aktif dengan prioritas identik untuk OLT/Board/PON ini (${names}). Ubah prioritas salah satu Task terlebih dahulu.`,
    };
  }

  return {
    matchedTask: sorted[0],
    conflictTasks: [],
    conflictReason: null,
  };
}

/**
 * Validates an IPv4 address string
 */
export function isValidIpv4Address(ip: string): boolean {
  const trimmed = (ip || '').trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/**
 * Generates full ZTE C300/C320 CLI script for Task Auto Provisioning + Verification
 */
export function buildAutoTaskCliScript(params: {
  onu: OnuRecord;
  allocatedIndex: number;
  task: AutoProvisioningTaskRecord;
  db: SmartOltDatabaseState;
}): {
  cliScript: string;
  rollbackScript: string;
  pppoeUser: string;
  pppoePass: string;
  resolvedWifiSsid: string | null;
} {
  const { onu, allocatedIndex, task, db } = params;
  const olt = db.olts.find((o) => o.id === onu.olt_id);
  const speedProf =
    db.speed_profiles.find((s) => s.id === task.speed_profile_id) ||
    db.speed_profiles[0];
  const tcontProf =
    (task.dba_profile_id
      ? db.tcont_profiles.find((t) => t.id === task.dba_profile_id)
      : null) ||
    (speedProf
      ? db.tcont_profiles.find((t) => t.id === speedProf.tcont_profile_id)
      : null) ||
    db.tcont_profiles[0];
  const trProfile = task.tr069_enabled
    ? db.tr069_profiles.find((p) => p.id === task.tr069_profile_id) ||
      db.tr069_profiles[0]
    : null;

  const snLast4 = onu.serial_number.slice(-4).toUpperCase();
  const snFull = onu.serial_number.toUpperCase();
  const pppoeUser = (task.pppoe_username_template || 'AUTO-{{SN}}')
    .replace(/\{\{SN\}\}/gi, snFull)
    .replace(/\{\{SN4\}\}/gi, snLast4)
    .replace(/\{\{PORT\}\}/gi, `${onu.board}-${onu.port}-${allocatedIndex}`);
  const pppoePass = task.pppoe_password_default || 'jetcyber123';
  const resolvedWifiSsid = task.wifi_enabled
    ? `${(task.wifi_ssid_prefix || 'JETCYBER-').replace(/\{\{SN4\}\}/gi, snLast4)}${
        (task.wifi_ssid_prefix || '').includes('{{SN4}}') ? '' : snLast4
      }`
    : null;

  const baseCli = generateAuthorizeCliScript({
    firmwareVersion: olt?.firmware_version || 'V2.1.0',
    ponInterface: `gpon-olt_1/${onu.board}/${onu.port}`,
    onuIndex: allocatedIndex,
    onuType:
      task.onu_model && task.onu_model !== 'ALL'
        ? task.onu_model
        : onu.onu_type && onu.onu_type !== 'ALL'
        ? onu.onu_type
        : 'ALL',
    serialNumber: onu.serial_number,
    customerName: `AUTO-${snLast4}`,
    address: `Task:${task.name}`,
    vlanId: task.vlan_id,
    tcontProfile: tcontProf?.profile_name || 'SMARTOLT-1G-UP',
    speedProfile: speedProf?.profile_name || 'SMARTOLT-1G-DOWN',
    onuMode: task.onu_profile_mode,
    wanMode: task.service_profile,
    enableNat: task.enable_nat,
    configMethod: task.tr069_enabled ? 'TR069' : task.config_method,
    pppoeUsername: pppoeUser,
    pppoePassword: pppoePass,
    wanRemoteAccess: 'Enabled from everywhere in the internet',
    tr069Enabled: task.tr069_enabled,
    tr069AcsUrl: trProfile?.acs_url || 'http://10.69.69.1:14501',
    tr069AcsUsername: trProfile?.acs_username || 'acsNet',
    tr069AcsPassword: trProfile?.acs_password || 'acsNet@2024',
    tr069MgmtVlanId:
      task.mgmt_vlan_id || trProfile?.mgmt_vlan_id || task.vlan_id || 100,
    tr069Priority: trProfile?.vlan_priority ?? 2,
    wifiSsid: resolvedWifiSsid || undefined,
    wifiPassword: task.wifi_enabled ? task.wifi_password : undefined,
  });

  // Append Management IP & TR-069 connection request / inform interval + verification commands
  const extraMngLines: string[] = [];
  if (task.mgmt_ip_mode !== 'INACTIVE' || task.tr069_enabled) {
    extraMngLines.push(
      `configure terminal`,
      `pon-onu-mng gpon-onu_1/${onu.board}/${onu.port}:${allocatedIndex}`
    );
    const mgmtVlan = task.mgmt_vlan_id || task.vlan_id || 100;
    if (task.mgmt_ip_mode === 'DHCP') {
      extraMngLines.push(
        `  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable`,
        `  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 2 pri 2 vlan ${mgmtVlan}`
      );
    } else if (task.mgmt_ip_mode === 'STATIC' && task.mgmt_ip_address) {
      extraMngLines.push(
        `  ip-host 2 ip ${task.mgmt_ip_address} mask ${task.mgmt_subnet_mask || '255.255.255.0'} gateway ${task.mgmt_gateway || '0.0.0.0'}`,
        `  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 2 pri 2 vlan ${mgmtVlan}`
      );
    }
    if (task.tr069_enabled && trProfile) {
      extraMngLines.push(
        `  tr069-mgmt 1 state unlock`,
        `  tr069-mgmt 1 acs ${trProfile.acs_url} validate basic username ${trProfile.acs_username} password ${trProfile.acs_password}`,
        `  tr069-mgmt 1 tag pri ${trProfile.vlan_priority ?? 2} vlan ${mgmtVlan}`
      );
    }
    extraMngLines.push(`exit`, `exit`);
  }

  // Verification commands on OLT
  const verifyCommands = [
    `show gpon onu detail-info gpon-onu_1/${onu.board}/${onu.port}:${allocatedIndex}`,
    `show running-config interface gpon-onu_1/${onu.board}/${onu.port}:${allocatedIndex}`,
  ];

  const fullCli = [
    baseCli.trim(),
    ...(extraMngLines.length > 0 ? extraMngLines : []),
    ...verifyCommands,
  ].join('\n');

  const rollbackScript = [
    `configure terminal`,
    `interface gpon-olt_1/${onu.board}/${onu.port}`,
    `  no onu ${allocatedIndex}`,
    `exit`,
    `exit`,
  ].join('\n');

  return {
    cliScript: fullCli,
    rollbackScript,
    pppoeUser,
    pppoePass,
    resolvedWifiSsid,
  };
}

/**
 * Verifies OLT CLI response to make sure provisioning truly succeeded on the OLT
 */
export function verifyOltProvisioningOutput(
  oltResponse: string,
  serialNumber: string,
  allocatedIndex: number
): { verified: boolean; reason: string | null; verificationSnippet: string } {
  const raw = (oltResponse || '').trim();
  if (!raw) {
    return {
      verified: false,
      reason: 'OLT tidak mengembalikan respon CLI (Empty response).',
      verificationSnippet: 'No output returned from OLT.',
    };
  }

  const errorPattern =
    /(?:%\s*Error|%\s*Invalid|%\s*Incomplete|%\s*Ambiguous|Error:\s*[^\r\n]+|authentication\s+failed|connection\s+refused|timed?\s*out)/i;
  const errMatch = raw.match(errorPattern);
  if (errMatch) {
    return {
      verified: false,
      reason: `OLT menolak perintah konfigurasi: ${errMatch[0]}`,
      verificationSnippet: raw.slice(-600),
    };
  }

  const snUpper = serialNumber.toUpperCase();
  const hasSnOrOnuConfirmed =
    raw.toUpperCase().includes(snUpper) ||
    new RegExp(`onu\\s+${allocatedIndex}\\b`, 'i').test(raw) ||
    /Phase\s+state\s*:/i.test(raw) ||
    /pon-onu-mng/i.test(raw);

  if (!hasSnOrOnuConfirmed) {
    return {
      verified: false,
      reason: `Verifikasi OLT gagal: Konfigurasi ONU #${allocatedIndex} (${snUpper}) tidak ditemukan pada running-config OLT.`,
      verificationSnippet: raw.slice(-600),
    };
  }

  return {
    verified: true,
    reason: null,
    verificationSnippet: raw.slice(-800),
  };
}

// ============================================================================
// 2. MAIN UI COMPONENT: AUTO PROVISIONING TASK MANAGER & 7-STEP WIZARD
// ============================================================================

interface AutoProvisioningTaskManagerProps {
  db: SmartOltDatabaseState;
  setDb: React.Dispatch<React.SetStateAction<SmartOltDatabaseState>>;
  isReadOnlyViewer: boolean;
  currentUsername: string;
  unconfiguredOnus: OnuRecord[];
  isRunningAutoEngine: boolean;
  onRunAutoProvisioningNow: (specificOnu?: OnuRecord, forceTaskId?: number) => Promise<void>;
  onRetryFailedRecord: (historyRecord: AutoProvisioningHistoryRecord) => Promise<void>;
  initialSubTab?: 'TASKS' | 'HISTORY' | 'FAILED' | 'AUDIT';
  openWizardSignal?: number;
  compactMode?: boolean;
}

const VENDOR_OPTIONS = ['ALL', 'ZTE', 'HUAWEI', 'FIBERHOME', 'NOKIA', 'VSOL', 'C-DATA', 'BDCOM'];
const MODEL_OPTIONS = [
  'ALL',
  'F670LV9.0',
  'F609V3.0',
  'F660V8.0',
  'F660',
  'F601',
  'HG8245H',
  'HG8245H5',
  'EG8145V5',
  'AN5506-04-FA',
];

export const AutoProvisioningTaskManager: React.FC<AutoProvisioningTaskManagerProps> = ({
  db,
  setDb,
  isReadOnlyViewer,
  currentUsername,
  unconfiguredOnus,
  isRunningAutoEngine,
  onRunAutoProvisioningNow,
  onRetryFailedRecord,
  initialSubTab = 'TASKS',
  openWizardSignal,
  compactMode = false,
}) => {
  const [subTab, setSubTab] = useState<'TASKS' | 'HISTORY' | 'FAILED' | 'AUDIT'>(initialSubTab);

  // Filters & Pagination for Task Dashboard
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOltId, setFilterOltId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterVlanId, setFilterVlanId] = useState<string>('ALL');
  const [sortByPriorityAsc, setSortByPriorityAsc] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 8;

  // History Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');

  // Modals
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [editingTask, setEditingTask] = useState<AutoProvisioningTaskRecord | null>(null);
  const [viewingTask, setViewingTask] = useState<AutoProvisioningTaskRecord | null>(null);
  const [deletingTask, setDeletingTask] = useState<AutoProvisioningTaskRecord | null>(null);
  const [viewingHistoryDetail, setViewingHistoryDetail] =
    useState<AutoProvisioningHistoryRecord | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [toastBanner, setToastBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  // Searchable dropdown filter states inside Wizard
  const [vlanDropdownSearch, setVlanDropdownSearch] = useState('');
  const [zoneDropdownSearch, setZoneDropdownSearch] = useState('');

  // Open wizard when parent triggers openWizardSignal
  React.useEffect(() => {
    if (openWizardSignal && openWizardSignal > 0 && !isReadOnlyViewer) {
      handleOpenAddWizard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWizardSignal]);

  const tasks = db.auto_provisioning_tasks || [];
  const historyList = db.auto_provisioning_history || [];
  const auditLogs = db.task_audit_logs || [];

  const defaultOltId = db.olts[0]?.id || 1;
  const defaultVlanNum =
    db.vlans.find((v) => v.olt_id === defaultOltId)?.vlan_id ||
    db.vlans[0]?.vlan_id ||
    101;
  const defaultSpeedId = db.speed_profiles[0]?.id || 1;
  const defaultDbaId = db.tcont_profiles[0]?.id || 1;
  const defaultTr069Profile = db.tr069_profiles[0] || null;

  const [formData, setFormData] = useState<Omit<AutoProvisioningTaskRecord, 'id' | 'created_at' | 'updated_at'>>({
    name: '',
    description: '',
    olt_id: defaultOltId,
    priority: Math.max(1, tasks.length + 1),
    status: 'ENABLED',
    auto_provisioning: true,
    vlan_id: defaultVlanNum,
    board_selection_mode: 'ALL',
    selected_boards: [],
    pon_selection_mode: 'ALL',
    selected_pons: [],
    onu_vendor: 'ALL',
    onu_model: 'ALL',
    onu_profile_mode: 'Routing',
    config_method: 'OMCI',
    service_profile: 'PPPOE',
    enable_nat: true,
    pppoe_username_template: 'AUTO-{{SN}}',
    pppoe_password_default: 'jetcyber123',
    speed_profile_id: defaultSpeedId,
    dba_profile_id: defaultDbaId,
    wifi_enabled: false,
    wifi_ssid_prefix: 'JETCYBER-{{SN4}}',
    wifi_password: 'password123',
    zone_id: null,
    odb_id: null,
    odb_port_mode: 'AUTO',
    odb_port: null,
    tr069_enabled: false,
    tr069_profile_id: defaultTr069Profile?.id || null,
    tr069_conn_req_username: defaultTr069Profile?.connection_request_username || 'smartolt-cpe',
    tr069_conn_req_password: defaultTr069Profile?.connection_request_password || 'smartolt-req',
    tr069_inform_interval: defaultTr069Profile?.periodic_inform_interval || 300,
    mgmt_ip_mode: 'DHCP',
    mgmt_vlan_id: defaultTr069Profile?.mgmt_vlan_id || defaultVlanNum,
    mgmt_ip_address: '',
    mgmt_subnet_mask: '255.255.255.0',
    mgmt_gateway: '',
    mgmt_dns1: '8.8.8.8',
    mgmt_dns2: '8.8.4.4',
    created_by: currentUsername,
  });

  const showToast = (type: 'success' | 'error' | 'warning', text: string) => {
    setToastBanner({ type, text });
    setTimeout(() => {
      setToastBanner((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Dependent Data for Wizard Step 2 (OLT -> VLANs, Boards, PON Ports)
  const oltVlans = useMemo(() => {
    const list = db.vlans.filter((v) => v.olt_id === formData.olt_id);
    return list.length > 0 ? list : db.vlans;
  }, [db.vlans, formData.olt_id]);

  const filteredOltVlans = useMemo(() => {
    if (!vlanDropdownSearch.trim()) return oltVlans;
    const q = vlanDropdownSearch.toLowerCase();
    return oltVlans.filter(
      (v) =>
        String(v.vlan_id).includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (v.description || '').toLowerCase().includes(q)
    );
  }, [oltVlans, vlanDropdownSearch]);

  const availableBoardsForOlt = useMemo(() => {
    const boardSet = new Set<number>();
    db.olt_cards
      .filter((c) => c.olt_id === formData.olt_id && /^GTG|^GPON/i.test(c.type))
      .forEach((c) => boardSet.add(c.slot));
    db.pon_ports
      .filter((p) => p.olt_id === formData.olt_id)
      .forEach((p) => boardSet.add(p.slot));
    db.onus
      .filter((u) => u.olt_id === formData.olt_id)
      .forEach((u) => boardSet.add(u.board));
    if (boardSet.size === 0) {
      boardSet.add(2);
      boardSet.add(3);
    }
    return Array.from(boardSet).sort((a, b) => a - b);
  }, [db.olt_cards, db.pon_ports, db.onus, formData.olt_id]);

  const availablePonsForSelection = useMemo(() => {
    const ponSet = new Set<number>();
    const targetBoards =
      formData.board_selection_mode === 'ALL'
        ? availableBoardsForOlt
        : formData.selected_boards;

    db.pon_ports
      .filter(
        (p) =>
          p.olt_id === formData.olt_id &&
          (targetBoards.length === 0 || targetBoards.includes(p.slot))
      )
      .forEach((p) => ponSet.add(p.port_number));

    db.olt_cards
      .filter(
        (c) =>
          c.olt_id === formData.olt_id &&
          /^GTG|^GPON/i.test(c.type) &&
          (targetBoards.length === 0 || targetBoards.includes(c.slot))
      )
      .forEach((c) => {
        const count = c.ports || 16;
        for (let i = 1; i <= count; i++) ponSet.add(i);
      });

    if (ponSet.size === 0) {
      for (let i = 1; i <= 16; i++) ponSet.add(i);
    }
    return Array.from(ponSet).sort((a, b) => a - b);
  }, [
    db.pon_ports,
    db.olt_cards,
    formData.olt_id,
    formData.board_selection_mode,
    formData.selected_boards,
    availableBoardsForOlt,
  ]);

  // Dependent Data for Wizard Step 4 (Zone -> Splitter ODP -> Splitter Port)
  const filteredZones = useMemo(() => {
    if (!zoneDropdownSearch.trim()) return db.zones;
    const q = zoneDropdownSearch.toLowerCase();
    return db.zones.filter(
      (z) =>
        z.name.toLowerCase().includes(q) ||
        z.code.toLowerCase().includes(q)
    );
  }, [db.zones, zoneDropdownSearch]);

  const availableSplittersForZone = useMemo(() => {
    if (!formData.zone_id) return [];
    return db.odbs.filter((o) => o.zone_id === formData.zone_id);
  }, [db.odbs, formData.zone_id]);

  const selectedSplitterObj = useMemo(() => {
    if (!formData.odb_id) return null;
    return db.odbs.find((o) => o.id === formData.odb_id) || null;
  }, [db.odbs, formData.odb_id]);

  const occupiedPortsInSplitter = useMemo(() => {
    if (!formData.odb_id) return new Set<number>();
    const used = new Set<number>();
    db.onus
      .filter((u) => u.odb_id === formData.odb_id && u.odb_port !== null)
      .forEach((u) => {
        if (u.odb_port) used.add(u.odb_port);
      });
    return used;
  }, [db.onus, formData.odb_id]);

  // Open Wizard for New Task
  const handleOpenAddWizard = () => {
    if (isReadOnlyViewer) return;
    const firstOltId = db.olts[0]?.id || 1;
    const firstVlan =
      db.vlans.find((v) => v.olt_id === firstOltId)?.vlan_id ||
      db.vlans[0]?.vlan_id ||
      101;
    const firstTr069 = db.tr069_profiles[0] || null;
    setEditingTask(null);
    setWizardStep(1);
    setWizardError(null);
    setFormData({
      name: `AUTO-TASK-OLT${firstOltId}-${tasks.length + 1}`,
      description: 'Auto Provisioning Task untuk ONU baru',
      olt_id: firstOltId,
      priority: Math.max(1, tasks.length + 1),
      status: 'ENABLED',
      auto_provisioning: true,
      vlan_id: firstVlan,
      board_selection_mode: 'ALL',
      selected_boards: [],
      pon_selection_mode: 'ALL',
      selected_pons: [],
      onu_vendor: 'ALL',
      onu_model: 'ALL',
      onu_profile_mode: 'Routing',
      config_method: 'OMCI',
      service_profile: 'PPPOE',
      enable_nat: true,
      pppoe_username_template: 'AUTO-{{SN}}',
      pppoe_password_default: 'jetcyber123',
      speed_profile_id: db.speed_profiles[0]?.id || 1,
      dba_profile_id: db.tcont_profiles[0]?.id || null,
      wifi_enabled: false,
      wifi_ssid_prefix: 'JETCYBER-{{SN4}}',
      wifi_password: 'password123',
      zone_id: db.zones[0]?.id || null,
      odb_id: null,
      odb_port_mode: 'AUTO',
      odb_port: null,
      tr069_enabled: false,
      tr069_profile_id: firstTr069?.id || null,
      tr069_conn_req_username: firstTr069?.connection_request_username || 'smartolt-cpe',
      tr069_conn_req_password: firstTr069?.connection_request_password || 'smartolt-req',
      tr069_inform_interval: firstTr069?.periodic_inform_interval || 300,
      mgmt_ip_mode: 'DHCP',
      mgmt_vlan_id: firstTr069?.mgmt_vlan_id || firstVlan,
      mgmt_ip_address: '',
      mgmt_subnet_mask: '255.255.255.0',
      mgmt_gateway: '',
      mgmt_dns1: '8.8.8.8',
      mgmt_dns2: '8.8.4.4',
      created_by: currentUsername,
    });
    setShowWizardModal(true);
  };

  // Open Wizard for Edit Task
  const handleOpenEditWizard = (task: AutoProvisioningTaskRecord) => {
    if (isReadOnlyViewer) return;
    setEditingTask(task);
    setWizardStep(1);
    setWizardError(null);
    const { id: _unusedId, created_at: _c, updated_at: _u, ...rest } = task;
    setFormData(rest);
    setShowWizardModal(true);
  };

  // Validate a specific step before proceeding
  const validateStep = (step: number): string | null => {
    if (step === 1) {
      if (!formData.name.trim()) return 'Nama Task (Task Name) wajib diisi.';
      if (!formData.olt_id) return 'Pilih OLT terlebih dahulu.';
      if (!Number.isInteger(formData.priority) || formData.priority < 1) {
        return 'Prioritas Task harus berupa angka bulat positif (1 = Tertinggi).';
      }
    }
    if (step === 2) {
      if (!formData.vlan_id) return 'Pilih VLAN ID dari daftar VLAN Inventory.';
      if (
        formData.board_selection_mode === 'SPECIFIC' &&
        formData.selected_boards.length === 0
      ) {
        return 'Pilih minimal 1 Board jika menggunakan mode Specific Board.';
      }
      if (
        formData.pon_selection_mode === 'SPECIFIC' &&
        formData.selected_pons.length === 0
      ) {
        return 'Pilih minimal 1 PON Port jika menggunakan mode Specific PON.';
      }
    }
    if (step === 3) {
      if (!formData.speed_profile_id) return 'Pilih Speed Profile terlebih dahulu.';
      if (formData.wifi_enabled && formData.wifi_password.trim().length < 8) {
        return 'Password WiFi minimal 8 karakter.';
      }
    }
    if (step === 4) {
      if (formData.odb_id && formData.zone_id) {
        const odb = db.odbs.find((o) => o.id === formData.odb_id);
        if (odb && odb.zone_id !== formData.zone_id) {
          return 'Splitter yang dipilih tidak sesuai dengan Zone. Silakan pilih ulang.';
        }
        if (
          odb &&
          formData.odb_port_mode === 'SPECIFIC' &&
          (!formData.odb_port ||
            formData.odb_port < 1 ||
            formData.odb_port > odb.total_ports)
        ) {
          return `Pilih nomor Splitter Port yang valid (1 s/d ${odb.total_ports}).`;
        }
      }
    }
    if (step === 5) {
      if (formData.tr069_enabled) {
        if (!formData.tr069_profile_id) {
          return 'Pilih ACS Profile karena fitur TR-069 diaktifkan.';
        }
        if (formData.tr069_inform_interval < 10) {
          return 'Inform Interval minimal 10 detik.';
        }
      }
    }
    if (step === 6) {
      if (formData.mgmt_ip_mode === 'STATIC') {
        if (!isValidIpv4Address(formData.mgmt_ip_address)) {
          return 'IP Address Management Static tidak valid (contoh: 10.69.10.25).';
        }
        if (!isValidIpv4Address(formData.mgmt_subnet_mask)) {
          return 'Subnet Mask tidak valid (contoh: 255.255.255.0).';
        }
        if (!isValidIpv4Address(formData.mgmt_gateway)) {
          return 'Gateway IP tidak valid (contoh: 10.69.10.1).';
        }
        if (formData.mgmt_dns1 && !isValidIpv4Address(formData.mgmt_dns1)) {
          return 'Primary DNS tidak valid.';
        }
        if (formData.mgmt_dns2 && !isValidIpv4Address(formData.mgmt_dns2)) {
          return 'Secondary DNS tidak valid.';
        }
      }
    }
    return null;
  };

  const handleNextStep = () => {
    const err = validateStep(wizardStep);
    if (err) {
      setWizardError(err);
      return;
    }
    setWizardError(null);
    setWizardStep((prev) => Math.min(7, prev + 1));
  };

  const handleSaveTask = (saveAsDraft: boolean) => {
    if (isReadOnlyViewer) return;
    // Validate all 6 steps if activating
    if (!saveAsDraft) {
      for (let s = 1; s <= 6; s++) {
        const err = validateStep(s);
        if (err) {
          setWizardError(`Step ${s}: ${err}`);
          setWizardStep(s);
          return;
        }
      }
    } else if (!formData.name.trim()) {
      setWizardError('Nama Task wajib diisi sebelum menyimpan Draft.');
      setWizardStep(1);
      return;
    }

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const finalStatus: AutoProvisioningTaskRecord['status'] = saveAsDraft
      ? 'DRAFT'
      : formData.status === 'DRAFT'
      ? 'ENABLED'
      : formData.status;

    setDb((prev) => {
      const existingTasks = prev.auto_provisioning_tasks || [];
      const existingAudits = prev.task_audit_logs || [];
      let updatedTasks: AutoProvisioningTaskRecord[];
      let auditEntry: TaskAuditLogRecord;

      if (editingTask) {
        const updatedRecord: AutoProvisioningTaskRecord = {
          ...formData,
          id: editingTask.id,
          status: finalStatus,
          created_at: editingTask.created_at,
          updated_at: nowStr,
        };
        updatedTasks = existingTasks.map((t) =>
          t.id === editingTask.id ? updatedRecord : t
        );
        auditEntry = {
          id: Date.now(),
          timestamp: nowStr,
          task_id: editingTask.id,
          task_name: updatedRecord.name,
          action: 'UPDATED',
          actor: currentUsername,
          details: `Task diperbarui (Status: ${finalStatus}, Priority: ${updatedRecord.priority}, VLAN: ${updatedRecord.vlan_id})`,
        };
      } else {
        const newId =
          existingTasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
        const newRecord: AutoProvisioningTaskRecord = {
          ...formData,
          id: newId,
          status: finalStatus,
          created_at: nowStr,
          updated_at: nowStr,
        };
        updatedTasks = [newRecord, ...existingTasks];
        auditEntry = {
          id: Date.now(),
          timestamp: nowStr,
          task_id: newId,
          task_name: newRecord.name,
          action: 'CREATED',
          actor: currentUsername,
          details: `Task baru dibuat (${saveAsDraft ? 'Draft' : 'Active'}, OLT ID: ${newRecord.olt_id}, VLAN: ${newRecord.vlan_id})`,
        };
      }

      return {
        ...prev,
        auto_provisioning_tasks: updatedTasks,
        task_audit_logs: [auditEntry, ...existingAudits].slice(0, 300),
      };
    });

    setShowWizardModal(false);
    showToast(
      'success',
      editingTask
        ? `Task "${formData.name}" berhasil diperbarui.`
        : saveAsDraft
        ? `Task "${formData.name}" disimpan sebagai Draft.`
        : `Task "${formData.name}" berhasil disimpan & diaktifkan!`
    );
  };

  const handleToggleTaskStatus = (task: AutoProvisioningTaskRecord) => {
    if (isReadOnlyViewer) return;
    const nextStatus: AutoProvisioningTaskRecord['status'] =
      task.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    setDb((prev) => ({
      ...prev,
      auto_provisioning_tasks: (prev.auto_provisioning_tasks || []).map((t) =>
        t.id === task.id ? { ...t, status: nextStatus, updated_at: nowStr } : t
      ),
      task_audit_logs: [
        {
          id: Date.now(),
          timestamp: nowStr,
          task_id: task.id,
          task_name: task.name,
          action: nextStatus === 'ENABLED' ? ('ENABLED' as const) : ('DISABLED' as const),
          actor: currentUsername,
          details: `Status Task diubah dari ${task.status} menjadi ${nextStatus}.`,
        },
        ...(prev.task_audit_logs || []),
      ].slice(0, 300),
    }));

    showToast(
      'success',
      `Task "${task.name}" berhasil di-${nextStatus === 'ENABLED' ? 'aktifkan' : 'nonaktifkan'}.`
    );
  };

  const handleDuplicateTask = (task: AutoProvisioningTaskRecord) => {
    if (isReadOnlyViewer) return;
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    setDb((prev) => {
      const existing = prev.auto_provisioning_tasks || [];
      const newId = existing.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      const duplicated: AutoProvisioningTaskRecord = {
        ...task,
        id: newId,
        name: `${task.name} (Copy)`,
        priority: task.priority + 1,
        status: 'DISABLED',
        created_by: currentUsername,
        created_at: nowStr,
        updated_at: nowStr,
      };
      return {
        ...prev,
        auto_provisioning_tasks: [duplicated, ...existing],
        task_audit_logs: [
          {
            id: Date.now(),
            timestamp: nowStr,
            task_id: newId,
            task_name: duplicated.name,
            action: 'DUPLICATED' as const,
            actor: currentUsername,
            details: `Task diduplikasi dari "${task.name}" (ID #${task.id}).`,
          },
          ...(prev.task_audit_logs || []),
        ].slice(0, 300),
      };
    });
    showToast('success', `Task "${task.name}" berhasil diduplikasi.`);
  };

  const handleConfirmDeleteTask = () => {
    if (!deletingTask || isReadOnlyViewer) return;
    const target = deletingTask;
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    setDb((prev) => ({
      ...prev,
      auto_provisioning_tasks: (prev.auto_provisioning_tasks || []).filter(
        (t) => t.id !== target.id
      ),
      task_audit_logs: [
        {
          id: Date.now(),
          timestamp: nowStr,
          task_id: target.id,
          task_name: target.name,
          action: 'DELETED' as const,
          actor: currentUsername,
          details: `Task "${target.name}" dihapus permanen.`,
        },
        ...(prev.task_audit_logs || []),
      ].slice(0, 300),
    }));
    setDeletingTask(null);
    showToast('warning', `Task "${target.name}" telah dihapus.`);
  };

  // Filtered & Sorted Tasks for Table
  const filteredTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (filterOltId !== 'ALL' && t.olt_id !== Number(filterOltId)) return false;
        if (filterStatus !== 'ALL' && t.status !== filterStatus) return false;
        if (filterVlanId !== 'ALL' && t.vlan_id !== Number(filterVlanId)) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const oltName =
            db.olts.find((o) => o.id === t.olt_id)?.name.toLowerCase() || '';
          return (
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            oltName.includes(q) ||
            String(t.vlan_id).includes(q)
          );
        }
        return true;
      })
      .sort((a, b) =>
        sortByPriorityAsc ? a.priority - b.priority : b.priority - a.priority
      );
  }, [tasks, filterOltId, filterStatus, filterVlanId, searchQuery, sortByPriorityAsc, db.olts]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, currentPage]);

  const failedHistoryRecords = useMemo(
    () => historyList.filter((h) => h.status === 'FAILED'),
    [historyList]
  );

  const filteredHistoryRecords = useMemo(() => {
    const source = subTab === 'FAILED' ? failedHistoryRecords : historyList;
    return source.filter((h) => {
      if (
        subTab !== 'FAILED' &&
        historyStatusFilter !== 'ALL' &&
        h.status !== historyStatusFilter
      ) {
        return false;
      }
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase();
        return (
          h.serial_number.toLowerCase().includes(q) ||
          h.task_name.toLowerCase().includes(q) ||
          h.olt_name.toLowerCase().includes(q) ||
          (h.error_message || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [subTab, failedHistoryRecords, historyList, historyStatusFilter, historySearch]);

  // Helper labels
  const getOltName = (oltId: number) =>
    db.olts.find((o) => o.id === oltId)?.name || `OLT #${oltId}`;
  const getSpeedName = (speedId: number) =>
    db.speed_profiles.find((s) => s.id === speedId)?.profile_name || '-';

  return (
    <div className="space-y-4 text-slate-100">
      {/* Notification Toast Banner */}
      {toastBanner && (
        <div
          className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-semibold shadow-sm ${
            toastBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : toastBanner.type === 'warning'
              ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toastBanner.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{toastBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastBanner(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Navigation & Summary Bar */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800/90 shadow-sm p-3.5 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 shrink-0">
              <Layers className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                SmartOLT Auto ONU Provisioning Engine
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Otomatisasi konfigurasi Unconfigured ONU berbasis Task, Priority Matching, Conflict Detection &amp; Verifikasi OLT
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnlyViewer && (
              <>
                <button
                  type="button"
                  onClick={() => onRunAutoProvisioningNow()}
                  disabled={isRunningAutoEngine || unconfiguredOnus.length === 0}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-xs transition-all cursor-pointer whitespace-nowrap"
                >
                  {isRunningAutoEngine ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isRunningAutoEngine
                      ? 'Memproses Auto Provisioning...'
                      : `Jalankan Auto Provisioning (${unconfiguredOnus.length} ONU)`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenAddWizard}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition-all cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Task</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sub-Menu Tabs (Responsive horizontal scroll on mobile) */}
        <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-slate-800/80 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSubTab('TASKS')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              subTab === 'TASKS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Auto Configuration Tasks</span>
            <span
              className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                subTab === 'TASKS'
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-700 text-slate-200'
              }`}
            >
              {tasks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('HISTORY')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              subTab === 'HISTORY'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Provisioning History</span>
            <span
              className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                subTab === 'HISTORY'
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-700 text-slate-200'
              }`}
            >
              {historyList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('FAILED')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              subTab === 'FAILED'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Failed Provisioning</span>
            <span
              className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                subTab === 'FAILED'
                  ? 'bg-rose-800 text-white'
                  : failedHistoryRecords.length > 0
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'bg-slate-700 text-slate-200'
              }`}
            >
              {failedHistoryRecords.length}
            </span>
          </button>

          {!compactMode && (
            <button
              type="button"
              onClick={() => setSubTab('AUDIT')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                subTab === 'AUDIT'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Task Audit Log</span>
              <span
                className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  subTab === 'AUDIT'
                    ? 'bg-blue-800 text-white'
                    : 'bg-slate-700 text-slate-200'
                }`}
              >
                {auditLogs.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: TASK MANAGEMENT DASHBOARD                                     */}
      {/* ==================================================================== */}
      {subTab === 'TASKS' && (
        <div className="bg-slate-900/80 rounded-xl border border-slate-800/90 shadow-sm overflow-hidden">
          {/* Search & Filters */}
          <div className="p-3.5 sm:p-4 border-b border-slate-800/80 bg-slate-900/50 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="relative flex-1 lg:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Cari Task Name, OLT, atau VLAN..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
              <select
                value={filterOltId}
                onChange={(e) => {
                  setFilterOltId(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-200 font-medium"
              >
                <option value="ALL">Semua OLT</option>
                {db.olts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-200 font-medium"
              >
                <option value="ALL">Semua Status</option>
                <option value="ENABLED">Enabled (Active)</option>
                <option value="DISABLED">Disabled</option>
                <option value="DRAFT">Draft</option>
              </select>

              <select
                value={filterVlanId}
                onChange={(e) => {
                  setFilterVlanId(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-200 font-medium"
              >
                <option value="ALL">Semua VLAN</option>
                {Array.from(new Set(db.vlans.map((v) => v.vlan_id)))
                  .sort((a, b) => a - b)
                  .map((vid) => (
                    <option key={vid} value={vid}>
                      VLAN {vid}
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={() => setSortByPriorityAsc((prev) => !prev)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-950 border border-slate-700/80 rounded-lg text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                <span>Priority ({sortByPriorityAsc ? '1 → 9' : '9 → 1'})</span>
              </button>
            </div>
          </div>

          {/* Mobile Card View (< md) */}
          <div className="md:hidden divide-y divide-slate-800/80">
            {paginatedTasks.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                Belum ada Auto Configuration Task. Klik <strong>+ Add New Task</strong> untuk membuat aturan baru.
              </div>
            ) : (
              paginatedTasks.map((task) => (
                <div key={task.id} className="p-3.5 space-y-2.5 hover:bg-slate-800/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-800 border border-slate-700 text-xs font-bold text-sky-400">
                        #{task.priority}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-white">{task.name}</div>
                        <div className="text-[11px] text-slate-400">{getOltName(task.olt_id)}</div>
                      </div>
                    </div>
                    {task.status === 'ENABLED' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    ) : task.status === 'DRAFT' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                        Draft
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-bold">
                        Disabled
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                    <div>
                      <span className="text-slate-500 block">VLAN &amp; Target</span>
                      <span className="font-semibold text-sky-300">VLAN {task.vlan_id}</span>
                      <span className="text-slate-400">
                        {' '}•{' '}
                        {task.board_selection_mode === 'ALL'
                          ? 'All Board'
                          : `B:${task.selected_boards.join(',')}`}{' '}
                        /{' '}
                        {task.pon_selection_mode === 'ALL'
                          ? 'All PON'
                          : `P:${task.selected_pons.join(',')}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Profile &amp; Speed</span>
                      <span className="font-semibold text-slate-200">
                        {task.service_profile} • {getSpeedName(task.speed_profile_id)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-mono text-slate-500">{task.created_at}</span>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setViewingTask(task)}
                        className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {!isReadOnlyViewer && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditWizard(task)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-sky-400"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateTask(task)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-indigo-400"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleTaskStatus(task)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                              task.status === 'ENABLED'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            }`}
                          >
                            {task.status === 'ENABLED' ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTask(task)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Task Table (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/90 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Task Name</th>
                  <th className="py-3 px-4">OLT</th>
                  <th className="py-3 px-4">VLAN</th>
                  <th className="py-3 px-4">Board</th>
                  <th className="py-3 px-4">PON</th>
                  <th className="py-3 px-4">ONU Profile</th>
                  <th className="py-3 px-4">Service Profile</th>
                  <th className="py-3 px-4">Speed Profile</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs text-slate-200">
                {paginatedTasks.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <Layers className="w-8 h-8 text-slate-600" />
                        <p className="font-semibold text-slate-300">
                          Belum ada Auto Configuration Task
                        </p>
                        <p className="text-xs text-slate-500 max-w-md">
                          Klik tombol <strong className="text-slate-300">+ Add New Task</strong> untuk membuat aturan Auto Provisioning ONU baru berdasarkan OLT, Board, PON, dan VLAN.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedTasks.map((task) => (
                    <tr
                      key={task.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-bold">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-800 border border-slate-700 text-xs font-bold text-sky-400">
                          #{task.priority}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{task.name}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {task.description || '-'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-200">
                        {getOltName(task.olt_id)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-sky-300 border border-blue-500/30 font-bold text-[11px]">
                          VLAN {task.vlan_id}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {task.board_selection_mode === 'ALL' ? (
                          <span className="text-emerald-400 font-semibold">All Board</span>
                        ) : (
                          <span className="font-mono font-semibold text-slate-200">
                            Board {task.selected_boards.join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {task.pon_selection_mode === 'ALL' ? (
                          <span className="text-emerald-400 font-semibold">All PON</span>
                        ) : (
                          <span className="font-mono font-semibold text-slate-200">
                            PON {task.selected_pons.join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-200">
                          {task.onu_vendor} / {task.onu_model}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {task.onu_profile_mode} • {task.config_method}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-[11px]">
                          {task.service_profile}
                          {task.enable_nat ? ' (NAT)' : ''}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-200">
                        {getSpeedName(task.speed_profile_id)}
                      </td>
                      <td className="py-3 px-4">
                        {task.status === 'ENABLED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Active
                          </span>
                        ) : task.status === 'DRAFT' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold">
                            Draft
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700 text-[11px] font-bold">
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-400 font-mono">
                        {task.created_at}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingTask(task)}
                            title="View Task Details"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-sky-400 cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!isReadOnlyViewer && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditWizard(task)}
                                title="Edit Task"
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-sky-400 cursor-pointer"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicateTask(task)}
                                title="Duplicate Task"
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-indigo-400 cursor-pointer"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleTaskStatus(task)}
                                title={
                                  task.status === 'ENABLED'
                                    ? 'Disable Task'
                                    : 'Enable Task'
                                }
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${
                                  task.status === 'ENABLED'
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                                }`}
                              >
                                {task.status === 'ENABLED' ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingTask(task)}
                                title="Delete Task"
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {filteredTasks.length > pageSize && (
            <div className="px-4 py-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Menampilkan {(currentPage - 1) * pageSize + 1} –{' '}
                {Math.min(currentPage * pageSize, filteredTasks.length)} dari{' '}
                {filteredTasks.length} Task
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 disabled:opacity-40 hover:bg-slate-800"
                >
                  Prev
                </button>
                <span className="font-semibold px-2 text-slate-200">
                  Hal {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 disabled:opacity-40 hover:bg-slate-800"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2 & 3: PROVISIONING HISTORY & FAILED PROVISIONING                */}
      {/* ==================================================================== */}
      {(subTab === 'HISTORY' || subTab === 'FAILED') && (
        <div className="bg-slate-900/80 rounded-xl border border-slate-800/90 shadow-sm overflow-hidden">
          <div className="p-3.5 sm:p-4 border-b border-slate-800/80 bg-slate-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Cari Serial Number ONU, Task Name, OLT, atau pesan error..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {subTab === 'HISTORY' && (
                <select
                  value={historyStatusFilter}
                  onChange={(e) => setHistoryStatusFilter(e.target.value)}
                  className="px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-200 font-medium"
                >
                  <option value="ALL">Semua Status Eksekusi</option>
                  <option value="SUCCESS">Success</option>
                  <option value="FAILED">Failed</option>
                  <option value="PROCESSING">Processing</option>
                  <option value="RETRY">Retry</option>
                  <option value="PENDING">Pending</option>
                </select>
              )}

              {subTab === 'FAILED' &&
                failedHistoryRecords.length > 0 &&
                !isReadOnlyViewer && (
                  <button
                    type="button"
                    disabled={isRunningAutoEngine}
                    onClick={async () => {
                      for (const rec of failedHistoryRecords) {
                        await onRetryFailedRecord(rec);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-xs cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry All Failed ({failedHistoryRecords.length})</span>
                  </button>
                )}
            </div>
          </div>

          {/* Mobile Card View (< md) */}
          <div className="md:hidden divide-y divide-slate-800/80">
            {filteredHistoryRecords.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                {subTab === 'FAILED'
                  ? 'Tidak ada Failed Provisioning.'
                  : 'Belum ada riwayat Auto Provisioning.'}
              </div>
            ) : (
              filteredHistoryRecords.map((item) => (
                <div key={item.id} className="p-3.5 space-y-2 hover:bg-slate-800/30">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-bold text-xs text-white">
                        {item.serial_number}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {item.olt_name} • gpon-onu_1/{item.board}/{item.pon}:{item.onu_id}
                      </div>
                    </div>
                    {item.status === 'SUCCESS' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3" />
                        Success
                      </span>
                    ) : item.status === 'FAILED' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                        <XCircle className="w-3 h-3" />
                        Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                        {item.status}
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-500/15 text-sky-300 font-bold">
                      VLAN {item.applied_vlan}
                    </span>
                    <span>{item.task_name}</span>
                    <span className="text-slate-500">• {item.duration_ms} ms</span>
                  </div>

                  {item.error_message && (
                    <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg p-2">
                      {item.error_message}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-mono text-slate-500">{item.timestamp}</span>
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setViewingHistoryDetail(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Details</span>
                      </button>
                      {item.status === 'FAILED' && !isReadOnlyViewer && (
                        <button
                          type="button"
                          disabled={isRunningAutoEngine}
                          onClick={() => onRetryFailedRecord(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 text-white"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop History Table (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/90 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">ONU Serial Number</th>
                  <th className="py-3 px-4">Model</th>
                  <th className="py-3 px-4">OLT / Board / PON / ID</th>
                  <th className="py-3 px-4">Task Name</th>
                  <th className="py-3 px-4">VLAN</th>
                  <th className="py-3 px-4">Service / Speed</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Execution Status</th>
                  <th className="py-3 px-4">Error Message</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs text-slate-200">
                {filteredHistoryRecords.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <History className="w-8 h-8 text-slate-600" />
                        <p className="font-semibold text-slate-300">
                          {subTab === 'FAILED'
                            ? 'Tidak ada Failed Provisioning'
                            : 'Belum ada riwayat Auto Provisioning'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredHistoryRecords.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                        {item.timestamp}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-white">
                        {item.serial_number}
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-semibold">
                        {item.onu_vendor} {item.onu_model}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">
                          {item.olt_name}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          gpon-onu_1/{item.board}/{item.pon}:{item.onu_id}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-sky-400">
                        {item.task_name}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-sky-300 border border-blue-500/30 font-bold text-[11px]">
                          VLAN {item.applied_vlan}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-200">
                          {item.service_profile}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {item.speed_profile}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                        {item.duration_ms} ms
                      </td>
                      <td className="py-3 px-4">
                        {item.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            Success
                          </span>
                        ) : item.status === 'FAILED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[11px] font-bold">
                            <XCircle className="w-3 h-3" />
                            Failed
                          </span>
                        ) : item.status === 'RETRY' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Retry (#{item.retry_count})
                          </span>
                        ) : item.status === 'PROCESSING' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-sky-300 border border-blue-500/30 text-[11px] font-bold">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Processing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px] font-bold">
                            <Clock className="w-3 h-3" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-[220px]">
                        {item.error_message ? (
                          <span className="text-[11px] text-rose-400 font-medium line-clamp-2">
                            {item.error_message}
                          </span>
                        ) : (
                          <span className="text-[11px] text-emerald-400 font-medium">
                            Verified on OLT
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingHistoryDetail(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Details</span>
                          </button>
                          {item.status === 'FAILED' && !isReadOnlyViewer && (
                            <button
                              type="button"
                              disabled={isRunningAutoEngine}
                              onClick={() => onRetryFailedRecord(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: TASK AUDIT LOG                                                */}
      {/* ==================================================================== */}
      {subTab === 'AUDIT' && (
        <div className="bg-slate-900/80 rounded-xl border border-slate-800/90 shadow-sm overflow-hidden">
          <div className="p-3.5 sm:p-4 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Audit Log Perubahan Auto Provisioning Task
            </div>
            <span className="text-xs text-slate-400">
              Total {auditLogs.length} kejadian tercatat
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/90 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Task Name</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs text-slate-200">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Belum ada aktivitas perubahan Task.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400">
                        {log.timestamp}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-white">
                        {log.actor}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-sky-400">
                        {log.task_name} (#{log.task_id})
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 7-STEP WIZARD MODAL: ADD / EDIT AUTO PROVISIONING TASK               */}
      {/* ==================================================================== */}
      {showWizardModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 rounded-2xl border border-slate-700/80 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[94vh] text-slate-100">
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-4 bg-slate-950 border-b border-slate-800 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm sm:text-base font-bold">
                  {editingTask
                    ? `Edit Auto Provisioning Task — ${editingTask.name}`
                    : 'Add New Auto ONU Provisioning Task'}
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-400">
                  Step {wizardStep} of 7 • Sistem konfigurasi otomatis ONU baru pada OLT
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWizardModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 7-Step Progress Indicator Bar */}
            <div className="px-4 sm:px-6 py-3 bg-slate-900/90 border-b border-slate-800 overflow-x-auto">
              <div className="flex items-center justify-between min-w-[620px] gap-1">
                {[
                  { step: 1, title: 'General Info', icon: Server },
                  { step: 2, title: 'VLAN & PON', icon: Layers },
                  { step: 3, title: 'ONU & Profile', icon: Wifi },
                  { step: 4, title: 'Location ODP', icon: MapPin },
                  { step: 5, title: 'TR-069 ACS', icon: Globe },
                  { step: 6, title: 'Mgmt IP', icon: Network },
                  { step: 7, title: 'Review & Save', icon: FileText },
                ].map((item, idx) => {
                  const IconComp = item.icon;
                  const isActive = wizardStep === item.step;
                  const isDone = wizardStep > item.step;
                  return (
                    <React.Fragment key={item.step}>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.step < wizardStep) {
                            setWizardError(null);
                            setWizardStep(item.step);
                          }
                        }}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          isActive
                            ? 'bg-blue-600 text-white shadow-xs'
                            : isDone
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isActive
                              ? 'bg-white text-blue-600'
                              : isDone
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isDone ? <Check className="w-3 h-3" /> : item.step}
                        </span>
                        <IconComp className="w-3.5 h-3.5 hidden sm:inline" />
                        <span className="whitespace-nowrap">{item.title}</span>
                      </button>
                      {idx < 6 && (
                        <div
                          className={`h-0.5 flex-1 min-w-[10px] ${
                            wizardStep > item.step ? 'bg-emerald-500/60' : 'bg-slate-800'
                          }`}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Validation Error Alert */}
            {wizardError && (
              <div className="mx-4 sm:mx-6 mt-4 px-4 py-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{wizardError}</span>
              </div>
            )}

            {/* Wizard Body */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
              {/* ============================================================ */}
              {/* STEP 1: GENERAL INFORMATION                                  */}
              {/* ============================================================ */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 1 – General Information
                    </h4>
                    <p className="text-xs text-slate-400">
                      Tentukan nama Task, OLT target, urutan prioritas pencocokan, serta status aktivasi.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Task Name <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        placeholder="Contoh: AUTO-FTTH-BOARD3-VLAN101"
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        OLT Selection <span className="text-rose-400">*</span>
                      </label>
                      <select
                        value={formData.olt_id}
                        onChange={(e) => {
                          const nextOltId = Number(e.target.value);
                          const firstVlanForOlt =
                            db.vlans.find((v) => v.olt_id === nextOltId)?.vlan_id ||
                            formData.vlan_id;
                          setFormData({
                            ...formData,
                            olt_id: nextOltId,
                            vlan_id: firstVlanForOlt,
                            selected_boards: [],
                            selected_pons: [],
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        {db.olts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} ({o.ip_address} • {o.hardware_model})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Description
                      </label>
                      <textarea
                        rows={2}
                        value={formData.description}
                        onChange={(e) =>
                          setFormData({ ...formData, description: e.target.value })
                        }
                        placeholder="Deskripsi aturan provisioning otomatis ini..."
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Task Priority (1 = Prioritas Tertinggi){' '}
                        <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={formData.priority}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            priority: Math.max(1, parseInt(e.target.value || '1', 10)),
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg font-mono font-bold text-white"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">
                        Jika beberapa Task cocok dengan ONU yang sama, Task dengan angka Priority terkecil dieksekusi.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">
                          Task Status
                        </label>
                        <select
                          value={formData.status === 'DRAFT' ? 'ENABLED' : formData.status}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              status: e.target.value as 'ENABLED' | 'DISABLED',
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-700 rounded-lg bg-slate-900 font-semibold text-white"
                        >
                          <option value="ENABLED">Enable</option>
                          <option value="DISABLED">Disable</option>
                        </select>
                      </div>

                      <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">
                          Auto Provisioning
                        </label>
                        <select
                          value={formData.auto_provisioning ? 'ENABLE' : 'DISABLE'}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              auto_provisioning: e.target.value === 'ENABLE',
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-700 rounded-lg bg-slate-900 font-semibold text-white"
                        >
                          <option value="ENABLE">Enable (Auto Run)</option>
                          <option value="DISABLE">Disable (Manual Trigger)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 2: VLAN, BOARD & PON CONFIGURATION                      */}
              {/* ============================================================ */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 2 – VLAN, Board &amp; PON Configuration
                    </h4>
                    <p className="text-xs text-slate-400">
                      Pilih VLAN dari database VLAN Inventory serta cakupan Board dan PON pada{' '}
                      <strong className="text-white">{getOltName(formData.olt_id)}</strong>.
                    </p>
                  </div>

                  {/* Searchable VLAN Dropdown */}
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                    <label className="block text-xs font-bold text-slate-200">
                      VLAN ID (Database VLAN Inventory){' '}
                      <span className="text-rose-400">*</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={vlanDropdownSearch}
                        onChange={(e) => setVlanDropdownSearch(e.target.value)}
                        placeholder="Filter/cari VLAN ID atau nama VLAN..."
                        className="px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                      <select
                        value={formData.vlan_id}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            vlan_id: Number(e.target.value),
                          })
                        }
                        className="px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg font-bold text-sky-400"
                      >
                        {filteredOltVlans.map((v) => (
                          <option key={v.id} value={v.vlan_id}>
                            VLAN {v.vlan_id} — {v.name} ({v.description || 'Service VLAN'})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Board Selection & PON Selection */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-200">
                          Board Selection
                        </label>
                        <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                board_selection_mode: 'ALL',
                                selected_boards: [],
                              })
                            }
                            className={`px-3 py-1 cursor-pointer ${
                              formData.board_selection_mode === 'ALL'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-900 text-slate-300'
                            }`}
                          >
                            All Board
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                board_selection_mode: 'SPECIFIC',
                                selected_boards:
                                  formData.selected_boards.length > 0
                                    ? formData.selected_boards
                                    : [availableBoardsForOlt[0] || 3],
                              })
                            }
                            className={`px-3 py-1 cursor-pointer ${
                              formData.board_selection_mode === 'SPECIFIC'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-900 text-slate-300'
                            }`}
                          >
                            Specific Board
                          </button>
                        </div>
                      </div>

                      {formData.board_selection_mode === 'ALL' ? (
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                          Mencakup seluruh Board GPON pada OLT ini (Board{' '}
                          {availableBoardsForOlt.join(', ')}).
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {availableBoardsForOlt.map((bNum) => {
                            const checked = formData.selected_boards.includes(bNum);
                            return (
                              <button
                                key={bNum}
                                type="button"
                                onClick={() => {
                                  const next = checked
                                    ? formData.selected_boards.filter((x) => x !== bNum)
                                    : [...formData.selected_boards, bNum].sort(
                                        (a, b) => a - b
                                      );
                                  setFormData({ ...formData, selected_boards: next });
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                  checked
                                    ? 'bg-blue-600 text-white border-blue-500'
                                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                                }`}
                              >
                                Board / Slot {bNum}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* PON Selection */}
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-200">
                          PON Selection
                        </label>
                        <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                pon_selection_mode: 'ALL',
                                selected_pons: [],
                              })
                            }
                            className={`px-3 py-1 cursor-pointer ${
                              formData.pon_selection_mode === 'ALL'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-900 text-slate-300'
                            }`}
                          >
                            All PON
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                pon_selection_mode: 'SPECIFIC',
                                selected_pons:
                                  formData.selected_pons.length > 0
                                    ? formData.selected_pons
                                    : [1],
                              })
                            }
                            className={`px-3 py-1 cursor-pointer ${
                              formData.pon_selection_mode === 'SPECIFIC'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-900 text-slate-300'
                            }`}
                          >
                            Specific PON
                          </button>
                        </div>
                      </div>

                      {formData.pon_selection_mode === 'ALL' ? (
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                          Mencakup seluruh PON Port (PON 1 s/d{' '}
                          {availablePonsForSelection.length}) pada Board yang dipilih.
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-1">
                          {availablePonsForSelection.map((pNum) => {
                            const checked = formData.selected_pons.includes(pNum);
                            return (
                              <button
                                key={pNum}
                                type="button"
                                onClick={() => {
                                  const next = checked
                                    ? formData.selected_pons.filter((x) => x !== pNum)
                                    : [...formData.selected_pons, pNum].sort(
                                        (a, b) => a - b
                                      );
                                  setFormData({ ...formData, selected_pons: next });
                                }}
                                className={`py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                  checked
                                    ? 'bg-blue-600 text-white border-blue-500'
                                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                                }`}
                              >
                                P{pNum}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 3: ONU CONFIGURATION                                    */}
              {/* ============================================================ */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 3 – ONU Configuration &amp; Profiles
                    </h4>
                    <p className="text-xs text-slate-400">
                      Semua profil diambil langsung dari database Speed Profile &amp; DBA/T-CONT Profile sistem.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        ONU Vendor / Manufacturer
                      </label>
                      <select
                        value={formData.onu_vendor}
                        onChange={(e) =>
                          setFormData({ ...formData, onu_vendor: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        {VENDOR_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v === 'ALL' ? 'ALL Vendors (Wildcard)' : v}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        ONU Model / Type
                      </label>
                      <select
                        value={formData.onu_model}
                        onChange={(e) =>
                          setFormData({ ...formData, onu_model: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        {MODEL_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m === 'ALL' ? 'ALL Models (type ALL)' : m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        ONU Configuration Profile (Mode)
                      </label>
                      <select
                        value={formData.onu_profile_mode}
                        onChange={(e) => {
                          const mode = e.target.value as OnuModeOption;
                          setFormData({
                            ...formData,
                            onu_profile_mode: mode,
                            service_profile:
                              mode === 'Bridging' ? 'BRIDGE' : 'PPPOE',
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        <option value="Routing">Routing Gateway (OMCI / VEIP)</option>
                        <option value="Bridging">Bridging L2 (Transparent VLAN)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Service Profile (WAN Mode)
                      </label>
                      <select
                        value={formData.service_profile}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            service_profile: e.target.value as WanModeOption,
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        <option value="PPPOE">PPPoE Client (OMCI Auto-Fill)</option>
                        <option value="DHCP">DHCP / IPoE Dynamic</option>
                        <option value="BRIDGE">Bridge Transparent</option>
                        <option value="ONU_WEBPAGE">Setup via ONU Webpage</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Speed Profile <span className="text-rose-400">*</span>
                      </label>
                      <select
                        value={formData.speed_profile_id}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            speed_profile_id: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-sky-400"
                      >
                        {db.speed_profiles.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.profile_name} ({Math.round(sp.download_kbps / 1024)}M Down /{' '}
                            {Math.round(sp.upload_kbps / 1024)}M Up)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        DBA / T-CONT Profile (Optional)
                      </label>
                      <select
                        value={formData.dba_profile_id || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            dba_profile_id: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        <option value="">Auto (Ikuti Speed Profile)</option>
                        {db.tcont_profiles.map((tp) => (
                          <option key={tp.id} value={tp.id}>
                            {tp.profile_name} (Type {tp.dba_type} • Max{' '}
                            {Math.round(tp.maximum_kbps / 1024)}M)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* PPPoE & Enable NAT Config */}
                  {formData.service_profile === 'PPPOE' && (
                    <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-950/20 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Template PPPoE Username
                        </label>
                        <input
                          type="text"
                          value={formData.pppoe_username_template}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              pppoe_username_template: e.target.value,
                            })
                          }
                          placeholder="AUTO-{{SN}}"
                          className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg font-mono text-white"
                        />
                        <span className="text-[10px] text-slate-400">
                          Gunakan <code>{'{{SN}}'}</code> atau <code>{'{{SN4}}'}</code>
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Default PPPoE Password
                        </label>
                        <input
                          type="text"
                          value={formData.pppoe_password_default}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              pppoe_password_default: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg font-mono text-white"
                        />
                      </div>

                      <div className="pt-2">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={formData.enable_nat}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                enable_nat: e.target.checked,
                              })
                            }
                            className="w-4 h-4 rounded text-blue-600"
                          />
                          <span className="text-xs font-bold text-slate-200">
                            Enable NAT (<code>pppoe 1 nat enable</code>)
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* WiFi Profile (Optional) */}
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formData.wifi_enabled}
                        onChange={(e) =>
                          setFormData({ ...formData, wifi_enabled: e.target.checked })
                        }
                        className="w-4 h-4 rounded text-blue-600"
                      />
                      <span className="text-xs font-bold text-slate-200">
                        Aktifkan WiFi Profile Otomatis (Optional)
                      </span>
                    </label>

                    {formData.wifi_enabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1">
                            Template SSID WiFi
                          </label>
                          <input
                            type="text"
                            value={formData.wifi_ssid_prefix}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                wifi_ssid_prefix: e.target.value,
                              })
                            }
                            placeholder="JETCYBER-{{SN4}}"
                            className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1">
                            WPA2 WiFi Password (Min. 8 Karakter)
                          </label>
                          <input
                            type="text"
                            value={formData.wifi_password}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                wifi_password: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg font-mono text-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 4: LOCATION CONFIGURATION (CASCADING DROPDOWNS)         */}
              {/* ============================================================ */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 4 – Location Configuration (Zone → Splitter → Splitter Port)
                    </h4>
                    <p className="text-xs text-slate-400">
                      Dropdown bertingkat dinamis dari Location Management (Zone &amp; ODP/Splitter).
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 1. Zone */}
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                      <label className="block text-xs font-bold text-slate-200">
                        1. Zone (Location Management)
                      </label>
                      <input
                        type="text"
                        value={zoneDropdownSearch}
                        onChange={(e) => setZoneDropdownSearch(e.target.value)}
                        placeholder="Cari Zone..."
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                      <select
                        value={formData.zone_id || ''}
                        onChange={(e) => {
                          const nextZoneId = e.target.value
                            ? Number(e.target.value)
                            : null;
                          setFormData({
                            ...formData,
                            zone_id: nextZoneId,
                            odb_id: null,
                            odb_port: null,
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-900 font-semibold text-white"
                      >
                        <option value="">-- Tanpa Zone Spesifik --</option>
                        {filteredZones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name} ({z.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 2. Splitter (ODP) */}
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                      <label className="block text-xs font-bold text-slate-200">
                        2. Splitter / ODP
                      </label>
                      <select
                        disabled={!formData.zone_id}
                        value={formData.odb_id || ''}
                        onChange={(e) => {
                          const nextOdbId = e.target.value
                            ? Number(e.target.value)
                            : null;
                          setFormData({
                            ...formData,
                            odb_id: nextOdbId,
                            odb_port: null,
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
                      >
                        <option value="">
                          {!formData.zone_id
                            ? 'Pilih Zone terlebih dahulu'
                            : availableSplittersForZone.length === 0
                            ? 'Belum ada Splitter di Zone ini'
                            : '-- Pilih Splitter / ODP --'}
                        </option>
                        {availableSplittersForZone.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} (Kapasitas {o.total_ports} Port)
                          </option>
                        ))}
                      </select>
                      {selectedSplitterObj && (
                        <p className="text-[11px] text-slate-400">
                          Terpakai: {occupiedPortsInSplitter.size} /{' '}
                          {selectedSplitterObj.total_ports} Port
                        </p>
                      )}
                    </div>

                    {/* 3. Splitter Port */}
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                      <label className="block text-xs font-bold text-slate-200">
                        3. Splitter Port
                      </label>
                      <select
                        disabled={!selectedSplitterObj}
                        value={
                          formData.odb_port_mode === 'AUTO'
                            ? 'AUTO'
                            : String(formData.odb_port || '')
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'AUTO') {
                            setFormData({
                              ...formData,
                              odb_port_mode: 'AUTO',
                              odb_port: null,
                            });
                          } else {
                            setFormData({
                              ...formData,
                              odb_port_mode: 'SPECIFIC',
                              odb_port: Number(val),
                            });
                          }
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
                      >
                        <option value="AUTO">
                          Auto-Assign Port Kosong Berikutnya
                        </option>
                        {selectedSplitterObj &&
                          Array.from(
                            { length: selectedSplitterObj.total_ports },
                            (_, idx) => idx + 1
                          ).map((portNum) => {
                            const isUsed = occupiedPortsInSplitter.has(portNum);
                            return (
                              <option key={portNum} value={portNum}>
                                Port #{portNum}{' '}
                                {isUsed ? '(Sudah Terisi)' : '(Tersedia)'}
                              </option>
                            );
                          })}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 5: TR-069 CONFIGURATION                                 */}
              {/* ============================================================ */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 5 – TR-069 CWMP ACS Configuration
                    </h4>
                    <p className="text-xs text-slate-400">
                      Jika TR-069 dinonaktifkan, seluruh parameter TR-069 tidak akan diterapkan ke ONU.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-white">
                        Enable / Disable TR-069
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Hubungkan ONU secara otomatis ke server ACS (GenieACS / SmartOLT ACS)
                      </div>
                    </div>
                    <select
                      value={formData.tr069_enabled ? 'ENABLE' : 'DISABLE'}
                      onChange={(e) => {
                        const enabled = e.target.value === 'ENABLE';
                        const prof =
                          db.tr069_profiles.find(
                            (p) => p.id === formData.tr069_profile_id
                          ) || db.tr069_profiles[0];
                        setFormData({
                          ...formData,
                          tr069_enabled: enabled,
                          tr069_profile_id: enabled ? prof?.id || null : null,
                          tr069_conn_req_username:
                            prof?.connection_request_username ||
                            formData.tr069_conn_req_username,
                          tr069_conn_req_password:
                            prof?.connection_request_password ||
                            formData.tr069_conn_req_password,
                          tr069_inform_interval:
                            prof?.periodic_inform_interval ||
                            formData.tr069_inform_interval,
                        });
                      }}
                      className="px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-900 font-bold text-white"
                    >
                      <option value="DISABLE">Disable TR-069</option>
                      <option value="ENABLE">Enable TR-069</option>
                    </select>
                  </div>

                  {formData.tr069_enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border border-blue-500/30 bg-blue-950/20">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          ACS Profile <span className="text-rose-400">*</span>
                        </label>
                        <select
                          value={formData.tr069_profile_id || ''}
                          onChange={(e) => {
                            const pid = Number(e.target.value);
                            const prof = db.tr069_profiles.find((p) => p.id === pid);
                            setFormData({
                              ...formData,
                              tr069_profile_id: pid,
                              tr069_conn_req_username:
                                prof?.connection_request_username ||
                                formData.tr069_conn_req_username,
                              tr069_conn_req_password:
                                prof?.connection_request_password ||
                                formData.tr069_conn_req_password,
                              tr069_inform_interval:
                                prof?.periodic_inform_interval ||
                                formData.tr069_inform_interval,
                            });
                          }}
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                        >
                          {db.tr069_profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.profile_name} ({p.acs_url})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Inform Interval (Detik)
                        </label>
                        <input
                          type="number"
                          min={10}
                          value={formData.tr069_inform_interval}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              tr069_inform_interval: Number(e.target.value || 300),
                            })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Connection Request Username
                        </label>
                        <input
                          type="text"
                          value={formData.tr069_conn_req_username}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              tr069_conn_req_username: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Connection Request Password
                        </label>
                        <input
                          type="text"
                          value={formData.tr069_conn_req_password}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              tr069_conn_req_password: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 6: MANAGEMENT IP SETTINGS                               */}
              {/* ============================================================ */}
              {wizardStep === 6 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 6 – Management IP Settings
                    </h4>
                    <p className="text-xs text-slate-400">
                      Konfigurasi IP Host Management ONU (DHCP / Static) beserta Management VLAN dari daftar VLAN.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Management Mode
                      </label>
                      <select
                        value={formData.mgmt_ip_mode}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            mgmt_ip_mode: e.target.value as
                              | 'INACTIVE'
                              | 'DHCP'
                              | 'STATIC',
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-white"
                      >
                        <option value="DHCP">DHCP (Otomatis dari Server DHCP)</option>
                        <option value="STATIC">Static IP (Wajib Validasi IP)</option>
                        <option value="INACTIVE">Inactive (Tanpa Management IP)</option>
                      </select>
                    </div>

                    {formData.mgmt_ip_mode !== 'INACTIVE' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Management VLAN (Dari VLAN List)
                        </label>
                        <select
                          value={formData.mgmt_vlan_id || formData.vlan_id}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              mgmt_vlan_id: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-semibold text-sky-400"
                        >
                          {oltVlans.map((v) => (
                            <option key={v.id} value={v.vlan_id}>
                              VLAN {v.vlan_id} — {v.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {formData.mgmt_ip_mode === 'STATIC' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-xl border border-amber-500/30 bg-amber-950/20">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          IP Address <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.mgmt_ip_address}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              mgmt_ip_address: e.target.value,
                            })
                          }
                          placeholder="10.69.10.25"
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Subnet Mask <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.mgmt_subnet_mask}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              mgmt_subnet_mask: e.target.value,
                            })
                          }
                          placeholder="255.255.255.0"
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Gateway <span className="text-rose-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.mgmt_gateway}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              mgmt_gateway: e.target.value,
                            })
                          }
                          placeholder="10.69.10.1"
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Primary DNS
                        </label>
                        <input
                          type="text"
                          value={formData.mgmt_dns1}
                          onChange={(e) =>
                            setFormData({ ...formData, mgmt_dns1: e.target.value })
                          }
                          placeholder="8.8.8.8"
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          Secondary DNS
                        </label>
                        <input
                          type="text"
                          value={formData.mgmt_dns2}
                          onChange={(e) =>
                            setFormData({ ...formData, mgmt_dns2: e.target.value })
                          }
                          placeholder="8.8.4.4"
                          className="w-full px-3 py-2 text-xs border border-slate-700 rounded-lg bg-slate-950 font-mono text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 7: REVIEW & SAVE                                        */}
              {/* ============================================================ */}
              {wizardStep === 7 && (
                <div className="space-y-4">
                  <div className="border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-white">
                      STEP 7 – Review &amp; Save Configuration
                    </h4>
                    <p className="text-xs text-slate-400">
                      Periksa kembali seluruh parameter Task sebelum disimpan atau diaktifkan.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-1.5">
                      <div className="font-bold text-sky-400 uppercase text-[11px] tracking-wider">
                        1. General &amp; Target OLT
                      </div>
                      <div>
                        <span className="text-slate-400">Task Name:</span>{' '}
                        <strong className="text-white">{formData.name}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">OLT:</span>{' '}
                        <strong className="text-slate-200">{getOltName(formData.olt_id)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Priority:</span>{' '}
                        <strong className="text-slate-200">#{formData.priority}</strong> • Auto Provisioning:{' '}
                        <strong className="text-emerald-400">
                          {formData.auto_provisioning ? 'Enabled' : 'Disabled'}
                        </strong>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-1.5">
                      <div className="font-bold text-sky-400 uppercase text-[11px] tracking-wider">
                        2. VLAN, Board &amp; PON
                      </div>
                      <div>
                        <span className="text-slate-400">Service VLAN:</span>{' '}
                        <strong className="text-sky-300">VLAN {formData.vlan_id}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Board Target:</span>{' '}
                        <strong className="text-slate-200">
                          {formData.board_selection_mode === 'ALL'
                            ? 'All Board'
                            : `Specific Board (${formData.selected_boards.join(', ')})`}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">PON Target:</span>{' '}
                        <strong className="text-slate-200">
                          {formData.pon_selection_mode === 'ALL'
                            ? 'All PON'
                            : `Specific PON (${formData.selected_pons.join(', ')})`}
                        </strong>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-1.5">
                      <div className="font-bold text-sky-400 uppercase text-[11px] tracking-wider">
                        3. ONU &amp; Service Profile
                      </div>
                      <div>
                        <span className="text-slate-400">Filter ONU:</span>{' '}
                        <strong className="text-slate-200">
                          Vendor {formData.onu_vendor} / Model {formData.onu_model}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Mode &amp; Service:</span>{' '}
                        <strong className="text-slate-200">
                          {formData.onu_profile_mode} • {formData.service_profile}{' '}
                          {formData.enable_nat ? '(NAT Enabled)' : ''}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Speed Profile:</span>{' '}
                        <strong className="text-slate-200">{getSpeedName(formData.speed_profile_id)}</strong>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-1.5">
                      <div className="font-bold text-sky-400 uppercase text-[11px] tracking-wider">
                        4. Location, TR-069 &amp; Management IP
                      </div>
                      <div>
                        <span className="text-slate-400">Location ODP:</span>{' '}
                        <strong className="text-slate-200">
                          {formData.zone_id
                            ? db.zones.find((z) => z.id === formData.zone_id)?.name
                            : 'Any Zone'}{' '}
                          /{' '}
                          {formData.odb_id
                            ? db.odbs.find((o) => o.id === formData.odb_id)?.name
                            : 'Any Splitter'}{' '}
                          ({formData.odb_port_mode})
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">TR-069 ACS:</span>{' '}
                        <strong className="text-slate-200">
                          {formData.tr069_enabled
                            ? `Enabled (Interval ${formData.tr069_inform_interval}s)`
                            : 'Disabled'}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Management IP:</span>{' '}
                        <strong className="text-slate-200">
                          {formData.mgmt_ip_mode}
                          {formData.mgmt_ip_mode !== 'INACTIVE'
                            ? ` (VLAN ${formData.mgmt_vlan_id || formData.vlan_id})`
                            : ''}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="px-4 sm:px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                {wizardStep > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setWizardError(null);
                      setWizardStep((s) => Math.max(1, s - 1));
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowWizardModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>

                {wizardStep < 7 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-xs cursor-pointer"
                  >
                    <span>Next Step</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSaveTask(true)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs cursor-pointer"
                    >
                      Save as Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveTask(false)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Save &amp; Activate Task</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* VIEW TASK DETAILS MODAL                                              */}
      {/* ==================================================================== */}
      {viewingTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-700/80 shadow-xl w-full max-w-2xl overflow-hidden text-slate-100">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">{viewingTask.name}</h3>
                <p className="text-xs text-slate-400">
                  Priority #{viewingTask.priority} • Status: {viewingTask.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingTask(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">Target OLT</span>
                <strong className="text-white">
                  {getOltName(viewingTask.olt_id)}
                </strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">VLAN &amp; Coverage</span>
                <strong className="text-sky-300">
                  VLAN {viewingTask.vlan_id} • Board:{' '}
                  {viewingTask.board_selection_mode === 'ALL'
                    ? 'ALL'
                    : viewingTask.selected_boards.join(',')}{' '}
                  • PON:{' '}
                  {viewingTask.pon_selection_mode === 'ALL'
                    ? 'ALL'
                    : viewingTask.selected_pons.join(',')}
                </strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">ONU &amp; Service Profile</span>
                <strong className="text-white">
                  {viewingTask.onu_vendor} / {viewingTask.onu_model} •{' '}
                  {viewingTask.onu_profile_mode} ({viewingTask.service_profile})
                </strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">Speed Profile</span>
                <strong className="text-white">
                  {getSpeedName(viewingTask.speed_profile_id)}
                </strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">TR-069 CWMP</span>
                <strong className="text-white">
                  {viewingTask.tr069_enabled
                    ? `Enabled (Interval ${viewingTask.tr069_inform_interval}s)`
                    : 'Disabled'}
                </strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">Management IP</span>
                <strong className="text-white">
                  {viewingTask.mgmt_ip_mode}{' '}
                  {viewingTask.mgmt_ip_mode === 'STATIC'
                    ? `(${viewingTask.mgmt_ip_address})`
                    : ''}
                </strong>
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingTask(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* DELETE CONFIRMATION MODAL                                            */}
      {/* ==================================================================== */}
      {deletingTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-700/80 shadow-xl w-full max-w-md p-6 space-y-4 text-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Hapus Auto Provisioning Task?
                </h3>
                <p className="text-xs text-slate-400">
                  Task <strong className="text-white">{deletingTask.name}</strong> akan dihapus permanen.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingTask(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTask}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
              >
                Ya, Hapus Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* VIEW EXECUTION DETAILS MODAL (CLI + OLT RESPONSE + VERIFICATION)     */}
      {/* ==================================================================== */}
      {viewingHistoryDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-700/80 shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100">
            <div className="px-5 sm:px-6 py-4 bg-slate-950 border-b border-slate-800 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Detail Eksekusi Provisioning — {viewingHistoryDetail.serial_number}
                </h3>
                <p className="text-xs text-slate-400">
                  {viewingHistoryDetail.olt_name} • gpon-onu_1/
                  {viewingHistoryDetail.board}/{viewingHistoryDetail.pon}:
                  {viewingHistoryDetail.onu_id} • Duration:{' '}
                  {viewingHistoryDetail.duration_ms} ms
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingHistoryDetail(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
              {viewingHistoryDetail.error_message && (
                <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 font-semibold">
                  Error / Kegagalan: {viewingHistoryDetail.error_message}
                </div>
              )}

              <div>
                <div className="font-bold text-slate-300 mb-1">
                  1. Generated OLT Provisioning CLI Script:
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap max-h-48">
                  {viewingHistoryDetail.cli_script || '# No CLI executed'}
                </pre>
              </div>

              <div>
                <div className="font-bold text-slate-300 mb-1">
                  2. Raw OLT Telnet Response &amp; Verification Output:
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap max-h-56">
                  {viewingHistoryDetail.olt_response ||
                    viewingHistoryDetail.verification_output ||
                    '# No response from OLT'}
                </pre>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Retry Count: {viewingHistoryDetail.retry_count}
              </span>
              <div className="flex items-center gap-2">
                {viewingHistoryDetail.status === 'FAILED' && !isReadOnlyViewer && (
                  <button
                    type="button"
                    onClick={() => {
                      const rec = viewingHistoryDetail;
                      setViewingHistoryDetail(null);
                      onRetryFailedRecord(rec);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Provisioning</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingHistoryDetail(null)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

