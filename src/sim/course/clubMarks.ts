import rdyc from '../../../data/marks/rdyc-2026.json' with { type: 'json' };
import { DART_PROJECTION } from '../geo/projection';

/**
 * The Royal Dart Yacht Club's racing marks and the harbour buoys its courses use, as published in the club's
 * Sailing Programme 2026 (Course Appendix 2026, section 7: "Marks and approximate positions (WGS84)"),
 * supplied by the owner on 3 Nov 2026. Lights from the Dart Harbour guide 2019 (DHNA), page 34.
 * Approximate positions; not for navigation. See docs/CLUB_DOCUMENTS.md.
 */
export interface ClubMark {
  /** The letter or number the courses use (H, L, 1 …). */
  id: string;
  name: string;
  kind: string;
  /** As the document describes it ('can', 'cone'), or 'unspecified'. */
  shape: 'can' | 'cone' | 'unspecified';
  colour: 'red' | 'green' | 'yellow' | 'south-cardinal';
  light: string;
  lat: number;
  lon: number;
  /** The position as printed. */
  position: string;
  note?: string;
}

export const CLUB_MARKS_SOURCE = rdyc.source;
export const CLUB_MARKS: readonly ClubMark[] = rdyc.marks as ClubMark[];

/** A navigation or club mark as the River Dart features carry it (public/geo/features.json `marks`). */
export interface FeatureMark {
  name: string;
  kind: string;
  light: string;
  e: number;
  n: number;
  tag: string;
  source: string;
  /** For marks from the club document: their course id, shape and colour. */
  id?: string;
  shape?: ClubMark['shape'];
  colour?: ClubMark['colour'];
}

/**
 * The features' marks with the club's marks added (in local metres), those outside `inDomain` left out.
 * A mark already in the features within 30 m of a club mark of the same name (Castle Ledge) keeps its place
 * and gains the club's id and description. The club marks no longer appear among the marks not placed.
 */
export function withClubMarks<T extends { marks: FeatureMark[]; marksNotPlaced: { name: string }[] }>(f: T, inDomain: (n: number, e: number) => boolean = () => true): T {
  const marks = f.marks.map((m) => ({ ...m }));
  for (const cm of CLUB_MARKS) {
    const p = DART_PROJECTION.toLocal(cm.lat, cm.lon);
    if (!inDomain(p.n, p.e)) continue;
    const same = marks.find((m) => m.name === cm.name && Math.hypot(m.n - p.n, m.e - p.e) < 30);
    const src = `RDYC Sailing Programme 2026, Course Appendix §7 (approximate position ${cm.position})`;
    if (same) {
      Object.assign(same, { id: cm.id, shape: cm.shape, colour: cm.colour, source: `${same.source}; ${src}` });
      continue;
    }
    marks.push({ name: cm.name, kind: cm.kind, light: cm.light, e: p.e, n: p.n, tag: 'S', source: src, id: cm.id, shape: cm.shape, colour: cm.colour });
  }
  const placed = new Set(marks.map((m) => m.name));
  const marksNotPlaced = f.marksNotPlaced.filter((m) => !placed.has(m.name) && !/RDYC racing marks/i.test(m.name));
  return { ...f, marks, marksNotPlaced };
}

/** A club mark's position in local metres, by its course id. */
export function clubMarkLocal(id: string): { n: number; e: number } | undefined {
  const cm = CLUB_MARKS.find((m) => m.id === id);
  return cm ? DART_PROJECTION.toLocal(cm.lat, cm.lon) : undefined;
}
