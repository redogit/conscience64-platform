// Run after serving docs: node tests/horizon-browser.cjs
// The app stays real. Only the five external provider HTTP APIs use fixtures.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseURL = process.env.WORKSPACE_URL || 'http://127.0.0.1:8765';
const launch = { headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
const query = 'affordable electric mountain bike for commuting and weekend trails';
const fixtureText = 'An affordable electric mountain bike for commuting and weekend trails. Compare price budget cost battery range charging reliability maintenance comfort safety weight brakes suspension motor power fit durability warranty accessories terrain and carrying capacity.';
const providers = {
  wikipedia: {
    host: 'en.wikipedia.org', path: '/w/api.php', param: 'srsearch', title: 'Wikipedia fixture: electric mountain bike',
    body: { batchcomplete: '', query: { searchinfo: { totalhits: 1 }, search: [{ ns: 0, title: 'Wikipedia fixture: electric mountain bike', pageid: 12345, size: 900, wordcount: 120, snippet: fixtureText, timestamp: '2026-09-01T12:00:00Z' }] } }
  },
  openalex: {
    host: 'api.openalex.org', path: '/works', param: 'search', title: 'OpenAlex fixture: electric mountain bike',
    body: { meta: { count: 1, db_response_time_ms: 2, page: 1, per_page: 10, groups_count: null }, results: [{ id: 'https://openalex.org/W12345', doi: 'https://doi.org/10.1234/bike.2026', title: 'OpenAlex fixture: electric mountain bike', display_name: 'OpenAlex fixture: electric mountain bike', publication_year: 2026, publication_date: '2026-09-01', type: 'article', cited_by_count: 4, authorships: [{ author: { id: 'https://openalex.org/A12345', display_name: 'Example Researcher' }, institutions: [], author_position: 'first', is_corresponding: true }], primary_location: { source: { display_name: 'Transport Research' }, landing_page_url: 'https://doi.org/10.1234/bike.2026', pdf_url: null, is_oa: true }, abstract_inverted_index: Object.fromEntries(fixtureText.split(' ').map((word, i) => [word, [i]])) }] }
  },
  crossref: {
    host: 'api.crossref.org', path: '/works', param: 'query', title: 'Crossref fixture: electric mountain bike',
    body: { status: 'ok', 'message-type': 'work-list', 'message-version': '1.0.0', message: { facets: {}, 'total-results': 1, 'items-per-page': 10, query: { 'start-index': 0, 'search-terms': query }, items: [{ DOI: '10.1234/bike.crossref.2026', URL: 'https://doi.org/10.1234/bike.crossref.2026', title: ['Crossref fixture: electric mountain bike'], type: 'journal-article', author: [{ given: 'Example', family: 'Researcher' }], publisher: 'Example Press', 'container-title': ['Transport Research'], abstract: '<p>' + fixtureText + '</p>', issued: { 'date-parts': [[2026, 9, 1]] }, published: { 'date-parts': [[2026, 9, 1]] }, 'is-referenced-by-count': 4 }] } }
  },
  archive: {
    host: 'archive.org', path: '/advancedsearch.php', param: 'q', title: 'Archive fixture: electric mountain bike',
    body: { responseHeader: { status: 0, QTime: 2, params: { q: query, rows: '10', page: '1', output: 'json' } }, response: { numFound: 1, start: 0, docs: [{ identifier: 'electric-bike-fixture', title: 'Archive fixture: electric mountain bike', description: fixtureText, creator: ['Example Researcher'], mediatype: 'texts', year: '2026', date: '2026-09-01T00:00:00Z' }] } }
  },
  github: {
    host: 'api.github.com', path: '/search/repositories', param: 'q', title: 'example/electric-mountain-bike',
    body: { total_count: 1, incomplete_results: false, items: [{ id: 12345, node_id: 'R_fixture', name: 'electric-mountain-bike', full_name: 'example/electric-mountain-bike', private: false, owner: { login: 'example', id: 123, html_url: 'https://github.com/example', type: 'User' }, html_url: 'https://github.com/example/electric-mountain-bike', description: fixtureText, fork: false, url: 'https://api.github.com/repos/example/electric-mountain-bike', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', pushed_at: '2026-09-01T00:00:00Z', homepage: '', size: 10, stargazers_count: 4, watchers_count: 4, language: 'JavaScript', forks_count: 0, open_issues_count: 0, default_branch: 'main', archived: false, disabled: false, topics: ['electric-bikes'], license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT' }, score: 1 }] }
  }
};

