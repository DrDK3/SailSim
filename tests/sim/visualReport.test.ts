/** "Report a visual problem" (src/app/visualReport.ts): one local file, escaped, with only an image embedded. */
import { describe, expect, it } from 'vitest';
import { reportFileName, reportHtml, reportText } from '../../src/app/visualReport';

const details = [
  { label: 'Build', value: 'abc123 (2026-11-10)' },
  { label: 'Graphics card', value: 'ANGLE <SwiftShader> & co' },
];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('visual problem report', () => {
  it('the text lists the note and every detail', () => {
    const t = reportText('  jetty floats  ', details);
    expect(t).toContain('What looks wrong: jetty floats');
    expect(t).toContain('Graphics card: ANGLE <SwiftShader> & co');
  });

  it('the page embeds the picture and escapes what the player typed and the details', () => {
    const h = reportHtml({ note: '<script>alert(1)</script>', details, screenshot: PNG });
    expect(h).toContain(`<img src="${PNG}"`);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('ANGLE &lt;SwiftShader&gt; &amp; co');
  });

  it('embeds nothing but an image data URL', () => {
    for (const bad of ['javascript:alert(1)', 'https://example.com/x.png', 'data:text/html;base64,PHA+', `${PNG}" onerror="x`]) {
      const h = reportHtml({ note: '', details, screenshot: bad });
      expect(h).not.toContain('<img');
      expect(h).toContain('No picture');
    }
    expect(reportHtml({ note: '', details }).includes('No picture')).toBe(true);
  });

  it('is named by the local date and time', () => {
    expect(reportFileName(new Date(2026, 10, 10, 9, 5))).toBe('squib-visual-report-2026-11-10-0905.html');
  });
});
