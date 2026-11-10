import { useState } from 'react';
import type { SimController } from '../app/controller';
import { reportFileName, reportHtml, reportText, saveFile, type ReportDetail } from '../app/visualReport';

/**
 * "Report a visual problem": a picture of the 3D view and the details, saved as one file on this device (nothing is
 * sent anywhere; src/app/visualReport.ts).
 */
export function ReportProblem({ ctl }: { ctl: SimController }) {
  const [shot, setShot] = useState<{ url?: string; details: ReportDetail[] }>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'saved' | 'copied'>();

  const start = async () => {
    setBusy(true);
    const url = await ctl.captureView();
    setShot({ url, details: ctl.visualReportDetails() });
    setBusy(false);
    setDone(undefined);
  };

  if (!shot) {
    return (
      <div className="row left">
        <button onClick={() => void start()} disabled={busy} data-testid="report-start">
          {busy ? 'Taking the picture…' : 'Report a visual problem'}
        </button>
      </div>
    );
  }
  return (
    <div className="report-problem" data-testid="report-problem">
      {shot.url ? <img src={shot.url} alt="The 3D view as it was" className="report-shot" /> : <p className="fine">The 3D view could not be captured; the details are still saved.</p>}
      <label>
        What looks wrong, and where?
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. the jetty floats above the water by the ferry slip" data-testid="report-note" />
      </label>
      <p className="fine">
        Saved as one file on this device (a picture of the 3D view, the graphics card, your settings, and where the boat and camera were). Nothing is
        sent anywhere: attach the file wherever you report problems.
      </p>
      <div className="row left wrap">
        <button
          onClick={() => {
            saveFile(reportFileName(new Date()), reportHtml({ note, details: shot.details, screenshot: shot.url }));
            setDone('saved');
          }}
          data-testid="report-save"
        >
          Save the report
        </button>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(reportText(note, shot.details)).catch(() => undefined);
            setDone('copied');
          }}
        >
          Copy the details
        </button>
        <button onClick={() => void start()}>Take the picture again</button>
        <button onClick={() => setShot(undefined)}>Close</button>
      </div>
      {done && <p className="fine" role="status">{done === 'saved' ? 'Report saved to your downloads.' : 'Details copied.'}</p>}
    </div>
  );
}
