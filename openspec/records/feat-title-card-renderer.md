---
record: feat-title-card-renderer
task: 把「文字标题卡出图」从测试桩提炼为桌面主进程的可复用模块，并接回素材出图兜底
date: 2026-10-24
---

## 本次执行记录：文字标题卡渲染能力落地（feat-title-card-renderer，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/services/title-card-renderer.js` 新增 + `asset-generator.js` 接入）+ 文档（`01-docs/PRD-video-creation.md` §13）⇒ 隔离 worktree `/workspace/mp-worktrees/mp-feat-title-card-renderer`、裸分支 `feat-title-card-renderer`（`git branch --show-current` 实证）；共享根保持 main clean |
| 第一性原因（QM-5 ①） | ✅ | 本片要解决的不是「某个 bug」，而是**能力没有归属**：标题卡渲染只以「测试桩里的 40 行 ffmpeg 参数」的形式存在于 `apps/desktop/tests/e2e/lib/local-provider-hub.js`，生产侧无人可用。生产侧唯一的同类能力是 `asset-generator.js` 的 provider 失败兜底（内联 drawtext），它**没有标题安全区** ⇒ 合成默认的 zoom-in（1.0→1.25 居中裁切，左右各裁 10%）会把边缘文字**无声切掉**：实测「好消息是」在成片里变成「消息是」，成片不报错、不降级、只是少字。**落点的第一性判据**：能力必须落在**今天真的跑得通的那条链路**上 |
**顺带挖出既有静默失败**：既有 `escapeDrawtextText` 把单引号转义成 `\'`，而 ffmpeg 的 filtergraph 引号规则
要求写成 `'\''`（闭合-转义-重开）⇒ 旧写法在 `text='...'` 里**提前闭合引号**，后半段文本被当成
filter 参数：含 `{word}` 时报 `Option 'w' not found`（直接失败），不含大括号时 **rc=0、不报错、
产出 630 字节空白图**（正常有内容的卡片同尺寸是 3210 字节）⇒ 英文提示词里的 `'s` 极常见，
命中即空白占位图而流水线一路绿灯。**旧实现的这条转义从未被带引号的文案测过** |
| 逃逸分析（QM-5 ②） | ✅ | ① **没有能力层**：仓库里「文字转 PNG」有 3 处实现 —— Python `diagram_gen._render_text_card`（单色等宽字体、左对齐、固定 40px 边距）、`code_snippet`（Pygments 代码图）、桌面 `asset-generator` 兜底（单色 + 30 字居中）；**三处各缺各的**（无分层、无安全区、无折行、Python 两处还用 `arial.ttf`/`consola.ttf` 回落 `load_default()` ⇒ **中文必是豆腐块**）。② **落点陷阱**：Python `video_creation/providers/image/` 看着是「程序化出图的家」，但调研证实它是**纯声明、无执行体** —— `registry.discover()` 生产 0 调用、`tools_available`/`required_tools` 全仓 JS/TS 0 命中、Python 侧**没有 pipeline engine**、桌面 `pipeline-engine.js` 用自己的 15 条硬编码注册表**从不读 YAML**、`ServiceBus.callPythonSkill` 打的 `/api/skills/*` 路由在 Python 后端**不存在** ⇒ 在那儿加工具会重蹈 `diagram_gen` 覆辙。③ **断言层**：既有断言只看「有路径 / 有音频流 / 规格合规」，**没有任何断言能看见「字被裁掉了」** —— 缺陷在断言层完全隐形。④ **静默面**：占位图失败时 `degraded: true` + `source: 'ffmpeg-placeholder'` 是**发布侧「占位图不得当成功封面」防线**的输入（`publish.js` / `video-clone` / `ResultView` 按**字符串**匹配）⇒ 改造不得改这个字面量。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `apps/desktop/electron/services/title-card-renderer.js`（`renderTitleCard` / `computeCardLayout` / `wrapText` / `normalizeOptions` / `escapeDrawtextText` / `THEMES` / `SAFE_MARGIN_RATIO`）。② **安全区做成可机械断言的契约**：`computeCardLayout` 是纯函数，测试直接断言「所有 drawtext 的 x ≥ margin」且「margin ≥ width×0.10」，而不是断言「渲染出来好看」。③ **接入兜底**：`asset-generator.js` 的 provider 失败分支改调本模块（顺带**净减 22 行**，该文件在「点名还账」名单里、零增长容差 ⇒ 替换而非新增是唯一可行路径）。④ **降级语义不变**：`source: 'ffmpeg-placeholder'` + `degraded: true` 逐字保留。⑤ **公共 API 不破**：`escapeDrawtextText` 从 `asset-generator` **迁到**渲染器（迁的是「drawtext 文本转义」的固有归属），`asset-generator` 改为转发并再导出 ⇒ **外部 require 路径不变**，且用「同一函数引用相等」断言锁住。⑥ **打破循环依赖**：渲染器与 `asset-generator` 互相 require 会让 CommonJS 有一边拿到未完成 exports（转义函数变 undefined）⇒ 转义函数迁到渲染器后**环消失**，无 require 环。
⑦ **修掉既有单引号转义**：`'` 的转义从 `\'` 改为 `'\''`（ffmpeg 在单引号语境下的唯一正确写法）。
   顺带发现一条**既有静默失败**：旧写法在无大括号的文案上 rc=0 但产出空白图（实测 630 vs 3210 字节）⇒
   素材占位图会变成空白图而流水线一路绿灯。
