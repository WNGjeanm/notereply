const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');
const manifest = require('./manifest.json');
manifest.version = pkg.version;
fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
require('esbuild').buildSync({
 absWorkingDir: __dirname,
 entryPoints: [path.join(__dirname, 'src/main.js')], outfile: path.join(__dirname, 'main.js'),
 bundle: true, platform: 'node', format: 'cjs', target: 'es2022',
 external: ['obsidian', 'electron', '@codemirror/view', '@codemirror/state'],
 sourcemap: false, minify: false, legalComments: 'eof'
});
for (const asset of ['pdf.mjs', 'pdf.worker.mjs']) {
 fs.copyFileSync(require.resolve('pdfjs-dist/legacy/build/' + asset), path.join(__dirname, asset));
}
console.log('Built 笔答 · NoteReply ' + pkg.version);
