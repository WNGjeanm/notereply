const MENTION=/@\[\[([^\]\r\n]+)\]\]/g;
function mentionsIn(text){return Array.from(String(text||'').matchAll(MENTION),m=>({path:m[1],from:m.index,to:m.index+m[0].length,raw:m[0]}));}
function mentionContext(text,caret){
 const before=text.slice(0,caret),from=before.lastIndexOf('@');if(from<0)return null;
 if(from>0&&/[a-z0-9._%+\\-]/i.test(before[from-1]))return null;
 const query=before.slice(from+1);if(query.length>100||/[\r\n@\[\]]/.test(query))return null;
 return {from,to:caret,query};
}
function atomicRange(text,from,to,key){
 let start=from,end=to,found=false;
 for(const m of mentionsIn(text)){
  if(from===to){if(key==='Backspace'&&from===m.to||key==='Delete'&&from===m.from){start=m.from;end=m.to;found=true;break;}}
  else if(from<m.to&&to>m.from){start=Math.min(start,m.from);end=Math.max(end,m.to);found=true;}
 }
 return found?{from:start,to:end}:null;
}
function rankFiles(files,query,configDir){
 const q=query.trim().toLocaleLowerCase();
 const scored=files.filter(f=>f.path&&!f.children&&f.path!==configDir&&!f.path.startsWith(configDir+'/')&&!f.path.split('/').includes('.git')&&!/[\]\r\n]/.test(f.path)).map(file=>{
  const name=(file.name||file.path.split('/').pop()).toLocaleLowerCase(),path=file.path.toLocaleLowerCase();let score=0;
  if(q){if(name===q)score=1000;else if(name.startsWith(q))score=800;else if(name.includes(q))score=600;else if(path.includes(q))score=400;else{let at=0,gaps=0;for(const char of q){const index=path.indexOf(char,at);if(index<0)return null;gaps+=index-at;at=index+1;}score=200-gaps;}}
  return {file,score};
 }).filter(Boolean);
 scored.sort((a,b)=>b.score-a.score||(b.file.stat?.mtime||0)-(a.file.stat?.mtime||0)||a.file.path.localeCompare(b.file.path));return scored.slice(0,30).map(x=>x.file);
}
module.exports={mentionsIn,mentionContext,atomicRange,rankFiles};
