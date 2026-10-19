## 1. 阶段 2 批次 E — 历史列表与通知

- [x] 1.1 `filteredRecords` 改读防抖快照（`FILTER_SOURCE_ORDER` 显式登记七个筛选源 + 命名访问器）
  —— 锁：`PublishHistory.test.js`「搜索和状态筛选只保留匹配记录」+ 新增「筛选输入立即回显，列表在防抖窗口之后才收敛」；反证 M1
- [x] 1.2 行内派生值收敛为 `rowMeta`（按 `record.id` 的 Map）+ `metaFor()` 查表
  —— 锁：`PublishHistory.rowContract.test.js` 两条（渲染路径白名单、死键锁）；反证 M4/M5/M6
- [x] 1.3 `RENDER_LIMIT = 200` + 超限提示行（`role=status`，zh/en 成对）
  —— 锁：「超过渲染上限时只画前 N 条并提示被收起的数量」「未超过时不显示」；反证 M2/M3
- [x] 1.4 展示值纯映射抽 `usePublishHistoryRowFormat`、状态判据抽 `utils/publish-record-status`
  —— 锁：导出完整性 17 项 + 装配锁 4 条（含 TDZ 顺序锁）；删除从未被消费的 `auditValue`
- [x] 1.5 `AutomationView.vue` 监听注册移到 `await load()` 之前
  —— 锁：「监听注册排在首屏加载之前」（挂起列表请求仍能收到通知）；反证：退回原顺序只红这一条

## 2. 阶段 2 批次 F — 首屏并行化

- [x] 2.1 `PodcastChannelView` 三源同批 —— 行为锁（快源 start 落在慢源 end 之前）+ 失败隔离锁；反证 M8
- [x] 2.2 `Publish.vue` 账号/预检偏好/草稿入批 + 逐条出声 —— 源码契约锁；反证 M9
- [x] 2.3 `Collection.vue` 六源入批 + 策略预览移到批后 —— 源码契约锁；反证 M10

## 3. 阶段 2 批次 G — 封面取数与进度语义

- [x] 3.1 前置测量（audit-34 要求）：`monitorEventLoopDelay` 基线四档，结论写入 PRD §4
- [x] 3.2 `cover:read-data` 读盘异步化、去掉同步 `existsSync`、ENOENT 文案保持
  —— 锁：`cover-cropper.test.js` 结构锁 + 4 条行为锁；反证 M13
- [x] 3.3 渲染侧可见区驱动（`observeCover` + IO rootMargin 240px，无 IO 退回立即加载）
  —— 锁：composable 3 条（绑定时不取数 / 远程不参与 / 卸载 disconnect）+ 视图装配锁 2 条；反证 M11/M12
- [x] 3.4 聚合进度软权重 + 「第 N / 共 M 项」（`publish-progress-aggregate.js` 单一实现）
  —— 锁：纯函数 8 条 + store 7 条 + 面板 4 条 + 夹具字段对偶锁；反证 M14/M15/M16
- [ ] 3.5 小图生成与缓存（2.1 ②）—— 契约见 PRD §7，本批未做

## 4. 质量节拍与交付

- [x] 4.1 QM-1 离线打包 `pnpm run build:dir` rc=0；asar 内键 `electron\services\cover-cropper.js` 实测
  含 `await fs.promises.readFile(imagePath)`、不含 `fs.readFileSync(imagePath)`；`ipc-handlers\publish.js` 含 `await readImageAsDataUrl(imagePath)`
- [x] 4.2 QM-1 启动判据三层：隔离 profile 启动 9s **存活**、stderr **0 字节**、未命中红线 ⇒ PASS
  （`MP_PROCS` 计数 0 → 0，未批量 kill）
- [x] 4.3 门禁实跑：`check-max-lines` PASS（点名还账文件零增长守住、`publishProgress.js` 超 500 行由抽出解决）、
  `check-locale-sync --keys` PASS（2124）、`check-css-var-defined` PASS、`check-font-size-scale` PASS、
  `check-no-brand-residue` PASS、`check-unwired-tests` OK、`eslint --quiet` 0 违规、`vite build` 通过
- [x] 4.4 文档：`01-docs/PRD-UX-AUDIT-PHASE2-PUBLISH-FLOW-2026-10-19.md`、
  `openspec/changes/ux-audit-implement-phase2/`、`openspec/records/ux-audit-phase2.md`、CHANGELOG 两条
- [ ] 4.5 QM-6 双模型外部评审：本机无 CCG（pre-commit 实测打印「未找到 CCG，已跳过」）⇒
  按实际状态登记，不谎称已跑；替代通道另议
- [ ] 4.6 QM-4 像素门禁：本批改了 `PublishProgressPanel` / `PublishHistory` 展示面，
  需在收口批次跑 `npm run test:visual:pixel`（基线只能取 CI 渲染）

## 5. 阶段 2 批次 H — 发布前摘要闸门（2.6）

- [x] 5.1 纯函数 `utils/publish-confirm-summary.js`：计数口径 + 只数不说 + 解析失败取向
  —— 锁：`publish-confirm-summary.test.js`（新建 7 条：去重/脏输入/三段拼接/labelFor/零目标/失败态）；反证 M20
- [x] 5.2 `usePublishFlow.handlePublish` 接入 `notifyConfirm` 闸门（位置在校验与截断之后、派发之前）
  —— 锁：`usePublishFlow.test.js` 新增 4 条（文案内容、调用顺序、取消不派发且解锁、无截断不出截断行、接线锁）；反证 M17/M18/M19
- [x] 5.3 既有敏感词锁改为**按弹窗文案指名**（原写法把"没有敏感词弹窗"写成"一次确认都没有"，被闸门撞红）
- [x] 5.4 locale 新增 `publishPage.publishFlow.confirmTitle / confirmSummary / confirmDetail / confirmTruncated / confirmAction / confirmCancel`（zh/en 成对，`--keys` PASS 2125）
- [x] 5.5 CJK 门禁实跑暴露并修掉本批自造的两处中文字面量（`Publish.vue` 的 console.warn 前缀、
  摘要明细的连接符顿号）⇒ `check-locale-sync --cjk` PASS（基线 1331 / 当前 1189）
- [ ] 5.6 QM-4 像素门禁：闸门是新增弹窗，像素门禁不覆盖模态内层（既有失明），仍需人工看一次
