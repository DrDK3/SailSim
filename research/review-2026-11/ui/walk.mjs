import { chromium } from 'playwright';
const B = 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const res = {};
const errors = [];
const ready = async (page) => { await page.getByTestId('stw').waitFor({ timeout: 120000 }); await page.waitForFunction(() => window.__squib?.controller.getState().dart.status !== 'loading', null, { timeout: 400000 }); };
// 1. First visit at 1280x800: what greets the user, and keyboard focus.
{ const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const t0 = Date.now(); await page.goto(B); await ready(page); res.loadToSailing_s = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1500); await page.screenshot({ path: '01-first-visit.png' });
  res.firstVisitDialog = await page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.textContent));
  // Keyboard: Tab through and record focus (name, visible focus ring).
  const focus = [];
  for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); focus.push(await page.evaluate(() => { const el = document.activeElement; if (!el) return null; const cs = getComputedStyle(el); const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.getAttribute('title') || el.tagName; return `${el.tagName.toLowerCase()}:${name}|ring:${cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' ? cs.outlineWidth : (cs.boxShadow !== 'none' ? 'shadow' : 'NONE')}`; })); }
  res.tabOrderFirstVisit = focus;
  await page.close(); }
// 2. Sailing view (welcome dismissed): unlabelled controls, small targets.
{ const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(B + '?nowelcome'); await ready(page); await page.waitForTimeout(1500);
  await page.screenshot({ path: '02-free-sailing-1280.png' });
  res.controls = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, input, select, [role=button], a[href]')].filter((e) => e.getClientRects().length);
    const name = (e) => (e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.textContent || e.getAttribute('title') || '').trim();
    const unnamed = els.filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 90));
    const small = els.map((e) => { const r = e.getBoundingClientRect(); return { n: name(e).slice(0, 24) || e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 24 || x.h < 24);
    return { count: els.length, unnamed, small };
  });
  // Text sizes below 12 px that are visible.
  res.tinyText = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent?.trim() && e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => `${parseFloat(getComputedStyle(e).fontSize)}px:${e.textContent.trim().slice(0, 40)}`).slice(0, 15));
  // Tutorial first step.
  await page.getByTestId('activity').click(); await page.getByRole('dialog', { name: 'Squib sailing simulator' }).getByRole('button', { name: 'Learn to sail' }).click();
  await page.waitForTimeout(2500); await page.screenshot({ path: '03-tutorial-step1.png' });
  res.tutorialText = (await page.getByTestId('tutorial').innerText()).slice(0, 400);
  // Quick race (defaults), start; pre-start and after the start.
  await page.getByTestId('activity').click(); await page.getByRole('dialog', { name: 'Squib sailing simulator' }).getByRole('button', { name: 'Race against AI' }).click();
  await page.waitForTimeout(800); await page.screenshot({ path: '04-quick-race-panel.png' });
  await page.getByTestId('quick-race-start').click(); await page.waitForTimeout(2000);
  await page.screenshot({ path: '05-race-prestart.png' });
  await page.evaluate(() => { const c = window.__squib.controller; if (!c.getState().paused) c.togglePause(); window.__squib.advance(240); });
  await page.waitForTimeout(2500); await page.screenshot({ path: '06-race-after-start.png' });
  // Leave the race to the AI (the user boat sails on with its helm centred): to the end, then the debrief.
  await page.evaluate(() => window.__squib.advance(2400));
  await page.waitForTimeout(2500); await page.screenshot({ path: '07-race-end.png' });
  res.raceEnd = await page.evaluate(() => { const s = window.__squib.controller.getState(); return { phase: s.race?.phase, over: s.race?.raceOver, results: s.race?.results?.map((r) => `${r.name}:${r.code ?? ''}:${r.place ?? ''}`), debrief: !!s.debrief }; });
  await page.close(); }
// 3. Phone and the owner's laptop size in a race.
for (const [w, h, tag] of [[390, 844, 'phone'], [1000, 560, 'laptop']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(B + '?nowelcome'); await ready(page);
  await page.evaluate(() => { const c = window.__squib.controller; c.startQuickRace({ competitors: 3, level: 'good', venue: 'start-bay', course: 'windward-leeward', conditions: 'random', wind: 'any', seed: 2, sequence: 'one-minute' }); if (!c.getState().paused) c.togglePause(); window.__squib.advance(100); });
  await page.waitForTimeout(2500); await page.screenshot({ path: `08-race-${tag}.png` });
  res[`overlap_${tag}`] = await page.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const a = r('.hud-left'), b = r('.controls'); return a && b ? { hudBottom: Math.round(a.bottom), dockTop: Math.round(b.top), overlap: a.bottom > b.top && a.left < b.right } : null; });
  await page.close();
}
res.errors = errors;
console.log(JSON.stringify(res, null, 1));
await browser.close();
