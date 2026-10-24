const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {DEFAULTS,SSEParser,historyRounds,buildMessages,requestBody,normalizeData,streamCompletion,selectionMatches}=require('../src/core');
test('SSE supports fragmented CRLF, reasoning and final content without losing Chinese UTF8',()=>{
 const seen=[],p=new SSEParser(d=>seen.push(d));
 const s=': ping\r\n\r\ndata: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
 for(const c of s)p.push(c);assert.equal(p.done,true);assert.deepEqual(seen,[{content:'',reasoning:'思考'},{content:'回答',reasoning:''}]);
});
test('history excludes entire unsatisfied/failed rounds, preserves useful round count and character budget',()=>{
 const messages=[];for(let i=0;i<25;i++)messages.push({role:'user',content:'q'+i},{role:'assistant',content:'a'+i,status:'done',bad:i===24});
 messages.push({role:'user',content:'failed'},{role:'assistant',content:'partial',status:'error'});
 const selected=historyRounds(messages,5);assert.equal(selected.length,10);assert.equal(selected[0].content,'q19');assert.equal(selected.at(-1).content,'a23');assert.equal(historyRounds(messages,20).length,40);assert.equal(historyRounds(messages,5,1).length,0);
});
test('request combines explicit note reference, followup, documents and images at send time',async()=>{
 const current={role:'user',content:'比较',reference:{filePath:'测试.md',text:'选区'},followup:{text:'局部回答'},attachments:[{name:'附件.txt',kind:'text'},{name:'图片.png',kind:'image',mime:'image/png'}]};
 let read=0;const m=await buildMessages(DEFAULTS,[],current,async a=>{read++;return new TextEncoder().encode(a.kind==='text'?'表格数据':'image');});
 assert.equal(read,2);assert.equal(m.length,2);assert.match(m[1].content[0].text,/选区/);assert.match(m[1].content[0].text,/局部回答/);assert.match(m[1].content[1].text,/表格数据/);assert.equal(m[1].content[2].type,'image_url');
 assert.deepEqual(requestBody(DEFAULTS,m).thinking,{type:'enabled'});
 await assert.rejects(()=>buildMessages({...DEFAULTS,model:'deepseek-v4-pro'},[],current,async()=>new Uint8Array(1)),/图片需要/);
});
test('restored streaming messages become interrupted, keeping partial answer',()=>{
 const d=normalizeData({settings:{historyRounds:20},topics:[{id:'t',messages:[{role:'assistant',status:'streaming',content:'部分回答'}]}],activeTopicId:'t'});assert.equal(d.topics[0].messages[0].status,'interrupted');assert.equal(d.topics[0].messages[0].content,'部分回答');
});
test('replacement refuses stale source selection',()=>{
 const ref={text:'旧内容',from:{line:0,ch:0},to:{line:0,ch:3}};assert(selectionMatches({getRange:()=> '旧内容'},ref));assert(!selectionMatches({getRange:()=> '已修改'},ref));
});
test('real HTTP streaming transport handles split UTF8, failure, truncated response and cancellation',async()=>{
 const server=http.createServer((req,res)=>{let input='';req.on('data',b=>input+=b);req.on('end',()=>{
  const mode=JSON.parse(input).mode;
  if(mode==='fail'){res.writeHead(401);res.end('{"error":{"message":"bad key"}}');return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const bytes=Buffer.from('data: {"choices":[{"delta":{"content":"你好，世界"}}]}\n\n');
  res.write(bytes.subarray(0,58));
  const timer=setTimeout(()=>{res.write(bytes.subarray(58));if(mode!=='truncated')res.write('data: [DONE]\n\n');res.end();},mode==='slow'?300:10);res.on('close',()=>clearTimeout(timer));
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${server.address().port}/chat/completions`;
 try{
  let result='';await streamCompletion({endpoint,apiKey:'fake',body:{},onDelta:d=>result+=d.content});assert.equal(result,'你好，世界');
  await assert.rejects(()=>streamCompletion({endpoint,apiKey:'fake',body:{mode:'fail'},onDelta:()=>{}}),/401/);
  await assert.rejects(()=>streamCompletion({endpoint,apiKey:'fake',body:{mode:'truncated'},onDelta:()=>{}}),/提前结束/);
  const c=new AbortController(),p=streamCompletion({endpoint,apiKey:'fake',body:{mode:'slow'},signal:c.signal,onDelta:()=>{}});setTimeout(()=>c.abort(),20);await assert.rejects(()=>p,{name:'AbortError'});
 }finally{await new Promise(r=>server.close(r));}
});
