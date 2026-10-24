const {copyText}=require('./clipboard');
const {tableMarkdown}=require('./selection');
const DIAGRAMS=new Set(['mermaid','chart','charts','echarts','vega','vega-lite','plantuml','dot','graphviz','markmap','mindmap']);
// Read fenced diagrams and GFM tables without mistaking code examples for tables.
function extractBlocks(markdown){
 const lines=markdown.replace(/\r\n/g,'\n').split('\n'),blocks=[];
 for(let i=0;i<lines.length;i++){
  const fence=/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^\n]*$/.exec(lines[i]);
  if(fence){const start=i,marker=fence[1],language=fence[2].toLowerCase();let end=i+1;
   for(;end<lines.length;end++)if(new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}\\s*$').test(lines[end]))break;
   if(end<lines.length&&DIAGRAMS.has(language))blocks.push({kind:'diagram',language,raw:lines.slice(start,end+1).join('\n')});i=end;continue;
  }
  const divider=lines[i+1]?.trim().replace(/^\|/,'').replace(/\|$/,'');
  if(lines[i].includes('|')&&divider&&/^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*$/.test(divider)){
   const start=i;i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))i++;
   blocks.push({kind:'table',raw:lines.slice(start,i).join('\n')});i--;
  }
 }
 return blocks;
}
async function diagramPNG(node){
 const d=node.ownerDocument,w=d.defaultView,svg=node.querySelector('svg'),img=node.querySelector('img'),sourceCanvas=node.querySelector('canvas');
 if(!svg&&!img&&!sourceCanvas)throw new Error('图表尚未渲染成图片，已复制图表源码。');
 let source,width,height;
 if(svg){
  const clone=svg.cloneNode(true),box=svg.getBoundingClientRect(),vb=svg.viewBox?.baseVal;
  width=box.width||vb?.width||800;height=box.height||vb?.height||500;
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',width);clone.setAttribute('height',height);
  clone.style.maxWidth='none';clone.style.width=width+'px';clone.style.height=height+'px';
  const originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  const properties=['font-size','font-family','font-weight','fill','stroke','color','background-color','line-height','white-space','text-align'];
  originals.forEach((el,i)=>{const css=w.getComputedStyle(el);for(const key of properties)copies[i].style.setProperty(key,css.getPropertyValue(key));});
  source='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new w.XMLSerializer().serializeToString(clone));
 }else if(sourceCanvas){source=sourceCanvas.toDataURL('image/png');width=sourceCanvas.width;height=sourceCanvas.height;}else{source=img.currentSrc||img.src;width=img.naturalWidth||img.width;height=img.naturalHeight||img.height;}
 const image=new w.Image();image.crossOrigin='anonymous';await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('无法导出图表图片，已复制图表源码。'));image.src=source;});
 const scale=Math.min(2,8192/width,8192/height,Math.sqrt(16000000/(width*height)));
 const canvas=d.createElement('canvas');canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前环境无法复制图表图片，已复制图表源码。');
 ctx.fillStyle=d.body.classList.contains('theme-dark')?'#202020':'#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
 return canvas.toDataURL('image/png').split(',')[1];
}
async function copyBlock(block,node){
 let clipboard,nativeImage;try{({clipboard,nativeImage}=require('electron'));}catch{}
 if(!clipboard?.writeText){await copyText(block.raw,node.ownerDocument);return block.kind==='table'?'已复制表格 Markdown。':'当前环境已复制图表源码。';}
 if(block.kind==='table'){
  const table=node.matches('table')?node:node.querySelector('table');if(!table)throw new Error('表格尚未渲染完成。');
  const clone=table.cloneNode(true);for(const n of clone.querySelectorAll('[style]'))n.removeAttribute('style');
  clone.removeAttribute('style');clone.setAttribute('border','1');
  for(const cell of clone.querySelectorAll('td,th')){cell.style.border='1px solid #d9d9d9';cell.style.padding='6px 9px';}
  const raw=block.raw||tableMarkdown(table,Array.from(table.querySelectorAll('td,th')));
  clipboard.write({text:raw,html:'<html><body><!--StartFragment-->'+clone.outerHTML+'<!--EndFragment--></body></html>'});return '已复制表格，可粘贴到 Word、Excel 或 Markdown 编辑器。';
 }
 try{const png=await diagramPNG(node);const image=nativeImage.createFromBuffer(Buffer.from(png,'base64'));if(image.isEmpty())throw new Error('图片为空');clipboard.writeImage(image);return '已复制图表图片，可直接粘贴到其他应用。';}
 catch(e){clipboard.writeText(block.raw);return e.message?.includes('已复制')?e.message:'图片导出失败，已复制图表源码。';}
}
function enhanceBlocks(plugin,message,container,component,{el,iconButton,Notice}){
 const d=container.ownerDocument,blocks=extractBlocks(message.content),tables=blocks.filter(b=>b.kind==='table'),diagrams=blocks.filter(b=>b.kind==='diagram');let disposed=false,queued=false;
 function decorate(node,block){
  if(!node||node.closest('.jm-block'))return;
  const wrapper=el(d,'section','jm-block jm-block-'+block.kind),tools=el(d,'div','jm-block-tools'),content=el(d,'div','jm-block-content');node.before(wrapper);wrapper.append(tools,content);content.appendChild(node);
  const name=block.kind==='table'?'表格':'图表';tools.appendChild(el(d,'span','jm-block-label',name));
  const copy=iconButton(tools,'复制'+name,'copy',async()=>{copy.disabled=true;try{new Notice(await copyBlock(block,content));}finally{copy.disabled=false;}});
  const insert=iconButton(tools,'插入'+name,'text-cursor-input',()=>plugin.writeAnswer({...message,content:block.raw},false));insert.dataset.jmBlockInsert='true';insert.disabled=message.status!=='done';
  if(block.kind==='diagram')iconButton(tools,'复制图表源码','code-2',async()=>{await copyText(block.raw,d);new Notice('已复制图表源码');});
 }
 function scan(){
  if(disposed)return;
  const renderedTables=Array.from(container.querySelectorAll('table')).filter(t=>!t.parentElement.closest('table')&&!t.closest('svg,.mermaid,.jm-block-diagram'));
  renderedTables.forEach((node,i)=>decorate(node,tables[i]||{kind:'table',raw:tableMarkdown(node,Array.from(node.querySelectorAll('td,th')))}));
  for(const language of new Set(diagrams.map(b=>b.language))){
   const selector='.'+language+',.block-language-'+language+',pre:has(code.language-'+language+')';
   const nodes=Array.from(container.querySelectorAll(selector)).filter(n=>!n.parentElement.closest(selector));
   const sources=diagrams.filter(b=>b.language===language);nodes.forEach((node,i)=>{if(sources[i])decorate(node,sources[i]);});
  }
 }
 const observer=new d.defaultView.MutationObserver(()=>{if(!queued){queued=true;d.defaultView.queueMicrotask(()=>{queued=false;scan();});}});observer.observe(container,{childList:true,subtree:true});scan();
 component.register(()=>{disposed=true;observer.disconnect();});return scan;
}
module.exports={extractBlocks,copyBlock,diagramPNG,enhanceBlocks};
