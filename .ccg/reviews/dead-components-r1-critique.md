{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "dead-components.test.js 第 5 条对 views/Dashboard.test.js 只断言 toContain('TrialBanner')（名字在场），没有像 style-guard 那一半那样验证「缺席断言」的形状（findComponent + 缺席期望）。而两个守卫文件在 scanForWiring 里被整体豁免出 needle 扫描域——若有人把 Dashboard.test.js 里的缺席断言改成正面断言、或在该文件里新增一个正向 findComponent 渲染检查（文件仍在豁免名单里，且 toContain('TrialBanner') 照样通过），整把锁保持全绿。这与文件头注释宣称的「验证豁免文件确实还在做缺席断言」「豁免不是洞」直接矛盾：对偶锁只实现了一半。",
      "suggestion": "把 Dashboard.test.js 的判据收紧成形状：断言它含 findComponent 且含 name: 'TrialBanner' 探针与缺席期望（.toBe(false) / .not.toBeTruthy() 之类），与 style-guard 半同款；或至少同时要求 indexOf('<TrialBanner') 与某个 .toBe(-1) 存在。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "code() 只按「行首注释符」剥行，两个方向都不可靠：(a) 漏报——一行同时含代码与注释时整行被剥，例如 /* 恢复 */ app.component('LoadingState', EmptyState) 这一整行会被 /^\\s*(\\/\\/|\\*|\\/\\*|<!--)/ 规则丢弃，真实的重新接线在锁下隐身；(b) 误报——多行块注释若正文行不以 * 开头（/*\\nTrialBanner 已删\\n*/），该正文行会被当成代码行命中 needle，违反 spec「注释不得被判红」的 Scenario。spec 宣称的「先剥行注释再匹配」在此实现下既不精确也不安全，两个方向都破坏了 Spec 自己承诺的判据。",
      "suggestion": "改用真正的注释剥离（逐字符扫描识别 //、/* */、<!-- --> 的完整区间，只保留区间外的代码再匹配），而不是行首正则；至少要保证「带前导注释的代码行」仍参与匹配。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "被删的 TrialBanner.vue 内注释明确写着「contrast-probe.js 以 .banner-text 为探针」，而本 diff 未改动 contrast-probe.js。删除后看板不再存在 .banner-text 元素：若该探针要求至少一个目标元素（或按元素逐条测对比度），视觉/对比度门禁会报错或空集假绿；proposal 的「用户可见变化：无」没有覆盖这条探针依赖。",
      "suggestion": "核实 scripts 下对比度探针对 .banner-text 的用法：若要求最小元素数则同步更新探针（换探针或放宽），若允许空集则在探针里显式登记 .banner-text 已随组件删除，并把结论写进执行记录。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "驱动头注释声明「还原放 finally 且自报不作数，跑完独立做 md5 回读比对（rc=4）」，但实现里 finally 直接 writeFileSync(before)/rmSync 之后没有任何 md5 回读校验，main() 也只返回 0/1/2，永不返回 4——头注释（从 1.5/1.6 驱动抄来的契约）与实现不符。另外 Node 收到 SIGINT/SIGTERM（Ctrl+C）时默认不执行 finally，变异中途被打断会把 worktree 留在被污染状态，恰好抵消记录宣称的「还原后 md5 复验」保障。",
      "suggestion": "按头注释实现还原后的独立 md5 回读比对并返回 rc=4；在 main 里注册 process.on('SIGINT'|'SIGTERM') 强制走还原（或在变异前后打印『正在变异 X，中断将留下脏树』到 stderr），避免静默污染共享 worktree。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "performance",
      "finding": "scanForWiring 每次调用都重新 walk(SRC) 全树扫描并逐文件 readFileSync+split+join：第 1、3、4 条用例各扫全树一次，第 4 条又额外读 main.js。驱动每趟 vitest 运行触发 3 次全树 walk，C1–C5 加基线共 6 趟 ⇒ 单次驱动运行约 18 次全树扫描。任务 #23 计划把这些驱动接进 CI 后，这属于可避免的重复 IO。",
      "suggestion": "在 describe 外做一次惰性的全树索引（文件清单 + 剥离后文本缓存），三条用例共享同一份扫描结果；或把多个 needle 合并进一次 walk。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "两处脆弱硬编码：scanned > 100 是绝对值下界，与真实文件数无关联，代码结构变动（目录迁移、组件扁平化）后要么太松让锁失守要么误红；SELF = 'components/dead-components.test.js' 是硬编码相对路径，锁文件一旦被移动/改名，豁免立即失效——文件自己的 it() 描述（如「代码里不得再出现 TrialBanner …」）含被禁名字，会把自己判红且极难排查。",
      "suggestion": "SELF 用 path.relative(SRC, HERE) 从 import.meta.url 推导；scanned 下界改为相对判据（例如与 walk 实际见到的文件数比对），或给 100 加一句显式依据注释。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "驱动里 DASH_VUE 声明后从未使用；const failed = [...out.matchAll(...)] 只被用作 failed.length 的布尔判据；C2 的 label 写「某个真实模板重新使用 <LoadingState />」而变异实际是给 main.js 重新注册（label 与动作不符）；spawnSync('pnpm.cmd', …, {shell:true}) 写死 Windows 形态，任务 #23 要把这类驱动接进 CI 时，非 Windows runner 上会直接失败。",
      "suggestion": "删掉 DASH_VUE、把 failed 改成长度判断或删除；修正 C2 label；进程调用按 process.platform 选择 pnpm/pnpm.cmd，或直接 spawn vitest 的 JS 入口，保证跨平台可复跑。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "correctness",
      "finding": ".gitignore 的 !scripts/dead-components-contract-mutate.js 只有在忽略规则确实形如 scripts/*.js、且没有更晚的规则再忽略它时才生效；若实际规则是忽略 scripts/ 整个目录，git 的「目录被忽略则不能反包含子文件」规则会让这行失效，驱动仍被静默排除在 git 之外——正是该行注释自己警告的失败模式，而 diff 本身无法自证规则形态。",
      "suggestion": "合入前跑 git check-ignore -v scripts/dead-components-contract-mutate.js 确认命中规则是 *.js 档且反包含生效；把这条检查并入 V5 静态门禁，防止后续有人改动 scripts/ 规则时静默复活该坑。"
    },
    {
      "id": "i9",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "日期与对账字段多处漂移：PRD 与执行记录标 2026-10-21，而 .openspec.yaml 的 created 为 2026-10-22；record frontmatter 写 sync_pr: pending，正文又称合并后由 merge-ledger 按主干历史推导、不另开回填 PR。这些不一致会让后续 merge-ledger / 回填脚本产生歧义。",
      "suggestion": "统一日期口径（以变更落盘日为准）；若 sync 确由 ledger 推导，sync_pr 直接写 derived-from-trunk 或移除 pending 字段，避免状态词互相打架。"
    },
    {
      "id": "i10",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "被删组件注释引用了 tokens.css:365 的 html[data-theme='dark'] .banner-btn 暗色覆盖规则；删除后该规则成为死 CSS（.banner-btn 不再存在于任何渲染树），本 diff 未清理，与锁的『只减不增』口径不彻底。",
      "suggestion": "随本批删除该 token 规则，或在 CHANGELOG / 遗留清单里显式登记为「已知死规则，待 5.x 清理」，不要留一条无人认领的暗色覆盖。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 9,
    "performance": 8,
    "maintainability": 6
  }
}