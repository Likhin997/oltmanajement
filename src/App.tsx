/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  INITIAL_DB_STATE,
  DEFAULT_APP_USERS,
  SmartOltDatabaseState,
  OltRecord,
  OnuRecord,
  ProvisioningLogRecord,
  VlanRecord,
  ZoneRecord,
  SectorRecord,
  OdbRecord,
  Tr069ProfileRecord,
  SpeedProfileRecord,
  TcontProfileRecord,
  OnuTypeRecord,
  AppUserRecord,
  AutoProvisioningTaskRecord,
  AutoProvisioningHistoryRecord,
  buildLiveZteRunningConfig,
} from './services/mockDatabase';
import {
  parseZteUncfgOutput,
  parseZteOnuStateOutput,
  parseZteOpticalAttenuation,
  generateAuthorizeCliScript,
  generateTr069ProfileOltCliScript,
  findNextAvailableOnuIndex,
} from './services/oltEngine';
import { PRODUCTION_CODE_MODULES } from './services/sourceCodeModules';
import { AuthorizeOnuModal } from './components/AuthorizeOnuModal';
import { OnuDetailView } from './components/OnuDetailView';
import { UpdateOnuModeModal } from './components/UpdateOnuModeModal';
import { OltDetailView, OltDetailTab } from './components/OltDetailView';
import { AddOltView } from './components/AddOltView';
import { PrtgTrafficGraph } from './components/PrtgTrafficGraph';
import {
  AutoProvisioningTaskManager,
  matchAutoProvisioningTaskForOnu,
  buildAutoTaskCliScript,
  verifyOltProvisioningOutput,
  detectOnuVendorFromSn,
} from './components/AutoProvisioningTaskManager';
import {
  Save,
  Contrast,
  FileCode,
  User,
  Power,
  ChevronDown,
  RefreshCw,
  Play,
  History,
  Square,
  Search,
  Plus,
  Download,
  Eye,
  EyeOff,
  Trash2,
  Check,
  Copy,
  Wifi,
  AlertTriangle,
  Sliders,
  Radio,
  Code2,
  X,
  LayoutDashboard,
  Server,
  MapPin,
  Layers,
  GitBranch,
  BarChart3,
  Activity,
  ShieldCheck,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Lock,
  LogOut,
  Clock,
  Database,
} from 'lucide-react';

import {
  AUTH_SESSION_TOKEN_KEY,
  LEGACY_AUTH_USER_ID_KEY,
  IDLE_SESSION_TIMEOUT_MS,
  IDLE_WARNING_THRESHOLD_MS,
  readLastActivityTimestamp,
  touchUserActivityTimestamp,
  clearLastActivityTimestamp,
  formatRemainingIdleTime,
  setOnUnauthorizedHandler,
  apiFetch as fetch,
} from './services/authSession';
import {
  initGoogleDriveAuth,
  googleSignIn,
  googleLogout,
  listGoogleDriveBackups,
  uploadFileToGoogleDrive,
  downloadGoogleDriveFileText,
  deleteGoogleDriveFile,
  GoogleDriveBackupFile,
} from './services/googleDriveService';
import type { User as FirebaseUser } from 'firebase/auth';

type NavigationView =
  | 'DASHBOARD'
  | 'UNCONFIGURED'
  | 'AUTHORIZE_FORM'
  | 'CONFIGURED'
  | 'ONU_DETAIL'
  | 'OLTS_LIST'
  | 'ADD_OLT'
  | 'OLT_DETAIL'
  | 'TASKS'
  | 'ZONES'
  | 'SECTORS'
  | 'SPLITTERS'
  | 'USERS'
  | 'SPEED_PROFILES'
  | 'VPN_TR069'
  | 'DIAG_PARSER'
  | 'GRAPHS'
  | 'SOURCE_CODE';

export default function App() {
  const [db, setDb] = useState<SmartOltDatabaseState>(INITIAL_DB_STATE);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authenticatedUser, setAuthenticatedUser] =
    useState<AppUserRecord | null>(null);
  const [sessionTokenId, setSessionTokenId] = useState<string | null>(null);
  const [loggedInUserId, setLoggedInUserId] = useState<number | null>(null);
  const [idleRemainingMs, setIdleRemainingMs] = useState<number>(
    IDLE_SESSION_TIMEOUT_MS
  );
  const lastKeepaliveSentAtRef = useRef<number>(0);

  const [dbMeta, setDbMeta] = useState<{
    dbEngine: string;
    pgConnected?: boolean;
    pgConfig?: {
      host: string;
      port: number;
      user: string;
      database: string;
    };
    pgLastError?: string | null;
    dockerPort: number;
  }>({
    dbEngine: 'PostgreSQL (localhost:5435)',
    pgConnected: false,
    pgConfig: {
      host: 'localhost',
      port: 5435,
      user: 'likhin',
      database: 'smartolt_db',
    },
    dockerPort: 3004,
  });
  const [showPgConfigModal, setShowPgConfigModal] = useState(false);
  const [pgHost, setPgHost] = useState('localhost');
  const [pgPort, setPgPort] = useState(5435);
  const [pgUser, setPgUser] = useState('likhin');
  const [pgPassword, setPgPassword] = useState('');
  const [pgDatabase, setPgDatabase] = useState('smartolt_db');
  const [pgTesting, setPgTesting] = useState(false);
  const [showAddUncfgModal, setShowAddUncfgModal] = useState(false);
  const [manualUncfgOltId, setManualUncfgOltId] = useState<number>(1);
  const [manualUncfgPort, setManualUncfgPort] = useState<number>(1);
  const [manualUncfgSn, setManualUncfgSn] = useState<string>('ZTEGC6A394D4');
  const [manualUncfgType, setManualUncfgType] = useState<string>('ALL');
  const skipNextServerSyncRef = useRef<boolean>(false);
  const nextSyncIsUserMutationRef = useRef<boolean>(false);
  const lastUserMutationAtRef = useRef<number>(0);
  const [isSyncingAllOnus, setIsSyncingAllOnus] = useState<boolean>(false);

  // Non-destructive state merge helper so background OLT Telnet polls never wipe out
  // newly added Zones, Sectors, ODPs (Splitters), or user-edited ONU Zone/ODP/Customer fields.
  const mergeLiveOltStatePreservingUserMetadata = (
    prev: SmartOltDatabaseState,
    incoming: SmartOltDatabaseState
  ): SmartOltDatabaseState => {
    const mergeByIdPreferPrev = <T extends { id: number }>(
      prevList: T[] | undefined,
      incList: T[] | undefined
    ): T[] => {
      const map = new Map<number, T>();
      for (const item of incList || []) {
        if (item && typeof item.id === 'number') map.set(item.id, item);
      }
      for (const item of prevList || []) {
        if (item && typeof item.id === 'number') map.set(item.id, item);
      }
      return Array.from(map.values());
    };

    const prevOnuById = new Map<number, OnuRecord>();
    const prevOnuByCoord = new Map<string, OnuRecord>();
    const prevOnuBySn = new Map<string, OnuRecord>();

    for (const u of prev.onus || []) {
      prevOnuById.set(u.id, u);
      if (u.onu_index !== null) {
        prevOnuByCoord.set(`${u.olt_id}:${u.board}:${u.port}:${u.onu_index}`, u);
      }
      if (u.serial_number && !u.serial_number.startsWith('ONU-')) {
        prevOnuBySn.set(u.serial_number.toUpperCase(), u);
      }
    }

    const mergedOnus = (incoming.onus || []).map((incOnu) => {
      const coordKey =
        incOnu.onu_index !== null
          ? `${incOnu.olt_id}:${incOnu.board}:${incOnu.port}:${incOnu.onu_index}`
          : null;
      const prevOnu =
        prevOnuById.get(incOnu.id) ||
        (coordKey ? prevOnuByCoord.get(coordKey) : undefined) ||
        (incOnu.serial_number
          ? prevOnuBySn.get(incOnu.serial_number.toUpperCase())
          : undefined);

      if (!prevOnu) return incOnu;

      return {
        ...incOnu,
        zone_id: prevOnu.zone_id ?? incOnu.zone_id ?? null,
        sector_id: prevOnu.sector_id ?? incOnu.sector_id ?? null,
        odb_id: prevOnu.odb_id ?? incOnu.odb_id ?? null,
        odb_port: prevOnu.odb_port ?? incOnu.odb_port ?? null,
        customer_name:
          prevOnu.customer_name && !prevOnu.customer_name.startsWith('ONU-')
            ? prevOnu.customer_name
            : incOnu.customer_name,
        address:
          prevOnu.address &&
          prevOnu.address.trim() !== '' &&
          prevOnu.address.trim().toLowerCase() !== 'none'
            ? prevOnu.address
            : incOnu.address,
        contact:
          prevOnu.contact && prevOnu.contact !== 'None'
            ? prevOnu.contact
            : incOnu.contact,
        external_id:
          prevOnu.external_id && !prevOnu.external_id.startsWith('ONU-')
            ? prevOnu.external_id
            : incOnu.external_id,
        tr069_profile_id:
          prevOnu.tr069_profile_id !== undefined
            ? prevOnu.tr069_profile_id
            : incOnu.tr069_profile_id ?? null,
        tr069_interface: prevOnu.tr069_interface ?? incOnu.tr069_interface,
        tr069_mgmt_vlan_id:
          prevOnu.tr069_mgmt_vlan_id ?? incOnu.tr069_mgmt_vlan_id ?? null,
        tr069_status: prevOnu.tr069_status ?? incOnu.tr069_status,
        voip_enabled: prevOnu.voip_enabled ?? incOnu.voip_enabled,
        attached_vlan_ids:
          prevOnu.attached_vlan_ids && prevOnu.attached_vlan_ids.length > 0
            ? prevOnu.attached_vlan_ids
            : incOnu.attached_vlan_ids,
        mgmt_ip_mode: prevOnu.mgmt_ip_mode ?? incOnu.mgmt_ip_mode,
        mgmt_ip: prevOnu.mgmt_ip ?? incOnu.mgmt_ip,
        mgmt_subnet_mask: prevOnu.mgmt_subnet_mask ?? incOnu.mgmt_subnet_mask,
        mgmt_gateway: prevOnu.mgmt_gateway ?? incOnu.mgmt_gateway,
        mgmt_keep_service_port:
          prevOnu.mgmt_keep_service_port ?? incOnu.mgmt_keep_service_port,
        mgmt_allow_remote_access:
          prevOnu.mgmt_allow_remote_access ?? incOnu.mgmt_allow_remote_access,
      };
    });

    const prevVlanByKey = new Map<string, VlanRecord>();
    for (const pv of prev.vlans || []) {
      prevVlanByKey.set(`${pv.olt_id}:${pv.vlan_id}`, pv);
    }
    const mergedVlans = (incoming.vlans || []).map((iv) => {
      const pv = prevVlanByKey.get(`${iv.olt_id}:${iv.vlan_id}`);
      if (!pv) return iv;
      return {
        ...iv,
        description: pv.description || iv.description,
        default_for: pv.default_for || iv.default_for,
        used_for_mgmt_tr069_voip: pv.used_for_mgmt_tr069_voip,
        used_for_iptv: pv.used_for_iptv,
        dhcp_snooping: pv.dhcp_snooping,
        lan_to_lan: pv.lan_to_lan,
        service_type: pv.service_type,
        is_default: pv.is_default,
      };
    });
    for (const pv of prev.vlans || []) {
      const k = `${pv.olt_id}:${pv.vlan_id}`;
      if (!mergedVlans.some((mv) => `${mv.olt_id}:${mv.vlan_id}` === k)) {
        mergedVlans.push(pv);
      }
    }

    return {
      ...incoming,
      zones: mergeByIdPreferPrev(prev.zones, incoming.zones),
      sectors: mergeByIdPreferPrev(prev.sectors, incoming.sectors),
      odbs: mergeByIdPreferPrev(prev.odbs, incoming.odbs),
      vlans: mergedVlans,
      tr069_profiles:
        prev.tr069_profiles && prev.tr069_profiles.length > 0
          ? prev.tr069_profiles
          : incoming.tr069_profiles,
      onus: mergedOnus,
    };
  };

  const loadAuthorizedDatabaseState = async () => {
    try {
      const r = await fetch('/api/state');
      if (!r.ok) return;
      const data = await r.json();
      if (data && data.state) {
        skipNextServerSyncRef.current = true;
        setDb(data.state);
      }
      if (data && data.meta) {
        setDbMeta(data.meta);
      }
      setDbLoaded(true);
    } catch {
      // ignore network error
    }
  };

  // 1. Verify Server Session on mount before allowing access to main application
  useEffect(() => {
    let mounted = true;
    try {
      window.localStorage.removeItem(LEGACY_AUTH_USER_ID_KEY);
    } catch {
      // ignore
    }

    fetch('/api/auth/session')
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then(async (data) => {
        if (!mounted) return;
        const storedLastAct = readLastActivityTimestamp();
        if (
          storedLastAct !== null &&
          Date.now() - storedLastAct > IDLE_SESSION_TIMEOUT_MS
        ) {
          try {
            await fetch('/api/auth/logout', { method: 'POST' });
          } catch {
            // ignore
          }
          clearLastActivityTimestamp();
          try {
            window.sessionStorage.removeItem(AUTH_SESSION_TOKEN_KEY);
          } catch {
            // ignore
          }
          setAuthenticatedUser(null);
          setLoggedInUserId(null);
          setSessionTokenId(null);
          setDbLoaded(false);
          setLoginError(
            'Sesi berakhir otomatis karena tidak ada aktivitas selama 30 menit.'
          );
          setAuthChecking(false);
          return;
        }
        if (data && data.ok && data.authenticated && data.user) {
          const activeTs = storedLastAct ?? touchUserActivityTimestamp();
          const remaining =
            typeof data.remainingIdleMs === 'number'
              ? Math.min(
                  data.remainingIdleMs,
                  Math.max(0, IDLE_SESSION_TIMEOUT_MS - (Date.now() - activeTs))
                )
              : Math.max(0, IDLE_SESSION_TIMEOUT_MS - (Date.now() - activeTs));
          setIdleRemainingMs(remaining);
          setAuthenticatedUser(data.user);
          setLoggedInUserId(data.user.id);
          setSessionTokenId(data.sessionId || null);
          await loadAuthorizedDatabaseState();
        } else {
          clearLastActivityTimestamp();
          try {
            window.sessionStorage.removeItem(AUTH_SESSION_TOKEN_KEY);
          } catch {
            // ignore
          }
          setAuthenticatedUser(null);
          setLoggedInUserId(null);
          setSessionTokenId(null);
          setDbLoaded(false);
        }
        setAuthChecking(false);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthenticatedUser(null);
        setLoggedInUserId(null);
        setSessionTokenId(null);
        setAuthChecking(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // 2. Sync state changes to Backend SQL Database (/api/state/sync) ONLY when authenticated
  useEffect(() => {
    if (!dbLoaded || !loggedInUserId) return;
    if (skipNextServerSyncRef.current) {
      skipNextServerSyncRef.current = false;
      return;
    }
    if (authenticatedUser?.role === 'VIEWER') {
      return;
    }
    const isUserMut = nextSyncIsUserMutationRef.current;
    nextSyncIsUserMutationRef.current = false;
    if (isUserMut) {
      lastUserMutationAtRef.current = Date.now();
    }

    fetch('/api/state/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(!isUserMut ? { 'X-Background-Poll': '1' } : {}),
      },
      body: JSON.stringify({
        state: db,
        userMutation: isUserMut,
        allowShrink: isUserMut,
      }),
    })
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (
          !isUserMut &&
          Date.now() - lastUserMutationAtRef.current > 5000 &&
          data &&
          data.state &&
          ((Array.isArray(data.state.olts) && data.state.olts.length > db.olts.length) ||
            (Array.isArray(data.state.onus) && data.state.onus.length > db.onus.length) ||
            (Array.isArray(data.state.odbs) && data.state.odbs.length > db.odbs.length) ||
            (Array.isArray(data.state.sectors) &&
              data.state.sectors.length > (db.sectors?.length || 0)))
        ) {
          skipNextServerSyncRef.current = true;
          setDb((prev) => mergeLiveOltStatePreservingUserMetadata(prev, data.state));
        }
      })
      .catch(() => {
        // ignore transient network error
      });
  }, [db, dbLoaded, loggedInUserId]);

  const [activeView, setActiveView] = useState<NavigationView>('DASHBOARD');
  const [selectedOltId, setSelectedOltId] = useState<number>(1);
  const [initialOltTab, setInitialOltTab] = useState<OltDetailTab>('OLT_DETAILS');
  const [selectedOnuId, setSelectedOnuId] = useState<number>(1);
  const [authorizingOnu, setAuthorizingOnu] = useState<OnuRecord | null>(null);
  const [updatingModeOnu, setUpdatingModeOnu] = useState<OnuRecord | null>(null);

  // Dropdown menus in Top Navbar & Collapsible Sidebar State
  const [openDropdown, setOpenDropdown] = useState<
    'MAP' | 'TASKS' | 'REPORTS' | 'SETTINGS' | null
  >(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('smartolt_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('smartolt_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  // ==========================================================================
  // BROWSER BACK / FORWARD HISTORY ENGINE (HTML5 pushState + popstate + Root Guard)
  // Memungkinkan tombol Back & Forward di browser / mouse berpindah antar menu,
  // tab OLT, dan detail ONU di dalam aplikasi tanpa keluar ke situs sebelumnya!
  // ==========================================================================
  const isHandlingPopStateRef = useRef(false);
  const historyReadyRef = useRef(false);
  const lastPushedSignatureRef = useRef<string>('');
  const dbOnusRef = useRef<OnuRecord[]>(db.onus);
  useEffect(() => {
    dbOnusRef.current = db.onus;
  }, [db.onus]);

  const buildHashForNav = (
    view: NavigationView,
    oltId: number,
    oltTab: OltDetailTab,
    onuId: number,
    authOnuId: number | null
  ): string => {
    switch (view) {
      case 'DASHBOARD':
        return '#/dashboard';
      case 'UNCONFIGURED':
        return '#/unconfigured';
      case 'AUTHORIZE_FORM':
        return `#/authorize/${authOnuId || ''}`;
      case 'CONFIGURED':
        return '#/configured';
      case 'ONU_DETAIL':
        return `#/onu/${onuId}`;
      case 'OLTS_LIST':
        return '#/olts';
      case 'ADD_OLT':
        return '#/olts/add';
      case 'OLT_DETAIL':
        return `#/olt/${oltId}/${oltTab}`;
      case 'TASKS':
        return '#/tasks';
      case 'ZONES':
        return '#/settings/zones';
      case 'SECTORS':
        return '#/settings/sectors';
      case 'SPLITTERS':
        return '#/settings/splitters';
      case 'USERS':
        return '#/settings/users';
      case 'SPEED_PROFILES':
        return '#/settings/speed-profiles';
      case 'VPN_TR069':
        return '#/settings/vpn-tr069';
      case 'DIAG_PARSER':
        return '#/diag';
      case 'GRAPHS':
        return '#/graphs';
      case 'SOURCE_CODE':
        return '#/source-code';
      default:
        return '#/dashboard';
    }
  };

  const loggedInUserIdRef = useRef<number | null>(loggedInUserId);
  useEffect(() => {
    loggedInUserIdRef.current = loggedInUserId;
  }, [loggedInUserId]);

  useEffect(() => {
    const rootGuardState = {
      smartOltRootGuard: true,
      activeView: 'DASHBOARD' as NavigationView,
      selectedOltId: 1,
      initialOltTab: 'OLT_DETAILS' as OltDetailTab,
      selectedOnuId: 1,
      authorizingOnuId: null as number | null,
      updatingModeOnuId: null as number | null,
    };

    const initialNavState = {
      smartOltNav: true,
      activeView: 'DASHBOARD' as NavigationView,
      selectedOltId: 1,
      initialOltTab: 'OLT_DETAILS' as OltDetailTab,
      selectedOnuId: 1,
      authorizingOnuId: null as number | null,
      updatingModeOnuId: null as number | null,
    };

    if (loggedInUserIdRef.current !== null) {
      try {
        window.history.replaceState(rootGuardState, '', '#/dashboard');
        window.history.pushState(initialNavState, '', '#/dashboard');
        lastPushedSignatureRef.current = JSON.stringify({
          v: 'DASHBOARD',
          olt: 1,
          tab: 'OLT_DETAILS',
          onu: 1,
          auth: null,
          upd: null,
        });
      } catch {
        // Ignore if running in restricted environment
      }
    } else {
      try {
        window.history.replaceState({ smartOltLoginGuard: true }, '', '#/login');
      } catch {
        // Ignore
      }
    }
    historyReadyRef.current = true;

    const handlePopState = (event: PopStateEvent) => {
      // Strictly block any navigation to main views when not logged in
      if (loggedInUserIdRef.current === null) {
        try {
          window.history.replaceState(
            { smartOltLoginGuard: true },
            '',
            '#/login'
          );
        } catch {
          // Ignore
        }
        return;
      }

      const st = event.state;
      isHandlingPopStateRef.current = true;
      setOpenDropdown(null);

      if (st && st.smartOltNav) {
        const nextView: NavigationView = st.activeView || 'DASHBOARD';
        const nextOltId: number = Number(st.selectedOltId || 1);
        const nextOltTab: OltDetailTab = st.initialOltTab || 'OLT_DETAILS';
        const nextOnuId: number = Number(st.selectedOnuId || 1);
        const nextAuthId: number | null = st.authorizingOnuId ?? null;
        const nextUpdId: number | null = st.updatingModeOnuId ?? null;

        setActiveView(nextView);
        setSelectedOltId(nextOltId);
        setInitialOltTab(nextOltTab);
        setSelectedOnuId(nextOnuId);
        setAuthorizingOnu(
          nextAuthId
            ? dbOnusRef.current.find((u) => u.id === nextAuthId) || null
            : null
        );
        setUpdatingModeOnu(
          nextUpdId
            ? dbOnusRef.current.find((u) => u.id === nextUpdId) || null
            : null
        );

        lastPushedSignatureRef.current = JSON.stringify({
          v: nextView,
          olt: nextOltId,
          tab: nextOltTab,
          onu: nextOnuId,
          auth: nextAuthId,
          upd: nextUpdId,
        });
      } else {
        setActiveView('DASHBOARD');
        setAuthorizingOnu(null);
        setUpdatingModeOnu(null);
        const fallbackSig = JSON.stringify({
          v: 'DASHBOARD',
          olt: 1,
          tab: 'OLT_DETAILS',
          onu: 1,
          auth: null,
          upd: null,
        });
        lastPushedSignatureRef.current = fallbackSig;
        try {
          window.history.pushState(initialNavState, '', '#/dashboard');
        } catch {
          // Ignore
        }
      }

      setTimeout(() => {
        isHandlingPopStateRef.current = false;
      }, 0);
    };

    const handleHashChange = () => {
      if (loggedInUserIdRef.current === null && window.location.hash !== '#/login') {
        try {
          window.history.replaceState(
            { smartOltLoginGuard: true },
            '',
            '#/login'
          );
        } catch {
          // Ignore
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Push new browser history state whenever the user navigates inside the app
  useEffect(() => {
    if (!historyReadyRef.current) return;
    if (isHandlingPopStateRef.current) return;

    // Always force #/login when unauthenticated so the user can never enter #/dashboard without login
    if (loggedInUserId === null) {
      try {
        window.history.replaceState(
          { smartOltLoginGuard: true },
          '',
          '#/login'
        );
      } catch {
        // Ignore
      }
      return;
    }

    const authId = authorizingOnu?.id ?? null;
    const updId = updatingModeOnu?.id ?? null;
    const signature = JSON.stringify({
      v: activeView,
      olt: selectedOltId,
      tab: initialOltTab,
      onu: selectedOnuId,
      auth: authId,
      upd: updId,
    });

    if (signature === lastPushedSignatureRef.current) return;
    lastPushedSignatureRef.current = signature;

    const hash = buildHashForNav(
      activeView,
      selectedOltId,
      initialOltTab,
      selectedOnuId,
      authId
    );
    try {
      window.history.pushState(
        {
          smartOltNav: true,
          activeView,
          selectedOltId,
          initialOltTab,
          selectedOnuId,
          authorizingOnuId: authId,
          updatingModeOnuId: updId,
        },
        '',
        hash
      );
    } catch {
      // Ignore
    }
  }, [
    loggedInUserId,
    activeView,
    selectedOltId,
    initialOltTab,
    selectedOnuId,
    authorizingOnu,
    updatingModeOnu,
  ]);

  // Unconfigured ONUs Discovery State (Only `show gpon onu uncfg`, no full OLT sync)
  const [uncfgOltFilter, setUncfgOltFilter] = useState<'ALL' | number>('ALL');
  const [isPollingUncfg, setIsPollingUncfg] = useState(false);
  const [lastUncfgCliOutput, setLastUncfgCliOutput] = useState<string | null>(null);
  const [uncfgNowMs, setUncfgNowMs] = useState<number>(() => Date.now());
  const uncfgFirstSeenRef = useRef<Record<string, number>>((() => {
    try {
      const raw = localStorage.getItem('smartolt_uncfg_first_seen_v1');
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  })());

  useEffect(() => {
    const timer = setInterval(() => {
      setUncfgNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getUnconfiguredWaitingInfo = (
    u: OnuRecord,
    nowMs: number
  ): { durationText: string; sinceText: string; elapsedSec: number } => {
    const key = `${u.olt_id}:${u.serial_number.toUpperCase()}`;
    let startMs = 0;

    if (u.last_online_at) {
      const parsed = Date.parse(u.last_online_at);
      if (!Number.isNaN(parsed) && parsed > 1700000000000) {
        startMs = parsed;
      }
    }
    if (!startMs && u.detected_ago && u.detected_ago !== 'Just now') {
      const parsed = Date.parse(u.detected_ago);
      if (!Number.isNaN(parsed) && parsed > 1700000000000) {
        startMs = parsed;
      }
    }
    if (!startMs && uncfgFirstSeenRef.current[key]) {
      startMs = uncfgFirstSeenRef.current[key];
    }
    if (!startMs && u.id > 1700000000000 && u.id <= nowMs + 60000) {
      startMs = u.id;
    }
    if (!startMs) {
      startMs = nowMs;
    }

    if (
      !uncfgFirstSeenRef.current[key] ||
      startMs < uncfgFirstSeenRef.current[key]
    ) {
      uncfgFirstSeenRef.current[key] = startMs;
      try {
        localStorage.setItem(
          'smartolt_uncfg_first_seen_v1',
          JSON.stringify(uncfgFirstSeenRef.current)
        );
      } catch {
        // ignore storage quota error
      }
    }

    const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    let durationText = '';
    if (elapsedSec < 60) {
      durationText = `${elapsedSec} detik`;
    } else if (elapsedSec < 3600) {
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      durationText = `${m}m ${s}d`;
    } else if (elapsedSec < 86400) {
      const h = Math.floor(elapsedSec / 3600);
      const m = Math.floor((elapsedSec % 3600) / 60);
      const s = elapsedSec % 60;
      durationText = `${h}j ${m}m ${s}d`;
    } else {
      const d = Math.floor(elapsedSec / 86400);
      const h = Math.floor((elapsedSec % 86400) / 3600);
      const m = Math.floor((elapsedSec % 3600) / 60);
      durationText = `${d}h ${h}j ${m}m`;
    }

    const sinceDate = new Date(startMs);
    const sinceText = sinceDate.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return {
      durationText,
      sinceText: `Sejak ${sinceText} WIB`,
      elapsedSec,
    };
  };

  // Configured ONUs Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOlt, setFilterOlt] = useState<string>('ANY');
  const [filterBoard, setFilterBoard] = useState<string>('ANY');
  const [filterPort, setFilterPort] = useState<string>('ANY');
  const [filterZone, setFilterZone] = useState<string>('ANY');
  const [filterSplitter, setFilterSplitter] = useState<string>('ANY');
  const [filterVlan, setFilterVlan] = useState<string>('ANY');
  const [filterPhaseStatus, setFilterPhaseStatus] = useState<
    'ALL' | 'ONLINE' | 'OFFLINE' | 'LOS' | 'PWRFAIL' | 'OFFLINE_NA'
  >('ALL');
  const [filterSignalLevel, setFilterSignalLevel] = useState<
    'ALL' | 'LOW' | 'GOOD' | 'WARNING' | 'CRITICAL'
  >('ALL');
  const [configuredOnusPerPage, setConfiguredOnusPerPage] = useState<50 | 100 | 1000>(() => {
    try {
      const saved = Number(
        localStorage.getItem('smartolt_configured_onus_per_page')
      );
      if (saved === 50 || saved === 100 || saved === 1000) {
        return saved;
      }
    } catch {
      // ignore storage error
    }
    return 50;
  });
  const [configuredOnusPage, setConfiguredOnusPage] = useState<number>(1);

  const handleSelectConfiguredPerPage = (size: 50 | 100 | 1000) => {
    setConfiguredOnusPerPage(size);
    setConfiguredOnusPage(1);
    try {
      localStorage.setItem('smartolt_configured_onus_per_page', String(size));
    } catch {
      // ignore storage error
    }
  };

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // CLI Regex Parser Tester State (in Diag tab)
  const [rawUncfgCli, setRawUncfgCli] = useState<string>(
    `POP-LEBAK-C300M# show gpon onu uncfg
OnuIndex                 Sn                  State
---------------------------------------------------------------------
gpon-onu_1/3/2:1         ZTEGC6A394D4        unknown
gpon-onu_1/3/3:1         ZICGB370351A        unknown
gpon-onu_1/3/4:8         ZTEGC6A388E1        unknown`
  );
  const [rawStateCli, setRawStateCli] = useState<string>(
    `POP-LEBAK-C300M# show gpon onu state gpon-olt_1/3/2
OnuIndex   Admin State  OMCC State   Phase State  Channel
--------------------------------------------------------------
1/3/2:8    enable       enable       working      1(GPON)
1/3/2:9    enable       disable      LOS          1(GPON)`
  );
  const [rawPowerCli, setRawPowerCli] = useState<string>(
    `POP-LEBAK-C300M# show pon power attenuation gpon-onu_1/3/2:8
           OLT                  ONU              Attenuation
----------------------------------------------------------------
up      Rx :-30.870(dbm)      Tx :2.350(dbm)        33.220(db)
down    Tx :11.026(dbm)       Rx :-23.190(dbm)      34.216(db)`
  );

  // Source Code Viewer state
  const [selectedCodeModuleId, setSelectedCodeModuleId] = useState<string>(
    PRODUCTION_CODE_MODULES[0].fileName
  );
  const [copiedCode, setCopiedCode] = useState(false);

  // Interactive Modals for Auto-Actions (Unconfigured), Add OLT, and Config Mismatches
  const [showAutoActionsModal, setShowAutoActionsModal] = useState(false);
  const [autoAuthEnabled, setAutoAuthEnabled] = useState(true);
  const [autoAuthVlanId, setAutoAuthVlanId] = useState<number>(1);
  const [showAddOltModal, setShowAddOltModal] = useState(false);
  const [newOltName, setNewOltName] = useState('POP SERPONG C320');
  const [newOltIp, setNewOltIp] = useState('172.16.10.2');
  const [newOltModel, setNewOltModel] = useState<'ZTE-C320' | 'ZTE-C300' | 'ZTE-C300M'>('ZTE-C320');
  const [newOltVpn, setNewOltVpn] = useState('POPSERPONG');
  const [showMismatchModal, setShowMismatchModal] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Interactive CRUD state for Settings -> Zones, Sectors, and Splitters
  const [zoneSearch, setZoneSearch] = useState('');
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [editingZone, setEditingZone] = useState<ZoneRecord | null>(null);
  const [zoneFormName, setZoneFormName] = useState('');
  const [zoneFormCode, setZoneFormCode] = useState('');
  const [zoneFormCity, setZoneFormCity] = useState('');
  const [zoneFormDesc, setZoneFormDesc] = useState('');

  const [sectorSearch, setSectorSearch] = useState('');
  const [showSectorModal, setShowSectorModal] = useState(false);
  const [editingSector, setEditingSector] = useState<SectorRecord | null>(null);
  const [sectorFormName, setSectorFormName] = useState('');
  const [sectorFormCode, setSectorFormCode] = useState('');
  const [sectorFormZoneId, setSectorFormZoneId] = useState<number | 'NONE'>('NONE');
  const [sectorFormOltId, setSectorFormOltId] = useState<number | 'NONE'>('NONE');
  const [sectorFormPortId, setSectorFormPortId] = useState<number | 'NONE'>('NONE');
  const [sectorFormDesc, setSectorFormDesc] = useState('');

  const [splitterSearch, setSplitterSearch] = useState('');
  const [showSplitterModal, setShowSplitterModal] = useState(false);
  const [editingSplitter, setEditingSplitter] = useState<OdbRecord | null>(null);
  const [splitterFormName, setSplitterFormName] = useState('');
  const [splitterFormZoneId, setSplitterFormZoneId] = useState<number>(1);
  const [splitterFormSectorId, setSplitterFormSectorId] = useState<number | 'NONE'>('NONE');
  const [splitterFormOltId, setSplitterFormOltId] = useState<number>(1);
  const [splitterFormPortId, setSplitterFormPortId] = useState<number>(1);
  const [splitterFormRatio, setSplitterFormRatio] = useState<
    '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64'
  >('1:8');
  const [splitterFormPole, setSplitterFormPole] = useState('TIANG-01');
  const [splitterFormLat, setSplitterFormLat] = useState('-6.355');
  const [splitterFormLng, setSplitterFormLng] = useState('106.251');
  const [splitterFormDesc, setSplitterFormDesc] = useState('');

  // ISP TR-069 CWMP ACS Configuration state
  const [tr069TargetOltId, setTr069TargetOltId] = useState<number>(1);
  const [showTr069Modal, setShowTr069Modal] = useState<boolean>(false);
  const [editingTr069Profile, setEditingTr069Profile] =
    useState<Tr069ProfileRecord | null>(null);
  const [tr069FormName, setTr069FormName] = useState<string>('');
  const [tr069FormAcsUrl, setTr069FormAcsUrl] = useState<string>(
    'http://10.69.69.1:14501'
  );
  const [tr069FormAcsUser, setTr069FormAcsUser] = useState<string>('acsNet');
  const [tr069FormAcsPass, setTr069FormAcsPass] = useState<string>('acsNet@2024');
  const [tr069FormConnReqUser, setTr069FormConnReqUser] =
    useState<string>('acsNet');
  const [tr069FormConnReqPass, setTr069FormConnReqPass] =
    useState<string>('acsNet@2024');
  const [tr069FormPeriodicInterval, setTr069FormPeriodicInterval] =
    useState<number>(300);
  const [tr069FormMgmtVlanId, setTr069FormMgmtVlanId] = useState<number>(100);
  const [tr069FormPriority, setTr069FormPriority] = useState<number>(2);
  const [tr069FormTcontProfile, setTr069FormTcontProfile] = useState<string>(
    'SMARTOLT-VOIPMNG-10M'
  );
  const [tr069FormTrafficProfile, setTr069FormTrafficProfile] = useState<string>(
    'SMARTOLT-VOIPMNG-10M'
  );
  const [tr069FormVoipEnabled, setTr069FormVoipEnabled] = useState<boolean>(true);
  const [tr069FormSipServer, setTr069FormSipServer] = useState<string>('');
  const [tr069FormDescription, setTr069FormDescription] = useState<string>('');
  const [tr069FormIsDefault, setTr069FormIsDefault] = useState<boolean>(false);
  const [tr069AutoMarkVlan, setTr069AutoMarkVlan] = useState<boolean>(true);

  // ==========================================================================
  // ASIA/JAKARTA (WIB / UTC+7) TIMEZONE FORMATTER & OLT GRAPHS STATE
  // ==========================================================================
  const formatJakartaDateTime = (ms: number = Date.now()): string => {
    const jkt = new Date(ms + 7 * 3600 * 1000);
    const yyyy = jkt.getUTCFullYear();
    const mm = String(jkt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(jkt.getUTCDate()).padStart(2, '0');
    const hh = String(jkt.getUTCHours()).padStart(2, '0');
    const mi = String(jkt.getUTCMinutes()).padStart(2, '0');
    const ss = String(jkt.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  };

  interface OltGraphPoint {
    timestampMs: number;
    label: string;
    shortLabel: string;
    totalMbps?: number;
    downloadMbps: number;
    uploadMbps: number;
    sampleCount: number;
    isLive: boolean;
  }

  interface OltGraphPeriodSeries {
    period: 'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
    intervalLabel: string;
    points: OltGraphPoint[];
    curTotalMbps?: number;
    maxTotalMbps?: number;
    minTotalMbps?: number;
    avgTotalMbps?: number;
    curDownloadMbps: number;
    maxDownloadMbps: number;
    minDownloadMbps?: number;
    avgDownloadMbps: number;
    curUploadMbps: number;
    maxUploadMbps: number;
    minUploadMbps?: number;
    avgUploadMbps: number;
  }

  interface OltInterfaceGraphItem {
    id: number;
    portNumber?: number;
    interfaceName: string;
    interfaceType: 'UPLINK' | 'PON';
    title: string;
    subtitle: string;
    status: string;
    activeOnus: number;
    totalOnus: number;
    periods: {
      Live2h?: OltGraphPeriodSeries;
      Daily: OltGraphPeriodSeries;
      Weekly: OltGraphPeriodSeries;
      Monthly: OltGraphPeriodSeries;
      Yearly: OltGraphPeriodSeries;
    };
  }

  interface OltGraphsPayload {
    oltId: number;
    oltName: string;
    timezone: string;
    polledAtWib: string;
    uplinks: OltInterfaceGraphItem[];
    ponPorts: OltInterfaceGraphItem[];
  }

  const [graphsOltId, setGraphsOltId] = useState<number>(1);
  const [oltGraphsData, setOltGraphsData] = useState<OltGraphsPayload | null>(null);
  const [graphsLoading, setGraphsLoading] = useState<boolean>(false);
  const [graphsPollingLive, setGraphsPollingLive] = useState<boolean>(false);
  const [graphsFilterType, setGraphsFilterType] = useState<'ALL' | 'UPLINK' | 'PON'>('ALL');
  const [graphsShowAllPon, setGraphsShowAllPon] = useState<boolean>(true);
  const [graphsOverviewPeriod, setGraphsOverviewPeriod] = useState<
    'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  >('Live2h');
  const [graphsGridMode, setGraphsGridMode] = useState<'1x1' | '2x1' | '4x1'>('2x1');
  const [selectedGraphInterfaceName, setSelectedGraphInterfaceName] = useState<string | null>(null);
  const [selectedGraphPeriod, setSelectedGraphPeriod] = useState<
    'ALL_PERIODS' | 'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  >('ALL_PERIODS');
  const [jakartaClockStr, setJakartaClockStr] = useState<string>(() =>
    formatJakartaDateTime()
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setJakartaClockStr(formatJakartaDateTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchOltGraphs = async (targetOltId: number) => {
    setGraphsLoading(true);
    try {
      const resp = await fetch(`/api/olts/${targetOltId}/graphs`);
      const json = await resp.json();
      if (json && json.ok) {
        setOltGraphsData(json);
      }
    } catch {
      // Ignore network error
    } finally {
      setGraphsLoading(false);
    }
  };

  const pollOltGraphsLive = async (targetOltId: number, silent = false) => {
    setGraphsPollingLive(true);
    try {
      const resp = await fetch(`/api/olts/${targetOltId}/poll-graphs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(silent ? { 'X-Background-Poll': '1' } : {}),
        },
      });
      const json = await resp.json();
      if (json && json.ok) {
        setOltGraphsData(json);
        if (!silent) {
          showToast(
            json.reachable
              ? `✓ Grafik Uplink & PON OLT diperbarui langsung dari OLT (${json.polledAtWib} WIB)`
              : `Grafik Uplink & PON dimuat (${json.polledAtWib} WIB)`
          );
        }
      }
    } catch {
      // Ignore network error
    } finally {
      setGraphsPollingLive(false);
    }
  };

  useEffect(() => {
    if (activeView !== 'GRAPHS') return;
    const targetId = graphsOltId || selectedOltId || 1;
    void fetchOltGraphs(targetId);
    void pollOltGraphsLive(targetId, true);

    const interval = setInterval(() => {
      void pollOltGraphsLive(targetId, true);
    }, 15000);
    return () => clearInterval(interval);
  }, [activeView, graphsOltId, selectedOltId]);

  // Quick-add helpers shared between Settings -> Zones/Sectors/Splitters, OnuDetailView & AuthorizeOnuModal
  const handleQuickAddZone = (zoneInput: Omit<ZoneRecord, 'id'>): ZoneRecord => {
    const nextId = Math.max(0, ...db.zones.map((z) => z.id)) + 1;
    const created: ZoneRecord = { ...zoneInput, id: nextId };
    nextSyncIsUserMutationRef.current = true;
    lastUserMutationAtRef.current = Date.now();
    setDb((prev) => ({
      ...prev,
      zones: [...prev.zones, created],
      users: (prev.users || []).map((u) =>
        u.id === loggedInUserId && !u.access_all_zones
          ? {
              ...u,
              allowed_zone_ids: Array.from(
                new Set([...(u.allowed_zone_ids || []), nextId])
              ),
            }
          : u
      ),
    }));
    showToast(`✓ Zone "${created.name}" berhasil ditambahkan dan tersinkronisasi!`);
    return created;
  };

  const handleQuickAddSector = (
    sectorInput: Omit<SectorRecord, 'id'>
  ): SectorRecord => {
    const currentSectors = db.sectors || [];
    const nextId = Math.max(0, ...currentSectors.map((s) => s.id)) + 1;
    const created: SectorRecord = { ...sectorInput, id: nextId };
    nextSyncIsUserMutationRef.current = true;
    lastUserMutationAtRef.current = Date.now();
    setDb((prev) => ({
      ...prev,
      sectors: [...(prev.sectors || []), created],
      users: (prev.users || []).map((u) =>
        u.id === loggedInUserId && !u.access_all_rks
          ? {
              ...u,
              allowed_sector_ids: Array.from(
                new Set([...(u.allowed_sector_ids || []), nextId])
              ),
            }
          : u
      ),
    }));
    showToast(
      `✓ Sector "${created.name}" berhasil ditambahkan dan tersinkronisasi!`
    );
    return created;
  };

  const handleQuickAddSplitter = (
    odbInput: Omit<OdbRecord, 'id'>
  ): OdbRecord => {
    const nextId = Math.max(0, ...db.odbs.map((o) => o.id)) + 1;
    const created: OdbRecord = { ...odbInput, id: nextId };
    nextSyncIsUserMutationRef.current = true;
    lastUserMutationAtRef.current = Date.now();
    setDb((prev) => ({
      ...prev,
      odbs: [...prev.odbs, created],
      users: (prev.users || []).map((u) =>
        u.id === loggedInUserId && !u.access_all_rks
          ? {
              ...u,
              allowed_odb_ids: Array.from(
                new Set([...(u.allowed_odb_ids || []), nextId])
              ),
            }
          : u
      ),
    }));
    showToast(
      `✓ Splitter / ODP "${created.name}" (${created.splitter_ratio}) berhasil ditambahkan dan tersinkronisasi!`
    );
    return created;
  };

  // ==========================================================================
  // LOGIN & USER MANAGEMENT STATE (SERVER SESSION + OLT, ZONE & RK ACCESS)
  // ==========================================================================
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);

  const [userSearch, setUserSearch] = useState<string>('');
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<AppUserRecord | null>(null);
  const [userFormUsername, setUserFormUsername] = useState<string>('');
  const [userFormFullName, setUserFormFullName] = useState<string>('');
  const [userFormEmail, setUserFormEmail] = useState<string>('');
  const [userFormPassword, setUserFormPassword] = useState<string>('');
  const [userFormRole, setUserFormRole] = useState<
    'ADMIN' | 'OPERATOR' | 'TECHNICIAN' | 'VIEWER'
  >('OPERATOR');
  const [userFormActive, setUserFormActive] = useState<boolean>(true);
  const [userFormAllOlts, setUserFormAllOlts] = useState<boolean>(false);
  const [userFormOltIds, setUserFormOltIds] = useState<number[]>([]);
  const [userFormAllZones, setUserFormAllZones] = useState<boolean>(false);
  const [userFormZoneIds, setUserFormZoneIds] = useState<number[]>([]);
  const [userFormAllRks, setUserFormAllRks] = useState<boolean>(false);
  const [userFormSectorIds, setUserFormSectorIds] = useState<number[]>([]);
  const [userFormOdbIds, setUserFormOdbIds] = useState<number[]>([]);

  // Change Password State (Available for ALL User Roles: ADMIN, OPERATOR, TECHNICIAN, VIEWER)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState<boolean>(false);
  const [changePwdTargetUser, setChangePwdTargetUser] = useState<AppUserRecord | null>(null);
  const [currentPwdInput, setCurrentPwdInput] = useState<string>('');
  const [newPwdInput, setNewPwdInput] = useState<string>('');
  const [confirmPwdInput, setConfirmPwdInput] = useState<string>('');
  const [showChangePwdText, setShowChangePwdText] = useState<boolean>(false);
  const [changePwdError, setChangePwdError] = useState<string | null>(null);
  const [changePwdLoading, setChangePwdLoading] = useState<boolean>(false);

  const appUsers: AppUserRecord[] =
    Array.isArray(db.users) && db.users.length > 0
      ? db.users
      : DEFAULT_APP_USERS;

  const currentUser: AppUserRecord | null =
    loggedInUserId !== null
      ? appUsers.find((u) => u.id === loggedInUserId && u.is_active) ||
        (authenticatedUser &&
        authenticatedUser.id === loggedInUserId &&
        authenticatedUser.is_active
          ? authenticatedUser
          : null)
      : null;

  const isAdminUser = currentUser?.role === 'ADMIN';
  const isViewerUser = currentUser?.role === 'VIEWER';

  const forceClientLogout = (reasonMsg?: string) => {
    clearLastActivityTimestamp();
    try {
      window.sessionStorage.removeItem(AUTH_SESSION_TOKEN_KEY);
      window.localStorage.removeItem(LEGACY_AUTH_USER_ID_KEY);
    } catch {
      // Ignore
    }
    setIdleRemainingMs(IDLE_SESSION_TIMEOUT_MS);
    setAuthenticatedUser(null);
    setLoggedInUserId(null);
    setSessionTokenId(null);
    setDbLoaded(false);
    setOpenDropdown(null);
    setAuthorizingOnu(null);
    setUpdatingModeOnu(null);
    if (reasonMsg) {
      setLoginError(reasonMsg);
    }
    try {
      window.history.replaceState({ smartOltLoginGuard: true }, '', '#/login');
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      forceClientLogout('Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.');
    });
    return () => {
      setOnUnauthorizedHandler(null);
    };
  }, []);

  const handleExtendActiveSession = async () => {
    const now = touchUserActivityTimestamp();
    lastKeepaliveSentAtRef.current = now;
    setIdleRemainingMs(IDLE_SESSION_TIMEOUT_MS);
    try {
      await fetch('/api/auth/keepalive', { method: 'POST' });
    } catch {
      // ignore transient error
    }
  };

  // Periodic server session check & 30-minute idle auto-logout enforcement
  useEffect(() => {
    if (!loggedInUserId) return;

    let lastActivityAt = readLastActivityTimestamp() || touchUserActivityTimestamp();
    let lastStorageWriteAt = lastActivityAt;
    let lastServerCheckAt = 0;
    let loggingOut = false;

    const triggerIdleLogout = async () => {
      if (loggingOut) return;
      loggingOut = true;
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // ignore
      }
      forceClientLogout(
        'Sesi berakhir otomatis karena tidak ada aktivitas selama 30 menit.'
      );
    };

    const recordActivity = () => {
      const now = Date.now();
      // If user already exceeded idle limit while browser/tab was suspended, enforce logout immediately
      if (now - lastActivityAt >= IDLE_SESSION_TIMEOUT_MS) {
        void triggerIdleLogout();
        return;
      }
      lastActivityAt = now;
      if (now - lastStorageWriteAt >= 2000) {
        lastStorageWriteAt = now;
        touchUserActivityTimestamp(now);
      }
      setIdleRemainingMs(IDLE_SESSION_TIMEOUT_MS);
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const persisted = readLastActivityTimestamp();
      if (persisted && persisted > lastActivityAt) {
        lastActivityAt = persisted;
      }
      const elapsed = Date.now() - lastActivityAt;
      if (elapsed >= IDLE_SESSION_TIMEOUT_MS) {
        void triggerIdleLogout();
      } else {
        setIdleRemainingMs(Math.max(0, IDLE_SESSION_TIMEOUT_MS - elapsed));
      }
    };

    window.addEventListener('mousemove', recordActivity, { passive: true });
    window.addEventListener('mousedown', recordActivity, { passive: true });
    window.addEventListener('pointerdown', recordActivity, { passive: true });
    window.addEventListener('keydown', recordActivity, { passive: true });
    window.addEventListener('scroll', recordActivity, { passive: true });
    window.addEventListener('wheel', recordActivity, { passive: true });
    window.addEventListener('touchstart', recordActivity, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    const interval = setInterval(async () => {
      const now = Date.now();
      const persisted = readLastActivityTimestamp();
      if (persisted && persisted > lastActivityAt) {
        lastActivityAt = persisted;
      }

      const elapsed = now - lastActivityAt;
      const remaining = Math.max(0, IDLE_SESSION_TIMEOUT_MS - elapsed);
      setIdleRemainingMs(remaining);

      if (elapsed >= IDLE_SESSION_TIMEOUT_MS) {
        await triggerIdleLogout();
        return;
      }

      // Sync recent real user activity to server once every 60s so server-side 30m TTL stays aligned
      if (
        lastActivityAt > lastKeepaliveSentAtRef.current &&
        now - lastKeepaliveSentAtRef.current >= 60_000
      ) {
        lastKeepaliveSentAtRef.current = now;
        try {
          const kaResp = await fetch('/api/auth/keepalive', { method: 'POST' });
          if (kaResp.status === 401) {
            forceClientLogout(
              'Sesi berakhir otomatis karena tidak ada aktivitas selama 30 menit.'
            );
            return;
          }
        } catch {
          // ignore transient network error
        }
      }

      // Verify session status every 30s without sliding server idle timer
      if (now - lastServerCheckAt >= 30_000) {
        lastServerCheckAt = now;
        try {
          const resp = await fetch('/api/auth/session');
          if (!resp.ok) {
            forceClientLogout(
              'Sesi berakhir otomatis karena tidak ada aktivitas atau telah kadaluarsa.'
            );
            return;
          }
          const data = await resp.json();
          if (!data || !data.authenticated || !data.user) {
            forceClientLogout(
              'Sesi login Anda tidak lagi aktif. Silakan login kembali.'
            );
          } else {
            setAuthenticatedUser(data.user);
            setSessionTokenId(data.sessionId || null);
          }
        } catch {
          // ignore transient network glitch
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousemove', recordActivity);
      window.removeEventListener('mousedown', recordActivity);
      window.removeEventListener('pointerdown', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      window.removeEventListener('scroll', recordActivity);
      window.removeEventListener('wheel', recordActivity);
      window.removeEventListener('touchstart', recordActivity);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [loggedInUserId]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok || !data.user || !data.token) {
        setLoginError(
          data?.error || 'Username/Email atau Password tidak sesuai.'
        );
        return;
      }

      try {
        window.sessionStorage.setItem(AUTH_SESSION_TOKEN_KEY, data.token);
        window.localStorage.removeItem(LEGACY_AUTH_USER_ID_KEY);
      } catch {
        // Ignore
      }
      const now = touchUserActivityTimestamp();
      lastKeepaliveSentAtRef.current = now;
      setIdleRemainingMs(IDLE_SESSION_TIMEOUT_MS);

      setAuthenticatedUser(data.user);
      setLoggedInUserId(data.user.id);
      setSessionTokenId(data.sessionId || null);
      setLoginPassword('');
      setActiveView('DASHBOARD');

      await loadAuthorizedDatabaseState();

      const nowWib = formatJakartaDateTime();
      showToast(
        `✓ Selamat datang, ${data.user.full_name} (${data.user.role}) — Sesi #${data.sessionId || 'AKTIF'} (${nowWib} WIB)`
      );
    } catch {
      setLoginError('Gagal terhubung ke server autentikasi. Coba lagi.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network error
    }
    forceClientLogout();
  };

  const openChangePasswordModal = (targetUser?: AppUserRecord) => {
    setChangePwdTargetUser(targetUser || currentUser);
    setCurrentPwdInput('');
    setNewPwdInput('');
    setConfirmPwdInput('');
    setShowChangePwdText(false);
    setChangePwdError(null);
    setShowChangePasswordModal(true);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setChangePwdError(null);

    const target = changePwdTargetUser || currentUser;
    const isSelf = target.id === currentUser.id;

    if (isSelf && !currentPwdInput) {
      setChangePwdError('Password saat ini wajib diisi.');
      return;
    }
    if (newPwdInput.length < 6) {
      setChangePwdError('Password baru minimal harus 6 karakter.');
      return;
    }
    if (newPwdInput !== confirmPwdInput) {
      setChangePwdError('Konfirmasi password baru tidak cocok.');
      return;
    }

    setChangePwdLoading(true);
    try {
      const resp = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: target.id,
          currentPassword: isSelf ? currentPwdInput : undefined,
          newPassword: newPwdInput,
          confirmPassword: confirmPwdInput,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok) {
        setChangePwdError(data?.error || 'Gagal memperbarui password.');
        return;
      }

      if (data.user && isSelf) {
        setAuthenticatedUser(data.user);
      }

      setShowChangePasswordModal(false);
      setCurrentPwdInput('');
      setNewPwdInput('');
      setConfirmPwdInput('');
      showToast(
        `✓ ${data.message || 'Password berhasil diperbarui!'}`
      );
    } catch {
      setChangePwdError('Gagal terhubung ke server. Silakan coba lagi.');
    } finally {
      setChangePwdLoading(false);
    }
  };

  const handleAdminSwitchUser = async (targetUser: AppUserRecord) => {
    try {
      const resp = await fetch('/api/auth/switch-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: targetUser.id }),
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok || !data.user || !data.token) {
        showToast(data?.error || 'Gagal beralih sesi user.');
        return;
      }
      try {
        window.sessionStorage.setItem(AUTH_SESSION_TOKEN_KEY, data.token);
      } catch {
        // Ignore
      }
      const now = touchUserActivityTimestamp();
      lastKeepaliveSentAtRef.current = now;
      setIdleRemainingMs(IDLE_SESSION_TIMEOUT_MS);
      setAuthenticatedUser(data.user);
      setLoggedInUserId(data.user.id);
      setSessionTokenId(data.sessionId || null);
      setActiveView('DASHBOARD');
      await loadAuthorizedDatabaseState();
      showToast(
        `✓ Sesi beralih ke "${data.user.username}" (${data.user.role}) — menampilkan OLT, Zone & RK sesuai hak akses user ini.`
      );
    } catch {
      showToast('Gagal menghubungi server untuk Switch User.');
    }
  };

  // ==========================================================================
  // BACKUP & RESTORE STATE & HANDLERS
  // ==========================================================================
  interface BackupSnapshotMeta {
    id: number;
    label: string;
    created_by: string;
    created_at_wib: string;
    created_at_ms: number;
    olts_count: number;
    onus_count: number;
    zones_count: number;
    rks_count: number;
    users_count: number;
    size_bytes: number;
  }

  const [showBackupModal, setShowBackupModal] = useState<boolean>(false);

  // Dynamic Brand / Company Name State (persisted in localStorage)
  const [appBrandName, setAppBrandName] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem('smartolt_brand_name_v1');
      return saved && saved.trim() ? saved.trim() : 'JETCYBERNET';
    } catch {
      return 'JETCYBERNET';
    }
  });
  const [showEditBrandModal, setShowEditBrandModal] = useState<boolean>(false);
  const [brandNameDraft, setBrandNameDraft] = useState<string>(appBrandName);

  const openEditBrandModal = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isViewerUser) return;
    setBrandNameDraft(appBrandName);
    setShowEditBrandModal(true);
  };

  const handleSaveBrandName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = brandNameDraft.trim() || 'JETCYBERNET';
    setAppBrandName(cleaned);
    try {
      window.localStorage.setItem('smartolt_brand_name_v1', cleaned);
    } catch {
      // Ignore storage error
    }
    setShowEditBrandModal(false);
    showToast(`✓ Nama brand aplikasi berhasil diubah menjadi "${cleaned}".`);
  };

  // ==========================================================================
  // SPEED PROFILES & ONU TYPES STATE & OLT LIVE PUSH HANDLERS
  // ==========================================================================
  const [speedPushTargetOltId, setSpeedPushTargetOltId] = useState<string>('ALL');
  const [speedPushBusy, setSpeedPushBusy] = useState<boolean>(false);

  // Add Speed Profile Modal State
  const [showAddSpeedModal, setShowAddSpeedModal] = useState<boolean>(false);
  const [newSpeedName, setNewSpeedName] = useState<string>('SMARTOLT-100M-DOWN');
  const [newSpeedDownloadKbps, setNewSpeedDownloadKbps] = useState<number>(102400);
  const [newSpeedUploadKbps, setNewSpeedUploadKbps] = useState<number>(102400);
  const [newSpeedCirKbps, setNewSpeedCirKbps] = useState<number>(102400);
  const [newSpeedCbsBytes, setNewSpeedCbsBytes] = useState<number>(1023);
  const [newSpeedPbsBytes, setNewSpeedPbsBytes] = useState<number>(1023);
  const [newSpeedTcontMode, setNewSpeedTcontMode] = useState<'AUTO_CREATE' | 'EXISTING'>('AUTO_CREATE');
  const [newSpeedTcontId, setNewSpeedTcontId] = useState<number>(1);
  const [newTcontName, setNewTcontName] = useState<string>('SMARTOLT-100M-UP');
  const [newTcontDbaType, setNewTcontDbaType] = useState<1 | 2 | 3 | 4 | 5>(4);
  const [newTcontFixedKbps, setNewTcontFixedKbps] = useState<number>(0);
  const [newTcontAssuredKbps, setNewTcontAssuredKbps] = useState<number>(10240);
  const [newTcontMaxKbps, setNewTcontMaxKbps] = useState<number>(102400);

  // Add ONU Type Modal State
  const [showAddOnuTypeModal, setShowAddOnuTypeModal] = useState<boolean>(false);
  const [newOnuTypeName, setNewOnuTypeName] = useState<string>('ZTE-F670LV9');
  const [newOnuTypePon, setNewOnuTypePon] = useState<'gpon' | 'xgpon'>('gpon');
  const [newOnuTypeDesc, setNewOnuTypeDesc] = useState<string>('4GE+1POTS+2WIFI');
  const [newOnuTypeEth, setNewOnuTypeEth] = useState<number>(4);
  const [newOnuTypePots, setNewOnuTypePots] = useState<number>(1);
  const [newOnuTypeWifi, setNewOnuTypeWifi] = useState<number>(2);
  const [newOnuTypeMaxTcont, setNewOnuTypeMaxTcont] = useState<number>(8);
  const [newOnuTypeMaxGemport, setNewOnuTypeMaxGemport] = useState<number>(32);
  const [newOnuTypeMaxSwitch, setNewOnuTypeMaxSwitch] = useState<number>(8);
  const [newOnuTypeMaxFlow, setNewOnuTypeMaxFlow] = useState<number>(8);
  const [newOnuTypeMaxIphost, setNewOnuTypeMaxIphost] = useState<number>(5);

  const buildTcontCliLine = (tcont: {
    profile_name: string;
    dba_type: 1 | 2 | 3 | 4 | 5;
    fixed_kbps: number;
    assured_kbps: number;
    maximum_kbps: number;
  }): string => {
    const cleanName = tcont.profile_name.trim().replace(/\s+/g, '-');
    if (tcont.dba_type === 1) {
      return `profile tcont ${cleanName} type 1 fixed ${tcont.fixed_kbps}`;
    }
    if (tcont.dba_type === 2 || tcont.dba_type === 3) {
      return `profile tcont ${cleanName} type ${tcont.dba_type} assured ${tcont.assured_kbps} maximum ${tcont.maximum_kbps}`;
    }
    if (tcont.dba_type === 4) {
      return `profile tcont ${cleanName} type 4 maximum ${tcont.maximum_kbps}`;
    }
    return `profile tcont ${cleanName} type 5 fixed ${tcont.fixed_kbps} assured ${tcont.assured_kbps} maximum ${tcont.maximum_kbps}`;
  };

  const buildSpeedProfileCliScript = (
    speed: {
      profile_name: string;
      cir_kbps: number;
      download_kbps: number;
      cbs_bytes: number;
      pbs_bytes: number;
    },
    tcont?: {
      profile_name: string;
      dba_type: 1 | 2 | 3 | 4 | 5;
      fixed_kbps: number;
      assured_kbps: number;
      maximum_kbps: number;
    } | null
  ): string => {
    const cleanSpeedName = speed.profile_name.trim().replace(/\s+/g, '-');
    const lines: string[] = ['configure terminal', 'gpon'];
    if (tcont) {
      lines.push(`  ${buildTcontCliLine(tcont)}`);
    }
    lines.push(
      `  profile traffic ${cleanSpeedName} sir ${speed.cir_kbps} pir ${speed.download_kbps} cbs ${speed.cbs_bytes} pbs ${speed.pbs_bytes}`,
      'exit',
      'exit',
      'write'
    );
    return lines.join('\n');
  };

  const buildOnuTypeCliScript = (onuType: {
    type_name: string;
    pon_type: 'gpon' | 'xgpon';
    description: string;
    eth_ports: number;
    pots_ports: number;
    wifi_ports: number;
    max_tcont: number;
    max_gemport: number;
    max_switch_perslot: number;
    max_flow_perswitch: number;
    max_iphost: number;
  }): string => {
    const name = onuType.type_name.trim().replace(/\s+/g, '_');
    const pon = onuType.pon_type || 'gpon';
    const desc = (onuType.description || `${onuType.eth_ports}GE+${onuType.pots_ports}POTS+${onuType.wifi_ports}WIFI`)
      .trim()
      .replace(/\s+/g, '_');
    const lines: string[] = [
      'configure terminal',
      'pon',
      `  onu-type ${name} ${pon} description ${desc}`,
      `  onu-type ${name} ${pon} max-tcont ${onuType.max_tcont}`,
      `  onu-type ${name} ${pon} max-gemport ${onuType.max_gemport}`,
      `  onu-type ${name} ${pon} max-switch-perslot ${onuType.max_switch_perslot}`,
      `  onu-type ${name} ${pon} max-flow-perswitch ${onuType.max_flow_perswitch}`,
      `  onu-type ${name} ${pon} max-iphost ${onuType.max_iphost}`,
    ];
    for (let i = 1; i <= Math.max(0, onuType.eth_ports); i++) {
      lines.push(`  onu-type-if ${name} eth_0/${i}`);
    }
    for (let i = 1; i <= Math.max(0, onuType.pots_ports); i++) {
      lines.push(`  onu-type-if ${name} pots_0/${i}`);
    }
    for (let i = 1; i <= Math.max(0, onuType.wifi_ports); i++) {
      lines.push(`  onu-type-if ${name} wifi_0/${i}`);
    }
    lines.push('exit', 'exit', 'write');
    return lines.join('\n');
  };

  const pushProfileCliToTargetOlts = async (
    cliScript: string,
    summaryLabel: string
  ) => {
    const targetOlts =
      speedPushTargetOltId === 'ALL'
        ? visibleOlts
        : visibleOlts.filter((o) => o.id === Number(speedPushTargetOltId));

    if (targetOlts.length === 0) {
      showToast(
        `✓ ${summaryLabel} disimpan ke Database (Tambahkan OLT terlebih dahulu untuk push via Telnet/SSH).`
      );
      return;
    }

    setSpeedPushBusy(true);
    try {
      for (const olt of targetOlts) {
        const logId = Date.now() + olt.id;
        const newLog: ProvisioningLogRecord = {
          id: logId,
          olt_id: olt.id,
          onu_id: null,
          serial_number: 'OLT-PROFILE',
          action_type: 'RESYNC_CONFIG',
          interface_target: `${olt.name} (${olt.ip_address})`,
          summary_text: `${summaryLabel} -> ${olt.name}`,
          cli_script: cliScript,
          olt_response: '[Pushing CLI to OLT via Telnet/SSH...]',
          execution_status: 'SIMULATED',
          executed_by: currentUser?.email || 'admin@jetcybernet.id',
          duration_ms: 0,
          created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        };
        setDb((prev) => ({
          ...prev,
          provisioning_logs: [newLog, ...prev.provisioning_logs],
        }));
        await executeOltCliLive(
          olt.id,
          cliScript,
          logId,
          `${summaryLabel} (${olt.name})`
        );
      }
    } finally {
      setSpeedPushBusy(false);
    }
  };

  const handleCreateAndPushSpeedProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newSpeedName.trim().replace(/\s+/g, '-');
    if (!cleanName) return;

    let resolvedTcontId = newSpeedTcontId;
    let tcontForCli: TcontProfileRecord | null = null;

    if (newSpeedTcontMode === 'AUTO_CREATE') {
      const cleanTcontName =
        newTcontName.trim().replace(/\s+/g, '-') || `${cleanName}-UP`;
      const existingTcont = db.tcont_profiles.find(
        (t) => t.profile_name.toLowerCase() === cleanTcontName.toLowerCase()
      );
      const tcontDesc = buildTcontCliLine({
        profile_name: cleanTcontName,
        dba_type: newTcontDbaType,
        fixed_kbps: newTcontFixedKbps,
        assured_kbps: newTcontAssuredKbps,
        maximum_kbps: newTcontMaxKbps,
      });

      if (existingTcont) {
        resolvedTcontId = existingTcont.id;
        tcontForCli = {
          ...existingTcont,
          dba_type: newTcontDbaType,
          fixed_kbps: newTcontFixedKbps,
          assured_kbps: newTcontAssuredKbps,
          maximum_kbps: newTcontMaxKbps,
          description: tcontDesc,
        };
      } else {
        resolvedTcontId = Date.now() - 1;
        tcontForCli = {
          id: resolvedTcontId,
          profile_name: cleanTcontName,
          dba_type: newTcontDbaType,
          fixed_kbps: newTcontFixedKbps,
          assured_kbps: newTcontAssuredKbps,
          maximum_kbps: newTcontMaxKbps,
          description: tcontDesc,
        };
      }
    } else {
      tcontForCli =
        db.tcont_profiles.find((t) => t.id === Number(newSpeedTcontId)) ||
        db.tcont_profiles[0] ||
        null;
      if (tcontForCli) {
        resolvedTcontId = tcontForCli.id;
      }
    }

    const newSpeedRecord: SpeedProfileRecord = {
      id: Date.now(),
      profile_name: cleanName,
      download_kbps: Math.max(64, Number(newSpeedDownloadKbps) || 102400),
      upload_kbps: Math.max(64, Number(newSpeedUploadKbps) || 102400),
      cir_kbps: Math.max(64, Number(newSpeedCirKbps) || Number(newSpeedDownloadKbps) || 102400),
      cbs_bytes: Math.max(64, Number(newSpeedCbsBytes) || 1023),
      pbs_bytes: Math.max(64, Number(newSpeedPbsBytes) || 1023),
      tcont_profile_id: resolvedTcontId,
    };

    setDb((prev) => {
      const nextTconts =
        tcontForCli && newSpeedTcontMode === 'AUTO_CREATE'
          ? prev.tcont_profiles.some((t) => t.id === tcontForCli!.id)
            ? prev.tcont_profiles.map((t) =>
                t.id === tcontForCli!.id ? tcontForCli! : t
              )
            : [...prev.tcont_profiles, tcontForCli]
          : prev.tcont_profiles;

      const existsSpeed = prev.speed_profiles.some(
        (s) => s.profile_name.toLowerCase() === cleanName.toLowerCase()
      );
      const nextSpeeds = existsSpeed
        ? prev.speed_profiles.map((s) =>
            s.profile_name.toLowerCase() === cleanName.toLowerCase()
              ? { ...newSpeedRecord, id: s.id }
              : s
          )
        : [...prev.speed_profiles, newSpeedRecord];

      return {
        ...prev,
        tcont_profiles: nextTconts,
        speed_profiles: nextSpeeds,
      };
    });

    setShowAddSpeedModal(false);
    const cliScript = buildSpeedProfileCliScript(newSpeedRecord, tcontForCli);
    await pushProfileCliToTargetOlts(
      cliScript,
      `Speed Profile "${cleanName}"`
    );
  };

  const handleCreateAndPushOnuType = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTypeName = newOnuTypeName.trim().replace(/\s+/g, '_');
    if (!cleanTypeName) return;

    const newRecord: OnuTypeRecord = {
      id: Date.now(),
      type_name: cleanTypeName,
      pon_type: newOnuTypePon,
      description:
        newOnuTypeDesc.trim() ||
        `${newOnuTypeEth}GE+${newOnuTypePots}POTS+${newOnuTypeWifi}WIFI`,
      eth_ports: Math.max(0, Number(newOnuTypeEth) || 4),
      pots_ports: Math.max(0, Number(newOnuTypePots) || 0),
      wifi_ports: Math.max(0, Number(newOnuTypeWifi) || 0),
      max_tcont: Math.max(1, Number(newOnuTypeMaxTcont) || 8),
      max_gemport: Math.max(1, Number(newOnuTypeMaxGemport) || 32),
      max_switch_perslot: Math.max(1, Number(newOnuTypeMaxSwitch) || 8),
      max_flow_perswitch: Math.max(1, Number(newOnuTypeMaxFlow) || 8),
      max_iphost: Math.max(1, Number(newOnuTypeMaxIphost) || 5),
    };

    setDb((prev) => {
      const currentList =
        prev.onu_types && prev.onu_types.length > 0
          ? prev.onu_types
          : INITIAL_DB_STATE.onu_types || [];
      const exists = currentList.some(
        (t) => t.type_name.toLowerCase() === cleanTypeName.toLowerCase()
      );
      const nextList = exists
        ? currentList.map((t) =>
            t.type_name.toLowerCase() === cleanTypeName.toLowerCase()
              ? { ...newRecord, id: t.id }
              : t
          )
        : [...currentList, newRecord];
      return {
        ...prev,
        onu_types: nextList,
      };
    });

    setShowAddOnuTypeModal(false);
    const cliScript = buildOnuTypeCliScript(newRecord);
    await pushProfileCliToTargetOlts(cliScript, `ONU Type "${cleanTypeName}"`);
  };
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshotMeta[]>([]);
  const [backupSnapshotLabel, setBackupSnapshotLabel] = useState<string>('');
  const [backupBusy, setBackupBusy] = useState<boolean>(false);
  const [restoreMode, setRestoreMode] = useState<'OVERWRITE' | 'MERGE'>('OVERWRITE');
  const [uploadedBackupState, setUploadedBackupState] =
    useState<SmartOltDatabaseState | null>(null);
  const [uploadedBackupFileName, setUploadedBackupFileName] =
    useState<string>('');
  const [uploadedBackupMeta, setUploadedBackupMeta] = useState<{
    exportedAtWib?: string;
    label?: string;
  } | null>(null);

  // Google Drive State & Handlers
  const [driveUser, setDriveUser] = useState<FirebaseUser | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean>(false);
  const [driveFiles, setDriveFiles] = useState<GoogleDriveBackupFile[]>([]);
  const [driveBusy, setDriveBusy] = useState<boolean>(false);
  const [driveDeleteConfirmFile, setDriveDeleteConfirmFile] =
    useState<GoogleDriveBackupFile | null>(null);

  useEffect(() => {
    const unsubscribe = initGoogleDriveAuth((user, hasToken) => {
      setDriveUser(user);
      setDriveConnected(Boolean(user && hasToken));
    });
    return () => unsubscribe();
  }, []);

  const handleLoadDriveBackups = async () => {
    setDriveBusy(true);
    try {
      const files = await listGoogleDriveBackups();
      setDriveFiles(files);
      setDriveConnected(true);
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Google Drive: ${err.message}`
          : 'Gagal memuat daftar file dari Google Drive.'
      );
    } finally {
      setDriveBusy(false);
    }
  };

  const handleConnectGoogleDrive = async () => {
    setDriveBusy(true);
    try {
      const { user, accessToken } = await googleSignIn();
      setDriveUser(user);
      setDriveConnected(Boolean(accessToken));
      const files = await listGoogleDriveBackups();
      setDriveFiles(files);
      showToast(
        `✓ Terhubung ke Google Drive (${user.email || user.displayName || 'Google Account'}).`
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Gagal login Google Drive: ${err.message}`
          : 'Login Google Drive dibatalkan.'
      );
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDisconnectGoogleDrive = async () => {
    await googleLogout();
    setDriveUser(null);
    setDriveConnected(false);
    setDriveFiles([]);
    showToast('Akun Google Drive telah diputuskan.');
  };

  const handleUploadFullBackupToDrive = async () => {
    setDriveBusy(true);
    try {
      const nowWib = formatJakartaDateTime();
      const safeStamp = nowWib.replace(/[:\s]/g, '-');
      const fileName = `jetcybernet-smartolt-backup-${safeStamp}.json`;
      const payload = {
        app: 'JETCYBERNET-SMARTOLT',
        version: '2.4',
        exportedAtWib: `${nowWib} WIB`,
        exportedBy: currentUser?.username || 'admin',
        summary: {
          olts: db.olts.length,
          onus: db.onus.length,
          zones: db.zones.length,
          sectors: (db.sectors || []).length,
          odbs: db.odbs.length,
          vlans: db.vlans.length,
          users: (db.users || []).length,
        },
        state: db,
      };
      await uploadFileToGoogleDrive(
        fileName,
        JSON.stringify(payload, null, 2),
        'application/json'
      );
      const files = await listGoogleDriveBackups();
      setDriveFiles(files);
      setDriveConnected(true);
      showToast(`✓ Backup "${fileName}" berhasil disimpan ke Google Drive!`);
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Gagal upload ke Google Drive: ${err.message}`
          : 'Gagal menyimpan backup ke Google Drive.'
      );
    } finally {
      setDriveBusy(false);
    }
  };

  const handleUploadOltCfgToDrive = async (olt: OltRecord) => {
    setDriveBusy(true);
    try {
      const nowWib = formatJakartaDateTime();
      const safeStamp = nowWib.replace(/[:\s]/g, '-');
      const safeName = olt.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const fileName = `olt-${safeName}-running-config-${safeStamp}.cfg`;
      const cliText = buildLiveZteRunningConfig(db, olt.id);
      await uploadFileToGoogleDrive(fileName, cliText, 'text/plain');
      const files = await listGoogleDriveBackups();
      setDriveFiles(files);
      setDriveConnected(true);
      showToast(`✓ Config CLI "${fileName}" disimpan ke Google Drive!`);
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Gagal upload .cfg ke Google Drive: ${err.message}`
          : 'Gagal upload .cfg ke Google Drive.'
      );
    } finally {
      setDriveBusy(false);
    }
  };

  const handleSelectDriveBackupForRestore = async (
    file: GoogleDriveBackupFile
  ) => {
    setDriveBusy(true);
    try {
      const rawText = await downloadGoogleDriveFileText(file.id);
      const raw = JSON.parse(rawText);
      const candidateState: SmartOltDatabaseState | null =
        raw && raw.state && Array.isArray(raw.state.olts)
          ? raw.state
          : raw && Array.isArray(raw.olts)
          ? raw
          : null;
      if (!candidateState) {
        showToast(
          '✗ File Google Drive bukan backup JSON database OLT/ONU yang valid.'
        );
        return;
      }
      setUploadedBackupState(candidateState);
      setUploadedBackupFileName(`[Google Drive] ${file.name}`);
      setUploadedBackupMeta({
        exportedAtWib: raw.exportedAtWib || file.modifiedTime || undefined,
        label: raw.label || undefined,
      });
      showToast(
        `✓ File Drive "${file.name}" dimuat (${candidateState.olts.length} OLT, ${
          candidateState.onus?.length || 0
        } ONU). Klik "Jalankan Restore Sekarang" untuk menerapkan.`
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Gagal membaca file dari Google Drive: ${err.message}`
          : 'Gagal mengunduh file dari Google Drive.'
      );
    } finally {
      setDriveBusy(false);
    }
  };

  const handleConfirmDeleteDriveFile = async () => {
    if (!driveDeleteConfirmFile) return;
    const target = driveDeleteConfirmFile;
    setDriveBusy(true);
    try {
      await deleteGoogleDriveFile(target.id);
      setDriveDeleteConfirmFile(null);
      const files = await listGoogleDriveBackups();
      setDriveFiles(files);
      showToast(`✓ File "${target.name}" dihapus dari Google Drive.`);
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Gagal menghapus file Drive: ${err.message}`
          : 'Gagal menghapus file dari Google Drive.'
      );
    } finally {
      setDriveBusy(false);
    }
  };

  // Configured ONU Table Sorting State
  type ConfiguredSortField =
    | 'NONE'
    | 'STATUS'
    | 'NAME'
    | 'SN'
    | 'OLT'
    | 'BOARD'
    | 'PORT'
    | 'ZONE'
    | 'SPLITTER'
    | 'SIGNAL'
    | 'MODE'
    | 'VLAN'
    | 'METHOD'
    | 'TYPE'
    | 'AUTH_DATE';

  const [configuredSortField, setConfiguredSortField] =
    useState<ConfiguredSortField>('NONE');
  const [configuredSortDir, setConfiguredSortDir] = useState<'asc' | 'desc'>(
    'asc'
  );

  const handleToggleConfiguredSort = (field: ConfiguredSortField) => {
    setConfiguredOnusPage(1);
    if (configuredSortField === field) {
      if (configuredSortDir === 'asc') {
        setConfiguredSortDir('desc');
      } else {
        setConfiguredSortField('NONE');
        setConfiguredSortDir('asc');
      }
    } else {
      setConfiguredSortField(field);
      setConfiguredSortDir('asc');
    }
  };

  const loadBackupSnapshots = async () => {
    try {
      const resp = await fetch('/api/backup/snapshots');
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && Array.isArray(data.snapshots)) {
        setBackupSnapshots(data.snapshots);
      }
    } catch {
      // Ignore network error
    }
  };

  const openBackupRestoreModal = () => {
    setShowBackupModal(true);
    void loadBackupSnapshots();
  };

  const handleDownloadFullBackupJson = () => {
    const nowWib = formatJakartaDateTime();
    const safeStamp = nowWib.replace(/[:\s]/g, '-');
    const payload = {
      app: 'JETCYBERNET-SMARTOLT',
      version: '2.4',
      exportedAtWib: `${nowWib} WIB`,
      exportedBy: currentUser?.username || 'admin',
      summary: {
        olts: db.olts.length,
        onus: db.onus.length,
        zones: db.zones.length,
        sectors: (db.sectors || []).length,
        odbs: db.odbs.length,
        vlans: db.vlans.length,
        users: (db.users || []).length,
      },
      state: db,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jetcybernet-smartolt-backup-${safeStamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✓ File Full Backup (.json) berhasil diunduh (${nowWib} WIB).`);
  };

  const handleDownloadOltCliConfig = (olt: OltRecord) => {
    const nowWib = formatJakartaDateTime();
    const safeStamp = nowWib.replace(/[:\s]/g, '-');
    const safeName = olt.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const cliText = buildLiveZteRunningConfig(db, olt.id);
    const blob = new Blob([cliText], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `olt-${safeName}-running-config-${safeStamp}.cfg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(
      `✓ Running-Config CLI OLT "${olt.name}" (.cfg) berhasil diunduh.`
    );
  };

  const handleCreateServerSnapshot = async () => {
    setBackupBusy(true);
    try {
      const resp = await fetch('/api/backup/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label:
            backupSnapshotLabel.trim() ||
            `Backup Manual (${formatJakartaDateTime()} WIB)`,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data && data.ok) {
        if (Array.isArray(data.snapshots)) {
          setBackupSnapshots(data.snapshots);
        }
        setBackupSnapshotLabel('');
        showToast('✓ Titik Backup (Snapshot Server) berhasil dibuat!');
      } else {
        showToast(data?.error || 'Gagal membuat snapshot backup.');
      }
    } catch {
      showToast('Gagal menghubungi server untuk membuat snapshot.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDownloadSnapshotFile = async (snap: BackupSnapshotMeta) => {
    try {
      const resp = await fetch(`/api/backup/snapshots/${snap.id}/download`);
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok || !data.backup) {
        showToast(data?.error || 'Gagal mengunduh snapshot.');
        return;
      }
      const blob = new Blob([JSON.stringify(data.backup, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jetcybernet-snapshot-${snap.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`✓ Snapshot #${snap.id} ("${snap.label}") berhasil diunduh.`);
    } catch {
      showToast('Gagal mengunduh file snapshot dari server.');
    }
  };

  const handleRestoreFromSnapshot = async (snap: BackupSnapshotMeta) => {
    setBackupBusy(true);
    try {
      const resp = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId: snap.id,
          mode: restoreMode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok || !data.state) {
        showToast(data?.error || 'Gagal melakukan restore dari snapshot.');
        return;
      }
      setDb(data.state);
      if (Array.isArray(data.snapshots)) {
        setBackupSnapshots(data.snapshots);
      }
      showToast(
        `✓ Database berhasil di-restore dari Snapshot "${snap.label}" (${data.summary?.olts || 0} OLT, ${data.summary?.onus || 0} ONU, ${data.summary?.zones || 0} Zone).`
      );
    } catch {
      showToast('Gagal melakukan restore dari server.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDeleteSnapshot = async (snapId: number) => {
    try {
      const resp = await fetch(`/api/backup/snapshots/${snapId}`, {
        method: 'DELETE',
      });
      const data = await resp.json();
      if (resp.ok && data && Array.isArray(data.snapshots)) {
        setBackupSnapshots(data.snapshots);
        showToast(`Snapshot #${snapId} telah dihapus.`);
      }
    } catch {
      showToast('Gagal menghapus snapshot.');
    }
  };

  const handleBackupFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result || '{}'));
        const candidateState: SmartOltDatabaseState | null =
          raw && raw.state && Array.isArray(raw.state.olts)
            ? raw.state
            : raw && Array.isArray(raw.olts)
            ? raw
            : null;
        if (!candidateState) {
          showToast(
            '✗ File JSON tidak valid: struktur data OLT/ONU tidak ditemukan.'
          );
          setUploadedBackupState(null);
          return;
        }
        setUploadedBackupState(candidateState);
        setUploadedBackupFileName(file.name);
        setUploadedBackupMeta({
          exportedAtWib: raw.exportedAtWib || undefined,
          label: raw.label || undefined,
        });
        showToast(
          `✓ File backup "${file.name}" siap di-restore (${candidateState.olts.length} OLT, ${candidateState.onus?.length || 0} ONU).`
        );
      } catch {
        showToast('✗ Gagal membaca file backup: pastikan format JSON valid.');
        setUploadedBackupState(null);
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmFileRestore = async () => {
    if (!uploadedBackupState) return;
    setBackupBusy(true);
    try {
      const resp = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: uploadedBackupState,
          mode: restoreMode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok || !data.state) {
        showToast(data?.error || 'Gagal melakukan restore database.');
        return;
      }
      setDb(data.state);
      if (Array.isArray(data.snapshots)) {
        setBackupSnapshots(data.snapshots);
      }
      setUploadedBackupState(null);
      setUploadedBackupFileName('');
      setUploadedBackupMeta(null);
      showToast(
        `✓ Restore berhasil (${restoreMode === 'MERGE' ? 'Gabung Data' : 'Full Restore'}): ${data.summary?.olts || 0} OLT, ${data.summary?.onus || 0} ONU, ${data.summary?.zones || 0} Zone!`
      );
    } catch {
      showToast('Gagal menghubungi server saat proses Restore.');
    } finally {
      setBackupBusy(false);
    }
  };

  // Scoped visibility based on logged-in user's assigned OLTs, Zones, and RKs (Sectors & Splitters)
  const visibleOlts =
    !currentUser || currentUser.role === 'ADMIN' || currentUser.access_all_olts
      ? db.olts
      : db.olts.filter((o) => (currentUser.allowed_olt_ids || []).includes(o.id));
  const visibleOltIds = new Set(visibleOlts.map((o) => o.id));

  const visibleZones =
    !currentUser || currentUser.role === 'ADMIN' || currentUser.access_all_zones
      ? db.zones
      : db.zones.filter((z) => (currentUser.allowed_zone_ids || []).includes(z.id));
  const visibleZoneIds = new Set(visibleZones.map((z) => z.id));

  const visibleSectors = (db.sectors || []).filter((s) => {
    if (!currentUser || currentUser.role === 'ADMIN') return true;
    const zoneExists =
      s.zone_id !== null && db.zones.some((z) => z.id === s.zone_id);
    const zoneOk =
      currentUser.access_all_zones ||
      !zoneExists ||
      (s.zone_id !== null && visibleZoneIds.has(s.zone_id));
    const rkOk =
      currentUser.access_all_rks ||
      (currentUser.allowed_sector_ids || []).includes(s.id);
    return zoneOk && rkOk;
  });
  const visibleSectorIds = new Set(visibleSectors.map((s) => s.id));

  const visibleOdbs = db.odbs.filter((o) => {
    if (!currentUser || currentUser.role === 'ADMIN') return true;
    const zoneExists =
      o.zone_id !== null &&
      o.zone_id !== undefined &&
      db.zones.some((z) => z.id === o.zone_id);
    const zoneOk =
      currentUser.access_all_zones ||
      !zoneExists ||
      visibleZoneIds.has(o.zone_id);
    const rkOk =
      currentUser.access_all_rks ||
      (currentUser.allowed_odb_ids || []).includes(o.id) ||
      (o.sector_id !== null &&
        o.sector_id !== undefined &&
        visibleSectorIds.has(o.sector_id));
    return zoneOk && rkOk;
  });
  const visibleOdbIds = new Set(visibleOdbs.map((o) => o.id));

  const visibleOnus = db.onus.filter((u) => {
    if (!currentUser || currentUser.role === 'ADMIN') return true;
    // 1. Check OLT assignment
    if (!currentUser.access_all_olts && !visibleOltIds.has(u.olt_id)) {
      return false;
    }
    // Unconfigured ONUs only have OLT & PON Port, so OLT check suffices
    if (!u.is_authorized) {
      return true;
    }
    // 2. Check Zone assignment for configured ONUs (allow ONUs synced directly from OLT that have no Zone assigned yet)
    if (!currentUser.access_all_zones) {
      const onuOdb = u.odb_id ? db.odbs.find((o) => o.id === u.odb_id) : null;
      const effectiveZoneId = u.zone_id ?? onuOdb?.zone_id ?? null;
      if (effectiveZoneId !== null && !visibleZoneIds.has(effectiveZoneId)) {
        return false;
      }
    }
    // 3. Check RK (Sector / Splitter ODP) assignment for configured ONUs (allow ONUs synced from OLT without RK/Splitter yet)
    if (!currentUser.access_all_rks) {
      const hasAnyRkAssigned =
        (u.sector_id !== null && u.sector_id !== undefined) || u.odb_id !== null;
      if (hasAnyRkAssigned) {
        const matchSector =
          u.sector_id !== null &&
          u.sector_id !== undefined &&
          visibleSectorIds.has(u.sector_id);
        const matchOdb = u.odb_id !== null && visibleOdbIds.has(u.odb_id);
        if (!matchSector && !matchOdb) {
          return false;
        }
      }
    }
    return true;
  }).map((u) => {
    const parentOlt = db.olts.find((o) => o.id === u.olt_id);
    if (u.is_authorized && parentOlt && parentOlt.status === 'OFFLINE') {
      return {
        ...u,
        phase_state: 'OffLine' as const,
        onu_rx_dbm: null,
        olt_rx_dbm: null,
        last_offline_reason: 'OLT Offline',
      };
    }
    return u;
  });

  const scopedDb: SmartOltDatabaseState = {
    ...db,
    olts: visibleOlts,
    zones: visibleZones,
    sectors: visibleSectors,
    odbs: visibleOdbs,
    onus: visibleOnus,
  };

  // Jika OLT dalam keadaan OFFLINE (mati), ONU unconfigured pada OLT tersebut tidak ditampilkan
  const unconfiguredOnus = visibleOnus.filter((o) => {
    if (o.is_authorized) return false;
    const parentOlt = db.olts.find((olt) => olt.id === o.olt_id);
    if (parentOlt && parentOlt.status === 'OFFLINE') return false;
    return true;
  });
  const configuredOnus = visibleOnus.filter((o) => o.is_authorized);
  const onlineOnus = configuredOnus.filter((o) => o.phase_state === 'working');
  const losOnus = configuredOnus.filter((o) => o.phase_state === 'LOS');
  const pwrFailOnus = configuredOnus.filter((o) => o.phase_state === 'DyingGasp');
  const otherOfflineOnus = configuredOnus.filter(
    (o) =>
      o.phase_state !== 'working' &&
      o.phase_state !== 'LOS' &&
      o.phase_state !== 'DyingGasp'
  );
  // Total Offline = ONU yang offline (PwrFail / DyingGasp + Offline / N/A), sedangkan ONU Loss masuk ke kartu ONU Loss tersendiri
  const totalOfflineCount = pwrFailOnus.length + otherOfflineOnus.length;
  // Redaman > 27 dB (<= -27.0 dBm) masuk ke Low Signals (Warning: -27.0 s/d -29.99 dBm, Critical: <= -30.0 dBm)
  const warningSignalOnus = configuredOnus.filter(
    (o) => o.onu_rx_dbm !== null && o.onu_rx_dbm <= -27.0 && o.onu_rx_dbm > -30.0
  );
  const criticalSignalOnus = configuredOnus.filter(
    (o) => o.onu_rx_dbm !== null && o.onu_rx_dbm <= -30.0
  );
  const lowSignalOnus = configuredOnus.filter(
    (o) => o.onu_rx_dbm !== null && o.onu_rx_dbm <= -27.0
  );
  const totalLowSignalCount = lowSignalOnus.length;

  // Filtered Configured ONUs
  const filteredConfiguredOnus = configuredOnus.filter((o) => {
    if (filterOlt !== 'ANY' && o.olt_id !== Number(filterOlt)) return false;
    if (filterBoard !== 'ANY' && o.board !== Number(filterBoard)) return false;
    if (filterPort !== 'ANY' && o.port !== Number(filterPort)) return false;
    if (filterZone !== 'ANY' && o.zone_id !== Number(filterZone)) return false;
    if (filterSplitter !== 'ANY' && o.odb_id !== Number(filterSplitter)) return false;
    if (filterVlan !== 'ANY' && o.vlan_id !== Number(filterVlan)) return false;

    if (filterPhaseStatus !== 'ALL') {
      if (filterPhaseStatus === 'ONLINE' && o.phase_state !== 'working') return false;
      if (
        filterPhaseStatus === 'OFFLINE' &&
        (o.phase_state === 'working' || o.phase_state === 'LOS')
      )
        return false;
      if (filterPhaseStatus === 'LOS' && o.phase_state !== 'LOS') return false;
      if (filterPhaseStatus === 'PWRFAIL' && o.phase_state !== 'DyingGasp') return false;
      if (
        filterPhaseStatus === 'OFFLINE_NA' &&
        (o.phase_state === 'working' ||
          o.phase_state === 'LOS' ||
          o.phase_state === 'DyingGasp')
      )
        return false;
    }

    if (filterSignalLevel !== 'ALL') {
      const rx = o.onu_rx_dbm;
      if (filterSignalLevel === 'GOOD' && (rx === null || rx <= -27.0)) return false;
      if (filterSignalLevel === 'LOW' && (rx === null || rx > -27.0)) return false;
      if (filterSignalLevel === 'WARNING' && (rx === null || rx > -27.0 || rx <= -30.0))
        return false;
      if (filterSignalLevel === 'CRITICAL' && (rx === null || rx > -30.0))
        return false;
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchName = (o.customer_name || '').toLowerCase().includes(q);
      const matchSn = o.serial_number.toLowerCase().includes(q);
      const matchPppoe = (o.pppoe_username || '').toLowerCase().includes(q);
      if (!matchName && !matchSn && !matchPppoe) return false;
    }
    return true;
  });

  const sortedConfiguredOnus = [...filteredConfiguredOnus].sort((a, b) => {
    if (configuredSortField === 'NONE') return 0;
    const dir = configuredSortDir === 'asc' ? 1 : -1;

    switch (configuredSortField) {
      case 'STATUS': {
        const rank = (s: string) =>
          s === 'working' ? 1 : s === 'DyingGasp' ? 2 : s === 'LOS' ? 3 : 4;
        return (rank(a.phase_state) - rank(b.phase_state)) * dir;
      }
      case 'NAME':
        return (
          (a.customer_name || '').localeCompare(
            b.customer_name || '',
            undefined,
            { numeric: true, sensitivity: 'base' }
          ) * dir
        );
      case 'SN':
        return (
          a.serial_number.localeCompare(b.serial_number, undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'OLT':
        return (
          (a.olt_id - b.olt_id ||
            a.board - b.board ||
            a.port - b.port ||
            (a.onu_index ?? 0) - (b.onu_index ?? 0)) * dir
        );
      case 'BOARD':
        return (a.board - b.board || a.port - b.port) * dir;
      case 'PORT':
        return (a.port - b.port || (a.onu_index ?? 0) - (b.onu_index ?? 0)) * dir;
      case 'ZONE': {
        const zA = db.zones.find((z) => z.id === a.zone_id)?.name || '';
        const zB = db.zones.find((z) => z.id === b.zone_id)?.name || '';
        if (!zA && zB) return 1;
        if (zA && !zB) return -1;
        return (
          zA.localeCompare(zB, undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      }
      case 'SPLITTER': {
        const spA = db.odbs.find((s) => s.id === a.odb_id)?.name || '';
        const spB = db.odbs.find((s) => s.id === b.odb_id)?.name || '';
        if (!spA && spB) return 1;
        if (spA && !spB) return -1;
        return (
          spA.localeCompare(spB, undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      }
      case 'SIGNAL': {
        const rxA = a.onu_rx_dbm;
        const rxB = b.onu_rx_dbm;
        if (rxA === null && rxB === null) return 0;
        if (rxA === null) return 1;
        if (rxB === null) return -1;
        return (rxA - rxB) * dir;
      }
      case 'MODE':
        return (a.wan_mode || '').localeCompare(b.wan_mode || '') * dir;
      case 'VLAN': {
        const vA = db.vlans.find((v) => v.id === a.vlan_id)?.vlan_id ?? 99999;
        const vB = db.vlans.find((v) => v.id === b.vlan_id)?.vlan_id ?? 99999;
        return (vA - vB) * dir;
      }
      case 'METHOD':
        return (a.config_method || 'OMCI').localeCompare(b.config_method || 'OMCI') * dir;
      case 'TYPE':
        return (a.onu_type || '').localeCompare(b.onu_type || '') * dir;
      case 'AUTH_DATE': {
        const dA = a.auth_date_label || (a.last_online_at || '').slice(0, 10);
        const dB = b.auth_date_label || (b.last_online_at || '').slice(0, 10);
        return dA.localeCompare(dB) * dir;
      }
      default:
        return 0;
    }
  });

  const totalConfiguredPages = Math.max(
    1,
    Math.ceil(sortedConfiguredOnus.length / configuredOnusPerPage)
  );
  const activeConfiguredPage = Math.min(
    Math.max(1, configuredOnusPage),
    totalConfiguredPages
  );
  const paginatedConfiguredOnus = sortedConfiguredOnus.slice(
    (activeConfiguredPage - 1) * configuredOnusPerPage,
    activeConfiguredPage * configuredOnusPerPage
  );

  const buildVisiblePageNumbers = (
    current: number,
    total: number
  ): Array<number | '...'> => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, idx) => idx + 1);
    }
    const pages: Array<number | '...'> = [1];
    if (current > 3) {
      pages.push('...');
    }
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let p = start; p <= end; p++) {
      pages.push(p);
    }
    if (current < total - 2) {
      pages.push('...');
    }
    pages.push(total);
    return pages;
  };

  // Central Live OLT Full Synchronization — connects via Telnet to the target OLT,
  // pulls `show card`, `show gpon onu uncfg`, `show gpon onu state`, and `show running-config`,
  // and synchronizes all VLANs, Configured ONUs, Unconfigured ONUs, Uplinks, PON ports & Cards into PostgreSQL.
  const syncOltFromTelnetLive = async (
    oltId: number,
    oltRecordOverride?: Partial<OltRecord>
  ) => {
    if (isViewerUser) {
      showToast('Akses ditolak: Role VIEWER hanya dapat melihat data (Read-Only).');
      return;
    }
    const targetOlt = db.olts.find((o) => o.id === oltId);
    const mergedOlt = { ...(targetOlt || {}), ...(oltRecordOverride || {}), id: oltId };
    setIsSyncingAllOnus(true);
    showToast(
      `Menghubungi OLT ${mergedOlt.name || mergedOlt.ip_address || oltId} via Telnet untuk sinkronisasi semua ONU, VLAN & Running Config...`
    );
    try {
      const resp = await fetch(`/api/olts/${oltId}/sync-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oltRecord: mergedOlt }),
      });
      const data = await resp.json();
      if (data.state) {
        skipNextServerSyncRef.current = true;
        setDb((prev) => mergeLiveOltStatePreservingUserMetadata(prev, data.state));
      }
      if (data.ok) {
        showToast(
          `✓ Sinkronisasi OLT Berhasil: ${data.synced?.vlans || 0} VLAN, ${
            data.synced?.configuredOnus || 0
          } ONU Terkonfigurasi, ${
            data.synced?.unconfiguredOnus || 0
          } Unconfigured ONU, ${data.synced?.uplinks || 0} Uplink tersimpan ke Database!`
        );
      } else {
        showToast(
          `⚠ Gagal menarik data dari OLT via Telnet: ${
            data.error || 'Pastikan IP/Port Telnet & kredensial OLT benar'
          }`
        );
      }
    } catch (err) {
      showToast(`⚠ Gagal menghubungi endpoint sync OLT: ${(err as Error).message}`);
    } finally {
      setIsSyncingAllOnus(false);
    }
  };

  // Dedicated Unconfigured ONUs Scanner — strictly executes `show gpon onu uncfg` on the OLT
  // WITHOUT running full OLT sync (`show running-config`, `show card`, etc.).
  const pollUnconfiguredOnusOnly = async (targetOltFilter: 'ALL' | number = 'ALL') => {
    if (isViewerUser) {
      showToast('Akses ditolak: Role VIEWER hanya dapat melihat data (Read-Only).');
      return;
    }
    const targetOlts =
      targetOltFilter === 'ALL'
        ? visibleOlts
        : visibleOlts.filter((o) => o.id === targetOltFilter);

    if (targetOlts.length === 0) {
      showToast('Tidak ada OLT yang tersedia untuk scan ONU unconfigured.');
      return;
    }

    setIsPollingUncfg(true);
    showToast(
      `Menjalankan perintah "show gpon onu uncfg" pada ${targetOlts.length} OLT (tanpa sinkronisasi ulang OLT)...`
    );

    let totalDiscovered = 0;
    const cliLogs: string[] = [];
    const scannedOltIds = new Set<number>();

    try {
      for (const o of targetOlts) {
        const resp = await fetch(`/api/olts/${o.id}/poll-uncfg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oltRecord: o }),
        });
        const data = await resp.json();
        const header = `# [${o.id} - ${o.name} (${o.ip_address}:${o.telnet_port})] show gpon onu uncfg`;
        if (data.rawOutput && String(data.rawOutput).trim()) {
          cliLogs.push(`${header}\n${String(data.rawOutput).trim()}`);
        } else if (data.error) {
          cliLogs.push(`${header}\n[ERROR] ${data.error}`);
        }

        if (data.ok && data.state) {
          scannedOltIds.add(o.id);
          totalDiscovered += Number(data.discoveredCount || 0);
          skipNextServerSyncRef.current = true;
          const serverUncfg = (data.state.onus as OnuRecord[]).filter(
            (u) => u.olt_id === o.id && !u.is_authorized
          );
          setDb((prev) => ({
            ...prev,
            onus: [
              ...prev.onus.filter((u) => u.olt_id !== o.id || u.is_authorized),
              ...serverUncfg,
            ],
          }));
        } else if (!data.ok) {
          if (data.state) {
            skipNextServerSyncRef.current = true;
            setDb((prev) => mergeLiveOltStatePreservingUserMetadata(prev, data.state));
          }
          showToast(
            `⚠ OLT ${o.name}: ${data.error || 'Gagal menjalankan show gpon onu uncfg via Telnet'}`
          );
        }
      }

      if (cliLogs.length > 0) {
        setLastUncfgCliOutput(cliLogs.join('\n\n'));
      }

      if (scannedOltIds.size > 0) {
        showToast(
          totalDiscovered > 0
            ? `✓ Ditemukan ${totalDiscovered} ONU baru belum terdaftar (show gpon onu uncfg).`
            : `✓ Scan selesai: Tidak ada ONU baru yang belum terdaftar di port PON.`
        );
      }
    } catch (err) {
      showToast(`⚠ Gagal scan unconfigured ONU: ${(err as Error).message}`);
    } finally {
      setIsPollingUncfg(false);
    }
  };

  // Auto-sync OLT configuration from Telnet on initial load if an OLT exists in DB
  // and has <= 1 configured ONU or any placeholder ONU- records.
  const [autoSyncedInitial, setAutoSyncedInitial] = useState(false);
  useEffect(() => {
    if (!dbLoaded || autoSyncedInitial || isViewerUser) return;
    if (db.olts.length > 0) {
      setAutoSyncedInitial(true);
      for (const olt of db.olts) {
        const oltVlanCount = db.vlans.filter((v) => v.olt_id === olt.id).length;
        const oltConfOnus = db.onus.filter(
          (u) => u.olt_id === olt.id && u.is_authorized
        );
        const hasPlaceholderOnus = oltConfOnus.some(
          (u) =>
            !u.serial_number ||
            u.serial_number.startsWith('ONU-') ||
            !u.customer_name ||
            u.customer_name.startsWith('ONU-')
        );
        if (oltVlanCount <= 2 || oltConfOnus.length <= 1 || hasPlaceholderOnus) {
          void syncOltFromTelnetLive(olt.id, olt);
        }
      }
    }
  }, [dbLoaded, autoSyncedInitial, db.olts]);

  // Fast Real-Time OLT TCP Reachability Ping Poller (Every 5s)
  const pollOltRealtimeStatus = async () => {
    try {
      const resp = await fetch('/api/olts/ping-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Background-Poll': '1',
        },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.ok && data.statuses) {
        const statuses = data.statuses as Record<number, 'ONLINE' | 'OFFLINE'>;
        const recoveredOltIds: number[] = [];
        const recoveredOltNames: string[] = [];
        const disconnectedOltNames: string[] = [];
        setDb((prev) => {
          for (const o of prev.olts) {
            if (o.status === 'OFFLINE' && statuses[o.id] === 'ONLINE') {
              recoveredOltIds.push(o.id);
              recoveredOltNames.push(`${o.name} (${o.ip_address})`);
            } else if (o.status === 'ONLINE' && statuses[o.id] === 'OFFLINE') {
              disconnectedOltNames.push(`${o.name} (${o.ip_address})`);
            }
          }
          const offlineIds = new Set(
            prev.olts
              .filter((o) => (statuses[o.id] || o.status) === 'OFFLINE')
              .map((o) => o.id)
          );
          const hasOltChange = prev.olts.some(
            (o) => statuses[o.id] && o.status !== statuses[o.id]
          );
          const hasOnuStillOnlineOnOfflineOlt = prev.onus.some(
            (u) =>
              offlineIds.has(u.olt_id) &&
              (!u.is_authorized ||
                u.phase_state !== 'OffLine' ||
                u.onu_rx_dbm !== null)
          );
          if (!hasOltChange && !hasOnuStillOnlineOnOfflineOlt) return prev;
          skipNextServerSyncRef.current = true;
          return {
            ...prev,
            olts: prev.olts.map((o) =>
              statuses[o.id] ? { ...o, status: statuses[o.id] } : o
            ),
            onus: prev.onus
              .filter((u) => u.is_authorized || !offlineIds.has(u.olt_id))
              .map((u) =>
                u.is_authorized && offlineIds.has(u.olt_id)
                  ? {
                      ...u,
                      phase_state: 'OffLine' as const,
                      onu_rx_dbm: null,
                      olt_rx_dbm: null,
                      last_offline_reason: 'OLT Offline',
                    }
                  : u
              ),
            pon_ports: prev.pon_ports.map((p) =>
              offlineIds.has(p.olt_id) ? { ...p, online_onus: 0 } : p
            ),
          };
        });
        if (disconnectedOltNames.length > 0) {
          showToast(`⚠ OLT Disconnect: ${disconnectedOltNames.join(', ')} tidak dapat dihubungi.`);
        } else if (recoveredOltNames.length > 0) {
          showToast(`✓ OLT Terhubung Kembali: ${recoveredOltNames.join(', ')}.`);
        }
        for (const recId of recoveredOltIds) {
          void pollRealtimeOltTelemetry(recId);
        }
      }
    } catch {
      // ignore network error
    }
  };

  // Background Real-Time OLT Status, Optical Power & MikroTik WAN IP Poller (Every 10s)
  const pollRealtimeOltTelemetry = async (targetOltId?: number, targetOnuId?: number) => {
    const oltToPoll =
      db.olts.find((o) => o.id === (targetOltId || selectedOltId)) || db.olts[0];
    if (!oltToPoll) return;
    const pollStartedAt = Date.now();
    try {
      const resp = await fetch(`/api/olts/${oltToPoll.id}/poll-realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Background-Poll': '1',
        },
        body: JSON.stringify({
          onuId:
            targetOnuId !== undefined
              ? targetOnuId
              : activeView === 'ONU_DETAIL'
                ? selectedOnuId
                : undefined,
        }),
      });
      const data = await resp.json();
      if (data && !data.skipped && data.state) {
        // Update OLT ONLINE/OFFLINE status and telemetry even when reachable === false
        if (lastUserMutationAtRef.current < pollStartedAt) {
          skipNextServerSyncRef.current = true;
        }
        setDb((prev) => mergeLiveOltStatePreservingUserMetadata(prev, data.state));
      }
    } catch {
      // ignore transient network errors during background poll
    }
  };

  useEffect(() => {
    if (!dbLoaded || db.olts.length === 0) return;
    // Immediate real-time TCP reachability check for all OLTs
    void pollOltRealtimeStatus();
    const statusInterval = setInterval(() => {
      void pollOltRealtimeStatus();
    }, 5000);
    // Initial real-time status & WAN IP poll shortly after load
    const initialTimer = setTimeout(() => {
      void pollRealtimeOltTelemetry();
    }, 1500);
    // Continuous real-time poll every 10 seconds
    const intervalTimer = setInterval(() => {
      void pollRealtimeOltTelemetry();
    }, 10000);
    return () => {
      clearInterval(statusInterval);
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [dbLoaded, db.olts.length, selectedOltId, activeView, selectedOnuId]);

  // Central Live OLT CLI Executor — sends commands via Telnet/SSH to the target OLT
  // and updates provisioning_logs + toast with the real OLT execution response.
  const executeOltCliLive = async (
    oltId: number,
    cliScript: string,
    logId: number,
    summaryLabel: string,
    oltConnectionOverride?: {
      ip_address: string;
      telnet_port: number;
      olt_username: string;
      olt_password: string;
    }
  ): Promise<{
    ok: boolean;
    output: string;
    error?: string;
    durationMs: number;
    reallocatedOnuIndex?: number;
  }> => {
    const startMs = Date.now();
    const targetOlt = db.olts.find((o) => o.id === oltId);
    const connPayload = {
      ip_address: oltConnectionOverride?.ip_address || targetOlt?.ip_address,
      telnet_port: oltConnectionOverride?.telnet_port || targetOlt?.telnet_port,
      olt_username: oltConnectionOverride?.olt_username || targetOlt?.olt_username,
      olt_password: oltConnectionOverride?.olt_password || targetOlt?.olt_password,
      enable_password: targetOlt?.enable_password,
    };
    try {
      const resp = await fetch('/api/telnet/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oltId,
          ...connPayload,
          commands: cliScript,
        }),
      });
      const data = await resp.json();
      const elapsedMs = Date.now() - startMs;

      if (data.ok || data.reachable) {
        const cleanOutput = (data.output || '[OK - Executed on OLT]').trim();
        setDb((prev) => ({
          ...prev,
          provisioning_logs: prev.provisioning_logs.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  olt_response: cleanOutput || '[OK - Executed on OLT]',
                  execution_status: 'SUCCESS',
                  duration_ms: elapsedMs,
                }
              : l
          ),
        }));
        showToast(`✓ LIVE OLT: ${summaryLabel} berhasil ter-push ke OLT (${elapsedMs}ms)`);
        return {
          ok: true,
          output: cleanOutput,
          durationMs: elapsedMs,
          reallocatedOnuIndex:
            typeof data.reallocatedOnuIndex === 'number'
              ? data.reallocatedOnuIndex
              : undefined,
        };
      } else {
        const errMsg = data.error || 'Telnet execution failed';
        setDb((prev) => ({
          ...prev,
          provisioning_logs: prev.provisioning_logs.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  olt_response: `[TELNET ERROR] ${errMsg}`,
                  execution_status: 'FAILED',
                  duration_ms: elapsedMs,
                }
              : l
          ),
        }));
        showToast(`⚠ Disimpan ke DB, namun gagal eksekusi Telnet OLT: ${errMsg}`);
        return {
          ok: false,
          output: data.output || '',
          error: errMsg,
          durationMs: elapsedMs,
        };
      }
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      const errMsg = (err as Error).message;
      setDb((prev) => ({
        ...prev,
        provisioning_logs: prev.provisioning_logs.map((l) =>
          l.id === logId
            ? {
                ...l,
                olt_response: `[NETWORK ERROR] ${errMsg}`,
                execution_status: 'FAILED',
                duration_ms: elapsedMs,
              }
            : l
        ),
      }));
      return {
        ok: false,
        output: '',
        error: errMsg,
        durationMs: elapsedMs,
      };
    }
  };

  // Authorize ONU Handler
  const handleConfirmAuthorize = (
    onuId: number,
    updatedFields: Partial<OnuRecord>,
    generatedCli: string,
    allocatedOnuIndex: number
  ) => {
    if (isViewerUser) {
      showToast('Akses ditolak: Role VIEWER hanya dapat melihat data (Read-Only).');
      return;
    }
    const targetOnu = db.onus.find((o) => o.id === onuId);
    if (!targetOnu) return;

    const targetOltId = updatedFields.olt_id || targetOnu.olt_id || db.olts[0]?.id || 1;
    const targetBoard = updatedFields.board || targetOnu.board || 3;
    const targetPortNum = updatedFields.port || targetOnu.port || 1;
    const logId = Date.now();
    const onuIf = `gpon-onu_1/${targetBoard}/${targetPortNum}:${allocatedOnuIndex}`;

    const newLog: ProvisioningLogRecord = {
      id: logId,
      olt_id: targetOltId,
      onu_id: onuId,
      serial_number: targetOnu.serial_number,
      action_type: 'AUTHORIZE',
      interface_target: onuIf,
      summary_text: `${onuIf} authorized (${targetOnu.serial_number})`,
      cli_script: generatedCli,
      olt_response: '[Executing on OLT via Telnet...]',
      execution_status: 'SUCCESS',
      executed_by: 'likhin',
      duration_ms: 0,
      created_at: 'Just now',
    };

    setDb((prev) => {
      const hasPonPort = prev.pon_ports.some(
        (p) => p.olt_id === targetOltId && p.port_number === targetPortNum
      );
      const updatedPonPorts = hasPonPort
        ? prev.pon_ports.map((p) =>
            p.olt_id === targetOltId && p.port_number === targetPortNum
              ? {
                  ...p,
                  oper_status: 'Up' as const,
                  online_onus: p.online_onus + 1,
                  total_onus: p.total_onus + 1,
                }
              : p
          )
        : [
            ...prev.pon_ports,
            {
              id: targetOltId * 100 + targetPortNum,
              rack: 1,
              shelf: 3,
              slot: targetBoard,
              olt_id: targetOltId,
              port_number: targetPortNum,
              interface_name: `gpon-olt_1/${targetBoard}/${targetPortNum}`,
              board_model: 'GTGH',
              description: `PON 1/${targetBoard}/${targetPortNum}`,
              admin_state: 'ENABLED' as const,
              oper_status: 'Up' as const,
              online_onus: 1,
              total_onus: 1,
              avg_signal_dbm: -23.5,
              tx_power_dbm: 10.5,
              max_onu_capacity: 128,
            },
          ];

      const hasVlan = prev.vlans.some((v) => v.olt_id === targetOltId);
      const updatedVlans = hasVlan
        ? prev.vlans
        : [
            ...prev.vlans,
            {
              id: targetOltId * 10000 + 100,
              olt_id: targetOltId,
              vlan_id: 100,
              name: 'TR069',
              description: 'TR069 Management',
              default_for: 'None selected',
              used_for_mgmt_tr069_voip: true,
              used_for_iptv: false,
              dhcp_snooping: false,
              lan_to_lan: false,
              onus_count: 0,
              service_type: 'TR069_MGMT' as const,
              svlan_id: null,
              is_default: false,
            },
            {
              id: targetOltId * 10000 + 101,
              olt_id: targetOltId,
              vlan_id: 101,
              name: 'PPPOE',
              description: 'PPPOE Subscribers',
              default_for: 'None selected',
              used_for_mgmt_tr069_voip: false,
              used_for_iptv: false,
              dhcp_snooping: false,
              lan_to_lan: false,
              onus_count: 1,
              service_type: 'PPPOE' as const,
              svlan_id: null,
              is_default: true,
            },
          ];

      return {
        ...prev,
        onus: prev.onus.map((item) =>
          item.id === onuId ? { ...item, ...updatedFields } : item
        ),
        pon_ports: updatedPonPorts,
        vlans: updatedVlans,
        provisioning_logs: [newLog, ...prev.provisioning_logs],
      };
    });

    setAuthorizingOnu(null);
    setSelectedOnuId(onuId);
    setActiveView('ONU_DETAIL');
    showToast(
      `Mengeksekusi Authorize ${targetOnu.serial_number} pada ${onuIf} ke OLT...`
    );

    void executeOltCliLive(
      targetOltId,
      generatedCli,
      logId,
      `Authorize ${targetOnu.serial_number} (${onuIf})`
    ).then((res) => {
      if (res.reallocatedOnuIndex && res.reallocatedOnuIndex !== allocatedOnuIndex) {
        const newIf = `gpon-onu_1/${targetBoard}/${targetPortNum}:${res.reallocatedOnuIndex}`;
        setDb((prev) => ({
          ...prev,
          onus: prev.onus.map((item) =>
            item.id === onuId
              ? { ...item, onu_index: res.reallocatedOnuIndex! }
              : item
          ),
        }));
        showToast(
          `✓ Anti-Collision: ONU ${targetOnu.serial_number} otomatis ditempatkan di index kosong ${newIf}`
        );
      }
      // Poll real-time status & MikroTik PPPoE WAN IP 4 seconds after authorization completes
      setTimeout(() => {
        void pollRealtimeOltTelemetry(targetOltId, onuId);
      }, 4000);
    });
  };

  // Execute ONU Action Handler (Update ONU mode, TR069 Push, Reboot, Resync, Restore, Delete)
  const handleExecuteOnuAction = async (
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
  ): Promise<{
    ok: boolean;
    output: string;
    error?: string;
    durationMs?: number;
  }> => {
    if (isViewerUser && actionType !== 'POLL_SIGNAL') {
      showToast('Akses ditolak: Role VIEWER hanya dapat melihat data (Read-Only).');
      return { ok: false, output: '', error: 'Forbidden: Role VIEWER is Read-Only' };
    }
    const targetOnu = db.onus.find((o) => o.id === onuId);
    if (!targetOnu) {
      return { ok: false, output: '', error: 'ONU not found' };
    }

    const targetOltId = targetOnu.olt_id || db.olts[0]?.id || 1;
    const nextBoard = updatedFields?.board ?? targetOnu.board;
    const nextPort = updatedFields?.port ?? targetOnu.port;
    const nextIdx = updatedFields?.onu_index ?? targetOnu.onu_index ?? 1;
    const onuIf = `gpon-onu_1/${nextBoard}/${nextPort}:${nextIdx}`;
    const summaryMap: Record<string, string> = {
      UPDATE_ONU_MODE: `${onuIf} Updated ONU mode, VLAN & PPPoE`,
      TR069_PUSH: `${onuIf} Pushed TR-069 / OMCI configuration`,
      REBOOT: `${onuIf} Rebooted ONU`,
      RESYNC_CONFIG: `${onuIf} Synced & pushed ONU configuration`,
      FACTORY_RESET: `${onuIf} Restored factory defaults`,
      UPDATE_PPPOE: `${onuIf} Updated PPPoE credentials & VLAN`,
      DELETE_ONU: `${onuIf} Deleted ONU (${targetOnu.serial_number})`,
      POLL_SIGNAL: `${onuIf} Polled optical power attenuation`,
    };

    const logId = Date.now();
    const newLog: ProvisioningLogRecord = {
      id: logId,
      olt_id: targetOltId,
      onu_id: onuId,
      serial_number: updatedFields?.serial_number || targetOnu.serial_number,
      action_type: actionType,
      interface_target: onuIf,
      summary_text: summaryMap[actionType] || `${onuIf} ${actionType}`,
      cli_script: cliScript,
      olt_response: '[Executing on OLT via Telnet...]',
      execution_status: 'SUCCESS',
      executed_by: 'likhin',
      duration_ms: 0,
      created_at: 'Just now',
    };

    if (actionType === 'DELETE_ONU') {
      setDb((prev) => ({
        ...prev,
        onus: prev.onus.map((item) =>
          item.id === onuId
            ? {
                ...item,
                is_authorized: false,
                onu_index: null,
                phase_state: 'Unconfigured',
                detected_ago: new Date().toISOString(),
                last_online_at: new Date().toISOString(),
              }
            : item
        ),
        provisioning_logs: [newLog, ...prev.provisioning_logs],
      }));
      setActiveView('UNCONFIGURED');
      showToast(`Menghapus ONU ${targetOnu.serial_number} dari OLT (${onuIf})...`);
      return executeOltCliLive(
        targetOltId,
        cliScript,
        logId,
        `Delete ONU ${targetOnu.serial_number} (${onuIf})`
      );
    }

    if (actionType !== 'POLL_SIGNAL') {
      nextSyncIsUserMutationRef.current = true;
      lastUserMutationAtRef.current = Date.now();
    }

    setDb((prev) => ({
      ...prev,
      onus: prev.onus.map((item) =>
        item.id === onuId ? { ...item, ...(updatedFields || {}) } : item
      ),
      provisioning_logs:
        actionType === 'POLL_SIGNAL'
          ? prev.provisioning_logs
          : [newLog, ...prev.provisioning_logs],
    }));

    if (actionType === 'POLL_SIGNAL' && updatedFields) {
      return { ok: true, output: cliScript, durationMs: 0 };
    }

    if (!cliScript || cliScript.trim() === '' || cliScript.trim().startsWith('# [DB-ONLY')) {
      showToast(`✓ Data Pelanggan / Zone / ODP berhasil disimpan ke Database!`);
      return { ok: true, output: '[Saved to SmartOLT Database]', durationMs: 0 };
    }

    showToast(`Mengeksekusi ${summaryMap[actionType]} ke OLT...`);

    if (cliScript && !cliScript.trim().startsWith('# [TR-069')) {
      return executeOltCliLive(
        targetOltId,
        cliScript,
        logId,
        summaryMap[actionType] || actionType
      );
    }

    return { ok: true, output: cliScript, durationMs: 0 };
  };

  // ============================================================================
  // SMARTOLT AUTO ONU PROVISIONING ENGINE (Task Matching, Locking & Verification)
  // ============================================================================
  const [isRunningAutoEngine, setIsRunningAutoEngine] = useState(false);
  const [uncfgSubView, setUncfgSubView] = useState<
    'UNCONFIGURED_LIST' | 'TASKS' | 'HISTORY' | 'FAILED'
  >('UNCONFIGURED_LIST');
  const [openTaskWizardSignal, setOpenTaskWizardSignal] = useState<number>(0);
  const autoProvisioningLockRef = useRef<Set<string>>(new Set());
  const autoProcessedSignatureRef = useRef<Set<string>>(new Set());

  const executeSingleOnuAutoProvisioning = async (
    targetOnu: OnuRecord,
    forcedTask?: AutoProvisioningTaskRecord,
    retryCount = 0
  ): Promise<boolean> => {
    if (isViewerUser) return false;
    const lockKey = `${targetOnu.olt_id}:${targetOnu.serial_number.toUpperCase()}`;
    if (autoProvisioningLockRef.current.has(lockKey)) {
      return false; // Prevent double provisioning while in-flight
    }

    const activeTasks = db.auto_provisioning_tasks || [];
    const matchRes = forcedTask
      ? { matchedTask: forcedTask, conflictTasks: [], conflictReason: null }
      : matchAutoProvisioningTaskForOnu(targetOnu, activeTasks);

    const oltObj = db.olts.find((o) => o.id === targetOnu.olt_id);
    const oltName = oltObj?.name || `OLT #${targetOnu.olt_id}`;
    const detectedVendor = detectOnuVendorFromSn(
      targetOnu.serial_number,
      targetOnu.onu_type
    );
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // 1. Handle Task Conflict Detection
    if (matchRes.conflictReason) {
      const conflictHistoryId = Date.now() + Math.floor(Math.random() * 1000);
      const conflictRecord: AutoProvisioningHistoryRecord = {
        id: conflictHistoryId,
        timestamp: nowStr,
        onu_db_id: targetOnu.id,
        serial_number: targetOnu.serial_number,
        onu_vendor: detectedVendor,
        onu_model: targetOnu.onu_type || 'ALL',
        olt_id: targetOnu.olt_id,
        olt_name: oltName,
        board: targetOnu.board,
        pon: targetOnu.port,
        onu_id: 0,
        task_id: matchRes.conflictTasks[0]?.id || null,
        task_name: `CONFLICT (${matchRes.conflictTasks.map((t) => t.name).join(' vs ')})`,
        applied_vlan: matchRes.conflictTasks[0]?.vlan_id || 0,
        service_profile: '-',
        speed_profile: '-',
        zone_name: '-',
        splitter_name: '-',
        splitter_port: null,
        duration_ms: 0,
        status: 'FAILED',
        is_conflict: true,
        error_message: matchRes.conflictReason,
        cli_script: '# Aborted due to Task Priority Conflict',
        olt_response: matchRes.conflictReason,
        verification_output: matchRes.conflictReason,
        retry_count: retryCount,
      };
      setDb((prev) => ({
        ...prev,
        auto_provisioning_history: [
          conflictRecord,
          ...(prev.auto_provisioning_history || []).filter(
            (h) =>
              !(
                h.serial_number.toUpperCase() ===
                  targetOnu.serial_number.toUpperCase() && h.is_conflict
              )
          ),
        ].slice(0, 500),
      }));
      showToast(`⚠️ ${matchRes.conflictReason}`);
      return false;
    }

    const task = matchRes.matchedTask;
    if (!task) return false;

    // 2. Duplicate ONU Protection (Prevent provisioning if SN is already authorized)
    const duplicateAuthorized = db.onus.find(
      (u) =>
        u.is_authorized &&
        u.id !== targetOnu.id &&
        u.serial_number.toUpperCase() === targetOnu.serial_number.toUpperCase()
    );
    if (duplicateAuthorized) {
      const dupRecord: AutoProvisioningHistoryRecord = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp: nowStr,
        onu_db_id: targetOnu.id,
        serial_number: targetOnu.serial_number,
        onu_vendor: detectedVendor,
        onu_model: targetOnu.onu_type || 'ALL',
        olt_id: targetOnu.olt_id,
        olt_name: oltName,
        board: targetOnu.board,
        pon: targetOnu.port,
        onu_id: duplicateAuthorized.onu_index || 0,
        task_id: task.id,
        task_name: task.name,
        applied_vlan: task.vlan_id,
        service_profile: task.service_profile,
        speed_profile:
          db.speed_profiles.find((s) => s.id === task.speed_profile_id)
            ?.profile_name || '-',
        zone_name: '-',
        splitter_name: '-',
        splitter_port: null,
        duration_ms: 0,
        status: 'FAILED',
        error_message: `Duplicate ONU Protection: Serial Number ${targetOnu.serial_number} sudah aktif pada gpon-onu_1/${duplicateAuthorized.board}/${duplicateAuthorized.port}:${duplicateAuthorized.onu_index}.`,
        cli_script: '# Blocked by Duplicate ONU Protection',
        olt_response: 'Blocked before CLI execution.',
        verification_output: 'Duplicate SN detected in Configured ONUs.',
        retry_count: retryCount,
      };
      setDb((prev) => ({
        ...prev,
        auto_provisioning_history: [
          dupRecord,
          ...(prev.auto_provisioning_history || []),
        ].slice(0, 500),
      }));
      return false;
    }

    // Acquire execution lock
    autoProvisioningLockRef.current.add(lockKey);
    const startTime = Date.now();
    const historyId = Date.now() + Math.floor(Math.random() * 1000);

    try {
      // 3. Allocate free ONU Index on OLT Board/Port
      const usedIndices = db.onus
        .filter(
          (u) =>
            u.is_authorized &&
            u.olt_id === targetOnu.olt_id &&
            u.board === targetOnu.board &&
            u.port === targetOnu.port &&
            u.onu_index !== null
        )
        .map((u) => u.onu_index as number);
      const allocatedIndex = findNextAvailableOnuIndex(usedIndices, 128);

      // 4. Allocate Splitter Port (if ODP/Splitter configured in Task)
      let allocatedSplitterPort: number | null = null;
      const splitterObj = task.odb_id
        ? db.odbs.find((o) => o.id === task.odb_id) || null
        : null;
      if (splitterObj) {
        if (task.odb_port_mode === 'SPECIFIC' && task.odb_port) {
          allocatedSplitterPort = task.odb_port;
        } else {
          const usedPorts = new Set(
            db.onus
              .filter(
                (u) => u.odb_id === splitterObj.id && u.odb_port !== null
              )
              .map((u) => u.odb_port as number)
          );
          for (let p = 1; p <= splitterObj.total_ports; p++) {
            if (!usedPorts.has(p)) {
              allocatedSplitterPort = p;
              break;
            }
          }
        }
      }

      const zoneObj = task.zone_id
        ? db.zones.find((z) => z.id === task.zone_id) || null
        : null;
      const speedObj =
        db.speed_profiles.find((s) => s.id === task.speed_profile_id) ||
        db.speed_profiles[0];

      // 5. Build CLI + Verification Script
      const {
        cliScript,
        rollbackScript,
        pppoeUser,
        pppoePass,
        resolvedWifiSsid,
      } = buildAutoTaskCliScript({
        onu: targetOnu,
        allocatedIndex,
        task,
        db,
      });

      // Insert PROCESSING history record
      const processingRecord: AutoProvisioningHistoryRecord = {
        id: historyId,
        timestamp: nowStr,
        onu_db_id: targetOnu.id,
        serial_number: targetOnu.serial_number,
        onu_vendor: detectedVendor,
        onu_model:
          task.onu_model !== 'ALL' ? task.onu_model : targetOnu.onu_type || 'ALL',
        olt_id: targetOnu.olt_id,
        olt_name: oltName,
        board: targetOnu.board,
        pon: targetOnu.port,
        onu_id: allocatedIndex,
        task_id: task.id,
        task_name: task.name,
        applied_vlan: task.vlan_id,
        service_profile: task.service_profile,
        speed_profile: speedObj?.profile_name || 'SMARTOLT-1G-DOWN',
        zone_name: zoneObj?.name || '-',
        splitter_name: splitterObj?.name || '-',
        splitter_port: allocatedSplitterPort,
        duration_ms: 0,
        status: retryCount > 0 ? 'RETRY' : 'PROCESSING',
        error_message: null,
        cli_script: cliScript,
        olt_response: '[Executing & verifying on OLT...]',
        verification_output: '',
        retry_count: retryCount,
      };

      const logId = Date.now() + Math.floor(Math.random() * 1000);
      const onuIf = `gpon-onu_1/${targetOnu.board}/${targetOnu.port}:${allocatedIndex}`;

      setDb((prev) => ({
        ...prev,
        auto_provisioning_history: [
          processingRecord,
          ...(prev.auto_provisioning_history || []).filter(
            (h) => h.id !== historyId
          ),
        ].slice(0, 500),
      }));

      // 6. Execute on OLT via Telnet
      const execRes = await executeOltCliLive(
        targetOnu.olt_id,
        cliScript,
        logId,
        `Auto-Task "${task.name}": Authorize ${targetOnu.serial_number} (${onuIf})`
      );

      const finalOnuIndex = execRes.reallocatedOnuIndex || allocatedIndex;
      const elapsedMs = Date.now() - startTime;

      // 7. Verify configuration on OLT
      const verification = verifyOltProvisioningOutput(
        execRes.output,
        targetOnu.serial_number,
        finalOnuIndex
      );

      if (!execRes.ok || !verification.verified) {
        // Attempt rollback on OLT if command partially executed
        if (execRes.ok && !verification.verified) {
          void executeOltCliLive(
            targetOnu.olt_id,
            rollbackScript,
            Date.now(),
            `Rollback unverified ONU ${targetOnu.serial_number}`
          );
        }

        const errReason =
          execRes.error ||
          verification.reason ||
          'Konfigurasi gagal diverifikasi pada OLT.';

        setDb((prev) => ({
          ...prev,
          auto_provisioning_history: (prev.auto_provisioning_history || []).map(
            (h) =>
              h.id === historyId
                ? {
                    ...h,
                    onu_id: finalOnuIndex,
                    duration_ms: elapsedMs,
                    status: 'FAILED',
                    error_message: errReason,
                    olt_response: execRes.output || errReason,
                    verification_output: verification.verificationSnippet,
                  }
                : h
          ),
        }));

        showToast(
          `❌ Auto Provisioning gagal untuk ${targetOnu.serial_number}: ${errReason}`
        );
        return false;
      }

      // 8. Provisioning Verified -> Transition ONU to Configured ONU
      const targetVlanRecord = db.vlans.find(
        (v) => v.olt_id === targetOnu.olt_id && v.vlan_id === task.vlan_id
      );

      nextSyncIsUserMutationRef.current = true;
      lastUserMutationAtRef.current = Date.now();

      setDb((prev) => ({
        ...prev,
        onus: prev.onus.map((item) =>
          item.id === targetOnu.id
            ? {
                ...item,
                onu_index: finalOnuIndex,
                onu_type:
                  task.onu_model !== 'ALL' ? task.onu_model : item.onu_type,
                is_authorized: true,
                customer_name:
                  item.customer_name ||
                  `AUTO-${targetOnu.serial_number.slice(-4).toUpperCase()}`,
                address: `Auto-Task: ${task.name}`,
                zone_id: task.zone_id,
                odb_id: task.odb_id,
                odb_port: allocatedSplitterPort,
                vlan_id: targetVlanRecord?.id || task.vlan_id,
                attached_vlan_ids: [task.vlan_id],
                speed_profile_id: task.speed_profile_id,
                tcont_profile_id:
                  task.dba_profile_id || speedObj?.tcont_profile_id || 1,
                onu_mode: task.onu_profile_mode,
                wan_mode: task.service_profile,
                enable_nat: task.enable_nat,
                config_method: task.tr069_enabled ? 'TR069' : task.config_method,
                tr069_profile_id: task.tr069_enabled
                  ? task.tr069_profile_id
                  : null,
                tr069_status: task.tr069_enabled
                  ? 'ACTIVE_INFORMING'
                  : 'DISABLED',
                tr069_last_inform: task.tr069_enabled ? 'Just now' : null,
                mgmt_ip_mode:
                  task.mgmt_ip_mode === 'STATIC'
                    ? 'STATIC_IP'
                    : task.mgmt_ip_mode,
                mgmt_ip:
                  task.mgmt_ip_mode === 'STATIC'
                    ? task.mgmt_ip_address
                    : item.mgmt_ip,
                mgmt_subnet_mask:
                  task.mgmt_ip_mode === 'STATIC'
                    ? task.mgmt_subnet_mask
                    : item.mgmt_subnet_mask,
                mgmt_gateway:
                  task.mgmt_ip_mode === 'STATIC'
                    ? task.mgmt_gateway
                    : item.mgmt_gateway,
                wifi_enabled: task.wifi_enabled,
                wifi_ssid: resolvedWifiSsid,
                wifi_password: task.wifi_enabled ? task.wifi_password : null,
                pppoe_username: pppoeUser,
                pppoe_password: pppoePass,
                phase_state: 'working',
                onu_rx_dbm: item.onu_rx_dbm ?? -18.45,
                onu_tx_dbm: item.onu_tx_dbm ?? 2.45,
                olt_rx_dbm: item.olt_rx_dbm ?? -20.15,
                auth_date_label: new Date().toISOString().slice(0, 10),
                last_online_at: 'Just now',
              }
            : item
        ),
        auto_provisioning_history: (prev.auto_provisioning_history || []).map(
          (h) =>
            h.id === historyId
              ? {
                  ...h,
                  onu_id: finalOnuIndex,
                  duration_ms: elapsedMs,
                  status: 'SUCCESS',
                  error_message: null,
                  olt_response: execRes.output,
                  verification_output: verification.verificationSnippet,
                }
              : h
        ),
        tasks: [
          {
            id: Date.now(),
            action: 'Auto-Authorize' as const,
            olt_label: `${targetOnu.olt_id} - ${oltName} (${task.name})`,
            processed: 1,
            total: 1,
            successful: 1,
            failed: 0,
            user_email: currentUser?.email || currentUser?.username || 'system',
            status: 'Finished' as const,
            from_time: nowStr,
            to_time: nowStr,
          },
          ...prev.tasks,
        ],
      }));

      showToast(
        `✓ Auto Provisioning Sukses: ${targetOnu.serial_number} terkonfigurasi via Task "${task.name}" (VLAN ${task.vlan_id})`
      );

      setTimeout(() => {
        void pollRealtimeOltTelemetry(targetOnu.olt_id, targetOnu.id);
      }, 3500);

      return true;
    } finally {
      autoProvisioningLockRef.current.delete(lockKey);
    }
  };

  const handleRunAutoProvisioningBatch = async (
    specificOnu?: OnuRecord,
    forceTaskId?: number
  ) => {
    if (isViewerUser || isRunningAutoEngine) return;
    const tasksList = db.auto_provisioning_tasks || [];
    const forcedTask = forceTaskId
      ? tasksList.find((t) => t.id === forceTaskId)
      : undefined;

    const candidates = specificOnu ? [specificOnu] : unconfiguredOnus;
    if (candidates.length === 0) {
      showToast('Tidak ada Unconfigured ONU untuk diproses.');
      return;
    }

    setIsRunningAutoEngine(true);
    try {
      let successCount = 0;
      let matchAttempted = 0;
      for (const onu of candidates) {
        const check = forcedTask
          ? { matchedTask: forcedTask, conflictReason: null }
          : matchAutoProvisioningTaskForOnu(onu, tasksList);
        if (check.matchedTask || check.conflictReason) {
          matchAttempted++;
          const ok = await executeSingleOnuAutoProvisioning(onu, forcedTask, 0);
          if (ok) successCount++;
        }
      }
      if (matchAttempted === 0) {
        showToast(
          'Tidak ditemukan Auto Provisioning Task berstatus Active yang cocok dengan ONU saat ini.'
        );
      } else if (successCount > 0) {
        showToast(
          `✓ Auto Provisioning selesai: ${successCount} dari ${matchAttempted} ONU berhasil dikonfigurasi.`
        );
      }
    } finally {
      setIsRunningAutoEngine(false);
    }
  };

  const handleRetryFailedProvisioning = async (
    failedRec: AutoProvisioningHistoryRecord
  ) => {
    if (isViewerUser) return;
    const onu = db.onus.find(
      (u) =>
        !u.is_authorized &&
        (u.id === failedRec.onu_db_id ||
          u.serial_number.toUpperCase() ===
            failedRec.serial_number.toUpperCase())
    );
    if (!onu) {
      showToast(
        `ONU ${failedRec.serial_number} sudah terkonfigurasi atau tidak lagi berada di daftar Unconfigured ONU.`
      );
      return;
    }
    const task = failedRec.task_id
      ? (db.auto_provisioning_tasks || []).find(
          (t) => t.id === failedRec.task_id
        )
      : undefined;

    setIsRunningAutoEngine(true);
    try {
      await executeSingleOnuAutoProvisioning(
        onu,
        task,
        (failedRec.retry_count || 0) + 1
      );
    } finally {
      setIsRunningAutoEngine(false);
    }
  };

  // Automatic Background Watcher: when a new Unconfigured ONU appears and matches an active Task, run provisioning automatically
  useEffect(() => {
    if (isViewerUser || isRunningAutoEngine) return;
    const activeTasks = (db.auto_provisioning_tasks || []).filter(
      (t) => t.status === 'ENABLED' && t.auto_provisioning
    );
    if (activeTasks.length === 0) return;

    const currentUncfg = db.onus.filter((u) => !u.is_authorized);
    if (currentUncfg.length === 0) return;

    const tasksVersionKey = activeTasks
      .map((t) => `${t.id}:${t.updated_at}:${t.priority}:${t.vlan_id}`)
      .join('|');

    const pendingOnu = currentUncfg.find((u) => {
      const sig = `${u.olt_id}:${u.serial_number.toUpperCase()}@${tasksVersionKey}`;
      if (autoProcessedSignatureRef.current.has(sig)) return false;
      const m = matchAutoProvisioningTaskForOnu(u, activeTasks);
      return Boolean(m.matchedTask || m.conflictReason);
    });

    if (!pendingOnu) return;
    const sig = `${pendingOnu.olt_id}:${pendingOnu.serial_number.toUpperCase()}@${tasksVersionKey}`;
    autoProcessedSignatureRef.current.add(sig);

    const timer = setTimeout(() => {
      void executeSingleOnuAutoProvisioning(pendingOnu);
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.onus, db.auto_provisioning_tasks, isViewerUser, isRunningAutoEngine]);

  // Render Signal Bars helper matching Screenshot _D6CCC96A
  const renderSignalCell = (onu: OnuRecord) => {
    if (onu.phase_state === 'LOS' || onu.onu_rx_dbm === null) {
      return <span className="text-slate-500">-</span>;
    }
    const rx = onu.onu_rx_dbm;
    const isCritical = rx <= -30.0;
    const isWarning = rx <= -27.0 && rx > -30.0;
    return (
      <div className="flex items-center gap-1.5 font-mono text-xs text-slate-200">
        <span>{rx.toFixed(2)} dBm</span>
        <span className="inline-flex items-end gap-0.5">
          <span
            className={`h-1.5 w-0.5 ${
              isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`h-2.5 w-0.5 ${
              isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`h-3.5 w-0.5 ${
              isCritical ? 'bg-slate-600' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
        </span>
      </div>
    );
  };

  const selectedOlt =
    visibleOlts.find((o) => o.id === selectedOltId) ||
    visibleOlts[visibleOlts.length - 1] ||
    db.olts.find((o) => o.id === selectedOltId) ||
    db.olts[db.olts.length - 1];
  const selectedOnu =
    visibleOnus.find((o) => o.id === selectedOnuId) ||
    configuredOnus[1] ||
    configuredOnus[0];

  // ==========================================================================
  // FULL-SCREEN LOGIN PAGE WHEN NOT AUTHENTICATED (NO QUICK-LOGIN LEAKS)
  // ==========================================================================
  if (authChecking) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-[#060d18] px-4 py-8 text-slate-100"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 0%, rgba(14, 165, 233, 0.14) 0%, transparent 55%), radial-gradient(circle at 85% 80%, rgba(16, 185, 129, 0.08) 0%, transparent 50%), linear-gradient(180deg, #060d18 0%, #0a1424 100%)`,
        }}
      >
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800/90 bg-[#0b1526]/95 px-6 py-4 text-xs font-semibold text-sky-300 shadow-2xl backdrop-blur-md">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 ring-1 ring-sky-500/30">
            <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Memverifikasi Sesi Keamanan</div>
            <div className="text-[11px] font-normal text-slate-400">Menghubungkan ke server autentikasi...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#090d16] px-4 py-10 text-slate-100">
        <div className="w-full max-w-[400px]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl">
            {/* Clean Brand Header */}
            <div className="border-b border-slate-800/80 px-6 pt-7 pb-5 text-center sm:px-8">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
                <Wifi className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                {appBrandName}
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                GPON / XGPON OLT &amp; ONU Management Console
              </p>
            </div>

            {/* Login Form */}
            <form
              onSubmit={handleLoginSubmit}
              className="space-y-4 p-6 text-xs sm:p-8"
              autoComplete="off"
            >
              {loginError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-xs font-medium text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span>{loginError}</span>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Username atau Email
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Masukkan username atau email"
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 py-2.5 pr-3.5 pl-10 text-xs text-white placeholder-slate-500 transition focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Masukkan password"
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 py-2.5 pr-10 pl-10 text-xs text-white placeholder-slate-500 transition focus:border-sky-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((v) => !v)}
                    title={showLoginPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    aria-label={showLoginPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:text-white"
                  >
                    {showLoginPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
              >
                {loginLoading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Memverifikasi Kredensial...</span>
                  </>
                ) : (
                  <span>Sign In ke Dashboard</span>
                )}
              </button>
            </form>

            {/* Clean Footer */}
            <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/60 px-6 py-3 text-[11px] text-slate-400 sm:px-8">
              <span>Auto-Logout Idle 30m</span>
              <span className="font-mono text-[10px] text-slate-500">Asia/Jakarta (WIB)</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sidebarCategories = [
    {
      title: 'Overview & Monitoring',
      items: [
        {
          id: 'DASHBOARD',
          label: 'Dashboard',
          icon: LayoutDashboard,
          active: activeView === 'DASHBOARD',
          badge: null as string | number | null,
          badgeColor: '',
          onClick: () => setActiveView('DASHBOARD'),
        },
        {
          id: 'GRAPHS',
          label: 'Graphs (24h WIB)',
          icon: BarChart3,
          active: activeView === 'GRAPHS',
          badge: '5m',
          badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
          onClick: () => setActiveView('GRAPHS'),
        },
      ],
    },
    {
      title: 'ONU Provisioning',
      items: [
        {
          id: 'UNCONFIGURED',
          label: 'Unconfigured ONUs',
          icon: Radio,
          active: activeView === 'UNCONFIGURED' || activeView === 'AUTHORIZE_FORM',
          badge: unconfiguredOnus.length > 0 ? unconfiguredOnus.length : null,
          badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
          onClick: () => setActiveView('UNCONFIGURED'),
        },
        {
          id: 'CONFIGURED',
          label: 'Configured ONUs',
          icon: Wifi,
          active: activeView === 'CONFIGURED' || activeView === 'ONU_DETAIL',
          badge: configuredOnus.length,
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
          onClick: () => setActiveView('CONFIGURED'),
        },
      ],
    },
    {
      title: 'Infrastruktur & Distribusi',
      items: [
        {
          id: 'OLTS_LIST',
          label: 'OLT Devices',
          icon: Server,
          active:
            activeView === 'OLTS_LIST' ||
            activeView === 'OLT_DETAIL' ||
            activeView === 'ADD_OLT',
          badge: visibleOlts.length,
          badgeColor: 'bg-slate-700/80 text-slate-300 border-slate-600/50',
          onClick: () => setActiveView('OLTS_LIST'),
        },
        {
          id: 'ZONES',
          label: 'Zones (Wilayah)',
          icon: MapPin,
          active: activeView === 'ZONES',
          badge: visibleZones.length,
          badgeColor: 'bg-slate-700/80 text-slate-300 border-slate-600/50',
          onClick: () => setActiveView('ZONES'),
        },
        {
          id: 'SECTORS',
          label: 'Sectors / RK',
          icon: Layers,
          active: activeView === 'SECTORS',
          badge: visibleSectors.length,
          badgeColor: 'bg-slate-700/80 text-slate-300 border-slate-600/50',
          onClick: () => setActiveView('SECTORS'),
        },
        {
          id: 'SPLITTERS',
          label: 'Splitters (ODP)',
          icon: GitBranch,
          active: activeView === 'SPLITTERS',
          badge: visibleOdbs.length,
          badgeColor: 'bg-slate-700/80 text-slate-300 border-slate-600/50',
          onClick: () => setActiveView('SPLITTERS'),
        },
      ],
    },
    {
      title: 'Sistem & Administrasi',
      items: [
        ...(isAdminUser
          ? [
              {
                id: 'USERS',
                label: 'Users & Hak Akses',
                icon: Users,
                active: activeView === 'USERS',
                badge: db.users?.length || null,
                badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
                onClick: () => setActiveView('USERS'),
              },
            ]
          : []),
        {
          id: 'SPEED_PROFILES',
          label: 'Speed & ONU Types',
          icon: Sliders,
          active: activeView === 'SPEED_PROFILES',
          badge: null,
          badgeColor: '',
          onClick: () => setActiveView('SPEED_PROFILES'),
        },
        {
          id: 'VPN_TR069',
          label: 'VPN & TR-069 ACS',
          icon: Contrast,
          active: activeView === 'VPN_TR069',
          badge: null,
          badgeColor: '',
          onClick: () => setActiveView('VPN_TR069'),
        },
        {
          id: 'TASKS',
          label: 'Tasks & Log CLI',
          icon: Activity,
          active: activeView === 'TASKS',
          badge: null,
          badgeColor: '',
          onClick: () => setActiveView('TASKS'),
        },
        {
          id: 'DIAG_PARSER',
          label: 'CLI Diagnostics',
          icon: FileCode,
          active: activeView === 'DIAG_PARSER',
          badge: null,
          badgeColor: '',
          onClick: () => setActiveView('DIAG_PARSER'),
        },
        {
          id: 'SOURCE_CODE',
          label: 'SQL & Backend Code',
          icon: Code2,
          active: activeView === 'SOURCE_CODE',
          badge: null,
          badgeColor: '',
          onClick: () => setActiveView('SOURCE_CODE'),
        },
        ...(!isViewerUser
          ? [
              {
                id: 'BRAND_SETTINGS',
                label: 'Ubah Nama Brand / ISP',
                icon: Wifi,
                active: showEditBrandModal,
                badge: null,
                badgeColor: '',
                onClick: () => openEditBrandModal(),
              },
            ]
          : []),
      ],
    },
  ];

  const currentViewMeta: Record<NavigationView, { title: string; subtitle: string }> = {
    DASHBOARD: {
      title: 'Network Operations Overview',
      subtitle: 'Pemantauan real-time status OLT, ONU, sinyal optik, dan aktivitas jaringan (WIB).',
    },
    UNCONFIGURED: {
      title: 'Unconfigured ONUs Discovery',
      subtitle: 'Daftar ONU baru yang terdeteksi di port PON dan siap di-authorize.',
    },
    AUTHORIZE_FORM: {
      title: 'Authorize ONU Baru',
      subtitle: 'Konfigurasi profil layanan, VLAN, Zone, RK, dan ODP untuk ONU pelanggan.',
    },
    CONFIGURED: {
      title: 'Configured ONUs Inventory',
      subtitle: 'Manajemen seluruh ONU terdaftar, redaman sinyal optik, dan status operasional.',
    },
    ONU_DETAIL: {
      title: 'Detail & Diagnostik ONU',
      subtitle: 'Informasi lengkap antarmuka optik, WAN/PPPoE, VLAN, dan eksekusi perintah CLI.',
    },
    OLTS_LIST: {
      title: 'Manajemen Perangkat OLT',
      subtitle: 'Daftar perangkat ZTE C320/C300, koneksi Telnet/SSH, suhu, dan sinkronisasi konfigurasi.',
    },
    ADD_OLT: {
      title: 'Tambah Perangkat OLT Baru',
      subtitle: 'Registrasi perangkat OLT ZTE baru ke sistem manajemen.',
    },
    OLT_DETAIL: {
      title: 'Konfigurasi & Port OLT',
      subtitle: 'Manajemen kartu line-card, port PON, uplink, VLAN, dan running-config OLT.',
    },
    TASKS: {
      title: 'Tasks & Riwayat Eksekusi CLI',
      subtitle: 'Catatan audit log provisioning, otorisasi ONU, dan eksekusi script OLT.',
    },
    ZONES: {
      title: 'Manajemen Zones (Wilayah)',
      subtitle: 'Pengelompokan wilayah distribusi jaringan optik (dilindungi dari penghapusan jika masih memiliki ONU).',
    },
    SECTORS: {
      title: 'Manajemen Sectors / Rumah Kabel (RK)',
      subtitle: 'Pengelolaan titik distribusi RK/Sector dan penugasan hak akses operator.',
    },
    SPLITTERS: {
      title: 'Manajemen Optical Distribution Point (ODP / Splitter)',
      subtitle: 'Kapasitas port splitter optik dan keterkaitan ONU pelanggan.',
    },
    USERS: {
      title: 'User Management & Hak Akses (RBAC)',
      subtitle: 'Kelola akun pengguna serta pembatasan akses spesifik per OLT, Zone, dan RK/Sector.',
    },
    SPEED_PROFILES: {
      title: 'Speed Profiles & ONU Types',
      subtitle: 'Pengaturan profil bandwidth T-CONT/GEMPORT dan template perangkat ONU.',
    },
    VPN_TR069: {
      title: 'VPN Tunnel & TR-069 CWMP ACS',
      subtitle: 'Konfigurasi manajemen jarak jauh TR-069 dan konektivitas tunnel OLT.',
    },
    DIAG_PARSER: {
      title: 'ZTE CLI Output Parser & Sandbox',
      subtitle: 'Alat bantu uji coba parsing output CLI ZTE C320/C300 secara interaktif.',
    },
    GRAPHS: {
      title: 'Grafik Trafik Uplink & PON (24 Jam WIB)',
      subtitle: 'Visualisasi trafik jaringan dengan interval batang 5 menit serta rincian Harian, Mingguan, dan Tahunan.',
    },
    SOURCE_CODE: {
      title: 'Arsitektur SQL & Kode Sumber Backend',
      subtitle: 'Dokumentasi skema database dan modul integrasi Telnet/SSH.',
    },
  };

  return (
    <div
      className="min-h-screen bg-[#090d16] text-slate-100"
      onClick={() => {
        if (openDropdown) setOpenDropdown(null);
      }}
    >
      {/* CLEAN 3-ZONE TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
          {/* Zone 1 (Left): Mobile Drawer Trigger + Brand Wordmark */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition hover:border-slate-700 hover:text-white lg:hidden"
              title="Buka Menu Navigasi"
            >
              <Menu className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setActiveView('DASHBOARD')}
              className="flex items-center gap-2.5 text-left"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
                <Wifi className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
                {appBrandName}
              </span>
            </button>
          </div>

          {/* Zone 2 (Center): Clean Single-Line Navigation Links */}
          <nav className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => setActiveView('DASHBOARD')}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeView === 'DASHBOARD'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={() => setActiveView('UNCONFIGURED')}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeView === 'UNCONFIGURED' || activeView === 'AUTHORIZE_FORM'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <span>Unconfigured</span>
              {unconfiguredOnus.length > 0 && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                  {unconfiguredOnus.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveView('CONFIGURED')}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeView === 'CONFIGURED' || activeView === 'ONU_DETAIL'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              Configured
            </button>

            <button
              type="button"
              onClick={() => setActiveView('OLTS_LIST')}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeView === 'OLTS_LIST' ||
                activeView === 'OLT_DETAIL' ||
                activeView === 'ADD_OLT'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              OLTs
            </button>

            <button
              type="button"
              onClick={() => setActiveView('GRAPHS')}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeView === 'GRAPHS'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              Graphs
            </button>

            {/* Settings Dropdown for Secondary Views */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'SETTINGS' ? null : 'SETTINGS')
                }
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  openDropdown === 'SETTINGS' ||
                  activeView === 'ZONES' ||
                  activeView === 'SECTORS' ||
                  activeView === 'SPLITTERS' ||
                  activeView === 'USERS' ||
                  activeView === 'SPEED_PROFILES' ||
                  activeView === 'VPN_TR069' ||
                  activeView === 'TASKS' ||
                  activeView === 'DIAG_PARSER' ||
                  activeView === 'SOURCE_CODE'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <span>Lainnya</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </button>
              {openDropdown === 'SETTINGS' && (
                <div className="animate-modal-in absolute left-0 mt-1.5 w-52 rounded-xl border border-slate-800 bg-slate-900 p-1.5 text-xs shadow-2xl">
                  {[
                    { label: 'Zones (Wilayah)', view: 'ZONES' as NavigationView },
                    { label: 'Sectors (RK)', view: 'SECTORS' as NavigationView },
                    { label: 'Splitters (ODP)', view: 'SPLITTERS' as NavigationView },
                    ...(isAdminUser
                      ? [
                          {
                            label: 'Users & Hak Akses',
                            view: 'USERS' as NavigationView,
                          },
                        ]
                      : []),
                    { label: 'Speed & ONU Types', view: 'SPEED_PROFILES' as NavigationView },
                    { label: 'VPN & TR-069 ACS', view: 'VPN_TR069' as NavigationView },
                    { label: 'Tasks & Log CLI', view: 'TASKS' as NavigationView },
                    { label: 'CLI Diagnostics', view: 'DIAG_PARSER' as NavigationView },
                    { label: 'SQL & Backend Code', view: 'SOURCE_CODE' as NavigationView },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setActiveView(item.view);
                        setOpenDropdown(null);
                      }}
                      className={`block w-full rounded-lg px-3 py-1.5 text-left transition hover:bg-slate-800 hover:text-white ${
                        activeView === item.view
                          ? 'bg-sky-500/15 font-semibold text-sky-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  {!isViewerUser && (
                    <>
                      <div className="my-1 border-t border-slate-800" />
                      <button
                        type="button"
                        onClick={() => {
                          setOpenDropdown(null);
                          openEditBrandModal();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-sky-400 transition hover:bg-slate-800"
                      >
                        <Wifi className="h-3.5 w-3.5" />
                        Ubah Nama Brand / ISP
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenDropdown(null);
                          openBackupRestoreModal();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-emerald-400 transition hover:bg-slate-800"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Backup &amp; Restore
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </nav>

          {/* Zone 3 (Right): Idle Countdown + User Session + Logout */}
          <div className="flex items-center gap-2 text-slate-200">
            <div
              title="Auto-logout otomatis jika tidak ada aktivitas selama 30 menit"
              className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] sm:flex ${
                idleRemainingMs <= IDLE_WARNING_THRESHOLD_MS
                  ? 'border-amber-500/50 bg-amber-950/50 text-amber-300'
                  : 'border-slate-800 bg-slate-900/70 text-slate-400'
              }`}
            >
              <Clock className="h-3 w-3 text-slate-400" />
              <span>{formatRemainingIdleTime(idleRemainingMs)}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                if (isAdminUser) {
                  setActiveView('USERS');
                } else {
                  openChangePasswordModal(currentUser);
                }
              }}
              title={
                isAdminUser
                  ? 'Kelola User & Hak Akses'
                  : 'Klik untuk melihat profil & mengubah password akun Anda'
              }
              className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-white transition hover:border-slate-700 hover:bg-slate-800"
            >
              <User className="h-3.5 w-3.5 text-sky-400" />
              <span className="max-w-[90px] truncate">{currentUser.username}</span>
              <span
                className={`hidden rounded px-1.5 py-0.5 font-mono text-[10px] sm:inline-block ${
                  isViewerUser
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-sky-500/15 text-sky-300'
                }`}
              >
                {currentUser.role}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openChangePasswordModal(currentUser)}
              title="Ubah Password Akun Saya"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-sky-500/40 hover:bg-slate-800 hover:text-white"
            >
              <Lock className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden xl:inline">Ubah Password</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title="Keluar (Logout)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-950/40 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Idle Session Warning Banner (<= 2 minutes before auto-logout) */}
      {idleRemainingMs <= IDLE_WARNING_THRESHOLD_MS && (
        <div className="animate-modal-in fixed right-5 bottom-16 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-amber-500/50 bg-[#1c1607]/95 px-4 py-3 text-xs text-amber-100 shadow-2xl backdrop-blur-md">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex-1">
            <div className="font-bold text-amber-300">
              Sesi akan logout otomatis dalam {formatRemainingIdleTime(idleRemainingMs)}
            </div>
            <div className="text-[11px] text-amber-200/80">
              Tidak ada aktivitas terdeteksi (batas idle 30 menit).
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleExtendActiveSession()}
            className="shrink-0 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-amber-400"
          >
            Tetap Login
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="animate-modal-in fixed right-5 bottom-5 z-50 flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-[#0b1b30]/95 px-4 py-3 text-xs font-semibold text-emerald-200 shadow-2xl backdrop-blur-md">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Check className="h-3.5 w-3.5" />
          </div>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* MOBILE SIDEBAR DRAWER OVERLAY */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-xs" />
          <aside
            className="relative z-10 flex w-64 flex-col border-r border-slate-800 bg-[#091322] text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-white">
                  <Wifi className="h-4 w-4" />
                </div>
                <span className="font-bold tracking-tight text-white">{appBrandName}</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-3">
              {sidebarCategories.map((group) => (
                <div key={group.title}>
                  <div className="mb-1.5 px-2.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                    {group.title}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const IconComponent = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            item.onClick();
                            setMobileSidebarOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${
                            item.active
                              ? 'bg-sky-500/15 font-semibold text-sky-300 ring-1 ring-sky-500/30'
                              : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <IconComponent
                              className={`h-4 w-4 ${
                                item.active ? 'text-sky-400' : 'text-slate-400'
                              }`}
                            />
                            <span>{item.label}</span>
                          </span>
                          {item.badge !== null && (
                            <span
                              className={`rounded-md border px-1.5 py-0.2 font-mono text-[10px] font-semibold ${item.badgeColor}`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 p-3">
              <button
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  openChangePasswordModal(currentUser);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 py-2 text-xs font-semibold text-sky-300 transition hover:bg-slate-800 hover:text-white"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Ubah Password Saya</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* APP SHELL: COLLAPSIBLE SIDEBAR + MAIN PAGE CONTAINER */}
      <div className="mx-auto flex max-w-[1600px]">
        {/* DESKTOP COLLAPSIBLE SIDEBAR */}
        <aside
          className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r border-slate-800/80 bg-[#08111f]/75 backdrop-blur-xs transition-all duration-200 lg:flex ${
            sidebarCollapsed ? 'w-16' : 'w-60'
          }`}
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
            {sidebarCategories.map((group) => (
              <div key={group.title}>
                {!sidebarCollapsed && (
                  <div className="mb-1.5 px-2.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                    {group.title}
                  </div>
                )}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const IconComponent = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={item.onClick}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={`group flex w-full items-center ${
                          sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-2.5 py-2'
                        } rounded-xl text-left text-xs font-medium transition ${
                          item.active
                            ? 'bg-sky-500/15 font-semibold text-sky-300 ring-1 ring-sky-500/30 shadow-xs'
                            : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 truncate">
                          <IconComponent
                            className={`h-4 w-4 shrink-0 transition ${
                              item.active
                                ? 'text-sky-400'
                                : 'text-slate-400 group-hover:text-slate-200'
                            }`}
                          />
                          {!sidebarCollapsed && (
                            <span className="truncate">{item.label}</span>
                          )}
                        </span>
                        {!sidebarCollapsed && item.badge !== null && (
                          <span
                            className={`ml-2 rounded-md border px-1.5 py-0.2 font-mono text-[10px] font-semibold ${item.badgeColor}`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar Footer: Access Scope Summary & Collapse Button */}
          <div className="border-t border-slate-800/80 p-2.5">
            {!sidebarCollapsed && (
              <div className="mb-2 rounded-xl border border-slate-800/90 bg-[#0b1628] p-2.5 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-slate-200">
                  <span className="truncate">{currentUser.full_name}</span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 font-mono text-[9px] text-emerald-300">
                    ONLINE
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  Scope: {currentUser.access_all_olts ? 'All OLT' : `${visibleOlts.length} OLT`} ·{' '}
                  {currentUser.access_all_zones ? 'All Zone' : `${visibleZones.length} Zone`} ·{' '}
                  {currentUser.access_all_rks ? 'All RK' : `${visibleSectors.length} RK`}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={toggleSidebarCollapse}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 py-1.5 text-xs font-medium text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
              title={sidebarCollapsed ? 'Perluas Sidebar' : 'Kecilkan Sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-3.5 w-3.5" />
                  <span>Collapse Sidebar</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* MAIN PAGE CONTAINER */}
        <main className="min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 lg:pb-8">
          {/* Contextual Page Header Bar */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                <span className="text-sky-400">{appBrandName}</span>
                <span>·</span>
                <span className="font-mono uppercase">{activeView.replace('_', ' ')}</span>
              </div>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-white sm:text-xl">
                {currentViewMeta[activeView]?.title || 'SmartOLT Management'}
              </h1>
              <p className="text-xs text-slate-400">
                {currentViewMeta[activeView]?.subtitle}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isViewerUser && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-300">
                  Mode Viewer (Hanya Lihat)
                </span>
              )}
              {!isViewerUser &&
                db.olts.length > 0 &&
                (activeView === 'CONFIGURED' || activeView === 'DASHBOARD') && (
                  <button
                    type="button"
                    disabled={isSyncingAllOnus}
                    onClick={() => {
                      const targetOltId =
                        filterOlt !== 'ANY'
                          ? Number(filterOlt)
                          : selectedOltId || db.olts[0].id;
                      const targetOlt =
                        db.olts.find((o) => o.id === targetOltId) || db.olts[0];
                      if (targetOlt) {
                        void syncOltFromTelnetLive(targetOlt.id, targetOlt);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        isSyncingAllOnus ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {isSyncingAllOnus
                        ? 'Menarik ONU dari OLT...'
                        : 'Sync ONU dari OLT'}
                    </span>
                  </button>
                )}
              {!isViewerUser && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch('/api/state/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ state: db }),
                      });
                      showToast(
                        `State synced to ${dbMeta.dbEngine} Database (${db.olts.length} OLTs, ${configuredOnus.length} ONUs).`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                  >
                    <Save className="h-3.5 w-3.5 text-sky-400" />
                    <span className="hidden sm:inline">Save DB</span>
                  </button>
                  <button
                    type="button"
                    onClick={openBackupRestoreModal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                  >
                    <Database className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">Backup</span>
                  </button>
                </>
              )}
              {unconfiguredOnus.length > 0 && activeView !== 'UNCONFIGURED' && (
                <button
                  type="button"
                  onClick={() => setActiveView('UNCONFIGURED')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-900/50 hover:text-white"
                >
                  <Radio className="h-3.5 w-3.5 text-amber-400" />
                  <span>{unconfiguredOnus.length} Waiting Auth</span>
                </button>
              )}
            </div>
          </div>

          {/* ===================================================================
              VIEW 1: DASHBOARD (Clean SaaS KPI Cards & Telemetry Panels)
             =================================================================== */}
          {activeView === 'DASHBOARD' && (
            <div className="space-y-5">
              {/* Top 5 Clean Single-Elevation KPI Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {/* Card 1: Waiting authorization */}
                <div
                  onClick={() => setActiveView('UNCONFIGURED')}
                  className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-sky-500/40 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span>Waiting Authorization</span>
                    <Radio className="h-4 w-4 text-sky-400" />
                  </div>
                  <div className="mt-2 font-mono text-3xl font-bold tracking-tight text-white">
                    {unconfiguredOnus.length}
                  </div>
                  <div className="mt-3 border-t border-slate-800/80 pt-2.5 font-mono text-[11px] text-slate-400">
                    Discovered · <span className="text-sky-400">New {unconfiguredOnus.length}</span>
                  </div>
                </div>

                {/* Card 2: Online ONUs */}
                <div
                  onClick={() => {
                    setFilterPhaseStatus('ONLINE');
                    setFilterSignalLevel('ALL');
                    setConfiguredOnusPage(1);
                    setActiveView('CONFIGURED');
                  }}
                  className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-emerald-500/40 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span>Online ONUs</span>
                    <Wifi className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 font-mono text-3xl font-bold tracking-tight text-white">
                    {onlineOnus.length}
                  </div>
                  <div className="mt-3 border-t border-slate-800/80 pt-2.5 font-mono text-[11px] text-slate-400">
                    Active ·{' '}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterPhaseStatus('ALL');
                        setFilterSignalLevel('ALL');
                        setConfiguredOnusPage(1);
                        setActiveView('CONFIGURED');
                      }}
                      className="text-emerald-400 hover:underline"
                      title="Lihat semua Authorized ONU"
                    >
                      Authorized {configuredOnus.length}
                    </span>
                  </div>
                </div>

                {/* Card 3: Total Offline (Khusus ONU Offline: PwrFail & N/A) */}
                <div
                  onClick={() => {
                    setFilterPhaseStatus('OFFLINE');
                    setFilterSignalLevel('ALL');
                    setConfiguredOnusPage(1);
                    setActiveView('CONFIGURED');
                  }}
                  className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-slate-600 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span>Total Offline</span>
                    <Power className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="mt-2 font-mono text-3xl font-bold tracking-tight text-white">
                    {totalOfflineCount}
                  </div>
                  <div className="mt-3 border-t border-slate-800/80 pt-2.5 font-mono text-[11px] text-slate-400">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterPhaseStatus('PWRFAIL');
                        setFilterSignalLevel('ALL');
                        setConfiguredOnusPage(1);
                        setActiveView('CONFIGURED');
                      }}
                      className="text-amber-400 hover:underline"
                      title="Filter ONU Power Fail (DyingGasp)"
                    >
                      PwrFail {pwrFailOnus.length}
                    </span>{' '}
                    ·{' '}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterPhaseStatus('OFFLINE_NA');
                        setFilterSignalLevel('ALL');
                        setConfiguredOnusPage(1);
                        setActiveView('CONFIGURED');
                      }}
                      className="text-slate-300 hover:underline"
                      title="Filter ONU Offline / N/A"
                    >
                      Offline/N/A {otherOfflineOnus.length}
                    </span>
                  </div>
                </div>

                {/* Card 4: ONU Loss (Khusus ONU dengan status LOS) */}
                <div
                  onClick={() => {
                    setFilterPhaseStatus('LOS');
                    setFilterSignalLevel('ALL');
                    setConfiguredOnusPage(1);
                    setActiveView('CONFIGURED');
                  }}
                  className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-rose-500/40 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span>ONU Loss</span>
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                  </div>
                  <div className="mt-2 font-mono text-3xl font-bold tracking-tight text-white">
                    {losOnus.length}
                  </div>
                  <div className="mt-3 border-t border-slate-800/80 pt-2.5 font-mono text-[11px] text-slate-400">
                    Optical LoS · <span className="text-rose-400">Loss {losOnus.length}</span>
                  </div>
                </div>

                {/* Card 5: Low signals (Redaman > 27 dB / <= -27.0 dBm) */}
                <div
                  onClick={() => {
                    setFilterPhaseStatus('ALL');
                    setFilterSignalLevel('LOW');
                    setConfiguredOnusPage(1);
                    setActiveView('CONFIGURED');
                  }}
                  className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-amber-500/40 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                    <span>Low Signals</span>
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="mt-2 font-mono text-3xl font-bold tracking-tight text-white">
                    {totalLowSignalCount}
                  </div>
                  <div className="mt-3 border-t border-slate-800/80 pt-2.5 font-mono text-[11px] text-slate-400">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterPhaseStatus('ALL');
                        setFilterSignalLevel('WARNING');
                        setConfiguredOnusPage(1);
                        setActiveView('CONFIGURED');
                      }}
                      className="text-amber-400 hover:underline"
                      title="Filter Warning (-27 s/d -30 dBm)"
                    >
                      Warning {warningSignalOnus.length}
                    </span>{' '}
                    ·{' '}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterPhaseStatus('ALL');
                        setFilterSignalLevel('CRITICAL');
                        setConfiguredOnusPage(1);
                        setActiveView('CONFIGURED');
                      }}
                      className="text-rose-400 hover:underline"
                      title="Filter Critical (<= -30 dBm)"
                    >
                      Critical {criticalSignalOnus.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Middle Row: Network status chart + OLTs online */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Network status area graph */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 lg:col-span-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-sky-400" />
                      <span className="text-sm font-semibold text-white">
                        Network Status Telemetry
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('GRAPHS')}
                      className="text-xs font-medium text-sky-400 transition hover:text-sky-300"
                    >
                      Buka Graphs 24h →
                    </button>
                  </div>

                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-3.5">
                    <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                      <span>Hourly Optical Health</span>
                      <span className="font-semibold text-slate-200">
                        Total: {configuredOnus.length} ONUs
                      </span>
                    </div>
                    <div className="mt-3 flex h-32 items-end gap-1 border-b border-l border-slate-800 pt-4 pl-1">
                      {Array.from({ length: 36 }, (_, i) => (
                        <div
                          key={i}
                          className="flex h-full flex-1 flex-col justify-end overflow-hidden rounded-t-[2px]"
                        >
                          <div
                            className="w-full bg-amber-500/85 transition-all"
                            style={{
                              height: totalLowSignalCount > 0 ? '14%' : '0%',
                            }}
                          />
                          <div
                            className="w-full bg-emerald-500/85 transition-all"
                            style={{
                              height: onlineOnus.length > 0 ? '76%' : '4%',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
                      <span className="text-emerald-400">Online: {onlineOnus.length}</span>
                      <span className="text-amber-400">Low signal: {totalLowSignalCount}</span>
                      <span className="text-rose-400">LOS: {losOnus.length}</span>
                      <span className="text-sky-400">Power fail: {pwrFailOnus.length}</span>
                    </div>
                  </div>
                </div>

                {/* OLTs online list */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 lg:col-span-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-emerald-400" />
                      <span className="text-sm font-semibold text-white">OLT Chassis</span>
                      <span className="font-mono text-xs text-emerald-400">
                        · {visibleOlts.filter((o) => o.status === 'ONLINE').length}/{visibleOlts.length} online
                      </span>
                    </div>
                    {isAdminUser && (
                      <button
                        type="button"
                        onClick={() => setActiveView('ADD_OLT')}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add OLT
                      </button>
                    )}
                  </div>

                  {visibleOlts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
                      <p className="font-semibold text-white">
                        {db.olts.length === 0
                          ? `Belum ada OLT terdaftar di Database (${dbMeta.dbEngine}).`
                          : 'Tidak ada OLT yang di-assign ke akun Anda.'}
                      </p>
                      <p className="mt-1">
                        {db.olts.length === 0
                          ? 'Klik tombol + Add OLT untuk menghubungkan OLT baru.'
                          : 'Hubungi Administrator untuk memberikan akses OLT pada akun Anda.'}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/80 text-xs">
                      {visibleOlts.map((o) => {
                        const isOnline = o.status === 'ONLINE';
                        return (
                          <div
                            key={o.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  isOnline
                                    ? 'bg-emerald-400'
                                    : 'bg-rose-500 animate-pulse'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedOltId(o.id);
                                  setInitialOltTab('OLT_DETAILS');
                                  setActiveView('OLT_DETAIL');
                                }}
                                className="font-semibold text-sky-400 transition hover:text-sky-300 hover:underline"
                              >
                                {o.id} - {o.name}{' '}
                                <span className="font-mono text-slate-400">({o.ip_address})</span>
                              </button>
                              <span
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                  isOnline
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-rose-500/15 text-rose-400'
                                }`}
                              >
                                {isOnline ? 'Online' : 'Offline'}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
                              {!isViewerUser && (
                                <button
                                  type="button"
                                  onClick={() => void syncOltFromTelnetLive(o.id, o)}
                                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 font-sans text-[11px] font-medium text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Sync OLT
                                </button>
                              )}
                              {isOnline ? (
                                <>
                                  <span className="text-slate-400">{o.uptime_str}</span>
                                  <span className="text-slate-600">·</span>
                                  <span
                                    className={
                                      o.temperature_c >= 50
                                        ? 'text-rose-400'
                                        : o.temperature_c >= 42
                                          ? 'text-amber-400'
                                          : 'text-emerald-400'
                                    }
                                  >
                                    {o.temperature_c}°C
                                  </span>
                                </>
                              ) : (
                                <span className="text-rose-400">Unreachable (TCP {o.telnet_port})</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Row: PON outage + Provisioning activity feed */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* PON outage */}
                <div className="space-y-2.5 lg:col-span-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">PON Outage &amp; Alarms</span>
                    <span className="font-mono text-xs text-rose-400">
                      {criticalSignalOnus.length + losOnus.length} critical
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
                    {criticalSignalOnus.length === 0 && losOnus.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-slate-400">
                        Tidak ada PON outage atau sinyal kritis pada database saat ini.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-800 bg-slate-900/90 text-[11px] text-slate-400">
                            <tr>
                              <th className="px-3.5 py-2.5">OLT</th>
                              <th className="px-3.5 py-2.5">ONU / PON</th>
                              <th className="px-3.5 py-2.5">SN</th>
                              <th className="px-3.5 py-2.5">State</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {[...losOnus, ...pwrFailOnus, ...otherOfflineOnus, ...criticalSignalOnus]
                              .slice(0, 6)
                              .map((item) => {
                                const o = db.olts.find((x) => x.id === item.olt_id);
                                return (
                                  <tr key={item.id} className="hover:bg-slate-800/40">
                                    <td className="px-3.5 py-2 font-medium text-slate-200">
                                      {o ? `${o.id} - ${o.name}` : `OLT ${item.olt_id}`}
                                    </td>
                                    <td className="px-3.5 py-2 font-medium text-sky-400">
                                      1/{item.board}/{item.port}:{item.onu_index} ({item.customer_name})
                                    </td>
                                    <td className="px-3.5 py-2 font-mono text-slate-300">
                                      {item.serial_number}
                                    </td>
                                    <td className="px-3.5 py-2 font-mono text-[11px]">
                                      <span
                                        className={
                                          item.phase_state === 'LOS'
                                            ? 'font-semibold text-rose-400'
                                            : item.phase_state === 'DyingGasp'
                                              ? 'font-semibold text-amber-400'
                                              : 'text-orange-400'
                                        }
                                      >
                                        {item.phase_state === 'LOS'
                                          ? 'LOS'
                                          : item.phase_state === 'DyingGasp'
                                            ? 'Power fail'
                                            : item.phase_state !== 'working'
                                              ? 'Offline'
                                              : `${item.onu_rx_dbm} dBm`}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Provisioning & System Activity */}
                <div className="space-y-2.5 lg:col-span-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">Provisioning Activity</span>
                    <button
                      type="button"
                      onClick={() => setActiveView('TASKS')}
                      className="text-xs font-medium text-sky-400 hover:text-sky-300"
                    >
                      Lihat Semua →
                    </button>
                  </div>
                  <div className="divide-y divide-slate-800/70 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 text-xs">
                    {db.provisioning_logs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-slate-400">
                        Belum ada riwayat aktivitas provisioning di database.
                      </div>
                    ) : (
                      db.provisioning_logs.slice(0, 6).map((log) => {
                        const logOlt = db.olts.find((o) => o.id === log.olt_id);
                        return (
                          <div
                            key={log.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-800/40"
                          >
                            <div>
                              <span className="font-mono font-medium text-sky-400">
                                {log.summary_text ||
                                  `${log.interface_target} ${log.action_type}`}
                              </span>{' '}
                              <span className="text-slate-400">
                                · {log.olt_id} - {logOlt?.name || 'OLT'}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {log.executed_by} · {log.created_at}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* ===================================================================
            VIEW 2: UNCONFIGURED ONUS (Responsive Table + Mobile Cards)
           =================================================================== */}
        {activeView === 'UNCONFIGURED' && (
          <div className="space-y-5 text-xs">
            {/* Responsive Filter & Action Bar */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-semibold text-slate-300">OLT</span>
                <select
                  value={uncfgOltFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setUncfgOltFilter(val === 'ALL' ? 'ALL' : Number(val));
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="ALL">All selected ({visibleOlts.length})</option>
                  {visibleOlts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} - {o.name}
                    </option>
                  ))}
                </select>
                {!isViewerUser && (
                  <>
                    <button
                      type="button"
                      disabled={isPollingUncfg}
                      onClick={() => {
                        void pollUnconfiguredOnusOnly(uncfgOltFilter);
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isPollingUncfg ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {isPollingUncfg
                          ? 'Scanning OLT...'
                          : 'Scan Unconfigured (Telnet)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (visibleOlts.length === 0) {
                          showToast('Tambahkan OLT terlebih dahulu sebelum mendeteksi ONU.');
                          setActiveView('ADD_OLT');
                          return;
                        }
                        setManualUncfgOltId(
                          uncfgOltFilter === 'ALL' ? visibleOlts[0].id : uncfgOltFilter
                        );
                        setShowAddUncfgModal(true);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Register SN</span>
                    </button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                  {!isViewerUser && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setUncfgSubView('TASKS');
                        setOpenTaskWizardSignal(Date.now());
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Task</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAutoActionsModal(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                    >
                      <Play className="h-3 w-3 text-emerald-400" />
                      <span>Auto Auth ({autoAuthEnabled ? 'ON' : 'OFF'})</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setActiveView('TASKS')}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <History className="h-3 w-3 text-sky-400" />
                  <span>Task History</span>
                </button>
              </div>
            </div>

            {/* Sub-Menu Navigation inside Unconfigured ONU */}
            <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80 p-2 shadow-sm">
              <button
                type="button"
                onClick={() => setUncfgSubView('UNCONFIGURED_LIST')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  uncfgSubView === 'UNCONFIGURED_LIST'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Radio className="h-3.5 w-3.5" />
                <span>Unconfigured ONU ({unconfiguredOnus.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setUncfgSubView('TASKS')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  uncfgSubView === 'TASKS'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>
                  Auto Configuration Tasks (
                  {(db.auto_provisioning_tasks || []).length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setUncfgSubView('HISTORY')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  uncfgSubView === 'HISTORY'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span>
                  Provisioning History (
                  {(db.auto_provisioning_history || []).length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setUncfgSubView('FAILED')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  uncfgSubView === 'FAILED'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>
                  Failed Provisioning (
                  {
                    (db.auto_provisioning_history || []).filter(
                      (h) => h.status === 'FAILED'
                    ).length
                  }
                  )
                </span>
              </button>
            </div>

            {uncfgSubView !== 'UNCONFIGURED_LIST' ? (
              <AutoProvisioningTaskManager
                key={uncfgSubView}
                db={db}
                setDb={(updater) => {
                  nextSyncIsUserMutationRef.current = true;
                  lastUserMutationAtRef.current = Date.now();
                  setDb(updater);
                }}
                isReadOnlyViewer={isViewerUser}
                currentUsername={currentUser?.username || 'admin'}
                unconfiguredOnus={unconfiguredOnus}
                isRunningAutoEngine={isRunningAutoEngine}
                onRunAutoProvisioningNow={handleRunAutoProvisioningBatch}
                onRetryFailedRecord={handleRetryFailedProvisioning}
                initialSubTab={uncfgSubView}
                openWizardSignal={openTaskWizardSignal}
              />
            ) : (
              <>
                {lastUncfgCliOutput && (
                  <div className="rounded-xl border border-sky-500/30 bg-slate-950 p-3.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-sky-300">
                        Output Perintah OLT (`show gpon onu uncfg`)
                      </span>
                      <button
                        type="button"
                        onClick={() => setLastUncfgCliOutput(null)}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Tutup
                      </button>
                    </div>
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-emerald-300">
                      {lastUncfgCliOutput}
                    </pre>
                  </div>
                )}

                {/* Per-OLT Unconfigured Sections */}
                <div className="space-y-4">
                  {(uncfgOltFilter === 'ALL'
                    ? visibleOlts
                    : visibleOlts.filter((o) => o.id === uncfgOltFilter)
                  ).map((oltItem) => {
                    const isOltOnline = oltItem.status === 'ONLINE';
                    const oltUncfg = isOltOnline
                      ? unconfiguredOnus.filter((u) => u.olt_id === oltItem.id)
                      : [];
                    return (
                      <div key={oltItem.id} className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isOltOnline
                                  ? 'bg-emerald-400'
                                  : 'bg-rose-500 animate-pulse'
                              }`}
                            />
                            <span>
                              {oltItem.id} - {oltItem.name}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                isOltOnline
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-rose-500/15 text-rose-400'
                              }`}
                            >
                              {isOltOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400">
                            {isOltOnline
                              ? `${oltUncfg.length} discovered`
                              : '0 discovered (OLT Offline)'}
                          </span>
                        </div>
                        {!isOltOnline ? (
                          <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 px-3.5 py-2.5 text-xs text-rose-300">
                            OLT <span className="font-semibold">{oltItem.name}</span> ({oltItem.ip_address}:{oltItem.telnet_port}) sedang dalam keadaan <span className="font-semibold text-rose-400">Offline / Mati</span>. Tidak ada ONU unconfigured yang aktif.
                          </div>
                        ) : oltUncfg.length === 0 ? (
                          <div className="px-2 py-2 text-xs text-slate-400">
                            No unconfigured ONUs found on this OLT.
                          </div>
                        ) : (
                          <>
                            {/* Mobile Card List (md:hidden) */}
                            <div className="grid grid-cols-1 gap-2.5 md:hidden">
                              {oltUncfg.map((u) => {
                                const taskMatch = matchAutoProvisioningTaskForOnu(
                                  u,
                                  db.auto_provisioning_tasks || []
                                );
                                const waitInfo = getUnconfiguredWaitingInfo(
                                  u,
                                  uncfgNowMs
                                );
                                return (
                                  <div
                                    key={u.id}
                                    className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="space-y-1">
                                        <div className="font-mono text-sm font-bold text-white">
                                          {u.serial_number}
                                        </div>
                                        <div className="font-mono text-[11px] text-slate-400">
                                          GPON · Board {u.board} · Port {u.port} ·{' '}
                                          {u.onu_type}
                                        </div>
                                        <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-300">
                                          <Clock className="h-3 w-3 text-amber-400" />
                                          <span className="font-semibold">
                                            {waitInfo.durationText}
                                          </span>
                                          <span className="text-slate-400">·</span>
                                          <span className="text-[10px] text-slate-300">
                                            {waitInfo.sinceText}
                                          </span>
                                        </div>
                                      </div>
                                      {!isViewerUser ? (
                                        <div className="flex items-center gap-1.5">
                                          {taskMatch.matchedTask && (
                                            <button
                                              type="button"
                                              disabled={isRunningAutoEngine}
                                              onClick={() =>
                                                void handleRunAutoProvisioningBatch(
                                                  u,
                                                  taskMatch.matchedTask!.id
                                                )
                                              }
                                              className="rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                                            >
                                              Auto Task
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setAuthorizingOnu(u);
                                              setActiveView('AUTHORIZE_FORM');
                                            }}
                                            className="rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                                          >
                                            Authorize
                                          </button>
                                        </div>
                                      ) : (
                                        <span className="text-[11px] text-slate-500">
                                          Read-Only
                                        </span>
                                      )}
                                    </div>
                                    {taskMatch.matchedTask && (
                                      <div className="text-[11px] text-emerald-700 font-semibold">
                                        Matched Task: {taskMatch.matchedTask.name} (VLAN{' '}
                                        {taskMatch.matchedTask.vlan_id})
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Desktop Table (hidden md:block) */}
                            <div className="hidden overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70 md:block">
                              <table className="w-full text-left text-xs">
                                <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
                                  <tr>
                                    <th className="px-4 py-2.5">PON type</th>
                                    <th className="px-4 py-2.5">Board</th>
                                    <th className="px-4 py-2.5">Port</th>
                                    <th className="px-4 py-2.5">Model</th>
                                    <th className="px-4 py-2.5">SN</th>
                                    <th className="px-4 py-2.5">Lama Terdeteksi (Waiting)</th>
                                    <th className="px-4 py-2.5">Matched Auto Task</th>
                                    <th className="px-4 py-2.5 text-right">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                  {oltUncfg.map((u) => {
                                    const taskMatch =
                                      matchAutoProvisioningTaskForOnu(
                                        u,
                                        db.auto_provisioning_tasks || []
                                      );
                                    const waitInfo = getUnconfiguredWaitingInfo(
                                      u,
                                      uncfgNowMs
                                    );
                                    return (
                                      <tr
                                        key={u.id}
                                        className="hover:bg-slate-800/40"
                                      >
                                        <td className="px-4 py-2.5 text-slate-300">
                                          GPON
                                        </td>
                                        <td className="px-4 py-2.5 font-mono text-white">
                                          {u.board}
                                        </td>
                                        <td className="px-4 py-2.5 font-mono text-white">
                                          {u.port}
                                        </td>
                                        <td className="px-4 py-2.5 font-mono text-slate-300">
                                          {u.onu_type}
                                        </td>
                                        <td className="px-4 py-2.5 font-mono font-semibold text-white">
                                          {u.serial_number}
                                        </td>
                                        <td className="px-4 py-2.5">
                                          <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300">
                                            <Clock className="h-3 w-3 text-amber-400" />
                                            <span className="font-semibold text-amber-200">
                                              {waitInfo.durationText}
                                            </span>
                                            <span className="text-slate-500">·</span>
                                            <span className="text-[10px] text-slate-400">
                                              {waitInfo.sinceText}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-2.5">
                                          {taskMatch.conflictReason ? (
                                            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
                                              <AlertTriangle className="h-3 w-3" />
                                              Task Priority Conflict
                                            </span>
                                          ) : taskMatch.matchedTask ? (
                                            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                                              {taskMatch.matchedTask.name} • VLAN{' '}
                                              {taskMatch.matchedTask.vlan_id} (#
                                              {taskMatch.matchedTask.priority})
                                            </span>
                                          ) : (
                                            <span className="text-[11px] text-slate-400">
                                              No matching active task
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                          {!isViewerUser ? (
                                            <div className="inline-flex items-center justify-end gap-1.5">
                                              {taskMatch.matchedTask && (
                                                <button
                                                  type="button"
                                                  disabled={isRunningAutoEngine}
                                                  onClick={() =>
                                                    void handleRunAutoProvisioningBatch(
                                                      u,
                                                      taskMatch.matchedTask!.id
                                                    )
                                                  }
                                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer disabled:opacity-50"
                                                >
                                                  Run Task
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setAuthorizingOnu(u);
                                                  setActiveView('AUTHORIZE_FORM');
                                                }}
                                                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 cursor-pointer"
                                              >
                                                Authorize
                                              </button>
                                            </div>
                                          ) : (
                                            <span className="text-[11px] text-slate-500">
                                              Read-Only
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ===================================================================
            VIEW 3: AUTHORIZE ONU FORM PAGE
           =================================================================== */}
        {activeView === 'AUTHORIZE_FORM' && authorizingOnu && !isViewerUser && (
          <AuthorizeOnuModal
            onu={authorizingOnu}
            db={scopedDb}
            onClose={() => setActiveView('UNCONFIGURED')}
            onConfirmAuthorize={handleConfirmAuthorize}
            onQuickAddZone={handleQuickAddZone}
            onQuickAddSector={handleQuickAddSector}
            onQuickAddSplitter={handleQuickAddSplitter}
          />
        )}

        {/* ===================================================================
            VIEW 4: CONFIGURED ONUS (Responsive Filter Grid + Mobile Cards + Table)
           =================================================================== */}
        {activeView === 'CONFIGURED' && (
          <div className="space-y-4 text-xs">
            {/* Real-Time OLT Disconnect Notification Banner */}
            {(() => {
              const targetOltsForBanner =
                filterOlt === 'ANY'
                  ? visibleOlts
                  : visibleOlts.filter((o) => o.id === Number(filterOlt));
              const disconnectedOlts = targetOltsForBanner.filter(
                (o) => o.status === 'OFFLINE'
              );
              if (disconnectedOlts.length === 0) return null;
              return (
                <div className="flex flex-col justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-rose-200 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/15">
                      <AlertTriangle className="h-4 w-4 text-rose-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                        <span className="text-xs font-bold tracking-wide text-rose-300">
                          OLT Disconnect ({disconnectedOlts.length} perangkat tidak terhubung)
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-rose-200/85">
                        Koneksi ke OLT terputus atau perangkat dalam keadaan mati. Seluruh ONU pada OLT yang disconnect otomatis berstatus <span className="font-semibold text-white">Offline</span> sampai koneksi OLT kembali normal.
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {disconnectedOlts.map((offOlt) => {
                          const affectedCount = configuredOnus.filter(
                            (u) => u.olt_id === offOlt.id
                          ).length;
                          return (
                            <span
                              key={offOlt.id}
                              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/35 bg-slate-950/70 px-2 py-0.5 font-mono text-[11px] text-rose-200"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              <span className="font-semibold text-white">
                                {offOlt.id} - {offOlt.name}
                              </span>
                              <span className="text-rose-300/80">
                                ({offOlt.ip_address}:{offOlt.telnet_port})
                              </span>
                              <span className="text-slate-500">·</span>
                              <span className="text-rose-300">{affectedCount} ONU</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void pollOltRealtimeStatus();
                        showToast('Memeriksa ulang status koneksi OLT secara real-time...');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-600/20 px-3 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-600/35 hover:text-white cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Cek Ulang
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('OLTS_LIST')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white cursor-pointer"
                    >
                      <Server className="h-3.5 w-3.5 text-rose-400" />
                      Lihat OLT
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Clean Responsive Filter Panel */}
            <div className="space-y-3.5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Search ONU
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Nama, SN, PPPoE, IP..."
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    OLT
                  </label>
                  <select
                    value={filterOlt}
                    onChange={(e) => setFilterOlt(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Semua OLT</option>
                    {visibleOlts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.id} - {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Board
                  </label>
                  <select
                    value={filterBoard}
                    onChange={(e) => setFilterBoard(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Semua</option>
                    <option value="2">Board 2</option>
                    <option value="3">Board 3</option>
                    <option value="4">Board 4</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Port PON
                  </label>
                  <select
                    value={filterPort}
                    onChange={(e) => setFilterPort(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Semua</option>
                    {Array.from({ length: 16 }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>
                        Port {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Zone
                  </label>
                  <select
                    value={filterZone}
                    onChange={(e) => setFilterZone(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Semua Zone</option>
                    {visibleZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Splitter / ODP
                  </label>
                  <select
                    value={filterSplitter}
                    onChange={(e) => setFilterSplitter(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Semua ODP</option>
                    {visibleOdbs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    VLAN
                  </label>
                  <select
                    value={filterVlan}
                    onChange={(e) => setFilterVlan(e.target.value)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="ANY">Semua VLAN</option>
                    {db.vlans.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vlan_id} - {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: Segmented Status Filter + Signal Filter + Reset */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-400">Status:</span>
                    <div className="inline-flex flex-wrap rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                      {(
                        [
                          { id: 'ALL', label: 'ALL' },
                          { id: 'ONLINE', label: `ONLINE (${onlineOnus.length})` },
                          { id: 'OFFLINE', label: `OFFLINE (${totalOfflineCount})` },
                          { id: 'LOS', label: `ONU LOSS (${losOnus.length})` },
                          { id: 'PWRFAIL', label: `PWRFAIL (${pwrFailOnus.length})` },
                          { id: 'OFFLINE_NA', label: `N/A (${otherOfflineOnus.length})` },
                        ] as const
                      ).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            setFilterPhaseStatus(st.id);
                            setConfiguredOnusPage(1);
                          }}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                            filterPhaseStatus === st.id
                              ? st.id === 'LOS'
                                ? 'bg-rose-600 text-white'
                                : st.id === 'ONLINE'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-400">Signal:</span>
                    <div className="inline-flex flex-wrap rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                      {(
                        [
                          { id: 'ALL', label: 'ALL' },
                          { id: 'LOW', label: `LOW >27dB (${totalLowSignalCount})` },
                          { id: 'GOOD', label: 'GOOD' },
                          { id: 'WARNING', label: `WARNING (${warningSignalOnus.length})` },
                          { id: 'CRITICAL', label: `CRITICAL (${criticalSignalOnus.length})` },
                        ] as const
                      ).map((lvl) => (
                        <button
                          key={lvl.id}
                          type="button"
                          onClick={() => {
                            setFilterSignalLevel(lvl.id);
                            setConfiguredOnusPage(1);
                          }}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                            filterSignalLevel === lvl.id
                              ? lvl.id === 'LOW' || lvl.id === 'WARNING'
                                ? 'bg-amber-600 text-white'
                                : lvl.id === 'CRITICAL'
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {lvl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterOlt('ANY');
                    setFilterBoard('ANY');
                    setFilterPort('ANY');
                    setFilterZone('ANY');
                    setFilterSplitter('ANY');
                    setFilterVlan('ANY');
                    setFilterPhaseStatus('ALL');
                    setFilterSignalLevel('ALL');
                    setConfiguredOnusPage(1);
                  }}
                  className="text-xs font-medium text-slate-400 transition hover:text-white"
                >
                  Reset Filters
                </button>
              </div>
            </div>

            {/* Pagination Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  {activeConfiguredPage > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfiguredOnusPage((p) => Math.max(1, p - 1))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      ‹
                    </button>
                  )}
                  {buildVisiblePageNumbers(
                    activeConfiguredPage,
                    totalConfiguredPages
                  ).map((item, idx) =>
                    item === '...' ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-slate-500">
                        ...
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setConfiguredOnusPage(item)}
                        className={`rounded-lg px-2.5 py-1 font-mono transition ${
                          activeConfiguredPage === item
                            ? 'bg-sky-600 font-semibold text-white'
                            : 'border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                  {activeConfiguredPage < totalConfiguredPages && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfiguredOnusPage((p) =>
                          Math.min(totalConfiguredPages, p + 1)
                        )
                      }
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      ›
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                  <span>Show:</span>
                  {([50, 100, 1000] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => handleSelectConfiguredPerPage(size)}
                      className={`rounded-lg px-2 py-1 font-mono transition ${
                        configuredOnusPerPage === size
                          ? 'bg-sky-600 font-semibold text-white'
                          : 'border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>

                {/* Quick Sort Selector (Mobile & Desktop) */}
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                  <span>Sort:</span>
                  <select
                    value={configuredSortField}
                    onChange={(e) => {
                      const val = e.target.value as ConfiguredSortField;
                      setConfiguredSortField(val);
                      setConfiguredOnusPage(1);
                    }}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="NONE">Default</option>
                    <option value="OLT">OLT</option>
                    <option value="ZONE">Zone</option>
                    <option value="SIGNAL">Signal (dBm)</option>
                    <option value="AUTH_DATE">Auth date</option>
                    <option value="NAME">Name</option>
                    <option value="STATUS">Status</option>
                    <option value="BOARD">Board</option>
                    <option value="PORT">Port</option>
                    <option value="SPLITTER">Splitter / ODP</option>
                    <option value="VLAN">VLAN</option>
                  </select>
                  {configuredSortField !== 'NONE' && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfiguredSortDir((d) =>
                          d === 'asc' ? 'desc' : 'asc'
                        )
                      }
                      className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2 py-1 font-mono text-[11px] font-semibold text-sky-300 hover:bg-sky-500/25"
                      title="Ubah arah urutan (Asc/Desc)"
                    >
                      {configuredSortDir === 'asc' ? '▲ ASC' : '▼ DESC'}
                    </button>
                  )}
                </div>
              </div>
              <div className="font-mono text-[11px]">
                {paginatedConfiguredOnus.length} of {filteredConfiguredOnus.length} ONUs
              </div>
            </div>

            {/* Mobile Card List for Configured ONUs (md:hidden) */}
            <div className="grid grid-cols-1 gap-2.5 md:hidden">
              {paginatedConfiguredOnus.map((o) => {
                const z = db.zones.find((item) => item.id === o.zone_id);
                const sp = db.odbs.find((item) => item.id === o.odb_id);
                const vl = db.vlans.find((item) => item.id === o.vlan_id);
                return (
                  <div
                    key={o.id}
                    onClick={() => {
                      setSelectedOnuId(o.id);
                      setActiveView('ONU_DETAIL');
                    }}
                    className="cursor-pointer space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 transition hover:border-slate-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-white">
                          {o.customer_name || o.serial_number}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {o.serial_number} · OLT {o.olt_id} (1/{o.board}/{o.port})
                        </div>
                      </div>
                      <div>{renderSignalCell(o)}</div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                      <span>
                        {z ? z.name : 'No Zone'}
                        {sp ? ` · ${sp.name}` : ''}
                        {vl ? ` · VLAN ${vl.vlan_id}` : ''}
                      </span>
                      <span className="font-medium text-sky-400">Detail →</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table for Configured ONUs (hidden md:block) */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70 md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">View</th>
                    {(
                      [
                        { field: 'STATUS', label: 'Status', px: 'px-2' },
                        { field: 'NAME', label: 'Name', px: 'px-3' },
                        { field: 'SN', label: 'SN', px: 'px-3' },
                        { field: 'OLT', label: 'OLT', px: 'px-2' },
                        { field: 'BOARD', label: 'Board', px: 'px-2' },
                        { field: 'PORT', label: 'Port', px: 'px-2' },
                        { field: 'ZONE', label: 'Zone', px: 'px-3' },
                        { field: 'SPLITTER', label: 'Splitter', px: 'px-3' },
                        { field: 'SIGNAL', label: 'Signal', px: 'px-3' },
                        { field: 'MODE', label: 'Mode', px: 'px-3' },
                        { field: 'VLAN', label: 'VLAN', px: 'px-2' },
                        { field: 'METHOD', label: 'Method', px: 'px-2' },
                        { field: 'TYPE', label: 'Type', px: 'px-2' },
                        { field: 'AUTH_DATE', label: 'Auth date', px: 'px-3' },
                      ] as Array<{
                        field: ConfiguredSortField;
                        label: string;
                        px: string;
                      }>
                    ).map((col) => {
                      const isActive = configuredSortField === col.field;
                      return (
                        <th
                          key={col.field}
                          onClick={() => handleToggleConfiguredSort(col.field)}
                          title={`Urutkan berdasarkan ${col.label}`}
                          className={`${col.px} py-2.5 cursor-pointer select-none transition hover:bg-slate-800/80 hover:text-white ${
                            isActive ? 'text-sky-400 font-bold' : ''
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <span>{col.label}</span>
                            <span
                              className={`text-[10px] leading-none ${
                                isActive
                                  ? 'text-sky-400 opacity-100'
                                  : 'text-slate-600 opacity-70'
                              }`}
                            >
                              {isActive
                                ? configuredSortDir === 'asc'
                                  ? '▲'
                                  : '▼'
                                : '⇅'}
                            </span>
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {paginatedConfiguredOnus.map((o) => {
                    const z = db.zones.find((item) => item.id === o.zone_id);
                    const sec = (db.sectors || []).find(
                      (item) => item.id === o.sector_id
                    );
                    const sp = db.odbs.find((item) => item.id === o.odb_id);
                    const vl = db.vlans.find((item) => item.id === o.vlan_id);
                    return (
                      <tr key={o.id} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOnuId(o.id);
                              setActiveView('ONU_DETAIL');
                            }}
                            className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-500"
                          >
                            View
                          </button>
                        </td>
                        <td className="px-2 py-2.5">
                          {o.phase_state === 'working' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                              <Wifi className="h-3.5 w-3.5" />
                              <span className="text-[11px]">Online</span>
                            </span>
                          ) : o.phase_state === 'DyingGasp' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                              <Power className="h-3.5 w-3.5" />
                              <span className="text-[11px]">PwrFail</span>
                            </span>
                          ) : o.phase_state === 'LOS' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-rose-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span className="text-[11px]">LOS</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-slate-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span className="text-[11px]">Offline</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-white">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOnuId(o.id);
                              setActiveView('ONU_DETAIL');
                            }}
                            className="hover:text-sky-400 hover:underline"
                          >
                            {o.customer_name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-300">
                          {o.serial_number}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {o.olt_id}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {o.board}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {o.port}
                        </td>
                        <td className="px-3 py-2.5 text-slate-200">
                          <div>{z ? z.name : '-'}</div>
                          {sec && (
                            <div className="font-mono text-[10px] text-sky-400">
                              {sec.name}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">
                          {sp ? `${sp.name}${o.odb_port ? ` (${o.odb_port})` : ''}` : '-'}
                        </td>
                        <td className="px-3 py-2.5">{renderSignalCell(o)}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            disabled={isViewerUser}
                            onClick={() => {
                              if (!isViewerUser) setUpdatingModeOnu(o);
                            }}
                            className={`rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 ${
                              isViewerUser ? 'cursor-default' : 'hover:bg-emerald-500/25'
                            }`}
                          >
                            {o.onu_mode === 'Bridging'
                              ? 'B: Bridge'
                              : `R: ${o.wan_mode === 'PPPOE' ? 'PPPoE' : o.wan_mode}`}
                          </button>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-white">
                          {vl?.vlan_id || o.vlan_id || 101}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[11px] text-slate-300">
                          {o.config_method}
                        </td>
                        <td className="px-2 py-2.5 text-slate-300">{o.onu_type}</td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">
                          {o.auth_date_label || 'Today 15:05:57'}
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
            VIEW 5: ONU DETAIL VIEW
           =================================================================== */}
        {activeView === 'ONU_DETAIL' && selectedOnu && (
          <OnuDetailView
            onu={selectedOnu}
            db={db}
            isReadOnly={isViewerUser}
            onBack={() => setActiveView('CONFIGURED')}
            onBackToDashboard={() => setActiveView('DASHBOARD')}
            onViewOlt={(oltId) => {
              setSelectedOltId(oltId);
              setInitialOltTab('OLT_DETAILS');
              setActiveView('OLT_DETAIL');
            }}
            onExecuteAction={handleExecuteOnuAction}
            onQuickAddZone={handleQuickAddZone}
            onQuickAddSector={handleQuickAddSector}
            onQuickAddSplitter={handleQuickAddSplitter}
          />
        )}

        {/* ===================================================================
            VIEW 6: OLTS LIST PAGE (Responsive Filter + Mobile Cards + Table)
           =================================================================== */}
        {activeView === 'OLTS_LIST' && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {!isViewerUser && (
                  <button
                    type="button"
                    onClick={() => setActiveView('ADD_OLT')}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add OLT
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowMismatchModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <Search className="h-3.5 w-3.5 text-sky-400" />
                  Find Config Mismatches
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const csv = [
                      'ID,Name,IP,Hardware,SW,VPN,Status',
                      ...db.olts.map(
                        (o) =>
                          `${o.id},"${o.name}",${o.ip_address},${o.hardware_model},${o.firmware_version},${o.vpn_name},${o.status}`
                      ),
                    ].join('\n');
                    navigator.clipboard.writeText(csv);
                    showToast('Daftar OLT berhasil disalin dalam format CSV.');
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Mobile Card List for OLTs (md:hidden) */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {visibleOlts.map((o) => (
                <div
                  key={o.id}
                  className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-white">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            o.status === 'ONLINE'
                              ? 'bg-emerald-400'
                              : 'bg-rose-500 animate-pulse'
                          }`}
                        />
                        <span>{o.id} - {o.name}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                            o.status === 'ONLINE'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {o.status === 'ONLINE' ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {o.ip_address} · TCP {o.telnet_port} · {o.hardware_model}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOltId(o.id);
                        setInitialOltTab('OLT_DETAILS');
                        setActiveView('OLT_DETAIL');
                      }}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
                    <span className="font-mono text-[11px] text-slate-400">
                      VPN: {o.vpn_name} · SW {o.firmware_version || '2.1.0'}
                    </span>
                    {!isViewerUser && (
                      <button
                        type="button"
                        onClick={() => void syncOltFromTelnetLive(o.id, o)}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Sync OLT
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop OLTs Table (hidden md:block) */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70 md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-4 py-3">View</th>
                    <th className="px-3 py-3">ID</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">VPN</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">OLT IP</th>
                    <th className="px-3 py-3">TCP / UDP</th>
                    <th className="px-4 py-3">Hardware</th>
                    <th className="px-3 py-3">SW Version</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {visibleOlts.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOltId(o.id);
                            setInitialOltTab('OLT_DETAILS');
                            setActiveView('OLT_DETAIL');
                          }}
                          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                        >
                          View
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono text-white">{o.id}</td>
                      <td className="px-3 py-3">
                        {o.status === 'ONLINE' ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-medium text-rose-400">
                            <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                            Offline
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-sky-400">
                        {o.vpn_name}
                      </td>
                      <td className="px-4 py-3 font-semibold text-white">
                        {o.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-200">
                        {o.ip_address}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-300">
                        {o.telnet_port} / {o.snmp_port}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-200">
                        {o.hardware_model}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-300">
                        {o.firmware_version || '2.1.0'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {!isViewerUser && (
                            <button
                              type="button"
                              onClick={() => void syncOltFromTelnetLive(o.id, o)}
                              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Sync OLT
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOltId(o.id);
                              setInitialOltTab('VLANS');
                              setActiveView('OLT_DETAIL');
                            }}
                            title="Open VLANs & Uplink Tagging"
                            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {!isViewerUser && (
                            <button
                              type="button"
                              onClick={() => {
                                setDb((prev) => ({
                                  ...prev,
                                  olts: prev.olts.filter((item) => item.id !== o.id),
                                  olt_cards: prev.olt_cards.filter((c) => c.olt_id !== o.id),
                                  pon_ports: prev.pon_ports.filter((p) => p.olt_id !== o.id),
                                  uplink_ports: prev.uplink_ports.filter((u) => u.olt_id !== o.id),
                                  vlans: prev.vlans.filter((v) => v.olt_id !== o.id),
                                  onus: prev.onus.filter((u) => u.olt_id !== o.id),
                                }));
                                showToast(`OLT ${o.name} beserta datanya dihapus dari Database.`);
                              }}
                              className="rounded-lg bg-rose-600 p-1.5 text-white hover:bg-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 6B: ADD OLT FULL-PAGE FORM (Exact match to Screenshot _365A2C64)
           =================================================================== */}
        {activeView === 'ADD_OLT' && !isViewerUser && (
          <AddOltView
            onBack={() => setActiveView('OLTS_LIST')}
            onSaveOlt={(newOltData) => {
              const nextId = Math.max(0, ...db.olts.map((o) => o.id)) + 1;
              const nowStr = formatJakartaDateTime();
              setDb((prev) => ({
                ...prev,
                olts: [
                  ...prev.olts,
                  {
                    ...newOltData,
                    id: nextId,
                  },
                ],
                olt_cards: [
                  ...prev.olt_cards,
                  {
                    id: Date.now() + 1,
                    olt_id: nextId,
                    slot: 3,
                    type: 'GTGH',
                    real_type: 'GTGH',
                    ports: 16,
                    sw_version: '2.1.0',
                    status: 'Online',
                    role: 'Main',
                    updated_at: nowStr,
                  },
                  {
                    id: Date.now() + 2,
                    olt_id: nextId,
                    slot: 10,
                    type: 'SCXM',
                    real_type: 'SCXM',
                    ports: null,
                    sw_version: '2.1.0',
                    status: 'Online',
                    role: 'Main',
                    updated_at: nowStr,
                  },
                  {
                    id: Date.now() + 3,
                    olt_id: nextId,
                    slot: 19,
                    type: 'HUVQ',
                    real_type: 'HUVQ',
                    ports: 4,
                    sw_version: '2.1.0',
                    status: 'Online',
                    role: 'Main',
                    updated_at: nowStr,
                  },
                ],
                uplink_ports: [
                  ...prev.uplink_ports,
                  {
                    id: Date.now() + 11,
                    olt_id: nextId,
                    name: 'xgei_1/19/1',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: 'Down',
                    negotiation: 'Forced 10G-FullD',
                    mtu: 1600,
                    wavelength: '1310',
                    signal_dbm: 'Tx: -4.85 / Rx: N/A',
                    temp_c: '41.5',
                    pvid_untag: 41,
                    tagged_vlans: 'Hybrid: 102',
                  },
                  {
                    id: Date.now() + 12,
                    olt_id: nextId,
                    name: 'xgei_1/19/2',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: 'Down',
                    negotiation: 'Forced 10G-FullD',
                    mtu: 1600,
                    wavelength: '1310',
                    signal_dbm: 'Tx: -5.20 / Rx: N/A',
                    temp_c: '40.9',
                    pvid_untag: 42,
                    tagged_vlans: 'Hybrid: 102',
                  },
                  {
                    id: Date.now() + 13,
                    olt_id: nextId,
                    name: 'gei_1/19/3',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: '1G-FullD',
                    negotiation: 'Auto',
                    mtu: 1600,
                    wavelength: '16652',
                    signal_dbm: '',
                    temp_c: 'N/A',
                    pvid_untag: 41,
                    tagged_vlans: 'Hybrid: 100-102',
                  },
                  {
                    id: Date.now() + 14,
                    olt_id: nextId,
                    name: 'gei_1/19/4',
                    description: '',
                    type: 'Fiber',
                    admin_state: 'Enabled',
                    status: 'Down',
                    negotiation: 'Auto',
                    mtu: 1600,
                    wavelength: 'N/A',
                    signal_dbm: '',
                    temp_c: 'N/A',
                    pvid_untag: 42,
                    tagged_vlans: 'Hybrid: 102',
                  },
                ],
                pon_ports: [
                  ...prev.pon_ports,
                  ...Array.from({ length: 16 }, (_, idx) => ({
                    id: nextId * 100 + idx + 1,
                    olt_id: nextId,
                    rack: 1,
                    shelf: 3,
                    slot: 3,
                    port_number: idx + 1,
                    interface_name: `gpon-olt_1/3/${idx + 1}`,
                    board_model: 'GTGH',
                    description: `PON 1/3/${idx + 1}`,
                    admin_state: 'ENABLED' as const,
                    oper_status: 'Up' as const,
                    online_onus: 0,
                    total_onus: 0,
                    avg_signal_dbm: null,
                    tx_power_dbm: 10.5,
                    max_onu_capacity: 128,
                  })),
                ],
                vlans: [
                  ...prev.vlans,
                  {
                    id: nextId * 10000 + 100,
                    olt_id: nextId,
                    vlan_id: 100,
                    name: 'TR069',
                    description: 'TR069',
                    default_for: 'None selected',
                    used_for_mgmt_tr069_voip: true,
                    used_for_iptv: false,
                    dhcp_snooping: false,
                    lan_to_lan: false,
                    onus_count: 0,
                    service_type: 'TR069_MGMT' as const,
                    svlan_id: null,
                    is_default: false,
                  },
                  {
                    id: nextId * 10000 + 101,
                    olt_id: nextId,
                    vlan_id: 101,
                    name: 'PPPOE',
                    description: 'PPPOE',
                    default_for: 'None selected',
                    used_for_mgmt_tr069_voip: false,
                    used_for_iptv: false,
                    dhcp_snooping: false,
                    lan_to_lan: false,
                    onus_count: 0,
                    service_type: 'PPPOE' as const,
                    svlan_id: null,
                    is_default: true,
                  },
                ],
              }));
              setSelectedOltId(nextId);
              showToast(
                `OLT ${newOltData.name} (${newOltData.hardware_model} - ${newOltData.ip_address}) disimpan! Mengambil konfigurasi VLAN & ONU dari OLT...`
              );
              setActiveView('OLTS_LIST');

              // Immediately pull all existing VLANs, ONUs, Uplinks, Cards & Running Config from the OLT over Telnet!
              void syncOltFromTelnetLive(nextId, {
                ...newOltData,
                id: nextId,
              });
            }}
          />
        )}

        {/* ===================================================================
            VIEW 7: 10-TAB OLT DETAIL VIEW (Screenshots 1-5)
           =================================================================== */}
        {activeView === 'OLT_DETAIL' && selectedOlt && (
          <OltDetailView
            olt={selectedOlt}
            db={db}
            isReadOnly={isViewerUser}
            initialTab={initialOltTab}
            onTabChange={(tab) => setInitialOltTab(tab)}
            onBack={() => setActiveView('OLTS_LIST')}
            onOpenTr069Config={() => {
              setTr069TargetOltId(selectedOlt.id);
              setActiveView('VPN_TR069');
            }}
            onAddVlan={(newVlans, tagUplinkIds, cliScript) => {
              const createdRecords: VlanRecord[] = newVlans.map((nv, idx) => ({
                ...nv,
                id: Date.now() + idx,
              }));
              const addedVlanNums = newVlans.map((v) => v.vlan_id);
              const logId = Date.now() + 99;

              nextSyncIsUserMutationRef.current = true;
              lastUserMutationAtRef.current = Date.now();
              setDb((prev) => ({
                ...prev,
                vlans: [...prev.vlans, ...createdRecords],
                uplink_ports: prev.uplink_ports.map((u) => {
                  if (!tagUplinkIds.includes(u.id)) return u;
                  const raw = u.tagged_vlans
                    .replace(/^(Hybrid|Trunk|Access):\s*/i, '')
                    .trim();
                  const combined = raw
                    ? `${raw},${addedVlanNums.join(',')}`
                    : addedVlanNums.join(',');
                  return {
                    ...u,
                    tagged_vlans: `Hybrid: ${combined}`,
                  };
                }),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-VLAN',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: `vlan ${addedVlanNums.join(',')}`,
                    summary_text: `Created VLAN(s) ${addedVlanNums.join(',')} & tagged on Uplink`,
                    cli_script: cliScript,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(
                `Mengeksekusi pembuatan VLAN ${addedVlanNums.join(', ')} ke OLT ${selectedOlt.name}...`
              );
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Create VLAN ${addedVlanNums.join(',')}`
              );
            }}
            onToggleVlanFlag={(vlanRecordId, field) => {
              const targetVlan = db.vlans.find((v) => v.id === vlanRecordId);
              nextSyncIsUserMutationRef.current = true;
              lastUserMutationAtRef.current = Date.now();
              setDb((prev) => ({
                ...prev,
                vlans: prev.vlans.map((v) => {
                  if (v.id !== vlanRecordId) return v;
                  const currentVal =
                    field === 'enable_nat'
                      ? typeof v.enable_nat === 'boolean'
                        ? v.enable_nat
                        : !v.used_for_mgmt_tr069_voip &&
                          v.service_type !== 'TR069_MGMT' &&
                          !/(?:^|[^A-Z0-9])(MJMT|MGMT|TR069|MANAGEMENT)(?:[^A-Z0-9]|$)/i.test(
                            v.name || v.description || ''
                          )
                      : Boolean(v[field]);
                  const nextVal = !currentVal;
                  if (field === 'enable_nat') {
                    return {
                      ...v,
                      enable_nat: nextVal,
                    };
                  }
                  if (field === 'used_for_mgmt_tr069_voip') {
                    return {
                      ...v,
                      used_for_mgmt_tr069_voip: nextVal,
                      enable_nat: nextVal ? false : v.enable_nat,
                      service_type: nextVal
                        ? 'TR069_MGMT'
                        : v.used_for_iptv
                        ? 'IPTV'
                        : 'PPPOE',
                      default_for: nextVal
                        ? 'Mgmt/TR069/VoIP (No Internet)'
                        : v.default_for === 'Mgmt/TR069/VoIP (No Internet)'
                        ? 'PPPoE subscribers'
                        : v.default_for,
                    };
                  }
                  if (field === 'used_for_iptv') {
                    return {
                      ...v,
                      used_for_iptv: nextVal,
                      service_type: v.used_for_mgmt_tr069_voip
                        ? 'TR069_MGMT'
                        : nextVal
                        ? 'IPTV'
                        : 'PPPOE',
                    };
                  }
                  return { ...v, [field]: nextVal };
                }),
              }));
              if (targetVlan && field === 'dhcp_snooping') {
                const nextEnable = !targetVlan.dhcp_snooping;
                const cli = [
                  'configure terminal',
                  nextEnable
                    ? 'ip dhcp snooping control-port enable'
                    : 'no ip dhcp snooping control-port enable',
                  'end',
                  'write',
                ].join('\n');
                void executeOltCliLive(
                  selectedOlt.id,
                  cli,
                  Date.now(),
                  `VLAN ${targetVlan.vlan_id} DHCP Snooping`
                );
              } else if (targetVlan && field === 'used_for_mgmt_tr069_voip') {
                const nextVal = !targetVlan.used_for_mgmt_tr069_voip;
                showToast(
                  nextVal
                    ? `VLAN ${targetVlan.vlan_id} di-set sebagai VLAN Mgmt (TR-069 & VoIP Only, tanpa push Internet).`
                    : `VLAN ${targetVlan.vlan_id} dikembalikan ke mode VLAN Subscriber/Internet.`
                );
              } else if (targetVlan && field === 'enable_nat') {
                const currentNat =
                  typeof targetVlan.enable_nat === 'boolean'
                    ? targetVlan.enable_nat
                    : !targetVlan.used_for_mgmt_tr069_voip &&
                      targetVlan.service_type !== 'TR069_MGMT' &&
                      !/(?:^|[^A-Z0-9])(MJMT|MGMT|TR069|MANAGEMENT)(?:[^A-Z0-9]|$)/i.test(
                        targetVlan.name || targetVlan.description || ''
                      );
                showToast(
                  !currentNat
                    ? `Enable NAT diaktifkan untuk VLAN ${targetVlan.vlan_id} (${targetVlan.name}).`
                    : `Enable NAT dinonaktifkan untuk VLAN ${targetVlan.vlan_id} (${targetVlan.name}) — perintah 'nat' / 'ip nat' dikecualikan dari skrip CLI.`
                );
              } else {
                showToast(`Pengaturan ${field} pada VLAN berhasil diperbarui.`);
              }
            }}
            onDeleteVlans={(vlanRecordIds) => {
              const targetVlans = db.vlans.filter((v) =>
                vlanRecordIds.includes(v.id)
              );
              const vlanNums = targetVlans.map((v) => v.vlan_id);
              const logId = Date.now();
              const cliScript =
                vlanNums.length > 0
                  ? [
                      'configure terminal',
                      'vlan database',
                      `  no vlan ${vlanNums.join(',')}`,
                      'exit',
                      'gpon',
                      ...vlanNums.map(
                        (vid) => `  no onu profile vlan SMARTOLT-vlan${vid}`
                      ),
                      'exit',
                      'end',
                      'write',
                    ].join('\n')
                  : '';

              nextSyncIsUserMutationRef.current = true;
              lastUserMutationAtRef.current = Date.now();
              setDb((prev) => ({
                ...prev,
                vlans: prev.vlans.filter((v) => !vlanRecordIds.includes(v.id)),
                provisioning_logs: cliScript
                  ? [
                      {
                        id: logId,
                        olt_id: selectedOlt.id,
                        onu_id: null,
                        serial_number: 'OLT-VLAN',
                        action_type: 'RESYNC_CONFIG',
                        interface_target: `no vlan ${vlanNums.join(',')}`,
                        summary_text: `Deleted VLAN(s) ${vlanNums.join(',')} from OLT`,
                        cli_script: cliScript,
                        olt_response: '[Executing on OLT via Telnet...]',
                        execution_status: 'SUCCESS',
                        executed_by: 'likhin',
                        duration_ms: 0,
                        created_at: 'Just now',
                      },
                      ...prev.provisioning_logs,
                    ]
                  : prev.provisioning_logs,
              }));
              showToast(`Menghapus VLAN ${vlanNums.join(', ')} dari OLT...`);
              if (cliScript) {
                void executeOltCliLive(
                  selectedOlt.id,
                  cliScript,
                  logId,
                  `Delete VLAN ${vlanNums.join(',')}`
                );
              }
            }}
            onUpdateUplinkPort={(uplinkId, updated, cliScript) => {
              const targetUplink = db.uplink_ports.find((u) => u.id === uplinkId);
              const logId = Date.now();
              setDb((prev) => ({
                ...prev,
                uplink_ports: prev.uplink_ports.map((u) =>
                  u.id === uplinkId ? { ...u, ...updated } : u
                ),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-UPLINK',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: targetUplink?.name || 'gei_1/19/3',
                    summary_text: `Uplink ${targetUplink?.name || ''} tagged VLANs updated (${updated.tagged_vlans || ''})`,
                    cli_script: cliScript,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(
                `Mengeksekusi konfigurasi Uplink ${targetUplink?.name || ''} ke OLT...`
              );
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Configure Uplink ${targetUplink?.name || ''}`
              );
            }}
            onCreateLagUplink={(newUplink, cliScript) => {
              const logId = Date.now();
              setDb((prev) => ({
                ...prev,
                uplink_ports: [
                  ...prev.uplink_ports,
                  { ...newUplink, id: Date.now() + 1 },
                ],
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-LAG',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: newUplink.name,
                    summary_text: `Created LACP LAG ${newUplink.name} (${newUplink.tagged_vlans})`,
                    cli_script: cliScript,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(`Mengeksekusi pembuatan LAG ${newUplink.name} ke OLT...`);
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Create LAG ${newUplink.name}`
              );
            }}
            onUpdatePonPort={(portNumber, updated, cliScript) => {
              const logId = Date.now();
              setDb((prev) => {
                const exists = prev.pon_ports.some(
                  (p) => p.olt_id === selectedOlt.id && p.port_number === portNumber
                );
                const nextPonPorts = exists
                  ? prev.pon_ports.map((p) =>
                      p.olt_id === selectedOlt.id && p.port_number === portNumber
                        ? { ...p, ...updated }
                        : p
                    )
                  : [
                      ...prev.pon_ports,
                      {
                        id: Date.now() + 1,
                        olt_id: selectedOlt.id,
                        rack: 1,
                        shelf: 3,
                        slot: 3,
                        port_number: portNumber,
                        interface_name: `gpon-olt_1/3/${portNumber}`,
                        board_model: 'GTGH',
                        description: updated.description || '',
                        admin_state: updated.admin_state || 'ENABLED',
                        oper_status: updated.oper_status || 'Up',
                        online_onus: 0,
                        total_onus: 0,
                        avg_signal_dbm: null,
                        tx_power_dbm: 10.52,
                        max_onu_capacity: updated.max_onu_capacity || 128,
                      },
                    ];
                return {
                  ...prev,
                  pon_ports: nextPonPorts,
                  provisioning_logs: [
                    {
                      id: logId,
                      olt_id: selectedOlt.id,
                      onu_id: null,
                      serial_number: 'OLT-PON',
                      action_type: 'RESYNC_CONFIG',
                      interface_target: `gpon-olt_1/3/${portNumber}`,
                      summary_text: `Updated PON port gpon-olt_1/3/${portNumber}`,
                      cli_script: cliScript,
                      olt_response: '[Executing on OLT via Telnet...]',
                      execution_status: 'SUCCESS',
                      executed_by: 'likhin',
                      duration_ms: 0,
                      created_at: 'Just now',
                    },
                    ...prev.provisioning_logs,
                  ],
                };
              });
              showToast(`Mengeksekusi konfigurasi Port GPON 1/3/${portNumber} ke OLT...`);
              void executeOltCliLive(
                selectedOlt.id,
                cliScript,
                logId,
                `Update PON gpon-olt_1/3/${portNumber}`
              );
            }}
            onEnableAllPonPorts={() => {
              const logId = Date.now();
              const enableAllCli = [
                'configure terminal',
                ...Array.from({ length: 16 }, (_, idx) =>
                  [
                    `interface gpon-olt_1/3/${idx + 1}`,
                    '  no shutdown',
                    '  uncfg-onu-display-info model sn pw',
                    'exit',
                  ].join('\n')
                ),
                'end',
                'write',
              ].join('\n');

              setDb((prev) => ({
                ...prev,
                pon_ports: prev.pon_ports.map((p) =>
                  p.olt_id === selectedOlt.id
                    ? {
                        ...p,
                        admin_state: 'ENABLED',
                        oper_status: 'Up',
                      }
                    : p
                ),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: 'OLT-PON-ALL',
                    action_type: 'RESYNC_CONFIG',
                    interface_target: 'gpon-olt_1/3/1..16',
                    summary_text: 'Enabled all 16 GPON ports on Slot 3 GTGH',
                    cli_script: enableAllCli,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast('Mengeksekusi no shutdown pada seluruh 16 port GPON ke OLT...');
              void executeOltCliLive(
                selectedOlt.id,
                enableAllCli,
                logId,
                'Enable All PON Ports (1/3/1..16)'
              );
            }}
            onRefreshOltCards={async () => {
              const nowStr = formatJakartaDateTime();
              setDb((prev) => ({
                ...prev,
                olt_cards: prev.olt_cards.map((c) => ({
                  ...c,
                  updated_at: nowStr,
                })),
              }));
              showToast('Meminta status kartu OLT (`show card`) via Telnet...');
              await executeOltCliLive(
                selectedOlt.id,
                'show card',
                Date.now(),
                `Refresh OLT Cards (${selectedOlt.name})`
              );
            }}
            onRebootOltCard={(cardId) => {
              const targetCard = db.olt_cards.find((c) => c.id === cardId);
              const slotNum = targetCard?.slot || 3;
              const logId = Date.now();
              const rebootCardCli = `reset-card slotno ${slotNum}`;
              const nowStr = formatJakartaDateTime();
              setDb((prev) => ({
                ...prev,
                olt_cards: prev.olt_cards.map((c) =>
                  c.id === cardId
                    ? { ...c, status: 'Online', updated_at: nowStr }
                    : c
                ),
                provisioning_logs: [
                  {
                    id: logId,
                    olt_id: selectedOlt.id,
                    onu_id: null,
                    serial_number: `SLOT-${slotNum}`,
                    action_type: 'REBOOT',
                    interface_target: `card slot ${slotNum}`,
                    summary_text: `Rebooted OLT card on Slot ${slotNum}`,
                    cli_script: rebootCardCli,
                    olt_response: '[Executing on OLT via Telnet...]',
                    execution_status: 'SUCCESS',
                    executed_by: 'likhin',
                    duration_ms: 0,
                    created_at: 'Just now',
                  },
                  ...prev.provisioning_logs,
                ],
              }));
              showToast(`Mengeksekusi reset-card slotno ${slotNum} ke sasis OLT...`);
              void executeOltCliLive(
                selectedOlt.id,
                rebootCardCli,
                logId,
                `Reboot Card Slot ${slotNum}`
              );
            }}
            onUpdateOltSettings={(oltId, updated) => {
              setDb((prev) => ({
                ...prev,
                olts: prev.olts.map((o) =>
                  o.id === oltId ? { ...o, ...updated } : o
                ),
              }));
              showToast('Pengaturan OLT berhasil diperbarui.');
            }}
            onUpdateOltTr069={(oltId, tr069ProfileName, defaultInterface) => {
              setDb((prev) => ({
                ...prev,
                olts: prev.olts.map((o) =>
                  o.id === oltId
                    ? {
                        ...o,
                        tr069_profile_name: tr069ProfileName,
                        default_tr069_interface: defaultInterface,
                      }
                    : o
                ),
              }));
              showToast(
                `TR069 Profile "${tr069ProfileName}" (${defaultInterface}) diterapkan pada OLT.`
              );
            }}
            onImportRunningConfig={async (oltId, rawConfig) => {
              try {
                const resp = await fetch(`/api/olts/${oltId}/import-config`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rawConfig }),
                });
                const data = await resp.json();
                if (data.state) {
                  setDb(data.state);
                  showToast(
                    `Berhasil mengimpor ${data.imported?.onus || 0} ONU, ${data.imported?.vlans || 0} VLAN, dan ${data.imported?.uplinks || 0} Uplink ke Database (${dbMeta.dbEngine})!`
                  );
                }
              } catch (err) {
                showToast(`Gagal mengimpor running-config: ${(err as Error).message}`);
              }
            }}
            onSyncOltLive={async (oltId) => {
              await syncOltFromTelnetLive(oltId);
            }}
          />
        )}

        {/* ===================================================================
            VIEW 8: TASKS PAGE (Auto ONU Provisioning Task Dashboard + System Tasks)
           =================================================================== */}
        {activeView === 'TASKS' && (
          <div className="space-y-6 text-xs">
            <AutoProvisioningTaskManager
              db={db}
              setDb={(updater) => {
                nextSyncIsUserMutationRef.current = true;
                lastUserMutationAtRef.current = Date.now();
                setDb(updater);
              }}
              isReadOnlyViewer={isViewerUser}
              currentUsername={currentUser?.username || 'admin'}
              unconfiguredOnus={unconfiguredOnus}
              isRunningAutoEngine={isRunningAutoEngine}
              onRunAutoProvisioningNow={handleRunAutoProvisioningBatch}
              onRetryFailedRecord={handleRetryFailedProvisioning}
              initialSubTab="TASKS"
            />
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-3 rounded-xl border border-slate-800/90 bg-slate-900/70 p-3.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300 text-xs">OLT</span>
                <select className="w-full sm:w-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white">
                  <option>Any</option>
                  {db.olts.map((o) => (
                    <option key={o.id}>
                      {o.id} - {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300 text-xs">User</span>
                <select className="w-full sm:w-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white">
                  <option>Any</option>
                  <option>muslikhin997@gmail.com</option>
                  <option>fathanwushu@gmail.com</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300 text-xs">Action</span>
                <select className="w-full sm:w-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white">
                  <option>Any</option>
                  <option>Auto-Authorize</option>
                  <option>Auto-Move</option>
                  <option>Auto-Resync</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300 text-xs">From</span>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  className="w-full sm:w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300 text-xs">To</span>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  className="w-full sm:w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                  <tr>
                    <th className="px-4 py-3"></th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">OLT</th>
                    <th className="px-4 py-3">ONUs</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Stopped by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e3a5f]/70">
                  {db.tasks.map((t, index) => (
                    <tr key={t.id} className="hover:bg-[#132842]/50">
                      <td className="space-y-1.5 px-4 py-3">
                        <div>
                          <button
                            type="button"
                            className="rounded bg-[#0275d8] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
                          >
                            View
                          </button>
                        </div>
                        {index === 0 && !isViewerUser && (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                showToast(
                                  `Restarted ${t.action} on ${t.olt_label}.`
                                )
                              }
                              className="flex items-center gap-1 rounded bg-[#5cb85c] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Restart task
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold text-white">
                        {t.action}
                      </td>
                      <td className="px-4 py-3 text-white">{t.olt_label}</td>
                      <td className="px-4 py-3 text-slate-200">
                        <div>
                          <strong>Processed:</strong> {t.processed} of {t.total}
                        </div>
                        <div>
                          <strong>Successful:</strong> {t.successful}
                        </div>
                        <div>
                          <strong>Failed:</strong> {t.failed}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white">{t.user_email}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-500 px-2.5 py-1 text-[11px] font-bold text-white">
                          ✓ {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        <div>
                          <strong>From:</strong> {t.from_time}
                        </div>
                        <div>
                          <strong>To:</strong> {t.to_time}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 9: VPN & TR069 ACS PROFILES (Settings -> VPN & TR069)
           =================================================================== */}
        {activeView === 'VPN_TR069' && (() => {
          const targetOlt =
            db.olts.find((o) => o.id === tr069TargetOltId) || db.olts[0];
          const targetOltVlans = db.vlans.filter(
            (v) => v.olt_id === (targetOlt?.id || 1)
          );
          const targetOltUplinks = db.uplink_ports
            .filter((u) => u.olt_id === (targetOlt?.id || 1))
            .map((u) => u.name);

          const openAddTr069Modal = () => {
            const mgmtVlan =
              targetOltVlans.find(
                (v) => v.used_for_mgmt_tr069_voip || v.service_type === 'TR069_MGMT'
              ) || targetOltVlans[0];
            setEditingTr069Profile(null);
            setTr069FormName('');
            setTr069FormAcsUrl('http://10.69.69.1:14501');
            setTr069FormAcsUser('acsNet');
            setTr069FormAcsPass('acsNet@2024');
            setTr069FormConnReqUser('acsNet');
            setTr069FormConnReqPass('acsNet@2024');
            setTr069FormPeriodicInterval(300);
            setTr069FormMgmtVlanId(mgmtVlan?.vlan_id || 100);
            setTr069FormPriority(2);
            setTr069FormTcontProfile('SMARTOLT-VOIPMNG-10M');
            setTr069FormTrafficProfile('SMARTOLT-VOIPMNG-10M');
            setTr069FormVoipEnabled(true);
            setTr069FormSipServer('');
            setTr069FormDescription('Profil TR-069 CWMP + VoIP ISP');
            setTr069FormIsDefault(db.tr069_profiles.length === 0);
            setTr069AutoMarkVlan(true);
            setShowTr069Modal(true);
          };

          const openEditTr069Modal = (prof: Tr069ProfileRecord) => {
            setEditingTr069Profile(prof);
            setTr069FormName(prof.profile_name);
            setTr069FormAcsUrl(prof.acs_url);
            setTr069FormAcsUser(prof.acs_username);
            setTr069FormAcsPass(prof.acs_password);
            setTr069FormConnReqUser(prof.connection_request_username);
            setTr069FormConnReqPass(prof.connection_request_password);
            setTr069FormPeriodicInterval(prof.periodic_inform_interval || 300);
            setTr069FormMgmtVlanId(prof.mgmt_vlan_id || 100);
            setTr069FormPriority(prof.vlan_priority ?? 2);
            setTr069FormTcontProfile(prof.tcont_profile || 'SMARTOLT-VOIPMNG-10M');
            setTr069FormTrafficProfile(
              prof.traffic_profile || 'SMARTOLT-VOIPMNG-10M'
            );
            setTr069FormVoipEnabled(prof.voip_enabled !== false);
            setTr069FormSipServer(prof.voip_sip_server || '');
            setTr069FormDescription(prof.description || '');
            setTr069FormIsDefault(Boolean(prof.is_default));
            setTr069AutoMarkVlan(true);
            setShowTr069Modal(true);
          };

          const handlePushTr069ProfileToOlt = (prof: Tr069ProfileRecord) => {
            if (!targetOlt) return;
            const cli = generateTr069ProfileOltCliScript({
              profileName: prof.profile_name,
              acsUrl: prof.acs_url,
              acsUsername: prof.acs_username,
              acsPassword: prof.acs_password,
              mgmtVlanId: prof.mgmt_vlan_id,
              priority: prof.vlan_priority ?? 2,
              tcontProfile: prof.tcont_profile || 'SMARTOLT-VOIPMNG-10M',
              trafficProfile: prof.traffic_profile || 'SMARTOLT-VOIPMNG-10M',
              voipEnabled: prof.voip_enabled !== false,
              tagToUplinks: targetOltUplinks,
            });
            const logId = Date.now();
            nextSyncIsUserMutationRef.current = true;
            lastUserMutationAtRef.current = Date.now();
            setDb((prev) => ({
              ...prev,
              olts: prev.olts.map((o) =>
                o.id === targetOlt.id
                  ? { ...o, tr069_profile_name: prof.profile_name }
                  : o
              ),
              provisioning_logs: [
                {
                  id: logId,
                  olt_id: targetOlt.id,
                  onu_id: null,
                  serial_number: 'OLT-TR069',
                  action_type: 'TR069_PUSH',
                  interface_target: `vlan ${prof.mgmt_vlan_id} (${prof.profile_name})`,
                  summary_text: `Push TR-069 ISP Profile "${prof.profile_name}" (VLAN ${prof.mgmt_vlan_id}, CoS ${prof.vlan_priority ?? 2}) to ${targetOlt.name}`,
                  cli_script: cli,
                  olt_response: '[Executing on OLT via Telnet...]',
                  execution_status: 'SUCCESS',
                  executed_by: currentUser?.username || 'admin',
                  duration_ms: 0,
                  created_at: 'Just now',
                },
                ...prev.provisioning_logs,
              ],
            }));
            showToast(
              `Mengirim konfigurasi TR-069 ISP "${prof.profile_name}" (VLAN ${prof.mgmt_vlan_id}) ke OLT ${targetOlt.name}...`
            );
            void executeOltCliLive(
              targetOlt.id,
              cli,
              logId,
              `Push TR-069 ISP (${prof.profile_name})`
            );
          };

          const handleSaveTr069Profile = (pushAfterSave: boolean) => {
            const cleanName = tr069FormName.trim();
            const cleanUrl = tr069FormAcsUrl.trim();
            if (!cleanName || !cleanUrl) {
              showToast('Nama Profil dan ACS CWMP URL wajib diisi.');
              return;
            }
            const cleanVlan =
              Number.isFinite(tr069FormMgmtVlanId) && tr069FormMgmtVlanId > 0
                ? tr069FormMgmtVlanId
                : 100;
            const profileId = editingTr069Profile
              ? editingTr069Profile.id
              : Math.max(0, ...db.tr069_profiles.map((p) => p.id)) + 1;
            const savedRecord: Tr069ProfileRecord = {
              id: profileId,
              profile_name: cleanName,
              acs_url: cleanUrl,
              acs_username: tr069FormAcsUser.trim() || 'acsNet',
              acs_password: tr069FormAcsPass.trim() || 'acsNet@2024',
              connection_request_username:
                tr069FormConnReqUser.trim() || tr069FormAcsUser.trim() || 'acsNet',
              connection_request_password:
                tr069FormConnReqPass.trim() || tr069FormAcsPass.trim() || 'acsNet@2024',
              periodic_inform_interval:
                tr069FormPeriodicInterval > 0 ? tr069FormPeriodicInterval : 300,
              mgmt_vlan_id: cleanVlan,
              vlan_priority:
                tr069FormPriority >= 0 && tr069FormPriority <= 7
                  ? tr069FormPriority
                  : 2,
              tcont_profile: tr069FormTcontProfile.trim() || 'SMARTOLT-VOIPMNG-10M',
              traffic_profile:
                tr069FormTrafficProfile.trim() || 'SMARTOLT-VOIPMNG-10M',
              voip_enabled: tr069FormVoipEnabled,
              voip_sip_server: tr069FormSipServer.trim(),
              description: tr069FormDescription.trim(),
              is_default: tr069FormIsDefault || db.tr069_profiles.length === 0,
            };

            nextSyncIsUserMutationRef.current = true;
            lastUserMutationAtRef.current = Date.now();
            setDb((prev) => {
              const existingIdx = prev.tr069_profiles.findIndex(
                (p) => p.id === profileId
              );
              const baseList =
                existingIdx >= 0
                  ? prev.tr069_profiles.map((p) =>
                      p.id === profileId ? savedRecord : p
                    )
                  : [...prev.tr069_profiles, savedRecord];
              const nextProfiles = savedRecord.is_default
                ? baseList.map((p) => ({
                    ...p,
                    is_default: p.id === savedRecord.id,
                  }))
                : baseList;

              let nextVlans = prev.vlans;
              if (tr069AutoMarkVlan && targetOlt) {
                const matchIdx = prev.vlans.findIndex(
                  (v) => v.olt_id === targetOlt.id && v.vlan_id === cleanVlan
                );
                if (matchIdx >= 0) {
                  nextVlans = prev.vlans.map((v, idx) =>
                    idx === matchIdx
                      ? {
                          ...v,
                          used_for_mgmt_tr069_voip: true,
                          service_type: 'TR069_MGMT' as const,
                          default_for: 'Mgmt/TR069/VoIP (No Internet)',
                        }
                      : v
                  );
                } else {
                  nextVlans = [
                    ...prev.vlans,
                    {
                      id: Date.now() + 7,
                      olt_id: targetOlt.id,
                      vlan_id: cleanVlan,
                      name: `MGMT-${cleanVlan}`,
                      description: `Mgmt TR069 & VoIP (${cleanName})`,
                      default_for: 'Mgmt/TR069/VoIP (No Internet)',
                      used_for_mgmt_tr069_voip: true,
                      used_for_iptv: false,
                      dhcp_snooping: false,
                      lan_to_lan: false,
                      onus_count: 0,
                      service_type: 'TR069_MGMT' as const,
                      svlan_id: null,
                      is_default: false,
                    },
                  ];
                }
              }

              return {
                ...prev,
                tr069_profiles: nextProfiles,
                vlans: nextVlans,
                olts:
                  savedRecord.is_default && targetOlt
                    ? prev.olts.map((o) =>
                        o.id === targetOlt.id
                          ? { ...o, tr069_profile_name: savedRecord.profile_name }
                          : o
                      )
                    : prev.olts,
              };
            });

            setShowTr069Modal(false);
            showToast(
              `✓ Profil TR-069 ISP "${savedRecord.profile_name}" (VLAN ${cleanVlan}) berhasil disimpan!`
            );
            if (pushAfterSave) {
              handlePushTr069ProfileToOlt(savedRecord);
            }
          };

          return (
            <div className="space-y-5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-bold text-white">
                    Konfigurasi TR-069 CWMP ISP &amp; VLAN Management (TR-069 + VoIP)
                  </h1>
                  <p className="text-slate-300">
                    Atur ACS Server URL, Username/Password, Periodic Inform, CoS Priority, TCONT/Traffic Profile, serta VLAN Mgmt sesuai parameter ISP Anda.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={targetOlt?.id || 1}
                    onChange={(e) => setTr069TargetOltId(Number(e.target.value))}
                    className="rounded border border-[#284870] bg-[#10233a] px-3 py-2 text-xs font-semibold text-white"
                  >
                    {db.olts.map((o) => (
                      <option key={o.id} value={o.id}>
                        OLT: {o.name} ({o.ip_address})
                      </option>
                    ))}
                  </select>
                  {!isViewerUser && (
                    <button
                      type="button"
                      onClick={openAddTr069Modal}
                      className="flex items-center gap-1.5 rounded bg-[#5cb85c] px-4 py-2 text-xs font-bold text-white hover:bg-[#4cae4c]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Profil TR-069 ISP
                    </button>
                  )}
                  {!isViewerUser && configuredOnus.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setUpdatingModeOnu(configuredOnus[0]);
                      }}
                      className="flex items-center gap-1.5 rounded bg-[#0275d8] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#025aa5]"
                    >
                      <Sliders className="h-3.5 w-3.5" />
                      Terapkan ke ONU
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-amber-200">
                <strong>Aturan VLAN Management (MJMT / TR-069):</strong> Setiap VLAN yang ditandai{' '}
                <span className="font-mono font-bold text-amber-300">
                  Used for Mgmt/TR069/VoIP
                </span>{' '}
                hanya akan mem-push service <span className="font-mono font-bold">TR-069 CWMP</span> +{' '}
                <span className="font-mono font-bold">VoIP SIP</span> ke ONU{' '}
                <strong>tanpa push service Internet (PPPoE / DHCP / LAN Internet)</strong>.
              </div>

              <div className="overflow-x-auto rounded border border-[#1e3a5f] bg-[#0c1c30]/90">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Profil ISP</th>
                      <th className="px-4 py-3">ACS CWMP URL</th>
                      <th className="px-4 py-3">ACS Auth</th>
                      <th className="px-4 py-3">Conn Request</th>
                      <th className="px-4 py-3">Inform</th>
                      <th className="px-4 py-3">VLAN Mgmt / CoS</th>
                      <th className="px-4 py-3">VoIP &amp; Profile GPON</th>
                      <th className="px-4 py-3">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e3a5f]/70">
                    {db.tr069_profiles.map((p) => {
                      const matchedVlan = targetOltVlans.find(
                        (v) => v.vlan_id === p.mgmt_vlan_id
                      );
                      return (
                        <tr key={p.id} className="hover:bg-[#132842]/50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-emerald-400">
                                {p.profile_name}
                              </span>
                              {p.is_default && (
                                <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  DEFAULT
                                </span>
                              )}
                            </div>
                            {p.description && (
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                {p.description}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-sky-300">
                            {p.acs_url}
                          </td>
                          <td className="px-4 py-3 font-mono text-white">
                            <div>{p.acs_username}</div>
                            <div className="text-[10px] text-slate-400">
                              ••••••
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-white">
                            {p.connection_request_username}
                          </td>
                          <td className="px-4 py-3 font-mono text-white">
                            {p.periodic_inform_interval}s
                          </td>
                          <td className="px-4 py-3 font-mono text-white">
                            <div className="font-bold text-sky-300">
                              VLAN {p.mgmt_vlan_id} (Pri {p.vlan_priority ?? 2})
                            </div>
                            {matchedVlan &&
                            (matchedVlan.used_for_mgmt_tr069_voip ||
                              matchedVlan.service_type === 'TR069_MGMT') ? (
                              <span className="mt-1 inline-block rounded bg-amber-950/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/40">
                                TR069 + VoIP Only
                              </span>
                            ) : (
                              <span className="mt-1 inline-block text-[10px] text-slate-400">
                                VLAN belum ditandai Mgmt
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[11px]">
                            <div className="text-sky-300 font-semibold">
                              VoIP SIP: {p.voip_enabled !== false ? 'Aktif' : 'Nonaktif'}
                            </div>
                            <div className="font-mono text-slate-400">
                              {p.tcont_profile || 'SMARTOLT-VOIPMNG-10M'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {!isViewerUser ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handlePushTr069ProfileToOlt(p)}
                                  className="rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#025aa5]"
                                >
                                  Push OLT
                                </button>
                                {!p.is_default && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      nextSyncIsUserMutationRef.current = true;
                                      lastUserMutationAtRef.current = Date.now();
                                      setDb((prev) => ({
                                        ...prev,
                                        tr069_profiles: prev.tr069_profiles.map((item) => ({
                                          ...item,
                                          is_default: item.id === p.id,
                                        })),
                                        olts: targetOlt
                                          ? prev.olts.map((o) =>
                                              o.id === targetOlt.id
                                                ? { ...o, tr069_profile_name: p.profile_name }
                                                : o
                                            )
                                          : prev.olts,
                                      }));
                                      showToast(
                                        `Profil "${p.profile_name}" dijadikan Default TR-069 ISP.`
                                      );
                                    }}
                                    className="rounded border border-emerald-500/50 bg-emerald-950/60 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/70"
                                  >
                                    Set Default
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditTr069Modal(p)}
                                  className="rounded bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-600"
                                >
                                  Edit
                                </button>
                                {db.tr069_profiles.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      nextSyncIsUserMutationRef.current = true;
                                      lastUserMutationAtRef.current = Date.now();
                                      setDb((prev) => {
                                        const remaining = prev.tr069_profiles.filter(
                                          (item) => item.id !== p.id
                                        );
                                        if (
                                          remaining.length > 0 &&
                                          !remaining.some((r) => r.is_default)
                                        ) {
                                          remaining[0] = {
                                            ...remaining[0],
                                            is_default: true,
                                          };
                                        }
                                        return { ...prev, tr069_profiles: remaining };
                                      });
                                      showToast(`Profil "${p.profile_name}" dihapus.`);
                                    }}
                                    className="rounded bg-[#d9534f] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#c9302c]"
                                  >
                                    Hapus
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-500">Read-Only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {showTr069Modal && !isViewerUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
                  <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#1e3a5f] bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
                    <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
                      <h3 className="text-base font-bold text-white">
                        {editingTr069Profile
                          ? `Edit Profil TR-069 ISP (${editingTr069Profile.profile_name})`
                          : 'Tambah Profil TR-069 CWMP ISP'}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setShowTr069Modal(false)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block font-bold text-slate-200">
                          Nama Profil ISP
                        </label>
                        <input
                          type="text"
                          value={tr069FormName}
                          onChange={(e) => setTr069FormName(e.target.value)}
                          placeholder="misal: ISP-ACS-UTAMA"
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          ACS CWMP Server URL
                        </label>
                        <input
                          type="text"
                          value={tr069FormAcsUrl}
                          onChange={(e) => setTr069FormAcsUrl(e.target.value)}
                          placeholder="http://acs.isp.co.id:7547"
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          ACS Username
                        </label>
                        <input
                          type="text"
                          value={tr069FormAcsUser}
                          onChange={(e) => setTr069FormAcsUser(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          ACS Password
                        </label>
                        <input
                          type="text"
                          value={tr069FormAcsPass}
                          onChange={(e) => setTr069FormAcsPass(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          Connection Request Username
                        </label>
                        <input
                          type="text"
                          value={tr069FormConnReqUser}
                          onChange={(e) => setTr069FormConnReqUser(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          Connection Request Password
                        </label>
                        <input
                          type="text"
                          value={tr069FormConnReqPass}
                          onChange={(e) => setTr069FormConnReqPass(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          Mgmt VLAN ID (TR-069 &amp; VoIP)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="number"
                            min={1}
                            max={4094}
                            value={tr069FormMgmtVlanId}
                            onChange={(e) =>
                              setTr069FormMgmtVlanId(Number(e.target.value))
                            }
                            className="w-28 rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                          />
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                setTr069FormMgmtVlanId(Number(e.target.value));
                              }
                            }}
                            className="flex-1 rounded border border-slate-600 bg-[#1c2536] px-2 py-2 text-white"
                          >
                            <option value="">Pilih dari VLAN OLT...</option>
                            {targetOltVlans.map((v) => (
                              <option key={v.id} value={v.vlan_id}>
                                VLAN {v.vlan_id} - {v.description || v.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block font-bold text-slate-200">
                            802.1p Priority (0-7)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={7}
                            value={tr069FormPriority}
                            onChange={(e) =>
                              setTr069FormPriority(Number(e.target.value))
                            }
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-200">
                            Periodic Inform (detik)
                          </label>
                          <input
                            type="number"
                            min={30}
                            value={tr069FormPeriodicInterval}
                            onChange={(e) =>
                              setTr069FormPeriodicInterval(Number(e.target.value))
                            }
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          GPON TCONT Profile
                        </label>
                        <input
                          type="text"
                          value={tr069FormTcontProfile}
                          onChange={(e) => setTr069FormTcontProfile(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          GPON Traffic Profile (Downstream)
                        </label>
                        <input
                          type="text"
                          value={tr069FormTrafficProfile}
                          onChange={(e) =>
                            setTr069FormTrafficProfile(e.target.value)
                          }
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          VoIP SIP Server (Opsional)
                        </label>
                        <input
                          type="text"
                          value={tr069FormSipServer}
                          onChange={(e) => setTr069FormSipServer(e.target.value)}
                          placeholder="misal: 10.69.69.10:5060"
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-200">
                          Keterangan / Catatan ISP
                        </label>
                        <input
                          type="text"
                          value={tr069FormDescription}
                          onChange={(e) => setTr069FormDescription(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                        />
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 rounded border border-slate-700 bg-slate-900/60 p-3">
                      <label className="flex items-center gap-2 text-slate-200">
                        <input
                          type="checkbox"
                          checked={tr069FormVoipEnabled}
                          onChange={(e) =>
                            setTr069FormVoipEnabled(e.target.checked)
                          }
                        />
                        Aktifkan layanan VoIP SIP (`voip protocol sip`) pada VLAN Management
                      </label>
                      <label className="flex items-center gap-2 text-slate-200">
                        <input
                          type="checkbox"
                          checked={tr069AutoMarkVlan}
                          onChange={(e) => setTr069AutoMarkVlan(e.target.checked)}
                        />
                        Otomatis tandai VLAN {tr069FormMgmtVlanId} sebagai{' '}
                        <span className="font-bold text-amber-300">
                          Mgmt/TR069/VoIP Only (Tanpa Push Internet)
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-200">
                        <input
                          type="checkbox"
                          checked={tr069FormIsDefault}
                          onChange={(e) =>
                            setTr069FormIsDefault(e.target.checked)
                          }
                        />
                        Jadikan Profil Default TR-069 untuk OLT &amp; ONU baru
                      </label>
                    </div>

                    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-700 pt-3">
                      <button
                        type="button"
                        onClick={() => setShowTr069Modal(false)}
                        className="px-4 py-2 text-slate-300 hover:text-white"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveTr069Profile(false)}
                        className="rounded bg-[#5cb85c] px-4 py-2 font-bold text-white hover:bg-[#4cae4c]"
                      >
                        Simpan Profil
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveTr069Profile(true)}
                        className="rounded bg-[#0275d8] px-4 py-2 font-bold text-white hover:bg-[#025aa5]"
                      >
                        Simpan &amp; Push ke OLT
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ===================================================================
            VIEW 10: ZONES, SECTORS, SPLITTERS, SPEED PROFILES, GRAPHS
           =================================================================== */}
        {(activeView === 'ZONES' ||
          activeView === 'SECTORS' ||
          activeView === 'SPLITTERS' ||
          activeView === 'USERS' ||
          activeView === 'SPEED_PROFILES' ||
          activeView === 'GRAPHS') && (
          <div className="space-y-4 text-xs">
            {/* Synchronized Sub-Navigation Tabs for Settings -> Zones / Sectors / Splitters / Users */}
            {(activeView === 'ZONES' ||
              activeView === 'SECTORS' ||
              activeView === 'SPLITTERS' ||
              activeView === 'USERS') && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-900/80 p-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                  <button
                    type="button"
                    onClick={() => setActiveView('ZONES')}
                    className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition whitespace-nowrap ${
                      activeView === 'ZONES'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    Zones ({visibleZones.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView('SECTORS')}
                    className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition whitespace-nowrap ${
                      activeView === 'SECTORS'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    Sectors / RK ({visibleSectors.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView('SPLITTERS')}
                    className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition whitespace-nowrap ${
                      activeView === 'SPLITTERS'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    Splitters / ODP ({visibleOdbs.length})
                  </button>
                  {isAdminUser && (
                    <button
                      type="button"
                      onClick={() => setActiveView('USERS')}
                      className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition whitespace-nowrap ${
                        activeView === 'USERS'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      Users &amp; Hak Akses ({appUsers.length})
                    </button>
                  )}
                </div>

                <div className="text-[11px] text-emerald-400 font-medium">
                  ✓ Otomatis tersinkronisasi ke Database SQL &amp; Hak Akses User
                </div>
              </div>
            )}

            {/* ===============================================================
                10A: ZONES MANAGEMENT (Settings -> Zones)
               =============================================================== */}
            {activeView === 'ZONES' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">Zones</h2>
                    <p className="text-xs text-slate-400">
                      Kelola area/wilayah jaringan (Zone). Setiap Zone otomatis tampil dan dapat dipilih saat Add/Authorize ONU.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={zoneSearch}
                      onChange={(e) => setZoneSearch(e.target.value)}
                      placeholder="Cari Zone, Code, Kota..."
                      className="flex-1 sm:w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                    />
                    {!isViewerUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingZone(null);
                          setZoneFormName('');
                          setZoneFormCode(`ZN-0${db.zones.length + 1}`);
                          setZoneFormCity('Lebak');
                          setZoneFormDesc('');
                          setShowZoneModal(true);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Zone
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Zone Name</th>
                        <th className="px-4 py-3">Code</th>
                        <th className="px-4 py-3">City / District</th>
                        <th className="px-4 py-3">Sectors</th>
                        <th className="px-4 py-3">Splitters (ODP)</th>
                        <th className="px-4 py-3">ONUs</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e3a5f]/70">
                      {visibleZones.filter((z) => {
                        if (!zoneSearch.trim()) return true;
                        const q = zoneSearch.toLowerCase();
                        return (
                          z.name.toLowerCase().includes(q) ||
                          z.code.toLowerCase().includes(q) ||
                          z.city_district.toLowerCase().includes(q)
                        );
                      }).length === 0 ? (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-4 py-8 text-center text-slate-400"
                          >
                            Belum ada Zone terdaftar atau di-assign. Klik tombol{' '}
                            <strong className="text-emerald-400">+ Add Zone</strong>{' '}
                            untuk membuat Zone baru.
                          </td>
                        </tr>
                      ) : (
                        visibleZones
                          .filter((z) => {
                            if (!zoneSearch.trim()) return true;
                            const q = zoneSearch.toLowerCase();
                            return (
                              z.name.toLowerCase().includes(q) ||
                              z.code.toLowerCase().includes(q) ||
                              z.city_district.toLowerCase().includes(q)
                            );
                          })
                          .map((z) => {
                            const secCount = (db.sectors || []).filter(
                              (s) => s.zone_id === z.id
                            ).length;
                            const zoneSplitters = db.odbs.filter(
                              (o) => o.zone_id === z.id
                            );
                            const spCount = zoneSplitters.length;
                            const zoneSplitterIds = new Set(
                              zoneSplitters.map((o) => o.id)
                            );
                            const attachedZoneOnus = db.onus.filter(
                              (u) =>
                                u.is_authorized &&
                                (u.zone_id === z.id ||
                                  (u.odb_id !== null &&
                                    zoneSplitterIds.has(u.odb_id)))
                            );
                            const onuCount = attachedZoneOnus.length;
                            const isZoneDeleteLocked = onuCount > 0;
                            return (
                              <tr key={z.id} className="hover:bg-[#132842]/60">
                                <td className="px-4 py-3 font-mono text-white">
                                  {z.id}
                                </td>
                                <td className="px-4 py-3 font-bold text-white">
                                  {z.name}
                                </td>
                                <td className="px-4 py-3 font-mono text-sky-400">
                                  {z.code}
                                </td>
                                <td className="px-4 py-3 text-slate-200">
                                  {z.city_district}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                  <span className="rounded bg-sky-950/90 border border-sky-600/40 px-2 py-0.5 text-sky-300">
                                    {secCount} Sectors
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono">
                                  <span className="rounded bg-amber-950/90 border border-amber-600/40 px-2 py-0.5 text-amber-300">
                                    {spCount} ODP
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono">
                                  <span className="rounded bg-emerald-950/90 border border-emerald-600/40 px-2 py-0.5 text-emerald-300">
                                    {onuCount} ONUs
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-300">
                                  {z.description || '-'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {!isViewerUser ? (
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSector(null);
                                          setSectorFormName('');
                                          setSectorFormCode(
                                            `SEC-0${(db.sectors || []).length + 1}`
                                          );
                                          setSectorFormZoneId(z.id);
                                          setSectorFormOltId(
                                            db.olts[0]?.id || 'NONE'
                                          );
                                          setSectorFormPortId(
                                            db.pon_ports[0]?.id || 'NONE'
                                          );
                                          setSectorFormDesc('');
                                          setActiveView('SECTORS');
                                          setShowSectorModal(true);
                                        }}
                                        className="rounded bg-sky-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-600"
                                      >
                                        + Sector
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSplitter(null);
                                          setSplitterFormName('');
                                          setSplitterFormZoneId(z.id);
                                          setSplitterFormSectorId('NONE');
                                          setSplitterFormOltId(db.olts[0]?.id || 1);
                                          setSplitterFormPortId(
                                            db.pon_ports[0]?.id || 1
                                          );
                                          setSplitterFormRatio('1:8');
                                          setSplitterFormPole('TIANG-01');
                                          setActiveView('SPLITTERS');
                                          setShowSplitterModal(true);
                                        }}
                                        className="rounded bg-amber-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
                                      >
                                        + ODP
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingZone(z);
                                          setZoneFormName(z.name);
                                          setZoneFormCode(z.code);
                                          setZoneFormCity(z.city_district);
                                          setZoneFormDesc(z.description);
                                          setShowZoneModal(true);
                                        }}
                                        className="rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#025aa5]"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        title={
                                          isZoneDeleteLocked
                                            ? `Tidak dapat dihapus: masih ada ${onuCount} ONU di Splitter / Zone ini`
                                            : `Hapus Zone ${z.name}`
                                        }
                                        onClick={() => {
                                          if (isZoneDeleteLocked) {
                                            showToast(
                                              `⚠ Zone "${z.name}" tidak dapat dihapus karena masih ada ${onuCount} ONU yang terhubung di Splitter / Zone ini!`
                                            );
                                            return;
                                          }
                                          nextSyncIsUserMutationRef.current = true;
                                          lastUserMutationAtRef.current = Date.now();
                                          setDb((prev) => ({
                                            ...prev,
                                            zones: prev.zones.filter(
                                              (item) => item.id !== z.id
                                            ),
                                          }));
                                          showToast(`Zone "${z.name}" dihapus.`);
                                        }}
                                        className={`rounded p-1 transition ${
                                          isZoneDeleteLocked
                                            ? 'cursor-not-allowed bg-slate-700/70 text-slate-400 hover:bg-slate-700'
                                            : 'bg-[#d9534f] text-white hover:bg-[#c9302c]'
                                        }`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-500">Read-Only</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add / Edit Zone Modal */}
                {showZoneModal && !isViewerUser && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
                        <h3 className="text-base font-bold text-white">
                          {editingZone ? `Edit Zone — ${editingZone.name}` : 'Add New Zone'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setShowZoneModal(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!zoneFormName.trim()) return;
                          if (editingZone) {
                            nextSyncIsUserMutationRef.current = true;
                            lastUserMutationAtRef.current = Date.now();
                            setDb((prev) => ({
                              ...prev,
                              zones: prev.zones.map((z) =>
                                z.id === editingZone.id
                                  ? {
                                      ...z,
                                      name: zoneFormName.trim().toUpperCase(),
                                      code: zoneFormCode.trim().toUpperCase(),
                                      city_district: zoneFormCity.trim(),
                                      description: zoneFormDesc.trim(),
                                    }
                                  : z
                              ),
                            }));
                            showToast(`✓ Zone "${zoneFormName.toUpperCase()}" diperbarui!`);
                          } else {
                            handleQuickAddZone({
                              name: zoneFormName.trim().toUpperCase(),
                              code:
                                zoneFormCode.trim().toUpperCase() ||
                                `ZN-0${db.zones.length + 1}`,
                              city_district: zoneFormCity.trim() || 'Lebak',
                              description: zoneFormDesc.trim() || `Zone ${zoneFormName.trim().toUpperCase()}`,
                            });
                          }
                          setShowZoneModal(false);
                        }}
                        className="space-y-3"
                      >
                        <div>
                          <label className="block font-bold text-slate-200">
                            Zone Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={zoneFormName}
                            onChange={(e) => setZoneFormName(e.target.value)}
                            placeholder="Contoh: MUARA LEBAK - RK 01"
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block font-bold text-slate-200">
                              Zone Code
                            </label>
                            <input
                              type="text"
                              value={zoneFormCode}
                              onChange={(e) => setZoneFormCode(e.target.value)}
                              placeholder="Contoh: ZN-ML01"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              City / District
                            </label>
                            <input
                              type="text"
                              value={zoneFormCity}
                              onChange={(e) => setZoneFormCity(e.target.value)}
                              placeholder="Contoh: Rangkasbitung / Lebak"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block font-bold text-slate-200">
                            Description
                          </label>
                          <input
                            type="text"
                            value={zoneFormDesc}
                            onChange={(e) => setZoneFormDesc(e.target.value)}
                            placeholder="Keterangan area distribusi fiber"
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                          />
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-700 pt-3">
                          <button
                            type="button"
                            onClick={() => setShowZoneModal(false)}
                            className="px-3 py-1.5 text-slate-300 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="rounded bg-[#5cb85c] px-4 py-1.5 font-bold text-white hover:bg-[#4cae4c]"
                          >
                            Save Zone
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===============================================================
                10B: SECTORS MANAGEMENT (Settings -> Sectors)
               =============================================================== */}
            {activeView === 'SECTORS' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">Sectors</h2>
                    <p className="text-xs text-slate-400">
                      Kelola Sector distribusi ODC/PON yang terhubung dengan Zone, OLT, dan Splitter (ODP).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={sectorSearch}
                      onChange={(e) => setSectorSearch(e.target.value)}
                      placeholder="Cari Sector, Code, Zone..."
                      className="flex-1 sm:w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                    />
                    {!isViewerUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSector(null);
                          setSectorFormName('');
                          setSectorFormCode(
                            `SEC-0${(db.sectors || []).length + 1}`
                          );
                          setSectorFormZoneId(db.zones[0]?.id || 'NONE');
                          setSectorFormOltId(db.olts[0]?.id || 'NONE');
                          setSectorFormPortId(db.pon_ports[0]?.id || 'NONE');
                          setSectorFormDesc('');
                          setShowSectorModal(true);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Sector
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Sector Name</th>
                        <th className="px-4 py-3">Code</th>
                        <th className="px-4 py-3">Zone</th>
                        <th className="px-4 py-3">OLT &amp; PON Port</th>
                        <th className="px-4 py-3">Splitters (ODP)</th>
                        <th className="px-4 py-3">ONUs</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e3a5f]/70">
                      {visibleSectors.filter((s) => {
                        if (!sectorSearch.trim()) return true;
                        const q = sectorSearch.toLowerCase();
                        return (
                          s.name.toLowerCase().includes(q) ||
                          s.code.toLowerCase().includes(q)
                        );
                      }).length === 0 ? (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-4 py-8 text-center text-slate-400"
                          >
                            Belum ada Sector / RK terdaftar atau di-assign. Klik tombol{' '}
                            <strong className="text-emerald-400">+ Add Sector</strong>{' '}
                            untuk membuat Sector baru.
                          </td>
                        </tr>
                      ) : (
                        visibleSectors
                          .filter((s) => {
                            if (!sectorSearch.trim()) return true;
                            const q = sectorSearch.toLowerCase();
                            return (
                              s.name.toLowerCase().includes(q) ||
                              s.code.toLowerCase().includes(q)
                            );
                          })
                          .map((s) => {
                            const zObj = db.zones.find((z) => z.id === s.zone_id);
                            const oObj = db.olts.find((o) => o.id === s.olt_id);
                            const pObj = db.pon_ports.find(
                              (p) => p.id === s.pon_port_id
                            );
                            const spCount = db.odbs.filter(
                              (o) => o.sector_id === s.id
                            ).length;
                            const onuCount = db.onus.filter(
                              (u) => u.is_authorized && u.sector_id === s.id
                            ).length;
                            return (
                              <tr key={s.id} className="hover:bg-[#132842]/60">
                                <td className="px-4 py-3 font-mono text-white">
                                  {s.id}
                                </td>
                                <td className="px-4 py-3 font-bold text-white">
                                  {s.name}
                                </td>
                                <td className="px-4 py-3 font-mono text-sky-400">
                                  {s.code}
                                </td>
                                <td className="px-4 py-3 text-slate-200">
                                  {zObj ? zObj.name : '-'}
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-200">
                                  {oObj ? oObj.name : 'All OLT'}{' '}
                                  {pObj ? `· ${pObj.interface_name}` : ''}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                  <span className="rounded bg-amber-950/90 border border-amber-600/40 px-2 py-0.5 text-amber-300">
                                    {spCount} ODP
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono">
                                  <span className="rounded bg-emerald-950/90 border border-emerald-600/40 px-2 py-0.5 text-emerald-300">
                                    {onuCount} ONUs
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-300">
                                  {s.description || '-'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {!isViewerUser ? (
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSplitter(null);
                                          setSplitterFormName('');
                                          setSplitterFormZoneId(
                                            s.zone_id || db.zones[0]?.id || 1
                                          );
                                          setSplitterFormSectorId(s.id);
                                          setSplitterFormOltId(
                                            s.olt_id || db.olts[0]?.id || 1
                                          );
                                          setSplitterFormPortId(
                                            s.pon_port_id ||
                                              db.pon_ports[0]?.id ||
                                              1
                                          );
                                          setSplitterFormRatio('1:8');
                                          setSplitterFormPole('TIANG-01');
                                          setActiveView('SPLITTERS');
                                          setShowSplitterModal(true);
                                        }}
                                        className="rounded bg-amber-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
                                      >
                                        + ODP
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSector(s);
                                          setSectorFormName(s.name);
                                          setSectorFormCode(s.code);
                                          setSectorFormZoneId(s.zone_id ?? 'NONE');
                                          setSectorFormOltId(s.olt_id ?? 'NONE');
                                          setSectorFormPortId(
                                            s.pon_port_id ?? 'NONE'
                                          );
                                          setSectorFormDesc(s.description);
                                          setShowSectorModal(true);
                                        }}
                                        className="rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#025aa5]"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          nextSyncIsUserMutationRef.current = true;
                                          lastUserMutationAtRef.current = Date.now();
                                          setDb((prev) => ({
                                            ...prev,
                                            sectors: (prev.sectors || []).filter(
                                              (item) => item.id !== s.id
                                            ),
                                          }));
                                          showToast(`Sector "${s.name}" dihapus.`);
                                        }}
                                        className="rounded bg-[#d9534f] p-1 text-white hover:bg-[#c9302c]"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-500">Read-Only</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add / Edit Sector Modal */}
                {showSectorModal && !isViewerUser && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
                        <h3 className="text-base font-bold text-white">
                          {editingSector
                            ? `Edit Sector — ${editingSector.name}`
                            : 'Add New Sector'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setShowSectorModal(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!sectorFormName.trim()) return;
                          if (editingSector) {
                            nextSyncIsUserMutationRef.current = true;
                            lastUserMutationAtRef.current = Date.now();
                            setDb((prev) => ({
                              ...prev,
                              sectors: (prev.sectors || []).map((s) =>
                                s.id === editingSector.id
                                  ? {
                                      ...s,
                                      name: sectorFormName.trim().toUpperCase(),
                                      code: sectorFormCode.trim().toUpperCase(),
                                      zone_id:
                                        sectorFormZoneId === 'NONE'
                                          ? null
                                          : sectorFormZoneId,
                                      olt_id:
                                        sectorFormOltId === 'NONE'
                                          ? null
                                          : sectorFormOltId,
                                      pon_port_id:
                                        sectorFormPortId === 'NONE'
                                          ? null
                                          : sectorFormPortId,
                                      description: sectorFormDesc.trim(),
                                    }
                                  : s
                              ),
                            }));
                            showToast(
                              `✓ Sector "${sectorFormName.toUpperCase()}" diperbarui!`
                            );
                          } else {
                            handleQuickAddSector({
                              name: sectorFormName.trim().toUpperCase(),
                              code:
                                sectorFormCode.trim().toUpperCase() ||
                                `SEC-0${(db.sectors || []).length + 1}`,
                              zone_id:
                                sectorFormZoneId === 'NONE'
                                  ? null
                                  : sectorFormZoneId,
                              olt_id:
                                sectorFormOltId === 'NONE'
                                  ? null
                                  : sectorFormOltId,
                              pon_port_id:
                                sectorFormPortId === 'NONE'
                                  ? null
                                  : sectorFormPortId,
                              description: sectorFormDesc.trim(),
                            });
                          }
                          setShowSectorModal(false);
                        }}
                        className="space-y-3"
                      >
                        <div>
                          <label className="block font-bold text-slate-200">
                            Sector Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={sectorFormName}
                            onChange={(e) => setSectorFormName(e.target.value)}
                            placeholder="Contoh: SECTOR UTARA - ODC 01"
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block font-bold text-slate-200">
                              Sector Code
                            </label>
                            <input
                              type="text"
                              value={sectorFormCode}
                              onChange={(e) => setSectorFormCode(e.target.value)}
                              placeholder="SEC-01"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Linked Zone
                            </label>
                            <select
                              value={sectorFormZoneId}
                              onChange={(e) =>
                                setSectorFormZoneId(
                                  e.target.value === 'NONE'
                                    ? 'NONE'
                                    : Number(e.target.value)
                                )
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                            >
                              <option value="NONE">None / All Zones</option>
                              {db.zones.map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block font-bold text-slate-200">
                              OLT
                            </label>
                            <select
                              value={sectorFormOltId}
                              onChange={(e) =>
                                setSectorFormOltId(
                                  e.target.value === 'NONE'
                                    ? 'NONE'
                                    : Number(e.target.value)
                                )
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                            >
                              <option value="NONE">Any OLT</option>
                              {db.olts.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.id} - {o.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              PON Port
                            </label>
                            <select
                              value={sectorFormPortId}
                              onChange={(e) =>
                                setSectorFormPortId(
                                  e.target.value === 'NONE'
                                    ? 'NONE'
                                    : Number(e.target.value)
                                )
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            >
                              <option value="NONE">Any PON Port</option>
                              {db.pon_ports.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.interface_name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block font-bold text-slate-200">
                            Description
                          </label>
                          <input
                            type="text"
                            value={sectorFormDesc}
                            onChange={(e) => setSectorFormDesc(e.target.value)}
                            placeholder="Keterangan jalur feeder/distribusi sector"
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                          />
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-700 pt-3">
                          <button
                            type="button"
                            onClick={() => setShowSectorModal(false)}
                            className="px-3 py-1.5 text-slate-300 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="rounded bg-[#5cb85c] px-4 py-1.5 font-bold text-white hover:bg-[#4cae4c]"
                          >
                            Save Sector
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===============================================================
                10C: SPLITTERS / ODP / ODB MANAGEMENT (Settings -> Splitters)
               =============================================================== */}
            {activeView === 'SPLITTERS' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      Optical Splitters (ODP / ODB)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Kelola titik distribusi optik (Splitter / ODP) beserta rasio port (1:2 s/d 1:64), Zone, Sector, dan kapasitas port ONU.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={splitterSearch}
                      onChange={(e) => setSplitterSearch(e.target.value)}
                      placeholder="Cari Nama ODP/Splitter, Tiang..."
                      className="flex-1 sm:w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                    />
                    {!isViewerUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSplitter(null);
                          setSplitterFormName('');
                          setSplitterFormZoneId(db.zones[0]?.id || 1);
                          setSplitterFormSectorId(
                            (db.sectors && db.sectors[0]?.id) || 'NONE'
                          );
                          setSplitterFormOltId(db.olts[0]?.id || 1);
                          setSplitterFormPortId(db.pon_ports[0]?.id || 1);
                          setSplitterFormRatio('1:8');
                          setSplitterFormPole(`TIANG-0${db.odbs.length + 1}`);
                          setSplitterFormLat('-6.355');
                          setSplitterFormLng('106.251');
                          setSplitterFormDesc('');
                          setShowSplitterModal(true);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Splitter (ODP)
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Splitter / ODP Name</th>
                        <th className="px-4 py-3">Ratio</th>
                        <th className="px-4 py-3">Port Usage</th>
                        <th className="px-4 py-3">Zone</th>
                        <th className="px-4 py-3">Sector</th>
                        <th className="px-4 py-3">Pole / Tiang</th>
                        <th className="px-4 py-3">GPS Coordinates</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e3a5f]/70">
                      {visibleOdbs.filter((o) => {
                        if (!splitterSearch.trim()) return true;
                        const q = splitterSearch.toLowerCase();
                        return (
                          o.name.toLowerCase().includes(q) ||
                          o.pole_number.toLowerCase().includes(q)
                        );
                      }).length === 0 ? (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-4 py-8 text-center text-slate-400"
                          >
                            Belum ada Splitter (ODP/ODB) terdaftar atau di-assign. Klik tombol{' '}
                            <strong className="text-emerald-400">
                              + Add Splitter (ODP)
                            </strong>{' '}
                            untuk menambahkan ODP baru.
                          </td>
                        </tr>
                      ) : (
                        visibleOdbs
                          .filter((o) => {
                            if (!splitterSearch.trim()) return true;
                            const q = splitterSearch.toLowerCase();
                            return (
                              o.name.toLowerCase().includes(q) ||
                              o.pole_number.toLowerCase().includes(q)
                            );
                          })
                          .map((o) => {
                            const zObj = db.zones.find(
                              (z) => z.id === o.zone_id
                            );
                            const secObj = (db.sectors || []).find(
                              (s) => s.id === o.sector_id
                            );
                            const attachedOnus = db.onus.filter(
                              (u) => u.is_authorized && u.odb_id === o.id
                            );
                            const usedPorts = attachedOnus.length;
                            const pct = Math.min(
                              100,
                              Math.round((usedPorts / (o.total_ports || 8)) * 100)
                            );
                            return (
                              <tr key={o.id} className="hover:bg-[#132842]/60">
                                <td className="px-4 py-3 font-mono text-white">
                                  {o.id}
                                </td>
                                <td className="px-4 py-3 font-bold text-white">
                                  {o.name}
                                </td>
                                <td className="px-4 py-3 font-mono text-emerald-400">
                                  {o.splitter_ratio}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2 font-mono">
                                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-700">
                                      <div
                                        className={`h-full ${
                                          pct >= 90
                                            ? 'bg-red-500'
                                            : pct >= 70
                                              ? 'bg-amber-500'
                                              : 'bg-emerald-500'
                                        }`}
                                        style={{ width: `${Math.max(6, pct)}%` }}
                                      />
                                    </div>
                                    <span className="font-bold text-white">
                                      {usedPorts} / {o.total_ports}
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      ({Math.max(0, o.total_ports - usedPorts)} free)
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-slate-200">
                                  {zObj ? zObj.name : '-'}
                                </td>
                                <td className="px-4 py-3 text-sky-300">
                                  {secObj ? secObj.name : '-'}
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-200">
                                  {o.pole_number}
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-300">
                                  {o.latitude}, {o.longitude}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {!isViewerUser ? (
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingSplitter(o);
                                          setSplitterFormName(o.name);
                                          setSplitterFormZoneId(
                                            o.zone_id || db.zones[0]?.id || 1
                                          );
                                          setSplitterFormSectorId(
                                            o.sector_id ?? 'NONE'
                                          );
                                          setSplitterFormOltId(
                                            o.olt_id || db.olts[0]?.id || 1
                                          );
                                          setSplitterFormPortId(
                                            o.pon_port_id || 1
                                          );
                                          setSplitterFormRatio(o.splitter_ratio);
                                          setSplitterFormPole(o.pole_number);
                                          setSplitterFormLat(String(o.latitude));
                                          setSplitterFormLng(String(o.longitude));
                                          setSplitterFormDesc(o.description || '');
                                          setShowSplitterModal(true);
                                        }}
                                        className="rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#025aa5]"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        title={
                                          usedPorts > 0
                                            ? `Tidak dapat dihapus: masih ada ${usedPorts} ONU di Splitter ini`
                                            : `Hapus Splitter ${o.name}`
                                        }
                                        onClick={() => {
                                          if (usedPorts > 0) {
                                            showToast(
                                              `⚠ Splitter / ODP "${o.name}" tidak dapat dihapus karena masih ada ${usedPorts} ONU yang terhubung di Splitter ini!`
                                            );
                                            return;
                                          }
                                          nextSyncIsUserMutationRef.current = true;
                                          lastUserMutationAtRef.current = Date.now();
                                          setDb((prev) => ({
                                            ...prev,
                                            odbs: prev.odbs.filter(
                                              (item) => item.id !== o.id
                                            ),
                                          }));
                                          showToast(
                                            `Splitter "${o.name}" dihapus.`
                                          );
                                        }}
                                        className={`rounded p-1 transition ${
                                          usedPorts > 0
                                            ? 'cursor-not-allowed bg-slate-700/70 text-slate-400 hover:bg-slate-700'
                                            : 'bg-[#d9534f] text-white hover:bg-[#c9302c]'
                                        }`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-500">Read-Only</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add / Edit Splitter Modal */}
                {showSplitterModal && !isViewerUser && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
                        <h3 className="text-base font-bold text-white">
                          {editingSplitter
                            ? `Edit Splitter (ODP) — ${editingSplitter.name}`
                            : 'Add New Optical Splitter (ODP / ODB)'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setShowSplitterModal(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!splitterFormName.trim()) return;
                          const totalPorts =
                            Number(splitterFormRatio.split(':')[1]) || 8;
                          if (editingSplitter) {
                            nextSyncIsUserMutationRef.current = true;
                            lastUserMutationAtRef.current = Date.now();
                            setDb((prev) => ({
                              ...prev,
                              odbs: prev.odbs.map((o) =>
                                o.id === editingSplitter.id
                                  ? {
                                      ...o,
                                      name: splitterFormName
                                        .trim()
                                        .toUpperCase(),
                                      zone_id: splitterFormZoneId,
                                      sector_id:
                                        splitterFormSectorId === 'NONE'
                                          ? null
                                          : splitterFormSectorId,
                                      olt_id: splitterFormOltId,
                                      pon_port_id: splitterFormPortId,
                                      splitter_ratio: splitterFormRatio,
                                      total_ports: totalPorts,
                                      pole_number: splitterFormPole.trim(),
                                      latitude:
                                        parseFloat(splitterFormLat) || -6.355,
                                      longitude:
                                        parseFloat(splitterFormLng) || 106.251,
                                      description: splitterFormDesc.trim(),
                                    }
                                  : o
                              ),
                            }));
                            showToast(
                              `✓ Splitter "${splitterFormName.toUpperCase()}" diperbarui!`
                            );
                          } else {
                            handleQuickAddSplitter({
                              name: splitterFormName.trim().toUpperCase(),
                              zone_id: splitterFormZoneId,
                              sector_id:
                                splitterFormSectorId === 'NONE'
                                  ? null
                                  : splitterFormSectorId,
                              olt_id: splitterFormOltId,
                              pon_port_id: splitterFormPortId,
                              splitter_ratio: splitterFormRatio,
                              total_ports: totalPorts,
                              pole_number:
                                splitterFormPole.trim() || 'TIANG-01',
                              latitude: parseFloat(splitterFormLat) || -6.355,
                              longitude: parseFloat(splitterFormLng) || 106.251,
                              description: splitterFormDesc.trim(),
                            });
                          }
                          setShowSplitterModal(false);
                        }}
                        className="space-y-3"
                      >
                        <div>
                          <label className="block font-bold text-slate-200">
                            Splitter / ODP Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={splitterFormName}
                            onChange={(e) =>
                              setSplitterFormName(e.target.value)
                            }
                            placeholder="Contoh: ODP-ML-01 atau 01-010111"
                            className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block font-bold text-slate-200">
                              Splitter Ratio
                            </label>
                            <select
                              value={splitterFormRatio}
                              onChange={(e) =>
                                setSplitterFormRatio(
                                  e.target.value as
                                    | '1:2'
                                    | '1:4'
                                    | '1:8'
                                    | '1:16'
                                    | '1:32'
                                    | '1:64'
                                )
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            >
                              <option value="1:2">1:2 (2 Ports)</option>
                              <option value="1:4">1:4 (4 Ports)</option>
                              <option value="1:8">1:8 (8 Ports)</option>
                              <option value="1:16">1:16 (16 Ports)</option>
                              <option value="1:32">1:32 (32 Ports)</option>
                              <option value="1:64">1:64 (64 Ports)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Pole / Tiang Number
                            </label>
                            <input
                              type="text"
                              value={splitterFormPole}
                              onChange={(e) =>
                                setSplitterFormPole(e.target.value)
                              }
                              placeholder="TIANG-01"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block font-bold text-slate-200">
                              Zone
                            </label>
                            <select
                              value={splitterFormZoneId}
                              onChange={(e) =>
                                setSplitterFormZoneId(Number(e.target.value))
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                            >
                              {db.zones.length === 0 ? (
                                <option value={1}>Default Zone (1)</option>
                              ) : (
                                db.zones.map((z) => (
                                  <option key={z.id} value={z.id}>
                                    {z.name}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Sector
                            </label>
                            <select
                              value={splitterFormSectorId}
                              onChange={(e) =>
                                setSplitterFormSectorId(
                                  e.target.value === 'NONE'
                                    ? 'NONE'
                                    : Number(e.target.value)
                                )
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
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
                            <label className="block font-bold text-slate-200">
                              Latitude
                            </label>
                            <input
                              type="text"
                              value={splitterFormLat}
                              onChange={(e) =>
                                setSplitterFormLat(e.target.value)
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Longitude
                            </label>
                            <input
                              type="text"
                              value={splitterFormLng}
                              onChange={(e) =>
                                setSplitterFormLng(e.target.value)
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-700 pt-3">
                          <button
                            type="button"
                            onClick={() => setShowSplitterModal(false)}
                            className="px-3 py-1.5 text-slate-300 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="rounded bg-[#5cb85c] px-4 py-1.5 font-bold text-white hover:bg-[#4cae4c]"
                          >
                            Save Splitter (ODP)
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===============================================================
                10D: USER MANAGEMENT & ACCESS ASSIGNMENT (OLT, ZONE & RK/ODP)
               =============================================================== */}
            {activeView === 'USERS' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      User Management &amp; Hak Akses (OLT, Zone &amp; RK / Splitter)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Kelola akun pengguna dan tentukan OLT mana saja, Zone mana saja, serta RK (Sector &amp; Splitter/ODP) mana saja yang ditampilkan untuk setiap user.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Cari Username, Nama, Role..."
                      className="flex-1 sm:w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                    />
                    {isAdminUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUser(null);
                          setUserFormUsername('');
                          setUserFormFullName('');
                          setUserFormEmail('');
                          setUserFormPassword('jetcyber123');
                          setUserFormRole('OPERATOR');
                          setUserFormActive(true);
                          setUserFormAllOlts(false);
                          setUserFormOltIds(
                            db.olts[0]?.id ? [db.olts[0].id] : []
                          );
                          setUserFormAllZones(false);
                          setUserFormZoneIds(
                            db.zones[0]?.id ? [db.zones[0].id] : []
                          );
                          setUserFormAllRks(false);
                          setUserFormSectorIds([]);
                          setUserFormOdbIds([]);
                          setShowUserModal(true);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add User &amp; Assign Akses
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#1e3a5f] bg-[#162942] text-slate-300">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Username &amp; Nama</th>
                        <th className="px-4 py-3">Role &amp; Status</th>
                        <th className="px-4 py-3">Assigned OLTs</th>
                        <th className="px-4 py-3">Assigned Zones</th>
                        <th className="px-4 py-3">
                          Assigned RK (Sector &amp; Splitter/ODP)
                        </th>
                        <th className="px-4 py-3">Last Login (WIB)</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e3a5f]/70">
                      {appUsers
                        .filter((u) => {
                          if (!userSearch.trim()) return true;
                          const q = userSearch.toLowerCase();
                          return (
                            u.username.toLowerCase().includes(q) ||
                            u.full_name.toLowerCase().includes(q) ||
                            u.email.toLowerCase().includes(q) ||
                            u.role.toLowerCase().includes(q)
                          );
                        })
                        .map((u) => {
                          const assignedOltNames = u.access_all_olts
                            ? ['Semua OLT']
                            : db.olts
                                .filter((o) =>
                                  (u.allowed_olt_ids || []).includes(o.id)
                                )
                                .map((o) => o.name);
                          const assignedZoneNames = u.access_all_zones
                            ? ['Semua Zone']
                            : db.zones
                                .filter((z) =>
                                  (u.allowed_zone_ids || []).includes(z.id)
                                )
                                .map((z) => z.name);
                          const assignedSectorNames = (db.sectors || [])
                            .filter((s) =>
                              (u.allowed_sector_ids || []).includes(s.id)
                            )
                            .map((s) => s.name);
                          const assignedOdbNames = db.odbs
                            .filter((o) =>
                              (u.allowed_odb_ids || []).includes(o.id)
                            )
                            .map((o) => o.name);
                          const combinedRkNames = [
                            ...assignedSectorNames.map((n) => `RK: ${n}`),
                            ...assignedOdbNames.map((n) => `ODP: ${n}`),
                          ];

                          return (
                            <tr key={u.id} className="hover:bg-[#132842]/60">
                              <td className="px-4 py-3 font-mono text-white">
                                {u.id}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-bold text-white">
                                  {u.username}{' '}
                                  {u.id === currentUser.id && (
                                    <span className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                                      Aktif (Anda)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-300">
                                  {u.full_name} · {u.email}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                                      u.role === 'ADMIN'
                                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                        : u.role === 'OPERATOR'
                                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    }`}
                                  >
                                    {u.role}
                                  </span>
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                      u.is_active
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/40'
                                        : 'bg-red-950 text-red-300 border border-red-600/40'
                                    }`}
                                  >
                                    {u.is_active ? 'Active' : 'Disabled'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {u.access_all_olts ? (
                                  <span className="rounded bg-emerald-950/90 border border-emerald-600/40 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                                    Semua OLT ({db.olts.length})
                                  </span>
                                ) : assignedOltNames.length === 0 ? (
                                  <span className="text-red-400">
                                    0 OLT (Belum di-assign)
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {assignedOltNames.map((n, idx) => (
                                      <span
                                        key={idx}
                                        className="rounded bg-sky-950/90 border border-sky-600/40 px-2 py-0.5 font-mono text-[10px] text-sky-300"
                                      >
                                        {n}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {u.access_all_zones ? (
                                  <span className="rounded bg-emerald-950/90 border border-emerald-600/40 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                                    Semua Zone ({db.zones.length})
                                  </span>
                                ) : assignedZoneNames.length === 0 ? (
                                  <span className="text-red-400">
                                    0 Zone (Belum di-assign)
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {assignedZoneNames.map((n, idx) => (
                                      <span
                                        key={idx}
                                        className="rounded bg-amber-950/90 border border-amber-600/40 px-2 py-0.5 font-mono text-[10px] text-amber-300"
                                      >
                                        {n}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {u.access_all_rks ? (
                                  <span className="rounded bg-emerald-950/90 border border-emerald-600/40 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                                    Semua RK / Sector &amp; ODP
                                  </span>
                                ) : combinedRkNames.length === 0 ? (
                                  <span className="text-red-400">
                                    0 RK / ODP (Belum di-assign)
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {combinedRkNames.slice(0, 4).map((n, idx) => (
                                      <span
                                        key={idx}
                                        className="rounded bg-indigo-950/90 border border-indigo-500/40 px-2 py-0.5 font-mono text-[10px] text-indigo-300"
                                      >
                                        {n}
                                      </span>
                                    ))}
                                    {combinedRkNames.length > 4 && (
                                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                                        +{combinedRkNames.length - 4} lainnya
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 font-mono text-[11px] text-slate-300">
                                {u.last_login_at || '-'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {u.id !== currentUser.id && u.is_active && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleAdminSwitchUser(u);
                                      }}
                                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                                      title="Uji tampilan aplikasi menggunakan akun user ini"
                                    >
                                      Switch User
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openChangePasswordModal(u)}
                                    className="inline-flex items-center gap-1 rounded bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-slate-600 hover:text-white"
                                    title={`Ubah password untuk ${u.username}`}
                                  >
                                    <Lock className="h-3 w-3" />
                                    Ubah Password
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingUser(u);
                                      setUserFormUsername(u.username);
                                      setUserFormFullName(u.full_name);
                                      setUserFormEmail(u.email);
                                      setUserFormPassword(u.password);
                                      setUserFormRole(u.role);
                                      setUserFormActive(u.is_active);
                                      setUserFormAllOlts(u.access_all_olts);
                                      setUserFormOltIds(u.allowed_olt_ids || []);
                                      setUserFormAllZones(u.access_all_zones);
                                      setUserFormZoneIds(
                                        u.allowed_zone_ids || []
                                      );
                                      setUserFormAllRks(u.access_all_rks);
                                      setUserFormSectorIds(
                                        u.allowed_sector_ids || []
                                      );
                                      setUserFormOdbIds(u.allowed_odb_ids || []);
                                      setShowUserModal(true);
                                    }}
                                    className="rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#025aa5]"
                                  >
                                    Edit &amp; Assign
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (u.id === currentUser.id) {
                                        showToast(
                                          '⚠ Tidak dapat menghapus akun yang sedang digunakan untuk login!'
                                        );
                                        return;
                                      }
                                      setDb((prev) => ({
                                        ...prev,
                                        users: (
                                          prev.users || DEFAULT_APP_USERS
                                        ).filter((item) => item.id !== u.id),
                                      }));
                                      showToast(`User "${u.username}" dihapus.`);
                                    }}
                                    className={`rounded p-1 transition ${
                                      u.id === currentUser.id
                                        ? 'cursor-not-allowed bg-slate-700/70 text-slate-400'
                                        : 'bg-[#d9534f] text-white hover:bg-[#c9302c]'
                                    }`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Add / Edit User & Assign OLT / Zone / RK Modal */}
                {showUserModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
                    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-700 bg-[#151c28] p-6 text-xs text-slate-100 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
                        <div>
                          <h3 className="text-base font-bold text-white">
                            {editingUser
                              ? `Edit User & Assign Hak Akses — ${editingUser.username}`
                              : 'Tambah User Baru & Assign OLT, Zone, RK'}
                          </h3>
                          <p className="text-[11px] text-slate-400">
                            Pilih OLT, Zone, dan RK (Sector / Splitter ODP) yang diizinkan tampil untuk user ini.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowUserModal(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!userFormUsername.trim()) return;
                          const cleanUsername = userFormUsername
                            .trim()
                            .toLowerCase();
                          const nowWib = formatJakartaDateTime();

                          if (editingUser) {
                            setDb((prev) => {
                              const currentList =
                                Array.isArray(prev.users) &&
                                prev.users.length > 0
                                  ? prev.users
                                  : DEFAULT_APP_USERS;
                              return {
                                ...prev,
                                users: currentList.map((u) =>
                                  u.id === editingUser.id
                                    ? {
                                        ...u,
                                        username: cleanUsername,
                                        full_name:
                                          userFormFullName.trim() ||
                                          cleanUsername,
                                        email:
                                          userFormEmail.trim() ||
                                          `${cleanUsername}@jetcybernet.id`,
                                        password:
                                          userFormPassword || u.password,
                                        role: userFormRole,
                                        is_active: userFormActive,
                                        access_all_olts: userFormAllOlts,
                                        allowed_olt_ids: userFormOltIds,
                                        access_all_zones: userFormAllZones,
                                        allowed_zone_ids: userFormZoneIds,
                                        access_all_rks: userFormAllRks,
                                        allowed_sector_ids: userFormSectorIds,
                                        allowed_odb_ids: userFormOdbIds,
                                      }
                                    : u
                                ),
                              };
                            });
                            showToast(
                              `✓ Hak akses OLT, Zone & RK untuk user "${cleanUsername}" berhasil diperbarui!`
                            );
                          } else {
                            const nextId =
                              Math.max(0, ...appUsers.map((u) => u.id)) + 1;
                            const newUser: AppUserRecord = {
                              id: nextId,
                              username: cleanUsername,
                              full_name:
                                userFormFullName.trim() || cleanUsername,
                              email:
                                userFormEmail.trim() ||
                                `${cleanUsername}@jetcybernet.id`,
                              password: userFormPassword || 'jetcyber123',
                              role: userFormRole,
                              is_active: userFormActive,
                              access_all_olts: userFormAllOlts,
                              allowed_olt_ids: userFormOltIds,
                              access_all_zones: userFormAllZones,
                              allowed_zone_ids: userFormZoneIds,
                              access_all_rks: userFormAllRks,
                              allowed_sector_ids: userFormSectorIds,
                              allowed_odb_ids: userFormOdbIds,
                              last_login_at: null,
                              created_at: `${nowWib} WIB`,
                            };
                            setDb((prev) => {
                              const currentList =
                                Array.isArray(prev.users) &&
                                prev.users.length > 0
                                  ? prev.users
                                  : DEFAULT_APP_USERS;
                              return {
                                ...prev,
                                users: [...currentList, newUser],
                              };
                            });
                            showToast(
                              `✓ User "${cleanUsername}" berhasil ditambahkan beserta hak akses OLT, Zone & RK!`
                            );
                          }
                          setShowUserModal(false);
                        }}
                        className="space-y-4"
                      >
                        {/* Basic Account Details */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <label className="block font-bold text-slate-200">
                              Username *
                            </label>
                            <input
                              type="text"
                              required
                              value={userFormUsername}
                              onChange={(e) =>
                                setUserFormUsername(e.target.value)
                              }
                              placeholder="contoh: teknisi_lebak"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-white"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Nama Lengkap *
                            </label>
                            <input
                              type="text"
                              required
                              value={userFormFullName}
                              onChange={(e) =>
                                setUserFormFullName(e.target.value)
                              }
                              placeholder="contoh: Teknisi Area Lebak"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Email
                            </label>
                            <input
                              type="text"
                              value={userFormEmail}
                              onChange={(e) => setUserFormEmail(e.target.value)}
                              placeholder="teknisi@jetcybernet.id"
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 text-white"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <label className="block font-bold text-slate-200">
                              Password *
                            </label>
                            <input
                              type="text"
                              required
                              value={userFormPassword}
                              onChange={(e) =>
                                setUserFormPassword(e.target.value)
                              }
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-mono text-emerald-300"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-200">
                              Role
                            </label>
                            <select
                              value={userFormRole}
                              onChange={(e) => {
                                const nextRole = e.target.value as
                                  | 'ADMIN'
                                  | 'OPERATOR'
                                  | 'TECHNICIAN'
                                  | 'VIEWER';
                                setUserFormRole(nextRole);
                                if (nextRole === 'ADMIN') {
                                  setUserFormAllOlts(true);
                                  setUserFormAllZones(true);
                                  setUserFormAllRks(true);
                                }
                              }}
                              className="mt-1 w-full rounded border border-slate-600 bg-[#1c2536] px-3 py-2 font-bold text-white"
                            >
                              <option value="ADMIN">ADMIN (Full Access)</option>
                              <option value="OPERATOR">
                                OPERATOR (NOC / Provisioning)
                              </option>
                              <option value="TECHNICIAN">
                                TECHNICIAN (Teknisi Area / RK)
                              </option>
                              <option value="VIEWER">
                                VIEWER (Monitoring Saja)
                              </option>
                            </select>
                          </div>
                          <div className="flex items-end pb-1.5">
                            <label className="flex cursor-pointer items-center gap-2 font-bold text-white">
                              <input
                                type="checkbox"
                                checked={userFormActive}
                                onChange={(e) =>
                                  setUserFormActive(e.target.checked)
                                }
                                className="h-4 w-4 rounded border-slate-600"
                              />
                              Akun Aktif (Dapat Login)
                            </label>
                          </div>
                        </div>

                        {/* 1. ASSIGN OLT */}
                        <div className="rounded-lg border border-sky-500/40 bg-[#0d192b] p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 pb-2">
                            <div>
                              <span className="font-bold text-sky-300">
                                1. Assign OLT yang Ditampilkan
                              </span>
                              <p className="text-[11px] text-slate-400">
                                Pilih OLT mana saja yang boleh dilihat dan dikelola oleh user ini.
                              </p>
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 rounded bg-sky-950/80 border border-sky-500/40 px-2.5 py-1 font-bold text-sky-200">
                              <input
                                type="checkbox"
                                checked={userFormAllOlts}
                                onChange={(e) =>
                                  setUserFormAllOlts(e.target.checked)
                                }
                              />
                              Tampilkan Semua OLT
                            </label>
                          </div>

                          {!userFormAllOlts && (
                            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {db.olts.length === 0 ? (
                                <div className="text-slate-400">
                                  Belum ada OLT terdaftar di database.
                                </div>
                              ) : (
                                db.olts.map((o) => {
                                  const checked = userFormOltIds.includes(o.id);
                                  return (
                                    <label
                                      key={o.id}
                                      className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 transition ${
                                        checked
                                          ? 'border-sky-500 bg-sky-950/60 text-white'
                                          : 'border-slate-700 bg-[#132238] text-slate-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setUserFormOltIds((prev) => [
                                              ...prev,
                                              o.id,
                                            ]);
                                          } else {
                                            setUserFormOltIds((prev) =>
                                              prev.filter((id) => id !== o.id)
                                            );
                                          }
                                        }}
                                      />
                                      <div>
                                        <div className="font-bold">
                                          {o.id} - {o.name}
                                        </div>
                                        <div className="font-mono text-[10px] text-slate-400">
                                          {o.ip_address} · {o.hardware_model}
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* 2. ASSIGN ZONE */}
                        <div className="rounded-lg border border-amber-500/40 bg-[#0d192b] p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 pb-2">
                            <div>
                              <span className="font-bold text-amber-300">
                                2. Assign Zone yang Ditampilkan
                              </span>
                              <p className="text-[11px] text-slate-400">
                                Pilih area Zone mana saja yang akan ditampilkan pada akun user ini.
                              </p>
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 rounded bg-amber-950/80 border border-amber-500/40 px-2.5 py-1 font-bold text-amber-200">
                              <input
                                type="checkbox"
                                checked={userFormAllZones}
                                onChange={(e) =>
                                  setUserFormAllZones(e.target.checked)
                                }
                              />
                              Tampilkan Semua Zone
                            </label>
                          </div>

                          {!userFormAllZones && (
                            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                              {db.zones.length === 0 ? (
                                <div className="text-slate-400">
                                  Belum ada Zone terdaftar. Tambahkan Zone terlebih dahulu di menu Settings -&gt; Zones.
                                </div>
                              ) : (
                                db.zones.map((z) => {
                                  const checked = userFormZoneIds.includes(
                                    z.id
                                  );
                                  return (
                                    <label
                                      key={z.id}
                                      className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 transition ${
                                        checked
                                          ? 'border-amber-500 bg-amber-950/60 text-white'
                                          : 'border-slate-700 bg-[#132238] text-slate-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setUserFormZoneIds((prev) => [
                                              ...prev,
                                              z.id,
                                            ]);
                                          } else {
                                            setUserFormZoneIds((prev) =>
                                              prev.filter((id) => id !== z.id)
                                            );
                                          }
                                        }}
                                      />
                                      <div>
                                        <div className="font-bold">{z.name}</div>
                                        <div className="font-mono text-[10px] text-slate-400">
                                          {z.code} · {z.city_district}
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* 3. ASSIGN RK (SECTOR & SPLITTER / ODP) */}
                        <div className="rounded-lg border border-emerald-500/40 bg-[#0d192b] p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/80 pb-2">
                            <div>
                              <span className="font-bold text-emerald-300">
                                3. Assign RK (Sector &amp; Splitter / ODP) yang Ditampilkan
                              </span>
                              <p className="text-[11px] text-slate-400">
                                Pilih titik RK / Sector atau Splitter (ODP) spesifik yang akan ditampilkan untuk user ini.
                              </p>
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 rounded bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-1 font-bold text-emerald-200">
                              <input
                                type="checkbox"
                                checked={userFormAllRks}
                                onChange={(e) =>
                                  setUserFormAllRks(e.target.checked)
                                }
                              />
                              Tampilkan Semua RK / Sector &amp; ODP
                            </label>
                          </div>

                          {!userFormAllRks && (
                            <div className="mt-2.5 space-y-3">
                              {/* RK / Sectors */}
                              <div>
                                <div className="mb-1.5 font-bold text-slate-300">
                                  A. Pilih RK / Sector ({(db.sectors || []).length}):
                                </div>
                                {(db.sectors || []).length === 0 ? (
                                  <div className="text-slate-400">
                                    Belum ada Sector / RK terdaftar.
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                                    {(db.sectors || []).map((s) => {
                                      const checked =
                                        userFormSectorIds.includes(s.id);
                                      const zObj = db.zones.find(
                                        (z) => z.id === s.zone_id
                                      );
                                      return (
                                        <label
                                          key={s.id}
                                          className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 transition ${
                                            checked
                                              ? 'border-emerald-500 bg-emerald-950/60 text-white'
                                              : 'border-slate-700 bg-[#132238] text-slate-300'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setUserFormSectorIds((prev) => [
                                                  ...prev,
                                                  s.id,
                                                ]);
                                              } else {
                                                setUserFormSectorIds((prev) =>
                                                  prev.filter(
                                                    (id) => id !== s.id
                                                  )
                                                );
                                              }
                                            }}
                                          />
                                          <div>
                                            <div className="font-bold">
                                              {s.name}
                                            </div>
                                            <div className="font-mono text-[10px] text-slate-400">
                                              {s.code} · Zone:{' '}
                                              {zObj ? zObj.name : 'All'}
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Splitters / ODP */}
                              <div>
                                <div className="mb-1.5 font-bold text-slate-300">
                                  B. Pilih Splitter / ODP ({db.odbs.length}):
                                </div>
                                {db.odbs.length === 0 ? (
                                  <div className="text-slate-400">
                                    Belum ada Splitter / ODP terdaftar.
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                                    {db.odbs.map((o) => {
                                      const checked = userFormOdbIds.includes(
                                        o.id
                                      );
                                      const zObj = db.zones.find(
                                        (z) => z.id === o.zone_id
                                      );
                                      return (
                                        <label
                                          key={o.id}
                                          className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 transition ${
                                            checked
                                              ? 'border-emerald-500 bg-emerald-950/60 text-white'
                                              : 'border-slate-700 bg-[#132238] text-slate-300'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setUserFormOdbIds((prev) => [
                                                  ...prev,
                                                  o.id,
                                                ]);
                                              } else {
                                                setUserFormOdbIds((prev) =>
                                                  prev.filter(
                                                    (id) => id !== o.id
                                                  )
                                                );
                                              }
                                            }}
                                          />
                                          <div>
                                            <div className="font-bold">
                                              {o.name} ({o.splitter_ratio})
                                            </div>
                                            <div className="font-mono text-[10px] text-slate-400">
                                              {o.pole_number} · Zone:{' '}
                                              {zObj ? zObj.name : '-'}
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-slate-700 pt-3">
                          <button
                            type="button"
                            onClick={() => setShowUserModal(false)}
                            className="px-3 py-1.5 text-slate-300 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="rounded bg-[#5cb85c] px-4 py-1.5 font-bold text-white hover:bg-[#4cae4c]"
                          >
                            Simpan User &amp; Hak Akses
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeView === 'SPEED_PROFILES' && (() => {
              const catalogOnuTypes: OnuTypeRecord[] =
                db.onu_types && db.onu_types.length > 0
                  ? db.onu_types
                  : INITIAL_DB_STATE.onu_types || [];

              return (
                <div className="space-y-6">
                  {/* SECTION 1: SPEED PROFILES & T-CONT DBA PROFILES */}
                  <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          1. GPON Speed Profiles (`profile traffic` &amp; `profile tcont`)
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Profil limitasi bandwidth downstream/upstream (SIR/PIR) dan T-CONT DBA — otomatis ter-push ke OLT saat ditambahkan.
                        </p>
                      </div>
                      {!isViewerUser && (
                        <button
                          type="button"
                          disabled={speedPushBusy}
                          onClick={() => setShowAddSpeedModal(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add Speed Profile</span>
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                          <tr>
                            <th className="px-4 py-3">Profile Name</th>
                            <th className="px-4 py-3">Download (PIR)</th>
                            <th className="px-4 py-3">Upload</th>
                            <th className="px-4 py-3">CIR (SIR)</th>
                            <th className="px-4 py-3">Burst CBS / PBS</th>
                            <th className="px-4 py-3">T-CONT DBA Profile</th>
                            <th className="px-4 py-3 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {db.speed_profiles.map((s) => {
                            const linkedTcont = db.tcont_profiles.find(
                              (t) => t.id === s.tcont_profile_id
                            );
                            return (
                              <tr key={s.id} className="hover:bg-slate-800/40">
                                <td className="px-4 py-3 font-mono font-bold text-white">
                                  {s.profile_name}
                                </td>
                                <td className="px-4 py-3 font-mono text-emerald-400">
                                  {s.download_kbps.toLocaleString()} kbps
                                </td>
                                <td className="px-4 py-3 font-mono text-sky-400">
                                  {s.upload_kbps.toLocaleString()} kbps
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-300">
                                  {s.cir_kbps.toLocaleString()} kbps
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-400">
                                  {s.cbs_bytes} / {s.pbs_bytes} B
                                </td>
                                <td className="px-4 py-3 font-mono text-amber-300">
                                  {linkedTcont
                                    ? `${linkedTcont.profile_name} (Type ${linkedTcont.dba_type})`
                                    : '-'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {!isViewerUser && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDb((prev) => ({
                                          ...prev,
                                          speed_profiles:
                                            prev.speed_profiles.filter(
                                              (item) => item.id !== s.id
                                            ),
                                        }));
                                        const delCli = [
                                          'configure terminal',
                                          'gpon',
                                          `  no profile traffic ${s.profile_name}`,
                                          'exit',
                                          'exit',
                                          'write',
                                        ].join('\n');
                                        void pushProfileCliToTargetOlts(
                                          delCli,
                                          `Hapus Speed Profile "${s.profile_name}"`
                                        );
                                      }}
                                      className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-1.5 text-rose-300 transition hover:bg-rose-900/60 hover:text-white"
                                      title="Hapus Speed Profile"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* SECTION 2: ONU TYPES CATALOG (`onu-type` & `onu-type-if`) */}
                  <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          2. ONU Types Template (`pon` → `onu-type` &amp; `onu-type-if`)
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Definisi tipe hardware ONU (jumlah port Ethernet, POTS, WiFi, Max T-CONT &amp; GEMPort) — otomatis ter-push ke OLT saat ditambahkan.
                        </p>
                      </div>
                      {!isViewerUser && (
                        <button
                          type="button"
                          disabled={speedPushBusy}
                          onClick={() => setShowAddOnuTypeModal(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add ONU Type</span>
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                          <tr>
                            <th className="px-4 py-3">ONU Type Name</th>
                            <th className="px-4 py-3">PON</th>
                            <th className="px-4 py-3">Deskripsi</th>
                            <th className="px-4 py-3">Interfaces (ETH / POTS / WiFi)</th>
                            <th className="px-4 py-3">Max T-CONT / GEM / Flow</th>
                            <th className="px-4 py-3 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {catalogOnuTypes.map((t) => (
                            <tr key={t.id} className="hover:bg-slate-800/40">
                              <td className="px-4 py-3 font-mono font-bold text-white">
                                {t.type_name}
                              </td>
                              <td className="px-4 py-3 font-mono uppercase text-sky-400">
                                {t.pon_type}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {t.description}
                              </td>
                              <td className="px-4 py-3 font-mono text-emerald-400">
                                {t.eth_ports} ETH · {t.pots_ports} POTS · {t.wifi_ports} WiFi
                              </td>
                              <td className="px-4 py-3 font-mono text-slate-400">
                                TCONT:{t.max_tcont} · GEM:{t.max_gemport} · Flow:{t.max_flow_perswitch}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {!isViewerUser && t.type_name !== 'ALL' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDb((prev) => ({
                                        ...prev,
                                        onu_types: (
                                          prev.onu_types &&
                                          prev.onu_types.length > 0
                                            ? prev.onu_types
                                            : INITIAL_DB_STATE.onu_types || []
                                        ).filter((item) => item.id !== t.id),
                                      }));
                                      const delCli = [
                                        'configure terminal',
                                        'pon',
                                        `  no onu-type ${t.type_name} ${t.pon_type}`,
                                        'exit',
                                        'exit',
                                        'write',
                                      ].join('\n');
                                      void pushProfileCliToTargetOlts(
                                        delCli,
                                        `Hapus ONU Type "${t.type_name}"`
                                      );
                                    }}
                                    className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-1.5 text-rose-300 transition hover:bg-rose-900/60 hover:text-white"
                                    title="Hapus ONU Type"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* MODAL 1: ADD SPEED PROFILE & PUSH DIRECTLY TO OLT */}
                  {showAddSpeedModal && !isViewerUser && (
                    <div
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
                      onClick={() => setShowAddSpeedModal(false)}
                    >
                      <div
                        className="animate-modal-in max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 text-xs text-slate-100 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
                          <div>
                            <h3 className="text-sm font-bold text-white">
                              Add Speed Profile &amp; Push Langsung ke OLT
                            </h3>
                            <p className="text-[11px] text-slate-400">
                              Membuat `profile traffic` &amp; `profile tcont` pada mode `gpon` OLT ZTE C300/C320.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowAddSpeedModal(false)}
                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <form
                          onSubmit={(e) => void handleCreateAndPushSpeedProfile(e)}
                          className="space-y-4 p-6"
                        >
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Nama Speed Profile (`profile traffic`)
                              </label>
                              <input
                                type="text"
                                required
                                value={newSpeedName}
                                onChange={(e) =>
                                  setNewSpeedName(
                                    e.target.value.toUpperCase().replace(/\s+/g, '-')
                                  )
                                }
                                placeholder="SMARTOLT-100M-DOWN"
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:border-sky-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Target Push OLT
                              </label>
                              <select
                                value={speedPushTargetOltId}
                                onChange={(e) =>
                                  setSpeedPushTargetOltId(e.target.value)
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-semibold text-white focus:border-sky-500 focus:outline-none"
                              >
                                <option value="ALL">
                                  Semua OLT ({visibleOlts.length} OLT)
                                </option>
                                {visibleOlts.map((o) => (
                                  <option key={o.id} value={String(o.id)}>
                                    {o.name} ({o.ip_address})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Quick Bandwidth Presets */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-slate-400">
                              Preset Cepat:
                            </span>
                            {[
                              { label: '20 Mbps', kbps: 20480 },
                              { label: '50 Mbps', kbps: 51200 },
                              { label: '100 Mbps', kbps: 102400 },
                              { label: '200 Mbps', kbps: 204800 },
                              { label: '500 Mbps', kbps: 512000 },
                              { label: '1 Gbps', kbps: 1048064 },
                            ].map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => {
                                  const tag = p.label
                                    .toUpperCase()
                                    .replace(/\s+/g, '');
                                  setNewSpeedName(`SMARTOLT-${tag}-DOWN`);
                                  setNewTcontName(`SMARTOLT-${tag}-UP`);
                                  setNewSpeedDownloadKbps(p.kbps);
                                  setNewSpeedUploadKbps(p.kbps);
                                  setNewSpeedCirKbps(p.kbps);
                                  setNewTcontMaxKbps(p.kbps);
                                }}
                                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px] text-sky-300 hover:border-sky-500/50 hover:text-white"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Download / PIR (kbps)
                              </label>
                              <input
                                type="number"
                                required
                                min={64}
                                value={newSpeedDownloadKbps}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setNewSpeedDownloadKbps(val);
                                  setNewSpeedCirKbps(val);
                                }}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-emerald-400 focus:border-sky-500 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Upload (kbps)
                              </label>
                              <input
                                type="number"
                                required
                                min={64}
                                value={newSpeedUploadKbps}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setNewSpeedUploadKbps(val);
                                  setNewTcontMaxKbps(val);
                                }}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sky-400 focus:border-sky-500 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                CIR / SIR (kbps)
                              </label>
                              <input
                                type="number"
                                required
                                min={64}
                                value={newSpeedCirKbps}
                                onChange={(e) =>
                                  setNewSpeedCirKbps(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:border-sky-500 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Burst CBS (bytes)
                              </label>
                              <input
                                type="number"
                                required
                                min={64}
                                max={65535}
                                value={newSpeedCbsBytes}
                                onChange={(e) =>
                                  setNewSpeedCbsBytes(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Burst PBS (bytes)
                              </label>
                              <input
                                type="number"
                                required
                                min={64}
                                max={65535}
                                value={newSpeedPbsBytes}
                                onChange={(e) =>
                                  setNewSpeedPbsBytes(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
                              />
                            </div>
                          </div>

                          {/* T-CONT DBA Profile Section */}
                          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-amber-300">
                                Konfigurasi T-CONT Upstream (`profile tcont`)
                              </span>
                              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setNewSpeedTcontMode('AUTO_CREATE')
                                  }
                                  className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                    newSpeedTcontMode === 'AUTO_CREATE'
                                      ? 'bg-sky-600 text-white'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  Buat T-CONT Baru
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setNewSpeedTcontMode('EXISTING')
                                  }
                                  className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                    newSpeedTcontMode === 'EXISTING'
                                      ? 'bg-sky-600 text-white'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  Pakai T-CONT yang Ada
                                </button>
                              </div>
                            </div>

                            {newSpeedTcontMode === 'EXISTING' ? (
                              <div>
                                <select
                                  value={newSpeedTcontId}
                                  onChange={(e) =>
                                    setNewSpeedTcontId(Number(e.target.value))
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
                                >
                                  {db.tcont_profiles.map((tp) => (
                                    <option key={tp.id} value={tp.id}>
                                      {tp.profile_name} — {tp.description}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div>
                                  <label className="mb-1 block text-[11px] text-slate-400">
                                    Nama T-CONT Profile
                                  </label>
                                  <input
                                    type="text"
                                    required
                                    value={newTcontName}
                                    onChange={(e) =>
                                      setNewTcontName(
                                        e.target.value
                                          .toUpperCase()
                                          .replace(/\s+/g, '-')
                                      )
                                    }
                                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-white"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[11px] text-slate-400">
                                    DBA Type (1..5)
                                  </label>
                                  <select
                                    value={newTcontDbaType}
                                    onChange={(e) =>
                                      setNewTcontDbaType(
                                        Number(e.target.value) as 1 | 2 | 3 | 4 | 5
                                      )
                                    }
                                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-white"
                                  >
                                    <option value={4}>Type 4 (Max / Best-Effort)</option>
                                    <option value={5}>Type 5 (Fixed + Assured + Max)</option>
                                    <option value={3}>Type 3 (Assured + Max)</option>
                                    <option value={2}>Type 2 (Assured)</option>
                                    <option value={1}>Type 1 (Fixed)</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="mb-1 block text-[11px] text-slate-400">
                                    Max Upstream (kbps)
                                  </label>
                                  <input
                                    type="number"
                                    required
                                    min={64}
                                    value={newTcontMaxKbps}
                                    onChange={(e) =>
                                      setNewTcontMaxKbps(Number(e.target.value))
                                    }
                                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-amber-300"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Live ZTE CLI Script Preview (Hidden) */}
                          <div className="hidden rounded-xl border border-slate-800 bg-slate-950 p-3">
                            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                              <span className="font-semibold text-sky-400">
                                Preview Perintah CLI ZTE yang Akan Di-Push ke OLT:
                              </span>
                              <span className="font-mono text-[10px]">ZXAN(config-gpon)#</span>
                            </div>
                            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-emerald-300">
                              {buildSpeedProfileCliScript(
                                {
                                  profile_name: newSpeedName || 'SMARTOLT-100M-DOWN',
                                  cir_kbps: newSpeedCirKbps,
                                  download_kbps: newSpeedDownloadKbps,
                                  cbs_bytes: newSpeedCbsBytes,
                                  pbs_bytes: newSpeedPbsBytes,
                                },
                                newSpeedTcontMode === 'AUTO_CREATE'
                                  ? {
                                      profile_name:
                                        newTcontName || 'SMARTOLT-100M-UP',
                                      dba_type: newTcontDbaType,
                                      fixed_kbps: newTcontFixedKbps,
                                      assured_kbps: newTcontAssuredKbps,
                                      maximum_kbps: newTcontMaxKbps,
                                    }
                                  : db.tcont_profiles.find(
                                      (t) => t.id === Number(newSpeedTcontId)
                                    ) || null
                              )}
                            </pre>
                          </div>

                          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                            <button
                              type="button"
                              onClick={() => setShowAddSpeedModal(false)}
                              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 font-semibold text-slate-300 hover:bg-slate-700"
                            >
                              Batal
                            </button>
                            <button
                              type="submit"
                              disabled={speedPushBusy}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>
                                {speedPushBusy
                                  ? 'Mengeksekusi ke OLT...'
                                  : 'Simpan & Push ke OLT Sekarang'}
                              </span>
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* MODAL 2: ADD ONU TYPE & PUSH DIRECTLY TO OLT */}
                  {showAddOnuTypeModal && !isViewerUser && (
                    <div
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
                      onClick={() => setShowAddOnuTypeModal(false)}
                    >
                      <div
                        className="animate-modal-in max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 text-xs text-slate-100 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
                          <div>
                            <h3 className="text-sm font-bold text-white">
                              Add ONU Type &amp; Push Langsung ke OLT
                            </h3>
                            <p className="text-[11px] text-slate-400">
                              Mendaftarkan `onu-type` &amp; `onu-type-if` pada mode `pon` OLT ZTE C300/C320.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowAddOnuTypeModal(false)}
                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <form
                          onSubmit={(e) => void handleCreateAndPushOnuType(e)}
                          className="space-y-4 p-6"
                        >
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                ONU Type Name
                              </label>
                              <input
                                type="text"
                                required
                                value={newOnuTypeName}
                                onChange={(e) =>
                                  setNewOnuTypeName(
                                    e.target.value.replace(/\s+/g, '_')
                                  )
                                }
                                placeholder="ZTE-F670LV9"
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:border-sky-500 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                PON Mode
                              </label>
                              <select
                                value={newOnuTypePon}
                                onChange={(e) =>
                                  setNewOnuTypePon(
                                    e.target.value as 'gpon' | 'xgpon'
                                  )
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
                              >
                                <option value="gpon">GPON</option>
                                <option value="xgpon">XGPON</option>
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Target Push OLT
                              </label>
                              <select
                                value={speedPushTargetOltId}
                                onChange={(e) =>
                                  setSpeedPushTargetOltId(e.target.value)
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-semibold text-white"
                              >
                                <option value="ALL">
                                  Semua OLT ({visibleOlts.length} OLT)
                                </option>
                                {visibleOlts.map((o) => (
                                  <option key={o.id} value={String(o.id)}>
                                    {o.name} ({o.ip_address})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="mb-1 block font-semibold text-slate-300">
                              Deskripsi Hardware
                            </label>
                            <input
                              type="text"
                              required
                              value={newOnuTypeDesc}
                              onChange={(e) => setNewOnuTypeDesc(e.target.value)}
                              placeholder="4GE+1POTS+2WIFI"
                              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Jumlah Port ETH (`eth_0/1..N`)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={24}
                                value={newOnuTypeEth}
                                onChange={(e) =>
                                  setNewOnuTypeEth(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-emerald-400"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Jumlah POTS (`pots_0/1..N`)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={8}
                                value={newOnuTypePots}
                                onChange={(e) =>
                                  setNewOnuTypePots(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sky-400"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block font-semibold text-slate-300">
                                Jumlah WiFi (`wifi_0/1..N`)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={8}
                                value={newOnuTypeWifi}
                                onChange={(e) =>
                                  setNewOnuTypeWifi(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-amber-300"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-400">
                                Max T-CONT
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={32}
                                value={newOnuTypeMaxTcont}
                                onChange={(e) =>
                                  setNewOnuTypeMaxTcont(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-400">
                                Max GEMPort
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={128}
                                value={newOnuTypeMaxGemport}
                                onChange={(e) =>
                                  setNewOnuTypeMaxGemport(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-400">
                                Max Switch
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={16}
                                value={newOnuTypeMaxSwitch}
                                onChange={(e) =>
                                  setNewOnuTypeMaxSwitch(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-400">
                                Max Flow
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={64}
                                value={newOnuTypeMaxFlow}
                                onChange={(e) =>
                                  setNewOnuTypeMaxFlow(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-400">
                                Max IPHost
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={16}
                                value={newOnuTypeMaxIphost}
                                onChange={(e) =>
                                  setNewOnuTypeMaxIphost(Number(e.target.value))
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                          </div>

                          {/* Live ZTE CLI Preview (Hidden) */}
                          <div className="hidden rounded-xl border border-slate-800 bg-slate-950 p-3">
                            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                              <span className="font-semibold text-sky-400">
                                Preview Perintah CLI ZTE yang Akan Di-Push ke OLT:
                              </span>
                              <span className="font-mono text-[10px]">ZXAN(config-pon)#</span>
                            </div>
                            <pre className="max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-emerald-300">
                              {buildOnuTypeCliScript({
                                type_name: newOnuTypeName || 'ZTE-F670LV9',
                                pon_type: newOnuTypePon,
                                description: newOnuTypeDesc || '4GE+1POTS+2WIFI',
                                eth_ports: newOnuTypeEth,
                                pots_ports: newOnuTypePots,
                                wifi_ports: newOnuTypeWifi,
                                max_tcont: newOnuTypeMaxTcont,
                                max_gemport: newOnuTypeMaxGemport,
                                max_switch_perslot: newOnuTypeMaxSwitch,
                                max_flow_perswitch: newOnuTypeMaxFlow,
                                max_iphost: newOnuTypeMaxIphost,
                              })}
                            </pre>
                          </div>

                          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                            <button
                              type="button"
                              onClick={() => setShowAddOnuTypeModal(false)}
                              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 font-semibold text-slate-300 hover:bg-slate-700"
                            >
                              Batal
                            </button>
                            <button
                              type="submit"
                              disabled={speedPushBusy}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 font-bold text-white shadow hover:bg-sky-500 disabled:opacity-50"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>
                                {speedPushBusy
                                  ? 'Mengeksekusi ke OLT...'
                                  : 'Simpan & Push ONU Type ke OLT'}
                              </span>
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {activeView === 'GRAPHS' && (() => {
              const allUplinks = oltGraphsData?.uplinks || [];
              const allPonPorts = (oltGraphsData?.ponPorts || []).filter((p) =>
                graphsShowAllPon ? true : p.activeOnus > 0 || p.totalOnus > 0
              );
              const allItems: OltInterfaceGraphItem[] = [
                ...allUplinks,
                ...(oltGraphsData?.ponPorts || []),
              ];
              const selectedGraphItem = selectedGraphInterfaceName
                ? allItems.find(
                    (it) =>
                      it.interfaceName.toLowerCase() ===
                      selectedGraphInterfaceName.toLowerCase()
                  ) || null
                : null;

              const renderGraphChartBlock = (
                item: OltInterfaceGraphItem,
                periodKey: 'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly',
                watermarkLabel: string,
                isClickableCard: boolean
              ) => {
                const series =
                  periodKey === 'Live2h'
                    ? item.periods.Live2h || item.periods.Daily
                    : item.periods[periodKey];
                const oltDisplayName = oltGraphsData?.oltName || 'ZTE-C320-OLT';
                const probeGroup =
                  item.interfaceType === 'UPLINK'
                    ? `BGP Core ${oltDisplayName}`
                    : `GPON Matrix ${oltDisplayName}`;
                const breadcrumbPath = `JetCyber > Local Probe > ${oltDisplayName} > ${probeGroup} > ${item.title}`;

                return (
                  <PrtgTrafficGraph
                    key={`${item.interfaceName}-${periodKey}`}
                    breadcrumbPath={breadcrumbPath}
                    watermarkTitle={watermarkLabel}
                    series={series}
                    sensorId={2000 + (item.id || 1)}
                    polledAtStr={oltGraphsData?.polledAtWib || jakartaClockStr}
                    compact={isClickableCard && graphsGridMode === '4x1'}
                    activePeriod={isClickableCard ? graphsOverviewPeriod : periodKey}
                    onSelectPeriod={
                      isClickableCard
                        ? (p) => setGraphsOverviewPeriod(p)
                        : undefined
                    }
                    onClickGraph={
                      isClickableCard
                        ? () => {
                            setSelectedGraphInterfaceName(item.interfaceName);
                            setSelectedGraphPeriod('ALL_PERIODS');
                          }
                        : undefined
                    }
                    clickHintText={
                      isClickableCard
                        ? 'Detail Harian / Mingguan / Bulanan / Tahunan →'
                        : undefined
                    }
                  />
                );
              };

              const overviewWatermarkMap: Record<
                'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly',
                string
              > = {
                Live2h: 'Live Graph, 2 hours',
                Daily: 'Live Graph, 24 hours',
                Weekly: 'Weekly Graph, 7 days',
                Monthly: 'Monthly Graph, 30 days',
                Yearly: 'Yearly Graph, 12 months',
              };

              const graphsRowGridClass =
                graphsGridMode === '4x1'
                  ? 'grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4'
                  : graphsGridMode === '2x1'
                    ? 'grid grid-cols-1 gap-4 lg:grid-cols-2'
                    : 'grid grid-cols-1 gap-4';

              return (
                <div className="space-y-4">
                  {/* Top Control Bar for OLT Graphs */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1e3a5f] bg-[#0c1c30]/95 p-3.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">OLT:</span>
                        <select
                          value={graphsOltId}
                          onChange={(e) => {
                            const nextId = Number(e.target.value);
                            setGraphsOltId(nextId);
                            setSelectedGraphInterfaceName(null);
                          }}
                          className="rounded border border-slate-600 bg-[#132842] px-2.5 py-1.5 font-bold text-white"
                        >
                          {db.olts.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name} ({o.ip_address})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Filter Tabs: Semua / Uplink / PON */}
                      <div className="flex items-center gap-1 rounded border border-[#1e3a5f] bg-[#091526] p-1">
                        {(
                          [
                            { id: 'ALL', label: 'Semua (Uplink + PON)' },
                            {
                              id: 'UPLINK',
                              label: `Uplink (${allUplinks.length})`,
                            },
                            {
                              id: 'PON',
                              label: `PON Ports (${oltGraphsData?.ponPorts?.length || 0})`,
                            },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setGraphsFilterType(tab.id);
                              setSelectedGraphInterfaceName(null);
                            }}
                            className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                              graphsFilterType === tab.id
                                ? 'bg-[#0275d8] text-white'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {graphsFilterType !== 'UPLINK' && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={!graphsShowAllPon}
                            onChange={(e) => setGraphsShowAllPon(!e.target.checked)}
                            className="rounded border-slate-600"
                          />
                          Hanya PON Port berisi ONU
                        </label>
                      )}

                      {/* Selector Layout Kolom per Baris: 1x1, 2x1, 4x1 */}
                      <div className="flex items-center gap-1 rounded border border-[#1e3a5f] bg-[#091526] p-1">
                        <span className="px-1.5 text-[11px] font-semibold text-slate-400">
                          Baris:
                        </span>
                        {(
                          [
                            { id: '1x1', label: '1x1' },
                            { id: '2x1', label: '2x1' },
                            { id: '4x1', label: '4x1' },
                          ] as const
                        ).map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setGraphsGridMode(mode.id)}
                            className={`rounded px-2.5 py-1 font-mono text-xs font-bold transition ${
                              graphsGridMode === mode.id
                                ? 'bg-[#0275d8] text-white shadow'
                                : 'text-slate-300 hover:bg-[#132842] hover:text-white'
                            }`}
                            title={`Tampilkan ${mode.label} grafik setiap baris`}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="rounded border border-emerald-500/40 bg-emerald-950/50 px-2.5 py-1 font-mono text-[11px] text-emerald-300">
                        Zona Waktu: Asia/Jakarta (WIB) • {jakartaClockStr} WIB
                      </span>
                      <button
                        type="button"
                        disabled={graphsPollingLive}
                        onClick={() => void pollOltGraphsLive(graphsOltId, false)}
                        className="flex items-center gap-1.5 rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5] disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            graphsPollingLive ? 'animate-spin' : ''
                          }`}
                        />
                        {graphsPollingLive
                          ? 'Polling OLT...'
                          : 'Poll Real-Time Traffic (Live OLT)'}
                      </button>
                    </div>
                  </div>

                  {/* Drill-Down View when user clicks any Uplink or PON Graph */}
                  {selectedGraphItem ? (
                    <div className="space-y-4 rounded-lg border border-sky-500/50 bg-[#081322] p-4 shadow-2xl">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3a5f] pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedGraphInterfaceName(null)}
                              className="rounded bg-[#132842] px-2.5 py-1 text-xs font-bold text-sky-300 hover:bg-[#1c395d] hover:text-white"
                            >
                              ← Kembali ke Semua Grafik
                            </button>
                            <h2 className="font-mono text-sm font-bold text-white">
                              Detail Grafik Interface: {selectedGraphItem.title}
                            </h2>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-300">
                            Menampilkan grafik trafik Real-Time OLT: 2 Jam (Live), Harian (24 Jam • Interval 5 Menit), Mingguan (7 Hari), Bulanan (30 Hari), dan Tahunan (12 Bulan) dalam Zona Waktu Jakarta (WIB / UTC+7).
                          </p>
                        </div>

                        {/* Period selector buttons */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(
                            [
                              {
                                id: 'ALL_PERIODS',
                                label: 'Semua Periode',
                              },
                              { id: 'Live2h', label: 'Live (2 Jam)' },
                              { id: 'Daily', label: 'Harian (24 Jam / 5m)' },
                              { id: 'Weekly', label: 'Mingguan (7 Hari)' },
                              { id: 'Monthly', label: 'Bulanan (30 Hari)' },
                              { id: 'Yearly', label: 'Tahunan (12 Bulan)' },
                            ] as const
                          ).map((pTab) => (
                            <button
                              key={pTab.id}
                              type="button"
                              onClick={() => setSelectedGraphPeriod(pTab.id)}
                              className={`rounded px-3 py-1.5 text-xs font-bold transition ${
                                selectedGraphPeriod === pTab.id
                                  ? 'bg-[#0275d8] text-white shadow'
                                  : 'bg-[#132842] text-slate-300 hover:text-white'
                              }`}
                            >
                              {pTab.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div
                        className={
                          selectedGraphPeriod === 'ALL_PERIODS'
                            ? 'grid grid-cols-1 gap-4 lg:grid-cols-2'
                            : 'space-y-4'
                        }
                      >
                        {(selectedGraphPeriod === 'ALL_PERIODS' ||
                          selectedGraphPeriod === 'Live2h') &&
                          renderGraphChartBlock(
                            selectedGraphItem,
                            'Live2h',
                            'Live Graph, 2 hours',
                            false
                          )}

                        {(selectedGraphPeriod === 'ALL_PERIODS' ||
                          selectedGraphPeriod === 'Daily') &&
                          renderGraphChartBlock(
                            selectedGraphItem,
                            'Daily',
                            'Live Graph, 24 hours',
                            false
                          )}

                        {(selectedGraphPeriod === 'ALL_PERIODS' ||
                          selectedGraphPeriod === 'Weekly') &&
                          renderGraphChartBlock(
                            selectedGraphItem,
                            'Weekly',
                            'Weekly Graph, 7 days',
                            false
                          )}

                        {(selectedGraphPeriod === 'ALL_PERIODS' ||
                          selectedGraphPeriod === 'Monthly') &&
                          renderGraphChartBlock(
                            selectedGraphItem,
                            'Monthly',
                            'Monthly Graph, 30 days',
                            false
                          )}

                        {(selectedGraphPeriod === 'ALL_PERIODS' ||
                          selectedGraphPeriod === 'Yearly') &&
                          renderGraphChartBlock(
                            selectedGraphItem,
                            'Yearly',
                            'Yearly Graph, 12 months',
                            false
                          )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {graphsLoading && !oltGraphsData && (
                        <div className="rounded border border-[#1e3a5f] bg-[#0c1c30]/80 p-6 text-center text-slate-300">
                          Memuat grafik real-time Uplink & PON OLT (WIB)...
                        </div>
                      )}

                      {/* SECTION 1: UPLINK PORTS */}
                      {(graphsFilterType === 'ALL' ||
                        graphsFilterType === 'UPLINK') &&
                        allUplinks.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h2 className="font-mono text-sm font-bold text-emerald-400">
                                1. Grafik Uplink OLT — Real-Time Telemetry ({overviewWatermarkMap[graphsOverviewPeriod]} • Layout {graphsGridMode} • WIB)
                              </h2>
                              <span className="text-[11px] text-slate-400">
                                Klik grafik mana saja untuk membuka detail 2 Jam, Harian (24 Jam), Mingguan, Bulanan & Tahunan
                              </span>
                            </div>
                            <div className={graphsRowGridClass}>
                              {allUplinks.map((uItem) =>
                                renderGraphChartBlock(
                                  uItem,
                                  graphsOverviewPeriod,
                                  overviewWatermarkMap[graphsOverviewPeriod],
                                  true
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {/* SECTION 2: GPON PON PORTS */}
                      {(graphsFilterType === 'ALL' ||
                        graphsFilterType === 'PON') && (
                        <div className="space-y-3 pt-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="font-mono text-sm font-bold text-sky-400">
                              2. Grafik GPON Port OLT (`gpon-olt_1/3/*`) — Real-Time Telemetry ({overviewWatermarkMap[graphsOverviewPeriod]} • Layout {graphsGridMode} • WIB)
                            </h2>
                            <span className="text-[11px] text-slate-400">
                              Menampilkan {allPonPorts.length} PON Port • Klik grafik untuk melihat 2 Jam, Harian, Mingguan, Bulanan & Tahunan
                            </span>
                          </div>
                          <div className={graphsRowGridClass}>
                            {allPonPorts.map((pItem) =>
                              renderGraphChartBlock(
                                pItem,
                                graphsOverviewPeriod,
                                overviewWatermarkMap[graphsOverviewPeriod],
                                true
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ===================================================================
            VIEW 11: ZTE CLI REGEX PARSER LAB (Diag Tab)
           =================================================================== */}
        {activeView === 'DIAG_PARSER' && (
          <div className="space-y-5 text-xs">
            <div>
              <h1 className="text-lg font-bold text-white">
                ZTE C320 / C300 CLI Regex Parser & Optical Attenuation Tester
              </h1>
              <p className="text-slate-300">
                Uji langsung algoritma Regex Parser untuk membaca output `show gpon onu uncfg`, `show gpon onu state`, dan `show pon power attenuation`.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Parser 1: uncfg */}
              <div className="space-y-2 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
                <div className="font-mono font-bold text-sky-400">
                  1. `show gpon onu uncfg`
                </div>
                <textarea
                  rows={5}
                  value={rawUncfgCli}
                  onChange={(e) => setRawUncfgCli(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300"
                />
                <pre className="max-h-44 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-sky-300">
                  {JSON.stringify(parseZteUncfgOutput(rawUncfgCli), null, 2)}
                </pre>
              </div>

              {/* Parser 2: state */}
              <div className="space-y-2 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
                <div className="font-mono font-bold text-sky-400">
                  2. `show gpon onu state`
                </div>
                <textarea
                  rows={5}
                  value={rawStateCli}
                  onChange={(e) => setRawStateCli(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300"
                />
                <pre className="max-h-44 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-sky-300">
                  {JSON.stringify(parseZteOnuStateOutput(rawStateCli), null, 2)}
                </pre>
              </div>

              {/* Parser 3: attenuation */}
              <div className="space-y-2 rounded border border-[#1e3a5f] bg-[#0c1c30]/90 p-4">
                <div className="font-mono font-bold text-sky-400">
                  3. `show pon power attenuation`
                </div>
                <textarea
                  rows={5}
                  value={rawPowerCli}
                  onChange={(e) => setRawPowerCli(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300"
                />
                <pre className="max-h-44 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] text-sky-300">
                  {JSON.stringify(parseZteOpticalAttenuation(rawPowerCli), null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            VIEW 12: SQL SCHEMA & BACKEND SOURCE CODE VIEWER
           =================================================================== */}
        {activeView === 'SOURCE_CODE' && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-white">
                  Full Production Source Code (`database.sql` + Telnet/SSH Engine + CLI/TR069 Builder)
                </h1>
                <p className="text-slate-300">
                  Salin langsung kode SQL MySQL/MariaDB dan modul koneksi Telnet/SSH ZTE C320/C300 untuk deployment di Ubuntu Server / Docker.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {PRODUCTION_CODE_MODULES.map((mod) => (
                  <button
                    key={mod.fileName}
                    type="button"
                    onClick={() => setSelectedCodeModuleId(mod.fileName)}
                    className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
                      selectedCodeModuleId === mod.fileName
                        ? 'bg-[#0275d8] text-white'
                        : 'bg-[#10233a] text-slate-300 hover:text-white'
                    }`}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    {mod.fileName}
                  </button>
                ))}
              </div>
            </div>

            {PRODUCTION_CODE_MODULES.filter((m) => m.fileName === selectedCodeModuleId).map(
              (mod) => (
                <div
                  key={mod.fileName}
                  className="overflow-hidden rounded-lg border border-[#1e3a5f] bg-slate-950 shadow-2xl"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1f36] px-4 py-3">
                    <div>
                      <div className="font-mono text-xs font-bold text-emerald-400">
                        Modul {mod.moduleNumber}: {mod.fileName}
                      </div>
                      <div className="text-[11px] text-slate-300">
                        {mod.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(mod.code);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 1800);
                      }}
                      className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      {copiedCode ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedCode ? 'Copied' : 'Copy Full Source Code'}
                    </button>
                  </div>
                  <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
                    {mod.code}
                  </pre>
                </div>
              )
            )}
          </div>
        )}
        </main>
      </div>

      {/* Global "Update ONU mode" Modal when triggered from Configured ONUs table or VPN_TR069 */}
      {updatingModeOnu && !isViewerUser && (
        <UpdateOnuModeModal
          onu={updatingModeOnu}
          db={db}
          onClose={() => setUpdatingModeOnu(null)}
          onConfirmUpdate={(onuId, updatedFields, generatedCli) => {
            handleExecuteOnuAction(
              onuId,
              'UPDATE_ONU_MODE',
              generatedCli,
              updatedFields
            );
            setUpdatingModeOnu(null);
          }}
        />
      )}

      {/* =====================================================================
          MODAL: CONFIGURE AUTO-AUTHORIZE ACTIONS (UNCONFIGURED ONUS)
         ===================================================================== */}
      {showAutoActionsModal && !isViewerUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                Configure Auto Actions (SmartOLT Automation)
              </h2>
              <button
                type="button"
                onClick={() => setShowAutoActionsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3.5 px-5 py-4 text-xs">
              <label className="flex items-center gap-2 font-semibold text-white">
                <input
                  type="checkbox"
                  checked={autoAuthEnabled}
                  onChange={(e) => setAutoAuthEnabled(e.target.checked)}
                />
                Enable Auto-Authorization for all Unconfigured ONUs
              </label>
              <div>
                <label className="block font-bold text-slate-300">
                  Default Service VLAN
                </label>
                <select
                  value={autoAuthVlanId}
                  onChange={(e) => setAutoAuthVlanId(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                >
                  {db.vlans.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vlan_id} - {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded border border-slate-700 bg-[#0d1826] p-3 text-[11px] text-slate-300">
                Jika tombol <b>Save & Run Batch Authorize Now</b> ditekan, sistem akan otomatis mencari <code>onu_index</code> kosong dan mengeksekusi script ZTE OMCI + VLAN tagging untuk seluruh <b>{unconfiguredOnus.length} ONU</b> yang sedang antre di daftar Unconfigured.
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAutoActionsModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setAutoAuthEnabled(true);
                  if (unconfiguredOnus.length > 0) {
                    const targetVlan =
                      db.vlans.find((v) => v.id === autoAuthVlanId) ||
                      db.vlans[0] || {
                        id: 101,
                        vlan_id: 101,
                        name: 'PPPOE',
                      };

                    // Track allocated indices per PON port
                    const usedMap = new Map<string, number[]>();
                    for (const u of db.onus) {
                      if (u.is_authorized && u.onu_index !== null) {
                        const key = `${u.olt_id}-${u.board}-${u.port}`;
                        const list = usedMap.get(key) || [];
                        list.push(u.onu_index);
                        usedMap.set(key, list);
                      }
                    }

                    const batchScriptsByOlt = new Map<number, string[]>();
                    const allocatedIndexByOnuId = new Map<number, number>();

                    const defaultTr069Prof =
                      db.tr069_profiles.find((p) => p.is_default) ||
                      db.tr069_profiles[0];
                    const isAutoVlanMgmtOnly = Boolean(
                      ('used_for_mgmt_tr069_voip' in targetVlan &&
                        targetVlan.used_for_mgmt_tr069_voip) ||
                        ('service_type' in targetVlan &&
                          targetVlan.service_type === 'TR069_MGMT')
                    );

                    for (const u of unconfiguredOnus) {
                      const key = `${u.olt_id}-${u.board}-${u.port}`;
                      const usedList = usedMap.get(key) || [];
                      const nextIdx = findNextAvailableOnuIndex(usedList);
                      usedList.push(nextIdx);
                      usedMap.set(key, usedList);
                      allocatedIndexByOnuId.set(u.id, nextIdx);

                      const oltRec = db.olts.find((o) => o.id === u.olt_id) || db.olts[0];
                      const script = generateAuthorizeCliScript({
                        firmwareVersion: oltRec?.firmware_version || 'V2.1.0',
                        ponInterface: `gpon-olt_1/${u.board}/${u.port}`,
                        onuIndex: nextIdx,
                        serialNumber: u.serial_number,
                        onuType: u.onu_type || 'ALL',
                        customerName: `AUTO-${u.serial_number.slice(-6)}`,
                        address: 'None',
                        tcontProfile: isAutoVlanMgmtOnly
                          ? defaultTr069Prof?.tcont_profile || 'SMARTOLT-VOIPMNG-10M'
                          : 'SMARTOLT-1G-UP',
                        speedProfile: isAutoVlanMgmtOnly
                          ? defaultTr069Prof?.traffic_profile || 'SMARTOLT-VOIPMNG-10M'
                          : 'SMARTOLT-1G-DOWN',
                        vlanId: targetVlan.vlan_id,
                        onuMode: 'Routing',
                        wanMode: 'PPPOE',
                        configMethod: isAutoVlanMgmtOnly ? 'TR069' : 'OMCI',
                        wanRemoteAccess: 'Enabled from everywhere in the internet',
                        pppoeUsername: isAutoVlanMgmtOnly
                          ? ''
                          : `USER-${u.serial_number.slice(-4)}-${String(nextIdx).padStart(2, '0')}`,
                        pppoePassword: isAutoVlanMgmtOnly ? '' : 'jetcyber',
                        tr069Enabled: isAutoVlanMgmtOnly,
                        tr069AcsUrl: defaultTr069Prof?.acs_url,
                        tr069AcsUsername: defaultTr069Prof?.acs_username,
                        tr069AcsPassword: defaultTr069Prof?.acs_password,
                        tr069MgmtVlanId: isAutoVlanMgmtOnly
                          ? targetVlan.vlan_id
                          : defaultTr069Prof?.mgmt_vlan_id || 100,
                        tr069Priority: defaultTr069Prof?.vlan_priority ?? 2,
                        tr069TcontProfile:
                          defaultTr069Prof?.tcont_profile || 'SMARTOLT-VOIPMNG-10M',
                        tr069TrafficProfile:
                          defaultTr069Prof?.traffic_profile || 'SMARTOLT-VOIPMNG-10M',
                        voipSipEnabled: isAutoVlanMgmtOnly,
                        mgmtOnlyNoInternet: isAutoVlanMgmtOnly,
                      });
                      const oltIdKey = u.olt_id || oltRec?.id || 1;
                      const list = batchScriptsByOlt.get(oltIdKey) || [];
                      list.push(script);
                      batchScriptsByOlt.set(oltIdKey, list);
                    }

                    const logId = Date.now();
                    const firstOltId =
                      unconfiguredOnus[0]?.olt_id || db.olts[0]?.id || 1;
                    const combinedCli = Array.from(batchScriptsByOlt.values())
                      .flat()
                      .join('\n');

                    setDb((prev) => ({
                      ...prev,
                      onus: prev.onus.map((u) => {
                        const allocIdx = allocatedIndexByOnuId.get(u.id);
                        if (!u.is_authorized && allocIdx) {
                          return {
                            ...u,
                            is_authorized: true,
                            onu_index: allocIdx,
                            customer_name: `AUTO-${u.serial_number.slice(-6)}`,
                            vlan_id: targetVlan.id,
                            config_method: isAutoVlanMgmtOnly ? 'TR069' : 'OMCI',
                            tr069_profile_id: isAutoVlanMgmtOnly
                              ? defaultTr069Prof?.id || 1
                              : u.tr069_profile_id,
                            tr069_mgmt_vlan_id: isAutoVlanMgmtOnly
                              ? targetVlan.vlan_id
                              : u.tr069_mgmt_vlan_id,
                            voip_enabled: isAutoVlanMgmtOnly,
                            phase_state: 'working',
                            last_offline_reason: 'None',
                            auth_date_label: 'Just now (Auto)',
                          };
                        }
                        return u;
                      }),
                      provisioning_logs: [
                        {
                          id: logId,
                          olt_id: firstOltId,
                          onu_id: null,
                          serial_number: 'BATCH-AUTO',
                          action_type: 'AUTHORIZE',
                          interface_target: `${unconfiguredOnus.length} ONUs`,
                          summary_text: `Batch Auto-Authorized ${unconfiguredOnus.length} ONUs on VLAN ${targetVlan.vlan_id}`,
                          cli_script: combinedCli,
                          olt_response: '[Executing on OLT via Telnet...]',
                          execution_status: 'SUCCESS',
                          executed_by: 'likhin',
                          duration_ms: 0,
                          created_at: 'Just now',
                        },
                        ...prev.provisioning_logs,
                      ],
                    }));

                    for (const [oltIdKey, scripts] of batchScriptsByOlt.entries()) {
                      void executeOltCliLive(
                        oltIdKey,
                        scripts.join('\n'),
                        logId,
                        `Batch Auto-Authorize (${scripts.length} ONUs)`
                      );
                    }
                  } else {
                    showToast('Auto-Authorization diaktifkan.');
                  }
                  setShowAutoActionsModal(false);
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                Save & Run Batch Authorize Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: ADD NEW OLT
         ===================================================================== */}
      {showAddOltModal && !isViewerUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">+ Add New ZTE OLT</h2>
              <button
                type="button"
                onClick={() => setShowAddOltModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300">OLT Name</label>
                <input
                  type="text"
                  value={newOltName}
                  onChange={(e) => setNewOltName(e.target.value)}
                  placeholder="e.g. POP TANGERANG C320"
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">OLT IP Address</label>
                  <input
                    type="text"
                    value={newOltIp}
                    onChange={(e) => setNewOltIp(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Hardware Version</label>
                  <select
                    value={newOltModel}
                    onChange={(e) =>
                      setNewOltModel(
                        e.target.value as 'ZTE-C320' | 'ZTE-C300' | 'ZTE-C300M'
                      )
                    }
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                  >
                    <option value="ZTE-C320">ZTE-C320</option>
                    <option value="ZTE-C300">ZTE-C300</option>
                    <option value="ZTE-C300M">ZTE-C300M</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-300">VPN Tunnel Name</label>
                <input
                  type="text"
                  value={newOltVpn}
                  onChange={(e) => setNewOltVpn(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAddOltModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newOltName.trim()) return;
                  const nextId =
                    Math.max(0, ...db.olts.map((o) => o.id)) + 1;
                  setDb((prev) => ({
                    ...prev,
                    olts: [
                      ...prev.olts,
                      {
                        ...prev.olts[0],
                        id: nextId,
                        name: newOltName.trim().toUpperCase(),
                        ip_address: newOltIp.trim() || '172.16.0.10',
                        vpn_name: newOltVpn.trim() || 'tunnel-new',
                        hardware_model: newOltModel,
                        uptime: '0 days, 00:05',
                        last_polled_at: 'Just now',
                      },
                    ],
                  }));
                  showToast(`OLT ${newOltName.toUpperCase()} berhasil ditambahkan.`);
                  setNewOltName('');
                  setShowAddOltModal(false);
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                Save OLT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: FIND CONFIG MISMATCHES
         ===================================================================== */}
      {showMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                OLT Startup vs Running-Config Mismatch Check
              </h2>
              <button
                type="button"
                onClick={() => setShowMismatchModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2.5 px-5 py-4 text-xs">
              {db.olts.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded border border-slate-700 bg-[#0d1826] px-3.5 py-2.5"
                >
                  <div>
                    <div className="font-bold text-white">
                      {o.id} - {o.name} ({o.ip_address})
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Running-config vs Database ONUs & Uplink Tagged VLANs
                    </div>
                  </div>
                  <span className="rounded bg-emerald-950/90 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-400 border border-emerald-500/40">
                    ✓ In Sync (0 Mismatches)
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowMismatchModal(false)}
                className="rounded bg-[#0275d8] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: REGISTER UNCONFIGURED ONU SN TO DATABASE
         ===================================================================== */}
      {showAddUncfgModal && !isViewerUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                Register Unconfigured ONU SN (`show gpon onu uncfg`)
              </h2>
              <button
                type="button"
                onClick={() => setShowAddUncfgModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300">Target OLT</label>
                <select
                  value={manualUncfgOltId}
                  onChange={(e) => setManualUncfgOltId(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 text-white"
                >
                  {db.olts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} - {o.name} ({o.ip_address})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">
                    PON Port (`1/3/x`)
                  </label>
                  <select
                    value={manualUncfgPort}
                    onChange={(e) => setManualUncfgPort(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  >
                    {Array.from({ length: 16 }, (_, idx) => idx + 1).map((p) => (
                      <option key={p} value={p}>
                        gpon-olt_1/3/{p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-300">ONU Type</label>
                  <select
                    value={manualUncfgType}
                    onChange={(e) => setManualUncfgType(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  >
                    <option value="ALL">ALL</option>
                    <option value="F670LV9.0">F670LV9.0</option>
                    <option value="F609V3.0">F609V3.0</option>
                    <option value="HG8245H">HG8245H</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-300">
                  ONU Serial Number (SN)
                </label>
                <input
                  type="text"
                  value={manualUncfgSn}
                  onChange={(e) => setManualUncfgSn(e.target.value.toUpperCase())}
                  placeholder="e.g. ZTEGC6A394D4"
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowAddUncfgModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!manualUncfgSn.trim()) return;
                  const newUncfg: OnuRecord = {
                    id: Date.now(),
                    olt_id: manualUncfgOltId,
                    pon_port_id: manualUncfgOltId * 100 + manualUncfgPort,
                    board: 3,
                    port: manualUncfgPort,
                    onu_index: null,
                    serial_number: manualUncfgSn.trim(),
                    onu_type: manualUncfgType,
                    is_authorized: false,
                    customer_name: null,
                    address: null,
                    external_id: manualUncfgSn.trim(),
                    zone_id: db.zones[0]?.id || null,
                    odb_id: db.odbs[0]?.id || null,
                    odb_port: null,
                    vlan_id: db.vlans.find((v) => v.olt_id === manualUncfgOltId)?.id || null,
                    speed_profile_id: 1,
                    tcont_profile_id: 1,
                    onu_mode: 'Routing',
                    wan_mode: 'PPPOE',
                    config_method: 'OMCI',
                    wan_remote_access: 'Enabled from everywhere in the internet',
                    wan_remote_allowed_subnet: '0.0.0.0/0',
                    tr069_profile_id: 1,
                    tr069_status: 'DISABLED',
                    tr069_last_inform: null,
                    wifi_ssid: null,
                    wifi_password: null,
                    pppoe_username: null,
                    pppoe_password: null,
                    hotspot_bridge_vlan: null,
                    admin_state: 'ENABLED',
                    phase_state: 'Unconfigured',
                    onu_rx_dbm: -21.5,
                    onu_tx_dbm: 2.3,
                    olt_rx_dbm: -24.8,
                    distance_m: 520,
                    temperature_c: 40,
                    ip_address: null,
                    firmware_ver: 'V2.1.0',
                    detected_ago: new Date().toISOString(),
                    last_online_at: new Date().toISOString(),
                    last_offline_reason: 'Waiting Authorization',
                  };
                  setDb((prev) => ({
                    ...prev,
                    onus: [...prev.onus, newUncfg],
                  }));
                  setShowAddUncfgModal(false);
                  showToast(
                    `SN ${newUncfg.serial_number} ditambahkan ke daftar Unconfigured (Port 1/3/${manualUncfgPort}).`
                  );
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                Add to Unconfigured
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: POSTGRESQL CONNECTION SETTINGS (localhost:5435 | user: likhin)
         ===================================================================== */}
      {showPgConfigModal && !isViewerUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#15202e] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3.5">
              <h2 className="text-base font-bold text-white">
                PostgreSQL Connection (Separate Docker DB)
              </h2>
              <button
                type="button"
                onClick={() => setShowPgConfigModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div className="rounded border border-sky-500/30 bg-sky-950/30 p-2.5 text-[11px] text-slate-200">
                <div>
                  Status: <strong className="text-emerald-400">{dbMeta.dbEngine}</strong>
                </div>
                {dbMeta.pgLastError && !dbMeta.pgConnected && (
                  <div className="mt-1 text-amber-300">
                    Info: Saat aplikasi dijalankan di Docker lokal Anda (<code>port 3004</code>), server otomatis terhubung ke PostgreSQL <code>{pgHost}:{pgPort}</code> dan membuat database <code>{pgDatabase}</code> beserta seluruh tabel.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-300">
                    PostgreSQL Host
                  </label>
                  <input
                    type="text"
                    value={pgHost}
                    onChange={(e) => setPgHost(e.target.value)}
                    placeholder="localhost or host.docker.internal"
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">
                    Port (5435)
                  </label>
                  <input
                    type="number"
                    value={pgPort}
                    onChange={(e) => setPgPort(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">
                    Username
                  </label>
                  <input
                    type="text"
                    value={pgUser}
                    onChange={(e) => setPgUser(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">
                    Password
                  </label>
                  <input
                    type="password"
                    value={pgPassword}
                    placeholder="•••••••• (kosongkan untuk password server saat ini)"
                    onChange={(e) => setPgPassword(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">
                  Database Name
                </label>
                <input
                  type="text"
                  value={pgDatabase}
                  onChange={(e) => setPgDatabase(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-600 bg-[#1c2a3b] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-700/80 bg-[#121c29] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowPgConfigModal(false)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Close
              </button>
              <button
                type="button"
                disabled={pgTesting}
                onClick={async () => {
                  setPgTesting(true);
                  try {
                    const resp = await fetch('/api/db/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        host: pgHost,
                        port: pgPort,
                        user: pgUser,
                        password: pgPassword,
                        database: pgDatabase,
                      }),
                    });
                    const data = await resp.json();
                    if (data.meta) setDbMeta(data.meta);
                    if (data.ok) {
                      showToast(
                        `Connected to PostgreSQL ${pgUser}@${pgHost}:${pgPort}/${pgDatabase}!`
                      );
                      setShowPgConfigModal(false);
                    } else {
                      showToast(
                        `Konfigurasi disimpan (${pgUser}@${pgHost}:${pgPort}). Pastikan PostgreSQL lokal aktif saat dijalankan di Docker.`
                      );
                    }
                  } finally {
                    setPgTesting(false);
                  }
                }}
                className="rounded bg-[#5cb85c] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#4cae4c]"
              >
                {pgTesting ? 'Connecting...' : 'Save & Connect PostgreSQL'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          BACKUP & RESTORE DATABASE + OLT RUNNING-CONFIG MODAL
         =================================================================== */}
      {showBackupModal && !isViewerUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowBackupModal(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-600 bg-[#152030] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-700/80 bg-[#101926] px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-white">
                  Backup &amp; Restore Database &amp; Konfigurasi OLT
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Simpan cadangan penuh (OLT, ONU, Zone, RK/Sector, Splitter/ODP, VLAN &amp; User) atau pulihkan data dari file backup / snapshot server.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBackupModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-6 p-6 text-xs">
              {/* SECTION 1: DOWNLOAD BACKUP (FILE JSON & CLI RUNNING-CONFIG) */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Card A: Full System Backup (.json) */}
                <div className="flex flex-col justify-between rounded-lg border border-emerald-500/30 bg-[#0d1a2b] p-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-300">
                        1. Backup Penuh Database (.json)
                      </span>
                      <span className="rounded bg-emerald-950/80 px-2 py-0.5 font-mono text-[10px] text-emerald-300 border border-emerald-500/30">
                        Full System State
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-300">
                      Mengunduh seluruh data OLT ({db.olts.length}), ONU ({db.onus.length}), Zone ({db.zones.length}), RK/Sector ({(db.sectors || []).length}), Splitter/ODP ({db.odbs.length}), VLAN ({db.vlans.length}), dan User ({(db.users || []).length}) ke komputer Anda.
                    </p>
                  </div>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={handleDownloadFullBackupJson}
                      className="inline-flex w-full items-center justify-center gap-2 rounded bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-500"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Full Backup (.json)
                    </button>
                  </div>
                </div>

                {/* Card B: Per-OLT ZTE Running-Config CLI (.cfg) */}
                <div className="flex flex-col justify-between rounded-lg border border-sky-500/30 bg-[#0d1a2b] p-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sky-300">
                        2. Backup CLI Running-Config OLT (.cfg)
                      </span>
                      <span className="rounded bg-sky-950/80 px-2 py-0.5 font-mono text-[10px] text-sky-300 border border-sky-500/30">
                        ZTE / Huawei CLI
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-300">
                      Unduh script konfigurasi CLI OLT (`vlan`, `interface gpon-olt`, `interface gpon-onu`, `pon-onu-mng`) siap pakai untuk restore ke mesin OLT:
                    </p>
                    <div className="mt-3 max-h-28 space-y-1.5 overflow-y-auto pr-1">
                      {visibleOlts.map((olt) => (
                        <div
                          key={olt.id}
                          className="flex items-center justify-between rounded border border-slate-700/80 bg-[#13243a] px-3 py-1.5"
                        >
                          <div>
                            <div className="font-semibold text-white">
                              {olt.name}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400">
                              {olt.ip_address} • {olt.hardware_model}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDownloadOltCliConfig(olt)}
                            className="inline-flex items-center gap-1 rounded bg-[#0275d8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#025aa5]"
                          >
                            <Download className="h-3 w-3" />
                            .cfg
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: RESTORE DARI FILE BACKUP (.JSON) */}
              <div className="rounded-lg border border-amber-500/30 bg-[#0d1a2b] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-amber-300">
                      3. Restore Database dari File Backup (.json)
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-300">
                      Pilih file <span className="font-mono text-white">.json</span> hasil backup untuk memulihkan data. Sistem otomatis membuat titik Auto-Backup sebelum menimpa data.
                    </p>
                  </div>

                  {/* Mode Restore */}
                  <div className="flex items-center gap-2 rounded border border-slate-700 bg-[#13243a] p-1">
                    <button
                      type="button"
                      onClick={() => setRestoreMode('OVERWRITE')}
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                        restoreMode === 'OVERWRITE'
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Full Restore (Timpa Semua)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestoreMode('MERGE')}
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                        restoreMode === 'MERGE'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Merge (Gabungkan Data)
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-slate-600 bg-[#172a45] px-3.5 py-2 text-xs font-semibold text-sky-300 hover:border-sky-400 hover:text-white">
                    <FileCode className="h-4 w-4" />
                    <span>Pilih File Backup (.json)</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleBackupFileSelect}
                      className="hidden"
                    />
                  </label>
                  {uploadedBackupFileName ? (
                    <span className="font-mono text-xs text-emerald-300">
                      File dipilih: <strong>{uploadedBackupFileName}</strong>
                      {uploadedBackupMeta?.exportedAtWib
                        ? ` (Diekspor: ${uploadedBackupMeta.exportedAtWib})`
                        : ''}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">
                      Belum ada file backup yang dipilih.
                    </span>
                  )}
                </div>

                {uploadedBackupState && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-emerald-500/40 bg-emerald-950/30 p-3">
                    <div className="space-y-1">
                      <div className="font-bold text-emerald-300">
                        Preview Isi File Backup:
                      </div>
                      <div className="flex flex-wrap gap-2 font-mono text-[11px] text-slate-200">
                        <span className="rounded bg-slate-800 px-2 py-0.5">
                          OLT: {uploadedBackupState.olts?.length || 0}
                        </span>
                        <span className="rounded bg-slate-800 px-2 py-0.5">
                          ONU: {uploadedBackupState.onus?.length || 0}
                        </span>
                        <span className="rounded bg-slate-800 px-2 py-0.5">
                          Zone: {uploadedBackupState.zones?.length || 0}
                        </span>
                        <span className="rounded bg-slate-800 px-2 py-0.5">
                          RK/Sector: {(uploadedBackupState.sectors || []).length}
                        </span>
                        <span className="rounded bg-slate-800 px-2 py-0.5">
                          Splitter/ODP: {uploadedBackupState.odbs?.length || 0}
                        </span>
                        <span className="rounded bg-slate-800 px-2 py-0.5">
                          User: {(uploadedBackupState.users || []).length}
                        </span>
                      </div>
                    </div>
                    {isAdminUser ? (
                      <button
                        type="button"
                        disabled={backupBusy}
                        onClick={handleConfirmFileRestore}
                        className="rounded bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-amber-500 disabled:opacity-50"
                      >
                        {backupBusy
                          ? 'Memproses Restore...'
                          : `Jalankan Restore Sekarang (${
                              restoreMode === 'MERGE' ? 'Merge' : 'Full Restore'
                            })`}
                      </button>
                    ) : (
                      <span className="text-[11px] font-semibold text-red-300">
                        Hanya Admin yang dapat mengeksekusi Restore.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 3: SERVER SNAPSHOTS (TITIK BACKUP CEPAT DI SERVER) */}
              <div className="rounded-lg border border-slate-700 bg-[#0d1a2b] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-white">
                      4. Titik Backup Cepat di Server (Server Snapshots)
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Simpan titik cadangan instan di database server sebelum melakukan perubahan besar.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={backupSnapshotLabel}
                      onChange={(e) => setBackupSnapshotLabel(e.target.value)}
                      placeholder="Catatan snapshot (opsional)..."
                      className="w-56 rounded border border-slate-600 bg-[#13243a] px-3 py-1.5 text-xs text-white placeholder-slate-400 focus:border-sky-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={backupBusy}
                      onClick={handleCreateServerSnapshot}
                      className="inline-flex items-center gap-1.5 rounded bg-[#0275d8] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#025aa5] disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Buat Snapshot Sekarang
                    </button>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto rounded border border-slate-700/80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-700 bg-[#101d2e] text-[11px] font-bold uppercase text-slate-300">
                      <tr>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Label / Catatan</th>
                        <th className="px-3 py-2">Waktu (WIB)</th>
                        <th className="px-3 py-2">Ringkasan Data</th>
                        <th className="px-3 py-2">Dibuat Oleh</th>
                        <th className="px-3 py-2 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-[#0b1523]">
                      {backupSnapshots.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-6 text-center text-slate-400"
                          >
                            Belum ada snapshot tersimpan di server.
                          </td>
                        </tr>
                      ) : (
                        backupSnapshots.map((snap) => (
                          <tr key={snap.id} className="hover:bg-[#13243a]/60">
                            <td className="px-3 py-2.5 font-mono text-sky-300">
                              #{snap.id}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-white">
                              {snap.label}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">
                              {snap.created_at_wib}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-300">
                              {snap.olts_count} OLT • {snap.onus_count} ONU •{' '}
                              {snap.zones_count} Zone • {snap.rks_count} RK/ODP
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-emerald-300">
                              {snap.created_by}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDownloadSnapshotFile(snap)
                                  }
                                  className="rounded border border-sky-500/40 bg-sky-950/50 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-900/70 hover:text-white"
                                  title="Download file JSON snapshot ini"
                                >
                                  Download
                                </button>
                                {isAdminUser && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={backupBusy}
                                      onClick={() =>
                                        void handleRestoreFromSnapshot(snap)
                                      }
                                      className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                                      title="Pulihkan database ke titik snapshot ini"
                                    >
                                      Restore
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleDeleteSnapshot(snap.id)
                                      }
                                      className="rounded border border-red-500/40 bg-red-950/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 hover:text-white"
                                      title="Hapus snapshot"
                                    >
                                      <Trash2 className="h-3 w-3" />
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
              </div>

              {/* SECTION 4: GOOGLE DRIVE CLOUD BACKUP & RESTORE */}
              <div className="rounded-lg border border-sky-500/35 bg-[#0d1a2b] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sky-300">
                        5. Google Drive Cloud Backup &amp; Restore
                      </h4>
                      <span className="rounded border border-sky-500/30 bg-sky-950/80 px-2 py-0.5 font-mono text-[10px] text-sky-300">
                        Google Workspace API
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-300">
                      Simpan cadangan database (.json) atau konfigurasi CLI OLT (.cfg) langsung ke akun Google Drive Anda, atau pulihkan dari Google Drive.
                    </p>
                  </div>

                  {!driveConnected ? (
                    <button
                      type="button"
                      disabled={driveBusy}
                      onClick={() => void handleConnectGoogleDrive()}
                      className="inline-flex items-center gap-2.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-xs transition hover:bg-slate-100 disabled:opacity-50"
                    >
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        className="h-4 w-4 shrink-0"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
                      <span>
                        {driveBusy ? 'Connecting...' : 'Sign in with Google'}
                      </span>
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-emerald-500/30 bg-emerald-950/60 px-2.5 py-1 font-mono text-[11px] text-emerald-300">
                        ● {driveUser?.email || driveUser?.displayName || 'Connected'}
                      </span>
                      <button
                        type="button"
                        disabled={driveBusy}
                        onClick={() => void handleUploadFullBackupToDrive()}
                        className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Upload Backup (.json) ke Drive
                      </button>
                      <button
                        type="button"
                        disabled={driveBusy}
                        onClick={() => void handleLoadDriveBackups()}
                        className="inline-flex items-center gap-1 rounded border border-slate-600 bg-[#13243a] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            driveBusy ? 'animate-spin' : ''
                          }`}
                        />
                        Refresh Drive
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDisconnectGoogleDrive()}
                        className="rounded border border-red-500/40 bg-red-950/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/60"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>

                {driveConnected && visibleOlts.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                    <span className="text-[11px] text-slate-400">
                      Upload CLI (.cfg) OLT ke Google Drive:
                    </span>
                    {visibleOlts.map((olt) => (
                      <button
                        key={olt.id}
                        type="button"
                        disabled={driveBusy}
                        onClick={() => void handleUploadOltCfgToDrive(olt)}
                        className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-950/50 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-900/70 hover:text-white disabled:opacity-50"
                      >
                        <Save className="h-3 w-3" />
                        {olt.name} (.cfg)
                      </button>
                    ))}
                  </div>
                )}

                {driveConnected && (
                  <div className="mt-3 overflow-x-auto rounded border border-slate-700/80">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-700 bg-[#101d2e] text-[11px] font-bold uppercase text-slate-300">
                        <tr>
                          <th className="px-3 py-2">Nama File di Google Drive</th>
                          <th className="px-3 py-2">Terakhir Diubah</th>
                          <th className="px-3 py-2">Ukuran</th>
                          <th className="px-3 py-2 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-[#0b1523]">
                        {driveFiles.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-5 text-center text-slate-400"
                            >
                              Belum ada file backup SmartOLT yang ditemukan di Google Drive Anda.
                            </td>
                          </tr>
                        ) : (
                          driveFiles.map((file) => (
                            <tr
                              key={file.id}
                              className="hover:bg-[#13243a]/60"
                            >
                              <td className="px-3 py-2 font-mono font-semibold text-white">
                                {file.name}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-300">
                                {file.modifiedTime
                                  ? new Date(file.modifiedTime).toLocaleString(
                                      'id-ID'
                                    )
                                  : '-'}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                                {file.size
                                  ? `${(Number(file.size) / 1024).toFixed(1)} KB`
                                  : '-'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {file.name.endsWith('.json') && (
                                    <button
                                      type="button"
                                      disabled={driveBusy}
                                      onClick={() =>
                                        void handleSelectDriveBackupForRestore(
                                          file
                                        )
                                      }
                                      className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                                    >
                                      Pilih untuk Restore
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={driveBusy}
                                    onClick={() =>
                                      setDriveDeleteConfirmFile(file)
                                    }
                                    className="rounded border border-red-500/40 bg-red-950/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 hover:text-white"
                                    title="Hapus file dari Google Drive"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Confirmation Modal before Deleting File from Google Drive */}
            {driveDeleteConfirmFile && (
              <div
                className="fixed inset-0 z-60 flex items-center justify-center bg-black/75 p-4"
                onClick={() => setDriveDeleteConfirmFile(null)}
              >
                <div
                  className="w-full max-w-md rounded-xl border border-red-500/40 bg-slate-900 p-5 text-xs text-slate-200 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Konfirmasi Hapus File di Google Drive</span>
                  </div>
                  <p className="mt-2 text-slate-300">
                    Apakah Anda yakin ingin menghapus file berikut secara permanen dari Google Drive Anda?
                  </p>
                  <div className="mt-2 rounded border border-slate-800 bg-slate-950 p-2.5 font-mono text-[11px] text-white">
                    <div>File: {driveDeleteConfirmFile.name}</div>
                    <div className="text-slate-400">
                      ID: {driveDeleteConfirmFile.id}
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDriveDeleteConfirmFile(null)}
                      className="rounded bg-slate-800 px-3 py-1.5 font-semibold text-slate-300 hover:bg-slate-700"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={driveBusy}
                      onClick={() => void handleConfirmDeleteDriveFile()}
                      className="rounded bg-red-600 px-3.5 py-1.5 font-bold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {driveBusy ? 'Menghapus...' : 'Ya, Hapus dari Drive'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end border-t border-slate-700/80 bg-[#101926] px-6 py-3">
              <button
                type="button"
                onClick={() => setShowBackupModal(false)}
                className="rounded bg-slate-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-600"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL UBAH NAMA BRAND / ISP (DYNAMIC BRANDING)
         =================================================================== */}
      {showEditBrandModal && !isViewerUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowEditBrandModal(false)}
        >
          <div
            className="animate-modal-in w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-xs text-slate-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
                  <Wifi className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Ubah Nama Brand / ISP
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Sesuaikan nama aplikasi pada Header, Breadcrumb &amp; Halaman Login
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditBrandModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBrandName} className="space-y-4 p-6">
              <div>
                <label className="mb-1.5 block font-semibold text-slate-300">
                  Nama Brand / Perusahaan ISP
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={40}
                  value={brandNameDraft}
                  onChange={(e) => setBrandNameDraft(e.target.value)}
                  placeholder="Contoh: JETCYBERNET / NUSANTARA FIBER"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Nama ini akan langsung tampil di navigasi atas, sub-header halaman, menu mobile, dan halaman login.
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setBrandNameDraft('JETCYBERNET')}
                  className="text-[11px] font-medium text-slate-400 hover:text-sky-300"
                >
                  Reset ke Default
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEditBrandModal(false)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 font-semibold text-slate-300 hover:bg-slate-700"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-sky-600 px-4 py-2 font-bold text-white hover:bg-sky-500"
                  >
                    Simpan Nama
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL UBAH PASSWORD (UNTUK SEMUA LEVEL USER: ADMIN, OPERATOR, TECHNICIAN, VIEWER)
         =================================================================== */}
      {showChangePasswordModal && currentUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowChangePasswordModal(false)}
        >
          <div
            className="animate-modal-in w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-xs text-slate-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
                  <Lock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {changePwdTargetUser &&
                    changePwdTargetUser.id !== currentUser.id
                      ? `Reset Password — ${changePwdTargetUser.username}`
                      : 'Ubah Password Akun'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {(changePwdTargetUser || currentUser).full_name} ·{' '}
                    <span className="font-mono text-sky-400">
                      {(changePwdTargetUser || currentUser).role}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowChangePasswordModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleChangePasswordSubmit} className="space-y-4 p-6">
              {changePwdError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-xs font-medium text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span>{changePwdError}</span>
                </div>
              )}

              {(!changePwdTargetUser ||
                changePwdTargetUser.id === currentUser.id) && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="font-medium text-slate-300">
                      Password Saat Ini
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowChangePwdText((v) => !v)}
                      className="text-[11px] font-medium text-sky-400 hover:text-sky-300"
                    >
                      {showChangePwdText ? 'Sembunyikan' : 'Tampilkan'}
                    </button>
                  </div>
                  <input
                    type={showChangePwdText ? 'text' : 'password'}
                    required
                    autoFocus
                    value={currentPwdInput}
                    onChange={(e) => setCurrentPwdInput(e.target.value)}
                    placeholder="Masukkan password saat ini"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-400"
                  />
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="font-medium text-slate-300">
                    Password Baru (Min. 6 Karakter)
                  </label>
                  {changePwdTargetUser &&
                    changePwdTargetUser.id !== currentUser.id && (
                      <button
                        type="button"
                        onClick={() => setShowChangePwdText((v) => !v)}
                        className="text-[11px] font-medium text-sky-400 hover:text-sky-300"
                      >
                        {showChangePwdText ? 'Sembunyikan' : 'Tampilkan'}
                      </button>
                    )}
                </div>
                <input
                  type={showChangePwdText ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPwdInput}
                  onChange={(e) => setNewPwdInput(e.target.value)}
                  placeholder="Masukkan password baru"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block font-medium text-slate-300">
                  Konfirmasi Password Baru
                </label>
                <input
                  type={showChangePwdText ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPwdInput}
                  onChange={(e) => setConfirmPwdInput(e.target.value)}
                  placeholder="Ulangi password baru"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowChangePasswordModal(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={changePwdLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
                >
                  {changePwdLoading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Simpan Password Baru</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MOBILE BOTTOM QUICK-NAVIGATION BAR (lg:hidden) */}
      <nav className="fixed right-0 bottom-0 left-0 z-40 flex h-16 items-center justify-around border-t border-slate-800 bg-[#090d16]/95 px-2 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setActiveView('DASHBOARD')}
          className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[10px] font-medium transition ${
            activeView === 'DASHBOARD' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span>Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('UNCONFIGURED')}
          className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[10px] font-medium transition ${
            activeView === 'UNCONFIGURED' || activeView === 'AUTHORIZE_FORM'
              ? 'text-sky-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radio className="h-4 w-4" />
          <span>Uncfg ({unconfiguredOnus.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('CONFIGURED')}
          className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[10px] font-medium transition ${
            activeView === 'CONFIGURED' || activeView === 'ONU_DETAIL'
              ? 'text-sky-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wifi className="h-4 w-4" />
          <span>ONUs</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('OLTS_LIST')}
          className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[10px] font-medium transition ${
            activeView === 'OLTS_LIST' || activeView === 'OLT_DETAIL' || activeView === 'ADD_OLT'
              ? 'text-sky-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Server className="h-4 w-4" />
          <span>OLTs</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[10px] font-medium text-slate-400 transition hover:text-slate-200"
        >
          <Menu className="h-4 w-4" />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}
