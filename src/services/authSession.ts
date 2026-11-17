export const AUTH_SESSION_TOKEN_KEY = 'smartolt_session_token';
export const AUTH_LAST_ACTIVITY_KEY = 'smartolt_last_activity_at';
export const LEGACY_AUTH_USER_ID_KEY = 'smartolt_auth_session_user_id';
export const IDLE_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout
export const IDLE_WARNING_THRESHOLD_MS = 2 * 60 * 1000; // Warn 2 minutes before auto-logout

// Immediately purge any legacy unverified user ID from localStorage
try {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_AUTH_USER_ID_KEY);
  }
} catch {
  // ignore
}

export function readLastActivityTimestamp(): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(AUTH_LAST_ACTIVITY_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function touchUserActivityTimestamp(ts: number = Date.now()): number {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(AUTH_LAST_ACTIVITY_KEY, String(ts));
    }
  } catch {
    // ignore
  }
  return ts;
}

export function clearLastActivityTimestamp(): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(AUTH_LAST_ACTIVITY_KEY);
    }
  } catch {
    // ignore
  }
}

export function formatRemainingIdleTime(remainingMs: number): string {
  const clampedSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mins = Math.floor(clampedSec / 60);
  const secs = clampedSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let globalOnUnauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  globalOnUnauthorizedHandler = handler;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
  const isApiCall = urlStr.startsWith('/api/') || urlStr.includes('/api/');
  let nextInit = init;

  if (isApiCall) {
    let token = '';
    try {
      token = window.sessionStorage.getItem(AUTH_SESSION_TOKEN_KEY) || '';
    } catch {
      // ignore
    }
    const headers = new Headers(init?.headers || {});
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    nextInit = {
      ...init,
      credentials: 'same-origin',
      headers,
    };
  }

  const response = await globalThis.fetch(input, nextInit);
  if (
    isApiCall &&
    response.status === 401 &&
    !urlStr.includes('/api/auth/login') &&
    !urlStr.includes('/api/auth/session')
  ) {
    if (globalOnUnauthorizedHandler) {
      globalOnUnauthorizedHandler();
    }
  }
  return response;
}
