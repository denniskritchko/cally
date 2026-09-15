import { getSettings, setSettings, type Message, type Settings, type SyncStatus } from './state';

const app = document.getElementById('app')!;
const send = <T = unknown>(msg: Message) => chrome.runtime.sendMessage(msg) as Promise<T>;

async function render() {
  const [settings, status] = await Promise.all([getSettings(), send<SyncStatus>({ type: 'status' })]);
  app.innerHTML = '';
  app.append(settings.deviceToken ? pairedView(settings, status) : unpairedView(settings));
}

function unpairedView(settings: Settings): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <p>Open <a href="${settings.apiUrl}" target="_blank">cally</a>, sign in, and click <b>Get pairing code</b>. Then enter it here.</p>
    <input id="code" placeholder="ABC-123" maxlength="7" autofocus />
    <button id="pair" class="primary" disabled>Pair</button>
    <p id="msg" class="muted"></p>
    <details>
      <summary>Advanced</summary>
      <label>cally server URL<input id="api" type="url" value="${settings.apiUrl}" /></label>
    </details>`;
  const code = el.querySelector<HTMLInputElement>('#code')!;
  const btn = el.querySelector<HTMLButtonElement>('#pair')!;
  const msg = el.querySelector<HTMLElement>('#msg')!;
  const api = el.querySelector<HTMLInputElement>('#api')!;
  code.addEventListener('input', () => (btn.disabled = code.value.replace(/[^a-z0-9]/gi, '').length < 6));
  api.addEventListener('change', () => void setSettings({ apiUrl: api.value.replace(/\/+$/, '') }));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.textContent = 'Pairing…';
    const r = await send<{ ok: boolean; email?: string; error?: string }>({ type: 'pair', code: code.value });
    if (r.ok) await render();
    else {
      msg.textContent = r.error ?? 'Pairing failed';
      btn.disabled = false;
    }
  });
  return el;
}

function pairedView(settings: Settings, status: SyncStatus): HTMLElement {
  const el = document.createElement('div');
  const line = describe(status, settings);
  el.innerHTML = `
    <p class="muted">Paired as <b>${settings.email ?? '?'}</b></p>
    <div class="status ${line.cls}">${line.text}</div>
    <div class="row">
      <button id="sync" class="primary">Sync now</button>
      <a href="${settings.apiUrl}" target="_blank">Open dashboard</a>
    </div>
    <p class="muted" style="margin-top:12px">Syncs every 30 min while Chrome is open. Keeping a Canvas tab open makes it most reliable.</p>
    <p><button id="unpair" class="link">Unpair this browser</button></p>`;
  const btn = el.querySelector<HTMLButtonElement>('#sync')!;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    await send({ type: 'sync' });
    await render();
  });
  el.querySelector('#unpair')!.addEventListener('click', async () => {
    await send({ type: 'unpair' });
    await render();
  });
  return el;
}

function describe(s: SyncStatus, settings: Settings): { cls: string; text: string } {
  const ago = (iso: string) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
  };
  switch (s.state) {
    case 'unpaired':
      return { cls: 'warn', text: 'Not paired.' };
    case 'syncing':
      return { cls: '', text: 'Syncing…' };
    case 'ok':
      return { cls: 'ok', text: `✓ Synced ${s.count} items ${ago(s.at)}.` };
    case 'canvas_logged_out':
      return { cls: 'warn', text: `Not logged in to Canvas. <a href="${settings.canvasBaseUrl}" target="_blank">Open Canvas</a>, sign in, then sync again.` };
    case 'error':
      return { cls: 'err', text: `Sync failed ${ago(s.at)}: ${escapeHtml(s.message)}` };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

void render();
