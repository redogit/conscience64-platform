import assert from 'node:assert/strict';
import { initializeRenderer } from './renderer.mjs';
function browser({ reduced = false, gpu } = {}) {
  let draws = 0, nextFrame = 1;
  const frames = new Map(), document = new EventTarget(), window = new EventTarget(), motion = new EventTarget();
  motion.matches = reduced;
  document.hidden = false;
  document.documentElement = { dataset: {} };
  document.getElementById = () => null;
  const gradient = { addColorStop() {} };
  const context2d = new Proxy({}, { get: (_,key) => key === 'createRadialGradient' ? () => gradient : key === 'fillRect' ? () => draws++ : () => {}, set: () => true });
  class Canvas extends EventTarget {
    width = 1; height = 1;
    getBoundingClientRect() { return { width: 1440, height: 900 }; }
    cloneNode() { return new Canvas(); }
    replaceWith(value) { document.canvas = value; }
    getContext(type) { return type === '2d' ? context2d : type === 'webgpu' && gpu ? gpu.context : null; }
  }
  document.canvas = new Canvas();
  Object.assign(globalThis,{ document, window, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 3, matchMedia: () => motion, requestAnimationFrame: fn => { const id=nextFrame++;frames.set(id,fn);return id; }, cancelAnimationFrame: id => frames.delete(id), GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 } });
  Object.defineProperty(globalThis,'navigator',{ configurable: true, value: { gpu: gpu?.api } });
  return { document, motion, frames, get draws() { return draws; }, frame(time) { const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time)); } };
}
function deferred() { let resolve; const promise=new Promise(done=>resolve=done);return { promise,resolve }; }
function fakeGPU(pipeline = Promise.resolve({ getBindGroupLayout: () => ({}) }), workDone = Promise.resolve()) {
  const loss=deferred();let destroyed=0, submitted=0;
  const device = { lost: loss.promise, destroy() { destroyed++; }, createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), createRenderPipelineAsync: () => pipeline, createBuffer: () => ({ destroy() {} }), createBindGroup: () => ({}), queue: { writeBuffer() {},submit() { submitted++; },onSubmittedWorkDone() { return workDone; } }, createCommandEncoder: () => ({ beginRenderPass: () => ({ setPipeline() {},setBindGroup() {},draw() {},end() {} }),finish: () => ({}) }) };
  const context = { configure() {},unconfigure() {},getCurrentTexture: () => ({ createView: () => ({}) }) };
  return { api: { requestAdapter: async () => ({ requestDevice: async () => device }),getPreferredCanvasFormat: () => 'rgba8unorm' },context,loss,get submitted() { return submitted; },get destroyed() { return destroyed; } };
}
{
  const env=browser();const renderer=await initializeRenderer(env.document.canvas);
  assert.equal(renderer.backend,'Canvas2D fallback');
  env.frame(100);assert.equal(env.document.canvas.width,2880,'device pixel ratio is capped at two');
  const drawn=env.draws;env.frame(116);assert.equal(env.draws,drawn,'rendering never exceeds 30fps');
  env.frame(134);assert.ok(env.draws > drawn);
  env.document.hidden=true;env.document.dispatchEvent(new Event('visibilitychange'));assert.equal(env.frames.size,0,'hidden tabs suspend animation');
  renderer.setQuery('exact words');assert.equal(env.frames.size,0);
  env.document.hidden=false;env.document.dispatchEvent(new Event('visibilitychange'));assert.equal(env.frames.size,1);
  renderer.destroy();assert.equal(env.frames.size,0);
  env.document.dispatchEvent(new Event('visibilitychange'));assert.equal(env.frames.size,0,'destroyed renderers cannot schedule more work');
}
{
  const env=browser({reduced:true});const renderer=await initializeRenderer(env.document.canvas);env.frame(100);
  assert.equal(env.frames.size,0,'reduced motion draws once instead of keeping an animation loop');
  assert.equal(env.document.documentElement.dataset.motion,'reduced');
  renderer.setQuery('静かな 空');assert.equal(env.frames.size,1);env.frame(150);assert.equal(env.frames.size,0);renderer.destroy();
}
{
  const pipeline=deferred(),gpu=fakeGPU(pipeline.promise),env=browser({gpu});
  const renderer=await initializeRenderer(env.document.canvas);
  assert.equal(renderer.backend,'Canvas2D fallback','stalled GPU initialization settles into a visible fallback');
  assert.equal(gpu.destroyed,1,'timed-out GPU releases its device while compilation is still stalled');
  pipeline.resolve({ getBindGroupLayout: () => ({}) });await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(gpu.destroyed,1,'late GPU initialization releases its abandoned device');
  assert.equal(renderer.backend,'Canvas2D fallback','late initialization cannot replace the active fallback');renderer.destroy();
}
{
  const gpu=fakeGPU(),env=browser({gpu});const renderer=await initializeRenderer(env.document.canvas);assert.equal(renderer.backend,'WebGPU');
  gpu.loss.resolve({ reason: 'unknown' });await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(renderer.backend,'Canvas2D fallback','device loss restores a visible renderer');assert.equal(gpu.destroyed,1);renderer.destroy();
}
{
  const work=deferred(),gpu=fakeGPU(undefined,work.promise),env=browser({gpu});const renderer=await initializeRenderer(env.document.canvas);
  env.frame(100);env.frame(134);assert.equal(gpu.submitted,1,'a slow GPU may only have one pending frame');
  work.resolve();await Promise.resolve();env.frame(168);assert.equal(gpu.submitted,2,'drawing resumes after the pending frame completes');renderer.destroy();
}
console.log('PASS frame limit, DPR cap, hidden suspension, reduced motion, cleanup, GPU timeout and device loss recovery');
