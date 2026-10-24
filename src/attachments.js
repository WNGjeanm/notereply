const {fromBase64}=require('./portable');
const {id}=require('./core');
const {drawioText}=require('./drawio');
const MAX_SOURCE=15*1024*1024,MAX_TEXT=120000;
const MIME={'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp'};
function imageType(bytes){
 const b=new Uint8Array(bytes);
 if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(b[0]===71&&b[1]===73&&b[2]===70)return 'image/gif';
 if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
function readDataURL(blob,win=window){return new Promise((resolve,reject)=>{const r=new win.FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('读取图片失败。'));r.readAsDataURL(blob);});}
async function prepareImage(buffer,mime,doc){
 if(buffer.byteLength>MAX_SOURCE)throw new Error('单个附件不能超过15MB。');
 if(mime==='image/gif'){if(buffer.byteLength>5*1024*1024)throw new Error('GIF 图片不能超过5MB。');return {bytes:buffer,mime};}
 const win=doc.defaultView;
 let image;try{image=await win.createImageBitmap(new win.Blob([buffer],{type:mime}));}catch{throw new Error('无法解析图片，文件可能损坏。');}
 try{
  const scale=Math.min(1,2560/Math.max(image.width,image.height));
  if(scale===1&&buffer.byteLength<=5*1024*1024)return {bytes:buffer,mime};
  const canvas=doc.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  let blob=await new Promise(r=>canvas.toBlob(r,mime==='image/png'?'image/png':'image/jpeg',0.9));
  if(!blob||blob.size>5*1024*1024)blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.82));
  if(!blob||blob.size>5*1024*1024)throw new Error('图片处理后仍超过5MB，请先压缩。');
  return {bytes:await blob.arrayBuffer(),mime:blob.type};
 }finally{image.close();}
}
function htmlToMarkdown(html,doc){
 const parsed=new doc.defaultView.DOMParser().parseFromString(html,'text/html');
 function render(node){
  if(node.nodeType===3)return node.textContent;
  const tag=node.tagName?.toLowerCase();if(!tag)return '';
  if(tag==='script'||tag==='style')return '';
  if(tag==='table')return '\n\n'+Array.from(node.rows).map((row,i)=>{const line='| '+Array.from(row.cells).map(c=>c.textContent.trim().replace(/\|/g,'\\|').replace(/\n/g,' ')).join(' | ')+' |';return i===0?line+'\n| '+Array.from(row.cells).map(()=>'---').join(' | ')+' |':line;}).join('\n')+'\n\n';
  const body=Array.from(node.childNodes).map(render).join('');
  if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+body+'\n\n';
  if(tag==='p'||tag==='div')return body+'\n\n';
  if(tag==='li')return '- '+body.trim()+'\n';
  if(tag==='strong')return '**'+body+'**';
  if(tag==='em')return '*'+body+'*';
  if(tag==='br')return '\n';
  if(tag==='img')return '\n[文档内嵌图片，见同批附件]\n';
  return body;
 }
 return render(parsed.body).replace(/\n{3,}/g,'\n\n').trim();
}
class Attachments {
 constructor(plugin){this.plugin=plugin;}
 get folder(){return `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/attachments`;}
 async ensureFolder(){const adapter=this.plugin.app.vault.adapter;if(!await adapter.exists(this.folder))await adapter.mkdir(this.folder);}
 async store(name,kind,bytes,mime,extra={}){
  await this.ensureFolder();const a={id:id(),name,kind,mime,size:bytes.byteLength,...extra};a.storagePath=`${this.folder}/${a.id}.${kind==='image'?'img':'txt'}`;
  await this.plugin.app.vault.adapter.writeBinary(a.storagePath,bytes);return a;
 }
 async load(a){
  // Never read arbitrary paths supplied by a corrupted/imported history file.
  if(!a.storagePath?.startsWith(this.folder+'/')||a.storagePath.includes('..'))throw new Error('附件路径无效，请重新添加。');
  if(!await this.plugin.app.vault.adapter.exists(a.storagePath))throw new Error(`找不到附件“${a.name}”，请重新添加或开启新话题。`);
  return this.plugin.app.vault.adapter.readBinary(a.storagePath);
 }
 async preview(a,doc){return readDataURL(new doc.defaultView.Blob([await this.load(a)],{type:a.mime}),doc.defaultView);}
 async text(name,text,extra){if(!text.trim())throw new Error(`“${name}”中没有可读取的文字。`);if(text.length>MAX_TEXT)throw new Error(`“${name}”的文字超过12万字，请拆分后上传。`);return this.store(name,'text',new TextEncoder().encode(text).buffer,'text/plain',extra);}
 async addFile(file,doc){
  if(file.size>MAX_SOURCE)throw new Error('单个附件不能超过15MB。');
  const bytes=await file.arrayBuffer(),mime=imageType(bytes),ext=file.name.split('.').pop().toLowerCase();
  if(mime){const image=await prepareImage(bytes,mime,doc);return [await this.store(file.name,'image',image.bytes,image.mime)];}
  if(MIME[ext])throw new Error('图片内容与格式不符，文件可能损坏。');
  if(['md','txt','csv','json','log'].includes(ext))return [await this.text(file.name,new TextDecoder().decode(bytes))];
  if(['drawio','xml','svg'].includes(ext)){
   const raw=new TextDecoder().decode(bytes);
   if(ext==='drawio'||/<(?:mxfile|mxGraphModel)\b/.test(raw)||ext==='svg'&&/\bcontent=["'][\s\S]*mxfile/.test(raw)){
    const parsed=drawioText(raw,file.name,doc.defaultView.DOMParser);return [await this.text(file.name,parsed.text,{note:`drawio：${parsed.pages}页、${parsed.nodes}个节点/标注、${parsed.edges}条连线`})];
   }
   return [await this.text(file.name,raw,{note:ext==='svg'?'SVG 实际源码':'XML 实际源码'})];
  }
  if(ext==='docx'){
   const mammoth=require('mammoth/mammoth.browser');const embedded=[];
   const result=await mammoth.convertToHtml({arrayBuffer:bytes},{convertImage:mammoth.images.imgElement(async image=>{const raw=fromBase64(await image.read('base64'));embedded.push({bytes:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),mime:image.contentType});return {src:'embedded-image'};})});
   if(embedded.length>5)throw new Error('此 Word 文档包含超过5张图片，请拆分或先移除不需要的图片。');
   const items=[];
   const text=htmlToMarkdown(result.value,doc);if(text)items.push(await this.text(file.name,text,{note:'已提取文字、表格及内嵌图片'}));
   for(let i=0;i<embedded.length;i++){const raw=embedded[i];const type=imageType(raw.bytes);if(!type)throw new Error('文档包含暂不支持的图片，请单独导出为 PNG/JPEG 后上传。');const image=await prepareImage(raw.bytes,type,doc);items.push(await this.store(`${file.name} · 图片${i+1}`,'image',image.bytes,image.mime));}
   if(!items.length)throw new Error('文档中没有可读取的文字或图片。');return items;
  }
  if(ext==='pdf')return this.pdf(file.name,bytes,doc);
  throw new Error('支持 Markdown、TXT、CSV、JSON、drawio、XML、SVG、DOCX、PDF 以及 PNG/JPEG/GIF/WebP 图片。');
 }
 async pdf(name,bytes,doc){
  const prefix=`${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
  const pdfjs=await import(this.plugin.app.vault.adapter.getResourcePath(prefix+'/pdf.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc=this.plugin.app.vault.adapter.getResourcePath(prefix+'/pdf.worker.mjs');
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
  let pdf;
  try{
   pdf=await task.promise;if(pdf.numPages>80)throw new Error('PDF 超过80页，请拆分后上传。');
   const pages=[];
   for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i),content=await page.getTextContent();
    const text=content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');pages.push({page,text});
   }
   // Preserve text PDFs as text. For scanned/mixed PDFs, include visual evidence.
   const scanned=pages.filter(p=>p.text.trim().length<20);
   if(scanned.length>5)throw new Error('扫描页超过5页，请分批上传或直接发送所需页的截图。');
   const items=[],text=pages.map((p,i)=>`## 第${i+1}页\n${p.text}`).join('\n\n');
   if(pages.some(p=>p.text.trim().length>=20))items.push(await this.text(name,text,{note:`已提取${pdf.numPages}页文字；表格版式复杂时建议附截图`}));
   for(const p of scanned){
    const viewport=p.page.getViewport({scale:1.6}),canvas=doc.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
    await p.page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw new Error('扫描页转图片失败。');
    const image=await prepareImage(await blob.arrayBuffer(),'image/png',doc);
    items.push(await this.store(`${name} · 第${p.page.pageNumber}页`,'image',image.bytes,image.mime));
   }
   return items;
  }finally{if(pdf)await pdf.destroy();else await task.destroy();}
 }
 async clear(){const adapter=this.plugin.app.vault.adapter;if(await adapter.exists(this.folder)){const list=await adapter.list(this.folder);for(const f of list.files)await adapter.remove(f);}}
}
module.exports={Attachments,prepareImage,imageType,htmlToMarkdown,readDataURL};
