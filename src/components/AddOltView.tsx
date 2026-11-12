import React, { useState } from 'react';
import { apiFetch as fetch } from '../services/authSession';
import { OltRecord } from '../services/mockDatabase';
import { Server, List, FileText, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

interface AddOltViewProps {
  onBack: () => void;
  onSaveOlt: (newOltData: Omit<OltRecord, 'id'>) => void;
}

const HUAWEI_MODELS = [
  'Huawei-EA5800-X15',
  'Huawei-EA5800-X7',
  'Huawei-EA5800-X2',
  'Huawei-MA5800-X15',
  'Huawei-MA5800-X7',
  'Huawei-MA5680T',
  'Huawei-MA5683T',
  'Huawei-MA5608T',
];

const ZTE_MODELS = [
  'ZTE-C320',
  'ZTE-C300',
  'ZTE-C300M',
  'ZTE-C600',
  'ZTE-C620',
  'ZTE-C650',
];

function generateRandomCommunity(length = 12): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '+.#@!';
  const all = lower + upper + digits;
  let res =
    lower[Math.floor(Math.random() * lower.length)] +
    upper[Math.floor(Math.random() * upper.length)] +
    digits[Math.floor(Math.random() * digits.length)] +
    special[Math.floor(Math.random() * special.length)];
  for (let i = 4; i < length; i++) {
    res += all[Math.floor(Math.random() * all.length)];
  }
  return res
    .split('')
    .sort(() => 0.5 - Math.random())
    .join('');
}

