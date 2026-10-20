"use strict"

const assert = require("node:assert/strict")
const cp = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const checker = require("./check-unwired-tests.js")

/**
 * 把夹具目录变成**真 git 仓**并把当前磁盘内容提交进去。
 * 判定域自 #85 起取自 git（scripts/lib/git-domain.js），所以夹具必须与真仓同形，
 * 否则 collectCheck 就地抛「不是 git 工作树」—— 那是 fail closed 的正确方向，
 * 但也意味着"玩具目录"这种夹具形态从此不成立。
 * 两处机器态解耦（git-domain 语义 ⑥：判据本体按调用方 git 环境如实取域，不替调用方改配置，
 * 所以解耦只能由夹具自己做）：
 *  - core.excludesFile 指到夹具内空文件：机器 global/system 档里的 excludesFile 能把文件
 *    从 --exclude-standard 里藏掉，同一份夹具会在 CI 与本机给出不同的域；
 *  - core.hooksPath 指到不存在目录：夹具的 commit 不该被任何宿主钩子拦下或改写。
 */
function initFixtureRepo(root) {
  const git = (args) => {
    const r = cp.spawnSync("git", args, { cwd: root, encoding: "utf8", env: process.env })
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} 失败：` + String(r.stderr || r.stdout).slice(0, 200))
    }
  }
  const posix = (p) => p.replace(/\\/g, "/")
  git(["init", "-q", "-b", "main"])
  fs.writeFileSync(path.join(root, ".git", "fixture-excludes"), "", "utf8")
  git(["config", "--local", "core.excludesFile", posix(path.join(root, ".git", "fixture-excludes"))])
  git(["config", "--local", "core.hooksPath", posix(path.join(root, ".git", "fixture-no-hooks"))])
  git(["add", "-A"])
  git(["-c", "user.name=fixture", "-c", "user.email=fixture@invalid", "commit", "-q", "-m", "fixture"])
}

function makeFixture({ tests, workflowBody, exemptions = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unwired-tests-"))
  for (const rel of tests) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, "// fixture\n", "utf8")
  }
  const wfDir = path.join(root, ".github", "workflows")
  fs.mkdirSync(wfDir, { recursive: true })
  if (workflowBody !== null) {
    fs.writeFileSync(path.join(wfDir, "gate.yml"), workflowBody, "utf8")
  }
  initFixtureRepo(root)
  return { root, exemptions }
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

test("被 workflow 点名的测试判为已接线", () => {
  const { root } = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "run: node --test scripts/a.test.js\n",
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.equal(r.files.length, 1, "夹具应恰好解析出 1 个测试文件")
    assert.deepEqual(r.violations, [])
    assert.deepEqual(r.staleExemptions, [])
  } finally {
    cleanup(root)
  }
})

test("未点名且无豁免必须变红", () => {
  const { root } = makeFixture({
    tests: ["scripts/a.test.js", "scripts/b.test.js"],
    workflowBody: "run: node --test scripts/a.test.js\n",
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.deepEqual(r.violations, [{ code: "TEST_NOT_COLLECTED_BY_CI", file: "scripts/b.test.js", ambiguous: false }])
  } finally {
    cleanup(root)
  }
})

test("带原因的豁免放行，但被收集后豁免即过时", () => {
  const wired = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "run: node --test scripts/a.test.js\n",
    exemptions: { "scripts/a.test.js": "历史欠账" },
  })
  const unwired = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "run: echo none\n",
    exemptions: { "scripts/a.test.js": "历史欠账" },
  })
  try {
    assert.deepEqual(checker.collectCheck(wired.root, wired.exemptions).violations, [])
    const stale = checker.collectCheck(wired.root, wired.exemptions).staleExemptions
    assert.deepEqual(stale, [{ code: "TEST_EXEMPTION_STALE", file: "scripts/a.test.js" }], "已接线的文件仍留豁免必须报过时")
    const held = checker.collectCheck(unwired.root, unwired.exemptions)
    assert.deepEqual(held.violations, [], "豁免应放行未接线文件")
    assert.deepEqual(held.staleExemptions, [])
  } finally {
    cleanup(wired.root)
    cleanup(unwired.root)
  }
})

test("豁免必须带非空原因，否则视同无豁免", () => {
  const { root } = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "run: echo none\n",
  })
  try {
    assert.equal(
      checker.collectCheck(root, { "scripts/a.test.js": "" }).violations.length,
      1,
      "空原因不得算作豁免",
    )
  } finally {
    cleanup(root)
  }
})

test("同名 basename 时要求写全相对路径", () => {
  const body = "run: node --test scripts/hooks/x.test.sh\n"
  const fullPath = makeFixture({ tests: ["scripts/hooks/x.test.sh", "scripts/other/x.test.sh"], workflowBody: body })
  const basenameOnly = makeFixture({
    tests: ["scripts/hooks/x.test.sh", "scripts/other/x.test.sh"],
    workflowBody: "run: bash x.test.sh\n",
  })
  try {
    const exact = checker.collectCheck(fullPath.root, {}, {})
    assert.deepEqual(
      exact.violations.map((v) => v.file),
      ["scripts/other/x.test.sh"],
      "同名文件只有被写全路径的那一份算已接线，另一份仍须显式登记",
    )
    const loose = checker.collectCheck(basenameOnly.root, {}, {})
    assert.equal(loose.violations.length, 2, "仅出现裸文件名时两份同名文件都不得算已接线")
    assert.ok(loose.violations.every((v) => v.ambiguous === true))
  } finally {
    cleanup(fullPath.root)
    cleanup(basenameOnly.root)
  }
})

test("workflow 集合为空时必须报错而非静默判绿", () => {
  const noFiles = makeFixture({ tests: ["scripts/a.test.js"], workflowBody: null })
  const noDir = makeFixture({ tests: ["scripts/a.test.js"], workflowBody: "run: node --test scripts/a.test.js\n" })
  const emptyBody = makeFixture({ tests: ["scripts/a.test.js"], workflowBody: "" })
  try {
    assert.throws(() => checker.collectCheck(noFiles.root, {}, {}), /没有 workflow 文件/, "workflows 目录为空必须抛错")
    fs.rmSync(path.join(noDir.root, ".github"), { recursive: true, force: true })
    // #85 起"有哪些 workflow"由域给：gate.yml 仍被跟踪，所以走的是"域里有、磁盘读不到"那一格。
    // 这条仍然测同一件事（退化必须抛错），只是文案随取数来源一起搬 —— 不许退化成"跳过那一份"。
    assert.throws(
      () => checker.collectCheck(noDir.root, {}, {}),
      /workflow 在 git 域里但磁盘读不到/,
      "索引里还在、磁盘已被删掉时必须抛错",
    )
    const r = checker.collectCheck(emptyBody.root, {}, {})
    assert.equal(r.violations.length, 1, "workflow 存在但正文为空时，测试判为未接线而不是判绿")
  } finally {
    cleanup(noFiles.root)
    cleanup(noDir.root)
    cleanup(emptyBody.root)
  }
})

test("注释里提到文件名不算接线（只有可执行正文算）", () => {
  const onlyComment = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "# a.test.js 曾被漏掉\nrun: echo nothing\n",
  })
  const realLine = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "# 说明\nrun: node --test scripts/a.test.js # 收编\n",
  })
  try {
    const r = checker.collectCheck(onlyComment.root, {}, {})
    assert.deepEqual(
      r.violations.map(v => v.file),
      ["scripts/a.test.js"],
      "仅注释提及必须仍判未接线",
    )
    assert.deepEqual(checker.collectCheck(realLine.root, {}, {}).violations, [], "正文点名（含行尾注释）应判已接线")
  } finally {
    cleanup(onlyComment.root)
    cleanup(realLine.root)
  }
})

test("真实仓库：检查域非空、欠账清单已钉住且无违规", () => {
  const root = path.join(__dirname, "..")
  const r = checker.collectCheck(root, checker.KNOWN_UNWIRED)
  assert.ok(r.files.length >= 40, `真实仓库解析到的测试文件数异常：${r.files.length}（解析退化会让本门禁假绿）`)
  assert.ok(checker.TEST_SUFFIXES.includes(".test.ps1"), "PowerShell 测试必须在扫描域内，否则它们继续隐身")
  assert.deepEqual(
    Object.keys(checker.KNOWN_UNWIRED).sort(),
    [
      // 2026-09-29：最后一条 session-isolation-automation.test.ps1 已接进 Gate 2d（夹具 = CI 侧
      // 自有的临时 clone：checkout -B main + 复制两个 hook），清单清空。
      // 这里刻意继续用 deepEqual 钉成"恰好等于"而不是改成 <=/长度比较：
      // 清单变空**不代表**机制可以拆——任何新增豁免会当场变红，而删掉本断言会让"回归成
      // 无人发现的状态"重新变成可行路径。
    ].sort(),
    "欠账清单只能缩小；新增豁免须先在门禁里明确接受（棘轮与 platform-definitions 同形）",
  )
  // 空清单的另一半证明：那条销过账的文件仍在检查域内（不是靠把它排除出域来"清零"的），
  // 且下面的 violations 为空即意味着它确实被 workflow 正文点名了。
  assert.ok(
    r.files.includes("scripts/session-isolation-automation.test.ps1"),
    "已销账的测试必须仍在检查域内，否则「清单归零」可以靠缩小域来作弊",
  )
  for (const [file, reason] of Object.entries(checker.KNOWN_UNWIRED)) {
    assert.ok(String(reason).trim().length > 10, `豁免 ${file} 缺少可用原因`)
    assert.ok(r.files.includes(file), `豁免指向不存在的文件：${file}`)
  }
  assert.deepEqual(r.violations.map((v) => v.file), [], "存在未接线的测试文件，必须登记进 .github/workflows")
  assert.deepEqual(r.staleExemptions.map((v) => v.file), [], "存在过时豁免，请删除")
  // 域从"两个写死目录"扩成"全仓减显式排除"，所以排除表本身必须钉住（只能缩小）：
  // 谁把 apps/ 从 WORKSPACE_COVERED 里摘掉，全仓上千个 vitest 测试会当场涌进检查域并变红。
  assert.deepEqual(
    checker.WORKSPACE_COVERED.slice().sort(),
    ["apps/", "ops-center/", "packages/"],
    "workspace 排除表被改动：它决定 vitest 已收集的目录是否进本棘轮，改动须显式评审",
  )
  assert.deepEqual(
    checker.VENDORED_MIRROR.slice().sort(),
    [".quality-rhythm/"],
    "vendored 副本排除表被改动：新增副本目录必须带理由登记",
  )
  // 副本里那份 tpl-contract.test.js 必须**不在**域内（它属于制品副本，不是本仓被测代码）；
  // 这条断言是"排除真的生效"的证据，而不是" walker 恰好没遍历到" —— 后者由下一条共同保证。
  assert.ok(
    !r.files.includes(".quality-rhythm/.github/scripts/tpl-contract.test.js"),
    "vendored 副本内的测试文件不得进检查域",
  )
  assert.ok(
    checker.domainFiles(root).includes(".quality-rhythm/.github/scripts/tpl-contract.test.js"),
    "排除应发生在测试域这一步，而不是靠『取域恰好没拿到它』—— git 的域必须仍然看得见它",
  )
  // 嵌套 workflow：GitHub 只调度顶层，副本里那份永不执行，必须处于"带理由承认"状态。
  assert.ok(r.nestedFiles.length >= 1, "真实仓库存在嵌套 workflow（.quality-rhythm 副本），解析不到说明遍历退化")
  assert.deepEqual(r.nested.map((v) => v.file), [], "出现未被承认的嵌套 workflow：它看起来像门禁但永远不会被执行")
  assert.deepEqual(r.staleNested.map((v) => v.file), [], "存在过时的嵌套 workflow 承认，请删除")
  assert.deepEqual(
    Object.keys(checker.KNOWN_NESTED_WORKFLOWS).sort(),
    [".quality-rhythm/.github/workflows/mechanism-check.yml"],
    "嵌套 workflow 承认清单只能缩小；新增须带理由",
  )
  for (const [file, reason] of Object.entries(checker.KNOWN_NESTED_WORKFLOWS)) {
    assert.ok(String(reason).trim().length > 10, `承认 ${file} 缺少可用原因`)
  }
})

test("嵌套 workflow 未被承认必须变红", () => {
  const { root } = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "run: node --test scripts/a.test.js\n",
  })
  const nestedDir = path.join(root, "vendor", ".github", "workflows")
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.writeFileSync(path.join(nestedDir, "mechanism-check.yml"), "on:\n  push: {}\n", "utf8")
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.deepEqual(
      r.nested,
      [{ code: "NESTED_WORKFLOW_NOT_EXECUTED", file: "vendor/.github/workflows/mechanism-check.yml" }],
      "嵌套在子目录里的 workflow 不会被 GitHub 调度，必须出声",
    )
    assert.deepEqual(r.violations, [], "测试本身已点名，不应误报未接线")
  } finally {
    cleanup(root)
  }
})

test("承认过的嵌套 workflow 放行，文件消失即判过时", () => {
  const { root } = makeFixture({
    tests: ["scripts/a.test.js"],
    workflowBody: "run: node --test scripts/a.test.js\n",
  })
  const nestedDir = path.join(root, "vendor", ".github", "workflows")
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.writeFileSync(path.join(nestedDir, "m.yml"), "on:\n  push: {}\n", "utf8")
  try {
    const ack = { "vendor/.github/workflows/m.yml": "vendored 副本，本仓不执行" }
    const held = checker.collectCheck(root, {}, ack)
    assert.deepEqual(held.nested, [], "带理由承认后应放行")
    assert.deepEqual(held.staleNested, [])
    const gone = checker.collectCheck(root, {}, { "vendor/.github/workflows/other.yml": "已经不存在的承认" })
    assert.deepEqual(
      gone.staleNested.map((v) => v.file),
      ["vendor/.github/workflows/other.yml"],
      "承认清单里指向不存在的文件必须变红（棘轮只能缩小）",
    )
    assert.deepEqual(
      gone.nested.map((v) => v.file),
      ["vendor/.github/workflows/m.yml"],
      "换了承认对象不能把真实存在的嵌套 workflow 也一起放行",
    )
  } finally {
    cleanup(root)
  }
})

test("排除表只挡测试域，不把同级 scripts/ 一起吞掉", () => {
  const { root } = makeFixture({
    tests: [
      "apps/desktop/src/widget.test.js",
      ".quality-rhythm/.github/scripts/tpl-contract.test.js",
      "scripts/real.test.js",
    ],
    workflowBody: "run: echo nothing\n",
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.deepEqual(
      r.violations.map((v) => v.file),
      ["scripts/real.test.js"],
      "workspace 与 vendored 副本被排除，但同域内的 scripts/ 必须仍然报未接线",
    )
    assert.deepEqual(
      r.files,
      ["scripts/real.test.js"],
      `检查域应恰好剩 1 个，实际：${JSON.stringify(r.files)}`,
    )
  } finally {
    cleanup(root)
  }
})

// 旧版这条锁的是「磁盘遍历读不动目录必须抛错」。域改取 git 之后，"读不动"这件事由
// gitDomain 的四个失败出口承担（git 不可执行 / 非工作树 / root 不是仓库根 / 空集合），
// 这里保留同一条不变量的新形态：**取不到读数一律抛错，绝不返回空集合判绿**。
// 非工作树那一格由「取域失败必须出声而不是退回磁盘遍历」单独锁，两条不合并 ——
// 合并了就无法区分"缺目录"与"缺仓库"两种失明（红的时候不知道是哪条断了）。
test("root 不存在必须抛错，不能静默判定全绿", () => {
  const { root } = makeFixture({ tests: ["scripts/a.test.js"], workflowBody: "run: node --test a.test.js\n" })
  try {
    assert.ok(checker.domainFiles(root).length >= 2, "正常取域应看得见夹具文件（负控前提）")
    assert.throws(
      () => checker.domainFiles(path.join(root, "definitely-missing-root")),
      /无法从 git 取得扫描域/,
      "根目录不存在时必须抛错，而不是返回空集合判绿",
    )
  } finally {
    cleanup(root)
  }
})

// —— 接线资格登记表（MUST_LIVE_IN_UNGATED_JOB）——
// 动因：一条锁「被 workflow 点名」和「在纯文档 PR 上真的会跑」是两件事。
// 归档 PR #3114 的镜像漂移就是被这个区别放过去的（PR 侧 QG Changes=pass / QG Static=skipping，
// 漂移靠 main push 才红）。所以本判据的输入必须是 job 级结构，而不是整份 workflow 的 includes。

function jobsFixture(tests, jobsYaml) {
  return makeFixture({
    tests,
    workflowBody: `on:\n  push:\n    branches: [main]\njobs:\n${jobsYaml}`,
  })
}

test("登记表里的锁只住在被 job 级 if 门控的 job ⇒ 必须变红", () => {
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node scripts/other.js",
      "  static-gates:",
      "    if: needs.changes.outputs.docs-only != 'true'",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/mirror.test.js",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, { "scripts/mirror.test.js": "已接 static-gates" }, {}, {
      "scripts/mirror.test.js": "输入命中 docs-only 白名单",
    })
    assert.deepEqual(
      r.ungatedViolations,
      [{
        code: "TEST_ONLY_IN_SKIPPABLE_JOB",
        file: "scripts/mirror.test.js",
        where: "gate.yml::static-gates(gated)",
        reason: "输入命中 docs-only 白名单",
      }],
      "接在会被 docs-only 整片跳过的 job 里，等于对纯文档 PR 没有门禁",
    )
  } finally {
    cleanup(root)
  }
})

test("同一条锁接进无 job 级 if 的 job ⇒ 判合规（上一条的正控）", () => {
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/mirror.test.js",
      "  static-gates:",
      "    if: needs.changes.outputs.docs-only != 'true'",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/mirror.test.js",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, {}, {}, { "scripts/mirror.test.js": "输入命中 docs-only 白名单" })
    assert.deepEqual(r.ungatedViolations, [], "只要有一个不被跳过的 job 点名即合规")
    assert.deepEqual(r.violations, [])
  } finally {
    cleanup(root)
  }
})

test("step 级 if 不得被当成 job 级门控", () => {
  // 8 空格缩进的 if: 只门控那一个 step。把它误读成"整片 job 被门控"会让合规接线变假红，
  // 而假红的结局是逼人把登记表清空 —— 那是把锁拆掉换安静。
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: gated step",
      "        if: github.event_name == 'pull_request'",
      "        run: node --test scripts/mirror.test.js",
      "",
    ].join("\n"),
  )
  try {
    const jobs = checker.listJobBlocks(root, checker.domainFiles(root))
    assert.deepEqual(jobs.map((j) => ({ name: j.name, gated: j.gated })), [{ name: "changes", gated: false }],
      "step 级 if 出现在 steps: 之后，不得标记 job 为 gated")
    const r = checker.collectCheck(root, {}, {}, { "scripts/mirror.test.js": "输入命中 docs-only 白名单" })
    assert.deepEqual(r.ungatedViolations, [])
  } finally {
    cleanup(root)
  }
})

test("job 级 if 写在 steps: 之后同样是整片门控（按缩进判，不按位置判）", () => {
  // YAML 映射的键序是自由的。若按「if: 必须出现在 steps: 之前」来判，这种写法会被读成
  // "不被跳过的 job" ⇒ 假绿；而假绿正是本判据要消灭的形态（#3114 就是被它放过去的）。
  // 这条测试由反证 W3 逼出来：那一版实现确实有这个洞。
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/mirror.test.js",
      "    if: needs.other.outputs.docs-only != 'true'",
      "",
    ].join("\n"),
  )
  try {
    const jobs = checker.listJobBlocks(root, checker.domainFiles(root))
    assert.deepEqual(jobs.map((j) => ({ name: j.name, gated: j.gated })), [{ name: "changes", gated: true }],
      "写在 steps: 之后的 job 级 if 必须仍然标记该 job 为被门控")
    const r = checker.collectCheck(root, { "scripts/mirror.test.js": "已点名" }, {}, {
      "scripts/mirror.test.js": "输入命中 docs-only 白名单",
    })
    assert.equal(r.ungatedViolations[0].code, "TEST_ONLY_IN_SKIPPABLE_JOB",
      "这种 job 里点名不得被当成合法接线")
  } finally {
    cleanup(root)
  }
})

test("注释里点名不构成接线资格", () => {
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      # - run: node --test scripts/mirror.test.js",
      "      - run: echo none",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, { "scripts/mirror.test.js": "历史欠账" }, {}, {
      "scripts/mirror.test.js": "输入命中 docs-only 白名单",
    })
    assert.deepEqual(r.ungatedViolations, [{
      code: "TEST_ONLY_IN_SKIPPABLE_JOB",
      file: "scripts/mirror.test.js",
      where: "未被任何 job 点名",
      reason: "输入命中 docs-only 白名单",
    }], "注释里的点名不是执行，本判据不得被它糊过去")
  } finally {
    cleanup(root)
  }
})

test("登记的锁文件消失 ⇒ 判过时，不许留死登记也不许靠删文件逃避", () => {
  const { root } = jobsFixture(
    ["scripts/other.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/other.test.js",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, {}, {}, { "scripts/mirror.test.js": "已经不存在的锁" })
    assert.deepEqual(
      r.staleUngated.map((v) => v.file),
      ["scripts/mirror.test.js"],
      "登记项指向不存在的文件必须变红（清单只能缩小）",
    )
    assert.deepEqual(r.ungatedViolations, [], "文件不在域内时不再重复报接线资格")
  } finally {
    cleanup(root)
  }
})

test("job 解析退化必须抛错，不得读成「没有需要核对的接线」", () => {
  const { root } = makeFixture({ tests: ["scripts/a.test.js"], workflowBody: "run: node --test scripts/a.test.js\n" })
  try {
    assert.throws(
      () => checker.listJobBlocks(root, checker.domainFiles(root)),
      /一个 job 都没解析出来/,
      "workflow 没有 jobs: 结构时，「谁会被跳过」无从谈起 —— 必须出声而不是判合规",
    )
  } finally {
    cleanup(root)
  }
})

test("无法识别的 job 键必须抛错 —— 把正文累加给上一个 job 会伪造出合法接线", () => {
  // 一个 2 空格缩进、但名字不合 job_id 规则的键（点号 / 引号），若被当成"普通正文"继续累加，
  // 前一个**不被门控**的 job 就会冒充成点名的承载者 ⇒ 方向是假绿。
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo nothing",
      "  weird.job:",
      "    if: always()",
      "    steps:",
      "      - run: node --test scripts/mirror.test.js",
      "",
    ].join("\n"),
  )
  try {
    assert.throws(
      () => checker.listJobBlocks(root, checker.domainFiles(root)),
      /无法识别的 job 键/,
      "解析看不懂的 job 键必须出声，不得静默把它的内容算给前一个 job",
    )
  } finally {
    cleanup(root)
  }
})

test("两空格缩进的整行注释不得被误判成未知 job 键", () => {
  // 本仓 build.yml 里真实存在两空格缩进的 `# --- …（change: …）` 注释行。
  // 若"未知 job 键"判据跑在它前面，整道门禁会在真实仓库上抛错 —— 那是把假绿修成必然红，不可接受。
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "  # --- 两空格缩进的段落注释（change: demo）---",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/mirror.test.js",
      "",
    ].join("\n"),
  )
  try {
    const jobs = checker.listJobBlocks(root, checker.domainFiles(root))
    assert.equal(jobs.length, 1, "注释行不得产生 job，也不得抛错")
    assert.equal(jobs[0].gated, false)
    assert.ok(!jobs[0].code.includes("# ---"), "整行注释不得进入可执行正文")
  } finally {
    cleanup(root)
  }
})

