# Tasks: ux-audit-hotkeys-settings

## 1. 取证与规格

- [x] 1.1 实测确认死 API：`git grep -na hotkeysList origin/main` 只命中
      `apps/desktop/electron/preload/system.js:141` 与其测试 ⇒ 渲染端零消费方
- [x] 1.2 实测主进程表：`SHORTCUTS` 10 条，`/publish` 与 `/accounts` 各被两条 accelerator 共用
      ⇒ 定 D1「映射键取 accelerator」
- [x] 1.3 本 change 的 proposal / spec / design 落盘（`desktop-ui-consistency` ADDED 6 条 Requirement）

## 2. 逻辑面（先测试后实现）

- [x] 2.1 `src/utils/hotkey-labels.js`：`HOTKEY_ACTION_KEYS`、`formatAccelerator()`、
      `hotkeyActionKey()`、`normalizeHotkeyList()`
- [x] 2.2 `src/utils/hotkey-labels.test.js` 17 条：平台形态（mac 符号与顺序 / 非 mac ` + ` 分隔 /
      未知 token 原样）、脏数据剔除（非对象、缺 accelerator、重复）、
      未登记回显与 `data-mapped`、哨兵值不回显、**跨包对齐锁**（双向 + 锚点存在断言 + 规模下界 + 成员断言）、
      zh/en 成对自证
- [x] 2.3 对齐锁锚点从 `process.cwd()` 改为 `import.meta.url` 定位 `DESKTOP_ROOT`；
      终点锚 `\n}` 加"必须存在"断言（负数终点会静默放大区间 —— 本仓实测过的锚点失效形态）

## 3. 显示面

- [x] 3.1 `src/components/HotkeysSettings.vue`：五态（loading/error/unavailable/empty/ready）、
      `<table>` + `th scope="col"`、`data-testid="hotkeys-combo"` / `hotkeys-action` / `hotkeys-row`、
      `data-mapped` 属性、未登记项 `console.warn` 点名 accelerator
- [x] 3.2 `src/components/HotkeysSettings.test.js` 16 条：五态各自可达且互不相同、
      不消费主进程 `label`、可访问性与"面板不新增可聚焦元素"走位基线
- [x] 3.3 locales `settings/zh.js` 与 `settings/en.js` 成对新增 `tabHotkeys` + `hotkeys` 文案块
- [x] 3.4 `SettingsDialog.vue` 新增 `hotkeys` Tab（`Key` 图标，位置在发布设置之后、禁用的账号设置之前）
      + `v-else-if` 面板分支
- [x] 3.5 `SettingsDialog.hotkeys-tab.test.js` 3 条：入口存在且可点、点后面板渲染且占位面板消失、
      `initialTab="hotkeys"` 经 **false→true 打开沿** 定位
- [x] 3.6 `SettingsDialog.test.js` 既有按索引断言改为按文案定位，六个 Tab 的计数与图标数改 7，
      `Coming Soon` 断言收窄到最后一个（账号设置）

## 4. 反证（变异）

- [x] 4.1 新增 `scripts/hotkey-labels-contract-mutate.js`（判据与 1.5 驱动同源：严格命中按**标题全集**、死探针预筛 + `[PROBE-MAP]` 逐条打印 needle→完整标题、`finally` 还原 + md5 回读；`.gitignore` 第 8 次踩 `scripts/*.js` 默认忽略，已补 `!` 反选并用 `git check-ignore --no-index` 当场验证 rc=1）
- [x] 4.2 实跑（`/d/tmp/hk-driver-r6.log`）：`[BASELINE] rc=0 failed=0 errors=0 blind=false`、`[DEAD-PROBE] 全部探针可命中（标题域 49 条）`、`[SUMMARY] 共 14 条：CAUGHT=14 其余=0`，无 `RESTORE_MISMATCH`。三轮过程的债都记在 PRD §6：首轮 12 道里两条 MISSED（N3 打在 `slice` 而牙在锚点断言 / N6 的 mac 输入本就是规范序）修在锁上；QM-6 处置追加 N13/N14；第五轮另修了判定坐标本身（标题域取 `fullName` 与红集不同源，一上线把 14 道全打成 PARTIAL_RED）
- [x] 4.3 实际覆盖 14 道：漏登记 / 孤儿项 / 终点锚失配 / 未登记项被丢弃 / 未知 token 被丢 /
      mac 不排序 / `data-mapped` 恒真 / 失败吞成空列表 / 无桥不成态 / 列头丢 `scope` /
      消费主进程中文 label / 去掉入口 Tab / 忽略注入的平台档 / 测试里再抄一份跨包解析

