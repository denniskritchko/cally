import type { NormalizedEvent } from '../types.js';
import { toIcsDate, toIcsUtc } from '../time.js';

export interface GenerateOptions {
  calendarName: string;
  /** Used for PRODID and as a hint to clients. */
  productId?: string;
  /** Suggested refresh interval in minutes (RFC 7986). Apple honours it. */
  refreshMinutes?: number;
  timezone?: string;
}

/** RFC 5545 §3.3.11 text escaping. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1 line folding: max 75 octets per line, continuation with a leading space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

function prop(name: string, value: string | undefined): string[] {
  if (value === undefined || value === '') return [];
  return [foldLine(`${name}:${value}`)];
}

export function eventToVevent(ev: NormalizedEvent, now: string): string[] {
  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(...prop('UID', ev.uid));
  lines.push(...prop('DTSTAMP', toIcsUtc(now)));
  if (ev.allDay) {
    lines.push(...prop('DTSTART;VALUE=DATE', toIcsDate(ev.start)));
    if (ev.end) lines.push(...prop('DTEND;VALUE=DATE', toIcsDate(ev.end)));
  } else {
    lines.push(...prop('DTSTART', toIcsUtc(ev.start)));
    if (ev.end && ev.end > ev.start) lines.push(...prop('DTEND', toIcsUtc(ev.end)));
  }
  const summary = ev.completed ? `✓ ${ev.title}` : ev.title;
  lines.push(...prop('SUMMARY', escapeText(summary)));
  const desc = [ev.description, ev.url].filter(Boolean).join('\n\n');
  lines.push(...prop('DESCRIPTION', desc ? escapeText(desc) : undefined));
  lines.push(...prop('URL', ev.url));
  lines.push(...prop('LAST-MODIFIED', ev.updatedAt ? toIcsUtc(ev.updatedAt) : undefined));
  lines.push(...prop('CATEGORIES', escapeText(ev.kind)));
  lines.push(...prop('X-CALLY-COURSE', ev.courseName ? escapeText(ev.courseName) : undefined));
  lines.push('END:VEVENT');
  return lines;
}

export function generateIcs(events: NormalizedEvent[], opts: GenerateOptions, now = new Date().toISOString()): string {
  const refresh = opts.refreshMinutes ?? 30;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    foldLine(`PRODID:${opts.productId ?? '-//cally//canvas-sync//EN'}`),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeText(opts.calendarName)}`),
    foldLine(`NAME:${escapeText(opts.calendarName)}`),
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}M`,
    `X-PUBLISHED-TTL:PT${refresh}M`,
  ];
  if (opts.timezone) lines.push(foldLine(`X-WR-TIMEZONE:${opts.timezone}`));
  const sorted = [...events].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (const ev of sorted) lines.push(...eventToVevent(ev, now));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
