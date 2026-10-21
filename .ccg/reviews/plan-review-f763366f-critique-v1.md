{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "本变更把 `.login-state-actions button` 从裸 `#5048e5` 收编成 `var(--color-primary)`，而暗色档 `--color-primary` 被 tokens.css:338 提亮为 `#8b85ff`（本变更集自己的评审文件与测试夹具都标注此值）。该按钮是 `.login-state` 固定横幅（`background: #f3f2ff`，surfaces 清单第 9 条登记为未修的裸底、无暗色覆盖——`.login-state`/`.login-state span` 两条豁免的 light/dark surface 与 ratio 完全相同可证）的子元素。真实暗色比值为 contrast(#8b85ff, #f3f2ff) ≈ 2.75:1 < 4.5（连非文本 3:1 都不过），而 `surfaceCandidates` 按选择器前缀只走到无 background 的 `.login-state-actions`，回落到页面 inset `#1e1e23`，模型算出 5.47:1 放行。即收编前裸值在真容器上 5.57:1 合规，收编后暗色实测 2.75:1——这是本变更亲手制造的一处暗色 AA 回归，且判据宣称两档都过，正是本批自述要消灭的『判据说合规、用户看不见』形态。",
      "suggestion": "收编坐落于固定浅底容器内的文字前，先把 `.login-state` 的底色一并 token 化（或保留该按钮裸值并登记 needs-design，真值 2.75）；机制侧不要只做『选择器前缀』祖先匹配——凡是页面回落后台被使用且站点组件存在已登记 bare 底色包裹它的，必须把该底色纳入候选或标记 unresolved 判不通过，禁止用 page-bg 回落把已知容器吞掉。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "`.group-search-box .search-icon` 与该框内 `.clear-search` 收编为 `var(--color-text-secondary)`（暗色 `#b4b2c6`），真实坐落在 `.group-search-box input` 的裸 `background: #fafbfe` 上（surfaces 第 17 条，暗色不随主题）。因 input 不是这两个图标的选择器前缀，模型按页面 inset 算出 dark ≈ 8.02:1；真实渲染 contrast(#b4b2c6, #fafbfe) ≈ 1.98:1，低于非文本 UI 的 3:1 与正文 4.5:1。收编前裸 `#92939c` 在 `#fafbfe` 上约 2.9:1 本就不过（浅色档），本批换令牌并『认证两档合规』是在已知欠账之上新增一层假绿；同根因下 `.group-search-box input` 自身没有 color 声明，其继承色（暗色 `--text-primary`≈`#f5f5f7` 时在该浅底上约 1.7:1）完全在判据视野之外。",
      "suggestion": "siteFails 在 page-bg 回落后台时不得直接认证：若站点所在组件内存在已登记 bare 底色并且该选择器包裹该元素（如 input 内的图标），应把该底色并入候选或不通过处理；同时为『暗色固定浅底内部文字』补一条需要登记的通道，把 input 继承文字也纳入现场。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "`loadThemeOverrides` 对目标选择器做 `replace(/\\s*:\\s*/g, ': ')`，把任一伪类键 `.page-button:focus-visible`、`button:hover` 归一成 `.page-button: focus-visible`（CSS 里是非法选择器）；而 SFC 侧 `parseRules` 只压空白不压冒号。于是 tokens.css 里任何 `html[data-theme='dark'] .x:hover / .x:focus-visible / .x:active` 覆盖层与 SFC 选择器永远无法命中、整层静默不生效——与本批『主题覆盖层要按选择器读、不得双向出错』的合同正面冲突；现有哨兵只钉了无伪类的 `.account-view-toggle` 一个选择器，识别不出这一类漏读。",
      "suggestion": "删掉 `\\s*:\\s* → ': '` 变换（或覆盖侧与规则侧用同一个归一函数），并补一条哨兵断言至少一个伪类目标（如 `:focus-visible`/`:hover`）的暗色覆盖被实际合并进某站点声明。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "PRD/判据合同写『界面文字 color 必须来自在暗色根块里也有声明的令牌』，但 `loadThemes` 返回 `dark = new Map([...light, ...dark])`（color-token-reader.js:71），暗色档先天包含全部浅色槽，『该槽是否在暗色根块显式声明』在数据结构上不可区分；叠加 `resolveColor` 对 `var(--x, #hex)` 在 `--x` 缺失时静默取回退值，一个拼错/失效的令牌名只要回退 hex 恰好两档都过 AA 就会被判『已收编、双档合格』。现存 `.accounts-page { color: var(--text-primary, #28282f) }`（Accounts.vue:1287）用的正是合同白名单（--color-text-*/--color-primary）之外的旧别名，其合格完全靠回退值参与判定。",
      "suggestion": "在 `collectSites` 里对每个站点断言其 color 声明第一个 var() 的名字落在合同允许槽集中，且解析链末端不得落在回退分支（绑定回退 ⇒ 登记 unresolved/needs-design 而非通过）；不能只靠两条字符串层测试。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "Accounts.text-contrast.test.js 里自称『选择器数量下界的独立实现』的 `rulesLen()` 与 `textSites` 都调用同一个 `scanStyleRules` 导出，且前者数全部规则、后者只数带 color 的，`rulesLen() >= textSites.length` 恒成立，是重言式而非独立防线；真正兜底的只有字面常量 `>35` 与 style 块数 `===2`。",
      "suggestion": "不再宣称『独立实现』；若真要独立，用不 import 本模块的朴素正则（如 `/[^{}]*\\{[^{}]*\\}/g`）数一遍规则再做下界断言，或删除该断言只留块数钉与 `>35` 常量。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "『未修的那一类也要留现场』这条判据在测试里内联重写了一份裸 hex 底色/边框扫描（自己的正则与遍历），与生成基线消费的 `text-contrast-sites` 形成同批自己斥责的第二份实现；且 surfaces 数组只被断言『数量相等』，每条的 `value` 从不被重算核对——exemptions 的 need/ratio/surface 有逐字段核对，surfaces 没有，生成侧若改了底色值而数量不变，所有字段漂移都无法被发现。",
      "suggestion": "把 surfaces 扫描收进 `text-contrast-sites.js` 导出，测试消费同一函数并逐项断言 `surfaces[i].value`（及 prop/selector）与现场相等。"
    },
    {
      "id": "i7",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "『底色候选集必须分主题解析』这条一面写注释主张『不是钉住某一条选择器……那是脆而不是严』，一面又把 `.account-view-toggle button` 的暗色 surface 硬钉成 `#1e1e23`、浅色钉成 `#f8f9fc`；下一批按既定计划把 `.account-view-toggle` 的底色（surfaces 第 27/28 条）换成令牌后，这里会假红，而其注释给出的理由恰恰声称这种合法变化不得判失败。",
      "suggestion": "去掉两个 toBe 钉值，改为断言该站点暗色与浅色 surface 不相同（与 `differ > 4` 同构），或把预期值从当前 token 值动态读出而不是写死字面量。"
    },
    {
      "id": "i8",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "`loadThemes`（读 tokens.css 真源）用的是扁平 `matchAll(/([^{}]+)\\{([^{}]*)\\}/g)`，而 SFC 扫描的 `parseRules` 已是递归下降——同一批代码里存在两代扫描器。tokens.css 的根块一旦被包进 `@media`/`@supports` 或出现嵌套，扁平正则会把根块截断、浅色槽被整块吞掉（暗色继承让下游表现为『解析不出』之外的静默）；目前仅靠『暗色根块被读到』哨兵里几个槽位恰好在块首才兜得住。",
      "suggestion": "`loadThemes` 改走 `parseRules`（或共用一个块迭代器），并给根块读取补一条『槽位总数==已知量』的哨兵，使任何根块截断直接变红而非静默。"
    },
    {
      "id": "i9",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "入库的 `.ccg/reviews/*.md` 与决策 JSON 是对更早暂存快照（changedLines 879/fileCount 5，`.batch-status` 那时已换 `var(--color-primary)`）的评审证据，而本 head 最终态是 2017 行、`.batch-status` 保留裸 `#5048e5`；逻辑轴 Critical（Accounts.vue:1355 `.batch-status` 换令牌后 3.04:1）与可维护性轴对同行的描述在最终代码里已不成立。评审原件随 head 提交，但行号与形态描述对不上终态，未来的核对者逐条验证会得到混叠结论。",
      "suggestion": "在各评审文件头注明『评审对象为早于终态的暂存快照』，或在终态收敛后重跑一次评审再入库，避免以旧评审的证据认证新代码。"
    }
  ],
  "dimensionScores": {
    "correctness": 5,
    "security": 9,
    "performance": 9,
    "maintainability": 5
  }
}