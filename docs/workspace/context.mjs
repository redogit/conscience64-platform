/**
 * Deterministic, browser-safe query contextualization. No network, model calls, or
 * automatic acceptance. `source.type` distinguishes literal query evidence,
 * matching record evidence, and optional, hand-authored domain facets.
 *
 * analyzeQuery(query, {documents = [], accepted = []}) returns a literal subject,
 * properties/aspects (chips already stated or accepted), optional suggestions,
 * a short summary, missing dimension names, and method: 'rules+records'.
 * Every chip has {id,label,term,kind,mode,reason,source}; source is an object.
 *
 * buildSearchQuery(query, accepted = [], goal = {}) returns
 * {query,humanQuery,providerQuery,constraints,semanticConstraints,accepted,conflicts}.
 * constraints has lexical must/prefer/avoid/aspects plus goal/scope. Query-stated
 * properties/aspects and concrete price/date/place choices go in semanticConstraints
 * (must/prefer/aspects), never hard exact-text filters. Only the user's query,
 * accepted choices, and explicit goal fields enter providerQuery. `prefer` is a ranking
 * intent; generic providers cannot guarantee weighted or required-term syntax.
 * Accepted objects are copied with their metadata; inputs are never mutated.
 */

const text = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
const key = value => text(value).toLocaleLowerCase();
const words = value => key(value).match(/[\p{L}\p{M}\p{N}_]+/gu) || [];
const unique = values => [...new Map(values.filter(Boolean).map(value => [key(value), value])).values()];
const STOP = new Set('a an the and or of for from to in on at by with about into as is are be can could would should do does did me my i we us you your please find finding search searching look looking show give tell explain recommend compare help need want get plan planning something anything only papers paper studies study research evidence information info sources source articles article'.split(' '));
const REQUEST = new Set('can could would should you me my i we us your please find finding search searching look looking show give tell explain recommend compare help need want get plan planning'.split(' '));
const MODES = new Set(['must', 'prefer', 'avoid', 'aspect']);
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const NEGATIVE_PHRASES = ['black hole physics', 'Hawking radiation', 'black holes', 'black hole', 'battery life', 'string theory', 'software theme', 'time travel', 'quantum gravity'];

function idFor(term, mode) {
  let hash = 2166136261;
  for (const char of key(term)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return `context-${mode}-${(hash >>> 0).toString(36)}`;
}
function chip(term, kind, mode, reason, source, label = term) {
  return {id: idFor(term, mode), label, term, kind, mode, reason, source};
}
function queryChip(term, kind = 'property', mode = 'must', dimension) {
  const item = chip(term, kind, mode, 'Stated in your query.', {type: 'query', text: term});
  if (dimension) item.dimension = dimension;
  return item;
}
function acceptedChips(accepted) {
  return (Array.isArray(accepted) ? accepted : []).flatMap(value => {
    if (typeof value === 'string') return text(value) ? [chip(text(value), 'aspect', 'aspect', 'Selected by you.', {type: 'query'})] : [];
    if (!value || typeof value !== 'object' || !text(value.term)) return [];
    // Preserve caller provenance and other metadata. Do not rewrite accepted IDs.
    return [{...value, term: text(value.term), mode: MODES.has(value.mode) ? value.mode : 'aspect', ...(value.source && typeof value.source === 'object' ? {source: {...value.source}} : {})}];
  });
}
function contains(haystack, needle) {
  const hay = words(haystack), term = words(needle);
  if (!term.length) return false;
  return hay.some((_, index) => term.every((word, offset) => hay[index + offset] === word));
}
function blocked(term, exclusions) {
  return exclusions.some(exclusion => contains(term, exclusion));
}

/** Quotes stay atomic. Natural-language negation only applies to its next
 * expression, never to the rest of the query; quoted negations stay literal. */
function parseQuery(query) {
  const input = text(query), atoms = [];
  const expression = /(-?)(?:"((?:\\.|[^"\\])*)"|“([^”]*)”|([$€£¥]?\d[\d,.]*(?![\p{L}\p{N}_–—-])|[^\s,;!?()]+))/gu;
  for (const match of input.matchAll(expression)) {
    const quoted = match[2] !== undefined || match[3] !== undefined;
    const term = text((match[2] ?? match[3] ?? match[4] ?? '').replace(/\\"/g, '"').replace(/^[.,:]+|[.,:]+$/g, ''));
    if (term) atoms.push({term, quoted, negative: match[1] === '-', start: match.index, end: match.index + match[0].length});
  }
  const excluded = [], omitted = new Set();
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (atom.negative) { excluded.push(atom.term); omitted.add(index); continue; }
    if (atom.quoted || !/^(?:not|no|without|excluding|except)$/i.test(atom.term)) continue;
    if (key(atom.term) === 'not' && key(atoms[index + 1]?.term) === 'only') continue;
    if (/^(?:no|not) more than\s+[$€£¥]?\s*\d/i.test(atoms.slice(index, index + 5).map(item => item.term).join(' '))) continue;
    let next = index + 1;
    while (next < atoms.length && /^(?:a|an|the|any|interested|in|about)$/i.test(atoms[next].term)) next++;
    if (next >= atoms.length) { omitted.add(index); continue; }
    let count = 1;
    if (!atoms[next].quoted) {
      const tail = words(atoms.slice(next).map(item => item.term).join(' ')).join(' ');
      const phrase = NEGATIVE_PHRASES.find(value => tail.startsWith(words(value).join(' ')));
      if (phrase) {
        count = 0;
        let matchedWords = 0;
        while (next + count < atoms.length && matchedWords < words(phrase).length) matchedWords += words(atoms[next + count++].term).length;
      }
    }
    excluded.push(atoms.slice(next, next + count).map(item => item.term).join(' '));
    for (let position = index; position < next + count; position++) omitted.add(position);
    index = next + count - 1;
  }
  const exclusions = unique(excluded);
  const positive = atoms.filter((atom, index) => !omitted.has(index) && !blocked(atom.term, exclusions));
  return {input, positive, exclusions, positiveText: positive.map(atom => atom.term).join(' ')};
}

