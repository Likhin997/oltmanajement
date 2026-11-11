/**
 * File: src/services/oltEngine.ts
 * Modul 2: Engine Koneksi OLT (Telnet/SSH & SNMP), Regex Parser ZTE C300/C320 (ZXAN V2.1),
 * Parser #show running-config asli, serta Generator Konfigurasi Otomatis (OMCI CLI +
 * PPPoE + VLAN Database + Uplink Hybrid Tagging + WAN Remote Access + TR-069 CWMP ACS)
 */

export type WanRemoteAccessOption =
  | 'Enabled from everywhere in the internet'
  | 'Enabled only from NOC subnet'
  | 'Disabled';

export type ConfigMethodOption = 'OMCI' | 'TR069';

export type OnuModeOption = 'Routing' | 'Bridging';

export type WanModeOption = 'PPPOE' | 'DHCP' | 'STATIC_IP' | 'ONU_WEBPAGE' | 'BRIDGE';

export interface UncfgOnuParsed {
  ponInterface: string; // Contoh: gpon-olt_1/3/2
  rack: number;
  shelf: number;
  slot: number;
  port: number;
  serialNumber: string; // Contoh: ZTEGC6A394D4
  onuModel: string;     // Contoh: ALL atau F670LV9.0
  firmwareVersion?: string;
}

export interface OnuStateParsed {
  ponInterface: string; // Contoh: gpon-olt_1/3/2
  onuIndex: number;     // 1 - 128
  fullInterface: string; // Contoh: gpon-onu_1/3/2:8
  adminState: 'ENABLED' | 'DISABLED';
  omccState: 'ENABLED' | 'DISABLED';
  phaseState: 'working' | 'LOS' | 'DyingGasp' | 'OffLine' | 'syncMib' | 'AuthFailed';
  channel: string;
}

export interface OpticalPowerParsed {
  oltTxDbm: number | null;
  oltRxDbm: number | null;
  onuTxDbm: number | null;
  onuRxDbm: number | null;
  upAttenuationDb: number | null;
  downAttenuationDb: number | null;
}

export interface CliProvisioningParams {
  firmwareVersion: 'V2.1.0' | 'V1.2.5P3';
  ponInterface: string; // misal: gpon-olt_1/3/2
  onuIndex: number;     // nomor index kosong 1..128
  serialNumber: string; // misal: ZTEGC6A3BF19
  onuType: string;      // misal: ALL atau F670LV9.0
  customerName: string;
  address: string;
  tcontProfile: string; // misal: SMARTOLT-1G-UP
  speedProfile: string; // misal: SMARTOLT-1G-DOWN
  vlanId: number;       // misal: 101
  onuMode?: OnuModeOption;
  wanMode: WanModeOption;
  configMethod?: ConfigMethodOption;
  wanRemoteAccess?: WanRemoteAccessOption;
  wanRemoteAllowedSubnet?: string; // misal: 10.69.69.1
  pppoeUsername?: string;
  pppoePassword?: string;
  staticIpAddress?: string;
  staticSubnetMask?: string;
  staticGateway?: string;
  staticDns1?: string;
  hotspotBridgeVlan?: number | null; // misal: 120 atau 140 untuk extra flow VLAN
  tr069Enabled?: boolean;
  tr069AcsUrl?: string;
  tr069AcsUsername?: string;
  tr069AcsPassword?: string;
  tr069PeriodicInterval?: number;
  wifiSsid?: string;
  wifiPassword?: string;
  voipSipEnabled?: boolean;
}

/**
 * 1. ALGORITMA REGEX PARSER: `show gpon onu uncfg`
 * Mendukung output ZTE C300/C320 (`uncfg-onu-display-info model sn pw`)
 */
export function parseZteUncfgOutput(rawOutput: string): UncfgOnuParsed[] {
  const results: UncfgOnuParsed[] = [];
  const lines = rawOutput.split(/\r?\n/);

  const regexV21 =
    /gpon-(?:onu|olt)_(\d+)\/(\d+)\/(\d+)(?::\d+)?\s+([A-Z0-9]{12,16})\s+(unknown|uncfg|[A-Za-z0-9\-_.]+)/i;
  const regexModelSn =
    /gpon-(?:onu|olt)_(\d+)\/(\d+)\/(\d+)(?::\d+)?\s+([A-Za-z0-9\-_.]+)\s+([A-Z0-9]{12,16})(?:\s+([A-Za-z0-9.\-_]+))?/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('---') || line.toLowerCase().startsWith('onuindex')) {
      continue;
    }

    const matchModelSn = line.match(regexModelSn);
    if (
      matchModelSn &&
      matchModelSn[5] &&
      /^[A-Z]{4}[A-Z0-9]{8}$/i.test(matchModelSn[5])
    ) {
      const rack = parseInt(matchModelSn[1], 10);
      const shelf = parseInt(matchModelSn[2], 10);
      const slotPort = parseInt(matchModelSn[3], 10);
      results.push({
        ponInterface: `gpon-olt_${rack}/${shelf}/${slotPort}`,
        rack,
        shelf,
        slot: shelf,
        port: slotPort,
        onuModel: matchModelSn[4].toUpperCase(),
        serialNumber: matchModelSn[5].toUpperCase(),
        firmwareVersion: matchModelSn[6] || 'V2.1.0',
      });
      continue;
    }

    const matchV21 = line.match(regexV21);
    if (matchV21) {
      const rack = parseInt(matchV21[1], 10);
      const shelf = parseInt(matchV21[2], 10);
      const port = parseInt(matchV21[3], 10);
      const sn = matchV21[4].toUpperCase();
      const stateOrModel = matchV21[5];
      const inferredModel =
        stateOrModel.toLowerCase() === 'unknown' || stateOrModel.toLowerCase() === 'uncfg'
          ? sn.startsWith('ZTEGCF')
            ? 'F670LV9.0'
            : 'ALL'
          : stateOrModel.toUpperCase();

      results.push({
        ponInterface: `gpon-olt_${rack}/${shelf}/${port}`,
        rack,
        shelf,
        slot: shelf,
        port,
        serialNumber: sn,
        onuModel: inferredModel,
        firmwareVersion: 'V2.1.0',
      });
    }
  }

  return results;
}

export interface WanIpParsed {
  currentIp: string | null;
  currentMask: string | null;
  gateway: string | null;
  primaryDns: string | null;
  secondaryDns: string | null;
  status: string | null;
  username: string | null;
  password: string | null;
  cvlan: number | null;
  macAddress: string | null;
  mode: string | null;
}

export interface OnuDetailInfoParsed {
  adminState: 'ENABLED' | 'DISABLED' | null;
  phaseState: OnuStateParsed['phaseState'] | null;
  serialNumber: string | null;
  name: string | null;
  distanceM: number | null;
  onlineDuration: string | null;
  lastOfflineReason: string | null;
  lastAuthTime: string | null;
  lastOfflineTime: string | null;
}

export function normalizeZtePhaseState(
  phaseRaw: string,
  offlineCauseRaw?: string | null
): OnuStateParsed['phaseState'] {
  const clean = (phaseRaw || '').trim().toLowerCase();
  const cause = (offlineCauseRaw || '').trim().toLowerCase();

  if (clean === 'working' || clean === 'online' || clean === 'up') {
    return 'working';
  }
  if (
    clean === 'los' ||
    clean === 'losi' ||
    clean === 'lofi' ||
    clean === 'lof' ||
    clean === 'loami'
  ) {
    return 'LOS';
  }
  if (
    clean === 'dyinggasp' ||
    clean === 'dying-gasp' ||
    clean === 'dying_gasp' ||
    clean === 'poweroff' ||
    clean === 'power-off' ||
    clean === 'pwrfail'
  ) {
    return 'DyingGasp';
  }
  if (clean === 'syncmib' || clean === 'sync-mib') {
    return 'syncMib';
  }
  if (clean === 'authfailed' || clean === 'auth-failed') {
    return 'AuthFailed';
  }

  // On ZTE C300, when an ONU is down in `logging` or `OffLine` state, check its last offline cause
  if (cause.includes('dyinggasp') || cause.includes('dying-gasp') || cause.includes('power')) {
    return 'DyingGasp';
  }
  if (cause.includes('los') || cause.includes('lof')) {
    return 'LOS';
  }

  return 'OffLine';
}

/**
 * 2. ALGORITMA REGEX PARSER: `show gpon onu state [gpon-olt_1/x/y]`
 */
