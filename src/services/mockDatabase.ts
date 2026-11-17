/**
 * File: src/services/mockDatabase.ts
 * Relational Database Types & Clean Initial State (Zero Dummy Data)
 * All live data is persisted in SQL (MySQL/MariaDB or SQLite) via /api/state & /api/olts
 */

import {
  WanRemoteAccessOption,
  ConfigMethodOption,
  OnuModeOption,
  WanModeOption,
} from './oltEngine';

export interface OltCardRecord {
  id: number;
  olt_id: number;
  slot: number;
  type: string; // GTGH, SCXM, HUVQ
  real_type: string;
  ports: number | null;
  sw_version: string;
  status: 'Online' | 'Offline';
  role: 'Main' | 'Standby';
  updated_at: string;
}

export interface UplinkPortRecord {
  id: number;
  olt_id: number;
  name: string; // xgei_1/19/1, gei_1/19/3
  description: string;
  type: 'Fiber' | 'Copper';
  admin_state: 'Enabled' | 'Disabled';
  status: '1G-FullD' | '10G-FullD' | 'Down';
  negotiation: string;
  mtu: number;
  wavelength: string;
  signal_dbm: string;
  temp_c: string;
  pvid_untag: number;
  tagged_vlans: string; // Hybrid: 100-102
}

export interface OltRecord {
  id: number;
  name: string;
  manufacturer?: 'ZTE' | 'Huawei';
  hardware_model: string;
  firmware_version: 'V2.1.0' | 'V1.2.5P3';
  ip_address: string;
  vpn_name: string;
  vpn_subnet: string;
  telnet_port: number;
  ssh_port: number;
  protocol: 'TELNET' | 'SSH';
  olt_username: string;
  olt_password: string;
  enable_password: string;
  snmp_read_community: string;
  snmp_write_community: string;
  snmp_port: number;
  snmp_traps_enabled: boolean;
  iptv_module?: boolean;
  supported_pon_types?: string;
  uplink_interface: string;
  location: string;
  temperature_c: number;
  voltage_v: number;
  power_usage_w: number;
  cpu_load_pct: number;
  uptime_str: string;
  warning_rx_dbm: number;
  critical_rx_dbm: number;
  ntp_servers: string;
  tr069_profile_name: string;
  default_tr069_interface: string;
  status: 'ONLINE' | 'OFFLINE';
  last_polled_at: string;
}

export interface PonPortRecord {
  id: number;
  olt_id: number;
  rack: number;
  shelf: number;
  slot: number;
  port_number: number;
  interface_name: string; // gpon-olt_1/3/2
  board_model: string; // GTGH / GTGO
  description: string;
  admin_state: 'ENABLED' | 'DISABLED';
  oper_status: 'Up' | 'Down';
  online_onus: number;
  total_onus: number;
  avg_signal_dbm: number | null;
  tx_power_dbm: number;
  max_onu_capacity: number;
}

export interface VlanRecord {
  id: number;
  olt_id: number;
  vlan_id: number;
  name: string;
  description: string;
  default_for: string;
  used_for_mgmt_tr069_voip: boolean;
  used_for_iptv: boolean;
  dhcp_snooping: boolean;
  lan_to_lan: boolean;
  enable_nat?: boolean;
  onus_count: number;
  service_type: 'PPPOE' | 'HOTSPOT_BRIDGE' | 'DHCP' | 'TR069_MGMT' | 'IPTV';
  svlan_id: number | null;
  is_default: boolean;
}

export interface TcontProfileRecord {
  id: number;
  profile_name: string;
  dba_type: 1 | 2 | 3 | 4 | 5;
  fixed_kbps: number;
  assured_kbps: number;
  maximum_kbps: number;
  description: string;
}

export interface SpeedProfileRecord {
  id: number;
  profile_name: string;
  download_kbps: number;
  upload_kbps: number;
  cir_kbps: number;
  cbs_bytes: number;
  pbs_bytes: number;
  tcont_profile_id: number;
}

export interface Tr069ProfileRecord {
  id: number;
  profile_name: string;
  acs_url: string;
  acs_username: string;
  acs_password: string;
  connection_request_username: string;
  connection_request_password: string;
  periodic_inform_interval: number;
  mgmt_vlan_id: number;
  vlan_priority?: number;
  tcont_profile?: string;
  traffic_profile?: string;
  voip_enabled?: boolean;
  voip_sip_server?: string;
  description?: string;
  is_default: boolean;
}