async function installProviderFixtures(page) {
  const calls = [], unexpected = [], pending = [];
  const network = { calls, unexpected, hold: false, release: () => { network.hold = false; for (const done of pending.splice(0)) done(); } };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    const entry = Object.entries(providers).find(([, p]) => url.hostname === p.host && url.pathname === p.path);
    if (!entry) { unexpected.push(url.href); return route.abort(); }
    const [provider, fixture] = entry;
    calls.push({ provider, url: url.href, query: url.searchParams.get(fixture.param) || '' });
    if (network.hold) await new Promise(resolve => pending.push(resolve));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(fixture.body) });
  });
  return network;
}

async function ready(page) {
  await page.goto(baseURL);
  await page.waitForFunction(() => document.querySelector('#submit')?.disabled === false);
}

async function words(page) {
  return page.locator('#word-chain .word-bubble').evaluateAll(nodes => nodes.map(n => n.dataset.word));
}

async function analyzed(page, subject) {
  await page.waitForFunction(want => document.querySelector('#query-subject')?.textContent.toLowerCase().includes(want), subject);
  await page.locator('#context-proposals button[data-context-id]').first().waitFor();
}

async function screenshot(page, name) {
  await page.screenshot({ path: name + '-preview.png', fullPage: !name.includes('typing') && !name.includes('reduced-motion') });
}

async function assertMobileGeometry(page) {
  const geometry = await page.evaluate(() => {
    const visible = selector => [...document.querySelectorAll(selector)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const composer = rect(document.querySelector('#ask'));
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      wordRects: visible('#word-chain .word-bubble').map(rect),
      controls: visible('#context-proposals button, #accepted-context button, #external-search').map(rect),
      contextText: visible('#alignment, #proposal-status, #notice').map(rect),
      edgeMenus: visible('nav .edge').map(rect),
      composer, width: innerWidth, height: innerHeight
    };
  });
  assert.equal(geometry.overflow, false, 'typing and context must not cause horizontal mobile overflow');
  assert.ok(geometry.wordRects.length > 0, 'mobile query words remain visible');
  for (const r of [...geometry.wordRects, ...geometry.controls]) {
    assert.ok(r.left >= -1 && r.right <= geometry.width + 1, 'query bubbles and context controls fit mobile width');
    assert.ok(!(r.left < geometry.composer.right && r.right > geometry.composer.left && r.top < geometry.composer.bottom && r.bottom > geometry.composer.top), 'bubbles and context buttons do not cover the typing field');
  }
  for (let i = 0; i < geometry.wordRects.length; i++) {
    for (let j = i + 1; j < geometry.wordRects.length; j++) {
      const a = geometry.wordRects[i], b = geometry.wordRects[j];
      assert.ok(!(a.left + 1 < b.right && a.right - 1 > b.left && a.top + 1 < b.bottom && a.bottom - 1 > b.top), 'mobile word bubbles must not overlap each other');
    }
  }
  for (const menu of geometry.edgeMenus) {
    for (const r of [...geometry.wordRects, ...geometry.controls, ...geometry.contextText]) {
      assert.ok(!(r.left < menu.right && r.right > menu.left && r.top < menu.bottom && r.bottom > menu.top), 'mobile menus do not cover query words, context controls, or context feedback');
    }
  }
}

