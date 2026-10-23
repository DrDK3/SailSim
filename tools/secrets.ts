/**
 * Secret scanning for the built site (Phase 6 acceptance: "no secrets in the bundle"). Pure functions, so the
 * rules are unit-tested (tests/sim/secrets.test.ts); tools/check-secrets.ts runs them over dist/.
 *
 * Three kinds of check:
 *  1. Well-known credential formats (AWS, GitHub, Google, Slack, Stripe, private keys, JWTs).
 *  2. A credential-looking value assigned to a key/token/secret/password name, or sent in an API-key header
 *     (the UKHO Admiralty API uses Ocp-Apim-Subscription-Key; the Met Office DataHub uses apikey).
 *  3. The exact values of secret-named environment variables present while checking (in CI: the UKHO key
 *     given to the ingest job), so a leaked real key is caught whatever its format.
 */

export interface Finding {
  file: string;
  line: number;
  rule: string;
  /** The matched text, shortened and partly masked. */
  excerpt: string;
}

interface Rule {
  name: string;
  re: RegExp;
}

const RULES: Rule[] = [
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: 'Stripe secret key', re: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { name: 'JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: 'API-key header with a value',
    re: /["']?(?:Ocp-Apim-Subscription-Key|x-api-key|apikey)["']?\s*[:=,]\s*["'`]([A-Za-z0-9_\-+/=]{16,})["'`]/gi,
  },
  {
    name: 'credential assigned to a secret-looking name',
    re: /\b[A-Za-z_$][\w$]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|subscription[_-]?key)["']?\s*[:=]\s*["'`]([A-Za-z0-9_\-+/=]{20,})["'`]/gi,
  },
];

/** Values that look like credentials but are not (placeholders and repeated characters). */
function isPlaceholder(s: string): boolean {
  return /^(?:your|example|dummy|placeholder|changeme|replace)/i.test(s) || /(.)\1{11,}/.test(s);
}

function mask(s: string): string {
  const t = s.length > 60 ? `${s.slice(0, 60)}…` : s;
  return t.replace(/([A-Za-z0-9_\-+/=]{8})([A-Za-z0-9_\-+/=]{6,})/g, (_, a: string) => `${a}******`);
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Scan one file's text. `knownSecrets` are exact values that must never appear (from the environment). */
export function scanText(file: string, text: string, knownSecrets: string[] = []): Finding[] {
  const out: Finding[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      if (m[1] !== undefined && isPlaceholder(m[1])) continue;
      out.push({ file, line: lineOf(text, m.index), rule: rule.name, excerpt: mask(m[0]) });
    }
  }
  for (const secret of knownSecrets) {
    if (secret.length < 8) continue; // too short to search for without false alarms
    for (let i = text.indexOf(secret); i >= 0; i = text.indexOf(secret, i + 1)) {
      out.push({ file, line: lineOf(text, i), rule: 'value of a secret environment variable', excerpt: mask(secret) });
    }
  }
  return out;
}

/** Values of environment variables whose names say they are secret (KEY, TOKEN, SECRET, PASSWORD). */
export function secretEnvValues(env: Record<string, string | undefined>): string[] {
  const names = Object.keys(env).filter((k) => /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)/i.test(k) && !/^(?:npm_|PUBLIC_)/i.test(k));
  return [...new Set(names.map((k) => env[k] ?? '').filter((v) => v.length >= 8))];
}

/**
 * Vite puts every VITE_* variable it sees into the bundle. A secret-looking VITE_ name in the source is a
 * leak waiting to happen, so it is reported even before a value exists.
 */
export function scanViteEnvNames(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  const re = /\bVITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ file, line: lineOf(text, m.index), rule: 'secret-looking VITE_ variable (Vite bundles it into the client)', excerpt: m[0] });
  }
  return out;
}
