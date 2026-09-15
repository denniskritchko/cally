import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Me } from './api';
import { Dashboard } from './Dashboard';

const ERRORS: Record<string, string> = {
  bad_state: 'The sign-in link expired. Try again.',
  bad_email: 'Enter a valid email address.',
  no_id_token: 'Google did not return an identity. Try again.',
  calendar_scope_denied: 'Google Calendar access was not granted. You can still use the feed URL.',
  access_denied: 'Sign-in was cancelled.',
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(() => {
    const e = new URLSearchParams(location.search).get('error');
    if (e) history.replaceState(null, '', '/');
    return e ? (ERRORS[e] ?? `Error: ${e}`) : null;
  });

  const reload = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (me === undefined) return <main className="muted">Loading…</main>;

  return (
    <main>
      <header>
        <h1>
          <span>cally</span> · Canvas → your calendar
        </h1>
        {me && (
          <span className="small muted row">
            {me.user.email}
            <button className="link" onClick={() => api.logout().then(() => setMe(null))}>
              sign out
            </button>
          </span>
        )}
      </header>
      {error && (
        <div className="alert err">
          {error}{' '}
          <button className="link" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {me ? <Dashboard me={me} reload={reload} onError={setError} /> : <Landing />}
      <footer className="small muted">
        Read-only: cally never writes to Canvas and never sees your personal calendars.
      </footer>
    </main>
  );
}

function Landing() {
  const [health, setHealth] = useState<{ google: boolean; dev: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ google: false, dev: false }));
  }, []);

  return (
    <div className="hero">
      <h1>Your SFU due dates, in the calendar you actually look at.</h1>
      <p>
        cally pulls assignments, quizzes and events from Canvas and publishes them to Apple Calendar, Google Calendar,
        Notion Calendar — anything that can subscribe to a calendar.
      </p>
      {health?.google !== false ? (
        <>
          <a className="btn primary" href="/api/auth/google">
            Sign in with Google
          </a>
          <p className="small" style={{ marginTop: 20 }}>
            Sign-in only asks for your email. Calendar access is a separate, optional step.
          </p>
        </>
      ) : health.dev ? (
        <form method="post" action="/api/auth/dev" className="row" style={{ justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
          <input type="text" name="email" placeholder="you@sfu.ca" defaultValue="" style={{ flex: 1 }} required />
          <button className="primary" type="submit">
            Dev sign-in
          </button>
          <p className="small muted" style={{ width: '100%', margin: '10px 0 0' }}>
            Google OAuth isn't configured, so this is a local-only sign-in. Set <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code> in{' '}
            <code>.env</code> for the real thing (steps in the README).
          </p>
        </form>
      ) : (
        <p className="small muted">Sign-in isn't available: this server has no Google OAuth credentials configured.</p>
      )}
    </div>
  );
}
