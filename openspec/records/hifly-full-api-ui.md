---
record: hifly-full-api-ui
task: 飞影 11 个扩展端点的 UI 接入（IPC + preload + renderer API + 面板）
date: 2026-10-24
---

## 本次执行记录：飞影 11 端点 UI 接入（hifly-full-api-ui）

| 门禁 | 状态 |
|---|---|
| 变更类型与隔离 | ✅ 运行时代码，worktree `mp-hifly-full-api-ui`（`<worktree 根目录>/mp-<task>`，非 C 盘） |
| docs-only 判定 | 由门禁推导 |
| TDD | ✅ 组件 7 例 + IPC 9 例，先写测试后实现 |
| 回归零破坏 | ✅ 契约/关键文件 **53/53** 全绿 |
| 超大文件 | ✅ `check-max-lines.js` 通过（locale en 504→463，见 §4） |
| 债务基线 | ✅ `check-debt-budget.js` 全过 |
| locale 成对 | ✅ `--keys` PASS（2289）、`--cjk` PASS（1115） |
| 同型风险锁 / 品牌 / 绝对路径 | 待跑 |
| 依赖漏洞审计 | 待跑 |
| 远程同步 | 由门禁推导 |

- 保留门禁：品牌残留 ✅ | doc-abs-paths ✅ | 远程同步 PR #NNNN

## 一、做了什么

把 `hifly-full-api`（11 个 adapter 端点）接通到渲染层，交付一条**完整可用**的链路：

```
HiflyExtraPanel.vue
  └─ src/api/hifly-extra.js          (11 个导出，方法名写字面量)
       └─ preload/hifly-extra.js     (hiflyExtra.* 11 个通道封装)
            └─ ipc-handlers/hifly-extra.js  (11 个通道 + 形状校验 + 能力探测)
                 └─ adapters/hifly-extra.js + hifly-create-modes.js  (change: hifly-full-api)
```

| 层 | 文件 | 行数 |
|---|---|---|
| IPC | `ipc-handlers/hifly-extra.js` | 约 380 |
| preload | `preload/hifly-extra.js` | 33 |
| renderer API | `src/api/hifly-extra.js` | 约 150 |
| 组件 | `views/video-creation/HiflyExtraPanel.vue` | 约 420 |
| locale | `locales/create/hifly-extra/{zh,en}.js` | 42 键 × 2 |

## 二、11 个端点的 UI 形态

一个面板装 7 个模式（6 个收费创作 + 1 个免费封面），另把 4 个辅助端点嵌进相应位置：

| 端点 | UI 位置 |
|---|---|
| `getAccountCredit` | 面板顶部积分条（余额未知显示「—」，不显示 0） |
| `listLivelyTemplates` | 「网感模板」模式内的模板选择器 |
| `listCoverStyles` | 「创建封面」模式内的模板选择器 |
| `createCover` | 「创建封面」模式 |
| `deleteWork` | 结果区的「删除作品」按钮（**只在该模式可删时出现**） |
| `createVideoByAudio` | 「声音驱动」模式 |
| `createVideoByTemplate` | 「网感模板」模式 |
| `translateVideo` | 「视频翻译」模式 |
| `createVideoBySing` | 「唱歌」模式 |
| `createVideoByImage` | 「图片驱动」模式 |
| `createAudioByTts` | 「音频创作」模式 |

## 三、三个关键设计判断

### 3.1 一个面板 + 数据驱动，而不是 7 个组件

11 个端点里 6 个是「同一件事的不同输入方式」，字段高度重叠。用一个 `MODES` 配置数组驱动表单渲染，
差异全部集中在配置里——比写 7 个几乎相同的组件更不容易漂移。

### 3.2 能力未就绪时**整体隐藏**，不是逐个报错

上游 adapter 方法（`hifly-extra.js` / `hifly-create-modes.js`）只有 `hifly-full-api` 合并后才存在。

IPC 层做 `supportsAdapterMethod` 探测，未实现时回 `HIFLY_EXTRA_UNSUPPORTED`；面板收到后
整体显示「当前服务商尚未支持该能力」并**隐藏所有表单**。

这样本 PR 可以先合，`hifly-full-api` 合并后能力自动生效——两边不需要互相等。这是本仓
「capability 驱动 UI、不支持就不渲染」原则的延续。

### 3.3 收费提示与「删除入口」的两条产品约束

- **收费提示**：6 个创作模式都收费且额度未知 ⇒ 固定显示「将消耗积分」，**不本地估算金额**（官方没给单价，估算是假精度）。余额已知且 ≤ 0 时直接禁用提交，避免打一次必然失败的请求。
- **创建封面免费**：它是唯一免费的创建类端点，因此**封面模式不显示收费提示**。测试专门锁了这条差异。
- **删除入口**：官方明确只有普通视频创作的任务能删（翻译/唱歌/图片驱动不支持）。`deleteWork` 无法本地判定任务来源，所以「只在该模式可删时显示按钮」是 UI 的责任，配置里用 `deletable: false` 表达，测试锁了「翻译模式不出现删除按钮」。

