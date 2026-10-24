---
record: fix-title-card-ffmpeg-stdin
task: 修主干红——标题卡渲染在 Windows runner 上挂死不可诊断（QG Desktop Shards 2/2 + Gate Result）
date: 2026-10-24
branch: fix-title-card-ffmpeg-stdin
---

| 远程同步 | 由门禁推导 |

## 现象

主干 `quality-gate` 的 `QG Desktop Shards (2/2)` 红，`Gate Result` 随之红；
`title-card-renderer.test.js` 里两个渲染用例各卡满 vitest 的 `testTimeout`（10s）：

```
FAIL  electron/services/title-card-renderer.test.js > title-card-renderer 实际渲染 > 含 ffmpeg 滤镜特殊字符的文案不得让渲染炸掉
Error: Test timed out in 10000ms.
FAIL  electron/services/title-card-renderer.test.js > title-card-renderer 实际渲染 > 带单引号的文案必须真渲染出内容（防「rc=0 但产出空白图」的静默失败）
Error: Test timed out in 10000ms.
```

同一文件里第一个渲染用例（不含特殊字符）**58ms 通过** ⇒ 稳定复现，不是 flaky。

## Bug 反思 5 步（QM-5）

### ① 第一性原因

渲染调用 `renderTitleCard` 交给 ffmpeg 的命令行**没有 `-nostdin`**，且 `execFile` 的
stdin 是**未关闭的 pipe**（父进程写端一直开着）。ffmpeg 一旦因任何原因去读 stdin，
就会**永久等待**，而调用方拿到的只是一个「超时」——现场（argv、stderr、退出码）全部丢失。

同时内部 `timeout: 30000` **大于** vitest 的 `testTimeout=10000`
⇒ 即便 ffmpeg 挂住被内部超时杀掉，vitest 也已经先判超时
⇒ 失败形态永远是 `Test timed out in 10000ms`，日志里没有任何 ffmpeg 现场。

### ② 测试逃逸链

| 层级 | 本该拦住 | 实际 |
|---|---|---|
| 单测断言 | 渲染必须产出有内容的 PNG | **存在**（体积下限 >2000 / >3000 字节） |
| 用例是否真的执行 | — | ⛔ **没执行** |
| CI | Desktop Shards 2/2 | ⛔ **绿灯（假绿）** |

逃逸的关键在「用例是否真的执行」这一层：`itWithFfmpeg = ffmpeg ? it : it.skip`
——**环境里没有 ffmpeg ⇒ 整组渲染断言全部跳过** ⇒ CI 绿，但那些断言**从未执行过**。

### ③ 系统性漏洞

**「条件跳过」把「依赖外部二进制的断言」整体变成了「环境决定断言强不强制」的开关。**
凡是 `xxx ? it : it.skip` 形态的守卫，一旦外部依赖在某个环境下缺失，
该组断言就变成**永远不跑的条文** —— 且 CI 全绿，无任何信号。

同类形态在本仓已出现三次（媒体工具缺失 ⇒ 统计断言恒假；缺 ffmpeg ⇒ 用例真去调而超时；
本例：缺 ffmpeg ⇒ 整组 skip 而绿灯）。

### ④ 修复 + 回归保护

**修复**（`apps/desktop/electron/services/title-card-renderer.js`）：

1. ffmpeg argv 加 **`-nostdin`**（ffmpeg 官方开关「禁用 stdin 交互」）
   ⇒ 即使 ffmpeg 因任何原因去读 stdin，也会立刻失败而不是永久等待；
2. `execFile` 的 `stdio` 显式改为 `['ignore','pipe','pipe']` ⇒ **stdin 关闭**；
3. 内部 `timeout` 由 30000 降到 **8000**（小于 vitest 的 10s）
   ⇒ 超时由「渲染器内部」而不是「测试框架」捕获，失败形态从「超时」变成「可读的 ffmpeg 错误」；
4. 失败信息带出 **argv 与 ffmpeg 的 stderr 尾巴**
   ⇒ 以后这类问题**当场可诊断**，不必再靠猜。

**回归保护**（`apps/desktop/electron/services/title-card-renderer.test.js`）：

- 两个渲染用例给**独立 30s 超时**（必须 > 内部 8s × 两次 fallback = 16s，
  否则内部超时还没来得及冒泡，测试框架又先判超时）；
- **新增一条不依赖 ffmpeg 存在的锁**：用 **node 自己冒充 ffmpeg**
  （`ffmpegPath: process.execPath`，node 拿到 `-nostdin` 会立刻失败退出），
  断言错误信息里**必须**出现 `-nostdin` / `| argv:` / `| stderr:`。
  ⇒ 这条锁在任何机器上都会执行 ⇒ 「渲染断言因为缺 ffmpeg 而整组 skip」的漏洞被堵死。

### ⑤ 预防措施

- 守卫形态的用例（`xxx ? it : it.skip`）**至少要有一条不依赖该前置条件的锁**，
  否则「绿色」只证明「环境恰好有那个依赖」；
- 任何把外部进程放进 `execFile` 的调用，**一律显式关 stdin + 显式传 `-nostdin`**，
  并让**内部超时小于调用方超时**，否则失败现场永远拿不到；
- 失败信息必须带 argv / stderr / 退出码，否则 CI 上只剩「超时」二字。

## 已知边界（如实记录）

- 本片**无法在沙箱复现原始挂死**：沙箱是 Linux + ffmpeg 5.1.9，三个用例均约 0.5s 通过；
  CI 是 Windows + `ffmpeg-ffprobe-static@6.1.2-rc.1`（该版本自 monorepo 迁移起未变）。
  ⇒ 本片采取「**机制性加固 + 失败可诊断**」双管齐下：
  若 `-nostdin` 正是根因则直接转绿；若不是，下一轮 CI 日志会带出 ffmpeg 的
  argv 与 stderr，可据此继续定位（不再需要猜）。
- 沙箱已实测通过：三个原用例仍通过（约 0.3–0.8s）；新锁的三项断言（`-nostdin` /
  `| argv:` / `| stderr:`）全部命中。

## 附带发现（不在本片范围，登记待办）

`定时作业心跳巡检` 亦为红，根因与本片无关：`check-schedule-heartbeat.js` 把
「workflow 从未跑过」直接判 FAIL，而**新加入的 workflow 在其首次 cron 触发前必然 NEVER_RAN**
（含巡检作业自身 ⇒ 自指）。属门禁设计缺陷，另片处理。
