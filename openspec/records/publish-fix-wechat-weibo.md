---
record: publish-fix-wechat-weibo
task: 修复微信公众号、微博的发布失败（B 站图文无通道，不在本片）
date: 2026-10-21
---

# 公众号与微博发布失败（publish-fix-wechat-weibo，2026-10-21）

> 分支 `publish-fix-wechat-weibo`（worktree `D:/全局项目库/mp-worktrees/mp-publish-fix-wx-wb`），起点 `7f3ebb6` = 当时 origin/main。

## 现场

2026-10-21 14:28 那次多平台批量发布，`app-2026-10-21.log` 记录：

```
[ERROR] Executor Publish failed for wechat_mp: 微信公众号草稿保存未被平台确认（点击保存后 30 秒内既未跳转、也未出现「保存完成」提示）
[ERROR] Executor Publish failed for weibo: weibo no publish_url
[ERROR] Executor Publish failed for bilibili: bilibili 仅支持视频发布（api 轨只有视频链），当前任务为图文/无 video_path
```

三件事性质不同：

| 平台 | 根因 | 本片处置 |
| --- | --- | --- |
| 微博 | `config/platforms.yaml` 的 weibo 段**整段没有 `publish_url`**；选择器是旧版 DOM（微博已改版 React + woo 设计系统，旧判据全部 0 命中） | **已修** |
| 微信 | 保存草稿走的是「行为层失败 → 合成 click」；微信后台忽略不可信事件（`probe appReq:0` / `xhr=none`） | **只修了一半**：可信点击已生效，但按钮定位仍不准（详见「未闭合」） |
| B 站 | 图文没有发布通道（api 轨只有视频链，RPA 分支是视频投稿页） | 不在本片（能力边界，需专栏通道，属新功能） |

## 微博：真机取证 → 选择器重写

取证方式：用应用自己的 RPA 会话（`account-f2667801`，已登录）触发一次发布，在它填表阶段从 CDP 读页面结构。因为旧 `content_textarea` 判据必然落空，流程走不到「点发送」，不会误发。

实测结构（`D:/tmp/weibo-dom-probe.json`）：

```
发布框  <textarea class="_input_1rz8r_8" placeholder="有什么新鲜事想分享给大家？">   ← 可见
发送    <button class="woo-button-main ... woo-button-primary ...">发送</button>      ← 可见
旧判据  .publisher_text textarea / .W_input / textarea[node-type="textEl"] /
        a[node-type="submit"] / .W_btn_b  → 全部 0 命中
```

落点：

- `config/platforms.yaml`：weibo 补 `publish_url: https://weibo.com/`（微博没有独立写文章入口，登录态下发布框就在首页）
- `packages/rpa-engine/src/platform-selectors.js`：`content_textarea` 首选 `textarea[placeholder*="有什么新鲜事"]`，`publish_btn` 首选 `button:has-text("发送")` / `.woo-button-primary`，旧判据保留在后做兼容
- 新锁 `packages/rpa-engine/tests/weibo-selectors-live-dom.test.js`（5 例）：新版判据必须在候选链最前（`_resolveSelector` 按顺序试，旧判据在前就是每次白等超时）、旧判据不得删除、**不得把 CSS Modules 哈希类名（`_input_1rz8r_8`）写进选择器**、图文任务不被视频选择器覆盖

## 微信：可信点击兜底（已生效），按钮定位未闭合

`_clickViaDriver` 的回退链原本是「行为层 → `el.click()`」，缺「CDP 可信点击」这一档。现改为「行为层 → `_clickViaCdp` → 合成 click」：

- 可信点击成功后只读一次描述串，**不再补点**（会重复提交）
- 宿主无 `_clickViaCdp`、它抛错或未命中，才落回合成 click 并 warn 出声（此前 `_click` 恒返回 true，假绿）
- 顺带修 `_clickViaCdp` 两个遗留缺陷：debugger attach **归属判断**（此前无条件 detach，会拆掉他方会话）、点击后**还原**被临时置 `pointer-events:none` 的遮挡层（`__mpPe` 只写不读）

真机验证（16:16，worktree 代码 + dev server，实跑一次公众号存草稿）：

```
[click] 行为层失败，先试 CDP 可信点击 sel=a#js_sync_save, ...
[clickTrusted] a#js_sync_save, a[data-actio -> TRUSTED@630,369
[click] CDP 可信点击生效 ... -> DIV|mp-body |Touchannel
[click] ... probe={"ocLog":[],"appReq":[],"appReqN":0}
save done without mediaId (saved=false ... xhr=none)
```

**可信点击确实生效了**（`TRUSTED@630,369`），但落点探针返回 `DIV|mp-body` —— 命中的是内容容器而不是「保存为草稿」按钮。`a#js_sync_save` 存在但不可见（`getBoundingClientRect` 退化到页面中心），`:has-text("保存")` 的兜底又在没有匹配到 a/button 时选到了包含该文本的大容器。

## 执行记录

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时（electron 主进程 + packages/rpa-engine + config）；隔离 worktree `mp-publish-fix-wx-wb` + 裸分支，起点 `7f3ebb6` |
| 第一性原因 | PASS | 微博：缺 publish_url + 旧版选择器全落空（真机 0 命中）；微信：回退链缺可信点击档（实机 `appReq:0`） |
| 逃逸分析 | PASS | 既有测试只覆盖「行为层失败 → isolated 合成 click」这一条，从未断言点击**是否被页面接受**；微博选择器无任何真机判据，改版后全仓测试仍全绿 |
| 修复 + 回归保护 | PASS | 新增 `rpa-behavior-mixin.click-fallback.test.js` 7 例、`weibo-selectors-live-dom.test.js` 5 例；既有的回退链用例按新链路拆成「可信命中 / 可信未命中」两条 |
| 测试 | PASS | apps/desktop：click-fallback 7 + rpa-view-helpers 22 + cdp-input 8 = 30 passed；rpa-view-platforms 79 passed；packages/rpa-engine 全量 287 passed |
| ESLint | PASS | 改动文件 0 error（修掉了 `no-useless-assignment` 两处） |
| 真机验证 | 部分 | 微信：跑通一次，日志证明可信点击生效、但落点错（未闭合）；微博：DOM 结构已取证，**未真发**（发一条微博是对外动作，未获授权） |
| QM-1 打包 | 待 CI | 本机依赖为跨盘 junction（store 在 C 盘、worktree 在 D 盘），无法本地产包 |
| QM-6 双模型评审 | 未执行 | 触及点击基础设施（所有平台共用），属需要外部轴复核的面 |
| 远程同步 | PENDING | PR 未合并 |

## 未闭合（不假装已修好）

- **微信保存按钮仍未定位准**：需要拿到 `mp.weixin.qq.com/cgi-bin/appmsg?action=edit` 页面上「保存为草稿」按钮的真实结构（隐藏的 `a#js_sync_save` 不是它）。下一次取证要解决 RPA 微信窗口不出现在 CDP page 列表的问题（微博窗口会出现在，微信不会）。
- **微博未真发验证**：选择器与 URL 已按真机 DOM 更新，但仍需一次真实发布确认「发送」能成功、且标题合并进正文的格式正确。
- B 站图文专栏通道：另立需求。
