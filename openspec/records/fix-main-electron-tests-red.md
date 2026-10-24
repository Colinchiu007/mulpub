---
record: fix-main-electron-tests-red
task: 修主干红 —— 出图桩在没有 ffmpeg 的机器上改为兜底 PNG 编码，去掉条件 skip 并补上「尺寸符合请求」的真断言
date: 2026-10-24
---

## 本次执行记录：修主干 electron-tests 红（fix-main-electron-tests-red，2026-10-24）

> **来由**：#4336（AI 讲解视频流水线的零凭据 CDP 复跑能力）交付的**本地 Provider 桩**
> 用 ffmpeg 渲染讲解卡片 PNG。**没有 ffmpeg 的机器**（实测：Windows CI runner）上
> `apps/desktop/tests/local-provider-hub.test.js` 的出图用例被 `ctx.skip()` 跳过，
> 而紧随其后的「调用统计能证明四个 LLM 阶段与出图都真的发生过」**无条件**断言
> `stats.image >= 1` ⇒ `expected 0 to be greater than or equal to 1`
> ⇒ `electron-tests` 分片红 ⇒ **主干红** ⇒ required check 挡住**所有** open PR。
>
> **这条红是「跳过前置条件 ⇒ 静默变成后续失败」的典型形态**：被跳过的不是断言，
> 是**另一个用例的输入**；跳过的动作没人看得见（vitest 只报 skip 数），
> 而后果落在一个**看起来毫不相干**的断言上。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 测试基础设施（仅 `apps/desktop/tests/**`） | worktree `mp-worktrees/mp-fix-main-electron-tests-red`，裸分支 `fix/main-electron-tests-red`；未触 `apps/desktop/electron/` 生产代码 ⇒ QM-1 打包 N/A、QM-4 视觉 N/A |
| 第一性原因（QM-5 ①） | ✅ | 出图桩**只有一条**出图路径（ffmpeg 渲染）⇒ 没有 ffmpeg 的机器上「出图」从未发生 ⇒ 依赖它的计数断言必然为 0。根因不是断言写错，是**被断言的那个事实在那台机器上根本没发生过**，而断言没有把这层依赖说出来 |
| 逃逸分析（QM-5 ②） | ✅ | ① 测试侧：出图用例 `if (!mediaAvailable) return ctx.skip()` ⇒ 无 ffmpeg 的机器上它**不执行**；② 用例顺序侧：统计断言依赖**前一个用例的执行结果**（跨用例的隐式顺序依赖，vitest 不保证执行顺序）；③ 评审侧：PR #4336 的 CI 跑的是**有 ffmpeg 的机器**（或该文件落在另一个分片）⇒ 红只在主干 push 的 runner 上显形，**PR 全绿、主干红**，正是最容易被漏掉的形态 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 桩里加**不依赖任何外部二进制**的 PNG 编码兜底（RGBA8 + zlib + CRC32，尺寸精确）⇒ 出图路径在**每台机器**上都走得通，`stats.image` 的保证恢复为无条件；② 测试里**删掉条件 skip**，并把用例名声称的「尺寸符合请求」变成**真断言**（解析 PNG 的 IHDR 读宽高）；③ 给兜底编码器本身加**常驻单测**（它只在无 ffmpeg 的机器上才会被走到 ⇒ 没有专测就等于它在有 ffmpeg 的机器上从未被执行过） |
| 防止再次发生（QM-5 ⑤） | ⏳（部分，见「遗留」） | 兜底编码器 + `hexToRgb` 两条常驻单测在**每台机器**上跑（`本地 Provider 桩：无 ffmpeg 兜底编码器`）；`renderCard` 的返回值新增 `degraded` 标记，使「这张图是兜底出的」在调用侧可见 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相等；文件内 CR 字节数 = 0；U+FFFD 计数 = 0 |
| 接线棘轮 | ✅ | 新增的 2 条单测在 `apps/desktop/tests/local-provider-hub.test.js`（`apps/desktop` 的 vitest workspace 自动收集）；`apps/desktop/tests/local-provider-hub.test.js` 与 `apps/desktop/tests/e2e/lib/local-provider-hub.js` **同在仓库内**，不新增目录 |
| QM-1 打包 / QM-4 视觉 | N/A | 只改 `apps/desktop/tests/**` 下的测试桩与测试，未触 `apps/desktop/electron/`、未改依赖区间、未触 UI |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无外部评审通道（仓外 claude/opencode 不可用）⇒ **如实写「未执行」，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（只认 squash 尾注 `(#NNNN)`）推导归属 |

## 一、本机实测（逐条亲自跑出来的，不抄 CI 文案）

1. **红在哪**（取自主干 `electron-tests` 分片的原始日志）：
   ```
   FAIL  tests/local-provider-hub.test.js > 本地 Provider 桩：协议兼容 > 调用统计能证明四个 LLM 阶段与出图都真的发生过
   AssertionError: expected 0 to be greater than or equal to 1
       196|     expect(stats.image).toBeGreaterThanOrEqual(1)
   Test Files  1 failed | 572 passed | 1 skipped (574)
   ```
