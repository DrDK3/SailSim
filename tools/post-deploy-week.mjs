/**
 * The week whose targets file should be on the live site (fixes of 21 Nov 2026, §3.7): the ISO 8601 week of the
 * calendar date in London, as "2026-W48". Plain JavaScript so the post-deploy check runs without a build; the unit
 * test (tests/sim/postDeployWeek.test.ts) holds it to the app's own `weekOf` (src/app/weekly.ts).
 */
export function londonIsoWeek(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const date = Date.UTC(get('year'), get('month') - 1, get('day'));
  const monday = date - ((new Date(date).getUTCDay() + 6) % 7) * 86400e3;
  const thursday = monday + 3 * 86400e3;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * 86400e3));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The site's address: SITE_URL, else the repository's GitHub Pages address (https://<owner>.github.io/<repo>/). */
export function siteUrl(env = process.env) {
  if (env.SITE_URL) return env.SITE_URL.endsWith('/') ? env.SITE_URL : `${env.SITE_URL}/`;
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo) throw new Error('Set SITE_URL (or GITHUB_REPOSITORY) to say which site to check.');
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}
