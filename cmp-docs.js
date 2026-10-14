const { execSync } = require('child_process');

function sectionsOf(ref, file) {
  const raw = execSync(`git show ${ref}:${file}`, { maxBuffer: 1e8, encoding: 'utf8' });
  return raw.split(/\r?\n/).filter(l => /^# \[/.test(l));
}

const file = process.argv[2];
const mine = sectionsOf('HEAD', file);
const main = sectionsOf('origin/main', file);
console.log(`mine entries: ${mine.length}`);
console.log(`main entries: ${main.length}`);
const onlyMine = mine.filter(s => !main.includes(s));
const onlyMain = main.filter(s => !mine.includes(s));
console.log('\n--- only in mine ---');
onlyMine.forEach(s => console.log('  ' + s.trim()));
console.log('\n--- only in main ---');
onlyMain.forEach(s => console.log('  ' + s.trim()));
