# 本次执行记录：E2E 脚本错误路径硬化（e2e-script-hardening，2026-10-21）【混合 PR】

- 分支：`e2e-script-hardening`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`，非 C 盘）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 packages/ 运行时脚本）
- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 一、动因（来自上一轮 CCG 裁决）

PR #4157 的 CCG 自查 i3 明确指出两个欠缺：
1. 轮询 60 轮 × 30s = 30 分钟，**若进程中断会空转到满**才报"未取到终态"；
2. CDP 连不上时报 Playwright 原始错误，**读者可能误以为是脚本 bug**。

本轮把这两条修掉（#4157 尚未合并，故在其分支基础上改，避免合并冲突）。

## 二、改动（两处，均有实跑验证）

### ① CDP 连接失败自解释

```js
try { browser = await chromium.connectOverCDP(...) }
catch (e) {
  console.error('无法连接应用 CDP（127.0.0.1:9279）: ...')
  console.error('最常见原因：**应用未启动**（electron 进程不存在）。请先启动应用再跑本脚本。')
  console.error('若应用已启动，请用 DY_CDP_PORT=<端口> 指定实际 CDP 端口。')
  process.exit(1)
}
```

**实跑读数**（应用未启动）：
```
视频: D:\Temp\dy-small.mp4 (250 KB)
无法连接应用 CDP（127.0.0.1:9279）: browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9279
最常见原因：**应用未启动**（electron 进程不存在）。请先启动应用再跑本脚本。
若应用已启动，请用 DY_CDP_PORT=<端口> 指定实际 CDP 端口。
rc=1
```

### ② 轮询中检测 CDP 断开（提前退出，不空转）

```js
if (/^ERR /.test(st) && /closed|Target page|ECONNREFUSED|connect/i.test(st)) {
  console.log('=== 应用已退出或 CDP 断开 ===')
  console.log('任务 ' + TARGET + ' **无终态**（进程中断不会入历史，见 PRD §16.20.1）')
  break
}
```

⇒ 把 §16.20.1 那条实测结论（进程中断 ⇒ 任务无终态）写进脚本输出，用户不会再误判成"发布失败"。

## 三、踩坑记录（CRLF）

第二处补丁两次未匹配，根因是**文件用 CRLF 行尾**而我的匹配串用 `\n`。
修法：先探测 `s.includes('\r\n')` 再选 NL。已记忆（本轮第二次被 CRLF 咬）。

## 四、读数

| 项 | 读数 |
| --- | --- |
| 语法 `node --check` | rc=0 |
| 实跑（应用未启动） | 见上，错误自解释 + exit 1 |
| max-lines / unwired / abs-paths / 品牌 / 编码 | ✅ / OK / PASS / PASS / OK |
| classify-docs-only | false（含 packages/ 脚本 ⇒ 混合 PR） |

## 五、未闭合
- 轮询中断检测**未实跑验证**（需要"跑到一半应用退出"的场景，当前应用本来就没起）。
  逻辑是字符串匹配 + break，风险低，但属未验证项，如实记。
- 脚本整体仍未跑通一次完整发布（等应用启动）。

## 六、远程同步

| 远程同步 | 由门禁推导 |
