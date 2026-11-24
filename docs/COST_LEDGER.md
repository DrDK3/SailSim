# Cost ledger

Design handover of 23 Nov 2026, item 29 ("Make the free development story reproducible"). A dated record of what
running and developing SailSim costs, kept apart by kind, so that a visitor can see the operating-cost model and
someone else could reproduce the approach.

**Status: a template awaiting the owner.** Amounts and dates of actual expenditure are the owner's to enter and
confirm; nothing below is an invoice or a claim of what was spent. Provider terms change: each row says where the
current terms are, and the date they were last checked.

## 1. Running the public site (what a visitor's use costs)

| Item | Provider terms (where to check) | Cost | Last checked | Notes |
|---|---|---|---|---|
| Hosting: GitHub Pages | docs.github.com → GitHub Pages limits | £0 (owner to confirm) | (date) | Site about 13 MB; limits: 1 GB site, about 100 GB a month bandwidth (soft) |
| Build and live-data jobs: GitHub Actions, public repository | docs.github.com → Actions billing | £0 (owner to confirm) | (date) | Standard runners are free for public repositories |
| Weather: Met Office UKV via AWS Open Data | registry.opendata.aws (Met Office) | £0 | (date) | CC BY-SA 4.0, attribution in the app |
| Water level: Environment Agency gauge | environment.data.gov.uk | £0 | (date) | Open Government Licence v3 |
| **Total running cost** | | **(owner to confirm)** | | docs/DEPLOYMENT.md §6 estimates £0 |

## 2. Optional services (not needed to run the site)

| Item | Provider terms | Cost if used | In use? | Notes |
|---|---|---|---|---|
| UKHO ADMIRALTY UK Tidal API, paid tiers | admiralty.co.uk → developer portal | about £120 or £300 a year (docs/LIVE_TIDES.md) | (owner) | The Discovery tier is free; without a key the app uses its own predictions |
| Custom domain | the registrar's price list | about £10 a year | (owner) | |
| Club table (Cloudflare Worker), off by default | developers.cloudflare.com → Workers pricing | £0 on the free tier (owner to confirm) | No | docs/DEPLOYMENT.md §6c |

## 3. Development subscriptions (making it, not running it)

| Item | Period | Cost | Notes |
|---|---|---|---|
| (for example, an AI coding assistant subscription) | (from – to) | (owner) | Used to write and test the code; not needed to run or to fork the site |
| (other tools) | | (owner) | |

## 4. Hardware

| Item | Cost | Notes |
|---|---|---|
| (computers or devices bought for this project, if any) | (owner) | Devices already owned are not counted |

## 5. Contributed time and material

| Who | What | Basis |
|---|---|---|
| The owner | (hours or a description) | Unpaid |
| Club members and sailors | Reviews, local knowledge, the club's approval of 20 Nov 2026 | Unpaid; credited in docs/SOURCES.md |
| Data providers | Open data (table in README → Data and attribution) | Under their own licences |

## How to reproduce the approach

- **The code:** github.com/DrDK3/SailSim, MIT licence (README → Licence). The build: `npm ci && npm run build`;
  the tests: `npm test` and `npx playwright test` (README, docs/DEPLOYMENT.md).
- **Not covered by the code's licence:** the data from other sources, the club's material and others' names
  (README → Licence). Anyone reusing the approach brings their own data under its own terms.
- **Hosting limits:** docs/DEPLOYMENT.md §6 (Pages and Actions limits, and what a private repository would cost).

Last updated: 23 Nov 2026 (template; figures awaiting the owner).
