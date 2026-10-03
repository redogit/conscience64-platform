/* Browser adapter for the preserved global-search route carrier.
 * The catalogue and planner create links; only search() requests live metadata.
 * Planning can also use an explicit same-origin public catalogue without a backend.
 * Live metadata requests require an explicitly selected trusted loopback backend.
 */
const CATEGORIES=new Set(['all','web','research','code','archives']);
const NAMES={crossref:'Crossref',europepmc:'Europe PMC'};
const copy=value=>value==null?null:structuredClone(value);
const clean=value=>String(value??'').replace(/\s+/gu,' ').trim();
const candidate={relation:'CANDIDATE_ONLY',corroborated:false,authorityTransfer:false,authority_transfer:false};
function localOrigin(value){
 try{
  if(typeof value!=='string'||!value.trim())throw Error();
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error();
  return url.origin;
 }catch{throw TypeError('An explicit trusted localhost or loopback HTTP(S) backend is required.');}
}
function safeURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function publicURL(value){
 try{
  if(typeof value!=='string'||!value.trim()||!globalThis.location?.href)throw Error();
  const page=new URL(globalThis.location.href),url=new URL(value,page);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==page.origin)throw Error();
  url.hash='';return url.href;
 }catch{throw TypeError('An explicit same-origin public route catalogue URL is required.');}
}
function stopped(signal){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new DOMException('Route request cancelled','AbortError');}
function parameters(query,{country='',category='all'}={}){
 if(typeof query!=='string'||!query.trim()||query.length>2048)throw TypeError('Enter a query of 1–2048 characters.');
 if(typeof country!=='string'||country&&!/^[A-Za-z]{2}$/u.test(country))throw TypeError('Invalid route country.');
 if(!CATEGORIES.has(category))throw TypeError('Unknown route category.');
 return {q:query.trim(),country:country.toUpperCase(),category};
}
function planned(data){
 if(!data||typeof data!=='object'||!Array.isArray(data.routes))throw TypeError('Backend did not return preserved route rows.');
 const routes=data.routes.filter(route=>route&&typeof route==='object'&&safeURL(route.url)).map(copy);
 return {...copy(data),...candidate,routes,mode:'routes',engine:'localhost',bounded:true,liveRequests:false};
}
function doiFor(value){const doi=clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu,'').toLowerCase();return doi.startsWith('10.')?doi:'';}
function allowedRouteURL(value,policy){
 try{
  const url=new URL(value),host=url.hostname.replace(/\.+$/u,'').toLowerCase();
  if(url.protocol!=='https:'||!host||url.username||url.password)return false;
  if((policy.blocked_tlds||[]).includes(host.split('.').at(-1))||host.split('.').includes('yandex'))return false;
  return !(policy.blocked_roots||[]).some(root=>host===root||host.endsWith('.'+root));
 }catch{return false;}
}
const quote=value=>encodeURIComponent(value).replace(/[!'()*]/gu,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
export function planPublicRoutes(query,catalogue,options={}){
 const {q,country,category}=parameters(query,options);
 if(!catalogue||!Array.isArray(catalogue.providers)||!Array.isArray(catalogue.countries)||!catalogue.policy)throw TypeError('A preserved route catalogue is required.');
 const selectedCountry=country?catalogue.countries.find(row=>row.code===country):null;
 if(country&&(!selectedCountry||country===catalogue.policy.excluded_country))throw TypeError('Country is excluded or unknown.');
 const effective=q+(selectedCountry?' "'+selectedCountry.name+'"':''),favored=new Set(['brave','mojeek','crossref','europepmc']);
 const providers=catalogue.providers.filter(provider=>provider.enabled&&!provider.known_russian_provider&&(category==='all'||provider.category===category));
 providers.sort((a,b)=>Number(a.country_affinity!==country)-Number(b.country_affinity!==country)||Number(!favored.has(a.id))-Number(!favored.has(b.id))||(a.name<b.name?-1:a.name>b.name?1:0));
 const routes=providers.flatMap(provider=>{
  if(!allowedRouteURL(provider.homepage,catalogue.policy))return[];
  const url=provider.query_template?provider.query_template.replace('{q}',quote(effective)):'https://search.brave.com/search?q='+quote('site:'+new URL(provider.homepage).hostname+' '+effective).replace(/%20/gu,'+');
  return allowedRouteURL(url,catalogue.policy)?[{...copy(provider),url,query:effective}]:[];
 });
 return {query:q,effective_query:effective,country,category,routes,country_scope:country?'keyword hint, not geographic restriction':'global',...candidate,unresolved:['Results require source-specific verification.'],source:copy(catalogue.source),mode:'routes',engine:'on-device',bounded:true,liveRequests:false};
}
function legacyRows(data){
 if(!Array.isArray(data.results))throw TypeError('Backend did not return legacy result rows.');
 const runs=Array.isArray(data.provider_runs)?data.provider_runs:[];
 return data.results.flatMap(row=>{
  if(!row||typeof row!=='object')return[];
  const source=safeURL(row.url||row.source);if(!source)return[];
  const providerId=clean(row.provider),provider=NAMES[providerId]||providerId||'Preserved search';
  const doi=doiFor(row.doi||(/doi\.org\//u.test(source)?source:''));
  const traces=Array.isArray(row.provenance)&&row.provenance.length?row.provenance:[{provider:providerId,retrieved_at:row.retrieved_at}];
  const provenance=traces.map(trace=>{
   const entry=trace&&typeof trace==='object'?copy(trace):{note:clean(trace)};
   const id=clean(entry.provider)||providerId,run=runs.find(value=>value.provider===id)||{};
   return {...entry,...candidate,provider:id,retrievedAt:entry.retrieved_at||row.retrieved_at||run.retrieved_at||'',endpoint:run.endpoint||'',responseSha256:run.response_sha256||'',carrier:copy(data.source)};
  });
  const text=doi?'DOI: '+doi:'Retrieved publication metadata';
  return [{...copy(row),...candidate,id:doi?'doi:'+doi:'legacy:'+source,refId:doi||source,title:clean(row.title)||'Untitled publication',text,snippet:text,source,url:source,doi:doi||undefined,kind:'web',authority:'EXTERNAL_CANDIDATE',provider,providerId,providers:[...new Set(provenance.map(entry=>entry.provider))],score:0,provenance,reason:'Metadata lead from '+provider+'. Verify the source content and its applicability.',raw:copy(row)}];
 });
}

export function createRouteService({baseURL,catalogueURL,fetchImpl=globalThis.fetch,signal,timeoutMs=16000}={}){
 const origin=baseURL==null?null:localOrigin(baseURL),staticURL=catalogueURL==null?null:publicURL(catalogueURL);
 if(!origin&&!staticURL)throw TypeError('An explicit trusted local backend or same-origin public catalogue is required.');
 if(typeof fetchImpl!=='function')throw TypeError('A fetch implementation is required.');
 async function request(url,options={}){
  const selectedSignal=options.signal??signal;stopped(selectedSignal);
  const controller=new AbortController(),duration=Math.min(30000,Math.max(1,Number(options.timeoutMs??timeoutMs)||16000));
  let timer,rejectStop;
  const cancellation=new Promise((_,reject)=>{rejectStop=reject;});
  const stop=reason=>{controller.abort(reason);rejectStop(reason);};
  const onAbort=()=>stop(selectedSignal.reason instanceof Error?selectedSignal.reason:new DOMException('Route request cancelled','AbortError'));
  selectedSignal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>stop(new DOMException('Local route backend timed out','TimeoutError')),duration);
  try{
   const fetchData=(async()=>{
    const response=await fetchImpl(String(url),{signal:controller.signal,headers:{Accept:'application/json'},redirect:'error',credentials:'omit'});
    if(!response.ok)throw Error('Local route backend HTTP '+(response.status||'request failed'));
    const data=await response.json();
    if(data?.error)throw Error(typeof data.error==='string'?data.error:data.error.message||'Local route backend error');
    return data;
   })();
   const data=await Promise.race([fetchData,cancellation]);stopped(selectedSignal);return data;
  }finally{clearTimeout(timer);selectedSignal?.removeEventListener('abort',onAbort);}
 }
 function endpoint(path,params){
  if(!origin)throw TypeError('Live legacy search requires an explicit trusted localhost or loopback backend.');
  const url=new URL(path,origin);for(const [key,value]of Object.entries(params||{}))url.searchParams.set(key,value);return url.href;
 }
 const service={
  baseURL:origin,
  async catalogue(options={}){
   const data=await request(staticURL||endpoint('/api/routes'),options);
   if(!data||!Array.isArray(data.providers)||!Array.isArray(data.countries))throw TypeError('Backend did not return a preserved route catalogue.');
   return {...copy(data),...candidate,mode:'routes',engine:staticURL?'on-device':'localhost',bounded:true,liveRequests:false};
  },
  async plan(query,options={}){
   const params=parameters(query,options);
   return origin?planned(await request(endpoint('/api/routes',params),options)):planPublicRoutes(query,await service.catalogue(options),options);
  },
  async search(query,options={}){
   const data=await request(endpoint('/api/legacy-search',parameters(query,options)),options),plan=planned(data),results=legacyRows(data),runs=Array.isArray(data.provider_runs)?data.provider_runs:[];
   const errors=runs.filter(run=>run.status!=='ok').map(run=>({provider:run.provider,name:NAMES[run.provider]||run.provider,error:run.error||'Unavailable',message:'Provider unavailable; this is not evidence of absence.'}));
   return {...plan,mode:'legacy-web',liveRequests:runs.length>0,separateFromFiveProviderSearch:true,results,total:results.length,totalRaw:data.results.length,provider_runs:copy(runs),errors};
  }
 };
 return Object.freeze(service);
}
