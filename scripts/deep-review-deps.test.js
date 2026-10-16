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

test('内容寻址：查找必须**早于**「判定记录: 无」早退（否则又成死代码）', () => {
  // 这是 2026-10-15「缺陷 E」的同型失效：引擎本有内容寻址兜底，
  // 却被脚本里一行早退 exit 0 挡在门外，兜底成了死代码、深度审查一次没跑起来。
  // 所以位置本身就是判据：查找段必须在早退**之前**。
  const src = shSrc()
  const iHash = src.indexOf('sha256sum')
  const iEarly = src.indexOf('判定记录: 无')
  assert.ok(iHash > 0, '找不到内容寻址段')
  assert.ok(iEarly > 0, '找不到早退段（判据锚点失效，需同步更新本锁）')
  assert.ok(iHash < iEarly, '内容寻址查找必须在「判定记录: 无」早退之前 —— 否则永远执行不到')
})

test('内容寻址：配方必须与判定器同源（同一 pathspec :(exclude).ccg）', () => {
  const src = shSrc()
  assert.match(src, /:\(exclude\)\.ccg/, '哈希配方必须排除 .ccg，与 ccg-review-decider.js 的 stagedDiffHash 同源；否则算出的名字永远对不上')
})
