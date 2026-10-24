function bytesOf(value){return value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer||value,value.byteOffset||0,value.byteLength);}
function toBase64(value){const bytes=bytesOf(value);let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(raw);}
function fromBase64(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
module.exports={bytesOf,toBase64,fromBase64};
