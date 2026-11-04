# Club courses (RDYC)

Entered on 3 Nov 2026 from the club's **Sailing Programme 2026, Course Appendix 2026**, which the owner supplied (docs/CLUB_DOCUMENTS.md, source R13). Every course here is **pending check**: a nominated RDYC member compares it with the document and then marks it verified.

| File | Course | Wind | Start / finish | Stated length |
|---|---|---|---|---|
| `rdyc-2026-b1.course.json` | B1: L 1p 2p [Lp] Hp | South-west | Committee boat and Castle Ledge (L) | 4.3 NM |
| `rdyc-2026-b5.course.json` | B5: H Ls 3s 1s [Hs] 1s | North-east | Committee boat and Homestone (H) | 5.1 NM |
| `rdyc-2026-b6.course.json` | B6: H Yp 1p 2p [Hp] 2p | North | Committee boat and H | 4.9 NM |
| `rdyc-2026-c1.course.json` | C1: H 1p 2p [Hp] 1p | South-west, light | Committee boat and H | 4.2 NM |
| `rdyc-2026-c2.course.json` | C2: H 2s 1s [Hs] 2s | South, light | Committee boat and H | 4.4 NM |
| `rdyc-2026-c3.course.json` | C3: H 3p 4p [Hp] 3p | South-east, light | Committee boat and H | 4.0 NM |
| `rdyc-2026-c4.course.json` | C4: H 4s 3s [Hs] 4s | East, light | Committee boat and H | 3.7 NM |
| `rdyc-2026-c8.course.json` | C8: 4 Hp 3p [4p] Hp | West, light | Committee boat and RDYC 4 | 3.7 NM |

**How the files were entered:**

- **Mark positions:** the club's approximate WGS84 positions (Course Appendix section 7), also in `data/marks/rdyc-2026.json`.
- **Distances:** computed from those positions, they agree with the stated lengths within 0.15 NM (`tests/sim/club.test.ts`).
- **The committee boat** has no position in the document. Her mark carries `placement: { odm }`, and the simulator places her on the day, square to the wind at that mark (E). The `position` the library shows is for the course's design wind.
- **Not simulated:** the shortened course (the mark in square brackets) and lap times.

**Not entered yet, and why:**

| Courses | Why not yet |
|---|---|
| Blackstone Point line courses (D, E, F, CT, WT) | They need the Blackstone Point flagstaff positions |
| Courses using the temporary mark T (A3, A4, A7, A8, B3, B7, C6, C7) | T has no fixed position |
| River courses R1 and R2 | They need the Club Line's pile, T1, T2 and MS1 positions |
| B2, B8 and most A courses | They start and finish at different marks |

**To add or check a course:**

- **Enter it** from the document, one file per course, in the format described in `docs/COURSES.md`:
  - status `"pending-check"`;
  - provenance `kind: "club-document"`, with `document`, `reference`, `enteredBy` and `enteredOn`.
- **Check it:** a nominated checker compares the file with the document. If it matches, they set the status to `"verified"` and add `checkedBy` and `checkedOn`. The validator refuses `verified` without a checker and a date.
