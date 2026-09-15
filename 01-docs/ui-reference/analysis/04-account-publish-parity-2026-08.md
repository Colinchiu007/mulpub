# 账号管理与内容发布对标增补（2026-08-04）

## 证据来源

- 目标应用安装目录：D:\Program Files\mp\；本轮确认版本为 4.13.19。
- 用户更正后的逆向工程目录：D:\Data\projects\_逆向工程_参考产品4.0\。该目录包含 packages/renderer/dist、packages/preload/dist、packages/main/dist/index.cjs、RPA分析报告.md 与 可复用代码分析.md。
- 本仓库既有资料：01-docs/ui-reference/analysis、prd、test-cases。
- 本工作树：C:\tmp\Multi-Publish-mp-parity-gap-20260804\；分支 codex/mp-parity-gap-20260804。

逆向目录和安装包用于确认技术结构、页面资源、Cookie/BrowserView、发布队列和通用上传/取消/重试模式；不把反编译代码中的未调用函数当成已观察 UI 行为。

## 页面与流程矩阵

| 模块 | 当前入口 | 已对齐的可观测行为 | 当前代码合同 | 外部边界 |
|---|---|---|---|---|
| 账号管理 | /accounts | 搜索、状态筛选、平台筛选、卡片/列表、收藏、默认账号、代理、批量启用/禁用/删除、登录状态条；卡片命令与真实截图一致为“设置 / 重新登录（仅失效） / 删除” | useAccountStore 负责账号/选择/本地分组，AccountManagementCard 负责字段与命令，AccountLoginDialog 与 Electron auth 事件负责授权；失效账号重新登录复用 auth:open-login | 真实第三方登录、验证码和平台 Cookie 仍依赖目标环境 |
| 分组管理 | /accounts?tab=groups 或账号页按钮 | 创建、删除、成员勾选、重命名、平台过滤；主列表侧栏增加分组搜索、全部分组、仅看共享和空态 | AccountGroupManager 发出 create/delete/rename/set-platform/toggle-account 事件；Store 以显式 accountIds 持久化，列表用 groupFilter 过滤 | 当前为设备级 localStorage；共享分组只有后端返回 shared/is_shared 字段时才显示 |
| 收藏分组 | /accounts?tab=favorites | 复用账号列表的收藏筛选；无收藏时显示“暂无收藏账号”专用空态 | filter=favorite，账号列表仍走同一状态/平台/选择合同 | 未观察到参考产品服务端收藏同步 API |
| 分享链接 | /accounts?tab=share | 导航入口、未接入服务状态、禁用的“创建分享链接”按钮 | 当前不伪造团队数据，明确提示尚未接入团队分享服务并阻止不可验证写入 | 团队成员、权限、分享链接生命周期需真实后端契约后实现 |
| 新建发布 | /publish | 独立主入口、单篇/批量、平台/账号绑定、媒体、封面、标签、话题、@、定时、草稿、进度、重试 | publish-contract.js 统一归一化/校验；usePublishFlow 与 useBatchPublish 共享目标和媒体字段 | 平台上传、签名、配额和真实发布结果需真实账号与网络 |
| 发布记录 | /publish/history | 搜索、平台/时间/状态筛选、网格/列表、详情、失败重试、CSV、批量删除 | historyList/historyGet/historyDelete/retryTask 走现有 IPC/API 适配；删除链路带 owner 隔离和 JSONL 原子重写 | 平台侧审核和统计字段取决于后端 |
| 草稿箱 | /publish?tab=drafts | 从模块导航直接打开独立草稿工作区，加载/空态/继续编辑/删除，也可从发布页打开 | usePublishDrafts 对媒体/封面/标签/话题/@ 做纯 JSON 脱壳后 IPC 传输；编辑入口使用 draft query 恢复 | 跨设备同步和素材库联动未证明 |

## 已完成的结构收敛

1. App.vue 仅对账号/发布工作区挂载 MpModuleNav；其他模块保留原有导航，避免无关页面回归。
2. 发布模块导航新增“新建发布”，不再把“发布记录”冒充发布主入口。
3. 账号模块 query 页签能驱动分组弹窗、收藏筛选和分享能力边界；分组关闭时会回到 /accounts。
4. 批量发布不再以平台字符串作为无账号回退；目标必须绑定结构化账号并通过同一校验。
5. 视频平台判断从静态小集合扩展为平台内容分类和稳定 fallback；历史页与发布页共享视频语义。

