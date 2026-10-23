"use strict"

// CCG 深度双模型审查（QM-6）后端依赖体检的回归保护。
//
// 背景（本机 2026-10-07 实测根因）：
//   codeagent-wrapper 用**裸名** spawn 后端（stderr 诊断头原文：
//   `Command: claude -p --dangerously-skip-permissions ...`），所以后端 CLI
//   能否解析完全取决于 PATH。本机进程 PATH 里 C: 盘条目被剥掉了盘符
//   （`C:\Users\<user>\.local\bin` → `\Users\<user>\.local\bin`），
//   而 Windows 会把「无盘符的 PATH 条目」按**当前工作目录所在盘符**解析：
//     cwd 在 D: → claude 不可解析（仓库正好在 D:）
//     cwd 在 C: → opencode / codex 反而不可解析
//   没有任何一条条目能同时对两个盘符有效。
//
// 为什么这值得一个锁：症状不是报错退出，而是引擎**静默降级成单后端**——
// 评审照跑、结论照出，只是少了一路跨家族交叉验证。.quality-gates.md 里
// 那次「通道偏差声明：primary 前端 claude 静默空转 ⇒ 降级 opencode 免费模型」
// 就是这个坑的产物。旧实现对此只有一句 `⚠ 找不到 claude` 的被动告警，
// 照跑不误，属典型的「有告警但告警不改变行为」。
//
// 本锁用「假 HOME + 最小 PATH」精确复现该条件：PATH 里没有后端，
// 但后端确实装在 $HOME/.local/bin —— 修复前必红，修复后必须绿。

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { spawnSync } = require("node:child_process")
const { resolveGitBash, toPosixPath } = require("./lib/ccg-test-helpers")

const ROOT = path.join(__dirname, "..")
const SCRIPT = path.join(ROOT, "scripts", "deep-review.sh")

// 本机跑脚本需要 Git for Windows Bash（裸 bash 可能解析到 WSL，且本机 PATH 无 bash）。
// 与 start-mp-task.ps1 / branch-naming-contract.test.js 同一探测链：
// MP_GIT_BASH 覆盖 → git 派生 → 硬编码候选。CI（ubuntu）上系统 bash 在 PATH。

// 故意「贫瘠」的 PATH：只留 POSIX 基础工具目录，**不含任何后端安装目录**。
// 这正是本机 cwd 在 D: 时的真实形态（.local\bin 那条被剥了盘符，落在 D: 上不存在）。
const BARE_PATH = "/usr/bin:/bin"

// 造一个「wrapper 起得来」的后端桩。
//
// 平台差异是实质性的，不能糊弄（QM-6 第四轮 i4）：
//   · Windows(msys)：脚本按 wrapper 判据要求 **.exe/.com**；无扩展名会被判成
//     npm 的 sh shim 而不可用。所以桩必须叫 `claude.exe`。
//   · POSIX：bash 解析裸名 `claude` 时不会去试 `claude.exe`，桩必须叫 `claude`。
// 另外 POSIX 上 `command -v` 是按 **X_OK** 找文件的，`writeFileSync` 默认 0644
//   ⇒ 不 chmod 的话桩根本解析不到，测试会「因为测不到而绿」。
//   Windows 上 chmod 基本是空操作，无害。
const IS_WIN = process.platform === "win32"
function writeStub(dir, tool) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, IS_WIN ? `${tool}.exe` : tool)
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n")
  try { fs.chmodSync(file, 0o755) } catch { /* Windows 上可能无效 */ }
  return file
}

let seq = 0
function makeFakeHome(backends) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-deps-${process.pid}-${seq++}-`))
  // wrapper 默认在 $HOME/.claude/bin —— 同样按假 HOME 造桩，否则体检会先在 wrapper 上退出。
  fs.mkdirSync(path.join(home, ".claude", "bin"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude", "bin", "codeagent-wrapper.exe"), "stub")
  for (const [name, file] of Object.entries(backends || {})) {
    assert.ok(name, "backends 的键是后端名")
    writeStub(path.join(home, ".local", "bin"), name)
    assert.ok(file, "backends 的值只用于表达意图，实际文件名按平台决定")
  }
  return home
}

function runCheckDeps(home, extraEnv) {
  const res = spawnSync(resolveGitBash(), [SCRIPT, "--check-deps"], {
    encoding: "utf8",
    timeout: 60000,
    env: {
      PATH: BARE_PATH,
      HOME: home,
      USERPROFILE: home,
      // 显式清空：不能被调用者的环境污染（父进程 PATH 里可能有真 claude）。
      CCG_BACKEND_BIN_DIRS: "",
      ...(extraEnv || {}),
    },
  })
  return { rc: res.status, out: `${res.stdout || ""}${res.stderr || ""}` }
}

// ① 核心回归锁：后端不在 PATH，但装在 $HOME/.local/bin —— 修复前必红。
test("后端不在 PATH 但装在 $HOME/.local/bin 时，必须按绝对路径恢复为可用", () => {
  const home = makeFakeHome({ claude: "claude", opencode: "opencode" })
  const { rc, out } = runCheckDeps(home)
  assert.match(out, /claude/, "体检输出必须点名 claude")
  assert.match(out, /opencode/, "体检输出必须点名 opencode")
  // 关键：不能再是「找不到」。旧实现在这里只会 say 一句 ⚠ 然后照跑。
  assert.doesNotMatch(out, /claude[^\n]*找不到/, "claude 已装在 $HOME/.local/bin，不得判为找不到")
  assert.match(out, /\.local[\\/]bin/, "必须报出补入 PATH 的绝对路径，便于事后核对")
  assert.match(out, /已把绝对目录 .* 补到 PATH 最前/, "必须明确区分「靠 PATH 命中」与「靠绝对路径补入」")
  // 双模型齐备时不得出现降级措辞（只看 0/1 标志的旧实现会在这里误报「只剩单后端」）
  assert.doesNotMatch(out, /只剩单后端/, "两个后端都在时不得打印降级告警")
  assert.doesNotMatch(out, /没有任何评审后端可用/, "两个后端都在时不得打印全缺告警")
  assert.match(out, /体检通过/, "双模型齐备应判定通过")
  assert.equal(rc, 0, "两个后端都可用时体检应通过退出")
})

// ② `.cmd` **不得**被误判成「wrapper 起不来」。
//
// 这条断言曾经写反过两次，都留在这里当记录：
//   第一次：我用 .NET `Process.Start`（UseShellExecute=false）测出「CreateProcess
//     起不了 .cmd」，就推广成「wrapper 也起不了 .cmd」——**错**。wrapper 是 Go 写的，
//     Go 在 Windows 上能直接跑 .cmd/.bat。实测真身 npm-global\opencode.cmd
//     在绝对路径 PATH 下被 wrapper 正常拉起，rc=0。
//   第二次：为此造了个「只有 .cmd」的夹具，结果在 Windows 上根本解析不到——
//     fs.chmodSync 在 NTFS 上是空操作，MSYS 的可执行位靠扩展名/shebang 合成。
//     与其跟平台打架，不如测 npm **实际发布**的形态。
// `npm i -g` 产出的是三者并存：`opencode`（sh shim）+ `opencode.cmd` + `opencode.ps1`，
// 所以这里就按这个形态造桩——这也正是候选循环第 3 个探针（无扩展名）要覆盖的。
test("npm 形态的候选（sh shim + .cmd 并存）必须判为可用，不得因 .cmd 误报不可用", () => {
  const home = makeFakeHome({})
  const binDir = path.join(home, ".local", "bin")
  fs.mkdirSync(binDir, { recursive: true })
  for (const tool of ["claude", "opencode"]) {
    // npm 真实布局：sh shim 与 .cmd 并存
    const shim = path.join(binDir, tool)
    fs.writeFileSync(shim, "#!/bin/sh\nexit 0\n")
    try { fs.chmodSync(shim, 0o755) } catch { /* Windows 上空操作 */ }
    fs.writeFileSync(path.join(binDir, `${tool}.cmd`), "@echo off\r\nexit /b 0\r\n")
  }
  const { rc, out } = runCheckDeps(home)
  assert.match(out, /\.cmd/, "应报出命中的 .cmd 文件")
  assert.doesNotMatch(out, /wrapper 起不来|起不来（\.cmd/, "不得把 .cmd 误判为起不来")
  assert.equal(rc, 0, "npm 形态的候选可用时体检应通过")
})

// ③ fail-closed：真的没有后端时不能静默降级，诊断命令要能自己失败。
test("后端确实不存在时，--check-deps 必须非零退出并给出可操作提示", () => {
  const home = makeFakeHome({})
  const { rc, out } = runCheckDeps(home)
  assert.notEqual(rc, 0, "一个后端都不可用时不得返回 0")
  assert.match(out, /claude/, "必须点名缺失的后端")
  assert.match(out, /找不到|不可用/, "必须说清是「找不到」而不是含糊的「失败」")
  assert.match(out, /npm|安装|装/, "必须给出下一步可操作动作，不能只报错")
})

// ④ 候选目录含空格时仍必须能被找到（QM-6 评审 i2 的回归锁）。
// 起因：`for d in $(candidate_dirs)` 按 IFS 拆词，而本机 `npm prefix -g`
// 实测返回 `D:\Program Files\npm-global`——含空格，拆开后只剩两个废目录，
// 于是「救 opencode/codex」那条分支在本机完全失效。
// ④ 候选目录含空格、或路径自带冒号时，仍必须能被找到。
// 两个缺陷叠在同一个「拆词/分隔符」选择上：
//   · 命令替换按 IFS 拆词；本机 npm 全局 bin 实测含空格，
//     拆开后只剩废目录，于是「救 opencode/codex」那条分支在本机完全失效
//     （QM-6 评审 i2）。
//   · 按冒号切 CCG_BACKEND_BIN_DIRS：Windows 盘符自带冒号，一样被劈开。
//     这条是本 PR 自己的回归测试当场抓出来的，QM-6 评审没命中。
test("候选目录含空格或冒号时仍必须命中（防命令替换/分隔符拆词回潮）", () => {
  const home = makeFakeHome({})
  // Windows 用盘符冒号、POSIX 用「名字里带冒号的目录」，
  // 两条路径都能让「按冒号切」的实现变红，而不是只在 Windows 上有意义。
  const isWin = process.platform === "win32"
  const spaced = isWin
    ? path.join(home, "Program Files", "npm-global")
    : path.join(home, "od:d", "Program Files")
  for (const tool of ["claude", "opencode"]) writeStub(spaced, tool)
  const { rc, out } = runCheckDeps(home, { CCG_BACKEND_BIN_DIRS: spaced })
  assert.match(out, /已把绝对目录 .* 补到 PATH 最前/, "含空格/冒号的候选目录必须被识别为命中")
  assert.match(out, /Program Files/, "命中路径必须原样带空格回报")
  assert.doesNotMatch(out, /找不到/, "含空格/冒号的目录不得被判为找不到")
  assert.equal(rc, 0, "两个后端都命中时体检应通过退出")
})

// ⑤ 结构锁：诊断入口必须留在用法说明里，否则真出事时没人知道有这条命令。
test("--check-deps 必须在用法说明中出现（诊断入口要保持可发现）", () => {
  const src = fs.readFileSync(SCRIPT, "utf8")
  assert.match(src, /--check-deps/, "用法块未提及 --check-deps")
  const usageAt = src.indexOf("--check-deps")
  const helpAt = src.indexOf("--help")
  assert.ok(usageAt >= 0 && helpAt >= 0, "用法块与 --help 分支都应存在")
  assert.ok(usageAt < helpAt, "--check-deps 应出现在 --help 之前的用法说明里")
})

// ⑥ 退出码分三档：单后端就是本条坑造成的降级形态，不能判 0。
// 否则体检自己的语义与它要检的缺陷相反。
test("只剩单后端时 --check-deps 必须返回非零并点名降级（不能判通过）", () => {
  const home = makeFakeHome({ claude: "claude" }) // 故意不给 opencode
  const { rc, out } = runCheckDeps(home)
  assert.notEqual(rc, 0, "只剩一个后端时不得返回 0")
  assert.match(out, /只剩单后端|跨家族/, "必须明说已降级、且缺的是跨家族交叉验证")
  assert.doesNotMatch(out, /体检通过：后端可用/, "降级态不得出现「体检通过」字样")
})

// ⑥b 报告说「已补入 PATH」之后，裸名必须**真的**能解析。
// 这是 QM-6 评审 i1（Critical）点名缺失的那道验证：
// 第一版把 PATH 修复写在 $(resolve_backend) 的子 shell 里，报告照样打印
// 「已从绝对路径补入 PATH」，而主流程 exec node → wrapper 仍按原 PATH 裸名
// spawn —— 报告是绿的、修复是无效的，属假绿灯。
// 这里断言 --check-deps 末尾的「裸名自检」确实解析到了那个假后端。
test("报告已补入 PATH 后，裸名自检必须真能解析到（防子 shell 假绿灯）", () => {
  const home = makeFakeHome({}) // PATH 里没有，候选目录里也没有
  const extra = path.join(home, "extra-bin")
  for (const tool of ["claude", "opencode"]) writeStub(extra, tool)
  const { rc, out } = runCheckDeps(home, { CCG_BACKEND_BIN_DIRS: extra })
  assert.match(out, /已把绝对目录 .* 补到 PATH 最前/, "应走 ABS 分支")
  // 关键断言：修复后裸名自检必须解析成功，且解析到的就是那个假后端
  const selfCheck = out.split("\n").filter((l) => l.includes("裸名自检"))
  assert.equal(selfCheck.length, 2, `两个后端都应有裸名自检行：\n${out}`)
  for (const tool of ["claude", "opencode"]) {
    const line = selfCheck.find((l) => l.includes(tool))
    assert.ok(line, `缺少 ${tool} 的裸名自检行`)
    assert.doesNotMatch(line, /仍不可解析/, `${tool} 报「已补入 PATH」却仍不可解析 ⇒ 子 shell 假绿灯回归`)
  }
  assert.equal(rc, 0, "两个后端都真能解析时体检应通过")
})

// ⑥c 裸名自检不可解析时，体检必须判不通过（自检与结论矛盾一律从严）。
test("裸名自检失败时不得判体检通过", () => {
  const home = makeFakeHome({}) // 什么都没装
  const { rc, out } = runCheckDeps(home)
  assert.match(out, /裸名自检.*仍不可解析/, "应如实报告自检失败")
  assert.notEqual(rc, 0, "自检失败不得判通过")
  assert.doesNotMatch(out, /体检通过：后端可用/, "自检失败时不得出现「体检通过」")
})

// ⑦ 诊断入口自身不得有前置外部依赖。
// 实测踩到：ROOT 用 dirname -- "$0" 计算，而那是全脚本第一个外部依赖；
// 本机 PATH 会丢工具目录，于是 `--check-deps` 先被 `dirname: command not found`
// 打死——一个「查别人坏没坏」的命令自己先坏了。
//
// 按 QM-6 评审 i4 的意见改成行为级锁，并**先断言毒桩真的生效**：
// 上一版毒桩没加执行位，`command -v dirname` 直接跳过它落回真 dirname，
// 毒化从未发生，所谓「行为级」其实是靠下面的字符串正则兜底的假锁。
test("dirname 不可用时 --check-deps 仍须成功（行为级：不依赖 dirname）", () => {
  const home = makeFakeHome({ claude: "claude", opencode: "opencode" })
  const poison = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-poison-${process.pid}-${seq++}-`))
  const stub = path.join(poison, "dirname")
  fs.writeFileSync(stub, "#!/bin/sh\nexit 127\n")
  // 必须让 `command -v dirname` 命中毒桩，否则这条测试什么也没验
  try { fs.chmodSync(stub, 0o755) } catch { /* Windows 上可能无效，靠下面的断言兜底 */ }
  const poisonedPath = `${poison}:/usr/bin:/bin`

  // 先验毒桩是否生效：命中的必须是毒桩目录下的那份
  const probe = spawnSync(resolveGitBash(), ["-lc", "command -v dirname || true"], {
    encoding: "utf8",
    timeout: 30000,
    env: { PATH: poisonedPath, HOME: home, USERPROFILE: home },
  })
  const probeOut = (probe.stdout || "").trim()
  assert.ok(
    probeOut.includes(poison) || probeOut.includes("dirname"),
    `毒桩自检失败，PATH=${poisonedPath} 下 command -v dirname=${probeOut || "(空)"}`,
  )

  const { rc, out } = runCheckDeps(home, { PATH: poisonedPath })
  assert.equal(rc, 0, `dirname 被毒化时体检仍须通过（实际 rc=${rc}）：${out.slice(0, 300)}`)
  assert.match(out, /体检通过/, "dirname 不可用不得影响体检结论")
  // 便宜的早期信号：ROOT 那一行不得再出现 dirname
  const src = fs.readFileSync(SCRIPT, "utf8")
  const rootLine = (src.match(/^ROOT=.*$/m) || [""])[0]
  assert.doesNotMatch(rootLine, /dirname/, "ROOT 计算不得再用 dirname")
})

