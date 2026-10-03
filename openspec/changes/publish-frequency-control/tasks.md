# publish-frequency-control — 任务清单

## 1. 频率策略单一真源（TDD）

- [x] 1.1 新建 `packages/shared-utils/src/publish-frequency-policy.js`：15 平台两档表 +
  基线最严档 + `MP_PUBLISH_MIN_INTERVAL_MS` / `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` 覆盖 +
  非法值回落并出声 + 纯函数 `resolveIntervals(platform, env)`
- [x] 1.2 `packages/shared-utils/tests/publish-frequency-policy.test.js`：
  15 平台全覆盖、未知平台回落基线（不得为 0）、`0` = 显式关闭、非法值回落 + warn 计数、
  环境变量覆盖优先级
- [x] 1.3 从 `packages/shared-utils/src/index.js` 与 `index.d.ts` 导出

## 2. Guard 扩展为双档 + 缺席也受控

- [x] 2.1 `publish-interval-guard.js` 新增 `check(platform, accountId, now)` 返回
  `{allowed, remainingMs, bucket}`；保留 `canPublish`/`recordPublish`/`getRemainingWait`
  既有签名（60+ 现存测试不得改）
- [x] 2.2 平台档桶键 `${platform}:*`；`accountId` 缺席时账号档跳过、平台档仍生效
- [x] 2.3 `record` 一次写两档；间隔值由策略模块按平台解析（不再构造期钉死单一 minInterval）
- [x] 2.4 测试：两档各自独立命中、两档同时命中取较大等待、缺席账号仍被平台档挡住、
  关闭档（0）恒放行

## 3. TaskQueue：记账前移 + 装配语义

- [x] 3.1 `task-queue.js` `_executeTask`：两档检查 → 阻塞则重排返回 →
  通过则**提交前**记账 → 再 submit；移除成功路径里的记账
- [x] 3.2 等待回退语义核对（`status:'pending'`、`startedAt:null`、不消耗 `retriesLeft`、
  句柄进 `_pendingTimers` + `unref`、`shutdown` 清理、取消再检查）
- [x] 3.3 `publish:blocked` 载荷补 `bucket`（account/platform）以便现场归因，并**贯穿到被渲染的那份状态**：
  `phase4-events` 转发 → `publish-progress-events` 投影白名单 → `publishProgress` store → `PublishProgressTaskRow`
  （归因文案进 `locales/zh.js` + `en.js` 成对；取值缺席时为 `null` 且不渲染标签）

## 4. 三处断链修复

- [x] 4.1 `container.setup.js:324` 工厂内注入 `publishIntervalGuard`（排在 `options.taskQueue`
  展开之后，不允许被覆盖成 undefined）
- [x] 4.2 `container.setup.js:332` guard 注册改为消费策略模块（去掉构造期硬编码 minInterval）
- [x] 4.3 `phase3-services.js:95` 删除死变量 `_publishIntervalGuard`，并同步该文件的
  JSDoc「phase3 负责 publishIntervalGuard」表述
- [x] 4.4 `phase3-services.test.js:31` 的 `publishIntervalGuard` 空对象夹具随之清理

## 5. 回归锁 + 反证（核心，防"装饰性接线"再犯）

- [x] 5.1 **装配锁**：落在既有 `apps/desktop/electron/core/container.setup.test.js`（新增 3 条，
  未另建 `taskQueue-frequency-guard.test.js`——锁必须与被测装配同处一个真实容器用例文件才有意义），
  以生产方式 `createContainer()`（不带参数）构建，断言 `taskQueue` 内部守卫非 null
  且与 `container.get('publishIntervalGuard')` 同一实例
- [x] 5.2 **行为锁**：经守卫的队列真的挡住第二次提交 / 到点放行 /
  超时任务仍占窗口 / 失败重试仍等窗口
- [x] 5.3 **反证（必须实跑并记录红条数）**：
  (a) 摘掉 `container.setup.js` 的注入 ⇒ 装配锁必须变红；
  (b) 把记账挪回成功路径之后 ⇒ 超时占窗口用例必须变红；
  (c) 让 `accountId` 缺席跳过全部检查 ⇒ 缺席仍受控用例必须变红；
  (d) 把守卫本身改成 no-op ⇒ 行为锁必须变红
- [x] 5.4 新测试文件按 `check-unwired-tests.js` 口径接进 `.github/workflows/quality-gate.yml`
  （写全相对路径；「接进 CI 了」≠「对本 PR 跑」≠「红了拦得住」，需核对落点取得到证据）