⑧ **ffmpeg 可执行性回退**（`resolveFfmpegBinary`）：`media-tool-paths.findFfmpeg()` 只判「文件存在」
   不判「能不能执行」⇒ 本模块逐个候选过可执行性校验，不可用就换下一个（PATH 上的 ffmpeg），
   全部不可用时给出明确错误而不是甩 `EACCES`。⑦ 新增单测 `title-card-renderer.test.js`（vitest 按 `electron/services/**/*.test.js` 自动收集 ⇒ 接线棘轮天然满足）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **能力单一归属**：标题卡渲染只此一份实现；`asset-generator` 不再自带一份 ffmpeg 参数。② **安全区写成契约**：`SAFE_MARGIN_RATIO` 常量 + 注释里写清来源（zoom-in 1.25 的裁切量 10%）与推导（取 13% 留 3% 余量）。③ **断言挡静默失败**：渲染类断言除 PNG 魔数外还卡 **体积下限 3000 字节**（豆腐块会退化成 ~765 字节 ⇒ 挡住「渲染了但字全是方块」）。④ **字体不自己找**：复用 `font-resolver.buildDrawtextFontOption()`，不再出现第二套找字体逻辑（Python 侧正是在这点上栽了：`arial.ttf` → `load_default()` ⇒ 中文必豆腐块）。⑤ **降级路径可解释**：渐变失败自动回退纯色并置 `degraded: true`，不因「要好看」让整条出图失败。⑥ **ffmpeg 滤镜特殊字符**纳入用例（`'` `:` `,` `%` `{` `}` `\`），且单引号用例**断言「真渲染出内容」**
   （体积 > 2000 字节）—— 这正是「rc=0 但空白图」那种静默失败唯一能被抓住的判据。⑦ **Python 侧的空缺登记在 PRD §13.10**，并写清「若将来补，须同时补齐哪三处」—— 防止下一个维护者只加个文件就以为能用。 |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| 接线棘轮 | ✅ | 新增 `apps/desktop/electron/services/title-card-renderer.test.js` 落在 vitest include 的 `electron/services/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 的判定域不含 `apps/`（WORKSPACE_COVERED），无新增欠账 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：改动落在 `apps/desktop/electron/services/` ⇒ 已执行打包 + 启动判据（下详）。QM-4：**未触碰任何 `.vue` / 样式 / locale 文件**，无视觉面变更 ⇒ N/A（产出是程序化 PNG，不是 UI 组件） |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 落点调研的实测依据（避免把能力放成死代码）

