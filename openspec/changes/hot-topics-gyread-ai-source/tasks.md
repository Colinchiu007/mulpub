# 任务清单：hot-topics-gyread-ai-source

> 勾选判据一律取**产物**（文件 / 命令输出 / 测试结果），不取「做过了」的叙述。

## 1. 调研

- [x] 1.1 站点结构与内容形态（首页/日报/周报/专题/幕后）→ `01-docs/research/hot-topics-sources-gyread.md`
- [x] 1.2 数据面盘点：sitemap.xml（319 URL）/ search-index.json（1421 条，字段 u/d/c/t/s/g）/ HTML
- [x] 1.3 合规边界取证：robots.txt 分类 UA + `x-robots-tag: noai, noimageai` + `Content-Signal`
- [x] 1.4 抓取健壮性实测：无 UA/Referer 200；未发布日期 404；不存在日期 404（404 即「无当日数据」）
- [x] 1.5 源链接回验 26 条：19 成功 / 7 失效（含 1 处出处张冠李戴）
- [x] 1.6 版式演进取证：10-16 及以前 `dateline`；10-17 起 `item-meta` + 多链接 `src-line`

## 2. TDD：先写测试（RED）

- [ ] 2.1 `parseGyreadIndex`：字段映射 / 日期过滤 / 空结构 / 栏目名透传
- [ ] 2.2 `parseGyreadEdition`：旧版 `dateline` + 单链接 `src-line`
- [ ] 2.3 `parseGyreadEdition`：新版 `item-meta` + 多链接 `src-line`（返回数组）
- [ ] 2.4 `parseGyreadEdition`：两版混存 / 无出处 / 空 HTML → fail-open 不抛错
- [ ] 2.5 `CATEGORY_BOOSTS.ai` 含 gyread 源（id/board/boostCategory/onlyCategory/intervalMinutes/throttleKey）
- [ ] 2.6 `CHANNEL_CONFIGS` 仍为 10 项（gyread 不进主渠道）
- [ ] 2.7 `CHANNEL_WEIGHTS.gyread === 0.7`
- [ ] 2.8 `_collectBoostChannel` + `enrichWithEdition`：成功补原文链接；失败只丢链接不丢条目
- [ ] 2.9 分类器新增正例（6 条 AI 术语）+ 既有回归不破
- [ ] 2.10 locales zh/en 键齐全（既有回归锁自动覆盖新 id）

## 3. 实现（GREEN）

- [ ] 3.1 `channels.js`：`parseGyreadIndex`
- [ ] 3.2 `channels.js`：`parseGyreadEdition`（双版式兼容 + 多出处数组）
- [ ] 3.3 `channels.js`：注册表 + module.exports
- [ ] 3.4 `hot-topics-service.js`：`CATEGORY_BOOSTS.ai` 增 gyread 源
- [ ] 3.5 `hot-topics-service.js`：`_collectBoostChannel` 支持 `enrichWithEdition`
- [ ] 3.6 `classifier.js`：AI 词表扩充（strong/weak）
- [ ] 3.7 `scorer.js`：`CHANNEL_WEIGHTS.gyread`
- [ ] 3.8 locales：`hot-topics/{zh,en}.js` 的 `channels.gyread` / `channels['gyread-ai']`

## 4. 文档

- [ ] 4.1 研究报告 `01-docs/research/hot-topics-sources-gyread.md`
- [ ] 4.2 openspec change 五件套（proposal / design / tasks / spec delta / .openspec.yaml）
- [ ] 4.3 `CHANGELOG.md` 顶部条目（显式 CRLF 只拼头部，整文件零裸 LF）
- [ ] 4.4 执行记录 `openspec/records/gyread-ai-source.md`

## 5. 质量节拍与验证

- [ ] 5.1 定向测试全绿（新增 + 既有 hot-topics 相关文件）
- [ ] 5.2 eslint（改动文件 exit 0）
- [ ] 5.3 `node .github/scripts/check-locale-sync.js`（pair-base / keys / cjk 三项）
- [ ] 5.4 `node scripts/check-no-brand-residue.js`
- [ ] 5.5 全量测试（`pnpm test` 或等价入口）
- [ ] 5.6 QM-1 打包验证（若改动触及 `apps/desktop/electron/` —— 本次触及，必跑）

## 6. 记忆沉淀

- [ ] 6.1 外部记忆：`01-docs/learnings.md` 新章节
- [ ] 6.2 内置记忆：DSH 会话档（harness 自动落盘，不伪造文件）

## 7. 交付

- [ ] 7.1 提交 + 推送远端分支
- [ ] 7.2 创建 PR（正文含改动清单 / 验证证据 / 未完成项）
- [ ] 7.3 CI 全绿后 squash 自动合并 + 删除远端分支
- [ ] 7.4 worktree 按 R1-R5 清理（`scripts/safe-worktree-remove.ps1 -WhatIf` 干跑通过后再实跑）