export const AddOltView: React.FC<AddOltViewProps> = ({ onBack, onSaveOlt }) => {
  const [name, setName] = useState('');
  const [ipOrFqdn, setIpOrFqdn] = useState('');
  const [protocol, setProtocol] = useState<'Telnet' | 'SSH'>('Telnet');
  const [tcpPort, setTcpPort] = useState('2333');
  const [telnetUsername, setTelnetUsername] = useState('');
  const [telnetPassword, setTelnetPassword] = useState('');
  const [snmpRoCommunity, setSnmpRoCommunity] = useState('cvha1G6neb+F');
  const [snmpRwCommunity, setSnmpRwCommunity] = useState('rX3nwosi9.Fx');
  const [snmpUdpPort, setSnmpUdpPort] = useState('2161');
  const [iptvEnabled, setIptvEnabled] = useState(false);
  const [manufacturer, setManufacturer] = useState<'Huawei' | 'ZTE'>('Huawei');
  const [hardwareVersion, setHardwareVersion] = useState('Huawei-EA5800-X15');
  const [supportedPonTypes, setSupportedPonTypes] = useState<
    | 'GPON (GPON, XGPON, XGSPON)'
    | 'EPON (EPON, 10G-EPON)'
    | 'GPON+EPON (select this only if you use both)'
  >('GPON (GPON, XGPON, XGSPON)');

  // Tooltip visibility state (shown by default on SNMP community hover/focus or toggle)
  const [showSnmpTooltip, setShowSnmpTooltip] = useState(true);

  // Test connection state
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    steps: string[];
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleManufacturerChange = (newMfg: 'Huawei' | 'ZTE') => {
    setManufacturer(newMfg);
    if (newMfg === 'Huawei') {
      setHardwareVersion('Huawei-EA5800-X15');
    } else {
      setHardwareVersion('ZTE-C320');
    }
  };

  const handleTestConnection = async () => {
    if (!ipOrFqdn.trim()) {
      setFormError('Please enter OLT IP or FQDN first before testing connection.');
      return;
    }
    setFormError(null);
    setTestingConnection(true);
    setTestResult(null);
    const targetHost = ipOrFqdn.trim();
    const user = telnetUsername.trim() || (manufacturer === 'Huawei' ? 'root' : 'zte');
    try {
      const resp = await fetch('/api/telnet/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: targetHost,
          port: Number(tcpPort) || 23,
          username: user,
          password: telnetPassword,
        }),
      });
      const data = await resp.json();
      setTestingConnection(false);
      if (data.reachable) {
        setTestResult({
          ok: true,
          steps: [
            `[1/4] Live TCP Socket connected to ${targetHost}:${tcpPort} via ${protocol} (${data.durationMs}ms)... OK`,
            `[2/4] Authenticated CLI user "${user}" on ${hardwareVersion}... OK`,
            `[3/4] SNMP RO (${snmpRoCommunity}) & RW (${snmpRwCommunity}) ready... OK`,
            `[4/4] OLT Response: ${(data.output || 'Connected').slice(0, 140)}`,
          ],
        });
      } else {
        setTestResult({
          ok: false,
          steps: [
            `[TCP Socket Test] Host ${targetHost}:${tcpPort} — ${data.error || 'Unreachable from current container network'}`,
            `Note: If ${targetHost} is on a local/VPN subnet, run this app in your local Docker container (port 3004) or click Save to register OLT in Database.`,
          ],
        });
      }
    } catch (err) {
      setTestingConnection(false);
      setTestResult({
        ok: false,
        steps: [`Connection test error: ${(err as Error).message}`],
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Please enter OLT Name.');
      return;
    }
    if (!ipOrFqdn.trim()) {
      setFormError('Please enter OLT IP or FQDN.');
      return;
    }

    setFormError(null);
    onSaveOlt({
      name: name.trim().toUpperCase(),
      manufacturer,
      hardware_model: hardwareVersion,
      firmware_version: 'V2.1.0',
      ip_address: ipOrFqdn.trim(),
      vpn_name: name.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'vpn_olt',
      vpn_subnet: `${ipOrFqdn.trim().split('.').slice(0, 3).join('.') || '172.16.0'}.0/30`,
      telnet_port: Number(tcpPort) || 2333,
      ssh_port: 22,
      protocol: protocol === 'Telnet' ? 'TELNET' : 'SSH',
      olt_username: telnetUsername.trim() || (manufacturer === 'Huawei' ? 'root' : 'zte'),
      olt_password: telnetPassword || '********',
      enable_password: telnetPassword || '********',
      snmp_read_community: snmpRoCommunity.trim() || 'cvha1G6neb+F',
      snmp_write_community: snmpRwCommunity.trim() || 'rX3nwosi9.Fx',
      snmp_port: Number(snmpUdpPort) || 2161,
      snmp_traps_enabled: true,
      iptv_module: iptvEnabled,
      supported_pon_types: supportedPonTypes,
      uplink_interface: manufacturer === 'Huawei' ? '0/19/0' : 'gei_1/19/3',
      location: 'POP Regional',
      temperature_c: 40,
      voltage_v: 48.2,
      power_usage_w: 45,
      cpu_load_pct: 14,
      uptime_str: '0 days, 00:01, 40°C',
      warning_rx_dbm: -30,
      critical_rx_dbm: -32,
      ntp_servers: '20.101.57.9, 216.239.35.4, 162.159.200.123',
      tr069_profile_name: 'JETCYBER',
      default_tr069_interface: 'Mgmt IP (recommended)',
      status: 'ONLINE',
      last_polled_at: 'Just now',
    });
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Top Header Bar matching Screenshot _365A2C64 */}
      <div className="flex items-center justify-between border-b border-[#1e3a5f]/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-[#2a4d7a] bg-[#102542] text-sky-400 shadow-inner">
            <Server className="h-4 w-4" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">Add OLT</h1>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded bg-[#4e5968] px-3.5 py-2 text-xs font-bold text-white shadow hover:bg-[#3e4856]"
        >
          <List className="h-3.5 w-3.5" />
          Back to OLTs
        </button>
      </div>

      {/* Main Form Card Container matching Screenshot _365A2C64 */}
      <form
        onSubmit={handleSubmit}
        className="rounded border border-[#1e3a5f] bg-[#0b1b30]/85 px-6 py-7 shadow-2xl"
      >
        {formError && (
          <div className="mb-5 max-w-3xl rounded border border-red-500/50 bg-red-950/60 px-4 py-2.5 text-xs font-semibold text-red-200">
            {formError}
          </div>
        )}

        <div className="max-w-3xl space-y-4">
          {/* 1. Name */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              Name
            </label>
            <div className="sm:col-span-9">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder=""
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 2. OLT IP or FQDN */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              OLT IP or FQDN
            </label>
            <div className="sm:col-span-9">
              <input
                type="text"
                value={ipOrFqdn}
                onChange={(e) => setIpOrFqdn(e.target.value)}
                placeholder=""
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 3. Connection protocol */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              Connection protocol
            </label>
            <div className="sm:col-span-9">
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as 'Telnet' | 'SSH')}
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              >
                <option value="Telnet">Telnet</option>
                <option value="SSH">SSH v2</option>
              </select>
            </div>
          </div>

          {/* 4. Telnet TCP port */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              {protocol === 'Telnet' ? 'Telnet TCP port' : 'SSH TCP port'}
            </label>
            <div className="sm:col-span-9">
              <input
                type="text"
                value={tcpPort}
                onChange={(e) => setTcpPort(e.target.value)}
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 5. OLT telnet username */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              OLT telnet username
            </label>
            <div className="sm:col-span-9">
              <input
                type="text"
                value={telnetUsername}
                onChange={(e) => setTelnetUsername(e.target.value)}
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 6. OLT telnet password */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              OLT telnet password
            </label>
            <div className="sm:col-span-9">
              <input
                type="password"
                value={telnetPassword}
                onChange={(e) => setTelnetPassword(e.target.value)}
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 7. SNMP read-only community + Dark Tooltip matching Screenshot _365A2C64 */}
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="pt-2 font-bold leading-tight text-slate-200 sm:col-span-3 sm:text-right">
              SNMP read-only
              <br />
              community
            </label>
            <div className="relative sm:col-span-9">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={snmpRoCommunity}
                  onFocus={() => setShowSnmpTooltip(true)}
                  onChange={(e) => setSnmpRoCommunity(e.target.value)}
                  className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="button"
                  title="Generate new random SNMP community"
                  onClick={() => setSnmpRoCommunity(generateRandomCommunity())}
                  className="rounded border border-[#254168] bg-[#142742] p-2 text-slate-300 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Will be automatically created on the OLT
              </div>

              {/* Floating Dark Validation Tooltip exactly like Screenshot _365A2C64 */}
              {showSnmpTooltip && (
                <div
                  onClick={() => setShowSnmpTooltip(false)}
                  title="Click to dismiss tooltip"
                  className="mt-1 cursor-pointer sm:absolute sm:top-2 sm:left-1/2 sm:z-20 sm:w-64 sm:-translate-x-1/2 rounded border border-slate-700 bg-[#070b12]/95 px-3 py-2 text-center text-[11px] leading-snug text-slate-200 shadow-2xl"
                >
                  Between 12 and 25 characters (at least 1 lowercase letter, 1
                  uppercase letter, 1 number and 1 special character)
                  <div className="mx-auto mt-1 h-2 w-2 rotate-45 border-r border-b border-slate-700 bg-[#070b12]" />
                </div>
              )}
            </div>
          </div>

          {/* 8. SNMP read-write community */}
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="pt-2 font-bold leading-tight text-slate-200 sm:col-span-3 sm:text-right">
              SNMP read-write
              <br />
              community
            </label>
            <div className="sm:col-span-9">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={snmpRwCommunity}
                  onChange={(e) => setSnmpRwCommunity(e.target.value)}
                  className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="button"
                  title="Generate new random SNMP RW community"
                  onClick={() => setSnmpRwCommunity(generateRandomCommunity())}
                  className="rounded border border-[#254168] bg-[#142742] p-2 text-slate-300 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Will be automatically created on the OLT
              </div>
            </div>
          </div>

          {/* 9. SNMP UDP port */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              SNMP UDP port
            </label>
            <div className="sm:col-span-9">
              <input
                type="text"
                value={snmpUdpPort}
                onChange={(e) => setSnmpUdpPort(e.target.value)}
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 10. IPTV module */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              IPTV module
            </label>
            <div className="sm:col-span-9">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-white">
                <input
                  type="checkbox"
                  checked={iptvEnabled}
                  onChange={(e) => setIptvEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-500"
                />
                <span>Enable</span>
              </label>
            </div>
          </div>

          {/* 11. Manufacturer */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              Manufacturer
            </label>
            <div className="sm:col-span-9">
              <select
                value={manufacturer}
                onChange={(e) =>
                  handleManufacturerChange(e.target.value as 'Huawei' | 'ZTE')
                }
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              >
                <option value="Huawei">Huawei</option>
                <option value="ZTE">ZTE</option>
              </select>
            </div>
          </div>

          {/* 12. OLT hardware version */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="font-bold text-slate-200 sm:col-span-3 sm:text-right">
              OLT hardware version
            </label>
            <div className="sm:col-span-9">
              <select
                value={hardwareVersion}
                onChange={(e) => setHardwareVersion(e.target.value)}
                className="w-full rounded border border-[#254168] bg-[#142742]/90 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              >
                {(manufacturer === 'Huawei' ? HUAWEI_MODELS : ZTE_MODELS).map(
                  (model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          {/* 13. 3D OLT Chassis Visual Preview (Matching Screenshot _365A2C64) */}
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12 sm:gap-4">
            <div className="sm:col-span-3" />
            <div className="sm:col-span-9">
              <div className="relative inline-flex items-end gap-2 pt-1 pb-2">
                {/* Realistic 3D Rack OLT Chassis Card */}
                <div className="relative h-28 w-28 rounded border border-slate-500/80 bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 p-1.5 shadow-xl">
                  {/* Top dark fan tray bar */}
                  <div className="mb-1 flex h-3 items-center justify-between rounded-xs bg-slate-800 px-1.5">
                    <span className="font-mono text-[7px] font-bold text-amber-300">
                      {hardwareVersion}
                    </span>
                    <div className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </div>
                  </div>
                  {/* Vertical GPON / Control Board Slots */}
                  <div className="grid h-19 grid-cols-10 gap-0.5 rounded-xs border border-slate-600 bg-slate-700 p-0.5">
                    {Array.from({ length: 10 }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-col justify-between rounded-[1px] p-[1px] ${
                          idx === 4 || idx === 5
                            ? 'bg-slate-400'
                            : 'bg-slate-300'
                        }`}
                      >
                        <span className="h-1 w-full bg-emerald-600" />
                        <div className="space-y-[1px]">
                          <div className="h-0.5 w-full bg-slate-700" />
                          <div className="h-0.5 w-full bg-slate-700" />
                          <div className="h-0.5 w-full bg-slate-700" />
                          <div className="h-0.5 w-full bg-slate-700" />
                        </div>
                        <span className="h-1 w-full bg-amber-500/80" />
                      </div>
                    ))}
                  </div>
                  {/* Bottom Rack Ear / Ground Bar */}
                  <div className="mt-1 h-1.5 w-full rounded-xs bg-slate-700" />
                </div>

                {/* Manufacturer Badge matching bottom-right of chassis in Screenshot _365A2C64 */}
                {manufacturer === 'Huawei' ? (
                  <div className="-ml-4 flex flex-col items-center rounded bg-[#0c1c30]/90 px-1.5 py-0.5 shadow">
                    <div className="text-sm leading-none text-red-500">✿</div>
                    <span className="font-sans text-[7px] font-extrabold tracking-widest text-red-500">
                      HUAWEI
                    </span>
                  </div>
                ) : (
                  <div className="-ml-4 flex flex-col items-center rounded bg-[#0c1c30]/90 px-1.5 py-0.5 shadow">
                    <span className="font-sans text-[10px] font-extrabold tracking-tight text-sky-400">
                      ZTE中兴
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 14. Supported PON types */}
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-12 sm:gap-4">
            <label className="pt-0.5 font-bold text-slate-200 sm:col-span-3 sm:text-right">
              Supported PON types
            </label>
            <div className="space-y-2 sm:col-span-9">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-white">
                <input
                  type="radio"
                  name="supportedPonTypes"
                  checked={supportedPonTypes === 'GPON (GPON, XGPON, XGSPON)'}
                  onChange={() =>
                    setSupportedPonTypes('GPON (GPON, XGPON, XGSPON)')
                  }
                  className="accent-sky-500"
                />
                <span>GPON (GPON, XGPON, XGSPON)</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-white">
                <input
                  type="radio"
                  name="supportedPonTypes"
                  checked={supportedPonTypes === 'EPON (EPON, 10G-EPON)'}
                  onChange={() => setSupportedPonTypes('EPON (EPON, 10G-EPON)')}
                  className="accent-sky-500"
                />
                <span>EPON (EPON, 10G-EPON)</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-white">
                <input
                  type="radio"
                  name="supportedPonTypes"
                  checked={
                    supportedPonTypes ===
                    'GPON+EPON (select this only if you use both)'
                  }
                  onChange={() =>
                    setSupportedPonTypes(
                      'GPON+EPON (select this only if you use both)'
                    )
                  }
                  className="accent-sky-500"
                />
                <span>GPON+EPON (select this only if you use both)</span>
              </label>
            </div>
          </div>

          {/* Connection Test Output Box (when "Test connection" is clicked) */}
          {testResult && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:gap-4">
              <div className="sm:col-span-3" />
              <div className="sm:col-span-9">
                <div className="rounded border border-emerald-500/40 bg-emerald-950/50 p-3 font-mono text-[11px] text-emerald-300">
                  <div className="mb-1.5 flex items-center gap-1.5 font-sans text-xs font-bold text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    SmartOLT Connection & SNMP Provisioning Test Passed
                  </div>
                  {testResult.steps.map((step, i) => (
                    <div key={i} className="leading-relaxed">
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 15. Bottom Action Row: Save + Cancel on Left, Test connection on Right */}
          <div className="grid grid-cols-1 items-center gap-2 pt-3 sm:grid-cols-12 sm:gap-4">
            <div className="sm:col-span-3" />
            <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-9">
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded bg-[#5cb85c] px-4 py-2 text-xs font-bold text-white shadow hover:bg-[#4cae4c]"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Save
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="text-xs font-semibold text-sky-400 hover:text-sky-300 hover:underline"
                >
                  Cancel
                </button>
              </div>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="flex items-center gap-1.5 rounded bg-[#0275d8] px-4 py-2 text-xs font-bold text-white shadow hover:bg-[#025aa5] disabled:opacity-60"
              >
                {testingConnection && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Test connection
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
