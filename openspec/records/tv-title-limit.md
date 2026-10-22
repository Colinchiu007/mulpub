---
record: tv-title-limit
task: 视频号短标题按 16 字上限裁剪并把完整标题并入正文
date: 2026-10-22
---

## 本次执行记录：视频号标题上限（tv-title-limit，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-title-limit` |
| 第一性原因（QM-5 ①） | ✅ | 真机截图显示短标题下方红字「标题超过16字限制」，而日志 `short title filled, readback=18` —— 标题 18 字 > 平台 16 字上限；此前所有验证都用短标题，因此该缺陷从未暴露 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「标题超平台上限」用例；集成层 `fillTencentVideo` 直接写入原文；E2E 层把发布后页面重置误读为「已提交」，未看红字校验；审查层未对照平台字数限制 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `tencent-video-frame.js` 新增 `SHORT_TITLE_MAX=16`：短标题截断到 16 字，**完整标题并入正文首行**；新增 `tests/tencent-video-frame.test.js` 3 例（提示串/命中子 frame/无子 frame 返回 null） |
| 防止再次发生（QM-5 ⑤） | ✅ | 字数上限写成具名常量并注明真机出处，后续接其它平台可复用同一模式 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 新测试由 `apps/desktop/tests/run-tests.js` 聚合执行 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机未复跑；判据：页面不再出现「标题超过16字限制」，且发布后作品列表出现该视频。
- 封面仍报 `No file input found`（需在触发封面弹窗后再找 input），单独排期。
