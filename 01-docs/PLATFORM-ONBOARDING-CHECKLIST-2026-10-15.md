# 扩平台自检清单与判据适用性裁定（2026-10-15）

> 本文档是 **P3-1 交付物（`scripts/verify-platform-onboarding.js`）的使用手册 + 判据适用性裁定记录**。
> 它回答三个问题：**这套判据查什么**、**报红时怎么定性**、**哪些判据对哪些平台不适用**。
>
> 关联：
> - `01-docs/PLAN-REUSE-ROLLOUT-2026-10-13.md` §5（P3-1 / P3-2）
> - `openspec/records/p3-2-onboarding-existing.md`（P3-2 方案 A 执行记录）
> - `openspec/records/p3-1-criterion9-anchor.md`（判据⑨ 假绿修复记录）

---

## 1. 为什么需要这份清单

2026-10-14 P3-1 首次把这套脚本对**全部 15 个既有平台**跑了一遍，结果是：

```
全 PASS: 4 / 15      有失败: 11
```

**⇒ 这说明两件事：**

1. **P3-1 的验收判据①「对已有平台跑 ⇒ 全 PASS」实测不成立**（当时只有 4 个合规）。
2. **但这也正说明脚本有用** —— 它第一次全量跑就抓到了真实不一致。

**⇒ 所以本文档的第一条纪律是：**报红不等于「平台有缺陷」，必须先定性。**

---

## 2. 判据清单（13 条：11 步 + 2 条额外）

| # | 判据 | 查什么 | 数据源 |
| --- | --- | --- | --- |
| 1 | 登录 URL | `PLATFORM_LOGIN_URLS` 有该 slug | `platform-definitions.js` |
| 2 | 后台 URL | `PLATFORM_DASHBOARD_URLS` 有该 slug | 同上 |
| 3 | 登录成功判据 | `PLATFORM_LOGIN_SUCCESS_PATTERNS` 有该 slug | 同上 |
| 4 | **配置字段完整** | `platforms.yaml` 该块含 7 个必需字段：`type` / `content_category` / `max_title` / `max_content` / `has_api` / `publishMode` / **`enabled`** | `config/platforms.yaml` |
| 5 | 能力元数据 | `publish-capabilities.json` 有该 slug 且 `validateRegistry()` 返回空数组 | `publish-capabilities.json` |
| 6 | 正文承载形态 | `getArticleBodyKind()` 与该平台登记一致 | `content-formatter.js` |
| 7 | 三张上限表 | `CONTENT_LIMITS` / `TITLE_LIMITS` / `TAG_STYLES` 均有该键 | `platform-limits` 等 |
| 8 | `TAG_STYLES` 取值合法 | 取值 ∈ `{'#tag', '#tag#', 'plain'}` | `content-formatter.js` |
| 9 | **`has_api` 与发布链一致** | `has_api:true` ⇒ 有 `publish/platforms/<链名>-*.js` 且被 `platform-entries.js` 登记 | 文件系统 + `platform-entries.js` |
| 10 | **承载形态单一实现** | 候选文件（adapter + 链）含 `formatArticleBody` 调用 | 源码扫描 |
| 11 | 测试与文案 | `content-formatter.test.js` 有该 slug + 有 chain 测试 + locales 成对 | 测试文件 + `locales/` |
| 12 | 额外：无自写 `<p>` 包装 | 正文链不得自己包 `<p>` 或做 HTML 剥离 | 源码扫描 |
| 13 | 额外：顺序不变量 | 话题转换必须先于 `<p>` 包装 | 源码扫描 |

**用法：**

```bash
node scripts/verify-platform-onboarding.js <slug>
# exit 0 = 13 条全过；非 0 = 有 FAIL（逐条打印）
# 不给参数 = exit 2 + 用法；slug 形态非法 = exit 2（防路径注入）
```

---

## 3. ★ 报红时的定性方法（五类）

**不要照着失败清单批量改。** 先分类：

| 类 | 含义 | 处置 |
| --- | --- | --- |
| **A. 真缺口** | 判据与设计文一致，平台确实缺 | **改数据** |
| **B. 字段间自相矛盾** | 同一平台的多个字段互相不一致 | **交平台 owner 裁定「谁对」**，不代改 |
| **C. 判据是否适用未裁定** | 判据本身的对错还没结论 | 先**裁定判据**，再决定是否改数据 |
| **D. 判据过严** | 代码有默认值/别名机制，判据没考虑 | **改判据**，不是改数据 |
| **E. 测试覆盖欠账** | 缺测试，非阻塞 | 可独立排期 |

**⇒ 两类最容易被搞反：**
- **把 D 类当 A 类修** ⇒ 去改一个本来正确的配置（或给正确的平台补假数据）
- **把 B 类当单点修** ⇒ 只改其中一个字段，矛盾转移到别处

---

