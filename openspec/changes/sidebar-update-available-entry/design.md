# Design — sidebar-update-entry

## Context

原先「更新可用」只有一条告知路径：应用启动 3 秒后由 `UpdateNotification.vue` 弹出 UiModal。它打断用户、错过即消失、入口不在导航壳内，且需要两步（下载更新 → 立即重启安装）。本项目要在应用壳内提供一个常驻、可达、一键完成的更新入口。

## Goals / Non-Goals

**Goals**
1. 运行期间常驻可达：检测到新版本即在侧边栏底部显示入口，直到安装完成或版本变为最新。
2. 一键完成：点击即「下载 → 退出 → 安装」，无需二次确认。
3. 不打扰：不再自动弹模态框；失败只以非阻塞提示条告知。

**Non-Goals**
- 不改运营后台版本发布策略判定（`force_version` / `gray_ratio` / `min_version`）。
- 不做「稍后提醒 / 忽略此版本」，不做增量更新与下载限速。
- 不在入口展示完整 releaseNotes（版本号仅通过 `title` 暴露）。
- 不删除既有 `update:check` / `update:download` / `update:install` 通道。

## Decisions

### D1：入口放在侧边栏 footer，条件渲染
- **选择**：footer 顺序 `[0] 服务连接信息 → [1]「新版本」入口（条件渲染）→ [2] 登录 banner`。
- **理由**：需求明确要求「左下角菜单按钮的上方」；条件渲染使「无更新」时既有 DOM 顺序契约完全不变，把回归面限制在它真正出现的状态。
- **替代方案**：顶部 header 徽标（违背「不得回顶部 header」约定）；右下角浮标（与 BackToTop 争位且不在导航壳内）。

### D2：状态与监听收敛为应用壳单例
- **选择**：`useAutoUpdate` 状态提升到模块作用域（单例），`start()` 幂等；`UpdateNotification`（App 级、不卸载）唯一持有 `start()/cleanup()`，侧边栏入口只读状态 + 触发安装。
- **理由**：两个消费者必须共享同一份状态与同一个 `update:status` 监听；若各自 `start()` 会重复检查。
- **代价与对策**：单例状态在同一测试文件内跨用例存活 → 导出 `resetAutoUpdateState()`（仅测试使用）在 `beforeEach/afterEach` 复位。

### D3：新增 `update:install-now` 而非改造 `update:install`
- **选择**：新增通道表达「确保安装（必要时先下载）」语义，保留 `update:install` 的「直接退出安装」语义。
- **理由**：语义不同、可分别回归；避免悄悄改变既有通道行为导致外部/文档契约漂移。
- **幂等**：渲染层（`installRequested && downloading` 忽略）+ 主进程（`_installRequested`）双重防抖。

### D4：用户主动动作的失败不静默降级
- **选择**：`error` 事件在「用户已请求安装」时原样回传 `error`；未点击时的网络/GFW/`latest.yml` 404 仍走既有静默降级。
- **理由**：把用户主动触发的失败伪装成「已是最新版本」会让入口永久停在下载中，且无从重试。

### D5：文案插值用 Message Function
- **背景**：`src/i18n/index.js` 为规避 Electron CSP 禁 `new Function`，把所有字符串消息转成「返回原串的函数」，普通字符串**不插值**。
- **选择**：带参数的 `update.*` 消息写成 `(ctx) => '下载中 ' + ctx.named('percent') + '%'`。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 点击后下载完成会自动退出，可能打断进行中的发布/创作任务 | 点击即为显式同意；点击瞬间用提示条明确告知「完成后将自动退出应用并安装」；文档中提示先等任务结束 |
| 单例状态在测试中互相污染 | `resetAutoUpdateState()` + 两个测试文件统一复位 |
| 入口挤占窄屏空间 | ≤900px 仅显示图标（保留 `aria-label`） |
| 从未发布 Release 的环境下无法实际验证安装链路 | 以主进程事件驱动的单测覆盖（emit `update-available` / `update-downloaded` / `error`），不依赖真实 Release |

## Migration Plan
无数据迁移。更新模态框随本次变更下线，用户侧无需操作；`update:check/download/install` 通道保留，不影响任何外部调用方。

## Open Questions
1. 是否需要在入口展示 releaseNotes（本次不做，后续可加「关于/版本」页）。
2. 安装前是否需要「有任务在运行」的二次确认（当前依赖用户主动点击表达同意）。