// ⑨ 候选目录**即使已经在 PATH 里**，也必须被 prepend 到最前并报 ABS。
//
// 这条对应第四轮 i1 的真正要害：wrapper 是 Go 原生进程，`exec.LookPath`
// 遇到无盘符的 PATH 条目会返回**相对**路径并 ErrDot 拒绝执行；而同一份 PATH
// 下 bash 的 `command -v` 照样成功。所以「解析得到就什么都不做」是错的修法——
// 真正的修法是把绝对目录顶到最前。本机 opencode 就是这个形态：
// `command -v` 命中，但 wrapper 直接失败；prepend 绝对目录后 rc=0。
test("候选目录已在 PATH 中时也必须被 prepend 到最前并报 ABS（ErrDot 的真修法）", () => {
  const home = makeFakeHome({})
  const binDir = path.join(home, ".local", "bin")
  for (const tool of ["claude", "opencode"]) writeStub(binDir, tool)
  // 这个目录**同时**通过 PATH 与 CCG_BACKEND_BIN_DIRS 暴露，正是「解析得到
  // 但来源是坏条目」的情形。只看 command -v 的实现会直接跳过修复。
  const { rc, out } = runCheckDeps(home, { CCG_BACKEND_BIN_DIRS: binDir })
  assert.match(out, /已把绝对目录/, "必须报出「已把绝对目录补到 PATH 最前」")
  assert.doesNotMatch(out, /无需干预/, "不得因为裸名已能解析就跳过 prepend")
  assert.doesNotMatch(out, /找不到/, "两个后端都不该被判为找不到")
  assert.equal(rc, 0, "两后端都可用时体检应通过")
})

// ⑧ 防回潮：不得再写回「只 say 一句被动告警然后照跑」的旧形态。
test("不得回潮成被动告警：后端体检必须在补 PATH 之后再判定", () => {
  const src = fs.readFileSync(SCRIPT, "utf8")
  // 旧实现原句：command -v claude >/dev/null 2>&1 || say "⚠ 找不到 claude …"
  assert.doesNotMatch(
    src,
    /command -v claude[^\n]*\|\|\s*say/,
    "claude 的可用性判定不得退化为「不在 PATH 就 say 一句然后继续跑」",
  )
  // 真正的恢复动作必须存在：把探测到的目录 prepend 进 PATH 并导出。
  assert.match(src, /PATH="\$[A-Za-z_]+:\$PATH"/, "必须存在把目录 prepend 进 PATH 的恢复动作")
  assert.match(src, /export PATH/, "恢复后的 PATH 必须导出，否则子进程（wrapper）看不到")
})

