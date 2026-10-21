# ux-audit-theme-entry — 暗色主题入口接线（UX 审计 阶段 1.1）

## 判定与分层

- 变更类型：运行时代码（渲染层组件 + composable + 入口 HTML）→ 独立 worktree + PR ✅
- 规模：M（6 个源文件 + 3 把锁 + 1 个反证驱动 + 文档）→ 完整流程 + QM-6
- 门禁记录载体：本文件（`openspec/records/<分支名>.md`）
- docs-only 判定：**不适用**（含运行时代码）

## 一、这一格原来坏在哪

`useTheme` 早已实现，但 `git grep useTheme -- apps/desktop/src` 现场显示**只有它自己与它的测试**命中
⇒ 70+ 处 `[data-theme="dark"]` 分支运行期永不激活，上一轮「深色低对比 61→0」没有验收对象。
隐蔽点在于：视觉 runner 自己会注入 `data-theme` 拍暗档（`test-runner.js:110` 与 `_applyTheme`），
所以"暗色被覆盖过"的证据全部来自测试侧。**"runner 能把它拍成暗色" ≠ "用户能把它切成暗色"** ——
这是本仓「装饰性链路」的又一种落点：判据、夹具、截图三样都齐，缺的正是生产代码里那个写入者。

## 二、实现

| 文件 | 改动 |
|---|---|
| `composables/useTheme.js` | 状态提到模块级（单例）；宿主 `matchMedia` 监听改**引用计数**；偏好闭合词表 `light\|dark\|system` + `normalizeThemePreference` 单一实现（坏值归一并 warn）；新增 `applyKnownThemeBeforeMount()` / `setPreference()` / `resetToSystem()`；`init()` 带 token 挡过期回包；**偏好未变化时也显式 commit** |
| `main.js` | `mount()` **之前**调用 `applyKnownThemeBeforeMount()` |
| `components/AppearanceSettings.vue` | 新增：radiogroup 三态 + roving tabindex + 方向键移动即选中 + 越界回绕；焦点沿用 `cohere-btn` |
| `components/SettingsDialog.vue` | 新增「外观设置」Tab（通用之后）+ 面板分支；默认停留 Tab 不变 |
| `locales/settings/{zh,en}.js` | `tabAppearance` + `appearance.*` **成对**新增 |
| `tests/visual-testing/test-runner.js` | 改写 :511 那句描述不存在接线的注释；写明"runner 注入只服务拍摄暗档" |
| `.gitignore` | `!scripts/theme-entry-contract-mutate.js`（`scripts/*.js` 会静默吞掉新驱动 —— 同 #4190 的实测教训） |

## 三、只有实测才会出现的三处修正（都记下来，防止被当成推演）

1. **watch 的盲区**：`watch` 只在值变化时触发，而"镜像写着 dark、真源是 system"是一次**无变化**赋值
   ⇒ 只靠 watch 会让界面永久停在过期镜像色上。正解是 `init()` 里显式 commit。变异 M7 打的就是这一格。
2. **CSP 否掉了"内联脚本读镜像"这条看似更彻底的方案**：本页 CSP 是 `script-src 'self'`，
   内联启动脚本会被直接拒绝。为消一帧画布底色去放开 CSP 是拿安全边界换观感 —— **不做**，
   改用 `<meta name="color-scheme" content="light dark">` 让画布在 JS 之前跟 OS。
   残余如实写明：OS 与显式偏好相反时可能有一帧按 OS 落的画布底色；内容层不闪。
   两条锁钉住：meta 必须存在、`script-src` 必须不含 `unsafe-inline`（防下一个会话去"修"它）。
3. **两道变异第一版选错靶子**（都不是"锁没牙"，而是"变异没造出来"）：
   - M6 原打在 `readFailed` 分支 ⇒ 成功读回路径**等价**，红数=0。改打"真源被镜像顶替"后 CAUGHT。
   - M7 红了**另外三条**而没红目标那条 ⇒ 根因是我那条用例依赖了跨用例存活的单例状态。
     改成"先构造 system 偏好 → 再写过期镜像 → 再触发第二次 init"后才有牙。
   - 补一条 M2：只断"调用存在"的锁对"写在 `mount()` 之后"照样绿，所以顺序必须单独测。

