// Only the browser APIs used by the existing extension need a native adapter.
const native = (message: unknown): Promise<any> => (window as any).webkit.messageHandlers.us.postMessage(message);
export const browser = {
 storage: {local: {
  get: (key: string) => native({type:'storage',action:'get',key}),
  set: (values: Record<string,unknown>) => native({type:'storage',action:'set',values}),
  remove: (key: string) => native({type:'storage',action:'remove',key}),
 }},
 runtime: {async sendMessage(message: any) {
  if(message.type !== 'us-profile-photos') return native(message);
  // Use the logged-in Instagram session; never substitute a fixed person.
  const username=message.username;
  if(!/^[\w.]{1,30}$/.test(username)) return {error:'Invalid Instagram username.'};
  const candidates:Array<{url:string;source:string;label:string}>=[];
  for(const img of document.querySelectorAll<HTMLImageElement>('img')) {
   if(img.alt.toLowerCase()===`${username.toLowerCase()}'s profile picture`)
    candidates.push({url:img.src,source:'profile',label:'Profile photo'});
  }
  try {
   const source=[...document.scripts].map(s=>s.textContent).join('');
   const appId=source.match(/"(?:APP_ID|app_id)"\s*:\s*"(\d+)"/)?.[1];
   if(appId){
    const response=await fetch('/api/v1/users/web_profile_info/?username='+encodeURIComponent(username),{credentials:'include',headers:{'X-IG-App-ID':appId},signal:AbortSignal.timeout(10000)});
    const user=(await response.json()).data?.user;
    if(user?.username?.toLowerCase()===username.toLowerCase()){
     if(user.has_profile_pic===false)candidates.length=0;
     else if(user.profile_pic_url_hd||user.profile_pic_url)candidates.unshift({url:user.profile_pic_url_hd||user.profile_pic_url,source:'profile',label:'Profile photo'});
     for(const {node} of user.edge_owner_to_timeline_media?.edges||[])if(!node.is_video&&node.display_url)candidates.push({url:node.display_url,source:'post',label:'Recent post'});
    }
   }
  }catch{/* The existing photo panel also supports choosing a file. */}
  return {data:candidates.filter(c=>{try{const url=new URL(c.url);return url.protocol==='https:'&&/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)}catch{return false}}).filter((c,i,a)=>a.findIndex(x=>x.url===c.url)===i).slice(0,7)};
 }},
};
export const defineContentScript = <T>(definition:T) => definition;
export async function createShadowRootUi(_ctx:unknown,options:{name:string}) {
 const host=document.createElement(options.name);
 const root=host.attachShadow({mode:'open'});
 const container=document.createElement('div');root.append(container);
 return {uiContainer:container,mount(){document.body.append(host)},remove(){host.remove()}};
}