## 4. 已裁定的判据适用性（2026-10-15）

### 4.1 判据 ④（`enabled`）—— **适用，且已修**

**依据三条：**

1. 它是 **schema 字段**：`packages/shared-utils/src/platform-config.js:29-34`
   ```js
   // applyRemote 允许覆盖的键与期望类型（allowlist）
   const APPLY_REMOTE_KEY_TYPES = { …, has_api: 'boolean', enabled: 'boolean' }
   ```
2. 它是**「单平台一键回滚」机制**（设计文 `ARCH-REUSE-INTEGRATION` §9.3 回滚成本段）
3. 15 个平台里 **12 个都已声明** ⇒ 缺的 3 个属遗漏

**⇒ 结论：真缺口。** 已在 P3-2 方案 A 补齐（`baijiahao` / `instagram` / `tencent_video`），
并把测试从「记录缺口」改成**棘轮**（空数组是断言目标，不是待办清单）。

---

### 4.2 判据 ⑨（`has_api` 与发布链一致）—— **适用，但判据曾有假绿，已修**

#### 4.2.1 假绿（2026-10-15 修）

```js
const hasApi = /^[ \t]{4}has_api:[ \t]*true/.test(block)   // ← 缺 m 标志
```

**没有 `m` ⇒ `^` 只锚字符串开头 ⇒ 该判据只在「块的第一行恰好是 `has_api`」时才执行**，
其余一律走 `if (!hasApi) return { ok: true, … }` ⇒ **判通过**。

**实测 15 个平台里 6 个是假绿：**

| slug | 块首行 | 假绿 |
| --- | --- | --- |
| `douyin` | `# 2026-10-06 修正…` | ✓ |
| **`tencent_video`** | `id: 21` | ✓（且 `has_api:true` 却 0 链）|
| `kuaishou` | `id: 35` | ✓ |
| `bilibili` | `id: 23` | ✓ |
| `baijiahao` | `id: 4` | ✓ |
| **`facebook`** | `id: 104` | ✓（且 `has_api:true` 却 0 链）|

**⇒ 只有恰好把 `has_api` 写在块首行的 `youtube` / `twitter` 被正确抓到。**

**修复：加 `m`。** 修好后新暴露 `tencent_video` / `facebook` 两个真缺口。

#### 4.2.2 链名别名（同批修）

**判据原来按 `<slug>-*.js` 找链。但视频号的链叫 `shipinhao-video.js` / `shipinhao-music.js`，
而 slug 是 `tencent_video`。**

**证据（平台自己的配置注释）：**

> `config/platforms.yaml` 的 tencent_video 块：
> 「使视频号完整链（`src/publish/platforms/shipinhao-video.js`，分片 + Content-MD5 +
> post_draft/post_create 双分支，带链级测试）从未被触发」

**⇒ 这是**判据错**（假设「链文件名 = slug 前缀」），不是平台错。**
**⇒ 修法：`CHAIN_NAME_ALIASES = { tencent_video: 'shipinhao' }`。**

#### 4.2.3 修好后仍报红的 3 个 —— **B 类，交 owner 裁定**

| slug | `has_api` | `publishMode` | 链 |
| --- | --- | --- | --- |
| `youtube` | `true` | **`dom-only`** | 无 |
| `twitter` | `true` | **`dom-only`** | 无 |
| `facebook` | `true` | **`dom-only`** | 无 |

**⇒ 「声明有 API 能力」+「只走 DOM」+「无实现」三者不可能同时为真。**

**⇒ 两种可能的裁定：**
- 若「有 API 能力但总闸设 dom-only」是**合法状态** ⇒ 判据 ⑨ 应放宽为「`has_api:true` **且** `publishMode != 'dom-only'` 时才要求链」
- 若「`has_api:true` 必须有实现」⇒ 应补链，或把 `has_api` 改成 `false`

**⇒ 本 PR 不代改。**

---

### 4.3 判据 ⑦/⑧（`TAG_STYLES`）—— **对 6 个平台判据过严（D 类）**

**判据要求 `TAG_STYLES` 有该 slug 的显式键。实测 6 个平台没有：**
`tencent_video` / `youtube` / `tiktok` / `twitter` / `instagram` / `facebook`

**三条证据表明这不是平台缺陷：**

| # | 证据 | 结论 |
| --- | --- | --- |
| ① | `content-formatter.js:60` — `var style = TAG_STYLES[platform] \|\| '#tag'` | **代码有默认值** ⇒ 缺席 ≠ 坏 |
| ② | `shipinhao-video.js:73` 传 `'tencent_video'`；`shipinhao.js:2` 注释确认 `constructor 'tencent_video'` | 表按**调度 id** 键，`shipinhao` 是**文件名**不是 id |
| ③ | `TAG_STYLES` 里有 `dayu` / `qiehao` / `aiqiyi` 等**不在 `platforms.yaml`** 的键 | 表覆盖范围比 config 广，**缺席是常态** |

