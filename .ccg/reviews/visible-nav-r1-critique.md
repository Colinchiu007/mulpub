{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "新入参门 `typeof to !== 'string' || !to` 会把非字符串的路由描述符（vue-router 完全合法的 `{ path, query }` / `{ name }` 对象，改造前 `router.push(route)` 可以直接消费）静默丢弃、不动作、不记任何日志。PRD §3.2 把它列成「数据校验契约」，但一个未来的新发送方只要传对象，就正好复现本单元要消灭的『按了没反应、日志零痕迹』——在组合式边界重新制造了同一个缺陷形态。",
      "suggestion": "要么接受 vue-router 的 location 对象并把类型校验推迟到 `router.push`（维持旧契约），要么在拒绝非字符串时 `warn('[sidebar] navigate ignored: invalid payload', to)` 留下痕迹，并加一条『非字符串 payload 必须出声』的用例，与 §3.2 表格口径对齐。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "验收表 V9 把一次『2 failed / 6417 passed』的本地全量跑记为 ✅，归因依据是『读了非受管构建产物、本 worktree 未跑打包』；但执行记录 §二 自己的措辞是『不认领、也不放行』——两处口径自相矛盾。更关键的是：反证驱动的基线门（rc=0、failed=0、errors=0）只覆盖它跑的 3 个测试文件，而 M1/M2 变异改的是 App.vue / MpSidebar.vue，其爆炸半径覆盖所有挂载 App 或使用侧边栏的其它测试（overlay-view-suspension / shell-mode-6b 等 402 个文件都不在驱动视野内）。『CAUGHT=10』只能证明 10 条锁在这 3 个文件内有牙，不能支撑『全量无回归』的结论；若某条变异只打红驱动未收录的文件，会被还原动作静默掩盖。",
      "suggestion": "① 把 V9 改写成实报口径（『405-2 个文件通过，2 条因缺构建产物未执行，CI 由 electron-ci 先打包再全量红/绿判定』），删除 ✅；② 在驱动入口打印并断言其覆盖文件集合，并至少在文档中声明『驱动不覆盖全仓消费者并集』这一边界。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "反证驱动的 `parseVitest` 只取 FAIL/× 行的**最后一个 `>` 段**做子串匹配，且 `expect` 里存在永远匹配不到任何现存用例标题的**死探针**：M1 期望的『调用同一个组合式』（实际标题是『共享实现只有一份：…都 import 同一个组合式』）与 M5 期望的『回退为切回首页 + 主窗口导航』都不在任何标题里。加上判定规则是『≥1 条命中即 CAUGHT』、非预期红只计数不否决，一个只打红非预期用例（或漏红大部分预期用例）的变异仍会自报 CAUGHT——『CAUGHT=10 其余=0』夸大了锁的保护面。",
      "suggestion": "判定改为集合包含关系：`expect ⊆ failed` 且 `unexpected.length === 0` 才算 CAUGHT，否则 WRONG_RED（打印命中的/缺失的/非预期的三分清单）；并在加载时对每条 `expect` 探针做一次『必须能匹配某条已知用例标题或注释声明』的静态校验，死探针直接报错。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "『找不到 home 标签』的回落分支（`if (!homeTab …) return` 后静默执行 `router.push(to)`）会**在普通网页标签覆盖层背后完成跳转**——这正是本单元要消灭的缺陷形态本身，而这条路径上没有任何 `warn`。如果 home 虚拟标签可被关闭（或数据异常导致列表里没有 isHome 标签），按快捷键就是旧缺陷的 1:1 复现且无日志。另外『可见性』证据链也弱于宣称：顺序账本证明的是 switchToTab/push 的**方法调用顺序**，而 `switchToTab` 的 await 拿到的是 IPC 回执，不等于原生 WebContentsView 已真正换面渲染；PRD §7.3 也承认无真机验证，但验收表 V1 直接写 ✅。",
      "suggestion": "① 在 `navigateVisibly` 的『未切换任何可见面就 push』路径上补一条 `warn('[sidebar] navigate on invisible surface', to)`（无 home 标签、切标签失败两种情况都出声）；② 验收表把 V1 的判据从『可见』降级为『顺序账本断言』并明确注明 IPC ack ≠ 渲染完成。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "App.vue 的 `api.onNavigate` 改为统一走 `navigateVisibly` 后，**所有** `app:navigate` 事件（不只用户快捷键）都会新增两段前置行为：聚焦 home-shell 标签时被 IPC 定向到该实例、聚焦网页标签时强制切回首页标签。PRD 只举证了 hotkeys.js:58 一个发送方；若仓库里还存在第二个发送 `app:navigate` 的进程内调用（比如引导、license 过期跳转、托盘菜单），其本意是『主窗口路由跳转』，也会被一并重定向/强制切标签，造成与负向订阅相同的双向漂移。",
      "suggestion": "在合并前用 `git grep -n \"app:navigate\"`（含主进程与 preload）确认发送方清单，把结论写进 PRD §1.2；若发送方多于一个，建议改为专用通道（如 `app:navigate:visible`）或给 payload 带 source 字段，避免通道语义被悄悄扩大。"
    },
    {
      "id": "i6",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "『不得有第二份判断』比宣称的弱：① App.vue 的结构锁只匹配字面形态 `onNavigate(<param> => {…?} router.push(`，回调用中间变量存 route、或包一层 helper 再 push 即可绕过且保留缺陷；②『单一实现』锁只扫 App.vue / MpSidebar.vue 两个文件+一个组合式，任何第三个入口（命令面板 / 托盘，PRD §7 自己承认）只要**复制三段判断但不调用 `useVisibleNavigation(`**，就能穿过全部 3 条结构锁 + 调用点集合锁（集合锁只对『新调用了组合式的文件』红）。",
      "suggestion": "把负向判据从文件级提升为仓级：在测试里递归扫描 `src`（排除组合式本体与测试文件），断言 `navigateActiveHomeShell` 与 `switchToTab(home…)/switchToTab('home')` 字面只允许出现在 `useVisibleNavigation.js` 内——这样任何新入口自带一份判断都会当场红，而不是等它恰好调用组合式才红。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "根因叙述『同一段判断被抄了两遍，其中一遍没抄全』与其自身证据矛盾：`git grep navigateActiveHomeShell` 只命中 MpSidebar 一个文件，说明键盘路径里**从来没有任何一份**三段判断（是『第零份』，不是『第二份没抄全』），裸 `router.push` 是错误引入方式的另一种形态。叙述偏差会误导后续会话的安全感——修复与锁只针对『已存在两份时的收敛』，真正的前瞻风险是未来新入口的『零副本』，而现有 M2/M6 只探侧边栏，没有一条探『新入口直接裸 push』的形态。",
      "suggestion": "把 PRD/design 里的根因描述改为『同一判断只实现了一份，另一条入口没有实现它』；并在驱动里加一条对『禁止出现新的裸 onNavigate→router.push 形态』的仓级探针（或至少在遗留节写明此类入口无锁覆盖）。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "入参门 `!to` 只挡空串：纯空白字符串（如 '  '）类型是 string 且真值，会原样穿过三段并 `router.push('  ')`，被 vue-router 以无匹配路由拒绝后落进 `[sidebar] navigate failed` 告警——产生无意义日志，且与『'/' 合法』的边界用例同表却没有对应用例。",
      "suggestion": "在入参门加 `to.trim() === ''` 的判空（或 `^/` 前缀校验），并补一条空白串不动作的用例；若担心 `'/'` 这类目标，明确把『必须以 / 开头的路径』写进校验而非注释。"
    }
  ],
  "dimensionScores": {
    "correctness": 6,
    "security": 8,
    "performance": 9,
    "maintainability": 6
  }
}