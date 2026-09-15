import type { EventKind, NormalizedEvent } from '../types.js';
import { eventUid } from '../uid.js';
import { addDays, dueBlock } from '../time.js';
import type { CanvasPlannerItem } from './types.js';

const KIND_BY_PLANNABLE: Record<string, EventKind> = {
  assignment: 'assignment',
  quiz: 'quiz',
  discussion_topic: 'discussion',
  calendar_event: 'event',
  planner_note: 'note',
  wiki_page: 'other',
  assessment_request: 'other',
};

/** Planner item types that never belong on a calendar. */
const SKIP = new Set(['announcement']);

export interface NormalizeOptions {
  /** e.g. "canvas.sfu.ca" — part of the UID so two Canvas instances never collide. */
  host: string;
  /** Turns Canvas' relative html_url into an absolute link. */
  absoluteUrl: (p: string | null | undefined) => string | undefined;
}

/** Strip the section suffix Canvas appends: "CMPT 225 D100" -> "CMPT 225". */
export function shortCourseName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const m = name.match(/^([A-Z]{2,5}\s?\d{3}[A-Z]?)\b/);
  return m ? m[1]!.replace(/\s+/, ' ') : name;
}

export function normalizePlannerItem(item: CanvasPlannerItem, opts: NormalizeOptions): NormalizedEvent | null {
  if (SKIP.has(item.plannable_type)) return null;
  const p = item.plannable ?? ({} as CanvasPlannerItem['plannable']);
  const kind = KIND_BY_PLANNABLE[item.plannable_type] ?? 'other';

  let start: string;
  let end: string | undefined;
  let allDay = false;

  if (item.plannable_type === 'calendar_event' && p.start_at) {
    if (p.all_day) {
      allDay = true;
      start = new Date(p.start_at).toISOString().slice(0, 10) + 'T00:00:00.000Z';
      end = addDays(start, 1);
    } else {
      start = new Date(p.start_at).toISOString();
      end = p.end_at ? new Date(p.end_at).toISOString() : undefined;
    }
  } else {
    const due = p.due_at ?? p.todo_date ?? item.plannable_date;
    if (!due) return null;
    ({ start, end } = dueBlock(new Date(due).toISOString()));
  }

  const course = shortCourseName(item.context_name);
  const baseTitle = (p.title ?? 'Untitled').trim();
  const submitted = item.submissions && typeof item.submissions === 'object' ? !!item.submissions.submitted : false;
  const completed = submitted || !!item.planner_override?.marked_complete;

  const externalId = `${item.plannable_type}:${item.plannable_id}`;
  const descParts: string[] = [];
  if (item.context_name) descParts.push(item.context_name);
  if (typeof p.points_possible === 'number') descParts.push(`${p.points_possible} pts`);
  if (p.location_name) descParts.push(`Location: ${p.location_name}`);
  if (typeof p.details === 'string' && p.details) descParts.push(stripHtml(p.details).slice(0, 500));

  return {
    uid: eventUid('canvas', externalId, opts.host),
    source: 'canvas',
    externalId,
    kind,
    title: course ? `${course}: ${baseTitle}` : baseTitle,
    description: descParts.join('\n') || undefined,
    courseId: item.course_id != null ? String(item.course_id) : undefined,
    courseName: course,
    url: opts.absoluteUrl(item.html_url),
    start,
    end,
    allDay,
    completed,
    updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : undefined,
  };
}

export function normalizePlannerItems(items: CanvasPlannerItem[], opts: NormalizeOptions): NormalizedEvent[] {
  const byUid = new Map<string, NormalizedEvent>();
  for (const item of items) {
    const ev = normalizePlannerItem(item, opts);
    if (ev) byUid.set(ev.uid, ev);
  }
  return [...byUid.values()];
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
