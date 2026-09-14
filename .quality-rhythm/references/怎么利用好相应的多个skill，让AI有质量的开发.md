

# 为了良好顺利的实现这个复用和代码集成，你建议我使用这个文档中的哪些skill来保证开发质量：E:\Data\03-obsidian-all\10.projects\项目开发和管理\我装的所有与产品需求、开发规范和流程有关的skill.md

说这句：
继续推进，使用质量节拍 skill来进行（读取 C:\Users\邱领\.agents\skills\质量节拍\SKILL.md 并按照内容执行）

---

这个文档太有料了！51 个技能全景覆盖。针对参考产品复用集成这个场景，我按 **使用顺序** 推荐以下技能：

---

## 推荐的技能与使用流程

### 📋 阶段一：集成前规划 — 保证"选对了"

|技能|为什么用|
|---|---|
|**`doubt-driven-dev`**|参考产品代码是 8.4MB webpack 打包产物，很多 API 端点/签名算法需要 **质疑式验证**——每个复用点都问"这个真的能用吗？"|
|**`/plan-eng-review`**|架构深度审查——新的 `signer-local.js` 替代远程签名后，需要检查架构是否合理、降级策略是否正确|
|**`documentation-and-adrs`**|记录架构决策：为什么选本地签名代替远程服务、为什么选这些平台优先实现|

### 🛠 阶段二：集成开发 — 保证"写对了"

|技能|为什么用|
|---|---|
|**`test-driven-development`**|**最核心的技能！** 对每个从参考产品复制的函数，先写测试再集成。特别是签名算法（CSDN HMAC、小红书 X-s/X-t）——没测试验证就不知道复制的对不对|
|**`testing-anti-patterns`**|禁止 mock 行为——验证签名算法要 **真实计算后对比**，不能 mock 掉 crypto 来"假装"测试通过|
|**`incremental-impl`**|10 个平台适配器不要一口气写完。一次 1 个平台：写适配器 → 写测试 → 验证 → 下一个|
|**`code-simplification`**|参考产品的 webpack 打包代码很冗余。每个复用的函数都要 **简化**——去掉混淆变量名、不必要的 try-catch、死代码|
|**`context-engineering`**|跨文件上下文管理——API 引擎涉及 index.js/signer.js/signer-local.js/base-adapter.js + 10 个适配器，要保证上下文不泄漏|

### 🔍 阶段三：集成后验证 — 保证"测过了"

|技能|为什么用|
|---|---|
|**`/review`**|对新集成的代码做审查——逻辑错误、安全风险、边界情况。特别是从逆向工程来的代码，要检查有没有硬编码敏感信息|
|**`/qa`**|全平台端到端测试——用 `test-publish.js` 逐平台扫码登录 + API 发布验证|
|**`code-review-and-quality`**|代码质量深度审计——检查复用的代码是否符合项目的编码规范、是否有重复代码|
|**`/cso`**|安全审计——参考产品代码中的密钥（CSDN `9znpamsyl2c7cdrr9sas0le9vbc3r6ba`）、签名算法是否有安全风险|
|**`/health`**|集成后的代码健康度检查——确保没有引入死代码、类型错误、lint 警告|

### 🚀 阶段四：集成收尾 — 保证"交付了"

|技能|为什么用|
|---|---|
|**`finishing-a-development-branch`**|标准化分支完成流程——测试 → 选项(merge/PR/清理) → 执行 → 清理|
|**`/document-release`**|生成发布说明——记录本次新增的 3 个工具模块 + 3 个平台适配器|
|**`/retro`**|复盘这次集成——什么做得好、哪里翻车了、下次怎么改进（特别是 FUSE 踩坑）|

---

### 🏆 最推荐的 TOP 5

如果只能选 5 个，优先级如下：

1. **`test-driven-development`** — 没测试什么复用都是盲人摸象
2. **`doubt-driven-dev`** — 参考产品的代码必须质疑每个假设
3. **`/review`** — 逆向工程来的代码必须审查
4. **`code-simplification`** — webpack 打包的代码太臃肿，必须简化
5. **`incremental-impl`** — 一个一个平台来，别贪多

> **建议：** 下一轮集成下一个平台（比如爱奇艺号/大鱼号）时，先 `test-driven-development` 写测试，再用 `incremental-impl` 一次一个平台，然后用 `/review` 审查，最后 `incremental-impl` 保证节奏。

---


好，我已经完整读完你的 skill 清单。结合这个 OpenMontage → Multi-Publish 迁移项目的具体需求，我按**使用阶段**精选出最关键的 15 个 skill：

---

## 阶段一：开发前（规划与设计确认）

### P0 — 必须用

1. **`/plan-eng-review`** — 架构深度审查
    
    - **用途**：对迁移计划做架构评审，重点审查：Python 工具链如何桥接到 Electron、IPC 协议设计、渲染引擎扩展方案
    - **时机**：Phase 1 开始前
2. **`/plan-design-review`** — 设计审查
    
    - **用途**：审查 Phase 1 新增的 12 个 Vue 组件和 CreateView 重构方案（主题选择、场景编辑器、叠加层配置）
    - **时机**：Phase 1 编码前
3. **`spec-driven-development`** — 规范驱动开发
    
    - **用途**：OpenMontage 的代码本身就是规范。这个 skill 确保"从 OpenMontage 的源代码推导出接口定义，再在 Multi-Publish 中实现"，而不是凭记忆乱写

### P1 — 强烈建议

4. **`incremental-implementation`** — 增量实现
    - **用途**：强制按 Phase 小步推进，每个 Phase 有明确的前后条件，禁止"一步到位"式重构

---

## 阶段二：编码阶段（TDD + 质量内建）

### P0 — 必须用

5. **`test-driven-development`** — 测试驱动开发
    
    - **用途**：所有新增组件/函数都必须先写测试。尤其是：
        - `render-engine.js` 扩展后（测试各 Composition 参数传递）
        - Python 桥接 IPC（测试调用/返回/超时/失败场景）
        - 前端组件（测试 loading / empty / error 三态）