## 5. 验证与文档

- [x] 5.1 消费者并集全跑：`git grep -l -e SettingsDialog -e HotkeysSettings -e hotkey-labels -- "*.test.js"` 得 9 个文件 ⇒ 5 个新增/直接面 + 7 个（`App.sidebar-collapse` / `batch-collect-panel-behavior` / `overlay-view-suspension` / `publish-draft-keepalive` / `publish-tab-state-keepalive` / `stores/settings-dialog` / `CreateView`）**375 passed，rc=0**（`git grep -l` 反查 `hotkey-labels` / `HotkeysSettings` / `SettingsDialog` 的消费者）
- [x] 5.2 聚合 `eslint electron src --quiet` → **rc=0**；`check-locale-sync --cjk` PASS；`--pair-base origin/main` PASS（但它打印根级 zh/en 变更=false ⇒ 对拆分文件失明，成对判据在 `hotkey-labels.test.js` 里自带）；`check-no-brand-residue` PASS；`check-doc-abs-paths --base=origin/main` PASS
- [x] 5.3 QM-1：`verify-worktree-deps.js` OK（11 项解析到当前 worktree）→ `pnpm run build:dir`（vite 16.74s + electron-builder `--dir`）成功 → 打包产物 `Multi-Publish.exe` 以隔离 `--user-data-dir` 启动，**8 秒内存活 + stderr 为空**（三层判据第 ③ 层）。动因：本批更正了 `electron/services/hotkeys.js` 的文件头注释（原列 6 条且含一条已不存在的 `Ctrl+Alt+M`）：改过 `electron/services/hotkeys.js`（注释）⇒ 本地打包验证
- [x] 5.4 `01-docs/PRD-HOTKEYS-SETTINGS-2026-10-21.md` 已落（交互/数据校验/显示项/提示文字/降级矩阵）
- [x] 5.5 审计文档 1.6 行改 🟡 + 文末「阶段 1.6 落地记录」+ audit-10 那条总述补"已接线" 状态更新 + 落地记录
- [x] 5.6 执行记录已落（含 `| 远程同步 |` 表格行）
- [x] 5.7 QM-6：判定 DUAL，claude(critic) + opencode(proposer) 跨家族出 8 条 → 7 upheld（全部落地，并追加反证 N13/N14）+ 1 dismissed（附当场否证）；引擎回写 `self_play_blocked` —— 只要有条目被判 upheld，自扮演出口在机械上就拿不到闭合态，故本 PR 不自动合并，需真外部复核或人工（任务 #19）
- [ ] 5.8 PR + CI + 合并后回读 main push

## 6. 遗留（不假装已闭合）

- [ ] 6.1 视觉基线 `settings-general`（浅/暗）必须由同一次 CI 渲染刷新，本批不本机截图
- [ ] 6.2 界面显示的是"应该有的"快捷键，不是"当前真正注册成功的"——`globalShortcut.register`
      失败只在主进程写 warn，`getShortcuts()` 不回传注册结果；需主进程配合，另批
- [ ] 6.3 反证驱动接进 CI（与 #23 同批欠账，落点须避开 30 分钟预算墙）
