# D2 选择器活体侦察 — 2026-09-26（结论：被登录态失效阻断，非选择器漂移）

## 探针方法

- 通道：CDP（127.0.0.1:10131）→ 社媒管家渲染端 `window.electronAPI.authOpenLogin('kuaishou','a4505f45')` 打开登录态视图 → 附加 kuaishou page target → `Runtime.evaluate` 枚举 DOM。
- 脚本：`.agent_context/w3livefix-staging/probe-d2-*.js`（只读，零发布副作用；结束一律 `authClose`）。
- 探针期间误建重复账号 `0e7a4bdf`（首次 authOpenLogin 未传 accountId 自动完成建号）→ 已经 `accountDelete` 删除，仅剩 `a4505f45`。

## 关键发现

1. **登录态已失效**：auth 分区视图 `/profile` 实际渲染的是登出营销页：
   - `hasLoginWord: true`（含"立即登录"），`hasConsoleWord: false`（无"作品管理/发布作品"等控制台词）
   - body 摘录："平台介绍 机构入驻 视频上传 快手创作者服务平台…立即登录 平台优势…"
2. **发布页不可达**：`cp.kuaishou.com/article/publish/video?tabType=1` 导航后被重定向回登出态页面；截图 `selector-probe-20260926-authview.png` 为"立即登录"营销页（非发布表单）。
3. **"冻结"假象根因**：导航发布页后 evaluate 全部超时——登出重定向链上的模态（首轮枚举唯一命中 `el-button confirm__btn is-disabled`"确定"按钮，即登录失效对话框）阻塞渲染线程；`Debugger.setSkipAllPauses` 无效、renderer CPU 空闲，排除反调试忙循环。
4. **对 6.3 判定的修正**：DOM 轨 `pubBtn=7 候选全 timeout` 的最可能根因是**登录态失效（页面根本没有发布按钮）**，而非选择器漂移。platform-selectors 的 7 候选是否命中，须在重新登录后复测才能判定。

## STATE 原始输出（loginstate 探针）

```json
{"href":"https://cp.kuaishou.com/profile","hasLoginWord":true,"hasConsoleWord":false,
 "body":"平台介绍 机构入驻 视频上传 快手创作者服务平台 为创作者/机构提供强大的运营管理、数据分析、内容生产等辅助工具…立即登录 平台优势 …"}
```

## 下一步（D2 解锁条件）

- [ ] 用户在场扫码重登快手（auth 视图 QR 登录；重登成功会同时把凭证写回 store——顺带验证 D1 的 store 空场景是否复现）
- [ ] 重登后复跑 `probe-d2-diag.js` 枚举发布页真实按钮 DOM → 才能定夺选择器是否需要刷新（红测 2.2 以复测证据为前提）