export interface ZoneRecord {
  id: number;
  name: string;
  code: string;
  city_district: string;
  description: string;
}

export interface SectorRecord {
  id: number;
  name: string;
  code: string;
  zone_id: number | null;
  olt_id: number | null;
  pon_port_id: number | null;
  description: string;
}

export interface OdbRecord {
  id: number;
  zone_id: number;
  sector_id?: number | null;
  olt_id?: number | null;
  pon_port_id: number;
  name: string;
  splitter_ratio: '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64';
  total_ports: number;
  latitude: number;
  longitude: number;
  pole_number: string;
  description?: string;
}

export interface TaskRecord {
  id: number;
  action: 'Auto-Authorize' | 'Auto-Move' | 'Auto-Resync';
  olt_label: string;
  processed: number;
  total: number;
  successful: number;
  failed: number;
  user_email: string;
  status: 'Finished' | 'Running';
  from_time: string;
  to_time: string;
}

export interface OnuRecord {
  id: number;
  olt_id: number;
  pon_port_id: number;
  board: number;
  port: number;
  onu_index: number | null;
  serial_number: string;
  onu_type: string;
  is_authorized: boolean;
  customer_name: string | null;
  address: string | null;
  contact?: string | null;
  external_id: string | null;
  zone_id: number | null;
  sector_id?: number | null;
  odb_id: number | null;
  odb_port: number | null;
  vlan_id: number | null;
  attached_vlan_ids?: number[];
  speed_profile_id: number | null;
  tcont_profile_id: number | null;
  onu_mode: OnuModeOption;
  wan_mode: WanModeOption;
  config_method: ConfigMethodOption;
  wan_remote_access: WanRemoteAccessOption;
  wan_remote_allowed_subnet: string;
  tr069_profile_id: number | null;
  tr069_interface?: 'MGMT_IP' | 'WAN';
  tr069_mgmt_vlan_id?: number | null;
  tr069_status: 'ACTIVE_INFORMING' | 'PENDING_INFORM' | 'DISABLED';
  tr069_last_inform: string | null;
  voip_enabled?: boolean;
  mgmt_ip_mode?: 'INACTIVE' | 'STATIC_IP' | 'DHCP';
  mgmt_ip?: string | null;
  mgmt_subnet_mask?: string | null;
  mgmt_gateway?: string | null;
  mgmt_keep_service_port?: boolean;
  mgmt_allow_remote_access?: boolean;
  wifi_enabled?: boolean;
  wifi_ssid: string | null;
  wifi_password: string | null;
  pppoe_username: string | null;
  pppoe_password: string | null;
  static_ip_address?: string | null;
  static_subnet_mask?: string | null;
  static_gateway?: string | null;
  static_dns1?: string | null;
  enable_nat?: boolean;
  hotspot_bridge_vlan: number | null;
  admin_state: 'ENABLED' | 'DISABLED';
  phase_state:
    | 'working'
    | 'LOS'
    | 'DyingGasp'
    | 'OffLine'
    | 'syncMib'
    | 'AuthFailed'
    | 'Unconfigured';
  onu_rx_dbm: number | null;
  onu_tx_dbm: number | null;
  olt_rx_dbm: number | null;
  distance_m: number;
  temperature_c: number;
  ip_address: string | null;
  firmware_ver: string;
  auth_date_label?: string;
  detected_ago?: string;
  last_online_at: string | null;
  last_offline_reason: string;
}

export interface ProvisioningLogRecord {
  id: number;
  olt_id: number;
  onu_id: number | null;
  serial_number: string;
  action_type:
    | 'AUTHORIZE'
    | 'UPDATE_ONU_MODE'
    | 'TR069_PUSH'
    | 'REBOOT'
    | 'RESYNC_CONFIG'
    | 'FACTORY_RESET'
    | 'UPDATE_PPPOE'
    | 'DELETE_ONU'
    | 'POLL_SIGNAL';
  interface_target: string;
  summary_text?: string;
  cli_script: string;
  olt_response: string;
  execution_status: 'SUCCESS' | 'FAILED' | 'SIMULATED';
  executed_by: string;
  duration_ms: number;
  created_at: string;
}

