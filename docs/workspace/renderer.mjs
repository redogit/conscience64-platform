import { createSceneModel, layoutScene, MAX_WORD_TRAILS } from './horizon-scene.mjs';
import { WGSL, GLSL_VERTEX, GLSL_FRAGMENT } from './horizon-shaders.mjs';

// A single animation owner and a shared analytic scene for all three backends.
export async function initializeRenderer(initialCanvas) {
  let canvas = initialCanvas, backend = 'Accessible fallback', render = null, release = () => {};
  let pendingDevice = null;
  const retiredDevices = new WeakSet();
  function retireDevice(device) { if (device && !retiredDevices.has(device)) { retiredDevices.add(device); device.destroy(); } }
  function retirePendingDevice() { retireDevice(pendingDevice); pendingDevice = null; }
  let destroyed = false, generation = 0, animation = 0, lastFrame = 0, sceneTime = 0, dirty = true;
  let width = 1, height = 1, dpr = 1, layout = layoutScene(1,1);
  const model = createSceneModel();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const uniforms = new Float32Array(8 + MAX_WORD_TRAILS * 8);
  let reduced = motion.matches;
  const eventCleanups = [];
  function listen(target, name, callback, options) {
    target.addEventListener(name,callback,options);
    eventCleanups.push(() => target.removeEventListener(name,callback,options));
  }
  function announce() {
    document.documentElement.dataset.renderer = backend;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    const label = document.getElementById('runtime');
    if (label) label.textContent = backend === 'Accessible fallback' ? 'Ready · standard display' : `Ready · ${backend}`;
  }
  function freshCanvas() {
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement);
    canvas = replacement;
  }
  function fit() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width || innerWidth || 1));
    height = Math.max(1, Math.round(rect.height || innerHeight || 1));
    dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
    const pixelWidth = Math.max(1,Math.round(width * dpr)), pixelHeight = Math.max(1,Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      dirty = true;
    }
    layout = layoutScene(width,height);
  }
  function pack(sample) {
    uniforms.fill(0);
    uniforms.set([canvas.width,canvas.height,reduced ? 0 : sceneTime,sample.activity]);
    uniforms.set([layout.centerX * dpr,layout.centerY * dpr,layout.radius * dpr,sample.trails.length],4);
    sample.trails.forEach((trail,index) => uniforms.set([
      trail.start.x * dpr,trail.start.y * dpr,trail.control.x * dpr,trail.control.y * dpr,
      trail.end.x * dpr,trail.end.y * dpr,trail.progress,trail.seed
    ],8 + index * 8));
  }
  async function webGPU(token) {
    if (!navigator.gpu) return false;
    let device = null, committed = false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter || token !== generation || destroyed) return false;
      device = await adapter.requestDevice();
      pendingDevice = device;
      if (token !== generation || destroyed) return false;
      const shader = device.createShaderModule({ code: WGSL });
      if (shader.getCompilationInfo) {
        const info = await shader.getCompilationInfo();
        if (info.messages.some(message => message.type === 'error')) throw new Error('Horizon shader unavailable');
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto', vertex: { module: shader, entryPoint: 'vertexMain' },
        fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
      });
      if (token !== generation || destroyed) return false;
      const context = canvas.getContext('webgpu');
      if (!context) return false;
      context.configure({ device, format, alphaMode: 'opaque' });
      const buffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
      let drawPending = false, redrawPending = false;
      render = () => {
        if (drawPending) { redrawPending = true; return; }
        device.queue.writeBuffer(buffer,0,uniforms);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0,bindings);
        pass.draw(3);
        pass.end();
        drawPending = true;
        device.queue.submit([encoder.finish()]);
        device.queue.onSubmittedWorkDone().then(() => {
          drawPending = false;
          if (redrawPending && !destroyed && token === generation) { redrawPending = false; dirty = true; schedule(); }
        }).catch(() => { if (!destroyed && token === generation) recover(); });
      };
      release = () => { buffer.destroy(); context.unconfigure(); retireDevice(device); };
      backend = 'WebGPU';
      committed = true;
      pendingDevice = null;
      device.lost.then(() => { if (!destroyed && token === generation) recover(); });
      return true;
    } finally {
      if (device && !committed) retireDevice(device);
      if (pendingDevice === device) pendingDevice = null;
    }
  }
  function webGL() {
    const gl = canvas.getContext('webgl2',{ alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return false;
    let vertex, fragment, program, buffer;
    function shader(type, source) {
      const value = gl.createShader(type);
      gl.shaderSource(value,source);
      gl.compileShader(value);
      if (!gl.getShaderParameter(value,gl.COMPILE_STATUS)) { gl.deleteShader(value); throw new Error('Horizon shader unavailable'); }
      return value;
    }
    try {
      vertex = shader(gl.VERTEX_SHADER,GLSL_VERTEX);
      fragment = shader(gl.FRAGMENT_SHADER,GLSL_FRAGMENT);
      program = gl.createProgram();
      gl.attachShader(program,vertex);
      gl.attachShader(program,fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Horizon program unavailable');
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program,'position');
      const screen = gl.getUniformLocation(program,'screen'), hole = gl.getUniformLocation(program,'hole'), paths = gl.getUniformLocation(program,'paths[0]');
      render = () => {
        gl.viewport(0,0,canvas.width,canvas.height);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        gl.uniform4fv(screen,uniforms.subarray(0,4));
        gl.uniform4fv(hole,uniforms.subarray(4,8));
        gl.uniform4fv(paths,uniforms.subarray(8));
        gl.drawArrays(gl.TRIANGLES,0,3);
      };
      release = () => { gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); };
      backend = 'WebGL2';
      listen(canvas,'webglcontextlost',event => { event.preventDefault(); if (!destroyed) recover(); });
      return true;
    } catch {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      // A context cannot change type on the same canvas.
      freshCanvas();
      return false;
    }
  }
  function canvas2D() {
    const ctx = canvas.getContext('2d',{ alpha: false });
    if (!ctx) { render = () => {}; backend = 'Accessible fallback'; return; }
    const stars = Array.from({length:180},(_,index) => {
      const seed = Math.sin(index * 127.1 + 311.7) * 43758.5453123;
      const x = seed - Math.floor(seed), next = Math.sin(index * 53.9 + 17.2) * 17312.2191;
      return { x, y: next - Math.floor(next), opacity: .04 + Math.pow(x,6) * .32, radius: .45 + x * .45 };
    });
    function orbit(radius, flattening, phase, warp = 0) {
      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const angle = i / 180 * Math.PI * 2;
        const ring = radius + warp * Math.sin(angle * 3 + phase) + warp * .5 * Math.sin(angle * 7 - phase);
        const x = Math.cos(angle) * ring, y = Math.sin(angle) * ring * flattening;
        const px = layout.centerX + x * .994 - y * .109, py = layout.centerY + y * .994 + x * .109;
        if (i === 0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.stroke();
    }
    render = sample => {
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#020508';
      ctx.fillRect(0,0,width,height);
      const glow = ctx.createRadialGradient(layout.centerX,layout.centerY,layout.radius * .7,layout.centerX,layout.centerY,layout.radius * 2.8);
      glow.addColorStop(0,'rgba(9,27,35,0)'); glow.addColorStop(.22,'rgba(20,59,73,.22)'); glow.addColorStop(.62,'rgba(5,26,37,.12)'); glow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.fillRect(0,0,width,height);
      for (const star of stars) { ctx.fillStyle = `rgba(195,224,236,${star.opacity})`; ctx.beginPath(); ctx.arc(star.x * width,star.y * height,star.radius,0,Math.PI * 2); ctx.fill(); }
      ctx.globalCompositeOperation = 'screen';
      ctx.shadowColor = 'rgba(107,209,232,.38)'; ctx.shadowBlur = 22;
      ctx.lineWidth = layout.radius * .08; ctx.strokeStyle = 'rgba(125,157,154,.14)'; orbit(layout.radius * 1.72,.265,0);
      for (let i = 0; i < 38; i++) {
        const seed = i * .61803398875 % 1;
        const alpha = .20 + seed * .30;
        ctx.lineWidth = .48 + seed * .34;
        ctx.strokeStyle = i % 7 < 2 ? `rgba(249,179,98,${alpha})` : `rgba(163,226,245,${alpha})`;
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 4 + seed * 3;
        orbit(layout.radius * (1.12 + i * .033),.33 + seed * .54,i * 1.7 + (reduced ? 0 : sceneTime * .035),layout.radius * .021);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
      ctx.fillStyle = '#000102'; ctx.beginPath(); ctx.arc(layout.centerX,layout.centerY,layout.radius * 1.008,0,Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'screen';
      ctx.shadowColor = '#72c7df'; ctx.shadowBlur = 15; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(130,214,239,.28)';
      ctx.beginPath(); ctx.arc(layout.centerX,layout.centerY,layout.radius * 1.015,0,Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 7; ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(214,247,255,.95)'; ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineWidth = .55; ctx.strokeStyle = 'rgba(177,230,243,.16)'; ctx.beginPath();ctx.arc(layout.centerX,layout.centerY,layout.radius * 1.078,0,Math.PI * 2);ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.rect(0,0,width,height); ctx.arc(layout.centerX,layout.centerY,layout.radius * .996,0,Math.PI * 2); ctx.clip('evenodd');
      for (const trail of sample.trails) {
        if (trail.progress < .01) continue;
        const fade = trail.progress >= .99 ? .08 : .38;
        ctx.strokeStyle = `rgba(176,233,247,${fade})`; ctx.lineWidth = .7;
        ctx.beginPath(); ctx.moveTo(trail.start.x,trail.start.y);
        for (let i = 1; i <= 40; i++) {
          const t = i / 40 * trail.progress, s = 1 - t;
          ctx.lineTo(s * s * trail.start.x + 2 * s * t * trail.control.x + t * t * trail.end.x,s * s * trail.start.y + 2 * s * t * trail.control.y + t * t * trail.end.y);
        }
        ctx.stroke();
        ctx.shadowColor = '#b3e7f6'; ctx.shadowBlur = trail.progress >= .99 ? 5 : 12;
        ctx.fillStyle = trail.progress >= .99 ? 'rgba(202,244,254,.35)' : 'rgba(225,251,255,.95)';
        ctx.beginPath(); ctx.arc(trail.head.x,trail.head.y,trail.progress >= .99 ? 1 : 1.7,0,Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    };
    release = () => {};
    backend = 'Canvas2D fallback';
  }
  function fallback() {
    if (!webGL()) canvas2D();
    announce();
    dirty = true;
  }
  function recover() {
    generation++;
    release();
    release = () => {};
    freshCanvas();
    fallback();
    schedule();
  }
  function frame(timestamp) {
    animation = 0;
    if (destroyed || document.hidden) return;
    if (!lastFrame || timestamp - lastFrame >= 1000 / 30 - .5) {
      if (lastFrame && !reduced) sceneTime += Math.min(.08,(timestamp - lastFrame) / 1000);
      lastFrame = timestamp;
      fit();
      const sample = model.sample(sceneTime,layout,reduced);
      pack(sample);
      try { render?.(sample); dirty = false; } catch { recover(); }
    }
    if (!reduced || dirty) schedule();
  }
  function schedule() {
    if (!animation && !destroyed && !document.hidden) animation = requestAnimationFrame(frame);
  }
  let timeout;
  const token = ++generation;
  try {
    const ready = await Promise.race([
      webGPU(token),
      new Promise(resolve => { timeout = setTimeout(() => { generation++; retirePendingDevice(); resolve(false); },2200); })
    ]);
    if (!ready) { if (generation === token) generation++; freshCanvas(); fallback(); }
  } catch { generation++; retirePendingDevice(); freshCanvas(); fallback(); }
  finally { clearTimeout(timeout); }
  announce();
  listen(window,'resize',() => { dirty = true; schedule(); });
  listen(document,'visibilitychange',() => {
    lastFrame = 0;
    if (document.hidden) { cancelAnimationFrame(animation); animation = 0; }
    else { dirty = true; schedule(); }
  });
  listen(motion,'change',event => { reduced = event.matches; announce(); dirty = true; lastFrame = 0; schedule(); });
  schedule();
  return {
    update(_items,_selectedId) { dirty = true; schedule(); },
    setQuery(query) { model.setQuery(query,sceneTime); dirty = true; schedule(); },
    setActivity(typing) { model.setActivity(typing); dirty = true; schedule(); },
    setAnchor(rect) { model.setAnchor(rect); dirty = true; schedule(); },
    setWordTargets(points) { model.setWordTargets(points); dirty = true; schedule(); },
    get backend() { return backend; },
    destroy() {
      if (destroyed) return;
      destroyed = true; generation++; retirePendingDevice();
      cancelAnimationFrame(animation); animation = 0;
      eventCleanups.forEach(cleanup => cleanup());
      release(); render = null;
    }
  };
}