「放在 Python 侧 `video_creation/providers/image/`」看着最合规（`diagram_gen` / `code_snippet` 就在那），
但调研证明那条链**今天没有执行体**：

| 证据 | 检索命令 | 结果 |
|---|---|---|
| 注册表在生产是空的 | `grep -rn "\.discover(" packages/python-backend/src/` | **0 命中**（只有测试调用）⇒ `image_selector.execute()` 读到空候选集 |
| 工具名无人消费 | `grep -rn "tools_available\|required_tools\|optional_tools" --include=*.js apps/ packages/` | **0 命中** |
| YAML 只被读取不执行 | `grep -c "yaml\|definitions" apps/desktop/electron/services/pipeline-engine.js` | **0** ⇒ 桌面用自己的 15 条硬编码注册表 |
| Python 侧无 pipeline engine | `VC/pipeline/` 目录 | 只有 `loader.py` + `definitions/` + schema |
| 桌面→Python 的技能桥是断的 | `grep -rn "api/skills" packages/python-backend/src/` | **0 命中**（路由不存在；仓库自己记在 `.ccg/tasks/archive/2026-09/story2video-all-pipelines-e2e-ue/ENGINE-FEASIBILITY.md`） |
| 同族工具无消费者 | `grep -rn "diagram_gen\|code_snippet" --include=*.js apps/ packages/` | **0 命中**（只有 `providers/image/__init__.py` 导入注册） |
| YAML 里引用的 agent skills 不在仓内 | `grep -rln "executive-producer"` | 只命中 YAML 自身 |

⇒ **在 Python 侧加同名工具会得到「注册了、声明了、没人用」的结果** ⇒ 本片改落桌面主进程侧，
并把「Python 侧若要补须同时补齐哪三处」写进 PRD §13.10（`registry.discover()` 的生产调用点 /
`/api/skills/title_card` 路由 / `providers/image/__init__.py` 导出与 `test_image_providers.py` 的硬编码计数）。

### 新增/修改清单（供评审逐条对照）

| 文件 | 动作 | 行数影响 |
|---|---|---|
| `apps/desktop/electron/services/title-card-renderer.js` | **新增** | +349（< 500 行债务阈值） |
| `apps/desktop/electron/services/title-card-renderer.test.js` | **新增** | +N（vitest 自动收集） |
| `apps/desktop/electron/services/asset-generator.js` | 改：兜底分支改调渲染器；`escapeDrawtextText` 迁出并转发 | **净减 22 行**（该文件在「点名还账」名单、零增长容差 ⇒ 替换而非新增是唯一可行路径） |
| `01-docs/PRD-video-creation.md` | 改：新增 §13 | +162 |

## CHANGELOG 条目

# feat(视频创作): 文字标题卡渲染抽成可复用模块，素材出图兜底顺带修好「边缘文字被合成动效切掉」（feat-title-card-renderer）

- feat(视频创作): 新增「文字标题卡」渲染能力：给定标题/副标题/画幅，**确定性地**产出一张 PNG（不调 AI 服务、无外部网络、同输入必得同输出），可当标题卡、字幕卡、封面卡、章节卡、演示要点卡。
- fix(视频创作): 素材出图的 provider 失败兜底此前是「单色底 + 提示词前 30 字居中」，**没有标题安全区** —— 合成阶段默认的放大动效会把画面放大并居中裁掉左右各 10%，边缘文字被**无声切掉**（成片能播、不报错、不降级，只是少字）。现已改走标题卡渲染器：完整文案折行显示、按安全区内缩。
- fix(视频创作): 兜底占位图此前**没有标题层级**，现改为「标签 + 主标题 + 副标题 + 进度条 + 序号」分层，且背景由纯色升级为渐变（用户机器上的 ffmpeg 过旧时自动回退纯色，不影响出图成功）。
- fix(视频创作): 素材占位图的文案里**带单引号时会静默变成空白图** —— 旧转义把 `'` 写成 `\'`，而 ffmpeg 的滤镜语法要求写成「闭合-转义-重开」，旧写法会提前闭合引号、把后半段文本当成滤镜参数：文本含 `{word}` 时直接报「选项 w 不存在」，不含大括号时**不报错、rc=0、产出空白图**。英文提示词里的 `'s` 极常见 ⇒ 命中即空白图，而流水线一路绿灯。现已按 ffmpeg 的真实语法修正。
- refactor(视频创作): 「用文字做一张卡」此前散落三处（各缺各的：无分层、无安全区、无折行，其中两处的字体回落路径渲染不了中文）。现收敛为**单一实现**，跨流水线复用；字体统一走仓库既有的 CJK 字体解析，不再各找各的。
- docs(视频创作): PRD 增补 §13，写清数据合同与校验、渲染流程与产线口径、标题安全区的来源与推导、显示项与交互、错误语义与降级、调用示例、验收矩阵，以及「为什么不在 Python 侧做同名能力」的实测依据（那条链今天没有执行体，在那儿加只会重蹈既有工具的覆辙）。

