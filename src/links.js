const {drawioText}=require('./drawio');
const MAX_LINKS=8,MAX_CHARS=100000,MAX_FILE=15*1024*1024;
function extractLinks(text,embeddedOnly=false){
 const found=[];const wiki=/(!?)\[\[([^\]\n]+)\]\]/g;let m;
 while((m=wiki.exec(text||''))){if(embeddedOnly&&!m[1])continue;found.push({target:(text||'')[m.index-1]==='@'?m[2]:m[2].split('|')[0].trim(),embedded:!!m[1],mention:(text||'')[m.index-1]==='@',offset:m.index});}
 const markdown=/(!?)\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g;
 while((m=markdown.exec(text||''))){if(embeddedOnly&&!m[1])continue;let target=m[2].replace(/^<|>$/g,'');if(/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target))continue;found.push({target,embedded:!!m[1],offset:m.index});}
 return found.sort((a,b)=>a.offset-b.offset).filter((v,i,a)=>a.findIndex(x=>x.target===v.target)===i);
}
function splitTarget(target){let decoded=target;try{decoded=decodeURIComponent(target);}catch{}const hash=decoded.indexOf('#');return {path:(hash<0?decoded:decoded.slice(0,hash)).replace(/\\/g,'/'),subpath:hash<0?'':decoded.slice(hash+1)};}
function allowedPath(path,configDir){
 const normalized=String(path||'').replace(/\\/g,'/');
 if(!normalized||normalized.startsWith('/')||/^[a-z]:/i.test(normalized))return false;
 const parts=normalized.split('/');return !parts.some(p=>p==='..'||p==='.git')&&normalized!==configDir&&!normalized.startsWith(configDir+'/');
}
function selectSection(text,subpath){
 if(!subpath)return text;const lines=text.split(/\r?\n/);
 if(subpath.startsWith('^')){const id=subpath.slice(1),index=lines.findIndex(l=>l.trimEnd().endsWith('^'+id));if(index<0)throw new Error('找不到指定块：'+subpath);let start=index;while(start>0&&lines[start-1].trim())start--;return lines.slice(start,index+1).join('\n').replace(new RegExp('\\s*\\^'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$'),'');}
 const clean=s=>s.replace(/[*_`]/g,'').trim().toLowerCase();let start=-1,level=0,inFence=false;
 for(let i=0;i<lines.length;i++){if(/^\s*(```|~~~)/.test(lines[i]))inFence=!inFence;if(inFence)continue;const h=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);if(!h)continue;if(start>=0&&h[1].length<=level)return lines.slice(start,i).join('\n');if(start<0&&clean(h[2])===clean(subpath)){start=i;level=h[1].length;}}
 if(start<0)throw new Error('找不到指定标题：'+subpath);return lines.slice(start).join('\n');
}
async function resolveMessageLinks(plugin,user,doc,signal){
 if(user.linkResolutionDone)return;
 const app=plugin.app,source=user.reference?.filePath||user.sourcePath||'',queue=extractLinks([user.content,user.reference?.text].filter(Boolean).join('\n')).map(link=>({...link,source,depth:0}));
 user.attachments=user.attachments.filter(a=>!a.linkedPath);user.linkReports=[];if(!queue.length){user.linkResolutionDone=true;return;}
 if(!doc?.defaultView?.DOMParser)throw new Error('无法初始化链接读取，请重新打开对话面板。');
 const visited=new Set();let count=0,total=0;
 const abort=()=>{if(signal?.aborted)throw Object.assign(new Error('已停止读取链接'),{name:'AbortError'});};
 for(const link of queue){
  abort();const target=link.mention?{path:link.target,subpath:''}:splitTarget(link.target);let file;
  try{
   if(++count>MAX_LINKS)throw new Error(`每次最多读取${MAX_LINKS}个链接，请分批提问`);
   if(/^[a-z][\w+.-]*:/i.test(target.path))throw new Error('只读取当前笔记库内的文件');
   file=target.path?(link.mention?app.vault.getAbstractFileByPath?.(target.path):null)||app.metadataCache?.getFirstLinkpathDest(target.path,link.source):app.vault.getAbstractFileByPath?.(link.source);
   if(!file&&target.path){const parent=link.source.includes('/')?link.source.slice(0,link.source.lastIndexOf('/')+1):'';for(const p of [parent+target.path,target.path,parent+target.path+'.md',target.path+'.md'])if(allowedPath(p,app.vault.configDir)){file=app.vault.getAbstractFileByPath?.(p);if(file)break;}}
   if(!file||file.children||!file.extension)throw new Error('笔记库内找不到该文件');
   if(!allowedPath(file.path,app.vault.configDir))throw new Error('不读取插件配置目录或库外文件');
   const key=file.path+'#'+target.subpath;if(visited.has(key))continue;visited.add(key);
   if(file.stat?.size>MAX_FILE)throw new Error('文件超过15MB，请拆分后上传');
   const ext=file.extension.toLowerCase();let items=[],note='';
   if(['md','txt','csv','json','log','drawio','xml','svg'].includes(ext)){
    const text=await app.vault.cachedRead(file);abort();let content=text;
    if(ext==='drawio'||(/<(?:mxfile|mxGraphModel)\b/.test(text)&&['xml','svg'].includes(ext))||ext==='svg'&&/\bcontent=["'][\s\S]*mxfile/.test(text)){
     const parsed=drawioText(text,file.path,doc.defaultView.DOMParser);content=parsed.text;note=`drawio：${parsed.pages}页、${parsed.nodes}个节点/标注、${parsed.edges}条连线`;
    }else if(ext==='md'){content=selectSection(text,target.subpath);note=target.subpath?'笔记指定标题/块':'笔记正文';}
    else if(ext==='svg'){
     // Plain SVG still provides actual labels and geometry, rather than an unread link.
     content='SVG 文件实际源码（文字、图形及连线坐标）：\n'+text;note='SVG 源码';
    }else note='文字文件';
    if(total+content.length>MAX_CHARS)throw new Error('链接资料合计超过10万字，请缩小选区或分批提问');
    items=[await plugin.attachments.text(file.path+(target.subpath?'#'+target.subpath:''),content,{note,linkedPath:file.path})];total+=content.length;
    if(ext==='md'&&link.depth<1)for(const nested of extractLinks(content,true))queue.push({...nested,source:file.path,depth:link.depth+1});
   }else{
    const bytes=await app.vault.readBinary(file);abort();if(bytes.byteLength>MAX_FILE)throw new Error('文件超过15MB');
    const localFile=new doc.defaultView.File([bytes],file.name||file.path.split('/').pop());items=await plugin.attachments.addFile(localFile,doc);note=items.map(a=>a.note||a.kind).join('、');
    for(const item of items)item.linkedPath=file.path;
   }
   abort();if(user.attachments.length+items.length>10)throw new Error('本次附件与链接资料超过10项，请分批发送');
   user.attachments.push(...items);user.linkReports.push({target:link.target,path:file.path,ok:true,note});
  }catch(e){if(e.name==='AbortError')throw e;user.linkReports.push({target:link.target,path:file?.path||'',ok:false,note:e.message||'读取失败'});}
 }
 user.linkResolutionDone=true;
}
module.exports={extractLinks,splitTarget,allowedPath,selectSection,resolveMessageLinks};
