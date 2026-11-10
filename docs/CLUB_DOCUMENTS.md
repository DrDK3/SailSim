# Club and class documents

On 3 Nov 2026 the owner supplied three documents (review decisions D6 and D9). This page records what each says that matters to the simulator, with page or rule references, what has been built in, and what is still open.

The PDFs are **not** in the repository: they are the club's, the class association's and the harbour authority's publications. Facts are quoted with their references so they can be checked against the originals.

| Id ([SOURCES.md](SOURCES.md)) | Document | Edition / date | Pages |
|---|---|---|---|
| **R13** | Royal Dart Yacht Club, *Sailing Programme 2026*: programme, Notice of Race 2026, Sailing Instructions 2026, Pursuit Race NoR and SIs, **Course Appendix 2026** | 2026 | 40 |
| **C16** | RYA / NSOA, *National Squib Class Rules 2025* | PDF dated 2 Jan 2025 | 43 |
| **H12** | Dart Harbour and Navigation Authority, *Dart Harbour guide* (sailing directions, harbour information) | 2019 (PDF 26 Feb 2019) | 98 |

The 2019 harbour guide is older than the club's 2026 programme. Where they overlap, the 2026 document is used.

## 1. RDYC Sailing Programme 2026 (R13)

### What it settles

- **Squibs race as Class 3.** "Class 3 will comprise Squibs and any similar boats which are below the 5 m minimum length for IRC", with separate class results for Squibs (NoR 5.2). National Squibs "shall comply fully with their class rules" (NoR 1.4).
- **Wednesday evenings:**
  - Class 3 (Squib OD) starts first.
  - Class 2 starts 5 minutes later and Class 1 10 minutes later (programme p.5; SI 6.3).
  - The Class 3 class flag is printed as "Naval 9" (SI 6.3).
  - Start time is 18:30 (18:15 or 18:00 at the ends of the season).
  - The time limit is 20:15, extended to 20:45 if a boat in the class has finished (SI 12).
- **The start:**
  - RRS 26, with the warning signal 5 minutes before the start (SI 9.1).
  - Course information, time checks and changes to the sequence are given by VHF on channel M1 (37). Starting signals and recalls *may* be made by VHF, and "visual signals may not be used" (SI 3.3–3.5).
  - Without a committee boat, a designated competitor broadcasts the times on VHF, with no visual or sound signals (SI 9.3).
  - The rule DR21-01 start (time penalty for starting in the last minute) applies to Classes 1 and 2 at the club line only, so not to Squibs (NoR 1.2.4).
- **Penalties and scoring:**
  - A post-race penalty is the score made worse by two points, but not worse than DNF (SI 11, RRS 44.3(c)).
  - Wednesday series discards: one when four or five races are completed, two when six to eight are (NoR 11.1).
- **Lines** (Course Appendix 3):
  - **BP:** the prolongation of the line joining two white flagstaffs at Blackstone Point, with Castle Ledge buoy as the outer distance mark (ODM).
  - **CB:** between the orange-flag staff on the committee boat and the course side of the ODM, "the nearest adjacent mark".
  - **Club Line:** the transit of the RDYC flagpole and the outermost downriver pontoon pile.
- **Marks and approximate positions (WGS84)** (Course Appendix 7, p.21), with a course map on p.22:
  - **H** Homestone (red can)
  - **M** Mewstone (south cardinal)
  - **R** West Rock (south cardinal)
  - **L** Castle Ledge (green conical)
  - **C** Checkstone (red can)
  - **X** and **Y**: yellow 6-knot buoys
  - **1–4**: RDYC yellow conical buoys
  - **S** Skerries and **W** the wave buoy, both outside the simulator's area
  - **T**, **T1** and **T2**: temporary orange marks, with no fixed position
- **Courses:**
  - Groups A–C are inshore courses with a committee boat, by wind direction:
    - A is longer, for Class 1;
    - B is for Classes 2 and 3;
    - C is short, for light winds.
  - D–F have no committee boat and start on the BP line.
  - R courses are in the river; CT and WT are pursuit courses.
  - The shortened course finishes at the mark shown in red and square brackets. "Gate H" means passing between the committee boat and Homestone.
- **Restrictions** (Course Appendix 4):
  - Do not pass between the shore and Western Blackstone Rock, Mew Stone Rocks, Combe Rocks, Dancing Beggars Rocks, Cod Rock or Blackstone Rock.
  - Pass West Rock buoy to seaward unless rounding it. The rock is awash at low tide about 200 m NW of the buoy.
  - Keep clear of ferries at all times.
  - In the river, boats not racing that are entering or leaving count as obstructions (RRS 19 and 20).
