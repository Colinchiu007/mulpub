---
record: film-auto-f3a-e2e
task: 把 F-3 拆成「应用链路 / 真 provider」，并用真 ffmpeg 闭合应用链路那一半
date: 2026-10-24
branch: film-auto-f3a-e2e
---

# F-3a：应用侧出片链路端到端（生成层用桩 + 真 ffmpeg 合成）

## 1. 起因：M0 门被「没有 provider 凭据」卡住，但卡过头了

M0 的三项前置取证（F-1 音轨 / F-2 镜长逐档 / F-3 出片路径）此前都被记成
「**需要真实 provider 通道**」⇒ 本会话所在环境无凭据 ⇒ 三项全挂 ⇒ M0 门一直开着，
而长篇化线上**已无任何可立即做的实现项**（M0′.1/.2/.4/.5 + M0.6 已落地，M0′.3 与 M1/M2/M3
按纪律等 F-2 的三态结论）。

复核 F-3 的原始定义后发现：**它捆了两件不依赖同一份凭据的事**——
- **应用侧出片链路**：`plan → 逐镜调度 → 台账落盘 → 收口清单 → 合成 → final.mp4`。
  生成层（provider 调用）可以换桩，**合成层与产物校验用真 ffmpeg / 真 ffprobe**；
- **真 provider 出片**：音轨与镜长可控性 ⇒ 确实必须要凭据。

⇒ 拆成 **F-3a（应用链路）/ F-3b（真 provider）**，前者当场可做。

## 2. 既有覆盖的边界（先核实，再补）

逐条核实后确认既有测试**不是「没有测试」**，而是各覆盖一半：

| 既有文件 | 覆盖 | 缺口 |
|---|---|---|
| `film-manifest-compose-run.test.js` | 合成阶段的**编排形状**（manifest 直通六阶段、产出 `finalPath`） | 它用 `_testRunTool` 桩把 `final.mp4` 写成字符串 `'fake-final'`、用 `_testProbe` 桩返回假 SPEC ⇒ 证明的是「**调用形状正确**」，**不证明**「真 ffmpeg 真能出一条可播的成片」 |
| `auto-runner.test.js` | 批执行**语义**（提示词真源、磁盘为真、原子重生成、轮次隔离） | 生成函数是假对象、**不产真实文件** |

⇒ 两块之间的**衔接**（自动模式逐镜产物 → 收口清单 → 真 ffmpeg 合成 → 可播成片）**从未被验过**。

## 3. 本次落地

**新增**：`apps/desktop/electron/services/film-engineering/auto-film-compose-e2e.test.js`（2 个用例）

链路（**除生成层外全是生产代码**）：

| 环节 | 用什么 | 断言 |
|---|---|---|
| 规划 | 真 `planAutoShots` | 12 镜、逐镜提示词非空 |
| 台账 | 真 `createProject` / `writeProject` | `project.json` 落盘 |
| 逐镜出片 | 真 `runAutoBatch`（生成函数用桩） | 12 个片段真落盘；按 `PRODUCTION_BATCH_SIZE` **分 2 批**、目录按批隔离 |
| 台账回写 | 真 `syncProjectFromDisk` | 12 镜全 `status='done'`、`outputPath` 指向真实文件 |
| 收口清单 | 真 `parseRenderManifest` | 跨批 manifest，`orderIndex` 0..11 连续 |
| 合成 | 真 `film-render`（真 ffmpeg） | `final.mp4` 产出 |
| 产物有效性 | **真 ffprobe** | 1 条视频流、分辨率符合、**时长 = 12 × 档位 ± 容差** |
| 缺镜 | 真 `parseRenderManifest` | 少 1 镜 ⇒ **合成 fail-closed、无 `final.mp4`** |

**同步文档**：`01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md` **v1.3 → v1.4**
（§0.2 订正、§0.4 总览图、§三 F-3 拆 a/b、§3.1 新增「F-3a 已闭合」、
§四 R11 现状、§五 M0 里程碑表 M0.3/M0.3b、§五 M0.5 产出物版本号、§5.1.9 遗留表、§六 A26a/A26b）。

## 4. 变异验证（证明断言有牙齿）

| 变异 | 期望 | 实测 |
|---|---|---|
| 桩不真编码（写字符串当 mp4） | 「产物有效性」断言红 | ✅ 红：`film_render 规格探测失败：moov atom not found` |
| manifest 少一条（11 镜） | 「时长」断言红 | ⚠️ **首轮红在计数断言上**（变异被打偏，未打到时长断言）⇒ 同步放宽计数断言后重做 |
| 同上（重做） | 「时长」断言红 | ✅ 红：`expected 55.199 to be greater than 58`（11 × 5 秒 = 55.2 秒） |

> 记一笔：**变异首轮「红在别处」不等于锁没牙齿**，也不等于锁有牙齿——它只说明变异打偏了。
> 必须把变异调到「能穿过前置断言、打到目标断言」再判。

**收集口径核对**（新增测试文件 ≠ 会被跑）：用仓内 `vitest.config.js` **原样**的 include/exclude
表达式判定本文件 ⇒ 命中；并加两条反向对照（同目录既有测试命中 / 非 `.test.js` 与 `tests/e2e/**` 不命中）
⇒ 判据本身有区分度。

## 5. 诚实边界（F-3a **不**证明什么）

- **不证明**真 provider 产对白音轨 ⇒ 那是 **F-1**；本项断言的音轨存在性来自**桩产的静音轨**，
  只能证明「合成层会带上音轨流」；
- **不证明**真 provider 接受应用下发的镜长 ⇒ 那是 **F-2**；
- **不覆盖**「渲染端经既有 pipeline 通道发起合成」那一跳的**跨进程**部分
  ⇒ 由 `tests/e2e/film-auto-mode-driver.js` Phase 2 覆盖，它需要真 provider；
- 绿灯是「**范围受限的观测**」：**应用侧出片链路通**，**不是**「真 provider 能出片」。

⇒ **M0 门由三项收敛到两项**（F-1 / F-2），且这两项**可合并成同一次真机出片**
（同一批产物，音轨与时长一起量）⇒ 不额外增加出片成本。
⇒ **M0′.3 与 M1/M2 仍然等 F-2 的三态结论**——本次**不改变**那个门。

## 6. 本地验证读数

| 项 | 读数 |
|---|---|
| 新测试 | 2/2 绿（真 ffmpeg 合成 + 真 ffprobe，沙箱本地实跑） |
| 变异验证 | 2 组，均红在目标断言上 |
| 收集口径 | 仓内 include/exclude 命中本文件（含 2 条反向对照） |
| 行数门禁 | 见 §7 |
| 编码 | 无 U+FFFD（见 §7） |

> 沙箱内跑 vitest 的方式：仓内 `apps/desktop` 无依赖树，故在快盘单独装 vitest，
> 用**最小配置**（只含本文件、不含仓内 setupFiles）实跑；`vitest/config` 与 vue 插件
> 用软链从快盘解析。⚠️ 这是**本地验证手段**，不是交付物；CI 侧照仓内 `vitest.config.js` 跑。

## 7. 门禁

见 PR 评论与 CI。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
