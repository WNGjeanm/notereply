const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {streamCompletion,errorMessage,buildMessages,DEFAULTS}=require('../src/core');
const good=()=>({status:200,text:JSON.stringify({choices:[{message:{content:'兼容回答',reasoning_content:'核对材料'},finish_reason:'stop'}]})});
const options={apiKey:'synthetic',body:{model:'deepseek-flash',messages:[{role:'user',content:'问题'}],stream:true,thinking:{type:'enabled'}},onDelta:()=>{}};
test('mobile requestUrl uses non-streaming JSON with intact model/context/thinking and no Content-Length',async()=>{
 let request,delta,transport;const result=await streamCompletion({...options,preferNative:true,requestUrl:async r=>(request=r,good()),onDelta:d=>delta=d,onTransport:t=>transport=t});
 assert.equal(transport,'native');assert.equal(request.throw,false);assert.equal(request.headers.Authorization,'Bearer synthetic');assert.equal(request.headers['Content-Length'],undefined);
 assert.deepEqual(JSON.parse(request.body),{...options.body,stream:false});assert.deepEqual(delta,{content:'兼容回答',reasoning:'核对材料'});assert.equal(result.finishReason,'stop');
});
function unsupportedCore(nodeError){const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/core'),'utf8'),{module,require:id=>id==='./portable'?require('../src/portable'):({request(){throw new Error(nodeError);}}),URL,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,AbortController,crypto:globalThis.crypto});return module.exports;}
test('exact Android Node stub falls back once; auth/network errors never retry via native transport',async()=>{
 let calls=0;const native=async()=>{calls++;return good();};
 await unsupportedCore('http.request is not available in the web version. Use requestUrl() instead.').streamCompletion({...options,requestUrl:native});assert.equal(calls,1);
 for(const error of ['HTTP 401: wrong key','ECONNRESET','HTTP 500: error'])await assert.rejects(()=>unsupportedCore(error).streamCompletion({...options,requestUrl:native}),new RegExp(error));
 assert.equal(calls,1);
});
test('native status/JSON/model errors surface and are not treated as connection success',async()=>{
 for(const [response,pattern] of [[{status:401,text:'bad key'},/401/],[{status:402,text:'balance'},/402/],[{status:429,text:'limit'},/429/],[{status:200,text:'<html>'},/无法解析/],[{status:200,text:'{"choices":[]}'},/没有返回/],[{status:200,text:'{"error":{"message":"model missing"}}'},/model missing/]])await assert.rejects(()=>streamCompletion({...options,preferNative:true,requestUrl:async()=>response}),pattern);
 assert.match(errorMessage(Error('HTTP 401')),/API Key/);
});
test('native cancellation is immediate, never emits a late answer and handles late failure',async()=>{
 const controller=new AbortController();let resolve,delta=0;const promise=streamCompletion({...options,preferNative:true,signal:controller.signal,requestUrl:()=>new Promise(r=>resolve=r),onDelta:()=>delta++});
 await Promise.resolve();controller.abort();await assert.rejects(()=>promise,{name:'AbortError'});resolve(good());await new Promise(r=>setTimeout(r,10));assert.equal(delta,0);
 let reads=0;await assert.rejects(()=>streamCompletion({...options,preferNative:true,signal:controller.signal,requestUrl:async()=>{reads++;return good();}}),{name:'AbortError'});assert.equal(reads,0);
});
test('native timeout rejects and does not publish delayed content',async()=>{
 let resolve,delta=0;await assert.rejects(()=>streamCompletion({...options,preferNative:true,timeoutMs:10,requestUrl:()=>new Promise(r=>resolve=r),onDelta:()=>delta++}),/超时/);resolve(good());await new Promise(r=>setTimeout(r,5));assert.equal(delta,0);
});
test('portable binary encoding and image request construction work without Node Buffer',async()=>{
 const {toBase64,fromBase64}=require('../src/portable');const bytes=Uint8Array.from([0,1,128,255]);assert.equal(toBase64(bytes),'AAGA/w==');assert.deepEqual(fromBase64(toBase64(bytes)),bytes);assert.equal(toBase64(bytes.buffer),'AAGA/w==');
 const messages=await buildMessages(DEFAULTS,[],{role:'user',content:'分析',attachments:[{kind:'image',name:'图.png',mime:'image/png'}]},async()=>bytes.buffer);assert.equal(messages[1].content[1].image_url.url,'data:image/png;base64,AAGA/w==');
});
