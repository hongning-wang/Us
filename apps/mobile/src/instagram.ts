import extension from '../../extension/entrypoints/instagram.content';

function start(){
 if(location.hostname!=='www.instagram.com' || (window as any).__usExtensionLoaded)return;
 (window as any).__usExtensionLoaded=true;
 void extension.main({onInvalidated(callback:()=>void){window.addEventListener('pagehide',()=>{
  callback();(window as any).__usExtensionLoaded=false;
 },{once:true})}} as any);
}
start();
window.addEventListener('pageshow',event=>{if(event.persisted)start()});
