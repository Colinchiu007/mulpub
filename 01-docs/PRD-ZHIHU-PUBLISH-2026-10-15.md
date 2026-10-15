# PRD — 知乎图文 RPA 发布终态合同（zhihu-publish-confirmation）

| 项目 | 内容 |
|------|------|
| 版本 | v1.0（2026-10-15） |
| 分支 | `fix-article-paragraph-zhihu-publish`（隔离 worktree `D:/Data/projects/mp-worktrees/mp-fix-article-paragraph-zhihu-publish`，基线 `origin/main` = `58256ffc8`） |
| change | `openspec/changes/fix-article-paragraph-zhihu-publish` |
| 执行记录 | `openspec/records/fix-article-paragraph-zhihu-publish.md` |
| 事故文档 | `01-docs/BUGFIX-ARTICLE-PARAGRAPH-AND-ZHIHU-PUBLISH-2026-10-15.md` §3 |
| 变更类型 | 🐛 Bug 修复（用户报障：**知乎显示发布成功，但并没有真实发布**） |
| 现状 | 代码 + 单测已落地；**真机复核待执行**（判据见 §8，未复核前不得声称端到端已通） |

---

## 1. 背景与报障

用户原文：

> 发布图文，知乎显示发布成功。但并没有真实发布。查一下原因并修复。

真机日志（2026-10-15 20:40 那批发布，`shared-user-data/logs/app-2026-10-15.log`）：

```
12:40:00.653Z PublisherRouter route-selected {platform: zhihu, mode: rpa_vm}
12:40:19.6xxZ RpaView [click] button:has-text('发布'), .PublishPanel-publish → BUTTON|…|发布
12:40:22.662Z RpaView [zhihu] published!
12:40:22.664Z RpaView publish done platform=zhihu url=https://zhuanlan.zhihu.com/p/2094165753981309631/edit
12:40:22.746Z PublishProgress phase-success {platform: zhihu, stageKey: done}
```

应用内显示成功；`tracked_content` 的知乎记录 `post_id=''`、`url=…/p/2094165753981309631/edit`（**草稿编辑页**）⇒ 平台上只有草稿，没有公开文章。

---

## 2. 根因（第一性）

| # | 缺陷 | 说明 |
|---|------|------|
| R1 | **成功判据过宽** | `_publish_zhihu` 用 `/\/p\/\d+/`（以及 `includes('success'/'publish'/'article')`）判成功，而**草稿编辑页** `https://zhuanlan.zhihu.com/p/<id>/edit` 同样命中 ⇒ 只落草稿也报成功 |
| R2 | **只点一次「发布」** | 知乎发布是**两段式**：首次点「发布」只是「落成草稿并跳到该编辑页」；需在**该编辑页再点一次「发布」**才真正发布并跳公开文章页 `/p/<id>` |
| R3 | **第二个假成功出口** | `panelGone` 兜底（发布按钮消失/隐藏即判成功）同样可能被「发布设置面板弹出遮住按钮」触发 |

**引入与逃逸**：`R1` 家族最早见于知乎 RPA 发布器首次落地（`1948a2a49`，`P1-M4 知乎 RPA 发布器`），2026-09-29 的修复（`d424c245c`，#2647）把 `/p/<id>` 当成「文章页」正式写入判据，并留下一条**用草稿编辑页 URL 断言成功**的回归测试 ⇒ 缺陷被锁成契约（详见 BUGFIX 文档 §3.3 逃逸链）。

---

## 3. 功能逻辑（修复后）

### 3.1 发布状态机（新增 `apps/desktop/electron/services/zhihu-publish-state.js`）

```
点「发布」（写作页）
      │
      ├─ 轮询读 URL（默认 6000ms / 500ms 一探，遇公开文章页提前结束）
      │
      ├─ 已是公开文章页 /p/<id>                → published:true（reason=published）
      │
      ├─ 停在草稿编辑页 /p/<id>/edit           → 等该页「发布」按钮就绪（默认 8000ms）
      │      ├─ 未就绪                         → published:false（draft-editor-publish-button-missing）
      │      └─ 就绪 → **补点一次** → 再轮询（默认 12000ms）
      │             ├─ 跳到公开文章页 /p/<id>  → published:true（reason=published-after-second-click）
      │             └─ 仍在草稿编辑页          → published:false（draft-editor-still-not-published）
      │
      └─ 其它页面（仍在写作页/风控页/未知页）  → published:false（unexpected-page，**不补点**）
```

**两条设计约束（不可破）**：

1. **只有公开文章页算成功**：`isZhihuPublishedUrl(url)` 严格匹配 `https?://<zhuanlan|www>.zhihu.com/p/<数字>`（允许查询串/锚点，**不允许任何尾段**）。`/edit`、`/draft`、`/manage`、`/write`、非知乎域名、非 http(s) 协议一律为假。
2. **补点必须「有据」**：仅在**确证当前停在草稿编辑页**时才补点第二次（`isZhihuDraftEditorUrl`）。停在写作页时不补点 —— 避免重复点击造出两份草稿。

