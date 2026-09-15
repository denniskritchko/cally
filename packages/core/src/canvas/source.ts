import type { CalendarSource, PullResult, SyncWindow } from '../types.js';
import { CanvasClient } from './client.js';
import { normalizePlannerItems } from './normalize.js';

/** Pulls the planner timeline via the Canvas REST API (token or session auth). */
export class CanvasApiSource implements CalendarSource {
  constructor(private readonly client: CanvasClient) {}

  async pull(window: SyncWindow): Promise<PullResult> {
    const items = await this.client.plannerItems(window.start, window.end);
    const events = normalizePlannerItems(items, {
      host: this.client.host,
      absoluteUrl: (p) => this.client.absoluteUrl(p),
    });
    return { events, window };
  }
}
