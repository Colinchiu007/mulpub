{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": "P6 的「首选择器在 index.css」通用锁无法抓住 el-reset：el-reset 的规则是 input/textarea/button/a/h1 等元素选择器，firstSelector 正则 /\\.el-[a-z0-9-]+/ 不匹配→返回 null→被塞进 placeholders 桶而非 notInFull。真正挡住 el-reset 的只有硬编码 imported.includes('el-reset')，而方案自己称这是弱锁。故其他「非 el-reset 但首选择器为元素」的多导文件仍会漏网，未实现「换文件也会重犯」的设计目标。",
      "suggestion": "改为逐条解析每个文件的所有选择器（含元素选择器），判断其 css 是否全部能在 index.css 中逐条定位；或对首选择器为元素/复合选择器的文件单独建断言，而非用首 class 代表整个文件。"
    },
    {
      "id": "i2",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "P6 用 indexCss.includes(sel) 做子串匹配：如文件首选择器为 .el-radio，而 index.css 含 .el-radio-group，子串命中即假通过；短 class 前缀也可误配到无关规则。子串匹配使「文件不在全量产物」的判定不可靠，与锁定目标不符。",
      "suggestion": "不由子串判断，改为切分 index.css 的规则块，做完整选择器精确匹配（独立 class 选择器按名称精确比对）。"
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "P6 的 expect(placeholders.length).toBeLessThan(5) 用魔法数 5，且 placeholders 混装「合法 renderless 0 字节」与「首选择器非 class（如 i1 的 el-reset）」两类不同对象。未来合法占位文件增多或元素首选择器文件被误分，将假通过或假失败，阈值断言脆弱。",
      "suggestion": "去掉宽松阈值，按当前实际占位文件逐一硬编码期望集合（如仅 el-config-provider）精确断言。"
    },
    {
      "id": "i4",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "create-pipeline 的像素数字在库内不一致：openspec 记录行写 9.47%，而 BUGFIX/AGENTS/CHANGELOG 多处写 9.26%，且 BUGFIX 同段又写「与 main 逐位一致 0.21%/0%/0%」。已提交的审计数字互相矛盾，削弱「逐位一致/对照」结论的可信度。",
      "suggestion": "统一三处 create-pipeline 数值为唯一来源，并核对 9.26%/9.47%/0% 各自对应的对照态，避免留多个版本数字。"
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "P7 指令扫描仅遍历 .vue 且正则 \\sv-(loading|infinite-scroll)\\b 要求 v- 前有空白；不扫 .ts/.tsx/render 函数中用 withDirectives/h 的指令用法，v- 前非空白（如紧贴开括号/注释）也会漏。扫描覆盖不全可能给出假的「已装配」绿。",
      "suggestion": "扩展扫描到 src 全部源码类型，去掉前导 \\s 限定，并补充对 withDirectives/h('...',...,[vLoading,...]) 形态的识别。"
    },
    {
      "id": "i6",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "P6/P7 直接读 ../../node_modules/element-plus 并在单测中内联当前安装版本的样式图与私有 app._context.directives；EP 升级、Vue 大版本或打包方式变化都会使锁意外破绿/误红，无版本固定或 mock。",
      "suggestion": "在测试中对 node_modules 读取加版本前置校验/固定 EP 版本，或改为喂入夹具 CSS 文件而非依赖真实安装目录。"
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "correctness",
      "finding": "P7 仅断言 app._context.directives.loading 为真（依赖 Vue 私有 _context 与 EP directive 命名 install 约定），未校验 el-loading.css 样式确实随装配加载；若 EP 变更注册内部名或存在多个同名指令，此断言测非所测。",
      "suggestion": "改为直接断言插件插件导出/注册对象含预期指令名，并对 el-loading.css 采用与 P4 相同的产物级选择器存在性核对。"
    }
  ],
  "dimensionScores": {
    "correctness": 5,
    "security": 9,
    "performance": 8,
    "maintainability": 5
  }
}