---
record: p3-residual-criteria
task: P3-2 四项遗留裁定并修复 —— B 类 facebook 空声明、C 类 6 适配器自抄正文转换、D 类 TAG_STYLES 19 个不可达孤儿键、E 类判据⑨⑪ 作用面错位
date: 2026-10-16
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：P3-2 四项遗留裁定并修复（p3-residual-criteria，2026-10-16）

四项此前全部标着「需 owner 裁定、不得单方面改」。本次**先取证再裁定**，结论是
**两类性质完全不同**：B/C 是**产品缺陷**（改产品），D 是**数据失真**（改表 + 加锁），
E 是**判据错位**（改判据）。逐项如下。

### 先给地面真值（不靠记忆里的标签）

对 15 个平台逐个跑 `node scripts/verify-platform-onboarding.js <slug>`，拿到修复前的红清单：

| 判据 | FAIL 平台（修复前）|
| --- | --- |
| ⑨ has_api 与链一致 | youtube / twitter / facebook |
| ⑩ 适配器/链含 formatArticleBody | zhihu / weibo / toutiao / youtube / tiktok / twitter |
| ⑪ 测试与文案 | wechat_mp / weibo / tencent_video / toutiao / youtube / tiktok / twitter / instagram / facebook |

**修复后 15/15 全绿**（`rc=0`，逐平台取产物，不看 rc 之外的任何东西）。

### B 类 —— facebook 空声明（**配置缺陷，已改产品**）

- **取证**：`facebook` 的 `has_api: true`，但 `src/adapters/facebook.js` **不存在**、
  `src/publish/platforms/facebook-*.js` **不存在**（两个目录都没有它的文件）；
  而 `api-router.js:45` 的 `supportsApi()` 就是 `!!cfg.has_api` ⇒ 原值让
  `supportsApi('facebook')` 恒 true，**谎称支持 API 轨**。
- **裁定**：`has_api` 与 `publishMode` 是**两个独立轴**（`publish-mode-config.test.js`
  有锚点注释「未入波」）。按此轴拆开：
  - **facebook**：0 实现 ⇒ **空声明** ⇒ 改 `has_api: false`（`config/platforms.yaml`，附证据注释）。
  - **youtube / twitter**：`adapters/youtube.js` 是**完整的 YouTube Data API v3 + OAuth2 适配器**，
    `adapters/twitter.js` 同构 ⇒ `has_api: true` **诚实**，**不动产品**，改判据（见 E）。
- **爆炸半径**：`getPublishMode()` 先读 `publishMode`、缺省才由 `has_api` 派生
  （`api-router.js:60-73`）⇒ 三个平台都写了 `publishMode: dom-only`，**改 has_api 不影响发布模式**。
  实测：`api-publish-engine` 全量 42 文件 / 431 测试通过；桌面侧
  `rpa-view-manager-publish-mode-gate.test.js` 9/9 通过（该用例恰好用 facebook 作夹具）。
- 旁证：`rpa-view-manager.js:68` 的既有注释就写着「publishMode=dom-only 却 has_api=true，
  此前本路径仍会进 API 轨」——**这个矛盾历史上真的导致过误入 API 轨**。

### C 类 —— 6 个适配器自抄正文转换（**真缺陷，已改产品**）

判据⑩ 判 FAIL 是**对的**。逐文件取证，这 6 个适配器确实各自在写正文/描述字段：

| 适配器 | 修复前 | 形态 |
| --- | --- | --- |
| `zhihu.js` | `content: stripped.content` 直写 | 纯文本承载 |
| `toutiao.js` | `content: stripped.content` 直写 | **HTML 承载** |
| `weibo.js` | 标题+正文 `join("\n")` 后直写 | 纯文本承载 |
| `twitter.js` | `[title, content].join("\n")` 后直写 | 纯文本承载 |
| `tiktok.js` | 同上（composedDescription）| 纯文本承载 |
| `youtube.js` | `description: taskData.content \|\| ""` | 纯文本承载 |

**6 个全部改走 `formatArticleBody(platform, …)`**，并保持**顺序不变量**（话题剥离/转换先于承载形态适配）。

**其中 toutiao 是行为变更（用户可见）**：它是 **HTML 承载平台**，原实现把
`stripTopicsFromContent` 的**纯文本直写** content 字段 ⇒ 平台按 HTML 解析、换行属可忽略空白
⇒ **整篇塌成一个文本节点**（与 AGENTS.md 记的 2026-10-12 百家号事故同型）。
`topic-inline-contract.test.js` 的 B-8 原来把**这个坏形态**钉成了期望
（`toBe('今天探店 太好吃了')`），本次**有意更新**为 `toBe('<p>今天探店 太好吃了</p>')` 并写明理由。

