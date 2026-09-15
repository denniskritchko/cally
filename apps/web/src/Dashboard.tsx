import { useEffect, useState } from 'react';
import { api, type Me } from './api';

interface Props {
  me: Me;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}

export function Dashboard({ me, reload, onError }: Props) {
  // Poll while something is pending so the user sees the first sync land.
  useEffect(() => {
    const id = setInterval(reload, 8000);
    return () => clearInterval(id);
  }, [reload]);

  const run = (fn: () => Promise<unknown>) => () => fn().then(reload).catch((e) => onError(e.message));

  return (
    <>
      <CanvasCard me={me} reload={reload} onError={onError} />
      <FeedCard me={me} reload={reload} onError={onError} />
      <GoogleCard me={me} run={run} />
      <UpcomingCard me={me} run={run} />
      <DangerCard run={run} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function CanvasCard({ me, reload, onError }: Props) {
  const c = me.canvas;
  const [tab, setTab] = useState<'extension' | 'token' | 'feed'>(c?.kind ?? 'extension');

  return (
    <section className="card">
      <h2>
        <span className="step">1</span> Canvas
        {c ? (
          c.lastError ? <span className="badge err">error</span> : <span className="badge ok">connected · {c.kind}</span>
        ) : (
          <span className="badge off">not connected</span>
        )}
      </h2>
      {c && (
        <p className="small muted">
          {c.canvasUserName && <>Signed in to Canvas as <b>{c.canvasUserName}</b>. </>}
          Last sync: <Ago iso={c.lastSyncedAt} /> · {me.eventCount} events.{' '}
          <button className="link" onClick={() => api.disconnectCanvas().then(reload).catch((e) => onError(e.message))}>
            disconnect
          </button>
        </p>
      )}
      {c?.lastError && <div className="alert err small">{c.lastError}</div>}

      <div className="tabs">
        <button className={tab === 'extension' ? 'active' : ''} onClick={() => setTab('extension')}>
          Browser extension
        </button>
        <button className={tab === 'token' ? 'active' : ''} onClick={() => setTab('token')}>
          Access token
        </button>
        <button className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>
          Calendar feed URL
        </button>
      </div>

      {tab === 'extension' && <ExtensionPanel me={me} reload={reload} onError={onError} />}
      {tab === 'token' && <TokenPanel me={me} reload={reload} onError={onError} />}
      {tab === 'feed' && <FeedUrlPanel me={me} reload={reload} onError={onError} />}
    </section>
  );
}

function ExtensionPanel({ me, reload, onError }: Props) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const devices = me.extension.devices;

  const start = () =>
    api
      .pairStart()
      .then((r) => setCode({ code: r.code, expiresAt: Date.now() + r.expiresInSeconds * 1000 }))
      .catch((e) => onError(e.message));

  // Pairing is done when a device shows up.
  useEffect(() => {
    if (code && devices.length) setCode(null);
  }, [devices.length, code]);

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Recommended. The extension reads your Canvas to-do list using the session you're already logged into at{' '}
        <code>{new URL(me.canvasBaseUrl).host}</code> — no tokens, nothing to paste. It syncs every 30 minutes while Chrome is open.
      </p>
      <ol className="steps small">
        <li>
          Load the extension from <code>apps/extension/dist</code> (chrome://extensions → Developer mode → Load unpacked).
        </li>
        <li>Make sure you're logged in to Canvas in this browser.</li>
        <li>Click the cally icon, and enter the pairing code below.</li>
      </ol>
      {code ? (
        <div>
          <div className="pair-code">{code.code}</div>
          <div className="small muted">
            Expires in <Countdown until={code.expiresAt} />. Waiting for the extension…
          </div>
        </div>
      ) : (
        <div>
          <button className="primary" onClick={start}>
            {devices.length ? 'Pair another browser' : 'Get pairing code'}
          </button>
        </div>
      )}
      {devices.length > 0 && (
        <ul className="events small">
          {devices.map((d) => (
            <li key={d.id} style={{ gridTemplateColumns: '1fr auto' }}>
              <span>
                <b>{d.label ?? 'Extension'}</b> · last push <Ago iso={d.lastPushAt} />
                {d.lastPushCount != null && <> ({d.lastPushCount} items)</>}
              </span>
              <button className="link" onClick={() => api.removeDevice(d.id).then(reload).catch((e) => onError(e.message))}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TokenPanel({ me, reload, onError }: Props) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.connectToken(token.trim());
      setToken('');
      await reload();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Works without the extension and syncs server-side every 15 minutes. In Canvas go to{' '}
        <a href={`${me.canvasBaseUrl}/profile/settings`} target="_blank" rel="noreferrer">
          Account → Settings
        </a>
        , scroll to <b>Approved Integrations</b>, click <b>New Access Token</b>. If that button is missing, SFU has disabled tokens — use the
        extension.
      </p>
      <div className="row">
        <input type="password" placeholder="Paste access token" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy || token.length < 20} onClick={submit}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

function FeedUrlPanel({ me, reload, onError }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.connectFeed(url.trim());
      setUrl('');
      await reload();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Lowest fidelity (due dates become all-day events, no submission status) but needs nothing but a URL. In Canvas open{' '}
        <a href={`${me.canvasBaseUrl}/calendar`} target="_blank" rel="noreferrer">
          Calendar
        </a>
        , click <b>Calendar Feed</b> at the bottom right, copy the URL.
      </p>
      <div className="row">
        <input type="url" placeholder="https://canvas.sfu.ca/feeds/calendars/user_….ics" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !url.includes('/feeds/')} onClick={submit}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FeedCard({ me, reload, onError }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(me.feed.webcal).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <section className="card">
      <h2>
        <span className="step">2</span> Subscribe from any calendar
      </h2>
      <p className="small muted">
        This URL is a live calendar of everything cally has pulled from Canvas. Anyone with the URL can read it — treat it like a password.
      </p>
      <div className="row">
        <span className="code block" style={{ flex: 1 }}>
          {me.feed.webcal}
        </span>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="row small" style={{ marginTop: 10 }}>
        <a className="btn" href={me.feed.webcal}>
          Open in Apple Calendar
        </a>
        <a className="btn" href={`https://calendar.google.com/calendar/r/settings/addbyurl?cid=${encodeURIComponent(me.feed.https)}`} target="_blank" rel="noreferrer">
          Add to Google Calendar
        </a>
        <button className="link" onClick={() => api.rotateFeed().then(reload).catch((e) => onError(e.message))}>
          rotate URL
        </button>
      </div>
      <details className="small" style={{ marginTop: 12 }}>
        <summary>Setup notes per app</summary>
        <ul>
          <li>
            <b>Apple Calendar (Mac):</b> File → New Calendar Subscription → paste. Set Auto-refresh to <b>every 5 minutes</b> and location to <b>iCloud</b> so it shows on your iPhone too.
          </li>
          <li>
            <b>iPhone:</b> Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.
          </li>
          <li>
            <b>Google Calendar:</b> subscribed URLs refresh only every ~12–24 h and you can't change that. For near-real-time, use step 3 instead.
          </li>
          <li>
            <b>Notion Calendar:</b> shows whatever your connected Google/iCloud accounts show — no separate setup.
          </li>
        </ul>
      </details>
    </section>
  );
}

function GoogleCard({ me, run }: { me: Me; run: (fn: () => Promise<unknown>) => () => void }) {
  const g = me.google;
  return (
    <section className="card">
      <h2>
        <span className="step">3</span> Google Calendar (direct)
        {g.connected ? (
          g.lastError ? <span className="badge err">error</span> : <span className="badge ok">connected</span>
        ) : (
          <span className="badge off">optional</span>
        )}
      </h2>
      <p className="small muted">
        Instead of waiting for Google to poll the feed, cally writes events straight into a dedicated <b>“Canvas (SFU)”</b> calendar in your Google account
        within a minute of every sync. It can only touch that one calendar — never your own events. Notion Calendar picks this up automatically.
      </p>
      {!g.enabled ? (
        <p className="small muted">Google OAuth isn't configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</p>
      ) : g.connected ? (
        <>
          {g.lastError && <div className="alert err small">{g.lastError}</div>}
          <p className="small muted">
            Last push: <Ago iso={g.lastSyncedAt} />
            {g.calendarId && (
              <>
                {' '}
                ·{' '}
                <a href="https://calendar.google.com/" target="_blank" rel="noreferrer">
                  open Google Calendar
                </a>
              </>
            )}
          </p>
          <div className="row">
            {g.lastError && (
              <a className="btn primary" href="/api/auth/google/calendar">
                Reconnect
              </a>
            )}
            <button className="link" onClick={run(api.disconnectGoogle)}>
              disconnect
            </button>
          </div>
        </>
      ) : (
        <a className="btn primary" href="/api/auth/google/calendar">
          Connect Google Calendar
        </a>
      )}
    </section>
  );
}

function UpcomingCard({ me, run }: { me: Me; run: (fn: () => Promise<unknown>) => () => void }) {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: me.user.timezone });
  const fmtDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <section className="card">
      <h2>
        Upcoming
        <button className="small" style={{ marginLeft: 'auto' }} onClick={run(api.syncNow)}>
          Sync now
        </button>
      </h2>
      {me.upcoming.length === 0 ? (
        <p className="muted small">Nothing yet. {me.canvas ? 'Waiting for the first sync…' : 'Connect Canvas above.'}</p>
      ) : (
        <ul className="events">
          {me.upcoming.map((e) => (
            <li key={e.uid}>
              <span className="when">{e.allDay ? fmtDay.format(new Date(e.start)) : fmt.format(new Date(e.end ?? e.start))}</span>
              <span className={e.completed ? 'done' : ''}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
                <span className="muted small"> · {e.kind}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {me.recentRuns.length > 0 && (
        <details className="small" style={{ marginTop: 12 }}>
          <summary>Sync log</summary>
          <table className="runs">
            <tbody>
              {me.recentRuns.map((r, i) => (
                <tr key={i}>
                  <td>
                    <Ago iso={r.startedAt} />
                  </td>
                  <td>{r.stage}</td>
                  <td>{r.ok ? <span className="badge ok">ok</span> : <span className="badge err">failed</span>}</td>
                  <td className="detail">{JSON.stringify(r.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function DangerCard({ run }: { run: (fn: () => Promise<unknown>) => () => void }) {
  return (
    <details className="small muted" style={{ marginTop: 30 }}>
      <summary>Delete my account</summary>
      <p>Removes your connections, stored tokens and every synced event from cally. The Google calendar cally created is left for you to delete.</p>
      <button className="danger" onClick={() => confirm('Delete your cally account?') && run(() => api.deleteAccount().then(() => location.reload()))()}>
        Delete account
      </button>
    </details>
  );
}

/* ------------------------------------------------------------------ */

function Ago({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <>never</>;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const txt = s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
  return <span title={new Date(iso).toLocaleString()}>{txt}</span>;
}

function Countdown({ until }: { until: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((until - Date.now()) / 1000));
  return (
    <>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </>
  );
}
