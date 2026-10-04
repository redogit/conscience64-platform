// Local order-3 character Markov model, constrained to observed vocabulary.
// Completed preceding words add a bigram prior; scores are relative, not confidence.
const words = text => [...String(text||'').normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map(m=>m[0]);
export const EVERYDAY_WORDS = [
 'electric bike battery bicycle commuting trail mountain cargo range removable charging maintenance budget lightweight',
 'electric vehicle power electrical electronics heating',
 'phone camera battery screen storage android laptop computer keyboard software programming code',
 'home repair cooking recipe dinner food garden plant travel trip hotel train flight weekend weather',
 'research science paper study history language music book learn lesson project physics quantum gravity black hole',
 'compare find explain how best affordable reliable safe accessible budget price cost location date recent local source'
];
export function activeWord(query,caret=String(query).length){
 query=String(query);caret=Math.max(0,Math.min(query.length,caret??query.length));
 for(const m of query.matchAll(/[\p{L}\p{M}\p{N}]+/gu))if(m.index<caret&&caret<=m.index+m[0].length)return{start:m.index,end:m.index+m[0].length,prefix:query.slice(m.index,caret),word:m[0]};
 return{start:caret,end:caret,prefix:'',word:''};
}
export function replaceActiveWord(query,word,caret=String(query).length){
 query=String(query);const span=activeWord(query,caret);
 return{query:query.slice(0,span.start)+word+query.slice(span.end),caret:span.start+word.length};
}
export function createWordPredictor(texts=[]){
 const vocabulary=new Map(),transitions=new Map(),pairs=new Map();
 const increment=(map,key)=>map.set(key,(map.get(key)||0)+1);
 function add(texts){for(const text of texts||[]){const tokens=words(String(text).slice(0,30000));for(let i=0;i<tokens.length;i++){
  const word=tokens[i];if(word.length>48||/^\d+$/u.test(word))continue;increment(vocabulary,word);if(i)increment(pairs,tokens[i-1]+'\0'+word);
  const letters=[...('^^^'+word+'$')];for(let j=3;j<letters.length;j++){const state=letters.slice(j-3,j).join('');if(!transitions.has(state))transitions.set(state,new Map());increment(transitions.get(state),letters[j]);}
 }}}
 add(texts);
 return Object.freeze({add,suggest(query,{caret=String(query).length,limit=6}={}){
  const span=activeWord(query,caret),prefix=words(span.prefix)[0];if(!prefix)return[];
  const previous=words(String(query).slice(0,span.start)).at(-1)||'';
  return [...vocabulary].filter(([word])=>word.startsWith(prefix)&&word!==prefix).map(([word,count])=>{
   const letters=[...('^^^'+word+'$')];let score=Math.log1p(count)+3*Math.log1p(pairs.get(previous+'\0'+word)||0);
   for(let j=3+[...prefix].length;j<letters.length;j++){const next=transitions.get(letters.slice(j-3,j).join('')),total=next?[...next.values()].reduce((a,b)=>a+b,0):0;score+=.35*Math.log(((next?.get(letters[j])||0)+.5)/(total+.5*((next?.size||0)+1)));}
   return{word,score,method:'character-markov+word-bigram'};
  }).sort((a,b)=>b.score-a.score||a.word.localeCompare(b.word)).slice(0,Math.max(0,Math.min(12,limit)));
 }});
}
