import { useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { saveFile } from '../app/visualReport';

const MODE: Record<string, string> = {
  none: 'as built',
  'no-reflections': 'without sky reflections',
  'simple-materials': 'with simple materials',
};

/**
 * The automatic graphics check's result (src/render/gpuCheck.ts), shown once for each graphics card and whenever it
 * finds a fault, with the report ready to copy or save (owner item, 10 Nov 2026: the report should be easy to send).
 * Nothing is sent anywhere: the report goes only where you paste or attach it.
 */
export function GpuCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const [copied, setCopied] = useState(false);
  const c = ui.materialCheck;
  if (!ui.gpuCard || !c) return null;
  return (
    <div className="hint-card" role="dialog" aria-label="Graphics check" data-testid="gpu-card">
      <p>
        <strong>
          {ui.gpuCard === 'unfixed'
            ? 'Graphics check: painted surfaces draw too dark, and no drawing mode fixed it'
            : ui.gpuCard === 'fixed'
              ? 'Graphics check: a fault was found and fixed'
              : 'Graphics check: painted surfaces draw correctly'}
        </strong>{' '}
        on {ui.gpuName ?? 'this graphics card'}
        {ui.gpuCard === 'fixed' ? `; now drawing ${MODE[ui.materialMode ?? 'none'] ?? ui.materialMode}` : ''}
        {ui.gpuCard === 'unfixed' ? ` (${c.reason})` : ''}. If anything looks wrong, send the report with a description; it stays on this device until you paste or attach it.
      </p>
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            void navigator.clipboard?.writeText(ctl.materialReport()).catch(() => undefined);
            setCopied(true);
          }}
          data-testid="gpu-card-copy"
        >
          {copied ? 'Report copied' : 'Copy the report'}
        </button>
        <button onClick={() => saveFile(`squib-graphics-check-${new Date().toISOString().slice(0, 10)}.txt`, ctl.materialReport(), 'text/plain')} data-testid="gpu-card-save">
          Save it as a file
        </button>
        <button onClick={() => ctl.dismissGpuCard()} data-testid="gpu-card-close">
          Close
        </button>
      </div>
    </div>
  );
}
