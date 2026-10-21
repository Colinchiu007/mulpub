## 1. 现状核对（先证伪「只有故事讲述有配置管理」）

- [x] 1.1 核对创作页「保存配置 / 我的配置」按钮的显示条件（是否与流水线类型相关）
- [x] 1.2 核对编排型 / legacy 型快照白名单
- [x] 1.3 核对独立页（视频克隆 / 影视工程）的配置管理
- [x] 1.4 核对既有规格 `story2video-pipeline-config-profiles` 的「所有流水线都有配置管理」Requirement
- [x] 1.5 结论落文档（PRD §1.2 / §10.2）

## 2. 纯函数模块（先测后码）

- [x] 2.1 `features/publish-destination/publish-destination-config.js` 骨架
- [x] 2.2 `normalizeConfigProfiles`：非法条目逐条丢弃、其余保留；`updatedAt` 非法归零
- [x] 2.3 `filterConfigProfilesByPipeline`：按 `pipelineId` 过滤 + `updatedAt` 倒序
- [x] 2.4 `resolveConfigSelection`：选项 + 选中项解析；选中项不在选项里时回落空串
- [x] 2.5 `buildPublishVideoSelection`：非法配置 id 清空
- [x] 2.6 `buildCreateHandoffQuery`：空值/非法值一律不带键
- [x] 2.7 对应单测 `publish-destination-config.test.js`（15 例）

## 3. 弹窗（`components/PublishDestinationModal.vue`）

- [x] 3.1 流水线下拉改用文案型全集（`TEXT_BASED_PIPELINE_IDS` 只读导出）
- [x] 3.2 配置选择器：触发器 + 菜单 + 空态（显示「默认」、下拉内容为空）
- [x] 3.3 三态提示：加载中 / 加载失败 / 无配置
- [x] 3.4 联动：切流水线清空已选配置；配置消失回落「默认」
- [x] 3.5 每次打开重新拉配置库
- [x] 3.6 `publish-video` 事件增加第 2 个载荷参数（向后兼容）
- [x] 3.7 组件测试新增 12 例（A1..A9 + 5 例键盘可达：↓ 展开、↑/↓/End/Esc、Enter 选中、空格选中、Home+空格选中「默认」）

## 4. 交接与创作页套用

- [x] 4.1 改写页 `onPublishVideo` 带上 `configProfile`
- [x] 4.2 采集页 `onPublishVideo` 带上 `configProfile`
- [x] 4.3 热门选题页：流水线 + 配置档案随队列项带到最终跳转（修 P3 断链）
- [x] 4.4 创作页 `_applyConfigProfileFromRoute()`：四道校验闸 + 复用 `applyS2VConfigProfileSnapshot`
- [x] 4.5 竞态修复：留住「恢复上次选项」的 promise，套用配置前 await（配置必胜）
- [x] 4.6 创作页测试 `CreateView.config-profile-handoff.test.js`（4 例，A10..A13）
- [x] 4.7 交接模块改**显式依赖注入 + 纯决策函数**（QM-6 第 1 轮 i4）：模块不再认识 Vue
- [x] 4.8 `loadProfiles` 失败被吞并并给**独立**提示 `handoffLoadFailed`（QM-6 第 2 轮 i2）
- [x] 4.9 交接模块测试 `apply-config-profile-handoff.test.js`（13 例）

## 5. i18n

- [x] 5.1 `locales/publish-destination/{zh,en}.js` 新增 5 键
- [x] 5.2 `locales/create/{zh,en}.js` 新增 `configProfile.notFound`
- [x] 5.3 locale 键对账（`--keys` / `--cjk` 两档）
- [x] 5.4 `locales/create/{zh,en}.js` 新增 `configProfile.pipelineUnresolved` + `configProfile.handoffLoadFailed`（共 3 键）

## 6. 文档

- [x] 6.1 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（详细 PRD）
- [x] 6.2 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §14
- [x] 6.3 CHANGELOG 条目真源落 `openspec/records/publish-config-picker.md` 的 `## CHANGELOG 条目`（`01-docs/CHANGELOG.md` 是**热写面**，由 `scripts/aggregate-changelog.js` 搬运，本 change 不直接改）
- [x] 6.4 `openspec/records/publish-config-picker.md`（执行记录）
- [x] 6.5 `openspec/changes/publish-config-picker/{proposal,tasks,design,spec}.md`
- [x] 6.6 spec 补「配置选择控件的键盘可达」Requirement 与「配置列表载入失败」Scenario（QM-6 第 2 轮 i1/i2：契约进规格，才不会再出现「文档承诺了、代码没写」）

## 7. 质量节拍

- [x] 7.1 QM-2：ESLint / 行尾对账 / 品牌残留 / 文档同步
- [x] 7.2 QM-1：本地打包验证
- [x] 7.3 QM-4：视觉（发布去向浮窗无视觉基线；流水线下拉选项集合变化不涉及基线页面）
- [x] 7.4 QM-6：CCG 外部双家族评审（**两轮**：第 1 轮 4 条 + 3 Info，第 2 轮 3 条 + 2 Info；逐条裁决落 `.adversarial/ccg-deep-*/adjudication.json`）
- [x] 7.5 `openspec validate --strict` 通过
- [x] 7.6 proposal 的 Impact 声明改为**完整仓库相对路径**（决策层按路径逐字比对，省略前缀会被误报「范围漂移」）
