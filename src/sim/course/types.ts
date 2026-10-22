/**
 * Course model (schema "squib-course/1"). Courses are data: built-in practice courses, user courses from the
 * editor, and club courses entered from official documents all use this format (docs/COURSES.md).
 *
 * Status:
 *  - simulated:     invented for practice (generated or drawn in the editor). Never presented as a club course.
 *  - pending-check: entered from a named club document; awaiting a check against that document.
 *  - verified:      checked against the named document by a named person on a stated date.
 */
export const COURSE_SCHEMA = 'squib-course/1';

export type CourseStatus = 'simulated' | 'pending-check' | 'verified';
export type Rounding = 'port' | 'starboard';

export type MarkPosition = { lat: number; lon: number } | { n: number; e: number };

export interface CourseMark {
  id: string;
  name: string;
  kind: 'inflatable' | 'nav-buoy' | 'committee-boat' | 'pin' | 'fixed' | 'virtual';
  position: MarkPosition;
  /** Where the position came from (document, chart, "generated"…). */
  source?: string;
}

export type CourseLeg =
  /** Round (or pass) the mark leaving it on the given side. */
  | { type: 'mark'; mark: string; rounding: Rounding }
  /** Sail between the two marks from the direction of the previous mark. */
  | { type: 'gate'; marks: [string, string] };

/** A line between two marks (start, finish, or a boundary). */
export interface CourseLine {
  ends: [string, string];
}

export interface CourseProvenance {
  kind: 'simulated' | 'user' | 'club-document';
  /** For club courses: the document title, edition and date (e.g. "RDYC Sailing Instructions 2026, Appendix B"). */
  document?: string;
  /** Section, page or course letter within the document. */
  reference?: string;
  enteredBy?: string;
  enteredOn?: string;
  checkedBy?: string;
  checkedOn?: string;
  /** Free text: generator parameters, assumptions, outstanding questions. */
  notes?: string;
}

export interface Course {
  schema: typeof COURSE_SCHEMA;
  id: string;
  name: string;
  description?: string;
  status: CourseStatus;
  provenance: CourseProvenance;
  marks: CourseMark[];
  start: CourseLine;
  /** One lap. */
  legs: CourseLeg[];
  laps: number;
  finish: CourseLine;
  /** Lines that must not be crossed (e.g. the sides of a tacking lane). */
  boundaries?: (CourseLine & { label?: string })[];
  /** The wind the course was designed for (deg true, FROM), when generated relative to the wind. */
  designWindFromDeg?: number;
}

export interface LocalPoint {
  n: number;
  e: number;
}
