// Conditional polling works across Vercel instances; revisions come from the shared database.
let liveTimer,liveBusy=false,liveEpoch=0,liveWrites=0,livePending=null,liveFailures=0;
function liveInvalidate(){liveEpoch++;livePending=null}
function liveWriteStarted(){liveInvalidate();liveWrites++}
function liveWriteFinished(){liveWrites=Math.max(0,liveWrites-1);scheduleLive(0)}
function liveStatus(connected){const el=document.querySelector('#live-status');if(el){el.classList.toggle('offline',!connected);el.title=connected?'Actualización automática: comprueba cambios cada 2 segundos':'Conexión interrumpida. Reintentando automáticamente.';el.setAttribute('aria-label',el.title)}}
function liveCanApply(){return !dialog.open&&!liveWrites&&!document.querySelector('button[type=submit]:disabled')&&!document.activeElement?.closest('form')&&!['import','settings'].includes(view)}
function applyLivePending(){
 if(!livePending||!state||livePending.user.id!==state.user.id||!liveCanApply())return;
 const data=livePending;livePending=null;if(data.revision===state.revision)return;
 const added=state.user.role==='admin'?data.users.filter(u=>u.role==='consumer'&&!state.users.some(old=>old.id===u.id)):[];
 const selected=document.querySelector('#cart-consumer')?.value,focus=document.activeElement,focusId=focus?.id,selection=typeof focus?.selectionStart==='number'?[focus.selectionStart,focus.selectionEnd]:null,scroll=window.scrollY;
 state=data;cart=cart.filter(c=>state.products.some(p=>p.id===c.id));
 if(view==='users'){
  // Keep the invitation QR/link and heading controls intact while updating the roster.
  const holder=document.createElement('div');holder.innerHTML=users();const panels=holder.querySelectorAll('section.panel');const current=document.querySelector('#main > section.panel:last-of-type');if(current)current.replaceWith(panels[panels.length-1]);adaptTables();
 }else if(view==='catalog'){
  document.querySelector('#product-results').innerHTML=catalogRows();document.querySelector('#cart-content').innerHTML=cartContent();if(selected&&document.querySelector('#cart-consumer'))document.querySelector('#cart-consumer').value=selected;adaptTables();
 }else if(view==='analytics'){
  loadAnalytics();loadMonthly();
  const people=document.querySelector('#monthly-form')?.elements.person;if(people){const value=people.value;people.innerHTML='<option value="">Todas las personas</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');people.value=value;}
 }else render();
 if(focusId){const next=document.getElementById(focusId);if(next&&next!==focus){next.focus({preventScroll:true});if(selection)next.setSelectionRange(...selection)}}
 window.scrollTo(0,scroll);if(added.length)toast(added.length===1?`Nuevo consumidor: ${added[0].name}`:`${added.length} nuevos consumidores registrados.`);
}
function scheduleLive(delay=2000){clearTimeout(liveTimer);liveTimer=setTimeout(pollLive,delay)}
async function pollLive(){
 if(liveBusy)return;
 if(document.hidden||!state||liveWrites){scheduleLive();return}
 applyLivePending();const uid=state.user.id,epoch=liveEpoch,revision=livePending?.revision||state.revision;
 liveBusy=true;
 try{
  const response=await fetch('/api/state',{credentials:'same-origin',cache:'no-store',headers:revision?{'If-None-Match':revision}:{},signal:AbortSignal.timeout(12000)});
  if(epoch!==liveEpoch||state?.user.id!==uid)return;
  if(response.status===401){liveInvalidate();state=null;cart=[];renderLogin();return}
  if(response.status===304){liveFailures=0;liveStatus(true);return}
  if(!response.ok)throw Error('No se pudo sincronizar.');
  const data=await response.json();if(epoch!==liveEpoch||state?.user.id!==uid)return;
  livePending=data;liveFailures=0;liveStatus(true);applyLivePending();
 }catch{liveFailures++;liveStatus(false)}
 finally{liveBusy=false;scheduleLive(Math.min(30000,2000*2**Math.min(liveFailures,4)))}
}
function resumeLive(){if(!document.hidden)scheduleLive(0)}
document.addEventListener('visibilitychange',resumeLive);
document.addEventListener('close',()=>{applyLivePending();resumeLive()},true);
document.addEventListener('focusout',resumeLive);
window.addEventListener('focus',resumeLive);
window.addEventListener('online',resumeLive);
window.addEventListener('offline',()=>liveStatus(false));
scheduleLive();
