// The query stays exact; the renderer only bounds the amount of visible geometry.
export const MAX_WORD_TRAILS = 12;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const tokensFor = query => String(query ?? '').match(/\S+/gu) ?? [];
export function layoutScene(viewWidth, viewHeight) {
  const width = Math.max(1, finite(viewWidth, 1));
  const height = Math.max(1, finite(viewHeight, 1));
  const mobile = width < 700;
  return { width, height, centerX: width * .5, centerY: height * (mobile ? .30 : .36), radius: Math.max(.1, Math.min(width * (mobile ? .28 : .20), height * (mobile ? .16 : .22))), mobile: Number(mobile) };
}
function hashWord(word, index) {
  let hash = 2166136261 ^ index;
  for (const char of word) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0) / 4294967295;
}
function pointOnCurve(start, control, end, t) {
  const s = 1 - t;
  return { x: s * s * start.x + 2 * s * t * control.x + t * t * end.x, y: s * s * start.y + 2 * s * t * control.y + t * t * end.y };
}
export function createSceneModel() {
  let entries = [], anchor = null, explicitTargets = [], typing = false;
  return {
    get words() { return entries.map(entry => entry.word); },
    setQuery(query, time = 0) {
      const next = tokensFor(query);
      entries = next.map((word,index) => {
        const previous = entries[index];
        const edited = previous && (word.startsWith(previous.word) || previous.word.startsWith(word));
        return edited ? { ...previous, word } : { word, born: finite(time,0), seed: hashWord(word,index) };
      });
    },
    setActivity(value) { typing = Boolean(value); },
    setAnchor(value) {
      anchor = value && ['x','y','width','height'].every(key => Number.isFinite(value[key])) ? { ...value } : null;
    },
    setWordTargets(value) {
      explicitTargets = Array.isArray(value) ? value.slice(0, MAX_WORD_TRAILS).map(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null) : [];
    },
    sample(time, layout, reducedMotion = false) {
      const count = Math.min(entries.length, MAX_WORD_TRAILS);
      const targetY = anchor ? anchor.y + anchor.height * .5 : layout.height * (layout.mobile ? .49 : .60);
      const targetCenter = anchor ? anchor.x + anchor.width * .5 : layout.width * .5;
      const estimatedWidths = entries.slice(0,count).map(entry => clamp([...entry.word].length * (layout.mobile ? 6 : 7) + 28, 40, layout.mobile ? 92 : 124));
      const gap = layout.mobile ? 8 : 12;
      const naturalWidth = estimatedWidths.reduce((sum,width) => sum + width, 0) + Math.max(0,count - 1) * gap;
      const available = Math.max(1,Math.min(anchor?.width ?? layout.width * .82, naturalWidth));
      const scale = naturalWidth > 0 ? Math.min(1,available / naturalWidth) : 1;
      let offset = targetCenter - naturalWidth * scale * .5;
      const trails = entries.slice(0,count).map((entry,index) => {
        const width = estimatedWidths[index] * scale;
        const end = explicitTargets[index] ?? { x: offset + width * .5, y: targetY };
        offset += width + gap * scale;
        const angle = .35 + entry.seed * 2.45;
        const start = { x: layout.centerX + Math.cos(angle) * layout.radius * 1.08, y: layout.centerY + Math.sin(angle) * layout.radius * .94 };
        const control = { x: start.x + (end.x - start.x) * .10 + (entry.seed - .5) * layout.radius * .7, y: Math.max(start.y,end.y) + layout.radius * (.16 + entry.seed * .22) };
        const linear = reducedMotion ? 1 : clamp((finite(time,0) - entry.born) / (1.25 + entry.seed * .35), 0, 1);
        const progress = linear * linear * (3 - 2 * linear);
        return { word: entry.word, seed: entry.seed, start, control, end: { ...end }, progress, head: pointOnCurve(start,control,end,progress) };
      });
      return { trails, activity: typing ? 1 : 0, wordCount: entries.length };
    }
  };
}
