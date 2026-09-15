import type { CalendarSource, PullResult, SyncWindow } from '../types.js';
import { parseCanvasFeed } from '../ics/parse.js';
import type { FetchLike } from './client.js';

/**
 * Pulls the per-user ICS "Calendar Feed" Canvas exposes on its calendar page.
 * Lower fidelity than the API (assignments are all-day, no submission state),
 * but needs no token and no extension.
 */
export class CanvasFeedSource implements CalendarSource {
  constructor(
    private readonly feedUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async pull(window: SyncWindow): Promise<PullResult> {
    const url = this.feedUrl.replace(/^webcal:/i, 'https:');
    const res = await this.fetchImpl(url, { headers: { Accept: 'text/calendar' } });
    if (!res.ok) throw new Error(`Canvas feed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const ics = await res.text();
    const host = new URL(url).host;
    const events = parseCanvasFeed(ics, { host }).filter((e) => e.start >= window.start && e.start <= window.end);
    return { events, window };
  }
}
