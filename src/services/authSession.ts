export const AUTH_SESSION_TOKEN_KEY = 'smartolt_session_token';
export const LEGACY_AUTH_USER_ID_KEY = 'smartolt_auth_session_user_id';
export const IDLE_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout

// Immediately purge any legacy unverified user ID from localStorage
try {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_AUTH_USER_ID_KEY);
  }
} catch {
  // ignore
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
