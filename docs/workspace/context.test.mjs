import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('./context.mjs').catch(() => ({}));
function analyze(...args) {
  assert.equal(typeof api.analyzeQuery, 'function', 'query analysis API must be available');
  return api.analyzeQuery(...args);
}
function build(...args) {
  assert.equal(typeof api.buildSearchQuery, 'function', 'query builder API must be available');
  return api.buildSearchQuery(...args);
}
const findTerm = (items, term) => items.find(item => item.term.toLocaleLowerCase() === term.toLocaleLowerCase());

test('reads the whole phone request while separating its actual budget and battery property', () => {
  const result = analyze('Can you find me a phone under $500 with good battery life?');
  assert.equal(result.subject, 'phone');
  assert.ok(findTerm(result.properties, 'under $500'));
  assert.ok(findTerm(result.properties, 'good battery life'));
  assert.ok(result.suggestions.some(item => /camera/i.test(item.term)));
  assert.ok(result.suggestions.every(item => ['query', 'record', 'facet'].includes(item.source.type)));
  assert.ok(!result.summary.includes('model'));
});

test('facet suggestions ask about missing dimensions without inventing a price or brand', () => {
  const result = analyze('smartphone');
  assert.ok(result.missing.includes('budget'));
  assert.ok(result.suggestions.some(item => item.kind === 'question' && /budget/i.test(item.label)));
  assert.ok(!result.suggestions.some(item => /500|Samsung|Apple|iPhone/i.test(item.term)));
  assert.ok(result.suggestions.every(item => item.mode === 'aspect' || item.kind !== 'question'));
});

test('generic black hole query offers interpretations instead of asserting a domain', () => {
  const result = analyze('black hole');
  assert.equal(result.subject, 'black hole');
  assert.ok(result.missing.includes('meaning'));
  assert.ok(result.suggestions.some(item => item.kind === 'ambiguity' && /astronomy/i.test(item.term)));
  assert.ok(result.suggestions.some(item => item.kind === 'ambiguity' && /software/i.test(item.term)));
  assert.ok(!result.aspects.some(item => item.term === 'astronomy'));
});

test('explicit astronomy words remove the irrelevant software interpretation', () => {
  const result = analyze('Explain Hawking radiation from black holes');
  assert.equal(result.subject, 'black holes');
  assert.ok(findTerm(result.aspects, 'Hawking radiation'));
  assert.ok(!result.missing.includes('meaning'));
  assert.ok(!result.suggestions.some(item => /software|theme/i.test(item.term)));
});

test('software context does not suggest physical black hole research', () => {
  const result = analyze('black hole theme for a software interface');
  assert.ok(!result.suggestions.some(item => /Hawking|astronomy|radiation/i.test(item.term)));
  assert.ok(result.aspects.some(item => /software|interface|theme/i.test(item.term)));
});

test('negated astronomy meanings do not become positive refinements', () => {
  const result = analyze('black hole not astronomy');
  assert.ok(findTerm(result.properties, 'astronomy')?.mode === 'avoid');
  assert.ok(!result.suggestions.some(item => /astronomy|Hawking|radiation/i.test(item.term)));
  const built = build('black hole not astronomy');
  assert.deepEqual(built.constraints.avoid, ['astronomy']);
  assert.match(built.providerQuery, /-astronomy/);
  assert.ok(!built.providerQuery.includes('not astronomy'));
});

test('travel request uses supplied location and date without inventing an itinerary', () => {
  const result = analyze('Plan a trip to Kyoto in November 2026 without crowds');
  assert.equal(result.subject, 'trip');
  assert.ok(findTerm(result.properties, 'Kyoto'));
  assert.ok(findTerm(result.properties, 'November 2026'));
  assert.equal(findTerm(result.properties, 'crowds').mode, 'avoid');
  assert.ok(!result.missing.includes('location'));
  assert.ok(!result.missing.includes('date'));
  assert.ok(result.missing.includes('budget'));
  assert.ok(!result.suggestions.some(item => /Tokyo|hotel|\d{4}/i.test(item.term)));
});

