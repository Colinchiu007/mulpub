# PRD：locale zh/en 键集对称门禁（i18n-content-sync L5 `--symmetry`）

- 日期：2026-10-25
- 归属：UX 审计任务 #20（`01-docs/UX-AUDIT-2026-10-17.md` 文案一致性面）
- 实现落点：`.github/scripts/check-locale-sync.js`（新增第 5 档 `--symmetry`）、`.github/workflows/quality-gate.yml` Gate 7
- 交付 PR：`ux-audit-locale-pair-gate`

## 1. 问题：三条既有判据各自漏掉同一格

locale 目录的真源形态在「FRONTEND-FILE-SPLIT」之后从两个装配文件变成 60 对
（`locales/<ns>/{zh,en}.js`，含 `locales/<ns>/<sub>/{zh,en}.js`）。Gate 7 原有的三条档各自的盲区是实测出来的，不是推的：

| 档 | 判据 | 实测盲区 |
| --- | --- | --- |
| `--pair-base` | 同一次 diff 里 `zh.js` 与 `en.js` 必须**都**被改 | 两侧都改了、但改的**不是同一批键** ⇒ PASS |
| `--keys` | 渲染端 `t('…')` 用到的键必须存在于 zh 与 en | 键**还没被界面用到**时，单侧缺席完全不报 |
| `--cjk` | `src/` 非 locales 的中文硬编码 | 与成对无关，管不到 locale 内部 |

取证（本机对同一提交的三档读数，提交形状＝两侧都改但键集不对称）：

```
--pair-base → pair check PASS（…zh.js 变更=false，…en.js 变更=false…）        rc=0
--keys      → FAIL，但只点名 publishPage.draftsHint（因为在 Publish.vue 被用到）
              同提交里 zh 侧新增、无人使用的探针键不出现在清单里                rc=1（漏一半）
--symmetry  → 不对称 …/publish-page: onlyZh=draftsHint,draftsTitle,unusedProbeKey rc=1（全点名）
```

后果的落点是用户可见的：vue-i18n 对缺失 key **原样返回键名**，所以「英文界面显示
`publishPage.draftsHint`」这类泄漏只有在有人用到该键时才会被现有档拦住；「先落中文、
键暂时没接进界面」这一整类不对称在门禁里根本不可表示。

## 2. 需求：`--symmetry` 的判定域与四类形态

1. **域** = 传入目录（默认 `apps/desktop/src/locales`）下**全部层级**的 `zh.js`，逐个找同名目录的 `en.js` 孪生。
   只扫顶层等于把拆进子目录的命名空间整体排除在外，因此域必须是递归的。
2. **键集口径** = 复用既有唯一实现 `loadLocaleKeys()`（点分叶子路径，会跟随 `import` 递归求值子模块），
   MUST NOT 新增第二份剥壳/解析逻辑；两份事实必然漂移，而漂移的表现是「门禁说没问题、界面显示键名」。
3. 四类形态各自必须 FAIL，且文案必须点名**哪一对、哪个方向、哪些键**：
   - `onlyZh=<k1,k2>`：中文侧独有的键（含「en 少了一个」与「zh 多了一个」两种来源）；
   - `onlyEn=<k1,k2>`：英文侧独有的键（判据必须双向，只查一个方向等于允许另一种不对称）；
   - `missingTwin`：有 `zh.js` 无 `en.js`（不得当成「无需比较」放行）；
   - `emptyPair`：任一侧键集为 0（零键既可能是空命名空间也可能是**解析退化**，两者都不得静默放行）。
4. **反失明**：扫描域为空 ⇒ FAIL，文案含 `domain is empty`；目录枚举失败 ⇒ FAIL 并说明是判据自身故障。
   PASS 行必须打印 `pairs=<n> zhKeys=<m>`，让「这一趟到底扫了多少」可复核。
5. **失败不降级**：locale 文件解析抛错一律 FAIL 并点名文件，不得把解析失败读成「该侧无键」。
6. `--locales-dir <dir>` 仅为让反证可构造（既有 `--keys` 读固定路径，历史上因此写不出失败路径的用例）；
   CI 不传，默认走真实域。

## 3. 提示文字（判据输出，非用户界面文案，故不进 locales）

- 逐条：`[locale-sync]   不对称 <相对目录>: onlyZh=<键清单> onlyEn=<键清单>（zh=<数> en=<数>）`
- 收口：`[locale-sync] FAIL：zh/en 键集不对称 —— 共 <N> 对（域 <dir>，配对 <pairs>）`
- 修法（写在红文案里，避免下一个会话去猜）：
  在同目录的孪生文件里补上缺席的键；确属一侧不该存在的死键，则从**该侧**删除，不得只改一份。

## 4. 验收标准

| # | 判据 | 锁 |
| --- | --- | --- |
| V1 | 键集相同的夹具 ⇒ PASS 且打印 `pairs=` | 单测 `--symmetry：两份键集相同` |
| V2 | zh 单边键 ⇒ FAIL 并点名该对与该键 | 单测（反证）单侧多出键 |
| V3 | en 单边键 ⇒ FAIL（双向） | 同上第二段 |
| V4 | 缺孪生 ⇒ FAIL `missingTwin` | 单测（反证）只有 zh 没有 en |
| V5 | 两侧零键 ⇒ FAIL `emptyPair` | 单测（反证）零键对 |
| V6 | 空域 ⇒ FAIL `domain is empty` | 单测（反证）扫描域为空 |
| V7 | 嵌套目录的不对称被抓 | 单测（反证）嵌套子目录 |
| V8 | 真实仓零漂移 + 规模下界（`pairs>=50`、`zhKeys>=8000`） | 单测 真实 locales |
| V9 | Gate 7 必须执行 `--symmetry` 且**紧跟**退出码检查 | 单测 接线锁（跳过注释行，注释里的字样不算接线） |
| V10 | 七道变异逐条 CAUGHT、还原后 md5 相同 | 反证驱动（现场读数见执行记录） |

## 5. 存量与不放宽

2026-10-25 实测存量漂移为 **0**（60 对 / 10054 键 / 零加载失败），因此本档**不需要基线**，
也就没有「为容忍存量而调大某个数」的空间；将来出现漂移只能改 locale 本身，不得给本档加豁免清单。
规模下界（50 / 8000）是防「解析或遍历退化」的，不是欠账登记；若因真实清理而跌破，
必须先确认扫描域仍然覆盖全部 locale 文件，再按当场实测调整并在 PR 说明里给证据。

## 6. 与其它门禁的关系

- Gate 7 的 `--pair-base` 档**保留**：它管的是「提交卫生」（一次提交只改一侧），与键集对称是两个维度，
  实测两者互不覆盖（见 §1 取证表）。
- 本次不改 `--cjk` / `--py-cjk` 的内容基线，不动 `CI_IGNORED_PATHS`，不动分支保护。
