// Obsidian Live Preview uses DOM cell selection, separate from Editor.getSelection().
function cellText(cell){return (cell?.innerText??cell?.textContent??'').trim().replace(/\r?\n/g,'<br>').replace(/\|/g,'\\|');}
function tableMarkdown(table,selected){
 const rows=Array.from(table.rows).filter(r=>r.closest('table')===table),chosen=new Set(selected);
 const columns=[...new Set(selected.map(c=>c.cellIndex))].sort((a,b)=>a-b);
 const included=rows.filter(r=>Array.from(r.cells).some(c=>chosen.has(c)));
 if(!included.length||!columns.length)return '';
 const first=included[0],hasHeader=columns.every(i=>first.cells[i]?.tagName==='TH'&&chosen.has(first.cells[i]));
 const sourceHeader=rows.find(r=>columns.every(i=>r.cells[i]?.tagName==='TH'));
 const header=hasHeader?columns.map(i=>cellText(first.cells[i])):columns.map(i=>cellText(sourceHeader?.cells[i])||`列${i+1}`);
 const body=(hasHeader?included.slice(1):included).map(r=>columns.map(i=>chosen.has(r.cells[i])?cellText(r.cells[i]):''));
 const line=values=>'| '+values.join(' | ')+' |';
 return [line(header),line(columns.map(()=>'---')),...body.map(line)].join('\n');
}
function selectedTableText(container){
 const selected=Array.from(container?.querySelectorAll?.('.cm-table-widget.has-selection td.is-selected, .cm-table-widget.has-selection th.is-selected')||[]);
 if(!selected.length)return '';
 // Do not combine unrelated tables, including nested rendered embeds.
 const table=selected[0].closest('table');if(!table)return '';
 return tableMarkdown(table,selected.filter(c=>c.closest('table')===table));
}
function selectionText(doc,container){
 const s=doc?.getSelection?.();if(!s?.rangeCount||!container?.contains(s.anchorNode)||!container.contains(s.focusNode))return '';
 const element=n=>n?.nodeType===1?n:n?.parentElement;
 const a=element(s.anchorNode)?.closest('td,th'),b=element(s.focusNode)?.closest('td,th');
 if(a&&b&&a!==b&&a.closest('table')===b.closest('table')){
  const table=a.closest('table'),range=s.getRangeAt(0);
  const cells=Array.from(table.rows).flatMap(r=>Array.from(r.cells)).filter(c=>c.closest('table')===table&&range.intersectsNode(c));
  if(cells.length)return tableMarkdown(table,cells);
 }
 return s.toString().trim();
}
module.exports={selectedTableText,selectionText,tableMarkdown};
