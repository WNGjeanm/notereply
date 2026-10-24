const test=require('node:test'),assert=require('node:assert/strict');
const {mentionsIn,mentionContext,atomicRange,rankFiles}=require('../src/mentions');
test('@ search accepts Chinese and path queries but excludes email and completed chips',()=>{
 for(const text of ['@','比较@需求 文档','请看 @812/状态机'])assert.equal(mentionContext(text,text.length).query,text.slice(text.lastIndexOf('@')+1));
 for(const text of ['a@example.com','@[[812/设计.md]]','@文件\n正文','正文'])assert.equal(mentionContext(text,text.length),null);
 assert.deepEqual(mentionContext('@设计 后文',3),{from:0,to:3,query:'设计'});
});
test('file ranking excludes configuration/folders and retains distinct full paths',()=>{
 const file=(path,mtime=0)=>({path,name:path.split('/').pop(),stat:{mtime}});
 const files=[file('资料/设计.md'),file('归档/设计.md'),file('资料/设计补充.md'),file('.obsidian/data.json'),file('.git/config'),{path:'资料',children:[]},file('非法].md')];
 assert.deepEqual(rankFiles(files,'设计.md','.obsidian').slice(0,2).map(f=>f.path),['归档/设计.md','资料/设计.md']);
 assert.deepEqual(rankFiles(files,'资料/设计','.obsidian').map(f=>f.path),['资料/设计.md','资料/设计补充.md']);
 assert.equal(rankFiles(files,'','.obsidian').length,3);assert.equal(rankFiles(Array.from({length:50},(_,i)=>file(i+'.md')),'','.obsidian').length,30);
});
test('atomic deletion expands partial selections and handles either adjacent key',()=>{
 const text='前@[[资料/设计.md]]中@[[图片.png]]后',tokens=mentionsIn(text),[a,b]=tokens;
 assert.deepEqual(atomicRange(text,a.to,a.to,'Backspace'),{from:a.from,to:a.to});
 assert.deepEqual(atomicRange(text,a.from,a.from,'Delete'),{from:a.from,to:a.to});
 assert.equal(atomicRange(text,a.from,a.from,'Backspace'),null);
 assert.deepEqual(atomicRange(text,a.from+2,b.to-2,'Delete'),{from:a.from,to:b.to});
 assert.deepEqual(atomicRange(text,0,a.from+2,'Backspace'),{from:0,to:a.to});
 assert.equal(atomicRange(text,text.length,text.length,'Delete'),null);
});