6. **`doubt-driven-development`** — 质疑驱动开发
    
    - **用途**：在复用 OpenMontage 代码时，主动质疑每个假设："这个参数真的需要吗？这个函数能在 Windows Electron 环境跑吗？这个 Python 库用户电脑上有吗？"

### P1 — 强烈建议

7. **`source-driven-development`** — 源码驱动开发
    
    - **用途**：每次需要理解 OpenMontage 的某个功能时，先用这个 skill 看源码再动手。避免"我以为它是什么"的偏差
8. **`code-simplification`** — 代码简化
    
    - **用途**：OpenMontage 有些 Python 工具为了通用性写得比较厚。迁移到 Multi-Publish 时，用这个 skill 做减法——只保留 Multi-Publish 需要的部分

---

## 阶段三：代码评审（质量门禁）

### P0 — 必须用

9. **`/review`** — 代码审查
    - **用途**：每 2-3 个功能做一次整库扫描。按 AGENTS.md 的规范输出：
        
        ```
        🔴 CRITICAL | 文件:行号 | 描述 | 修复建议
        🟠 MAJOR   | 文件:行号 | 描述 | 修复建议
        🟢 MINOR   | 文件:行号 | 描述 | 修复建议
        ```
        
    - **关键审查点**：Electron 子进程管理（进程泄漏）、Python 桥接安全性、API Key 存储

### P1 — 强烈建议

10. **`testing-anti-patterns`** — 测试反模式
    
    - **用途**：审查测试时用的，确保不 mock 不该 mock 的东西。比如 RenderEngine 测试不要 mock spawn 成"永远成功"
11. **`/guard`** — 安全门禁
    
    - **用途**：在 Python 工具链集成时（Phase 3），扫描是否引入了 shell 注入、eval、硬编码密钥等

---

## 阶段四：集成验证

### P0 — 必须用

12. **`verification-before-completion`** — 完成前验证
    - **用途**：每个 Phase 结束前，对照 PRD 的验收标准逐条验证。验证清单：
        - 渲染命令能跑通
        - IPC 通信正常
        - 前端渲染成功
        - 离线可用

### P1 — 强烈建议

13. **`/qa`** — 全量质量验证
    
    - **用途**：Phase 1 完成后做一次全量 QA，覆盖：功能、视觉、响应式、离线场景、错误恢复
14. **`/investigate`** — 根因调试
    
    - **用途**：集成过程中肯定会出现"OpenMontage 里能跑，到了 Multi-Publish 就跑不了"的问题。用这个 skill 严格执行"没有根因就不能修"

---

## 阶段五：收尾沉淀

### P1 — 强烈建议

15. **`/learn`** — 经验学习管理
    - **用途**：把这次迁移过程中踩过的坑、发现的兼容性问题、剪裁掉的代码记录下来。以后再有类似项目直接查 `learnings`

---

## 按 Phase 的技能使用推荐表

|Phase|阶段|必须用（P0）|建议用（P1）|
|---|---|---|---|
|**Phase 1** 基础渲染|编码前|`/plan-eng-review`, `spec-driven-dev`|`incremental-impl`|
||编码中|`TDD`, `doubt-driven-dev`|`source-driven-dev`, `code-simplification`|
||编码后|`/review`, `verification-before-completion`|`/qa`|
|**Phase 2** 多模式|编码前|`/plan-design-review`||
||编码中|`TDD`, `doubt-driven-dev`|`frontend-ui-engineering`|
||编码后|`/review`, `verification-before-completion`|`testing-anti-patterns`|
|**Phase 3** Python 工具链|编码前|`/plan-eng-review`|`api-and-interface-design`|
||编码中|`TDD`, `doubt-driven-dev`|`security-hardening`, `observability`|
||编码后|`/review`, `/guard`, `/investigate`|`systematic-debugging`|
|**Phase 4** Pipeline 编排|编码前|`/plan-ceo-review`|`writing-plans`|
||编码中|`TDD`, `spec-driven-dev`|`subagent-driven-dev`|
||编码后|`/review`, `verification-before-completion`|`documentation-and-adrs`|
|**Phase 5** 增强完善|编码后|`/qa`, `/review`|`/retro`, `/learn`|

---

**一句话建议**：最少可用集是 **TDD + source-driven-dev + /review + verification-before-completion**，这 4 个就能兜住 80% 的质量风险。如果只能选一个，**TDD 优先级最高**——这个迁移项目最怕的是"OpenMontage 里好的测试全丢了，新代码又没补测试"。

---

明白了，你要的是**全量技能覆盖**，一个不落。我来从 51 个 skill 中筛选出所有适用于这个迁移项目的，按**使用阶段 + 目的**完整列出。

---

## 最大可用集：全 37 个适用 Skill

### 一、需求与规划阶段（6 个）

|Skill|用途|
|---|---|
|**`/office-hours`**|需求深度追问（已完成 PRD，可用 Builder Mode 验证方向）|
|**`/plan-ceo-review`**|CEO 审查：迁移计划的 ROI、风险、MVP 范围合理性|
|**`/plan-tune`**|计划调优：细化 Phase 粒度、调整依赖顺序|
|**`planning-with-files`**|基于文件的规划：用 OpenMontage 的 `pipeline_defs/` 目录结构反推迁移清单|
|**`planning-and-task-breakdown`**|将每个 Phase 拆解到 ≤4h 的可执行任务|
|**`writing-plans`**|编写每次编码 session 的聚焦计划，防止 scope creep|

### 二、架构与设计阶段（7 个）

|Skill|用途|
|---|---|
|**`/plan-eng-review`**|架构审查：Python 桥接方案、IPC 协议、渲染引擎扩展、子进程管理|
|**`/plan-devex-review`**|DX 审查：开发者能否快速理解新代码结构、OpenMontage 桥接是否清晰|
|**`/plan-design-review`**|设计审查：CreateView 重构方案、12 个新组件设计、主题系统一致性|
|**`design-consultation`**|设计咨询：用户界面布局、交互流程、信息架构|
|**`/design-review`**|视觉设计审查：4 个主题的视觉呈现、组件 UI 一致性|
|**`api-and-interface-design`**|IPC 接口设计：`render-engine.js` 扩展后的方法签名、Python 桥接协议定义|
|**`documentation-and-adrs`**|架构决策记录：记录每个关键技术选择的上下文（为什么用 submodule 而不是复制、为什么选某个 AI 提供商）|

