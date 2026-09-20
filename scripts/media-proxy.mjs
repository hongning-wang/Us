import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';

// Expose only flat media files to the provider. All application APIs stay local.
export function mediaProxy(upstream='http://127.0.0.1:5173') {
 return createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)||!/^\/api\/media\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(req.url||'')||req.url.includes('..')) {
   res.writeHead(404);res.end();return;
  }
  try {
   const response=await fetch(upstream+req.url,{method:req.method,headers:req.headers.range?{Range:req.headers.range}:{},signal:AbortSignal.timeout(30_000),redirect:'error'});
   const headers={};for(const name of ['content-type','content-length','content-range','accept-ranges'])if(response.headers.has(name))headers[name]=response.headers.get(name);
   res.writeHead(response.status,headers);
   if(req.method==='HEAD'||!response.body)res.end();else Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(502);res.end('Media server unavailable.');}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const port=Number(process.env.MEDIA_PROXY_PORT||5174);
 mediaProxy().listen(port,'127.0.0.1',()=>console.log(`Media-only proxy listening on http://127.0.0.1:${port}`));
}
