import { CanvasClient, CanvasHttpError, sessionFetch, type FetchLike } from '@cally/core/canvas';
import { defaultWindow } from '@cally/core/time';
import { getSettings, getStatus, setSettings, setStatus, type Message, type SyncStatus } from './state';

const ALARM = 'cally-sync';
const INTERVAL_MIN = 30;

chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void runSync();
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: INTERVAL_MIN, delayInMinutes: 1 });
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, respond) => {
  (async () => {
    switch (msg.type) {
      case 'sync':
        return respond(await runSync());
      case 'pair':
        return respond(await pair(msg.code));
      case 'unpair':
        await setSettings({ deviceToken: undefined, deviceId: undefined, email: undefined });
        await setStatus({ state: 'unpaired' });
        return respond({ ok: true });
      case 'status':
        return respond(await getStatus());
    }
  })().catch((e) => respond({ ok: false, error: String(e) }));
  return true; // async response
});

/* ---------------------------------------------------------------- */

async function pair(code: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const s = await getSettings();
  const res = await fetch(`${s.apiUrl}/api/extension/pair/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label: await deviceLabel() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  await setSettings({ deviceToken: data.deviceToken, deviceId: data.deviceId, email: data.email, canvasBaseUrl: data.canvasBaseUrl ?? s.canvasBaseUrl });
  void runSync();
  return { ok: true, email: data.email };
}

async function deviceLabel(): Promise<string> {
  const info = await chrome.runtime.getPlatformInfo();
  const os = { mac: 'macOS', win: 'Windows', linux: 'Linux', cros: 'ChromeOS', android: 'Android', openbsd: 'OpenBSD', fuchsia: 'Fuchsia' }[info.os] ?? info.os;
  return `Chrome on ${os}`;
}

/**
 * Pull the planner with the user's own Canvas session and hand the raw items
 * to the API. Prefers running the fetch inside an open Canvas tab (same-origin,
 * cookies guaranteed); otherwise fetches from the worker with credentials.
 */
export async function runSync(): Promise<SyncStatus> {
  const s = await getSettings();
  if (!s.deviceToken) return finish({ state: 'unpaired' });
  const prev = await getStatus();
  if (prev.state === 'syncing' && Date.now() - new Date(prev.at).getTime() < 120_000) return prev;
  await setStatus({ state: 'syncing', at: new Date().toISOString() });

  const tab = await findCanvasTab(s.canvasBaseUrl);
  const via: 'tab' | 'worker' = tab ? 'tab' : 'worker';
  const client = new CanvasClient({ baseUrl: s.canvasBaseUrl, fetch: tab ? tabFetch(tab.id!) : sessionFetch() });
  const window = defaultWindow();

  try {
    const [items, self] = await Promise.all([client.plannerItems(window.start, window.end), client.self().catch(() => null)]);
    const res = await fetch(`${s.apiUrl}/api/extension/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.deviceToken}` },
      body: JSON.stringify({ baseUrl: s.canvasBaseUrl, window, items, canvasUserName: self?.name }),
    });
    if (res.status === 401) {
      await setSettings({ deviceToken: undefined, deviceId: undefined, email: undefined });
      return finish({ state: 'unpaired' });
    }
    if (!res.ok) throw new Error(`cally API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return finish({ state: 'ok', at: new Date().toISOString(), count: items.length, via });
  } catch (e) {
    if (e instanceof CanvasHttpError && (e.status === 401 || e.status === 403)) return finish({ state: 'canvas_logged_out', at: new Date().toISOString() });
    // Canvas redirects unauthenticated HTML requests to the login page; the JSON parse then fails.
    if (e instanceof SyntaxError) return finish({ state: 'canvas_logged_out', at: new Date().toISOString() });
    return finish({ state: 'error', at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) });
  }
}

async function finish(status: SyncStatus): Promise<SyncStatus> {
  await setStatus(status);
  await chrome.action.setBadgeText({ text: status.state === 'ok' || status.state === 'syncing' ? '' : '!' });
  await chrome.action.setBadgeBackgroundColor({ color: status.state === 'canvas_logged_out' ? '#9a6700' : '#b42318' });
  return status;
}

async function findCanvasTab(baseUrl: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: `${baseUrl.replace(/\/+$/, '')}/*`, status: 'complete' });
  return tabs.find((t) => t.id != null && !t.discarded);
}

/** A FetchLike that executes the request inside a Canvas tab, so it's same-origin. */
function tabFetch(tabId: number): FetchLike {
  return async (url, init) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async (u: string, headers: Record<string, string>) => {
        const r = await fetch(u, { credentials: 'include', headers });
        return { status: r.status, text: await r.text(), link: r.headers.get('link'), contentType: r.headers.get('content-type') };
      },
      args: [url, Object.fromEntries(new Headers(init?.headers ?? {}).entries())],
    });
    const r = result?.result as { status: number; text: string; link: string | null; contentType: string | null } | undefined;
    if (!r) throw new Error('Canvas tab did not respond');
    const headers = new Headers();
    if (r.link) headers.set('link', r.link);
    if (r.contentType) headers.set('content-type', r.contentType);
    return new Response(r.text, { status: r.status, headers });
  };
}
