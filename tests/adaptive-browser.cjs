// Real app, actual public corpus; typing and local browsing must make no external requests.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const baseURL=process.env.WORKSPACE_URL||'http://127.0.0.1:8765';
const launch={headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
if(process.env.CHROMIUM_EXECUTABLE_PATH)launch.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;
async function geometry(page){
 const out=await page.evaluate(()=>{
  const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:b.width,h:b.height}};
  return{width:innerWidth,height:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,
   controls:[...document.querySelectorAll('button,input,select,textarea,a[href],summary')].filter(e=>!e.closest('[hidden]')&&e.getClientRects().length&&!e.closest('[inert]')&&!e.classList.contains('skip')).map(e=>({text:e.getAttribute('aria-label')||e.textContent.slice(0,50),tag:e.tagName,parent:e.parentElement.textContent.slice(0,80),clip:e.closest('#main,#drawer')?r(e.closest('#main,#drawer')):null,...r(e)})),
   drawerOverflow:!document.querySelector('#drawer').hidden&&document.querySelector('#drawer-body').scrollHeight>document.querySelector('#drawer-body').clientHeight+2};
 });
 assert.ok(out.sw<=out.width+1,'horizontal page scrolling: '+JSON.stringify(out));
 assert.ok(out.sh<=out.height+1,'vertical page scrolling: '+JSON.stringify(out));
 for(const c of out.controls){if(c.clip)assert.ok(c.y>=c.clip.y-1&&c.bottom<=c.clip.bottom+1,'control clipped by its panel: '+JSON.stringify(c));assert.ok(c.x>=-1&&c.y>=-1&&c.right<=out.width+1&&c.bottom<=out.height+1,'control outside viewport: '+JSON.stringify(c));}
 assert.equal(out.drawerOverflow,false,'menu must paginate instead of scroll');
}
async function menuReady(page){await page.waitForFunction(()=>document.querySelector('#drawer-body').getAttribute('aria-busy')!=='true')};
async function menuFind(page,locator){for(let i=0;i<100;i++){await menuReady(page);if(await locator.isVisible())return locator;const next=page.locator('#drawer-next');if(!await next.isEnabled())break;await next.click();}throw Error('Menu item inaccessible: '+locator);}
(async()=>{
 const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{if(new URL(r.request().url()).origin===new URL(baseURL).origin)return r.continue();external.push(r.request().url());return r.abort()});
 await page.addInitScript(()=>localStorage.setItem('conscience64.play.v1.orbit',JSON.stringify({schema:'conscience64.play/v1',app:'orbit',data:{items:Array.from({length:13},(_,i)=>({id:'viewport-'+i,title:'Commuting bike '+i,text:'Electric bike commuting battery range under $2000. '+('Long source text '.repeat(200)),source:'',language:'en'}))}})));
 try{
  await page.goto(baseURL);await page.waitForFunction(()=>window.Conscience64Search&&document.querySelector('#submit')?.disabled===false);
  const pendingPager=await page.evaluate(async()=>{
   const {createMenuPager}=await import('./workspace/viewport.mjs');
   const host=document.createElement('div'),previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('span');
   host.style.cssText='position:fixed;left:0;top:0;width:300px;height:70px;overflow:hidden';document.body.append(host);
   const control=()=>{const b=document.createElement('button');b.style.height='45px';b.textContent='Item';return b};
   host.append(control(),control());const pager=createMenuPager(host,{previous,next,status});pager.reset();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const before=next.disabled;host.replaceChildren(control());pager.reset();
   const pending=next.disabled;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const after=next.disabled;host.remove();return{before,pending,after};
  });
  assert.equal(pendingPager.before,false,'two pages enable Next');
  assert.equal(pendingPager.pending,true,'a rebuilt menu must not expose stale paging controls');
  assert.equal(pendingPager.after,true,'single-page menus disable Next');
  await geometry(page); // Catches the old composer below the viewport.
  await page.locator('#question').fill('bi cam');
  await page.locator('#question').press('Home');await page.locator('#question').press('ArrowRight');await page.locator('#question').press('ArrowRight');
  await page.locator('[data-completion="bike"]').waitFor({timeout:1500});
  await page.locator('[data-completion="bike"]').click();
  assert.equal(await page.locator('#question').inputValue(),'bike cam','completion follows the edited word, preserving its suffix');
  await page.locator('#reset').click();
  await page.locator('#question').fill('ele');
  await page.locator('[data-completion="electric"]').click();
  await page.locator('#question').dispatchEvent('compositionstart');
  await page.locator('#question').dispatchEvent('keydown',{key:'Backspace',isComposing:true,keyCode:229});
  assert.equal(await page.locator('#question').inputValue(),'','IME Backspace does not pull a chosen word into the draft');
  await page.locator('#question').dispatchEvent('compositionend');
  await page.locator('#question').fill('bi');await page.locator('[data-completion="bike"]').click();
  assert.match(await page.locator('#word-chain').innerText(),/electric.*bike/s);
  await page.locator('#word-chain button[data-word="electric"]').click();
  await page.locator('#question').pressSequentially('hybrid');
  assert.equal(await page.locator('#question').inputValue(),'hybrid bike ','editing a prior word preserves following words and the caret');
  await page.locator('#reset').click();
  await page.locator('#question').fill('ele');await page.locator('[data-completion="electric"]').click();
  await page.locator('#question').fill('bi');await page.locator('[data-completion="bike"]').click();
  await page.locator('#context-proposals button[data-context-kind="question"]').first().click();
  await page.locator('#descriptor-value').waitFor({timeout:2000});
  assert.equal(await page.locator('#accepted-context button').count(),0,'a missing budget is not silently accepted as a value');
  await page.locator('#descriptor-value').fill('に');
  await page.locator('#descriptor-value').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  assert.equal(await page.locator('#descriptor-value').count(),1,'IME candidate confirmation does not accept an unfinished detail');
  await page.locator('#descriptor-value').fill('under $2,000');
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#descriptor-value').inputValue(),'under $2,000','viewport adaptation retains an unfinished descriptor');
  await page.getByRole('button',{name:'Add detail',exact:true}).click();
  assert.equal(await page.locator('#accepted-context button').count(),1);
  await page.locator('#accepted-context button').click();
  assert.equal(await page.locator('#accepted-context button').count(),0);
  await page.locator('#question').press('Backspace');assert.equal(await page.locator('#question').inputValue(),'bike');
  await page.locator('#question').press('Escape');
  const sizes=[{width:1440,height:900},{width:768,height:1024},{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:390,height:320}];
  for(const size of sizes){
   await page.setViewportSize(size);await page.locator('#reset').click();
   await geometry(page);
   await page.locator('#question').fill('bike');await page.locator('#ask').evaluate(f=>f.requestSubmit());
   await page.locator('.card').first().waitFor();await geometry(page);
   const seen=new Set();for(let i=0;i<100;i++){for(const id of await page.locator('.card').evaluateAll(es=>es.map(e=>e.dataset.resultId)))seen.add(id);if(!await page.locator('#next').isEnabled())break;await page.locator('#next').click();}
   assert.ok([...seen].filter(id=>id.startsWith('viewport-')).length===13,'all results remain reachable');
   for(const drawer of ['recent','add','refine','tools']){await page.locator('[data-drawer="'+drawer+'"]').first().click();await menuReady(page);await geometry(page);for(let i=0;i<100;i++){await menuReady(page);if(!await page.locator('#drawer-next').isEnabled())break;await page.locator('#drawer-next').click();await geometry(page)}await page.locator('#close').click()}
   await page.screenshot({path:`adaptive-${size.width}x${size.height}-preview.png`});
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#reset').click();await page.locator('#question').fill('An electric bike for commuting ');await page.waitForTimeout(700);
  await page.screenshot({path:'adaptive-builder-preview.png'});
  await page.setViewportSize({width:390,height:320});
  await page.locator('#reset').click();await page.locator('#question').fill('longword '.repeat(220).trim());await page.locator('#ask').evaluate(f=>f.requestSubmit());
  await page.locator('[data-drawer="recent"]').click();await page.waitForTimeout(80);await geometry(page);
  for(let i=0;i<100;i++){await menuReady(page);if(!await page.locator('#drawer-next').isEnabled())break;await page.locator('#drawer-next').click();await geometry(page)}
  await page.locator('#close').click();
  await page.setViewportSize({width:390,height:844});await page.locator('#reset').click();
  await page.locator('#question').fill('Commuting bike 0');await page.locator('#ask').evaluate(f=>f.requestSubmit());
  await page.locator('.card[data-result-id="viewport-0"] button').last().click();
  await (await menuFind(page,page.getByRole('button',{name:'Delete',exact:true}))).click();
  assert.equal(await page.locator('#drawer').isVisible(),false,'deleted note actions close so repeated Delete cannot overwrite undo');
  await page.locator('[data-drawer="tools"]').click();
  await (await menuFind(page,page.getByRole('button',{name:'Undo last library change',exact:true}))).click();
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('conscience64.play.v1.orbit')).data.items.some(x=>x.id==='viewport-0')),'Undo restores the deleted note');
  await page.locator('#close').click();
  for(const size of [{width:390,height:240},{width:320,height:240}]){await page.setViewportSize(size);await page.waitForTimeout(100);await geometry(page);const control=page.locator('.card button').first();await control.click();assert.equal(await control.innerText(),'Selected','short viewport actions remain clickable');}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('PASS adaptive viewport: Markov word selection, descriptor add/remove, Backspace, all result pages, all menu pages, 6 device/keyboard sizes, no typing network.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
module.exports={menuFind,geometry};