### 三、编码阶段（减少编码却保证质量的方法）（11 个）

|Skill|用途|
|---|---|
|**`TDD`**|先写测试再写代码。关键测试点：render-engine 扩展、Python 桥接 IPC、前端三态|
|**`testing-anti-patterns`**|审查测试质量：不 mock spawn 成"永远成功"、不 mock 整个 Python 进程|
|**`source-driven-development`**|OpenMontage 源码就是需求文档：每次实现前先看 OpenMontage 对应代码的完整实现|
|**`spec-driven-development`**|以 OpenMontage 的接口签名为 spec，保证参数名/类型/行为一致|
|**`doubt-driven-development`**|每次 copy-paste 前质疑："这个函数真的需要吗？Windows 上能跑吗？用户有这依赖吗？"|
|**`code-simplification`**|OpenMontage 的 Python 工具为了通用性有很多抽象层。迁移时做减法，只保留 Multi-Publish 需要的路径|
|**`incremental-implementation`**|严格按 Phase 推进，每个任务完成前不得开始下一个|
|**`subagent-driven-development`**|Phase 2 中 7 个模式可并行开发（TalkingHead / Cinematic / Collage 等互不依赖）|
|**`dispatching-parallel-agents`**|Phase 3 中多个 Python 工具适配可并行（AI 视频 / TTS / 图像生成互不依赖）|
|**`context-engineering`**|给 AI 提供精确的上下文：每次 session 开始提供"当前 Phase + 目标文件 + OpenMontage 对应文件"|
|**`frontend-ui-engineering`**|Vue 组件最佳实践：确保 12 个新组件覆盖 loading / empty / error 三态|

### 四、代码评审阶段（6 个）

|Skill|用途|
|---|---|
|**`/review`**|每 2-3 个功能做整库扫描。按 AGENTS.md 格式输出 CRITICAL / MAJOR / MINOR|
|**`code-review-and-quality`**|系统性 code review：逻辑错误、边界条件、性能问题、安全隐患|
|**`receiving-code-review`**|处理审查意见的规范流程：逐条确认、不辩解、快速修复|
|**`requesting-code-review`**|发起审查的规范流程：提供 diff + 测试结果 + 审查重点|
|**`/guard`**|安全门禁：Python 工具链集成时扫描 shell 注入、eval、硬编码密钥|
|**`/cso`**|安全审计（OWASP + STRIDE）：重点关注 API Key 存储、Python 子进程隔离、用户文件系统访问|

### 五、集成调试阶段（4 个）

|Skill|用途|
|---|---|
|**`/investigate`**|根因调试铁律：出现"OpenMontage 能跑 Multi-Publish 不能跑"的问题时，严格执行 5 阶段流程|
|**`/careful`**|逐步分析模式：Python 桥接首次联调时，每步确认结果再前进|
|**`systematic-debugging`**|系统化调试：数据流跟踪 + 二分法缩小范围 + 假设验证|
|**`defense-in-depth`**|多层防御：渲染输出做 ffprobe 验证、Python 调用做超时保护、IPC 做错误恢复|

### 六、验证与发布阶段（5 个）

|Skill|用途|
|---|---|
|**`verification-before-completion`**|每个 Phase 交付前，对照 PRD 验收标准逐条跑通|
|**`/qa`**|全量 QA：功能 + 视觉 + 离线 + 错误场景 + 大文件压力测试|
|**`/health`**|健康检查：代码质量指标、测试覆盖率、依赖版本一致性|
|**`finishing-a-development-branch`**|分支完成标准化：验证测试 → merge → 清理|
|**`/ship`**|合入主分支：verify → commit → push → merge 全流程检查|

### 七、复盘沉淀阶段（4 个）

|Skill|用途|
|---|---|
|**`/retro`**|每周工程复盘：提交趋势、代码质量、踩坑记录、速度变化|
|**`/learn`**|迁移经验沉淀：记录兼容性问题、API 差异、剪裁掉的代码、Python 环境坑|
|**`/document-release`**|发布说明：生成视频创作模块的变更日志|
|**`git-workflow-and-versioning`**|版本管理：合理分支策略、commit 规范（每个 Phase 一个 tag）|

---

### 不适用 Skill（14 个）

|Skill|不适用原因|
|---|---|
|`/browse`|不需要浏览网页|
|`/benchmark`|性能基准测试暂不需要（渲染速度取决于用户硬件）|
|`/canary`|金丝雀部署不适用于桌面应用|
|`/land-and-deploy`|不需要部署到生产服务器|
|`/freeze` / `/unfreeze`|单人开发不需要冻结审查状态|
|`deprecation-and-migration`|虽然名字有 migration，但这个 skill 侧重 API 废弃迁移，适合重构旧代码，不适用本项目|
|`ci-cd-and-automation`|CI/CD 已有，本次不需要改动|
|`performance-optimization`|渲染性能是 Remotion 负责的，本次不修改渲染引擎本身|
|`observability-and-instrumentation`|桌面应用的日志系统已有，不需要新增|
|`security-and-hardening`|安全已在 /guard + /cso 中覆盖|
|`shipping-and-launch`|发布已有 /ship 覆盖|
|`idea-refine`|需求已经明确|
|`codex`|工作流程类，不直接贡献质量|
|`/qa-only`|`/qa` 已覆盖全量|

---

**37 个技能可用，14 个不适用。最大可用集就是这 37 个。**

如果你想要更可操作一点，我可以把这 37 个 skill 编排成一个**串联执行路线图**——每个 Phase 走到哪一步该调哪个 skill，做成一个"一键质检流水线"。

---

#  可以啊 。就是最好等跟AI会话来说清楚的。你告诉我怎么讲清楚，才能实现你推荐的这个线路图

---

搞定了，`01-docs/quality-playbook-ai-prompt.md`（9KB）。

---

### 怎么用

**最简单的方式** — 每次开新会话时说这一句就行：