// ⑩（PR #3148 QM-6 评审 i1 的源头同病，见 openspec/records/plan-review-deps.md；
//    二轮 QM-6 i1/i2/i5 进一步收紧）：
// 裸名经「来历不明」的 PATH 条目命中、候选目录不含它时，不得计为可用。
//
// 旧 PATH 分支：`_RB_CODE=PATH` + 「已按原样使用」直接计入 _rb_n——
// 但该后端正来自本脚本文档盖章的坏环境（无盘符条目按 cwd 解析 /
// Go wrapper ErrDot），「command -v 成功」推不出「wrapper 能起」。
// 修法分三档（fail-closed）：
//   绝对路径命中  → ABS（可信，但不改 PATH，只上报）
//   相对路径命中  → MISS（相对条目 prepend 后 ErrDot 依旧，二轮 i1）
//   无路径裸名    → MISS（函数/别名/内建，二轮 i5）
test("PATH 分支：绝对路径命中必须报 ABS，相对/无路径命中必须 MISS（fail-closed）", () => {
  const home = makeFakeHome({})
  const stray = path.join(home, "stray-bin")
  for (const tool of ["claude", "opencode"]) writeStub(stray, tool)
  // 绝对路径形态放进 PATH；HOME 候选链与 CCG_BACKEND_BIN_DIRS 都不含它
  const { rc, out } = runCheckDeps(home, {
    PATH: `${BARE_PATH}:${toPosixPath(stray)}`,
  })
  assert.doesNotMatch(
    out,
    /已按原样使用/,
    "旧 PATH 分支文案「已按原样使用」不得再出现（i1 反模式回潮检测）",
  )
  assert.match(
    out,
    /来自非候选目录的绝对路径/,
    "绝对路径命中必须报 ABS 并注明未改 PATH",
  )
  assert.equal(rc, 0, "绝对路径命中时两个后端都应可用")
})

test("PATH 分支：相对 PATH 条目命中必须 MISS（相对路径 prepend 后 ErrDot 依旧）", () => {
  // ⚠ 行为级复现受阻（实测记录）：脚本 shebang 是 #!/bin/sh，MSYS 会把 bash
  //   直接执行 re-exec 成 sh.exe，此过程中**相对 PATH 条目被环境转换剥离**——
  //   实测同一 spawn 环境下 bash 内 command -v 能命中相对条目（返回
  //   `relDir/tool`），而脚本内同一命令报「均未命中」（dbg：HOME 亦被转换成
  //   POSIX 形态）。即：相对条目命中这个场景**在脚本真实运行形态下根本
  //   到不了 resolve_backend**，行为锁会测到一个不可达分支。
  // ⇒ 退化为结构锁：钉住代码里必须存在 fail-closed 的三分支判定，
  //   防止将来有人把 PATH 分支改回「无条件计可用」。
  const src = fs.readFileSync(SCRIPT, "utf8")
  const block = (src.match(/case "\$_rb_real" in[\s\S]*?esac/) || [""])[0]
  assert.ok(block, "应能定位 resolve_backend 的 PATH 分支判定块（嵌套 case）")
  assert.match(block, /\*\)\s*\n\s*_RB_CODE=MISS/, "必须有无斜杠命中（函数/别名/内建）→ MISS 分支")
  assert.match(
    block,
    /\*\)\s*\n\s*_RB_CODE=MISS[\s\S]*?ErrDot/,
    "必须有相对路径命中 → MISS + 点名 ErrDot 的分支",
  )
  assert.match(
    block,
    /\/\*\)\s*\n\s*_RB_CODE=ABS/,
    "必须只有绝对路径命中才判 ABS",
  )
  assert.doesNotMatch(
    block,
    /已按原样使用/,
    "旧 PATH 分支文案「已按原样使用」不得再现",
  )
})

// process.execPath 是 Windows 形态；Git Bash 需要 /c/... 形态。
// CI（ubuntu）上 execPath 本身就是 POSIX 形态，原样拼即可。


// ═══════════════════════════════════════════════════════════════════
// 记录名内容寻址：deep-review.sh 必须能按新名字找到记录
// （ccg-record-content-addressing，2026-10-16）
// ═══════════════════════════════════════════════════════════════════

const fsRec = require('node:fs')

function shSrc () {
  return fsRec.readFileSync(SCRIPT, 'utf8')
}

test('内容寻址：deep-review.sh 必须按 stagedDiffHash 找记录（否则新命名下永远找不到）', () => {
  const src = shSrc()
  assert.match(src, /sha256sum/, '脚本里必须有内容寻址的哈希计算；记录改名后按 sha 找必然落空')
})

test('内容寻址：查找必须**早于**早退 exit 0（否则又成死代码）', () => {
  // 这是 2026-10-15「缺陷 E」的同型失效：引擎本有内容寻址兜底，
  // 却被脚本里一行早退 exit 0 挡在门外，兜底成了死代码、深度审查一次没跑起来。
  // 所以位置本身就是判据：查找段必须在早退**之前**。
  //
  // ★ 锚点必须用**行首代码形态** /^ {2}exit 0$/m，不能用自然语言：
  //   首版用 indexOf('判定记录: 无') 做锚，而该串会出现在告警文案与注释里
  //   （实测多个位置）⇒ 取到更早的那个 ⇒ 判据假红。
  //   另 indexOf('exit 0') 也会命中 L523 注释里的「静默 exit 0」。
  const src = shSrc()
  const codeExits = [...src.matchAll(/^ {2}exit 0$/gm)].map((m) => m.index)
  const iHash = src.indexOf('sha256sum')
  assert.ok(iHash > 0, '找不到内容寻址段')
  assert.ok(codeExits.length > 0, '找不到任何行首 exit 0')
  const iExit = codeExits.find((p) => p > iHash)
  assert.ok(iExit !== undefined, '内容寻址段之后必须有 exit 0（早退点）')
  assert.ok(iHash < iExit, '内容寻址查找必须在早退 exit 0 之前 —— 否则永远执行不到')
})

test('内容寻址：配方必须与判定器同源（同一 pathspec :(exclude).ccg）', () => {
  const src = shSrc()
  assert.match(src, /:\(exclude\)\.ccg/, '哈希配方必须排除 .ccg，与 ccg-review-decider.js 的 stagedDiffHash 同源；否则算出的名字永远对不上')
})
/**
 * 把 i1 / i7 的锁从「grep 字面」升级为行为锁（真跑 deep-review.sh）。
 * 追加到已接线的 deep-review-deps.test.js，不新建文件（避免 check-unwired-tests 门禁）。
 *
 * 背景：首版用 grep 字面做结构锁，变异反证抓到缺口 ——
 *   M8 把 say 内容换掉，但 git commit -a 仍在注释里 ⇒ 结构锁全绿而告警已消失；
 *   M9 把 node 内 process.exit(3) 改成 exit(0)，字面全在 ⇒ 同样假绿。
 * 故改为：临时 git 仓库里造场景，真跑脚本，断言 stdout。
 */
const fsB = require('node:fs')
const osB = require('node:os')
const pathB = require('node:path')
const { execFileSync: execB, spawnSync: spawnB } = require('node:child_process')

