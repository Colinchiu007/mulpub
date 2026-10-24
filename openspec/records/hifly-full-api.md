---
record: hifly-full-api
task: 补齐飞影官方剩余 11 个端点（辅助管理 5 + 创作模式 6）
date: 2026-10-24
---

## 本次执行记录：飞影 API 全量接入（hifly-full-api）

| 门禁 | 状态 |
|---|---|
| 变更类型与隔离 | ✅ 运行时代码，worktree `mp-hifly-full-api`（`<worktree 根目录>/mp-<task>`，非 C 盘） |
| docs-only 判定 | 由门禁推导 |
| TDD | ✅ 两个新文件都先写测试后实现：`hifly-extra.test.js` 19 例、`hifly-create-modes.test.js` 25 例，先 RED 后 GREEN |
| 回归零破坏 | ✅ 8 个 adapter 相关测试文件 **215/215** 全绿 |
| 超大文件 | ✅ `check-max-lines.js` 通过（hifly.js 469 ≤ 500；两个新文件 292 / 354） |
| 债务基线 | ✅ `check-debt-budget.js` 全过 |
| locale 成对 | 本 PR 未改 locale |
| 同型风险锁 / 品牌 / 绝对路径 | 待跑 |
| 依赖漏洞审计 | 待跑 |
| 远程同步 | 由门禁推导 |

- 保留门禁：品牌残留 ✅ | doc-abs-paths ✅ | 远程同步 PR #NNNN

## 一、做了什么

把飞影官方**剩余 11 个端点**全部实现，使能力面完整覆盖（唯一例外见 §5）：

| # | 端点 | 方法 | 计费 |
|---|---|---|---|
| 1 | `GET /account/credit` | `getAccountCredit` | 免费 |
| 2 | `GET /video/lively_templates` | `listLivelyTemplates` | 免费 |
| 3 | `GET /project/cover_styles` | `listCoverStyles` | 免费 |
| 4 | `POST /project/covers` | `createCover` | **免费** |
| 5 | `DELETE /video/task` | `deleteWork` | 免费 |
| 6 | `POST /video/create_by_audio` | `createVideoByAudio` | 收费 |
| 7 | `POST /video/create_by_template` | `createVideoByTemplate` | 收费 |
| 8 | `POST /video/translate` | `translateVideo` | 收费 |
| 9 | `POST /video/create_by_sing` | `createVideoBySing` | 收费 |
| 10 | `POST /video/create_by_image` | `createVideoByImage` | 收费 |
| 11 | `POST /audio/create_by_tts` | `createAudioByTts` | 收费 |

详细契约、数据校验、交互逻辑、显示项与提示文字见
`01-docs/PRD-HIFLY-FULL-API-2026-10-24.md`。

## 二、代码结构（为什么拆两个新文件）

`hifly.js` 已 465 行，`check-max-lines.js` 硬线 500，只剩 35 行余量。11 个端点约 650 行，必须外置：

| 文件 | 职责 | 行数 |
|---|---|---|
| `hifly-extra.js` | 5 个辅助与作品管理端点（全免费） | 292 |
| `hifly-create-modes.js` | 6 个创作模式端点（全收费） | 354 |
| `hifly.js` | 只加 4 行 `Object.assign` 挂载与注释 | 465 → 469 |

挂载与 `hifly-clone.js` 同型（prototype mixin）。

## 三、`KNOWN_METHODS` 登记与实证

`_base/base.js` 的 `KNOWN_METHODS` 是 `callAdapter` 的闸门——不在表里即便实现了也调不到。
已登记 11 个（分组注释写明来源与免费/收费）。

**关键：实跑 `supports()` 逐个核对，不把注释当事实。**

```
OK   getAccountCredit          OK   createVideoByAudio
OK   listLivelyTemplates       OK   createVideoByTemplate
OK   listCoverStyles           OK   translateVideo
OK   createCover               OK   createVideoBySing
OK   deleteWork                OK   createVideoByImage
                               OK   createAudioByTts
caps count: 22   bad: 0
```