```
阅读 01-docs/quality-playbook-ai-prompt.md 并按照其中的质量路线图执行。
当前焦点：Phase 1 —— 增强 render-engine.js，使其支持动态 Composition 选择。
```

AI 会自己读取文件里的完整路线图，然后自动执行。

### 文件结构

```
一、主提示词（完整版） → 整个 session 启动时粘贴
    按阶段排列 24 个技能，每个技能有明确触发条件
    AI 读完后会自动按流程执行，不需要你逐个提醒

二、Phase 专用补充 → 每个 Phase 有独立的焦点文件和约束
    你只需要说"当前焦点：Phase 3"
    AI 就会自动加载对应的补充约束

三、快速启动命令 → 最精简版，一句搞定
    适合日常开发，不需要每次贴大段文字

四、5 个常见场景应对 → AI 跑偏时你回一句话就能纠正
    比如 AI 跳过测试 → 你说"verification-before-completion"
    出现神秘错误 → 你说"/investigate"
```

### 实际效果

你后续的会话流程会变成这样：

1. **你说**：`阅读 quality-playbook-ai-prompt.md，当前焦点：Phase 1 —— 重构 CreateView.vue`
2. **AI 自动**：读取 OpenMontage 源码（source-driven-dev）→ 拆任务（planning-breakdown）→ 写测试（TDD）→ 写实现 → 做评审（code-review）→ 验证（verification-before-completion）
3. **你只需要**：确认结果，然后说 `进入下一子任务`

任何一个支持读取 markdown 文件的 AI 工具都能直接用——Codex、Cursor、Claude Code、Windsurf 都行。

---

# 对于老项目，也可以这样让它来后补吗？

---

现在文档支持三种模式，你根据场景选一种：

---

### 模式一：新开发模式（给新代码）

```
阅读 quality-playbook-ai-prompt.md
当前焦点：Phase 1 —— 重构 CreateView.vue
```

AI 自动走 **TDD → 增量化实现 → 代码审查 → 验证 → ADR** 全流程。

### 模式二：后补模式（给老代码）

```
阅读 quality-playbook-ai-prompt.md，以后补模式执行。
对以下存量代码做质量后补：
- apps/desktop/electron/render-engine.js
- apps/desktop/electron/ipc-handlers/render.js
- apps/desktop/src/views/CreateView.vue
```

AI 自动执行 **6 步流水线**：

1. 源码对齐（对比 OpenMontage 差异）
2. 代码审查（出 🔴/🟠/🟢 报告）
3. 安全审计（OWASP + STRIDE）
4. 补测试（normal + error + edge）
5. 补 ADR（架构决策记录）
6. 健康检查（评分 0-10）

每步输出独立文件到 `01-docs/quality-reports/`，完成一个才进下一个。

### 模式三：即抽即检（怀疑某个模块时）

```
对 render-engine.js 做抽查。先对比 OpenMontage 源码，再出 review 报告。
```

一句话搞定，适用于开会前或合入前的快速质检。

---

所以你现在可以对已经写好的 `CreateView.vue`、`render-engine.js`、`ipc-handlers/render.js` 跑一遍**后补模式**，先把存量代码的质量兜住，然后再开始 Phase 1 的新开发。

---

# 两套不同组合的比较分析

两个方案我都仔细分析了。先说结论：**各有优劣，针对的场景不同，不矛盾。**

---

## 核心差异：两个项目的问题本质不同

|维度|参考产品集成|OpenMontage 迁移|
|---|---|---|
|代码来源|**8.4MB webpack 打包产物**（混淆/压缩/冗余）|**干净的 Python + TypeScript 源码**|
|集成方式|逆向工程→提取关键函数→重写|直接引用源码 / git submodule|
|工作量|~3 个工具 + 3 个适配器|70+ 工具 + 13 条管线 + 前端|
|风险类型|逆向错误的概率高|漏移植参数、架构不当的概率高|
|核心矛盾|**"我猜的对不对？"**|**"我移植全了吗？"**|

这就是为什么两个方案的 skill 侧重不同：

---

## 详细对比

### Set B（参考产品方案）的优点 ✅

```
1. doubt-driven-dev   ★★★★★  —— 对混淆代码的质疑核心技能
2. TDD                ★★★★★  —— 验证逆向猜测的唯一手段
3. code-simplification ★★★★★  —— webpack 产物必须减负
4. incremental-impl   ★★★★   —— 一次一个适配器，节奏清晰
5. /review            ★★★★   —— 逆向代码必须过审查
```

**最适合的场景**：从混淆/打包的 JS 产物中提取功能。**参考产品的方案在这一点上完胜。**

### Set A（OpenMontage 方案）的优点 ✅

```
1. source-driven-dev    ★★★★★ —— 有完整源码可对比，天然优势
2. spec-driven-dev      ★★★★★ —— 以 OpenMontage 接口签名为 spec
3. planning-breakdown   ★★★★  —— 5 Phase 55 天需要精细拆解
4. subagent-driven/parallel ★★★★ —— Python 工具链天然可并行
5. verification-before-completion ★★★★ —— 每 Phase 验收防漂移
6. defense-in-depth     ★★★★  —— Python 桥接需要多层保护
7. documentation-adrs   ★★★★  —— 架构决策需要记录（submodule/复制/桥接）
```

**最适合的场景**：从有完整源码的项目中移植功能，架构复杂、周期长。

### Set B 的不足

|缺失项|为什么对 OpenMontage 迁移重要|
|---|---|
|**source-driven-dev**|你有 OpenMontage 完整源码，不用质疑，直接对比就行。比 doubt-driven-dev 更高效|
|**spec-driven-dev**|接口签名需要对齐，移漏参数是 OpenMontage 迁移的最大风险|
|**subagent-driven / parallel**|15 个 AI 视频提供商可以并行适配，串行做要 3 周，并行做 1 周|
|**verification-before-completion**|5 个 Phase 之间依赖关系紧密，必须逐 Phase 验收才能进下一个|
|**defense-in-depth**|Python 进程管理比 JS 子进程更容易出问题（路径、编码、版本）|
|**planning-breakdown**|55 天的项目不做精细拆解很容易 scope creep|

