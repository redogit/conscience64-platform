/** Local-only successor helpers for SpaceLensMemory v1. No DOM or network work.
 * readMemory(storage?) returns a detached state. Mutation helpers accept explicit
 * raw text and {storage?}; teaching/feedback return the saved record, alias returns
 * its target, and selection returns the new vote count. Storage failures use an
 * isolated in-memory fallback, matching the original browser memory behavior.
 * Existing restricted records require independent regrounding before replacement;
 * tagged objects cannot become raw text.
 */
import {hasRestrictedOrigin} from './search-service.mjs';

export const MEMORY_KEY = 'conscience64.spaceLensMemory.v1';
export const MEMORY_SCHEMA = 'conscience64/space-lens-memory/v1';
const MAX_QUERIES = 250, MAX_SELECTIONS = 600;
const fallbacks = new WeakMap();
const unsaved = new WeakSet();
let fallback = null;
const now = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
const put = (object, key, value) => Object.defineProperty(object, key, {value, writable: true, configurable: true, enumerable: true});
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
const fresh = () => ({schema: MEMORY_SCHEMA, version: 1, createdAt: now(), updatedAt: now(), queries: {}, teachings: {}, aliases: {}, sourceVotes: {}, selections: []});

/** Exact legacy ASCII/accent normalization, with a Unicode-only fallback. */
export function normalizeMemory(question) {
  const input = typeof question === 'string' ? question : '';
  const legacy = input.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9:_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  return legacy || (input.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}_:-]+/gu) || []).join(' ');
}
function deviceStorage(provided) {
  if (provided !== undefined) return provided && typeof provided === 'object' ? provided : null;
  try {return globalThis.localStorage || null;} catch {return null;}
}
function localState(storage) {
  if (storage) return fallbacks.get(storage) || fresh();
  return fallback || fresh();
}
function retain(storage, state) {
  if (storage) fallbacks.set(storage, clone(state));
  else fallback = clone(state);
}
function valid(state) {
  return plain(state) && state.schema === MEMORY_SCHEMA && (state.version === undefined || state.version === 1) && plain(state.queries) && plain(state.teachings) && plain(state.sourceVotes);
}
export function readMemory(provided) {
  const storage = deviceStorage(provided);
  if (storage && unsaved.has(storage)) return clone(localState(storage));
  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(MEMORY_KEY) || 'null');
      if (valid(saved)) {
        const state = {...saved, version: 1, aliases: plain(saved.aliases) ? saved.aliases : {}, selections: Array.isArray(saved.selections) ? saved.selections : []};
        retain(storage, state);
        return clone(state);
      }
    } catch {}
  }
  return clone(localState(storage));
}
function saveMemory(state, provided) {
  const storage = deviceStorage(provided);
  state.updatedAt = now();
  retain(storage, state);
  if (storage) {try {storage.setItem(MEMORY_KEY, JSON.stringify(state)); unsaved.delete(storage);} catch {unsaved.add(storage);}}
  return clone(state);
}
function raw(value, name) {
  if (hasRestrictedOrigin(value)) throw new TypeError('Restricted-origin objects cannot be entered as local user text.');
  if (typeof value !== 'string') throw new TypeError(`${name} must be explicitly supplied raw text.`);
  return value.trim();
}
function optionsFor(options) {
  if (options == null) return {};
  if (!plain(options)) throw new TypeError('Memory options must be an object.');
  const {storage, ...metadata} = options;
  if (hasRestrictedOrigin(metadata)) throw new TypeError('Restricted-origin objects cannot be imported into local user memory.');
  return options;
}
function trim(state) {
  state.queries = Object.fromEntries(Object.entries(state.queries).sort((a, b) => String(b[1]?.lastAsked || '').localeCompare(String(a[1]?.lastAsked || ''))).slice(0, MAX_QUERIES));
  state.selections = state.selections.slice(-MAX_SELECTIONS);
}
function inheritedOrigin(state, key) {
  const teaching = own(state.teachings, key), query = own(state.queries, key);
  return teaching?.privacyOrigin ?? query?.privacyOrigin;
}
function writable(state, key) {
  if (hasRestrictedOrigin({teaching: own(state.teachings, key), query: own(state.queries, key)})) throw new TypeError('Existing restricted-origin memory requires independent regrounding before replacement or feedback.');
}

export function teachMemory(question, answer, options = {}) {
  const settings = optionsFor(options), query = raw(question, 'Question'), taught = raw(answer, 'Answer'), key = normalizeMemory(query);
  if (!key || !taught) throw new TypeError('Question and taught answer are required.');
  const state = readMemory(settings.storage), prior = own(state.teachings, key), origin = inheritedOrigin(state, key);
  writable(state, key);
  const record = {question: query, answer: taught.slice(0, 12000), note: '', createdAt: prior?.createdAt || now(), updatedAt: now(), authority: 'LOCAL_USER_TAUGHT'};
  if (origin != null) record.privacyOrigin = clone(origin);
  put(state.teachings, key, record);
  return saveMemory(state, settings.storage).teachings[key];
}
export function rememberAlias(alias, target, options = {}) {
  const settings = optionsFor(options), key = normalizeMemory(raw(alias, 'Alias')), value = raw(target, 'Alias target');
  if (!key || !value) return null;
  const state = readMemory(settings.storage);
  put(state.aliases, key, value);
  saveMemory(state, settings.storage);
  return value;
}
export function feedbackMemory(question, answer, helpful, options = {}) {
  const settings = optionsFor(options), query = raw(question, 'Question'), value = raw(answer, 'Answer'), key = normalizeMemory(query);
  if (!key) return null;
  if (![true, false, 'helpful', 'not-helpful'].includes(helpful)) throw new TypeError('Feedback must be helpful or not-helpful.');
  const feedback = helpful === true || helpful === 'helpful' ? 'helpful' : 'not-helpful';
  const state = readMemory(settings.storage), prior = own(state.queries, key), origin = inheritedOrigin(state, key), at = now();
  writable(state, key);
  const record = {...(plain(prior) ? prior : {}), question: query, count: count(prior?.count) + 1, helpful: count(prior?.helpful), notHelpful: count(prior?.notHelpful), lastAsked: at, lastAnswer: value.slice(0, 4000), lastFeedback: feedback, lastFeedbackAt: at};
  if (feedback === 'helpful') record.helpful++;
  else record.notHelpful++;
  if (origin != null) record.privacyOrigin = clone(origin);
  put(state.queries, key, record);
  trim(state);
  return saveMemory(state, settings.storage).queries[key];
}
export function selectMemory(query, sourceId, options = {}) {
  const settings = optionsFor(options), key = normalizeMemory(raw(query, 'Question')), id = raw(sourceId, 'Source ID');
  if (!key || !id) return null;
  const state = readMemory(settings.storage), votes = Math.min(Number.MAX_SAFE_INTEGER, count(own(state.sourceVotes, id)) + 1);
  put(state.sourceVotes, id, votes);
  state.selections.push({query: key, sourceId: id, at: now()});
  trim(state);
  saveMemory(state, settings.storage);
  return votes;
}
