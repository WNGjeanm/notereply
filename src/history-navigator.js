function summary(text,max=78){return String(text||'').replace(/!?(?:@)?\[\[([^\]]+)\]\]/g,'$1').replace(/[#*_`>|]/g,'').replace(/\s+/g,' ').trim().slice(0,max);}
function navigationTurns(messages){const turns=[];let current;for(const message of messages){if(message.role==='user'){current={id:message.id,title:summary(message.content)||'附件或引用提问',answer:'尚无回答'};turns.push(current);}else if(message.role==='assistant'&&current)current.answer=summary(message.content)||(message.status==='streaming'?'正在生成回答…':'尚无回答');}return turns;}
class HistoryNavigator{
 constructor(owner,parent,{el,button,setIcon}){
  this.owner=owner;this.doc=parent.ownerDocument;this.win=this.doc.defaultView;this.items=new Map();this.topicId=null;
  this.root=el(this.doc,'aside','jm-history-navigator');this.root.hidden=true;this.root.setAttribute('aria-label','历史对话快速定位');parent.appendChild(this.root);
  this.trigger=button(this.root,'',()=>this.toggle(),'jm-history-toggle');this.trigger.setAttribute('aria-label','打开历史定位');this.trigger.setAttribute('aria-haspopup','dialog');this.trigger.setAttribute('aria-expanded','false');const icon=el(this.doc,'span');setIcon(icon,'list');icon.setAttribute('aria-hidden','true');this.trigger.appendChild(icon);this.count=el(this.doc,'span','jm-history-count');this.trigger.appendChild(this.count);
  this.panel=el(this.doc,'section','jm-history-panel');this.panel.hidden=true;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','历史对话目录');this.root.appendChild(this.panel);
  const header=el(this.doc,'header','jm-history-head');this.panel.appendChild(header);header.appendChild(el(this.doc,'strong','','对话记录'));this.total=el(this.doc,'span');header.appendChild(this.total);const close=button(header,'×',()=>this.close(true),'jm-history-close');close.setAttribute('aria-label','关闭历史定位');
  this.list=el(this.doc,'div','jm-history-items');this.panel.appendChild(this.list);this.helpers={el,button};
  const cancel=()=>clearTimeout(this.closeTimer),schedule=()=>{cancel();this.closeTimer=setTimeout(()=>this.close(),280);};
  this.listeners=[[this.trigger,'pointerenter',e=>{if(e.pointerType!=='touch')this.open();}],[this.trigger,'pointerleave',schedule],[this.panel,'pointerenter',cancel],[this.panel,'pointerleave',schedule],[this.doc,'pointerdown',e=>{if(!this.root.contains(e.target))this.close(true);}],[this.doc,'keydown',e=>{if(e.key==='Escape'&&!this.panel.hidden){e.preventDefault();const focused=this.panel.contains(this.doc.activeElement);this.close(true);if(focused)this.trigger.focus();}}],[owner.list,'scroll',()=>this.active()],[this.win,'resize',()=>this.close(true)]];
  for(const [target,event,fn]of this.listeners)target.addEventListener(event,fn);
  this.trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();this.open(true);this.items.values().next().value?.button.focus();}});
  this.panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();this.close(true);this.trigger.focus();}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[...this.items.values()].map(x=>x.button),i=buttons.indexOf(this.doc.activeElement);buttons[(Math.max(0,i)+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
 }
 refresh(){
  const topic=this.owner.plugin.activeTopic(),turns=navigationTurns(topic.messages);if(this.topicId!==topic.id){this.close(true);this.topicId=topic.id;}
  this.root.hidden=turns.length<2;this.count.textContent=turns.length;this.total.textContent='共 '+turns.length+' 轮问答';if(this.root.hidden)this.close(true);
  const ids=new Set(turns.map(t=>t.id));for(const [id,item]of this.items)if(!ids.has(id)){item.button.remove();this.items.delete(id);}
  const {el,button}=this.helpers;
  turns.forEach((turn,index)=>{let item=this.items.get(turn.id);if(!item){const b=button(this.list,'',()=>this.locate(turn.id),'jm-history-item');b.dataset.messageId=turn.id;const number=el(this.doc,'span','jm-history-index');b.appendChild(number);const content=el(this.doc,'span','jm-history-item-text');b.appendChild(content);const title=el(this.doc,'strong','jm-history-title'),answer=el(this.doc,'span','jm-history-answer');content.append(title,answer);item={button:b,number,title,answer};this.items.set(turn.id,item);}
   item.number.textContent=index+1;item.title.textContent=turn.title;item.answer.textContent=turn.answer;item.button.setAttribute('aria-label','第 '+(index+1)+' 轮：'+turn.title);
  });this.active();
 }
 active(){if(this.root.hidden||this.panel.hidden)return;const limit=this.owner.list.getBoundingClientRect().top+Math.min(80,this.owner.list.clientHeight*.28);let active=this.items.keys().next().value;for(const id of this.items.keys()){const target=this.owner.cards.get(id)?.root;if(target&&target.getBoundingClientRect().top<=limit)active=id;}
  for(const [id,item]of this.items){const selected=id===active;item.button.classList.toggle('is-active',selected);if(selected)item.button.setAttribute('aria-current','true');else item.button.removeAttribute('aria-current');}
 }
 open(pinned=false){if(this.root.hidden)return;clearTimeout(this.closeTimer);this.pinned=!!pinned||this.pinned;this.panel.hidden=false;this.trigger.setAttribute('aria-expanded','true');this.active();const active=this.list.querySelector('[aria-current=true]');if(active){const top=active.offsetTop,bottom=top+active.offsetHeight;if(top<this.list.scrollTop)this.list.scrollTop=top;else if(bottom>this.list.scrollTop+this.list.clientHeight)this.list.scrollTop=bottom-this.list.clientHeight;}}
 close(force=false){if(this.pinned&&!force)return;clearTimeout(this.closeTimer);this.pinned=false;this.panel.hidden=true;this.trigger.setAttribute('aria-expanded','false');}
 toggle(){if(!this.panel.hidden&&this.pinned)this.close(true);else this.open(true);}
 locate(id){const target=this.owner.cards.get(id)?.root;if(!target)return;this.close(true);this.owner.atBottom=false;this.owner.list.scrollTop+=target.getBoundingClientRect().top-this.owner.list.getBoundingClientRect().top-12;this.owner.syncScrollState();this.clearHighlight();target.classList.add('jm-history-located');this.highlightTimer=setTimeout(()=>target.classList.remove('jm-history-located'),1600);this.active();}
 clearHighlight(){clearTimeout(this.highlightTimer);for(const node of this.owner.list.querySelectorAll('.jm-history-located'))node.classList.remove('jm-history-located');}
 destroy(){this.close(true);this.clearHighlight();for(const [target,event,fn]of this.listeners)target.removeEventListener(event,fn);this.root.remove();}
}
module.exports={HistoryNavigator,navigationTurns};
