// Serve the actual backend: python server/search_server.py --port 8768
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const {adaptPage,readAllMenu}=require('./paged-ui.cjs');
const baseURL = process.env.WORKSPACE_URL || 'http://127.0.0.1:8768';
const launch = { headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

(async () => {
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  adaptPage(page);
  const errors = [], external = [], providerRequests = [], corpusResponses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/search') providerRequests.push(url.href);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/corpus') corpusResponses.push(response.status());
  });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  try {
    const connected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/corpus' && response.status() === 200);
    await page.goto(baseURL);
    await connected;
    await page.waitForFunction(() => /Full search index connected/i.test(document.querySelector('#notice')?.textContent || ''));
    await page.waitForFunction(() => window.Conscience64Search?.stats().corpusAvailable === true);
    const stats = await page.evaluate(() => window.Conscience64Search.stats());
    assert.equal(stats.corpus.total, 734, 'the real browser backend connects the complete verified corpus');
    assert.equal(stats.corpus.projects.count, 7);
    assert.equal(stats.corpus.projects.lessonCount, 14);
    assert.equal(stats.corpus.transport.payloadShards, 6);
    assert.deepEqual(corpusResponses, [200], 'corpus is fetched through the real local server');

    await page.locator('#question').fill('Physics / GR–Quantum Seam');
    await page.waitForTimeout(750);
    assert.equal(providerRequests.length, 0, 'backend-connected typing never starts an external search');
    await page.locator('#ask').evaluate(form => form.requestSubmit());
    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Physics / GR–Quantum Seam', exact: true }) });
    await card.waitFor();
    await card.getByRole('button', { name: 'Details & actions', exact: true }).click();
    await page.getByRole('button',{name:'Relations & record',exact:true}).click();
    await page.waitForTimeout(80);
    const details = await readAllMenu(page);
    assert.ok(details.includes('project:physics'), 'record inspection preserves the original logical identity');
    assert.ok(details.includes('uoid:sha256:a1ca3309d2a86e1a3ee8944fe60ea1a206879db6873bdb2933887989227e8f40'), 'record inspection retains the original source UOID');
    assert.ok(/direct relations/.test(details), 'relation inspection uses the connected corpus');
    await page.locator('#close').click();
    await page.screenshot({ path: 'backend-results-preview.png', fullPage: true });

    await page.locator('[data-drawer="tools"]').click();
    await page.getByRole('button', { name: 'Browse projects and lessons', exact: true }).click();
    await page.getByRole('button', { name: 'Historical Recovery', exact: true }).click();
    await page.getByRole('heading', { name: 'Historical Recovery', exact: true }).waitFor();
    assert.ok((await readAllMenu(page)).includes('2026-09-13'), 'the real separate registry supplies its project lessons');
    await page.screenshot({ path: 'backend-projects-preview.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.equal(providerRequests.length, 0, 'local records and project lessons do not call provider search');
    console.log('PASS real backend browser: corpus transport, original record identity, relation inspection, separate project registry and lessons, local-only typing');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
