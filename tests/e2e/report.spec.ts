import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * "Report a visual problem" (src/app/visualReport.ts): a picture of the 3D view and the details, saved as one file on
 * this device; nothing is sent anywhere.
 */
const CI_SLOW = process.env.CI ? 2 : 1;

test('report a visual problem: a picture of the view and the details, saved locally, nothing sent', async ({ page }) => {
  test.setTimeout(120_000 * CI_SLOW);
  const sent: string[] = [];
  await page.goto('/?nowelcome&quality=low');
  await expect(page.getByTestId('stw')).toBeVisible();
  // From here on, any request at all would be the report leaving the device.
  page.on('request', (r) => {
    if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
  });
  await page.evaluate(() => window.__squib!.controller.toggleSettings(true));
  await page.getByTestId('report-start').click({ timeout: 30_000 * CI_SLOW });
  const box = page.getByTestId('report-problem');
  await expect(box).toBeVisible();
  // The picture is the frame drawn: a PNG of the canvas's size, not blank.
  const shot = await box.locator('img.report-shot').getAttribute('src');
  expect(shot).toMatch(/^data:image\/png;base64,/);
  expect(shot!.length).toBeGreaterThan(5000);
  await page.getByTestId('report-note').fill('The jetty floats above the water');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-save').click()]);
  expect(download.suggestedFilename()).toMatch(/^squib-visual-report-\d{4}-\d\d-\d\d-\d{4}\.html$/);
  const html = readFileSync((await download.path())!, 'utf8');
  expect(html).toContain('The jetty floats above the water');
  expect(html).toContain('<img src="data:image/png;base64,');
  for (const label of ['Build', 'Graphics card', 'Graphics settings', 'Camera', 'Boat', 'Wind', 'Water level']) expect(html).toContain(`<th>${label}</th>`);
  expect(sent).toEqual([]);
});
