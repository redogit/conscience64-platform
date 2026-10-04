// A single analytic scene is translated into both shader languages so the
// event horizon keeps the same identity on WebGPU and WebGL2.
const field = String.raw`
const PI: f32 = 3.14159265359;
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}
fn curve(a: vec2f, b: vec2f, c: vec2f, t: f32) -> vec2f {
  let s: f32 = 1.0 - t;
  return s * s * a + 2.0 * s * t * b + t * t * c;
}
fn shade(pixel: vec2f) -> vec3f {
  let resolution: vec2f = screen.xy;
  let time: f32 = screen.z;
  let activity: f32 = screen.w;
  let radius: f32 = hole.z;
  let p: vec2f = (pixel - hole.xy) / radius;
  let r: f32 = length(p);
  let angle: f32 = atan2(p.y, p.x);
  let ice: vec3f = vec3f(0.88, 0.88, 0.88);
  let cyan: vec3f = vec3f(0.35, 0.35, 0.35);
  let gold: vec3f = vec3f(0.85, 0.08, 0.12);
  var color: vec3f = vec3f(0.003, 0.003, 0.003);
  let nebula: f32 = exp(-dot(p * vec2f(0.43, 0.75), p * vec2f(0.43, 0.75)));
  color += vec3f(0.012, 0.012, 0.012) * nebula;
  // Sparse, fixed stars: there is no random geometry or temporal flicker.
  let cell: vec2f = floor(pixel / 64.0);
  let local: vec2f = fract(pixel / 64.0);
  let seed: f32 = hash(cell);
  let starAt: vec2f = vec2f(hash(cell + vec2f(18.0)), hash(cell + vec2f(71.0))) * 0.78 + 0.11;
  let starDistance: f32 = length(local - starAt);
  let star: f32 = exp(-starDistance * starDistance * 11000.0) * pow(seed, 10.0);
  color += ice * star * 0.33;
  if (r < 3.8) {
    let atmosphere: f32 = exp(-pow((r - 1.22) / 0.62, 2.0));
    color += mix(cyan, ice, 0.17) * atmosphere * 0.063;
    let tilted: vec2f = vec2f(p.x * 0.994 + p.y * 0.109, p.y * 0.994 - p.x * 0.109);
    let ellipse: f32 = length(vec2f(tilted.x, tilted.y / 0.265));
    let bandAngle: f32 = atan2(tilted.y / 0.265, tilted.x);
    let bandTexture: f32 = 0.63 + 0.22 * sin(ellipse * 92.0 - time * 0.34 + sin(bandAngle * 7.0) * 4.0) + 0.15 * sin(ellipse * 153.0 + bandAngle * 18.0 + time * 0.18);
    let band: f32 = exp(-pow((ellipse - 1.80) / 0.62, 2.0)) * max(0.12, bandTexture);
    let bandTint: vec3f = mix(gold, ice, smoothstep(-1.3, 1.4, p.x));
    color += bandTint * band * 0.32 * smoothstep(1.02, 1.15, r);
    // Fine accretion filaments curve around the opaque horizon. The varying
    // flattening makes lens-like arches instead of a stack of flat ellipses.
    for (var i: i32 = 0; i < 38; i = i + 1) {
      let n: f32 = f32(i);
      let seedLine: f32 = fract(n * 0.61803398875);
      let flattening: f32 = 0.33 + seedLine * 0.54;
      let q: vec2f = vec2f(tilted.x, tilted.y / flattening);
      let a: f32 = atan2(q.y, q.x);
      let orbit: f32 = 1.12 + n * 0.033;
      let warp: f32 = 0.021 * sin(a * 3.0 + n * 1.7 + time * 0.035) + 0.010 * sin(a * 7.0 - n * 0.81);
      let delta: f32 = length(q) - orbit - warp;
      let width: f32 = 0.0020 + seedLine * 0.0015;
      let core: f32 = exp(-delta * delta / (width * width));
      let glow: f32 = exp(-delta * delta / 0.00034) * 0.075;
      let stream: f32 = 0.30 + 0.70 * pow(0.5 + 0.5 * sin(a * 2.0 + n * 1.83 - time * (0.10 + seedLine * 0.05)), 2.0);
      let edge: f32 = smoothstep(1.015, 1.055, r);
      let tint: vec3f = mix(gold, ice, 0.28 + 0.70 * seedLine);
      color += tint * (core * 0.48 + glow) * stream * edge;
    }
    // The slim photon ring has a bright ice edge and a wider cyan halo.
    let ringDelta: f32 = r - 1.015;
    let ringHot: f32 = exp(-ringDelta * ringDelta / 0.000037);
    let ringHalo: f32 = exp(-ringDelta * ringDelta / 0.0017);
    let brightness: f32 = 0.50 + 0.46 * pow(0.5 + 0.5 * cos(angle + 0.60), 2.0);
    color += ice * ringHot * brightness * (2.4 + activity * 0.25);
    color += mix(cyan, gold, 0.20) * ringHalo * 0.25;
    let outerEdge: f32 = exp(-pow((r - 1.078) / 0.007, 2.0));
    color += ice * outerEdge * 0.13;
    if (r < 0.996) {
      color = vec3f(0.0002, 0.0002, 0.0002);
      color += cyan * pow(r, 16.0) * 0.001;
    }
  }
  // Each exact input word owns one graceful quadratic strand. A short bright
  // head travels down it once, then settles at the matching HTML word bubble.
  if (hole.w > 0.0) {
    for (var i: i32 = 0; i < 12; i = i + 1) {
      if (f32(i) < min(hole.w, 12.0)) {
        let first: vec4f = paths[i * 2];
        let second: vec4f = paths[i * 2 + 1];
        let a: vec2f = (first.xy - hole.xy) / radius;
        let b: vec2f = (first.zw - hole.xy) / radius;
        let c: vec2f = (second.xy - hole.xy) / radius;
        let lower: vec2f = min(min(a,b),c) - vec2f(0.04);
        let upper: vec2f = max(max(a,b),c) + vec2f(0.04);
        if (p.x >= lower.x && p.y >= lower.y && p.x <= upper.x && p.y <= upper.y) {
        let advance: f32 = second.z;
        let lineSeed: f32 = second.w;
        let direction: vec2f = c - a;
        var t: f32 = clamp(dot(p - a, direction) / max(dot(direction, direction), 0.001), 0.0, 1.0);
        let secondDerivative: vec2f = 2.0 * (a - 2.0 * b + c);
        for (var iteration: i32 = 0; iteration < 3; iteration = iteration + 1) {
          let onCurve: vec2f = curve(a, b, c, t);
          let derivative: vec2f = 2.0 * ((b - a) * (1.0 - t) + (c - b) * t);
          let denominator: f32 = dot(derivative, derivative) + dot(onCurve - p, secondDerivative);
          t = clamp(t - dot(onCurve - p, derivative) / max(denominator, 0.001), 0.0, advance);
        }
        let distance: f32 = length(p - curve(a,b,c,t));
        let headDistance: f32 = length(p - curve(a,b,c,advance));
        let tail: f32 = smoothstep(advance - 0.42, advance, t);
        let settled: f32 = smoothstep(0.96, 1.0, advance);
        let thin: f32 = exp(-distance * distance / 0.000018) * (0.04 + tail * 0.20) * (1.0 - settled * 0.75);
        let head: f32 = exp(-headDistance * headDistance / 0.00017) * (1.0 - settled * 0.85);
        color += mix(ice,gold,lineSeed * 0.45) * (thin + head * 1.35) * smoothstep(0.01,0.08,advance) * smoothstep(0.996,1.015,r);
        }
      }
    }
  }
  let vignette: f32 = 1.0 - 0.30 * pow(length((pixel / resolution - vec2f(0.5)) * vec2f(1.0, 0.8)), 2.0);
  color *= vignette;
  return vec3f(1.0) - exp(-color * 1.28);
}
`;
function toGLSL(source) {
  return source
    .replace(/fn\s+(\w+)\(([^)]*)\)\s*->\s*(\w+)\s*\{/g, (_, name, args, result) => `${result} ${name}(${args.replace(/(\w+)\s*:\s*(\w+)/g, '$2 $1')}) {`)
    .replace(/\b(?:let|var|const)\s+(\w+)\s*:\s*(\w+)\s*=/g, '$2 $1 =')
    .replace(/\bvec2f\b/g, 'vec2').replace(/\bvec3f\b/g, 'vec3').replace(/\bvec4f\b/g, 'vec4')
    .replace(/\bf32\b/g, 'float').replace(/\bi32\b/g, 'int').replace(/\batan2\b/g, 'atan');
}
export const GLSL_VERTEX = `#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}`;
export const GLSL_FRAGMENT = `#version 300 es\nprecision highp float;uniform vec4 screen;uniform vec4 hole;uniform vec4 paths[24];out vec4 outputColor;\n${toGLSL(field)}\nvoid main(){outputColor=vec4(shade(vec2(gl_FragCoord.x,screen.y-gl_FragCoord.y)),1.0);}`;
export const WGSL = `struct Scene { screen: vec4f, hole: vec4f, paths: array<vec4f,24> };\n@group(0) @binding(0) var<uniform> u: Scene;\n${field.replace(/\bscreen\b/g,'u.screen').replace(/\bhole\b/g,'u.hole').replace(/\bpaths\b/g,'u.paths')}\n@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { var p=vec2f(-1.0,-1.0); if(index==1u){p=vec2f(3.0,-1.0);} if(index==2u){p=vec2f(-1.0,3.0);} return vec4f(p,0.0,1.0); }\n@fragment fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f { return vec4f(shade(pixel.xy),1.0); }`;
