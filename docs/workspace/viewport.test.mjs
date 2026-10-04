import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('./viewport.mjs');
test('text pages preserve every character while bounding wrapped lines',()=>{
 assert.equal(typeof module.splitTextPages,'function');
 const text='World 世界\n'+('long-unbroken-value'.repeat(40))+'\n\nLast line';
 const pages=module.splitTextPages(text,12,3);
 assert.equal(pages.join(''),text);
 assert.ok(pages.length>5);
 for(const page of pages)assert.ok([...page].length<=36);
 assert.deepEqual(module.splitTextPages('',12,3),['']);
});
