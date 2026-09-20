export const pairGlyph='<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="10" r="4.6" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="10" r="4.6" stroke="currentColor" stroke-width="1.5"/></svg>';
export function actionContent(button:HTMLButtonElement,kind:'composer'|'reel'|'reply'|'share',recipient?:string){
 button.type='button';
 if(kind==='composer'){
  button.innerHTML='<span class="us-wordmark">us</span>';
  button.setAttribute('aria-label','Create a video with Us');button.title='Imagine with Us';
 }else{
  const text=kind==='reply'?'Continue':'Make this us';
  button.innerHTML=pairGlyph;
  const label=document.createElement('span');label.textContent=text;button.append(label);
  button.setAttribute('aria-label',kind==='reply'?'Imagine what happens next':text);
 }
}
export const buttonStyles=`
[data-us-action]{box-sizing:border-box;appearance:none;-webkit-appearance:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;gap:7px;line-height:1;outline-offset:3px}
[data-us-actions]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
[data-us-action="original"]{min-height:32px;padding:0 12px;border:1px solid rgb(var(--ig-separator,219,219,219));border-radius:16px;color:rgb(var(--ig-secondary-text,115,115,115));font-size:12px;font-weight:500;text-decoration:none;background:transparent}
[data-us-action="original"]:hover{background:rgba(128,128,128,.08)}
[data-us-action]:focus-visible{outline:2px solid #4a5df9}
[data-us-action="composer"]{width:30px;height:30px;padding:0;margin:0 7px 0 5px;align-self:center;border:0;border-radius:0;background:transparent;color:rgb(var(--ig-primary-text,0,0,0))}
[data-us-action="composer"] .us-wordmark{font-size:21px;font-weight:600;letter-spacing:-1.4px;line-height:1;transform:translateY(-1px)}
[data-us-action="composer"]:hover{opacity:.55}
[data-us-action="reference"]{min-height:32px;padding:0 10px;margin:0;border:0;border-radius:16px;background:transparent;color:rgb(var(--ig-primary-text,0,0,0));font-size:12px;font-weight:600;letter-spacing:0}
[data-us-action="reference"]:hover{opacity:.6}
[data-us-share-footer]{display:flex!important;gap:8px;align-items:center}
[data-us-share-footer]>button,[data-us-share-footer]>[role="button"]{box-sizing:border-box!important;flex:1 1 0!important;width:0!important;min-width:0!important;height:40px!important;min-height:40px!important;max-height:40px!important;margin:0!important;padding:0 12px!important;border-radius:8px!important;display:inline-flex!important;align-items:center;justify-content:center;font-size:14px!important;line-height:20px!important;white-space:nowrap}
[data-us-share-standalone]{display:flex;flex-shrink:0;padding-top:12px}[data-us-share-standalone] [data-us-action="share"]{width:100%}
[data-us-action="share"]{height:40px;min-height:40px;width:auto;padding:0 12px;margin:0;border:0;border-radius:8px;background:#4a5df9;color:#fff;font-size:14px;font-weight:600;white-space:nowrap;transition:opacity .15s,transform .15s}
[data-us-share-error]{font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#ed4956;flex-basis:100%;white-space:normal}[data-us-share-footer]:has([data-us-share-error]){flex-wrap:wrap}
[data-us-action="share"]:active{transform:scale(.98)}
[data-us-action="share"]:disabled{opacity:.45;cursor:default}
`;
