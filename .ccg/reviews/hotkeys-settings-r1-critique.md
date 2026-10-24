{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "组件测试平台相关且不可注入：`HotkeysSettings.test.js` 里 5+ 条断言硬编码非 mac 期望（`'Ctrl + Alt + P'`、`'Ctrl + ,'`），而 `HotkeysSettings.vue` 的 `detectMac()` 在挂载时读 `navigator.platform` 实时判定。在 macOS 上挂载同一实例会产出 `⌘ ⌥ P`，这些断言全部变红；且变异驱动 `runTests` 的基线检查要求 `[BASELINE] rc=0 failed=0`，在 mac 环境下整条反证管线直接以「基线不干净」退出（exit 2），12 道变异全部无法归因 —— 反证证据只对 Windows 单 OS 成立，而本批却为 mac 显式实现了展示逻辑（MAC_TOKENS/MAC_ORDER 与 `isMac` 分支）。另外 `navigator.platform` 本身是 deprecated API。",
      "suggestion": "把 `isMac` 做成可注入：新增 prop（如 `platformIsMac`，默认 `detectMac()`）或抽成 composable，测试里显式传 `{isMac:false}` 与 `{isMac:true}` 各跑一遍，并补一条组件级 mac 用例断言 `⌘ ⌥ P`；或至少在测试里 `vi.stubGlobal('navigator', {platform:'Win32', userAgent:''})` 固定平台再挂载。`detectMac` 改读 `navigator.userAgentData?.platform ?? navigator.platform`。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "跨包对齐的「源解析 + missing 检查」在 `hotkey-labels.test.js` 与 `HotkeysSettings.test.js` 里各抄了一份，且两份已经发散：`HotkeysSettings.test.js` 那份既没有 `expect(end >= 0)` 终点锚存在断言（正是本批 N3 记录里被实测 MISSED 过的「负数终点被 slice 静默放大区间」失效形态，N3 变异只打 `hotkey-labels.test.js`，这一份永远不被变异覆盖到），也没有 extra 方向（孤儿项）检查。这与本批反复声称的「单一实现」「读对方源码而非复制常量」口径直接冲突 —— 两处解析逻辑一旦漂移，对齐锁的保护面就只由其中一份决定，另一份变成装饰。",
      "suggestion": "把 `readMainShortcuts()`（含起点/终点锚的 >=0 断言、规模下界、成员断言、双向检查）提取为共享实现（放 `hotkey-labels.js` 导出，或单独 test 工具模块），两个测试文件引用同一份，N3 变异也改打共享实现；最小收敛动作是给 `HotkeysSettings.test.js` 那份补上终点锚断言与 extra 检查。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "这份变更自己的落底记录与其代码自相矛盾：执行记录写「组件不 import `@/api/electron-bridge`（沿用 1.5 的教训：mock 桥接层的夹具会在访问期抛 'No export is defined'），宿主对象一律经 `window.electronAPI` 惰性取」，但 `HotkeysSettings.vue` 实际是 `import { getApi } from '@/api/electron-bridge'` 并在 `onMounted` 里调 `getApi()`。若 1.5 教训仍然成立，这个模块级 import 正是记录声称规避的风险；若 `getApi()` 是惰性读 `window.electronAPI`，则记录说法与代码不符 —— 而本批的核心叙事恰恰是「说明书落后于实现的文档漂移」类缺陷（hotkeys.js 文件头），这里自身又制造了一处。",
      "suggestion": "二选一并对齐：若 `getApi()` 惰性读 `window.electronAPI`，按记录删掉 import、`onMounted` 直接读 `window.electronAPI`；否则把记录改写成真实代码形态。并补一条结构锁（如 `HotkeysSettings.vue` 源码不含 `@/api/electron-bridge` 导入）或一条用例，证明挂载期不触碰任何 mock 桥接层导出。"
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "locales 成对判据（「每个展示键在 zh 与 en 里都成对存在」）实现过弱：`src.slice(src.indexOf('hotkeys:'))` 取「第一个 hotkeys: 之后的整个文件」，然后 `expect(block).toContain(''+leaf+':')` 只验证该叶子串出现在区块里任意位置——不要求在 `action:` 子块内、不要求值是非空字符串（`home: ''` 会通过而 UI 渲染出空动作单元格）、且若值文本偶然包含 `'Press Ctrl+Home: …'` 这类串也会误通过。这使「三方逐项对齐」的声明含金量低于字面。",
      "suggestion": "改为对 `action:` 子块逐叶子做非空引号字符串断言，如 `new RegExp('^\\\\s*' + leaf + ':\\\\s*\\'' + '[^\\'']+' + '\\'', 'm')`；或直接 import `settings/zh.js` 与 `settings/en.js` 两个模块，`Object.keys(action)` 与 `HOTKEY_ACTION_KEYS` 的值逐一相互比对且值非空。"
    },
    {
      "id": "i5",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "跨包对齐锁没有「唯一性」断言。若主进程 SHORTCUTS 表未来出现同一 accelerator 注册两条（不同 route），regex 解析出重复项（`['…P','…P',…]`），两份锁的 `hasOwnProperty` 检查全部通过（因为该 accelerator 在映射里），而 `normalizeHotkeyList` 的 `seen` 去重只保留首条——面板对其中一条动作静默失明，锁零红，且没有任何测试覆盖「主进程真实重复 + 锁不拦」这条路径（现有去重用例只喂了测试自造的报文）。",
      "suggestion": "在对齐锁（或 i2 建议的共享解析实现）里加 `expect(new Set(list).size).toBe(list.length)`；同时可考虑把 `normalizeHotkeyList` 的去重单元一个测试声明为「冗余注册属于主进程错误，显示面丢弃是降级，锁必须在此刻先红」。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "`.gitignore` 的 `!scripts/hotkey-labels-contract-mutate.js` 反选规则脆弱：反选只在该排它规则位于**同一文件**且在该行之前时才生效；若 `scripts/*.js` 的忽略来自嵌套 .gitignore 或排除了父目录，git 不允许反包括被排除目录下的文件，这条 `!` 就是死规则或无效规则。同时与本仓 1.5 驱动 `visible-navigation-contract-mutate.js` 的先例关系不明（它是否同样被反选/被跟踪），本批文档多次把两者判据并提。",
      "suggestion": "提交前用 `git check-ignore -v scripts/hotkey-labels-contract-mutate.js` 验证文件确实被跟踪、规则来源正确，并把被反选的规则位置写进注释；更稳的做法是把驱动放进明确整体跟踪的目录（如 `scripts/hotkeys/`）或为 `scripts/*.js` 白名单整体收紧，避免逐文件豁免。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "变异驱动的 CAUGHT 判定是 needle 级而不是标题级：`matched = expect.filter(needle => run.failed.some(n => n.includes(needle)))`——只要红集里存在一条含该 needle 即计为命中，而同一 needle 可以命中两个用例标题（例如 `绝不进展示面` 同时出现在 `hotkey-labels.test.js` 的逻辑层用例和 `HotkeysSettings.test.js` 的组件层用例标题里，`[PROBE-MAP]` 也显示 `[2 条]`）。于是「预期两条都红，实际只红一条」会被读成 CAUGHT，与 spec/驱动注释声称的「变红…必须命中全部声明的预期探针」语义有偏差。",
      "suggestion": "在死探针预筛阶段把 needle→标题集的解析结果保存下来（现在 `[PROBE-MAP]` 已打印，改成结构化保留），CAUGHT 判定改为「每条 needle 解析出的**每一个**标题都出现在 failed 集」；判定日志逐条打印 needle→实际红/绿的标题对照，PARTIAL_RED 的「沉默」口径随之精确到标题。"
    },
    {
      "id": "i8",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "`formatAccelerator` 的未知 token 策略是 `t.toUpperCase()` 整词大写，作为「展示面唯一实现」会在任何新增键上直接漏出含糊/不可读文本（`Shift+Plus` → `Shift + +`、`MediaPlayPause` → `MEDIAPLAYPAUSE`、`PrintScreen` → `PRINTSCREEN`），没有像修饰键表那样的显式登记通道；`NAMED_KEYS` 只覆盖 6 个具名键。结合 `detectMac()` 依赖 deprecated 的 `navigator.platform`，这一层的可维护冗余偏低。",
      "suggestion": "为常见非修饰键（`F1`–`F24`、方向键、`Insert`/`Delete`/`Home`/`End`/`PageUp`/`PageDown`/`Backspace` 等）补一张键盘名表，未知 token 默认保留原文大小写（不整词大写）并允许未来显式登记；`detectMac` 回退链改为 `navigator.userAgentData?.platform ?? navigator.platform ?? ''`。"
    }
  ],
  "dimensionScores": {
    "correctness": 7,
    "security": 9,
    "performance": 9,
    "maintainability": 6
  }
}