### 3.2 返回值契约

| 情形 | 返回值 |
|------|--------|
| 真发布 | `{ success: true, url: 'https://zhuanlan.zhihu.com/p/<id>', platform: 'zhihu', postId: '<id>' }` |
| 未确认 | `{ success: false, error: 'zhihu: publish not confirmed (<reason>) url=<url>', platform: 'zhihu', url: '<当前 URL>' }` |
| 用户选存草稿 | `{ success: true, platform: 'zhihu', draft: true, url: '<当前 URL>' }`（分支语义不变，见 §9 遗留） |
| 异常（点击/等待抛错） | 由既有 `try/catch` 兜底：`{ success: false, error: <message>, platform: 'zhihu' }` |

`reason` 取值（机器可读，供上层/日志分类）：`published`、`published-after-second-click`、`unexpected-page`、`draft-editor-publish-button-missing`、`draft-editor-still-not-published`。

### 3.3 发布记录字段

| 字段 | 修复前 | 修复后 |
|------|--------|--------|
| `url` | `https://zhuanlan.zhihu.com/p/<id>/edit`（草稿页，误导） | `https://zhuanlan.zhihu.com/p/<id>`（公开页） |
| `post_id` | `''`（空） | `<id>`（由新增的 `postId` 派生） |
| 状态 | 显示「已发布」（假） | 真发布才显示已发布；未确认显示失败与原因 |

---

## 4. 数据校验

| 校验点 | 规则 | 反例（必须为假/不触发） |
|--------|------|------------------------|
| 主机 | 仅 `zhuanlan.zhihu.com` / `www.zhihu.com`（大小写不敏感） | `zhuanlan.zhihu.com.evil.example.com`、`evil.example.com/p/1` |
| 协议 | 仅 `http:` / `https:`（`parseZhihuUrl` 解析失败返回 `null`） | `javascript:alert(1)`、`file:///D:/x.html`、`not a url` |
| 公开文章路径 | `^/p/(\d+)/?$` | `/p/<id>/edit`、`/p/<id>/edit/`、`/p/<id>/draft`、`/p/<id>/manage`、`/write`、`/people/x`、`/` |
| 查询串/锚点 | 允许（不参与判据） | — |
| 空/非法输入 | `null`/`undefined`/非字符串/空串 ⇒ 全部为假，**不抛** | — |
| 读 URL 抛错 | 状态机内收敛为空串（`try/catch`），按「未确认」处理 | 不得让异常冒泡成「发布成功」 |
| 补点资格 | 必须先确证草稿编辑页，且「发布」按钮可等；否则不点击 | 写作页 / 未知页一律不补点 |
| 补点次数 | ≤1 次（总计 ≤2 次「发布」点击） | 不允许循环点击 |
| 时限 | 可注入（`settleMs`/`waitButtonMs`/`secondSettleMs`/`pollMs`），默认 6000/8000/12000/500ms | 测试传 0 必须仍走完判定（零真实等待） |

---

## 5. 流程（端到端）

```
[发布页] 选「知乎」+ 账号 + 标题/正文（正文承载形态见 PRD-ARTICLE-BODY-FORMAT §15）
   ↓ IPC publish:batch / publish:start
[PublisherRouter] route → { platform:'zhihu', mode:'rpa_vm' }   ← 知乎无 API 轨，必走浏览器
[RpaViewSession] 登录态：从 auth 分区恢复 cookie（不足时按账号补充）→ 打开 https://zhuanlan.zhihu.com/write
   ↓ 标题：wrapper 内 textarea 原生 setter + input/change
   ↓ 正文：CDP 可信 insertText（失败回退 innerHTML 注入）
   ↓ 点「发布」
   ↓ ★ confirmZhihuPublished()（本次修复）
   ↓
[成功] 进度 100%「published!」→ 发布记录 postId/url 为公开页 → 可在应用内回查
[失败] 进度按失败处理 + 原因文案（§7）→ 不写「已发布」记录
```

---

## 6. 交互逻辑与显示项

| 场景 | 进度面板 | 发布记录 | 平台侧 | 用户下一步 |
|------|---------|---------|--------|-----------|
| 真发布成功 | 阶段 `publishing...` 80% → `verifying...` 95% → `published!` 100% | `url=/p/<id>`、`post_id=<id>` | 文章公开可见 | 无 |
| 只落草稿（本次事故） | **失败**（不再 100% 成功） | 不写入发布记录 | 草稿箱有稿 | 按原因文案手动处理/重试 |
| 停在写作页（风控/校验） | 失败，原因 `unexpected-page` | 不写入 | 未发布 | 检查账号风控 |
| 草稿页按钮缺失 | 失败，原因 `draft-editor-publish-button-missing` | 不写入 | 草稿已建 | 手动发布 |
| 补点后仍未跳转 | 失败，原因 `draft-editor-still-not-published` | 不写入 | 草稿已建 | 手动确认后重试 |
| 用户选「存草稿」 | 成功（草稿语义，与修复前一致） | 记录草稿态 | 草稿箱有稿 | 后续手动发布 |

