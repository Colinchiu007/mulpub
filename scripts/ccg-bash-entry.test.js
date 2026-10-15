"use strict"

// CCG 评审入口的「跑在哪个 shell」防护（QM-6 补充锁）。
//
// 背景（2026-10-07 另一会话实测事故）：有人在 PowerShell 里敲 `bash scripts/deep-review.sh`，
// 而**裸 bash 在本机解析到 WSL shim**（C:\windows\system32\bash.exe），不是 Git Bash。
// 后果不是报错退出，而是一串**指向性错误的排查建议**：
//   · HOME 变成 WSL 的 /home/<user>，于是 `找不到 ccg-deep-review.js` / `找不到 codeagent-wrapper`
//   · 脚本接着建议「设置 CCG_ARL_DIR 指向引擎目录」
// 于是排查者真的去查/去设 CCG_ARL_DIR —— 而该变量在 Process/User/Machine 三级作用域
// **全都不存在**，它是「从来没被设置过」，不是「没穿透到 Git Bash」。
// 整个会话因此在追一个幻影变量上耗掉多轮，真实根因（用错 shell）始终没被说破。
//
// 症状分类：这不是「环境坏了」，而是**报错文案把人带偏**。
// 所以本锁保护的不是某个变量，而是「入口必须先证明自己跑在对的 shell 里」。
//
// 设计约束（重要）：**只拦 WSL，不拦真 Linux**。
//   · WSL：Windows 的 Linux 子系统，本机 PATH/家目录/互操作全是另一套，本脚本无法工作；
//   · 真 Linux（含 GitHub Actions ubuntu runner）：.local/bin、npm prefix -g、
//     无扩展名 sh shim 那套 POSIX 分支**是能工作的**，deep-review-deps.test.js
//     就在 ubuntu 上跑。粗暴地要求「必须是 Git Bash」会把 CI 一起打死。
//
// 检测手段只用 WSL 自己必然设置的环境变量 + /proc/version，且**不引入任何外部命令**
// ——deep-review.sh 的既有教训（见 deep-review-deps.test.js ⑦）是：入口自己
// 不能依赖 PATH 里的工具目录，`dirname: command not found` 已经坑过一次。

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { spawnSync } = require("node:child_process")
const { resolveGitBash, toPosixPath } = require("./lib/ccg-test-helpers")

const ROOT = path.join(__dirname, "..")
const DEEP_REVIEW = path.join(ROOT, "scripts", "deep-review.sh")
const PLAN_REVIEW = path.join(ROOT, "scripts", "plan-review.sh")
const PS_ENTRY = path.join(ROOT, "scripts", "ccg-review.ps1")

// 与 start-mp-task.ps1 / run-bash-gate.ps1 / deep-review-deps.test.js 同一探测链：
// MP_GIT_BASH 覆盖 → git --exec-path 派生 → 硬编码候选 → 裸 bash（CI 上系统 bash）。