export interface AppUserRecord {
  id: number;
  username: string;
  full_name: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'OPERATOR' | 'TECHNICIAN' | 'VIEWER';
  is_active: boolean;
  access_all_olts: boolean;
  allowed_olt_ids: number[];
  access_all_zones: boolean;
  allowed_zone_ids: number[];
  access_all_rks: boolean;
  allowed_sector_ids: number[];
  allowed_odb_ids: number[];
  last_login_at: string | null;
  created_at: string;
}

export const DEFAULT_APP_USERS: AppUserRecord[] = [
  {
    id: 1,
    username: 'admin',
    full_name: 'Super Administrator',
    email: 'admin@jetcybernet.id',
    password: 'admin',
    role: 'ADMIN',
    is_active: true,
    access_all_olts: true,
    allowed_olt_ids: [],
    access_all_zones: true,
    allowed_zone_ids: [],
    access_all_rks: true,
    allowed_sector_ids: [],
    allowed_odb_ids: [],
    last_login_at: null,
    created_at: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    username: 'likhin',
    full_name: 'Mohammad Muslikhin (Admin)',
    email: 'mohammadmuslikhin97@gmail.com',
    // Password asli diverifikasi & di-hash (scrypt) hanya di server.ts (tidak dikirim ke bundle browser)
    password: '••••••••',
    role: 'ADMIN',
    is_active: true,
    access_all_olts: true,
    allowed_olt_ids: [],
    access_all_zones: true,
    allowed_zone_ids: [],
    access_all_rks: true,
    allowed_sector_ids: [],
    allowed_odb_ids: [],
    last_login_at: null,
    created_at: '2025-01-01 00:00:00',
  },
];

