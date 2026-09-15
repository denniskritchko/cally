# Architecture

## The problem is smaller than it looks

"Merge Canvas, Apple, Google and Notion calendars" decomposes to:

- **Notion Calendar has no API.** It renders Google and iCloud accounts. Writing to Google covers it.
- **Apple Calendar has no cloud API.** CalDAV against iCloud means holding app-specific passwords — a liability with no upside when every Apple device subscribes to `webcal://` natively.
- **Canvas is a source, never a sink.** Nobody writes events into Canvas.

So: one source (Canvas), one materialized feed, one optional write integration (Google). No bidirectional sync, no conflict resolution.

## Why not extension-only

An MV3 service worker is killed after ~30 s idle and `chrome.alarms` doesn't fire with the browser closed. A sync that only runs when a laptop has Chrome open is wrong at 8 am on a phone. Storing Google refresh tokens in `chrome.storage` is plaintext on disk. And extensions don't exist on iOS, where students actually check due dates.

The extension is kept for the one thing only it can do: **read Canvas with the user's existing session**, so nobody needs an access token, a feed URL, or an SFU-issued developer key. It scrapes, posts, and holds nothing sensitive.

## Data flow

```
                 pull (token/feed, cron)            push (diff vs sink_state)
 Canvas API ──┐                                                     ┌──▶ Google Calendar
 Canvas ICS ──┼──▶ normalize ──▶ applySnapshot ──▶ events table ──┤
 extension ───┘   (@cally/core)   (tombstones)                      └──▶ GET /f/<token>.ics
```

- **`NormalizedEvent`** is the only shape that crosses package boundaries. `packages/core` has no I/O dependencies, so the extension bundles the Canvas client from it and the server bundles everything.
- **Deterministic UIDs**: `cally-<fnv1a64(source:host:externalId)>@cally`. The same Canvas assignment always maps to the same UID *and* the same Google event id (a base32hex derivation of the UID), so every write downstream is idempotent even if `sink_state` is lost. Switching a user from the ICS feed to the API keeps assignment/calendar-event UIDs stable because both paths recover the same `externalId`.
- **`applySnapshot`** treats each pull as authoritative for its time window: upsert what arrived (only rows whose `content_hash` changed), tombstone what's inside the window but missing. Events outside the window are untouched, so history is retained.
- **`sink_state`** records what each sink last saw (`synced_hash`). The Google push is `events ⋈ sink_state`: rows with a different hash are upserted, tombstones with a state row are deleted. If the diff is empty, Google isn't contacted at all. Tombstones are purged once no sink references them.
- **The feed** is a view over live rows. `ETag` is derived from `uid:content_hash` pairs so clients that send `If-None-Match` get a 304.

## Auth

- **Users** sign in with Google (`openid email profile`). Calendar access is a separate incremental-consent step requesting only `calendar.app.created`: cally can create secondary calendars and edit events on those; it cannot list, read or modify anything else in the account.
- **Sessions** are opaque random ids in Postgres, `HttpOnly; SameSite=Lax` cookie.
- **Extension devices** pair with a 6-char one-shot code minted by the logged-in dashboard, exchanged for a long-lived token that's stored hashed. The token authorizes exactly two endpoints (`/status`, `/ingest`), both scoped to that user.
- **Secrets at rest** (Canvas token, feed URL, Google refresh token) are AES-256-GCM under `ENCRYPTION_KEY`.

## Jobs

`pg-boss` on the same Postgres. `sync-all` runs on `SYNC_CRON` and fans out one `sync-user` per user who has a server-side Canvas connection or a Google connection. `sync-user` is singleton-keyed on the user id so bursts collapse. An extension ingest enqueues `sync-user` directly, so Google gets the update within seconds of the push rather than at the next tick.

## Choices considered and rejected

- **Cloudflare Workers + Durable Objects.** A DO per user is a lovely fit for a per-user sync loop, and cheaper at scale. Rejected for v1: the calendar library ecosystem is Node-shaped, sync jobs are bursty, and one Node process + Postgres is the fastest thing to ship and debug. Revisit if per-user cost ever matters.
- **Canvas OAuth2.** Needs a developer key issued by an SFU Canvas admin. That's a relationship, not code. The extension gives us session auth without it. If a key ever materializes it's one more `canvas_connections.kind`.
- **iCloud CalDAV.** Never. Subscription is the correct permanent answer for Apple.
- **Notion database sink.** Dropped — Notion Calendar is covered by Google, and a Notion DB of assignments is a different product.
- **Full `calendar` scope.** `calendar.app.created` is strictly less privilege, matches the product exactly (an overlay calendar, not mutating the user's life), and is a lighter Google verification.

## Known limits / next

- Google refreshes *subscribed* ICS feeds every 12–24 h and doesn't expose a knob. That's why the direct Google integration exists.
- Due dates render as a 30-minute block ending at the due time (`DUE_BLOCK_MINUTES` in `core/time.ts`). Making this a per-user setting is a small change.
- The extension syncs from a Canvas tab when one is open (same-origin, cookies guaranteed) and from the worker otherwise. If SFU's SSO ever sets cookies the worker path can't send, the popup says so and asks the user to open Canvas.
- Firefox needs a `launchWebAuthFlow`-free build (we don't use `chrome.identity`, so this is mostly manifest work) and a separate store listing.