async function typingAndContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const network = await installProviderFixtures(page);
  await ready(page);
  await page.locator('#question').fill('affordable');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#word-chain .word-bubble')).opacity) > .95);
  await page.locator('#question').pressSequentially(query.slice('affordable'.length), { delay: 18 });
  await page.waitForFunction(want => document.querySelectorAll('#word-chain .word-bubble').length === want, query.split(' ').length);
  assert.deepEqual(await words(page), query.split(' '), 'every typed word detaches into an exact, ordered bubble');
  assert.ok(await page.locator('#word-chain .word-bubble').first().evaluate(word => Number(getComputedStyle(word).opacity) > .95), 'an earlier word remains readable while the next word is typed');
  await screenshot(page, 'desktop-typing');
  await analyzed(page, 'bike');
  const kinds = await page.locator('#context-proposals button[data-context-id]').evaluateAll(nodes => nodes.map(n => n.dataset.contextKind || n.dataset.kind));
  const modes = await page.locator('#context-proposals button[data-context-id]').evaluateAll(nodes => nodes.map(n => n.dataset.contextMode));
  assert.ok(kinds.includes('property'), 'the complete query yields property proposals');
  assert.ok(kinds.includes('aspect') || modes.includes('aspect'), 'the complete query yields aspect proposals');
  assert.equal(network.calls.length, 0, 'typing and local analysis never send a provider request');
  assert.equal(network.unexpected.length, 0, 'typing sends no other external requests');
  console.log('CHECK browser: words and local whole-query context');

  // Replacing the query before the debounce settles must discard the old subject.
  await page.locator('#question').fill('quantum physics research');
  await page.waitForTimeout(150);
  await page.locator('#question').fill('smartphone with good battery life');
  await analyzed(page, 'smartphone');
  await page.waitForTimeout(750);
  assert.ok(!(await page.locator('#query-subject').innerText()).toLowerCase().includes('physics'), 'a stale analysis cannot replace the latest subject');
  assert.deepEqual(await words(page), ['smartphone', 'with', 'good', 'battery', 'life']);

  await page.locator('#question').fill(query);
  await analyzed(page, 'bike');
  const choice = await page.locator('#context-proposals button[data-context-id]').evaluateAll((nodes, input) => {
    return nodes.map(b => ({ id: b.dataset.contextId, value: b.dataset.contextValue || b.dataset.contextLabel || b.textContent.replace(/^\s*[+＋]\s*/u, '').trim(), kind: b.dataset.contextKind || b.dataset.kind }))
      .find(b => b.kind === 'property' && b.value.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(token => token.length > 3 && !input.toLowerCase().includes(token)));
  }, query);
  assert.ok(choice, 'at least one proposed property supplies useful context beyond the typed query');
  const proposal = page.locator(`#context-proposals button[data-context-id=${JSON.stringify(choice.id)}]`);
  // Two rapid selection events must preserve set membership, even if the first rerenders the list.
  await proposal.evaluate(button => { button.click(); button.click(); });
  const accepted = page.locator('#accepted-context button[data-remove-context]');
  assert.equal(await accepted.count(), 1, 'rapid repeated selection cannot duplicate an accepted context');
  assert.equal(await accepted.getAttribute('data-remove-context'), choice.id);
  console.log('CHECK browser: latest debounce and unique context acceptance');
  const extraTokens = choice.value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 3 && !query.toLowerCase().includes(token));

  const before = network.calls.length;
  await page.locator('#external-search').click();
  for (const [id, fixture] of Object.entries(providers)) {
    await page.getByRole('heading', { name: fixture.title, exact: true }).waitFor();
    const calls = network.calls.slice(before).filter(call => call.provider === id);
    assert.equal(calls.length, 1, `explicit search makes exactly one ${id} request`);
    const call = calls[0];
    assert.ok(call.query.toLowerCase().includes('mountain') && call.query.toLowerCase().includes('commuting'), `${id} receives the whole query`);
    assert.ok(extraTokens.some(token => call.query.toLowerCase().includes(token)), `${id} receives the accepted context in its request URI`);
  }
  assert.equal(network.calls.length, before + 5, 'one explicit search requests each of the five selected providers');
  console.log('CHECK browser: five explicit provider requests retain chosen context');
  await screenshot(page, 'desktop-results');
  await accepted.click();
  assert.equal(await page.locator('#accepted-context button[data-remove-context]').count(), 0, 'accepted context can be removed');
  const beforeRemovalSearch = network.calls.length;
  await page.locator('#external-search').click();
  await page.waitForFunction(() => /complete/i.test(document.querySelector('#notice')?.textContent || ''));
  assert.equal(network.calls.length, beforeRemovalSearch + 5);
  assert.ok(network.calls.slice(beforeRemovalSearch).every(call => !extraTokens.some(token => call.query.toLowerCase().includes(token))), 'removed context is absent from later provider requests');

  const beforeScopeRefine = network.calls.length;
  await page.locator('[data-drawer="refine"]').first().click();
  assert.equal(await page.locator('#drawer-body select[name="scope"]').inputValue(), 'web', 'Sources targets the currently displayed web candidates');
  await page.getByLabel('Avoid (comma separated)', { exact: true }).fill('Wikipedia');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(await page.locator('#cards .card').count(), 4, 'refining web results does not switch into the local index');
  await page.locator('[data-drawer="refine"]').first().click();
  await page.getByLabel('Avoid (comma separated)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(await page.locator('#cards .card').count(), 5, 'removing a web filter restores original fetched candidates');
  assert.equal(network.calls.length, beforeScopeRefine, 'Sources refinements make no additional provider requests');

  // Slow provider responses must not leave the explicit search control stuck after cancellation.
  await page.locator('#question').fill(query + ' with suspension');
  await analyzed(page, 'bike');
  network.hold = true;
  const pendingRequest = page.waitForRequest(request => new URL(request.url()).hostname === providers.wikipedia.host);
  await page.locator('#external-search').click();
  await pendingRequest;
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#external-search').isEnabled(), true, 'Escape during an external request immediately restores the search control');
  network.release();
  await page.waitForTimeout(60);
  assert.match(await page.locator('#notice').innerText(), /stopped|ready/i, 'late provider completion cannot replace cancellation status');

  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('#clear').isVisible()) await page.locator('#clear').click();
  await page.locator('#question').fill(query);
  await analyzed(page, 'bike');
  await page.waitForFunction(() => [...document.querySelectorAll('#word-chain .word-bubble')].every(word => Number(getComputedStyle(word).opacity) > .95));
  await assertMobileGeometry(page);
  await screenshot(page, 'mobile-typing');
  await page.locator('#external-search').click();
  await page.getByRole('heading', { name: providers.wikipedia.title, exact: true }).waitFor();
  await assertMobileGeometry(page);
  await screenshot(page, 'mobile-results');
  assert.deepEqual(errors, [], 'typing, context changes, and searches produce no uncaught errors');
  assert.deepEqual(network.unexpected, [], 'only explicitly selected, known provider APIs are requested');
  await context.close();
}

