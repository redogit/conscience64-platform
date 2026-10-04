// Tests follow the same Previous/Next controls available to users.
async function reveal(page,locator){
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 if(await locator.isVisible().catch(()=>false))return;
 const menu=await page.locator('#drawer').isVisible();
 const back=page.locator(menu?'#drawer-prev':'#prev'),next=page.locator(menu?'#drawer-next':'#next');
 if(!menu&&!await page.locator('#results').isVisible())return;
 for(let i=0;i<100&&await back.isEnabled();i++)await back.click();
 for(let i=0;i<100;i++){if(await locator.isVisible().catch(()=>false))return;if(!await next.isEnabled())break;await next.click()}
}
function adaptPage(page){
 const wrap=locator=>new Proxy(locator,{get(target,key){
  const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  if(['click','fill','selectOption','check','uncheck'].includes(key))return async(...args)=>{await reveal(page,target);return value.apply(target,args)};
  if(key==='waitFor')return async(...args)=>{if(args[0]?.state!=='hidden')await reveal(page,target);return value.apply(target,args)};
  if(['getByRole','getByLabel','getByText','locator','filter','first','last','nth'].includes(key))return(...args)=>wrap(value.apply(target,args));
  return value.bind(target);
 }});
 for(const name of ['getByRole','getByLabel','getByText']){const original=page[name].bind(page);page[name]=(...args)=>wrap(original(...args))}
 return page;
}
module.exports={adaptPage,reveal};

async function readAllMenu(page){
 const back=page.locator('#drawer-prev'),next=page.locator('#drawer-next');for(let i=0;i<100&&await back.isEnabled();i++)await back.click();
 let text='';for(let i=0;i<100;i++){
  text+=await page.locator('#drawer-body').innerText();
  for(const reader of await page.locator('#drawer-body .text-pager:visible').all()){
   const forward=reader.getByRole('button',{name:'Text next',exact:true});
   text+=await reader.locator('pre').textContent();for(let j=0;j<1000&&await forward.isEnabled();j++){await forward.click();text+=await reader.locator('pre').textContent()}
  }
  if(!await next.isEnabled())break;await next.click();
 }
 return text;
}
module.exports.readAllMenu=readAllMenu;
