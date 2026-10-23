# Proposal: film-taskid-path-safety

## Why

影视工程有 **5 个入口**以 `taskId` 定位受控媒体根下的目录（`production-plan` / `production-run-batch` / `production-status` / `production-retry-shot` / `download-recycled`），
它们共享同一个路径遍历防护判据：

```js
taskId !== path.basename(taskId)
```

**这个判据有两个洞。**

### 洞 1：`.` 与 `..` 放行 ⇒ 目录逃逸一层

`path.basename('..')` 就是 `'..'`，恒等式成立 ⇒ **被放行**。于是：

```js
path.join(getFilmMediaRoot(), 'production', '..', 'recycled')
// = <mediaRoot>/recycled     ← 逃出了 production/ 这一层
```

`taskId: '.'` 同理。两个不同的 taskId 可以落到同一目录（`..` 与名为 `recycled` 的任务撞车）。

### 洞 2：分隔符语义平台相关 ⇒ POSIX 上 Windows 风格穿越被放行

`path.basename` 的分隔符语义是**平台相关**的：POSIX 上 `\` 是合法文件名字符，
于是 `a\b` 在 Linux 上 `basename` 仍是 `a\b` ⇒ 放行；同一份代码在 Windows 上则拒绝。
**同一输入、两平台两种结论。**

这不只是观感问题：`download-recycled` 的既有测试里就有一条
`{ taskId: 'a\\b', ... }` 期望被拒，**它在 Linux 上恒失败**（`a\b` 放行 → 落到下载分支 →
测试注入的 `_testDownloadShot` mock 返回 `undefined` → `results[i] = r.ok` 抛
`TypeError: Cannot read properties of undefined`）。

**该测试失败长期挂在 main 上**，此前被当作「与本次改动无关的既有失败」登记在
`openspec/records/film-production-artifact-identity.md` 的遗留里。**它不是环境噪声，是一个真缺陷。**

### 更要紧的：spec 本身把有洞的判据写成了合同

`openspec/specs/film-engineering/spec.md:215` 原文：

> 路径二 SHALL 逐条 fail-closed 校验：`taskId` 非空且满足 `taskId === path.basename(taskId)`（路径遍历防护）

⇒ 这**不是「实现偏离 spec」，而是「spec 判据本身有洞」**。只改实现会让 spec 与现实脱节，
必须走 MODIFIED Requirements。

## What Changes

- **新增单一真源** `isSafeTaskId(value)`（`services/film-engineering/production-driver.js` 导出）：
  非空字符串、不含首尾空白、不等于 `.` / `..`、不含 `/` 与 `\`。
- **5 个入口全部改用它**：`film-engineering-production.js`（2 处）、
  `film-engineering.js`（1 处）、`production-driver.js`（1 处）——
  消除「每个调用点各拼一次判据」的结构。
- **spec delta**：
  - MODIFIED「失败分镜单镜重试」——把 `taskId === path.basename(taskId)` 换成路径安全段合同引用；
  - ADDED「任务标识的路径安全段合同」——写明判据、平台无关性、以及「只多拒、不少拒」的收紧方向。

### 为什么不用字符集白名单

`/^[A-Za-z0-9._-]{1,64}$/`（前端已有的 taskId 规则）也能挡住全部危险输入，但它会**收紧到与前端完全同口径**，
后端不再接受含中文或空格的 taskId。而当前后端判据允许这些，且存量 taskId 就是这么产生的
（前端有校验，但后端是 API 边界，direct 调用方可能用过更宽的 taskId）。
**改用「精确路径语义」判据 ⇒ 只多拒 `.`/`..`/含分隔符/空/首尾空白五类，其余原本能用的全部继续能用。**

## Capabilities

### New Capabilities

（无——归属既有 `film-engineering` 能力）

### Modified Capabilities

- `film-engineering`：
  - **「失败分镜单镜重试」**——路径二校验条款的判据表述；
  - **新增「任务标识的路径安全段合同」**——5 个入口共用的判据与其平台无关性。

## 影响面

| 文件 | 改动 |
|---|---|
| `services/film-engineering/production-driver.js` | 新增并导出 `isSafeTaskId`；自身守卫改用它 |
| `ipc-handlers/film-engineering-production.js` | 2 处守卫改用它（`production-retry-shot` / `production-status`） |
| `ipc-handlers/film-engineering.js` | 1 处守卫改用它（`download-recycled`） |
| `services/film-engineering/production-driver.test.js` | 新增 3 条用例（含变异反证） |

**不改任何运行行为**，除收紧上述五类危险 taskId。

## 遗留（不在本 change 范围）

- **auto 模式的批次产物身份漂移**（另立 change）：auto 模式按**批内序号**命名产物
  `shot_NNN.mp4`，而 `project.shots` 是可编辑状态。删除中间一个镜后，后续镜的产物错位一位，
  `collectMissingShots` 仍判「齐备」⇒ 成片内容错位。
  **已实跑复现**，但**修法与本 change 不同**（不能照搬手动出片的批次指纹——那会让用户改一个字就丢光已生成视频；
  auto 需要自己的按 shotId 寻址方案）。详见下一轮的 openspec 提案。
