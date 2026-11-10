import React, { useState, useMemo } from 'react';
import {
  SmartOltDatabaseState,
  OnuRecord,
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
}

export const AuthorizeOnuModal: React.FC<AuthorizeOnuModalProps> = ({
  onu,
  db,
  onClose,
  onConfirmAuthorize,
}) => {
  const [selectedOltId, setSelectedOltId] = useState<number>(
    onu.olt_id || db.olts[0]?.id || 1
  );
  const [boardNum, setBoardNum] = useState<number>(onu.board || 3);
  const [portNum, setPortNum] = useState<number>(onu.port || 3);

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
        p.id === onu.pon_port_id ||
        (p.olt_id === selectedOltId && p.port_number === portNum)
    ) || db.pon_ports[0];

  const maxCapacity = ponPort?.max_onu_capacity || 128;

  const allocatedOnuIndex = useMemo(() => {
    const usedIndices = db.onus
      .filter(
        (item) =>
          item.is_authorized &&
          item.onu_index !== null &&
          ((ponPort && item.pon_port_id === ponPort.id) ||
            (item.olt_id === selectedOltId &&
              item.board === boardNum &&
              item.port === portNum))
      )
      .map((item) => item.onu_index as number);
    return findNextAvailableOnuIndex(usedIndices, maxCapacity);
  }, [db.onus, ponPort, selectedOltId, boardNum, portNum, maxCapacity]);

  const usedCount =
    ponPort?.total_onus ??
    db.onus.filter(
      (item) =>
        item.is_authorized &&
        item.olt_id === selectedOltId &&
        item.board === boardNum &&
        item.port === portNum
    ).length;
  const freeCount = Math.max(0, maxCapacity - usedCount);
  const usagePct = Math.round((usedCount / maxCapacity) * 100);

  const [usePreset, setUsePreset] = useState<boolean>(false);
  const [presetName, setPresetName] = useState<string>('None');
  const [ponType, setPonType] = useState<'GPON' | 'EPON'>('GPON');
  const [gponChannel, setGponChannel] = useState<'GPON' | 'XG-PON' | 'XGS-PON'>('GPON');
  const [onuType, setOnuType] = useState<string>(onu.onu_type || 'ALL');
  const [useCustomProfile, setUseCustomProfile] = useState<boolean>(false);
  const [serviceProfile, setServiceProfile] = useState<string>('Default (ALL)');
  const [onuMode, setOnuMode] = useState<OnuModeOption>('Routing');
  const [vlanRecordId, setVlanRecordId] = useState<number>(
    db.vlans.find((v) => v.olt_id === selectedOltId && v.vlan_id === 101)?.id ||
      db.vlans.find((v) => v.vlan_id === 101)?.id ||
      db.vlans[0]?.id ||
      101
  );
  const [zoneId, setZoneId] = useState<number>(
    db.zones.find((z) => z.name.includes('DONGKAL'))?.id || db.zones[0]?.id || 1
  );
  const [odbId, setOdbId] = useState<number | 'NONE'>('NONE');
  const [odbPort, setOdbPort] = useState<number | 'NONE'>('NONE');
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
  const [pppoeUsername, setPppoeUsername] = useState<string>(
    `USER-${onu.serial_number.slice(-4)}-${String(allocatedOnuIndex).padStart(2, '0')}`
  );
  const [pppoePassword, setPppoePassword] = useState<string>('jetcyber');
  const [showCliPreview, setShowCliPreview] = useState<boolean>(false);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);

  const selectedVlan =
    db.vlans.find((v) => v.id === vlanRecordId) ||
    db.vlans[0] || {
      id: 101,
      vlan_id: 101,
      name: 'PPPOE',
    };
  const selectedSpeed =
    db.speed_profiles.find((s) => s.id === downSpeedId) || db.speed_profiles[0];
  const selectedTcont = db.tcont_profiles[0];
  const selectedTr069 = db.tr069_profiles[0];

  const generatedCli = useMemo(() => {
    return generateAuthorizeCliScript({
      firmwareVersion: olt?.firmware_version || 'V2.1.0',
      ponInterface: `gpon-olt_1/${boardNum}/${portNum}`,
      onuIndex: allocatedOnuIndex,
      serialNumber: onu.serial_number,
      onuType,
      customerName: customerName || onu.serial_number,
      address: address || 'None',
      tcontProfile: selectedTcont?.profile_name || 'TCONT-1G',
      speedProfile: selectedSpeed?.profile_name || '1G',
      vlanId: selectedVlan?.vlan_id || 101,
      onuMode,
      wanMode: onuMode === 'Bridging' ? 'BRIDGE' : wanMode,
      configMethod,
      wanRemoteAccess,
      pppoeUsername,
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
    onuType,
    customerName,
    address,
    selectedTcont,
    selectedSpeed,
    selectedVlan,
    onuMode,
    wanMode,
    configMethod,
    wanRemoteAccess,
    pppoeUsername,
    pppoePassword,
    selectedTr069,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = customerName.trim() || `SUBSCRIBER-${onu.serial_number.slice(-4)}`;
    onConfirmAuthorize(
      onu.id,
      {
        olt_id: selectedOltId,
        board: boardNum,
        port: portNum,
        onu_index: allocatedOnuIndex,
        onu_type: onuType,
        is_authorized: true,
        customer_name: finalName.toUpperCase(),
        address: address || 'None',
        external_id: externalId || onu.serial_number,
        zone_id: zoneId,
        odb_id: odbId === 'NONE' ? null : odbId,
        odb_port: odbPort === 'NONE' ? null : odbPort,
        vlan_id: vlanRecordId,
        speed_profile_id: downSpeedId,
        tcont_profile_id: selectedTcont?.id || 1,
        onu_mode: onuMode,
        wan_mode: onuMode === 'Bridging' ? 'BRIDGE' : wanMode,
        config_method: configMethod,
        wan_remote_access: wanRemoteAccess,
        wan_remote_allowed_subnet: '0.0.0.0/0',
        tr069_profile_id: 1,
        tr069_status: 'ACTIVE_INFORMING',
        tr069_last_inform: 'Today 16:40:00',
        mgmt_ip: `10.100.${portNum}.${allocatedOnuIndex}`,
        wifi_enabled: true,
        pppoe_username: onuMode === 'Routing' ? pppoeUsername : null,
        pppoe_password: onuMode === 'Routing' ? pppoePassword : null,
        phase_state: 'working',
        onu_rx_dbm: onu.onu_rx_dbm || -22.45,
        olt_rx_dbm: onu.olt_rx_dbm || -26.1,
        ip_address:
          onuMode === 'Routing'
            ? `10.0.183.${allocatedOnuIndex + 100}`
            : `Bridge-VLAN${selectedVlan?.vlan_id || 101}`,
        auth_date_label: 'Today 16:40:12',
        last_online_at: '10-Nov-2026 16:40:12',
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
              <Info className="h-3.5 w-3.5 text-slate-400" />
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
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Zone
          </label>
          <div className="sm:col-span-8">
            <select
              value={zoneId}
              onChange={(e) => setZoneId(Number(e.target.value))}
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              {db.zones.length === 0 ? (
                <option value={1}>Default Zone</option>
              ) : (
                db.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Splitter */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
          <label className="font-semibold text-slate-200 sm:col-span-3 sm:text-right sm:pr-4">
            Splitter
          </label>
          <div className="sm:col-span-8">
            <select
              value={odbId}
              onChange={(e) =>
                setOdbId(e.target.value === 'NONE' ? 'NONE' : Number(e.target.value))
              }
              className="w-full rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs text-white"
            >
              <option value="NONE">None</option>
              {db.odbs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.splitter_ratio})
                </option>
              ))}
            </select>
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
              {Array.from({ length: 16 }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>
                  Port {p}
                </option>
              ))}
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
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer Name (e.g. RATMI)"
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
              placeholder="Address or comment (optional)"
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
                  onChange={(e) => setPppoeUsername(e.target.value)}
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
