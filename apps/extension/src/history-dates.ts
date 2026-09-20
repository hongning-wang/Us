/** Read only date-shaped Instagram labels, never arbitrary message text. */
export function parseInstagramDate(raw:string,now=new Date()):string|undefined {
 const text=raw.replace(/[\u00a0\u202f]/g,' ').replace(/\s+at\s+/i,', ').trim();
 const month=/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:,?\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?))?$/i.exec(text);
 if(month){
  let year=month[3]?Number(month[3]):now.getFullYear();
  let date=new Date(`${month[1]} ${month[2]}, ${year} ${month[4]||'00:00'}`);
  if(!month[3]&&date.getTime()>now.getTime())date=new Date(`${month[1]} ${month[2]}, ${--year} ${month[4]||'00:00'}`);
  return Number.isFinite(date.getTime())?date.toISOString():undefined;
 }
 const relative=/^(Today|Yesterday|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)(?:,?\s+(\d{1,2}:\d{2})(?:\s*([AP]M))?)?$/i.exec(text);
 if(!relative)return;
 const date=new Date(now);date.setHours(0,0,0,0);
 const name=relative[1]!.toLowerCase();
 if(name==='yesterday')date.setDate(date.getDate()-1);
 else if(name!=='today')date.setDate(date.getDate()-(date.getDay()-['sun','mon','tue','wed','thu','fri','sat'].indexOf(name.slice(0,3))+7)%7);
 if(relative[2]){let [hour=0,minute=0]=relative[2].split(':').map(Number);if(relative[3])hour=hour%12+(relative[3].toUpperCase()==='PM'?12:0);if(hour>23||minute>59)return;date.setHours(hour,minute);}
 return date.toISOString();
}

export function messageDates(articles:HTMLElement[]):Map<HTMLElement,string> {
 const dates=new Map<HTMLElement,string>();if(!articles.length)return dates;
 let root:HTMLElement=articles[0]!;
 while(root.parentElement&&!/auto|scroll/.test(getComputedStyle(root).overflowY))root=root.parentElement;
 const markers=[...root.querySelectorAll<HTMLElement>('span,time[datetime]')].flatMap(node=>{
  if(node.closest('[role=article],[role=group][tabindex="-1"]')||node.childElementCount)return [];
  const date=node.getAttribute('datetime')||parseInstagramDate(node.textContent||'');
  return date&&Number.isFinite(Date.parse(date))?[{node,date}]:[];
 });
 let i=0,context:string|undefined;
 for(const article of articles){
  while(i<markers.length&&(markers[i]!.node.compareDocumentPosition(article)&Node.DOCUMENT_POSITION_FOLLOWING)){context=markers[i++]!.date;}
  const group=article.closest('[role=group][tabindex="-1"]');
  const explicit=article.querySelector('[datetime]')?.getAttribute('datetime')||group?.querySelector('[datetime]')?.getAttribute('datetime');
  const date=explicit||context;if(date&&Number.isFinite(Date.parse(date)))dates.set(article,new Date(date).toISOString());
 }
 return dates;
}
