"use strict"

// plan-review.sh 后端体检的反模式回归锁（QM-6 补充）。
//
// 背景（2026-10-08 前一任务 PR #3107 执行记录登记的遗留项）：
//   plan-review.sh 的「依赖体检」段至今是旧形态——
//     command -v claude   >/dev/null 2>&1 || say "⚠ 找不到 claude —— …"
//     command -v opencode >/dev/null 2>&1 || say "⚠ 找不到 opencode —— …"
//   只 say 一句被动告警然后**照跑**。deep-review.sh 早已修好同一问题：
//   后端不在 PATH 时主动扫候选目录、把命中目录 prepend 到 PATH 最前并导出。
//
// 为什么「告警后照跑」是反模式（deep-review-deps.test.js ⑧ 已在 code 层钉过一次）：
//   症状不是报错退出，而是引擎**静默降级成单后端**——评审照跑、结论照出，
//   只是少了一路跨家族交叉验证。决策层（plan）恰恰是质量节拍的第一道闸，
//   在这里降级意味着整个「先对抗再动手」的承诺名存实亡。
//
// 本机实测形态（为什么 command -v 命中也不能幸免）：
//   进程 PATH 里 C: 盘条目被剥掉盘符（`C:\Users\<user>\.local\bin` →
//   `\Users\<user>\.local\bin`），Windows 按 cwd 盘符解析：cwd 在 D: 时
//   claude 不可解析、cwd 在 C: 时 opencode 反而不可解析——没有任何一条
//   PATH 条目能同时对两个盘符有效。且 wrapper 是 Go 原生进程，其
//   exec.LookPath 对无盘符条目拿相对路径后直接 ErrDot 拒绝执行，
//   而 bash 的 command -v 照样成功——「裸名能解析」根本推不出「wrapper 能起」。
//   所以唯一可靠的修法是把绝对目录顶到 PATH 最前并导出（ABS-prepend）。
//
// 判据与 deep-review-deps.test.js 同源，只是对象换成 plan-review.sh；
// 两个脚本必须**同步受锁**，否则修好一个、漏掉另一个的形态会静默回归
// ——这正是本锁要防的事。

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { spawnSync } = require("node:child_process")
const { resolveGitBash, toPosixPath } = require("./lib/ccg-test-helpers")

const ROOT = path.join(__dirname, "..")
const PLAN_REVIEW = path.join(ROOT, "scripts", "plan-review.sh")

// 与 ccg-bash-entry.test.js / deep-review-deps.test.js 同一探测链。

// 造「方案 + 判定器 + 引擎 + 假 HOME」最小环境，让脚本跑到依赖体检段。
// 判定器（ccg-review-decider.js）在仓库 scripts/ 下本来就存在，直接用；
// 引擎（ccg-deep-review.js）用技能目录真身；SKIP 模式会在体检前退出，
// 所以方案必须写成 DUAL（>200 行）才能走到被测的那段。
let seq = 0
function makeFakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `plan-deps-${process.pid}-${seq++}-`))
  fs.mkdirSync(path.join(home, ".claude", "bin"), { recursive: true })
  fs.writeFileSync(path.join(home, ".claude", "bin", "codeagent-wrapper.exe"), "stub")
  // 引擎驱动桩：plan-review.sh 第 3 候选在 $HOME/.claude/skills/.../ccg-deep-review.js。
  // 被测段（依赖体检）在引擎启动**之前**，桩只需要存在；--dry-run 路径同样不会真跑它。
  const skillDir = path.join(home, ".claude", "skills", "adversarial-review-loop", "scripts")
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, "ccg-deep-review.js"), "// stub\n")
  return home
}
function makeDualProposal() {
  const f = path.join(os.tmpdir(), `plan-proposal-${process.pid}-${seq++}.md`)
  const body = Array.from({ length: 220 }, (_, i) => `第 ${i} 行：方案正文占位，用于把复杂度推过 DUAL 阈值。`).join("\n")
  fs.writeFileSync(f, "# 方案\n\n" + body, "utf8")
  return f
}
// 统一清理（QM-6 评审 i5：断言抛异常时 finally 也要清理临时目录）。
function cleanup(proposals, homes) {
  for (const f of proposals || []) { try { fs.rmSync(f, { force: true }) } catch { /* 忽略 */ } }
  for (const d of homes || []) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 忽略 */ } }
}

function run(scriptArgs, extraEnv) {
  const home = makeFakeHome()
  const res = spawnSync(resolveGitBash(), [PLAN_REVIEW, ...scriptArgs], {
    encoding: "utf8",
    timeout: 120000,
    env: {
      PATH: bashPath(),
      HOME: home,
      USERPROFILE: home,
      CCG_BACKEND_BIN_DIRS: "",
      ...(extraEnv || {}),
    },
  })
  return { rc: res.status, out: `${res.stdout || ""}${res.stderr || ""}` }
}