test("互为子串的 basename 不算点名", () => {
  // 登记项 scripts/a.test.js 若被 "scripts/ba.test.js" 这行冒充成点名，
  // 就会把"没有任何不被跳过的 job 跑它"读成"有" —— 方向是假绿。
  const { root } = jobsFixture(
    ["scripts/a.test.js", "scripts/ba.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/ba.test.js",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, { "scripts/a.test.js": "已点名（假）" }, {}, {
      "scripts/a.test.js": "输入命中 docs-only 白名单",
    })
    assert.equal(r.ungatedViolations[0].code, "TEST_ONLY_IN_SKIPPABLE_JOB",
      "ba.test.js 的点名不得替 a.test.js 顶罪")
    assert.match(r.ungatedViolations[0].where, /未被任何 job 点名/)
  } finally {
    cleanup(root)
  }
})

test("行尾注释里的文件名不算点名", () => {
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo nothing # node --test scripts/mirror.test.js",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, { "scripts/mirror.test.js": "已点名（假）" }, {}, {
      "scripts/mirror.test.js": "输入命中 docs-only 白名单",
    })
    assert.equal(r.ungatedViolations[0].code, "TEST_ONLY_IN_SKIPPABLE_JOB",
      "行尾注释里的点名不是执行，与整行注释同口径")
  } finally {
    cleanup(root)
  }
})

