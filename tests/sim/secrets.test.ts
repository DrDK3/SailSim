import { describe, expect, it } from 'vitest';
import { PUBLIC_BY_DESIGN, scanText, scanViteEnvNames, secretEnvValues } from '../../tools/secrets';

// Fake credentials are assembled at run time so this file contains none (and trips no secret scanner).
const j = (...p: string[]) => p.join('');
const rnd = (n: number, seed = 7) => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    s += abc[x % abc.length];
  }
  return s;
};

describe('secret check (Phase 6: no secrets in the bundle)', () => {
  it('finds well-known credential formats', () => {
    const cases: [string, string][] = [
      ['AWS access key id', `const k = "${j('AKIA', rnd(16).toUpperCase())}";`],
      ['GitHub token', `token=${j('ghp', '_', rnd(36))}`],
      ['Google API key', `key: "${j('AIza', rnd(35))}"`],
      ['private key block', j('-----BEGIN ', 'RSA PRIVATE KEY-----\nMIIE...')],
      ['JSON web token', j('eyJ', rnd(20), '.eyJ', rnd(20), '.', rnd(20))],
    ];
    for (const [rule, text] of cases) expect(scanText('x.js', text).map((f) => f.rule)).toContain(rule);
  });

  it('finds API keys in headers and secret-named assignments, with the line number', () => {
    const ukho = rnd(32, 3);
    const text = `fetch(u, {\n  headers: { "Ocp-Apim-Subscription-Key": "${ukho}" }\n});\nconst ukhoApiKey = "${rnd(24, 9)}";`;
    const f = scanText('a.js', text);
    expect(f.find((x) => x.rule === 'API-key header with a value')?.line).toBe(2);
    expect(f.some((x) => x.rule === 'credential assigned to a secret-looking name' && x.line === 4)).toBe(true);
    // The report masks the value.
    expect(f.every((x) => !x.excerpt.includes(ukho))).toBe(true);
  });

  it('finds the exact value of a secret environment variable anywhere in the bundle', () => {
    const secret = rnd(40, 11);
    const env = { UKHO_API_KEY: secret, PATH: '/usr/bin', npm_config_token_like: rnd(20), SHORT_KEY: 'abc' };
    const known = secretEnvValues(env);
    expect(known).toEqual([secret]);
    expect(scanText('b.js', `var q="${secret.slice(0, 10)}"+"${secret.slice(10)}";`, known)).toEqual([]); // split: not literal
    expect(scanText('b.js', `...${secret}...`, known)[0]?.rule).toBe('value of a secret environment variable');
  });

  it('does not flag ordinary code, placeholders or hashes', () => {
    const ok = [
      'const tokenizer = new Tokenizer(); const passwordField = document.querySelector("#pw");',
      'const apiKey = "YOUR_API_KEY_HERE_REPLACE_ME";',
      'const secret = "xxxxxxxxxxxxxxxxxxxxxxxx";',
      'integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"',
      'const tokenType = "identifier";',
    ];
    for (const t of ok) expect(scanText('c.js', t)).toEqual([]);
  });

  it('flags secret-looking VITE_ variables, which Vite would put into the client', () => {
    expect(scanViteEnvNames('s.ts', 'const k = import.meta.env.VITE_UKHO_API_KEY;')[0]?.excerpt).toBe('VITE_UKHO_API_KEY');
    expect(scanViteEnvNames('s.ts', 'const u = import.meta.env.VITE_LIVE_BASE_URL;')).toEqual([]);
  });

  it('exempts only the names that are public by design (the Turnstile site key), by exact name', () => {
    expect([...PUBLIC_BY_DESIGN]).toEqual(['VITE_TURNSTILE_SITEKEY']);
    // The site key may be in the source and its value in the bundle: every page with the widget carries it.
    expect(scanViteEnvNames('s.ts', 'const k = import.meta.env.VITE_TURNSTILE_SITEKEY;')).toEqual([]);
    expect(secretEnvValues({ VITE_TURNSTILE_SITEKEY: '0x4AAAAAAAexamplesitekey' })).toEqual([]);
    // Its private counterpart, and anything merely similar, is still caught.
    for (const name of ['VITE_TURNSTILE_SECRET', 'VITE_TURNSTILE_SECRET_KEY', 'VITE_TURNSTILE_SITEKEY_SECRET', 'VITE_OTHER_SITEKEY'])
      expect(scanViteEnvNames('s.ts', `const k = import.meta.env.${name};`)[0]?.excerpt, name).toBe(name);
    expect(secretEnvValues({ TURNSTILE_SECRET: '0x4AAAAAAAexamplesecret' })).toEqual(['0x4AAAAAAAexamplesecret']);
  });
});
