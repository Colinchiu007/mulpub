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

### 1-A 首版被 CI 打回：**本机跑绿，是因为那个 Node 构建把 `zlib` 暴露成了全局**

首版提交后 CI 报 `ReferenceError: zlib is not defined`（`encodePng` 第 240 行）——
而**本机跑同一段代码是绿的**。根因不是断言写错，是**求值环境不同**：

```
$ node -e "console.log(typeof globalThis.zlib)"
object          ← 本机：内置模块被暴露成全局
```

⇒ 漏写 `const zlib = require('zlib')` 时，本机那个全局**恰好**兜住了 ⇒ 绿；
CI 的 Node 构建上没有这个全局 ⇒ ReferenceError。

⇒ 两处修正：
1. 桩里补**显式** `require('zlib')`（不依赖任何构建细节）；
2. 补一条**在干净沙箱里求值**的本地检查（`vm.runInNewContext` 起一个没有 `zlib` 全局的上下文），
   并对「剥掉 require」做**变异验证** ⇒ 本地就能复现 CI 的那条 ReferenceError。

```
$ node verify_zlib_require.js <桩> --strip-require
✗ 干净沙箱里求值失败：ReferenceError: zlib is not defined      ← 变异必须红
$ node verify_zlib_require.js <桩>
✓ 干净沙箱里求值通过：encodePng 产出 4602 字节，IHDR 64x32     ← 修复后必须绿
```

**教训**：「本机跑是绿的」有三种掩码形态，这里踩到的是第三种 ——
**① 依赖了某台机器/某个构建里恰好存在的全局**；② Node 版本不同；
③ **代码路径压根没被执行到**（本机那次「7 条断言全过」就属于这一类之外的另一种：
本机有 ffmpeg，`renderCard` 走的是 ffmpeg 路径，**兜底编码器从未被真正执行**）。
⇒ 验证必须**在接近消费方的求值环境里**做（干净沙箱 / 无该全局），
并对验证手段本身做**变异验证**（把修复拿掉 ⇒ 验证必须红）。

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

### lesson: 「本机跑是绿的」可能是被**构建细节**掩罩的（fix-main-electron-tests-red）

**现场**：新增的 PNG 兜底编码器用 `zlib.deflateSync`，本机跑全绿，CI 上
`ReferenceError: zlib is not defined`。本机 `globalThis.zlib` 是 `object` ——
**这个 Node 构建把内置模块暴露成了全局**，恰好兜住了漏写的 `require`。

**根因**：「本机绿」只证明「本机的求值环境里不缺那个符号」，不证明「消费方的求值环境里不缺」。
CI 与本机的 Node **构建不同** ⇒ 全局集合不同。

**可复用的 N 条**：

1. 任何内置模块**一律显式 require**；「它在本机是全局」不是不 require 的理由。
2. 验证要在**接近消费方的求值环境**里做：干净沙箱（`vm.runInNewContext`）、无该全局、
   对齐 Node 版本。本例用干净沙箱复现了 CI 的那条 ReferenceError。
3. **对验证手段本身做变异验证**：把修复拿掉，验证必须红。本例剥掉 require 后验证立刻红
   ⇒ 证明这条检查有牙齿，而不是「恰好绿」。
4. 附带一条：**本机有 ffmpeg ⇒ 兜底路径从未被真正执行过** ⇒ 「本机跑过一遍」不等于
   「所有分支都被执行过」。兜底路径要有**每台机器都跑**的专测。