export function parseZteOnuStateOutput(rawOutput: string): OnuStateParsed[] {
  const results: OnuStateParsed[] = [];
  const cleaned = rawOutput
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const lines = cleaned.split(/[\r\n]+/);

  const stateRegex =
    /(?:gpon-onu_)?(\d+)\/(\d+)\/(\d+):(\d+)\s+(enable|disable|unlock|lock)\s+(enable|disable)\s+([A-Za-z0-9_\-]+)(?:\s+(\S+))?/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('---') || /^onuindex/i.test(line)) continue;
    const match = line.match(stateRegex);
    if (!match) continue;

    const rack = match[1];
    const slot = match[2];
    const port = match[3];
    const onuIndex = parseInt(match[4], 10);
    const adminRaw = match[5].toLowerCase();
    const omccRaw = match[6].toLowerCase();
    const phaseRaw = match[7];

    const normalizedPhase = normalizeZtePhaseState(phaseRaw);

    results.push({
      ponInterface: `gpon-olt_${rack}/${slot}/${port}`,
      onuIndex,
      fullInterface: `gpon-onu_${rack}/${slot}/${port}:${onuIndex}`,
      adminState:
        adminRaw === 'enable' || adminRaw === 'unlock' ? 'ENABLED' : 'DISABLED',
      omccState: omccRaw === 'enable' ? 'ENABLED' : 'DISABLED',
      phaseState: normalizedPhase,
      channel: match[8] || '1(GPON)',
    });
  }

  return results;
}

/**
 * 2b. ALGORITMA REGEX PARSER: `show gpon onu detail-info gpon-onu_1/x/y:z`
 * Membaca Phase state, Online Duration, Distance, serta riwayat Authpass/Offline Cause (DyingGasp / LOS)
 */
export function parseZteOnuDetailInfo(rawOutput: string): OnuDetailInfoParsed {
  const cleaned = rawOutput.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const adminMatch = cleaned.match(/Admin\s+state\s*:\s*(\S+)/i);
  const phaseMatch = cleaned.match(/Phase\s+state\s*:\s*(\S+)/i);
  const snMatch = cleaned.match(/Serial\s+number\s*:\s*([A-Z0-9]{8,16})/i);
  const nameMatch = cleaned.match(/^\s*Name\s*:\s*([^\r\n]+)/im);
  const distMatch = cleaned.match(/ONU\s+Distance\s*:\s*(\d+)\s*m/i);
  const durMatch = cleaned.match(/Online\s+Duration\s*:\s*([^\r\n]+)/i);

  // Parse the last entry of the ZTE Authpass/OfflineTime/Cause table:
  //   1   2026-11-10 14:20:11    2026-11-10 16:45:02     DyingGasp
  const historyRegex =
    /^\s*\d+\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|N\/A|0000-00-00\s+00:00:00)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|N\/A|0000-00-00\s+00:00:00)\s+([A-Za-z0-9_\-]+)/gim;
  let hm: RegExpExecArray | null;
  let lastAuthTime: string | null = null;
  let lastOfflineTime: string | null = null;
  let lastCause: string | null = null;

  while ((hm = historyRegex.exec(cleaned)) !== null) {
    if (hm[1] && hm[1] !== 'N/A' && !hm[1].startsWith('0000')) {
      lastAuthTime = hm[1].trim();
    }
    if (hm[2] && hm[2] !== 'N/A' && !hm[2].startsWith('0000')) {
      lastOfflineTime = hm[2].trim();
    }
    if (hm[3]) {
      lastCause = hm[3].trim();
    }
  }

  const rawPhase = phaseMatch ? phaseMatch[1].trim() : null;
  const phaseState = rawPhase ? normalizeZtePhaseState(rawPhase, lastCause) : null;

  return {
    adminState: adminMatch
      ? /enable|unlock/i.test(adminMatch[1])
        ? 'ENABLED'
        : 'DISABLED'
      : null,
    phaseState,
    serialNumber: snMatch ? snMatch[1].trim().toUpperCase() : null,
    name: nameMatch ? nameMatch[1].trim() : null,
    distanceM: distMatch ? parseInt(distMatch[1], 10) : null,
    onlineDuration: durMatch ? durMatch[1].trim() : null,
    lastOfflineReason: lastCause,
    lastAuthTime,
    lastOfflineTime,
  };
}

/**
 * 2c. ALGORITMA REGEX PARSER: `show gpon remote-onu wan-ip gpon-onu_1/x/y:z`
 * Membaca IP PPPoE / DHCP nyata yang didapat ONU dari MikroTik / BNG melalui OMCI OLT!
 */
