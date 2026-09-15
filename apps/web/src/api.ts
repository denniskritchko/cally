export interface Me {
  user: { id: string; email: string; name: string | null; timezone: string };
  feed: { https: string; webcal: string };
  canvas: { kind: 'extension' | 'token' | 'feed'; baseUrl: string; canvasUserName: string | null; lastSyncedAt: string | null; lastError: string | null } | null;
  google: { enabled: boolean; connected: boolean; calendarId: string | null; lastSyncedAt: string | null; lastError: string | null };
  extension: { devices: { id: string; label: string | null; lastSeenAt: string | null; lastPushAt: string | null; lastPushCount: number | null }[] };
  eventCount: number;
  upcoming: { uid: string; kind: string; title: string; start: string; end?: string; allDay: boolean; url?: string; completed?: boolean; courseName?: string }[];
  recentRuns: { stage: 'pull' | 'push'; ok: boolean; detail: unknown; startedAt: string; finishedAt: string }[];
  canvasBaseUrl: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => call<Me>('GET', '/api/me'),
  logout: () => call('POST', '/api/auth/logout'),
  syncNow: () => call('POST', '/api/me/sync'),
  rotateFeed: () => call<{ feed: Me['feed'] }>('POST', '/api/me/feed/rotate'),
  connectToken: (token: string) => call<{ canvasUserName: string }>('POST', '/api/canvas/token', { token }),
  connectFeed: (feedUrl: string) => call('POST', '/api/canvas/feed', { feedUrl }),
  disconnectCanvas: () => call('DELETE', '/api/canvas'),
  disconnectGoogle: () => call('DELETE', '/api/me/google'),
  pairStart: () => call<{ code: string; expiresInSeconds: number }>('POST', '/api/extension/pair/start'),
  removeDevice: (id: string) => call('DELETE', `/api/extension/devices/${id}`),
  deleteAccount: () => call('DELETE', '/api/me/account'),
};
