class MemoryAdapter{
 constructor(){this.entries=new Map();this.writes=[];this.reads=[];}
 async exists(path){return this.entries.has(path);}
 async mkdir(path){this.entries.set(path,null);}
 async write(path,text){this.writes.push(path);this.entries.set(path,String(text));}
 async read(path){this.reads.push(path);if(!this.entries.has(path)||typeof this.entries.get(path)!=='string')throw Error('ENOENT '+path);return this.entries.get(path);}
 async writeBinary(path,value){const bytes=new Uint8Array(value.buffer||value,value.byteOffset||0,value.byteLength);this.entries.set(path,new Uint8Array(bytes));}
 async readBinary(path){const value=this.entries.get(path);if(value===undefined||value===null)throw Error('ENOENT '+path);return typeof value==='string'?new TextEncoder().encode(value).buffer:new Uint8Array(value).buffer;}
 async rename(from,to){if(!this.entries.has(from))throw Error('ENOENT');this.entries.set(to,this.entries.get(from));this.entries.delete(from);}
 async remove(path){this.entries.delete(path);}
 async list(path){const prefix=path+'/',files=[],folders=[];for(const [key,value]of this.entries)if(key.startsWith(prefix)&&!key.slice(prefix.length).includes('/'))(value===null?folders:files).push(key);return {files,folders};}
 async rmdir(path,recursive){for(const key of [...this.entries.keys()])if(key.startsWith(path+'/')){if(!recursive)throw Error('not empty');this.entries.delete(key);}this.entries.delete(path);}
}
module.exports={MemoryAdapter};
