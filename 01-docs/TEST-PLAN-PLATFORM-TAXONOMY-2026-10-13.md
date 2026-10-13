# TEST-PLAN-PLATFORM-TAXONOMY-2026-10-13 — 平台分类体系接入 测试计划

> **被测对象**：平台分类体系接入（P0-1 转换器 / P0-2 读取层 / P0-3 路由 / P0-4 注册表 / P0-5 适配器）
> **产品规格**：`PRD-PLATFORM-TAXONOMY-2026-10-13.md`（判据编号 A/B/D/E/F 的唯一真源在本文件 §4、§6）
> **设计真源**：`ARCH-REUSE-INTEGRATION-2026-10-13.md` §3 ｜ **实施计划**：`PLAN-REUSE-ROLLOUT-2026-10-13.md` §2
> **角色**：QA ｜ **状态**：待执行 ｜ **核实口径**：断言中的数值全部来自本次直读实测，转引值另行标注

## 目录

- [0. 范围与不在范围](#0-范围与不在范围)
- [1. 测试分层与仓库规范一致性](#1-测试分层与仓库规范一致性)
- [2. 测试用例矩阵](#2-测试用例矩阵)
- [3. 关键回归锁与变异反证](#3-关键回归锁与变异反证)
- [4. 测试文件路径与断言要点](#4-测试文件路径与断言要点)
- [5. 数据对账基线](#5-数据对账基线)
- [6. 门禁与接线检查表](#6-门禁与接线检查表)
- [7. 手工与真机验证（不可自动化）](#7-手工与真机验证不可自动化)
- [8. 退出判据（Definition of Done）](#8-退出判据definition-of-done)
- [9. 未覆盖与已知边界（不假装已闭合）](#9-未覆盖与已知边界不假装已闭合)

---

## 0. 范围与不在范围

**在范围**：转换器的形态/编码/对账行为；读取层 8 个导出的语义；`publisher-router` 的分类解析顺序不变量与失败语义；
注册表登记与渲染端归一化；产物的结构性不变量与确定性。

**不在范围（明确声明，避免「没测=已测」）**：

| # | 不在范围 | 理由 |
|---|---|---|
| N-1 | **平台侧分类 ID 是否仍然有效** | 数据是 2026-07-14 冻结快照、本轮零联网校验（PRD §2.3）。只能真机发布一条带分类的内容来判定（§7），**自动化测不了** |
| N-2 | RPA/DOM 轨的分类选择器 | `weibo`/`zhihu` 有 ID 但 `publishMode: dom-only`（PRD §2.1），本轮不接线 ⇒ 分类字段到不了平台，无链路可测 |
| N-3 | `youtube` 的 `categoryId` 默认值 `"22"` 是否正确 | 数据集里**没有 youtube**（已核实）⇒ 无参照物，改了也是猜（PRD §9.1） |
| N-4 | 产物体量对启动耗时的影响 | 需真实打包 + 冷启动计时，属性能验证，另立任务（PRD U-5） |
| N-5 | 参考产品数据副本的许可边界 | 法务判断，非测试（PRD U-7） |

---

## 1. 测试分层与仓库规范一致性

### 1.1 五层（每层给命令、覆盖什么、**不覆盖什么**）

| 层 | 范围 | 文件 | 运行命令 | 覆盖 | **不覆盖** |
|---|---|---|---|---|---|
| **L1 转换器** | `scripts/` | `scripts/import-platform-taxonomy.test.js` | `node --test scripts/import-platform-taxonomy.test.js` | CLI 契约、形态、编码、fail-loud、确定性、对账 | 产物在运行时的语义（见 L2） |
| **L2 读取层** | `packages/shared-utils` | `packages/shared-utils/src/__tests__/platform-taxonomy.test.js` | `pnpm --filter @multi-publish/shared-utils test`（vitest） | 8 个导出、缓存、副本、抛错、`null` 五成因、8 条不变量 | 真实产物之外的结构（用夹具覆盖） |
| **L3 路由契约** | `apps/desktop/electron/services` | `publisher-router.test.js`（**追加**） | `pnpm --filter @multi-publish/desktop test`（vitest） | 顺序不变量、失败码、`contentType` 推导、既有合同不破 | 平台真实拒绝行为（N-1） |
| **L4 注册表 + 渲染端** | `packages/shared-utils` / `apps/desktop/src` | `publish-capabilities.test.js`、`publish-overrides.test.js`（**追加**） | 同上两条 | 字段登记、`uiOnly` 暴露、**归一化不丢字段**、`classifyPublishFields` 快照 | Vue 模板渲染（`PlatformOverridePanel.test.js` 只覆盖既有分支） |
| **L5 产物自检** | 真实产物 | L2 文件内的数据自检组 | 同 L2 | `validateTaxonomy()`、精确节点数、`path` 唯一性 | 转换器逻辑本身（在 L1） |

### 1.2 与仓库既有测试规范的一致性（**逐条已核实**）

| 约定 | 本仓事实 | 本计划如何遵守 |
|---|---|---|
| `scripts/` 下用 **`node --test` + `node:assert/strict`**，**不用 vitest** | `quality-gate.yml:352` 注释明写「本仓不自动收集 `scripts/` 与 `.github/scripts/` 下的测试（vitest 只管 workspace）」；`scripts/sync-platform-config.test.js:12-13` 是先例 | L1 用 `node:test`；**不得**引入 vitest |
| `scripts/` 的测试必须**被某个 workflow 的可执行正文点名**，否则永不执行且无人发现 | `scripts/check-unwired-tests.js:3-8` 的棘轮；`KNOWN_UNWIRED = {}`（`:49`）**只能缩小、新增即红** | **同一 PR 内**把 `node --test scripts/import-platform-taxonomy.test.js` 加进 `.github/workflows/quality-gate.yml`（§6 F-6） |
| 新测试必须接在**不被 docs-only 短路的 job** | `MUST_LIVE_IN_UNGATED_JOB`（`:68`）的语义 | 若本项测试的输入落在 `CI_IGNORED_PATHS` 内则须登记；本项输入是 `scripts/` + `config/` + `src/`，**不属白名单**，按普通 job 接线即可 |
| workspace 包用 **vitest**，测试文件 `*.test.js` 与被测文件**同目录**（`shared-utils` 例外：集中在 `src/__tests__/`） | `apps/desktop/electron/services/publisher-router.test.js` 与 `publisher-router.js` 同目录；`packages/shared-utils/src/__tests__/` 存在 28 个测试 | L3/L4 同目录追加；L2 放 `src/__tests__/` |
| 断言必须**精确**（`toBe`/`toStrictEqual`/精确数组），禁止用 `toContain` 断言「整篇结构」 | AGENTS.md「文本结构断言」条：`toContain` 对「整篇压成一行」完全免疫 | 节点数用 `toBe`，`path` 用精确串，形态用精确节点数 |
| 禁止 blanket mock 文件系统 | `scripts/check-blanket-fs-mock.test.js` 存在 | L1/L2/L5 一律用**真实临时目录 + 真实文件**（`fs.mkdtempSync`），不 mock `fs` |

---

## 2. 测试用例矩阵

### 2.1 正常路径

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| N1 | 真实数据集全量导入 | `--source 01-docs/research/competitor-reverse-2026-10-13/platform-data --out <tmp>` | exit 0；`platforms` 键 **恰好 6 个**；`importedNodeCount === 1269` |
| N2 | 真实产物结构自检 | 同上产物 | `validateTaxonomy()` 返回 `[]` |
| N3 | 单平台精确取值 | `resolveCategoryId('douyin','动植物',{contentType:'article'})` | `{id:'117', name:'动植物', path:'动植物'}` |
| N4 | 路径形态取值 | `resolveCategoryId('bilibili','生活/日常',{contentType:'video'})` | `{id:'21', …}` |
| N5 | 按 ID 反查 | `resolveCategoryId('bilibili','21',{contentType:'video'})` | 命中且 `path === '生活/日常'` |
| N6 | 档位查询 | `getTaxonomyCoverage` 三例 | `bilibili→'id'`、`toutiao→'name-only'`、`youtube→'absent'` |
| N7 | 热更 | 改文件 mtime 后 `loadTaxonomy()` | 读到新内容；未改时**不重读**（可用 spy 计数或 `data` 引用相等断言） |

### 2.2 异常路径

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| E1 | 无参数 | `node script.js` | `status !== 0`；stderr 匹配 `/用法|usage/i` |
| E2 | 源目录不存在 | `--source <不存在>` | `status !== 0`；**不产出文件** |
| E3 | 畸形结构（无 ID 键也无名称键） | `{"foo":{"bar":1},"baz":[1,2,3]}` | `status !== 0`；stderr 匹配 `/未识别|无法识别|unrecognized/i` |
| E4 | 非空文件解析 0 节点 | `[]` 或 `{}` | **exit 1**（FL-2；这是历史少算 67% 的直接防线） |
| E5 | 双解码均失败 | 随机二进制字节 + `.txt` 扩展名 | exit 1；`unreadable[]` 非空 |
| E6 | 产物文件缺失 | `loadTaxonomy({filePath:'<不存在>'})` | **抛错**（不是返回空表） |
| E7 | JSON 非法 | 写 `{` 开头的截断文件 | **抛错** |
| E8 | `schemaVersion:999` | 手写产物 | **抛错**（fail-closed，不猜结构） |
| E9 | `platforms` 结构非法（缺 `nodes`） | 手写产物 | **抛错** |
| E10 | 显式给了 `categoryName` 但平台无能力 | 路由测试：`platform='toutiao'` + `categoryName='三农'` | 返回 `{ok:false, code:'category-unsupported'}`，**且不构造请求** |
| E11 | 显式给了名字但查不到 | `resolveCategoryId('douyin','不存在的分类')` ⇒ `null`；路由层断言 `category-unresolved` | 失败码正确 |
| E12 | 同名歧义 | `resolveCategoryId('baijiahao','其他',{contentType:'video'})` | **`null`**（快照有 4 个同名；**不得择一**） |
| E13 | `contentType` 不匹配 | 对只有 `video` 块的平台请求 `article` | `null`（成因 `content-type-mismatch`） |

### 2.3 边界

| # | 用例 | 期望 |
|---|---|---|
| B1 | 未收录平台 | `getCategories('not-a-platform')` ⇒ **`[]`**（**不是 `null`** —— 空数组对 `for`/展开安全） |
| B2 | 未被收录但传 `contentType` | 同样 `[]`，不抛错 |
| B3 | `hasPlatformCategories('kuaishou')` | `false`（有数据但 `name-only`） |
| B4 | 空关键词搜索 | `searchCategories('bilibili','')` ⇒ 返回该块全部节点（定义明确，不返回 `undefined`） |
| B5 | 大小写不敏感 | `searchCategories('bilibili','ABC')` 与 `'abc'` 结果相同 |
| B6 | 突变防御 | 取 `getCategories(...)` 后 `arr[0].name='X'`、`arr.pop()`，再取一次 ⇒ 内容不变（**深拷贝**） |
| B7 | 一级节点 | `level===1` ⇒ `parentId===null && parentPath===null` |
| B8 | 最深层级 | `baijiahao` 有 `level===3` 的节点，其 `parentPath` 必须能解析到二级 `path` |
| B9 | 中文 ID | `baijiahao` 的节点 `id` 形如 `"军事历史"`（**字符串**，不是数字）⇒ 类型断言 `typeof id === 'string'` |
| B10 | 超大块搜索 | `searchCategories('baijiahao','教学',{contentType:'video'})` ⇒ `length > 1`（验证命中 `path` 任一层） |

### 2.4 形态覆盖（8 态，逐态一条**精确节点数**断言）

| # | 形态 | 夹具（最小可判形态） | 该夹具期望节点数 |
|---|---|---|---|
| F-A | `[{code,text}]` | `[{"code":117,"text":"动植物"},{"code":109,"text":"游戏"}]` | 2 |
| F-B | `[{id,name,cates:[…]}]` | `[{"id":"10","name":"军事","cates":[{"id":"1468","name":"国防观察"}]}]` | 2（父+子） |
| F-C | `[{child,id,name}]`，`child:null` | `[{"id":"军事历史","name":"军事历史","child":null}]` | 1 |
| F-D | `[{childrenCate,level,parentCate,title,…}]` | 三级链（`level` 1→3） | 3 |
| F-E | `{名:[…]}` / `{名:null}` | `{"三农":["种植业","养殖业"],"社会":null}` | **0**（无 ID ⇒ 不进产物）+ 计数对账可见 |
| F-F | `[{children:[{id,ids,name}]}]` | `[{"id":"A1","ids":"A1","name":"正能量","children":[{"id":"A2","ids":"A2","name":"社会资讯"}]}]` | 2；`ids≠id` 的变体另测 ⇒ `warnings[]` 非空 |
| F-G | `[{id:int,name,children:[…]}]` | `[{"id":160,"name":"生活","children":[{"id":21,"name":"日常"}]}]` | 2 |
| F-H | 顶层数组（元素为上述任一） | `[{...}]` 直接作为根 | ≥1 |
| F-I | **同一文件跨形态** | `[{"id":1,"name":"A","cates":[{"id":2,"name":"B"}]},{"id":3,"name":"C","child":{"id":4,"name":"D"}}]` | 4 |

**变异反证（必做）**：把遍历器改成「只认一种形态」⇒ F-A/F-C/F-D/F-E/F-G 中**至少 5 条**必须变红。
**依据**：这正是 11,623 → 3,838 的真实事故形态（错误表现为数字偏小而非红灯）。

### 2.5 编码覆盖（**本节是本计划最关键的一节**）

**三条已实测的事实（决定夹具怎么造）**：

1. **仓内副本全部是 UTF-8**（121 个 `.txt`，0 个 GBK）⇒ **指向仓内副本的测试永远走不到 GBK 分支**。
2. **GBK 夹具不能以文件形式入库**：`scripts/check-text-encoding-integrity.js` 的判据域是 `git ls-files`
   且 `.txt` 在域内 ⇒ 入库即红。
3. **「GBK 解码后 U+FFFD 计数 === 0」单独使用是错的判据**。本次实测：
   UTF-8 字节 `7b22 e4b889 e5869c 223a 6e756c6c 7d`（即 `{"三农":null}`）被误按 GBK 解码得到
   `{"涓夊啘":null}`，**U+FFFD 计数 = 0**；4 个 UTF-8 样本里有 3 个都是 0。
   ⇒ **必须先试 UTF-8 严格解码，顺序不可交换**；`U+FFFD 计数` 只能用来判定「GBK 也不是」（双失败）。

**夹具构造法（唯一正确做法）**：在**测试源码里写 ASCII 十六进制**，运行时转成真实 GBK 字节写入 `os.tmpdir()`。
源码保持合法 UTF-8（过编码门禁），字节是真实 GBK。

| # | 用例 | 做法 | 期望 |
|---|---|---|---|
| C1 | 纯 GBK 文件 | `Buffer.from('7b22c8fdc5a9223a6e756c6c7d','hex')` 写入 `toutiaovideosubcategort.txt`（实测该 hex 按 GBK 解码 = `{"三农":null}`；严格 UTF-8 解码**失败**） | 判为 GBK；`encoding.gbk === 1` |
| C2 | 纯 UTF-8 文件 | 同一内容用 `fs.writeFileSync(..., s, 'utf8')` | 判为 UTF-8 |
| C3 | **同目录混编码**（核心） | 同一临时目录写 `a…categortmap.txt`（GBK hex）+ `b…categortmap.txt`（UTF-8 字符串） | 两个文件各自判对；`utf8+gbk+undecidable === 2` |
| C4 | **顺序锁**：UTF-8 文件误按 GBK 解码无 U+FFFD | 用 C2 的 UTF-8 文件，断言其被判为 UTF-8（若实现先试 GBK，会得到「0 个 U+FFFD」而误判） | 判为 UTF-8 ⇒ **顺序被锁死** |
| C5 | 双失败 | `Buffer.from([0xff,0xfe,0x00,0x01,0x80,0x81])` | 记 `unreadable[]` 且 exit 1 |
| C6 | GBK 文件名不影响内容判定 | 文件名用 ASCII，内容用 GBK | 判为 GBK（**证明判据只看内容**） |
| C7 | 真实数据集编码分布 | 对仓内副本跑转换器 | `encoding.utf8 === 文件总数`、`gbk === 0`（**因为副本已转码** ⇒ 这条断言本身就是「副本已转码」的锁） |

> ⚠️ **对既有 TDD 测试的修正**：`scripts/import-platform-taxonomy.test.js` 的 `makeFixture` 在 `enc === 'gbk'`
> 时用 `Buffer.from(content, 'binary')` 写入 —— `'binary'` 是 **latin1 别名，不是 GBK**，因此**该分支测不到任何 GBK 行为**。
> 必须改为 §2.5 的 hex 字节法（C1~C4）。

### 2.6 数据质量（**锁住真实的脏数据形态**）

| # | 用例 | 数据事实 | 期望 |
|---|---|---|---|
| Q1 | **ID 重复不得导致校验失败** | `bilibili/video` 有 3 组重复 ID（`36`→{知识,科技}、`86`、`95`）；`baijiahao/video` 8 组（`其他`×4、`资讯解读`×12、`教学`×18） | `validateTaxonomy()` **不含**「id 唯一」判据；含重复 ID 的产物**仍然返回 `[]`** |
| Q2 | **`path` 唯一性是硬判据** | 8/8 块、1,269 节点零重复（实测） | 人为造一条重复 `path` ⇒ `validateTaxonomy()` 非空 |
| Q3 | `parentId` 不唯一 ⇒ 树重建必须用 `parentPath` | `bilibili` 有两个一级节点 `id=36` | 用例：按 `parentId` 重建会串台；按 `parentPath` 重建正确（断言子节点集合精确相等） |
| Q4 | 名称歧义 ⇒ 不择一 | `baijiahao` 的 `其他` 有 4 个 | `resolveCategoryId('baijiahao','其他') === null` |
| Q5 | 一级节点父子字段 | 全部 8 个块 | `level===1 ⇔ parentId===null && parentPath===null` |
| Q6 | 中文 ID 类型归一 | `baijiahao` 的 `"军事历史"` | `typeof node.id === 'string'`（全部节点） |
| Q7 | 层数上限 | `baijiahao` 最深 3 层 | `max(level) === 3`；无 `level > 3` 的节点 |

---

## 3. 关键回归锁与变异反证

**每条锁都必须做一次「把防线改成 no-op 立刻变红」的变异**（只证「业务改动变红」不能证明锁在跑）。

| # | 锁 | 位置 | 断言 | 建议的 no-op 变异 | 期望后果 |
|---|---|---|---|---|---|
| **K-1** | **形态无关遍历** | L1 + L2 | §2.4 的 9 条精确节点数断言 | 遍历器只保留「`{id,name}` + `children`」一种分支 | **≥5 条红**（F-A/C/D/E/G） |
| **K-2** | **fail-loud（0 节点）** | L1 | E4 断言 `status !== 0` | 把「0 节点」分支改成 `unreadable.push` 后继续（不 exit） | E4 必红 |
| **K-3** | **编码顺序（UTF-8 优先）** | L1 | C4 | 交换试探顺序（先 GBK）/ 把判据改成「GBK 无 U+FFFD 即 GBK」 | C4 必红（UTF-8 文件会被判成 GBK） |
| **K-4** | **逐文件而非按目录** | L1 | C3 | 改成「取目录中第一个文件的编码作为全目录编码」 | C3 必红 |
| **K-5** | **顺序不变量（精确层胜出）** | L3 `publisher-router.test.js` | `category`(tid=17) + `categoryName='生活/日常'` 同给 ⇒ 结果是 `17` | 把通用层移到精确层**之后** | 该用例必红 |
| **K-6** | **显式指定失败要可见** | L3 | E10/E11 断言失败码 | 把 FL-9/FL-10 改成「不写字段 + 继续」（ARCH 原写法） | E10/E11 必红 |
| **K-7** | **归一化不丢字段** | L4 `publish-overrides.test.js` | `normalizePlatformOverrides({bilibili:{categoryName:'生活/日常'}}).bilibili.categoryName === '生活/日常'` | 从 `publish-capabilities.json` 删掉 `categoryName` 条目 | 该用例必红（**这是「UI 可编辑但发布不生效」形态的锁**） |
| **K-8** | **歧义不择一** | L2 | `resolveCategoryId('baijiahao','其他')` ⇒ `null` | 把歧义分支改成「取第一个」 | 必红 |
| **K-9** | **未收录平台返回空数组** | L2 | `getCategories('not-a-platform')` ⇒ `[]`（`Array.isArray` + `length===0`） | 改成返回 `null` | 必红 |
| **K-10** | **副本不可污染** | L2 | B6 | 返回缓存内对象（去掉深拷贝） | 必红 |
| **K-11** | **`schemaVersion` fail-closed** | L2 | E8 | 改成「不认识就按 v1 读」 | 必红 |
| **K-12** | **确定性** | L1 | A-2 两次 SHA-256 相同 | 去掉显式排序（依赖 `readdirSync`/插入顺序） | 在 ≥2 文件的目录上必红（**单文件夹具测不出来 ⇒ 夹具必须含 ≥3 个文件且名字顺序与期望序不同**） |
| **K-13** | **计数对账** | L1 | A-3/A-4 的 5 个数字 | 把某个对账断言删掉 | 断言消失即等于门禁消失 ⇒ 用「读断言清单」的结构锁或直接保留断言（不做变异，标注为**不可变异项**） |
| **K-14** | **`classifyPublishFields` 快照** | L4 | `semantic:'category'` 从 `semiCommon` 移入 `common` | 撤销注册表登记 | 快照必红（**同时证明 E-4 是有效锁**） |
| **K-15** | **测试本身被 CI 执行** | L1 接线 | `node --test scripts/check-unwired-tests.test.js` | 从 `quality-gate.yml` 删掉该 step | `check-unwired-tests` 必红（**这是「锁在跑」的元锁**） |

> **K-13 的说明**：不是所有断言都适合变异反证。计数对账的价值在「数字变了就红」，
> 删掉断言本身没有可观察的变异信号；此类锁用 **K-15 的元锁**（测试必须被 CI 点名）来保证其执行，
> 并在 PR 描述里要求**贴出真实产物里的这 5 个数字**。

---

## 4. 测试文件路径与断言要点

### 4.0 ⛔ 与在飞实现的对齐修正（**先读本节，否则下面多行断言会与代码冲突**）

`packages/shared-utils/src/platform-taxonomy.js` 已于 2026-10-13 23:50 写入（324 行），其接口与本文/ARCH 有 7 处分歧。
**下表把断言按「实际实现」改写，并标注哪几处必须先拍板**（对应 PRD §12 U-10）：

| # | 分歧 | 本文原断言 | **改为** | 状态 |
|---|---|---|---|---|
| A1 | `validateTaxonomy()` **校验块内 `id` 唯一**（`:289`） | `validateTaxonomy()` ⇒ `[]`（B-1） | **先删该校验**（真实数据 `bilibili/video` 3 组、`baijiahao/video` 8 组重复 ⇒ 现实现下**永远非空**）。改后断言：`validateTaxonomy()` ⇒ `[]`，且**人为造重复 `id` 仍须为 `[]`**（见 §2.6 Q1） | ⛔ **须先改代码** |
| A2 | **顶层字段是 `version`（非 `schemaVersion`）**，且无版本 fail-closed | E8「`schemaVersion:999` 抛错」 | 改为：字段名 `version`；未知版本的处理口径由 U-10 决定。**当前实现不 fail-closed** ⇒ E8 暂记为「待定稿后补」 | ⛔ 待拍板 |
| A3 | `loadTaxonomy` **任何失败都不抛**（`:62` 注释），返回空壳 + `__loadError` | E6/E7/E9「抛错」、B-9/B-10 | 改为：**返回空壳且 `__loadError` 非空**；`validateTaxonomy()` 把 `__loadError` 作为第一条 issue 返回。**若拍板改为抛错，则本节三条断言反向改** | ⛔ 待拍板 |
| A4 | `resolveCategoryId` 返回 `{ok:true,id,name,path,contentType}` / `{ok:false,reason,hint}` | B-3/B-4/B-5/E12「`=== null`」、N3/N4「`.id`」 | 负例改断言 `ok === false` + `reason === '<五成因之一>'`；正例 `hit.id`（`ok===true`）。**注意 `path` 是数组** ⇒ N4 改 `hit.path.join('/') === '生活/日常'` | 按实现改（已定档） |
| A5 | 节点深度字段名 **`depth`**（非 `level`） | B7/B8/Q5/Q7 的 `level` | 全部改 `depth`；`max(depth) === 3`（`baijiahao`） | 按实现改，但 **PRD/ARCH 的 `level` 需同步改** |
| A6 | `path` 是 **数组**（`string[]`） | Q2「`path` 唯一」用字符串比较 | 改 `node.path.join('/')` 后比较；`parentPath` 同样为数组（或按实现为准） | 按实现改 |
| A7 | `searchCategories` **空关键词返回 `[]`** | B4「返回全部节点」 | 改为断言 `[]`（更安全的行为）；「返回全部」改由 `getCategories` 承担 | 按实现改 |
| A8 | `getCategories` **缺 `contentType` 时抛错**（`:127`） | ARCH 写「可选」 | 断言 `assert.throws(...)`；这是**刻意的 fail-loud**（猜错会发到错分类），保留 | 按实现改（优于 ARCH） |
| A9 | 块级字段 `nodeCount` 必须等于 `nodes.length`（`:282`） | 本文 schema 未含 `nodeCount` | 新增断言；并把它写进 PRD §5.4 的 schema | 按实现改 |
| A10 | 复合键 `article:xxx`（同平台多来源表，`:94`） | 本文 schema 只有 `<contentType>` | 若启用，PRD §5.4 需补「同一 `contentType` 可有多块，键为 `<contentType>` 或 `<contentType>:<来源>`」，并明确 `read` 取第一个匹配 | 待拍板（是否真有多来源） |
| A11 | 模块被**渲染进程打包链**引用（`:44` 注释，`require` 包在 try 里） | PRD §4.4 走 IPC 拉取 | **冲突**：渲染进程无 `fs`。需定：渲染端走 IPC（PRD 方案）还是打包时把 JSON 内联（则该模块不能 `require('node:fs')`） | ⛔ 待拍板 |

**执行顺序**：先定 A1/A2/A3/A11（阻塞）→ 再落 A5/A6/A9（命名与字段）→ 其余按实现改。**A1 未修前，P0-2 的验收判据 ① 无法通过，任何「测试全绿」的声明都不成立。**

### 4.1 `scripts/import-platform-taxonomy.test.js`（**已存在，需修正**；`node --test`）

**修正清单（三处，均为 U-9 的内容）**：

| # | 现状 | 问题 | 修正 |
|---|---|---|---|
| 1 | `:134` `assert.ok(withData.length >= 7)` | 实测本项目 15 平台中**只有 6 个**有 ID 文件 ⇒ 该断言按正确映射**必然为假** | 改为 `assert.equal(withData.length, 6)`，并**新增** `coverage.filter(c => c.variant === 'name-only').length === 3` |
| 2 | `:39-41` `Buffer.from(content, 'binary')` 当作 GBK | `'binary'` = **latin1**，不是 GBK ⇒ **GBK 分支零覆盖** | 改为 §2.5 的 hex 字节法（C1~C4） |
| 3 | 无「同目录混编码」用例 | 编码混用是本数据集**已核实的真实属性**（60 GBK / 4 UTF-8 同目录） | 增加 C3；并断言 `utf8 + gbk + undecidable === 文件总数` |
| 4 | `:128` 数据集不存在时 `return`（静默跳过） | 「数据集不在 ⇒ 绿」会把「没跑」误报成「通过」 | 改为 `t.skip('数据集缺失')`（`node:test` 有显式 skip 语义，输出里可见） |

**必须保留的既有断言（它们是有效契约）**：
`:73-74`（`platforms.douyin.article.nodes.length === 2` 与 `.video.nodes.length === 2` 的形态断言）、
`:99-109`（图文/视频**同一 ID 21 不得互相覆盖** ⇒ `bilibili.article[0].name==='萌宠'`、`bilibili.video[0].name==='日常'`）、
`:111-125`（**产出不含空 id 节点**）、`:127-139`（真实数据集 **B站图文 38 / 视频 143**）、
`:141-150`（`source.snapshotDate` 匹配 `^\d{4}-\d{2}-\d{2}$` 且 `source.verifiedOnline === false`）。

**新增断言（编号与 PRD §11 对齐）**：A-3（`11623/64/28`）、A-4（`9/6/1269`）、A-5（键集合精确等于 6 个 slug）、
A-6（8 个块的节点数 `38/143/27/245/438/190/33/155`）、A-7（无空 id）、A-8（`unreadable` 为 `[]`）、
A-9（`utf8+gbk+undecidable === vendorFileCount`）、A-10（`snapshotDate`/`verifiedOnline`）、
A-11（产物文本不含参考产品名——用 `assert.ok(!/品牌正则/.test(text))`，正则按需从
`scripts/check-no-brand-residue.js` 的码点构造法复用，**不写字面量**）、
A-12/A-13/A-14（三种非零退出）、A-2（两次 SHA-256 相同，**夹具 ≥3 文件且文件名顺序 ≠ 期望序**）。

### 4.2 `packages/shared-utils/src/__tests__/platform-taxonomy.test.js`（**新增**；vitest）

**分组与断言**：

- `describe('loadTaxonomy')`：正常加载；缓存命中不重读；mtime 变化后重读；`force:true` 重读；
  抛错三例（文件缺失 / JSON 非法 / `schemaVersion:999`）—— **E6/E7/E8**。
- `describe('getCategories')`：未收录平台 → `[]`（**B1**）；`contentType` 过滤 → `bilibili` video **143** / article **38**（**B8**）；
  返回深拷贝（**B6/K-10**）。
- `describe('resolveCategoryId')`：**五种 `null` 成因各一例** + 三个正例（**N3/N4/N5**）+
  歧义 `null`（**E12/K-8**）+ `content-type-mismatch`（**E13**）。
- `describe('hasPlatformCategories')`：`douyin→true`、`kuaishou→false`、`youtube→false`、未收录→`false`。
- `describe('getTaxonomyCoverage')`：三档各一例 + 未收录平台的档位（定义为 `'absent'`，须断言）。
- `describe('searchCategories')`：空关键词（**B4**）、大小写不敏感（**B5**）、命中 `path` 任一层（**B10**）。
- `describe('validateTaxonomy')`：真实产物 → `[]`（**N2**）；人为破坏 `path` 唯一性/父子链 → 非空（**Q2**）；
  **含重复 ID 的产物仍返回 `[]`**（**Q1** —— 明确锁住「不做 id 唯一校验」这个刻意决定）。
- `describe('不变量')`：§2.3 的 B7/B8/B9 与 §2.6 的 Q5/Q6/Q7 逐条。

### 4.3 `apps/desktop/electron/services/publisher-router.test.js`（**追加 4 条**；vitest）

| # | 用例 | 断言 |
|---|---|---|
| D-1 | 既有用例 | **全绿**（不破坏 bilibili/youtube 合同）—— 回归底线 |
| D-2 | `category`(17) + `categoryName='生活/日常'` 同给 | `article.category === 17`（**精确层胜出 / K-5**） |
| D-3 | `platform='toutiao'` + `categoryName='三农'` | 失败码 `category-unsupported`；**且未调用引擎提交**（用 spy 断言零调用） |
| D-4 | `platform='douyin'` + `categoryName='不存在的分类'` | 失败码 `category-unresolved` |
| D-5 | 未给 `categoryName` | `article.category` 仍为 `21`（`bilibili` 默认行为不变）；**未新增** `categoryName` 字段 |

**若采用 PRD §4.3 的降级方案**（不改 `resolvePlatformArticle` 的返回结构）：D-3/D-4 改为断言
「不写字段 + warnings 数组含对应码」，并**在 PR 描述里显式声明**这是与 ARCH §3.6(a) 的差异。

### 4.4 `packages/shared-utils/src/__tests__/publish-capabilities.test.js`（**追加**；vitest）

- `E-1` `validateRegistry()` → `[]`。
- `E-2` 6 个平台的 `getPlatformOverrideFields(slug,{uiOnly:true})` 均含 `key==='categoryName'` 且
  `semantic==='category'`、`type==='category'`、`uiExposed===true`、`status==='implemented'`。
- `E-4` `classifyPublishFields()`：`semantic==='category'` 的条目在 **`common`**（≥3 平台）而**不在** `semiCommon`；
  快照断言同步更新（**K-14**）。

### 4.5 `apps/desktop/src/features/publish/publish-overrides.test.js`（**追加**；vitest）

- `E-3`：`normalizePlatformOverrides({bilibili:{categoryName:'生活/日常'}})` ⇒
  `result.bilibili.categoryName === '生活/日常'`（**K-7**）。
- 反向用例：**未登记**的字段名（如 `notRegisteredField`）被丢弃 ⇒ 证明这条锁确实在测「注册表驱动」这件事，
  而不是「任何字段都放行」。

### 4.6 数据自检（放在 L2 文件内的独立 describe）

`validateTaxonomy()` 的 8 条不变量逐条一例（正例 + 反例），其中 **反例必须是人为构造的坏产物**，
不得只依赖真实产物（真实产物全绿无法证明校验器有效）。

---

## 5. 数据对账基线（**断言里出现的每个数字都在此备案**）

| 断言对象 | 值 | 来源 |
|---|---|---|
| `source.vendorPlatformCount` | **31** | `_taxonomy-summary-v2.json` 的 `platforms[]` 长度 |
| `source.vendorFileCount` | **64** | 目录枚举（28 `categortmap` + 39 `subcategort`，3 个文件名同时命中两模式） |
| `source.vendorNodeCount` | **11623** | 64 个文件节点数**求和**（含仅名称镜像，**非去重值**） |
| `source.idFileCount` | **28** | 带 ID 的文件数（全部 31 平台，非本项目子集） |
| `source.slugsWithData` / `slugsWithId` / `importedNodeCount` | **9 / 6 / 1269** | PRD §2.1 / §2.2 |
| `platforms` 键集合 | `{bilibili, douyin, baijiahao, weibo, zhihu, tencent_video}` | 本项目 15 平台中带 ID 的 6 个 |
| `bilibili.article` / `.video` | **38 / 143** | `bilibilicategortmap.txt` / `bilibilivideocategortmap.txt` |
| `douyin.article` / `.video` | **27 / 245** | `douyincategortmap.txt` / `douyinvideocategortmap.txt` |
| `baijiahao.video` | **438** | `baijiavideocategortmap.txt` |
| `weibo.video` | **190** | `weibovideocategortmap.txt` |
| `zhihu.video` | **33** | `zhihuvideocategortmap.txt`（原件 UTF-8） |
| `tencent_video.video` | **155** | `tencentvideocategortmap.txt`（原件 UTF-8） |
| `bilibili/video` 重复 ID 组数 | **3**（`36`/`86`/`95`） | 本次实测 |
| `baijiahao/video` 重复 ID 组数 | **8**（`其他`×4、`资讯解读`×12、`教学`×18） | 本次实测 |
| 裸名歧义节点数（视频块） | **88 / 1204（7.3%）** | 本次实测 |
| `path` 唯一性 | **8/8 块、1,269 节点零重复** | 本次实测 |

**换快照时的处置**：这 12 行**必须一起改**，且改动要出现在 PR 描述里（这是一次**刻意的人工确认点**）。
建议在测试文件里把这组数字集中成一个 `EXPECTED` 常量对象，改名/改值都在一处，评审时一眼可见。

---

## 6. 门禁与接线检查表

| # | 检查 | 命令 / 判据 | 谁来做 |
|---|---|---|---|
| **F-1** | 变更类型判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **必须 `false`**（含代码 ⇒ 走完整质量节拍） | 每个 PR |
| **F-2** | 品牌残留 | `node scripts/check-no-brand-residue.js` | 每个 PR |
| **F-3** | zh/en 成对 | `node .github/scripts/check-locale-sync.js --pair-base origin/main`（新增 `publish.category.*` 10 个 key 必须 zh/en 同在） | 做 §8.3 文案的 PR |
| **F-4** | 文本编码完整性 | `node scripts/check-text-encoding-integrity.js`（**GBK 夹具不得入库** ⇒ 必须走 §2.5 的运行时构造） | 每个 PR |
| **F-5** | QM-1 打包 | `cd apps/desktop && pnpm exec electron-builder --win --x64`（改了 `electron/**` 时必须） | 改主进程/preload 的 PR |
| **F-6** | 测试接线（**元锁**） | `node --test scripts/check-unwired-tests.test.js`；且 `node --test scripts/import-platform-taxonomy.test.js` 已被 `.github/workflows/quality-gate.yml` 的**可执行正文**点名 | P0-1 的 PR **必须同 PR 完成** |
| **F-7** | preload bundle | `pnpm run build:preload` 后断言 `apps/desktop/electron/preload/index.bundle.js` 含 `taxonomy:categories` | 新增 IPC 的 PR |
| **F-8** | IPC 清单 | 新增通道后 `01-docs/ipc-manifest.md` 含该通道（`scripts/ipc-manifest-registrar.js`） | 新增 IPC 的 PR |
| **F-9** | 测试文件位置规范 | 断言测试文件与被测文件同目录（`shared-utils` 用 `src/__tests__/`） | review |

---

## 7. 手工与真机验证（不可自动化）

| # | 验证 | 步骤 | 通过判据 | 为什么自动化不了 |
|---|---|---|---|---|
| **M-1** | **分类 ID 是否仍有效**（N-1 / PRD U-1/U-2 的解除方式） | 在 B 站创作者后台发一条**显式指定分类**的内容（`categoryName='生活/日常'` ⇒ `tid=21`） | 平台接受且内容落在预期分区 | 需要真实账号、真实平台；且**只能证「这一个 ID 有效」**，不能证全表 |
| **M-2** | **注册表 vs 快照的 4 处标签矛盾**（`124/231/207/251`） | 在平台后台把分区切到 124，读界面显示的中文名 | 与快照一致 ⇒ 快照对；与注册表一致 ⇒ 注册表对 | 同上；这是 PRD U-2 的**唯一**解除路径 |
| **M-3** | `tencent_video` 的 slug 归属（PRD U-1） | 打开 `packages/api-publish-engine/src/adapters/shipinhao.js` 的接口域名，对照 `mediadatamgr.ini` 的 `21=腾讯视频` / `53=视频号` | 能唯一确定该 slug 指哪个平台 | 需要产品负责人裁决 |
| **M-4** | 分类控件在打包应用里的可用性 | 打包 → 启动 → 发布页选 B 站 → 观察分类控件与文案② | 控件可见、层级可下钻、ID 弱化显示、过期提示出现 | 需真实 Electron 窗口（IPC 在浏览器里静默 fallback，见 AGENTS.md QM-2） |
| **M-5** | 文案②的阈值边界 | 把 `MP_TAXONOMY_STALE_DAYS` 设为 `1` / `9999` / 非法值 | `1` ⇒ 显示过期提示；`9999` ⇒ 不显示；非法值 ⇒ 回落 180 **并出声告警** | 需运行期环境变量与界面观察 |

---

## 8. 退出判据（Definition of Done）

1. L1~L5 五层测试**全绿**，且 L1 已被 CI 实际执行（F-6 的元锁通过）。
2. §3 的 15 条锁中，**K-1~K-12、K-14、K-15 均实跑过一次变异反证**，PR 描述里附「变异 → 变红条数」。
3. §5 的 12 行对账数字在真实产物上**逐条核对**并把产物 SHA-256 贴在 PR 里。
4. §6 的 F-1~F-9 全部通过（含 F-3 locale 成对、F-4 编码门禁）。
5. §7 的 M-1/M-2 至少各做一次并记录结论（**做不到就如实登记为未闭合**，不得以「测试全绿」代替）。
6. PRD §12 的 U-1~U-9 逐条给出结论或明确的「未解阻 + 降级已生效」。

---

## 9. 未覆盖与已知边界（不假装已闭合）

| # | 未覆盖 | 后果 | 处置 |
|---|---|---|---|
| G-1 | **平台侧 ID 的有效性** | 用户可能选到平台已删除的分类 ⇒ 提交被拒 | 平台会拒（不会发到错分类）；失败如实上报（FL-11）；UI 文案② |
| G-2 | **「平台静默接受了一个语义已变的 ID」** | 内容发到语义已变的分类，**本仓与用户均不可察** | **本计划明确不声称覆盖**。唯一的判定路径是 M-1/M-2 的联网校验（PRD §10.2 残余风险） |
| G-3 | DOM/RPA 轨的分类写入 | `weibo`/`zhihu`/`toutiao`/`wechat_mp` 虽有分类数据/ID，但分类字段**到不了平台** | 本轮不做（PRD O-3/N-2）；ID 已入库，待 RPA 选择器接线后另立测试计划 |
| G-4 | 产物体积与加载耗时 | 若远超 1.5 MB 会影响冷启动 | 归性能验证（N-4，PRD U-5） |
| G-5 | `name-only` 平台（`toutiao`/`kuaishou`/`wechat_mp`）的分类正确性 | 只有名称、没有 ID ⇒ 只能做 UI 提示，无法验证「名称与平台一致」 | 只断言 `variant==='name-only'` 与「不写字段」；**不断言名称正确**（无参照物） |
| G-6 | 数据前缀 `weixin` 到底对应公众号还是视频号（PRD U-4） | `wechat_mp` 的 `coverage.sourceFiles` 可能挂错前缀 | 采用 U-4 的降级：`reason` 只写 `vendor-provides-names-only`，**不写「公众号」字样**，因此不产生错误断言 |
| G-7 | 转换器对**第 7/8 种未发现形态**的鲁棒性 | 若数据里还存在未识别形态，`unreadable[]` 非空 ⇒ exit 1（**不会静默少算**） | 这正是 fail-loud 的设计目的；届时补遍历器（PLAN §2 P0-1 的【阻塞 U-5】） |
