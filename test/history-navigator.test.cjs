const test=require('node:test'),assert=require('node:assert/strict');
const {navigationTurns}=require('../src/history-navigator');
test('history navigation preserves user message IDs and groups each displayed question with its answer',()=>{
 const messages=[{id:'stray',role:'assistant',content:'无提问回复'},{id:'u1',role:'user',content:'# 第一问\n\n**分析** @[[资料.md]]'},{id:'a1',role:'assistant',content:'初次回答'},{id:'a2',role:'assistant',content:'最后回答'},{id:'u2',role:'user',content:''},{id:'a3',role:'assistant',content:'',status:'streaming'}];
 const turns=navigationTurns(messages);assert.deepEqual(turns.map(t=>t.id),['u1','u2']);assert.equal(turns[0].title,'第一问 分析 资料.md');assert.equal(turns[0].answer,'最后回答');assert.equal(turns[1].title,'附件或引用提问');assert.equal(turns[1].answer,'正在生成回答…');assert.equal(messages[1].content,'# 第一问\n\n**分析** @[[资料.md]]');
});
test('removed questions disappear and long snippets are bounded without changing the conversation',()=>{
 const question={id:'u',role:'user',content:'问题'.repeat(100)},answer={role:'assistant',content:'回答'.repeat(100)};assert.equal(navigationTurns([question,answer])[0].title.length,78);assert.equal(navigationTurns([question,answer])[0].answer.length,78);assert.deepEqual(navigationTurns([answer]),[]);assert.equal(question.content.length,200);
});
