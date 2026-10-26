const {initialData}=require('./core');
const FORMAT='notereply-storage',ROOT='NoteReply';
const clone=value=>JSON.parse(JSON.stringify(value));
function safeRoot(value){if(typeof value!=='string'||!value||/^[\\/]|^[a-z]:/i.test(value)||value.split(/[\\/]/).some(x=>!x||['..','.','.git','.obsidian'].includes(x)))throw Error('对话数据目录无效，未修改任何记录。');return value.replace(/\\/g,'/');}
function safeId(value){if(typeof value!=='string'||!/^[-\w]{1,100}$/.test(value))throw Error('话题 ID 无效，迁移已停止。');return value;}
function loaded(topic,value=true){Object.defineProperty(topic,'_loaded',{value,writable:true,configurable:true,enumerable:false});return topic;}
function bytes(value){return value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer||value,value.byteOffset||0,value.byteLength);}
function equalBytes(a,b){a=bytes(a);b=bytes(b);return a.length===b.length&&a.every((v,i)=>v===b[i]);}
class TopicStore{
 constructor(plugin){this.plugin=plugin;this.adapter=plugin.app.vault.adapter;this.root=ROOT;this.revisions=new Map();this.dirty=new Set();this.queue=Promise.resolve();this.lastSettings='';this.modified=new Map();}
 get indexPath(){return this.root+'/index.json';}
 get attachments(){return this.root+'/attachments';}
 topicPath(id){return this.root+'/topics/'+safeId(id)+'.json';}
 async mkdir(path){const parts=path.split('/');for(let i=1;i<=parts.length;i++){const part=parts.slice(0,i).join('/');if(!await this.adapter.exists(part))await this.adapter.mkdir(part);}}
 async read(path){const text=await this.adapter.read(path);this.revisions.set(path,text);return JSON.parse(text);}
 async write(path,text){
  if(this.revisions.get(path)===text)return;
  const exists=await this.adapter.exists(path),previous=exists?await this.adapter.read(path):null;
  if(exists&&this.revisions.has(path)&&previous!==this.revisions.get(path)){const conflict=this.root+'/conflicts/'+path.split('/').pop()+'-'+Date.now()+'.json';await this.mkdir(this.root+'/conflicts');await this.adapter.write(conflict,text);if(await this.adapter.read(conflict)!==text)throw Error('同步冲突且本地副本写入失败，请保留当前窗口并检查磁盘。');throw Error('对话文件已被其他设备修改，未覆盖远端；本地副本已保存在 NoteReply/conflicts，请重新加载后核对。');}
  if(exists&&!this.revisions.has(path))throw Error('发现未知的同名对话文件，已停止覆盖：'+path);
  await this.mkdir(path.slice(0,path.lastIndexOf('/')));const temp=path+'.pending';
  await this.adapter.write(temp,text);if(await this.adapter.read(temp)!==text)throw Error('对话临时文件校验失败。');
  if(previous!==null){await this.adapter.write(path+'.previous',previous);if(await this.adapter.read(path+'.previous')!==previous)throw Error('备份文件校验失败，未替换原文件。');}
  try{if(exists)await this.adapter.remove(path);await this.adapter.rename(temp,path);if(await this.adapter.read(path)!==text)throw Error('对话文件校验失败。');}
  catch(error){if(previous!==null)await this.adapter.write(path,previous);throw error;}
  this.revisions.set(path,text);
 }
 async putNew(path,text){if(await this.adapter.exists(path)){if(await this.adapter.read(path)!==text)throw Error('迁移目标已有不同内容，已停止覆盖：'+path);this.revisions.set(path,text);return;}await this.write(path,text);}
 config(data){return {schemaVersion:2,settings:clone(data.settings),secretId:data.secretId,storage:{version:1,root:this.root}};}
 async saveConfig(data){const config=this.config(data),stamp=JSON.stringify(config);if(stamp===this.lastSettings)return;await this.plugin.saveData(config);if(this.plugin.loadData&&JSON.stringify(await this.plugin.loadData())!==stamp)throw Error('插件配置写入校验失败，旧附件已保留。');this.lastSettings=stamp;}
 async open(raw){
  const data=raw||initialData();this.root=safeRoot(raw?.storage?.root||ROOT);const configDir=this.plugin.app.vault.configDir.toLowerCase();if(this.root.toLowerCase()===configDir||this.root.toLowerCase().startsWith(configDir+'/'))throw Error('对话目录不能位于插件配置目录内。');
  if(raw?.schemaVersion===2){if(raw.topics)throw Error('配置中检测到新旧格式混合，已停止加载以保护记录。');return this.openIndex(data);}
  if(await this.adapter.exists(this.indexPath)){
   const index=await this.read(this.indexPath);if(index.format!==FORMAT)throw Error('NoteReply 数据目录已被其他文件占用。');
   if(raw?.topics){if(!index.legacyBackup?.startsWith(this.root+'/backups/')||index.legacyBackup.includes('..')||JSON.stringify(await this.read(index.legacyBackup))!==JSON.stringify(raw))throw Error('发现不同版本的旧记录，已停止自动迁移以防覆盖。');}
   const result=await this.openIndex(data);await this.saveConfig(result);if(raw?.topics)await this.retireLegacy(index);return result;
  }
  return this.migrate(data,!!raw);
 }
 async openIndex(config){
  let index;try{index=await this.read(this.indexPath);}catch(error){
   const backup=this.indexPath+'.previous';if(await this.adapter.exists(backup)){try{index=JSON.parse(await this.adapter.read(backup));}catch{}}
   if(!index||index.format!==FORMAT||!index.topics?.length){const topics=await this.scanTopics(new Set());if(!topics.length)throw Error('找不到有效话题索引，未创建空记录或覆盖数据。');index={format:FORMAT,version:1,topics,activeTopicId:topics[0].id};}
   await this.adapter.write(this.indexPath,JSON.stringify(index));this.revisions.set(this.indexPath,JSON.stringify(index));
  }
  if(index.format!==FORMAT||!Array.isArray(index.topics)||!index.topics.length)throw Error('话题索引格式异常，未覆盖任何记录。');
  const recovered=await this.scanTopics(new Set(index.topics.map(t=>t.id)));if(recovered.length){index.topics.push(...recovered);await this.write(this.indexPath,JSON.stringify(index));}
  const ids=new Set();const topics=index.topics.map(meta=>{safeId(meta.id);if(ids.has(meta.id))throw Error('索引包含重复话题 ID。');ids.add(meta.id);this.modified.set(meta.id,meta.updatedAt);const t=loaded({id:meta.id,title:meta.title,createdAt:meta.createdAt,titleCustom:meta.titleCustom,messages:[]},false);return t;});
  const activeTopicId=ids.has(index.activeTopicId)?index.activeTopicId:topics[0].id,result={...config,topics,activeTopicId};this.indexExtra={legacyBackup:index.legacyBackup,legacyAttachmentsBackup:index.legacyAttachmentsBackup,legacyFolder:index.legacyFolder};await this.loadTopic(result,activeTopicId);return result;
 }
 async scanTopics(exclude){
  const folder=this.root+'/topics';if(!await this.adapter.exists(folder))return [];const list=await this.adapter.list(folder),meta=[];
  for(const path of list.files){if(!path.endsWith('.json'))continue;const id=path.split('/').pop().slice(0,-5);safeId(id);if(exclude.has(id))continue;const topic=await this.read(path);if(topic.id!==id||!Array.isArray(topic.messages))throw Error('发现异常话题文件，未覆盖任何记录。');meta.push({id,title:topic.title,titleCustom:!!topic.titleCustom,createdAt:topic.createdAt,updatedAt:topic.messages.at(-1)?.completedAt||topic.messages.at(-1)?.createdAt||topic.createdAt});}return meta;
 }
 async loadTopic(data,id){const topic=data.topics.find(t=>t.id===id);if(!topic)throw Error('找不到话题。');if(topic._loaded!==false)return topic;
  let payload;const path=this.topicPath(id);try{payload=await this.read(path);}catch(error){const backup=path+'.previous';if(!await this.adapter.exists(backup))throw Error('无法读取话题，已保留原文件，请从备份恢复。');payload=JSON.parse(await this.adapter.read(backup));if(payload.id!==id)throw error;await this.adapter.write(path,JSON.stringify(payload));this.revisions.set(path,JSON.stringify(payload));}
  if(payload.id!==id||!Array.isArray(payload.messages))throw Error('话题文件格式异常，已停止加载。');for(const key of Object.keys(topic))delete topic[key];Object.assign(topic,payload);loaded(topic);for(const m of topic.messages)if(m.status==='streaming'){m.status='interrupted';m.error='上次生成因插件关闭而中断，可重新生成。';}return topic;
 }
 async files(folder){if(!await this.adapter.exists(folder))return [];const list=await this.adapter.list(folder);let files=[...list.files];for(const dir of list.folders||[])files.push(...await this.files(dir));return files;}
 async copyFile(source,target){const content=await this.adapter.readBinary(source);await this.mkdir(target.slice(0,target.lastIndexOf('/')));if(!await this.adapter.exists(target))await this.adapter.writeBinary(target,content);if(!equalBytes(content,await this.adapter.readBinary(target)))throw Error('附件迁移校验失败，旧附件已保留。');}
 async migrate(data,hasLegacy){
  if(!Array.isArray(data.topics)||!data.topics.length)throw Error('旧话题数据为空或损坏，未开始迁移。');const ids=new Set();for(const t of data.topics){safeId(t.id);if(ids.has(t.id)||!Array.isArray(t.messages))throw Error('旧话题结构异常，未开始迁移。');ids.add(t.id);}
  await this.mkdir(this.root);const marker=this.root+'/migration.json';let backupRoot;
  if(await this.adapter.exists(marker)){const record=await this.read(marker);if(record.format!==FORMAT||!record.backupRoot?.startsWith(this.root+'/backups/')||record.backupRoot.includes('..')||record.legacyBackup!==record.backupRoot+'/data.json'||JSON.stringify(await this.read(record.legacyBackup))!==JSON.stringify(data))throw Error('未完成迁移与当前旧数据不一致，已停止覆盖。');backupRoot=record.backupRoot;}
  else{backupRoot=this.root+'/backups/legacy-'+new Date().toISOString().replace(/[:.]/g,'-');await this.mkdir(backupRoot);await this.putNew(backupRoot+'/data.json',JSON.stringify(data));await this.putNew(marker,JSON.stringify({format:FORMAT,backupRoot,legacyBackup:backupRoot+'/data.json'}));}
  const legacyFolder=this.plugin.app.vault.configDir+'/plugins/'+this.plugin.manifest.id+'/attachments',legacyFiles=await this.files(legacyFolder);
  for(const source of legacyFiles){if(!source.startsWith(legacyFolder+'/')||source.includes('..'))throw Error('旧附件路径异常。');const suffix=source.slice(legacyFolder.length);await this.copyFile(source,this.attachments+suffix);await this.copyFile(source,backupRoot+'/attachments'+suffix);}
  const migrated=clone(data);const remap=value=>{if(!value||typeof value!=='object')return;if(typeof value.storagePath==='string'){if(!value.storagePath.startsWith(legacyFolder+'/')||value.storagePath.includes('..'))throw Error('附件引用路径异常，未替换旧配置。');const source=value.storagePath;if(!legacyFiles.includes(source))throw Error('旧附件缺失，迁移已停止，请从备份找回附件。');value.storagePath=this.attachments+source.slice(legacyFolder.length);}for(const item of Object.values(value))if(item&&typeof item==='object')remap(item);};remap(migrated);
  for(const topic of migrated.topics){await this.putNew(this.topicPath(topic.id),JSON.stringify(topic));loaded(topic);this.modified.set(topic.id,topic.createdAt);}
  this.indexExtra={legacyBackup:backupRoot+'/data.json',legacyAttachmentsBackup:backupRoot+'/attachments',legacyFolder:hasLegacy?legacyFolder:undefined};const index=this.index(migrated);await this.putNew(this.indexPath,JSON.stringify(index));
  await this.saveConfig(migrated);await this.retireLegacy(index);return this.openIndex(this.config(migrated));
 }
 async retireLegacy(index){if(!index.legacyFolder||!await this.adapter.exists(index.legacyFolder))return;const prefix=this.plugin.app.vault.configDir+'/plugins/'+this.plugin.manifest.id+'/attachments';if(index.legacyFolder!==prefix||!index.legacyAttachmentsBackup?.startsWith(this.root+'/backups/')||index.legacyAttachmentsBackup.includes('..'))throw Error('旧附件目录无效，未清理。');for(const source of await this.files(prefix)){const suffix=source.slice(prefix.length);if(!await this.adapter.exists(index.legacyAttachmentsBackup+suffix)||!equalBytes(await this.adapter.readBinary(source),await this.adapter.readBinary(index.legacyAttachmentsBackup+suffix)))throw Error('旧附件发生变化，已保留原文件。');}for(const source of await this.files(prefix)){const suffix=source.slice(prefix.length);if(!equalBytes(await this.adapter.readBinary(source),await this.adapter.readBinary(index.legacyAttachmentsBackup+suffix)))throw Error('旧附件发生变化，已保留原文件。');await this.adapter.remove(source);}await this.removeEmpty(prefix);}
 async removeEmpty(folder){const list=await this.adapter.list(folder);if(list.files.length)throw Error('旧目录出现新文件，已保留。');for(const sub of list.folders||[])await this.removeEmpty(sub);await this.adapter.rmdir(folder,false);}
 index(data){return {format:FORMAT,version:1,...this.indexExtra,activeTopicId:data.activeTopicId,topics:data.topics.map(t=>({id:t.id,title:t.title,titleCustom:!!t.titleCustom,createdAt:t.createdAt,updatedAt:this.modified.get(t.id)}))};}
 save(data,ids=[]){for(const id of ids)if(id)this.dirty.add(id);this.queue=this.queue.catch(()=>{}).then(()=>this.flush(data));return this.queue;}
 async flush(data){
  const pending=[...this.dirty];this.dirty.clear();try{
   for(const id of pending){const t=data.topics.find(t=>t.id===id);if(!t||t._loaded===false)continue;loaded(t);const text=JSON.stringify(t);if(this.revisions.get(this.topicPath(id))!==text){await this.write(this.topicPath(id),text);this.modified.set(id,t.messages.at(-1)?.completedAt||t.messages.at(-1)?.createdAt||this.modified.get(id)||t.createdAt);}}
   const wanted=new Set(data.topics.map(t=>t.id));for(const path of [...this.revisions.keys()])if(path.startsWith(this.root+'/topics/')&&path.endsWith('.json')){const id=path.slice((this.root+'/topics/').length,-5);if(!wanted.has(id)&&await this.adapter.exists(path)){await this.mkdir(this.root+'/trash');await this.adapter.rename(path,this.root+'/trash/'+id+'-'+Date.now()+'.json');this.revisions.delete(path);}}
   await this.write(this.indexPath,JSON.stringify(this.index(data)));await this.saveConfig(data);
  }catch(error){for(const id of pending)this.dirty.add(id);throw error;}
 }
}
module.exports={TopicStore,equalBytes,safeRoot};