**无新增用户可见文案**：失败详情沿用既有 RPA 失败透传通道（`RpaVmPublisher` 抛 `result.error`），故不涉及 `locales/zh.js` / `en.js` 成对修改。

---

## 7. 提示文字（逐字）

失败（`error` 字段，随发布失败详情展示）：

1. `zhihu: publish not confirmed (unexpected-page) url=https://zhuanlan.zhihu.com/write`
2. `zhihu: publish not confirmed (draft-editor-publish-button-missing) url=https://zhuanlan.zhihu.com/p/<id>/edit`
3. `zhihu: publish not confirmed (draft-editor-still-not-published) url=https://zhuanlan.zhihu.com/p/<id>/edit`

日志：

- `[WARN] RpaView [zhihu] publish not confirmed reason=<reason> url=<url>`（状态机内与调用点各一次）
- 成功保持既有 `RpaView [zhihu] published!` 与 `RpaView publish done platform=zhihu url=<公开页>`

已移除：`zhihu: publish verification failed`（随 `panelGone` 兜底一并删除，不再存在第二个成功出口）。

---

## 8. 验收标准

### 8.1 自动化（已达成）

| 文件 | 用例 | 锁什么 |
|------|------|--------|
| `apps/desktop/electron/services/zhihu-publish-state.test.js` | 39 | 判据穷举（含 `/edit` 反例、域名/协议伪装、空值）+ 状态机 7 例（首点即公开页 / 补点成功 / **补点后仍在草稿页 ⇒ false** / 写作页不补点 / 按钮缺失 / 点击抛错冒泡 / 时限可注入） |
| `apps/desktop/electron/services/rpa-view-platforms-zhihu-publish.test.js` | 5 | 公开页判成功带 `postId`；两段式补点（2 次点击、2 次等元素）；补点后仍在草稿页 ⇒ 失败；写作页 ⇒ 失败且只点 1 次；**结构锁**（必须经 `confirmZhihuPublished`，源码不得再有 `curUrl.includes('publish'/'success'/'article')` 或 `panelGone`） |
| `apps/desktop/electron/services/rpa-view-platforms.test.js` | 既有全量（+1 反例） | 原「草稿编辑页 ⇒ success」断言已改写为「草稿编辑页 ⇒ `success:false` 且 error 含 `not confirmed`」 |

### 8.2 真机复核（**待执行**，判据取产物）

1. 用含本次修复的构建发布一篇知乎图文（标题可标注测试用途）。
2. 读发布记录（`tracked_content`）：`url` 必须形如 `https://zhuanlan.zhihu.com/p/<id>`（**不含 `/edit`**），`post_id` 非空。
3. 打开该 URL 应看到已发布的公开文章（而非编辑器）。
4. 若判据 2/3 不成立，如实记录为未通过（不得以「不再谎报成功」替代「能真正发布」的验收）。
5. 取证数字写回 `openspec/records/fix-article-paragraph-zhihu-publish.md`。

---

## 9. 遗留与后续（不假装已闭合）

1. **真机两段式有效性待证**：本次修复保证「不再谎报成功」，但「补点第二次一定能把稿子发出去」仍需真机证实（§8.2）。
2. **`draft: true` 仍返回成功**：用户主动选「存草稿」时语义是「草稿已存」，但 `RpaVmPublisher` 不区分 `draft`，UI 仍显示发布成功 —— 与本次报障不是同一件事（本次是未选草稿却只落了草稿），登记为遗留；若后续要区分，应在升级结果契约里显式透传 `draft`。
3. **失败重试的重复发帖风险**：新判据把「未确认」判为失败，若队列自动重试，理论上存在「其实已发布 + 重试再发一篇」的风险。缓解点：`unexpected-page` 属未补点情形（大概率确未发布）；`draft-editor-still-not-published` 属补点后仍未跳转，需人工确认后再重试。本次未改重试策略。
4. **同族平台判据未审计**：`rpa-view-platforms.js` 其它平台的成功判据形态各异（头条用作品列表 API、公众号有专用判定测试），是否存在「子串命中即成功」的同族缺陷**本次未逐个取证**，登记为下一轮审计项。
5. **知乎「发布」按钮文案/选择器耦合**：判据依赖 `button:has-text('发布'), .PublishPanel-publish`；平台改版会失效（失效形态是「按钮找不到 ⇒ 如实失败」，不会假成功）。

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-10-15 | 首版：两段式发布状态机、严格终态判据、返回值与记录字段契约、数据校验矩阵、流程/交互/显示项、逐字提示文字、自动化与真机验收判据、遗留清单 |