## learnings

### lesson: verify-against-the-original-not-against-yourself-after-refactoring

**现场**：把 `escapeDrawtextText` 从 `asset-generator.js` 迁到新模块后，我写了个「两者等价」的检查：
`require('title-card-renderer').escapeDrawtextText` vs `require('asset-generator').escapeDrawtextText`
⇒ 打印「11 组用例全部一致 ✅」。

**根因**：迁移时我**先把 `asset-generator` 里的原定义删掉、改成转发**，**之后**才跑等价检查 ⇒
两边拿到的是**同一个函数对象** ⇒ 该检查**恒真**，无论实现被改成什么样都会「通过」。
它唯一验证到的事实是「asset-generator 的导出确实指向渲染器」——而那正是我改出来的，**不是**「行为没变」。

**可复用的 N 条**：

1. **等价性检查的「参照物」必须是迁移前的原版**，不能是迁移后的自己。要么在改代码**之前**把原实现
   抽成 fixture 冻住，要么用 `git show <base>:<path>` 取出原版单独求值再对拍。
2. **恒真的检查比没有检查更坏**：它会让人以为「这块验过了」。凡是「A 与 B 一致」型断言，
   都要先问一句「A 和 B 会不会其实是同一个东西」。
3. **本次是单测救回来的**（那条逐字期望的用例红了 ⇒ 期望值写错；顺带暴露出真正的单引号转义缺陷）。
   但更值得注意的是：**期望值本身也是我写的**，如果我照着自己实现的行为写期望值，它同样会绿。
   ⇒ 期望值必须**独立于实现**推导（从 ffmpeg 的语法规则推、或从原版行为推）。
4. **「实现与原版等价」和「实现对不对」是两个问题**。本例两者都破了：等价性检查恒真没发现，
   而正确性由单测 + ffmpeg 实测对拍才发现。**迁移类改动必须同时做这两件事**。

### lesson: a-capability-must-land-on-the-path-that-actually-runs-today

**现场**：要把「文字标题卡出图」抽成可复用能力。最合规的落点是 Python `video_creation/providers/image/`（`diagram_gen` / `code_snippet` 就在那，同属"程序化出图"）。调研后才发现那条链**今天没有执行体**：注册表在生产是空的（`registry.discover()` 零调用）、工具名在 JS/TS 里零命中、Python 侧没有 pipeline engine、桌面用自己硬编码的注册表从不读 YAML、连 `callPythonSkill` 打的 `/api/skills/*` 路由都不存在。

**根因**：**「目录归属正确」不等于「能力可被调用」**。前者回答"放哪儿像"，后者回答"放这儿有没有用"。本仓里 `diagram_gen` / `code_snippet` / `showcase_card` 三者都在 YAML 里"声明"过、也在注册表里"注册"过，但没有一条活的消费链 —— 看着齐备，实则够不着。

**可复用的 N 条**：

