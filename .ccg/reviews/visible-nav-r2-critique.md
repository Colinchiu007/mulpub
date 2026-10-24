{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "生产环境两个调用点（App.vue、MpSidebar.vue）都没有传 warn，组合式使用默认值 `warn = (msg, err) => console.warn(msg, err)`。而 `ensureVisibleTab` 的「找不到 home 标签」分支只传一个实参：`warn('[nav] no home tab; target route pushed behind the active tab overlay')`。默认实现会执行 `console.warn(msg, undefined)`，生产控制台打印出一条带尾随 `undefined` 的告警。该缺陷在测试中零覆盖：useVisibleNavigation.test.js 的 setup 恒注入 `warn: vi.fn()`，App 测试的 seed 恒含 HOME_TAB、从不触发该分支，因此默认 warn 的求值形态从未被任何用例执行过。可逐行验证：composable 默认参数（useVisibleNavigation.js 第 34-36 行）、单实参调用（第 60 行）、两个生产调用点均未传 warn。",
      "suggestion": "默认值改为 `warn = (...args) => console.warn(...args)`（或 `(msg, ...rest) => console.warn(msg, ...rest)`），并补一条「不传 warn 时该分支只打印一条、无尾随 undefined」的用例，让默认 warn 的形态也被测试钉住。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "navigateVisibly 没有串行化。同一组合式实例下，两次快速快捷键（或快捷键与侧边栏点击并发）会并发执行两段 async 流程：两次都基于同一份 tabStore.activeTabId 做 B 段判定，都可能判定「需要切回首页」，从而发出两次 switchToTab，两次 push 也可能以与输入顺序不同的顺序完成。V6 只覆盖「卸载后不得再触发」，没有任何用例覆盖「前一次在途未完成时又进来一次」。顺序账本只证明单次调用内部 `switch` 先于 `push`，不证明跨调用的最终可见态等于最后一次输入。",
      "suggestion": "在组合式内加 in-flight 串行化（同一实例的调用排队），并加一条用例：第一次 navigateVisibly 未 resolve 时触发第二次，断言最终只发生一次切标签、且最终推的是后一个目标（或明确记录当前行为并锁住）。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "M7 的注入体构念效度被污染：变异后 `navigateVisibly` 对非定向路径会 push 两次——注入体里加的那次 `await router.push(to).catch(...)` 是新增的，原有 C 段的 `try { await router.push(to) }` 仍原样保留。于是 App 层顺序账本 `expect(order).toEqual(['switch:home','push'])` 红的原因是「数组多了一个 push」，而不纯是「顺序反转」。该变异实际证明的是「多一次 push 也会红」与「反转也会红」的混合体，CAUGHT 不能干净地读成「顺序不可反」这条锁有牙。可验证：M7 的 from 只覆盖两行，to 保留了原有 C 段。",
      "suggestion": "让 M7 的 from 扩大为覆盖整个 navigateVisibly 主体（含 C 段），注入体替换成恰好一次 push 且顺序为 push→switch 的完整函数体（`await router.push(to).catch(...); await ensureVisibleTab()`），使变异后 push 恰好一次，红集只由顺序引起。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "文档计数集体漂移，与提交内实际产物对不上：tasks.md 3.1 写「useVisibleNavigation.test.js 19 条」（实际文件含 it.each 5 行共 25 条）、3.2 写「App.visible-navigation.test.js 9 条」（实际 10 条，TDD 记录里的 6 failed|3 passed 也只对应 9 条、不含后加的 4 条结构锁）、4.1/4.2 写「10 条变异 / CAUGHT=10」（驱动实际 MUTATIONS 是 M1–M14 共 14 条）；record frontmatter 写「28 条契约锁与 10 条变异反证」——28 对不上任何可推导数（25+10=35，加侧边栏 4=39），且与同文件门禁表里正确的「反证（14 条）」「39 passed（25+10+4）」自相矛盾。这些文件本身宣称是防「下一会话重抄」的机制，数字对不上会让下个会话按 10/19/9 核对而误判。",
      "suggestion": "把 tasks.md 与 record frontmatter 的计数统一改到实际值（14 条变异、组合式 25、App 10、总数 39），并在 tasks.md 注明「i5/i6 处置后从 10 条变异扩到 14」的沿革，避免后续把 14 改回 10。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "PRD §3.3 声称诊断痕迹「三条」且「措辞沿用改造前 MpSidebar 的同款前缀 [sidebar]」，并断言「唯一的可观测变化是行为本身」；但实现实际新增了两条 `[nav]` 前缀告警（`[nav] ignored navigate request`、`[nav] no home tab`），且鼠标路径（MpSidebar.onNavClick）在非法/空入参时从原来的「静默 return」变成「打一条生产控制台告警」——这既是 §3.3 声称之外的新的可观测变化，也让「三条 [sidebar]」清单实际变成五条、两个前缀，历史日志按 `[sidebar]` 前缀检索会漏掉新路径。",
      "suggestion": "§3.3 改为枚举全部五条痕迹并注明前缀分工（[sidebar] 三条 + [nav] 两条）；或把两条新告警统一到 [sidebar] 前缀保持检索连续；并明说鼠标路径非法入参从静默改为出声是评审 i1 处置的刻意延伸。"
    },
    {
      "id": "i6",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "App.visible-navigation.test.js 与 useVisibleNavigation.test.js 的结构锁/集合锁都用 `path.resolve(process.cwd(), 'src'|'electron')` 定位被扫描文件。锁的正确性依赖 vitest 恰好从 apps/desktop 目录启动：一旦从仓库根以 workspace 模式运行、或 CI 改变工作目录，fs.readFileSync/readdirSync 直接 ENOENT，三条结构锁 + 三条集合锁 + 调用点集合锁一次性全红（扫描域规模断言 `scanned>20/50` 也因目录不存在而抛错）。变异驱动把 spawnSync 的 cwd 钉在 DESKTOP 掩盖了这个问题，但测试文件自身没有自定位，锁的可用域比它声明的小。",
      "suggestion": "把两个测试文件里的 ROOT/SRC/ELECTRON 改为从测试文件自身推导：`path.resolve(__dirname, '..')`（或 import.meta.dirname）作为 apps/desktop 根，再拼 src / electron，消除对进程 cwd 的依赖。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "非法入参分支把 `''`（typeof 为 string）与 null/undefined/42/{} 混在同一条告警里：文案是「target is not a route string」，但载荷是 `{ type: 'string' }`，两条信息自相矛盾——排障者看到空串被拒时拿到「不是路由字符串」却「类型是 string」。空串与非字符串本属两个被拒原因，当前日志无法区分。",
      "suggestion": "拆两类文案：非字符串打「target is not a route string」；空串单独打「target is an empty route string」，并在「非法输入不动作，但必须出声」用例里分别断言两条文案，避免文案退化。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "变异驱动的每条 expect 探针都以「用例标题子串」为坐标，但 M2/M4/M5/M9 声明的探针（『聚焦 home-shell 标签：点击菜单经 IPC 定向导航』『先切回首页标签再导航，使变化可见』『回退为切回首页 + 主窗口导航』『主窗口 router.push 不被调用』）指向 MpSidebar.sidebar-focus-nav.test.js 中本 diff 未展示的用例标题——该文件的 diff 只含三处 flushPromises 追加，标题文本不在评审可见范围内，因此现场读数「[DEAD-PROBE] 全部探针可命中（标题域 39 条）」无法从 diff 独立复核；且标题与探针是纯子串耦合，未来任何用例重命名都会把整条变异静默变成 rc=2 的 DEAD-PROBE。",
      "suggestion": "在 PRD §6 或驱动注释里为这些探针标注到具体用例标题全文（尤其 M9 的『主窗口 router.push 不被调用』），使 dead-probe 判定可复核；或把标题声明成驱动内常量并在文件里做「标题存在性自检」，重命名即红而非 DEAD-PROBE。"
    }
  ],
  "dimensionScores": {
    "correctness": 7,
    "security": 9,
    "performance": 9,
    "maintainability": 6
  }
}