test('research query offers source quality as an optional facet', () => {
  const result = analyze('Find research papers on quantum gravity');
  assert.equal(result.subject, 'quantum gravity');
  assert.ok(result.suggestions.some(item => /peer.reviewed|primary sources/i.test(item.term)));
  assert.ok(result.suggestions.every(item => item.source.type !== 'model'));
});

test('unknown subjects remain literal and receive no unrelated domain facets', () => {
  const result = analyze('flibbertigibbet');
  assert.equal(result.subject, 'flibbertigibbet');
  assert.deepEqual(result.suggestions, []);
  assert.ok(!/phone|travel|astronomy/i.test(result.summary));
});

test('bike requests separate the noun phrase from price and intended uses', () => {
  const result = analyze('affordable electric mountain bike for commuting and weekend trails');
  assert.equal(result.subject, 'electric mountain bike');
  assert.ok(findTerm(result.properties, 'affordable'));
  assert.ok(findTerm(result.aspects, 'commuting'));
  assert.ok(findTerm(result.aspects, 'weekend trails'));
  assert.ok(result.suggestions.some(item => /range|terrain/i.test(item.term)));
});

test('a rejected subject does not activate its domain facets', () => {
  const result = analyze('not a phone; find a travel guide');
  assert.ok(!/phone/i.test(result.subject));
  assert.ok(!result.suggestions.some(item => /camera|battery|operating system/i.test(item.term)));
  assert.equal(findTerm(result.properties, 'phone').mode, 'avoid');
});

test('quoted time travel research does not activate vacation facets', () => {
  const result = analyze('"time travel" research');
  assert.equal(result.subject, 'time travel');
  assert.ok(!result.missing.includes('location'));
  assert.ok(!result.suggestions.some(item => /destination|travel dates|transport/i.test(item.term)));
});

test('empty and question-only input contain no invented subject or refinements', () => {
  for (const query of ['', '   ', 'Can you find me something?']) {
    const result = analyze(query);
    assert.equal(result.subject, '');
    assert.deepEqual(result.suggestions, []);
  }
});

test('quoted expressions survive as phrases and duplicate words are not repeated', () => {
  const result = analyze('Find "quantum gravity" quantum gravity');
  assert.equal(result.subject, 'quantum gravity');
  const built = build('"quantum gravity" "quantum gravity" -"string theory"');
  assert.equal(built.providerQuery, '"quantum gravity" -"string theory"');
  assert.deepEqual(built.constraints.avoid, ['string theory']);
});

test('Unicode subjects and matching record facets retain their characters', () => {
  const result = analyze('日本語 検索', {documents: [{id: 'jp', title: '日本語 検索', tags: ['形態素解析'], text: '非公開の長い記録'}]});
  assert.equal(result.subject, '日本語 検索');
  assert.ok(findTerm(result.suggestions, '形態素解析'));
  assert.equal(build('cafe\u0301 café').providerQuery, 'café');
});

