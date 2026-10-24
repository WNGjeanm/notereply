class TopicPicker{
 constructor(owner,parent,{el,button,iconButton}){
  this.owner=owner;this.plugin=owner.plugin;this.doc=parent.ownerDocument;this.helpers={el,button,iconButton};
  this.container=el(this.doc,'div','jm-topic-picker');parent.appendChild(this.container);
  this.trigger=button(this.container,'',()=>this.toggle(),'jm-topic-select');this.trigger.setAttribute('aria-haspopup','menu');this.trigger.setAttribute('aria-expanded','false');
  this.menu=el(this.doc,'div','jm-topic-menu');this.menu.setAttribute('role','menu');this.menu.hidden=true;this.doc.body.appendChild(this.menu);
  this.onPointer=e=>{if(!this.menu.contains(e.target)&&!this.container.contains(e.target))this.close();};
  this.onResize=()=>this.close();this.onScroll=e=>{if(!this.menu.contains(e.target))this.close();};
  this.doc.addEventListener('pointerdown',this.onPointer);this.doc.addEventListener('scroll',this.onScroll,true);this.doc.defaultView.addEventListener('resize',this.onResize);
  this.trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();this.open();}});
  this.menu.addEventListener('keydown',e=>{
   const choices=Array.from(this.menu.querySelectorAll('.jm-topic-choice')),index=choices.indexOf(this.doc.activeElement);
   if(e.key==='Escape'){e.preventDefault();this.close();this.trigger.focus();}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=(Math.max(0,index)+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[next]?.focus();}
  });this.refresh();
 }
 refresh(){const t=this.plugin.activeTopic();this.trigger.textContent=t.title;this.trigger.title=t.title+' · 选择话题';const signature=JSON.stringify([this.plugin.busy,this.plugin.data.activeTopicId,this.plugin.data.topics.map(t=>[t.id,t.title])]);if(!this.menu.hidden&&signature!==this.signature){this.render();}this.signature=signature;}
 render(){const {el,button,iconButton}=this.helpers;this.menu.replaceChildren();
  for(const topic of [...this.plugin.data.topics].reverse()){
   const row=el(this.doc,'div','jm-topic-option');row.dataset.topicId=topic.id;row.classList.toggle('is-current',topic.id===this.plugin.data.activeTopicId);this.menu.appendChild(row);
   const choice=button(row,topic.title,async()=>{this.close();await this.plugin.switchTopic(topic.id);},'jm-topic-choice');choice.setAttribute('role','menuitem');choice.title=topic.title;choice.dataset.topicId=topic.id;if(topic.id===this.plugin.data.activeTopicId)choice.setAttribute('aria-current','true');
   const remove=iconButton(row,'删除话题：'+topic.title,'trash-2',async()=>{this.close();await this.plugin.deleteTopic(topic.id);});remove.classList.add('jm-topic-remove');remove.disabled=this.plugin.busy;remove.dataset.topicId=topic.id;
  }
 }
 open(){this.render();this.menu.hidden=false;this.trigger.setAttribute('aria-expanded','true');const box=this.trigger.getBoundingClientRect(),win=this.doc.defaultView;const width=Math.max(220,Math.min(430,Math.max(box.width,280),win.innerWidth-16));this.menu.style.width=width+'px';this.menu.style.left=Math.max(8,Math.min(box.left,win.innerWidth-width-8))+'px';this.menu.style.top=(box.bottom+5)+'px';this.menu.style.maxHeight=Math.max(120,Math.min(360,win.innerHeight-box.bottom-16))+'px';this.menu.querySelector('[aria-current=true]')?.focus();}
 toggle(){if(this.menu.hidden)this.open();else this.close();}
 close(){this.menu.hidden=true;this.trigger.setAttribute('aria-expanded','false');}
 destroy(){this.close();this.menu.remove();this.doc.removeEventListener('pointerdown',this.onPointer);this.doc.removeEventListener('scroll',this.onScroll,true);this.doc.defaultView.removeEventListener('resize',this.onResize);}
}
module.exports={TopicPicker};
