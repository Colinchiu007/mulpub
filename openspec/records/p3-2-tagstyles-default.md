---
record: p3-2-tagstyles-default
task: P3-2 方案 A 续 —— 修判据 7/8 过严（TAG_STYLES 缺席应走默认兜底），并加「不许空转」反向锁
date: 2026-10-15
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：修 P3-1 判据 7/8 过严（p3-2-tagstyles-default，2026-10-15）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 含 `scripts/`
  ⇒ **混合 PR**，走完整质量节拍。

## 承接

`01-docs/PLATFORM-ONBOARDING-CHECKLIST-2026-10-15.md` §4.3 把判据 ⑦/⑧ 的 6 个失败
（`tencent_video` / `youtube` / `tiktok` / `twitter` / `instagram` / `facebook`）
定性为 **D 类「判据过严」**，并写明正解方向。本 PR 落地该修正。

## 现场取证（先取到精确 detail，再动手）

原判据 ⑦ 要求 `CONTENT_LIMITS` / `TITLE_LIMITS` / `TAG_STYLES` **三张表都有该 slug 的显式键**。
写探针逐平台取精确 detail：

```
youtube        7: ok=false  detail="TAG_STYLES 无 youtube"
tiktok         7: ok=false  detail="TAG_STYLES 无 tiktok"
...
tencent_video  7: ok=false  detail="TAG_STYLES 无 tencent_video"
```

**⇒ 6 个平台的 detail 全是「TAG_STYLES 无 <slug>」—— 即 `CONTENT_LIMITS` / `TITLE_LIMITS`
**均已命中**，只缺 `TAG_STYLES` 一张。**

三张表的真实键数（按实现同款正则提取）：

| 表 | 键数 | 键 |
| --- | --- | --- |
| `CONTENT_LIMITS` | 4 | `wechat_mp, douyin, toutiao, youtube` |
| `TITLE_LIMITS` | 6 | `wechat_mp, douyin, toutiao, youtube, weibo, tiktok` |
| `TAG_STYLES` | 10 | `douyin, bilibili, pipixia, xigua, tengxun_shipin, meiyou, chejiahao, weibo, zhihu, wangyi` |

## 为什么这是判据过严（三条证据）

| # | 证据 | 结论 |
| --- | --- | --- |
| ① | `content-formatter.js:60` — `var style = TAG_STYLES[platform] \|\| '#tag'` | **代码有默认兜底** ⇒ 缺席不是坏 |
| ② | `content-formatter-registry-sync.test.js` 的注释与测试**只锁 `CONTENT_LIMITS` / `TITLE_LIMITS`**，完全不涉及 `TAG_STYLES` | `TAG_STYLES` 本就不在「必须全覆盖」的契约范围内 |
| ③ | `TAG_STYLES` 的 10 个键里 **6 个**（`pipixia`/`xigua`/`tengxun_shipin`/`meiyou`/`chejiahao`/`wangyi`）**不在 `config/platforms.yaml` 的 15 个平台里** | 缺席是这张表的**常态**，不是缺陷 |
| ④ | `formatTags`（L58-67）：`'#tag'` ⇒ `#话题`、`'#tag#'` ⇒ `#话题#`、`plain` ⇒ 原样 | 默认 `'#tag'` 对海外/短视频平台的 hashtag 约定**恰好正确** |

## ★ 顺带修正我上一轮的一处取证错误

上一轮我在记录里写「`TAG_STYLES['shipinhao'] = '#tag'` 是够不着的孤键」。
**这次取到真实键名后发现是错的**：

- 表里的键是 **`tengxun_shipin`**，不是 `shipinhao`
- `tencent_video` 的调度 id 是 `tencent_video`（已由 `shipinhao-video.js:73` 调
  `formatArticleBody('tencent_video', …)`、`shipinhao.js:2` 注释确认）
- **两者都不是** ⇒ 不存在「本平台的孤键」，只有「另一套命名体系的残留键」

**⇒ 教训：**「读到的键名」必须与「判据实际查的名字」逐字对上再下结论。
上一轮我用 `Select-String` 提取键名时被 PowerShell 转义问题吃成了 0 键，
于是**基于推测**写了「孤键」—— 这次改用 Node 探针（与实现同款正则）才拿到真值。

## 修法

| 判据 | 改动 |
| --- | --- |
| ⑦ | `CONTENT_LIMITS` / `TITLE_LIMITS` **仍要求显式键**（不放宽）；`TAG_STYLES` 改为「键存在 ⇒ 显式命中；缺席 ⇒ 校验默认兜底值合法即通过」 |
| ⑧ | 有键 ⇒ 校验取值合法（原逻辑）；缺席 ⇒ 改为校验**默认兜底值本身**合法 |

**★ 关键：默认兜底值不复制字面量，而是从实现里读** ——
`formatterText.match(/TAG_STYLES\[platform\]\s*\|\|\s*'([^']+)'/)`。
**这样若有人改了兜底表达式，判据会当场报「不可解析」而不是静默按旧值放过。**