function collectMatches(input, regex, kind, mode, dimension, output, removed) {
  for (const match of input.matchAll(regex)) {
    const term = text(match[1] ?? match[0]);
    if (!term) continue;
    output.push(queryChip(term, kind, mode, dimension));
    removed.push(term);
  }
}
function pickDomain(input, accepted, exclusions) {
  const positive = `${input} ${accepted.filter(item => item.mode !== 'avoid').map(item => item.term).join(' ')}`;
  const physical = /\b(?:astronomy|astrophysics|Hawking|radiation|spacetime|singularity|physics)\b/i.test(positive) && !blocked('astronomy', exclusions) && !blocked('physics', exclusions);
  const software = /\b(?:software|interface|theme|ui|app|code|game|rendering)\b/i.test(positive) && !blocked('software', exclusions);
  if (/\bblack[ -]+holes?\b/i.test(input)) return {name: 'black-hole', physical, software, ambiguous: physical === software};
  if (/\b(?:phones?|smartphones?|iPhones?)\b/i.test(input) && !/\b(?:phone|smartphone|iphone)s?\s+(?:cases?|covers?|chargers?|repairs?|plans?|numbers?|calls?)\b|\b(?:cases?|covers?|chargers?|repairs?|plans?)\s+for\s+(?:a\s+)?(?:phone|smartphone|iphone)\b/i.test(input)) return {name: 'phone'};
  if (/\b(?:bikes?|bicycles?|e-bikes?)\b/i.test(input) && !/\b(?:bike|bicycle)s?\s+(?:helmets?|locks?|racks?|repairs?)\b/i.test(input)) return {name: 'bike', electric: /\b(?:electric|e-bike|ebike)\b/i.test(positive)};
  if (/\b(?:trip|travel|vacation|itinerary|holiday)\b/i.test(input) && !/\btime travel\b|\btravel\s+(?:mugs?|adapters?|pillows?|bags?)\b|\b(?:mugs?|adapters?|pillows?|bags?|phones?|laptops?)\s+(?:for|when)\s+(?:travel|traveling|vacation)\b/i.test(input)) return {name: 'travel'};
  if (/\b(?:research|papers?|studies|peer.reviewed|evidence|sources)\b/i.test(input)) return {name: 'research'};
  return {name: ''};
}
function literalSubject(parsed, domain, removed) {
  let remainder = parsed.positiveText;
  for (const phrase of [...removed].sort((a, b) => b.length - a.length)) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    remainder = remainder.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'), ' ');
  }
  if (domain.name === 'phone') return remainder.match(/\b(?:mobile\s+)?(?:smartphones?|phones?|iPhones?)\b/i)?.[0] || '';
  if (domain.name === 'bike') return remainder.match(/\b(?:electric\s+)?(?:mountain\s+)?(?:bikes?|bicycles?|e-bikes?)\b/i)?.[0] || '';
  if (domain.name === 'black-hole') return remainder.match(/\bblack[ -]+holes?\b/i)?.[0] || '';
  if (domain.name === 'travel') return remainder.match(/\b(?:travel guide|trip|travel|vacation|itinerary|holiday)\b/i)?.[0] || '';
  const quoted = parsed.positive.filter(atom => atom.quoted && !removed.some(term => key(term) === key(atom.term)));
  const quotedWords = new Set(quoted.flatMap(atom => words(atom.term)));
  const residualWords = (remainder.match(/[\p{L}\p{M}\p{N}_'-]+/gu) || []).filter(word => !STOP.has(key(word)) && !quotedWords.has(key(word)));
  return unique([...quoted.map(atom => atom.term), ...unique(residualWords)]).join(' ');
}

const FACETS = {
  phone: [
    ['budget', 'Budget range?', 'question', 'aspect', 'budget'],
    ['battery life', 'Battery life', 'property', 'prefer', 'battery'],
    ['camera', 'Camera quality', 'property', 'prefer', 'camera'],
    ['operating system', 'Operating system?', 'question', 'aspect', 'platform'],
    ['screen size', 'Screen size', 'property', 'prefer', 'screen']
  ],
  bike: [
    ['budget', 'Budget range?', 'question', 'aspect', 'budget'],
    ['battery range', 'Battery range', 'property', 'prefer', 'range'],
    ['terrain', 'Terrain and trail difficulty?', 'question', 'aspect', 'terrain'],
    ['weight', 'Weight', 'property', 'prefer', 'weight'],
    ['commuting', 'Commuting', 'aspect', 'aspect', 'use']
  ],
  travel: [
    ['destination', 'Which destination?', 'question', 'aspect', 'location'],
    ['travel dates', 'When are you traveling?', 'question', 'aspect', 'date'],
    ['budget', 'Travel budget?', 'question', 'aspect', 'budget'],
    ['transport', 'Transport preferences?', 'question', 'aspect', 'transport'],
    ['activities', 'Preferred activities?', 'question', 'aspect', 'activities']
  ],
  research: [
    ['primary sources', 'Primary sources', 'aspect', 'prefer', 'sources'],
    ['peer-reviewed', 'Peer-reviewed work', 'aspect', 'prefer', 'sources'],
    ['publication date', 'Publication period?', 'question', 'aspect', 'date'],
    ['methods', 'Research methods', 'aspect', 'aspect', 'methods']
  ],
  astronomy: [
    ['Hawking radiation', 'Hawking radiation', 'aspect', 'aspect', 'phenomenon'],
    ['event horizon', 'Event horizon', 'aspect', 'aspect', 'structure'],
    ['observational evidence', 'Observational evidence', 'aspect', 'prefer', 'evidence'],
    ['theoretical models', 'Theoretical models', 'aspect', 'aspect', 'approach']
  ],
  software: [
    ['interaction design', 'Interaction design', 'aspect', 'aspect', 'design'],
    ['animation', 'Animation', 'aspect', 'aspect', 'animation'],
    ['accessibility', 'Accessibility', 'property', 'prefer', 'accessibility'],
    ['implementation', 'Implementation', 'aspect', 'aspect', 'implementation']
  ]
};

function matchingRecords(documents, subject, domain, exclusions) {
  const focus = words(subject).filter(word => !STOP.has(word));
  if (!focus.length) return [];
  return (Array.isArray(documents) ? documents : []).filter(document => {
    if (!document || typeof document !== 'object') return false;
    if (['note', 'learned'].includes(key(document.kind)) || document.privacyOrigin) return false;
    const hay = [document.title, document.text, document.description, ...(Array.isArray(document.tags) ? document.tags : [])].map(text).join(' ');
    if (exclusions.some(term => contains(hay, term))) return false;
    const tokens = new Set(words(hay)), matches = focus.filter(word => tokens.has(word) || tokens.has(`${word}s`) || word.endsWith('s') && tokens.has(word.slice(0, -1))).length;
    const aliases = domain.name === 'phone' && /\b(?:phones?|smartphones?|iPhones?)\b/i.test(hay) || domain.name === 'black-hole' && /\bblack[ -]+holes?\b/i.test(hay);
    return matches >= Math.min(focus.length, 2) || aliases;
  }).slice(0, 12);
}
function recordCandidates(record, subject, domain) {
  const fields = [record.tags, record.keywords, record.topics, record.entities].flatMap(value => Array.isArray(value) ? value : []);
  const explicit = fields.map(value => typeof value === 'string' ? value : value?.name).filter(value => typeof value === 'string' && text(value).length <= 80).map(text);
  const title = text(record.title), focus = new Set(words(subject));
  const remainder = (title.match(/[\p{L}\p{M}\p{N}_'-]+/gu) || []).filter(word => !focus.has(key(word)) && !focus.has(`${key(word)}s`) && !(key(word).endsWith('s') && focus.has(key(word).slice(0, -1))) && !STOP.has(key(word)));
  // Titles and explicit metadata can yield short phrases; private note bodies
  // only confirm a bounded facet, and are never copied into a chip or reason.
  if (remainder.length && remainder.length <= 5 && !remainder.some(word => /^\d/u.test(word))) explicit.push(remainder.join(' '));
  const hay = [title, text(record.text), text(record.description)].join(' ');
  for (const [term] of FACETS[domain.name] || []) if (contains(hay, term)) explicit.push(term);
  return unique(explicit).filter(term => words(term).length <= 6 && words(term).length > 0);
}

export function analyzeQuery(query, {documents = [], accepted = []} = {}) {
  const parsed = parseQuery(query), selected = acceptedChips(accepted);
  const exclusions = unique([...parsed.exclusions, ...selected.filter(item => item.mode === 'avoid').map(item => item.term)]);
  const domain = pickDomain(parsed.positiveText, selected, exclusions);
  const properties = parsed.exclusions.map(term => queryChip(term, 'property', 'avoid'));
  const aspects = [], removed = [];
  const addProperty = (regex, mode, dimension) => collectMatches(parsed.positiveText, regex, 'property', mode, dimension, properties, removed);
  const addAspect = (regex, dimension) => collectMatches(parsed.positiveText, regex, 'aspect', 'aspect', dimension, aspects, removed);
  addProperty(/\b(?:under|below|less than|no more than|not more than|up to|at most|max(?:imum)?(?: budget)?(?: of)?|budget(?: of)?|around)\s*(?:[$€£¥]\s*)?\d[\d,.]*(?:\s*(?:USD|EUR|GBP|JPY|dollars?|euros?|pounds?))?/giu, 'must', 'budget');
  addProperty(/\b(?:affordable|cheap|inexpensive|premium)\b/giu, 'prefer', 'budget');
  if (domain.name === 'phone') {
    addProperty(/\b(?:(?:good|long|excellent|great|all-day)\s+)?battery(?:\s+life)?\b/giu, 'prefer', 'battery');
    addProperty(/\b(?:(?:good|excellent|great)\s+)?camera(?:\s+quality)?\b/giu, 'prefer', 'camera');
    addProperty(/\b(?:Android|iOS)\b/giu, 'must', 'platform');
  }
  if (domain.name === 'bike') {
    addAspect(/\b(?:commuting|weekend trails|trail riding|off-road)\b/giu, 'use');
  }
  if (domain.name === 'black-hole') {
    addAspect(/\b(?:Hawking radiation|astronomy|astrophysics|software interface|software|interface|theme|physics)\b/giu, 'meaning');
  }
  if (domain.name === 'travel') {
    const locationPattern = /\b(?:to|visiting|visit|destination\s*:)\s+([^,;!?]+?)(?=\s+(?:in|on|during|for|with|without|under|from|and|at|this|next|by)\b|[,;!?]|$)/giu;
    addProperty(locationPattern, 'must', 'location');
  }
  if (domain.name === 'travel' || domain.name === 'research') {
    addProperty(new RegExp(`\\b(?:\\d{1,2}(?:[–-]\\d{1,2})?\\s+)?${MONTH}(?:\\s+\\d{1,2}(?:[–-]\\d{1,2})?,?)?(?:\\s+\\d{4})?\\b`, 'giu'), 'must', 'date');
    addProperty(/\b\d{4}-\d{2}-\d{2}\b|\b(?:next|this)\s+(?:week|month|year|summer|winter|spring|autumn|fall)\b/giu, 'must', 'date');
  }
  for (const item of selected) {
    if (item.mode === 'aspect' || item.kind === 'aspect' || item.kind === 'ambiguity') aspects.push({...item});
    else properties.push({...item});
  }
  const subject = literalSubject(parsed, domain, removed);
  const dedup = items => [...new Map(items.filter(item => item.mode === 'avoid' || !blocked(item.term, exclusions)).map(item => [`${item.mode}:${key(item.term)}`, item])).values()];
  const propertyItems = dedup(properties), aspectItems = dedup(aspects);
  if (!subject) return {subject: '', properties: propertyItems, aspects: aspectItems, suggestions: [], summary: 'Enter a subject to explore.', missing: ['subject'], method: 'rules+records'};
  const known = [...propertyItems, ...aspectItems];
  const exists = term => known.some(item => contains(item.term, term) || contains(term, item.term));
  const suggestions = [], seen = new Set(), missing = [];
  const offer = item => {
    const termKey = key(item.term);
    if (!termKey || seen.has(termKey) || exists(item.term) || blocked(item.term, exclusions) || contains(subject, item.term)) return;
    seen.add(termKey); suggestions.push(item);
  };
  const records = matchingRecords(documents, subject, domain, exclusions);
  const facetSet = (domain.name === 'black-hole' ? domain.ambiguous ? [] : FACETS[domain.physical ? 'astronomy' : 'software'] : FACETS[domain.name] || []).filter(([term]) => !(domain.name === 'bike' && !domain.electric && term === 'battery range'));
  if (domain.name === 'black-hole' && domain.ambiguous) {
    missing.push('meaning');
    for (const [term, label, signal] of [['astronomy', 'Astronomy and physics?', /\b(?:astronomy|Hawking|physics|radiation)\b/i], ['software theme', 'Software, interface, or theme?', /\b(?:software|theme|interface|game)\b/i]]) {
      const evidence = records.find(record => signal.test([record.title, record.text, record.description].map(text).join(' ')));
      const source = evidence ? {type: 'record', recordId: text(evidence.id), title: text(evidence.title).slice(0, 90)} : {type: 'facet', domain: 'black-hole', dimension: 'meaning'};
      if (blocked(term, exclusions) || term === 'astronomy' && (blocked('physics', exclusions) || blocked('Hawking radiation', exclusions))) continue;
      offer(chip(term, 'ambiguity', 'aspect', 'Which meaning of “black hole” do you want to explore?', source, label));
    }
  }
  for (const record of records) {
    for (const term of recordCandidates(record, subject, domain)) {
      // An explicitly resolved black-hole meaning also filters cross-domain
      // record facets; records supply possibilities, never override user intent.
      if (domain.name === 'black-hole' && !domain.ambiguous && (domain.physical ? /\b(?:software|theme|game|interface)\b/i : /\b(?:astronomy|Hawking|physics|radiation)\b/i).test(term)) continue;
      offer(chip(term, 'aspect', 'aspect', 'Appears in a matching record; an optional focus, not an inferred requirement.', {type: 'record', recordId: text(record.id), title: text(record.title).slice(0, 90), recordKind: text(record.kind)}));
      if (suggestions.length >= 7 && facetSet.length) break;
    }
    if (suggestions.length >= 7 && facetSet.length) break;
  }
  for (const [term, label, kind, mode, dimension] of facetSet) {
    const present = known.some(item => item.dimension === dimension && item.mode !== 'avoid') || exists(term);
    if (kind === 'question' && !present) missing.push(dimension);
    if (!present) offer({...chip(term, kind, mode, `Optional ${domain.name === 'black-hole' ? domain.physical ? 'astronomy' : 'software' : domain.name} facet; choose it if relevant. No value was inferred.`, {type: 'facet', domain: domain.name, dimension}, label), dimension});
  }
  const summary = `${subject}${known.length ? ` · ${known.filter(item => item.mode !== 'avoid').map(item => item.label || item.term).join(' · ')}` : ''}${exclusions.length ? ` · avoiding ${exclusions.join(', ')}` : ''}. ${domain.ambiguous ? 'Choose a meaning to narrow this query.' : 'Choose optional context to refine the search.'}`.replace(/ · \./g, '.');
  return {subject, properties: propertyItems, aspects: aspectItems, suggestions: suggestions.slice(0, 12), summary, missing: unique(missing), method: 'rules+records'};
}

function constraintList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(',').map(text).filter(Boolean);
}
// Derived chip text is data, not provider syntax. Keep the precise original
// intent in structured constraints and neutralize operators in the text form.
function providerLiteral(term, forceQuote = false) {
  const literal = text(term).replace(/["“”\\]/g, ' ').replace(/:/g, ' ').replace(/\b(?:OR|AND|NOT)\b/g, value => value.toLowerCase()).replace(/\s+/g, ' ').trim();
  if (!literal) return '';
  return forceQuote || /\s/u.test(literal) ? `"${literal}"` : literal;
}
function compactAtoms(atoms, exclusions) {
  const output = [], seen = new Set(), phraseWords = new Set(atoms.filter(atom => atom.quoted).flatMap(atom => words(atom.term)));
  for (const atom of atoms) {
    const normalized = key(atom.term);
    if (seen.has(normalized) || blocked(atom.term, exclusions) || !atom.quoted && (REQUEST.has(normalized) || phraseWords.has(normalized))) continue;
    seen.add(normalized);
    output.push({term: atom.term, rendered: providerLiteral(atom.term, atom.quoted)});
  }
  return output.filter(atom => atom.rendered);
}
function semanticChoice(item) {
  return item.source?.type === 'query' && item.kind === 'property' ||
    ['date', 'location'].includes(item.dimension) && item.kind !== 'question' ||
    /(?:\b(?:under|below|less than|no more than|not more than|up to|at most|budget(?: of)?|around)\s*[$€£¥]?\s*\d|[$€£¥]\s*\d)/iu.test(item.term);
}

export function buildSearchQuery(query, accepted = [], goal = {}) {
  const parsed = parseQuery(query), selected = acceptedChips(accepted);
  const stated = analyzeQuery(query);
  const literal = [...stated.properties, ...stated.aspects].filter(item => item.source?.type === 'query' && item.mode !== 'avoid');
  const settings = typeof goal === 'string' ? {goal} : goal && typeof goal === 'object' ? goal : {};
  const semanticConstraints = {must: literal.filter(item => item.mode === 'must').map(item => item.term), prefer: literal.filter(item => item.mode === 'prefer').map(item => item.term), aspects: literal.filter(item => item.mode === 'aspect').map(item => item.term)};
  const constraints = {
    must: constraintList(settings.must), prefer: constraintList(settings.prefer),
    avoid: unique([...parsed.exclusions, ...constraintList(settings.avoid), ...selected.filter(item => item.mode === 'avoid').map(item => item.term)]),
    aspects: constraintList(settings.aspects), goal: text(settings.goal), scope: text(settings.scope) || 'all'
  };
  for (const item of selected) {
    if (item.mode !== 'avoid') (semanticChoice(item) ? semanticConstraints : constraints)[item.mode === 'aspect' ? 'aspects' : item.mode].push(item.term);
  }
  for (const mode of ['must', 'prefer', 'aspects']) {
    for (const term of constraints[mode].filter(term => semanticChoice({term}))) semanticConstraints[mode].push(term);
    constraints[mode] = constraints[mode].filter(term => !semanticChoice({term}));
  }
  const conflicts = ['must', 'prefer', 'aspects'].flatMap(mode => unique([...constraints[mode], ...semanticConstraints[mode]]).filter(term => blocked(term, constraints.avoid)).map(term => ({term, mode, excludedBy: constraints.avoid.filter(exclusion => contains(term, exclusion)), reason: 'An explicit exclusion takes precedence; the accepted chip is still available to remove.'})));
  for (const name of ['must', 'prefer', 'aspects']) {
    constraints[name] = unique(constraints[name]).filter(term => !blocked(term, constraints.avoid));
    semanticConstraints[name] = unique(semanticConstraints[name]).filter(term => !blocked(term, constraints.avoid));
  }
  const base = compactAtoms(parsed.positive, constraints.avoid);
  const refinements = unique([...constraints.must, ...semanticConstraints.must, ...constraints.prefer, ...semanticConstraints.prefer, ...constraints.aspects, ...semanticConstraints.aspects]);
  const additions = refinements.filter(term => !contains(base.map(atom => atom.term).join(' '), term));
  const providerQuery = [...base.map(atom => atom.rendered), ...additions.map(term => providerLiteral(term)), ...constraints.avoid.map(term => `-${providerLiteral(term)}`)].filter(Boolean).join(' ');
  const humanQuery = [...base.map(atom => atom.term), ...additions, ...(constraints.avoid.length ? [`excluding ${constraints.avoid.join(', ')}`] : [])].join(' ');
  return {query: parsed.input, humanQuery, providerQuery, constraints, semanticConstraints, accepted: selected, conflicts};
}
