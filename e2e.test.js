/* End-to-end test, run in a real headless browser (Playwright), not the
   plain-Node checks the other tests/*.test.js files use — this one has to
   exercise ui.js's private load()/normalizeState() closure and the actual
   rendered DOM, neither of which is reachable from plain Node.

   Requires Playwright and a local static file server. Not part of the
   default `npm test` (kept dependency-light and fast); run explicitly with
   `npm run test:e2e`.

   IMPORTANT LESSON ENCODED HERE, learned the hard way earlier in this
   project's history: never reuse one browser page across multiple
   navigations when testing state changes. Repeated page.goto() calls to
   the same URL can be served a stale cached response from the first
   navigation, silently invalidating everything tested after it — this
   produced a real false result (a same-moment, zero-change comparison
   that still showed hundreds of "differences") before the cause was
   found. Every state-dependent check below uses a FRESH browser context
   (fresh cache, fresh storage) for each scenario, never page.goto() twice
   on the same page. */
const path = require('path');
const http = require('http');
const fs = require('fs');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  console.log('SKIPPED: playwright is not installed. Run `npm install playwright` (or `npm install --save-dev playwright`) to enable `npm run test:e2e`.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PORT = 8917;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p === '/') p = '/index.html';
      const full = path.join(ROOT, p);
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(full);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

let failures = 0;
function check(label, cond) {
  if (cond) { console.log('  OK   ' + label); }
  else { console.log('  FAIL ' + label); failures++; }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();

  // ---- Scenario 1: full tab-and-mode walkthrough, zero console errors ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const issues = [];
    page.on('pageerror', e => issues.push('[pageerror] ' + e.message));
    page.on('console', m => { if (m.type() === 'error') issues.push('[console] ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    for (const t of ['today', 'study', 'revise', 'progress', 'more']) {
      await page.click('button[data-tab="' + t + '"]');
      await page.waitForTimeout(250);
    }
    await page.click('button[data-tab="today"]');
    await page.waitForTimeout(150);
    await page.click('.sm-v16-brand-mode');
    await page.waitForTimeout(150);
    for (const m of ['night', 'study', 'focus']) {
      const b = await page.$('[data-visual-mode="' + m + '"]');
      if (b) { await b.click(); await page.waitForTimeout(200); }
    }
    check('full tab + visual-mode walkthrough produces zero console errors', issues.length === 0);
    if (issues.length) console.log(issues.join('\n'));
    await ctx.close();
  }

  // ---- Scenario 2: schema migration from an old (v1-shaped) saved state ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const issues = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => { if (m.type() === 'error') issues.push(m.text().slice(0, 200)); });
    // Seed a pre-migration-era state (no schemaVersion, no procedures/notifications/
    // diagnostics/productPrinciples/aiProfile.provider — the shape a real long-time
    // user's browser could still have on disk) BEFORE the app's own JS ever runs,
    // via addInitScript, so this is what load() actually sees on first boot.
    await page.addInitScript(() => {
      localStorage.setItem('surgimaster:v10', JSON.stringify({
        prefs: {}, misses: [], days: {}, scores: {}, calib: [], tallies: {},
        repairs: {}, mcq: {}, cursors: {}, lecDone: {}, viva: [], swaps: [],
        notes: [], retiredCount: 3
      }));
    });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    for (const t of ['today', 'study', 'revise', 'progress', 'more']) {
      await page.click('button[data-tab="' + t + '"]');
      await page.waitForTimeout(200);
    }
    check('old-shape state loads and renders with zero console errors', issues.length === 0);
    if (issues.length) console.log(issues.join('\n'));

    // load() migrates in memory but is lazy about persisting — it only writes
    // back to localStorage on the next real save(), the same as any other
    // in-memory state change. Trigger one via a real, already-used UI action
    // (the visual-mode toggle) before reading localStorage back, matching
    // what an actual user's browser would show after using the app at all.
    await page.click('button[data-tab="today"]');
    await page.waitForTimeout(150);
    await page.click('.sm-v16-brand-mode');
    await page.waitForTimeout(150);
    const focusBtn = await page.$('[data-visual-mode="focus"]');
    if (focusBtn) { await focusBtn.click(); await page.waitForTimeout(200); }

    const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('surgimaster:v10')));
    check('schemaVersion upgraded to current (7)', migrated.schemaVersion === 7);
    check('retiredCount survived the migration untouched', migrated.retiredCount === 3);
    check('new v2 field (adaptiveProfile) backfilled', migrated.adaptiveProfile && typeof migrated.adaptiveProfile === 'object');
    check('new v3 field (adaptive4) backfilled', migrated.adaptive4 && typeof migrated.adaptive4 === 'object');
    check('new v4 field (procedures) backfilled', migrated.procedures && typeof migrated.procedures === 'object');
    check('new v5 field (notifications) backfilled', migrated.notifications && typeof migrated.notifications === 'object');
    check('new v6 field (diagnostics) backfilled', migrated.diagnostics && typeof migrated.diagnostics === 'object');
    check('new v7 field (productPrinciples) backfilled', migrated.productPrinciples && typeof migrated.productPrinciples === 'object');
    // The one thing migrateState() uniquely provides that normalizeState()'s
    // own unconditional per-field defaults do not: every other field checked
    // above turned out to have an independent fallback in normalizeState too
    // (found while building this test, not assumed) — a migration from v1
    // would still get correctly-shaped fields even with migrateState's own
    // per-field backfill entirely deleted. lastMigrationAt does NOT have that
    // redundancy; it is the one place migrateState's own gate has to run.
    check('lastMigrationAt recorded a real migration happened', migrated.diagnostics && migrated.diagnostics.lastMigrationAt > 0);
    await ctx.close();
  }

  await browser.close();
  server.close();

  if (failures > 0) {
    console.log('\nE2E FAILED: ' + failures + ' check(s) did not pass.');
    process.exit(1);
  }
  console.log('\nE2E PASS: full walkthrough clean, old-shape state migrates to schema v7 correctly.');
})();
