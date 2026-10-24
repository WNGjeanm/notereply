const {fromBase64}=require('./portable');
const MAX_XML=20*1024*1024;
function decodeDiagram(value){
 const text=value.trim();if(text.startsWith('<'))return text;
 const inflater=new (require('pako').Inflate)({raw:true}),chunks=[];let size=0;
 inflater.onData=chunk=>{size+=chunk.length;if(size>MAX_XML)throw new Error('drawio 解压内容超过20MB');chunks.push(chunk);};
 inflater.push(fromBase64(text),true);if(inflater.err)throw new Error('drawio 压缩内容无效');
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}const decoded=new TextDecoder().decode(bytes);
 try{return decodeURIComponent(decoded);}catch{if(decoded.startsWith('<'))return decoded;throw new Error('drawio 压缩内容编码无效');}
}
function parseXML(text,DOMParser){
 if(text.length>MAX_XML||/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text))throw new Error('drawio 内容过大或包含不支持的 XML 实体');
 const doc=new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/gi,''),'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw new Error('drawio XML 格式无效');return doc;
}
function cleanLabel(text){
 return String(text||'').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<br\s*\/?>|<\/(?:div|p|li|tr)>/gi,'\n').replace(/<\/?(?:div|p|span|font|b|i|u|strong|em|small|sub|sup|table|tr|td|th|ul|ol|li|a|pre|code|h[1-6])\b[^>]*>/gi,'').replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi,(_,entity)=>{
  if(entity[0]==='#'){const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return ({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[entity.toLowerCase()];
 }).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
const cellText=value=>String(value??'').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');
function drawioText(text,name,DOMParser){
 let doc=parseXML(text,DOMParser),root=doc.documentElement;
 if(root.tagName.toLowerCase()==='svg'){
  let embedded=root.getAttribute('content');if(!embedded)throw new Error('SVG 不包含 drawio 源数据');
  if(!embedded.trim().startsWith('<')){try{embedded=decodeURIComponent(embedded);}catch{}}
  doc=parseXML(embedded,DOMParser);root=doc.documentElement;
 }
 const pages=Array.from(doc.getElementsByTagName('diagram'));if(!pages.length&&root.tagName==='mxGraphModel')pages.push(root);
 if(!pages.length)throw new Error('文件中没有可读取的 drawio 图页');
 const out=[`# drawio 文件：${name}`,'以下是文件中实际保存的节点和连线。source/target 为文件端点 ID；箭头方向以样式字段为准。不根据排版臆测未记录的关系。'];let nodes=0,edges=0;
 for(let index=0;index<pages.length;index++){
  const page=pages[index];let model=page.tagName==='mxGraphModel'?page:page.getElementsByTagName('mxGraphModel')[0];
  if(!model)model=parseXML(decodeDiagram(page.textContent),DOMParser).documentElement;
  const cells=Array.from(model.getElementsByTagName('mxCell'));if(cells.length>5000)throw new Error('drawio 单页超过5000个单元，请拆分后提问');
  const values=cells.map(cell=>{const wrapper=cell.parentNode?.nodeType===1&&['object','userobject'].includes(cell.parentNode.tagName.toLowerCase())?cell.parentNode:null;const id=cell.getAttribute('id')||wrapper?.getAttribute('id')||'';const label=cleanLabel(cell.getAttribute('value')||wrapper?.getAttribute('label')||wrapper?.getAttribute('name')||'');return {cell,id,label};});
  const labels=new Map(values.map(v=>[v.id,v.label])),childLabels=new Map();for(const v of values)if(v.label){const key=v.cell.getAttribute('parent')||'';if(!childLabels.has(key))childLabels.set(key,[]);childLabels.get(key).push(v.label);}const nodeRows=[],edgeRows=[];
  for(const {cell,id,label}of values){
   const style=cell.getAttribute('style')||'',geometry=cell.getElementsByTagName('mxGeometry')[0];
   if(cell.getAttribute('edge')==='1'){
    const endpoint=key=>{const value=cell.getAttribute(key)||'';return value+(labels.get(value)?'：'+labels.get(value):'');};
    const arrows=style.split(';').filter(x=>/^(?:startArrow|endArrow|startFill|endFill|dashed|edgeStyle|curved)=/.test(x)).join(';');
    const points=Array.from(geometry?.getElementsByTagName('mxPoint')||[]).map(p=>`${p.getAttribute('as')||'途经'}(${p.getAttribute('x')},${p.getAttribute('y')})`).join('；');
    const attachedLabels=childLabels.get(id)||[];
    edgeRows.push([id,endpoint('source'),endpoint('target'),[label,...attachedLabels].filter(Boolean).join('；'),arrows,points]);edges++;
   }else if(cell.getAttribute('vertex')==='1'||label){
    const pos=geometry?['x','y','width','height'].map(k=>`${k}=${geometry.getAttribute(k)||'0'}`).join(', '):'';
    nodeRows.push([id,label,cell.getAttribute('parent')||'',pos]);nodes++;
   }
  }
  const table=(header,rows)=>['| '+header.join(' | ')+' |','| '+header.map(()=>'---').join(' | ')+' |',...rows.map(row=>'| '+row.map(cellText).join(' | ')+' |')].join('\n');
  out.push(`## 图页 ${index+1}：${page.getAttribute('name')||'未命名'}`,'### 节点与标注',table(['ID','原文标签','父容器 ID','位置与尺寸'],nodeRows),'### 连线',table(['ID','source','target','连线原文','方向及线型样式','几何点'],edgeRows));
 }
 if(!nodes&&!edges)throw new Error('drawio 中没有可读取的节点或连线');
 return {text:out.join('\n\n'),nodes,edges,pages:pages.length};
}
module.exports={drawioText,decodeDiagram,cleanLabel};
