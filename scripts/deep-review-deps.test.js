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
  const infoExclude = pathB.join(dir, '.git', 'info', 'exclude')
  fsB.mkdirSync(pathB.dirname(infoExclude), { recursive: true })
  fsB.appendFileSync(infoExclude, '\nscripts/deep-review.sh\n')
  fsB.mkdirSync(pathB.join(dir, '.ccg', 'reviews'), { recursive: true })
  return dir
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

descB('QM-6 i1 行为锁：无记录时必须输出 commit -a 告警与两条自检命令', () => {
  const dir = makeRepoWithoutRecordB()
  try {
    const r = spawnB(bashB, ['scripts/deep-review.sh', '--dry-run'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.match(out, /git commit -a/, '必须点名实测故障形态 git commit -a')
    assert.match(out, /git diff --cached --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/, '必须给出提交前口径的自检命令（与实现同参数）')
    assert.match(out, /git diff HEAD\^ HEAD --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/, '必须给出提交后口径的自检命令（与实现同参数）')
  } finally { fsB.rmSync(dir, { recursive: true, force: true }) }
})

descB('QM-6 i7 行为锁：记录损坏时必须输出「读不出 mode」告警', () => {
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

descB('QM-6 第二轮 i1 行为锁：有改动却无记录必须判为「故障」', () => {
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

descB('QM-6 第三轮 i1：部分提交（索引有已暂存改动）必须报「分叉」而非「非故障」', () => {
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

descB('QM-6 第三轮 i8：记录损坏时不得再报「这是故障」（避免两条诊断互相误导）', () => {
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

descB('QM-6 第二轮自查：工作区有未提交改动时不得误报故障（最常见工作流）', () => {
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
