import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

let module;
try { module = await import('./search-service.mjs'); } catch {}
assert.ok(module, 'The shared search service must exist before the new workspace can retrieve prior corpus and web sources.');
const {PROVIDERS, createCorpusAPI, createSearchService, loadCorpus, searchWeb, composeQuery,hasRestrictedOrigin,refineCandidates} = module;
const candidateFixture=[{id:'a',title:'Bike for sport',text:'An electric bike',score:0},{id:'b',title:'Bike for commuting',text:'An electric bike',score:0}];
assert.equal(refineCandidates(candidateFixture,{goal:'commuting',limit:10}).results[0].id,'b','refining cached candidates retains goal-oriented ranking');
assert.equal(refineCandidates(candidateFixture,{must:'commuting'}).total,1);
assert.equal(refineCandidates(candidateFixture,{}).total,2,'removing a constraint restores fetched candidates without another request');
const sourceRoot = new URL('../../conscience64/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('data-manifest.json', sourceRoot)));
const chunks = await Promise.all(manifest.shards.filter(x => x.state === 'PAYLOAD').map(x => readFile(new URL(x.path, sourceRoot), 'utf8')));
const records = JSON.parse(gunzipSync(Buffer.from(chunks.join(''), 'base64')));
const registry = JSON.parse(await readFile(new URL('research/projects/projects.json', sourceRoot)));
const corpus = createCorpusAPI(records, registry, {manifest});
assert.equal(corpus.stats().total, 734);
assert.equal(corpus.stats().projects.count, 7);
assert.equal(corpus.stats().projects.lessonCount, 14);
assert.equal(hasRestrictedOrigin({records,registry,manifest}),false,'the already public source projection has no restricted-origin markers');
assert.throws(()=>createCorpusAPI([{uoid:'restricted:dual',privacy_origin:{classification:'public'},privacyOrigin:{classification:'private-history-method-only'}}]),/Restricted private origin/,'conflicting origin fields cannot hide a restricted marker');
for(const marker of [{privacyOrigin:{classification:'private-history-method-only'}},{privacy_origin:{classification:'private-history-method-only'}},{derived_from_private_history:true},{publication_allowed:false,requires_independent_regrounding:true}]){
 assert.equal(hasRestrictedOrigin({nested:[marker]}),true);
 assert.throws(()=>createCorpusAPI([{...records[0],data:{nested:marker}}],registry),/restricted.*origin/i);
 assert.throws(()=>createCorpusAPI(records,{...registry,nested:marker}),/restricted.*origin/i);
 assert.equal(createSearchService({items:[{id:'private',title:'Withheld history',text:'private source',...marker}]}).localSearch('withheld').total,0);
}
assert.equal(corpus.get('project:physics').uoid, records.find(x => x.logicalId === 'project:physics').uoid);
assert.ok(corpus.search.simple('black hole quantum').total > 0);
assert.ok(corpus.search.advanced({objectTypes:['research-node'],minDegree:5}).results.every(x => x.objectType==='research-node' && x.degree >= 5));
assert.throws(() => corpus.search.advanced({from:'unresolved-object'}), /UNRESOLVED_REFERENCE/);
assert.throws(() => corpus.search.advanced({from:''}), /INVALID_REFERENCE/);
assert.ok(corpus.relations('project:physics',{direction:'out'}).relations.every(x=>x.sourceUoid===corpus.get('project:physics').uoid));
assert.ok(corpus.traverse('project:orbit',{depth:2}).nodes.length > 1);
assert.equal(corpus.microdata('project:orbit').itemId, corpus.get('project:orbit').uoid);
assert.match(corpus.microdataHTML('project:orbit'), /itemscope/);
assert.equal(corpus.projects.get('historical-recovery').id, 'historical-recovery');
assert.ok(corpus.projects.reflow('historical-recovery').O.claimCeiling);
assert.equal(corpus.projects.lessons({date:'2026-09-13'}).total, 14);
assert.throws(() => corpus.projects.lessons({projectId:'missing'}), /UNRESOLVED_PROJECT/);
assert.throws(() => corpus.projects.lessons({unknown:'x'}), /INVALID_LESSON_FILTER/);

// Compare the adapter against the actual predecessor's pure API, without loading its DOM/canvas install.
const predecessor = (await readFile(new URL('app.js',sourceRoot),'utf8')).split('globalThis.Conscience64API=API;')[0];
const predecessorFetch = async path => ({ok:true,json:async()=>path.includes('projects.json')?registry:manifest,text:async()=>chunks[manifest.shards.findIndex(x=>path.endsWith(x.path))]});
const prior = await new (Object.getPrototypeOf(async function(){}).constructor)('fetch','document', predecessor+'\nreturn API;')(predecessorFetch,{getElementById:()=>null});
for(const query of ['physics','black hole quantum','language','orbit']) {
  assert.deepEqual(corpus.search.simple(query,{offset:1,limit:13}), prior.search.simple(query,{offset:1,limit:13}));
}
for(const spec of [{objectTypes:['research-node'],minDegree:5,sortBy:'label',sortDir:'asc',limit:12},{relation:'RELATED',limit:20},{from:'project:physics',limit:50},{text:'language',limit:8}]) {
  assert.deepEqual(corpus.search.advanced(spec), prior.search.advanced(spec));
}
assert.deepEqual(corpus.relations('project:physics',{direction:'out'}),prior.relations('project:physics',{direction:'out'}));
assert.deepEqual(corpus.traverse('project:orbit',{depth:2}),prior.traverse('project:orbit',{depth:2}));
assert.deepEqual(corpus.projects.invariants(),prior.projects.invariants());

const items=[{id:'private-a',title:'Budget phone',text:'Android under 500 private marker',kind:'note'},{id:'private-b',title:'Premium phone',text:'Android 1000',kind:'note'},{id:'unicode',title:'日本語',text:'検索',kind:'note'},{id:'teaching',title:'My phone preference',text:'Repairable Android',kind:'learned',authority:'LOCAL_USER_TAUGHT'}];
const service=createSearchService({items,corpus});
assert.deepEqual(service.localSearch('phone',{must:'Android',avoid:'premium',type:'note'}).results.map(x=>x.id),['private-a']);
assert.equal(service.localSearch('検索').results[0].id,'unicode');
assert.equal(createSearchService({items:[{id:'accent',title:'Café methods',text:'Fieldwork'}]}).localSearch('cafe').results[0]?.id,'accent','prior accent-insensitive retrieval survives Unicode support');
assert.equal(service.localSearch('qqqjjjxxyywz').total,0);
assert.ok(service.localSearch('physics',{type:'record'}).results.some(x=>x.refId==='project:physics'));
assert.ok(service.localSearch('recovery',{type:'project'}).results.every(x=>x.kind==='project'));
assert.ok(service.localSearch('',{advanced:{from:'project:physics'}}).results.every(x=>x.raw.objectType==='research-edge'));
assert.deepEqual(service.localSearch('',{advanced:{objectTypes:['research-node'],sortBy:'degree',sortDir:'desc'},limit:10}).results.map(x=>x.id),corpus.search.advanced({objectTypes:['research-node'],sortBy:'degree',sortDir:'desc',text:'',offset:0,limit:1000}).results.slice(0,10).map(x=>x.uoid),'advanced result ordering must retain the selected degree sort');
assert.equal(service.localSearch('phone',{type:'learned'}).results[0].authority,'LOCAL_USER_TAUGHT');
service.setItems([{id:'next',title:'New note',text:'new words'}]);
assert.equal(service.localSearch('phone',{type:'note'}).total,0);
const voted=createSearchService({items:[{id:'a',title:'Camera choice',text:'portable'},{id:'b',title:'Camera option',text:'portable'},{id:'unrelated',title:'Bananas',text:'fruit'}],sourceVotes:{b:10,unrelated:1000}});
assert.equal(voted.localSearch('camera').results[0].id,'b','learned source preference reranks a real lexical match');
assert.equal(voted.localSearch('camera').results.some(x=>x.id==='unrelated'),false,'source votes never manufacture an unrelated lexical result');
voted.setSourceVotes({a:10});assert.equal(voted.localSearch('camera').results[0].id,'a');
voted.setAliases({'photography equipment':'camera'});assert.equal(voted.localSearch('photography equipment').results.length,2);

const loaded=await loadCorpus({backendURL:'/api/corpus',fetchImpl:async url=>({ok:true,json:async()=>({records,registry,manifest})})});
assert.equal(loaded.stats().total,734);
await assert.rejects(loadCorpus({fetchImpl:async()=>{throw Error('must never call without endpoint')}}),/explicit.*backend/i);

const calls=[];
const fixtures={
 'en.wikipedia.org':{query:{search:[{pageid:123,title:'Quantum repair',snippet:'<span>Repairable</span> quantum research'}]}},
 'api.openalex.org':{results:[{id:'https://openalex.org/W1',display_name:'Quantum repair',doi:'https://doi.org/10.1/q',publication_year:2026,authorships:[]}]},
 'api.crossref.org':{message:{items:[{DOI:'10.1/q',title:['Quantum repair'],URL:'https://doi.org/10.1/q',published:{'date-parts':[[2026]]}}]}},
 'archive.org':{response:{numFound:1,docs:[{identifier:'quantum',title:'Quantum archive',description:'Repairable research'}]}},
 'api.github.com':{items:[{id:99,full_name:'lab/quantum',description:'Repairable quantum research',html_url:'https://github.com/lab/quantum'}]}
};
const fetchImpl=async (url,options={})=>{calls.push({url:String(url),options}); const parsed=new URL(url,'http://localhost');return {ok:true,json:async()=>fixtures[parsed.hostname]};};
const web=await searchWeb('quantum',{providers:Object.keys(PROVIDERS),goal:'research',must:'quantum',prefer:'repair',avoid:'irrelevant',fetchImpl,limit:50});
assert.equal(web.results.length,4,'Crossref and OpenAlex identical DOI must retain both provenance entries in one result.');
assert.equal(web.results.find(x=>x.source.includes('doi.org')).provenance.length,2);
assert.ok(web.results.every(x=>x.kind==='web'&&x.authority==='EXTERNAL_CANDIDATE'&&x.source));
assert.ok(calls.every(x=>!x.url.includes('private%20marker')&&!x.url.includes('Budget')));
assert.ok(calls.every(x=>decodeURIComponent(x.url).includes('quantum research repair')));
assert.equal(composeQuery('quantum',{goal:'research',must:'evidence',prefer:'original',avoid:'private'}),'quantum research evidence original');
assert.equal(composeQuery('quantum',{must:'title:secret OR evil'}),'quantum "title secret or evil"','derived constraint text is literal provider data');
const preparedCalls=[];
const prepared=await searchWeb('quantum "title secret or evil"',{providers:['wikipedia'],preparedQuery:true,goal:'DO NOT APPEND',must:'title:secret OR evil',fetchImpl:async(url,o)=>{preparedCalls.push(String(url));return fetchImpl(url,o);}});
assert.equal(new URL(preparedCalls[0]).searchParams.get('srsearch'),'quantum "title secret or evil"');
assert.equal(prepared.candidateResults.length,1,'candidate snapshot survives local filter removal');
assert.equal(prepared.results.length,0,'raw constraint remains metadata for local exact filtering');
assert.equal((await searchWeb('quantum',{providers:[],fetchImpl})).total,0);
await assert.rejects(searchWeb('quantum',{providers:['invented'],fetchImpl}),/Unknown provider/);
const partial=await searchWeb('quantum',{providers:['wikipedia','github'],fetchImpl:async (url,o)=>String(url).includes('github')?Promise.reject(Error('rate limited')):fetchImpl(url,o)});
assert.equal(partial.results.length,1);assert.equal(partial.errors.length,1);assert.equal(partial.errors[0].provider,'github');
const malicious=await searchWeb('quantum',{providers:['github'],fetchImpl:async()=>({ok:true,json:async()=>({items:[{id:1,full_name:'bad',html_url:'javascript:alert(1)'}]})})});
assert.equal(malicious.results.length,0,'unsafe result source URLs are excluded');
const controller=new AbortController();controller.abort();
await assert.rejects(searchWeb('quantum',{providers:['wikipedia'],fetchImpl,signal:controller.signal}),e=>e.name==='AbortError');
let backendRequest;
const backend=await searchWeb('quantum',{backendURL:'/api/search',goal:'research',providers:['github'],fetchImpl:async url=>{backendRequest=String(url);return{ok:true,json:async()=>({results:[],total:0,errors:[],offset:0,limit:10})};}});
assert.match(backendRequest,/providers=github/);assert.match(backendRequest,/goal=research/);assert.equal(backend.total,0);
await searchWeb('quantum "title secret or evil"',{backendURL:'/api/search',preparedQuery:true,must:'title:secret OR evil',providers:['github'],fetchImpl:async url=>{backendRequest=String(url);return{ok:true,json:async()=>({results:[],candidateResults:[],total:0,totalRaw:0,errors:[]})};}});
assert.equal(new URL(backendRequest).searchParams.get('preparedQuery'),'1');
assert.equal(new URL(backendRequest).searchParams.get('q'),'quantum "title secret or evil"');
const backendCandidate={id:'archive:astronomy',refId:'astronomy',title:'Astronomy archive',text:'Original astronomical archive',url:'https://archive.org/details/astronomy',source:'https://archive.org/details/astronomy',kind:'web',provider:'Internet Archive',providerId:'archive',provenance:[{provider:'archive',endpoint:'https://archive.org/advancedsearch.php',retrievedAt:'2026-10-03T00:00:00Z',relation:'CANDIDATE_ONLY'}]};
const backendSnapshot=await searchWeb('astronomy',{backendURL:'/api/search',providers:['archive'],preparedQuery:true,must:'missing',fetchImpl:async()=>({ok:true,json:async()=>({candidateResults:[backendCandidate],results:[],totalRaw:1,total:0,errors:[]})})});
assert.equal(backendSnapshot.results.length,0);assert.equal(backendSnapshot.candidateResults.length,1);
assert.equal(backendSnapshot.candidateResults[0].source,'https://archive.org/details/astronomy');assert.equal(backendSnapshot.candidateResults[0].providerId,'archive');
const cacheCalls=[];
const cachedService=createSearchService({fetchImpl:async(url,o)=>{cacheCalls.push(String(url));return fetchImpl(url,o);}});
await cachedService.webSearch('title:phone',{providers:['wikipedia']});
const preparedCached=await cachedService.webSearch('title:phone',{providers:['wikipedia'],preparedQuery:true});
assert.equal(cacheCalls.length,2,'prepared and unprepared queries cannot share cached provider results');
assert.equal(preparedCached.externalQuery,'title:phone');
console.log('PASS prior API parity, verified corpus, seven projects, fourteen lessons, Unicode BM25, private memory boundary, five providers, DOI provenance, partial failures, cancellation and backend adapter');
