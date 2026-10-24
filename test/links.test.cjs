const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),zlib=require('node:zlib');
const {DOMParser}=require(require.resolve('@xmldom/xmldom',{paths:[path.dirname(require.resolve('mammoth'))]}));
const {drawioText}=require('../src/drawio');
const {extractLinks,allowedPath,selectSection,resolveMessageLinks}=require('../src/links');
const {DEFAULTS,buildMessages}=require('../src/core');
const graph='<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="s" value="&lt;b&gt;待审核&lt;/b&gt;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="40"/></mxCell><object id="done" label="完成"><mxCell vertex="1" parent="1"/></object><mxCell id="edge" edge="1" source="s" target="done" value="通过" style="endArrow=block;dashed=1"><mxGeometry><mxPoint x="20" y="50" as="sourcePoint"/></mxGeometry></mxCell></root></mxGraphModel>';
const plain='<mxfile><diagram name="审批">'+graph+'</diagram></mxfile>';
const compressed='<mxfile><diagram name="压缩页">'+zlib.deflateRawSync(Buffer.from(encodeURIComponent(graph))).toString('base64')+'</diagram></mxfile>';
test('drawio extracts actual labels, object IDs, source/target and arrow style from plain and compressed multi-page XML',()=>{
 for(const raw of [plain,compressed]){const result=drawioText(raw,'状态机.drawio',DOMParser);assert.equal(result.nodes,2);assert.equal(result.edges,1);assert.match(result.text,/待审核/);assert.match(result.text,/done：完成/);assert.match(result.text,/endArrow=block/);assert(!result.text.includes('<b>'));}
 assert.equal(drawioText('<mxfile><diagram name="1">'+graph+'</diagram><diagram name="2">'+graph+'</diagram></mxfile>','multi',DOMParser).pages,2);
 assert.throws(()=>drawioText('<!DOCTYPE x [<!ENTITY evil "x">]><mxfile/>','bad',DOMParser),/实体/);
});
test('link parsing supports aliases, embeds and local Markdown links, avoids external URLs and config paths',()=>{
 const links=extractLinks('[[资料#流程|别名]] ![[图.drawio]] [本地](<资料 2.md>) [网页](https://example.com) [[图.drawio]]');assert.equal(links.length,3);assert.equal(links[0].target,'资料#流程');assert.equal(extractLinks('[[普通]] ![[嵌入]]',true)[0].target,'嵌入');
 for(const p of ['../secret','.obsidian/plugins/key.json','C:/key','/key'])assert(!allowedPath(p,'.obsidian'));assert(allowedPath('资料/正文.md','.obsidian'));
 assert.equal(selectSection('# A\n原文\n## 子标题\n子内容\n# B\n其他','A'),'# A\n原文\n## 子标题\n子内容');assert.equal(selectSection('前文\n\n目标内容 ^target\n\n后文','^target'),'目标内容');assert.throws(()=>selectSection('# A\n原文','B'),/找不到/);
});
function mock(){
 const files=new Map([['notes/资料.md','# 流程\n选择内容\n![[图.drawio]]\n[[不应读取]]\n# 私密段\n未选择的内容'],['notes/图.drawio',plain],['.obsidian/secrets.json','不应读取的密钥'],['notes/不应读取.md','未请求的笔记']]);const reads=[],store=new Map();
 const fileFor=p=>files.has(p)?{path:p,name:p.split('/').at(-1),extension:p.split('.').at(-1),stat:{size:Buffer.byteLength(files.get(p))}}:null;
 const plugin={app:{metadataCache:{getFirstLinkpathDest:(p,source)=>{const dir=source.slice(0,source.lastIndexOf('/')+1);return fileFor(p)||fileFor(dir+p)||fileFor(dir+p+'.md');}},vault:{configDir:'.obsidian',getAbstractFileByPath:fileFor,cachedRead:async f=>{reads.push(f.path);return files.get(f.path);}}},attachments:{text:async(name,text,extra)=>{const a={id:String(store.size),name,kind:'text',...extra};store.set(a.id,text);return a;}}};return {plugin,reads,store};
}
test('send-time link resolution reads selected note section and its embedded drawio only, caches facts into model attachments',async()=>{
 const {plugin,reads,store}=mock(),user={role:'user',content:'请分析 [[资料#流程]] 与 [[.obsidian/secrets.json]]',sourcePath:'notes/当前.md',attachments:[]};assert.equal(reads.length,0);
 await resolveMessageLinks(plugin,user,{defaultView:{DOMParser}});assert.deepEqual(reads,['notes/资料.md','notes/图.drawio']);assert.equal(user.linkReports.filter(r=>r.ok).length,2);assert.equal(user.linkReports.filter(r=>!r.ok).length,1);
 const payload=await buildMessages(DEFAULTS,[],user,async a=>new TextEncoder().encode(store.get(a.id)));const text=JSON.stringify(payload);assert.match(text,/待审核/);assert.match(text,/已实际读取/);assert(!text.includes('未选择的内容'));assert(!text.includes('不应读取的密钥'));
 await resolveMessageLinks(plugin,user,{defaultView:{DOMParser}});assert.equal(reads.length,2,'Retry preserves the already sent snapshot');
});
test('missing links are reported honestly and aborted reading does not continue',async()=>{
 const {plugin,reads}=mock(),user={content:'[[缺失.drawio]]',sourcePath:'notes/当前.md',attachments:[]};await resolveMessageLinks(plugin,user,{defaultView:{DOMParser}});assert.equal(user.linkReports[0].ok,false);assert.equal(reads.length,0);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>resolveMessageLinks(plugin,{content:'[[资料]]',sourcePath:'notes/当前.md',attachments:[]},{defaultView:{DOMParser}},controller.signal),{name:'AbortError'});
});
test('explicit @ file keeps exact vault path including hash and percent, ahead of ambiguous link resolution',async()=>{
 const {plugin,reads,store}=mock();const path='其他/100%#设计.md';const selected={path,name:'100%#设计.md',extension:'md',stat:{size:20}};
 const oldRead=plugin.app.vault.cachedRead;plugin.app.vault.cachedRead=async f=>{if(f===selected){reads.push(f.path);return '明确选择的文件正文';}return oldRead(f);};
 plugin.app.vault.getAbstractFileByPath=p=>p===path?selected:null;
 plugin.app.metadataCache.getFirstLinkpathDest=()=>{throw new Error('不应模糊解析明确选择的路径');};
 const user={content:'分析 @[[其他/100%#设计.md]]',attachments:[]};await resolveMessageLinks(plugin,user,{defaultView:{DOMParser}});
 assert.deepEqual(reads,[path]);assert.equal(user.linkReports[0].ok,true);assert([...store.values()].some(s=>s.includes('明确选择的文件正文')));
});
