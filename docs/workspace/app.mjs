import {createWordPredictor,EVERYDAY_WORDS,replaceActiveWord,activeWord} from './word-predictor.mjs';
import {createMenuPager,watchViewport} from './viewport.mjs';
import {validate,documentFor,parseDocument} from './orbit-core.mjs';
import {analyzeQuery,buildSearchQuery} from './context.mjs';
import {createSearchService,loadCorpus,hasRestrictedOrigin,refineCandidates} from './search-service.mjs';
import {createRouteService} from './routes.mjs';
import {readMemory,teachMemory,rememberAlias,feedbackMemory,selectMemory} from './memory.mjs';

const KEY='conscience64.play.v1.orbit';
const SESSION='conscience64.workspace.session.v1';
const split=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
const safeURL=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}};
export async function mount(renderer){
 const $=id=>document.getElementById(id);
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
 const notice=text=>$('notice').textContent=text;
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
 let shelf={items:[]},history=[],accepted=[],analysis=null,queryTimer=null,composing=false;
 let goal={goal:'',must:'',prefer:'',avoid:'',scope:'all'},advanced={},providers=['wikipedia','openalex','crossref','archive','github'];
 let result=[],total=0,offset=0,selected=null,trigger=null,undo=null,active='',request=0,abort=null,web=[],webInfo=null,viewMode='local',backend='';
 let PAGE=3,queryPrefix='',contextPage=0,acceptedPage=0,proposalMode='auto',pendingDescriptor=null;
 const predictor=createWordPredictor(EVERYDAY_WORDS);
 const menuPager=createMenuPager($('drawer-body'),{previous:$('drawer-prev'),next:$('drawer-next'),status:$('drawer-page')});
 function queryText(){return queryPrefix+$('question').value}
 function setQueryText(value){queryPrefix='';$('question').value=String(value||'')}
 function capacity(){const area=$('main').clientHeight;const columns=innerWidth>=1000?3:innerWidth>=650?2:1;const rows=area>=540?2:1;document.documentElement.style.setProperty('--result-columns',columns);document.documentElement.style.setProperty('--result-rows',rows);document.documentElement.style.setProperty('--snippet-lines',area<260?1:3);return columns*rows;}

 try{const stored=read(KEY);if(stored)shelf=stored.schema?parseDocument(JSON.stringify(stored),'orbit'):validate('orbit',stored)}catch{notice('Saved library could not be read. Import a backup.');}
 const saved=read(SESSION);
 if(saved?.version===1){
  history=Array.isArray(saved.history)?saved.history.filter(x=>typeof x.query==='string').slice(0,30):[];
  if(saved.goal)for(const k of Object.keys(goal))if(typeof saved.goal[k]==='string')goal[k]=saved.goal[k];
  setQueryText(typeof saved.query==='string'?saved.query:'');
  accepted=Array.isArray(saved.accepted)?saved.accepted.filter(x=>x&&typeof x.term==='string'&&typeof x.id==='string').slice(0,20):[];
  if(Array.isArray(saved.providers))providers=saved.providers.filter(x=>['wikipedia','openalex','crossref','archive','github'].includes(x));
  if(saved.advanced&&typeof saved.advanced==='object'&&!Array.isArray(saved.advanced))advanced=saved.advanced;
 }
 function learnedItems(){
  const m=readMemory();
  const teachings=Object.entries(m.teachings||{}).filter(([,v])=>v&&typeof v.answer==='string'&&!hasRestrictedOrigin(v)).map(([id,v])=>({id:'learned:'+id,refId:id,title:v.question||id,text:v.answer,source:'',kind:'learned',authority:'LOCAL_USER_TAUGHT',provenance:'Local browser teaching'}));
  const useful=Object.entries(m.queries||{}).filter(([,v])=>v&&v.helpful>v.notHelpful&&typeof v.lastAnswer==='string'&&!hasRestrictedOrigin(v)).map(([id,v])=>({id:'history:'+id,refId:id,title:v.question||id,text:v.lastAnswer,source:'',kind:'learned',authority:'LOCAL_HELPFUL_HISTORY',provenance:'Helpful local answer history'}));
  return [...teachings,...useful].filter(x=>!hasRestrictedOrigin(x));
 }
 const service=createSearchService({items:[]});
 const trainedTitles=new Set();
 function refreshIndex(){const titles=shelf.items.filter(x=>!hasRestrictedOrigin(x)&&!trainedTitles.has(x.title)).map(x=>x.title);for(const title of titles)trainedTitles.add(title);predictor.add(titles);service.setItems([...shelf.items.map(x=>({...x,kind:'note',authority:'LOCAL_NOTE',provenance:'Your Orbit library'})),...learnedItems()]);const m=readMemory();service.setSourceVotes(m.sourceVotes);service.setAliases(m.aliases);}
 refreshIndex();
 function persist(){try{localStorage.setItem(SESSION,JSON.stringify({version:1,query:queryText(),goal,accepted,advanced,providers,history}));}catch{notice('Session storage unavailable. Export your library to keep it.');}}
 function stopSearch(){request++;abort?.abort();abort=null;syncContext();}
 function saveShelf(){shelf=validate('orbit',shelf);refreshIndex();try{localStorage.setItem(KEY,JSON.stringify(documentFor('orbit',shelf)));notice('Saved on this device.');return true}catch{notice('Device storage unavailable. Export to keep your notes.');return false}}
 function download(){const a=node('a'),url=URL.createObjectURL(new Blob([JSON.stringify(documentFor('orbit',shelf),null,2)],{type:'application/json'}));a.href=url;a.download='orbit-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 function queryPlan(){return buildSearchQuery(queryText(),accepted,goal)}
 function localOptions(){const plan=queryPlan(),c=plan.constraints;return{...goal,must:[...split(goal.must),...(c.must||[])].filter((x,i,a)=>a.indexOf(x)===i).join(','),prefer:[...split(goal.prefer),...(c.prefer||[]),...(c.aspects||[])].filter((x,i,a)=>a.indexOf(x)===i).join(','),avoid:[...split(goal.avoid),...(c.avoid||[])].filter((x,i,a)=>a.indexOf(x)===i).join(','),...(Object.keys(advanced).length?{advanced}:{}),offset,limit:PAGE}}
 function syncContext(){
  const names={all:'All local sources',note:'Orbit notes',record:'Indexed records',project:'Projects',learned:'Learned locally',web:'Web results'};
  const count=accepted.length;
  $('alignment').textContent=`${names[goal.scope]||'All sources'} · ${providers.length} web source${providers.length===1?'':'s'}${count?' · '+count+' refinements':''}`;
  $('context').textContent=goal.goal?'Goal: '+goal.goal:`Using ${shelf.items.length} Orbit notes and the connected local index.`;
  $('external-search').disabled=!queryText().trim()||providers.length===0||Boolean(abort&&!abort.signal.aborted);
 }
 function syncWordTargets(){const host=$('word-chain'),r=host.getBoundingClientRect(),c=$('scene').getBoundingClientRect();renderer.setAnchor?.({x:r.x-c.x,y:r.y-c.y,width:r.width,height:r.height});renderer.setWordTargets?.([...host.querySelectorAll('[data-word]')].map(e=>{const b=e.getBoundingClientRect(),t=getComputedStyle(e).transform,m=t==='none'?{e:0,f:0}:new DOMMatrixReadOnly(t);return{x:b.x+b.width/2-m.e-c.x,y:b.y+b.height/2-m.f-c.y}}));}
 function syncWordChain(){
  const words=[...queryPrefix.matchAll(/\S+/gu)],host=$('word-chain');host.replaceChildren();
  document.body.dataset.query=queryText().trim()?'active':'empty';
  const visible=innerWidth<700?1:innerWidth<1100?3:5;
  if(words.length>visible){const older=action('…'+(words.length-visible),()=>{const full=queryText();setQueryText(full);syncWordChain();$('question').focus();$('question').setSelectionRange(0,full.length)});older.className='word-overflow';older.setAttribute('aria-label','Edit all chosen words');host.append(older)}
  for(const m of words.slice(-visible)){const b=action(m[0],()=>{const full=queryText();setQueryText(full);syncWordChain();$('question').focus();$('question').setSelectionRange(m.index,m.index+m[0].length);proposalMode='details';contextualize()});b.className='word-bubble';b.dataset.word=m[0];b.title='Edit '+m[0];host.append(b)}
  renderer.setQuery?.(queryText());requestAnimationFrame(syncWordTargets);
 }
 function chooseWord(word){
  const caret=queryPrefix.length+($('question').selectionStart??$('question').value.length),replacement=replaceActiveWord(queryText(),word,caret);
  if(replacement.query.length>2000){notice('Keep your search below 2,000 characters.');return}
  if(!replacement.query.slice(replacement.caret).trim()){queryPrefix=replacement.query.trim()+' ';$('question').value='';}
  else{setQueryText(replacement.query);$('question').setSelectionRange(replacement.caret,replacement.caret)}
  proposalMode='details';contextPage=0;inputChanged();contextualize();persist();$('question').focus({preventScroll:true});
 }
 function renderPredictions(){
  if(composing||proposalMode==='details'||!$('question').value.trim())return false;
  const caret=queryPrefix.length+($('question').selectionStart??$('question').value.length),options=predictor.suggest(queryText(),{caret});if(!options.length)return false;
  const host=$('context-proposals');host.replaceChildren();const offeredQuery=queryText(),offeredCaret=caret;const size=innerWidth<700?2:4;
  for(const item of options.slice(contextPage*size,contextPage*size+size)){const b=action(item.word,()=>{const currentCaret=queryPrefix.length+($('question').selectionStart??$('question').value.length);if(composing||queryText()!==offeredQuery||currentCaret!==offeredCaret){renderPredictions();fitBuilder();return}chooseWord(item.word)});b.className='context-chip';b.dataset.completion=item.word;b.title='Local character Markov completion';host.append(b)}
  if(options.length>size){const b=action('More',()=>{contextPage=(contextPage+1)%Math.ceil(options.length/size);renderPredictions()});b.className='context-next';host.append(b)}
  const refine=action('Details',()=>{proposalMode='details';contextPage=0;contextualize()});refine.className='context-next';host.append(refine);
  $('proposal-status').textContent='Choose a word, or keep typing. Enter searches your exact words.';
  return true;
 }
 function renderAccepted(){
  const host=$('accepted-context');host.replaceChildren();if(!accepted.length)return;
  acceptedPage=Math.min(acceptedPage,accepted.length-1);const visible=innerWidth<700?1:2;
  for(const item of accepted.slice(acceptedPage,acceptedPage+visible)){const b=action((item.label||item.term)+' ×',()=>{accepted=accepted.filter(x=>x.id!==item.id);persist();contextualize();if(viewMode==='web')filterWeb();else if(!$('results').hidden)search(false)});b.className='context-chip accepted';b.dataset.removeContext=item.id;b.title=item.reason||'Your accepted refinement';b.setAttribute('aria-label','Remove '+item.label);host.append(b)}
  if(accepted.length>visible){const b=action('…'+accepted.length,()=>{acceptedPage=(acceptedPage+visible)%accepted.length;renderAccepted()});b.className='context-next';b.setAttribute('aria-label','More accepted refinements');host.append(b)}
 }
 function chooseContext(suggestion){
  if(suggestion.kind==='question'){pendingDescriptor={...suggestion,draft:''};renderDescriptor();return}
  if(!accepted.some(x=>x.id===suggestion.id))accepted.push({...suggestion});
  persist();contextualize();if(viewMode==='web')filterWeb();else if(!$('results').hidden)search(false);
 }
 function renderDescriptor(){
  if(!pendingDescriptor)return;const suggestion=pendingDescriptor,host=$('context-proposals');host.replaceChildren();
  const input=node('input');input.id='descriptor-value';input.type='text';input.maxLength=180;input.placeholder=suggestion.label||'Add a detail';input.value=suggestion.draft||'';input.oninput=()=>{suggestion.draft=input.value};input.setAttribute('aria-label',suggestion.label||'Detail value');
  const add=action('Add detail',()=>{const value=input.value.trim();if(!value){input.focus();return}const item={...suggestion,id:suggestion.id+'-'+value,label:value,term:value,kind:'property',source:{type:'user',dimension:suggestion.dimension}};pendingDescriptor=null;chooseContext(item);$('question').focus({preventScroll:true})});
  const cancel=action('Cancel',()=>{pendingDescriptor=null;contextualize();$('question').focus({preventScroll:true})});add.className=cancel.className='context-next';input.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();add.click()}if(e.key==='Escape'){e.stopPropagation();cancel.click()}});host.append(input,add,cancel);$('proposal-status').textContent='Enter the detail you want. It is added only when you choose Add detail.';input.focus({preventScroll:true});
 }
 function contextualize(){
  clearTimeout(queryTimer);renderer.setActivity?.(false);
  const query=queryText().trim();
  $('context-proposals').replaceChildren();
  if(!query){analysis=null;$('query-subject').textContent='Type freely, or select a suggested word.';$('proposal-status').textContent='';renderAccepted();syncContext();return}
  // Context looks only at locally available matches and returned sources; typing never calls providers.
  const docs=(service.localSearch(query,{scope:'all',offset:0,limit:20}).results||[]).filter(x=>!hasRestrictedOrigin(x)&&!['note','learned'].includes(x.kind));
  analysis=analyzeQuery(query,{documents:[...docs,...web],accepted});
  $('query-subject').textContent=analysis.subject?'About '+analysis.subject:analysis.summary||'Add a little more context.';
  const size=innerWidth<700?2:4,options=analysis.suggestions.filter(x=>!accepted.some(a=>a.id===x.id));contextPage=Math.min(contextPage,Math.max(0,Math.ceil(options.length/size)-1));
  for(const suggestion of options.slice(contextPage*size,contextPage*size+size)){
   if(accepted.some(x=>x.id===suggestion.id))continue;
   const b=node('button');b.type='button';b.className='context-chip';b.dataset.contextId=suggestion.id;b.dataset.contextKind=suggestion.kind;b.dataset.contextMode=suggestion.mode;b.dataset.contextValue=suggestion.term;
   const kind=node('span',suggestion.kind);kind.className='chip-kind';b.append(node('span','+'),kind,node('span',suggestion.label));b.title=suggestion.reason;b.setAttribute('aria-label','Add context: '+suggestion.label);
   b.onclick=()=>chooseContext(suggestion);
   $('context-proposals').append(b);
  }
  if(options.length>size){const b=action('More',()=>{contextPage=(contextPage+1)%Math.ceil(options.length/size);contextualize()});b.className='context-next';$('context-proposals').append(b)}
  $('proposal-status').textContent=analysis.suggestions.length?'Optional details · choose what fits, or keep typing.':'No additional context found yet. Add a note, or inspect sources after searching.';
  renderAccepted();syncContext();if(pendingDescriptor)renderDescriptor();else renderPredictions();fitBuilder();
 }
 function fitBuilder(){
  // Page long suggestion labels rather than let them overlap the search controls.
  for(const id of ['context-proposals','accepted-context']){const host=$(id),buttons=[...host.children];for(const b of buttons)b.style.maxWidth=Math.max(54,Math.floor((host.clientWidth-6*(buttons.length-1))/Math.max(1,buttons.length)))+'px';}
 }
 function inputChanged(){
  if(!composing&&/\s$/u.test($('question').value)&&$('question').selectionStart===$('question').value.length&&$('question').selectionEnd===$('question').value.length){queryPrefix=queryText();$('question').value='';proposalMode='details';}
  else if(!composing&&$('question').value.trim())proposalMode='auto';
  contextPage=0;pendingDescriptor=null;
  stopSearch();clearTimeout(queryTimer);web=[];webInfo=null;offset=0;result=[];total=0;selected=null;renderer.update([],null);
  if(!$('results').hidden){$('cards').replaceChildren(Object.assign(node('p','Your question has changed. Choose Search library or Search the web for new results.'),{className:'empty-state'}));$('result-title').textContent='Continue your search';$('summary').textContent='Waiting for your next search.';$('prev').disabled=true;$('next').disabled=true;$('page').textContent='';}
  syncWordChain();renderer.setActivity?.(true);syncContext();
  $('context-proposals').replaceChildren();$('query-subject').textContent=queryText().trim()?'Following your thought…':'Type freely, or select a suggested word.';$('proposal-status').textContent='';
  if(!composing){renderPredictions();fitBuilder();queryTimer=setTimeout(contextualize,650);}
 }
 $('question').addEventListener('input',inputChanged);
 const refreshCaret=()=>{if(!composing&&!pendingDescriptor&&document.activeElement===$('question')){proposalMode='auto';contextPage=0;contextualize()}};
 $('question').addEventListener('click',refreshCaret);
 $('question').addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))refreshCaret()});
 $('question').addEventListener('select',refreshCaret);
 $('question').addEventListener('keydown',e=>{if(composing||e.isComposing||e.keyCode===229)return;if(e.key==='Backspace'&&!$('question').value&&queryPrefix){e.preventDefault();const matches=[...queryPrefix.matchAll(/\S+/gu)],last=matches.at(-1);if(last){queryPrefix=queryPrefix.slice(0,last.index);$('question').value=last[0];inputChanged();}}});
 $('question').addEventListener('compositionstart',()=>{composing=true;clearTimeout(queryTimer)});
 $('question').addEventListener('compositionend',()=>{composing=false;inputChanged()});
 function setBackgroundInert(value){for(const e of document.querySelectorAll('#main,.composer,header,nav,.skip'))e.inert=value;}
 function close(){active='';$('drawer').hidden=true;document.body.classList.remove('drawer-open');setBackgroundInert(false);document.querySelectorAll('[data-drawer]').forEach(b=>b.setAttribute('aria-expanded','false'));trigger?.isConnected&&trigger.focus({preventScroll:true})}
 function label(title,type='input',value=''){const l=node('label',title),input=node(type);input.value=value;l.append(input);return[l,input]}
 function action(text,fn){const b=node('button',text);b.type='button';b.addEventListener('click',fn);return b}
 function sectionTitle(text){const p=node('p',text);p.className='field-title';return p}
 function open(kind,from){
  trigger=from||document.activeElement;active=kind;$('drawer').hidden=false;document.body.classList.add('drawer-open');setBackgroundInert(true);
  $('drawer-title').textContent={recent:'Pick up the thread',add:'Your Orbit library',refine:'Shape your search',tools:'Tools & connections'}[kind];
  const host=$('drawer-body');host.replaceChildren();document.querySelectorAll('[data-drawer]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.drawer===kind)));
  if(kind==='recent'){
   host.append(node('p',history.length?'Previous questions and the context you chose.':'Your searches will appear here.'));
   for(const h of history){const b=action(h.query,()=>{setQueryText(h.query);goal={...goal,...h.goal};advanced=h.advanced||{};accepted=Array.isArray(h.accepted)?h.accepted:[];close();syncWordChain();contextualize();search(false)});b.className='list-item';host.append(b)}
   host.append(action('Clear recent searches',()=>{history=[];persist();open('recent',trigger)}));
  }
  if(kind==='add'){
   const form=node('form');form.style.display='grid';form.style.gap='14px';
   const [tl,title]=label('Title'),[nl,text]=label('Note','textarea'),[sl,source]=label('Source link (optional)');title.required=true;title.maxLength=160;text.maxLength=20000;source.type='url';source.maxLength=2000;
   form.append(tl,nl,sl,node('button','Save to Orbit'));form.onsubmit=e=>{e.preventDefault();try{undo=structuredClone(shelf);shelf=validate('orbit',{items:[...shelf.items,{id:crypto.randomUUID(),title:title.value,text:text.value,source:source.value,language:''}]});saveShelf();close();contextualize();search(false)}catch(err){notice('Could not save: '+err.message)}};
   host.append(form,node('p','Notes are saved on this device. They are not sent to search providers.'),action('Browse my library',()=>{setQueryText('');accepted=[];goal={goal:'',must:'',prefer:'',avoid:'',scope:'note'};advanced={};close();syncWordChain();contextualize();search()}),action('Import Orbit file',importFile),action('Export library',download));
  }
  if(kind==='refine'){
   if(analysis?.suggestions?.length){const options=node('details');options.append(node('summary','Additional context directions'));const choices=node('div');choices.className='row';for(const suggestion of analysis.suggestions){if(accepted.some(x=>x.id===suggestion.id))continue;choices.append(action(suggestion.label,()=>{close();chooseContext(suggestion)}))}options.append(choices);host.append(options);}
   const form=node('form');form.style.display='grid';form.style.gap='14px';
   for(const [k,title] of [['goal','What are you trying to accomplish?'],['must','Must contain (comma separated)'],['prefer','Prefer (comma separated)'],['avoid','Avoid (comma separated)']]){const [l,i]=label(title,'input',goal[k]);i.name=k;form.append(l)}
   const [l,sel]=label('Search scope','select');for(const [v,t] of [['all','All local sources'],['note','My Orbit library'],['record','Indexed records'],['project','Project records'],['learned','Learned locally'],['web','Returned web results']]){const o=node('option',t);o.value=v;sel.append(o)}sel.value=viewMode==='web'?'web':goal.scope;sel.name='scope';form.append(l);
   form.append(sectionTitle('External sources · requested only on Search the web'));
   const checks=node('div');checks.className='provider-list';
   for(const id of ['wikipedia','openalex','crossref','archive','github']){const names={wikipedia:'Wikipedia',openalex:'OpenAlex',crossref:'Crossref',archive:'Internet Archive',github:'GitHub'};const l=node('label'),i=node('input');i.type='checkbox';i.name='provider';i.value=id;i.checked=providers.includes(id);l.append(i,node('span',names[id]));checks.append(l)}form.append(checks);
   const extra=node('details');extra.append(node('summary','Advanced record search'));const fields=node('div');fields.style.display='grid';fields.style.gap='9px';
   for(const [k,t] of [['kind','Kind'],['objectType','Object type'],['domain','Domain'],['authority','Authority'],['timeLayer','Time layer'],['relation','Relation'],['from','From object ID'],['to','To object ID'],['logicalId','Logical ID'],['uoidPrefix','Object ID prefix'],['minDegree','Minimum degree'],['maxDegree','Maximum degree'],['provenance','Provenance contains'],['sortBy','Sort field (degree, label or uoid)'],['sortDir','Sort direction (asc or desc)'],['hasFields','Required fields (comma separated)'],['equals','Exact field values (JSON object)']]){const value=advanced[k],display=k==='equals'&&value?JSON.stringify(value):Array.isArray(value)?value.join(','):value??'';const [l,i]=label(t,'input',display);i.name='advanced-'+k;fields.append(l)}extra.append(fields);form.append(extra,node('p','Words and metadata narrow results. A match is a lead, not proof that a source answers your question.'),node('button','Apply'));
   form.onsubmit=e=>{e.preventDefault();try{const data=new FormData(form),next={};for(const [k,v] of data){if(k.startsWith('advanced-')&&String(v).trim())next[k.slice(9)]=v}for(const k of ['minDegree','maxDegree'])if(next[k]!=null){next[k]=Number(next[k]);if(!Number.isFinite(next[k]))throw Error('Degree must be a number')}if(next.hasFields)next.hasFields=split(next.hasFields);if(next.equals){next.equals=JSON.parse(next.equals);if(!next.equals||Array.isArray(next.equals)||typeof next.equals!=='object')throw Error('Exact fields must be a JSON object')}for(const k of Object.keys(goal))goal[k]=String(data.get(k)||'');providers=data.getAll('provider');advanced=next;persist();close();contextualize();goal.scope==='web'?filterWeb():search(false)}catch(error){notice('Invalid search filter: '+error.message)}};host.append(form,routeMenu());
  }
  if(kind==='tools'){
   host.append(action('Reset view',()=>{close();$('clear').click()}));
   host.append(action('Export Orbit library',download),action('Import Orbit library',importFile),action('Undo last library change',()=>{if(!undo){notice('Nothing to undo.');return}shelf=undo;undo=null;saveShelf();contextualize();search(false)}));
   host.append(sectionTitle('Full search backend'));
   const [l,url]=label('Backend URL (your trusted local server)','input',backend);url.placeholder='http://127.0.0.1:8765';host.append(l,action('Connect full index',()=>connectBackend(url.value)),action('Import record index',importCorpus));host.append(node('p','For server retrieval, run python server/search_server.py and open http://127.0.0.1:8765. The public page already includes the original public record index.'));
   const stats=service.stats();host.append(Object.assign(node('p',`Connected index: ${stats.corpus?.total||0} records · ${stats.noteCount} notes · ${stats.learnedCount} learned answers. Advanced filters, project lessons and relation tracing use this index.`),{className:'help'}));
   host.append(action('Browse projects and lessons',showProjects));
   host.append(memoryMenu());
   host.append(Object.assign(node('p','S′ / S Prime: model not connected. Query proposals are based on rules and retrieved records, not simulated language-model answers.'),{className:'help'}));
   for(const [title,url] of [['S′ source and lineage','https://github.com/redogit/conscience64/blob/main/research/federation/s1-models.json'],['Backend & search source','https://github.com/redogit/conscience64-platform/tree/main/server'],['Project information','previous.html']]){const a=node('a',title);a.href=url;host.append(a)}
  }
  menuPager.reset();requestAnimationFrame(()=>[...$('drawer-body').querySelectorAll('input,button,a')].find(x=>x.getClientRects().length)?.focus({preventScroll:true}));
 }
 function memoryMenu(){
  const details=node('details');details.append(node('summary','Teach an answer or remember a phrase'));const form=node('form');form.style.cssText='display:grid;gap:12px;margin-top:14px';const [ql,q]=label('Question','input',queryText()),[al,a]=label('Answer to remember','textarea');q.required=true;a.required=true;a.maxLength=12000;form.append(ql,al,node('button','Remember answer on this device'));form.onsubmit=e=>{e.preventDefault();try{teachMemory(q.value,a.value);refreshIndex();notice('Remembered locally. Check its support before relying on it.');a.value='';contextualize()}catch(error){notice('Could not remember: '+error.message)}};
  const aliases=node('form');aliases.style.cssText='display:grid;gap:12px;margin-top:20px';const [sl,s]=label('When I search this phrase'),[tl,t]=label('Also look for these words');s.required=true;t.required=true;aliases.append(sl,tl,node('button','Remember phrase'));aliases.onsubmit=e=>{e.preventDefault();try{rememberAlias(s.value,t.value);refreshIndex();notice('Phrase remembered for local search.');s.value='';t.value=''}catch(error){notice('Could not remember phrase: '+error.message)}};details.append(form,aliases,node('p','Answers and phrase mappings stay on this device. They help retrieval and do not make a source authoritative.'));return details;
 }
 function routeMenu(){
  const details=node('details');details.append(node('summary','More search engines · 65 routes'));const panel=node('div');panel.style.cssText='display:grid;gap:12px;margin-top:14px';details.append(panel);let loaded=false;
  details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;panel.append(node('p','Loading the original search catalogue…'));try{
   const routes=createRouteService({...(backend?{baseURL:backend}:{}),catalogueURL:new URL('./public-routes.json',import.meta.url).href}),catalog=await routes.catalogue();if(!details.isConnected)return;panel.replaceChildren();
   const [cl,country]=label('Country hint','select'),global=node('option','Global');global.value='';country.append(global);for(const c of catalog.countries){const o=node('option',c.name);o.value=c.code;country.append(o)}
   const [kl,category]=label('Search category','select');for(const [v,t] of [['all','All engines'],['web','Web'],['research','Research'],['code','Code'],['archives','Archives']]){const o=node('option',t);o.value=v;category.append(o)}
   const list=node('div');list.style.cssText='display:grid;gap:10px';
   panel.append(cl,kl,node('p','Country adds a keyword hint. Open an engine to search with the context you chose.'),action('Show search routes',async()=>{try{const plan=await routes.plan(queryPlan().providerQuery,{country:country.value,category:category.value});list.replaceChildren(node('p',`${plan.routes.length} source routes · ${plan.country_scope}`));for(const r of plan.routes){const a=node('a',r.name+' · '+r.category);a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';list.append(a)}}catch(e){notice('Could not plan routes: '+e.message)}}),action('Search Crossref & Europe PMC',()=>legacyWebSearch(routes,{country:country.value,category:category.value})),list);
   if(!backend)panel.append(node('p','Direct Europe PMC retrieval uses the local backend. Open the local interface as described in Tools. Research source links work here.'));
  }catch(e){panel.replaceChildren(node('p','Catalogue unavailable: '+e.message));loaded=false}});return details;
 }
 async function legacyWebSearch(routes,options){
  if(!backend){notice('Open http://127.0.0.1:8765 after starting the backend in Tools.');return}
  stopSearch();abort=new AbortController();const seq=++request;const query=queryPlan().providerQuery;close();syncContext();notice('Searching Crossref and Europe PMC…');
  try{const out=await routes.search(query,{...options,signal:abort.signal});if(seq!==request)return;web=out.results;webInfo={...out,sourceCount:out.provider_runs?.length||0};offset=0;viewMode='web';filterWeb();contextualize();notice(out.errors.length?'Some research sources are unavailable. Other leads are shown.':'Research search complete.');persist()}catch(e){if(e.name!=='AbortError'&&seq===request)notice('Research search unavailable: '+e.message)}finally{if(seq===request){abort=null;syncContext()}}
 }
 function importFile(){const input=node('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>32000000)throw Error('file too large');const incoming=parseDocument(await file.text(),'orbit');const map=new Map(shelf.items.map(x=>[x.id,x]));for(const item of incoming.items){if(map.has(item.id)&&JSON.stringify(map.get(item.id))!==JSON.stringify(item))throw Error('conflicting note ID; original preserved');map.set(item.id,item)}undo=structuredClone(shelf);shelf=validate('orbit',{items:[...map.values()]});saveShelf();contextualize();search(false);if(active)open(active,trigger)}catch(e){notice('Import failed: '+e.message)}};input.click()}
 async function connectBackend(value){
  try{const u=new URL(value||location.origin);if(!['http:','https:'].includes(u.protocol))throw Error('Use an HTTP or HTTPS backend');notice('Connecting the full local index…');const corpus=await loadCorpus({baseURL:u.origin,backendURL:u.origin+'/api/corpus',signal:AbortSignal.timeout(12000)});service.setCorpus(corpus);predictor.add(corpus.all().filter(x=>!hasRestrictedOrigin(x)).map(x=>x.label||''));backend=u.origin;window.Conscience64API=corpus;notice('Full search index connected.');contextualize();if(active)open(active,trigger)}catch(e){notice('Backend unavailable: '+e.message)}
 }
 async function connectPublicIndex(){try{const corpus=await loadCorpus({backendURL:new URL('./public-corpus.json',import.meta.url).href,signal:AbortSignal.timeout(12000)});service.setCorpus(corpus);predictor.add(corpus.all().filter(x=>!hasRestrictedOrigin(x)).map(x=>x.label||''));window.Conscience64API=corpus;syncContext();if(!$('results').hidden&&viewMode==='local')search(false)}catch(e){notice('Public record index unavailable: '+e.message)}}
 function importCorpus(){const input=node('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const f=input.files[0];if(!f)return;if(f.size>32000000)throw Error('index too large');const payload=JSON.parse(await f.text());const {createCorpusAPI}=await import('./search-service.mjs');const api=createCorpusAPI(payload.records||payload,payload.registry||payload.projects||{});service.setCorpus(api);window.Conscience64API=api;notice('Record index imported for this session.');contextualize()}catch(e){notice('Index import failed: '+e.message)}};input.click()}
 function showProjects(){const host=$('drawer-body'),out=service.projects.list();const rows=out.projects||[];host.replaceChildren(sectionTitle('Project records'));if(!rows.length)host.append(node('p','Connect the full backend or import a record index to browse projects.'));for(const p of rows)host.append(action(p.name||p.id,()=>{host.replaceChildren(node('h3',p.name||p.id),node('p',p.highlight||p.O||''));const lessons=service.projects.lessons({projectId:p.id});for(const l of lessons.lessons||[])host.append(node('p',JSON.stringify(l,null,2)));host.append(action('Back to projects',showProjects))}));}
 function sourceLabel(d){return d.provider||{note:'ORBIT · YOUR NOTE',project:'PROJECT RECORD',record:'INDEXED RECORD',learned:'LEARNED LOCALLY',web:'EXTERNAL SOURCE'}[d.kind]||'SOURCE'}
 function cardFor(d){
  const card=node('article');card.className='card'+(selected===d.id?' selected':'');card.dataset.resultId=d.id;
  const text=d.text||d.snippet||'';card.append(Object.assign(node('span',sourceLabel(d)),{className:'meta'}),node('h2',d.title),node('p',text.slice(0,1000)));
  const row=node('div');row.className='actions';row.append(action(selected===d.id?'Selected':'Select',()=>{selected=d.id;selectMemory(queryText(),d.refId||d.id);service.setSourceVotes(readMemory().sourceVotes);renderCards()}));
  row.append(action('Details & actions',()=>{open('tools',document.activeElement);showResultDetails(d)}));
  card.append(row);return card;
 }
 function showResultDetails(d){
  const text=d.text||d.snippet||'';
  const host=$('drawer-body');host.replaceChildren(node('h3',d.title),node('p',text));
  const details=node('details');details.append(node('summary','Why this fits · source'));details.append(node('p',d.reason||'Matched your search terms and selected constraints.'));
  if(d.provenance)details.append(node('p',typeof d.provenance==='string'?d.provenance:JSON.stringify(d.provenance)));
  const url=safeURL(d.source||d.url||'');if(url){const a=node('a','Open original source');a.href=url;a.target='_blank';a.rel='noopener noreferrer';details.append(a)}
  details.append(node('p',d.kind==='note'||d.kind==='learned'?'Remembered material. Check its original support before relying on it.':'A search result is a lead. Inspect its source and claim boundaries.'));host.append(details);details.open=true;
  const row=node('div');row.className='row';row.append(action(selected===d.id?'Selected':'Select',()=>{selected=d.id;selectMemory(queryText(),d.refId||d.id);service.setSourceVotes(readMemory().sourceVotes);renderCards()}));
  if(d.kind==='note'){row.append(action('Edit',()=>editNote(d)));row.append(action('Delete',()=>{if(!shelf.items.some(x=>x.id===d.id))return;undo=structuredClone(shelf);shelf.items=shelf.items.filter(x=>x.id!==d.id);saveShelf();close();search(false)}));}
  else if(!hasRestrictedOrigin(d))row.append(action('Keep in Orbit',()=>{if(shelf.items.some(x=>x.source&&x.source===url)){notice('Already in Orbit.');return}try{undo=structuredClone(shelf);shelf=validate('orbit',{items:[...shelf.items,{id:crypto.randomUUID(),title:d.title.slice(0,160),text:text.slice(0,20000),source:url,language:''}]});saveShelf()}catch(e){notice('Could not save: '+e.message)}}));
  if(!hasRestrictedOrigin(d))row.append(action('Search from this',()=>{setQueryText(d.title);accepted=[];close();inputChanged();contextualize();search()}));
  if(d.kind==='learned')for(const helpful of [true,false])row.append(action(helpful?'Helpful':'Not helpful',()=>{try{feedbackMemory(queryText()||d.title,text,helpful);refreshIndex();notice('Feedback remembered on this device.');search(false)}catch(error){notice('Could not remember feedback: '+error.message)}}));
  if(d.kind==='record'||d.kind==='project')row.append(action('Relations & record',()=>inspectRecord(d)));
  host.append(row);menuPager.reset();
 }
 function editNote(d){
  open('add',document.activeElement);const form=$('drawer-body').querySelector('form'),inputs=form.querySelectorAll('input'),text=form.querySelector('textarea');inputs[0].value=d.title;text.value=d.text;inputs[1].value=d.source;form.querySelector('button').textContent='Save changes';
  form.onsubmit=e=>{e.preventDefault();try{undo=structuredClone(shelf);const updated={...shelf.items.find(x=>x.id===d.id),title:inputs[0].value,text:text.value,source:inputs[1].value};shelf=validate('orbit',{items:shelf.items.map(x=>x.id===d.id?updated:x)});saveShelf();close();contextualize();search(false)}catch(error){notice('Could not save: '+error.message)}};
 }
 function inspectRecord(d){open('tools',document.activeElement);const host=$('drawer-body');const id=d.refId||d.id;const obj=d.kind==='project'?service.projects.reflow(id):service.get(id);host.replaceChildren(node('h3',d.title));const pre=node('pre',JSON.stringify(obj,null,2));pre.style.cssText='white-space:pre-wrap;font-size:11px;overflow-wrap:anywhere';host.append(pre);if(d.kind==='record'){const relations=service.relations(id),traversal=service.traverse(id,{depth:2});host.append(sectionTitle('Connected objects · depth 2'),node('p',`${relations.total||0} direct relations · ${traversal.nodes?.length||0} reachable objects`));for(const r of relations.relations||[])host.append(node('p',r.label||r.relation||JSON.stringify(r)));const md=service.microdata(id);if(md)host.append(node('pre',JSON.stringify(md,null,2)));}}
 function renderCards(){
  const nextCapacity=capacity();if(PAGE!==nextCapacity){PAGE=nextCapacity;offset=Math.floor(offset/PAGE)*PAGE;if(viewMode==='web'){const out=refineCandidates(web,{...localOptions(),offset,limit:PAGE});result=out.results;total=out.total}else{const out=service.localSearch(queryText(),localOptions());result=out.results;total=out.total}}
  document.body.dataset.view='results';$('welcome').hidden=true;$('results').hidden=false;$('result-title').textContent=queryText()||'Your library';
  $('summary').textContent=viewMode==='web'?`${total} matching results from ${webInfo?.totalRaw??web.length} returned leads · ${webInfo?.sourceCount??webInfo?.providers?.length??providers.length} requested sources. Counts cover returned results, not the entire web.`:`${total} matching local result${total===1?'':'s'} · records, projects and remembered material keep their source identities.`;
  $('cards').replaceChildren();if(!result.length){const p=node('p','No results match this search. Remove a refinement, try fewer words, or choose another source.');p.className='empty-state';$('cards').append(p)}else for(const d of result)$('cards').append(cardFor(d));
  $('prev').disabled=offset===0;$('next').disabled=offset+PAGE>=total;$('page').textContent=total?`${offset+1}–${Math.min(offset+PAGE,total)} of ${total}`:'0 results';renderer.update(result,selected);syncWordChain();syncContext();
 }
 function search(record=true){
  clearTimeout(queryTimer);request++;abort?.abort();offset=0;selected=null;viewMode='local';
  if(goal.scope==='web')goal.scope='all';
  try{const out=service.localSearch(queryText(),localOptions());result=out.results;total=out.total;if(record&&queryText().trim())history=[{query:queryText(),goal:{...goal},advanced:{...advanced},accepted:[...accepted]},...history.filter(x=>x.query!==queryText())].slice(0,30);persist();contextualize();renderCards()}catch(e){notice('Search could not run: '+e.message)}
 }
 function filterWeb(){
  viewMode='web'; // Refine returned candidates without another network request.
  const options=localOptions(),count=refineCandidates(web,{...options,offset:0,limit:1}).total;
  offset=Math.min(offset,Math.max(0,Math.floor((count-1)/PAGE)*PAGE));const out=refineCandidates(web,{...options,offset,limit:PAGE});total=out.total;result=out.results;renderCards();
 }
 async function webSearch(){
  const query=queryText().trim();if(!query){notice('Start with a question.');$('question').focus();return}if(!providers.length){notice('Choose a source in Sources.');return}
  contextualize();abort?.abort();abort=new AbortController();const seq=++request;const plan=queryPlan();
  notice('Searching '+providers.length+' sources…');$('external-search').disabled=true;
  try{const c=plan.constraints;const out=await service.webSearch(plan.providerQuery||plan.query||query,{preparedQuery:true,providers,goal:goal.goal,must:[...split(goal.must),...(c.must||[])],prefer:[...split(goal.prefer),...(c.prefer||[]),...(c.aspects||[])],avoid:[...split(goal.avoid),...(c.avoid||[])],limit:60,offset:0,signal:abort.signal,backendURL:backend?backend+'/api/search':undefined});if(seq!==request)return;web=out.candidateResults||out.results;webInfo=out;offset=0;viewMode='web';filterWeb();contextualize();persist();notice(out.errors?.length?'Some sources unavailable: '+out.errors.map(e=>e.provider||e.id).join(', '):'Search complete. Refine the returned results below.')}catch(e){if(e.name!=='AbortError'&&seq===request)notice('Web search unavailable: '+e.message)}finally{if(seq===request){abort=null;syncContext()}}
 }
 document.addEventListener('click',e=>{const b=e.target.closest('[data-drawer]');if(b)open(b.dataset.drawer,b)});
 $('close').onclick=close;
 document.addEventListener('keydown',e=>{
  if(e.key==='Tab'&&active){const controls=[...$('drawer').querySelectorAll('button,input,textarea,select,a[href],summary')].filter(x=>!x.disabled&&x.getClientRects().length),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
  if(e.key==='Escape'){if(active)close();else{stopSearch();notice('Search stopped.')}}
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();if(active)close();$('question').focus()}
 });
 $('ask').onsubmit=e=>{e.preventDefault();contextualize();search()};$('external-search').onclick=webSearch;
 $('prev').onclick=()=>{offset=Math.max(0,offset-PAGE);viewMode==='web'?filterWeb():pageLocal()};$('next').onclick=()=>{offset+=PAGE;viewMode==='web'?filterWeb():pageLocal()};
 function pageLocal(){const out=service.localSearch(queryText(),localOptions());result=out.results;total=out.total;renderCards()}
 $('clear').onclick=()=>{abort?.abort();abort=null;request++;clearTimeout(queryTimer);setQueryText('');pendingDescriptor=null;web=[];accepted=[];result=[];selected=null;document.body.dataset.view='welcome';$('welcome').hidden=false;$('results').hidden=true;renderer.update([],null);syncWordChain();contextualize();persist();$('question').focus({preventScroll:true})};
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Recognition)$('voice').hidden=true;
 else{let recognition;$('voice').onclick=()=>{if(recognition){recognition.stop();return}recognition=new Recognition();recognition.lang=navigator.language;recognition.onresult=e=>{setQueryText(e.results[0][0].transcript);inputChanged();contextualize()};recognition.onerror=e=>notice('Microphone: '+e.error);recognition.onend=()=>{recognition=null;$('voice').setAttribute('aria-label','Dictate your question')};try{recognition.start();$('voice').setAttribute('aria-label','Stop dictation');notice('Listening · your browser speech service.')}catch(e){recognition=null;notice('Microphone unavailable: '+e.message)}}}
 window.addEventListener('resize',syncWordChain);window.visualViewport?.addEventListener('resize',syncWordChain);
 $('reset').onclick=()=>$('clear').click();
 let layoutFrame;watchViewport(()=>{const compact=(window.visualViewport?.height||innerHeight)<=300;const webButton=$('external-search');const destination=compact?document.querySelector('nav'):$('query-subject').parentElement;if(webButton.parentElement!==destination)destination.append(webButton);webButton.textContent=compact?'Web ↗':'Search the web ↗';if(layoutFrame)cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{PAGE=capacity();if(!$('results').hidden){offset=Math.floor(offset/PAGE)*PAGE;viewMode==='web'?filterWeb():pageLocal()}syncWordChain();contextualize();menuPager.refresh();fitBuilder()})});
 let targetFrame;window.addEventListener('scroll',()=>{if(!targetFrame)targetFrame=requestAnimationFrame(()=>{targetFrame=null;syncWordTargets()})},{passive:true});
 $('submit').disabled=false;syncWordChain();contextualize();
 await connectPublicIndex();
 if(['127.0.0.1','localhost','::1'].includes(location.hostname))fetch('/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>{if(r.ok)return connectBackend(location.origin)}).catch(()=>{});
 if(queryText())search(false);
 window.Conscience64Search=service;
}