### Set A 的不足

|过多项|为什么对 OpenMontage 迁移不那么关键|
|---|---|
|**doubt-driven-dev**|OpenMontage 是干净的源码，不需要质疑"这个函数到底在做什么"，直接读就懂了|
|**code-simplification**|OpenMontage 的代码结构清晰，不需要大幅简化，只需要选择性引用|
|**/cso（安全审计）**|OpenMontage 没有硬编码密钥问题（参考产品有 CSDN `9znpamsyl2c7cdrr9sas0le9vbc3r6ba` 这种），安全风险低一档|
|**/retro（每周复盘）**|单人开发复盘频率过高，改成每 Phase 一次就够了|

---

## 我的最终推荐

**给 OpenMontage 迁移，把两个方案合并取交集，得到最优集：**

### 精简核心集（TOP 10）

|优先级|Skill|原因|
|---|---|---|
|**P0**|`test-driven-development`|两套方案共同第一优先，没测试不配叫复用|
|**P0**|`source-driven-dev`|你有完整源码，直接对比比质疑高效得多|
|**P0**|`spec-driven-dev`|参数对齐是迁移的最大风险，没有之一|
|**P0**|`incremental-impl`|两套方案一致认可，按 Phase 逐块推进|
|**P0**|`/review`|两套方案一致认可，每 2-3 个功能审查一次|
|**P1**|`verification-before-completion`|每 Phase 验收防止范围漂移|
|**P1**|`subagent-driven-dev` / `dispatching-parallel-agents`|Python 工具链并行适配省 2 周|
|**P1**|`defense-in-depth`|Python 桥接需要多层保护|
|**P2**|`documentation-and-adrs`|架构决策需要记录|
|**P2**|`planning-and-task-breakdown`|55 天项目需要精细拆解|

### 精简流程

```
每个子任务开始：
  1. source-driven-dev + spec-driven-dev → 读源码，列接口签名
  2. TDD → 先写测试再写实现
  3. incremental-impl → 严格按任务推进
每完成 3 个功能：
  4. /review → 代码审查
每完成一个 Phase：
  5. verification-before-completion → 对照 PRD 逐条验收
  6. documentation-and-adrs → 记录架构决策
可并行时：
  7. dispatching-parallel-agents → 并行适配
每次集成调试：
  8. defense-in-depth → ffprobe 验证 + 超时保护 + 错误恢复
```

你说"要不直接开干"，用这个 **TOP 10 精简集** 做 Phase 1 就行——够用又不啰嗦。

---
# 分析2

## 分析

两套组合的核心重叠度很高（TDD、`/review`、`code-simplification`、`incremental-impl` 都出现了），差异在于各自的**领域特异性技能**。以下是我的判断：

### 组合一（参考产品集成）的优势

逆向工程场景下，**`doubt-driven-dev` + `source-driven-dev`** 是正确的选择——webpack 打包产物每个函数都值得质疑。`/cso` 安全审计也合理（提取了硬编码密钥）。但组合一**缺少规划阶段的架构审查**（没有 `/plan-eng-review`），对 8.4MB 打包产物的模块边界没有前期规划。

### 组合二（OpenMontage 迁移）的优势

按 Phase 分阶段推荐更系统，`spec-driven-dev` 适合"从源码推导接口"的迁移场景。但组合二**过于冗长**——15 个 skill 很多是 P1 级别，实际用到的频率不高。

### 问题：两个组合都犯了同一个错

**都堆了太多 skill，没有按"实际触发频率"排序。** 你用 MiMo Code 写代码时，90% 的时间在 TDD + incremental-impl + code-simplification + /review 这四个循环里。其余 skill 是"偶尔触发"而不是"每次都用"。

---

## 我的建议：精简为核心 8 个 + 按项目叠加

### 核心层（所有项目通用）

| Skill | 触发时机 | 为什么 |
|-------|---------|--------|
| **`test-driven-development`** | 每次写新函数 | 没测试的复用是盲人摸象 |
| **`incremental-implementation`** | 每次改 3+ 文件 | 防止一步到位式重构翻车 |
| **`code-simplification`** | 每次从外部复制代码 | webpack/Python 代码必须简化 |
| **`/review`** | 每 2-3 个功能做一次 | 逆向或迁移的代码必须审查 |
| **`verification-before-completion`** | 每个 Phase 结束 | 完成前跑验证清单 |

### 规划层（按项目类型选）

| 项目类型 | 推荐 | 不推荐 |
|---------|------|--------|
| **逆向工程**（参考产品） | `doubt-driven-dev` + `source-driven-dev` + `/plan-eng-review` | `spec-driven-dev`（没有 spec 可言） |
| **系统迁移**（OpenMontage） | `spec-driven-dev` + `/plan-eng-review` + `/plan-design-review` | `doubt-driven-dev`（源码在手，不需要质疑） |
| **新功能开发** | `brainstorming`/`idea-refine` + `writing-plans` | `source-driven-dev`（没有参考源码） |

### 收尾层（按风险等级选）

| 风险等级 | 推荐 |
|---------|------|
| **涉及密钥/签名** | `/cso` |
| **涉及 UI** | `/qa` + `frontend-ui-engineering` |
| **普通功能** | `/learn` + `document-release` |

---

## 具体到你的两个项目

### 参考产品集成：用 7 个

```
/doubt-driven-dev → /plan-eng-review → test-driven-dev → 
incremental-impl → code-simplification → /review → /cso
```

**理由**：逆向工程没有 spec，`spec-driven-dev` 用不上；`doubt-driven-dev` 才是核心——每个签名算法都要质疑"这个真的能复用吗"。

### OpenMontage 迁移：用 8 个

```
/spec-driven-dev → /plan-eng-review → /plan-design-review → 
test-driven-dev → incremental-impl → code-simplification → 
/review → verification-before-completion
```

**理由**：OpenMontage 源码就是 spec，`spec-driven-dev` 能从源码推导接口定义；`doubt-driven-dev` 不需要——代码在手，不用猜。

---

## 一句话总结