async function reducedMotionFallback(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl' || kind === 'webgpu') return null;
      return getContext.call(this, kind, ...args);
    };
    try { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); } catch {}
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const network = await installProviderFixtures(page);
  await ready(page);
  await page.locator('#question').fill('Ice 世界 now');
  await page.waitForFunction(() => document.querySelectorAll('#word-chain .word-bubble').length === 3);
  assert.deepEqual(await words(page), ['Ice', '世界', 'now'], 'fallback keeps exact multilingual query words accessible');
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced');
  assert.match(await page.locator('html').getAttribute('data-renderer'), /fallback/i, 'no GPU uses a functional fallback');
  await page.locator('#question').focus();
  assert.equal(await page.locator('#question').evaluate(input => input === document.activeElement), true, 'fallback retains keyboard access to the composer');
  await page.locator('#question').press('Enter');
  await page.locator('#results').waitFor({ state: 'visible' });
  await screenshot(page, 'mobile-reduced-motion');
  assert.deepEqual(errors, []);
  assert.equal(network.calls.length, 0, 'fallback local search does not contact providers');
  await context.close();
}

(async () => {
  const browser = await chromium.launch(launch);
  try {
    await typingAndContext(browser);
    await reducedMotionFallback(browser);
    console.log('PASS browser: exact word bubbles, whole-query context, stale debounce, acceptance/removal, five provider requests, responsive geometry, reduced-motion fallback');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