test("真实仓库：接线资格清单只能缩小，且登记的锁确实住在不被跳过的 job", () => {
  const root = path.join(__dirname, "..")
  const jobs = checker.listJobBlocks(root, checker.domainFiles(root))
  // 规模下界（2026-10-08 实测：解析到 26 个 job，其中 14 个被 job 级 if 门控、12 个不被门控）。
  // 下界取「实测减两成」而不是贴脸值：正常新增 job 不会顶到上界，而解析退化（只解析到部分 workflow、或整片早退）会立刻掉到下界之下。
  assert.ok(jobs.length >= 24, `真实仓库解析到的 job 数异常：${jobs.length} —— 解析退化会让本判据假绿`)
  assert.ok(
    jobs.filter((j) => !j.gated).length >= 10,
    `不被跳过的 job 只剩 ${jobs.filter((j) => !j.gated).length} 个：若接线面整体被门控，这条门禁就失去意义`,
  )
  assert.deepEqual(
    Object.keys(checker.MUST_LIVE_IN_UNGATED_JOB).sort(),
    [
      "scripts/aggregate-changelog.test.js",
      "scripts/check-compose-error-codes.test.js",
      "scripts/openspec-sync-check.test.js",
      "scripts/quality-rhythm-spec-mirror.test.js",
    ],
    "接线资格登记表只能缩小；新增登记须在同 PR 把点名补进不被跳过的 job",
  )
  for (const [file, ack] of Object.entries(checker.MUST_LIVE_IN_UNGATED_JOB)) {
    assert.ok(String(ack && ack.reason ? ack.reason : "").trim().length > 10, `登记 ${file} 缺少可用原因`)
    assert.ok(String(ack && ack.resolveWhen ? ack.resolveWhen : "").trim().length > 10,
      `登记 ${file} 必须写明销账条件（散文里塞一句"销账"不算，见下条）`)
    assert.doesNotMatch(
      String(ack.resolveWhen).trim(),
      /^(无|N\/A|暂无|待定)[。.]?$/,
      `登记 ${file} 的销账条件是空洞占位 —— 判据要挡的是"以后没人能销账"，不是"字段存在"`,
    )
  }
  const r = checker.collectCheck(root, checker.KNOWN_UNWIRED, checker.KNOWN_NESTED_WORKFLOWS, checker.MUST_LIVE_IN_UNGATED_JOB)
  assert.deepEqual(r.ungatedViolations.map((v) => v.file), [], "登记的锁必须真的住在不被 docs-only 短路的 job 里")
  assert.deepEqual(r.staleUngated.map((v) => v.file), [], "存在过时的接线资格登记，请删除")
  // 现场证据按**每个登记项**核（原先只硬编码核 spec-mirror 那一条，新增登记等于免检）：
  // 点名它的那一行必须落在不被 job 级 if 门控的 changes 作业**可执行正文**里 ——
  // 注释行里提一句不算承载（与 collectCheck 的「注释不算点名」同口径，否则这条判据比它守的东西还松）。
  for (const file of Object.keys(checker.MUST_LIVE_IN_UNGATED_JOB)) {
    const carriers = jobs.filter((j) => j.code.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').includes(file))
    assert.ok(carriers.length >= 1, `没解析到点名 ${file} 的 job：${JSON.stringify(jobs.map((j) => j.name))}`)
    assert.ok(
      carriers.some((j) => !j.gated && j.name === "changes"),
      `${file} 的承载 job 应为不被门控的 changes，实际：${JSON.stringify(carriers.map((j) => [j.workflow, j.name, j.gated]))}`,
    )
  }
})

// —— 点名匹配的两条「假绿」方向（QM-6 两轴各自独立命中，逐条核过代码后确认都成立）——

test("同 basename 跨目录时，兄弟文件的点名不得冒领", () => {
  // collectCheck 早就有这条守卫（同名文件必须写全相对路径），接线资格判据的第一版漏了它：
  // 只点名 scripts/a/x.test.js 时，includes(basename) 会让 scripts/b/x.test.js 也被判成已接线。
  const { root } = jobsFixture(
    ["scripts/a/x.test.js", "scripts/b/x.test.js"],
    [
      "  changes:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: node --test scripts/a/x.test.js",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, { "scripts/a/x.test.js": "已接 changes" }, {}, {
      "scripts/b/x.test.js": { reason: "输入命中 docs-only 白名单", resolveWhen: "输入不再命中" },
    })
    assert.equal(r.ungatedViolations.length, 1, "同名兄弟文件的点名不得顶掉这一条红")
    assert.equal(r.ungatedViolations[0].file, "scripts/b/x.test.js")
    assert.match(r.ungatedViolations[0].where, /未被任何 job 点名/)
  } finally {
    cleanup(root)
  }
})

test("环境变量字面量里的路径不算点名", () => {
  // `env: TARGET=scripts/mirror.test.js` 只是把字符串塞进环境，不会执行任何东西。
  // 若它被当成接线，「没有任何 job 跑这条锁」就会被读成「有」—— 方向同样是假绿。
  const { root } = jobsFixture(
    ["scripts/mirror.test.js"],
    [
      "  changes:",
      "    env:",
      "      TARGET: scripts/mirror.test.js",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo nothing",
      "",
    ].join("\n"),
  )
  try {
    const r = checker.collectCheck(root, {}, {}, {
      "scripts/mirror.test.js": { reason: "输入命中 docs-only 白名单", resolveWhen: "输入不再命中" },
    })
    assert.equal(r.ungatedViolations[0].code, "TEST_ONLY_IN_SKIPPABLE_JOB")
    assert.match(r.ungatedViolations[0].where, /未被任何 job 点名/)
  } finally {
    cleanup(root)
  }
})

test("listJobBlocks 的退化出口各自都必须抛错（前两条经 collectCheck 走不到）", () => {
  // spec 的 Scenario 3 列了三种退化（目录缺失 / 目录里没有 yml / 解析出 0 个 job）。
  // 前两条若只靠 collectCheck 触发，实际会被 readWorkflowText 先抛 —— 那就没测到本函数的守卫，
  // 所以必须**直接调用** listJobBlocks。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unwired-degrade-"))
  try {
    const noWorkflows = path.join(tmp, "no-workflows")
    fs.mkdirSync(noWorkflows, { recursive: true })
    assert.throws(
      () => checker.listJobBlocks(noWorkflows, []),
      /未找到 workflows 目录/,
      "workflows 目录缺失必须抛错",
    )
    const emptyWf = path.join(tmp, "empty-wf")
    fs.mkdirSync(path.join(emptyWf, ".github", "workflows"), { recursive: true })
    assert.throws(
      () => checker.listJobBlocks(emptyWf, []),
      /没有 workflow 文件/,
      "目录存在但零个 yml 必须抛错，不得读成「无需核对」",
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// —— CLI 进程入口契约：判据在单测里跑对，不代表从命令行跑也对。
// 上一轮 Gate 12d 实测过 `process.exit(main())` 漏传 argv 会让所有命令行选项静默失效，
// 所以 root / --json / 抛错退出码这三条都必须从进程入口跑一次。
function runCli (args, cwd) {
  try {
    const out = cp.execFileSync(
      process.execPath,
      [path.join(__dirname, 'check-unwired-tests.js')].concat(args),
      { cwd: cwd || __dirname, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return { rc: 0, out, err: '' }
  } catch (e) {
    return { rc: e.status == null ? -1 : e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}

test('CLI：真实仓库上 rc=0 且打印 OK', () => {
  const r = runCli(['--root=' + path.join(__dirname, '..')])
  assert.equal(r.rc, 0, 'rc 必须为 0，stderr=' + r.err.slice(0, 200))
  assert.match(r.out, /OK: 全部测试均已接线或按欠账登记/)
})

test('CLI：root 取自 --root 而不是 cwd（从别处调用结果一致）', () => {
  const repo = path.join(__dirname, '..')
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'unwired-cli-'))
  try {
    const a = runCli(['--root=' + repo, '--json'], elsewhere)
    assert.equal(a.rc, 0, '从临时目录调用仍应 rc=0，stderr=' + a.err.slice(0, 200))
    const j = JSON.parse(a.out)
    assert.equal(j.ok, true)
    assert.ok(j.checked >= 40, '检查域规模不得退化：' + j.checked)
    assert.deepEqual(j.findings, [])
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('CLI：--root 指向不存在的目录必须 rc=2 并出声，不得静默 rc=0', () => {
  const r = runCli(['--root=' + path.join(os.tmpdir(), 'definitely-missing-unwired-root')])
  assert.equal(r.rc, 2, '抛错路径的退出码必须区别于「有违规」的 1，stdout=' + r.out.slice(0, 200))
  // #85 起域取自 git，所以第一个出声的出口是取域失败（collectCheck 一进门就取域，
  // 走不到 readWorkflowText）。「无法枚举目录」是旧磁盘遍历的文案，已随实现一起删除。
  assert.match(r.err, /无法从 git 取得扫描域/)
})

// ---------------------------------------------------------------- 本机归档目录不得冒充仓库（2026-10-18 起）
// 动因（实测）：`.agent_context/` 是**本地会话隔离归档**（worktree 快照 + 一次性探针脚本），
// 从未被 git 跟踪（`git ls-files .agent_context` = 0 条，实测 `.gitignore:354` 有 `.agent_context/`），
// CI 上根本不存在它。但它就在共享仓库根里，于是本判据在共享根的输出是 **3546 行 / 其中 3543 行**
// 来自 `.agent_context/worktree-archive-*`，rc=1；而干净 worktree 只有 3 行、rc=0。
// 也就是说这个门禁在共享根上**完全不可用** —— 天天红的东西等于没有，
// 属本仓反复记录的「装饰性门禁」同型（把红色训练成背景色）。
// 第一版处置是给剪枝清单加一条目录名；#85 把它换成"域取自 git"，于是这一类**整个消失**，
// 下面的行为锁因此只证明"排除确实发生"，不再依赖任何具体目录名。

test("本地归档目录 .agent_context 下的 *.test.js 不得进入检查域", () => {
  const { root } = makeDomainFixture({
    tracked: ["scripts/real.test.js"],
    untracked: [],
    ignored: [
      ".agent_context/worktree-archive-fake/scripts/orphan.test.js",
      ".agent_context/worktree-archive-fake/.github/scripts/lock.test.js",
    ],
    ignoreRules: [".agent_context/"],
    workflowBody: "run: node --test scripts/real.test.js\n",
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.deepEqual(r.files, ["scripts/real.test.js"],
      "只有真实脚本目录里的测试进检查域；本机归档副本必须被排除，实际: " + JSON.stringify(r.files))
    assert.deepEqual(r.violations, [], "归档目录里的孤儿测试不得判未接线")
    assert.deepEqual(r.nested.map((v) => v.file), [],
      "归档目录里的嵌套 workflow 也不得报（CI 只调度顶层 .github/workflows）")
  } finally {
    cleanup(root)
  }
})

// 反向锁：把"逐个目录名剪枝 + 自己递归遍历磁盘"这套机制**钉在已删除状态**。
// 理由不是洁癖：那套机制的判据是"这台机器上现在有什么"，而它只能事后追认已经发现的噪声目录
// —— 本轮实测的第二例 `.adversarial/arl-patched/.github/workflows/ci.yml` 就是这样重新红一次的
// （A/B 同环境读数见 openspec/records/ 本篇）。把它请回来等于重新引入本缺陷。
test("磁盘遍历与逐个目录名的剪枝清单不得回来（本判据的域只有一个来源）", () => {
  assert.equal(checker.walkRepoFiles, undefined, "walkRepoFiles 已删除：它量的是磁盘，不是仓库")
  assert.equal(checker.PRUNE_DIRS, undefined, "PRUNE_DIRS 已删除：逐目录名只能事后追认噪声")
  const src = fs.readFileSync(path.join(__dirname, "check-unwired-tests.js"), "utf8")
  assert.match(src, /require\(["']\.\/lib\/git-domain["']\)/,
    "取域必须走共享实现（scripts/lib/git-domain.js），不得在本文件里再写一份 git 调用")
  assert.doesNotMatch(src, /withFileTypes/,
    "不得再出现递归磁盘枚举；readWorkflowText/listJobBlocks 读顶层 .github/workflows 用的是 readdirSync(files)，与此不同")
})

// ================================================================ 判定域＝git 的域（#85）
// 动因（2026-10-18 实测两例，同一根因）：本判据的域是 `walkRepoFiles` 的**磁盘遍历**，
// 于是任何**本机才有的未跟踪产物**都会被当成"仓库里的东西"：
//   ① 共享根里另一会话留下的 `.adversarial/arl-patched/.github/workflows/ci.yml`
//      ⇒ NESTED_WORKFLOW_NOT_EXECUTED rc=1（而 CI 的检出态里没有这个路径）；
//   ② 另一片里 `check-docs-sync.test.sh` 泄漏的畸形目录，其内部含
//      `.github/workflows/quality-gate.yml` ⇒ 同一个判据再红一次。
// 上一轮的处置是给 PRUNE_DIRS 加一条目录名 —— 那是按**具体路径**打补丁，下一个未跟踪目录
// 又会红。正解是把域收敛到 `scripts/lib/git-domain.js`（= `git ls-files` ∪
// `--others --exclude-standard` = git status = CI 检出态），与 #3876/#3900 同一条路。
// 关键约束：**未跟踪但未被忽略**的文件仍在域内（"新增测试必须接线"这一半不能被削掉），
// 只有**被 .gitignore 吞掉**的才排除。

/**
 * 建一个**真 git 仓**夹具，按三种身份放文件：
 *   tracked   —— 提交进库（CI 检出态里存在）
 *   untracked —— 只在磁盘、未被忽略（git status 的 `??`，本仓要求接线的正是这一类）
 *   ignored   —— 只在磁盘、被 .gitignore 吞掉（CI 上根本不存在 ⇒ 不得进域）
 * ignored 一档必须由夹具自己提交的 `.gitignore` 制造（不是宿主机器态），
 * 否则同一份夹具会在 CI 与本机给出不同的域 —— 解耦见 initFixtureRepo 与下面那条对账用例。
 */
function makeDomainFixture({ tracked = [], untracked = [], ignored = [], ignoreRules = [], workflowBody }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unwired-domain-"))
  const put = (rel, text) => {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, text, "utf8")
  }
  if (ignoreRules.length) put(".gitignore", ignoreRules.join("\n") + "\n")
  for (const rel of tracked) put(rel, "// fixture\n")
  put(".github/workflows/gate.yml", workflowBody === undefined ? "run: node --test scripts/real.test.js\n" : workflowBody)
  initFixtureRepo(root)
  for (const rel of untracked) put(rel, "// fixture\n")
  for (const rel of ignored) put(rel, "// fixture\n")
  return { root }
}

/** 把 process.env.GIT_CONFIG_GLOBAL 指到一份可控配置，跑 fn，随后原样恢复。 */
function withGitGlobal(configText, fn) {
  const cfg = path.join(os.tmpdir(), `unwired-git-global-${process.pid}-${Date.now()}.txt`)
  fs.writeFileSync(cfg, configText, "utf8")
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
  process.env.GIT_CONFIG_GLOBAL = cfg
  process.env.GIT_CONFIG_NOSYSTEM = "1"
  try {
    return fn(cfg)
  } finally {
    for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: saved.global, GIT_CONFIG_NOSYSTEM: saved.nosystem })) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    fs.rmSync(cfg, { force: true })
  }
}

test("域正控：被**提交**的嵌套 workflow 必须报 NESTED_WORKFLOW_NOT_EXECUTED", () => {
  const { root } = makeDomainFixture({
    tracked: ["scripts/real.test.js", "vendor-copy/.github/workflows/x.yml"],
    untracked: [],
    ignored: [],
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.deepEqual(r.nested.map((v) => v.file), ["vendor-copy/.github/workflows/x.yml"],
      "被跟踪的嵌套 workflow 是这条判据要抓的本体，换域后不得漏")
  } finally {
    cleanup(root)
  }
})

test("域负控 A：被 .gitignore 吞掉的本机产物不得进判据（今天红在这里）", () => {
  const { root } = makeDomainFixture({
    tracked: ["scripts/real.test.js"],
    untracked: [],
    ignored: [".adversarial/arl-patched/.github/workflows/ci.yml", "scratch/orphan.test.js"],
    ignoreRules: [".adversarial/", "scratch/"],
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.deepEqual(r.nested, [],
      "未跟踪且被忽略的嵌套 workflow 在 CI 检出态里不存在，报出来就是本机假红：" +
      JSON.stringify(r.nested))
    assert.deepEqual(r.files, ["scripts/real.test.js"],
      "被忽略的 *.test.js 不得进检查域：" + JSON.stringify(r.files))
  } finally {
    cleanup(root)
  }
})

test("域负控 B：未跟踪但**未被忽略**的东西必须仍在域内（不得缩成只看被跟踪文件）", () => {
  const { root } = makeDomainFixture({
    tracked: ["scripts/real.test.js"],
    untracked: ["scripts/new.test.js", "dropped/.github/workflows/y.yml"],
    ignored: [],
  })
  try {
    const r = checker.collectCheck(root, {}, {})
    assert.ok(r.files.includes("scripts/new.test.js"),
      "新写的未跟踪测试正是「必须去接线」的对象，域若只看被跟踪文件就会永久漏掉它：" + JSON.stringify(r.files))
    assert.ok(r.violations.some((v) => v.file === "scripts/new.test.js"),
      "未接线的未跟踪测试必须判红")
    assert.deepEqual(r.nested.map((v) => v.file), ["dropped/.github/workflows/y.yml"],
      "未跟踪但未忽略的嵌套 workflow 仍要报（它会被 add 进库）")
  } finally {
    cleanup(root)
  }
})

// 夹具自带 core.excludesFile 钉住的**效力**证明。git-domain 语义 ⑥ 明确"判据本体按调用方
// git 环境如实取域、不替调用方改配置"，所以机器 global 档的 excludesFile 能否污染判定域，
// 完全取决于夹具自己有没有钉 —— 这条用例证明那颗钉子真的有牙（同时含"不钉就会被藏掉"的负控，
// 否则「钉了」与「本来就不受影响」两种状态在断言上不可区分）。
test("夹具的 excludesFile 钉住必须压过机器 global 档（否则同一套件在 CI 与本机量到不同的域）", () => {
  const hostile = path.join(os.tmpdir(), `unwired-hostile-excludes-${process.pid}-${Date.now()}.txt`)
  fs.writeFileSync(hostile, "*.test.js\nvendor*/\n", "utf8")
  withGitGlobal(`[core]\n\texcludesFile = ${hostile.replace(/\\/g, "/")}\n`, () => {
    try {
      const pinned = makeDomainFixture({
        tracked: ["scripts/real.test.js"],
        untracked: ["scripts/new.test.js"],
        ignoreRules: [],
      })
      try {
        const r = checker.collectCheck(pinned.root, {}, {})
        assert.deepEqual(r.files, ["scripts/new.test.js", "scripts/real.test.js"],
          "被跟踪/未跟踪的测试都该在域里，机器 global 档的 excludesFile 不得越权改写夹具：" +
          JSON.stringify(r.files))
      } finally {
        cleanup(pinned.root)
      }
      // 负控：同一份 hostile global 档下，一个**没钉** excludesFile 的仓库确实被藏掉 ——
      // 证明上面那句结论来自钉子，而不是"这个环境本来就不受影响"。
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), "unwired-bare-"))
      try {
        fs.mkdirSync(path.join(bare, "scripts"), { recursive: true })
        fs.writeFileSync(path.join(bare, "scripts", "real.test.js"), "// fixture\n", "utf8")
        const g = (args) => cp.spawnSync("git", args, { cwd: bare, encoding: "utf8", env: process.env })
        g(["init", "-q", "-b", "main"])
        g(["add", "-A"])
        g(["-c", "user.name=f", "-c", "user.email=f@invalid", "commit", "-q", "-m", "x"])
        fs.writeFileSync(path.join(bare, "scripts", "new.test.js"), "// fixture\n", "utf8")
        const listed = cp.spawnSync(
          "git", ["ls-files", "--others", "--exclude-standard"],
          { cwd: bare, encoding: "utf8", env: process.env },
        )
        assert.ok(!String(listed.stdout).includes("new.test.js"),
          "负控前提：未钉 excludesFile 时这份 global 档必须真的能藏掉未跟踪文件，否则上一条不构成证据")
      } finally {
        cleanup(bare)
      }
    } finally {
      fs.rmSync(hostile, { force: true })
    }
  })
})

// 上面两条负控打的是**假红**方向（本机垃圾冒充仓库缺陷）。同一个域缺陷还有第二种发作，
// 方向相反且更糟：`readWorkflowText` / `listJobBlocks` 用 `fs.readdirSync(.github/workflows)`
// 取"有哪些 workflow"，于是本机放一个被 .gitignore 吞掉的 yml 就能**伪造接线** ——
// CI 的检出态里根本没有那个文件，测试永远不会被执行，而棘轮报"已接线"。
// 假红只会天天被忽略，假绿是把这个门禁赖以成立的证据换成本机私产，所以单独锁两条。
test("被 .gitignore 吞掉的本机 workflow 不得充当「已接线」证据（假绿方向）", () => {
  const { root } = makeDomainFixture({
    tracked: ["scripts/orphan.test.js"],
    untracked: [],
    ignored: [],
    ignoreRules: [".github/workflows/local-*"],
    workflowBody: "run: echo nothing\n",
  })
  try {
    fs.writeFileSync(
      path.join(root, ".github", "workflows", "local-only.yml"),
      "run: node --test scripts/orphan.test.js\n",
      "utf8",
    )
    // 负控前提：这份伪造文件必须真的被 git 忽略（否则它会被下一次 add 带走，测的就不是本机私产）
    const st = cp.spawnSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8", env: process.env })
    assert.ok(!String(st.stdout).includes("local-only.yml"),
      "夹具失效：伪造的 workflow 未被忽略，本条测不到目标变量")
    const r = checker.collectCheck(root, {}, {})
    assert.ok(r.files.includes("scripts/orphan.test.js"), "该测试必须在检查域内")
    assert.deepEqual(r.violations.map((v) => v.file), ["scripts/orphan.test.js"],
      "只有本机可见的点名不算接线，必须仍判未接线：" + JSON.stringify(r.violations))
  } finally {
    cleanup(root)
  }
})

test("本机忽略的 workflow 不得为接线资格登记表充当「不被跳过的 job」", () => {
  const { root } = makeDomainFixture({
    tracked: ["scripts/mirror.test.js"],
    untracked: [],
    ignored: [],
    ignoreRules: [".github/workflows/local-*"],
    workflowBody: [
      "on:", "  push:", "    branches: [main]", "jobs:",
      "  gated:", "    if: needs.changes.outputs.docs-only != 'true'", "    steps:",
      "      - run: node --test scripts/mirror.test.js", "",
    ].join("\n"),
  })
  try {
    fs.writeFileSync(
      path.join(root, ".github", "workflows", "local-ungated.yml"),
      ["on:", "  push: {}", "jobs:", "  ungated:", "    steps:", "      - run: node --test scripts/mirror.test.js", ""].join("\n"),
      "utf8",
    )
    const registry = {
      "scripts/mirror.test.js": { reason: "输入命中 docs-only 白名单", resolveWhen: "移出白名单" },
    }
    const r = checker.collectCheck(root, {}, {}, registry)
    assert.deepEqual(r.ungatedViolations.map((v) => v.file), ["scripts/mirror.test.js"],
      "唯一那份「不被跳过的 job」来自本机忽略文件时，必须仍判违规：" + JSON.stringify(r.ungatedViolations))
  } finally {
    cleanup(root)
  }
})

test("取域失败必须出声而不是退回磁盘遍历（fail closed）", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "unwired-notrepo-"))
  try {
    fs.mkdirSync(path.join(plain, ".github", "workflows"), { recursive: true })
    fs.writeFileSync(path.join(plain, ".github", "workflows", "gate.yml"), "run: x\n", "utf8")
    assert.throws(
      () => checker.collectCheck(plain, {}, {}),
      /无法从 git 取得扫描域/,
      "非 git 工作树时不得静默降级成磁盘遍历 —— 那正是本次要消除的行为",
    )
    // ⛔ 这条断言的匹配串原先写成 /git|工作树|work tree/i，而它**恒真**：任何包含
    // `.github` 的文案都命中（实测变异 M3 把取域改成"失败返回空集"后，抛的是
    // 「…\unwired-notrepo-XXXX\.github\workflows 下没有 workflow 文件」，宽判据照样绿）。
    // 一条测"是哪个出口在出声"的锁，判据必须点名那个出口，否则它测的是"有没有抛错"。
  } finally {
    fs.rmSync(plain, { recursive: true, force: true })
  }
})