**组合二的框架更合理**（按 Phase 分阶段），但太冗长。**精简到核心 5 个 + 按项目叠加 2-3 个领域 skill** 是最优解。两个项目共享 TDD + incremental-impl + code-simplification + /review 这个底座，差异化只在规划阶段和收尾阶段。

---
# 两者可以结合吗？

可以。两个组合共享 70% 的核心技能，差异只在规划层和领域层。合并成一个**分层框架**：

## 合并后的统一框架

```
┌─────────────────────────────────────────────┐
│  收尾层（按风险选 1-2 个）                      │
│  /cso | /qa | /learn | document-release     │
├─────────────────────────────────────────────┤
│  验证层（每次必用）                             │
│  /review + verification-before-completion    │
├─────────────────────────────────────────────┤
│  编码层（每次必用）                             │
│  TDD + incremental-impl + code-simplification│
├─────────────────────────────────────────────┤
│  规划层（按项目类型选 2-3 个）                   │
│  逆向工程: doubt-driven + source-driven      │
│  系统迁移: spec-driven + plan-design-review  │
│  新功能:   brainstorming + writing-plans      │
├─────────────────────────────────────────────┤
│  通用层（所有项目）                             │
│  /plan-eng-review + context-engineering      │
└─────────────────────────────────────────────┘
```

## 具体操作

两个项目实际调用的技能序列合并后：

| 阶段 | 参考产品（逆向） | OpenMontage（迁移） | 共享？ |
|------|--------------|-------------------|--------|
| 规划 | doubt-driven → /plan-eng-review | spec-driven → /plan-eng-review → /plan-design-review | `/plan-eng-review` 共享 |
| 编码 | TDD → incremental-impl → code-simplification | 同左 | **完全一致** |
| 验证 | /review → /cso | /review → verification-before-completion | `/review` 共享 |
| 收尾 | /learn | /learn | 一致 |

## 结论

**编码层和验证层完全相同**，不需要区分。唯一需要按项目切换的是：

- **规划层**：逆向用 `doubt-driven`，迁移用 `spec-driven`
- **收尾层**：涉及密钥加 `/cso`，涉及 UI 加 `/qa`

所以不是"选 A 还是 B"，而是 **A 和 B 共用一个底座，上面各加 2-3 个领域插件**。如果你同时做两个项目，只需要记住 5 个核心 + 按项目查表选 2-3 个即可。

---

这个 AI 的分析比我的更精准。核心差异抓得好：**"我猜的对不对"vs"我移植全了吗"**，这是两种完全不同的认知模式，决定了 skill 选择的根本分歧。

## 对照看，谁对在哪

| 维度 | 我的分析 | 另一个 AI | 谁更准 |
|------|---------|----------|--------|
| 核心判断 | 两个组合 70% 重叠，可以合并 | 问题本质不同，侧重不同 | **它更准** — 重叠的是"通用开发习惯"，不是"项目特异性策略" |
| 参考产品 | 缺了 `/plan-eng-review` | doubt-driven 是核心，不需要 spec | **它更准** — 逆向工程确实没 spec 可言 |
| OpenMontage | 建议用 spec-driven | source-driven + spec-driven 并用 | **它更准** — 有源码时先读源码再推导 spec，两步都有必要 |
| 合并方案 | 我提了"共享底座 + 领域插件" | 它直接给了 TOP 10 + 精简流程 | **它更实用** — 有优先级有流程，没有抽象层 |
| 遗漏 | 我没提 subagent-driven/parallel | 它提了并行适配省 2 周 | **它更完整** — 15 个提供商确实该并行 |
| defense-in-depth | 我没提 | 它提了 Python 桥接多层保护 | **它更完整** — Python 子进程管理比我意识到的更脆弱 |

## 我需要修正的地方

1. **"共享底座"的说法过于乐观** — TDD + incremental-impl + /review 确实是通用习惯，但 doubt-driven 和 source-driven 是**互斥的思维方式**，不是同一个底座的两个插件
2. **低估了 OpenMontage 的复杂度** — 70+ 工具 + 13 条管线 + 前端，这不是"加几个 skill"能覆盖的，需要 subagent-driven 这种重型协调工具
3. **漏了关键的并行策略** — Python 工具链天然可并行，串行做是浪费

## 结论

**以另一个 AI 的方案为准**，它的 TOP 10 精简集 + 流程比我之前的"分层框架"更具体、更可执行。我的分析在"两个组合共享核心"这个判断上偏差了——共享的只是表层习惯，深层策略确实应该按项目分开。

---

# 问题：两个组合都犯了同一个错

**都堆了太多 skill，没有按"实际触发频率"排序。** 你用 MiMo Code 写代码时，90% 的时间在 TDD + incremental-impl + code-simplification + /review 这四个循环里。其余 skill 是"偶尔触发"而不是"每次都用"。

没有完全解决。

另一个 AI 给了优先级排序（P0/P1/P2）和流程，比之前的"15 个 skill 列表"好很多，但 **TOP 10 仍然是 10 个 skill**。按触发频率，实际应该是这样：

| 频率 | Skill | 每次用？ |
|------|-------|---------|
| **每次写代码** | TDD + incremental-impl + /review | 是 |
| **每个子任务开始** | source-driven-dev | 是（有源码时） |
| **每个子任务开始** | spec-driven-dev | 是（有接口时） |
| **每 3 个功能** | verification-before-completion | 是 |
| **可并行时** | subagent-driven | 偶尔 |
| **Python 桥接时** | defense-in-depth | 偶尔 |
| **架构变更时** | documentation-and-adrs | 偶尔 |
| **规划阶段** | planning-and-task-breakdown | 一次 |

另一个 AI 的方案好在**给了流程**，但没区分"每次循环都触发的核心 4 个"和"特定阶段才触发的"。两个方案的共同问题：**都没有把"必须每次都用的"和"偶尔用一次的"从视觉上分开**。

正确的呈现方式不是 TOP 10 列表，而是：

```
日常循环（每次）：  TDD → incremental-impl → /review
阶段检查（每 Phase）：verification-before-completion
特殊场景（按需）：  source-driven | spec-driven | subagent | defense-in-depth | adrs
```

