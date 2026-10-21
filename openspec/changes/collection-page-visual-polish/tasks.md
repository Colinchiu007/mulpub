# tasks：采集页视觉精致化（collection-page-visual-polish）

- [x] 1. 隔离 worktree（`start-mp-task.ps1 -TaskName collection-page-visual-polish`），依赖解析 OK
- [x] 2. PRD：`01-docs/PRD-COLLECTION-PAGE-VISUAL-POLISH-2026-10-20.md`（8 条取证根因 + 决策记录）
- [x] 3. TDD：`collection-page-visual-polish.test.js` 先写，18 例 / 15 红
- [x] 4. D1 删除面板饰带与 `@keyframes col-panel-ribbon`
- [x] 5. D2/D4 新增 `--col-card-gap: var(--spacing-3)`，间距收敛 4px 刻度
- [x] 6. D3 标题 clamp 2 行 + `line-height: 1.45` + `word-break`
- [x] 7. D5 卡片内按钮 28px/12px → 32px/13px
- [x] 8. D7 `.cohere-card` cursor 还原为 default
- [x] 9. D8 无效结果态：抽 `collected-result-validity.js` + 模板类/testid/提示行
- [x] 10. locale 成对新增 `collection.invalidResultHint`（zh 496 / en 495 行，未越 500）
- [x] 11. 变异反证 **8/8 捕获**（`mutate.cjs`，判据非恒真）
- [x] 12. 测试：采集域 + 视觉契约 + 页面测试 18 文件 / 380 例全绿；eslint 0 error
- [x] 13. 判据族：max-lines / debt-budget / brand-residue / doc-abs-paths / locale 三项 全 PASS
- [ ] 14. QM-4 视觉基线：按 CI 同源渲染回填（本轮改观感，基线必变）
- [ ] 15. openspec 归档 + CHANGELOG / learnings
- [ ] 16. PR + CI + 自动合并 + 收尾链

## 已知坑（本轮实测，已写入 learnings）

1. **edit 报成功但内容未落地**：`:title="item.title ..."` 首次 edit 返回成功，文件里却没有；
   随之而来的是测试"假绿"——我先前看到的 371 passed 里混着一次未落地的失败。
   **对策**：改完必须用 `Select-String` 回读验证，不能只信工具返回值。
2. **变异脚本的匹配串不能凭想象写**：v2 的 4 条变异因想象的串与文件不符被整体跳过，
   等于没跑反证。v3 改为先 `includes` 断言再替换。
3. **变异脚本的路径基准要一致**：`VALIDITY` 一度写成 `src/...`（apps/desktop 基准），
   而脚本跑在 worktree 根 ⇒ 读成空串 ⇒ 静默跳过。
4. **`String.replace` 只换第一处**：`min-height: var(--col-btn-h)` 在文件里出现两次
   （`:root` 变量区 + 按钮规则），不限位的变异会改错行，导致有效断言被误判为恒真。
