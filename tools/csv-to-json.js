#!/usr/bin/env node
// Usage: node tools/csv-to-json.js booklet.csv   (merges into data/questions.json)
// CSV columns: year,subject,topic,type,question,option1,option2,option3,option4,answer,explanation
// type = mc | short.  For short answers, put alternatives in answer separated by |
const fs = require('fs'), path = require('path');
const file = process.argv[2]; if (!file) { console.error('Usage: csv-to-json.js file.csv'); process.exit(1); }
function parse(t){ const rows=[]; let r=[],f='',q=false;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){ if(c=='"'&&t[i+1]=='"'){f+='"';i++} else if(c=='"') q=false; else f+=c; }
    else if(c=='"') q=true; else if(c==','){r.push(f);f=''} else if(c=='\n'||c=='\r'){ if(c=='\r'&&t[i+1]=='\n')i++; r.push(f);f=''; if(r.some(x=>x.trim()))rows.push(r); r=[]; } else f+=c; }
  if(f||r.length){r.push(f);rows.push(r)} return rows; }
const out = path.join(__dirname,'..','data','questions.json');
const db = JSON.parse(fs.readFileSync(out,'utf8'));
const [head,...rows] = parse(fs.readFileSync(file,'utf8'));
let n = db.questions.length, added = 0;
for (const r of rows) {
  const [year,subject,topic,type,q,o1,o2,o3,o4,answer,explain] = r.map(x=>x.trim());
  if(!q) continue;
  const item = {id:`imp-${Date.now().toString(36)}-${++n}`,year,subject,topic,type:type||'short',q,answer:answer.split('|').map(s=>s.trim()),explain:explain||''};
  if(item.type==='mc') item.options=[o1,o2,o3,o4].filter(Boolean);
  db.questions.push(item); added++;
  if(!db.yearGroups.includes(year)) db.yearGroups.push(year);
}
fs.writeFileSync(out, JSON.stringify(db,null,1));
console.log(`Added ${added} questions (total ${db.questions.length}).`);