## 四、两个门禁红与修法（如实记录）

### 4.1 `locales/create/en.js` 504 行触到 500 硬线

42 个新键把 en.js 从 462 推到 504。

**修法**：按既有 `avatar/`、`ui/` 子目录范式，把 42 个键拆到 `locales/create/hifly-extra/{zh,en}.js`，
主文件恢复 458/463 行。**不是**上调基线。

### 4.2 `ipc-exposure-contract` 报「生产侧不应存在动态取名调用点」

我最初在 `src/api/hifly-extra.js` 里用 `call(method, input)` 统一封装，`method` 是**变量**——
契约测试无法逐条对账到 preload 暴露面，因此判红。

**修法**：11 个导出全部改成写字面量 `invokeNamespace(NS, 'xxx', input)`。
这条约束的设计意图是「让对账看得见每条路径」，动态取名会让判据覆盖不到。

同时在 `SCAN_DOMAIN` 里登记 `hifly-extra.js`（该测试要求每个触碰 IPC 的 api 文件都在域内）。

## 五、本轮明确不做

| 项 | 理由 |
|---|---|
| 接线到 CreateView / S2vConfigPanels | 需要定「入口放哪个管线、什么时候显示」；组件已自包含、随时可挂 |
| 文件上传 UI（音频/图片/视频选本地文件） | 需要主进程 dialog + 一次性令牌（与 avatar-clone 的 chooseMedia 同型），是独立一层 |
| 真实端点调用验证 | 6 个创作端点收费、额度未知 |

即：**本轮交付「完整链路 + 可独立挂载的面板」**，接线与文件选择是下一步。

## 六、测试读数

| 文件 | 例数 |
|---|---|
| `HiflyExtraPanel.test.js` | **7/7** |
| `ipc-handlers/hifly-extra.test.js` | **9/9** |
| `ipc-exposure-contract.test.js`（含 SCAN_DOMAIN 登记） | 20/20 |
| `i18n.test.js` | 17/17 |
| 合计（4 文件） | **53/53** |

## CHANGELOG 条目

# feat(video): 飞影 11 个扩展能力接入界面——创作模式面板 + 积分显示

- 新增「飞影扩展能力」面板：7 个模式（声音驱动 / 网感模板 / 视频翻译 / 唱歌 / 图片驱动 / 音频创作 / 创建封面）共用一套数据驱动的表单。
- 面板顶部显示剩余积分；余额为 0 时禁用收费模式的提交，避免白打一次必然失败的请求。
- 6 个创作模式固定显示「将消耗积分」，**创建封面不显示**（它是免费的）。
- 删除作品入口只出现在「普通视频创作」类模式上——翻译、唱歌、图片驱动的任务官方不支持删除。
- 上游能力未就绪时面板整体显示「暂不可用」并隐藏表单，而不是给出一堆点了必然失败的按钮。

## 八、CI 侧又抓到两个本地门禁漏掉的项（2026-10-24 19:15 补）

PR #4387 首轮 CI 的 `QG Static` 判红。逐条在本地复现后定位到两个**真实**问题：

### 8.1 `check-font-size-scale.js`：6 处 font-size 字面量

组件 scoped style 里写了 6 处 `font-size: 12px`。判据要求用设计令牌，改为 `var(--font-size-xs)`。

> 这条本地首轮没跑（只跑了 max-lines / debt / locale / eslint），是 CI 补上的。

### 8.2 `check-ipc-sender-guard.js`：动态通道名被判「重复注册」

原来用 `for (const [channel, method] of Object.entries(CHANNEL_METHODS))` 循环注册，
写法是 `ipcMain.handle(channel, ...)`。静态判据只认**字面量通道名**，于是把它读成
`<expr:channel>`，并与 `automation.js:35` 的同型表达式判为「重复注册且守卫状态不一致」。

**修法**：改成工厂 `makeHandler(method, normalize)` + **11 条显式注册**（通道名字面量），
公共逻辑收进工厂。判据意图正是「让每条通道的守卫看得见」，所以字面量是对的方向，
不是把判据改宽。

修后：`check-ipc-sender-guard` **PASS**、`check-font-size-scale` **OK**、IPC 测试 **9/9** 仍绿。

### 教训

**本地门禁集不等于 CI 的 `QG Static`。** `QG Static` 含 18 个脚本，我首轮只跑了 5 个。
以后改 Electron IPC / Vue 组件的任务，提交前应把那 18 个脚本**整组**跑一遍
（尤其 `check-ipc-sender-guard`、`check-font-size-scale`、`check-color-literals`、
`check-vue-style-parse`），而不是按「我猜相关的」挑几个。