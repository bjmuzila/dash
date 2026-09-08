import fs from 'fs';
const r = p => fs.readFileSync(p,'utf8');
const css = r('src/styles.css');
const js  = ['src/data.js','src/ui.js','src/pages.js','src/pages-info.js','src/pages-content.js','src/pages-market-a.js','src/pages-market-b.js','src/pages-system.js','src/shell.js'].map(r).join('\n\n');
let out = r('template.html').replace('/*__CSS__*/', css).replace('/*__JS__*/', js);
fs.mkdirSync('dist',{recursive:true});
fs.writeFileSync('dist/index.html', out);
console.log('dist/index.html', (out.length/1024).toFixed(1)+' KB');