2. **为什么 `stats.image` 是 0**：`this._calls.image++` 在图片端点**被真的请求到**时才会执行；
   而出图用例在无 ffmpeg 的机器上 `ctx.skip()` ⇒ **根本没发那个请求** ⇒ 计数必然是 0。
   ⇒ 不是「计数写错」，是「那条路在那台机器上从未走过」。
3. **兜底 PNG 编码器实测**（本机有 ffmpeg，所以用 `env -i PATH=<无 ffmpeg 的目录>` 屏蔽后重跑）：
   ```
   degraded= true  w= 640  h= 360  bytes= 13736
   IHDR w= 640  h= 360
   ```
   独立解析器校验（不共用桩里任何代码）：
   ```
   签名 OK；IHDR 640x360（bit depth 8 / color type 6）；IDAT 解压 921960 字节（期望 (640*4+1)*360 = 921960）；
   全部 chunk CRC 校验通过；字节数 13736 > 1000
   ```
4. **新增单测的 7 条断言本地全过**（手工跑等价断言）：签名 / IHDR 宽高 / 位深 / 颜色类型 / IEND 收尾 / `hexToRgb` 两例。

## 二、遗留（不假装已闭合）

- **主干红要靠这个 PR 自己解开**：`scripts/check-main-red.js` 的退出码 2 语义明写
  「主干是红的 —— 停手，先有人去修 main；**本 PR 是那一刀的修复时显式加 `--allow-main-red`**」，
  且退出码 0 的定义是「主干绿，**或主干红但已显式归因且本 PR 无新增红**」。
  ⇒ 本 PR 走的就是这条自举出口（归因文本写在本条记录里），不是「把当前 PR 硬合进红主干」。
- **ffmpeg 路径仍然是首选**：有 ffmpeg 时仍走 ffmpeg 渲染**带标题/副标题/进度条的完整卡片**；
  兜底只产出**渐变底 + 进度条**的 PNG（无文字）。⇒ 兜底图**不能**用来断言画面文字，
  e2e 里与画面文字相关的断言仍需 ffmpeg 环境。这条边界如实登记。
- **`degraded` 标记目前只透出到 `renderCard` 的返回值**，消费侧（e2e 驱动）尚未读它；
  下一步应让 e2e 在 `degraded=true` 时**出声**（而不是静默用兜底图跑完）。
- **「跨用例的隐式顺序依赖」这一形态本身没被消除**：本 PR 只是把「出图用例被跳过」这一种
  去掉；仓内若还有别的「A 用例 skip ⇒ B 用例断言落空」的形态，仍需逐个查。
  判据：**任何断言若依赖另一个用例的副作用，那条依赖必须写进断言的读数里**。

## CHANGELOG 条目

# fix(e2e): 本地 Provider 桩在没有 ffmpeg 的机器上也能出图，修主干 electron-tests 红（fix-main-electron-tests-red）

- AI 讲解视频流水线的本地 Provider 桩原本只用 ffmpeg 渲染讲解卡片 PNG；
  在没有 ffmpeg 的机器（CI runner）上出图路径从未被执行，出图用例只能跳过，
  而依赖它的调用统计断言仍然无条件要求「出图发生过」⇒ 该断言失败 ⇒ 主干红 ⇒ 挡住所有 PR。
- 修法：给桩加一条不依赖任何外部二进制的 PNG 兜底编码（尺寸精确），
  出图路径在每台机器上都走得通；出图用例不再条件跳过，并补上「尺寸符合请求」的真断言；
  兜底编码器本身也加常驻单测，不再只在无 ffmpeg 的机器上才被执行。

## learnings

### lesson: 被跳过的用例若是别的断言的输入，跳过会静默变成失败（fix-main-electron-tests-red）

**现场**：出图用例因「本机没有 ffmpeg」被 `ctx.skip()`；紧随其后的调用统计断言
无条件要求 `stats.image >= 1` ⇒ `expected 0 to be greater than or equal to 1` ⇒ 主干红。

**根因**：断言依赖**另一个用例的执行结果**（隐式的跨用例顺序依赖），而 vitest 只报 skip 数、
不报「谁依赖了被跳过的那条」⇒ 从报告上根本看不出因果。

**可复用的 N 条**：

1. 断言若依赖别的用例的副作用，**那条依赖必须出现在断言的读数里**
   （本 PR 的修法是让被依赖的事实「在任何机器上都成立」，而不是给断言加条件）。
2. 「本机缺某个外部工具 ⇒ 跳过」这种写法，**必须检查被跳过的用例有没有人依赖它的副作用** ——
   查法：把那个用例的 skip 去掉跑一遍，看下游哪条断言先红。
3. 条件 skip 会把「这台机器上没验证过」伪装成「这台机器上没问题」；
   要么让被测路径在**任何环境**下都成立（本 PR 的兜底编码器），要么把缺口显式记成可见项。