## 四、验证读数（当场，不是回忆）

- `useTheme.test.js` + `AppearanceSettings.test.js` + `SettingsDialog.test.js`：**49 passed**
  （驱动控制跑 `[BASE] rc=0 collected=49 red=0`）
- `node scripts/theme-entry-contract-mutate.js`：**M1–M14 全 CAUGHT**，红集互不相同、逐条按字节还原
- 消费者并集（`settings-panel-layout` / `App.sidebar-collapse` / `styles/focus-ring` + 本批三把锁）：**6 文件 69 passed**
- locale 门禁 `check-locale-sync.js --cjk --keys`：CJK **PASS**（基线 1330、当前 1124、无新增硬编码）；
  key 存在性 **PASS**（2209 个 key 在 zh/en 均在）。⚠ 三条 `console.warn` 最初被判成"新增硬编码中文"
  —— CJK 扫描连日志串一起算，而为吸收自己新写的串去 `--update-baseline` 正是该门禁禁止的动作 ⇒ 改写为 ASCII。
- 真实 Chromium（Playwright headless，dev server 5174）：
  - OS=dark、无镜像：`@domcontentloaded` 即 `data-theme=dark`、`computed color-scheme=dark`、稳态 body 底色 `rgb(26,26,30)`
  - 镜像=dark：内容层首帧即暗，未出现浅色内容帧
- `contrast-audit.js`（Gate 7c 同款入口，本地 TEST_URL）：**18 视图，低对比 0（阈值 3:1），无退化**
  —— 脚本第 110 行确实先 `setAttribute('data-theme','dark')`，所以这个 0 是暗态读数不是浅态自证
- 两处 `.vue` 过 `@vue/compiler-sfc` `parse` + `compileTemplate`：零错误
- ESLint：改动文件 0 error（一处 `vue/no-unused-vars` 的 `idx` 已删）

## 五、QE / 视觉基线（本批刻意留下的动作）

`settings-general` 在像素判定域内（浅/暗两档），新增 Tab 必然改动这两张基线。
**本批未提交任何本机截图**：按 AGENTS 视觉规则 7，基线只能取**同一次 CI 渲染**的产物。
计划：CI 首跑若 `QG Visual` 因此报红 → 下载 `quality-gate-visual-reports` / Gate 7 产物，
取该 run 的 `screenshots/settings-general-current.png` 与 `-dark` 版入库，并自证"新基线 vs 同一次 CI 渲染 = 0 px"。
不得用 `--update-baseline` 或本机 `test:visual:update-baseline` 消化。

## 六、边界与残余（不得读成已完成）

1. 暗色下个别视图可能未适配 —— 本批只补可达性，未逐个修（按文件登记欠账，归各自批次）。
2. 多窗口下 `localStorage` 镜像可能滞后一帧；终值仍由真源决定。
3. 画布层（JS 之前那一帧）走 UA `color-scheme`，OS 与显式偏好相反时可能有一帧按 OS 落的底色（原因与取舍见 §三.2）。
4. 反证驱动**尚无任何 workflow 引用**，`check-unwired-tests.js` 的后缀表也不含 `*-contract-mutate.js`
   ⇒ "入库"不等于"被守"。已单独立项（任务 #23：把三个反证驱动接进 CI），此处如实标注。

## 七、QM-6

见本文件末尾由评审链回填的段落（产物落 `.adversarial/ccg-deep-<sha>/`，判定记录落 `.ccg/reviews/<sha>.json`）。
按既有实测：`self_play_*` 出口在存在 upheld 条目或高危域时拿不到闭合态，闭合需外部复核或人工（任务 #19）。

## 远程同步

| 远程同步 | PENDING |
