/** Subset of Canvas' planner item shape that we rely on.
 *  https://canvas.instructure.com/doc/api/planner.html */
export interface CanvasPlannerItem {
  context_type?: 'Course' | 'Group' | 'User' | string;
  course_id?: number | null;
  context_name?: string | null;
  plannable_id: number;
  plannable_type: string;
  plannable_date: string;
  plannable: {
    id: number;
    title?: string;
    details?: string | null;
    due_at?: string | null;
    todo_date?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    all_day?: boolean;
    location_name?: string | null;
    points_possible?: number | null;
    updated_at?: string | null;
    [k: string]: unknown;
  };
  html_url?: string | null;
  submissions?:
    | false
    | {
        submitted?: boolean;
        excused?: boolean;
        graded?: boolean;
        missing?: boolean;
        [k: string]: unknown;
      };
  planner_override?: {
    marked_complete?: boolean;
    dismissed?: boolean;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
  [k: string]: unknown;
}

export interface CanvasUser {
  id: number;
  name: string;
  [k: string]: unknown;
}
