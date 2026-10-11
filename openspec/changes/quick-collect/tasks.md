# 任务：采集页「快捷采集」（quick-collect）

> 依赖顺序：1 → 2 → 3 → 4 → 5 → 6 → 7（6/7 可并行）。每项 ≤ 一个会话。
> TDD：每一项的实现前先落对应测试（测试目标在该项内标注）。

## 1. 主进程纯逻辑层（TDD）

- [x] 1.1 `quick-collect-command.js`：`validateQuickCollectCommand`（返回 `{ ok, code, field }`，领域码闭集）、
  `normalizeQuickCollectCommand`（trim / keywords 去空去重截断 5×30 / windowHours 白名单 / sources 白名单去重）、
  `newCustomCommandId()`；测试：合法/非法各 10 例、边界（40/41 字标题、9/10 字指令、4000/4001、5/6 关键词）
- [x] 1.2 `quick-collect-materials.js`：`mergeMaterials(items, { windowHours, now, limit=12 })`（url 去重保高 engagement、
  `safeHttpUrl` 判据、缺时间戳在窗口开启时丢弃、engagement 倒序、截断）、`summarizeRetrieval()`（ok/partial/empty/skipped）；
  测试：AC-8/AC-9（非法 url 丢弃、48h 窗口过滤）、去重保留高 engagement、`windowHours=0` 不看时间
- [x] 1.3 `quick-collect-prompt.js`：`buildMessages(command, materials)`（system 硬约束 + 指令逐字透传 + 素材段 + 输出要求）、
  `buildDisclaimerLine(command, retrieval)`、`shouldPrependDisclaimer(content)`；测试：指令逐字、无素材写「本次未获得素材」、
  已有同类声明不重复插入
- [x] 1.4 `quick-collect-presets.js`：6 条内置指令（冻结）；测试：AC-10 对「AI 领域动向」提示词**逐字**断言、
  每条 id 唯一且 `builtin === true`、keywords ≤5 且每条 ≤30、windowHours 在闭集内、`listPresets()` 返回深拷贝（改返回值不影响单例）

## 2. 引擎（TDD）

- [x] 2.1 `quick-collect-engine.js`：`createQuickCollectEngine({ searchFn, llmFn, log, now })` + `run(command, { onProgress })`；
  阶段进度 `retrieving → summarizing → done`；错误码 `-2` 校验 / `-101` 未配模型 / `-102` 调用失败 / `-103` 空输出；
  测试：注入假源与假 LLM，覆盖成功、无素材、无关键词、LLM 抛错、LLM 返回空白、非法指令、progress 序列、LLM 输出截断
- [x] 2.2 条目装配断言：`title` 含指令标题、`content` 去空白、`sourceUrl = materials[0].url`（无素材为空串）、
  `quickCollect.materialCount/retrieval/sources/windowHours` 正确

## 3. IPC + preload

- [x] 3.1 `ipc-handlers/quick-collect.js`：`quick-collect:list-presets`（无参，受控 ipcMain）+
  `quick-collect:run`（`wrapIpcHandlerRaw` + `withSenderCheck`，非对象参数 → `-2`）；测试：3 条（正常/缺参/服务缺席降级）
- [x] 3.2 `ipc-handlers/index.js` 注册 + `bootstrap/phase5-ipc.js` 透传 `contentIntelligence`（1 处解构 + 1 行依赖）
- [x] 3.3 `preload/quick-collect.js`（3 个扁平方法，通道名为字面量）+ `preload/index.js` 注册 + `pnpm run build:preload`
- [x] 3.4 `node .github/scripts/check-ipc-bridge.js` 与 `check-ipc-sender-guard.js` 通过

## 4. 渲染端逻辑

- [x] 4.1 `src/api/quick-collect.js`：3 个导出（`invokeWithFallback` / `on`），无 `window.electronAPI` 直调
- [x] 4.2 `quick-collect-commands.js`：`validateCommandForm`（返回 locale 文案键）、`parseKeywordsInput`、
  `formatKeywordsInput`、`encodeCommands/decodeCommands`（v0 数组 → v1 对象 + 逐条校验丢弃计数）、
  `sortCustomCommands`、`mergeCommands`（内置在前）；测试：解码容错、关键词拆分（`，、,`）、重名检测（不区分大小写）
- [x] 4.3 `useQuickCollectCommands.js`：加载/新增/编辑/删除/落盘/`skipped` 计数；测试：落盘调用键与形状、
  内置不落盘、删除内置被拒
- [x] 4.4 `collected-item.js` 增加 `quickCollect` 透传；测试：字段保留与非法值归一为 `undefined`

## 5. 渲染端 UI

- [x] 5.1 `QuickCollectTab.vue`（页签按钮）+ `quick-collect-ui.js`（两组件一行 import 出口）
- [x] 5.2 `QuickCollectPanel.vue`：内置/自定义两组卡片、执行态（阶段文案 + 禁用）、错误条（领域码 → 文案）、
  空态、`emit('collected', item)`；`data-testid` 齐全
- [x] 5.3 `QuickCollectCommandDialog.vue`：标题/指令/关键词/时间范围 + 计数器 + 内联错误 + 提示文字 + 默认示例占位
- [x] 5.4 `Collection.vue` 接线：1 行 import + 1 行页签 + 1 行面板 + `TAB_KEYS` + 7 行 handler；净增 ≤30 行
- [x] 5.5 `locales/collection/{zh,en}.js` 成对新增文案键（含错误码映射与全部提示文字）

## 6. 测试与门禁

- [x] 6.1 组件测试 `QuickCollectPanel.test.js`：点执行 → 调桥接 → emit；失败 → 领域码文案；running 期间 CRUD 禁用
- [x] 6.2 变异反证：把 4 条守卫（窗口过滤、safeHttpUrl、声明行、内置不可删）改成 no-op，各自**指名**变红后回滚
- [x] 6.3 静态门禁：`check-ipc-bridge` / `check-ipc-sender-guard` / `check-locale-sync --pair-base --cjk --keys` /
  `check-max-lines` / `check-no-brand-residue` / `.github/scripts/check-frontend-consistency.js` / eslint
- [x] 6.4 QM-1：`node scripts/verify-worktree-deps.js` → `pnpm run build:dir` rc=0 → asar 核对新模块与
  `quick-collect:run` 字面量在包内（含 bundle）
- [x] 6.5 QM-4：视觉基线按同一次 CI run 的 artifact 重取（页签变化），逐项归因后回填
- [x] 6.6 QM-2 代码审查必检项自检（require 路径、preload 重打包、IPC 纯 JSON、注释语法、无硬编码文案）

## 7. 文档与收尾

- [x] 7.1 `01-docs/PRD-QUICK-COLLECT-2026-10-11.md`（本 change 的 PRD）
- [x] 7.2 `CHANGELOG.md` 顶部条目 + `openspec/records/quick-collect.md` 执行记录 + `.quality-gates.md` 记录
- [x] 7.3 记忆沉淀：内置记忆（本仓既有记忆文件）+ 外部记忆（`~/.gstack/projects/Colinchiu007-Multi-Publish/learnings.jsonl`）+ EverOS
- [x] 7.4 PR + CI 全绿 + squash 自动合并 + 回填远程同步（含 ledger 销账）