// 「半贫瘠」PATH：node 必须可解析（否则脚本在体检段之前就死于
// 「找不到 node」，测不到目标行为），而后端 CLI 故意不在。
// node 目录从当前进程派生（fnm/系统 node 均可）；Git Bash 需 /c/... 形态。
function bashPath() {
  const nodeDir = path.dirname(process.execPath)
  const posix = path.sep === "\\" ? toPosixPath(nodeDir) : nodeDir
  return `/usr/bin:/bin:${posix}`
}

// ① 核心行为锁：后端不在 PATH 但装在候选目录时，必须 ABS-prepend 恢复，
//    不得只 say 一句 ⚠ 然后照跑（旧形态）。
test("plan-review.sh：后端在候选目录时必须 prepend PATH 恢复，不得被动告警后照跑", () => {
  const proposal = makeDualProposal()
  const home = makeFakeHome()
  const bin = path.join(home, ".local", "bin")
  fs.mkdirSync(bin, { recursive: true })
  const IS_WIN = process.platform === "win32"
  for (const tool of ["claude", "opencode"]) {
    const f = path.join(bin, IS_WIN ? `${tool}.exe` : tool)
    fs.writeFileSync(f, "#!/bin/sh\nexit 0\n")
    try { fs.chmodSync(f, 0o755) } catch { /* Windows 空操作 */ }
  }
  const res = spawnSync(resolveGitBash(), [PLAN_REVIEW, proposal], {
    encoding: "utf8",
    timeout: 120000,
    env: { PATH: bashPath(), HOME: home, USERPROFILE: home, CCG_BACKEND_BIN_DIRS: "" },
  })
  const out = `${res.stdout || ""}${res.stderr || ""}`
  assert.match(out, /已把绝对目录 .* 补到 PATH 最前/, "必须主动把候选目录 prepend 进 PATH（ABS 分支）")
  assert.doesNotMatch(out, /找不到 claude|找不到 opencode/, "装在候选目录的后端不得被判「找不到」")
  cleanup([proposal], [home])
})

// ② 结构锁：与 deep-review-deps.test.js ⑧ 同判据，对象换成 plan-review.sh。
//    防回潮：「command -v X || say …」就是被动告警形态本身。
test("plan-review.sh 不得回潮成被动告警：体检必须先修 PATH 再判定", () => {
  const src = fs.readFileSync(PLAN_REVIEW, "utf8")
  assert.doesNotMatch(
    src,
    /command -v (claude|opencode)[^\n]*\|\|\s*say/,
    "后端可用性判定不得是「不在 PATH 就 say 一句然后继续跑」的旧形态",
  )
  assert.match(src, /PATH="\$[A-Za-z_]+:\$PATH"/, "必须存在把目录 prepend 进 PATH 的恢复动作")
  assert.match(src, /export PATH/, "恢复后的 PATH 必须导出，否则子进程（wrapper）看不到")
})

// ③ fail-closed：一个后端都没有时必须早退，不能带着降级继续跑引擎。
//    与 deep-review.sh 语义一致：0 个后端 = 深度审查根本起不来（rc=2）；
//    1 个后端 = 降级可跑但必须点名（决策矩阵由引擎自己处理）。
test("plan-review.sh：一个后端都没有时必须 rc=2 早退并给出修法", () => {
  const proposal = makeDualProposal()
  const { rc, out } = run([proposal])
  assert.notEqual(rc, 0, "零后端时不得照跑引擎")
  assert.match(out, /claude/, "必须点名缺失后端")
  assert.match(out, /npm|安装|装/, "必须给出可操作修法")
  cleanup([proposal])
})

// ④ 单后端降级必须点名跨家族缺失（不得静默）。
//    i2 修复：同时断言 rc!=0 不可作为「早退」信号——④的语义是「降级后仍继续
//    跑引擎」，所以这里断言输出点名降级即可；真正的「早退 vs 照跑」分界由
//    ③（零后端 rc=2）与 ①（恢复后继续跑）两头钉住。
test("plan-review.sh：只剩单后端时必须点名降级（不得静默放行）", () => {
  const proposal = makeDualProposal()
  const home = makeFakeHome()
  const bin = path.join(home, ".local", "bin")
  fs.mkdirSync(bin, { recursive: true })
  const IS_WIN = process.platform === "win32"
  const f = path.join(bin, IS_WIN ? "claude.exe" : "claude")
  fs.writeFileSync(f, "#!/bin/sh\nexit 0\n")
  try { fs.chmodSync(f, 0o755) } catch { /* 空操作 */ }
  const res = spawnSync(resolveGitBash(), [PLAN_REVIEW, proposal], {
    encoding: "utf8",
    timeout: 120000,
    env: { PATH: bashPath(), HOME: home, USERPROFILE: home, CCG_BACKEND_BIN_DIRS: "" },
  })
  const out = `${res.stdout || ""}${res.stderr || ""}`
  assert.match(out, /只剩单后端|跨家族/, "降级必须点名跨家族交叉验证缺失")
  cleanup([proposal], [home])
})

