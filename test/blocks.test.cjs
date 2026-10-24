const test=require('node:test'),assert=require('node:assert/strict');
const {extractBlocks}=require('../src/blocks');
test('extracts standalone table and fenced diagrams without copying surrounding answer or code examples',()=>{
 const text=['说明','', '| 名称 | 数值 |','| --- | ---: |','| A\\|B | 5 |','','```js','| 假表 | 数值 |','| --- | --- |','| 代码 | 9 |','```','','~~~mermaid','flowchart LR',' A[开始] --> B[完成]','~~~','','结束'].join('\n');
 const blocks=extractBlocks(text);assert.equal(blocks.length,2);assert.equal(blocks[0].kind,'table');assert.match(blocks[0].raw,/A\\\|B/);assert(!blocks[0].raw.includes('说明'));assert(!blocks[0].raw.includes('假表'));assert.equal(blocks[1].language,'mermaid');assert(blocks[1].raw.startsWith('~~~mermaid'));assert(!blocks[1].raw.includes('结束'));
});
test('preserves repeated table order, ignores unclosed diagram fences, handles CRLF',()=>{
 const table='| X | Y |\r\n| --- | --- |\r\n| 1 | 2 |';assert.equal(extractBlocks(table+'\r\n\r\n'+table).length,2);
 assert.equal(extractBlocks('```mermaid\ngraph LR\n A-->B').length,0);
});
