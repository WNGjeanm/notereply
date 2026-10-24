const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// Match Obsidian PopoverSuggest's real state guard: setting isOpen before
// calling the base method skips DOM attachment and keyboard scope activation.
class NativeLifecycleSuggest{
 constructor(app,input){this.app=app;this.textInputEl=input;this.isOpen=false;this.attached=false;this.scopeActive=false;}
 open(){if(this.isOpen)return;this.isOpen=true;this.attached=true;this.scopeActive=true;}
 close(){this.scopeActive=false;if(this.isOpen){this.isOpen=false;this.attached=false;}}
}
function load(){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/mention-input.js'),'utf8'),{module,require:id=>id==='obsidian'?{AbstractInputSuggest:NativeLifecycleSuggest}:require('../src/mentions')});return module.exports.FileMentionSuggest;}
test('native file suggestions really attach, close, and reopen without pre-setting parent state',()=>{
 const Suggest=load(),app={vault:{configDir:'.obsidian',getFiles:()=>[{path:'资料/设计.md'}]}},chosen=[];
 const editor={el:{},context:()=>({query:'设计'}),choose:f=>chosen.push(f.path)},suggest=new Suggest({app},editor);
 assert.equal(suggest.getSuggestions().length,1);suggest.open();assert.equal(suggest.isOpen,true);assert.equal(suggest.attached,true);assert.equal(suggest.scopeActive,true);
 suggest.close();assert.equal(suggest.attached,false);assert.equal(suggest.scopeActive,false);assert.equal(suggest.isOpen,false);
 suggest.open();assert.equal(suggest.attached,true);suggest.selectSuggestion({path:'资料/设计.md'});assert.deepEqual(chosen,['资料/设计.md']);assert.equal(suggest.attached,false);assert.equal(suggest.isOpen,false);
});
test('file suggestions suppress Chinese IME composition and non-mention contexts',()=>{
 const Suggest=load(),app={vault:{configDir:'.obsidian',getFiles:()=>{throw Error('should not search');}}};
 const editor={el:{},composing:true,context:()=>({query:'设计'})},suggest=new Suggest({app},editor);assert.equal(suggest.getSuggestions().length,0);
 editor.composing=false;editor.context=()=>null;assert.equal(suggest.getSuggestions().length,0);
});
