---
record: local-provider-hub-media-guard
task: 修掉主干存量红 —— local-provider-hub 统计断言在无 ffmpeg 环境下恒假，Electron CI 连红挡住全仓 PR
date: 2026-10-24
branch: local-provider-hub-media-guard
---

# 本地 Provider 桩：媒体守卫错位导致 Electron CI 恒红（2026-10-24）

## 1. 现象

主干上 `Electron CI` 的 `electron-tests` 作业**稳定失败**，与改了什么无关：

```
FAIL  tests/local-provider-hub.test.js > 本地 Provider 桩：协议兼容 >
      调用统计能证明四个 LLM 阶段与出图都真的发生过
AssertionError: expected 0 to be greater than or equal to 1
 ❯ tests/local-provider-hub.test.js:196:25
    195|     expect(stats.llm).toBeGreaterThanOrEqual(2)
    196|     expect(stats.image).toBeGreaterThanOrEqual(1)
Test Files  1 failed | 570 passed | 1 skipped (572)
Tests       1 failed | 10260 passed | 5 skipped (10266)
```

⇒ **required check ⇒ 全仓所有 PR 一起被挡**（含只改文档的 PR）。

**稳定复现**（两个不同主干提交、同一个 job）：
`f35277c18`（#4169）与 `d94f83a7b`（#4354 合并点）上 `Electron CI` 均为 `failure`，
job id `120729315076`（前者）/ `120730847971`（后者），
失败断言逐字相同。

## 2. 根因（逐条回源码 + CI log 双向核实）

### 2.1 直接机制：skip 守卫只护住了「被依赖的那条用例」

vitest verbose 输出里三条相邻用例的状态（CI log 实测）：

```
✓ ... LLM 端点返回 OpenAI 兼容结构
✓ ... scenes 阶段返回可被 parseScenesJson 直接解析的 JSON 数组
↓ ... 图片端点返回 SD WebUI 兼容结构（images: [base64]）且尺寸符合请求   ← skipped
✓ ... 图片端点的连活探针可用
× ... 调用统计能证明四个 LLM 阶段与出图都真的发生过                     ← failed
```

图片端点用例的出图桩要**真调 ffmpeg**，媒体工具不可用时按设计 `ctx.skip()`；
而**紧邻其后的统计断言没有同等守卫** ⇒
出图请求从未发生 ⇒ `stats.image` 恒为 `0` ⇒ `toBeGreaterThanOrEqual(1)` **恒假**。

⇒ 这是一条**恒假断言**，不是 flaky：它每次都会红。

### 2.2 为什么 CI 上媒体必然不可用

`apps/desktop/tests/e2e/lib/local-provider-hub.js:178-195` 的 `resolveFfmpegBinary()`：
先试 `findFfmpeg()`（`electron/services/media-tool-paths.js:95`），失败再回退**裸名** `ffmpeg`。

`findMediaTool` 的查找顺序：打包产物 → `SKIP_NATIVE_MEDIA_TOOL_TESTS` 开关 → `FFMPEG_PATH` 环境变量
→ `ffmpeg-ffprobe-static` 预置包 → 裸名探测 → **平台常见绝对路径**。

- CI 是 **Windows** runner，`findMediaTool` 在 Windows 侧列的两个常见安装目录
  （见 `apps/desktop/electron/services/media-tool-paths.js` 的 `defaultCommonPaths`）
  都不存在；
- `.github/workflows/electron-ci.yml` 里**没有任何 ffmpeg 安装步骤**；
- ⇒ `findFfmpeg()` 返回 null → 回退裸名 `ffmpeg` 也找不到 → **抛错** ⇒ 媒体不可用。

⚠️ 顺带核到一个**语义不一致**（本次不修，见 §5）：
`electron-ci.yml:88` 确实设了 `SKIP_NATIVE_MEDIA_TOOL_TESTS: '1'`，
但该开关只让 `findMediaTool` 返回 null，**挡不住 `resolveFfmpegBinary` 的裸名回退**——
即「本环境不测原生媒体工具」这个约定，在这条路径上没有生效。

### 2.3 责任归属

该测试文件由 **#4336**（`556723580da`，AI 讲解视频流水线零凭据 CDP 复跑）引入
⇒ 这条红是**本线自己留下的存量债**，不是他人改动引入。

## 3. 对照实验（3 组，本地真跑）

用 `pnpm dlx vitest@4` + 极简 config（该测试文件是纯 node，不依赖仓库 alias/setup），
并按 CI 的真实失败形态（`resolveFfmpegBinary()` 抛错）构造「媒体不可用」环境：

| 组合 | 结果 |
|---|---|
| **修复前** + 媒体不可用（CI 形态） | ❌ `AssertionError: expected 0 to be greater than or equal to 1` ← **与 CI log 逐字一致** |
| **修复后** + 媒体不可用（CI 形态） | ✅ 绿；图片用例 `↓` skip、**统计面用例 `✓` 真跑**、出图计数用例 `↓` skip |
| **修复后** + 媒体可用（本机有 ffmpeg） | ✅ 17/17 绿；图片端点用例真跑（395ms，真调 ffmpeg） |

⇒ 缺陷真实存在（对照组复现），修复有效，且**修复后媒体不可用时仍有真断言在跑**（不是整组跳过 ⇒ 不是恒绿）。

## 4. 修法

`apps/desktop/tests/local-provider-hub.test.js`：

1. 媒体可用性判定从**用例内**提到 **describe 级**，`beforeAll` 里只判一次，两处共用；
2. 把**不依赖媒体**的统计断言（统计面存在 + LLM 阶段计数）**拆出来始终执行**；
3. 只有「出图也被计数」这半句依赖媒体，媒体不可用时如实 skip。

**明确没有做的事**：

- 没有删断言；
- 没有把断言放宽成恒真；
- 没有用「整体跳过这一组」来消红（那会把真断言变成死条文）。

> 顺带修正一处**名实不符**：原用例名说「证明**四个 LLM 阶段**」，但断言只有 `llm >= 2`。
> 新名改为「调用统计面存在且 LLM 阶段计数正确（不依赖媒体工具）」，不再声称验证四个阶段。

## 5. 遗留（不在本 PR 范围）

- **`SKIP_NATIVE_MEDIA_TOOL_TESTS` 在 `resolveFfmpegBinary` 上不生效**：该函数绕过
  `findMediaTool` 的开关、自己裸名回退。CI 的「不测原生媒体工具」约定在这条路径上形同虚设。
  正确修法是让 `resolveFfmpegBinary` 也尊重该开关（属 `media-tool-paths` 的契约面，需团队决策）。
- **出图桩在 CI 上从未被真正测过**：CI 无 ffmpeg ⇒ 图片端点用例恒 skip ⇒
  「出图桩协议兼容」这条覆盖在 CI 上是空的。本 PR 只做到「不再因此红」，
  补覆盖需要给桩加依赖注入（把 ffmpeg 调用换成可注入的渲染器），属独立 change。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
