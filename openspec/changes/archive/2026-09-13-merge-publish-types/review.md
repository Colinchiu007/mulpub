# 双模型审查报告（merge-publish-types，2026-09-11）

## opencode 审查（已完成）

结论：**0 Critical / 3 Warning / 2 Info**

### W1. tasks.md 清单未勾选——与实现状态不一致（已修复 ✅）
- 位置：openspec/changes/merge-publish-types/tasks.md
- 处置：已勾选 1-9 项（第 10 项 PR 合并完成后勾选）。

### W2. activeMode 是 ref，路由热切换不同步（预存问题，不在本次范围）
- 位置：apps/desktop/src/views/Publish.vue:580
- 分析：`const activeMode = ref(publishType.value === 'video' ? 'video' : 'article')` 只在 setup 读一次快照。若同组件实例内路由 type 参数无刷新变化，activeMode 不跟随。
- 处置：**预存问题**（合并前即如此，本次仅移动行号未改逻辑，风险未扩大）。实际入口链路（PublishTypeDialog → router.push）会重新挂载组件，快照语义成立。记入 learnings 备后续迭代处理，本次不修（避免扩大变更范围）。

### W3. 测试注释中 image(9)/article(8) 括号数字易误解（已修复 ✅）
- 位置：PublishTypeDialog.test.js:33
- 处置：注释改为直接列出并集 11 个平台 id，去掉旧入口计数。

### I1. locale-cjk-baseline.json 行号偏移与本次变更无关（确认为环境性）
- 已核实：diff 中 48 增/45 删全部来自 AiWriterPanel/Collection/FirstRun 等无关文件的行号漂移；与 origin/main 对比 publish 相关增删为 0。基线在 main 上本就 FAIL（1455 vs 1458），--update-baseline 重排后三项检查 PASS。

### I2. en.js 中 publishPage 块内 typeArticleImage 结构正确
- 非问题：publishPage 与 publishType 两个命名空间各有一个 typeArticleImage 键，分别服务编辑页标题与弹窗卡片，属预期设计。

## claude 审查（API 不可用，已尽力）

- wrapper 与 claude CLI 均正常启动（版本 2.1.266），但 Claude API 连续重试失败：`api_retry attempt 8/10、9/10、10/10，error unknown`，最终 exit 1/超时。
- 分类（按记忆中的三分法）：① claude CLI 可用 ✅（--version 正常）；② wrapper 启动 ✅（进程/日志正常）；③ **API 服务本身不可用 ❌**（上游持续重试失败）。
- 处置：以 opencode 完整审查 + 主代理人工复核（diff 逐行审阅 + 73 测试 + build + locale 三查）作为本次审查证据。claude 侧审查缺失已如实记录，不伪造结果。

## 主代理复核补充

- 归一化边界：空值/无效值/大小写（?type=VIDEO）均有测试覆盖；`hasExplicitPublishType` 对无效值不显示标签（有专门用例）。
- 并集正确性：11 个平台 id 逐一核对无重复、无遗漏（原 image 9 + 原 article 8 - 6 重复 = 11）。
- 遗漏引用检查：全仓 grep `type=image|type=wechat`（排除文档/测试）无生产代码引用；E2E/视觉测试无引用。
