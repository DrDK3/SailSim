# Club table endpoint

`worker.js` is the whole endpoint (one file, no framework, no dependencies): a Cloudflare Worker with one KV
namespace. `mock.mjs` runs the same handler locally over an in-memory store. Deployment, secrets and costs:
[docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md#club-table-optional-off-by-default); what it stores and for how long:
[docs/club-table/DATA_PROTECTION.md](../../docs/club-table/DATA_PROTECTION.md).

It is not deployed by this repository. The app makes no request to it unless the site was built with
`VITE_CLUB_TABLE_URL` set and a player presses "Submit to the club table".
