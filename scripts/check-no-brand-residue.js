#!/usr/bin/env node
/**
 * check-no-brand-residue.js — 品牌残留门禁（字节级，增量安全）
 *
 * 目的：防止参考产品品牌词再次进入仓库（见 01-docs/PRD-NAMING-NORMALIZATION-2026-09-15.md §8）。
 *
 * 扫描口径：
 * - 仅 git tracked 文件；跳过锁文件与二进制扩展名（压缩数据中的字节巧合命中不可改写也不构成痕迹）。
 * - 字节级（latin1 保真）扫描，兼容含 NUL 字节的"文本"文件与非 UTF-8 编码。
 * - 品牌词本身**不以字面量出现在本脚本中**（按码点构造），避免门禁脚本自证违规。
 * - 唯一豁免：第三方远程签名服务域名（packages/api-publish-engine/src/signer.js 的默认端点，
 *   发布链路硬依赖；可用环境变量 MP_SIGNER_BASE 覆盖）。
 *
 * CI：quality-gate.yml static-gates「Gate 12 - Brand residue (naming normalization)」。
 * 用法：node scripts/check-no-brand-residue.js [--root <repo-root>]
 * 退出码：0 = 通过；1 = 存在残留。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { root: process.cwd() };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opts.root = path.resolve(args[++i]);
    else {
      console.error(`unknown option: ${args[i]}`);
      process.exit(2);
    }
  }
  return opts;
}

const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json']);
const BINARY_EXT = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.flac',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.asar', '.exe', '.dll', '.node',
  '.wasm', '.bin', '.dat', '.db', '.sqlite', '.woff', '.woff2', '.ttf', '.eot',
]);

// ── 品牌词按码点构造（不写字面量）─────────────────────────────
// 全拼小写（8 字母）与其中文名称（3 个汉字），及其大小写 / 三字母缩写变体
const BRAND_FULL = String.fromCharCode(0x79, 0x69, 0x78, 0x69, 0x61, 0x6f, 0x65, 0x72);
const BRAND_ZH = String.fromCharCode(0x8681, 0x5c0f, 0x4e8c);
const BRAND_ABBR = BRAND_FULL[0] + BRAND_FULL[2] + BRAND_FULL[6];

const BRAND_VARIANTS = [
  BRAND_ZH,
  BRAND_FULL,
  BRAND_FULL[0].toUpperCase() + BRAND_FULL.slice(1),
  BRAND_FULL.toUpperCase(),
  BRAND_ABBR,
  BRAND_ABBR[0].toUpperCase() + BRAND_ABBR.slice(1),
  BRAND_ABBR.toUpperCase(),
];

// 字符串 → latin1 字节串（1 字节 = 1 字符，可逆）
const toL = (s) => Buffer.from(s, 'utf8').toString('latin1');

const BRAND_RESIDUAL = new RegExp(
  BRAND_VARIANTS.map((v) => '(?<![A-Za-z])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);

// 豁免：第三方远程签名服务域名（功能性依赖），扫描前替换成占位符
const SIGNER_HOST = toL('qianming.' + BRAND_FULL + '.cn');
const SIGNER_PLACEHOLDER = toL('qianming.__SIGNER_HOST__');

function main() {
  const { root } = parseArgs();
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 1 << 28 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);

  const hits = [];
  for (const rel of files) {
    if (SKIP_FILES.has(path.basename(rel))) continue;
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(root, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    const latin = fs.readFileSync(abs).toString('latin1').split(SIGNER_HOST).join(SIGNER_PLACEHOLDER);
    BRAND_RESIDUAL.lastIndex = 0;
    let m;
    while ((m = BRAND_RESIDUAL.exec(latin)) !== null) {
      const ctx = latin
        .slice(Math.max(0, m.index - 50), m.index + 55)
        // 上下文仅保留可打印 ASCII 与常用汉字，便于定位（品牌词以外的噪声以 . 代替）
        .replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '.');
      hits.push(`${rel}  @byte ${m.index}  …${ctx}…`);
      if (hits.length >= 100) break;
    }
    if (hits.length >= 100) break;
  }

  if (hits.length > 0) {
    console.error('[no-brand-residue] FAIL：发现 ' + hits.length + ' 处品牌残留');
    console.error('[no-brand-residue] 品牌词口径：参考产品中文名 / 全拼小写与大小写变体 / 三字母缩写变体（共 ' + BRAND_VARIANTS.length + ' 种字面形式，本门禁不复现其字面）');
    hits.forEach((h) => console.error('  ' + h));
    if (hits.length >= 100) console.error('  …（已截断，仅显示前 100 处）');
    console.error('[no-brand-residue] 唯一例外：第三方远程签名服务域名（signer.js 默认端点）。');
    process.exit(1);
  }
  console.log('[no-brand-residue] PASS（扫描 ' + files.length + ' 个 tracked 文件，无品牌残留；已豁免第三方签名服务域名）');
}

main();
