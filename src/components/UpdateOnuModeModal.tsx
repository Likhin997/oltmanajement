import React, { useState, useMemo } from 'react';
import { OnuRecord, SmartOltDatabaseState } from '../services/mockDatabase';
import {
  OnuModeOption,
  WanModeOption,
  ConfigMethodOption,
  WanRemoteAccessOption,
  generateUpdateOnuModeCliScript,
} from '../services/oltEngine';
import { X, Terminal, Copy, Check, Radio } from 'lucide-react';

interface UpdateOnuModeModalProps {
  onu: OnuRecord;
  db: SmartOltDatabaseState;
  onClose: () => void;
  onConfirmUpdate: (
    onuId: number,
    updatedFields: Partial<OnuRecord>,
    generatedCli: string
  ) => void;
}

export const UpdateOnuModeModal: React.FC<UpdateOnuModeModalProps> = ({
  onu,
  db,
  onClose,
  onConfirmUpdate,
}) => {
  const olt =
    db.olts.find((o) => o.id === onu.olt_id) ||
    db.olts[0] || {
      id: onu.olt_id || 1,
      name: 'OLT-1',
      firmware_version: 'V2.1.0' as const,
    };
  const ponPort =
    db.pon_ports.find(
      (p) =>
        p.id === onu.pon_port_id ||
        (p.olt_id === onu.olt_id && p.port_number === onu.port)
    ) || db.pon_ports[0];
  const ponInterfaceName =
    ponPort?.interface_name || `gpon-olt_1/${onu.board || 3}/${onu.port || 1}`;

  const [vlanRecordId, setVlanRecordId] = useState<number>(
    onu.vlan_id ||
      db.vlans.find((v) => v.vlan_id === 101)?.id ||
      db.vlans[0]?.id ||
      101
  );
  const [customerName, setCustomerName] = useState<string>(
    onu.customer_name || onu.pppoe_username || onu.serial_number
  );
  const [rebindTypeAll, setRebindTypeAll] = useState<boolean>(
    Boolean(onu.onu_type && onu.onu_type !== 'ALL')
  );
  const [onuMode, setOnuMode] = useState<OnuModeOption>(onu.onu_mode || 'Routing');
  const [wanMode, setWanMode] = useState<WanModeOption>(
    onu.wan_mode === 'BRIDGE' ? 'PPPOE' : onu.wan_mode || 'PPPOE'
  );
  const [configMethod, setConfigMethod] = useState<ConfigMethodOption>(
    onu.config_method || 'OMCI'
  );
  const safeInitialUser =
    onu.pppoe_username &&
    onu.pppoe_username.trim().toLowerCase() !== 'zte' &&
    !onu.pppoe_username.includes('%')
      ? onu.pppoe_username.trim()
      : (onu.customer_name || onu.serial_number).toLowerCase();
  const safeInitialPass =
    onu.pppoe_password &&
    !onu.pppoe_password.includes('%') &&
    !onu.pppoe_password.toLowerCase().includes('not strong')
      ? onu.pppoe_password.trim()
      : 'jetcyber';

  const [username, setUsername] = useState<string>(safeInitialUser);
  const [password, setPassword] = useState<string>(safeInitialPass);
  const [wanRemoteAccess, setWanRemoteAccess] = useState<WanRemoteAccessOption>(
    onu.wan_remote_access || 'Enabled from everywhere in the internet'
  );
  const [allowedSubnet, setAllowedSubnet] = useState<string>(
    onu.wan_remote_allowed_subnet || '103.144.22.0/24'
  );

  // Static IP fields
  const [staticIp, setStaticIp] = useState<string>(
    onu.static_ip_address || '103.144.22.50'
  );
  const [staticMask, setStaticMask] = useState<string>(
    onu.static_subnet_mask || '255.255.255.0'
  );
  const [staticGw, setStaticGw] = useState<string>(
    onu.static_gateway || '103.144.22.1'
  );
  const [staticDns, setStaticDns] = useState<string>(
    onu.static_dns1 || '8.8.8.8'
  );

  // TR-069 specific fields
  const [tr069ProfileId, setTr069ProfileId] = useState<number>(
    onu.tr069_profile_id || db.tr069_profiles[0]?.id || 1
  );
  const [wifiSsid, setWifiSsid] = useState<string>(
    onu.wifi_ssid || `${(onu.customer_name || 'SmartOLT').split(' ')[0]}_5G`
  );
  const [wifiPassword, setWifiPassword] = useState<string>(
    onu.wifi_password || 'jetcyber123'
  );
  const [showCliPreview, setShowCliPreview] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const selectedVlan =
    db.vlans.find((v) => v.id === vlanRecordId || v.vlan_id === vlanRecordId) ||
    db.vlans.find((v) => v.vlan_id === 101) ||
    db.vlans[0] || {
      id: 101,
      vlan_id: 101,
      name: 'PPPOE',
    };
  const selectedTr069Profile =
    db.tr069_profiles.find((p) => p.id === tr069ProfileId) ||
    db.tr069_profiles[0];

  const generatedCli = useMemo(() => {
    return generateUpdateOnuModeCliScript({
      firmwareVersion: olt?.firmware_version || 'V2.1.0',
      ponInterface: ponInterfaceName,
      onuIndex: onu.onu_index || 1,
      serialNumber: onu.serial_number,
      customerName: customerName.trim() || username.trim() || onu.serial_number,
      address: onu.address || 'none',
      rebindTypeAll,
      vlanId: selectedVlan?.vlan_id || 101,
      onuMode,
      wanMode: onuMode === 'Bridging' ? 'BRIDGE' : wanMode,
      configMethod,
      wanRemoteAccess,
      wanRemoteAllowedSubnet: allowedSubnet,
      pppoeUsername: username,
      pppoePassword: password,
      staticIpAddress: staticIp,
      staticSubnetMask: staticMask,
      staticGateway: staticGw,
      staticDns1: staticDns,
      tr069AcsUrl: selectedTr069Profile?.acs_url,
      tr069AcsUsername: selectedTr069Profile?.acs_username,
      tr069AcsPassword: selectedTr069Profile?.acs_password,
      tr069PeriodicInterval: selectedTr069Profile?.periodic_inform_interval,
      wifiSsid,
      wifiPassword,
    });
  }, [
    olt?.firmware_version,
    ponInterfaceName,
    onu.onu_index,
    onu.serial_number,
    onu.address,
    customerName,
    rebindTypeAll,
    selectedVlan,
    onuMode,
    wanMode,
    configMethod,
    wanRemoteAccess,
    allowedSubnet,
    username,
    password,
    staticIp,
    staticMask,
    staticGw,
    staticDns,
    selectedTr069Profile,
    wifiSsid,
    wifiPassword,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirmUpdate(
      onu.id,
      {
        customer_name: (customerName.trim() || username.trim() || onu.serial_number)
          .replace(/\s+/g, '-')
          .toUpperCase(),
        onu_type: rebindTypeAll ? 'ALL' : onu.onu_type,
        vlan_id: selectedVlan?.id || vlanRecordId,
        onu_mode: onuMode,
        wan_mode: onuMode === 'Bridging' ? 'BRIDGE' : wanMode,
        config_method: configMethod,
        wan_remote_access: wanRemoteAccess,
        wan_remote_allowed_subnet: allowedSubnet,
        pppoe_username:
          onuMode === 'Routing' && wanMode === 'PPPOE'
            ? username.trim().replace(/\s+/g, '-')
            : onu.pppoe_username,
        pppoe_password:
          onuMode === 'Routing' && wanMode === 'PPPOE'
            ? password.trim()
            : onu.pppoe_password,
        static_ip_address: wanMode === 'STATIC_IP' ? staticIp : null,
        static_subnet_mask: wanMode === 'STATIC_IP' ? staticMask : null,
        static_gateway: wanMode === 'STATIC_IP' ? staticGw : null,
        static_dns1: wanMode === 'STATIC_IP' ? staticDns : null,
        tr069_profile_id: tr069ProfileId,
        tr069_status: 'ACTIVE_INFORMING',
        tr069_last_inform: new Date().toISOString().slice(0, 19).replace('T', ' '),
        wifi_ssid: wifiSsid,
        wifi_password: wifiPassword,
      },
      generatedCli
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#151c28] text-slate-100 shadow-2xl">
        {/* Modal Header (Identik SmartOLT Dark Dialog) */}
        <div className="flex items-center justify-between border-b border-slate-700/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold tracking-tight text-white">
              Update ONU mode
            </h2>
            <span className="font-mono text-xs text-slate-400">
              ({ponInterfaceName.replace('olt', 'onu')}:{onu.onu_index || 1} · SN: {onu.serial_number})
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCliPreview(!showCliPreview)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-slate-700"
            >
              <Terminal className="h-3.5 w-3.5" />
              {showCliPreview ? 'Hide CLI / TR069 Script' : 'Show CLI / TR069 Script'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <form
          onSubmit={handleSubmit}
          className="grid flex-1 grid-cols-1 divide-y divide-slate-700/80 overflow-y-auto lg:grid-cols-12 lg:divide-x lg:divide-y-0"
        >
          {/* Left Column: Identical SmartOLT "Update ONU mode" Form */}
          <div className={`space-y-5 p-6 ${showCliPreview ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
            {/* Row 0: Name & Hardware Type Rebind */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
              <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                ONU Name
              </label>
              <div className="space-y-2 sm:col-span-8">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full rounded-md border border-slate-600 bg-[#1c2536] px-3.5 py-2 font-mono text-sm text-white focus:border-blue-500 focus:outline-hidden"
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-amber-300">
                  <input
                    type="checkbox"
                    checked={rebindTypeAll}
                    onChange={(e) => setRebindTypeAll(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-amber-500"
                  />
                  Re-register ONU as `type ALL` (Gunakan jika PPPoE belum masuk / hanya 4 port eth)
                </label>
              </div>
            </div>

            {/* Row 1: WAN VLAN-ID */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
              <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                WAN VLAN-ID
              </label>
              <div className="sm:col-span-8">
                <select
                  value={selectedVlan?.id || vlanRecordId}
                  onChange={(e) => setVlanRecordId(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-600 bg-[#1c2536] px-3.5 py-2.5 text-sm font-medium text-white focus:border-blue-500 focus:outline-hidden"
                >
                  {db.vlans.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vlan_id} - {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Helper Notice from Screenshot */}
            <p className="text-sm leading-relaxed text-slate-400">
              After changing the WAN VLAN-ID, please check the Ethernet ports settings and update VLANs as desired.
            </p>

            {/* Row 2: ONU mode (Routing / Bridging) */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
              <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                ONU mode
              </label>
              <div className="flex items-center gap-6 sm:col-span-8">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                  <input
                    type="radio"
                    name="onuMode"
                    checked={onuMode === 'Routing'}
                    onChange={() => setOnuMode('Routing')}
                    className="h-4 w-4 accent-blue-500"
                  />
                  Routing
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                  <input
                    type="radio"
                    name="onuMode"
                    checked={onuMode === 'Bridging'}
                    onChange={() => setOnuMode('Bridging')}
                    className="h-4 w-4 accent-blue-500"
                  />
                  Bridging
                </label>
              </div>
            </div>

            {/* Row 3: WAN mode */}
            {onuMode === 'Routing' && (
              <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12">
                <label className="pt-0.5 text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                  WAN mode
                </label>
                <div className="space-y-2.5 sm:col-span-8">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                    <input
                      type="radio"
                      name="wanMode"
                      checked={wanMode === 'ONU_WEBPAGE'}
                      onChange={() => setWanMode('ONU_WEBPAGE')}
                      className="h-4 w-4 accent-blue-500"
                    />
                    Setup via ONU webpage
                  </label>

                  <div className="text-sm text-slate-400">
                    Settings for compatible ONUs:
                  </div>

                  <div className="flex flex-wrap items-center gap-6">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                      <input
                        type="radio"
                        name="wanMode"
                        checked={wanMode === 'DHCP'}
                        onChange={() => setWanMode('DHCP')}
                        className="h-4 w-4 accent-blue-500"
                      />
                      DHCP
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                      <input
                        type="radio"
                        name="wanMode"
                        checked={wanMode === 'STATIC_IP'}
                        onChange={() => setWanMode('STATIC_IP')}
                        className="h-4 w-4 accent-blue-500"
                      />
                      Static IP
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                      <input
                        type="radio"
                        name="wanMode"
                        checked={wanMode === 'PPPOE'}
                        onChange={() => setWanMode('PPPOE')}
                        className="h-4 w-4 accent-blue-500"
                      />
                      PPPoE
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Row 4: Config method (OMCI / TR069 Active) */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
              <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                Config method
              </label>
              <div className="flex flex-wrap items-center gap-6 sm:col-span-8">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                  <input
                    type="radio"
                    name="configMethod"
                    checked={configMethod === 'OMCI'}
                    onChange={() => setConfigMethod('OMCI')}
                    className="h-4 w-4 accent-blue-500"
                  />
                  OMCI
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-emerald-400 font-semibold">
                  <input
                    type="radio"
                    name="configMethod"
                    checked={configMethod === 'TR069'}
                    onChange={() => setConfigMethod('TR069')}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  <Radio className="h-3.5 w-3.5" />
                  TR069 - Active (CWMP ACS)
                </label>
              </div>
            </div>

            {/* Conditional PPPoE Username & Password (Identical to Screenshot) */}
            {onuMode === 'Routing' && wanMode === 'PPPOE' && (
              <>
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
                  <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                    Username
                  </label>
                  <div className="sm:col-span-8">
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-md border border-slate-600 bg-[#1c2536] px-3.5 py-2.5 font-mono text-sm text-white focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
                  <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                    Password
                  </label>
                  <div className="sm:col-span-8">
                    <input
                      type="text"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-md border border-slate-600 bg-[#1c2536] px-3.5 py-2.5 font-mono text-sm text-white focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Conditional Static IP Settings */}
            {onuMode === 'Routing' && wanMode === 'STATIC_IP' && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-700 bg-slate-900/70 p-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-300">
                    IPv4 Address
                  </label>
                  <input
                    type="text"
                    value={staticIp}
                    onChange={(e) => setStaticIp(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300">
                    Subnet Mask
                  </label>
                  <input
                    type="text"
                    value={staticMask}
                    onChange={(e) => setStaticMask(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300">
                    Default Gateway
                  </label>
                  <input
                    type="text"
                    value={staticGw}
                    onChange={(e) => setStaticGw(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300">
                    Primary DNS
                  </label>
                  <input
                    type="text"
                    value={staticDns}
                    onChange={(e) => setStaticDns(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-xs text-white"
                  />
                </div>
              </div>
            )}

            {/* Row 7: WAN remote access (Exact match with screenshot) */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
              <label className="text-sm font-bold text-slate-200 sm:col-span-4 sm:text-right sm:pr-4">
                WAN remote access
              </label>
              <div className="sm:col-span-8">
                <select
                  value={wanRemoteAccess}
                  onChange={(e) =>
                    setWanRemoteAccess(e.target.value as WanRemoteAccessOption)
                  }
                  className="w-full rounded-md border border-slate-600 bg-[#1c2536] px-3.5 py-2.5 text-sm font-medium text-white focus:border-blue-500 focus:outline-hidden"
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

            {wanRemoteAccess === 'Enabled only from NOC subnet' && (
              <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
                <label className="text-xs font-semibold text-slate-400 sm:col-span-4 sm:text-right sm:pr-4">
                  Allowed NOC Subnet
                </label>
                <div className="sm:col-span-8">
                  <input
                    type="text"
                    value={allowedSubnet}
                    onChange={(e) => setAllowedSubnet(e.target.value)}
                    placeholder="103.144.22.0/24"
                    className="w-full rounded-md border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-xs text-white"
                  />
                </div>
              </div>
            )}

            {/* Conditional TR-069 CWMP ACS Configuration Box */}
            {configMethod === 'TR069' && (
              <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-950/20 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400">
                    TR-069 (CWMP ACS) Auto-Provisioning & WLAN Parameters
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Inform Interval: {selectedTr069Profile?.periodic_inform_interval || 300}s
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-300">
                      TR-069 ACS Server Profile
                    </label>
                    <select
                      value={tr069ProfileId}
                      onChange={(e) => setTr069ProfileId(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-xs text-white"
                    >
                      {db.tr069_profiles.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.profile_name} ({prof.acs_url})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      Remote WiFi SSID (TR-069)
                    </label>
                    <input
                      type="text"
                      value={wifiSsid}
                      onChange={(e) => setWifiSsid(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-xs text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-300">
                      Remote WiFi WPA2/WPA3 Passphrase (TR-069)
                    </label>
                    <input
                      type="text"
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-1.5 font-mono text-xs text-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Modal Footer Buttons (Exact match with screenshot: Close + green Update) */}
            <div className="flex items-center justify-end gap-4 border-t border-slate-700/80 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold text-sky-400 hover:text-sky-300"
              >
                Close
              </button>
              <button
                type="submit"
                className="rounded-md bg-[#4caf50] px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-[#43a047]"
              >
                Update
              </button>
            </div>
          </div>

          {/* Right Column: Live ZTE OMCI CLI & TR-069 CWMP Script Preview */}
          {showCliPreview && (
            <div className="flex flex-col bg-slate-950 p-5 lg:col-span-5">
              <div className="flex items-center justify-between pb-3">
                <span className="text-xs font-semibold text-emerald-400">
                  Generated ZTE OLT CLI + {configMethod === 'TR069' ? 'TR-069 CWMP RPC' : 'OMCI Security-Mgmt'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedCli);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/90 p-3.5 font-mono text-[11px] leading-relaxed text-emerald-300">
                {generatedCli}
              </pre>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