## 2026-08-04 parity gap closure

1. `MpModuleNav` 的四个工具按钮不再是静态 placeholder；每个按钮打开可关闭的本地面板，移动预览、客服和通知均明确未接入或暂无状态，使用指南提供本地流程说明。逆向 bundle 没有可证实的专用 URL/IPC，因此没有硬编码未经验证的外链。
2. `Publish.vue` 的 `tab=drafts` 进入独立草稿工作区，隐藏发布编辑器，提供加载、空态、继续编辑、删除和返回发布；既有 `draft` query 编辑恢复流程保持不变。
3. 发布记录批量删除沿 renderer API → preload → `history:delete` → JSONL service 链路实现，handler 使用可信身份 owner，service 只删除当前 owner 的指定记录并以临时文件 + 有界 Windows rename 重试替换原文件。
4. 新增稳定回归选择器：`mp-tool-*`、`publish-drafts-*`、`publish-progress`、`delete-selected-history`；功能测试不再依赖卡片数量或 inert 按钮。

## 2026-08-04 续作补齐

1. `AccountManagementCard` 按真实参考产品账号截图收敛底部命令：活动账号仅显示“设置、删除”，失效账号追加“重新登录”；原有“设默认、打开主页、验证”仍保留为页面级兼容方法，但不再污染参考产品卡片主界面。
2. 重新登录流程复用 `useAccountActions.openLogin('browser', platform)`，由 `pendingAuthAction` 区分“添加账号成功”和“账号重新登录成功”；取消、IPC 业务失败、异常均关闭登录视图并显示原始错误。
3. 账号卡片增加粉丝数、负责人、运营人、代理字段的多后端字段归一化；缺失字段分别显示“暂无数据”或“未设置”，不生成假团队数据。
4. 分享链接状态改为可验证的未接入服务空态，创建按钮显式禁用；分组侧栏增加搜索、共享筛选、分组成员计数和无分组空态。

5. 账号列表排序合同已落地：默认 `sortBy=name`、`sortOrder=asc`，可选 `name`、`platform`、`created_at`、`last_used_at`、`followers`、`status`。搜索、状态/收藏筛选先缩小集合，Store 再排序；页面的平台筛选、分组、负责人/发布人筛选沿用该顺序，不重新打乱账号。文本按 `zh-CN` 小写归一化；日期按时间戳归一化；粉丝数字兼容数字、逗号、`万`、`w`、`k`；缺失或非法日期/数字统一为 `-Infinity`（升序置前、降序置后）；相同值用筛选结果中的原始索引作为 tie-break，保证顺序稳定。

6. 账号状态徽章和检查记录使用可解释映射：`active|online` → `online`/“已登录”；`inactive|offline|expired` → `offline`/“已过期”；`error|failed|failure` → `error`/“异常”；其他或缺失 → `unknown`/“暂无检查记录”。最近检查优先读取 `last_login_check_at`、`lastLoginCheckAt`、`login_checked_at`、`loginCheckedAt`、`last_checked_at`、`lastCheckedAt`、`checked_at`、`checkedAt`；日期无法解析时回退到 `login_check_error`、`loginCheckError`、`last_login_error`、`lastLoginError`、`status_reason`、`statusReason`，再无数据才显示“暂无检查记录”。未知状态不伪装成已过期或已登录；只有已登录状态显示“验证”，其他状态保留重新登录入口。
7. 账号 IPC 的 `toPublicAccount` 现在对粉丝数、负责人、运营人、最近使用、最近检查和检查原因执行显式别名归一化，仅输出卡片需要的公开元数据；未知字段及 Cookie/token 等凭据不会透传到 renderer。`account:set-proxy` 等待持久化 Promise，异步保存失败会转换为可见 IPC 错误。
8. 扫码登录事件链补齐可见二维码预览：`qrcode:detected` 的 PNG/JPEG/WebP `data:`、HTTPS、`blob:` 来源显示在账号页右上角，二维码关闭/完成时预览清除；其他协议和 SVG data URL fail closed，不把不可信地址写入图片节点。

## 设计与代码分离审计

已确认仍有以下非阻断遗漏，不能声称“整个项目已完全分离”：

