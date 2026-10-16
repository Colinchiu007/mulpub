#!/usr/bin/env node
// 重算旧载体冻结基线 `scripts/gate-carrier-freeze.json`。
// 只在**有意**变更存档面时人工跑一次（属"改谁来守门"，不走自动合并）；日常 PR 不该碰它。
// 用法：node scripts/freeze-gate-carrier.js [--print-only]
'use strict';
const fs = require('fs');
const path = require('path');
const { HEADING_RE, headingTitle, carrierSignature, GATE_FILE, CARRIER_FREEZE_FILE } = require('./check-gate-record-debt.js');

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, GATE_FILE), 'utf8').split('\n');
const titles = lines.filter((l) => HEADING_RE.test(l)).map((l) => headingTitle(l));
const sig = carrierSignature(titles);
const payload = {
  _policy: '旧载体 .quality-gates.md 的冻结基线。新 PR 的执行记录一律写 openspec/records/<分支名>.md；'
    + '本文件只允许就地关闭已有记录块里的状态行，不许加块、不许删块。'
    + '有意变更存档面时人工跑 `node scripts/freeze-gate-carrier.js` 重算，属"改谁来守门"、不走自动合并。',
  frozenAt: new Date().toISOString().slice(0, 10),
  headingCount: sig.count,
  headingSha256: sig.sha256,
  headings: sig.titles,
};
if (process.argv.includes('--print-only')) {
  console.log(JSON.stringify({ headingCount: payload.headingCount, headingSha256: payload.headingSha256 }));
  process.exit(0);
}
fs.writeFileSync(CARRIER_FREEZE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`已写入 ${path.relative(root, CARRIER_FREEZE_FILE)}：条数=${sig.count} sha=${sig.sha256.slice(0, 12)}…`);