**逐个定性：**

| slug | 定性 | 说明 |
| --- | --- | --- |
| `tencent_video` | ⚠️ **潜在隐患（孤键）** | `TAG_STYLES['shipinhao'] = '#tag'` **永远够不着**（实际查的是 `'tencent_video'`）。因两者值相同，**行为无差异**；但若有人把 `shipinhao` 改成 `'plain'`，`tencent_video` 不会跟随 |
| `youtube`/`tiktok`/`twitter`/`instagram`/`facebook` | ✅ **判据不适用** | 缺席 ⇒ 默认 `'#tag'`，**对海外/短视频平台恰好正确**（hashtag 约定）|

**⇒ 正解（建议，未实施）：判据 ⑦/⑧ 应接受「键存在 **或** 默认值语义正确」，
并把默认值本身钉进回归锁。**

---

### 4.4 判据 ⑩（`formatArticleBody`）—— **未裁定**

**P3-1 作者已在测试注释里写明：**

> 「步骤 10 要求候选文件含 `formatArticleBody` —— 是否过严**尚未裁定**，故本快照如实记录，不宣称这些平台『有缺陷』。」

**⇒ 本文档维持「未裁定」，不擅自扩大也不擅自收窄。**

**已知事实（供裁定时参考）：**

`AGENTS.md`「图文正文承载形态合同」已列明**纯文本承载平台**包括：
`douyin`/`xiaohongshu`/`kuaishou`/`bilibili`/`tencent_video`/`weibo`/`zhihu`/`youtube`/`tiktok`/`twitter`/`instagram`/`facebook`

**⇒ 也就是说：这 12 个平台的正文**确实**要经 `formatArticleBody`（走纯文本分支）。**
**⇒ 那么「候选文件含 `formatArticleBody` 调用」对它们应当是**真要求**，
报红者需逐平台核对「是链没调用，还是调用点不在候选扫描范围内」。**

---

### 4.5 判据 ⑪（测试与文案）—— **真缺口（E 类），非阻塞**

9 个平台缺 chain 测试或 `content-formatter.test.js` 无该 slug。**属测试欠账，可独立排期。**

---

## 5. 一次完整的平台自检流程（建议）

```
① 跑脚本：node scripts/verify-platform-onboarding.js <slug>
② 对每条 FAIL 做定性（本文档 §3 的五类）
③ 按下表处置：

   类 A（真缺口）      ⇒ 改数据，并更新快照/棘轮
   类 B（字段矛盾）    ⇒ 写清矛盾点，交 owner 裁定，本 PR 不代改
   类 C（适用未裁定）  ⇒ 只登记，不动判据也不动数据
   类 D（判据过严）    ⇒ 改判据（加别名/接受默认值），**不动数据**
   类 E（测试欠账）    ⇒ 可独立排期

④ 改完跑：node --test scripts/verify-platform-onboarding.test.js（应全绿）
⑤ ★ 必做一次**变异反证**：把修复点临时改回错误形态，确认测试当场变红；
   还原后确认 git diff 只剩自己的改动（未污染工作区）
```

---

## 6. 反证纪律（这套判据自己的教训）

**本套判据出过两类「假绿」，都写进教训：**

| 形态 | 实例 | 教训 |
| --- | --- | --- |
| **判据空转** | `structure-lock` 的 `for (const k of [])` 空循环 | 一个断言如果「空集合也过」，它就不是棘轮而是待办清单 |
| **判据只在多数输入的少数上执行** | 本条判据⑨ 的正则缺 `m` | 一个正则标志位可以决定整条判据是否执行，而逻辑读起来完全正确 |

**⇒ 所以：改门禁时**必须**做一次真变异跑**（把修复点改回错误形态 ⇒ 测试必须变红），
**不能用「拿字面量测正则」这类同义反复冒充反证。**

**⇒ 且负控优先用**真实数据**：本条的 `facebook`（`has_api:true` 不在首行 + 无链 ⇒ 应 FAIL）
天然就是证伪样本，不需要造夹具。**

---

## 7. 现状快照（2026-10-15）

| 指标 | 值 |
| --- | --- |
| 平台总数 | 15 |
| 判据 ④ 失败数 | **0**（P3-2 方案 A 修复后）|
| 全 PASS | **5 / 15**（`baijiahao` 只缺 ④ ⇒ 整平台转绿）|
| 判据 ⑨ 失败 | 3（`youtube`/`twitter`/`facebook`，B 类待裁定）|
| 判据 ⑦/⑧ 失败 | 6（D 类，判据过严）|
| 判据 ⑩ 失败 | 6（C 类，未裁定）|
| 判据 ⑪ 失败 | 9（E 类，测试欠账）|
| P3-1 脚本自测 | **16 / 16** |