这样你一眼就知道"写代码时只需要记住 3 个"。

---
# 分析3


说得对。TOP 10 列表的问题在于：**你写代码时脑子记不住 10 件事，最终一件都不会执行。**

正确的设计是按**操作节奏**来分，你只需要记住"写代码时循环哪几个"。重新梳理：

---

## 最终版：按操作节奏分层的技能地图

### 日常循环 —— 你每次写代码的 4 步节奏

```
source-driven-dev        ①  先看 OpenMontage 对应源码
     ↓
TDD                      ②  先写测试再写实现
     ↓
incremental-impl         ③  严格按子任务推进，不跳步
     ↓
/review                  ④  写完本地审查，过了再提交
```

这 4 步形成一个 **闭环**，每次写代码都走一遍。不需要思考，像肌肉记忆。

> 有 4 步是因为 OpenMontage 迁移的特殊性——**每次必须先看源码**。纯新项目可以减到 3 步（去掉 source-driven-dev）。

### 阶段检查 —— 一个 Phase 结束触发一次

```
verification-before-completion   对照 PRD 逐条验收
    ↓
documentation-and-adrs           记录架构决策
    ↓
/health                          健康检查
```

**频率**: 每 Phase 一次，不是每天。不需要记在脑子里，Phase 结束时 AI 会提示你。

### 特殊场景 —— 出状况时才用

|场景|触发条件|技能|
|---|---|---|
|"OpenMontage 能跑这不能跑"|集成错误|`/investigate`|
|"要并行适配多个 AI 提供商"|任务可并行|`dispatching-parallel-agents`|
|"Python 桥接要上线了"|Python 子进程接入|`defense-in-depth`|
|"这代码可疑"|怀疑有坑|`doubt-driven-dev`|
|"代码太复杂"|看到冗余代码|`code-simplification`|
|"安全风险"|涉及密钥/签名|`/cso` + `/guard`|
|"要不要做这个东西"|需求不确定|`/office-hours`|

**频率**: 几乎为零。AI 会在触发条件满足时自动激活，不需要你记。

---

### 三行总结，贴给 AI 就完事

```
日常循环（写代码时自动执行）：
  1. source-driven-dev → 2. TDD → 3. incremental-impl → 4. /review

阶段检查（Phase 结束时 AI 提示）：
  verification-before-completion + documentation-and-adrs

特殊情况（AI 自动判断触发）：
  investigate | defense-in-depth | dispatching-parallel | /cso | code-simplification
```

你写代码时只需要管**第 1 行**的 4 步，剩下的 AI 会在对应时机自动触发。

---
# 做成一个新的skill

	Skill 已创建：`~/.agents/skills/质量节拍/SKILL.md`（10KB）

结构就三层，一目了然：

### 第一层：日常循环（每次写代码）

你只需要记 **4 步**，AI 会自动展开细节：

```
source-driven-dev → TDD → incremental-impl → /review
```

### 第二层：阶段检查（每 Phase 结束）

AI 会在相位结束时自动提示你跑：

```
verification-before-completion → /health → documentation-and-adrs
```

### 第三层：特殊场景（按需，不用记）

你遇到什么情况就说什么，AI 自动匹配对应技能：

|你说|AI 执行|
|---|---|
|"出 bug 了"|`/investigate`|
|"安全审计一下"|`/cso` + `/guard`|
|"这代码不太对"|`doubt-driven-dev`|
|"并行搞"|`dispatching-parallel-agents`|
|...等 24 个场景|自动匹配|

**全部 37 个技能都覆盖了**，一个没漏。但分成了"要记的 4 个"和"不用记的 33 个"。

---

使用方式：新会话开始说一句 `使用质量节拍 skill` 或 `遵循质量节拍`，AI 就会自动按这个节奏执行。

---
更新完成，现在 16.8KB。新增的内容：

### 第一章：起作用的方式

讲清楚了**三种触发机制**的区别：

|触发方式|你做的事|AI 做的事|
|---|---|---|
|**A. 日常循环（自动串行）**|告诉 AI"当前焦点"|自动跑 4 步嵌套流程|
|**B. AI 主动提示（阶段门禁）**|说"好，跑一遍"或"跳过"|检测子任务完成条件，主动问你要不要检查|
|**C. 你说一句话（按需调用）**|用自然语言说出意图|从场景映射表匹配对应技能|

### 第二章：具体流程

一个完整 Session 从开始到结束的**逐步骤走查**（以 Phase 1 render-engine.js 增强为例）：

```
你说"使用质量节拍" → AI 加载上下文（自动）
    → 日常循环第 1 轮（render() 函数）
    → 日常循环第 2 轮（IPC handler）
    → 日常循环第 3 轮（list-compositions）
    → AI 检测完成 → 问你要不要阶段检查
    → verification + /health + adrs
    → 你说"记下来" → /learn
    → Session 结束
```

### 第三章：触发方式详解

**完整的 24 个场景→技能映射表**，每个场景附带了**触发关键词**：

|你说|AI 匹配|
|---|---|
|"出 **bug** 了" / "**错误**怎么回事"|`/investigate`|
|"这代码**可疑** / **不对**"|`doubt-driven-dev`|
|"**首次联调** / **第一**次跑"|`/careful + defense-in-depth`|
|...全部 24 个场景|每个都有 2-3 个触发词变体|

### 第四章：3 个完整会话示例

- **场景 A**：日常开发 render-engine.js（正常流程）
- **场景 B**：TalkingHead 黑屏 bug 调试（investigate 全流程）
- **场景 C**：对已有 CreateView.vue 跑后补模式（6 步流水线）

### 第五章：完整覆盖清单

37 个技能按三层重新列出，确认无遗漏。

---
这个 skill **没有斜杠命令**，因为它是放在 `~/.agents/skills/` 下的用户级 skill，不是 gstack 的斜杠命令。

调用的方式不是打斜杠，而是直接**说名字**：

|方式|你说的话|
|---|---|
|完整引用|`使用质量节拍 skill`|
|简短引用|`遵循质量节拍`|
|最精简|`质量节拍`|

