const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const {initialData}=require('../src/core');
const {MemoryAdapter}=require('./memory-adapter.cjs');
class Component {addChild(c){return c;}removeChild(){}register(){} }
class Plugin extends Component{
 constructor(){super();this.manifest={id:'jeanmk-obsidian-ai',version:'0.1.0'};this.registered=[];this.events={};}
 async loadData(){return this.saved||initialData();}async saveData(data){this.saved=structuredClone(data);}
 registerView(id,fn){this.factory=fn;}addRibbonIcon(){}addCommand(c){this.registered.push(c);}addSettingTab(){}registerEvent(){}registerDomEvent(){}registerEditorExtension(){}
}
class MarkdownView{constructor(editor){this.editor=editor;this.file={path:'测试.md',extension:'md'};this.containerEl={isConnected:true,ownerDocument:{},contains:()=>true};}getMode(){return'source';}addAction(){return{remove(){}};}}
class Editor{
 constructor(){this.value='原文：需要润色的句子\n结束';this.from={line:0,ch:3};this.to={line:0,ch:10};this.undo=[];}
 offset(p){return this.value.split('\n').slice(0,p.line).reduce((a,b)=>a+b.length+1,0)+p.ch;}
 getRange(a,b){return this.value.slice(this.offset(a),this.offset(b));}
 getSelection(){return this.getRange(this.from,this.to);}getCursor(which){return which==='from'?{...this.from}:{...this.to};}
 replaceRange(text,from,to=from){this.undo.push(this.value);const a=this.offset(from),b=this.offset(to);this.value=this.value.slice(0,a)+text+this.value.slice(b);}
}
test('plugin lifecycle and full send → followup → insert/replace → new topic → save loop',async()=>{
 const requests=[];
 const server=http.createServer((req,res)=>{let bytes='';req.on('data',c=>bytes+=c);req.on('end',()=>{requests.push(JSON.parse(bytes));res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"reasoning_content":"先分析原文"}}]}\n\n');res.end('data: {"choices":[{"delta":{"content":"## 润色结果\\n\\n这是一条规范的句子。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const notices=[],electron={clipboard:{writeText:text=>{electron.copied=text;}}};
  const obsidian={AbstractInputSuggest:class{},Plugin,MarkdownView,ItemView:class extends Component{},PluginSettingTab:class{},Modal:class{},Component,Notice:class{constructor(s){notices.push(s);}},Platform:{isWin:true},editorInfoField:Symbol(),TFile:class{}};
  const module={exports:{}};
  const context={module,exports:module.exports,require:name=>name==='obsidian'?obsidian:name==='@codemirror/view'?{EditorView:{updateListener:{of:fn=>fn}}}:name==='https'?{request:(_,opts,callback)=>http.request(`http://127.0.0.1:${server.address().port}/chat/completions`,opts,callback)}:name==='electron'?electron:require(name),document:{},window:{},console,setTimeout,clearTimeout,TextDecoder,TextEncoder,Buffer,AbortController,URL,crypto:globalThis.crypto};
  vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'),'utf8'),context);
  const plugin=new module.exports(),editor=new Editor(),view=new MarkdownView(editor);const secrets={};
  plugin.app={secretStorage:{getSecret:key=>secrets[key]||'',setSecret:(key,value)=>secrets[key]=value},workspace:{on:()=>({}),onLayoutReady:fn=>fn(),getLeavesOfType:t=>t==='markdown'?[{view}]:[],getActiveViewOfType:()=>view},vault:{configDir:'.obsidian',on:()=>({}),adapter:new MemoryAdapter()}};
  await plugin.onload();assert.equal(plugin.version,require('../package.json').version);assert.equal(plugin.manifest.version,plugin.version,'Runtime version must replace stale Obsidian manifest metadata');assert.equal(plugin.registered.length,3);plugin.openChat=async()=>({input:{focus(){}}});plugin.openSettings=()=>{plugin.settingsOpened=true;};
  plugin.draft().text='润色';await plugin.send();assert(plugin.settingsOpened);assert.equal(requests.length,0);
  await plugin.renameTopic(plugin.data.activeTopicId,' 手动命名 ');assert.equal(plugin.activeTopic().title,'手动命名');assert.equal(plugin.activeTopic().titleCustom,true);await assert.rejects(()=>plugin.renameTopic(plugin.data.activeTopicId,'   '),/1到80/);
  plugin.setApiKey('test-only-key');plugin.capture(editor,view.file,view);
  assert.equal(requests.length,0,'Selecting text must not call DeepSeek');assert.equal(plugin.draft().reference.text,'需要润色的句子');
  await plugin.send();assert.equal(requests.length,1);let answer=plugin.activeTopic().messages.at(-1);assert.equal(answer.status,'done');assert.equal(plugin.activeTopic().title,'手动命名');assert.equal(JSON.parse(await plugin.app.vault.adapter.read(plugin.store.topicPath(plugin.data.activeTopicId))).titleCustom,true);assert.equal(plugin.saved.topics,undefined);assert.equal(answer.reasoning,'先分析原文');assert.match(answer.content,/规范的句子/);assert.match(requests[0].messages[1].content,/需要润色的句子/);
  await plugin.writeAnswer(answer,true);assert.equal(editor.value,'原文：'+answer.content+'\n结束');assert.equal(editor.undo.length,1);
  await assert.rejects(()=>plugin.writeAnswer(answer,true),/原选区内容或位置已变化/);
  editor.from={line:0,ch:0};editor.to={line:0,ch:0};plugin.capture(editor,view.file,view);const previous=editor.value;await plugin.writeAnswer(answer,false);assert.equal(editor.value,answer.content+previous);
  await plugin.followup(answer,'规范的句子');plugin.draft().text='展开解释';await plugin.send();assert.equal(requests.length,2);assert(requests[1].messages.some(m=>typeof m.content==='string'&&m.content.includes('局部')===false));assert.match(requests[1].messages.at(-1).content,/规范的句子/);
  for(const m of plugin.activeTopic().messages)if(m.role==='assistant')m.bad=true;
  plugin.draft().text='独立问题';await plugin.send();assert.equal(requests.at(-1).messages.length,2,'Unsatisfied rounds must not re-enter context');
  await plugin.newTopic();plugin.draft().text='全新话题';await plugin.send();assert.equal(requests.at(-1).messages.length,2);assert.equal(plugin.data.topics.length,2);
  const serialized=JSON.stringify(plugin.saved);assert(!serialized.includes('test-only-key'));assert(!serialized.includes('全新话题'));assert((await plugin.app.vault.adapter.read(plugin.store.topicPath(plugin.data.activeTopicId))).includes('全新话题'));
  await plugin.copy(plugin.activeTopic().messages.at(-1));assert.match(electron.copied,/规范的句子/);
 }finally{await new Promise(r=>server.close(r));}
});