// ⑤（QM-6 评审 i1 的回归锁，Critical）：裸名经「来历不明」的 PATH 条目命中、
//    候选目录不含它时，不得计为可用（旧 PATH 分支 = wrapper 可能起不来仍当
//    双后端用）。修复后该场景升级为 ABS（反推目录并 prepend）或按 MISS。
//    这里造「裸名命中 + 候选目录不含」：后端放进一个普通目录并加入 PATH，
//    但 HOME 候选链与 CCG_BACKEND_BIN_DIRS 都不含它。
test("PATH 分支：裸名来自非候选目录时必须反推目录 prepend（不得静默计可用）", () => {
  const proposal = makeDualProposal()
  const home = makeFakeHome()
  const stray = path.join(home, "stray-bin")
  fs.mkdirSync(stray, { recursive: true })
  const IS_WIN = process.platform === "win32"
  for (const tool of ["claude", "opencode"]) {
    const f = path.join(stray, IS_WIN ? `${tool}.exe` : tool)
    fs.writeFileSync(f, "#!/bin/sh\nexit 0\n")
    try { fs.chmodSync(f, 0o755) } catch { /* 空操作 */ }
  }
  // stray-bin 显式放进 PATH（POSIX 形态），HOME 候选链不含它
  const res = spawnSync(resolveGitBash(), [PLAN_REVIEW, proposal], {
    encoding: "utf8",
    timeout: 120000,
    env: {
      PATH: `${bashPath()}:${toPosixPath(stray)}`,
      HOME: home,
      USERPROFILE: home,
      CCG_BACKEND_BIN_DIRS: "",
    },
  })
  const out = `${res.stdout || ""}${res.stderr || ""}`
  assert.match(
    out,
    /已把其所在目录 .* 补到 PATH 最前|找不到/,
    "非候选目录的裸名命中必须升级为 ABS 或按 MISS，不得走旧 PATH 分支静默放行",
  )
  assert.doesNotMatch(out, /已按原样使用/, "旧 PATH 分支文案不得再出现（i1 反模式回潮检测）")
  cleanup([proposal], [home])
})

// ⑥（QM-6 评审 i2）：test① 必须断言「恢复后继续跑」——
//    旧实现的坑是把「体检通过」和「早退」混为一谈；①要钉的是
//    「候选目录命中 → 双后端可用 → 继续跑引擎（不再有零后端早退）」。
test("候选目录命中后不得早退：双后端齐备必须继续走完主流程", () => {
  const proposal = makeDualProposal()
  const home = makeFakeHome()
  const bin = path.join(home, ".local", "bin")
  fs.mkdirSync(bin, { recursive: true })
  const IS_WIN = process.platform === "win32"
  for (const tool of ["claude", "opencode"]) {
    const f = path.join(bin, IS_WIN ? `${tool}.exe` : tool)
    fs.writeFileSync(f, "#!/bin/sh\nexit 0\n")
    try { fs.chmodSync(f, 0o755) } catch { /* 空操作 */ }
  }
  const res = spawnSync(resolveGitBash(), [PLAN_REVIEW, proposal], {
    encoding: "utf8",
    timeout: 120000,
    env: { PATH: bashPath(), HOME: home, USERPROFILE: home, CCG_BACKEND_BIN_DIRS: "" },
  })
  const out = `${res.stdout || ""}${res.stderr || ""}`
  assert.match(out, /已把绝对目录 .* 补到 PATH 最前/, "必须走 ABS 分支")
  assert.match(out, /体检通过|只剩单后端|开始跨家族对抗评审/, "双后端齐备必须继续主流程（不得 rc=2 早退）")
  cleanup([proposal], [home])
})

