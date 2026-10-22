# Club courses (RDYC)

**None yet.** No official Royal Dart Yacht Club course documents have been made available (the 2026 sailing programme, sailing instructions and mark positions; see `docs/MISSING_INFORMATION.md`, items A1–A3). Nothing here may be invented.

To add a club course, enter it from the official document, one file per course: `<id>.course.json` in the format described in `docs/COURSES.md`.

- **Status:** `"pending-check"`.
- **Provenance:** `kind: "club-document"`, `document` (title, edition, date), `reference` (section, page or course letter), `enteredBy`, `enteredOn`.
- **Mark positions:** as given in the document. Use latitude and longitude for the club's fixed marks and navigation buoys.

A nominated checker compares the file with the document. If it matches, they set the status to `"verified"` and add `checkedBy` and `checkedOn`. The app's course editor can do this, then export the file. The validator refuses `verified` without a checker and a date.
