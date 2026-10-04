const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const {adaptPage,reveal}=require('./paged-ui.cjs');

const baseURL = process.env.WORKSPACE_URL || 'http://127.0.0.1:8765';
const launch = { headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

async function submit(page, query) {
  await page.locator('#question').fill(query);
  await page.locator('#ask').evaluate(form => form.requestSubmit());
}

async function exportOrbit(page) {
  await page.locator('[data-drawer="tools"]').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Orbit library', exact: true }).click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'orbit-library.json');
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await page.locator('#close').click();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

(async () => {
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  adaptPage(page);
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  try {
    await page.goto(baseURL);
    await page.waitForFunction(() => document.querySelector('#submit')?.disabled === false);
    await page.locator('[data-drawer="add"]').first().click();
    await page.getByLabel('Title', { exact: true }).fill('Phone options');
    await page.getByLabel('Note', { exact: true }).fill('Android budget under 500 with a good camera');
    await page.getByRole('button', { name: 'Save to Orbit', exact: true }).click();
    await submit(page, 'phone');
    const phone = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Phone options', exact: true }) });
    await phone.waitFor();
    await phone.getByRole('button', { name: 'Select', exact: true }).click();
    await phone.getByRole('button', { name: 'Selected', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Phone options', exact: true }).waitFor();

    // Editing updates the same saved note, rather than appending a duplicate.
    await phone.getByRole('button', { name: 'Details & actions', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('Phone shortlist');
    await page.getByLabel('Note', { exact: true }).fill('Android budget under 400 with a good camera');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('heading', { name: 'Phone shortlist', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Phone options', exact: true }).count(), 0);
    const exported = await exportOrbit(page);
    assert.equal(exported.schema, 'conscience64.play/v1');
    assert.equal(exported.app, 'orbit');
    assert.equal(exported.data.items.length, 1, 'an edit preserves one Orbit item');
    assert.equal(exported.data.items[0].title, 'Phone shortlist');
    assert.equal(exported.data.items[0].text, 'Android budget under 400 with a good camera');

    // The real file chooser, validator, and import merge path retain provenance.
    const imported = { schema: 'conscience64.play/v1', app: 'orbit', data: { items: [{ id: 'browser-fixture-field-notebook', title: 'Field notebook', text: 'Notes on migratory birds and coastal habitats.', source: 'https://example.org/field-notebook', language: 'en' }] } };
    await page.locator('[data-drawer="tools"]').click();
    const pendingChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Orbit library', exact: true }).click();
    const chooser = await pendingChooser;
    await chooser.setFiles({ name: 'orbit-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction(() => {
      const stored = JSON.parse(localStorage.getItem('conscience64.play.v1.orbit') || 'null');
      return stored?.data?.items?.some(item => item.id === 'browser-fixture-field-notebook');
    });
    await page.locator('#close').click();
    await submit(page, 'migratory birds');
    await page.getByRole('heading', { name: 'Field notebook', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Field notebook', exact: true }).waitFor();
    const merged = await exportOrbit(page);
    assert.equal(merged.data.items.length, 2, 'import merges with the edited note');
    assert.ok(merged.data.items.some(item => item.id === imported.data.items[0].id && item.source === imported.data.items[0].source), 'import retains identity and provenance');

    await page.locator('[data-drawer="tools"]').click();
    await page.getByText('Teach an answer or remember a phrase', { exact: true }).click();
    await page.getByLabel('Question', { exact: true }).fill('Bike touring checklist');
    await page.getByLabel('Answer to remember', { exact: true }).fill('Carry a repair kit, water, and lights for long bicycle rides.');
    await page.getByRole('button', { name: 'Remember answer on this device', exact: true }).click();
    await page.getByLabel('When I search this phrase', { exact: true }).fill('rideprep');
    await page.getByLabel('Also look for these words', { exact: true }).fill('bike touring checklist');
    await page.getByRole('button', { name: 'Remember phrase', exact: true }).click();
    await page.locator('#close').click();
    await submit(page, 'rideprep');
    const learned = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Bike touring checklist', exact: true }) });
    await learned.waitFor();
    await learned.getByRole('button', { name: 'Details & actions', exact: true }).click();
    await page.getByRole('button', { name: 'Helpful', exact: true }).click();
    await page.locator('#close').click();
    await page.reload();
    await page.getByRole('heading', { name: 'Bike touring checklist', exact: true }).waitFor();
    assert.ok((await page.locator('#cards').innerText()).includes('Carry a repair kit'), 'a taught answer and phrase alias survive reload and retrieve the remembered text');

    await page.locator('[data-drawer="recent"]').click();
    await page.getByRole('button', { name: 'phone', exact: true }).click();
    assert.equal(await page.locator('#question').inputValue(), 'phone', 'Recent restores the prior query');
    await page.getByRole('heading', { name: 'Phone shortlist', exact: true }).waitFor();
    await page.locator('[data-drawer="refine"]').first().click();
    await page.getByLabel('Avoid (comma separated)', { exact: true }).fill('Android');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('heading', { name: 'Phone shortlist', exact: true }).waitFor({ state: 'hidden' });
    await page.locator('#clear').click();
    await page.locator('#question').fill('quantum gravity');
    await page.locator('[data-drawer="refine"]').first().click();
    await page.getByText('More search engines · 65 routes', { exact: true }).click();
    await page.getByLabel(/^Country hint/u).waitFor();
    assert.equal(await page.getByLabel(/^Country hint/u).locator('option').count(), 249, 'the original 248 country hints plus Global remain available');
    await page.getByRole('button', { name: 'Show search routes', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#drawer-body details a[href]').length === 65);
    const routes = await page.locator('#drawer-body details a[href]').evaluateAll(links => links.map(link => link.href));
    assert.ok(routes.every(href => ['http:', 'https:'].includes(new URL(href).protocol)), 'planned engine links retain usable source URLs');
    assert.ok(routes.some(href => decodeURIComponent(href).replace(/\+/g, ' ').includes('quantum gravity')), 'planned routes carry the current query');
    assert.deepEqual(externalRequests, [], 'planning source links makes no external retrieval requests');
    await page.screenshot({ path: 'routes-preview.png', fullPage: true });
    await page.locator('#close').click();
    await submit(page, 'phone');
    await page.locator('#clear').click();
    await page.screenshot({ path: 'desktop-preview.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'mobile-preview.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'the original controls fit mobile width');
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, [], 'save, edit, import, history, and local retrieval stay on this device');
    console.log('PASS browser: Orbit save/edit/export/import/provenance, local teaching/alias/feedback, selection, reload restore, Recent, exclusions, 65 source routes/248 country hints, mobile overflow; renderer=' + await page.locator('html').getAttribute('data-renderer'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