- **Dangers:**
  - Homestone Rock lies 300 m west of the buoy, least depth 1.5 m.
  - There are dangers 50 m west of the Checkstone buoy, 1.6 m (pursuit course appendix 9).
- **Safety:** RRS 40.1 (personal flotation) applies at all times to National Squibs (Appendix 2.3).

### Built in (3 Nov 2026)

- **Marks** (`data/marks/rdyc-2026.json`, `src/sim/course/clubMarks.ts`):
  - **Which:** every mark with a position inside the simulator's area.
  - **Drawn as:** red can, green cone or yellow cone as the document describes them; south cardinal colours as IALA buoyage has them; a plain yellow buoy where the document gives no shape.
  - **Where they show:** in the 3D harbour and on the minimap. Checkstone, Homestone and the club marks are no longer "not placed".
  - **Cross-check:** Castle Ledge's position in the document is exactly the one the geodata already had from another source.
- **Eight club courses**, all **pending check** (`data/courses/club/rdyc-2026-*.course.json`):
  - **Which:** B1, B5, B6, C1, C2, C3, C4, C8. These are the Squib-relevant courses that start and finish at the same outer distance mark and use only fixed marks.
  - **Cross-check:** distances computed from the mark positions match the appendix's stated lengths within 0.15 NM (most within 0.06). Legs checked against the course map agree.
- **The committee boat** on these courses anchors where the race officer would set her. The document leaves her position to the officer on the day. The simulator (E):
  - places her square to the wind at the start of the race, at the outer distance mark;
  - makes the line 100 m, or 2.5 boat lengths per boat if longer;
  - puts her on the deeper side.
- **Quick race → "Start Bay: an RDYC club course for the wind":**
  - The course chosen is the one for the nearest wind direction: Group B in a breeze, Group C under 8 kn (the threshold is E).
  - The race says the course awaits a club check.

### Not yet built, and what is needed

| Item | Why not yet | Needed |
|---|---|---|
| Courses on the BP line (D, E, F, CT, WT) | The positions of the two white flagstaffs at Blackstone Point are not given | Their positions, or confirmation that the line runs from Blackstone Point to Castle Ledge |
| Courses using T (A3, A4, A7, A8, B3, B7, C6, C7) | T is laid on the day ("NW of Home", "W of Home") | Where T usually lies, or accept a simulator choice labelled as such |
| River courses R1 and R2 | The Club Line's pile, and T1, T2 and MS1, have no positions | The RDYC flagpole and pile positions; T1, T2 and MS1 positions (MS1 is the southernmost yellow ship buoy, H12) |
| Courses starting and finishing at different marks (B2, B8; most A courses) | The committee boat would have to move after the start | Whether the club moves her, or uses a second boat or mark |
| Shorten course, lap times, the time limit, DR21-01 | Racing package (P7) | — |
| VHF start signals (a spoken countdown instead of flags) | The RRS 26 sound signals are played and captioned since Package 2 round A (the simulator always has a committee boat, SI 9.1). The VHF time checks and countdown (SI 3.3, 3.4, 9.3) are not: the SIs do not give their wording | The usual wording of the race officer's VHF calls, if the club wants them simulated |
| The 44.3(c) two-point post-race penalty and series discards | Racing package (P7) | — |

## 2. National Squib Class Rules 2025 (C16)

Closed class rules: "if these rules do not say that you can – then you can not".

### What it settles

| Item | Rule | Value |
|---|---|---|
| Crew | C.2.1, J.2.1 | **Minimum 2**; no maximum or weight limit |
| Boat weight | C.6.1, J.6.1 | **680 kg minimum**, including sails, the mandatory equipment and permanently fitted optional items |
| Corrector weights | C.6.2, C.6.3 | Up to 30 kg, plus up to 30 kg of penalty correctors with approval |
| Mandatory equipment | C.5.1 | Bailer or bucket; anchor of 4–5 kg with 18–20 m of line; **158 L of extra flotation forward of the mast**; paddle |
| Sails carried | C.10.2 | 1 mainsail, 1 jib, 2 spinnakers |
| Standing rigging | C.9.7 | **Not adjusted while racing** |
| Running rigging | C.9.8, F.7 | Optional in design, except: the mainsheet leads to the traveller; **barber haulers permitted**; **a backstay** (running rigging, so adjustable); a kicking strap (fittings mandatory, F.3.5, F.4.3); a Cunningham eye in the mainsail and a Cunningham hole in the jib (G.3.3(f), G.4.2(h)) |
| Jib fairlead tracks | C.7.4(b) | 385 mm maximum |
| Mast | F.3.6, F.3.7 | Length 7695 mm max from the heel; forestay height 6400–6440 mm; spinnaker hoist 6490 mm max; spreaders 538–558 mm at 3500–3550 mm; weight 16 kg minimum |
| Boom | C.9.6 | Outer point 2743 mm maximum |
| Spinnaker pole | F.5.5 | 2140 mm maximum |
| Mainsail | G.3.4 | Leech 6815 mm; quarter, half, three-quarter and top widths 2320 / 1690 / 985 / 145 mm (all maxima) |
| Jib | G.4.3 | Luff 5380, leech 4670, foot 2410 mm (maxima); leech within a straight line |
| Spinnaker | G.5.3 | Luff and leech 4900, foot 3420, half width 3200, three-quarter width 1880 mm (maxima) |
| Keel | E.3 | Fine-grain cast iron to the RYA pattern; widths at stations given |
| Rudder | E.4 | Profile below the waterline to the official plan within 6 mm; bearing within 25 mm aft of the transom |

