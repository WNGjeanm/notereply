const {copyText}=require('./clipboard');
const {Plugin,MarkdownView,MarkdownRenderer,Modal,Notice,Component,TFile,editorInfoField,Platform,requestUrl}=require('obsidian');
const {EditorView}=require('@codemirror/view');
const {version:BUILD_VERSION}=require('../package.json');
const {id,topic,normalizeData,historyRounds,buildMessages,requestBody,streamCompletion,errorMessage,selectionMatches}=require('./core');
const {Attachments}=require('./attachments');
const {resolveMessageLinks}=require('./links');
const {selectedTableText,selectionText}=require('./selection');
const {VIEW_TYPE,READING_VIEW_TYPE,ChatView,ReadingView,AISettings,ConfirmModal,el,button}=require('./ui');

class JeanmkAIPlugin extends Plugin{
 async onload(){
  this.version=BUILD_VERSION;if(!Object.isFrozen(this.manifest))this.manifest.version=BUILD_VERSION;
  this.data=normalizeData(await this.loadData());this.listeners=new Set();this.headerButtons=new Map();this.busy=false;this.unloading=false;this.saveQueue=Promise.resolve();this.attachments=new Attachments(this);this.lastEditor=null;this.lastSelection='';
  this.registerView(VIEW_TYPE,leaf=>new ChatView(leaf,this));
  this.registerView(READING_VIEW_TYPE,leaf=>new ReadingView(leaf,this));
  this.addRibbonIcon('messages-square','打开 AI 对话',()=>this.openChat());
  this.addSettingTab(new AISettings(this.app,this));
  this.addCommand({id:'open-chat',name:'打开 AI 对话',callback:()=>this.openChat()});
  this.addCommand({id:'ask-selection',name:'使用选中文字提问',editorCallback:(editor,info)=>{this.capture(editor,info.file,info);this.openChat();}});
  this.addCommand({id:'new-topic',name:'开启新话题',callback:()=>this.newTopic()});
  this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,info)=>{if(editor.getSelection())menu.addItem(item=>item.setTitle('使用选中文字提问').setIcon('messages-square').onClick(()=>{this.capture(editor,info.file,info);this.openChat();}));}));
  this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{if(leaf?.view instanceof MarkdownView)this.capture(leaf.view.editor,leaf.view.file,leaf.view);this.refreshHeaders();}));
  this.registerEvent(this.app.workspace.on('layout-change',()=>this.refreshHeaders()));
  this.registerEvent(this.app.vault.on('rename',(file,old)=>this.renameSource(file,old)));
  this.registerEditorExtension(EditorView.updateListener.of(update=>{
   if(!update.view.hasFocus||(!update.selectionSet&&!update.docChanged))return;
   const info=update.state.field(editorInfoField,false);if(info?.editor&&info.file)this.capture(info.editor,info.file,info);
  }));
  this.selectionDocuments=new WeakSet();this.watchSelectionDocument(document);
  this.registerEvent(this.app.workspace.on('window-open',(_window,win)=>this.watchSelectionDocument(win.document)));
  for(const leaf of this.app.workspace.getLeavesOfType('markdown'))this.watchSelectionDocument(leaf.view.containerEl.ownerDocument);
  this.app.workspace.onLayoutReady(()=>{this.refreshHeaders();const view=this.app.workspace.getActiveViewOfType(MarkdownView);if(view)this.capture(view.editor,view.file,view);});
  this.register(()=>{this.unloading=true;clearTimeout(this.saveTimer);clearTimeout(this.notifyTimer);this.controller?.abort();for(const b of this.headerButtons.values())b.remove();this.headerButtons.clear();this.listeners.clear();});
  await this.save();
 }
 async onunload(){this.controller?.abort();await this.save();}
 activeTopic(){return this.data.topics.find(t=>t.id===this.data.activeTopicId)||this.data.topics[0];}
 draft(t=this.activeTopic()){if(!t.draft)t.draft={text:'',attachments:[],reference:null,followup:null};if(!Array.isArray(t.draft.attachments))t.draft.attachments=[];return t.draft;}
 subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 notify(type){for(const fn of this.listeners)fn(type);}
 notifyStream(){if(this.notifyTimer)return;this.notifyTimer=setTimeout(()=>{this.notifyTimer=null;this.notify('stream');},120);}
 scheduleSave(){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save(),800);}
 save(){
  if(!this.data)return Promise.resolve();clearTimeout(this.saveTimer);
  const snapshot=JSON.parse(JSON.stringify(this.data));
  this.saveQueue=(this.saveQueue||Promise.resolve()).catch(()=>{}).then(()=>this.saveData(snapshot));
  this.saveQueue.catch(()=>{if(!this.unloading)new Notice('对话保存失败，请检查仓库是否可写。');});return this.saveQueue;
 }
 apiKey(){return this.app.secretStorage?.getSecret(this.data.secretId)||'';}
 setApiKey(value){if(!this.app.secretStorage)throw new Error('当前 Obsidian 不支持 SecretStorage，请升级到1.11.4或以上版本。');this.app.secretStorage.setSecret(this.data.secretId,value);this.save();}
 openSettings(){this.app.setting.open();this.app.setting.openTabById(this.manifest.id);}
 refreshHeaders(){
  for(const [view,b]of this.headerButtons)if(!view.containerEl.isConnected){b.remove();this.headerButtons.delete(view);}
  for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
   const view=leaf.view;if(!(view instanceof MarkdownView)||this.headerButtons.has(view))continue;
   const b=view.addAction('messages-square','打开 AI 对话',()=>{this.capture(view.editor,view.file,view);this.openChat();});this.headerButtons.set(view,b);
  }
 }
 async openChat(){
  let leaf=this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
  if(!leaf){leaf=this.app.workspace.getRightLeaf(false);if(!leaf)throw new Error('无法打开右侧面板。');await leaf.setViewState({type:VIEW_TYPE,active:true});}
  await this.app.workspace.revealLeaf(leaf);leaf.view.input?.focus();return leaf.view;
 }
 async openReading(message){
  const workspace=this.app.workspace;
  let leaf=workspace.getLeavesOfType(READING_VIEW_TYPE).find(l=>l.view.messageId===message.id);
  if(!leaf){leaf=Platform.isMobile||typeof workspace.openPopoutLeaf!=='function'?workspace.getLeaf('tab'):workspace.openPopoutLeaf({size:{width:1000,height:780}});await leaf.setViewState({type:READING_VIEW_TYPE,state:{messageId:message.id},active:true});}
  await workspace.revealLeaf(leaf);leaf.getContainer()?.win?.focus?.();return leaf.view;
 }
 watchSelectionDocument(doc){
  if(!doc?.addEventListener||this.selectionDocuments.has(doc))return;this.selectionDocuments.add(doc);
  const capture=event=>{
   const view=this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v.containerEl.ownerDocument===doc&&v.containerEl.contains(event.target));
   if(!view?.file)return;
   if(view.getMode()==='preview'){
    const text=selectionText(doc,view.containerEl);if(text)this.setReference({filePath:view.file.path,text,readOnly:true});
   }else this.capture(view.editor,view.file,view);
  };
  this.registerDomEvent(doc,'mouseup',capture);
  // Native cell selection finishes on window pointerup, after the document event.
  this.registerDomEvent(doc,'pointerup',event=>{doc.defaultView.setTimeout(()=>{if(!this.unloading)capture(event);},0);});
  this.registerDomEvent(doc,'keyup',capture);
 }
 capture(editor,file,view){
  if(!file||file.extension!=='md'||!editor)return;
  this.lastEditor={editor,filePath:file.path,view,cursor:editor.getCursor('head')};
  const tableText=selectedTableText(view?.containerEl);
  if(tableText){this.setReference({filePath:file.path,text:tableText,readOnly:true,tableSelection:true});this.notify('target');return;}
  if(view instanceof MarkdownView&&view.getMode()==='preview'){this.notify('target');return;}
  const text=editor.getSelection();
  if(text)this.setReference({filePath:file.path,text,from:editor.getCursor('from'),to:editor.getCursor('to')});
  this.notify('target');
 }
 setReference(ref){
  const signature=ref.filePath+'|'+JSON.stringify(ref.from)+'|'+ref.text;
  if(signature===this.lastSelection&&this.draft().reference?.filePath===ref.filePath&&this.draft().reference?.text===ref.text)return;this.lastSelection=signature;
  if(ref.text.length>80000){new Notice('选区超过8万字，请缩小选区后提问。');return;}
  this.draft().reference=ref;this.scheduleSave();this.notify('draft');
 }
 currentTarget(){
  const t=this.lastEditor;if(!t)return null;
  if(t.view instanceof MarkdownView&&(!t.view.containerEl.isConnected||t.view.file?.path!==t.filePath))return null;
  return t;
 }
 renameSource(file,old){
  const remap=value=>value===old?file.path:value?.startsWith(old+'/')?file.path+value.slice(old.length):value;
  if(this.lastEditor)this.lastEditor.filePath=remap(this.lastEditor.filePath);
  for(const t of this.data.topics)for(const m of [...t.messages,t.draft||{}]){if(m.reference)m.reference.filePath=remap(m.reference.filePath);if(m.sourcePath)m.sourcePath=remap(m.sourcePath);}
  this.scheduleSave();this.notify('target');
 }
 async newTopic(){if(this.busy){this.stop();await this.running;}const t=topic();this.data.topics.push(t);this.data.activeTopicId=t.id;this.lastSelection='';this.selectedBubble=null;await this.save();await this.openChat();this.notify('topics');}
 async switchTopic(topicId){if(!this.data.topics.some(t=>t.id===topicId))return;this.data.activeTopicId=topicId;this.selectedBubble=null;await this.save();this.notify('topic');}
 async followup(message,text){
  const selected=text||this.selectedText(message);
  this.draft().followup={messageId:message.id,text:selected||message.content};this.selectedBubble=null;await this.save();const view=await this.openChat();this.notify('draft');view.input.focus();
 }
 async copy(message){
  const selected=this.selectedText(message);
  const text=selected||message.content;if(!text)return;
  await copyText(text);new Notice(selected?'已复制选中文字':'已复制整条内容');
 }
 selectedText(message){
  const cached=this.selectedBubble;
  const docs=new Set([typeof document!=='undefined'?document:null,cached?.doc]);
  for(const leaf of [...this.app.workspace.getLeavesOfType(VIEW_TYPE),...this.app.workspace.getLeavesOfType(READING_VIEW_TYPE)])docs.add(leaf.view.contentEl?.ownerDocument);
  for(const doc of docs){
   const selection=doc?.getSelection?.();if(!selection?.rangeCount)continue;
   const anchor=selection.anchorNode?.nodeType===1?selection.anchorNode:selection.anchorNode?.parentElement;
   const focus=selection.focusNode?.nodeType===1?selection.focusNode:selection.focusNode?.parentElement;
   if(anchor?.closest('[data-message-id]')?.dataset.messageId===message.id&&focus?.closest('[data-message-id]')?.dataset.messageId===message.id)return selectionText(doc,anchor.closest('[data-message-id]'));
  }
  return '';
 }
 async send(){
  if(this.busy)return;
  const apiKey=this.apiKey();if(!apiKey){new Notice('请先在插件设置中配置 DeepSeek API Key。');this.openSettings();return;}
  const t=this.activeTopic(),draft=this.draft(t);
  if(!draft.text.trim()&&!draft.reference&&!draft.followup&&!draft.attachments.length)return;
  const user={id:id(),role:'user',content:draft.text.trim()||'请分析所引用的内容和附件。',createdAt:new Date().toISOString(),sourcePath:draft.reference?.filePath||this.currentTarget()?.filePath||'',reference:draft.reference?JSON.parse(JSON.stringify(draft.reference)):null,followup:draft.followup?{...draft.followup}:null,attachments:[...draft.attachments]};
  if(t.messages.length===0)t.title=user.content.replace(/\s+/g,' ').slice(0,28);
  const history=historyRounds(t.messages,this.data.settings.historyRounds);t.messages.push(user);t.draft={text:'',reference:null,followup:null,attachments:[]};
  this.notify('draft');this.notify('topics');return this.generate(t,user,history,apiKey);
 }
 async generate(t,user,history,apiKey){
  const settings={...this.data.settings};
  const message={id:id(),role:'assistant',content:'',reasoning:'',deepThink:settings.deepThink,status:'streaming',bad:false,createdAt:new Date().toISOString(),sourcePath:user.sourcePath||user.reference?.filePath||this.currentTarget()?.filePath||'',reference:user.reference?JSON.parse(JSON.stringify(user.reference)):null,replyTo:user.id};
  t.messages.push(message);this.busy=true;this.controller=new AbortController();this.notify('message');
  this.running=(async()=>{
   try{
    await this.save();
    message.readingLinks=true;this.notify('message');
    const linkDoc=this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view.contentEl?.ownerDocument||(typeof document!=='undefined'?document:null);
    await resolveMessageLinks(this,user,linkDoc,this.controller.signal);message.readingLinks=false;await this.save();this.notify('links');
    const messages=await buildMessages(settings,history,user,a=>this.attachments.load(a));
    const result=await streamCompletion({requestUrl,preferNative:!!Platform.isMobile,onTransport:()=>{if(!this.nativeNoticeShown){this.nativeNoticeShown=true;new Notice('当前环境使用兼容请求，回答生成完成后显示。',6000);}},apiKey,body:requestBody(settings,messages),signal:this.controller.signal,onDelta:delta=>{message.content+=delta.content;message.reasoning+=delta.reasoning;this.notifyStream();}});
    message.status='done';message.completedAt=new Date().toISOString();
    if(result.finishReason==='length')message.warning='已达到模型输出上限，回答可能未完成，可继续追问。';
    if(!message.content)throw new Error('模型没有返回回答正文，请重试。');
   }catch(e){message.status=e.name==='AbortError'?'stopped':'error';message.error=errorMessage(e);}
   finally{message.readingLinks=false;this.busy=false;this.controller=null;clearTimeout(this.notifyTimer);this.notifyTimer=null;await this.save();this.notify('message');}
  })();return this.running;
 }
 stop(){this.controller?.abort();}
 async retry(message){
  if(this.busy)return;const apiKey=this.apiKey();if(!apiKey){this.openSettings();return;}
  const t=this.data.topics.find(t=>t.messages.some(m=>m.id===message.id));if(!t)return;
  const index=t.messages.findIndex(m=>m.id===message.id),user=t.messages.find(m=>m.id===message.replyTo);if(!user)return;
  // Keep the previous attempt visible but exclude it from future automatic context.
  message.bad=true;
  const history=historyRounds(t.messages.slice(0,t.messages.findIndex(m=>m.id===user.id)),this.data.settings.historyRounds);
  // Insert a new user/answer round so history remains well formed even after retrying old answers.
  const retryUser={...JSON.parse(JSON.stringify(user)),id:id(),createdAt:new Date().toISOString(),retryOf:user.id};t.messages.push(retryUser);
  this.data.activeTopicId=t.id;this.notify('topic');return this.generate(t,retryUser,history,apiKey);
 }
 async writeAnswer(message,replace){
  if(!message.content||message.status!=='done')throw new Error('请等待回答完成后再写回笔记。');
  if(replace){
   const reference=message.reference;if(!reference?.text||!reference.from||!reference.to)throw new Error('替换需要来自编辑模式的笔记选区，请重新选中文字后提问。');
   let view=this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v instanceof MarkdownView&&v.file?.path===reference.filePath);
   if(!view){await this.app.workspace.openLinkText(reference.filePath,'',false);throw new Error('已打开来源笔记，请确认内容后再次点击“替换”。');}
   if(view.getMode()!=='source')throw new Error('请先把来源笔记切换到编辑模式，再执行替换。');
   if(!selectionMatches(view.editor,reference))throw new Error('原选区内容或位置已变化，请重新选取原文后提问。');
   view.editor.replaceRange(message.content,reference.from,reference.to);new Notice('已替换原选区，可使用 Ctrl/Cmd+Z 撤销。');
  }else{
   const target=this.currentTarget();if(!target)throw new Error('请先点击目标 Markdown 笔记，设置光标后再插入。');
   if(target.view instanceof MarkdownView&&target.view.getMode()!=='source')throw new Error('请先将目标笔记切换到编辑模式。');
   // Re-read that editor's cursor at action time rather than using a stale send-time offset.
   const cursor=target.editor.getCursor('head');target.editor.replaceRange(message.content,cursor);new Notice('已按 Markdown 插入 '+target.filePath+'，可撤销。');
  }
 }
 async deleteTopic(topicId=this.data.activeTopicId){
  if(this.busy)throw new Error('请先停止生成，再删除话题。');
  const target=this.data.topics.find(t=>t.id===topicId);if(!target)return;
  if(!await new ConfirmModal(this.app,'删除话题',`将删除“${target.title}”及其中的全部对话和草稿。其他话题和已写入的笔记不受影响。`,'删除话题').openResult())return;
  if(this.busy)throw new Error('正在生成回答，请停止后重试删除。');
  this.data.topics=this.data.topics.filter(t=>t.id!==topicId);if(!this.data.topics.length)this.data.topics.push(topic());
  if(this.data.activeTopicId===topicId)this.data.activeTopicId=this.data.topics.at(-1).id;
  const removed=new Set(target.messages.map(m=>m.id));for(const t of this.data.topics)if(removed.has(t.draft?.followup?.messageId))t.draft.followup=null;
  this.lastSelection='';if(removed.has(this.selectedBubble?.id))this.selectedBubble=null;
  await this.save();this.notify('topics');this.notify('topic');this.notify('round-deleted');new Notice('已删除话题');
 }
 async deleteRound(message){
  if(this.busy)throw new Error('请等待生成完成或先停止生成，再删除对话。');
  const t=this.data.topics.find(t=>t.messages.some(m=>m.id===message.id));if(!t)return;
  const index=t.messages.findIndex(m=>m.id===message.id),user=t.messages.find(m=>m.role==='user'&&m.id===message.replyTo)||(t.messages[index-1]?.role==='user'?t.messages[index-1]:null);
  if(!await new ConfirmModal(this.app,'删除本轮对话','将删除这一轮的提问及对应回答，删除后不再用于后续自动上下文。已写入的笔记不受影响。','删除本轮').openResult())return;
  // Generation may have started while the confirmation was open.
  if(this.busy)throw new Error('正在生成回答，请停止后重试删除。');
  const removed=new Set([message.id]);if(user){removed.add(user.id);for(const m of t.messages)if(m.replyTo===user.id)removed.add(m.id);}
  t.messages=t.messages.filter(m=>!removed.has(m.id));
  t.title=(t.messages.find(m=>m.role==='user')?.content||'新话题').replace(/\s+/g,' ').slice(0,28);
  for(const topic of this.data.topics)if(removed.has(topic.draft?.followup?.messageId))topic.draft.followup=null;
  if(removed.has(this.selectedBubble?.id))this.selectedBubble=null;
  await this.save();this.notify('round-deleted');this.notify('draft');new Notice('已删除本轮提问与回答');
 }
 async clearHistory(){
  if(this.busy){this.stop();await this.running;}
  const t=topic();this.data.topics=[t];this.data.activeTopicId=t.id;this.lastSelection='';this.selectedBubble=null;
  await this.attachments.clear();await this.save();this.notify('history');this.notify('topics');
 }
 async previewAttachment(a){
  const modal=new Modal(this.app);modal.titleEl.textContent=a.name;const d=modal.contentEl.ownerDocument;
  if(a.kind==='image'){const img=el(d,'img','jm-preview-image');img.alt=a.name;img.src=await this.attachments.preview(a,d);modal.contentEl.appendChild(img);}
  else{const text=el(d,'pre','jm-file-preview',new TextDecoder().decode(await this.attachments.load(a)));modal.contentEl.appendChild(text);}modal.open();
 }
 async startScreenshot(){
  if(Platform.isMobile){new Notice('请使用系统截图后，通过附件选择截图图片。');return;}
  const {execFile}=require('child_process');
  if(Platform.isWin)execFile('snippingtool.exe',['/clip'],{windowsHide:true},err=>{if(err)new Notice('无法启动截图工具，可按 Win+Shift+S 截图后粘贴到输入框。');});
  else if(Platform.isMacOS)execFile('/usr/sbin/screencapture',['-i','-c'],err=>{if(err)new Notice('截图未完成，可使用系统截图后粘贴图片。');});
  else new Notice('请使用系统截图复制到剪贴板，再点击“读取剪贴板图片”。');
 }
 async clipboardImage(doc){
  if(Platform.isMobile)throw new Error('请通过附件按钮选择相册或截图图片。');
  const image=require('electron').clipboard.readImage();if(image.isEmpty())throw new Error('剪贴板中没有图片，请先截图或复制图片。');
  return new doc.defaultView.File([image.toPNG()],`截图-${new Date().toISOString().replace(/[:.]/g,'-')}.png`,{type:'image/png'});
 }
 async testConnection(){
  const key=this.apiKey();if(!key)throw new Error('请先输入 API Key。');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try{await streamCompletion({requestUrl,preferNative:true,apiKey:key,body:{model:this.data.settings.model,messages:[{role:'user',content:'请只回复：连接成功'}],stream:true,max_tokens:24,thinking:{type:'disabled'}},signal:controller.signal,onDelta:()=>{}});}finally{clearTimeout(timeout);}
 }
}
module.exports=JeanmkAIPlugin;