## 6. 门禁与交付

- [x] 6.1 shared-utils + apps/desktop 相关测试全量；`verify-worktree-deps.js`
- [x] 6.2 QM-1 本地打包验证（改了 `apps/desktop/electron/`）
- [x] 6.3 QM-6 外部交叉评审（M+ 强制）——**harness 偏差已在记录里声明**：配置真源
  `~/.claude/.ccg/config.toml` 的两个 primary（`codex` / `claude`）都绑 `127.0.0.1:15721`，
  本机实测该端口无监听 ⇒ 改用 `opencode` 两套**不同底模**分轴执行（后端轴 nemotron、前端轴 longcat），
  结论与处置见 §7
- [x] 6.4 PRD `01-docs/PRD-PUBLISH-FREQUENCY-CONTROL-2026-10-02.md`
  （须含：默认值属工程保守估计而非平台规则、乐观记账的代价、不含设备级串行）
- [x] 6.5 CHANGELOG 收口（注意 CRLF 基线，禁止整文件统一行尾）
- [x] 6.6 执行记录落在 `openspec/records/publish-frequency-control.md`（本 PR 采用的载体；
  门禁 `check-gate-record-debt.js` 两处都读——`.quality-gates.md` 是旧载体，近期 #2771/#2772 同用 records）
- [x] 6.7 PR #2773 已开、CI 20 pass/0 fail；合并与归档三同步待 QM-6 补跑后

## 7. QM-6 外部评审发现与处置（逐条已实跑反证）

后端轴（`opencode/nemotron-3-ultra-free`）2 条 Warning，前端/集成轴（`opencode/longcat-2.5-preview-free`）
1 条 Warning + 5 条 Info，**无 Critical**。全部 Warning 已修：

- [x] 7.1 **W1（前端轴）`bucket` 在跨层边界被静默丢弃** —— `phase4-events.js` 的处理器只解构
  `{task, remainingWait}`，转发白名单、store、TaskRow 三层都没有 `bucket`；PRD §5.1/§7 承诺的
  「被自己账号卡住 vs 被同平台别的号卡住」归因实际到不了界面，而既有转引用例的**夹具本身不含 bucket**，
  对该丢失结构性免疫（全绿）。处置：四层逐个接上 + `locales` zh/en 成对新增两键 +
  把 `phase4-events.test.js` 的夹具改为带 `bucket` 并精确断言（缺席则 `null`，不许猜档）。
- [x] 7.2 **W2（后端轴）守卫读错 accountId 源** —— `task-queue.js` 取 `task.article.accountId`，
  而 `add()` 已把 accountId 归一到 `task.accountId`；调用方只在任务级带账号时账号档被整条跳过
  （平台档更宽，拦不住）。处置：改读 `task.accountId`，并补一条**可区分两侧**的行为锁
  （现场构造「平台档窗口已过、账号档仍在窗口内」，取错源时任务会立即发出且无 blocked 事件）。
- [x] 7.3 **W3（后端轴）`index.d.ts` 的 `TaskQueue` 构造参数缺 `publishIntervalGuard`** ⇒ 补声明；
  顺带补前端轴 Info 指出的 `static InMemoryStore`（该静态导出在 main 上早已存在，声明一直漏着）。
- [x] 7.4 前端轴 Info 处置：`tasks.md` 5.1 声称的文件名与实际落点不符 ⇒ 按实际改写；
  `canPublish`/`getRemainingWait` 生产调用点为 0（PRD 明示保留的兼容 shim）⇒ 保持不动并记录；
  渲染层 `DEFAULT_MIN_ACCOUNT_INTERVAL_MS`（定时表单输入期校验 5min）与运行期分平台档位口径不同
  ⇒ PRD §5.2 补「用户可感知的两套口径」这一条已知代价。
- [x] 7.5 反证五条（M1 摘 phase4 转发 / M2 摘投影白名单 / M3 摘 store 写入 / M4 退回 `article.accountId`
  取值源 / M5 摘掉平台档标签分支）：每条**先跑基线全绿**再应用变异，各让对应测试文件恰好红 1 条
  （23→1/22、20→1/19、35→1/34、10→1/9、26→1/25），五个文件均按备份**逐字节还原**相同。
  踩到的两条驱动侧坑：锚点含 `\n` 在本仓 CRLF 文件上恒 0 命中（须按文件真实 EOL 拼接）；
  先应用变异再跑"基线"会让两次读同一份变异态（顺序必须是 基线→变异→还原）。