### Built in

- `data/boats/squib/class-spec.json` cites C16 and the rule numbers. The values read from it are tagged V. New entries cover forestay height, hoist height, mast weight, sail dimensions, forward flotation and fairlead track length.
- The physics values are unchanged; the parameter fingerprint is the same.

### For later packages

- **Sail areas (Package 5).** The rules give dimensions, not areas. From the maxima the estimates (E) are:
  - mainsail about 9.85 m² (ORC-style formula, with a luff of about 6.33 m between the mast bands);
  - jib about 5.62 m²;
  - spinnaker about 13.3 m².

  That puts the upwind total near 15.5 m², nearer the 15.8 m² secondary figure than the 16.5 m² the model uses. The sensitivity runs put 4% of area at about 0.07 kn. It is settled with the sail-power calibration, not changed alone.
- **Controls (Package 5, decision D2).** The rules permit:
  - adjusting the backstay, kicker and Cunningham, and barber haulers on the jib;
  - the mainsheet to a traveller.

  They forbid adjusting the standing rigging while racing. The realism contract can now say which of these the player gets.

## 3. Dart Harbour guide 2019 (H12)

### What it settles

- **Tidal stream** (Sailing Directions, p.33):
  - "In the entrance, the stream ebb or flood seldom exceeds 2 knots except after heavy rainfall or strong northerly winds when, on the ebb tide, this can run up to 3.5 knots."
  - "The tidal stream 1.5 miles outside the entrance runs N.E. from 2 hours before to 4 hours after high water at Dartmouth and S.W. from 2 hours before to 4 hours after low water at Dartmouth."
- **Chart:** Admiralty Chart 2253 (Edition 8, 3 Dec 2015) is the chart to use with the guide.
- **Buoys and lights** (p.34):
  - Homestone, port lateral, Q R;
  - Castle Ledge, starboard lateral, Fl G 5s ("mariners without local knowledge should not pass between the Castle Ledge Buoy and the shore");
  - Checkstone, port lateral, Fl(2) R 5s;
  - Kingswear light, Iso WRG 3s;
  - Bayards Cove light, Fl WRG 2s.
- **Ferries** (p.33):
  - The two lower car ferries (tug and float) and the wire-guided Higher Ferry are "restricted in their ability to manoeuvre".
  - There are submerged wires near the Higher Ferry.
- **Speed limit:** 6 knots in the harbour.
- **Main stream buoys:** yellow ships' buoys MS1–MS5, south to north, on the right of the main channel heading north. The visitors' anchorage is on their Kingswear side.
- **Moorings:** most harbour authority moorings are blue; visitors' moorings are white with a black V.

### Built in

- **Stream:** the entrance rates (default flood 1.5 kn, ebb 2 kn, up to 3.5 kn on the ebb with strong northerlies) and the offshore timing (NE from HW−2 to HW+4, SW from LW−2 to LW+4) were already in the model, from a secondary source. They now cite the guide.
- **Not resolved:** the river stream's own timing. The guide gives the entrance rates but not when the entrance stream turns, so the river stream stays illustrative (review EN-1).
- **Lights:** the three buoys' characters are used for the drawn lights (Q = about one flash a second).

### For later packages

- **Package 4:** Admiralty Chart 2253 holds the soundings and tidal diamonds; a licence question (D5, D6).
- **Packages 4 and 7:** MS1–MS5, needed for river course R2, could be placed from the chart or OSM seamarks.

## 4. Owner statements

| Date | Statement | Provenance | Used for |
|---|---|---|---|
| 10 Nov 2026 | **RDYC is an accredited RYA Training Centre.** | The owner (O); no document seen | The review's RYA recommendations (a skills log mapped to the courses RDYC runs, checked by its instructors; an instructor mode). Which courses RDYC runs, and the course criteria, are still to come from the club. The simulator does not carry RYA approval or the RYA's marks: the accreditation is the club's, not the software's |
