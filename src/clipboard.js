async function copyText(text,doc=globalThis.document){
 try{const {clipboard}=require('electron');if(clipboard?.writeText){clipboard.writeText(text);return;}}catch{}
 const win=doc?.defaultView||globalThis;try{if(win.navigator?.clipboard?.writeText){await win.navigator.clipboard.writeText(text);return;}}catch{}
 if(!doc)throw new Error('当前环境无法访问剪贴板，请选中文字后复制。');
 const focus=doc.activeElement,selection=doc.getSelection(),ranges=[];for(let i=0;i<(selection?.rangeCount||0);i++)ranges.push(selection.getRangeAt(i).cloneRange());
 const input=doc.createElement('textarea');input.value=text;input.style.cssText='position:fixed;opacity:0;pointer-events:none';doc.body.appendChild(input);input.focus();input.select();
 try{if(!doc.execCommand('copy'))throw new Error('复制失败，请选中文字后使用系统复制。');}finally{input.remove();focus?.focus();selection?.removeAllRanges();for(const range of ranges)selection?.addRange(range);}
}
module.exports={copyText};
