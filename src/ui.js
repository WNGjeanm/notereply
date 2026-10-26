const {ItemView,Modal,Component,MarkdownRenderer,Notice,PluginSettingTab,Setting,setIcon,setTooltip,Platform}=require('obsidian');
const {errorMessage}=require('./core');
const {HistoryNavigator}=require('./history-navigator');
const {selectionText}=require('./selection');
const {enhanceBlocks}=require('./blocks');
const {MentionInput,renderMentionText}=require('./mention-input');
const {TopicPicker}=require('./topic-picker');
const VIEW_TYPE='jeanmk-ai-chat',READING_VIEW_TYPE='jeanmk-ai-reading';
let logLabelSequence=0;
function el(doc,tag,cls,text){const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function button(parent,text,action,cls=''){const b=el(parent.ownerDocument,'button',cls,text);b.type='button';b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>Promise.resolve().then(action).catch(e=>new Notice(errorMessage(e))));parent.appendChild(b);return b;}
function renderContent(message){return message.status==='streaming'?message.content.replace(/^([ \t]*)(`{3,}|~{3,})(?:mermaid|chart|echarts|vega|plantuml|dot|markmap)\b/gim,'$1$2text'):message.content;}
function selectionWithin(doc,node){return selectionText(doc,node);}
function iconButton(parent,label,icon,action){const b=button(parent,'',action,'jm-icon-button');setIcon(b,icon);setTooltip(b,label);b.setAttribute('aria-label',label);return b;}
function bindSelectionFollowup(component,plugin,body,message){
 const d=body.ownerDocument,w=d.defaultView,bar=el(d,'div','jm-selection-actions');bar.hidden=true;d.body.appendChild(bar);let quote='';
 const hide=()=>{bar.hidden=true;};
 button(bar,'追问',async()=>{const text=quote;hide();if(text)await plugin.followup(message,text);});
 const show=()=>{
  quote=selectionWithin(d,body);if(!quote||message.status!=='done'){hide();return;}
  plugin.selectedBubble={id:message.id,text:quote,doc:d};
  const rect=d.getSelection().getRangeAt(0).getBoundingClientRect();bar.hidden=false;
  const bounds=bar.getBoundingClientRect();bar.style.left=Math.max(8,Math.min(rect.right-bounds.width,w.innerWidth-bounds.width-8))+'px';
  bar.style.top=(rect.bottom+bounds.height+12<w.innerHeight?Math.max(8,rect.bottom+7):Math.max(8,rect.top-bounds.height-7))+'px';
 };
 const listeners=[[body,'mouseup',show],[body,'keyup',show],[d,'selectionchange',()=>{if(!selectionWithin(d,body))hide();}],[d,'pointerdown',e=>{if(!bar.contains(e.target))hide();}],[d,'scroll',hide,true],[w,'resize',hide]];
 for(const [target,event,fn,capture]of listeners)target.addEventListener(event,fn,capture);
 component.register(()=>{for(const [target,event,fn,capture]of listeners)target.removeEventListener(event,fn,capture);bar.remove();});
}

class ConfirmModal extends Modal{
 constructor(app,title,description,confirm='确定'){super(app);this.heading=title;this.description=description;this.confirm=confirm;}
 openResult(){return new Promise(resolve=>{this.resolve=resolve;this.open();});}
 onOpen(){this.titleEl.textContent=this.heading;this.contentEl.appendChild(el(this.contentEl.ownerDocument,'p','',this.description));const actions=el(this.contentEl.ownerDocument,'div','jm-modal-actions');this.contentEl.appendChild(actions);button(actions,'取消',()=>this.close());button(actions,this.confirm,()=>{this.resolve?.(true);this.resolve=null;this.close();},'mod-warning');}
 onClose(){this.resolve?.(false);this.contentEl.empty();}
}
class RenameTopicModal extends Modal{
 constructor(app,title){super(app);this.original=title;}
 openResult(){return new Promise(resolve=>{this.resolve=resolve;this.open();});}
 onOpen(){
  this.modalEl.classList.add('jm-rename-modal');this.titleEl.textContent='重命名话题';const d=this.contentEl.ownerDocument;
  const label=el(d,'label','jm-rename-label','话题名称');this.contentEl.appendChild(label);this.input=el(d,'input','jm-rename-input');this.input.type='text';this.input.maxLength=80;this.input.value=this.original;this.input.setAttribute('aria-label','话题名称');label.appendChild(this.input);
  const error=el(d,'div','jm-rename-error');error.setAttribute('role','alert');this.contentEl.appendChild(error);
  const submit=()=>{const name=this.input.value.replace(/\s+/g,' ').trim();if(!name||name.length>80){error.textContent='请输入1到80个字符的话题名称。';this.input.focus();return;}this.resolve?.(name);this.resolve=null;this.close();};
  this.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();submit();}});
  const actions=el(d,'div','jm-modal-actions');this.contentEl.appendChild(actions);button(actions,'取消',()=>this.close());button(actions,'保存',submit,'jm-rename-save');setTimeout(()=>{this.input.focus();this.input.select();},0);
 }
 onClose(){this.resolve?.(null);this.resolve=null;this.contentEl.empty();}
}
class ReadingView extends ItemView{
 constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.messageId=null;}
 getViewType(){return READING_VIEW_TYPE;}
 getDisplayText(){return '回答 · 大窗阅读';}
 getIcon(){return 'book-open';}
 getState(){return {messageId:this.messageId};}
 async setState(state,result){this.messageId=state.messageId;await this.plugin.ensureMessageLoaded(this.messageId);this.render();await super.setState(state,result);}
 async onOpen(){this.contentEl.addClass('jm-reader-content');this.unsubscribe=this.plugin.subscribe(()=>this.refresh());this.render();}
 message(){return this.plugin.data.topics.flatMap(t=>t.messages).find(m=>m.id===this.messageId);}
 render(){
  if(!this.contentEl)return;this.contentEl.empty();if(this.component)this.removeChild(this.component);
  this.component=new Component();this.addChild(this.component);this.body=null;this.renderChild=null;const d=this.contentEl.ownerDocument,m=this.message();
  this.root=el(d,'section','jm-reader');this.contentEl.appendChild(this.root);
  if(!m){this.root.appendChild(el(d,'p','','该回答已被清除，或尚未载入。'));return;}
  this.root.dataset.messageId=m.id;
  const bar=el(d,'header','jm-reader-toolbar');this.root.appendChild(bar);
  const heading=el(d,'div','jm-reader-heading');heading.appendChild(el(d,'strong','','回答阅读'));heading.appendChild(el(d,'time','',new Date(m.createdAt).toLocaleString('zh-CN',{hour12:false})));bar.appendChild(heading);
  const actions=el(d,'div','jm-reader-actions');bar.appendChild(actions);
  button(actions,'复制',()=>this.plugin.copy(m));button(actions,'追问',()=>this.plugin.followup(m,selectionWithin(d,this.body)));
  button(actions,'插入笔记',()=>this.plugin.writeAnswer(m,false));button(actions,'替换选区',()=>this.plugin.writeAnswer(m,true));
  this.body=el(d,'article','jm-markdown markdown-rendered');this.root.appendChild(this.body);
  bindSelectionFollowup(this.component,this.plugin,this.body,m);
  this.body.addEventListener('mouseup',()=>{const text=selectionWithin(d,this.body);this.plugin.selectedBubble=text?{id:m.id,text,doc:d}:null;});
  this.renderedContent=null;this.refresh();
 }
 refresh(){
  if(!this.root)return;this.root.style.setProperty('--jm-bubble-size',this.plugin.data.settings.bubbleFontSize+'px');
  const m=this.message();if(!m){if(this.body)this.render();return;}
  for(const b of this.body?.querySelectorAll('[data-jm-block-insert]')||[])b.disabled=m.status!=='done';
  const stamp=m.content+'|'+m.status;if(!this.body||this.renderedContent===stamp)return;
  this.renderedContent=stamp;const node=el(this.body.ownerDocument,'div');this.body.replaceChildren(node);
  if(this.renderChild)this.component.removeChild(this.renderChild);this.renderChild=new Component();this.component.addChild(this.renderChild);
  MarkdownRenderer.render(this.app,renderContent(m),node,m.sourcePath||'',this.renderChild).then(()=>{if(m.status!=='streaming')enhanceBlocks(this.plugin,m,node,this.renderChild,{el,iconButton,Notice});}).catch(e=>{node.textContent=errorMessage(e);});
 }
 async onClose(){this.unsubscribe?.();if(this.component)this.removeChild(this.component);this.contentEl.empty();}
}
class ScreenshotModal extends Modal{
 constructor(plugin,onFiles){super(plugin.app);this.plugin=plugin;this.onFiles=onFiles;}
 onOpen(){
  this.titleEl.textContent='截图提问';const d=this.contentEl.ownerDocument;
  this.contentEl.appendChild(el(d,'p','','使用系统截图工具框选内容，然后点击“读取剪贴板图片”。图片只会加入待发送附件，不会自动上传。'));
  const actions=el(d,'div','jm-modal-actions');this.contentEl.appendChild(actions);
  button(actions,'启动系统截图',()=>this.plugin.startScreenshot());
  button(actions,'读取剪贴板图片',async()=>{const file=await this.plugin.clipboardImage(d);await this.onFiles([file]);this.close();},'mod-cta');
 }
}
class ChatView extends ItemView{
 constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.cards=new Map();this.atBottom=true;this.topicId=null;this.closed=false;}
 getViewType(){return VIEW_TYPE;}
 getDisplayText(){return 'AI 对话';}
 getIcon(){return 'messages-square';}
 async onOpen(){
  this.closed=false;const p=this.plugin,d=this.contentEl.ownerDocument;
  this.contentEl.empty();this.contentEl.addClass('jm-chat-content');this.root=el(d,'section','jm-chat');this.contentEl.appendChild(this.root);
  this.addAction('settings','打开 AI 助手设置',()=>p.openSettings());
  const top=el(d,'header','jm-chat-top');this.root.appendChild(top);
  const brand=el(d,'div','jm-brand');brand.appendChild(el(d,'strong','','NoteReply'));top.appendChild(brand);
  const nav=el(d,'div','jm-topic-nav');top.appendChild(nav);this.topicPicker=new TopicPicker(this,nav,{el,button,iconButton});this.newTopicButton=iconButton(nav,'新话题','square-pen',()=>p.newTopic());this.newTopicButton.classList.add('jm-new-topic');
  this.stage=el(d,'div','jm-conversation-stage');this.root.appendChild(this.stage);
  this.list=el(d,'div','jm-messages');this.list.setAttribute('role','log');const logLabel=el(d,'span','jm-sr-only','对话记录');logLabel.id='jm-chat-log-label-'+(++logLabelSequence);this.root.appendChild(logLabel);this.list.setAttribute('aria-labelledby',logLabel.id);this.stage.appendChild(this.list);this.historyNavigator=new HistoryNavigator(this,this.stage,{el,button,setIcon});
  this.list.addEventListener('scroll',()=>this.syncScrollState());
  this.scrollButton=button(this.root,'回到底部 ↓',()=>{this.atBottom=true;this.scrollButton.hidden=true;this.scrollBottom();},'jm-scroll-bottom');this.scrollButton.hidden=true;
  const ResizeObserver=d.defaultView.ResizeObserver;this.scrollObserver=new ResizeObserver(()=>{if(this.atBottom)this.scrollBottom();else this.syncScrollState();});this.scrollObserver.observe(this.list);
  this.composer=el(d,'div','jm-composer');this.root.appendChild(this.composer);
  this.targetInfo=el(d,'div','jm-target-info');this.composer.appendChild(this.targetInfo);
  const targetHeading=el(d,'div','jm-target-heading');this.targetInfo.appendChild(targetHeading);targetHeading.appendChild(el(d,'span','jm-target-label','写回目标：'));
  this.targetRow=el(d,'div','jm-target-row');this.targetInfo.appendChild(this.targetRow);
  this.targetPath=el(d,'span','jm-target-path');targetHeading.appendChild(this.targetPath);
  this.references=el(d,'div','jm-references');this.targetRow.appendChild(this.references);
  this.attachments=el(d,'div','jm-attachments');this.composer.appendChild(this.attachments);
  this.inputBox=el(d,'div','jm-input-box');this.composer.appendChild(this.inputBox);
  const inputLabel=el(d,'span','jm-sr-only','提问输入框');inputLabel.id='jm-chat-input-label-'+logLabelSequence;this.inputBox.appendChild(inputLabel);
  this.mentionInput=new MentionInput(this,{labelId:inputLabel.id,onInput:()=>{p.draft().text=this.input.value;p.scheduleSave();this.resizeInput();this.updateSend();},onSend:()=>this.send(),onFiles:files=>this.addFiles(files)});this.input=this.mentionInput.el;this.inputBox.appendChild(this.input);
  this.root.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();this.composer.addClass('jm-drag-over');}});
  this.root.addEventListener('dragleave',()=>this.composer.removeClass('jm-drag-over'));
  this.root.addEventListener('drop',e=>{this.composer.removeClass('jm-drag-over');if(e.dataTransfer?.files?.length){e.preventDefault();this.addFiles(Array.from(e.dataTransfer.files));}});
  const tools=el(d,'div','jm-composer-tools');this.inputBox.appendChild(tools);
  button(tools,'＋ 附件',()=>this.pickFiles(),'jm-subtle');button(tools,'截图',()=>{if(Platform.isMobile){new Notice('请使用系统截图，然后选择截图图片。');this.pickFiles();}else new ScreenshotModal(p,files=>this.addFiles(files)).open();},'jm-subtle');
  const thinking=el(d,'label','jm-thinking-toggle');this.thinkingCheck=el(d,'input');this.thinkingCheck.type='checkbox';thinking.appendChild(this.thinkingCheck);thinking.appendChild(d.createTextNode('深度思考'));tools.appendChild(thinking);
  this.thinkingCheck.addEventListener('change',()=>{p.data.settings.deepThink=this.thinkingCheck.checked;p.save();p.notify('settings');});
  this.sendButton=button(tools,'发送 ↑',()=>p.busy?p.stop():this.send(),'jm-send');
  this.pick=el(d,'input');this.pick.type='file';this.pick.multiple=true;this.pick.accept='.md,.txt,.csv,.json,.log,.drawio,.xml,.svg,.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp';this.pick.hidden=true;this.root.appendChild(this.pick);
  this.pick.addEventListener('change',()=>{this.addFiles(Array.from(this.pick.files||[]));this.pick.value='';});
  this.unsubscribe=p.subscribe(type=>this.refresh(type));this.refresh('topic');
 }
 async onClose(){this.closed=true;this.mentionInput?.destroy();this.topicPicker?.destroy();this.historyNavigator?.destroy();this.scrollObserver?.disconnect();this.unsubscribe?.();for(const card of this.cards.values())this.removeChild(card.component);this.cards.clear();}
 refresh(type){
  if(this.closed||!this.root)return;
  const p=this.plugin,t=p.activeTopic(),s=p.data.settings,d=this.root.ownerDocument;
  if(type==='stream'){const latest=t.messages.at(-1),card=latest&&this.cards.get(latest.id);if(card&&latest.role==='assistant')this.updateCard(card,latest);this.scrollBottom();return;}
  this.root.style.setProperty('--jm-bubble-size',s.bubbleFontSize+'px');this.root.style.setProperty('--jm-input-size',s.inputFontSize+'px');this.root.style.setProperty('--jm-user-lines',String(s.userCollapseLines));
  this.topicPicker.refresh();this.topicPicker.trigger.disabled=!!p.switchingTopic;this.topicPicker.trigger.setAttribute('aria-busy',String(!!p.switchingTopic));this.newTopicButton.disabled=!!p.switchingTopic;this.input.contentEditable=p.switchingTopic?'false':'true';
  const topicChanged=this.topicId!==t.id;
  if(topicChanged||type==='history'){
   for(const card of this.cards.values())this.removeChild(card.component);this.cards.clear();this.list.replaceChildren();this.topicId=t.id;this.atBottom=true;
  }
  if(!t.messages.length&&!this.list.querySelector('.jm-empty')){
   const empty=el(d,'div','jm-empty');empty.appendChild(el(d,'div','jm-empty-icon','✦'));empty.appendChild(el(d,'h3','','从一段笔记，开始对话'));empty.appendChild(el(d,'p','','选中文字后提问，或直接输入问题。回答可作为 Markdown 插入笔记。'));this.list.appendChild(empty);
  }else if(t.messages.length)this.list.querySelector('.jm-empty')?.remove();
  const liveIds=new Set(t.messages.map(m=>m.id));for(const [key,card]of this.cards)if(!liveIds.has(key)){this.removeChild(card.component);card.root.remove();this.cards.delete(key);}
  for(const m of t.messages){let c=this.cards.get(m.id);if(!c){c=this.makeCard(m);this.cards.set(m.id,c);this.list.appendChild(c.root);}this.updateCard(c,m);}
  if(topicChanged||type==='draft'||type==='topic'){this.input.value=p.draft().text||'';this.resizeInput();this.renderReferences();}
  if(type==='attachments')this.renderReferences();
  this.thinkingCheck.checked=s.deepThink;
  const target=p.currentTarget();this.targetPath.textContent=target?target.filePath.split('/').pop():'请先打开 Markdown 笔记';
  this.targetPath.title=target?`写回至：${target.filePath}`:'请在笔记中设置光标';
  this.targetRow.classList.toggle('has-reference',!!(p.draft().reference?.text||p.draft().followup?.text));
  this.historyNavigator.refresh();this.updateSend();this.scrollButton.hidden=this.atBottom;this.scrollBottom();
 }
 makeCard(m){
  const d=this.root.ownerDocument,root=el(d,'article',`jm-message jm-${m.role}`);root.dataset.messageId=m.id;
  const component=new Component();this.addChild(component);
  const meta=el(d,'div','jm-message-meta');root.appendChild(meta);meta.appendChild(el(d,'strong','',m.role==='user'?'你':'DeepSeek'));
  const time=el(d,'time','',new Date(m.createdAt).toLocaleString('zh-CN',{hour12:false}));time.dateTime=m.createdAt;meta.appendChild(time);
  const refs=el(d,'div','jm-message-refs');root.appendChild(refs);const linkInfo=el(d,'div','jm-link-info');refs.appendChild(linkInfo);
  if(m.reference)refs.appendChild(el(d,'div','jm-reference-summary',`引用 · ${m.reference.filePath}`));
  if(m.followup)refs.appendChild(el(d,'div','jm-reference-summary','追问 · '+m.followup.text.slice(0,90)));
  for(const a of m.attachments||[])button(refs,(a.kind==='image'?'▧ ':'▤ ')+a.name,()=>this.plugin.previewAttachment(a),'jm-file-chip');
  let thinking,thinkingBody;
  if(m.role==='assistant'){thinking=el(d,'details','jm-reasoning');thinking.appendChild(el(d,'summary','','思考过程'));thinkingBody=el(d,'div','jm-reasoning-body');thinking.appendChild(thinkingBody);root.appendChild(thinking);}
  const body=el(d,'div',m.role==='assistant'?'jm-answer-body jm-markdown markdown-rendered':'jm-user-body');root.appendChild(body);
  const status=el(d,'div','jm-message-status');root.appendChild(status);
  const actions=el(d,'div','jm-message-actions');root.appendChild(actions);
  body.addEventListener('mouseup',()=>{const text=selectionWithin(d,body);if(text)this.plugin.selectedBubble={id:m.id,text,doc:d};else if(this.plugin.selectedBubble?.id===m.id)this.plugin.selectedBubble=null;});
  if(m.role==='assistant'){
   bindSelectionFollowup(component,this.plugin,body,m);
   const primary=el(d,'div','jm-action-group jm-actions-primary'),secondary=el(d,'div','jm-action-group jm-actions-secondary');actions.append(primary,secondary);
   iconButton(primary,'复制','copy',()=>this.plugin.copy(m));
   const insert=iconButton(primary,'插入','text-cursor-input',()=>this.plugin.writeAnswer(m,false));
   const replace=iconButton(primary,'替换','replace',()=>this.plugin.writeAnswer(m,true));
   const follow=iconButton(primary,'追问','reply',()=>this.plugin.followup(m));
   const remove=iconButton(secondary,'删除本轮对话','trash-2',()=>this.plugin.deleteRound(m));
   const bad=iconButton(secondary,'不满意','thumbs-down',()=>{m.bad=!m.bad;this.plugin.save();this.plugin.notify('message');});
   const retry=iconButton(secondary,'重新生成','rotate-cw',()=>this.plugin.retry(m));
   const read=iconButton(secondary,'大窗阅读','book-open',()=>this.plugin.openReading(m));
   return {root,component,body,status,thinking,thinkingBody,actions,follow,replace,insert,read,remove,bad,retry,lastContent:null,lastReasoning:null};
  }
  renderMentionText(body,m.content);
  if(m.content?.length>400||m.content?.split('\n').length>this.plugin.data.settings.userCollapseLines){body.addClass('jm-collapsed');const expand=button(actions,'展开消息',()=>{body.classList.toggle('jm-collapsed');expand.textContent=body.hasClass('jm-collapsed')?'展开消息':'收起消息';});}
  if(!actions.childElementCount)actions.remove();return {root,component,body,status,linkInfo};
 }
 updateCard(c,m){
  if(m.role!=='assistant'){
   const stamp=JSON.stringify(m.linkReports||[]);if(c.linkStamp!==stamp){c.linkStamp=stamp;c.linkInfo.replaceChildren();for(const report of m.linkReports||[]){const line=el(c.body.ownerDocument,'div','jm-link-report'+(report.ok?'':' is-error'),(report.ok?'已读取：':'未读取：')+(report.path||report.target)+' · '+report.note);c.linkInfo.appendChild(line);}
    for(const item of (m.attachments||[]).filter(a=>a.linkedPath))button(c.linkInfo,'查看资料 · '+item.name,()=>this.plugin.previewAttachment(item),'jm-file-chip');
   }return;
  }

  if(c.lastContent!==m.content||c.lastStreaming!==(m.status==='streaming')){
   c.lastStreaming=m.status==='streaming';
   c.lastContent=m.content;const content=m.content,renderNode=el(c.body.ownerDocument,'div');
   if(c.renderChild)c.component.removeChild(c.renderChild);c.renderChild=new Component();c.component.addChild(c.renderChild);
   if(content)MarkdownRenderer.render(this.app,renderContent(m),renderNode,m.sourcePath||'',c.renderChild).then(()=>{if(c.lastContent!==content)return;c.body.replaceChildren(renderNode);if(m.status!=='streaming')enhanceBlocks(this.plugin,m,renderNode,c.renderChild,{el,iconButton,Notice});this.scrollBottom();}).catch(e=>{c.status.textContent=errorMessage(e);});else c.body.replaceChildren();
  }
  if(c.lastReasoning!==m.reasoning){c.lastReasoning=m.reasoning;c.thinkingBody.textContent=m.reasoning||'';}
  c.thinking.hidden=!m.deepThink&&!m.reasoning;
  if(m.status==='streaming'&&!c.wasStreaming){c.thinking.open=!!m.deepThink;c.wasStreaming=true;}
  if(m.status!=='streaming'&&c.wasStreaming){c.thinking.open=false;c.wasStreaming=false;}
  c.status.textContent=m.status==='streaming'?(m.readingLinks?'正在读取链接资料…':m.content?'正在生成回答…':'正在思考…'):m.status==='done'?(m.bad?'已标记不满意 · 不参与后续自动上下文':m.warning||''):m.error||'生成未完成';
  c.remove.disabled=this.plugin.busy;for(const b of c.body.querySelectorAll('[data-jm-block-insert]'))b.disabled=m.status!=='done';
  const ready=m.status==='done';c.follow.disabled=!ready;c.replace.disabled=!ready||!m.reference?.from;c.insert.disabled=!ready;c.read.disabled=!m.content;c.bad.disabled=!ready;const badLabel=m.bad?'取消不满意':'不满意';if(c.bad.getAttribute('aria-label')!==badLabel){setTooltip(c.bad,badLabel);c.bad.setAttribute('aria-label',badLabel);}c.bad.setAttribute('aria-pressed',String(!!m.bad));c.bad.classList.toggle('is-active',!!m.bad);c.retry.disabled=this.plugin.busy;c.retry.hidden=m.status==='streaming';
 }
 renderReferences(){
  const p=this.plugin,d=this.root.ownerDocument,draft=p.draft();this.references.replaceChildren();this.attachments.replaceChildren();
  for(const [key,label]of [['reference','引用'],['followup','追问']])if(draft[key]?.text){
   const card=el(d,'div','jm-reference-card');card.title=label+(draft[key].filePath?' · '+draft[key].filePath:'')+'\n'+draft[key].text;
   card.appendChild(el(d,'span','jm-reference-text',label+'：'+draft[key].text.replace(/\s+/g,' ')));
   const remove=button(card,'移除',()=>{draft[key]=null;if(key==='reference')p.lastSelection='';p.save();p.notify('draft');},'jm-subtle');remove.setAttribute('aria-label','移除'+label);this.references.appendChild(card);
  }
  for(const a of draft.attachments||[]){const card=el(d,'div','jm-attachment');if(a.kind==='image'){const img=el(d,'img');img.alt=a.name;p.attachments.preview(a,d).then(url=>{if(card.isConnected)img.src=url;}).catch(()=>{});card.appendChild(img);}const info=el(d,'span','',a.name);info.title=a.note||a.name;card.appendChild(info);button(card,'×',()=>{draft.attachments=draft.attachments.filter(x=>x.id!==a.id);p.save();p.notify('attachments');},'jm-subtle');this.attachments.appendChild(card);}
 }
 updateSend(){if(!this.sendButton)return;this.sendButton.textContent=this.plugin.busy?'停止 ■':'发送 ↑';this.sendButton.disabled=!!this.adding||!!this.plugin.switchingTopic||(!this.plugin.busy&&!this.input.value.trim()&&!(this.plugin.draft().attachments||[]).length&&!this.plugin.draft().reference?.text&&!this.plugin.draft().followup?.text);}
 resizeInput(){this.input.style.height='auto';const line=parseFloat(this.root.ownerDocument.defaultView.getComputedStyle(this.input).lineHeight)||22;this.input.style.height=Math.max(line*3+20,Math.min(this.input.scrollHeight,line*6+20))+'px';}
 syncScrollState(){if(!this.list||this.closed)return;this.atBottom=this.list.scrollHeight-this.list.scrollTop-this.list.clientHeight<=8;this.scrollButton.hidden=this.atBottom;}
 scrollBottom(){if(this.closed)return;if(!this.atBottom){this.syncScrollState();return;}this.root?.ownerDocument.defaultView.requestAnimationFrame(()=>{if(this.closed||!this.atBottom)return;this.list.scrollTop=this.list.scrollHeight;this.syncScrollState();});}
 pickFiles(){this.pick.click();}
 async addFiles(files){
  if(this.adding)return;this.adding=true;this.updateSend();const p=this.plugin,t=p.activeTopic();
  try{
   for(const file of files){const items=await p.attachments.addFile(file,this.root.ownerDocument);const draft=p.draft(t);if((draft.attachments||[]).length+items.length>10)throw new Error('每次最多添加10个附件，请分批发送。');draft.attachments.push(...items);await p.save();p.notify('attachments');}
  }catch(e){new Notice(errorMessage(e),8000);}finally{this.adding=false;this.updateSend();}
 }
 async send(){this.plugin.draft().text=this.input.value;this.atBottom=true;this.scrollButton.hidden=true;this.scrollBottom();await this.plugin.send();}
}
class AISettings extends PluginSettingTab{
 constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
 display(){
  const p=this.plugin,s=p.data.settings,c=this.containerEl;c.empty();
  new Setting(c).setName('DeepSeek API Key').setDesc('密钥保存在 Obsidian SecretStorage 中，不写入聊天历史。留空不会删除已保存密钥。').addText(text=>{text.inputEl.type='password';text.setPlaceholder(p.apiKey()?'已配置 · 输入新密钥以替换':'输入 DeepSeek API Key').onChange(value=>{if(value.trim())p.setApiKey(value.trim());});});
  new Setting(c).setName('密钥管理').addButton(b=>b.setButtonText('清除密钥').onClick(()=>{p.setApiKey('');this.display();})).addButton(b=>b.setButtonText('测试连接').onClick(async()=>{b.setDisabled(true);try{await p.testConnection();new Notice('DeepSeek 连接成功');}catch(e){new Notice(errorMessage(e),7000);}finally{b.setDisabled(false);}}));
  if(Platform.isMobile)new Setting(c).setName('移动端兼容请求').setDesc('回答与思考过程在生成完成后显示。停止仅停止等待，服务端请求可能继续执行和计费。阅读在应用内打开，截图请通过附件选择。');
  new Setting(c).setName('模型').setDesc('上传图片、截图或扫描 PDF 时请选择 deepseek-flash。').addDropdown(d=>d.addOptions({'deepseek-flash':'DeepSeek Flash · 支持图片','deepseek-v4-pro':'DeepSeek V4 Pro · 文字'}).setValue(s.model).onChange(async v=>{s.model=v;await p.save();p.notify('settings');}));
  new Setting(c).setName('默认开启深度思考').addToggle(t=>t.setValue(s.deepThink).onChange(async v=>{s.deepThink=v;await p.save();p.notify('settings');}));
  new Setting(c).setName('参考历史轮数').setDesc('按完整问答轮计算；失败、中断和不满意回答不纳入自动上下文。').addDropdown(d=>d.addOption('5','最近5轮').addOption('20','最近20轮').setValue(String(s.historyRounds)).onChange(async v=>{s.historyRounds=Number(v);await p.save();p.notify('settings');}));
  new Setting(c).setName('显示').setHeading();
  for(const [key,label]of [['bubbleFontSize','对话与大窗阅读字体大小'],['inputFontSize','输入框字体大小']])new Setting(c).setName(label).addSlider(sl=>sl.setLimits(11,24,1).setValue(s[key]).setDynamicTooltip().onChange(async v=>{s[key]=v;await p.save();p.notify('settings');}));
  new Setting(c).setName('长用户消息折叠行数').addSlider(sl=>sl.setLimits(4,12,1).setValue(s.userCollapseLines).setDynamicTooltip().onChange(async v=>{s.userCollapseLines=v;await p.save();}));
  new Setting(c).setName('助手行为').setHeading();
  new Setting(c).setName('系统提示词').setDesc('控制回答风格，不会自动读取整个仓库。').addTextArea(t=>{t.inputEl.rows=6;t.inputEl.style.width='100%';t.setValue(s.systemPrompt).onChange(v=>{s.systemPrompt=v;p.scheduleSave();});});
  new Setting(c).setName('本地记录').setHeading();
  new Setting(c).setName('清除全部对话与附件缓存').setDesc('清除当前聊天记录与附件缓存；保留迁移备份、笔记、配置及 API Key。').addButton(b=>b.setButtonText('清除记录').setWarning().onClick(async()=>{if(await new ConfirmModal(this.app,'清除对话记录','此操作会清除所有话题及插件附件缓存，不删除任何笔记。','清除').openResult())await p.clearHistory();}));
  const footer=c.createDiv({cls:'jm-settings-footer'});footer.setText(`笔答 · NoteReply · v${p.version||p.manifest.version} · 设置保存在插件配置中 · 对话保存在 NoteReply 目录`);
 }
}
module.exports={VIEW_TYPE,READING_VIEW_TYPE,ChatView,ReadingView,AISettings,ConfirmModal,RenameTopicModal,button,el};
