/** Minutes before the due time that a due-date block starts. */
export const DUE_BLOCK_MINUTES = 30;

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

/** "2026-09-20T06:59:00.000Z" -> "20260920T065900Z" */
export function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** "2026-09-20T00:00:00.000Z" -> "20260920" */
export function toIcsDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Build a due-date block ending at `dueIso`. */
export function dueBlock(dueIso: string): { start: string; end: string } {
  return { start: addMinutes(dueIso, -DUE_BLOCK_MINUTES), end: dueIso };
}

/** Default pull window: two weeks back, six months forward. */
export function defaultWindow(now = new Date()): { start: string; end: string } {
  const iso = now.toISOString();
  return { start: addDays(iso, -14), end: addDays(iso, 180) };
}
