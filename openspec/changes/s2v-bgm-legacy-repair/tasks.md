# Tasks：s2v-bgm-legacy-repair

## 1. 主进程能力（TDD：先红后绿）

- [x] 1.1 写服务测试（`electron/services/story2video-bgm-library.test.js`）：`inspectPath` 判定矩阵 8 例
  - 库内条目（存在、可读、`inLibrary=true`、`reason=ok`）
  - 不存在路径 → `missing`
  - 不支持扩展名（不触盘）→ `format_unsupported`
  - 超 15MB → `size_exceeded`
  - 不在允许根 → `not_allowed`
  - 符号链接 → `not_a_file`
  - 目录 → `not_a_file`
  - 非法入参（空/相对/`file://` 非本地/超长）→ `invalid_argument`
- [x] 1.2 实现 `story2video-paths.js` 导出 `toLocalPath` / `getMediaRule`（行为不变）
- [x] 1.3 实现 `Story2VideoBgmLibrary.inspectPath`
- [x] 1.4 写 IPC 测试并实现 `story2video:bgm-library-status`（成功 + 参数校验失败 2 例）
- [x] 1.5 接线：`PUBLIC_CHANNELS`、`preload/publish.js`、`PUBLIC_METHODS`、`preload.test.js`、`src/api/publisher.js`

## 2. 渲染层状态机（TDD）

- [x] 2.1 `useBgmLibrary.js` 新增 `s2vLegacyBgmStatus` 与 `verifyLegacyBgmLibraryPath` / `adoptLegacyBgmLibrary` / `clearLegacyBgmLibrary`
- [x] 2.2 `useBgmLibrary.test.js`：状态映射、请求代际、adopt 成功/失败、clear（6 例）
- [x] 2.3 `CreateView.vue`：`s2vLegacyBgmStatus` 桥接、watch `s2vLegacyBgmPath`、启动门禁与首条阻塞原因、3 个挂载测试的 API mock 补齐
- [x] 2.4 `CreateView.test.js`：文件丢失阻断 + 清除、加入素材库成功后自动选中、unknown 不阻断、声音摘要含 BGM（4 例）
- [x] 2.5 `s2v-panel-contract.js` 登记新状态键与 3 个方法（父键交叉校验自动覆盖）

## 3. 面板迁移与提示（TDD）

- [x] 3.1 移动「背景音乐」`UiField` 与「背景音乐音量」`UiSlider` 到 `voice` 折叠区，保留全部 `data-testid`
- [x] 3.2 按状态渲染提示行（`role="status"`）与操作按钮：【加入素材库】【清除背景音乐选择】（`data-testid` 新增）
- [x] 3.3 `S2vConfigPanels.test.js`：归属断言（voice 内 / appearance 无）+ 状态渲染 3 例
- [x] 3.4 locales zh/en 成对新增 `bgmLibrary.legacy*` / `blockedReason.bgm*` / `ui.summaryBgm*`

## 4. 文档

- [x] 4.1 新 PRD：`01-docs/PRD-S2V-BGM-VOICE-SECTION-LEGACY-REPAIR-2026-10-17.md`（数据校验/流程/功能逻辑/交互/显示项/提示文字/测试/验收/风险）
- [x] 4.2 `PRD-S2V-PIPELINE-PAGE-UX.md`：§9.2.1 分组归属、§9.7.1 显示项、§11.4/11.5/11.6、新增 §12 契约
- [x] 4.3 `PRD-video-creation.md`：BGM 素材库合同追加历史路径校验与修复
- [x] 4.4 `openspec/specs/story2video-bgm-library/spec.md`（归档时合并 change delta）
- [x] 4.5 `CHANGELOG.md` 顶部条目、`01-docs/learnings.md` 置顶教训

## 5. 质量节拍与交付

- [x] 5.1 定向测试全绿（服务/IPC/preload/composable/面板/壳）
- [x] 5.2 宽范围回归（CreateView 相关 4 文件 + electron ipc-handlers + preload）
- [x] 5.3 ESLint、locale 同步（`check-locale-sync --pair-base/--keys/--cjk`）、debt budget
- [x] 5.4 QM-1：`electron-builder --win --dir`、asar 清单、require 链、8 秒启动 stderr 三层判据
- [x] 5.5 三路记忆：内置（`~/.dsh/memory/Mulpub/`）、外部（`01-docs/learnings.md` + gstack `learnings.jsonl`）、EverOS add→flush→读回
- [ ] 5.6 提交、推送、开 PR；CI 全绿后 squash 自动合并并删除远端分支
- [ ] 5.7 合并后：`openspec archive`、同步 spec、记录远程同步 PASS + merge SHA、清理 worktree