export interface AutoProvisioningTaskRecord {
  id: number;
  // Step 1 - General Information
  name: string;
  description: string;
  olt_id: number;
  priority: number; // 1 = Highest Priority
  status: 'ENABLED' | 'DISABLED' | 'DRAFT';
  auto_provisioning: boolean;
  // Step 2 - VLAN, Board & PON Configuration
  vlan_id: number;
  board_selection_mode: 'ALL' | 'SPECIFIC';
  selected_boards: number[];
  pon_selection_mode: 'ALL' | 'SPECIFIC';
  selected_pons: number[];
  // Step 3 - ONU Configuration
  onu_vendor: string; // 'ALL' | 'ZTE' | 'HUAWEI' | 'FIBERHOME' | 'NOKIA' | etc.
  onu_model: string; // 'ALL' | 'F670LV9.0' | 'F609V3.0' | 'F660' | etc.
  onu_profile_mode: OnuModeOption; // 'Routing' | 'Bridging'
  config_method: ConfigMethodOption; // 'OMCI' | 'TR069'
  service_profile: WanModeOption; // 'PPPOE' | 'DHCP' | 'STATIC_IP' | 'BRIDGE'
  enable_nat: boolean;
  pppoe_username_template: string;
  pppoe_password_default: string;
  speed_profile_id: number;
  dba_profile_id: number | null;
  wifi_enabled: boolean;
  wifi_ssid_prefix: string;
  wifi_password: string;
  // Step 4 - Location Configuration
  zone_id: number | null;
  odb_id: number | null;
  odb_port_mode: 'AUTO' | 'SPECIFIC';
  odb_port: number | null;
  // Step 5 - TR-069 Configuration
  tr069_enabled: boolean;
  tr069_profile_id: number | null;
  tr069_conn_req_username: string;
  tr069_conn_req_password: string;
  tr069_inform_interval: number;
  // Step 6 - Management IP Settings
  mgmt_ip_mode: 'INACTIVE' | 'DHCP' | 'STATIC';
  mgmt_vlan_id: number | null;
  mgmt_ip_address: string;
  mgmt_subnet_mask: string;
  mgmt_gateway: string;
  mgmt_dns1: string;
  mgmt_dns2: string;
  // Metadata
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutoProvisioningHistoryRecord {
  id: number;
  timestamp: string;
  onu_db_id: number | null;
  serial_number: string;
  onu_vendor: string;
  onu_model: string;
  olt_id: number;
  olt_name: string;
  board: number;
  pon: number;
  onu_id: number;
  task_id: number | null;
  task_name: string;
  applied_vlan: number;
  service_profile: string;
  speed_profile: string;
  zone_name: string;
  splitter_name: string;
  splitter_port: number | null;
  duration_ms: number;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'RETRY';
  is_conflict?: boolean;
  error_message: string | null;
  cli_script: string;
  olt_response: string;
  verification_output: string;
  retry_count: number;
}

export interface TaskAuditLogRecord {
  id: number;
  timestamp: string;
  task_id: number;
  task_name: string;
  action: 'CREATED' | 'UPDATED' | 'ENABLED' | 'DISABLED' | 'DUPLICATED' | 'DELETED';
  actor: string;
  details: string;
}

export interface SmartOltDatabaseState {
  olts: OltRecord[];
  olt_cards: OltCardRecord[];
  pon_ports: PonPortRecord[];
  uplink_ports: UplinkPortRecord[];
  vlans: VlanRecord[];
  tcont_profiles: TcontProfileRecord[];
  speed_profiles: SpeedProfileRecord[];
  tr069_profiles: Tr069ProfileRecord[];
  zones: ZoneRecord[];
  sectors?: SectorRecord[];
  odbs: OdbRecord[];
  tasks: TaskRecord[];
  onus: OnuRecord[];
  provisioning_logs: ProvisioningLogRecord[];
  users?: AppUserRecord[];
  auto_provisioning_tasks?: AutoProvisioningTaskRecord[];
  auto_provisioning_history?: AutoProvisioningHistoryRecord[];
  task_audit_logs?: TaskAuditLogRecord[];
}

/**
 * CLEAN DATABASE STATE — ZERO DUMMY DATA
 * Semua tabel OLT, ONU, VLAN, Port, Uplink, Zone, ODB, dan Log dimulai 100% kosong dari database SQL.
 * Hanya berisi profil standar ITU-T G.984 GPON (TCONT & Traffic Limit) agar OLT baru siap digunakan.
 */
export const INITIAL_DB_STATE: SmartOltDatabaseState = {
  olts: [],
  olt_cards: [],
  pon_ports: [],
  uplink_ports: [],
  vlans: [],
  tcont_profiles: [
    {
      id: 1,
      profile_name: 'SMARTOLT-1G-UP',
      dba_type: 5,
      fixed_kbps: 128,
      assured_kbps: 1024,
      maximum_kbps: 1048064,
      description: 'profile tcont SMARTOLT-1G-UP type 5 fixed 128 assured 1024 maximum 1048064',
    },
    {
      id: 2,
      profile_name: 'SMARTOLT-VOIPMNG-10M',
      dba_type: 5,
      fixed_kbps: 512,
      assured_kbps: 1024,
      maximum_kbps: 11264,
      description: 'profile tcont SMARTOLT-VOIPMNG-10M type 5 fixed 512 assured 1024 maximum 11264',
    },
    {
      id: 3,
      profile_name: 'GPON-1G',
      dba_type: 4,
      fixed_kbps: 0,
      assured_kbps: 0,
      maximum_kbps: 1000000,
      description: 'profile tcont GPON-1G type 4 maximum 1000000',
    },
  ],
  speed_profiles: [
    {
      id: 1,
      profile_name: 'SMARTOLT-1G-DOWN',
      download_kbps: 1048064,
      upload_kbps: 1048064,
      cir_kbps: 1048064,
      cbs_bytes: 1023,
      pbs_bytes: 1023,
      tcont_profile_id: 1,
    },
    {
      id: 2,
      profile_name: 'SMARTOLT-VOIPMNG-10M',
      download_kbps: 11264,
      upload_kbps: 11264,
      cir_kbps: 10240,
      cbs_bytes: 256,
      pbs_bytes: 256,
      tcont_profile_id: 2,
    },
    {
      id: 3,
      profile_name: 'SMARTOLT-IPTV-50M-DOWN',
      download_kbps: 51200,
      upload_kbps: 51200,
      cir_kbps: 51200,
      cbs_bytes: 1023,
      pbs_bytes: 1023,
      tcont_profile_id: 1,
    },
  ],
  tr069_profiles: [
    {
      id: 1,
      profile_name: 'DEFAULT-ACS',
      acs_url: 'http://10.69.69.1:14501',
      acs_username: 'acsNet',
      acs_password: 'acsNet@2024',
      connection_request_username: 'smartolt-cpe',
      connection_request_password: 'smartolt-req',
      periodic_inform_interval: 300,
      mgmt_vlan_id: 100,
      vlan_priority: 2,
      tcont_profile: 'SMARTOLT-VOIPMNG-10M',
      traffic_profile: 'SMARTOLT-VOIPMNG-10M',
      voip_enabled: true,
      voip_sip_server: '',
      description: 'Default ISP TR-069 CWMP + VoIP Management Profile',
      is_default: true,
    },
  ],
  zones: [],
  sectors: [],
  odbs: [],
  tasks: [],
  onus: [],
  provisioning_logs: [],
  users: DEFAULT_APP_USERS,
  auto_provisioning_tasks: [],
  auto_provisioning_history: [],
  task_audit_logs: [],
};

/**
 * GENERATOR LIVE `#show running-config` DARI DATABASE STATE SAAT INI
 * Menghasilkan output `#show running-config` ZTE C300/C320 V2.1 secara real-time berdasarkan data di database.
 */
export function buildLiveZteRunningConfig(
  db: SmartOltDatabaseState,
  oltId: number
): string {
  const olt = db.olts.find((o) => o.id === oltId) || db.olts[0];
  if (!olt) {
    return `! No OLT registered in database yet.\n! Add an OLT first via Settings -> OLTs -> + Add OLT.`;
  }

  const oltVlans = db.vlans
    .filter((v) => v.olt_id === olt.id)
    .sort((a, b) => a.vlan_id - b.vlan_id);
  const oltUplinks = db.uplink_ports.filter((u) => u.olt_id === olt.id);
  const oltOnus = db.onus
    .filter((o) => o.olt_id === olt.id && o.is_authorized && o.onu_index !== null)
    .sort((a, b) => a.port - b.port || (a.onu_index || 0) - (b.onu_index || 0));

  const lines: string[] = [
    `#show running-config`,
    `Building configuration...`,
    `!`,
    `<status>`,
    `!`,
    `!Invalid configuration Line Eventually Visible`,
    `!`,
    `!Last configuration change at ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    `!`,
    `config-version 2.1 `,
    `!`,
    `enable-password ${olt.enable_password || 'zxr10'}`,
    `hostname ${olt.name.replace(/\s+/g, '-')}`,
    `!`,
    `start-run-sync auto-enable`,
    `start-run-sync interval 20`,
    `!`,
    `shelf 1 type C300_19B`,
    `set-pnp enable`,
    `card 1/3 GTGH`,
    `card 1/10 SCXM`,
    `card 1/11 SCXM`,
    `card 1/19 HUVQ`,
    `!`,
    `gpon`,
  ];

  for (const tp of db.tcont_profiles) {
    lines.push(`  ${tp.description}`);
  }
  lines.push(
    `  profile traffic SMARTOLT-IPTV-50M-DOWN sir 51200 pir 51200 cbs 1023 pbs 1023`,
    `  profile traffic SMARTOLT-1G-DOWN sir 1048064 pir 1048064 cbs 1023 pbs 1023`,
    `  profile traffic SMARTOLT-VOIPMNG-10M sir 10240 pir 11264 cbs 256 pbs 256`
  );

  for (const v of oltVlans) {
    lines.push(
      `  onu profile vlan SMARTOLT-vlan${v.vlan_id} tag-mode tag cvlan ${v.vlan_id}`
    );
  }
  lines.push(`  uncfg-onu-display-info model sn pw`, `!`);

  if (oltVlans.length > 0) {
    lines.push(
      `vlan database`,
      `  vlan ${oltVlans.map((v) => v.vlan_id).join(',')}`,
      `!`
    );
    for (const v of oltVlans) {
      if (v.name) {
        lines.push(`vlan ${v.vlan_id}`, `  name ${v.name}`, `!`);
      }
    }
  }

  lines.push(
    `interface vlan 102`,
    `  ip address ${olt.ip_address} 255.255.255.252`,
    `!`
  );

  // Per-port GPON OLT + GPON ONU interfaces (Ports 1..16)
  for (let p = 1; p <= 16; p++) {
    const portOnus = oltOnus.filter((o) => o.port === p);
    lines.push(
      `interface gpon-olt_1/3/${p}`,
      `  no shutdown`,
      `  linktrap disable`
    );
    for (const o of portOnus) {
      const zType = o.onu_type === 'F670LV9.0' ? 'F670LV9.0' : 'ALL';
      lines.push(`  onu ${o.onu_index} type ${zType} sn ${o.serial_number}`);
    }
    lines.push(`!`);

    for (const o of portOnus) {
      const vlObj = db.vlans.find((v) => v.id === o.vlan_id || v.vlan_id === o.vlan_id);
      const vlanNum = vlObj?.vlan_id || o.vlan_id || 101;
      const trProfile =
        db.tr069_profiles.find((t) => t.id === o.tr069_profile_id) ||
        db.tr069_profiles.find((t) => t.is_default) ||
        db.tr069_profiles[0];
      const oltMgmtVlan = oltVlans.find(
        (v) => v.used_for_mgmt_tr069_voip || v.service_type === 'TR069_MGMT'
      );
      const isMgmtOnly = Boolean(
        vlObj?.used_for_mgmt_tr069_voip || vlObj?.service_type === 'TR069_MGMT'
      );
      const mgmtVlanNum =
        o.tr069_mgmt_vlan_id ||
        trProfile?.mgmt_vlan_id ||
        oltMgmtVlan?.vlan_id ||
        100;
      const mgmtTcont = trProfile?.tcont_profile || 'SMARTOLT-VOIPMNG-10M';
      const mgmtTraffic = trProfile?.traffic_profile || 'SMARTOLT-VOIPMNG-10M';

      lines.push(
        `interface gpon-onu_1/3/${p}:${o.onu_index}`,
        `  name ${o.customer_name || o.serial_number}`,
        `  description ${o.address || 'none'}`,
        `  sn-bind enable sn`
      );
      if (isMgmtOnly) {
        lines.push(
          `  tcont 1 profile ${mgmtTcont}`,
          `  gemport 1 tcont 1`,
          `  gemport 1 traffic-limit downstream ${mgmtTraffic}`,
          `  service-port 1 vport 1 user-vlan ${vlanNum} vlan ${vlanNum}`
        );
      } else {
        lines.push(`  tcont 1 profile SMARTOLT-1G-UP`);
        if (o.config_method === 'TR069') {
          lines.push(`  tcont 2 profile ${mgmtTcont}`);
        }
        lines.push(
          `  gemport 1 tcont 1`,
          `  gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN`
        );
        if (o.config_method === 'TR069') {
          lines.push(
            `  gemport 2 tcont 2`,
            `  gemport 2 traffic-limit downstream ${mgmtTraffic}`
          );
        }
        lines.push(
          `  service-port 1 vport 1 user-vlan ${vlanNum} vlan ${vlanNum}`
        );
        if (o.config_method === 'TR069') {
          lines.push(
            `  service-port 2 vport 2 user-vlan ${mgmtVlanNum} vlan ${mgmtVlanNum}`
          );
        }
      }
      lines.push(`!`);
    }
  }

  // Uplink Interfaces
  for (const u of oltUplinks) {
    const is10G = u.name.startsWith('xgei');
    const cleanTag =
      u.tagged_vlans.replace(/^(Hybrid|Trunk|Access):\s*/i, '').trim() || '102';
    lines.push(`interface ${u.name}`);
    if (is10G) lines.push(`  phy-attribute lan`);
    lines.push(
      u.admin_state === 'Enabled' ? `  no shutdown` : `  shutdown`,
      `  hybrid-attribute fiber`,
      is10G ? `  no negotiation auto` : `  negotiation auto`
    );
    if (is10G) lines.push(`  speed 10000`, `  duplex full`);
    lines.push(
      `  flowcontrol disable`,
      `  linktrap enable`,
      `  switchport mode hybrid`,
      `  switchport default vlan ${u.pvid_untag}`,
      `  switchport vlan ${cleanTag} tag`,
      `  port-protect disable`,
      `  uplink-isolate disable`,
      `!`
    );
  }

  lines.push(`pon`, `!`);

  // Per-ONU OMCI `pon-onu-mng` blocks
  for (const o of oltOnus) {
    const vlObj = db.vlans.find((v) => v.id === o.vlan_id || v.vlan_id === o.vlan_id);
    const vlanNum = vlObj?.vlan_id || o.vlan_id || 101;
    const trProfile =
      db.tr069_profiles.find((t) => t.id === o.tr069_profile_id) ||
      db.tr069_profiles.find((t) => t.is_default) ||
      db.tr069_profiles[0];
    const oltMgmtVlan = oltVlans.find(
      (v) => v.used_for_mgmt_tr069_voip || v.service_type === 'TR069_MGMT'
    );
    const isMgmtOnly = Boolean(
      vlObj?.used_for_mgmt_tr069_voip || vlObj?.service_type === 'TR069_MGMT'
    );
    const mgmtVlanNum =
      o.tr069_mgmt_vlan_id ||
      trProfile?.mgmt_vlan_id ||
      oltMgmtVlan?.vlan_id ||
      100;
    const pri = trProfile?.vlan_priority ?? 2;

    lines.push(`pon-onu-mng gpon-onu_1/3/${o.port}:${o.onu_index}`);
    if (isMgmtOnly) {
      lines.push(
        `  flow mode 1 tag-filter vlan-filter untag-filter discard`,
        `  flow 1 pri ${pri} vlan ${vlanNum}`,
        `  gemport 1 flow 1`,
        `  switchport-bind switch_0/1 iphost 1`,
        `  ip-host 1 dhcp-enable enable ping-response enable traceroute-response enable`,
        `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 1 pri ${pri} vlan ${vlanNum}`
      );
      if (trProfile) {
        lines.push(
          `  tr069-mgmt 1 state unlock`,
          `  tr069-mgmt 1 acs ${trProfile.acs_url} validate basic username ${trProfile.acs_username} password ${trProfile.acs_password}`,
          `  tr069-mgmt 1 tag pri ${pri} vlan ${vlanNum}`
        );
      }
    } else {
      lines.push(
        `  flow mode 1 tag-filter vlan-filter untag-filter discard`,
        `  flow 1 pri 0 vlan ${vlanNum}`
      );
      if (o.hotspot_bridge_vlan) {
        lines.push(`  flow 1 pri 0 vlan ${o.hotspot_bridge_vlan}`);
      }
      const isNatEnabled =
        typeof o.enable_nat === 'boolean'
          ? o.enable_nat
          : typeof vlObj?.enable_nat === 'boolean'
          ? vlObj.enable_nat
          : !/(?:^|[^A-Z0-9])(MJMT|MGMT|TR069|MANAGEMENT)(?:[^A-Z0-9]|$)/i.test(
              vlObj?.name || vlObj?.description || ''
            );
      const pppoeCmd = isNatEnabled
        ? `  pppoe 1 nat enable user ${o.pppoe_username || o.customer_name || 'USER'} password ${o.pppoe_password || 'jetcyber'}`
        : `  pppoe 1 user ${o.pppoe_username || o.customer_name || 'USER'} password ${o.pppoe_password || 'jetcyber'}`;
      lines.push(
        `  gemport 1 flow 1`,
        `  switchport-bind switch_0/1 iphost 1`,
        `  switchport-bind switch_0/1 veip 1`,
        pppoeCmd,
        `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 1 pri 0 vlan ${vlanNum}`
      );

      const ethPorts = o.onu_type === 'F670LV9.0' ? 4 : 8;
      for (let e = 1; e <= ethPorts; e++) {
        lines.push(`  dhcp-ip ethuni eth_0/${e} from-onu`);
      }

      if (o.config_method === 'TR069' && trProfile) {
        lines.push(
          `  flow 2 switch switch_0/1`,
          `  flow mode 2 tag-filter vlan-filter untag-filter discard`,
          `  flow 2 pri ${pri} vlan ${mgmtVlanNum}`,
          `  gemport 2 flow 2`,
          `  switchport-bind switch_0/1 iphost 2`,
          `  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable`,
          `  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard`,
          `  vlan-filter iphost 2 pri ${pri} vlan ${mgmtVlanNum}`,
          `  tr069-mgmt 1 state unlock`,
          `  tr069-mgmt 1 acs ${trProfile.acs_url} validate basic username ${trProfile.acs_username} password ${trProfile.acs_password}`,
          `  tr069-mgmt 1 tag pri ${pri} vlan ${mgmtVlanNum}`
        );
      }
    }

    lines.push(
      `  security-mgmt 1 state enable mode forward protocol web https`,
      `  security-mgmt 998 state enable mode forward ingress-type lan protocol web https`,
      `  security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069`,
      `!`
    );
  }

  lines.push(`end`);
  return lines.join('\n');
}
