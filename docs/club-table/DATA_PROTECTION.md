# Club table: data-protection note for the owner (DRAFT)

**Draft for the owner to check.** Written by the developer (an AI agent) from the code as built on 17 Nov 2026. It is
not legal advice and does not claim the service is compliant with the UK GDPR, the Data Protection Act 2018 or the
ICO's Age Appropriate Design Code (the Children's code). Players may be under 18, and the Children's code applies to
online services likely to be used by children. Check it, ideally with someone who knows data protection, before the
club table is switched on. Nothing here applies while the table is off (the default).

## What is processed

| Item | Where it comes from | Personal data? |
|---|---|---|
| The run (the replay): the course, the wind, the player's control inputs over time, the claimed finish time and whether assists were used | Created by the app when the player presses **Submit to the club table** | Not on its own. It describes how a boat was sailed. In principle a distinctive style of sailing could be recognised by someone who knows it; we think that unlikely and low risk |
| A word-list name (for example "Blue Heron 42") | Chosen or re-rolled by the player from fixed lists; never typed | Designed not to identify anyone. It is a pseudonym: if a junior tells friends their name, those friends can link it to them |
| The build of the app and the browser engine family (Chromium, Gecko, WebKit or other) | The app | No |
| A random deletion token | Made on the device; only its SHA-256 hash is stored by the endpoint | A random value. It links a device's own copy to its entry, so the player can remove it |

**Not processed by the app:** real names, email addresses, accounts, free text, location, contact lists, and the user
agent string (only the engine family). The endpoint's code stores **no IP address** or other network identifier
(`server/club-table/worker.js`; a test checks this).

**The hosting provider (if Cloudflare is chosen, as recommended):** like any web host, Cloudflare processes the IP
address and request metadata of each request to deliver it. Its own logs and analytics are governed by its terms and
data processing addendum, not by this code. The owner should read Cloudflare's current privacy policy and DPA, and set
the account's log retention to the minimum available. The Turnstile bot check runs Cloudflare's script in the browser
when the player presses Submit. Cloudflare's terms ask the site's privacy notice to refer to its Turnstile Privacy
Addendum: the owner must check this. The GitHub Action that verifies runs reads the stored runs with an admin token
and publishes the table to GitHub Pages; GitHub's own terms apply to that.

## Where, and for how long

| Data | Where | Kept |
|---|---|---|
| A submitted run, waiting to be checked | Cloudflare KV (the provider's region choice) | Until the next verifier run (every 30 minutes); at most 14 days (automatic expiry) |
| The verdict for a token (accepted, or the reason not) | Cloudflare KV | 120 days (automatic expiry) |
| An accepted entry (name, time, independent or assisted, date) | Cloudflare KV, and published as `club/weekly-<week>.json` on the public website | Until the end of the season (26 weeks by default, set by the owner), then deleted automatically from both |
| The week's top three runs, as ghosts others can race | Published next to the table | As the table |
| All other replays | — | Deleted after verification |
| The deletion token | The player's own browser (local storage) | Until the player clears the browser's data |

## The provider's role

If Cloudflare is used, Cloudflare acts as the owner's processor for the stored data, under its terms. The owner (or the
club, if it runs it) is the controller and decides whether to run the table, for how long data is kept, and who holds
the admin token. GitHub hosts the published table.

## Removal and other rights

- **Remove my entry**: the button in the app sends the token. The next verifier run (within 30 minutes) deletes the
  entry and its ghost, and republishes the table without it. No person is involved.
- A player who has lost their token (for example after clearing the browser) cannot prove which entry is theirs. The
  owner could remove an entry by name on request, by deleting its `accepted:` record with the admin token. That is
  the one manual step, and it is only needed if someone asks.
- Entries expire at the end of the season automatically.

## Design choices that follow the Children's code (to be checked, not claimed)

- Off by default. Submission is opt-in for each run, with a plain explanation of what is sent before the button.
- Data minimisation: word-list names only, no free text, no accounts, no IP addresses stored by the app. Replays are
  deleted after checking. Tables expire.
- No profiling, no notifications, no streaks, no rewards for coming back. No advertising and no third-party analytics.
- Nothing leaves the device unless the player presses a labelled submit or share button.

## Open points for the owner

1. Choose who runs it (the owner personally, or the club) and name the controller in the privacy notice.
2. Check the provider's terms, DPA, data location and log retention.
3. Decide the season length (default 26 weeks).
4. Publish a privacy notice (the parents' note, [PARENTS.md](PARENTS.md), is a starting point), linked from the app's
   Help and the club's website.
5. Consider a data protection impact assessment (a DPIA). The ICO expects one for services likely to be used by
   children.