// ── 产物目录碰撞拦截（change: gate-record-sync-derived-status，tasks 4.8）──────────────
// 引擎住在 git 之外（用户级技能），它用 basename(方案文件) 拼 slug ⇒ 两个 change 的 design.md
// 撞同一个产物目录、后跑的静默覆盖先跑的评审现场。实测本会话就覆盖了 commit f66081aec 里
// 另一会话的 critique-v1.md。修法选仓侧守卫：不动共享技能文件，改动可测、可变异、随 PR 走 CI。
test('plan-review.sh：方案名撞上别人的产物目录时必须拒绝运行并给出路', () => {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), `plan-collide-${process.pid}-`))
  const dir = path.join(art, '.adversarial', 'ccg-plan-design-claude')
  fs.mkdirSync(dir, { recursive: true })
  // 已存在的产物属于**另一份**方案（内容不同）
  fs.writeFileSync(path.join(dir, 'proposal-v1.md'), 'B1 RPA 反检测方案\n不同的方案\n', 'utf8')
  const proposal = path.join(art, 'design.md')
  fs.writeFileSync(proposal, '远程同步派生收口方案\n本次的方案\n', 'utf8')

  const r = run([proposal, '--dry-run'], { MP_ARTIFACT_ROOT: art })
  assert.match(r.out, /产物目录碰撞/, `必须点名碰撞，实际：${r.out.slice(0, 240)}`)
  assert.match(r.out, /ccg-plan-design-claude/, '必须点出会被覆盖的具体目录')
  assert.match(r.out, /只用方案文件名|不带所在目录/, '必须说明根因，否则下一个人只会改文件名试')
  assert.strictEqual(r.rc, 2, `碰撞时不得继续跑引擎（rc=${r.rc}，out=${r.out.slice(0, 200)}）`)
  // rc=2 单独不构成证据：环境闸/驱动搜索缺后端时同样是 rc=2，两个原因共用一个读数就分辨不出来
  // （变异 P-D 摘掉守卫里的 exit 2 后本用例照样绿，就是这个缺口被实测抓到的）。
  // 判据改成形状断言：碰撞时守卫必须是**最后**一段输出——摘掉 exit 后必然还有后续阶段的打印。
  const lastLine = String(r.out).trim().split('\n').pop()
  assert.match(lastLine, /拒绝运行/,
    `守卫退出后不得再有后续输出（末行实为「${lastLine}」⇒ 摘掉 exit 2 仍会继续往下跑）`)

  fs.rmSync(art, { recursive: true, force: true })
})

test('plan-review.sh：同一份方案重跑不算碰撞；知情放行必须留痕', () => {
  const mk = (storedText) => {
    const art = fs.mkdtempSync(path.join(os.tmpdir(), `plan-same-${process.pid}-`))
    const dir = path.join(art, '.adversarial', 'ccg-plan-design-claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'proposal-v1.md'), storedText, 'utf8')
    const proposal = path.join(art, 'design.md')
    fs.writeFileSync(proposal, '同一份方案的内容\n', 'utf8')
    return { art, proposal }
  }

  // ① 内容逐字相同 ⇒ 是自己的续跑，不得报碰撞
  const a = mk('同一份方案的内容\n')
  const r1 = run([a.proposal, '--dry-run'], { MP_ARTIFACT_ROOT: a.art })
  assert.doesNotMatch(r1.out, /产物目录碰撞/, `续跑被误判为碰撞：${r1.out.slice(0, 240)}`)
  fs.rmSync(a.art, { recursive: true, force: true })

  // ② 显式放行 ⇒ 必须留痕，且不得静默
  const b = mk('别人的方案\n')
  const r2 = run([b.proposal, '--dry-run'], { MP_ARTIFACT_ROOT: b.art, MP_ALLOW_PLAN_COLLISION: '1' })
  assert.match(r2.out, /MP_ALLOW_PLAN_COLLISION=1 放行/, `放行必须留痕：${r2.out.slice(0, 240)}`)
  assert.match(r2.out, /将覆盖/, '放行必须点名将被覆盖的目录')
  fs.rmSync(b.art, { recursive: true, force: true })
})

test('plan-review.sh：碰撞守卫必须在环境闸之前（否则缺后端时恒不可测）', () => {
  // 守卫若排在后端体检之后，测试环境（PATH 里没有后端）会在撞到守卫之前就退出，
  // 这条锁就退化成"只在有后端时才跑"的装饰——本仓吃过多次同款。
  const src = fs.readFileSync(PLAN_REVIEW, 'utf8')
  const iGuard = src.indexOf('产物目录碰撞拦截')
  const iEnvGate = src.indexOf('环境闸：拒绝 WSL')
  const iDriverSearch = src.indexOf('DRIVER=""')
  assert.ok(iGuard > 0, '守卫必须存在于 plan-review.sh')
  assert.ok(iGuard < iEnvGate, '守卫必须早于环境闸')
  assert.ok(iGuard < iDriverSearch, '守卫必须早于驱动搜索/调用')
})