**★ detail 必须如实说明走了默认**（`TAG_STYLES 缺席走默认 '…'`），
不许静默通过 —— 否则将来没人知道这 6 个平台靠的是兜底。

## ★ 反向锁（放宽后最怕空转）

`scripts/verify-platform-onboarding.test.js` 新增一条，四层断言：

1. **默认兜底值必须可解析且合法** —— 反向锁的核心
2. **6 个缺席平台判据 ⑦/⑧ PASS，且 detail 必须含「TAG_STYLES 缺席走默认」**
3. **8 个有显式键的平台必须报「TAG_STYLES 显式命中」** —— 防键匹配退化
4. **`CONTENT_LIMITS` / `TITLE_LIMITS` 仍不许缺** —— 防「一起被放宽混过」

## ★ 真变异反证

```
基线:     tests 19 / pass 19 / fail 0
变异:     把 formatTags 兜底 '#tag' -> '#BADVALUE'（不在允许集）
          => not ok 19 - TAG_STYLES 缺席的平台走默认兜底，且判据 7/8 不空转
             tests 19 / pass 18 / fail 1        ← 恰为新加的锁
还原:     tests 19 / pass 19 / fail 0；git diff 该文件为空
```

**⇒ 另外单独验证过：变异时 6 个缺席平台的判据 ⑦/⑧ **逐条转 FAIL**（12 条 FAIL 输出），
证明放宽后判据仍在真正校验。**

### ★ 追加一次变异：兜底表达式**不可解析**时是否 fail-closed

日常循环 Step ④ 自审时我担心一条脆弱路径：判据 ⑦ 里
`if (!def) { missing.push(...) }` 之后**不 return**，若 `missing` 为空会不会带着
`def === null` 继续往下拼 detail。于是加做一次变异验证：

```
变异:     把 formatTags 兜底  'TAG_STYLES[platform] || '#tag''
          -> 'TAG_STYLES[platform] || SOME_UNDEFINED_VAR'（不再是字面量 => 正则匹配不到）
结果:
  youtube（TAG_STYLES 缺席）   判据 ⑦ FAIL ｜ 判据 ⑧ FAIL   ← 不放过 ✅
  douyin / baijiahao / weibo    判据 ⑦ FAIL ｜ 判据 ⑧ PASS
                                ← ⑧ 有显式键故不依赖兜底；⑦ 仍红（见下）
测试:     not ok 1 / 10 / 14 / 19  ⇒ tests 19 / pass 15 / fail 4
还原:     tests 19 / pass 19 / fail 0；git diff 为空
```

**⇒ 结论：fail-closed 成立。** 兜底表达式坏掉时：

- 判据 ⑧ 对**缺席**平台 FAIL（`无法判定`），对**有显式键**的平台仍 PASS（不依赖兜底）
  —— **粒度正确**
- 判据 ⑦ 对**所有**平台 FAIL —— 因为 ⑦ 无条件调 `tagStylesDefault`。
  **这算「过度敏感」**：显式命中的平台本不需要兜底值。
  **但方向是正确的 fail-closed**（兜底表达式是共享依赖，它坏了就该整体报警），
  且正常状态下兜底表达式可解析，**不影响任何平台的结论**。
  故**刻意不改**，在此登记为已知取舍。

**⇒ 这条验证同时修正了我第一次探针的缺陷**：那次我在内存里 hook `fs.readFileSync`
再 `require(SCRIPT)`，结果 hook 没生效（`youtube` 的 detail 仍显示 `'#tag'`），
**探针自身失灵却看起来像「判据不 fail-closed」**。改用真实文件变异才拿到可信结论。

**⇒ 教训：探针本身也要被验证。** 当探针输出与预期矛盾时，
先怀疑探针（hook 时序 / 缓存 / 转义），再怀疑被测对象。

## 验证

| 项 | 结果 |
| --- | --- |
| `node --test scripts/verify-platform-onboarding.test.js` | **19/19** |
| 真变异反证 | 改兜底 ⇒ 1 条锁红（且 6 平台判据 7/8 逐条红）|
| 判据 ⑦ 失败平台数 | **0**（原 6）|
| 判据 ⑧ 失败平台数 | **0**（原 6）|
| 全 PASS 平台数 | **5 / 15（无变化）** ⇒ 证明没「顺手放宽」别的判据 |
| `content-formatter.test.js` | 1/1（未碰坏运行时代码）|
| `content-formatter-registry-sync.test.js` | 6/6（契约锁未破坏）|
| `node --check` 脚本 | 通过 |
| 还原后 `git diff` 运行时代码 | **空** |

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 脚本自测 | PASS | **19/19** |
| 真变异反证 | PASS | 改兜底 ⇒ 锁红 + 6 平台判据红 |
| 判据 ⑦/⑧ | PASS | 失败 **0** |
| 全 PASS 无回归 | PASS | 5 / 15，与修改前一致 |
| 运行时代码未被碰坏 | PASS | content-formatter 两个测试文件 1/1 + 6/6 |
| `check-pr-exec-record` | PASS | OK |
| `check-gate-record-debt` | PASS | 本记录已写两形态 |
| `check-unwired-tests` | PASS | exit=0 |
| `check-no-brand-residue` | PASS | 全仓扫描 |
| 行尾对账 | PASS | 两口径一致 |
| **QM-1 打包** | **不适用** | 只改 `scripts/` 与文档；`content-formatter.js` 仅**临时变异后已还原**（`git diff` 为空）|
| **CCG `verify-quality`** | PASS | 两文件均「✓ 通过，错误 0 ｜ 警告 0」（仅 4 条格式类 ℹ 提示）|
| **CCG `verify-security`** | PASS | 严重 0 ｜ 高危 0 ｜ 中危 0 ｜ 低危 7（均不阻断）|
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：脚本自测 19/19 ✅ | 变异反证 ✅ | 判据⑦⑧ 0 失败 ✅ | 无回归 ✅ | 运行时代码未碰坏 ✅ | unwired ✅ | 品牌 ✅ | 行尾 ✅ | CCG quality+security ✅ | 远程同步 PENDING

