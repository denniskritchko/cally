import type { CanvasCourse, CanvasPlannerItem, CanvasUser } from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CanvasClientOptions {
  baseUrl: string;
  /** Supply a fetch that carries auth: bearer header (server) or cookies (extension). */
  fetch: FetchLike;
}

export class CanvasHttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`Canvas ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

/** Build a fetch that authenticates with a personal access token. */
export function bearerFetch(token: string, base: FetchLike = fetch): FetchLike {
  return (input, init = {}) =>
    base(input, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
}

/** Build a fetch that rides the browser's existing Canvas session (extension use). */
export function sessionFetch(base: FetchLike = fetch): FetchLike {
  return (input, init = {}) =>
    base(input, {
      ...init,
      credentials: 'include',
      headers: { ...(init.headers ?? {}), Accept: 'application/json' },
    });
}

/**
 * Minimal Canvas REST client: pagination via Link headers, the `while(1);`
 * anti-hijack prefix Canvas adds on session-authenticated responses, and
 * nothing else.
 */
export class CanvasClient {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(opts: CanvasClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch;
  }

  get host(): string {
    return new URL(this.baseUrl).host;
  }

  absoluteUrl(pathOrUrl: string | null | undefined): string | undefined {
    if (!pathOrUrl) return undefined;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  async getJson<T>(url: string): Promise<{ data: T; next?: string }> {
    const res = await this.fetch(url);
    const text = await res.text();
    if (!res.ok) throw new CanvasHttpError(res.status, url, text);
    const body = text.startsWith('while(1);') ? text.slice('while(1);'.length) : text;
    return { data: JSON.parse(body) as T, next: parseNextLink(res.headers.get('link')) };
  }

  async getAll<T>(path: string, params: Record<string, string | string[]> = {}): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
    if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '100');

    const out: T[] = [];
    let next: string | undefined = url.toString();
    let guard = 0;
    while (next && guard++ < 50) {
      const page: { data: T[]; next?: string } = await this.getJson<T[]>(next);
      out.push(...page.data);
      next = page.next;
    }
    return out;
  }

  self(): Promise<CanvasUser> {
    return this.getJson<CanvasUser>(`${this.baseUrl}/api/v1/users/self`).then((r) => r.data);
  }

  activeCourses(): Promise<CanvasCourse[]> {
    return this.getAll<CanvasCourse>('/courses', { enrollment_state: 'active' });
  }

  /** Everything on the student's to-do timeline in [start, end]. */
  plannerItems(start: string, end: string): Promise<CanvasPlannerItem[]> {
    return this.getAll<CanvasPlannerItem>('/planner/items', { start_date: start, end_date: end });
  }
}

export function parseNextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return undefined;
}
