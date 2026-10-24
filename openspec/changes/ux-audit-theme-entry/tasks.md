## 1. 先写锁（TDD 红）

- [x] 1.1 `apps/desktop/src/composables/useTheme.test.js` 扩锁：三态读写（`light|dark|system`）、词表外值归一为 `system` 且出声、`null`/缺键/空串继续解释为 `system`（零迁移兼容性）
- [x] 1.2 同文件加**单例**行为锁：两个消费者读到同一份 `theme`；挂载第二个消费者后宿主监听注册数不增长；卸载全部消费者后监听被注销且一次系统变化只触发一次界面更新
- [x] 1.3 加**首帧**锁：镜像存在 ⇒ `applyKnownThemeBeforeMount()` 同步落 `data-theme`；镜像与真源不一致 ⇒ 终值 == 真源且镜像被跟进；镜像缺失 ⇒ 跟随系统；真源读失败 ⇒ 界面确定 + 留下可观测痕迹（`console.warn` 或 logger），断言里显式区分"没读到"与"读到 light"
- [x] 1.4 新增 `AppearanceSettings.test.js`：radiogroup 结构锁（`role=radiogroup` / 每项 `role=radio` + `aria-checked` 恰一项为 true / 可访问名来自 label 而非 placeholder）；行为锁（选暗色 ⇒ 根元素 `data-theme=dark` 且持久层写入被调用一次、参数为 `dark`）；键盘锁（方向键移动选中、Tab 只进组一次）；负控（无 `.prevent` 之类误绑）
- [x] 1.5 `SettingsDialog.test.js` 登记「外观」Tab：断言 tabs 清单含 appearance 且 `disabled:false`，点击后渲染 `AppearanceSettings`；默认停留 Tab 仍为 `model`
- [x] 1.6 接线锁（禁止"实现正确但无人调用"）：结构判据断言 `main.js` 在 `mount()` **之前**调用 `applyKnownThemeBeforeMount()`；并断言生产源码里 `useTheme` 的调用点数 > 0（用真 grep 语义，不接受只在测试里 new）
- [x] 1.7 locales 成对锁：`settings/appearance.*` 新键在 `zh.js`/`en.js` 同时存在（Gate 7 口径），且 `src/` 非 locales 文件不新增中文字面量

## 2. 实现

- [x] 2.1 `useTheme.js` 改模块级单例：共享 `theme`/`loaded`、`matchMedia` 引用计数注册、`init()` 幂等、偏好词表校验函数单一实现
- [x] 2.2 新增 `applyKnownThemeBeforeMount()`（只碰 DOM 属性与 `localStorage`，不得依赖应用上下文/IPC），并在 `main.js` 挂载前调用
- [x] 2.3 偏好持久化：写入端统一走单一函数；`system` 作为可写值；非法值归一并出声；镜像跟随真源收敛
- [x] 2.4 新增 `components/AppearanceSettings.vue`：三态 radiogroup + 说明文案（暗色首次对用户开放，文案须如实描述"部分区域可能仍在适配"，不得宣称完美适配）
- [x] 2.5 `SettingsDialog.vue` 增加「外观」Tab（位于「通用」之后）与面板挂载分支；图标沿用既有引入方式
- [x] 2.6 `locales/settings/{zh,en}.js` 成对补齐全部新文案（Tab 名、三个选项、说明、生效提示）
- [x] 2.7 更正 `tests/visual-testing/test-runner.js:511` 注释：写清生产侧写入者与 runner 注入的边界

## 3. 反证（变异，必须逐条指名红）

- [x] 3.1 驱动入库 `scripts/theme-entry-contract-mutate.js`（沿用 `keyboard-cards-contract-mutate.js` 形态：`process.execPath` 直跑 vitest 入口，POSIX 可复跑，入口缺失走 blind 档不当通过）
- [x] 3.2 变异集至少覆盖：摘掉 `main.js` 的挂载前调用 / 把单例退回"每次调用各建一份" / 词表放宽接受任意字符串 / 镜像优先级改成"镜像赢真源" / radiogroup 少一个 `aria-checked` / 监听注册不退计数 / locales 只写 zh 不写 en
- [x] 3.3 正控一条：合规形态（把 `data-theme` 写成 light、镜像与真源一致）必须**保持绿**

## 4. 验证与视觉

- [x] 4.1 本地全跑：`useTheme.test.js` + `AppearanceSettings.test.js` + `SettingsDialog.test.js` + `settings-panel-layout.test.js` + `focusable-ring-contract.test.js`（新控件必须过焦点环合同）+ 消费者并集
- [ ] 4.2 `pnpm exec vite build`（或既有构建校验）确认模板编译零错误
- [x] 4.3 静态门禁：`check-locale-sync --cjk --keys`、`check-max-lines`、品牌残留、行尾两口径对账、`check-css-var-defined`
- [ ] 4.4 真 Chromium 取证（本机 dev server + CDP 或 browser MCP）：切暗色后读 `getComputedStyle` 与 `data-theme` 实值；截一张暗态现场
- [ ] 4.5 推送后取**同一次 CI** 的 `settings-general` 浅/暗渲染产物重建两张基线，并自证"新基线 vs 同一次 CI 渲染 == 0 px"；禁止本机截图与 `--update-baseline`

## 5. 文档与收口

- [x] 5.1 `01-docs/PRD.md`：新增/续写「外观设置」一节——三态语义、持久化词表、首帧与真源优先级、控件交互与提示文字、显示项、暗色适配现状与已知残余
- [x] 5.2 `01-docs/UX-AUDIT-2026-10-17.md`：1.1 条目标记完成并附现场读数；把"暗色成果用户不可达"那条 finding 的状态改为已闭合（附取证命令）
- [x] 5.3 `CHANGELOG.md` 顶部条目（含当日读数：测试条数、变异道数、基线两张的来源 run）
- [ ] 5.4 `openspec/records/ux-audit-theme-entry.md` 执行记录（QM-1 不适用：未改 electron 主进程；QM-6 双模型评审逐条处置）
- [ ] 5.5 记忆落盘：内置 + EverOS（单例化取舍、镜像≠第二份事实的锁写法、"runner 注入不等于用户可达"这条取证陷阱）
- [ ] 5.6 PR + CI 全绿后按机械闸门自动合并，回读 merge SHA 与该 merge SHA 上的 main push 结论
