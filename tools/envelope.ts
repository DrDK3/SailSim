/**
 * The behaviour envelope (comprehensive review §4; docs/review/ACCEPTANCE_SCENARIOS.md): every acceptance
 * scenario run headless, written to out/envelope.json and out/envelope.md. MODEL OUTPUT FROM ESTIMATED
 * COEFFICIENTS, NOT VALIDATION.   Usage: npm run envelope
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { envelopeMarkdown, runEnvelope } from '../src/sim/validation/envelope';

const t0 = Date.now();
const report = runEnvelope();
mkdirSync('out', { recursive: true });
writeFileSync('out/envelope.json', JSON.stringify(report, null, 1) + '\n');
const md = envelopeMarkdown(report);
writeFileSync('out/envelope.md', md + '\n');
console.log(md);
console.log(`\nwritten out/envelope.json and out/envelope.md (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