### D 类 —— TAG_STYLES 的 19 个不可达孤儿键（**数据失真，已改表 + 加锁**）

- **取证**：原表 29 个键，其中 19 个（aiqiyi / pipixia / meipai / xigua / duoduo / qiehao /
  tengxun_shipin / weishi / souhu_shipin / meiyou / xhs_shangjia / acfun / chejiahao /
  yichehao / souhu / dayu / wangyi / yidianhao / dewu）在**两个平台真源里都不存在**
  （注册表 `publish-capabilities.json` 无；`platform-definitions.js` 的 15 张表全无命中）。
  而 `TAG_STYLES[platform]` 只可能被已入册平台调用 ⇒ 那些键**永远不可达**。
- **另修**：`shipinhao` 是 `tencent_video` 的**链文件名**（不是平台 slug）⇒ 改回真 slug。
- **行为等价**：被删的 19 键不可达；6 个原先走兜底的平台（youtube/tiktok/twitter/instagram/
  facebook/tencent_video）其兜底值就是 `'#tag'`，**显式登记为同值** ⇒ 无行为变化。
- **加锁**：表改为导出，新增 G 用例（`content-formatter-registry-sync.test.js`）断言
  ①键集 ⊆ 注册表 15 平台 ②取值在允许集 ③不得含 `shipinhao`；含**下界断言**
  （注册表平台数必须 == 15、键集非空），防解析退化后假绿。

### E 类 —— 判据⑨⑪ 作用面错位（**判据错，已改判据**）

**⑨**：原口径「`has_api:true` ⇒ 必须有链 + `platform-entries.js` 登记」。它把
**能力轴**（有没有 API 实现）与**轨道轴**（当前走哪条轨）混为一谈 ⇒ youtube/twitter 恒红。
新口径三层：①无声明 ⇒ 无需链；②有声明 ⇒ 至少有**实现证据**（链**或适配器**）；
③有链 ⇒ 仍必须被 `platform-entries.js` 登记（这层不变）。

**⑪** 两条子判据测量错作用面：
- 「`content-formatter.test.js` 里有没有该 slug 的**字面量**」——本仓 formatter 限值的真实覆盖是
  **按注册表遍历**的契约锁（`content-formatter-registry-sync.test.js` 的 A 用例遍历
  `Object.keys(PLATFORM_PUBLISH_META)` 逐平台断言）⇒ 对 youtube/tiktok/twitter/instagram/facebook
  是**假 FAIL**。改为问「该平台在注册表内吗」。
- 「必须有 `test/<slug>*.js`」——对**无链平台**恒不可满足；且 `tencent_video` 的链级测试叫
  `shipinhao-*.test.js`（文件名 ≠ slug）⇒ 存在却判「无」（与⑨同型）。
  改为「有链才要求」，并把别名表**提到模块级由 ⑨⑪ 共用**（单一来源）。

### 变异反证（10 次，全部实跑；每次只改一处，改完即还原并复验）

| # | 变异 | 期望 | 实得 |
| --- | --- | --- | --- |
| M-D1 | 把孤儿键 `pipixia` 加回 TAG_STYLES | G 红 | ✅ 红（点名 pipixia）|
| M-D2 | 把 `shipinhao` 加回 | G 红 | ✅ 红 |
| M-C1 | zhihu 退回直写 `stripped.content` | A1 红 | ✅ 红 |
| M-C2 | toutiao 退回直写 | A2 红 | ✅ 红 |
| M-C3 | twitter 退回裸 content | A4 红 | ✅ 红 |
| M-C4 | youtube 退回裸 content | B(youtube) 红 | ✅ 红 |
| M-E1 | ⑪ 去掉别名 | 别名断言红 | ✅ 红（test 20）|
| M-E2 | ⑪ 恢复「无条件要求 chain 测试」| 无链平台红 | ✅ 红（test 14/20）|
| M-E3 | ⑨ 退回「必须有链」| youtube/twitter 红 | ✅ 红（test 14/17/18）|
| M-E4 | 删掉 douyin 的 TAG_STYLES 键 | 「15 全显式命中」红 | ✅ 红（test 19）|

每次变异后均**逐字节还原**并复验（包 431 测试 / 判据 20 测试全绿）。

