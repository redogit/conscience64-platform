import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('./memory.mjs').catch(() => ({}));
const KEY = 'conscience64.spaceLensMemory.v1';
function call(name, ...args) {
  assert.equal(typeof api[name], 'function', `${name} API must be available`);
  return api[name](...args);
}
function storageFor(value) {
  const values = new Map(value ? [[KEY, JSON.stringify(value)]] : []);
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value))};
}
const base = () => ({schema: 'conscience64/space-lens-memory/v1', version: 1, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', queries: {}, teachings: {}, aliases: {}, sourceVotes: {}, selections: []});

test('default state and storage key preserve the original v1 memory contract', () => {
  const storage = storageFor();
  const state = call('readMemory', storage);
  assert.equal(state.schema, 'conscience64/space-lens-memory/v1');
  assert.equal(state.version, 1);
  assert.deepEqual(state.queries, {});
  assert.deepEqual(state.teachings, {});
  assert.deepEqual(state.aliases, {});
  assert.deepEqual(state.sourceVotes, {});
  assert.deepEqual(state.selections, []);
  call('teachMemory', 'What is Orbit?', 'A bounded navigation layer.', {storage});
  assert.equal(JSON.parse(storage.getItem(KEY)).teachings['what is orbit'].authority, 'LOCAL_USER_TAUGHT');
});

test('teaching retains legacy normalized keys, shapes, limits, and creation time', () => {
  const state = base();
  state.teachings['what is cafe'] = {question: 'Old question', answer: 'Old answer', note: 'old note', authority: 'LOCAL_USER_TAUGHT', createdAt: state.createdAt, updatedAt: state.updatedAt};
  const storage = storageFor(state);
  const taught = call('teachMemory', ' What is Café? ', 'x'.repeat(13000), {storage});
  assert.equal(taught.question, 'What is Café?');
  assert.equal(taught.answer.length, 12000);
  assert.equal(taught.note, '');
  assert.equal(taught.createdAt, '2025-01-01T00:00:00.000Z');
  assert.ok(taught.updatedAt > taught.createdAt);
  assert.equal(Object.keys(call('readMemory', storage).teachings).length, 1);
});

test('aliases retain target text and use the original accent-insensitive keys', () => {
  const storage = storageFor();
  call('rememberAlias', '  CAFÉ library  ', 'orbit-library', {storage});
  assert.equal(call('readMemory', storage).aliases['cafe library'], 'orbit-library');
});

test('feedback records the caller answer and original helpful-history fields', () => {
  const storage = storageFor();
  const first = call('feedbackMemory', 'What is Orbit?', 'A local answer.', true, {storage});
  assert.equal(first.question, 'What is Orbit?');
  assert.equal(first.count, 1);
  assert.equal(first.helpful, 1);
  assert.equal(first.notHelpful, 0);
  assert.equal(first.lastAnswer, 'A local answer.');
  assert.equal(first.lastFeedback, 'helpful');
  assert.ok(first.lastAsked && first.lastFeedbackAt);
  const next = call('feedbackMemory', 'What is Orbit?', 'x'.repeat(4100), false, {storage});
  assert.equal(next.helpful, 1);
  assert.equal(next.notHelpful, 1);
  assert.equal(next.lastFeedback, 'not-helpful');
  assert.equal(next.lastAnswer.length, 4000);
});

test('source selections preserve source IDs and normalized query history', () => {
  const storage = storageFor();
  call('selectMemory', 'What is Café?', 'orbit-library', {storage});
  call('selectMemory', 'What is Café?', 'orbit-library', {storage});
  const state = call('readMemory', storage);
  assert.equal(state.sourceVotes['orbit-library'], 2);
  assert.equal(state.selections[0].query, 'what is cafe');
  assert.equal(state.selections[0].sourceId, 'orbit-library');
  assert.ok(state.selections[0].at);
});

test('legacy memory remains readable and callers cannot mutate persisted state through returned objects', () => {
  const state = base();
  state.aliases.old = 'orbit';
  state.sourceVotes.orbit = 5;
  const storage = storageFor(state);
  const result = call('readMemory', storage);
  result.aliases.old = 'changed';
  assert.equal(call('readMemory', storage).aliases.old, 'orbit');
  assert.equal(call('readMemory', storage).sourceVotes.orbit, 5);
});

test('invalid saved schema falls back to v1 and Unicode-only teaching remains usable', () => {
  const storage = storageFor({schema: 'bad', teachings: {bad: {answer: 'wrong'}}});
  assert.deepEqual(call('readMemory', storage).teachings, {});
  call('teachMemory', '日本語 検索', '形態素解析を使います。', {storage});
  assert.equal(call('readMemory', storage).teachings['日本語 検索'].answer, '形態素解析を使います。');
});

test('restricted-origin objects are rejected while explicit raw user text remains valid', () => {
  const storage = storageFor();
  const restricted = {answer: 'Imported answer', privacyOrigin: {classification: 'private-history-method-only'}};
  assert.throws(() => call('teachMemory', 'Question', restricted, {storage}), /restricted/i);
  assert.throws(() => call('feedbackMemory', 'Question', restricted, true, {storage}), /restricted/i);
  assert.throws(() => call('rememberAlias', 'Alias', restricted, {storage}), /restricted/i);
  call('teachMemory', 'What does private-history-method-only mean?', 'Raw text explicitly supplied by the user.', {storage});
  assert.ok(Object.values(call('readMemory', storage).teachings).some(item => item.answer === 'Raw text explicitly supplied by the user.'));
});

test('restricted existing origin markers cannot be lifted by corrections or helpful feedback', () => {
  const state = base();
  const origin = {classification: 'private-history-method-only', publicationAllowed: false};
  state.teachings.question = {question: 'Question', answer: 'old', privacyOrigin: origin, createdAt: state.createdAt};
  const storage = storageFor(state);
  assert.throws(() => call('teachMemory', 'Question', 'User correction', {storage}), /independent.*reground/i);
  assert.throws(() => call('feedbackMemory', 'Question', 'User answer', true, {storage}), /independent.*reground/i);
  const result = call('readMemory', storage);
  assert.deepEqual(result.teachings.question.privacyOrigin, origin);
  assert.equal(result.teachings.question.answer, 'old');
  assert.deepEqual(result.queries, {});
});

test('selection and query histories obey the original bounded limits', () => {
  const state = base();
  state.selections = Array.from({length: 600}, (_, index) => ({query: 'old', sourceId: String(index), at: state.updatedAt}));
  for (let index = 0; index < 250; index++) state.queries[`old ${index}`] = {question: `old ${index}`, lastAsked: state.updatedAt};
  const storage = storageFor(state);
  call('selectMemory', 'new', 'new-source', {storage});
  call('feedbackMemory', 'new', 'answer', true, {storage});
  const result = call('readMemory', storage);
  assert.equal(result.selections.length, 600);
  assert.equal(result.selections.at(-1).sourceId, 'new-source');
  assert.equal(Object.keys(result.queries).length, 250);
  assert.ok(result.queries.new);
});

test('reserved object keys remain user data without changing object prototypes', () => {
  const storage = storageFor();
  call('teachMemory', '__proto__', 'answer', {storage});
  call('rememberAlias', '__proto__', 'target', {storage});
  call('selectMemory', 'Question', '__proto__', {storage});
  const result = call('readMemory', storage);
  assert.ok(Object.hasOwn(result.teachings, '__proto__'));
  assert.equal(result.teachings.__proto__.answer, 'answer');
  assert.equal(result.aliases.__proto__, 'target');
  assert.equal(result.sourceVotes.__proto__, 1);
  assert.equal({}.answer, undefined);
});

test('unavailable device storage has an isolated local fallback without network or DOM access', () => {
  const blocked = {getItem() {throw Error('blocked');}, setItem() {throw Error('blocked');}};
  call('teachMemory', 'Local question', 'Local answer', {storage: blocked});
  assert.equal(call('readMemory', blocked).teachings['local question'].answer, 'Local answer');
  assert.deepEqual(call('readMemory', storageFor()).teachings, {});
});

test('snake-case and nested restricted markers cannot disappear in replacement records', () => {
  for (const marker of [
    {privacy_origin: {classification: 'private-history-method-only'}},
    {derived_from_private_history: true},
    {raw: {metadata: {publication_allowed: false, requires_independent_regrounding: true}}}
  ]) {
    const state = base();
    state.queries.question = {question: 'Question', lastAnswer: 'restricted answer', ...marker};
    const storage = storageFor(state);
    assert.throws(() => call('teachMemory', 'Question', 'Replacement', {storage}), /independent.*reground/i);
    assert.throws(() => call('feedbackMemory', 'Question', 'Replacement', true, {storage}), /independent.*reground/i);
    assert.deepEqual(call('readMemory', storage).queries.question, state.queries.question);
  }
});

test('write-only quota failures keep new local teachings readable in the fallback', () => {
  const saved = base();
  const storage = {getItem: () => JSON.stringify(saved), setItem() {throw Error('quota');}};
  call('teachMemory', 'Question', 'Local answer', {storage});
  assert.equal(call('readMemory', storage).teachings.question.answer, 'Local answer');
});