> 本仓曾因「只读注释得出 KNOWN_METHODS 未登记」这一错误结论而误判过一次
> （见 `hifly-clone-realrun` 记录第一节）。这次直接实跑。

## 四、几个值得记下的设计判断

### 4.1 `data` 非数组时抛错，不返回空列表

`listLivelyTemplates` / `listCoverStyles` 都做了这条。

**理由**：空列表会被 UI 读成「平台没有模板」——一次解析失败被伪装成业务结论。
同类：`getAccountCredit` 的 `left` 缺失也不兜底成 0（那会显示「没积分了」）。

### 4.2 `createCover` 是免费的——与直觉相反

同为「创建」，视频创作收费而封面不收费。若按「创建类都收费」的直觉做 UI，会给用户错误的成本预期。已在 PRD §1.3 单列。

### 4.3 `createVideoByTemplate` 的 voice/avatar 是**条件必填**

必填性取决于 `videoFileId` 是否给出。这是唯一一组「有条件必填」的参数，测试专门锁了两种情形：
- 只给 `videoFileId + text + template` ⇒ 合法
- 什么都没给 ⇒ 非法

### 4.4 `deleteWork` 的「只支持普通视频创作任务」只能由 UI 保证

官方明确：翻译 / 唱歌 / 图片驱动的任务**不能**删除。adapter 不记录任务来源、无法本地判定，
所以服务端会拒、原文透出。**「只对普通视频创作作品显示删除入口」是 UI 的责任**，
已写进 PRD §3.5 与 §5.3，避免下一轮做 UI 时漏掉。

### 4.5 收费端点失败不自动重试

重试可能重复计费。已写进 PRD §4。

## 五、唯一的「不做」：消息回调

官方「消息回调」是**服务端推送到你提供的 HTTP 端点**，不是客户端调用接口。
本应用是桌面客户端、没有公网回调地址，且当前用轮询（`getVideoStatus`）已能拿到结果。

**明确不实现，理由记录在此**，避免下次盘点时被当成「又漏了一个」。

## 六、未真实调用的端点（已知验证缺口）

| 端点 | 状态 |
|---|---|
| `account/credit` | ✅ 真实调用过（`left: 1582`） |
| 其余 10 个 | ⚠️ **只按官方文档实现，未花积分做真实调用** |

原因：6 个创作端点收费且额度未知；3 个查询端点依赖真实模板 id（要先调创作类接口）。

**这是本轮如实记录的缺口**——接口契约按官方文档实现并用测试锁死，
但「真实响应形态」只有 `account/credit` 核对过。

## 七、本轮明确不做

| 项 | 理由 |
|---|---|
| UI 入口 | 11 个端点的界面工作量 = 6 个创作模式面板 + 3 个选择器 + 作品管理页，远大于 adapter 层 |
| IPC / preload / renderer API | 需先定 UI 形态，否则会做出用不上的通道 |
| 真实调用验证 | 6 个端点收费、额度未知，不在未经用户确认前消耗积分 |

即：**本轮交付「可用但还没有界面」的能力**，契约已锁，UI 接上即可用。

## CHANGELOG 条目

# feat(video): 飞影 API 全量接入——补齐剩余 11 个端点

- 新增 **5 个辅助与作品管理能力**：查询账户积分、网感模板列表、封面模板列表、创建封面、删除作品。
- 新增 **6 个创作模式**：声音驱动（用自己的录音驱动数字人）、网感模板、视频翻译、唱歌、图片驱动、音频创作。
- 所有分页、枚举、长度与范围参数在本地即校验，越界直接提示该改哪个值，不会白打一次远端请求。
- 查询类接口在服务端返回结构不符时报错而非返回空列表——避免把一次解析失败显示成「平台没有内容」。
- 创建封面不消耗积分（与视频创作不同），已在文档中单列说明。