### 一个必须说明的空转风险（已处理，不假装看不见）

D 修完后「没有任何平台的 TAG_STYLES 键缺席」⇒ 原用例里「缺席走默认」的循环
**永不执行**（空判据）。已重构成：把「该集合恒为空」**断言出来**，并把真实生效的覆盖
改成「15 个平台逐个必须报『显式命中』」；缺席分支的存活由 **M4** 反证（删键 ⇒ 立刻红）。

### 门禁

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`packages/` + `config/`）+ 判据脚本（`scripts/`）⇒ **混合 PR**，worktree `D:\Data\projects\mp-worktrees\mp-p3-residual-criteria`，裸分支 `p3-residual-criteria` |
| 第一性原因（QM-5 ①） | ✅ | 四项各自的取证见上（不是「判据说红就改」）|
| 逃逸分析（QM-5 ②） | ✅ | 见下「逃逸链」|
| 修复 + 回归保护（QM-5 ④） | ✅ | 6 个适配器 + 1 处配置 + 1 张表 + 2 条判据；新增 6 条行为/结构测试 + 2 条判据下界测试 + 1 条契约锁 |
| 防止再次发生（QM-5 ⑤） | ✅ | 10 次变异反证；`run-tests.js` 登记新测试文件（漏登记会静默不执行）|
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径一致** |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → `OK`（88 个测试文件）；新文件已进 `VITEST_FILES` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与渲染面 |
| QM-6 CCG 双模型外部评审 | PENDING | 见下 |
| 远程同步 | PENDING | 本 PR 未合并 |

### 逃逸链（QM-5 ②：这些缺陷为什么此前没被拦住）

1. **单元测试**：6 个适配器的既有测试只做接口断言（`youtube.test.js` 22 行，只查
   `name` 与 `execute` 返回形态）⇒ 正文形态无人断言。**本次已补**：4 条行为级
   （zhihu/toutiao/weibo/twitter 的真实产物）+ 2 条结构级（tiktok/youtube，其正文组装
   深埋在真实网络调用之后，无可注入缝，**如实标注为「结构档，非行为证明」**）。
2. **判据**：⑨⑪ 存在但**作用面错位**（把能力轴与轨道轴混谈、对无链平台提不可满足要求、
   对「按注册表遍历」的锁做文本匹配）⇒ 红的一直是**判据错**那部分，真缺陷被淹没在噪声里。
3. **棘轮**：`STEP9_CHAIN_GAPS` 与 `TAG_STYLES_ABSENT_OK` 两个快照**如实记录了现状**却没触发裁定
   ⇒ 它们把「待裁定」固化成了长期状态。本次裁定后两者都清空为 `[]`，**维持为空本身成为新棘轮**。
4. **流程**：四项被标记为「需 owner 裁定」后**没有任何机械提醒**，直到本次被显式问起才处理。

### 门禁自检命令（可复跑）

```bash
cd packages/api-publish-engine && node scripts/run-tests.js        # 42 文件 / 431 测试
node --test scripts/verify-platform-onboarding.test.js             # 20 测试
node scripts/check-unwired-tests.js                                # exit 0
for s in wechat_mp zhihu weibo douyin xiaohongshu tencent_video kuaishou toutiao \
         youtube tiktok bilibili baijiahao twitter instagram facebook; do
  node scripts/verify-platform-onboarding.js "$s" || echo "FAIL $s"
done                                                               # 15/15 全绿
```

### 遗留（不假装已闭合）

- **tiktok / youtube 的正文形态只有结构档测试**（无可注入缝，见上）。要升级为行为档，
  需要先给这两个适配器加可注入缝（例如把 payload 组装抽成纯函数）。**本次刻意不做**：
  那会扩大改动面到「重构」量级，应单独排期。
- **`has_api` 与 `publishMode` 的轴语义只写在注释与测试里**，没有可机读的单一来源。
  若后续再有平台两轴不一致，判据⑨ 只能判「有声明无实现」，判不出「声明与轨道是否相符」。
- **`platform-entries.js` 只登记 10 个平台**（DOM 发布入口），与注册表 15 个的差集
  （youtube/tiktok/twitter/instagram/facebook 等）是否有意为之，本次**未裁定**
  （不影响本次任何判据的结论，但它是另一条可能的遗留）。
- QM-6 双模型外部评审按流程执行，结论以 `.ccg/reviews/` 与 PR 描述为准，不在本记录里预先声称。
