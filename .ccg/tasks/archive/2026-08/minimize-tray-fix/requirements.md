# requirements.md — 移除无条件最小化进托盘（方案A）

## 背景
用户反馈桌面应用"启动后操作不了"：窗口被反复"最小化进托盘"而消失。经确认，`system-tray.js` 对**任何 minimize 事件**无条件 `preventDefault() + hide()`，最小化即藏进托盘；而用户记忆中的"关闭应用→隐藏到托盘"是 `window-close-policy.js` 的条件行为（运行中流水线 + 托盘可用）。

## Bug 5 步 SOP（QM-5）
1. **根因溯源**：`d3cbe6a0`（feat: integrate 参考产品逆向分析 findings）引入无条件 `minimize → preventDefault + hide()`；`847cdf30` 仅为 services/ 目录迁移（git log -S "minimized to tray" 确认）。文件头注释亦写明"应用最小化到托盘"为设计意图，但与系统常规最小化语义冲突。
2. **逃逸分析**：无任何测试覆盖该行为——`system-tray.test.js` 只测 `tray:flash`/`tray:set-tooltip` IPC 安全与图标回退；`window.test.js` 只测 close→tray（有运行任务）路径。最小化是唯一无测试的窗口生命周期路径，故回归未被拦截。
3. **系统性漏洞**：托盘/窗口生命周期"事件行为契约"测试缺失；行为回归只能靠人工发现。
4. **回归保护测试**：`system-tray.test.js` 新增 (a) init 不注册 minimize 拦截（防重新引入）；(b) 双击托盘图标恢复+显示（保持托盘恢复能力）。
5. **预防措施**：为窗口事件行为补测试契约；CHANGELOG 记录；评审清单中增加"托盘/窗口生命周期行为变更须带行为契约测试"。

## 方案（用户确认：方案A）
- 删除无条件 minimize→托盘 拦截；最小化恢复系统常规行为。
- 保留 close→tray（运行中流水线 + 托盘可用）不变（window-close-policy.js + window.js close handler）。

## 验收标准
- [ ] system-tray.js 不再对 minimize 事件 preventDefault/hide
- [ ] close→tray 行为不变（window-close-policy 测试仍通过）
- [ ] 新增回归测试通过；system-tray/window/window-close-policy 相关套件全绿
- [ ] eslint 0 error
