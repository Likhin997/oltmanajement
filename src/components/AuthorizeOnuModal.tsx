import React, { useState, useMemo, useEffect } from 'react';
import {
  SmartOltDatabaseState,
  OnuRecord,
  ZoneRecord,
  SectorRecord,
  OdbRecord,
} from '../services/mockDatabase';
import {
  findNextAvailableOnuIndex,
  generateAuthorizeCliScript,
  OnuModeOption,
  WanModeOption,
  ConfigMethodOption,
  WanRemoteAccessOption,
} from '../services/oltEngine';
import {
  Save,
  Terminal,
  Copy,
  Check,
  Plus,
  Info,
  RefreshCw,
  X,
} from 'lucide-react';

interface AuthorizeOnuModalProps {
  onu: OnuRecord;
  db: SmartOltDatabaseState;
  onClose: () => void;
  onConfirmAuthorize: (
    onuId: number,
    updatedFields: Partial<OnuRecord>,
    generatedCli: string,
    allocatedOnuIndex: number
  ) => void;
  onQuickAddZone?: (zone: Omit<ZoneRecord, 'id'>) => ZoneRecord;
  onQuickAddSector?: (sector: Omit<SectorRecord, 'id'>) => SectorRecord;
  onQuickAddSplitter?: (odb: Omit<OdbRecord, 'id'>) => OdbRecord;
}