export function parseZteWanIpOutput(rawOutput: string): WanIpParsed {
  const cleaned = rawOutput.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

  const ipMatch =
    cleaned.match(/Current\s+IP\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i) ||
    cleaned.match(/IP\s+address\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
  const maskMatch =
    cleaned.match(/Current\s+mask\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i) ||
    cleaned.match(/Subnet\s+mask\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
  const gwMatch =
    cleaned.match(/Current\s+gateway\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i) ||
    cleaned.match(/Default\s+gateway\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
  const dns1Match = cleaned.match(
    /Current\s+primary\s+DNS\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i
  );
  const dns2Match = cleaned.match(
    /Current\s+secondary\s+DNS\s*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i
  );
  const statusMatch = cleaned.match(/^\s*Status\s*:\s*([^\r\n]+)/im);
  const userMatch = cleaned.match(/^\s*Username\s*:\s*([^\r\n]+)/im);
  const passMatch = cleaned.match(/^\s*Password\s*:\s*([^\r\n]+)/im);
  const cvlanMatch = cleaned.match(/^\s*CVLAN\s*:\s*(\d+)/im);
  const macMatch = cleaned.match(/^\s*MAC\s+address\s*:\s*([0-9a-fA-F:.\-]+)/im);
  const modeMatch = cleaned.match(/^\s*Mode\s*:\s*([^\r\n]+)/im);

  const rawIp = ipMatch ? ipMatch[1].trim() : null;
  const validIp =
    rawIp && rawIp !== '0.0.0.0' && rawIp !== '255.255.255.255' ? rawIp : rawIp;

  return {
    currentIp: validIp,
    currentMask: maskMatch ? maskMatch[1].trim() : null,
    gateway: gwMatch ? gwMatch[1].trim() : null,
    primaryDns: dns1Match ? dns1Match[1].trim() : null,
    secondaryDns: dns2Match ? dns2Match[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    username:
      userMatch && userMatch[1].trim() && userMatch[1].trim().toLowerCase() !== 'n/a'
        ? userMatch[1].trim()
        : null,
    password:
      passMatch && passMatch[1].trim() && passMatch[1].trim().toLowerCase() !== 'n/a'
        ? passMatch[1].trim()
        : null,
    cvlan:
      cvlanMatch && parseInt(cvlanMatch[1], 10) > 0
        ? parseInt(cvlanMatch[1], 10)
        : null,
    macAddress: macMatch ? macMatch[1].trim() : null,
    mode: modeMatch ? modeMatch[1].trim() : null,
  };
}

/**
 * 2d. Multi-ONU WAN IP Parser untuk batch `show gpon remote-onu wan-ip gpon-onu_1/B/P:I`
 */
export function parseZteMultiWanIpOutput(
  rawOutput: string
): Map<string, WanIpParsed> {
  const map = new Map<string, WanIpParsed>();
  const regex =
    /show\s+gpon\s+remote-onu\s+wan-ip\s+(gpon-onu_\d+\/\d+\/\d+:\d+)([\s\S]*?)(?=show\s+gpon\s+remote-onu\s+wan-ip|show\s+pon\s+power|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(rawOutput)) !== null) {
    const key = m[1].trim().toLowerCase();
    const parsed = parseZteWanIpOutput(m[2]);
    map.set(key, parsed);
  }
  return map;
}

/**
 * 2e. Parser Tabel Redaman Optik per Port PON:
 * `show pon power onu-rx gpon-olt_1/3/2` atau `show pon power olt-rx gpon-olt_1/3/2`
 */
export function parseZtePonPowerRxTable(
  rawOutput: string
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  const cleaned = rawOutput.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const lines = cleaned.split(/[\r\n]+/);
  const rowRegex =
    /^\s*(gpon-onu_\d+\/\d+\/\d+:\d+)\s+([+-]?\d+(?:\.\d+)?(?=\s*\(dbm\))|N\/A|no\s+signal)/i;

  for (const line of lines) {
    const m = line.match(rowRegex);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const valStr = m[2].trim().toLowerCase();
    if (valStr === 'n/a' || valStr.includes('no signal')) {
      map.set(key, null);
    } else {
      const num = parseFloat(valStr);
      map.set(key, isNaN(num) ? null : num);
    }
  }
  return map;
}

/**
 * 3. ALGORITMA REGEX PARSER: `show pon power attenuation gpon-onu_1/x/y:z`
 */
export function parseZteOpticalAttenuation(rawOutput: string): OpticalPowerParsed {
  const result: OpticalPowerParsed = {
    oltTxDbm: null,
    oltRxDbm: null,
    onuTxDbm: null,
    onuRxDbm: null,
    upAttenuationDb: null,
    downAttenuationDb: null,
  };

  const upRegex =
    /up\s+Rx\s*:\s*([+-]?\d+(?:\.\d+)?|N\/A|no\s+signal)\s*(?:\(dbm\))?\s+Tx\s*:\s*([+-]?\d+(?:\.\d+)?|N\/A)\s*(?:\(dbm\))?\s+([+-]?\d+(?:\.\d+)?|N\/A)/i;

  const downRegex =
    /down\s+Tx\s*:\s*([+-]?\d+(?:\.\d+)?|N\/A)\s*(?:\(dbm\))?\s+Rx\s*:\s*([+-]?\d+(?:\.\d+)?|N\/A|no\s+signal)\s*(?:\(dbm\))?\s+([+-]?\d+(?:\.\d+)?|N\/A)/i;

  const upMatch = rawOutput.match(upRegex);
  if (upMatch) {
    const val = upMatch[1].trim().toLowerCase();
    result.oltRxDbm =
      val !== 'n/a' && !val.includes('no signal') ? parseFloat(upMatch[1]) : null;
    result.onuTxDbm = upMatch[2] !== 'N/A' ? parseFloat(upMatch[2]) : null;
    result.upAttenuationDb = upMatch[3] !== 'N/A' ? parseFloat(upMatch[3]) : null;
  }

  const downMatch = rawOutput.match(downRegex);
  if (downMatch) {
    result.oltTxDbm = downMatch[1] !== 'N/A' ? parseFloat(downMatch[1]) : null;
    const val = downMatch[2].trim().toLowerCase();
    result.onuRxDbm =
      val !== 'n/a' && !val.includes('no signal') ? parseFloat(downMatch[2]) : null;
    result.downAttenuationDb = downMatch[3] !== 'N/A' ? parseFloat(downMatch[3]) : null;
  }

  return result;
}

/**
 * 4. ALGORITMA PENCARI `onu_index` KOSONG OTOMATIS PADA PORT PON (1 s/d 128)
 * Contoh nyata pada running-config: Port 1/3/4 memiliki ONU 1,2,3,4,5,6,7,9 -> otomatis menemukan index 8!
 */
export function findNextAvailableOnuIndex(usedIndices: number[], maxCapacity = 128): number {
  const usedSet = new Set(usedIndices.filter((n) => Number.isInteger(n) && n > 0));
  for (let idx = 1; idx <= maxCapacity; idx++) {
    if (!usedSet.has(idx)) {
      return idx;
    }
  }
  throw new Error(`Port GPON penuh! Seluruh ${maxCapacity} slot ONU sudah terpakai.`);
}

/**
 * Helper pembangkit baris CLI ZTE asli untuk `WAN remote access` (`security-mgmt`)
 * Sesuai persis dengan running-config:
 *   security-mgmt 1 state enable mode forward protocol web https
 *   security-mgmt 10 state enable mode forward protocol web https
 *   security-mgmt 10 start-src-ip 10.69.69.1 end-src-ip 10.69.69.1
 *   security-mgmt 998 state enable mode forward ingress-type lan protocol web https
 *   security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069
 */
export function buildWanRemoteAccessCliLines(
  wanRemoteAccess: WanRemoteAccessOption = 'Enabled from everywhere in the internet',
  allowedSubnet = '10.69.69.1'
): string[] {
  if (wanRemoteAccess === 'Disabled') {
    return [
      `  security-mgmt 1 state disable protocol web https`,
      `  security-mgmt 998 state enable mode forward ingress-type lan protocol web https`,
      `  security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069`,
    ];
  }

  if (wanRemoteAccess === 'Enabled only from NOC subnet') {
    const cleanIp = allowedSubnet.split('/')[0].trim() || '10.69.69.1';
    return [
      `  security-mgmt 1 state enable mode forward protocol web https`,
      `  security-mgmt 10 state enable mode forward protocol web https`,
      `  security-mgmt 10 start-src-ip ${cleanIp} end-src-ip ${cleanIp}`,
      `  security-mgmt 998 state enable mode forward ingress-type lan protocol web https`,
      `  security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069`,
    ];
  }

  // Default sesuai running-config: Enabled from everywhere in the internet
  return [
    `  security-mgmt 1 state enable mode forward protocol web https`,
    `  security-mgmt 998 state enable mode forward ingress-type lan protocol web https`,
    `  security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069`,
  ];
}

/**
 * Helper pembangkit baris CLI ZTE asli untuk `TR-069 CWMP ACS` (`tr069-mgmt`)
 * Sesuai persis dengan `pon-onu-mng gpon-onu_1/3/5:4` (SUHANAH) pada running-config:
 *   flow 2 switch switch_0/1
 *   flow mode 2 tag-filter vlan-filter untag-filter discard
 *   flow 2 pri 2 vlan 100
 *   gemport 2 flow 2
 *   switchport-bind switch_0/1 iphost 2
 *   ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable
 *   vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard
 *   vlan-filter iphost 2 pri 2 vlan 100
 *   tr069-mgmt 1 state unlock
 *   tr069-mgmt 1 acs http://10.69.69.1:14501 validate basic username acsNet password acsNet@2024
 *   tr069-mgmt 1 tag pri 2 vlan 100
 */
export function buildTr069CliLines(params: {
  enabled?: boolean;
  acsUrl?: string;
  acsUsername?: string;
  acsPassword?: string;
  vlanId: number;
}): string[] {
  if (params.enabled === false) {
    return [`  no tr069-mgmt 1`];
  }
  const acsUrl = params.acsUrl || 'http://10.69.69.1:14501';
  const acsUser = params.acsUsername || 'acsNet';
  const acsPass = params.acsPassword || 'acsNet@2024';
  const tr069Vlan = 100;

  return [
    `  flow 2 switch switch_0/1`,
    `  flow mode 2 tag-filter vlan-filter untag-filter discard`,
    `  flow 2 pri 2 vlan ${tr069Vlan}`,
    `  gemport 2 flow 2`,
    `  switchport-bind switch_0/1 iphost 2`,
    `  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable`,
    `  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard`,
    `  vlan-filter iphost 2 pri 2 vlan ${tr069Vlan}`,
    `  tr069-mgmt 1 state unlock`,
    `  tr069-mgmt 1 acs ${acsUrl} validate basic username ${acsUser} password ${acsPass}`,
    `  tr069-mgmt 1 tag pri 2 vlan ${tr069Vlan}`,
  ];
}

/**
 * 5. ALGORITMA GENERATOR KONFIGURASI OTOMATIS (CLI BUILDER) ZTE C300 / C320
 * 100% Identik dengan #show running-config nyata user:
 * - interface gpon-olt_1/3/{port} -> onu {idx} type ALL sn {SN}
 * - interface gpon-onu_1/3/{port}:{idx} -> name, sn-bind, tcont 1 profile SMARTOLT-1G-UP, gemport 1, service-port 1
 * - pon-onu-mng gpon-onu_1/3/{port}:{idx} -> flow mode 1, flow 1 pri 0 vlan 101, gemport 1 flow 1,
 *   switchport-bind switch_0/1 iphost 1, switchport-bind switch_0/1 veip 1,
 *   pppoe 1 nat enable user <USER> password <PASS>, vlan-filter, dhcp-ip ethuni eth_0/1..8 from-onu, security-mgmt
 */
export function generateAuthorizeCliScript(params: CliProvisioningParams): string {
  const coords = params.ponInterface.replace(/^gpon-olt_/i, ''); // contoh: 1/3/3
  const oltIf = `gpon-olt_${coords}`;
  const onuIf = `gpon-onu_${coords}:${params.onuIndex}`;
  const cleanName =
    params.customerName
      .replace(/[^a-zA-Z0-9_\-. ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toUpperCase() || `ONU-${params.serialNumber}`;
  const cleanDesc =
    params.address &&
    params.address.trim() &&
    params.address.trim().toLowerCase() !== 'none'
      ? params.address
          .replace(/[^a-zA-Z0-9_\-. ,/]/g, '')
          .trim()
          .replace(/\s+/g, '-')
      : 'none';

  const onuMode: OnuModeOption =
    params.onuMode || (params.wanMode === 'BRIDGE' ? 'Bridging' : 'Routing');
  const configMethod: ConfigMethodOption = params.configMethod || 'OMCI';
  const wanRemoteAccess: WanRemoteAccessOption =
    params.wanRemoteAccess || 'Enabled from everywhere in the internet';

  // SmartOLT ZTE C300 standard: always register with `type ALL` and 8 ethuni ports
  // to avoid OMCI Equipment-ID mismatch that blocks PPPoE ME creation on ZTE ONUs.
  const zteOnuType = 'ALL';
  const tcontUpProfile =
    params.tcontProfile && params.tcontProfile.startsWith('SMARTOLT')
      ? params.tcontProfile
      : 'SMARTOLT-1G-UP';
  const trafficDownProfile =
    params.speedProfile && params.speedProfile.startsWith('SMARTOLT')
      ? params.speedProfile
      : 'SMARTOLT-1G-DOWN';

  const lines: string[] = [
    `configure terminal`,
    `interface ${oltIf}`,
    `  onu ${params.onuIndex} type ${zteOnuType} sn ${params.serialNumber}`,
    `exit`,
    `interface ${onuIf}`,
    `  name ${cleanName}`,
    `  description ${cleanDesc}`,
    `  tcont 1 profile ${tcontUpProfile}`,
  ];

  if (configMethod === 'TR069' || params.tr069Enabled) {
    lines.push(`  tcont 2 profile SMARTOLT-VOIPMNG-10M`);
  }

  lines.push(
    `  gemport 1 tcont 1`,
    `  gemport 1 traffic-limit downstream ${trafficDownProfile}`
  );

  if (configMethod === 'TR069' || params.tr069Enabled) {
    lines.push(
      `  gemport 2 tcont 2`,
      `  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M`
    );
  }

  lines.push(`  service-port 1 vport 1 user-vlan ${params.vlanId} vlan ${params.vlanId}`);

  if (configMethod === 'TR069' || params.tr069Enabled) {
    lines.push(`  service-port 2 vport 2 user-vlan 100 vlan 100`);
  }

  lines.push(`exit`, `pon-onu-mng ${onuIf}`);

  if (params.voipSipEnabled) {
    lines.push(`  voip protocol sip`);
  }

  lines.push(
    `  flow mode 1 tag-filter vlan-filter untag-filter discard`,
    `  flow 1 pri 0 vlan ${params.vlanId}`
  );

  if (params.hotspotBridgeVlan) {
    lines.push(`  flow 1 pri 0 vlan ${params.hotspotBridgeVlan}`);
  }

  lines.push(
    `  gemport 1 flow 1`,
    `  switchport-bind switch_0/1 iphost 1`,
    `  switchport-bind switch_0/1 veip 1`
  );

  if (onuMode === 'Bridging' || params.wanMode === 'BRIDGE') {
    lines.push(
      `  vlan port eth_0/1 mode tag vlan ${params.vlanId}`,
      `  vlan port eth_0/2 mode tag vlan ${params.vlanId}`,
      `  vlan port eth_0/3 mode tag vlan ${params.vlanId}`,
      `  vlan port eth_0/4 mode tag vlan ${params.vlanId}`
    );
  } else if (params.wanMode === 'PPPOE') {
    const rawUser = params.pppoeUsername ? params.pppoeUsername.trim() : cleanName;
    const user = rawUser.replace(/\s+/g, '-') || cleanName;
    const pass = (params.pppoePassword || 'jetcyber').trim().replace(/\s+/g, '');
    lines.push(
      `  pppoe 1 nat enable user ${user} password ${pass}`,
      `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
      `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
    );
  } else if (params.wanMode === 'DHCP') {
    lines.push(
      `  ip-host 1 dhcp-enable enable ping-response enable traceroute-response enable`,
      `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
      `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
    );
  } else if (params.wanMode === 'STATIC_IP') {
    const ip = params.staticIpAddress || '172.16.10.50';
    const mask = params.staticSubnetMask || '255.255.255.0';
    const gw = params.staticGateway || '172.16.10.1';
    lines.push(
      `  ip-host 1 ip ${ip} mask ${mask} gateway ${gw}`,
      `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
      `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
    );
  } else {
    // Setup via ONU Webpage
    lines.push(
      `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
      `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
    );
  }

  // SmartOLT standard: configure all 8 ethuni ports (`eth_0/1` .. `eth_0/8`)
  for (let e = 1; e <= 8; e++) {
    lines.push(`  dhcp-ip ethuni eth_0/${e} from-onu`);
  }

  if (params.voipSipEnabled) {
    lines.push(`  veip 1 port udp 1232 host 2`);
  }

  // TR-069 CWMP configuration (if enabled)
  if (configMethod === 'TR069' || params.tr069Enabled) {
    lines.push(
      ...buildTr069CliLines({
        enabled: true,
        acsUrl: params.tr069AcsUrl,
        acsUsername: params.tr069AcsUsername,
        acsPassword: params.tr069AcsPassword,
        vlanId: 100,
      })
    );
  }

  // Security management rules (WAN Remote Access + LAN management)
  lines.push(
    ...buildWanRemoteAccessCliLines(wanRemoteAccess, params.wanRemoteAllowedSubnet),
    `exit`,
    `end`,
    `write`
  );

  return lines.join('\n');
}

/**
 * 6. GENERATOR SCRIPT KHUSUS MODAL "Update ONU mode" (Sesuai Sintaks Asli Running-Config)
 */
export function generateUpdateOnuModeCliScript(params: {
  firmwareVersion: 'V2.1.0' | 'V1.2.5P3';
  ponInterface: string;
  onuIndex: number;
  serialNumber: string;
  customerName?: string;
  address?: string;
  rebindTypeAll?: boolean;
  vlanId: number;
  onuMode: OnuModeOption;
  wanMode: WanModeOption;
  configMethod: ConfigMethodOption;
  wanRemoteAccess: WanRemoteAccessOption;
  wanRemoteAllowedSubnet?: string;
  pppoeUsername?: string;
  pppoePassword?: string;
  staticIpAddress?: string;
  staticSubnetMask?: string;
  staticGateway?: string;
  staticDns1?: string;
  tr069AcsUrl?: string;
  tr069AcsUsername?: string;
  tr069AcsPassword?: string;
  tr069PeriodicInterval?: number;
  wifiSsid?: string;
  wifiPassword?: string;
}): string {
  const coords = params.ponInterface.replace(/^gpon-olt_/i, '');
  const oltIf = `gpon-olt_${coords}`;
  const onuIf = `gpon-onu_${coords}:${params.onuIndex}`;
  const cleanName =
    (params.customerName || params.pppoeUsername || params.serialNumber)
      .replace(/[^a-zA-Z0-9_\-. ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toUpperCase() || params.serialNumber;
  const cleanDesc =
    params.address &&
    params.address.trim() &&
    params.address.trim().toLowerCase() !== 'none'
      ? params.address
          .replace(/[^a-zA-Z0-9_\-. ,/]/g, '')
          .trim()
          .replace(/\s+/g, '-')
      : 'none';

  const lines: string[] = [`configure terminal`];

  if (params.rebindTypeAll) {
    lines.push(
      `interface ${oltIf}`,
      `  no onu ${params.onuIndex}`,
      `  onu ${params.onuIndex} type ALL sn ${params.serialNumber}`,
      `exit`,
      `interface ${onuIf}`,
      `  name ${cleanName}`,
      `  description ${cleanDesc}`,
      `  tcont 1 profile SMARTOLT-1G-UP`,
      `  gemport 1 tcont 1`,
      `  gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN`,
      `  service-port 1 vport 1 user-vlan ${params.vlanId} vlan ${params.vlanId}`
    );
  } else {
    lines.push(
      `interface ${onuIf}`,
      `  name ${cleanName}`,
      `  description ${cleanDesc}`,
      `  tcont 1 profile SMARTOLT-1G-UP`,
      `  gemport 1 tcont 1`,
      `  gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN`,
      `  no service-port 1`,
      `  service-port 1 vport 1 user-vlan ${params.vlanId} vlan ${params.vlanId}`
    );
  }

  if (params.configMethod === 'TR069') {
    lines.push(
      `  tcont 2 profile SMARTOLT-VOIPMNG-10M`,
      `  gemport 2 tcont 2`,
      `  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M`,
      `  service-port 2 vport 2 user-vlan 100 vlan 100`
    );
  }

  lines.push(
    `exit`,
    `pon-onu-mng ${onuIf}`,
    `  flow mode 1 tag-filter vlan-filter untag-filter discard`,
    `  flow 1 pri 0 vlan ${params.vlanId}`,
    `  gemport 1 flow 1`,
    `  switchport-bind switch_0/1 iphost 1`,
    `  switchport-bind switch_0/1 veip 1`
  );

  if (params.onuMode === 'Bridging') {
    lines.push(
      `  no pppoe 1`,
      `  vlan port eth_0/1 mode tag vlan ${params.vlanId}`,
      `  vlan port eth_0/2 mode tag vlan ${params.vlanId}`,
      `  vlan port eth_0/3 mode tag vlan ${params.vlanId}`,
      `  vlan port eth_0/4 mode tag vlan ${params.vlanId}`
    );
  } else {
    if (params.wanMode === 'PPPOE') {
      const user =
        (params.pppoeUsername || cleanName).trim().replace(/\s+/g, '-') || cleanName;
      const pass = (params.pppoePassword || 'jetcyber').trim().replace(/\s+/g, '');
      if (!params.rebindTypeAll) {
        lines.push(`  no pppoe 1`);
      }
      lines.push(
        `  pppoe 1 nat enable user ${user} password ${pass}`,
        `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
      );
    } else if (params.wanMode === 'DHCP') {
      lines.push(
        `  no pppoe 1`,
        `  ip-host 1 dhcp-enable enable ping-response enable traceroute-response enable`,
        `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
      );
    } else if (params.wanMode === 'STATIC_IP') {
      lines.push(
        `  no pppoe 1`,
        `  ip-host 1 ip ${params.staticIpAddress || '172.16.10.50'} mask ${params.staticSubnetMask || '255.255.255.0'} gateway ${params.staticGateway || '172.16.10.1'}`,
        `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
      );
    } else {
      lines.push(
        `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
        `  vlan-filter iphost 1 pri 0 vlan ${params.vlanId}`
      );
    }

    for (let e = 1; e <= 8; e++) {
      lines.push(`  dhcp-ip ethuni eth_0/${e} from-onu`);
    }
  }

  if (params.configMethod === 'TR069') {
    lines.push(
      ...buildTr069CliLines({
        enabled: true,
        acsUrl: params.tr069AcsUrl,
        acsUsername: params.tr069AcsUsername,
        acsPassword: params.tr069AcsPassword,
        vlanId: 100,
      })
    );
  }

  lines.push(
    ...buildWanRemoteAccessCliLines(
      params.wanRemoteAccess,
      params.wanRemoteAllowedSubnet
    ),
    `exit`,
    `end`,
    `write`
  );

  return lines.join('\n');
}

/**
 * 7. GENERATOR PAYLOAD TR-069 CWMP (`SetParameterValues`) UNTUK PROVISIONING VIA ACS
 */
export function generateTr069CwmpRpcPreview(params: {
  serialNumber: string;
  vlanId: number;
  onuMode: OnuModeOption;
  wanMode: WanModeOption;
  pppoeUsername: string;
  pppoePassword: string;
  wanRemoteAccess: WanRemoteAccessOption;
  acsUrl: string;
  periodicInterval: number;
  wifiSsid?: string;
  wifiPassword?: string;
}): string {
  const remoteEnableBool = params.wanRemoteAccess === 'Disabled' ? 'false' : 'true';
  const lines = [
    `# [TR-069 CWMP ACS Task — Device ID: OUI-ZTE-${params.serialNumber}]`,
    `POST ${params.acsUrl}/devices/ZTE-${params.serialNumber}/tasks?connection_request`,
    `{`,
    `  "name": "setParameterValues",`,
    `  "parameterValues": [`,
    `    ["InternetGatewayDevice.ManagementServer.PeriodicInformEnable", true, "xsd:boolean"],`,
    `    ["InternetGatewayDevice.ManagementServer.PeriodicInformInterval", ${params.periodicInterval}, "xsd:unsignedInt"],`,
    `    ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_ZTE-COM_WANEponLinkConfig.VLANIDMark", ${params.vlanId}, "xsd:unsignedInt"],`,
    `    ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", ${params.onuMode === 'Routing' ? 'true' : 'false'}, "xsd:boolean"],`,
    `    ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType", "${params.onuMode === 'Bridging' ? 'PPPoE_Bridged' : 'IP_Routed'}", "xsd:string"],`,
    `    ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username", "${params.pppoeUsername}", "xsd:string"],`,
    `    ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password", "${params.pppoePassword}", "xsd:string"],`,
    `    ["InternetGatewayDevice.X_ZTE-COM_Security.WanRemoteAccessEnable", ${remoteEnableBool}, "xsd:boolean"],`,
    `    ["InternetGatewayDevice.X_ZTE-COM_Security.WanHttpEnable", ${remoteEnableBool}, "xsd:boolean"],`,
    `    ["InternetGatewayDevice.X_ZTE-COM_Security.WanPingRespond", ${remoteEnableBool}, "xsd:boolean"]`,
  ];

  if (params.wifiSsid) {
    lines.push(
      `    ,["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", "${params.wifiSsid}", "xsd:string"]`
    );
  }
  if (params.wifiPassword) {
    lines.push(
      `    ,["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", "${params.wifiPassword}", "xsd:string"]`
    );
  }

  lines.push(`  ]`, `}`);
  return lines.join('\n');
}

export function generateRebootCliScript(ponInterface: string, onuIndex: number): string {
  const coords = ponInterface.replace(/^gpon-olt_/i, '');
  const onuIf = `gpon-onu_${coords}:${onuIndex}`;
  return [
    `configure terminal`,
    `pon-onu-mng ${onuIf}`,
    `  reboot`,
    `exit`,
    `end`,
  ].join('\n');
}

export function generateFactoryResetCliScript(ponInterface: string, onuIndex: number): string {
  const coords = ponInterface.replace(/^gpon-olt_/i, '');
  const onuIf = `gpon-onu_${coords}:${onuIndex}`;
  return [
    `configure terminal`,
    `pon-onu-mng ${onuIf}`,
    `  restore factory`,
    `exit`,
    `end`,
  ].join('\n');
}

export function generateUpdatePppoeCliScript(
  ponInterface: string,
  onuIndex: number,
  vlanId: number,
  pppoeUsername: string,
  pppoePassword: string,
  wanRemoteAccess: WanRemoteAccessOption = 'Enabled from everywhere in the internet'
): string {
  const coords = ponInterface.replace(/^gpon-olt_/i, '');
  const onuIf = `gpon-onu_${coords}:${onuIndex}`;
  const cleanUser = pppoeUsername.trim().replace(/\s+/g, '-');
  const cleanPass = pppoePassword.trim().replace(/\s+/g, '');
  return [
    `configure terminal`,
    `interface ${onuIf}`,
    `  tcont 1 profile SMARTOLT-1G-UP`,
    `  gemport 1 tcont 1`,
    `  gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN`,
    `  no service-port 1`,
    `  service-port 1 vport 1 user-vlan ${vlanId} vlan ${vlanId}`,
    `exit`,
    `pon-onu-mng ${onuIf}`,
    `  flow mode 1 tag-filter vlan-filter untag-filter discard`,
    `  flow 1 pri 0 vlan ${vlanId}`,
    `  gemport 1 flow 1`,
    `  switchport-bind switch_0/1 iphost 1`,
    `  switchport-bind switch_0/1 veip 1`,
    `  no pppoe 1`,
    `  pppoe 1 nat enable user ${cleanUser} password ${cleanPass}`,
    `  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard`,
    `  vlan-filter iphost 1 pri 0 vlan ${vlanId}`,
    `  dhcp-ip ethuni eth_0/1 from-onu`,
    `  dhcp-ip ethuni eth_0/2 from-onu`,
    `  dhcp-ip ethuni eth_0/3 from-onu`,
    `  dhcp-ip ethuni eth_0/4 from-onu`,
    `  dhcp-ip ethuni eth_0/5 from-onu`,
    `  dhcp-ip ethuni eth_0/6 from-onu`,
    `  dhcp-ip ethuni eth_0/7 from-onu`,
    `  dhcp-ip ethuni eth_0/8 from-onu`,
    ...buildWanRemoteAccessCliLines(wanRemoteAccess),
    `exit`,
    `end`,
    `write`,
  ].join('\n');
}

export function generateDeleteOnuCliScript(ponInterface: string, onuIndex: number): string {
  const coords = ponInterface.replace(/^gpon-olt_/i, '');
  const oltIf = `gpon-olt_${coords}`;
  return [
    `configure terminal`,
    `interface ${oltIf}`,
    `  no onu ${onuIndex}`,
    `exit`,
    `end`,
    `write`,
  ].join('\n');
}

/**
 * Helper Klasifikasi Warna Redaman Optik sesuai Standar FTTH SmartOLT
 */
export function classifyOpticalSignal(
  rxDbm: number | null,
  phaseState: string
): {
  level: 'GOOD' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
  label: string;
  badgeClass: string;
} {
  if (phaseState === 'LOS' || rxDbm === null || rxDbm <= -38) {
    return {
      level: 'CRITICAL',
      label: phaseState === 'LOS' ? 'LOS (No Light)' : 'No Signal',
      badgeClass: 'bg-red-600 text-white',
    };
  }
  if (phaseState === 'DyingGasp' || phaseState === 'OffLine') {
    return {
      level: 'OFFLINE',
      label: `${rxDbm.toFixed(2)} dBm (PwrOff)`,
      badgeClass: 'bg-slate-600 text-white',
    };
  }
  if (rxDbm >= -24.99 && rxDbm <= -8.0) {
    return {
      level: 'GOOD',
      label: `${rxDbm.toFixed(2)} dBm`,
      badgeClass: 'bg-emerald-600 text-white',
    };
  }
  if (rxDbm >= -27.0 && rxDbm < -24.99) {
    return {
      level: 'WARNING',
      label: `${rxDbm.toFixed(2)} dBm`,
      badgeClass: 'bg-amber-500 text-slate-950 font-semibold',
    };
  }
  return {
    level: 'CRITICAL',
    label: `${rxDbm.toFixed(2)} dBm`,
    badgeClass: 'bg-red-600 text-white',
  };
}

/**
 * 8. GENERATOR CLI ZTE UNTUK KONFIGURASI PORT UPLINK & TAG VLAN KE UPLINK
 * Sesuai persis dengan `interface xgei_1/19/1` & `interface gei_1/19/3` di running-config:
 *   interface gei_1/19/3
 *     no shutdown
 *     hybrid-attribute fiber
 *     negotiation auto
 *     flowcontrol disable
 *     linktrap enable
 *     switchport mode hybrid
 *     switchport default vlan 41
 *     switchport vlan 100-102 tag
 *     port-protect disable
 *     uplink-isolate disable
 */
export function generateUplinkConfigCliScript(params: {
  uplinkName: string; // contoh: gei_1/19/3 atau xgei_1/19/1
  description: string;
  adminState: 'Enabled' | 'Disabled';
  portMode: 'Hybrid' | 'Trunk' | 'Access';
  pvidUntag: number;
  taggedVlans: string; // contoh: "100-102" atau "100-102,111,120"
  mtu: number;
}): string {
  const modeLower = params.portMode.toLowerCase();
  const cleanVlans =
    params.taggedVlans.replace(/^(Hybrid|Trunk|Access):\s*/i, '').trim() || '100-102';
  const is10G = params.uplinkName.startsWith('xgei');

  const lines = [
    `configure terminal`,
    `eth-switch max-frame-length ${params.mtu || 1600}`,
    `interface ${params.uplinkName}`,
  ];

  if (is10G) {
    lines.push(`  phy-attribute lan`);
  }
  lines.push(
    params.adminState === 'Enabled' ? `  no shutdown` : `  shutdown`,
    `  hybrid-attribute fiber`,
    is10G ? `  no negotiation auto` : `  negotiation auto`
  );
  if (is10G) {
    lines.push(`  speed 10000`, `  duplex full`);
  }
  if (params.description && params.description.trim()) {
    lines.push(`  description ${params.description.trim()}`);
  }
  lines.push(
    `  flowcontrol disable`,
    `  linktrap enable`,
    `  switchport mode ${modeLower}`,
    `  switchport default vlan ${params.pvidUntag || 41}`
  );

  if (params.portMode !== 'Access' && cleanVlans) {
    lines.push(`  switchport vlan ${cleanVlans} tag`);
  }

  lines.push(
    `  port-protect disable`,
    `  uplink-isolate disable`,
    `exit`,
    `end`,
    `write`
  );
  return lines.join('\n');
}

/**
 * 9. GENERATOR CLI ZTE UNTUK PEMBUATAN VLAN BARU (+ OPSIONAL TAG OTOMATIS KE UPLINK)
 * Sesuai persis dengan `vlan database`, `vlan <id>`, `gpon -> onu profile vlan SMARTOLT-vlan<id>` di running-config!
 */
export function generateCreateVlanCliScript(params: {
  vlanIds: number[];
  descriptionPrefix: string;
  tagToUplinks: string[]; // contoh: ['gei_1/19/3', 'xgei_1/19/1']
  dhcpSnooping?: boolean;
}): string {
  const vlanCsv = params.vlanIds.join(',');
  const lines = [
    `configure terminal`,
    `vlan database`,
    `  vlan ${vlanCsv}`,
    `exit`,
  ];

  for (const vid of params.vlanIds) {
    const vName =
      params.vlanIds.length === 1
        ? (params.descriptionPrefix || `VLAN_${vid}`).replace(/\s+/g, '_')
        : `${(params.descriptionPrefix || 'VLAN').replace(/\s+/g, '_')}_${vid}`;
    lines.push(`vlan ${vid}`, `  name ${vName}`, `exit`);
  }

  lines.push(`gpon`);
  for (const vid of params.vlanIds) {
    lines.push(`  onu profile vlan SMARTOLT-vlan${vid} tag-mode tag cvlan ${vid}`);
  }
  lines.push(`exit`);

  if (params.dhcpSnooping) {
    lines.push(`ip dhcp snooping control-port enable`);
  }

  if (params.tagToUplinks.length > 0) {
    for (const uplinkIf of params.tagToUplinks) {
      lines.push(
        `interface ${uplinkIf}`,
        `  switchport mode hybrid`,
        `  switchport vlan ${vlanCsv} tag`,
        `exit`
      );
    }
  }

  lines.push(`end`, `write`);
  return lines.join('\n');
}

/**
 * 10. GENERATOR CLI ZTE UNTUK KONFIGURASI PORT ETHERNET ONU (eth_0/1 .. eth_0/8)
 * Sesuai persis dengan `onu-pnp -> onu-uni-vlan` & `pon-onu-mng -> dhcp-ip ethuni` di running-config!
 */
export function generateOnuEthPortCliScript(params: {
  ponInterface: string;
  onuIndex: number;
  ethPort: string; // eth_0/1
  adminState: 'Unlocked' | 'Locked';
  mode: 'LAN' | 'Tag VLAN' | 'Transparent';
  vlanId: number;
  dhcpMode: 'From ONU' | 'From Internet';
}): string {
  const coords = params.ponInterface.replace(/^gpon-olt_/i, '');
  const oltIf = `gpon-olt_${coords}`;
  const onuIf = `gpon-onu_${coords}:${params.onuIndex}`;
  const lines = [`configure terminal`];

  if (params.mode === 'Tag VLAN') {
    lines.push(
      `onu-pnp`,
      `  onu-uni-vlan ${oltIf} ${params.ethPort} mode tag vlan ${params.vlanId}`,
      `exit`
    );
  }

  lines.push(
    `pon-onu-mng ${onuIf}`,
    params.adminState === 'Unlocked'
      ? `  interface eth ${params.ethPort} state unlock`
      : `  interface eth ${params.ethPort} state lock`
  );

  if (params.mode === 'Tag VLAN') {
    lines.push(`  flow 1 pri 0 vlan ${params.vlanId}`);
  } else if (params.mode === 'Transparent') {
    lines.push(`  vlan port ${params.ethPort} mode transparent`);
  }

  lines.push(
    params.dhcpMode === 'From Internet'
      ? `  dhcp-ip ethuni ${params.ethPort} from-internet`
      : `  dhcp-ip ethuni ${params.ethPort} from-onu`,
    `exit`,
    `end`,
    `write`
  );
  return lines.join('\n');
}

/**
 * 11. PARSER `#show running-config` ASLI ZTE C300 / C320
 * Membaca seluruh konfigurasi berjalan dari OLT (VLANs, Uplink Tagged VLANs, Registered ONUs, PPPoE Users, TR-069)
 */
export interface ParsedRunningConfigOnu {
  board: number;
  port: number;
  onuIndex: number;
  onuType: string;
  serialNumber: string;
  name: string;
  description: string;
  tcontProfile: string;
  trafficProfile: string;
  vlanId: number;
  extraFlowVlans: number[];
  pppoeUsername: string | null;
  pppoePassword: string | null;
  tr069Enabled: boolean;
  tr069AcsUrl: string | null;
  wanRemoteRestrictedIp: string | null;
}

export interface ParsedOltCard {
  slot: number;
  type: string;
  realType: string;
  ports: number | null;
  swVersion: string;
  status: 'Online' | 'Standby' | 'Offline';
  role: 'Main' | 'Standby';
}

export interface ParsedRunningConfigSummary {
  hostname: string | null;
  vlans: { vlanId: number; name: string }[];
  cards: ParsedOltCard[];
  tcontProfiles: {
    name: string;
    type: number;
    fixedKbps: number;
    assuredKbps: number;
    maxKbps: number;
  }[];
  trafficProfiles: {
    name: string;
    sirKbps: number;
    pirKbps: number;
  }[];
  uplinks: {
    name: string;
    pvidUntag: number;
    taggedVlans: string;
    speed: string;
    adminState: 'Enabled' | 'Disabled';
  }[];
  onus: ParsedRunningConfigOnu[];
}

export function parseZteCardOutput(rawText: string): ParsedOltCard[] {
  const cardsMap = new Map<number, ParsedOltCard>();

  // 1. From `add-card rackno 1 shelfno 1 slotno 3 GTGH` in running-config
  const addCardRegex = /add-card\s+rackno\s+\d+\s+shelfno\s+\d+\s+slotno\s+(\d+)\s+(\S+)/gi;
  let acm: RegExpExecArray | null;
  while ((acm = addCardRegex.exec(rawText)) !== null) {
    const slot = parseInt(acm[1], 10);
    const ctype = acm[2].trim().toUpperCase();
    cardsMap.set(slot, {
      slot,
      type: ctype,
      realType: ctype,
      ports: ctype.startsWith('GTG') ? 16 : ctype.startsWith('GTXO') ? 8 : ctype.startsWith('HUV') ? 4 : null,
      swVersion: 'V2.1.0',
      status: 'Online',
      role: 'Main',
    });
  }

  // 2. From `show card` output:
  // 1    1     3    GTGH    GTGH     16     V1.0.0  V2.1.0          Insigh
  const showCardRegex =
    /^\s*\d+\s+\d+\s+(\d+)\s+([A-Z0-9]{3,8})\s+([A-Z0-9]{3,8})?\s*(\d+)?\s*(?:V[\d.]+\s+)?(V[\d.P]+)?\s*(Insigh|Inservice|Online|Standby|Offline)/gim;
  let scm: RegExpExecArray | null;
  while ((scm = showCardRegex.exec(rawText)) !== null) {
    const slot = parseInt(scm[1], 10);
    const cfgType = scm[2].toUpperCase();
    const realType = (scm[3] || cfgType).toUpperCase();
    const ports = scm[4] ? parseInt(scm[4], 10) : cfgType.startsWith('GTG') ? 16 : null;
    const swVer = scm[5] || 'V2.1.0';
    const rawStat = (scm[6] || 'Online').toLowerCase();
    const status: ParsedOltCard['status'] =
      rawStat === 'offline' ? 'Offline' : rawStat === 'standby' ? 'Standby' : 'Online';
    cardsMap.set(slot, {
      slot,
      type: cfgType,
      realType,
      ports: ports === 0 ? null : ports,
      swVersion: swVer,
      status,
      role: status === 'Standby' ? 'Standby' : 'Main',
    });
  }

  return Array.from(cardsMap.values()).sort((a, b) => a.slot - b.slot);
}

function expandVlanSpecToNumbers(spec: string): number[] {
  const nums: number[] = [];
  const parts = spec.split(',');
  for (const p of parts) {
    const token = p.trim();
    if (!token) continue;
    if (token.includes('-')) {
      const [s, e] = token.split('-').map((n) => parseInt(n.trim(), 10));
      if (!isNaN(s) && !isNaN(e) && s <= e && e - s <= 500) {
        for (let v = s; v <= e; v++) nums.push(v);
      }
    } else {
      const v = parseInt(token, 10);
      if (!isNaN(v) && v >= 1 && v <= 4094) nums.push(v);
    }
  }
  return nums;
}

export function parseZteRunningConfig(rawConfig: string): ParsedRunningConfigSummary {
  const vlansMap = new Map<number, string>();
  const uplinks: ParsedRunningConfigSummary['uplinks'] = [];
  const onuMap = new Map<string, ParsedRunningConfigOnu>();
  const tcontProfiles: ParsedRunningConfigSummary['tcontProfiles'] = [];
  const trafficProfiles: ParsedRunningConfigSummary['trafficProfiles'] = [];

  const hostMatch = rawConfig.match(/^\s*hostname\s+(\S+)/m);
  const hostname = hostMatch ? hostMatch[1].trim() : null;

  // 1. Parse `vlan database`
  const vlanDbRegex = /vlan database([\s\S]*?)!/g;
  let vdb: RegExpExecArray | null;
  while ((vdb = vlanDbRegex.exec(rawConfig)) !== null) {
    const vlanLines = vdb[1].split(/\r?\n/);
    for (const l of vlanLines) {
      const m = l.trim().match(/^vlan\s+(.+)$/i);
      if (m) {
        for (const v of expandVlanSpecToNumbers(m[1])) {
          if (!vlansMap.has(v)) vlansMap.set(v, `VLAN_${v}`);
        }
      }
    }
  }

  // 1b. Parse `onu profile vlan <name> tag-mode tag cvlan <id>`
  const gponVlanProfRegex = /onu\s+profile\s+vlan\s+(\S+)\s+tag-mode\s+\S+\s+cvlan\s+(\d+)/gi;
  let gvp: RegExpExecArray | null;
  while ((gvp = gponVlanProfRegex.exec(rawConfig)) !== null) {
    const profName = gvp[1].trim();
    const vid = parseInt(gvp[2], 10);
    if (!isNaN(vid) && !vlansMap.has(vid)) {
      vlansMap.set(vid, profName.replace(/^SMARTOLT-vlan/i, 'VLAN_'));
    }
  }

  // 2. Parse named `vlan <id>` blocks
  const namedVlanRegex = /^vlan\s+(\d+)\r?\n\s+name\s+([^\r\n!]+)/gm;
  let vm: RegExpExecArray | null;
  while ((vm = namedVlanRegex.exec(rawConfig)) !== null) {
    const vid = parseInt(vm[1], 10);
    const vname = vm[2].trim();
    vlansMap.set(vid, vname);
  }

  // 2b. Parse GPON TCONT & Traffic profiles
  const tcontProfRegex =
    /profile\s+tcont\s+(\S+)\s+type\s+(\d+)(?:\s+fixed\s+(\d+))?(?:\s+assured\s+(\d+))?\s+maximum\s+(\d+)/gi;
  let tcp: RegExpExecArray | null;
  while ((tcp = tcontProfRegex.exec(rawConfig)) !== null) {
    tcontProfiles.push({
      name: tcp[1].trim(),
      type: parseInt(tcp[2], 10),
      fixedKbps: tcp[3] ? parseInt(tcp[3], 10) : 0,
      assuredKbps: tcp[4] ? parseInt(tcp[4], 10) : 0,
      maxKbps: parseInt(tcp[5], 10),
    });
  }

  const trafficProfRegex = /profile\s+traffic\s+(\S+)\s+sir\s+(\d+)\s+pir\s+(\d+)/gi;
  let trp: RegExpExecArray | null;
  while ((trp = trafficProfRegex.exec(rawConfig)) !== null) {
    trafficProfiles.push({
      name: trp[1].trim(),
      sirKbps: parseInt(trp[2], 10),
      pirKbps: parseInt(trp[3], 10),
    });
  }

  // 3. Parse `interface gpon-olt_1/x/y` for ONU registrations
  const oltBlockRegex =
    /interface gpon-olt_(\d+)\/(\d+)\/(\d+)([\s\S]*?)(?=!|\bend\b|interface\s+|pon-onu-mng\s+|$)/gi;
  let ob: RegExpExecArray | null;
  while ((ob = oltBlockRegex.exec(rawConfig)) !== null) {
    const board = parseInt(ob[2], 10);
    const port = parseInt(ob[3], 10);
    const body = ob[4];
    const onuLineRegex = /onu\s+(\d+)\s+type\s+(\S+)\s+sn\s+(\S+)/gi;
    let ol: RegExpExecArray | null;
    while ((ol = onuLineRegex.exec(body)) !== null) {
      const onuIndex = parseInt(ol[1], 10);
      const key = `1/${board}/${port}:${onuIndex}`;
      onuMap.set(key, {
        board,
        port,
        onuIndex,
        onuType: ol[2].trim(),
        serialNumber: ol[3].trim().toUpperCase(),
        name: `ONU-${ol[3].trim().toUpperCase()}`,
        description: 'none',
        tcontProfile: 'SMARTOLT-1G-UP',
        trafficProfile: 'SMARTOLT-1G-DOWN',
        vlanId: 101,
        extraFlowVlans: [],
        pppoeUsername: null,
        pppoePassword: null,
        tr069Enabled: false,
        tr069AcsUrl: null,
        wanRemoteRestrictedIp: null,
      });
    }
  }

  // 4. Parse `interface gpon-onu_1/x/y:z` (also auto-create entry if oltBlock was not in snippet)
  const onuIfRegex =
    /interface gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)([\s\S]*?)(?=!|\bend\b|interface\s+|pon-onu-mng\s+|$)/gi;
  let oib: RegExpExecArray | null;
  while ((oib = onuIfRegex.exec(rawConfig)) !== null) {
    const board = parseInt(oib[2], 10);
    const port = parseInt(oib[3], 10);
    const onuIndex = parseInt(oib[4], 10);
    const key = `${oib[1]}/${board}/${port}:${onuIndex}`;
    let existing = onuMap.get(key);
    if (!existing) {
      existing = {
        board,
        port,
        onuIndex,
        onuType: 'ALL',
        serialNumber: `ONU-${board}-${port}-${onuIndex}`,
        name: `ONU-${board}-${port}-${onuIndex}`,
        description: 'none',
        tcontProfile: 'SMARTOLT-1G-UP',
        trafficProfile: 'SMARTOLT-1G-DOWN',
        vlanId: 101,
        extraFlowVlans: [],
        pppoeUsername: null,
        pppoePassword: null,
        tr069Enabled: false,
        tr069AcsUrl: null,
        wanRemoteRestrictedIp: null,
      };
      onuMap.set(key, existing);
    }
    const body = oib[5];
    const nameMatch = body.match(/^\s*name\s+([^\r\n]+)/m);
    if (nameMatch) existing.name = nameMatch[1].trim();
    const descMatch = body.match(/^\s*description\s+([^\r\n]+)/m);
    if (descMatch) existing.description = descMatch[1].trim();
    const tcontMatch = body.match(/tcont\s+1\s+profile\s+(\S+)/);
    if (tcontMatch) existing.tcontProfile = tcontMatch[1].trim();
    const trafficMatch = body.match(/gemport\s+1\s+traffic-limit\s+downstream\s+(\S+)/);
    if (trafficMatch) existing.trafficProfile = trafficMatch[1].trim();
    const spMatch = body.match(/service-port\s+1\s+vport\s+1\s+user-vlan\s+(\d+)\s+vlan\s+(\d+)/);
    if (spMatch) {
      const svlan = parseInt(spMatch[2], 10);
      existing.vlanId = svlan;
      if (!vlansMap.has(svlan)) {
        vlansMap.set(svlan, svlan === 101 ? 'PPPOE' : `VLAN_${svlan}`);
      }
    }
  }

  // 5. Parse `pon-onu-mng gpon-onu_1/x/y:z`
  const mngRegex =
    /pon-onu-mng gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)([\s\S]*?)(?=!|\bend\b|interface\s+|pon-onu-mng\s+|$)/gi;
  let mb: RegExpExecArray | null;
  while ((mb = mngRegex.exec(rawConfig)) !== null) {
    const board = parseInt(mb[2], 10);
    const port = parseInt(mb[3], 10);
    const onuIndex = parseInt(mb[4], 10);
    const key = `${mb[1]}/${board}/${port}:${onuIndex}`;
    let existing = onuMap.get(key);
    if (!existing) {
      existing = {
        board,
        port,
        onuIndex,
        onuType: 'ALL',
        serialNumber: `ONU-${board}-${port}-${onuIndex}`,
        name: `ONU-${board}-${port}-${onuIndex}`,
        description: 'none',
        tcontProfile: 'SMARTOLT-1G-UP',
        trafficProfile: 'SMARTOLT-1G-DOWN',
        vlanId: 101,
        extraFlowVlans: [],
        pppoeUsername: null,
        pppoePassword: null,
        tr069Enabled: false,
        tr069AcsUrl: null,
        wanRemoteRestrictedIp: null,
      };
      onuMap.set(key, existing);
    }
    const body = mb[5];
    const pppoeMatch = body.match(/pppoe\s+1\s+nat\s+enable\s+user\s+(\S+)\s+password\s+(\S+)/);
    if (pppoeMatch) {
      existing.pppoeUsername = pppoeMatch[1].trim();
      existing.pppoePassword = pppoeMatch[2].trim();
    }
    const flowRegex = /flow\s+1\s+pri\s+\d+\s+vlan\s+(\d+)/g;
    let fm: RegExpExecArray | null;
    while ((fm = flowRegex.exec(body)) !== null) {
      const fVlan = parseInt(fm[1], 10);
      if (!vlansMap.has(fVlan)) {
        vlansMap.set(fVlan, `VLAN_${fVlan}`);
      }
      if (fVlan !== existing.vlanId && !existing.extraFlowVlans.includes(fVlan)) {
        existing.extraFlowVlans.push(fVlan);
      }
    }
    const trMatch = body.match(/tr069-mgmt\s+1\s+acs\s+(\S+)/);
    if (trMatch) {
      existing.tr069Enabled = true;
      existing.tr069AcsUrl = trMatch[1].trim();
    }
    const secIpMatch = body.match(/security-mgmt\s+10\s+start-src-ip\s+(\S+)/);
    if (secIpMatch) {
      existing.wanRemoteRestrictedIp = secIpMatch[1].trim();
    }
  }

  // 6. Parse Uplink interfaces (`xgei_1/19/1`, `gei_1/19/3`, etc.)
  const uplinkRegex = /interface\s+((?:x?gei)_\d+\/\d+\/\d+)([\s\S]*?)!/g;
  let ub: RegExpExecArray | null;
  while ((ub = uplinkRegex.exec(rawConfig)) !== null) {
    const name = ub[1].trim();
    const body = ub[2];
    const pvidM = body.match(/switchport\s+default\s+vlan\s+(\d+)/);
    const tagM = body.match(/switchport\s+vlan\s+([^\r\n]+?)\s+tag/);
    const isShutdown = /^\s*shutdown\b/m.test(body) && !/^\s*no\s+shutdown\b/m.test(body);
    if (tagM) {
      for (const tv of expandVlanSpecToNumbers(tagM[1].trim())) {
        if (!vlansMap.has(tv)) vlansMap.set(tv, `VLAN_${tv}`);
      }
    }
    uplinks.push({
      name,
      pvidUntag: pvidM ? parseInt(pvidM[1], 10) : 41,
      taggedVlans: `Hybrid: ${tagM ? tagM[1].trim() : '102'}`,
      speed: name.startsWith('xgei') ? 'Forced 10G-FullD' : 'Auto',
      adminState: isShutdown ? 'Disabled' : 'Enabled',
    });
  }

  const cards = parseZteCardOutput(rawConfig);

  return {
    hostname,
    vlans: Array.from(vlansMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([vlanId, name]) => ({
        vlanId,
        name,
      })),
    cards,
    tcontProfiles,
    trafficProfiles,
    uplinks,
    onus: Array.from(onuMap.values()),
  };
}
