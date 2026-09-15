export interface Settings {
  apiUrl: string;
  canvasBaseUrl: string;
  deviceToken?: string;
  deviceId?: string;
  email?: string;
}

export type SyncStatus =
  | { state: 'unpaired' }
  | { state: 'ok'; at: string; count: number; via: 'tab' | 'worker' }
  | { state: 'canvas_logged_out'; at: string }
  | { state: 'error'; at: string; message: string }
  | { state: 'syncing'; at: string };

export const DEFAULTS: Settings = { apiUrl: __CALLY_API_URL__, canvasBaseUrl: __CANVAS_BASE_URL__ };

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getStatus(): Promise<SyncStatus> {
  const { status } = await chrome.storage.local.get('status');
  return status ?? { state: 'unpaired' };
}

export async function setStatus(status: SyncStatus): Promise<void> {
  await chrome.storage.local.set({ status });
}

export type Message = { type: 'sync' } | { type: 'pair'; code: string } | { type: 'unpair' } | { type: 'status' };
