# 双模型审查报告（member-center-avatar-entry）

## 审查方式
- Claude（codeagent-wrapper reviewer）：完整审查，无 Critical；Warning 8 项（W1-W8）+ Info 9 项。
- OpenCode（codeagent-wrapper reviewer）：后端连续失败（多行 stdin 解析失败 + 单行任务超时无终报），按机制硬化规则降级：主代理逐文件复核 + 全量测试兜底。

## 已修复（代码层面，均已补充测试验证）
| 编号 | 问题 | 修复 |
|------|------|------|
| W1 | 切换账号失败显示「退出失败」错误文案（IDENTITY_ACCOUNT_SWITCH_FAILED 未映射，switchFailed 键定义了没用） | ProfileMenu.vue errorMessage 补映射 |
| W2 | MemberCenter 页登录/切换/退出失败无错误反馈（error 未解构、无 alert） | 解构 error + errorMessage computed + 账号卡 role="alert" 错误行 |
| W3 | 全角冒号「：」硬编码漏过 CJK 门禁 | expiresAt 改为 {date} 命名插值（zh/en 成对） |
| W4 | 会员中心入口零测试覆盖（IdentityMenu 按钮、Sidebar more 项） | 补已登录点击跳转用例 + more-menu 断言「会员中心」 |
| I2 | moreItems i18n 标签非响应式 | 改 computed |
| I3 | MpSidebar 死 CSS（.mp-profile 系列） | 删除（ProfileMenu 自带 scoped 样式） |

## 未采纳（记录备查）
- W5 三入口并存（产品明确要求保留多入口，PRD §2.3.3 已声明）；
- W6 useDropdownBehavior 与 IdentityMenu 重复实现（后续重构收敛，PRD 边界注明）；
- W8 aria-haspopup 动态语义（a11y 瑕疵，后续优化）；
- W7 quota 引用共享序列化建议、I1 signing_in 静默防抖、I3 已修、I4 冗余 locale 键、I5 配额裸键本地化、I6 断言增强、I7 toggle 可裁剪 API、I8 licenseMeta 冗余分支、I9 preload bundle 假变更（LF/CRLF，无可提交内容）。

## 测试结果
- 目标 7 文件 + 修复后 5 文件：全绿（42/42、15/15 等）；
- 全量 466 文件 8587 测试：4 失败——visual-view-runner（本次路由门禁，已修复）＋ phase1-context / account-state-restorer（全量并发超时，单独重跑通过）＋ feedback（Windows symlink EPERM 环境问题，与本任务无关）。