## ★ 质量节拍 7 步 + CCG 补跑记录（用户要求核查后补）

### 已跑齐的

| 步骤 | 结果 |
| --- | --- |
| ⓪ pre-flight | worktree 隔离 + 非 C 盘 + 0 脏文件 |
| ① 上下文检查 | 已读 `content-formatter.js` / `registry-sync.test.js` / 判据实现 |
| ② 测试场景脑暴 | 4 层断言（默认合法 / 缺席 PASS / 显式命中 / 另两表不许缺）|
| ③ 增量实现 | 只改判据 7/8 + 测试 + 记录 + 文档 |
| ④ 上下文完整性审查 | 6 专项自审 + **追加变异验证（兜底不可解析）** |
| ⑤ 文档更新 | §4.3 改写 + §6 加第三类 + §7 快照 + 本记录 |
| ⑥ AI 协作质量检查 | 两条教训写进本记录 |
| ⑦ CI 流水线验证 | `fail=0`，`pending` 递减中 |

### CCG 补跑（此前只有 pre-commit 钩子的暂存区判定，且对 amend 前的 commit 误判 `skip`）

**根因**：`ccg-gate.js` / `ccg-review-decider.js` **只读暂存区**，改动一旦提交就无法再用
`--mode staged` 复判；而 amend 前那次判定读到的是「纯文档」暂存态，于是误判 `skip`。

**补跑方式**（绕过暂存区限制，直接调 CCG 本体）：

```
node "C:\Users\邱领\.claude\skills\ccg\run_skill.js" verify-quality  <file>
node "C:\Users\邱领\.claude\skills\ccg\run_skill.js" verify-security <file>
```

**结果**：

| 文件 | verify-quality | verify-security |
| --- | --- | --- |
| `scripts/verify-platform-onboarding.js` | ✓ 通过，错误 0 ｜ 警告 0（4 条格式 ℹ）| 严重 0 ｜ 高危 0 ｜ 中危 0 ｜ 低危 7 |
| `scripts/verify-platform-onboarding.test.js` | ✓ 通过，错误 0 ｜ 警告 0 | 严重 0 ｜ 高危 0 ｜ 中危 0 ｜ 低危 0 |

**⇒ 两条都不阻断（`verify-quality` 仅告警；`verify-security` 严重/高危为 0）。**

**★ 但这里有一个**未闭合的缺口**：`ccg-review-decider` 的**审查模式判定**（dual / single / skip）
仍然只对「暂存区」有效，改动提交后无法补判。本 PR 应按 `dual` 还是 `single` 走，
**目前没有可复现的判定记录**。按规则反推：源码变更 114 行（≤ 200）且未命中
auth/数据库/加密路径 ⇒ 应为 `single`（§12.6 常规专家分派）。
**该反推未经脚本确认，故在残余里登记，不冒充已跑。**

## 残余（未含，不假装闭合）

| 类 | 内容 | 状态 |
| --- | --- | --- |
| **B** | `youtube`/`twitter`/`facebook` 的 `has_api:true` + `dom-only` + 无链 | 仍待 owner 裁定（判据 ⑨ 棘轮 `STEP9_CHAIN_GAPS` 钉住）|
| **C** | 判据 ⑩（`formatArticleBody`）| 仍未裁定 |
| **E** | 判据 ⑪（测试覆盖）| 仍欠账 |
| **CCG-decider** | 审查模式判定（dual/single/skip）只读暂存区 ⇒ 改动提交后**无法补判** | 已补跑 `verify-quality` + `verify-security` 两个 gate；**模式判定未跑**，按规则反推应为 `single` 但**未经脚本确认**，故在此登记 |
| 新 | `TAG_STYLES` 里的 `tengxun_shipin` / `pipixia` / `xigua` 等 6 个非 config 平台键 | **本 PR 不动**（属另一套命名体系，清理需 owner 确认口径）|
