export function splitTextPages(text,columns=24,lines=3){
 columns=Math.max(1,columns);lines=Math.max(1,lines);const pages=[];let page='',column=0,line=1;
 for(const char of String(text)){if((column>=columns&&char!=='\n')||char==='\n'){column=0;line++;}if(line>lines){pages.push(page);page='';column=0;line=char==='\n'?2:1;}page+=char;if(char!=='\n')column++;}
 if(page||!pages.length)pages.push(page);return pages;
}
// Fixed viewport layout. Long menus retain their original controls/forms and page them.
export function watchViewport(callback){
 const sync=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--viewport-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--viewport-width',(v?.width||innerWidth)+'px');callback?.()};
 window.addEventListener('resize',sync);window.visualViewport?.addEventListener('resize',sync);sync();
}
export function createMenuPager(host,{previous,next,status}){
 let units=[],pages=[],index=0,frame=0;
 const wrappers=[],readers=new WeakMap();
 const observer=new MutationObserver(()=>schedule());
 const observe=()=>observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
 function reader(element){
  if(readers.has(element)){readers.get(element)();return}
  const full=element.textContent;if(!full||full.length<180||!['PRE','P','H3'].includes(element.tagName))return;
  element.dataset.reader='true';let part=0;
  const box=document.createElement('div'),text=document.createElement('pre'),row=document.createElement('div'),back=document.createElement('button'),label=document.createElement('span'),forward=document.createElement('button');
  box.className='text-pager';row.className='row';back.type=forward.type='button';back.textContent='Text back';forward.textContent='Text next';
  let columns=Math.max(8,Math.floor((host.clientWidth-24)/14)),chunks=splitTextPages(full,columns,3);
  const render=()=>{text.textContent=chunks[part];label.textContent=`${part+1}/${chunks.length}`;back.disabled=part===0;forward.disabled=part+1===chunks.length};
  back.onclick=()=>{part--;render()};forward.onclick=()=>{part++;render()};row.append(back,label,forward);box.append(text,row);element.replaceChildren(box);render();readers.set(element,()=>{const nextColumns=Math.max(8,Math.floor((host.clientWidth-24)/14));if(columns!==nextColumns){columns=nextColumns;chunks=splitTextPages(full,columns,3);part=Math.min(part,chunks.length-1);render()}});
 }
 function collect(parent){
  for(const e of parent.children){
   e.hidden=false;
   if(e.matches('form,div:not(.text-pager),details')){
    if(e.matches('.text-pager')){units.push(e);continue}
    e.classList.add('page-container');wrappers.push(e);
    if(e.matches('form,div')){e.style.margin='0';e.style.display='grid';}
    if(e.tagName==='DETAILS'){const summary=e.querySelector(':scope > summary');if(summary)units.push(summary);if(e.open)for(const child of [...e.children].filter(c=>c!==summary)){if(child.matches('form,div')){wrappers.push(child);child.classList.add('page-container');child.style.margin='0';child.style.display='grid';collect(child)}else{reader(child);units.push(child)}}}
    else collect(e);
   }else{reader(e);units.push(e);}
  }
 }
 function show(){
  const visible=new Set(pages[index]||[]);for(const e of units)e.hidden=!visible.has(e);
  for(const e of wrappers.slice().reverse())e.hidden=!units.some(unit=>visible.has(unit)&&e.contains(unit));
  previous.disabled=index===0;next.disabled=index+1>=pages.length;status.textContent=pages.length?`${index+1} / ${pages.length}`:'1 / 1';
 }
 function layout(){
  frame=0;if(host.closest('[hidden]')){host.setAttribute('aria-busy','false');return;}
  observer.disconnect();
  for(const e of units)e.hidden=false;for(const e of wrappers)e.hidden=false;
  units=[];wrappers.length=0;collect(host);
  const height=Math.max(70,host.clientHeight),gap=matchMedia('(max-height:500px)').matches?8:12;
  pages=[];let page=[],used=0;
  for(const e of units){const h=Math.ceil(e.getBoundingClientRect().height);if(!h)continue;if(page.length&&used+h+gap>height){pages.push(page);page=[];used=0;}page.push(e);used+=h+(page.length>1?gap:0)}if(page.length)pages.push(page);
  index=Math.min(index,Math.max(0,pages.length-1));show();
  // Nested wrappers may contribute a gap: split an overflowing page without clipping controls.
  for(let p=0;p<pages.length;p++){index=p;show();while(host.scrollHeight>height+1&&pages[p].length>1){const last=pages[p].pop();if(!pages[p+1])pages[p+1]=[];pages[p+1].unshift(last);show()}}
  index=Math.min(savedIndex,Math.max(0,pages.length-1));show();observe();host.setAttribute('aria-busy','false');
 }
 let savedIndex=0;
 function schedule(){savedIndex=index;host.setAttribute('aria-busy','true');previous.disabled=next.disabled=true;if(!frame)frame=requestAnimationFrame(layout)}
 previous.onclick=()=>{index=Math.max(0,index-1);show()};next.onclick=()=>{index=Math.min(pages.length-1,index+1);show()};
 host.addEventListener('invalid',e=>{const page=pages.findIndex(rows=>rows.some(row=>row.contains(e.target)));if(page>=0){index=page;show();e.target.focus({preventScroll:true})}},true);
 host.addEventListener('toggle',schedule,true);
 observe();
 return{refresh:schedule,reset(){index=0; schedule()}};
}
