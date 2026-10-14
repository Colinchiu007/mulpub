const { execSync } = require('child_process');
const fs = require('fs');

function keysOf(ref, file) {
  const raw = execSync(`git show ${ref}:${file}`, { maxBuffer: 1e8, encoding: 'utf8' });
  try { return Object.keys(JSON.parse(raw)); } catch (e) { return { __error: e.message, __len: raw.length }; }
}

const file = 'scripts/gate-record-debt-ledger.json';
const mine = keysOf('HEAD', file);
const main = keysOf('origin/main', file);

console.log('mine keys:', Array.isArray(mine) ? mine.length : JSON.stringify(mine));
console.log('main keys:', Array.isArray(main) ? main.length : JSON.stringify(main));

if (Array.isArray(mine) && Array.isArray(main)) {
  const onlyMine = mine.filter(k => !main.includes(k));
  const onlyMain = main.filter(k => !mine.includes(k));
  console.log('\n--- only in mine (must survive the merge) ---');
  onlyMine.forEach(k => console.log('  ' + k));
  console.log('\n--- only in main (must survive the merge) ---');
  onlyMain.forEach(k => console.log('  ' + k));
}
