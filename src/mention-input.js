const {AbstractInputSuggest,setIcon}=require('obsidian');
const {mentionsIn,mentionContext,atomicRange,rankFiles}=require('./mentions');
function chip(doc,path){const node=doc.createElement('span');node.className='jm-file-mention';node.contentEditable='false';node.dataset.filePath=path;node.textContent='@'+path.split('/').pop();node.title=path;return node;}
function renderMentionText(root,text){root.replaceChildren();let at=0;for(const m of mentionsIn(text)){root.appendChild(root.ownerDocument.createTextNode(text.slice(at,m.from)));root.appendChild(chip(root.ownerDocument,m.path));at=m.to;}root.appendChild(root.ownerDocument.createTextNode(text.slice(at)));}
function readDocument(root){
 let text='';const segments=[];
 const append=(value,node,kind)=>{const from=text.length;text+=value;segments.push({node,kind,from,to:text.length});};
 function walk(parent){for(const node of Array.from(parent.childNodes)){
  if(node.nodeType===3){append(node.textContent,node,'text');continue;}if(node.nodeType!==1)continue;
  if(node.dataset?.filePath){append('@[['+node.dataset.filePath+']]',node,'token');continue;}
  if(node.tagName==='BR'){append('\n',node,'break');continue;}
  const block=['DIV','P'].includes(node.tagName);if(block&&text&&!text.endsWith('\n'))append('\n',node,'before');walk(node);if(block&&node.nextSibling&&!text.endsWith('\n'))append('\n',node,'after');
 }}walk(root);
 // Chromium adds a final BR to keep the caret visible after a line break.
 if(root.nodeType===1&&root.classList.contains('jm-input')&&root.lastChild?.nodeName==='BR'&&root.lastChild.previousSibling?.nodeName==='BR')text=text.slice(0,-1);
 if(root.nodeType===1&&root.classList.contains('jm-input')&&root.childNodes.length===1&&root.firstChild?.nodeName==='BR')text='';
 return {text,segments};
}
function boundary(node,after){return {node:node.parentNode,offset:Array.prototype.indexOf.call(node.parentNode.childNodes,node)+(after?1:0)};}
function pointAt(root,offset){
 for(const segment of readDocument(root).segments){
  if(offset<=segment.to){if(segment.kind==='text')return {node:segment.node,offset:Math.max(0,Math.min(segment.node.textContent.length,offset-segment.from))};if(segment.kind==='before'&&offset>segment.from)return {node:segment.node,offset:0};return boundary(segment.node,offset>segment.from);}
 }return {node:root,offset:root.childNodes.length};
}
class FileMentionSuggest extends AbstractInputSuggest{
 constructor(owner,editor){super(owner.app,editor.el);this.editor=editor;this.plugin=owner.plugin;this.limit=30;
  if(this.suggestEl){this.suggestEl.classList.add('jm-file-suggest');const doc=editor.el.ownerDocument,head=doc.createElement('div');head.className='jm-file-suggest-head';head.textContent='引用文件';this.suggestEl.prepend(head);}
 }
 open(){const menu=this.suggestEl,input=this.editor.el,rect=input.getBoundingClientRect?.();if(menu&&rect){const win=input.ownerDocument.defaultView;const width=Math.min(480,rect.width,win.innerWidth-24);menu.style.setProperty('--jm-mention-width',Math.max(0,width)+'px');}super.open();}
 getSuggestions(){if(this.editor.composing)return [];const context=this.editor.context();if(!context)return [];return rankFiles((this.app.vault.getFiles?.()||[]).filter(f=>!this.plugin?.store||!f.path.startsWith(this.plugin.store.root+'/')),context.query,this.app.vault.configDir);}
 renderSuggestion(file,element){
  const doc=element.ownerDocument,filename=file.name||file.path.split('/').pop(),ext=(file.extension||filename.split('.').pop()).toLowerCase(),directory=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')):'';
  element.classList.add('jm-file-suggest-row');element.title=file.path;
  const icon=doc.createElement('span');icon.className='jm-file-suggest-icon';setIcon(icon,['png','jpg','jpeg','webp','gif','svg'].includes(ext)?'image':'file-text');icon.setAttribute('aria-hidden','true');
  const text=doc.createElement('div');text.className='jm-file-suggest-text';const name=doc.createElement('div');name.className='jm-file-suggest-name';name.textContent=ext==='md'?filename.slice(0,-3):filename;text.appendChild(name);
  if(directory){const path=doc.createElement('div');path.className='jm-file-suggest-path';path.textContent=directory;text.appendChild(path);}
  element.append(icon,text);
 }
 selectSuggestion(file){this.editor.choose(file);this.close();}
}
class MentionInput{
 constructor(owner,{onInput,onSend,onFiles,labelId}){
  this.owner=owner;this.doc=owner.contentEl.ownerDocument;this.el=this.doc.createElement('div');const input=this.el;
  input.className='jm-input is-empty';input.contentEditable='true';input.spellcheck=false;input.setAttribute('role','textbox');input.setAttribute('aria-multiline','true');input.setAttribute('aria-labelledby',labelId);
  input.setAttribute('placeholder','输入问题，或输入 @ 选择文件…\nEnter 发送 · Shift+Enter 换行 · 支持粘贴图片');input.dataset.placeholder=input.getAttribute('placeholder');
  Object.defineProperty(input,'value',{get:()=>readDocument(input).text,set:value=>{if(value!==input.value){this.suggest?.close();renderMentionText(input,value);}this.emptyState();}});
  this.onInput=()=>{this.emptyState();onInput();};input.addEventListener('input',this.onInput);
  input.addEventListener('compositionstart',()=>{this.composing=true;this.suggest?.close();});input.addEventListener('compositionend',()=>{this.composing=false;this.changed();});
  input.addEventListener('keydown',event=>{
   if(event.defaultPrevented||event.isComposing||this.composing||event.keyCode===229)return;
   if(this.suggest?.isOpen&&['Enter','ArrowDown','ArrowUp','Escape','Tab'].includes(event.key))return;
   const positions=this.offsets();if(positions&&['Backspace','Delete'].includes(event.key)){const range=atomicRange(input.value,positions.from,positions.to,event.key);if(range){event.preventDefault();this.replace(range.from,range.to,'');return;}}
   if(event.key==='Enter'){event.preventDefault();if(event.shiftKey){this.doc.execCommand('insertLineBreak',false);this.changed();}else if(!owner.plugin.busy)onSend();}
  });
  input.addEventListener('beforeinput',event=>{if(event.inputType?.startsWith('format'))event.preventDefault();});
  input.addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.files||[]);event.preventDefault();if(files.length){onFiles(files);return;}const holder=this.doc.createElement('div');renderMentionText(holder,event.clipboardData?.getData('text/plain')||'');this.insertHTML(holder.innerHTML);});
  for(const type of ['copy','cut'])input.addEventListener(type,event=>{const pos=this.offsets();if(!pos||pos.from===pos.to)return;event.preventDefault();event.clipboardData?.setData('text/plain',input.value.slice(pos.from,pos.to));if(type==='cut')this.replace(pos.from,pos.to,'');});
  this.suggest=new FileMentionSuggest(owner,this);
 }
 emptyState(){this.el.classList.toggle('is-empty',!this.el.value);}
 changed(){this.el.dispatchEvent(new this.doc.defaultView.InputEvent('input',{bubbles:true,inputType:'insertText'}));}
 offsets(){const selection=this.doc.getSelection();if(!selection?.rangeCount)return null;const range=selection.getRangeAt(0);if(!this.el.contains(range.startContainer)||!this.el.contains(range.endContainer))return null;const prefix=this.doc.createRange();prefix.selectNodeContents(this.el);prefix.setEnd(range.startContainer,range.startOffset);const from=readDocument(prefix.cloneContents()).text.length;prefix.setEnd(range.endContainer,range.endOffset);return {from,to:readDocument(prefix.cloneContents()).text.length};}
 context(){const pos=this.offsets();if(!pos||pos.from!==pos.to)return null;return mentionContext(this.el.value,pos.to);}
 select(from,to=from){const a=pointAt(this.el,from),b=pointAt(this.el,to),range=this.doc.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const selection=this.doc.getSelection();selection.removeAllRanges();selection.addRange(range);}
 replace(from,to,html){this.el.focus();this.select(from,to);this.insertHTML(html);}
 insertHTML(html){
  if(!this.doc.execCommand(html?'insertHTML':'delete',false,html||null)){
   const selection=this.doc.getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();if(html){const fragment=range.createContextualFragment(html),last=fragment.lastChild;range.insertNode(fragment);if(last)range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
  }this.changed();
 }
 choose(file){const context=this.context();if(!context)return;this.replace(context.from,context.to,chip(this.doc,file.path).outerHTML);this.select(context.from+('@[['+file.path+']]').length);}
 destroy(){this.suggest.close();}
}
module.exports={MentionInput,FileMentionSuggest,renderMentionText,readDocument};
