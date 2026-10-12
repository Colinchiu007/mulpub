#!/usr/bin/env node
/**
 * 变异反证（wxmp-draft-mediaid-fix）：把锁改成 no-op / 摘掉修复，对应用例必须变红。
 * 用法：
 *   node scripts/mut-check-wxmp-mediaid.cjs list
 *   node scripts/mut-check-wxmp-mediaid.cjs <mutation-id>        # 施加变异
 *   node scripts/mut-check-wxmp-mediaid.cjs <mutation-id> --revert  # 从 .bak 恢复
 *
 * 设计约束：恢复一律走 .bak 整体还原，**不用正则反向替换**（2026-10-12 实测：
 * 正则摘除会把相邻代码的收尾括号留下，造出语法错误文件）。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const TARGET = path.join(ROOT, 'apps/desktop/electron/services/wechat-mp-draft-mediaid.js')
const BACKUP = TARGET + '.bak'

/** 每个变异用「锚点串 → 替换串」，锚点必须唯一（不匹配即报错退出，不允许静默 no-op） */
const MUTATIONS = {
  'drop-body-channel': {
    desc: '摘掉响应体采集通道（真根因修复本身）',
    expect: 'wechat-mp-draft-mediaid.test.js 中 2 条响应体用例变红',
    apply: (s) => s.replace(
      "  // 通道 ③：XHR 响应体（新版后台 URL 不跳转时的唯一通道）\n  if (!mediaId && saveResp) {\n    mediaId = extractAppMsgIdFromBody(saveResp.body)\n    if (mediaId) {\n      log.info('RpaView', '[wechat_mp] mediaId from save response body appMsgId=' + mediaId\n        + ' (url 未跳转，走响应体通道)')\n    }\n  }\n",
      ''),
  },
  'accept-zero-appmsgid': {
    desc: '响应体通道不拒 appMsgId=0/空串',
    expect: '「appMsgId=0 视为未创建」用例变红',
    apply: (s) => s.replace(
      "if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '0') {",
      'if (v !== undefined && v !== null) {'),
  },
  'drop-visibility-guard': {
    desc: 'toast 脚本去掉可见性守卫（退回 innerText 语义）',
    expect: '可见性守卫断言用例变红',
    apply: (s) => s.replace(
      "    'var visible=false;' +\n    'try{visible=!!el.offsetParent||el.getClientRects().length>0}catch(e){visible=false}' +\n    'if(!visible)continue;' +\n",
      ''),
  },
  'drop-actionable-hint': {
    desc: '失败文案去掉「可操作下一步」',
    expect: '可操作文案 2 条用例变红',
    apply: (s) => s.split('，请稍后重试；若反复失败请到公众号后台草稿箱核对').join(''),
  },
}

const id = process.argv[2]
const revert = process.argv.includes('--revert')

if (id === 'list' || !id) {
  console.log('可用变异：')
  for (const [k, v] of Object.entries(MUTATIONS)) console.log('  ' + k + ' — ' + v.desc + '（预期：' + v.expect + '）')
  process.exit(0)
}

if (!MUTATIONS[id]) { console.error('未知变异: ' + id); process.exit(2) }

if (revert) {
  if (!fs.existsSync(BACKUP)) { console.error('无 .bak 可恢复'); process.exit(3) }
  fs.copyFileSync(BACKUP, TARGET)
  fs.unlinkSync(BACKUP)
  console.log('REVERTED: ' + id)
  process.exit(0)
}

const original = fs.readFileSync(TARGET, 'utf8')
const mutated = MUTATIONS[id].apply(original)
if (mutated === original) { console.error('MUTATION-NOOP: ' + id + ' 未改变任何内容——变异无效'); process.exit(4) }
if (!fs.existsSync(BACKUP)) fs.writeFileSync(BACKUP, original)
fs.writeFileSync(TARGET, mutated)
console.log('MUTATED: ' + id + ' — ' + MUTATIONS[id].desc)
