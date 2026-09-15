# cally

Your SFU Canvas due dates, in the calendar you actually look at.

cally pulls assignments, quizzes, discussions and events from **canvas.sfu.ca** and publishes them to Apple Calendar, Google Calendar and Notion Calendar. Canvas is read-only upstream; nothing ever writes back.

```
                     ┌──────────────┐    webcal://…/f/<token>.ics    ┌─ Apple Calendar (Mac/iPhone)
 canvas.sfu.ca ────▶ │  cally API   │ ─────────────────────────────▶ ├─ Google Calendar (subscribed)
   extension /       │  + Postgres  │                                └─ Notion Calendar, Outlook, …
   token / feed      │              │    Calendar API (app-owned cal)
                     └──────────────┘ ─────────────────────────────▶ Google Calendar (direct, ~instant)
```

## How Canvas data gets in

| Method | Needs | Fidelity | Runs |
|---|---|---|---|
| **Browser extension** (recommended) | Being logged in to Canvas in Chrome | Full: due *times*, submission status, course names | Every 30 min while Chrome is open, or on click |
| Personal access token | Canvas → Account → Settings → *New Access Token* (if SFU allows it) | Full | Server-side every 15 min |
| Calendar feed URL | Canvas → Calendar → *Calendar Feed* | Low: due dates become all-day events, no status | Server-side every 15 min |

None of these need anything from SFU IT. A Canvas OAuth2 integration would, and is deliberately not built.

## How it gets out

1. **Merged ICS feed** — `webcal://<app>/f/<secret>.ics`. Subscribe from anything. Apple refreshes as often as you tell it to (set 5 min); Google refreshes subscribed feeds only every ~12–24 h.
2. **Google Calendar direct** — optional. cally creates a dedicated *Canvas (SFU)* calendar in your Google account and writes to it within a minute of each sync. Uses the `calendar.app.created` scope, which cannot see or touch your other calendars. Notion Calendar renders Google calendars, so this covers it too.

## Repo layout

```
packages/core      normalized event model, Canvas client + normalizer, ICS parse/generate, Google sink  (no I/O deps, browser-safe)
apps/api           Hono + Postgres (Drizzle) + pg-boss. Auth, connections, sync engine, feed endpoint, extension ingest
apps/web           React dashboard, served by the API in production
apps/extension     Manifest V3 extension: reads the Canvas planner with your session, posts raw items to the API
docs/ARCHITECTURE.md   why it's shaped this way
```

## Run it locally

Requirements: Node ≥ 22, pnpm 10 (`corepack enable`), Postgres (`docker compose up -d` if you don't have one).

```sh
pnpm install
cp .env.example .env
# set ENCRYPTION_KEY:  openssl rand -hex 32
# set DATABASE_URL if not postgres://localhost:5432/cally
pnpm db:push                 # create tables
pnpm dev                     # API on :3000, dashboard on :5173 (proxies /api)
```

Google sign-in needs OAuth credentials (see below). Without them, mint a local session and try the whole extension flow anyway:

```sh
pnpm --filter @cally/api dev:session you@sfu.ca   # prints a cookie to paste into devtools
```

### Google OAuth setup

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → create a project → enable **Google Calendar API**.
2. OAuth consent screen: External. Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.app.created`.
3. Credentials → OAuth client → **Web application** → authorized redirect URI `http://localhost:3000/api/auth/google/callback` (and the production one).
4. Put the client id/secret in `.env`.

While the consent screen is in *Testing*, only listed test users (max 100) can sign in — plenty for friends. Publishing requires Google's verification (privacy policy, domain, demo video). `calendar.app.created` is a non-sensitive scope, which makes that review lighter than it would be with full calendar access.

### Extension

```sh
pnpm --filter @cally/extension build        # → apps/extension/dist  (API defaults to http://localhost:3000)
CALLY_API_URL=https://cally.fly.dev pnpm --filter @cally/extension build   # production build
```

chrome://extensions → Developer mode → *Load unpacked* → `apps/extension/dist`. Sign in on the dashboard → **Get pairing code** → enter it in the popup. Pairing gives the extension an ingest-only device token for cally; it never sees or stores Canvas credentials — it just makes same-origin requests with the Canvas session you already have. Revoke from the dashboard any time.

## Deploy

One container, one Postgres. `Dockerfile` + `fly.toml` are included:

```sh
fly launch --no-deploy
fly postgres create && fly postgres attach        # or Neon/Supabase: set DATABASE_URL
fly secrets set ENCRYPTION_KEY=$(openssl rand -hex 32) GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…
pnpm db:push                                      # against the prod DATABASE_URL, once per schema change
fly deploy
```

Set `APP_URL` in `fly.toml` to your real host — it's baked into the feed URL and OAuth redirect. Keep `min_machines_running = 1`: the sync scheduler runs inside the API process.

## Scripts

```
pnpm typecheck   pnpm test   pnpm build   pnpm db:push   pnpm db:studio
```

## Security notes

- Canvas tokens, feed URLs and Google refresh tokens are AES-256-GCM encrypted at rest with `ENCRYPTION_KEY`.
- The feed URL is a bearer secret. It can be rotated from the dashboard.
- Extension device tokens are stored hashed; the extension holds only its own token, never Canvas credentials.
- No iCloud credentials, ever. Apple Calendar is served purely by subscription.

## License

MIT