- apps/desktop/src/styles/cohere-design-system.css 已提供全局 token，但账号、发布、历史仍有 scoped CSS 与既有 inline style；本轮新增工具面板、草稿页和反馈状态全部使用模块级 class/token，不做无证据的大范围视觉重构。
- 平台名称/图标仍存在 store、shared-utils、publish-contract 三个读取入口；应在后续以 platform store adapter 作为唯一 view-model。
- 发布草稿在 Publish.vue 与 PublishHistory.vue 仍各有一层展示；字段合同已统一，跨入口抽取尚未完成。
- 负责人/发布人筛选目前保留为 disabled 占位，因为未发现可验证的 owner/team API；不得用前端假数据冒充参考产品团队能力。
- 代理编辑保留安全边界：重新打开已配置代理时恢复类型和端口，并以脱敏主机提示引导重新输入完整地址；用户名/密码不回显，保存仍要求完整地址和成对认证字段。

## 验证矩阵

- 定向 Vitest：本轮受影响的 7 files / 648 tests 通过；模块导航、发布页、发布历史、发布合同、批量发布、草稿、preload、IPC 和 JSONL service 均有回归覆盖。
- 全量串行 Vitest：357 files / 6120 tests passed；日志为 `D:\\tmp\\Multi-Publish-mp-parity-gap-20260804-vitest-full-serial.log`。输出仅包含既有 warning，未出现失败测试。
- Vue 构建：`npm run build:vue` 通过，Vite 仅保留既有动态导入和大 chunk 警告。
- 视觉捕获：账号、发布、批量发布在 desktop/mobile/audit 三视口共 9/9 通过；真实参考产品像素审计 3/3 通过，账号误差 2.5240%、发布 5.3809%、批量发布 5.8431%，无阻断、无未验证参考图。
- 必测 UI 合同：query 页签 active 状态、分组重命名/平台过滤、分享边界提示、草稿 query 自动打开、结构化媒体 metadata。
- 构建门禁：本续作修改了 Electron preload/IPC/service 源码；已重新执行 preload 构建、Windows 目录打包、ASAR require 链和真实窗口启动检查。最终目录为 `D:\\tmp\\Multi-Publish-mp-parity-gap-20260804-dist-electron-final\\win-unpacked`，隔离加载输出 `RPA_ENGINE_REQUIRE_OK`，可见窗口标题为“社媒管家”、句柄 `790144`。
- 视觉门禁：账号、发布、发布记录和草稿 query 必须在目标 worktree Vite 端口下执行像素回归；截图不得包含账号 Cookie、二维码或个人信息。
- 本轮续作验证：账号/代理 IPC 与组件定向 35/35、账号 Store/视图/组件及发布 API 383/383、账号事件与二维码视图 77/77；全量桌面 Vitest 357 files / 6135 tests passed；`npm run build:vue`、Windows electron-builder、ASAR 入口 require 和 8 秒打包启动检查通过。视觉像素 17/17 通过。上述证据均来自当前续作工作树，仍不替代真实第三方登录、Cookie 恢复或线上团队服务验收。

## 本地代码审查边界

- 外部 Antigravity 因 `agy command not found` 未运行，Claude wrapper 以退出码 1 结束；本轮没有伪造“双模型已通过”，审查结论来自本地静态检查、定向 lint 和测试。交付前需保留两路 wrapper 的失败证据并完成本地双视角审查。
- 设计与代码分离、团队分享、手机号/密码登录、真实第三方发布和线上审核仍列为后续/外部边界。

## 不可客观证明的 100% 一致

以下事项必须保持 PENDING_EXTERNAL 或 PENDING_USER_LOGIN，不应在 PR 描述中写成完成：

- 第三方平台网页登录、手机号/验证码/密码登录、二维码过期和真实 Cookie 持久化。
- 平台上传签名、分片 CDN、审核、配额、失败重试的线上返回。
- 参考产品团队/分享链接服务端的成员权限和跨设备同步。
- 真实安装包窗口截图与当前 worktree 的像素 100% 等价；反编译 bundle 可确认资源和调用形状，但不等同于完整原始源码。
9. 2026-08-08 CCG 双模型审查修复：`toPublicErrorValue` 脱敏覆盖 `access_token`/`refreshToken`/`api_key`/`密码`/`令牌` 等下划线/驼峰/中文键并吞掉逗号值；`publisher` 别名增加 `publishers`/`publisher_list` 且数组归一化；`account:set-proxy` 判空、代理字符串端口归一化、二维码 img `referrerpolicy="no-referrer"`；双 IPC 路径契约测试证明 `accounts:list` 与 `account:list` 输出一致。
