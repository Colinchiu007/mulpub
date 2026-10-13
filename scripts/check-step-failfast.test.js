"use strict"

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const checker = require("./check-step-failfast.js")

function makeFixture(workflowBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "step-failfast-"))
  const dir = path.join(root, ".github", "workflows")
  fs.mkdirSync(dir, { recursive: true })
  if (workflowBody !== null) fs.writeFileSync(path.join(dir, "gate.yml"), workflowBody, "utf8")
  return root
}

const STEP_PWSH_MULTI = [
  "jobs:",
  "  t:",
  "    steps:",
  '      - name: "multi"',
  "        shell: pwsh",
  "        run: |",
  "          node --test a.test.js",
  "          node --test b.test.js",
  "",
].join("\n")

const STEP_BASH_MULTI = STEP_PWSH_MULTI.replace("shell: pwsh", "shell: bash")
// ⛔ 第 2 轮纠正（2026-10-13）：下面这份夹具原先被喂给一条"断言 violations 为空"的用例，
// 于是"只在最后一条命令后面写一条守卫"这个**吞红形状**被本棘轮认成合规。它就是 Gate 3 的真实形状：
// run 38339739342 / job 115107955784 / step "Gate 3 - Hardcoded secrets scan" 的日志里
// `# tests 115 / # pass 114 / # fail 1`（not ok 62 是 workflow-contract 的 Gate 9 断言），
// 而 step conclusion 是 success。现在这条夹具必须报违规，合规形态另立正向用例（不得为守而守地误报）。
const STEP_PWSH_LAST_GUARD = STEP_PWSH_MULTI + "          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n"

// 合规形态：每条受管命令各自紧跟一条自己的退出码检查（Gate 7 既有形状）。
const STEP_PWSH_EACH_GUARDED = [
  "jobs:",
  "  t:",
  "    steps:",
  '      - name: "each"',
  "        shell: pwsh",
  "        run: |",
  "          node --test a.test.js",
  "          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
  "          node --test b.test.js",
  "          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
  "",
].join("\n")

// 一条测试 + 一条门禁脚本：门禁脚本的非零退出同样应当让步骤失败，不纳入受管集合就连"多命令步骤"都不识别。
const STEP_TEST_PLUS_GATE = [
  "jobs:",
  "  t:",
  "    steps:",
  '      - name: "gate10-shape"',
  "        shell: pwsh",
  "        run: |",
  "          node --test .github/scripts/check-frontend-consistency.test.js",
  "          node .github/scripts/check-frontend-consistency.js",
  "",
].join("\n")

// job 级默认 shell（debt-guard.yml / electron-ci.yml 的真实形状）必须被认出来，否则整类误报。
// ⛔ 夹具必须把 defaults 与目标步骤拉开到 stepShell 的 12 行上溯窗口之外：
// 否则「步骤自己往上找 shell:」这条既有机制会恰好够到 job 级默认值，
// 使本夹具对"删掉 jobShellMap"这一变异免疫（第 1 轮变异 M4 实测就是这样打空的）。
function jobDefaultShellFixture (shellValue, padSteps) {
  const pad = []
  for (let n = 0; n < (padSteps || 0); n++) {
    pad.push('      - name: "pad' + n + '"')
    pad.push('        run: "Write-Host pad' + n + '"')
  }
  return [
    "jobs:",
    "  t:",
    "    defaults:",
    "      run:",
    "        shell: " + shellValue,
    "    steps:",
  ].concat(pad).concat([
    '      - name: "multi"',
    "        run: |",
    "          node --test a.test.js",
    "          node --test b.test.js",
    "",
  ]).join("\n")
}
const STEP_SINGLE = ["jobs:", "  t:", "    steps:", '      - name: "one"', "        shell: pwsh", "        run: |", "          node --test a.test.js", ""].join("\n")