export const AuthorizeOnuModal: React.FC<AuthorizeOnuModalProps> = ({
  onu,
  db,
  onClose,
  onConfirmAuthorize,
  onQuickAddZone,
  onQuickAddSector,
  onQuickAddSplitter,
}) => {
  const [selectedOltId, setSelectedOltId] = useState<number>(
    onu.olt_id || db.olts[0]?.id || 1
  );
  const [boardNum, setBoardNum] = useState<number>(onu.board || 3);
  const [portNum, setPortNum] = useState<number>(onu.port || 3);
  const [liveUsedIndices, setLiveUsedIndices] = useState<number[]>([]);
  const [liveExistingSnIndex, setLiveExistingSnIndex] = useState<number | null>(null);
  const [checkingPonLive, setCheckingPonLive] = useState<boolean>(false);
  const [manualOnuIndex, setManualOnuIndex] = useState<number | null>(null);

  const olt =
    db.olts.find((o) => o.id === selectedOltId) ||
    db.olts[0] || {
      id: selectedOltId,
      name: `OLT-${selectedOltId}`,
      firmware_version: 'V2.1.0' as const,
    };

  const ponPort =
    db.pon_ports.find(
      (p) =>
        p.olt_id === selectedOltId &&
        (p.slot || 3) === boardNum &&
        p.port_number === portNum
    ) ||
    db.pon_ports.find(
      (p) => p.olt_id === selectedOltId && p.port_number === portNum
    ) ||
    db.pon_ports[0];

  const maxCapacity = ponPort?.max_onu_capacity || 128;

  // Query live OLT PON port via Telnet to know every occupied ONU index on gpon-olt_1/board/port
  const checkLivePonPortIndices = async () => {
    setCheckingPonLive(true);
    try {
      const resp = await fetch(`/api/olts/${selectedOltId}/check-pon-indices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: boardNum,
          port: portNum,
          serialNumber: onu.serial_number,
        }),
      });
      const data = await resp.json();
      if (data && Array.isArray(data.usedIndices)) {
        setLiveUsedIndices(data.usedIndices);
        setLiveExistingSnIndex(
          typeof data.existingSnIndex === 'number' ? data.existingSnIndex : null
        );
      }
    } catch {
      // Fallback to local DB indices if offline
    } finally {
      setCheckingPonLive(false);
    }
  };

  useEffect(() => {
    setManualOnuIndex(null);
    void checkLivePonPortIndices();
  }, [selectedOltId, boardNum, portNum, onu.serial_number]);

  const combinedUsedIndices = useMemo(() => {
    const dbIndices = db.onus
      .filter(
        (item) =>
          item.is_authorized &&
          item.onu_index !== null &&
          item.serial_number.toUpperCase() !== onu.serial_number.toUpperCase() &&
          item.olt_id === selectedOltId &&
          item.board === boardNum &&
          item.port === portNum
      )
      .map((item) => item.onu_index as number);
    return Array.from(
      new Set(
        [...dbIndices, ...liveUsedIndices].filter(
          (idx) => idx !== liveExistingSnIndex
        )
      )
    ).sort((a, b) => a - b);
  }, [
    db.onus,
    liveUsedIndices,
    liveExistingSnIndex,
    onu.serial_number,
    selectedOltId,
    boardNum,
    portNum,
  ]);

  const autoAllocatedOnuIndex = useMemo(() => {
    if (liveExistingSnIndex !== null && liveExistingSnIndex > 0) {
      return liveExistingSnIndex;
    }
    return findNextAvailableOnuIndex(combinedUsedIndices, maxCapacity);
  }, [liveExistingSnIndex, combinedUsedIndices, maxCapacity]);

  const allocatedOnuIndex =
    manualOnuIndex !== null &&
    manualOnuIndex >= 1 &&
    manualOnuIndex <= maxCapacity &&
    !combinedUsedIndices.includes(manualOnuIndex)
      ? manualOnuIndex
      : autoAllocatedOnuIndex;

  const usedCount = Math.max(
    combinedUsedIndices.length,
    db.onus.filter(
      (item) =>
        item.is_authorized &&
        item.olt_id === selectedOltId &&
        item.board === boardNum &&
        item.port === portNum
    ).length
  );
  const freeCount = Math.max(0, maxCapacity - usedCount);
  const usagePct = Math.round((usedCount / maxCapacity) * 100);

  const [usePreset, setUsePreset] = useState<boolean>(false);
  const [presetName, setPresetName] = useState<string>('None');
  const [ponType, setPonType] = useState<'GPON' | 'EPON'>('GPON');
  const [gponChannel, setGponChannel] = useState<'GPON' | 'XG-PON' | 'XGS-PON'>('GPON');
  const [onuType, setOnuType] = useState<string>('ALL');
  const [useCustomProfile, setUseCustomProfile] = useState<boolean>(true);
  const [serviceProfile, setServiceProfile] = useState<string>('Default (ALL)');
  const [onuMode, setOnuMode] = useState<OnuModeOption>('Routing');
  const [vlanRecordId, setVlanRecordId] = useState<number>(
    db.vlans.find((v) => v.olt_id === selectedOltId && v.vlan_id === 101)?.id ||
      db.vlans.find((v) => v.vlan_id === 101)?.id ||
      db.vlans[0]?.id ||
      101
  );
  const [zoneId, setZoneId] = useState<number | 'NONE'>(
    onu.zone_id || db.zones[0]?.id || 'NONE'
  );
  const [sectorId, setSectorId] = useState<number | 'NONE'>(
    onu.sector_id || (db.sectors && db.sectors[0]?.id) || 'NONE'
  );
  const [odbId, setOdbId] = useState<number | 'NONE'>(onu.odb_id || 'NONE');
  const [odbPort, setOdbPort] = useState<number | 'NONE'>(onu.odb_port || 'NONE');

  // Inline Quick-Add states for Zone, Sector, and Splitter directly from Authorize ONU form
  const [quickAddMode, setQuickAddMode] = useState<
    'ZONE' | 'SECTOR' | 'SPLITTER' | null
  >(null);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneCode, setNewZoneCode] = useState('');
  const [newZoneCity, setNewZoneCity] = useState('');
  const [newSectorName, setNewSectorName] = useState('');
  const [newSectorCode, setNewSectorCode] = useState('');
  const [newSplitterName, setNewSplitterName] = useState('');
  const [newSplitterRatio, setNewSplitterRatio] = useState<
    '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64'
  >('1:8');
  const [newSplitterPole, setNewSplitterPole] = useState('TIANG-01');

  const sectorsList = db.sectors || [];

  // Filter Sectors & Splitters synced with selected Zone / Sector
  const availableSectors = useMemo(() => {
    if (zoneId === 'NONE') return sectorsList;
    const matched = sectorsList.filter(
      (s) => s.zone_id === zoneId || s.zone_id === null
    );
    return matched.length > 0 ? matched : sectorsList;
  }, [sectorsList, zoneId]);

  const availableSplitters = useMemo(() => {
    let list = db.odbs;
    if (zoneId !== 'NONE') {
      const byZone = list.filter((o) => o.zone_id === zoneId);
      if (byZone.length > 0) list = byZone;
    }
    if (sectorId !== 'NONE') {
      const bySector = list.filter(
        (o) => !o.sector_id || o.sector_id === sectorId
      );
      if (bySector.length > 0) list = bySector;
    }
    return list;
  }, [db.odbs, zoneId, sectorId]);

  const selectedSplitter = useMemo(
    () => (odbId === 'NONE' ? null : db.odbs.find((o) => o.id === odbId) || null),
    [db.odbs, odbId]
  );

  // Compute occupied ports on the selected Splitter so user never collides on ODP port
  const occupiedSplitterPorts = useMemo(() => {
    const map = new Map<number, string>();
    if (!selectedSplitter) return map;
    for (const item of db.onus) {
      if (
        item.is_authorized &&
        item.odb_id === selectedSplitter.id &&
        item.odb_port !== null &&
        item.id !== onu.id
      ) {
        map.set(
          item.odb_port,
          item.customer_name || item.serial_number
        );
      }
    }
    return map;
  }, [db.onus, selectedSplitter, onu.id]);

  // Auto-select first free port when a Splitter is selected
  useEffect(() => {
    if (!selectedSplitter) {
      setOdbPort('NONE');
      return;
    }
    const maxPorts = selectedSplitter.total_ports || 8;
    if (
      odbPort !== 'NONE' &&
      odbPort >= 1 &&
      odbPort <= maxPorts &&
      !occupiedSplitterPorts.has(odbPort)
    ) {
      return;
    }
    for (let p = 1; p <= maxPorts; p++) {
      if (!occupiedSplitterPorts.has(p)) {
        setOdbPort(p);
        return;
      }
    }
    setOdbPort(1);
  }, [selectedSplitter, occupiedSplitterPorts]);

  const [downSpeedId, setDownSpeedId] = useState<number>(db.speed_profiles[0]?.id || 1);
  const [upSpeedId, setUpSpeedId] = useState<number>(db.speed_profiles[0]?.id || 1);
  const [customerName, setCustomerName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [externalId, setExternalId] = useState<string>(onu.serial_number);
  const [useGps, setUseGps] = useState<boolean>(false);

  // Advanced WAN PPPoE, WAN Remote Access & TR069 options
  const [wanMode, setWanMode] = useState<WanModeOption>('PPPOE');
  const [configMethod, setConfigMethod] = useState<ConfigMethodOption>('OMCI');
  const [wanRemoteAccess, setWanRemoteAccess] = useState<WanRemoteAccessOption>(
    'Enabled from everywhere in the internet'
  );
  const [pppoeUsername, setPppoeUsername] = useState<string>('');
  const [pppoeUserEdited, setPppoeUserEdited] = useState<boolean>(false);
  const [pppoePassword, setPppoePassword] = useState<string>('jetcyber');
  const [showCliPreview, setShowCliPreview] = useState<boolean>(true);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);

  const selectedVlan =
    db.vlans.find((v) => v.id === vlanRecordId || v.vlan_id === vlanRecordId) ||
    db.vlans.find((v) => v.vlan_id === 101) ||
    db.vlans[0] || {
      id: 101,
      vlan_id: 101,
      name: 'PPPOE',
    };
  const selectedSpeed =
    db.speed_profiles.find((s) => s.id === downSpeedId) || db.speed_profiles[0];
  const selectedTcont = db.tcont_profiles[0];
  const selectedTr069 = db.tr069_profiles[0];

  const effectivePppoeUser =
    pppoeUsername.trim() ||
    customerName.trim().replace(/\s+/g, '-') ||
    onu.serial_number;

  const generatedCli = useMemo(() => {
    return generateAuthorizeCliScript({
      firmwareVersion: olt?.firmware_version || 'V2.1.0',
      ponInterface: `gpon-olt_1/${boardNum}/${portNum}`,
      onuIndex: allocatedOnuIndex,
      serialNumber: onu.serial_number,
      onuType: 'ALL',
      customerName: customerName.trim() || effectivePppoeUser || onu.serial_number,
      address: address.trim() || 'none',
      tcontProfile: selectedTcont?.profile_name || 'SMARTOLT-1G-UP',
      speedProfile: selectedSpeed?.profile_name || 'SMARTOLT-1G-DOWN',
      vlanId: selectedVlan?.vlan_id || 101,
      onuMode,
      wanMode: onuMode === 'Bridging' ? 'BRIDGE' : wanMode,
      configMethod,
      wanRemoteAccess,
      pppoeUsername: effectivePppoeUser,
      pppoePassword,
      tr069Enabled: configMethod === 'TR069',
      tr069AcsUrl: selectedTr069?.acs_url,
      tr069AcsUsername: selectedTr069?.acs_username,
      tr069AcsPassword: selectedTr069?.acs_password,
      tr069PeriodicInterval: selectedTr069?.periodic_inform_interval,
    });
  }, [
    olt?.firmware_version,
    boardNum,
    portNum,
    allocatedOnuIndex,
    onu.serial_number,
    customerName,
    address,
    selectedTcont,
    selectedSpeed,
    selectedVlan,
    onuMode,
    wanMode,
    configMethod,
    wanRemoteAccess,
    effectivePppoeUser,
    pppoePassword,
    selectedTr069,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName =
      customerName.trim().replace(/\s+/g, '-') ||
      effectivePppoeUser ||
      onu.serial_number;
    const nowTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
    onConfirmAuthorize(
      onu.id,
      {
        olt_id: selectedOltId,
        board: boardNum,
        port: portNum,
        onu_index: allocatedOnuIndex,
        onu_type: 'ALL',
        is_authorized: true,
        customer_name: finalName.toUpperCase(),
        address: address.trim() || 'none',
        external_id: externalId || onu.serial_number,
        zone_id: zoneId === 'NONE' ? null : zoneId,
        sector_id: sectorId === 'NONE' ? null : sectorId,
        odb_id: odbId === 'NONE' ? null : odbId,
        odb_port: odbPort === 'NONE' ? null : odbPort,
        vlan_id: selectedVlan?.id || vlanRecordId,
        speed_profile_id: downSpeedId,
        tcont_profile_id: selectedTcont?.id || 1,
        onu_mode: onuMode,
        wan_mode: onuMode === 'Bridging' ? 'BRIDGE' : wanMode,
        config_method: configMethod,
        wan_remote_access: wanRemoteAccess,
        wan_remote_allowed_subnet: '0.0.0.0/0',
        tr069_profile_id: 1,
        tr069_status: 'ACTIVE_INFORMING',
        tr069_last_inform: `Today ${nowTime}`,
        mgmt_ip: null,
        wifi_enabled: true,
        pppoe_username: onuMode === 'Routing' ? effectivePppoeUser : null,
        pppoe_password: onuMode === 'Routing' ? pppoePassword : null,
        phase_state: 'working',
        onu_rx_dbm: onu.onu_rx_dbm,
        olt_rx_dbm: onu.olt_rx_dbm,
        ip_address:
          onuMode === 'Routing'
            ? null
            : `Bridge-VLAN${selectedVlan?.vlan_id || 101}`,
        auth_date_label: `Today ${nowTime}`,
        last_online_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        last_offline_reason: 'None',
      },
      generatedCli,
      allocatedOnuIndex
    );
  };

  return (
    <div className="mx-auto max-w-5xl rounded-lg border border-[#1e3a5f] bg-[#0c1c30]/95 p-6 text-slate-100 shadow-2xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3a5f] pb-3">
        <div>
          <h2 className="text-base font-bold text-white">
            Authorize ONU — SN: <span className="font-mono text-sky-400">{onu.serial_number}</span>
          </h2>
          <p className="text-xs text-slate-400">
            Target Interface: <span className="font-mono text-emerald-400">gpon-onu_1/{boardNum}/{portNum}:{allocatedOnuIndex}</span> (Original catalog model: {onu.onu_type})
            {checkingPonLive ? (
              <span className="ml-2 text-amber-300">· Checking live OLT port indices...</span>
            ) : (
              <span className="ml-2 text-sky-300">
                · Free ONU Index #{allocatedOnuIndex} (Occupied on 1/{boardNum}/{portNum}:{' '}
                {combinedUsedIndices.length > 0
                  ? combinedUsedIndices.map((idx) => `#${idx}`).join(', ')
                  : 'None'}
                )
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCliPreview(!showCliPreview)}
          className="flex items-center gap-1.5 rounded bg-[#183456] px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-[#1f426d]"
        >
          <Terminal className="h-3.5 w-3.5" />
          {showCliPreview ? 'Hide Generated ZTE CLI Script' : 'Preview Generated ZTE CLI Script'}
        </button>
      </div>

      {showCliPreview && (
        <div className="mb-6 rounded-lg border border-slate-700 bg-slate-950 p-4">
          <div className="flex items-center justify-between pb-2">
            <span className="font-mono text-xs font-semibold text-emerald-400">
              ZTE C320/C300 Auto-Provisioning CLI Script (`gpon-onu_1/{boardNum}/{portNum}:{allocatedOnuIndex}`)
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(generatedCli);
                setCopiedCli(true);
                setTimeout(() => setCopiedCli(false), 1800);
              }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
            >
              {copiedCli ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCli ? 'Copied' : 'Copy CLI'}
            </button>
          </div>
          <pre className="max-h-60 overflow-x-auto overflow-y-auto font-mono text-[11px] leading-relaxed text-emerald-300">
            {generatedCli}
          </pre>
        </div>
      )}

      {/* Exact SmartOLT Form Layout matching Screenshot _1F161B1B */}
      <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
        {/* Use Preset */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="flex items-center justify-end gap-1.5 font-semibold text-slate-200 sm:col-span-3 sm:pr-4">
            <input
              type="checkbox"
              checked={usePreset}
              onChange={(e) => setUsePreset(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            Use Preset
          </label>
          <div className="flex items-center gap-2 sm:col-span-8">
            <select
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="flex-1 rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-hidden"
            >
              <option value="None">None</option>
              <option value="PPPoE-101">Preset: PPPoE VLAN 101 + Remote Access</option>
              <option value="TR069-Auto">Preset: TR-069 CWMP + VLAN 101</option>
            </select>
            <button
              type="button"
              onClick={() => setUsePreset(true)}
              className="rounded border border-slate-600 bg-slate-700 p-2 text-slate-200 hover:bg-slate-600"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* OLT */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            OLT
          </label>
          <div className="sm:col-span-8">
            <select
              value={selectedOltId}
              onChange={(e) => setSelectedOltId(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-hidden"
            >
              {db.olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id} - {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* PON type */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            PON type
          </label>
          <div className="flex items-center gap-5 sm:col-span-8">
            <label className="flex items-center gap-1.5 text-slate-300">
              <input
                type="radio"
                checked={ponType === 'GPON'}
                onChange={() => setPonType('GPON')}
                className="accent-sky-500"
              />
              GPON
            </label>
            <label className="flex items-center gap-1.5 text-slate-400">
              <input
                type="radio"
                checked={ponType === 'EPON'}
                onChange={() => setPonType('EPON')}
                className="accent-sky-500"
              />
              EPON
            </label>
          </div>
        </div>

        {/* GPON channel */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            GPON channel
          </label>
          <div className="flex items-center gap-5 sm:col-span-8">
            {(['GPON', 'XG-PON', 'XGS-PON'] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-1.5 text-slate-200">
                <input
                  type="radio"
                  checked={gponChannel === ch}
                  onChange={() => setGponChannel(ch)}
                  className="accent-sky-500"
                />
                {ch}
              </label>
            ))}
          </div>
        </div>

        {/* Board */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Board
          </label>
          <div className="sm:col-span-8">
            <input
              type="number"
              value={boardNum}
              onChange={(e) => setBoardNum(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 font-mono text-xs text-slate-300"
            />
          </div>
        </div>

        {/* Port + Usage Bar */}
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
          <label className="pt-2 font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Port
          </label>
          <div className="space-y-2 sm:col-span-8">
            <input
              type="number"
              value={portNum}
              onChange={(e) => setPortNum(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 font-mono text-xs text-slate-300"
            />
            <div className="flex items-center gap-3 text-[11px] text-slate-300">
              <span>Usage:</span>
              <div className="h-2 w-36 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${Math.max(5, usagePct)}%` }}
                />
              </div>
              <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {freeCount} free
              </span>
              <span className="font-mono font-bold text-white">
                {usedCount} / 128 ({usagePct}%)
              </span>
              <button
                type="button"
                onClick={() => void checkLivePonPortIndices()}
                className="flex items-center gap-1 rounded border border-sky-600/60 bg-sky-950/60 px-2 py-0.5 text-[10px] font-semibold text-sky-300 hover:bg-sky-900"
              >
                <RefreshCw className={`h-3 w-3 ${checkingPonLive ? 'animate-spin' : ''}`} />
                {checkingPonLive ? 'Checking OLT...' : 'Check Live PON Index'}
              </button>
              <Info className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
              <span>Allocated ONU Index on OLT:</span>
              <span className="rounded bg-emerald-950/90 border border-emerald-500/50 px-2 py-0.5 font-mono font-bold text-emerald-300">
                onu {allocatedOnuIndex} (gpon-onu_1/{boardNum}/{portNum}:{allocatedOnuIndex})
              </span>
              <input
                type="number"
                min={1}
                max={128}
                value={manualOnuIndex ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setManualOnuIndex(val);
                }}
                placeholder={`Auto: ${autoAllocatedOnuIndex}`}
                className="w-24 rounded border border-[#284870] bg-[#10233a] px-2 py-0.5 font-mono text-[11px] text-white"
              />
              {manualOnuIndex !== null && combinedUsedIndices.includes(manualOnuIndex) && (
                <span className="text-red-400 font-semibold">
                  ⚠ Index #{manualOnuIndex} sudah terpakai di OLT! Otomatis dialihkan ke #{autoAllocatedOnuIndex}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* SN */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            SN
          </label>
          <div className="sm:col-span-8">
            <input
              type="text"
              readOnly
              value={onu.serial_number}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 font-mono text-xs text-slate-300"
            />
          </div>
        </div>

        {/* ONU type + Use custom profile */}
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
          <label className="pt-2 font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            ONU type
          </label>
          <div className="space-y-2 sm:col-span-8">
            <select
              value={onuType}
              onChange={(e) => setOnuType(e.target.value)}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              <option value="ALL">ALL</option>
              <option value="F609V3.0">F609V3.0</option>
              <option value="SIGMA_F663NV3A">SIGMA_F663NV3A</option>
              <option value="ZTE-F670L">ZTE-F670L</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={useCustomProfile}
                onChange={(e) => setUseCustomProfile(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
              />
              Use custom profile (For better compatibility with generic ONUs)
            </label>
          </div>
        </div>

        {/* Service-profile */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Service-profile
          </label>
          <div className="sm:col-span-8">
            <select
              value={serviceProfile}
              onChange={(e) => setServiceProfile(e.target.value)}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              <option value="Default (ALL)">Default (ALL)</option>
              <option value="ZTE-OMCI-ROUTING">ZTE-OMCI-ROUTING</option>
              <option value="ZTE-TR069-CWMP">ZTE-TR069-CWMP</option>
            </select>
          </div>
        </div>

        {/* ONU mode */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            ONU mode
          </label>
          <div className="flex items-center gap-5 sm:col-span-8">
            <label className="flex cursor-pointer items-center gap-1.5 text-white">
              <input
                type="radio"
                checked={onuMode === 'Routing'}
                onChange={() => setOnuMode('Routing')}
                className="accent-sky-500"
              />
              Routing
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-white">
              <input
                type="radio"
                checked={onuMode === 'Bridging'}
                onChange={() => setOnuMode('Bridging')}
                className="accent-sky-500"
              />
              Bridging
            </label>
          </div>
        </div>

        {/* User VLAN-ID */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            User VLAN-ID
          </label>
          <div className="sm:col-span-8">
            <select
              value={vlanRecordId}
              onChange={(e) => setVlanRecordId(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              {db.vlans.length === 0 ? (
                <>
                  <option value={101}>101 - PPPOE (Default)</option>
                  <option value={100}>100 - TR069</option>
                </>
              ) : (
                db.vlans.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vlan_id} - {v.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Zone */}
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
          <label className="pt-2 font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Zone
          </label>
          <div className="space-y-2 sm:col-span-8">
            <div className="flex items-center gap-2">
              <select
                value={zoneId}
                onChange={(e) => {
                  const val =
                    e.target.value === 'NONE' ? 'NONE' : Number(e.target.value);
                  setZoneId(val);
                  if (val !== 'NONE') {
                    const matchingSector = sectorsList.find(
                      (s) => s.zone_id === val
                    );
                    if (matchingSector) setSectorId(matchingSector.id);
                    const matchingOdb = db.odbs.find((o) => o.zone_id === val);
                    if (matchingOdb) setOdbId(matchingOdb.id);
                  }
                }}
                className="flex-1 rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
              >
                <option value="NONE">
                  {db.zones.length === 0
                    ? 'None (Klik + untuk tambah Zone baru)'
                    : 'None'}
                </option>
                {db.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} {z.code ? `(${z.code})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setQuickAddMode(quickAddMode === 'ZONE' ? null : 'ZONE')
                }
                title="Tambah Zone baru (langsung sinkron ke Settings -> Zones)"
                className="flex items-center gap-1 rounded border border-emerald-600/60 bg-emerald-950/70 px-2.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-900"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Zone
              </button>
            </div>

            {quickAddMode === 'ZONE' && (
              <div className="rounded border border-emerald-600/50 bg-[#0a1829] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-300">
                    + Quick Add Zone (Sinkron ke Settings → Zones)
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuickAddMode(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={newZoneName}
                    onChange={(e) => setNewZoneName(e.target.value)}
                    placeholder="Zone Name (e.g. MUARA LEBAK - RK 01)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={newZoneCode}
                    onChange={(e) => setNewZoneCode(e.target.value)}
                    placeholder="Code (e.g. ZN-ML01)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                  <input
                    type="text"
                    value={newZoneCity}
                    onChange={(e) => setNewZoneCity(e.target.value)}
                    placeholder="City / District (e.g. Lebak)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!newZoneName.trim() || !onQuickAddZone) return;
                      const created = onQuickAddZone({
                        name: newZoneName.trim().toUpperCase(),
                        code:
                          newZoneCode.trim().toUpperCase() ||
                          `ZN-${db.zones.length + 1}`,
                        city_district: newZoneCity.trim() || 'Lebak',
                        description: `Zone ${newZoneName.trim().toUpperCase()}`,
                      });
                      setZoneId(created.id);
                      setNewZoneName('');
                      setNewZoneCode('');
                      setNewZoneCity('');
                      setQuickAddMode(null);
                    }}
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    Save Zone
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sector */}
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
          <label className="pt-2 font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Sector
          </label>
          <div className="space-y-2 sm:col-span-8">
            <div className="flex items-center gap-2">
              <select
                value={sectorId}
                onChange={(e) =>
                  setSectorId(
                    e.target.value === 'NONE' ? 'NONE' : Number(e.target.value)
                  )
                }
                className="flex-1 rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
              >
                <option value="NONE">
                  {availableSectors.length === 0
                    ? 'None (Klik + untuk tambah Sector baru)'
                    : 'None'}
                </option>
                {availableSectors.map((sec) => {
                  const secZone = db.zones.find((z) => z.id === sec.zone_id);
                  return (
                    <option key={sec.id} value={sec.id}>
                      {sec.name} {sec.code ? `(${sec.code})` : ''}{' '}
                      {secZone ? `— Zone: ${secZone.name}` : ''}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() =>
                  setQuickAddMode(quickAddMode === 'SECTOR' ? null : 'SECTOR')
                }
                title="Tambah Sector baru (langsung sinkron ke Settings -> Sectors)"
                className="flex items-center gap-1 rounded border border-sky-600/60 bg-sky-950/70 px-2.5 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-900"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Sector
              </button>
            </div>

            {quickAddMode === 'SECTOR' && (
              <div className="rounded border border-sky-600/50 bg-[#0a1829] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sky-300">
                    + Quick Add Sector (Sinkron ke Settings → Sectors)
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuickAddMode(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={newSectorName}
                    onChange={(e) => setNewSectorName(e.target.value)}
                    placeholder="Sector Name (e.g. SECTOR UTARA - PON 3)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={newSectorCode}
                    onChange={(e) => setNewSectorCode(e.target.value)}
                    placeholder="Sector Code (e.g. SEC-01)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!newSectorName.trim() || !onQuickAddSector) return;
                      const created = onQuickAddSector({
                        name: newSectorName.trim().toUpperCase(),
                        code:
                          newSectorCode.trim().toUpperCase() ||
                          `SEC-${sectorsList.length + 1}`,
                        zone_id: zoneId === 'NONE' ? (db.zones[0]?.id ?? null) : zoneId,
                        olt_id: selectedOltId,
                        pon_port_id: ponPort?.id || portNum,
                        description: `PON 1/${boardNum}/${portNum}`,
                      });
                      setSectorId(created.id);
                      setNewSectorName('');
                      setNewSectorCode('');
                      setQuickAddMode(null);
                    }}
                    className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-500"
                  >
                    Save Sector
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Splitter */}
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
          <label className="pt-2 font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Splitter
          </label>
          <div className="space-y-2 sm:col-span-8">
            <div className="flex items-center gap-2">
              <select
                value={odbId}
                onChange={(e) => {
                  const val =
                    e.target.value === 'NONE' ? 'NONE' : Number(e.target.value);
                  setOdbId(val);
                  if (val !== 'NONE') {
                    const chosen = db.odbs.find((o) => o.id === val);
                    if (chosen) {
                      if (chosen.zone_id) setZoneId(chosen.zone_id);
                      if (chosen.sector_id) setSectorId(chosen.sector_id);
                    }
                  }
                }}
                className="flex-1 rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
              >
                <option value="NONE">
                  {availableSplitters.length === 0
                    ? 'None (Klik + untuk tambah Splitter / ODP baru)'
                    : 'None'}
                </option>
                {availableSplitters.map((o) => {
                  const usedOnSplitter = db.onus.filter(
                    (u) => u.is_authorized && u.odb_id === o.id
                  ).length;
                  const zObj = db.zones.find((z) => z.id === o.zone_id);
                  return (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.splitter_ratio} · {usedOnSplitter}/
                      {o.total_ports} ports used
                      {zObj ? ` · ${zObj.name}` : ''})
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() =>
                  setQuickAddMode(
                    quickAddMode === 'SPLITTER' ? null : 'SPLITTER'
                  )
                }
                title="Tambah Splitter / ODP baru (langsung sinkron ke Settings -> Splitters)"
                className="flex items-center gap-1 rounded border border-amber-600/60 bg-amber-950/70 px-2.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-900"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Splitter
              </button>
            </div>

            {quickAddMode === 'SPLITTER' && (
              <div className="rounded border border-amber-600/50 bg-[#0a1829] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-300">
                    + Quick Add Splitter / ODP (Sinkron ke Settings → Splitters)
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuickAddMode(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={newSplitterName}
                    onChange={(e) => setNewSplitterName(e.target.value)}
                    placeholder="Splitter/ODP Name (e.g. ODP-ML-01)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 text-xs text-white"
                  />
                  <select
                    value={newSplitterRatio}
                    onChange={(e) =>
                      setNewSplitterRatio(
                        e.target.value as
                          | '1:2'
                          | '1:4'
                          | '1:8'
                          | '1:16'
                          | '1:32'
                          | '1:64'
                      )
                    }
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 font-mono text-xs text-white"
                  >
                    <option value="1:2">Ratio 1:2 (2 Ports)</option>
                    <option value="1:4">Ratio 1:4 (4 Ports)</option>
                    <option value="1:8">Ratio 1:8 (8 Ports)</option>
                    <option value="1:16">Ratio 1:16 (16 Ports)</option>
                    <option value="1:32">Ratio 1:32 (32 Ports)</option>
                    <option value="1:64">Ratio 1:64 (64 Ports)</option>
                  </select>
                  <input
                    type="text"
                    value={newSplitterPole}
                    onChange={(e) => setNewSplitterPole(e.target.value)}
                    placeholder="Pole / Tiang (e.g. TIANG-01)"
                    className="rounded border border-[#284870] bg-[#10233a] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!newSplitterName.trim() || !onQuickAddSplitter) return;
                      const totalPorts =
                        Number(newSplitterRatio.split(':')[1]) || 8;
                      const targetZoneId =
                        zoneId === 'NONE' ? db.zones[0]?.id || 1 : zoneId;
                      const created = onQuickAddSplitter({
                        name: newSplitterName.trim().toUpperCase(),
                        zone_id: targetZoneId,
                        sector_id: sectorId === 'NONE' ? null : sectorId,
                        olt_id: selectedOltId,
                        pon_port_id: ponPort?.id || portNum,
                        splitter_ratio: newSplitterRatio,
                        total_ports: totalPorts,
                        pole_number: newSplitterPole.trim() || 'TIANG-01',
                        latitude: -6.355,
                        longitude: 106.251,
                        description: `PON 1/${boardNum}/${portNum}`,
                      });
                      setOdbId(created.id);
                      setNewSplitterName('');
                      setQuickAddMode(null);
                    }}
                    className="rounded bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-500"
                  >
                    Save Splitter (ODP)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Splitter port */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Splitter port
          </label>
          <div className="sm:col-span-8">
            <select
              value={odbPort}
              onChange={(e) =>
                setOdbPort(e.target.value === 'NONE' ? 'NONE' : Number(e.target.value))
              }
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              <option value="NONE">None</option>
              {Array.from(
                { length: selectedSplitter?.total_ports || 16 },
                (_, i) => i + 1
              ).map((p) => {
                const occupiedBy = occupiedSplitterPorts.get(p);
                return (
                  <option key={p} value={p}>
                    Port {p}{' '}
                    {occupiedBy ? `(Terpakai — ${occupiedBy})` : '(Free)'}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Download speed */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Download speed
          </label>
          <div className="sm:col-span-8">
            <select
              value={downSpeedId}
              onChange={(e) => setDownSpeedId(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              {db.speed_profiles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.profile_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Upload speed */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Upload speed
          </label>
          <div className="sm:col-span-8">
            <select
              value={upSpeedId}
              onChange={(e) => setUpSpeedId(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              {db.speed_profiles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.profile_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Name */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Name
          </label>
          <div className="sm:col-span-8">
            <input
              type="text"
              value={customerName}
              onChange={(e) => {
                const nextVal = e.target.value;
                setCustomerName(nextVal);
                if (!pppoeUserEdited) {
                  setPppoeUsername(nextVal.trim().replace(/\s+/g, '-'));
                }
              }}
              placeholder="Customer Name (e.g. SAIPUL-RIFAI)"
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            />
          </div>
        </div>

        {/* Address or comment */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Address or comment
          </label>
          <div className="sm:col-span-8">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address or comment (optional, defaults to none)"
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            />
          </div>
        </div>

        {/* ONU external ID */}
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
          <label className="pt-2 font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            ONU external ID
          </label>
          <div className="space-y-2.5 sm:col-span-8">
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 font-mono text-xs text-white"
            />

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <input
                type="checkbox"
                checked={useGps}
                onChange={(e) => setUseGps(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
              />
              Use GPS
            </label>
          </div>
        </div>

        {/* WAN PPPoE + WAN Remote Access + TR069 Inline Quick Config */}
        {onuMode === 'Routing' && (
          <div className="grid grid-cols-1 items-start gap-2 border-t border-[#1e3a5f] pt-3 sm:grid-cols-12">
            <label className="pt-2 font-semibold text-emerald-400 sm:col-span-3 sm:text-right sm:pr-4">
              WAN PPPoE & TR-069
            </label>
            <div className="grid grid-cols-1 gap-3 rounded border border-[#284870] bg-[#10233a]/80 p-3 sm:col-span-8 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] text-slate-400">
                  PPPoE Username
                </label>
                <input
                  type="text"
                  value={pppoeUsername}
                  onChange={(e) => {
                    setPppoeUserEdited(true);
                    setPppoeUsername(e.target.value);
                  }}
                  placeholder={effectivePppoeUser}
                  className="mt-1 w-full rounded border border-[#284870] bg-[#0c1c30] px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">
                  PPPoE Password
                </label>
                <input
                  type="text"
                  value={pppoePassword}
                  onChange={(e) => setPppoePassword(e.target.value)}
                  className="mt-1 w-full rounded border border-[#284870] bg-[#0c1c30] px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">
                  Config method
                </label>
                <select
                  value={configMethod}
                  onChange={(e) => setConfigMethod(e.target.value as ConfigMethodOption)}
                  className="mt-1 w-full rounded border border-[#284870] bg-[#0c1c30] px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="OMCI">OMCI</option>
                  <option value="TR069">TR069 - Active (JETCYBER ACS)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">
                  WAN remote access
                </label>
                <select
                  value={wanRemoteAccess}
                  onChange={(e) =>
                    setWanRemoteAccess(e.target.value as WanRemoteAccessOption)
                  }
                  className="mt-1 w-full rounded border border-[#284870] bg-[#0c1c30] px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="Enabled from everywhere in the internet">
                    Enabled from everywhere in the internet
                  </option>
                  <option value="Enabled only from NOC subnet">
                    Enabled only from NOC subnet
                  </option>
                  <option value="Disabled">Disabled</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Save & Cancel Buttons */}
        <div className="grid grid-cols-1 items-center gap-2 pt-3 sm:grid-cols-12">
          <div className="sm:col-span-3" />
          <div className="flex items-center gap-4 sm:col-span-8">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded bg-[#4caf50] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#43a047]"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-sky-400 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