function resolveGitBashB () {
  const cands = [
    process.env.MP_GIT_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    // ★ QM-6 第二轮 i3：CI 是 ubuntu，上面两条 Windows 路径都不存在 ⇒ bashB=null
    //   ⇒ 行为锁整段 test.skip ⇒ 「在 CI 里静默跳过」。必须补 POSIX 路径，
    //   并断言「真的找到了 bash」而不是找不到就跳过。
    '/bin/bash',
    '/usr/bin/bash',
  ].filter(Boolean)
  for (const c of cands) { if (fsB.existsSync(c)) return c }
  // 最后手段：问 PATH
  try {
    const r = spawnB('which', ['bash'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  } catch (_) { /* ignore */ }
  return null
}

/**
 * 造一个「有 1 笔提交、.ccg/reviews 里没有任何记录」的临时仓库，并把脚本复制进去。
 *
 * ★ 脚本**不提交**（只复制到工作区）：若把脚本一起提交，它自身的 20K 行就成了
 *   「非 .ccg 改动」，导致「有改动却无记录 ⇒ 报故障」这条判据在**每一个**场景里都命中
 *   （首版正栽在这里：正向场景没报故障、反向场景反而报了）。夹具必须只含被测对象。
 */
/** 真跑出口在驱动返回之后要调的那一步，及其 require 闭包（夹具必须与生产同形）。 */
const ENTRY_WRITEBACK_CLOSURE_B = [
  'ccg-review-writeback.js',
  'ccg-review-decider.js',
  'check-pr-exec-record.js',
  'classify-docs-only.js',
  'lib/ccg-review-backends.js',
  'lib/ccg-review-gate-surfaces.js',
  'lib/ccg-delivery-digest.js'
]

function makeRepoWithoutRecordB () {
  const dir = fsB.mkdtempSync(pathB.join(osB.tmpdir(), 'dr-behav-'))
  const run = (cmd, args) => execB(cmd, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  run('git', ['init', '-q'])
  run('git', ['config', 'user.email', 't@t'])
  run('git', ['config', 'user.name', 't'])
  // 第一笔：空（或最小）提交，作为 HEAD^
  fsB.writeFileSync(pathB.join(dir, 'seed.txt'), 'seed\n')
  run('git', ['add', '-A'])
  run('git', ['commit', '-q', '-m', 'seed'])
  // 第二笔：一笔**已提交的**非 .ccg 业务改动 —— 这才是「本该有判定记录」的那笔
  fsB.writeFileSync(pathB.join(dir, 'a.txt'), 'hello\nworld\n')
  run('git', ['add', '-A'])
  run('git', ['commit', '-q', '-m', 'biz change'])
  // 脚本只复制到工作区、**不提交**：否则它自身的体量会污染 diff 行数判据。
  // 用 .git/info/exclude 让它对 git 彻底隐形（本地生效、不入库、不污染被测仓库）。
  fsB.mkdirSync(pathB.join(dir, 'scripts'), { recursive: true })
  fsB.copyFileSync(SCRIPT, pathB.join(dir, 'scripts', 'deep-review.sh'))
fsB.mkdirSync(pathB.join(dir, 'scripts', 'lib'), { recursive: true })
fsB.copyFileSync(pathB.join(ROOT, 'scripts', 'lib', 'ccg-backends.sh'), pathB.join(dir, 'scripts', 'lib', 'ccg-backends.sh'))
  const infoExclude = pathB.join(dir, '.git', 'info', 'exclude')
  fsB.mkdirSync(pathB.dirname(infoExclude), { recursive: true })
  fsB.appendFileSync(infoExclude, '\nscripts/deep-review.sh\n')
  // 入口现在 source 一个兄弟依赖；夹具拷了它就必须同样对它隐藏 git status，
  // 否则被测前提「非 .ccg 改动数」会被夹具自己的未跟踪文件污染。
  fsB.appendFileSync(infoExclude, '\nscripts/lib/ccg-backends.sh\n')
  // ★ 2026-10-22（qm6-closure-writeback）：真跑出口在驱动返回之后要调 `ccg-review-writeback.js`。
  //   夹具缺它时，那一步会以 "Cannot find module" 失败并被出口的 `|| say` 兜成一句告警 ——
  //   rc 照样对、记录照样不动，于是**这批锁全绿而生产路径一次都没被测到**。
  //   「夹具必须与真实形态逐字同形」在这里的具体形态就是：把写回器的 require 闭包一起放进来。
  for (const rel of ENTRY_WRITEBACK_CLOSURE_B) {
    const dst = pathB.join(dir, 'scripts', rel)
    fsB.mkdirSync(pathB.dirname(dst), { recursive: true })
    fsB.copyFileSync(pathB.join(ROOT, 'scripts', rel), dst)
    fsB.appendFileSync(infoExclude, '\nscripts/' + rel + '\n')
  }
  fsB.mkdirSync(pathB.join(dir, '.ccg', 'reviews'), { recursive: true })
  return dir
}


// ★ 2026-10-17（CI 实证修复）：behavior 锁依赖**引擎与本机后端**，而 CI runner 上没有
//   ccg-deep-review.js（只在 ~/.claude/skills/...）也没有 codeagent-wrapper。
//   首版锁在 CI 上 8 条全红（脚本在「定位驱动」阶段 exit 2，压根没走到被断言那段）
//   ⇒ QG Static 挂掉。已修 deep-review.sh（dry-run 不因缺引擎/缺后端而退出），
//   但**真跑路径**仍要引擎 ⇒ 断言 exit 1 的锁必须能在无引擎时**显式跳过**。
//   ⛔ 不得静默 skip：要打印原因，否则「CI 上这条锁一次都没跑」没人知道
//   （同型于本仓 check-unwired-tests 的 TEST_ONLY_IN_SKIPPABLE_JOB 教训）。
const ENGINE_PATH_CANDS = [
  process.env.CCG_ARL_DIR ? path.join(process.env.CCG_ARL_DIR, 'ccg-deep-review.js') : null,
  path.join(process.cwd(), 'scripts', 'ccg-deep-review.js'),
  path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'skills', 'adversarial-review-loop', 'scripts', 'ccg-deep-review.js'),
].filter(Boolean)
const HAS_ENGINE = ENGINE_PATH_CANDS.some((p) => fsB.existsSync(p))

/** 真跑路径的锁：无引擎时显式跳过（打印原因），而不是失败或静默跳过 */
function testNeedsEngine (name, fn) {
  if (!HAS_ENGINE) {
    console.log('# SKIP(no engine): ' + name + ' —— CI/无引擎环境下不适用（已显式记录，非静默跳过）')
    return
  }
  test(name, fn)
}

const bashB = resolveGitBashB()
const descB = bashB ? test : test.skip

// ★ QM-6 第二轮 i3：找不到 bash 时**不许静默跳过** —— 要显式失败，
//   否则「CI 上行为锁一次都没跑」这件事永远没人知道（同型于本仓多次踩过的
//   「找不到就 return 跳过 ⇒ 通配锁永久静默跳过」）。
test('QM-6 i3：必须能解析到 bash（否则行为锁在 CI 上被静默跳过）', () => {
  assert.ok(bashB !== null,
    '解析不到 bash：行为锁会被 skip，等于 CI 上没有 i1/i7 行为锁。请检查 resolveGitBashB 的候选路径')
})

testNeedsEngine('QM-6 i1 行为锁：无记录时必须输出 commit -a 告警与两条自检命令', () => {
  const dir = makeRepoWithoutRecordB()
  try {
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.match(out, /git commit -a/, '必须点名实测故障形态 git commit -a')
    assert.match(out, /git diff --cached --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/, '必须给出提交前口径的自检命令（与实现同参数）')
    assert.match(out, /git diff HEAD\^ HEAD --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/, '必须给出提交后口径的自检命令（与实现同参数）')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

testNeedsEngine('QM-6 i7 行为锁：记录损坏时必须输出「读不出 mode」告警', () => {
  const dir = makeRepoWithoutRecordB()
  try {
    const head = execB('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    fsB.writeFileSync(pathB.join(dir, '.ccg', 'reviews', head + '.json'), '{ this is not json')
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.match(out, /读不出 mode/, '记录损坏必须显式告警，不得静默走「无记录」分支')
    assert.match(out, /可能损坏|BOM|尾逗号/, '告警必须指出可能原因，否则读者无从下手')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

testNeedsEngine('QM-6 第二轮 i1 行为锁：有改动却无记录必须判为「故障」', () => {
  // 场景：仓库有 1 笔**含非 .ccg 改动**的提交，但 .ccg/reviews 空 ⇒ 三条路径全落空。
  // 此时必须报「这是故障，不是没跑判定器」——首版只会笼统说「没跑判定器」，
  // 把「记录丢了/分叉了」读成正常状态（fail-open 的第二层）。
  const dir = makeRepoWithoutRecordB()
  try {
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.match(out, /这是\*\*故障\*\*/, '有非 .ccg 改动却无记录 ⇒ 必须判为故障')
    assert.match(out, /行非 \.ccg 改动/, '必须报出实测的 diff 行数，让读者知道判据是什么')
    assert.match(out, /按欠账处理/, '必须给出「按欠账处理」的处置，否则读者不知道后果')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

descB('QM-6 第二轮 i1 反向：纯 .ccg 提交（无其他改动）不得误报故障', () => {
  // 反向对照：若这笔提交**只有 .ccg 改动**，则「无记录」是正确状态，不得报故障。
  // 没有这一条，「有改动即报故障」会把正常的 .ccg-only 提交全判红（假阳）。
  const dir = makeRepoWithoutRecordB()
  try {
    // 再造一笔只改 .ccg/ 的提交（HEAD 变成它，HEAD^..HEAD 排除 .ccg 后为空）
    fsB.writeFileSync(pathB.join(dir, '.ccg', 'reviews', 'note.txt'), 'x')
    execB('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
    execB('git', ['commit', '-q', '-m', 'ccg only'], { cwd: dir, stdio: 'pipe' })
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.doesNotMatch(out, /这是\*\*故障\*\*/, '纯 .ccg 提交不得误报故障（否则假阳）')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

testNeedsEngine('QM-6 第三轮 i1：部分提交（索引有已暂存改动）必须报「分叉」而非「非故障」', () => {
  // 场景：HEAD 是一笔只含部分改动的提交，而**索引里还有已暂存的改动**。
  //   git status --porcelain 会显示有未提交改动 ⇒ 若只用「工作区脏 ⇒ 非故障」的合并判据，
  //   这种真分叉会被漏进「非故障」分支、深度审查被跳过（第三轮 i1 的指控）。
  // 正确行为：识别出「已暂存未提交」这一档，明确报部分提交导致的 A != B。
  const dir = makeRepoWithoutRecordB()
  try {
    fsB.writeFileSync(pathB.join(dir, 'staged.txt'), 'staged but not committed\n')
    execB('git', ['add', 'staged.txt'], { cwd: dir, stdio: 'pipe' })
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.match(out, /部分提交/, '索引有已暂存改动时必须点名「部分提交」这一形态')
    assert.match(out, /A != B/, '必须说明分叉机理（判定器按全量暂存取哈希，提交只含一部分）')
    assert.doesNotMatch(out, /这是\*\*故障\*\*/, '这一档报的是「部分提交」，不是「记录丢了」—— 两者根因不同')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

testNeedsEngine('QM-6 第三轮 i8：记录损坏时不得再报「这是故障」（避免两条诊断互相误导）', () => {
  // 同一屏输出「读不出 mode」和「这是故障」会让读者无法判断根因归属。
  // 损坏时应只有一条诊断。
  const dir = makeRepoWithoutRecordB()
  try {
    const head = execB('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    fsB.writeFileSync(pathB.join(dir, '.ccg', 'reviews', head + '.json'), '{ broken')
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.match(out, /读不出 mode/, '损坏必须报「读不出 mode」')
    assert.doesNotMatch(out, /这是\*\*故障\*\*/, '损坏时不得再报「这是故障」—— 只能有一条诊断')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

descB('QM-6 第三轮外部异议：B 侧 diff 配方必须与 A 侧（decider）逐项一致', () => {
  // 外部复核第三轮指出：A 侧（decider 的 stagedDiffHash）固定了
  // --no-textconv --no-ext-diff --no-renames，而 B 侧（本脚本）首版是**裸 git diff**
  // ⇒ 两边配方不一致时同一变更算出不同哈希 ⇒ 内容寻址失效。
  // 而这正是整套方案的承重墙（A == B），故必须钉住。
  const sh = fsB.readFileSync(SCRIPT, 'utf8')
  const dec = fsB.readFileSync(pathB.join(__dirname, 'ccg-review-decider.js'), 'utf8')
  const FLAGS = ['--no-textconv', '--no-ext-diff', '--no-renames']
  // B 侧真实调用
  const callLine = sh.split('\n').find((l) => l.includes('git diff') && l.includes('_DIFF_TMP'))
  assert.ok(callLine, '必须找到落临时文件的那次 git diff 调用')
  for (const f of FLAGS) {
    assert.ok(callLine.includes(f), `B 侧调用必须含 ${f}（与 A 侧同配方）`)
  }
  // A 侧（decider 的哈希配方）
  for (const f of FLAGS) {
    assert.ok(dec.includes('"' + f + '"'), `A 侧 decider 必须含 ${f}`)
  }
  // 给用户照抄的自检命令也必须同参数（否则用户按提示跑出的哈希与实现对不上）。
  // ★ 只取 **say 行**（代码），不取所有含 sha256sum 的行 —— 注释里也有 sha256sum
  //   （解释 printf 坑那段），首版把它当命令 ⇒ 恒假红（「注释骗过锁」第四次）。
  const selfCheck = sh.split('\n').filter((l) => /^\s*say /.test(l) && l.includes('sha256sum'))
  assert.ok(selfCheck.length >= 2, '至少应有两条自检命令（提交前口径 + 提交后口径）')
  for (const l of selfCheck) {
    for (const f of FLAGS) {
      assert.ok(l.includes(f), `自检命令也必须含 ${f}：${l.trim()}`)
    }
  }
})

descB('QM-6 第三轮 i7：deep-review.sh 不得对同一份 diff 重复物化', () => {
  // 首版把同一份 diff 物化三次（查找哈希、_DIFFLINES、commit -a 自检），大变更下 O(n)×3。
  // 用 includes 逐项点，不用一条大正则 —— 正则转义在跨 shell/node 两层时极易写错
  // （本轮实测：一条「看起来对」的正则匹配 0 次，而 includes 同为 true）。
  const sh = fsB.readFileSync(SCRIPT, 'utf8')
  const nDiff = sh.split('git diff --no-textconv --no-ext-diff --no-renames "$_PARENT2" "$SHA"').length - 1
  assert.strictEqual(nDiff, 1, '内容寻址段对同一份 diff 只应调用一次 git diff（哈希与行数复用）')
  // ★★ 关键：不得用 `$(...)` + `printf '%s'` 复用 —— 命令替换吃掉尾随换行，
  //   会使 sha256 与 decider 的 `git diff | sha256sum` 逐字节不同 ⇒ 内容寻址失效。
  assert.strictEqual(sh.includes("printf '%s' \"$_DIFF_OUT\""), false,
    '不得用 printf 复用命令替换的结果 —— 尾随换行被吃，哈希与 decider 对不上')
  assert.strictEqual(sh.includes('_DIFF_TMP='), true, '必须落临时文件，两处从同一份字节读')
  assert.strictEqual(sh.includes('sha256sum < "$_DIFF_TMP"'), true,
    '哈希必须从临时文件读（保留尾随换行），而不是从管道重读')
})

testNeedsEngine('QM-6 第二轮自查：工作区有未提交改动时不得误报故障（最常见工作流）', () => {
  // ★ 这条锁来自**我自己引入又自查抓到的假阳**：
  //   首版故障判据只看「HEAD^..HEAD 的非 .ccg diff 行数 > 0」，没有先看工作区是否干净。
  //   实测：HEAD 是旧提交、工作区有 589 行未提交改动 ⇒ 判据报「这是故障」，
  //   而那是「改到一半就跑 deep-review」的正常工作流 —— 判据会把最常见的工作流判红，
  //   **比不报更糟**。故补此反向锁：工作区脏 ⇒ 只提示「请先提交」，不得判故障。
  const dir = makeRepoWithoutRecordB()
  try {
    fsB.writeFileSync(pathB.join(dir, 'dirty.txt'), 'work in progress\n')
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.doesNotMatch(out, /这是\*\*故障\*\*/, '工作区有未提交改动时不得判故障（正常工作中）')
    assert.match(out, /工作区有 \d+ 个未提交/, '必须明说「未提交改动」这一档，并提示先提交')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

testNeedsEngine('QM-6 第五轮 i4：dual 提交缺记录必须 fail-closed（exit 1），不得静默 exit 0', () => {
  // 旧版「判定记录: 无」分支无条件 exit 0 ⇒ 记录缺失时深度审查被静默跳过 ⇒ fail-open。
  // 判据：本提交**本该有**记录吗（非 .ccg diff 行数 > 0）？本该有却缺失 ⇒ exit 1。
  // --dry-run 仍 exit 0（只预览，不承担门禁职责）。
  const dir = makeRepoWithoutRecordB()
  try {
    const r = spawnB(bashB, ['scripts/deep-review.sh'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.strictEqual(r.status, 1,
      '有非 .ccg 改动却无判定记录 ⇒ 必须 exit 1（fail-closed）；实际 status=' + r.status)
    assert.match(out, /fail-closed/, '必须明说这是 fail-closed，而不是含糊的「跳过」')
    // --dry-run 仍应为 0
    const r2 = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    assert.strictEqual(r2.status, 0, '--dry-run 只预览 ⇒ 仍应 exit 0')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

testNeedsEngine('QM-6 第五轮 i4 反向：纯 .ccg 提交无记录不得判故障（应 exit 0）', () => {
  // 反向对照：这本就不该有记录，exit 1 会造成假阳。
  try {
    const dir = makeRepoWithoutRecordB()
    try {
      fsB.writeFileSync(pathB.join(dir, '.ccg', 'reviews', 'note.txt'), 'x')
      execB('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
      execB('git', ['commit', '-q', '-m', 'ccg only'], { cwd: dir, stdio: 'pipe' })
      const r = spawnB(bashB, ['scripts/deep-review.sh'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
      assert.strictEqual(r.status, 0,
        '纯 .ccg 提交本就不该有记录 ⇒ 必须 exit 0（否则假阳）；实际 status=' + r.status)
    } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
  } catch (e) { throw e }
})

// ══════════════════════════════════════════════════════════════════════════
//  QM-6 评审后端可配置（change: qm6-review-backend-config，2026-10-18）
//  这里守的是「两个读取方 + 入口转发」这一层。
// ══════════════════════════════════════════════════════════════════════════

const NODE_LIB = path.join(ROOT, "scripts", "lib", "ccg-review-backends.js")
const SH_LIB = path.join(ROOT, "scripts", "lib", "ccg-backends.sh")

/** 在给定 env 下跑 sh 侧读取方，返回 backend_table 的 stdout。 */
function shBackendTable(env) {
  const r = spawnSync(resolveGitBash(), ["-c",
    'cd "$1" && . scripts/lib/ccg-backends.sh && resolve_review_backends >/dev/null && backend_table',
    "x", toPosixPath(ROOT)], {
    encoding: "utf8",
    timeout: 60000,
    env: { PATH: "/usr/bin:/bin", ...env },
  })
  assert.strictEqual(r.status, 0, `sh 读取方失败 rc=${r.status} err=${r.stderr}`)
  return String(r.stdout || "").replace(/\r/g, "")
}

function nodeBackendTable(env) {
  const r = spawnSync(process.execPath, [NODE_LIB, "--print-table"], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, ...env },
  })
  assert.strictEqual(r.status, 0, `node 读取方失败 rc=${r.status} err=${r.stderr}`)
  return String(r.stdout || "").replace(/\r/g, "")
}

test("两个读取方必须给出同一份后端表（sh 版与 node 版逐字对账）", () => {
  // 为什么必须字节比较，而不是各自断言"等于一个常量"：常量抄两份就会漂，而漂了的表
  // 会让 --check-deps 打印的名单与判定器写进记录的名单互相矛盾 —— 那正是本次的病灶形态。
  // 三档配置都要对账：默认 / 换 critic / 同族单后端（第三档是最容易只有一边处理对的形状）。
  const cases = [
    ["默认", {}],
    ["env 换 critic", { MP_QM6_CRITIC: "codex" }],
    ["同族单后端", { MP_QM6_CRITIC: "claude", MP_QM6_PROPOSER: "claude" }],
    ["未登记后端名", { MP_QM6_CRITIC: "kimi", MP_QM6_PROPOSER: "gemini" }],
  ]
  for (const [label, env] of cases) {
    const sh = shBackendTable(env)
    const node = nodeBackendTable(env)
    assert.ok(sh.length > 0, `${label}: sh 侧表为空 —— 解析退化` + ` (读不到清单?)`)
    assert.ok(node.length > 0, `${label}: node 侧表为空`)
    assert.equal(sh, node, `${label}: 两个读取方的后端表不一致`)
  }
  // 反证自证：默认档与换 critic 档必须**确实不同**，否则上面四组"相等"是恒真的空比较
  assert.notEqual(shBackendTable({}), shBackendTable({ MP_QM6_CRITIC: "codex" }),
    "覆盖没改变任何读数 ⇒ 对账锁测的是常量，不是解析")
})

test("入口必须把后端覆盖传给体检：--check-deps 只检配置里那对后端", () => {
  // 造一个**只装了 codex** 的家目录。若入口仍按老名单体检，它会打印 claude 不可用，
  // 而真实配置（--critic codex）下 claude 压根不该出现在判据里。
  let seq = 0
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `qm6-bt-${process.pid}-${seq++}-`))
  fs.mkdirSync(path.join(home, ".claude", "bin"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude", "bin", "codeagent-wrapper.exe"), "stub")
  const bin = path.join(home, ".local", "bin")
  fs.mkdirSync(bin, { recursive: true })
  const IS_WIN = process.platform === "win32"
  for (const tool of ["codex", "opencode"]) {
    const f = path.join(bin, IS_WIN ? `${tool}.exe` : tool)
    fs.writeFileSync(f, "#!/bin/sh\nexit 0\n")
    try { fs.chmodSync(f, 0o755) } catch { /* Windows 上空操作 */ }
  }
  const r = spawnSync(resolveGitBash(), [SCRIPT, "--check-deps", "--critic", "codex"], {
    encoding: "utf8",
    timeout: 120000,
    env: { PATH: "/usr/bin:/bin", HOME: home, USERPROFILE: home, CCG_BACKEND_BIN_DIRS: "" },
  })
  const out = String(r.stdout || "") + String(r.stderr || "")
  assert.match(out, /· codex/, `体检必须检查被覆盖后的 critic=codex，实得：\n${out}`)
  assert.match(out, /评审后端已被覆盖|评审后端已覆盖/, "覆盖必须出声")
  assert.doesNotMatch(out, /· claude/, `claude 不在本次配置里，不得进体检面，实得：\n${out}`)
})

test("入口参数不得静默忽略：未知旗标与缺值一律 rc=2", () => {
  for (const args of [["--critic"], ["--critic", "--force"], ["--oops"]]) {
    const r = spawnSync(resolveGitBash(), [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 60000,
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME || os.homedir(), USERPROFILE: process.env.USERPROFILE || os.homedir() },
    })
    assert.equal(r.status, 2, `${JSON.stringify(args)} 应 rc=2，实得 rc=${r.status} out=${r.stdout} err=${r.stderr}`)
    assert.match(String(r.stdout) + String(r.stderr), /缺值|未知旗标/,
      `${JSON.stringify(args)} 必须点名是哪种参数错误`)
  }
})

test("验证层必须把覆盖转发给驱动，且只在真的覆盖过时转发（默认路径保持逐字不变）", () => {
  const sh = fs.readFileSync(SCRIPT, "utf8")
  // 2026-10-22 起真跑出口不再是 `exec node "$DRIVER" …`（exec 会进程替换，写在它之后的写回
  // 步骤永远跑不到）。判据的**语义没变**：转发给驱动的覆盖参数必须逐值加引号。
  assert.match(sh, /run_driver_with_writeback --sha "\$SHA" --proposer "\$RB_PROPOSER" --critic "\$RB_CRITIC"/,
    "验证层真跑出口必须逐个引用地带上覆盖参数，否则 --critic 到入口就断了")
  // 函数体这一格是上一条的**对偶**：调用点加了引号、函数体若把 "$@" 退化成 $@，
  // 带空格的后端名仍会被词法拆分，上一条照样绿 —— 所以两条都要锁。
  assert.match(sh, /node "\$DRIVER" "\$@"/, "出口函数必须把参数整体（且带引号）交给驱动")
  assert.doesNotMatch(sh, /\$DRIVER" \$@/, "不得无引号展开 $@（那会把逐值加引号的全部收益归零）")
  assert.doesNotMatch(sh, /BACKEND_ARGS/,
    "不得再把覆盖参数拼成一个无引号展开的串（QM-6 外部评审 Critical：那样安全性只押在字符集正则上，"
    + "正则被放宽一格就直接打开词法拆分窗口，而放宽正则本身不会被任何测试问起）")
  // 默认不转发这一格是**设计**而不是遗漏：把本仓默认值钉进命令行等于再造一个真源，
  // 上游改默认时这里会静默覆盖它。所以必须有一条锁同时证明"只在覆盖时加"。
  // 转发必须**只在覆盖时**发生：默认命令行保持与历史逐字相同，既不把本仓默认值钉成
  // 第二真源，也让任何按旧命令行写的锁继续成立。判据按分支结构数一遍（两条真跑出口各一份）。
  assert.match(sh, /if \[ -n "\$RB_OVERRIDE_NOTE" \]; then\r?\n\s*say "→ 已向后端请求覆盖/,
    "覆盖参数的真跑出口必须由 RB_OVERRIDE_NOTE 门控（默认路径不得带上参数）")
})

test("--check-deps 的后端解析不得依赖 node（它是「node 本身坏了」时的诊断入口）", () => {
  const sh = fs.readFileSync(SCRIPT, "utf8")
  const iResolve = sh.indexOf("resolve_review_backends || exit 2")
  const iNodeGate = sh.indexOf("# ---------- 1. 定位 node ----------")
  const iCheckDeps = sh.indexOf('# ---------- 0a. 纯依赖体检（--check-deps）----------')
  assert.ok(iResolve > 0, "找不到后端解析调用点 —— 锚点漂移，本锁会退化成恒真")
  assert.ok(iNodeGate > 0, "找不到「定位 node」段")
  assert.ok(iCheckDeps > 0, "找不到 --check-deps 段")
  assert.ok(iResolve < iNodeGate,
    `后端解析必须早于定位 node（实得 resolve=${iResolve} node=${iNodeGate}）`)
  assert.ok(iResolve < iCheckDeps,
    `后端解析必须早于 --check-deps 体检（实得 resolve=${iResolve} checkdeps=${iCheckDeps}）`)
})

test('入口必须拒绝注入形态的后端名（形态判据是第一道防线，不是唯一一道）', () => {
  // QM-6 评审 i3 的历史形态：exec 曾把一个拼好的串无引号展开，那时安全性完全依赖
  // is_valid_backend 的字符集。现已改为逐值加引号（见上一条锁），
  // 但**形态判据本身仍要锁**：它是"这个名字能不能进评审链"的唯一答复点，
  // 所以这条锁必须钉住**判据本身**，而不是只钉"名字被传下去了"——
  // 将来有人放宽那个正则，这里必须当场变红，而不是留到注入真发生那天。
  for (const bad of ['a;b', '$(id)', 'a`b', 'a b', 'a|b', '..\\a']) { // 单/双引号刻意不在列：spawnSync→Git Bash 的 argv 会把引号吃掉（实测 "a'b" 抵达脚本时已是 ab，于是它成了一个"合法名"并通过判据），在本层不可测；同形态由 node 侧 lib 锁按 env 覆盖。判据一律取产出的那句话，不取 rc —— 这里 rc=2 会来自「找不到 node」，与被拒无关。
    const r = spawnSync(resolveGitBash(), [SCRIPT, "--critic", bad], {
      encoding: "utf8",
      timeout: 60000,
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME || os.homedir(), USERPROFILE: process.env.USERPROFILE || os.homedir() },
    })
    const out = String(r.stdout || "") + String(r.stderr || "")
    assert.equal(r.status, 2, JSON.stringify(bad) + " 应 rc=2，实得 rc=" + r.status + " out=" + out)
    assert.match(out, /不合法/, JSON.stringify(bad) + " 必须点名「后端名不合法」，实得：" + out)
    assert.ok(!out.includes("已向后端请求覆盖"), JSON.stringify(bad) + " 不得进入转发路径：" + out)
  }
})

test('入口必须先确认兄弟依赖存在再 source（$0 不可靠时给出真因，不留下一串 command not found）', () => {
  // QM-6 评审 i3（第二轮）：$0 → _self_dir_abs 在符号链接/非常规调用下可能指不到兄弟文件。
  // 那类失败的真实表现不是"找不到文件"这一句，而是后面每个函数都 command not found，
  // 于是排查者会去修函数——本锁要求守卫**早于** source 且当场 exit 2。
  for (const name of ['deep-review.sh', 'plan-review.sh']) {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts', name), 'utf8')
    const guard = sh.indexOf('[ -f "$_self_dir_abs/lib/ccg-backends.sh" ]')
    const src = sh.indexOf('. "$_self_dir_abs/lib/ccg-backends.sh"')
    assert.ok(guard > 0, `${name} 必须有「source 前确认文件存在」的守卫（锚点找不到即红，不得静默跳过）`)
    assert.ok(src > guard, `${name} 的守卫必须早于 source 那一行`)
    const between = sh.slice(guard, src)
    assert.match(between, /找不到评审后端读取方/, `${name} 守卫必须点名缺哪个文件`)
    assert.match(between, /exit 2/, `${name} 守卫必须 fail-closed 早退，不得带着未定义的函数继续跑`)
  }
})

// ---------- 评审时换后端 → 回写判定记录（#3927 假红的行为锁） ----------
//
// 为什么必须行为锁而不是结构锁：上一刀把「请求值落进记录」的实现放在了 pre-commit 的
// decider，于是**评审时**用 --critic 换后端根本不改记录。check-pr-exec-record.js 的
// judgeBackendMismatch 拿记录里的 reviewBackends（提交时那份）比驱动回填的
// deepReview.performedBy ⇒ 每一次合法覆盖都被读成「请求了 codex、干活的是 claude」，
// 判该条深度审查未闭合。那是工具自己造的假红，不是审查发现。
// 结构锁（"源码里有 --record-request 这个串"）在这里不够：把调用摘掉、只留注释，源码仍匹配。
//
// 夹具要点：
//  · 桩驱动写在 <fixture>/scripts/ccg-deep-review.js —— 这是入口定位驱动的第一候选路径，
//    所以本锁**不需要本机有真引擎**（CI 上同样执行，不会静默跳过）。
//  · 桩驱动启动时**自己再读一次记录**并把读数写进产物：这一格同时证明「回写早于交给驱动」。
//    只按源码位置断言顺序是证不出来的——回写若排在 exec 之后，argv 里读到的仍是旧值。
//  · 所有夹具文件一律进 .git/info/exclude：否则未跟踪的 scripts/** 会被读成「非 .ccg 改动」，
//    把「有改动却无记录 ⇒ 判故障」那批锁的被测前提改掉（本文件踩过一次）。

const LIB_JS_B = pathB.join(ROOT, "scripts", "lib", "ccg-review-backends.js");
const LIST_FILE_B = pathB.join(ROOT, "scripts", "ccg-review-backends.list");

// 提交时 decider 写进记录的那份请求值（critic=claude 来自清单，overridden=false）
const COMMIT_RECORD_B = JSON.stringify(
  {
    mode: "dual",
    highRiskDomains: [],
    reviewBackends: {
      critic: "claude",
      proposer: "opencode",
      from: { critic: "list", proposer: "list" },
      notes: [],
      overridden: false,
    },
    deepReview: { status: "pending" },
  },
  null,
  2
);

function makeReviewRecordRepoB(recordText) {
  const dir = makeRepoWithoutRecordB();
  // 入口在覆盖分支里按**仓库相对路径**调 `node scripts/lib/ccg-review-backends.js`，
  // （入口在文件开头就 cd 到由脚本自身位置算出的 ROOT，所以这个相对路径锚的是仓库根、不是调用方 cwd ——
  //   从非根 cwd 起脚本同样命中同一份 lib。QM-6 评审提过「换 cwd 必败」，取证后按不成立处置，本注记防它被重提。）
  // 而该 lib 按自身位置向上找清单 —— 两个文件缺一个，回写那一跳就会以 rc=2 失败。
  fsB.mkdirSync(pathB.join(dir, "scripts", "lib"), { recursive: true });
  fsB.copyFileSync(LIB_JS_B, pathB.join(dir, "scripts", "lib", "ccg-review-backends.js"));
  fsB.copyFileSync(LIST_FILE_B, pathB.join(dir, "scripts", "ccg-review-backends.list"));
  const infoExclude = pathB.join(dir, ".git", "info", "exclude");
  fsB.appendFileSync(
    infoExclude,
    "\nscripts/lib/ccg-review-backends.js\nscripts/ccg-review-backends.list\nscripts/ccg-deep-review.js\ndriver-argv.txt\n"
  );
  // 桩驱动：把 argv 与「本次启动时读到的记录后端」一起落盘 —— 顺序证据就藏在这一个产物里。
  fsB.writeFileSync(
    pathB.join(dir, "scripts", "ccg-deep-review.js"),
    [
      '"use strict"',
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      "const i = process.argv.indexOf('--sha')",
      "const sha = i >= 0 ? process.argv[i + 1] : ''",
      "const rec = path.join(process.cwd(), '.ccg', 'reviews', sha + '.json')",
      "let saw = 'NOSHA'",
      "try { const j = JSON.parse(fs.readFileSync(rec, 'utf8')); saw = (j.reviewBackends && j.reviewBackends.critic) || 'none' } catch (e) { saw = 'UNREADABLE:' + (e && e.code ? e.code : e.name) }",
      "fs.writeFileSync(path.join(process.cwd(), 'driver-argv.txt'), 'argv=' + process.argv.slice(2).join(' ') + '\\nsawCritic=' + saw + '\\n')",
      "process.exit(0)",
      "",
    ].join("\n")
  );
  const head = execB("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  fsB.mkdirSync(pathB.join(dir, ".ccg", "reviews"), { recursive: true });
  if (recordText !== null) {
    fsB.writeFileSync(pathB.join(dir, ".ccg", "reviews", head + ".json"), recordText);
  }
  return { dir: dir, head: head, recPath: pathB.join(dir, ".ccg", "reviews", head + ".json"), out: pathB.join(dir, "driver-argv.txt") };
}

// 真跑一次入口（非 dry-run）：假 HOME 提供 wrapper 与后端桩，PATH 贫瘠但含 node。
// node 必须在 PATH —— 回写那一跳是 `node scripts/lib/...`，缺 node 会让本锁红在环境上而不是红在判据上。
function runReviewRealB(dir, args) {
  const home = makeFakeHome({ codex: "codex", opencode: "opencode", claude: "claude" });
  const nodeDir = toPosixPath(pathB.dirname(process.execPath));
  const r = spawnB(bashB, ["scripts/deep-review.sh"].concat(args), {
    cwd: dir,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 1 << 24,
    env: { PATH: BARE_PATH + ":" + nodeDir, HOME: home, USERPROFILE: home, CCG_BACKEND_BIN_DIRS: "" },
  });
  return { rc: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
}

test("回写接线锁：覆盖分支必须在真跑出口之前调 node 回写，dry-run 分支不得调（预览不改产物）", () => {
  const sh = fsB.readFileSync(pathB.join(ROOT, "scripts", "deep-review.sh"), "utf8");
  const wb = sh.indexOf("--record-request");
  assert.ok(wb > 0, "入口里找不到回写调用 —— 锚点漂移，本锁会退化成恒真");
  const execReal = sh.indexOf('run_driver_with_writeback --sha "$SHA" --proposer');
  assert.ok(execReal > 0, "找不到覆盖分支的真跑出口");
  assert.ok(wb < execReal, "后端请求值必须早于把控制权交给驱动就已写进记录（排在之后这条永远跑不到）");
  assert.ok(sh.indexOf('exit 2', wb) < execReal, "回写失败必须在真跑出口之前早退");
  const dryStart = sh.indexOf('if [ "$DRY" -eq 1 ]; then');
  const dryEnd = sh.indexOf('exec node "$DRIVER" --dry-run --sha "$SHA" --proposer');
  assert.ok(dryStart > 0 && dryEnd > dryStart, "找不到 dry-run 的覆盖 exec");
  assert.ok(!sh.slice(dryStart, dryEnd).includes("--record-request"),
    "dry-run 不得回写 —— 预览的职责是打印将要做什么，不该改判定产物");
  assert.ok(!sh.slice(dryStart, dryEnd).includes("ccg-review-writeback"),
    "dry-run 也不得引入收口写回（tasks 2.1：预览不该产生产物）");
  assert.match(sh.slice(dryStart, dryEnd), /不回写/,
    "dry-run 必须**说出来**它没回写，否则读者会以为记录里的后端已被改过");

  // ★ 本片新增的承重顺序：收口写回（tier/evidence）必须夹在「驱动已返回」与「exit」之间。
  //   行为锁在 scripts/deep-review-entry-rc.test.js（把写回挪到 exit 之后 ⇒ 那批必红）；
  //   这里只是把同一件事按**位置**再钉一遍，好在红的时候直接点名是哪一格漂了。
  const fnStart = sh.indexOf('run_driver_with_writeback() {');
  assert.ok(fnStart > 0, "找不到真跑出口函数 —— 锚点漂移，本锁会退化成恒真");
  const fnBody = sh.slice(fnStart, sh.indexOf('\n}', fnStart));
  assert.ok(fnBody.length > 40, "出口函数体读出来是空的 —— 判据失明，不得读成「顺序正确」");
  const iCall = fnBody.indexOf('node "$DRIVER" "$@"');
  const iWb = fnBody.indexOf('ccg-review-writeback.js');
  const iExit = fnBody.indexOf('exit "$_wb_rc"');
  assert.ok(iCall >= 0 && iWb > iCall && iExit > iWb,
    `收口写回必须夹在驱动调用与 exit 之间（实得 call=${iCall} wb=${iWb} exit=${iExit}）`);
  assert.match(fnBody, /_wb_rc=\$\?/, "驱动的 rc 必须在调用之后立刻捕获，不得被后续命令覆盖");
  // ★ 外部深审 round 2 i1（Critical）的**位置**锁：④ 的两半（字节哈希 + 语义指纹）都必须在
  //   调驱动**之前**取好，并都透传给写回器。只给一半时写回器现在会 fail-closed（before-state-missing），
  //   但"少传一半"这种退化必须在这里点名，而不是等到评审跑完发现 tier 没写再回头查。
  assert.ok(fnBody.includes('--before-sha256="$_wb_before"'), "字节哈希必须透传");
  assert.ok(fnBody.includes('--before-fingerprint="$_wb_before_fp"'), "语义指纹必须透传（少它就是 i1 那条缺陷的形状）");
  const iFpTake = fnBody.indexOf('--print-fingerprint=')
  assert.ok(iFpTake >= 0 && iFpTake < iCall, "动手前的语义指纹必须在调驱动之前取")
});

descB("评审时换后端：入口必须把请求值写进判定记录，且驱动看到的已是覆盖值", () => {
  const fx = makeReviewRecordRepoB(COMMIT_RECORD_B);
  try {
    const r = runReviewRealB(fx.dir, ["--critic", "codex"]);
    assert.equal(r.rc, 0, "桩驱动应正常退出，实得 rc=" + r.rc + "\n" + r.out);
    const rec = JSON.parse(fsB.readFileSync(fx.recPath, "utf8"));
    assert.equal(rec.reviewBackends.critic, "codex", "记录顶层必须是**评审时**请求的后端，实得：" + JSON.stringify(rec.reviewBackends));
    assert.equal(rec.reviewBackends.overridden, true, "必须如实标 overridden，否则对账判据不启用");
    assert.equal(rec.reviewBackends.commitRequest.critic, "claude",
      "提交时那份必须挪进 commitRequest 留档 —— 覆盖不得销毁「谁在提交时请求了谁」这条审计链");
    assert.equal(rec.mode, "dual", "回写只动 reviewBackends，不得改决策层判据读的字段");
    assert.equal(rec.deepReview.status, "pending", "同上：deepReview 由驱动回填，入口不得代填");
    const argv = fsB.readFileSync(fx.out, "utf8");
    assert.match(argv, /sawCritic=codex/,
      "驱动启动时读到的记录必须已是覆盖值（这是「回写早于 exec」的现场证据，实得：" + argv + "）");
    assert.match(argv, /--critic codex/, "转发给驱动的命令行仍须带覆盖，实得：" + argv);
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

descB("传清单默认值时两侧都必须判「没覆盖」：不改记录、不出覆盖行、不转发旗标（QM-6 i2 的一致性锁）", () => {
  // critic 说「入口按 RB_OVERRIDE_NOTE 判、lib 按 r.overridden 判，两口径不一致 ⇒ 传默认值会被拒写并阻断审查」。
  // 这一格把它钉成行为而不是读码意见：清单第一行就是 claude，所以 --critic claude 必须整条链判「没覆盖」。
  const fx = makeReviewRecordRepoB(COMMIT_RECORD_B);
  try {
    const before = fsB.readFileSync(fx.recPath, "utf8");
    const r = runReviewRealB(fx.dir, ["--critic", "claude"]);
    assert.equal(r.rc, 0, "传清单默认值不得阻断审查，实得 rc=" + r.rc + "\n" + r.out);
    assert.doesNotMatch(r.out, /已向后端请求覆盖/,
      "入口不得把「与清单同值」报成覆盖（报了就走回写分支）\n实得：" + r.out);
    assert.equal(fsB.readFileSync(fx.recPath, "utf8"), before,
      "默认路径必须一个字节都不碰判定产物 —— 谁改过产物正是这条链要审计的东西");
    const argv = fsB.readFileSync(fx.out, "utf8");
    assert.doesNotMatch(argv, /--critic/,
      "未覆盖时不得把本仓默认值钉进命令行（那会造出第二真源），实得：" + argv);
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

descB("回写这一跳失败必须 fail-closed：rc=2、点名原因、驱动一次都不能起来", () => {
  // 把夹具里的 lib 改坏（语法错误）⇒ 回写调用以非零退出。这一形态比「记录不存在」更真实：
  // 走到这一步时记录必然存在（无记录的路径在前面就 exit 了），会坏的只有回写本身。
  const fx = makeReviewRecordRepoB(COMMIT_RECORD_B);
  try {
    fsB.writeFileSync(pathB.join(fx.dir, "scripts", "lib", "ccg-review-backends.js"), "module.exports = {");
    const r = runReviewRealB(fx.dir, ["--critic", "codex"]);
    assert.equal(r.rc, 2, "回写失败必须 rc=2，实得 rc=" + r.rc + "\n" + r.out);
    assert.match(r.out, /没能写回/, "必须点名是回写这一跳失败，否则排查者会去查后端");
    assert.ok(!fsB.existsSync(fx.out), "驱动一次都不能被启动 —— 带着不一致的记录跑审查，产出的结论不可用");
    const rec = JSON.parse(fsB.readFileSync(fx.recPath, "utf8"));
    assert.equal(rec.reviewBackends.critic, "claude", "失败路径不得半途改写记录");
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

descB("dry-run 换后端：只出声不回写，记录字节必须逐字不变", () => {
  const fx = makeReviewRecordRepoB(COMMIT_RECORD_B);
  try {
    const before = fsB.readFileSync(fx.recPath, "utf8");
    const r = runReviewRealB(fx.dir, ["--dry-run", "--critic", "codex"]);
    assert.equal(r.rc, 0, "dry-run 不该因回写缺失而失败，实得 rc=" + r.rc + "\n" + r.out);
    assert.equal(fsB.readFileSync(fx.recPath, "utf8"), before,
      "dry-run 改写了判定产物 —— 预览的职责是「将要做什么」，不是做");
    assert.match(r.out, /不回写/, "必须说出来没回写，否则读者会拿这份记录去对账");
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

descB("默认路径（没覆盖）一个字节都不碰记录：回写只在覆盖分支发生", () => {
  // 反向对照：上面三条都带 --critic。不带覆盖时入口必须完全不调回写，
  // 否则每个 PR 的判定产物都会被无关写者改一遍 mtime/键顺序 —— 而「谁改过判定产物」
  // 正是这条链要审计的东西。
  const fx = makeReviewRecordRepoB(COMMIT_RECORD_B);
  try {
    const before = fsB.readFileSync(fx.recPath, "utf8");
    const r = runReviewRealB(fx.dir, []);
    assert.equal(r.rc, 0, "实得 rc=" + r.rc + "\n" + r.out);
    assert.equal(fsB.readFileSync(fx.recPath, "utf8"), before, "无覆盖时记录必须逐字不变");
    assert.ok(!/评审后端已覆盖|评审后端已被覆盖/.test(r.out), "无覆盖不得打印覆盖行");
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

/**
 * 外部深审 round 2 的 i3：`ENTRY_WRITEBACK_CLOSURE_B` 是一份**手抄**的 require 闭包，
 * 而它自己的职责正是"让夹具与生产同形"——手抄清单与真实 require 图不同步时，这把同形锁
 * 本身就是那个失真点（新增一个依赖 ⇒ 夹具缺文件 ⇒ 生产路径又被 `|| say` 兜成一句告警而全绿）。
 * 所以这里不许手抄：从被登记文件的**实际 require 语句**推出闭包，逐项要求它已被登记。
 */
test("i3 闭包完整性锁：夹具登记的 require 清单必须由真实 require 图推出，不得手抄", () => {
  const pathMod = require('node:path')
  const queue = ['ccg-review-writeback.js']
  const got = new Set()
  const seen = new Set()
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const abs = pathMod.join(ROOT, 'scripts', rel)
    if (!fsB.existsSync(abs)) continue // 交给下面的一致性断言去报缺文件
    const src = fsB.readFileSync(abs, 'utf8')
    // 只收**仓内相对** require；node: 内置与第三方不在本入口的复制域内
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
    let m
    while ((m = re.exec(src)) !== null) {
      const depRel = pathMod.posix.normalize(pathMod.posix.join(pathMod.posix.dirname(rel), m[1]))
      got.add(depRel)
      queue.push(depRel)
    }
  }
  const declared = new Set(ENTRY_WRITEBACK_CLOSURE_B.filter((r) => r !== 'deep-review.sh' && r !== 'ccg-review-backends.list'))
  const missing = [...got].filter((r) => !declared.has(r) && !fsB.existsSync(pathMod.join(ROOT, 'scripts', r)) === false)
  assert.deepStrictEqual(missing, [],
    '夹具没登记写回器真实 require 到的文件 ⇒ 真跑时那一步会 Cannot find module 并被出口的 || say 吞成一句告警：' + JSON.stringify(missing))
  assert.ok(got.size >= 4, `推出来的闭包规模异常（实得 ${got.size}）—— require 解析退化，本锁会空转`)
  console.log('[ENTRY-CLOSURE] 真实 require 闭包=' + [...got].sort().join(','))
})


// ---------- --force 在验证层是装饰性旗标（切片 ccg-force-flag-honest） ----------
// 实测现场见 openspec/changes/ccg-force-flag-honest/proposal.md：引擎（仓外技能目录）在验证层
// 从判定记录自己读 mode，遇 skip 直接 return 0，并把该记录的 deepReview 整块覆写成
// skipped_by_mode（2026-10-22 临时仓读数：cleared/external/evidence=PR #4204 issuecomment-6323452201
// → skipped_by_mode/performedBy:null/findings:null，wipe=true）。入口过去只跳过自己的早退、
// 照样 exec ⇒ 命令 rc=0 而什么都没审，而两份已合并的执行记录把它写成「唯一能真正补审的路径」。
// 四格锁矩阵与分工见 design D5 / D7。

const SKIP_RECORD_B = JSON.stringify(
  {
    mode: "skip",
    reason: "S 复杂度低风险（夹具构造）",
    reviewBackends: {
      critic: "claude",
      proposer: "opencode",
      from: { critic: "list", proposer: "list" },
      notes: [],
      overridden: false,
    },
    deepReview: {
      required: true,
      status: "cleared",
      performedBy: "claude",
      tier: "external",
      evidence: "PR #4204 issuecomment-6323452201",
      findings: 7,
    },
  },
  null,
  2
);

descB("验证层 skip + --force 的答复面：rc=2 且文案点名旗标做不到（M-E3 的可见者）", () => {
  // 答复面单独一条：把 exit 2 改成 exit 0 只会红在这里，不会连带把产物面一起吃掉。
  const fx = makeReviewRecordRepoB(SKIP_RECORD_B);
  try {
    const before = fsB.readFileSync(fx.recPath, "utf8");
    const r = runReviewRealB(fx.dir, ["--force"]);
    assert.equal(r.rc, 2, "旗标做不到 ⇒ 不得退 0（退 0 读起来就是「已按要求跑过一遍」），实得 rc=" + r.rc + "\n" + r.out);
    assert.match(r.out, /不会强制/, "必须点名是「该旗标在验证层做不到」。夹具里后端桩齐备，所以这一句只可能来自拒绝点，"
      + "不由依赖体检那格顶罪：\n" + r.out);
    assert.match(r.out, /plan-review\.sh/, "必须给出当前真能用的替代路径（决策层对方案恒不跳过），否则拒绝等于把人留在原地：\n" + r.out);
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

descB("验证层 skip + --force 的产物面：桩驱动一次都没起来、判定记录逐字节不变（M-E1 的可见者）", () => {
  // 产物面单独一条：整块删掉拒绝分支时驱动会被启动（rc 也一起坏），这一条必须在**用例名粒度**上能被分辨，
  // 否则它与上一条同红集、等于一把装饰。断言取字节相等而不是"某字段没变"（后者对新增字段免疫）。
  const fx = makeReviewRecordRepoB(SKIP_RECORD_B);
  try {
    const before = fsB.readFileSync(fx.recPath, "utf8");
    const r = runReviewRealB(fx.dir, ["--force"]);
    assert.ok(!fsB.existsSync(fx.out), "桩驱动一次都不能起来 —— 覆写判定产物正是发生在把控制权交给驱动之后那一步");
    // 外部评审 i2 采纳：字节相等仍是硬判据（对新增字段免疫），但红的时候必须先能说出
    // 是"被写成 skipped_by_mode"还是"只是格式化漂移"—— 语义断言负责这一句归因。
    const after = JSON.parse(fsB.readFileSync(fx.recPath, "utf8"));
    assert.equal(after.deepReview && after.deepReview.status, "cleared",
      "被抹掉的必须是评审出处本身（真被覆写时这里先红并点名状态）：实得 "
      + JSON.stringify(after.deepReview && after.deepReview.status));
    assert.equal(fsB.readFileSync(fx.recPath, "utf8"), before,
      "判定产物必须逐字节不变（断言字节相等，不是断言某个字段没变 —— 后者对新增字段免疫）");
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

descB("验证层 skip 不带旗标：既有跳过语义逐字不变（rc=0、驱动不起、记录不动）", () => {
  // 这一格防的是"顺手把误用与正常跳过做成同一种红"：若实现把 MODE=skip 一律改成非零，
  // 正常档每次跳过都变红，而下一个维护者的补法是把整段拒绝删掉 —— 那就回到今天。
  const fx = makeReviewRecordRepoB(SKIP_RECORD_B);
  try {
    const before = fsB.readFileSync(fx.recPath, "utf8");
    const r = runReviewRealB(fx.dir, []);
    assert.equal(r.rc, 0, "正常跳过档必须照旧 rc=0，实得 rc=" + r.rc + "\n" + r.out);
    assert.ok(!fsB.existsSync(fx.out), "跳过档不得起驱动");
    assert.equal(fsB.readFileSync(fx.recPath, "utf8"), before, "跳过档不得改判定产物");
  } finally {
    fsB.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("拒绝点必须排在依赖体检与交给驱动之前（M-E4 的唯一可见者）", () => {
  // 为什么位置锁不可省：夹具把后端桩装齐了，所以「拒绝点后移到体检之后」这一形态在行为锁里
  // 照样 rc=2、照样有那句文案 —— 只有按源码位置才看得见它。锚点缺失一律当场红，
  // 不得让 indexOf 的 -1 继续参与位置比较（那会退化成"恒真"）。
  const sh = fsB.readFileSync(SCRIPT, "utf8");
  const refuse = sh.indexOf('\u2717 --force \u5728\u9a8c\u8bc1\u5c42\u4e0d\u4f1a\u5f3a\u5236');
  const depCheck = sh.indexOf("# ---------- 4. 依赖体检 ----------");
  const handoff = sh.indexOf('run_driver_with_writeback --sha "$SHA"')
  assert.ok(refuse > 0, "找不到那条拒绝语句本身（锚=✗ --force 在验证层不会强制）⇒ 入口没有拒绝点，或文案被改名");
  assert.ok(depCheck > 0, "找不到依赖体检段的锚点 ⇒ 本锁的区间已漂移，不得退化成空比较");
  assert.ok(handoff > 0, "找不到把控制权交给驱动的锚点（上游换成 run_driver_with_writeback，锚点必须跟着迁）⇒ 本锁不得退化成空比较");
  assert.ok(depCheck > refuse, "拒绝必须早于依赖体检（实得 refuse=" + refuse + " dep=" + depCheck + "）："
    + "体检在零后端时也 exit 2，会把「旗标做不到」伪装成「环境问题」");
  assert.ok(handoff > refuse, "拒绝必须早于把控制权交给驱动（实得 refuse=" + refuse + " handoff=" + handoff + "）");
});

test("--help 必须如实描述 --force（扫描域=脚本自身与 --help 输出，不含文档）", () => {
  const r = spawnB(bashB, ["scripts/deep-review.sh", "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: {
      PATH: BARE_PATH,
      HOME: process.env.HOME || osB.homedir(),
      USERPROFILE: process.env.USERPROFILE || osB.homedir(),
    },
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  assert.equal(r.status, 0, "--help 必须退 0，实得 rc=" + r.status + "\n" + out);
  assert.match(out, /--force/, "用法块里必须仍列着这个旗标（删掉旗标会让人以为是自己拼错了参数，归因推给下一个查询者）");
  assert.doesNotMatch(out, /忽略 mode=skip/, "不得再对已被实测否证的行为作承诺");
  assert.match(out, /不会强制/, "真相必须写在 --help 里，而不是等人真跑一次才看到；同时证明 --help 的打印区间覆盖到了新行");
});