// 造一个「后端齐全」的家目录，让体检能走到最后 —— 我们要验的是 shell 判定，不是后端解析。
let seq = 0
function makeFakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-shell-${process.pid}-${seq++}-`))
  fs.mkdirSync(path.join(home, ".claude", "bin"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude", "bin", "codeagent-wrapper.exe"), "stub")
  const bin = path.join(home, ".local", "bin")
  fs.mkdirSync(bin, { recursive: true })
  const IS_WIN = process.platform === "win32"
  for (const tool of ["claude", "opencode"]) {
    const f = path.join(bin, IS_WIN ? `${tool}.exe` : tool)
    fs.writeFileSync(f, "#!/bin/sh\nexit 0\n")
    try { fs.chmodSync(f, 0o755) } catch { /* Windows 上空操作 */ }
  }
  return home
}

function run(script, args, extraEnv) {
  const home = makeFakeHome()
  const res = spawnSync(resolveGitBash(), [script, ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: home,
      USERPROFILE: home,
      CCG_BACKEND_BIN_DIRS: "",
      ...(extraEnv || {}),
    },
  })
  return { rc: res.status, out: `${res.stdout || ""}${res.stderr || ""}` }
}

// ① 核心行为锁：WSL 标记在场时，--check-deps 必须**先**拦下并说清「你跑在 WSL 上」。
//
// 为什么用 WSL_DISTRO_NAME 而不是去伪造 /proc/version：WSL **必然**设置该变量，
// 所以这是真实信号而非测试专用开关；而 /proc/version 在 Windows 上根本没有，
// 无法在单测里伪造（只能退化成结构锁，见 ③）。
test("WSL 环境下 deep-review.sh --check-deps 必须拦下并指向 Git Bash（不得输出误导性排查建议）", () => {
  const { rc, out } = run(DEEP_REVIEW, ["--check-deps"], { WSL_DISTRO_NAME: "Ubuntu" })
  assert.notEqual(rc, 0, "跑在 WSL 上必须非零退出，不能继续往下做无效体检")
  assert.match(out, /WSL/i, "必须点名 WSL 才是根因")
  assert.match(out, /Git Bash|Git for Windows/i, "必须指向正确的 shell，不能只说「你用错了」")
  // 关键断言：不得再吐出那条把人带偏的**建议**。
  // 注意判据是「建议去设」这个动作，不是 token 是否出现 —— 主动劝退反而更有价值。
  assert.doesNotMatch(
    out,
    /设置\s*CCG_ARL_DIR|CCG_ARL_DIR\s*指向/,
    "WSL 下最误导的动作就是建议设 CCG_ARL_DIR；该变量本机三级作用域都不存在，追它是死路",
  )
  // 更强的一格：必须**主动劝退**这个死路，否则排查者仍会先去试它。
  //
  // ⚠ 判据只认「不要 / 无需 / 不必」，**不能**写「不是环境变量」：
  // 实际文案是 `这**不是**环境变量没传进来`，中间夹了 Markdown 粗体星号，
  // 正则 `/不是环境变量/` 匹配不到，那条分支就是永不触发的死代码
  //（QM-6 评审 i6 点名）。要让断言真的活着，要么去掉文案里的星号，
  // 要么让正则容忍星号 —— 这里选后者，不动用户可见文案。
  assert.match(out, /不要|无需|不必/, "必须主动劝退追 CCG_ARL_DIR 的错误方向")
  assert.match(out, /不是\s*\**\s*环境变量/, "必须明说这不是环境变量没传进来（容忍 Markdown 星号）")
})

// ② 同一道闸必须装在 plan-review.sh 上。
//
// 否则从「决策层」入口走的人仍会掉进同一个坑：plan-review.sh 找不到 decider/driver
// 时同样会打印设置 CCG_ARL_DIR 的建议，而且它连 --check-deps 这样的诊断入口都没有。
test("WSL 环境下 plan-review.sh 同样必须拦下", () => {
  const { rc, out } = run(PLAN_REVIEW, [], { WSL_DISTRO_NAME: "Ubuntu" })
  assert.notEqual(rc, 0, "plan-review.sh 在 WSL 下也必须非零退出")
  assert.match(out, /WSL/i, "必须点名 WSL")
  assert.doesNotMatch(out, /设置\s*CCG_ARL_DIR|CCG_ARL_DIR\s*指向/, "不得输出误导性的 CCG_ARL_DIR 建议")
})

// ③ 反向锁：**不得**误伤真 Linux（含 GitHub Actions ubuntu runner）。
//
// 这是本锁最容易写坏的方向 —— 把「必须是 Git Bash」写成无条件断言，CI 会直接红。
// 深审不进 CI，但 deep-review-deps.test.js 每天都在 ubuntu 上跑本脚本。
test("无 WSL 标记时不得拦下（不得误伤真 Linux / ubuntu CI）", () => {
  const { out } = run(DEEP_REVIEW, ["--check-deps"], { WSL_DISTRO_NAME: "", WSL_INTEROP: "" })
  assert.doesNotMatch(out, /WSL/, "普通 Linux 环境不得被判成 WSL")
  assert.match(out, /体检通过|体检不通过/, "应当正常走完体检流程")
})

// ④ 检测手段必须覆盖 /proc/version 这条兜底。
//
// WSL_DISTRO_NAME 不是在所有调用形态下都在（例如某些非交互 -c 启动方式、
// 或经由某些 wrapper 时环境被清洗过），此时只剩 /proc/version 可认。
//
// ⚠ 该文件**并非 Windows 上不存在**——Git Bash 有虚拟 /proc 且可读
//（本机实测读到 `MINGW64_NT-10.0-26200 version 3.6.9-...`）。
// 这正是 QM-6 评审 i1 顺带查出的注释事实错误，也是本锁存在的理由：
// 检测在 Git Bash 上真的会被执行到，判据必须能区分二者，不能只认 Microsoft。
test("必须保留 /proc/version 兜底检测（结构锁）", () => {
  for (const script of [DEEP_REVIEW, PLAN_REVIEW]) {
    const src = fs.readFileSync(script, "utf8")
    assert.match(src, /proc\/version/, `${path.basename(script)} 应读 /proc/version 作兜底检测`)
    assert.match(
      src,
      /WSL_DISTRO_NAME|WSL_INTEROP/,
      `${path.basename(script)} 应认 WSL 自身设置的环境变量`,
    )
  }
})

// ⑤ 检测本身不得引入外部命令依赖。
//
// deep-review-deps.test.js ⑦ 记着一次真实事故：入口用 dirname 算 ROOT，
// 于是 PATH 坏掉时 --check-deps 自己先以 `dirname: command not found` 死掉 ——
// 一个「查别人坏没坏」的命令自己先坏了。WSL 闸同样不许引入 cat/grep/uname。
// 剥掉注释再判结构：本仓对结构锁已有成例（AGENTS.md「注释行里的 `2>&1`
// 不算捕获点」）——否则「# 不经 cat」这句说明本身会把锁变成永远红。
const stripComments = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""))
    .join("\n")

// 截取 _is_wsl 函数体。
//
// ⚠ 不能用 /_is_wsl[\s\S]*?\n}/ —— 它撞上**第一个**独占一行的 `}` 就停
// （QM-6 评审 i4）。将来函数里若为多行 while/do 块加一个收尾的 `}`，
// 截取会提前结束、只剩半截，检查要么失守要么误报。改为锚定函数末尾那行
// 裸 `return 1` + `}`，它与「检测失败」的语义绑定，不会被内层块抢走。
function extractGuard(src) {
  const m = src.match(/_is_wsl\(\)\s*\{([\s\S]*?\n\s*return 1\n\})/)
  return m ? m[1] : ""
}

test("WSL 检测不得依赖外部命令（结构锁：不得出现 cat/grep/uname）", () => {
  for (const script of [DEEP_REVIEW, PLAN_REVIEW]) {
    const src = fs.readFileSync(script, "utf8")
    const guardBlock = extractGuard(src)
    assert.ok(guardBlock, `${path.basename(script)} 应有 _is_wsl 检测函数`)
    const code = stripComments(guardBlock)
    for (const bad of ["cat", "grep", "uname"]) {
      assert.doesNotMatch(
        code,
        new RegExp(`\\b${bad}\\b`),
        `${path.basename(script)} 的 WSL 检测里不得调用外部命令 ${bad}`,
      )
    }
  }
})

// 截取 _is_wsl 函数体已提到模块顶层（stripComments / extractGuard）。

// ⑧ WSL 判据必须**同时**要求 Linux 内核特征，不能单凭 Microsoft。
//
// 这条是 QM-6 评审 i1 的落点。评审报的「Git Bash 已被误杀」经实测**不成立**
// —— 本机 Git Bash 的 /proc/version 是 `MINGW64_NT-10.0-26200 ...`，不含
// Microsoft。但它顺带查出两个真问题，本锁各钉一条：
//   ① 注释曾断言「Windows 上无 /proc/version」，**与事实相反**——MSYS 有
//      虚拟 /proc 且可读（本仓测试③在 Git Bash 上正是走这条分支通过的）；
//   ② 只认 Microsoft 的判据过宽：别的 MSYS/Cygwin 发行版版本串可能带厂商
//      字样，单看 Microsoft 就会把 Git Bash 判成 WSL 而 exit 2，
//      恰好打死本闸要保护的平台。真 WSL 的判据是
//      `Linux version ...-microsoft-standard-WSL2`，两者取交集才无歧义。
test("WSL 判据必须要求 Linux 内核串（不得单凭 Microsoft 误杀 Git Bash）", () => {
  for (const script of [DEEP_REVIEW, PLAN_REVIEW]) {
    const src = fs.readFileSync(script, "utf8")
    const code = stripComments(extractGuard(src))
    assert.match(code, /"Linux version "\*/, `${path.basename(script)} 的判据必须以 Linux 内核串为前缀`)
    // 剥掉带前缀的那两个分支后，剩下的不得再有裸的 Microsoft 判据
    const rest = code.replace(/"Linux version "\*\[Mm\]icrosoft\*/g, "").replace(/"Linux version "\*\[Ww\]\[Ss\]\[Ll\]\*/g, "")
    assert.doesNotMatch(
      rest,
      /\*\[Mm\]icrosoft\*|\*\[Ww\]\[Ss\]\[Ll\]\*/,
      `${path.basename(script)} 不得存在脱离 Linux 内核前缀的裸 Microsoft/WSL 判据`,
    )
  }
})

// ⑥ PowerShell 入口存在，且自带 Git Bash 身份校验。
//
// 这是**预防**层：真正的根治是让人根本不必手敲 `bash scripts/deep-review.sh`。
// 本仓已有同一套探测链的成熟实现（run-bash-gate.ps1），入口必须复用它而不是另起炉灶。
test("ccg-review.ps1 入口存在并复用 Git Bash 身份校验", () => {
  assert.ok(fs.existsSync(PS_ENTRY), "缺少 scripts/ccg-review.ps1 入口")
  const src = fs.readFileSync(PS_ENTRY, "utf8")
  assert.match(src, /Test-GitBashIdentity/, "必须做 Git Bash 身份校验，不能信任裸 bash")
  assert.match(src, /usr\\bin\\bash\.exe|usr\/bin\/bash\.exe/, "必须探测 Git Bash 的规范路径")
  assert.match(src, /MP_GIT_BASH/, "必须支持 MP_GIT_BASH 覆盖，与本仓其余脚本一致")
  // 必须显式拒绝 WSL shim 那类路径形态
  assert.match(src, /WSL|system32/i, "必须把 WSL shim 列为拒绝对象")
})

// ⑦ 入口必须真的能派发到两个评审脚本（结构锁）。
// 只做体检不做派发的入口没有意义。
test("ccg-review.ps1 入口必须派发到 deep-review.sh 与 plan-review.sh", () => {
  const src = fs.readFileSync(PS_ENTRY, "utf8")
  assert.match(src, /deep-review\.sh/, "必须派发到 deep-review.sh")
  assert.match(src, /plan-review\.sh/, "必须派发到 plan-review.sh")
})

// ⑧ 缺陷 E 回归锁：记录恒按【父提交 sha】命名，包装脚本必须回退命中而不是早退。
//
// 动因（2026-10-15 实测）：deep-review.sh 按 `git rev-parse HEAD` 找
// `.ccg/reviews/<HEAD>.json`；而判定器在 pre-commit 里跑，那时新 commit 还不存在、
// currentSha() 拿到的是**父提交** ⇒ 记录恒命名为 `<HEAD^>.json`，按 HEAD 找必然落空。
// 旧实现随即打印「判定记录: 无 —— 提交时没跑判定器」并 **exit 0**，于是深度审查
// 在真实流程里一次都没跑起来过；而引擎侧 ccg-deep-review.js 的 readDecision()
// 早有 stagedDiffHash 内容寻址兜底（其注释专门写了这件事），被这行早退挡在门外成了死代码。
//
// 判据为什么取「真实行为」而不是「源码里出现 HEAD^」：后者在回退被放到 exit 之后
// 时依然为真 —— 本仓明令防再犯锁必须做一次「把锁改成 no-op 就立刻变红」的变异，
// 纯文本断言过不了这一关。所以这里造一个隔离的两提交仓库，
// **记录只按父提交 sha 命名**，然后要求脚本既没早退、又报出了 DUAL、还真派发到了引擎。
test("记录只按父提交 sha 命名时，deep-review.sh 必须回退命中而不是早退「判定记录: 无」", () => {
  const gitBash = resolveGitBash()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-parentrec-${process.pid}-${seq++}-`))
  try {
    // 隔离仓库：复制被测脚本。脚本以自身位置推 ROOT ⇒ ROOT = 夹具目录，不碰真仓库。
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true })
    fs.copyFileSync(DEEP_REVIEW, path.join(root, "scripts", "deep-review.sh"))

    const g = (...args) =>
      spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } })
    g("init", "-q")
    g("config", "user.email", "t@example.invalid")
    g("config", "user.name", "t")
    g("config", "commit.gpgsign", "false")
    fs.writeFileSync(path.join(root, "a.txt"), "1\n")
    g("add", "a.txt")
    g("commit", "-q", "-m", "base")
    const base = g("rev-parse", "HEAD").stdout.trim()
    assert.equal(base.length, 40, "夹具仓库的第一个提交 sha 必须拿到")
    fs.writeFileSync(path.join(root, "b.txt"), "2\n")
    g("add", "b.txt")
    g("commit", "-q", "-m", "second")

    // 记录**只按父提交（= base）命名**；HEAD 名下故意不放记录 —— 这正是真实现场的形状。
    fs.mkdirSync(path.join(root, ".ccg", "reviews"), { recursive: true })
    fs.writeFileSync(
      path.join(root, ".ccg", "reviews", `${base}.json`),
      JSON.stringify({ sha: base, mode: "dual", deepReview: { required: true, status: "pending" } }),
    )

    // 桩 driver：脚本在 --dry-run 下 exec 它。它被调到 = 证明请求真的走到了引擎。
    const stubDir = path.join(root, "stub-arl")
    fs.mkdirSync(stubDir, { recursive: true })
    fs.writeFileSync(path.join(stubDir, "ccg-deep-review.js"), 'console.log("[stub-driver] reached")\n')

    const home = makeFakeHome()
    const gitRoot = gitBash.replace(/[\\/]usr[\\/]bin[\\/]bash\.exe$/, "")
    // PATH 三件事缺一不可：① node（脚本内部用 `node -e` 读记录 mode，也是桩 driver 的解释器）
    // ② git（rev-parse HEAD / HEAD^）③ Git 自带 POSIX 工具（tr/which/dirname）。
    // 少了任一个，本测试会因**环境**而非**判据**失败 —— 那是最容易把假红当真的地方。
    const envPath = [
      toPosixPath(path.dirname(process.execPath)),
      "/usr/bin",
      "/bin",
      `${toPosixPath(gitRoot)}/cmd`,
      `${toPosixPath(gitRoot)}/mingw64/bin`,
    ].join(":")

    const res = spawnSync(gitBash, [toPosixPath(path.join(root, "scripts", "deep-review.sh")), "--dry-run"], {
      encoding: "utf8",
      // ★ 超时必须给足：本用例要起 1 次 Git Bash + 若干次 git + node，
      // 实测净跑 35s；而它曾与一个 15 分钟的深度审查并发执行，
      // 在 60s 超时下被**资源争抢**打成假红（三条断言全失败，看起来像判据坏了）。
      // 假红的代价是让人去改没坏的判据 —— 所以这里放宽到 300s，
      // 并把 res.error 显式断言出来，让「超时」不再伪装成「判据失败」。
      timeout: 300000,
      cwd: root,
      env: {
        PATH: envPath,
        HOME: toPosixPath(home),
        USERPROFILE: toPosixPath(home),
        CCG_BACKEND_BIN_DIRS: "",
        CCG_ARL_DIR: toPosixPath(stubDir),
      },
    })
    const out = `${res.stdout || ""}${res.stderr || ""}`
    assert.ok(
      !res.error,
      `子进程本身必须正常结束（超时/信号会伪装成判据失败）：${res.error && res.error.message}\n输出：\n${out}`,
    )

    assert.doesNotMatch(
      out,
      /判定记录:\s*无/,
      `不得因「按 HEAD 找不到记录」而早退；实际输出：\n${out}`,
    )
    assert.match(out, /判定:\s*DUAL/i, `必须报出记录里的模式；实际输出：\n${out}`)
    assert.match(
      out,
      /\[stub-driver\] reached/,
      `必须真的派发到引擎（早退会让这里拿不到证据）；实际输出：\n${out}`,
    )
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具清理失败不影响判据 */ }
  }
})