import type { CanvasPlannerItem } from '../src/canvas/types.js';

export const plannerItems: CanvasPlannerItem[] = [
  {
    context_type: 'Course',
    course_id: 91234,
    context_name: 'CMPT 225 D100',
    plannable_id: 555,
    plannable_type: 'assignment',
    plannable_date: '2026-09-20T06:59:00Z',
    plannable: { id: 555, title: 'Assignment 2: Linked Lists', due_at: '2026-09-20T06:59:00Z', points_possible: 100, updated_at: '2026-09-01T12:00:00Z' },
    html_url: '/courses/91234/assignments/555',
    submissions: { submitted: false, graded: false },
    planner_override: null,
  },
  {
    context_type: 'Course',
    course_id: 91234,
    context_name: 'CMPT 225 D100',
    plannable_id: 777,
    plannable_type: 'quiz',
    plannable_date: '2026-09-25T06:59:00Z',
    plannable: { id: 777, title: 'Quiz 1', due_at: '2026-09-25T06:59:00Z', points_possible: 10 },
    html_url: '/courses/91234/quizzes/777',
    submissions: { submitted: true, graded: true },
    planner_override: null,
  },
  {
    context_type: 'Course',
    course_id: 55555,
    context_name: 'MATH 232 D200',
    plannable_id: 42,
    plannable_type: 'calendar_event',
    plannable_date: '2026-10-01T17:30:00Z',
    plannable: { id: 42, title: 'Midterm', start_at: '2026-10-01T17:30:00Z', end_at: '2026-10-01T19:20:00Z', all_day: false, location_name: 'AQ 3150' },
    html_url: '/calendar?event_id=42&include_contexts=course_55555',
    submissions: false,
    planner_override: null,
  },
  {
    context_type: 'Course',
    course_id: 55555,
    context_name: 'MATH 232 D200',
    plannable_id: 9,
    plannable_type: 'announcement',
    plannable_date: '2026-09-15T00:00:00Z',
    plannable: { id: 9, title: 'Welcome!' },
    html_url: '/courses/55555/discussion_topics/9',
    submissions: false,
    planner_override: null,
  },
  {
    context_type: 'User',
    course_id: null,
    context_name: null,
    plannable_id: 3,
    plannable_type: 'planner_note',
    plannable_date: '2026-09-18T20:00:00Z',
    plannable: { id: 3, title: 'Book study room', todo_date: '2026-09-18T20:00:00Z', details: '<p>Level 3 &amp; 4</p>' },
    html_url: null,
    submissions: false,
    planner_override: { marked_complete: true, dismissed: false },
  },
];

export const canvasFeed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Instructure//Canvas//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Canvas Calendar
BEGIN:VEVENT
DTSTAMP:20260901T120000Z
UID:event-assignment-555@canvas.sfu.ca
DTSTART;VALUE=DATE:20260919
CLASS:PUBLIC
DESCRIPTION:Implement a doubly linked list.
SEQUENCE:0
SUMMARY:Assignment 2: Linked Lists [CMPT 225 D100]
URL:https://canvas.sfu.ca/courses/91234/assignments/555
X-ALT-DESC;FMT-TYPE=text/html:<p>Implement a doubly linked list.</p>
END:VEVENT
BEGIN:VEVENT
DTSTAMP:20260901T120000Z
UID:event-calendar-event-42@canvas.sfu.ca
DTSTART:20261001T173000Z
DTEND:20261001T192000Z
CLASS:PUBLIC
LAST-MODIFIED:20260902T080000Z
SEQUENCE:0
SUMMARY:Midterm [MATH 232 D200]
URL:https://canvas.sfu.ca/calendar?event_id=42&include_contexts=course_55555
END:VEVENT
END:VCALENDAR
`.replace(/\n/g, '\r\n');
