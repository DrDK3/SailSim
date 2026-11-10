/**
 * "Report a visual problem" (red team, 10 Nov 2026): a picture of the 3D view and everything needed to see it again
 * (build, graphics card, settings, where the boat and the camera were, the time and weather), saved as one HTML file
 * on this device. Nothing is sent anywhere: the player attaches the file wherever they report problems. Sending it
 * to a server would need a service with storage and a privacy notice (docs/DEPLOYMENT.md), which this does not use.
 */

export interface ReportDetail {
  label: string;
  value: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The details as plain text (for the clipboard, or pasting into an email). */
export function reportText(note: string, details: readonly ReportDetail[]): string {
  const lines = ['Squib simulator: visual problem report', ''];
  if (note.trim()) lines.push(`What looks wrong: ${note.trim()}`, '');
  for (const d of details) lines.push(`${d.label}: ${d.value}`);
  return lines.join('\n');
}

/** One self-contained page: the note, the picture (a PNG data URL) and the details. Opens in any browser. */
export function reportHtml(o: { note: string; details: readonly ReportDetail[]; screenshot?: string }): string {
  // Only an image data URL is embedded; anything else (or none) shows a line saying there is no picture.
  const img = o.screenshot && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(o.screenshot) ? `<img src="${o.screenshot}" alt="The 3D view when the report was made">` : '<p><em>No picture: the 3D view could not be captured.</em></p>';
  const rows = o.details.map((d) => `<tr><th>${esc(d.label)}</th><td>${esc(d.value)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Squib visual problem report</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:16px auto;max-width:1100px;padding:0 16px;background:#fff;color:#111}
img{max-width:100%;height:auto;border:1px solid #ccc}
table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{text-align:left;vertical-align:top;padding:4px 8px;border-bottom:1px solid #e5e5e5}
th{white-space:nowrap;color:#444;font-weight:600}
td{font-family:ui-monospace,monospace;font-size:13px;word-break:break-word}
.note{padding:8px 12px;background:#f4f4f4;border-left:4px solid #888;white-space:pre-wrap}
</style></head><body>
<h1>Squib simulator: visual problem report</h1>
${o.note.trim() ? `<p class="note">${esc(o.note.trim())}</p>` : '<p><em>No description given.</em></p>'}
${img}
<p>The picture is the 3D view only (not the panels over it), drawn the moment the report was started.</p>
<table>
${rows}
</table>
</body></html>
`;
}

/** e.g. squib-visual-report-2026-11-10-1143.html (local time). */
export function reportFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `squib-visual-report-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.html`;
}

/** Save text as a file on this device (the browser's download). */
export function saveFile(name: string, text: string, type = 'text/html'): void {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
