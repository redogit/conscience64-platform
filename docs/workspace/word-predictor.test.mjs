import test from 'node:test';
import assert from 'node:assert/strict';

// Regression targets: unrelated completions, losing typed text, and context-blind ranking.
const module = await import('./word-predictor.mjs').catch(()=>({}));
test('local character Markov completion preserves the typed prefix and uses previous words',()=>{
 assert.equal(typeof module.createWordPredictor,'function');
 const model=module.createWordPredictor(['electric bike battery','electric bike battery','electric bike basket','fruit basket','fruit basket','fruit basket']);
 const options=model.suggest('electric bike ba');
 assert.equal(options[0].word,'battery');
 assert.ok(options.every(x=>x.word.startsWith('ba')&&Number.isFinite(x.score)));
 assert.equal(model.suggest('fruit ba')[0].word,'basket');
 assert.deepEqual(model.suggest('xyznotaword'),[]);
});
test('completion replaces only the active word, including mid-sentence and Unicode input',()=>{
 assert.equal(typeof module.replaceActiveWord,'function');
 assert.deepEqual(module.replaceActiveWord('electric bi for trails','bike',11),{query:'electric bike for trails',caret:13});
 assert.deepEqual(module.replaceActiveWord('café él','électrique'),{query:'café électrique',caret:15});
 assert.equal(module.replaceActiveWord('bike "bat" -cheap','battery',9).query,'bike "battery" -cheap');
});
test('training accepts additions without sending queries or generating unknown words',()=>{
 assert.equal(typeof module.createWordPredictor,'function');
 const model=module.createWordPredictor(['bike']);
 model.add(['bicycle bicycle']);
 assert.equal(model.suggest('bicy')[0].word,'bicycle');
 assert.deepEqual(model.suggest(''),[]);
});
