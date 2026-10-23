/// <reference types="vite/client" />
import { parseCourse } from '../sim/course/course';
import { practiceCourse, PRACTICE_KINDS, type PracticeKind } from '../sim/course/practice';
import type { Course } from '../sim/course/types';

/**
 * Where courses come from:
 *  - practice: generated relative to the wind at the start position (status simulated);
 *  - simulated: fixed practice courses shipped with the app (data/courses/simulated);
 *  - club: courses entered from official RDYC documents (data/courses/club): none yet;
 *  - user: courses drawn or imported in the editor, kept in this browser only.
 */
export type CourseChoice =
  | { source: 'practice'; kind: PracticeKind; legM?: number; laps?: number }
  | { source: 'library'; id: string; laps?: number }
  /** A course carried in the scenario itself (e.g. from the editor when browser storage is unavailable). */
  | { source: 'inline'; course: Course };

const files = import.meta.glob('../../data/courses/{simulated,club}/*.course.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export interface LibraryEntry {
  id: string;
  name: string;
  group: 'simulated' | 'club' | 'user';
  status: Course['status'];
  course: Course;
}

const USER_KEY = 'squib.userCourses.v1';

export function builtInCourses(): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const [path, json] of Object.entries(files)) {
    const { course } = parseCourse(json);
    if (!course) continue;
    out.push({ id: course.id, name: course.name, group: path.includes('/club/') ? 'club' : 'simulated', status: course.status, course });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** User courses saved in this browser (a per-viewer convenience; export to keep or share them). */
export function userCourses(): LibraryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) ?? '[]') as unknown[];
    return raw.flatMap((j) => {
      const { course } = parseCourse(j);
      return course ? [{ id: course.id, name: course.name, group: 'user' as const, status: course.status, course }] : [];
    });
  } catch {
    return [];
  }
}

export function saveUserCourse(course: Course): boolean {
  try {
    const list = userCourses().filter((c) => c.id !== course.id).map((c) => c.course);
    list.push(course);
    localStorage.setItem(USER_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function deleteUserCourse(id: string): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(userCourses().filter((c) => c.id !== id).map((c) => c.course)));
  } catch {
    // storage unavailable: nothing to delete
  }
}

export function allCourses(): LibraryEntry[] {
  return [...builtInCourses(), ...userCourses()];
}

/** Turn a scenario's course choice into a course, laid at `centre` for practice courses (start line `startLineM`). */
export function courseFor(choice: CourseChoice, centre: { n: number; e: number }, windFromDeg: number, startLineM?: number): Course {
  if (choice.source === 'practice') {
    return practiceCourse({ kind: choice.kind, centre, windFromDeg, legM: choice.legM, laps: choice.laps, startLineM });
  }
  if (choice.source === 'inline') return choice.course;
  const entry = allCourses().find((c) => c.id === choice.id);
  if (!entry) throw new Error(`course "${choice.id}" not found`);
  return choice.laps ? { ...entry.course, laps: choice.laps } : entry.course;
}

export { PRACTICE_KINDS };