1. **定落点时先问「这条路径今天真的跑得通吗」**，而不是「这一类东西通常放哪儿」。判据是**可达性**，不是**同类性**。
2. **「注册了」「声明了」「有人调」是三件事**。仓库里同时存在「有注册无发现」「有声明无执行体」两种空转 —— 找一条**活的**消费链（这里：桌面 `asset-generator` → `model-provider-manager` → adapter）比新造一条可靠。
3. **能力落地后要验证「它真的被调用」**，而不是「它被注册了」。本片的验收是「素材出图兜底真的走了新渲染器」，不是「模块可以被 require」。
4. **空缺要登记成「待补清单」而不是「补个文件就算数」**。本片把 Python 侧的缺口写进 PRD §13.10，并列出将来补齐必须同时动的三处（注册发现的生产调用点 / HTTP 路由 / 硬编码计数）—— 否则下一个维护者会以为只加个文件就能用。

### lesson: silent-visual-defects-need-layout-level-assertions

**现场**：兜底占位图的边缘文字在成片里被切掉（「好消息是」→「消息是」）。现有验收全绿：成片能播、时长正常、有音轨、不报错、不降级。

**根因**：缺陷的形态是**版面**问题，而现有断言全是**信号级**（有没有产出、对不对得上规格）。「字少了一个」既不改变文件大小、也不改变时长、不产生任何错误码 —— 信号级断言原理上看不见它。

**可复用的 N 条**：

1. **把版面计算抽成纯函数，断言就有着力点**。本片抽出 `computeCardLayout`（无 IO），于是可以直接断言「所有文字的 x ≥ 安全区边界」「内容宽度 ≤ 画幅 − 两侧边距」—— 这类断言能机械判定，不依赖肉眼。
2. **静默缺陷要用「产物有效性」判据，不只是「产物存在」**。本片除 PNG 魔数外还卡**体积下限 3000 字节**：豆腐块（字体解析失败）会退化成 ~765 字节，于是「渲染了但字全是方块」也能被挡住。
3. **阈值要从事故里取数，不是拍脑袋**。安全区 13% 来自「zoom-in 放大到 1.25 倍 ⇒ 左右各裁 10%」这条推导；3000 字节下限来自实测的「正常 PNG 5495 字节 / 豆腐块 765 字节」。两个数都有出处。
4. **先量出静默失败的物理机制，再决定约束写在哪**。本例的机制是「缩放裁切」，约束就落在**边距**上；机制若是「字体缺字」，约束就该落在**体积/像素统计**上。约束写错层，等于没写。

### lesson: a-shared-helper-must-not-create-a-require-cycle

**现场**：把「标题卡渲染」抽成独立模块时，它需要 `escapeDrawtextText`（ffmpeg drawtext 文本转义），而那个函数住在 `asset-generator.js`；同时 `asset-generator.js` 又要调用新渲染器（占位图兜底）—— **互相 require，环**。

**根因**：CommonJS 循环 require 下，有一边的 `module.exports` 尚未填完，另一边拿到的是 `undefined`（本例：`escapeDrawtextText` 会在渲染时炸）。更隐蔽的是**它不会在加载时报错**，只在真正调用到那个函数时才崩 —— 很容易被误判成"别的 bug"。

**可复用的 N 条**：

1. **共用工具的归属应当是"这件事本身的固有部分"**，不是"谁先用它"。`escapeDrawtextText` 是「渲染 drawtext 文本」的固有部分 ⇒ 归渲染器；`asset-generator` 转发并再导出 ⇒ **外部 require 路径不变、公共 API 不破**。
2. **迁移 + 转发 + 断言同一性**，三步一起做：定义搬走、原位置改为 require 转发、导出列表保留 ⇒ 调用方零改动。用「`a === b` 的函数引用相等」当回归锁，比逐个用例比对输出更直接地锁住"没换成另一份实现"。
3. **循环依赖不会在加载时报错**，所以要主动查：新增/移动 require 后，用一条机械检查确认依赖图无环（本仓 `scripts/check-debt-budget.js` 的 `checkCircularDeps` 已覆盖全仓，我直接跑了它）。
