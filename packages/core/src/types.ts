/**
 * The one shape everything speaks. Sources produce it, sinks consume it,
 * the feed endpoint renders it. Keep it boring.
 */
export type EventKind =
  | 'assignment'
  | 'quiz'
  | 'discussion'
  | 'event'
  | 'note'
  | 'other';

export interface NormalizedEvent {
  /** Deterministic, globally unique. See `eventUid()`. */
  uid: string;
  source: 'canvas';
  /** Stable within the source, e.g. "assignment:12345". */
  externalId: string;
  kind: EventKind;
  title: string;
  description?: string;
  courseId?: string;
  /** Short course label, e.g. "CMPT 225 D100". */
  courseName?: string;
  url?: string;
  /** ISO 8601, UTC. For all-day events, the date at 00:00Z. */
  start: string;
  /** ISO 8601, UTC. Exclusive for all-day. Omit for zero-duration. */
  end?: string;
  allDay: boolean;
  /** Whether the student has submitted / marked complete. Cosmetic only. */
  completed?: boolean;
  /** ISO 8601, UTC. When the upstream object last changed, if known. */
  updatedAt?: string;
}

/** Inclusive-ish time window a source was asked to cover. */
export interface SyncWindow {
  start: string;
  end: string;
}

export interface PullResult {
  events: NormalizedEvent[];
  /** The window the snapshot is authoritative for. Events inside it that are
   *  absent from `events` should be treated as deleted upstream. */
  window: SyncWindow;
}

export interface CalendarSource {
  pull(window: SyncWindow): Promise<PullResult>;
}

export interface CalendarSink {
  upsert(events: NormalizedEvent[]): Promise<void>;
  remove(uids: string[]): Promise<void>;
}