test("pwsh 步骤里多条测试命令且不查退出码 → 必须报违规", () => {
  const root = makeFixture(STEP_PWSH_MULTI)
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 1, "夹具应恰好解析出 1 个多测试步骤")
    assert.deepEqual(r.violations.map(v => [v.code, v.key]), [["STEP_NOT_FAIL_FAST", "gate.yml::multi"]])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("shell: bash 视为 fail-fast（GitHub 默认 bash -e -o pipefail）", () => {
  const root = makeFixture(STEP_BASH_MULTI)
  try {
    assert.deepEqual(checker.collectCheck(root).violations, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("只在最后一条命令后面写一条守卫 → 前面每条都必须被点名（吞红形状，实测 Gate 3）", () => {
  const root = makeFixture(STEP_PWSH_LAST_GUARD)
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.violations.length, 1, "夹具应恰好报 1 条违规：" + JSON.stringify(r.violations))
    assert.equal(r.violations[0].code, "STEP_NOT_FAIL_FAST")
    assert.equal(r.violations[0].uncovered, 1, "应恰好有 1 条命令没被自己的守卫守住")
    assert.ok(r.violations[0].hint.includes("a.test.js"), "hint 必须点名未被守住的那条命令：" + r.violations[0].hint)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("合规形态不得被误报：每条受管命令各自紧跟一条退出码检查", () => {
  const root = makeFixture(STEP_PWSH_EACH_GUARDED)
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 1, "夹具应被识别为多命令步骤")
    assert.deepEqual(r.violations, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("门禁脚本（node 跑一个 .js，非 --test）计入受管集合：一条测试 + 一条门禁脚本也是多命令步骤", () => {
  const root = makeFixture(STEP_TEST_PLUS_GATE)
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 1, "旧判据只数测试文件，这里会是 0 —— 那就是 Gate 10 隐身的原因")
    assert.equal(r.violations.length, 1, JSON.stringify(r.violations))
    assert.equal(r.violations[0].uncovered, 2, "两条都没守卫：" + r.violations[0].hint)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("job 级 defaults: run: shell: bash 视为 fail-fast（debt-guard / electron-ci 的真实形状，不得误报）", () => {
  const root = makeFixture(jobDefaultShellFixture("bash", 8))
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 1, "仍应被识别为多命令步骤，只是判为合规")
    assert.deepEqual(r.violations, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("空值 shell:（gui-test.yml 形状）不得被当成 bash —— 读成 bash 就是方向相反的归因", () => {
  const root = makeFixture(jobDefaultShellFixture("", 8))
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 1)
    assert.equal(r.violations.length, 1, "空值 shell 必须回落到 windows-latest 默认 pwsh 并报违规：" + JSON.stringify(r.violations))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("node -e 内联块不计入受管命令（它是多行块体，且自身就是手工守卫）", () => {
  const root = makeFixture([
    "jobs:",
    "  t:",
    "    steps:",
    '      - name: "inline"',
    "        shell: pwsh",
    "        run: |",
    "          node scripts/migrate-postgres.js --dry-run",
    "          node -e \"",
    "            if (!hit) { process.exit(1) }",
    "          \"",
    "",
  ].join("\n"))
  try {
    assert.equal(checker.collectCheck(root).stepsScanned, 0, "只有 1 条真受管命令时不该被当成多命令步骤")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("同一行用 && 串起来的命令算已守住（GitHub bash -e 与 pwsh 的 && 语义都中止）", () => {
  const root = makeFixture([
    "jobs:",
    "  t:",
    "    steps:",
    '      - name: "and-chain"',
    "        shell: pwsh",
    "        run: |",
    "          node --test a.test.js && node --test b.test.js",
    "          node scripts/check-x.js && node scripts/check-y.js",
    "",
  ].join("\n"))
  try {
    assert.deepEqual(checker.collectCheck(root).violations, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("单条测试命令的步骤不受本门禁约束", () => {
  const root = makeFixture(STEP_SINGLE)
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 0)
    assert.deepEqual(r.violations, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("workflows 集合为空时抛错，不静默判绿", () => {
  const root = makeFixture(null)
  try {
    assert.throws(() => checker.collectCheck(root), /没有 workflow 文件/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("同行 || exit 算守住；|| echo / || true 是把失败吃掉，必须照报（否则装饰形状能过棘轮）", () => {
  const mk = (tail) => [
    "jobs:",
    "  t:",
    "    steps:",
    '      - name: "or-chain"',
    "        shell: pwsh",
    "        run: |",
    "          node scripts/check-x.js " + tail,
    "          node --test b.test.js",
    "",
  ].join("\n")
  const cases = [
    { tail: "|| exit 1", expectUncovered: 1, why: "|| exit 已守住第一条，第二条 node --test 仍裸奔" },
    { tail: "|| echo jiangxing", expectUncovered: 2, why: "|| echo 吞掉失败 ⇒ 两条都没守住" },
    { tail: "|| true", expectUncovered: 2, why: "|| true 恒成功 ⇒ 两条都没守住" },
  ]
  for (const c of cases) {
    const root = makeFixture(mk(c.tail))
    try {
      const r = checker.collectCheck(root)
      assert.equal(r.violations.length, 1, c.tail + " 应恰好 1 条违规：" + JSON.stringify(r.violations))
      assert.equal(r.violations[0].uncovered, c.expectUncovered, c.tail + " → " + c.why)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})


// CI 实测（2026-10-13，PR #3477）：我给 ubuntu-latest 的 Gate 4p-1 塞了 PowerShell 守卫 ⇒ runner 报
// `syntax error near unexpected token`。默认 shell 取决于 runner OS，所以作业必须有 runs-on 版夹具。
// 夹具刻意在 multi 步骤紧邻上方放一个带 shell: bash 的兄弟步骤：这样"ubuntu 那条判为合规"只能由
// runs-on 推导得出，绝不可能是从兄弟步骤泄漏来的 bash 帮它过的（两种错误机制就此分开）。
function runsOnFixture (runsOn, shellLine) {
  return [
    "jobs:",
    "  t:",
    "    runs-on: " + runsOn,
    "    steps:",
    '      - name: "sibling-with-shell"',
    "        shell: bash",
    '        run: "echo 兄弟步骤，本步骤不该继承它"',
    '      - name: "multi"',
    ...(shellLine ? [shellLine] : []),
    "        run: |",
    "          node --test a.test.js",
    "          node --test b.test.js",
    "",
  ].join("\n")
}

test("runs-on: ubuntu-latest 且未声明 shell ⇒ 默认是 bash，不得判违规", () => {
  const root = makeFixture(runsOnFixture("ubuntu-latest"))
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.stepsScanned, 1, "仍应被识别为多命令步骤")
    assert.deepEqual(r.violations, [], "bash 默认带 -e -o pipefail，本来就逐条中止")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("runs-on: windows-latest 且未声明 shell ⇒ 默认是 pwsh，必须逐条要求守卫", () => {
  const root = makeFixture(runsOnFixture("windows-latest"))
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.violations.length, 1, JSON.stringify(r.violations))
    assert.equal(r.violations[0].shell, "pwsh", "现场要报出推导出的默认档，不是 (默认)")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("推不出 OS（matrix 表达式 / 未知标签）时保守判需要守卫，不得猜成 bash", () => {
  for (const ro of ["${{ matrix.os }}", "self-hosted-large"]) {
    const root = makeFixture(runsOnFixture(ro))
    try {
      const r = checker.collectCheck(root)
      assert.equal(r.violations.length, 1, ro + " 必须保守报违规：" + JSON.stringify(r.violations))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test("显式 shell 压过 runs-on 的推导（步骤声明优先）", () => {
  const root = makeFixture(runsOnFixture("ubuntu-latest", "        shell: pwsh"))
  try {
    assert.equal(checker.collectCheck(root).violations.length, 1, "ubuntu 上显式 pwsh ⇒ 必须逐条守卫")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("兄弟步骤的 shell 不得泄漏进本步骤（上溯遇步骤边界即停）", () => {
  // windows 作业里紧邻兄弟写了 shell: bash，multi 自己没写 ⇒ 必须仍按 pwsh 判违规。
  // 读到 bash 就意味着归属跨了步骤边界 —— 那是"漏掉真吞红"的方向，比误报更危险。
  const root = makeFixture(runsOnFixture("windows-latest"))
  try {
    const r = checker.collectCheck(root)
    assert.equal(r.violations.length, 1, JSON.stringify(r.violations))
    assert.equal(r.violations[0].shell, "pwsh", "报出 bash 就是从兄弟步骤泄漏来的")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("真实仓库：ubuntu 作业里的多条命令不被误判（回归 #3477 的 CI 红）", () => {
  const r = checker.collectCheck(path.join(__dirname, ".."))
  const pg = r.violations.filter(v => /Gate 4p/.test(v.key))
  assert.deepEqual(pg.map(v => v.key), [], "business-api-postgres 是 ubuntu-latest，不该要 PowerShell 守卫")
})

test("真实仓库：已无未登记的非 fail-fast 多测试步骤", () => {
  const root = path.join(__dirname, "..")
  const r = checker.collectCheck(root)
  assert.ok(r.stepsScanned >= 24, `解析到的多命令步骤数异常：${r.stepsScanned}（受管集合含门禁脚本后应显著上升；解析退化会让本门禁假绿）`)
  assert.deepEqual(r.violations.map(v => v.key), [], "存在会吞失败的多命令步骤")
  assert.deepEqual(
    Object.keys(checker.KNOWN_NON_FAIL_FAST),
    [],
    "欠账清单应保持为空：任何非 fail-fast 的多测试步骤都必须改成 shell: bash，而不是登记豁免",
  )
})