test('only matching records can supply contextual terms and source metadata stays bounded', () => {
  const result = analyze('vector embeddings', {documents: [
    {id: 'matched', title: 'Vector embeddings', tags: ['cosine similarity'], text: 'PRIVATE_NOTE_SENTINEL '.repeat(80)},
    {id: 'unrelated', title: 'Holiday recipes', tags: ['sourdough'], text: 'unrelated'}
  ]});
  const suggestion = findTerm(result.suggestions, 'cosine similarity');
  assert.equal(suggestion.source.type, 'record');
  assert.equal(suggestion.source.recordId, 'matched');
  assert.ok(!findTerm(result.suggestions, 'sourdough'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_NOTE_SENTINEL'));
});

test('matching titles can supply short contextual phrases without disclosing note bodies', () => {
  const result = analyze('vector embeddings', {documents: [{id: 'matched', title: 'Vector embeddings with cosine similarity', text: 'private account number 123456'}]});
  assert.ok(findTerm(result.suggestions, 'cosine similarity'));
  assert.ok(!JSON.stringify(result).includes('123456'));
});

test('accepted choices retain their provenance and do not reappear as suggestions', () => {
  const accepted = [{id: 'battery-choice', label: 'Long battery life', term: 'battery life', kind: 'property', mode: 'prefer', source: {type: 'record', recordId: 'a'}}];
  const snapshot = structuredClone(accepted);
  const result = analyze('phone', {accepted});
  assert.ok(!result.suggestions.some(item => item.term === 'battery life'));
  const built = build('phone', accepted);
  assert.deepEqual(built.accepted, accepted);
  assert.deepEqual(accepted, snapshot);
  assert.deepEqual(built.constraints.prefer, ['battery life']);
  assert.match(built.providerQuery, /"battery life"/);
  assert.equal(build('phone', []).providerQuery, 'phone');
});

test('unselected suggestions never affect the provider query', () => {
  analyze('phone');
  assert.equal(build('phone').providerQuery, 'phone');
  assert.deepEqual(build('phone').constraints.must, []);
});

test('minus exclusions suppress record and facet suggestions including duplicates', () => {
  const result = analyze('phone -camera', {documents: [{id: 'a', title: 'Phone', tags: ['camera', 'battery life', 'battery life'], text: 'Phone battery life'}]});
  assert.ok(!findTerm(result.suggestions, 'camera'));
  assert.equal(result.suggestions.filter(item => item.term === 'battery life').length, 1);
  assert.ok(result.properties.some(item => item.term === 'camera' && item.mode === 'avoid'));
});

test('accepted exclusions suppress later positive suggestions and provider contradictions', () => {
  const accepted = [{id: 'no-camera', label: 'Avoid camera', term: 'camera', kind: 'property', mode: 'avoid'}, {id: 'camera', label: 'Camera', term: 'camera', kind: 'aspect', mode: 'aspect'}];
  assert.ok(!findTerm(analyze('phone', {accepted}).suggestions, 'camera'));
  const built = build('phone', accepted);
  assert.deepEqual(built.constraints.avoid, ['camera']);
  assert.deepEqual(built.constraints.aspects, []);
  assert.equal(built.providerQuery, 'phone -camera');
});

test('builder maps explicit goals and constraint chips into structured search inputs', () => {
  const built = build('phone', [
    {id: 'budget', term: 'under $500', mode: 'must'},
    {id: 'battery', term: 'battery life', mode: 'prefer'},
    {id: 'camera', term: 'camera', mode: 'aspect'}
  ], {goal: 'compare options', scope: 'web', avoid: 'refurbished'});
  assert.deepEqual(built.constraints.must, []);
  assert.deepEqual(built.semanticConstraints.must, ['under $500']);
  assert.deepEqual(built.constraints.prefer, ['battery life']);
  assert.deepEqual(built.constraints.aspects, ['camera']);
  assert.deepEqual(built.constraints.avoid, ['refurbished']);
  assert.equal(built.constraints.goal, 'compare options');
  assert.equal(built.constraints.scope, 'web');
  assert.match(built.humanQuery, /phone.*under \$500.*battery life.*camera/);
  assert.match(built.providerQuery, /-refurbished/);
});

test('quoted provider operators remain data and do not activate unintended operators', () => {
  const built = build('phone', [{term: 'camera" OR site:private.example', mode: 'must'}]);
  assert.ok(!built.providerQuery.includes(' OR '));
  assert.ok(!built.providerQuery.includes('site:private.example'));
  assert.ok(built.constraints.must.includes('camera" OR site:private.example'));
});

test('numeric no-more-than wording is a price constraint rather than a negated word', () => {
  const result = analyze('phone no more than $500');
  assert.ok(findTerm(result.properties, 'no more than $500'));
  assert.ok(!result.properties.some(item => item.mode === 'avoid'));
  assert.deepEqual(build('phone no more than $500').semanticConstraints.must, ['no more than $500']);
});

test('accessory and compound subjects do not activate unrelated purchase or travel facets', () => {
  for (const query of ['phone case', 'mountain bike helmet', 'travel mug']) {
    const result = analyze(query);
    assert.equal(result.subject, query);
    assert.deepEqual(result.suggestions, []);
  }
});

test('a manual bicycle query does not invent a battery requirement', () => {
  const result = analyze('mountain bike');
  assert.ok(!result.suggestions.some(item => /battery/i.test(item.term)));
});

test('literal query properties and aspects enter structured constraints without duplicated provider text', () => {
  const built = build('phone under $500 with good battery life');
  assert.deepEqual(built.semanticConstraints.must, ['under $500']);
  assert.deepEqual(built.semanticConstraints.prefer, ['good battery life']);
  assert.deepEqual(built.constraints.must, []);
  assert.deepEqual(built.constraints.prefer, []);
  assert.equal(built.providerQuery.split('under').length - 1, 1);
});

test('record evidence supports ambiguity questions instead of silently resolving a meaning', () => {
  const result = analyze('black hole', {documents: [
    {id: 'space', title: 'Black holes', tags: ['astronomy'], text: 'Hawking radiation'},
    {id: 'ui', title: 'Black hole interface', tags: ['software theme'], text: 'interface animation'}
  ]});
  const astronomy = findTerm(result.suggestions, 'astronomy');
  assert.equal(astronomy.kind, 'ambiguity');
  assert.equal(astronomy.source.recordId, 'space');
  assert.equal(findTerm(result.suggestions, 'software theme').kind, 'ambiguity');
  assert.ok(!result.suggestions.some(item => item.term === 'holes'));
});

test('contradictory accepted refinements stay removable and are reported as conflicts', () => {
  const selected = [{id: 'camera-choice', term: 'camera', mode: 'must', source: {type: 'facet'}}];
  const built = build('phone -camera', selected);
  assert.deepEqual(built.accepted, selected);
  assert.deepEqual(built.constraints.must, []);
  assert.equal(built.conflicts[0].term, 'camera');
  assert.deepEqual(built.conflicts[0].excludedBy, ['camera']);
});

test('comma-separated prices remain complete values', () => {
  const result = analyze('phone under $1,200');
  assert.ok(findTerm(result.properties, 'under $1,200'));
  assert.deepEqual(build('phone under $1,200').semanticConstraints.must, ['under $1,200']);
});

test('hyphenated negated meanings remain a single excluded expression', () => {
  const result = analyze('Fuzzball research not black-hole physics');
  assert.equal(result.subject, 'Fuzzball');
  assert.equal(findTerm(result.properties, 'black-hole physics').mode, 'avoid');
  assert.ok(!result.suggestions.some(item => /Hawking|astronomy/i.test(item.term)));
});

test('a travel use does not replace a mug subject', () => {
  const result = analyze('ceramic coffee mug for travel');
  assert.equal(result.subject, 'ceramic coffee mug travel');
  assert.deepEqual(result.suggestions, []);
});

test('deeply frozen caller data remains unchanged and analysis is deterministic', () => {
  const source = Object.freeze({type: 'record', recordId: 'frozen'});
  const accepted = Object.freeze([Object.freeze({id: 'frozen', term: 'battery life', mode: 'prefer', source})]);
  const documents = Object.freeze([Object.freeze({id: 'a', title: 'Phone', tags: Object.freeze(['camera']), text: 'phone battery life'})]);
  const options = {accepted, documents};
  assert.deepEqual(analyze('phone', options), analyze('phone', options));
  assert.deepEqual(build('phone', accepted).accepted, accepted);
});

test('private notes, learned records, and private origins cannot supply external contextualizations', () => {
  const result = analyze('vector embeddings', {documents: [
    {id: 'note', kind: 'note', title: 'Vector embeddings', tags: ['SECRET_NOTE_CONTEXT']},
    {id: 'learned', kind: 'learned', title: 'Vector embeddings', tags: ['SECRET_LEARNED_CONTEXT']},
    {id: 'origin', kind: 'web', privacyOrigin: 'private-note', title: 'Vector embeddings', tags: ['SECRET_ORIGIN_CONTEXT']},
    {id: 'public', kind: 'web', title: 'Vector embeddings', tags: ['cosine similarity']}
  ]});
  assert.ok(findTerm(result.suggestions, 'cosine similarity'));
  assert.ok(!JSON.stringify(result).includes('SECRET_'));
});

test('numeric accepted budgets stay in the provider query without becoming literal must filters', () => {
  const built = build('phone', [{term: 'under $500', mode: 'must', dimension: 'budget'}]);
  assert.deepEqual(built.constraints.must, []);
  assert.deepEqual(built.semanticConstraints.must, ['under $500']);
  assert.match(built.providerQuery, /under \$500/);
});