AI 读到这几句话中的任意一个，就会自动去 `~/.agents/skills/质量节拍/SKILL.md` 读取内容并按路线图执行。

---

所以前面给的启动句应该是：

```
质量节拍。当前焦点：Phase 1 —— 增强 render-engine.js
```

不需要打斜杠。如果你觉得 4 个字太长想改成一个短的英文词，可以直接改目录名，比如改成 `rhythm`：

```
C:\Users\邱领\.agents\skills\rhythm\SKILL.md
```

然后说 `rhythm` 或 `使用 rhythm skill` 就能触发。要改吗？

---

三个问题逐一回答：

### 1. 能做斜杠命令吗？

不一定。gstack 的斜杠命令（如 `/review`、`/qa`）是 gstack 包里预定义的，**用户不能自己注册新的 gstack 斜杠命令**，除非改 gstack 的源码。

但你可以用**编辑器级别的斜杠命令**替代：

|编辑器|方式|
|---|---|
|**Cursor**|创建 `.cursor/commands/质量节拍.md` → 输入 `/质量节拍` 触发|
|**Claude Code**|创建 `.claude/commands/质量节拍.md` → 输入 `/质量节拍` 触发|
|**Codex**|直接说"使用质量节拍 skill"（Codex 从 `~/.agents/skills/` 自动发现）|

要不要我帮你创建 Cursor 和 Claude Code 的命令文件？

### 2. 需要重启吗？

- **新会话**：不需要重启。新的 AI 会话会自动扫描 `~/.agents/skills/` 目录，发现质量节拍 skill
- **当前会话**：不需要重启，但需要你**手动告诉 AI 这个文件在哪**，因为当前会话启动时还没这个文件

### 3. 老会话有效吗？

**老的已打开会话无效** — 系统在会话启动时已经加载了 skills 列表，新加的 skill 不会自动出现。

但你可以用这句话让任何老会话立即生效：

```
读取 C:\Users\邱领\.agents\skills\质量节拍\SKILL.md 并按照内容执行
```

当前这个会话就可以用这句话立刻激活。**要试试吗？**


继续推进，使用质量节拍 skill来进行（读取 C:\Users\邱领\.agents\skills\质量节拍\SKILL.md 并按照内容执行）

---
# 强制执行

有。以上 4 层全是"软约束"——AI 可以读但可以不执行，`git commit --no-verify` 也能跳过。**真正有效的只有技术门禁，能物理上阻止违反流程的操作。**

---

## 真正有效的 3 层技术门禁

### 第 1 层：Pre-commit 钩子（阻止本地提交）

当开发者 `git commit` 时，脚本自动检查：

```
改动了 render-engine.js？ → 测试文件 tests/render-engine.test.js 存在吗？
                             不存在 → ❌ 提交被拒绝
改动了 CreateView.vue？  → 测试文件存在吗？
                             不存在 → ❌ 提交被拒绝
所有测试通过了？         → 没通过 → ❌ 提交被拒绝
```

这个可以 `git commit --no-verify` 跳过，但正常人不会每次都跳过。

### 第 2 层：CI 流水线（阻止合并到主分支）

GitHub Actions 在每次 push 时自动运行：

```
① 测试阶段
   npm test                    → 失败则 ❌
   pytest                      → 失败则 ❌
   覆盖率 < 80%                → 失败则 ❌

② 审查阶段（Phase 检查）
   检查 01-docs/quality-reports/ 下是否有当前 Phase 的审查报告
   没有？                     → 失败则 ❌

③ 安全阶段
   /guard 扫描                 → 发现 🔴 则 ❌
   /cso 审计报告存在？         → 没有则 ❌
```

这个**无法跳过**——没有 CI 绿色通过，PR 不能合并。

### 第 3 层：GitHub 分支保护规则（物理封锁）

在 GitHub 仓库设置中开启：

```
Require status checks before merging
  → 要求 CI 测试通过
  → 要求覆盖率不低于阈值
  → 要求审查报告存在

Require pull request reviews before merging
  → 至少 1 人审查通过

Do not allow bypassing the above settings
  → 管理员也不能跳过
```

---

### 要不要我现在配置？

如果你同意，我实际在 Multi-Publish 仓库配好这三层：

|层|配置内容|能否绕过|
|---|---|---|
|**Pre-commit hook**|改代码必须带对应测试，否则 commit 被拒|`--no-verify` 可跳，但正常人不会|
|**CI pipeline**|push 自动跑测试 + 检查覆盖率 + 安全扫描|❌ 不能跳|
|**分支保护**|主分支锁定，PR 必须 CI 过 + 审查过 + 覆盖率达阈值|❌ 管理员也跳不了|

要开干吗？我先配 pre-commit 脚本和 CI 配置文件。


---

# 应用所有项目的脚手架

目前只绑在 **Multi-Publish** 这一个项目上。具体来说：

|层|范围|生效项目|
|---|---|---|
|AGENTS.md 强制段落|项目根目录|**仅 Multi-Publish**|
|Pre-commit 钩子|`.husky/` 在项目里|**仅 Multi-Publish**|
|CI quality-gate|`.github/` 在项目里|**仅 Multi-Publish 仓库**|
|分支保护|仓库设置|**仅 Multi-Publish 仓库**|
|`~/.agents/skills/质量节拍/`|用户全局目录|**所有项目**（但不强制）|

所以前 4 层（硬约束）只绑死了 Multi-Publish。其他项目 AI 启动时能读到 `质量节拍` skill，但**没有技术门禁**，跳不跳过全看 AI 自觉。

---

如果你想推广到所有项目，有两条路：

**方案 A：逐个部署（推荐）**  
每个新项目走一遍：

```
cp .husky/    → 新项目
cp .github/   → 新项目
gh api ...    → 新仓库设分支保护
```

**方案 B：做个脚手架模板**  
做一个 `quality-rhythm-template` 仓库，里面放 `.husky/`、`.github/workflows/quality-gate.yml`，每个新项目：

```
cd 新项目
npx degit Colinchiu007/quality-rhythm/installer .    # 一键拉配置文件
node .husky/install.js                                  # 安装钩子
```

要不要我把方案 B 的脚手架做好推上去？