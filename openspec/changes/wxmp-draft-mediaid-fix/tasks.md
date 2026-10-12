# Tasks — wxmp-draft-mediaid-fix

> 真机边界：本机无可用公众号账号会话，`appmsg_edit_v2` 保存后 URL 是否真的不跳转
> **未实测**（依据见 design.md §1.1 的三条旁证）。§7 保留该门槛。

## 1. 复现与根因（QM-5 ①）

- [x] 读码取证：保存段 mediaId 只从 URL / 响应 URL 两处取（修复前 `rpa-view-platforms.js` L1173-1184）
- [x] 读码取证：`readEditorToast` 无可见性判据（`wechat-mp-dom-guard.js` L110-120）
- [x] 实测取证：`innerText` 对 `display:none` / 离屏节点照样返回文本（Playwright fixture）
- [ ] 真机复现：用运行中的应用发一条图文，导出保存请求响应体验证 `appMsgId` 字段名（无会话，PENDING）

## 2. 契约层（先测试后实现）

- [x] `wechat-mp-draft-mediaid.test.js`：三条通道、`appMsgId=0` 不认、畸形 body 不抛、可见性守卫、可操作文案
- [x] `wechat-mp-draft-mediaid.js`：`saveWechatMpDraft` / `buildVisibleToastScript` / `extractAppMsgIdFromBody` / `describeSaveFailure`

## 3. 接线（主进程）

- [x] `rpa-view-platforms.js`：保存段下沉到新模块（含 fail-closed 与文案）
- [x] `rpa-view-platforms.js`：新增 `readVisibleEditorToast`；群发/发布段 toast 读取也切可见性判据
- [x] 行数门禁：`rpa-view-platforms.js` 1483 → 1415 行（targets 登记 1484 / 容差 0）

## 4. 变异反证

- [x] M1 摘响应体通道 → 2 红
- [x] M2 不拒 `appMsgId=0` → 1 红
- [x] M3 去可见性守卫 → 3 红
- [x] M4 去可操作提示 → 2 红

## 5. 文档与证据

- [x] `01-docs/PRD-WECHAT-MP-ARTICLE-PUBLISH-2026-10-12.md` §11–§19（第二部分）
- [x] `openspec/changes/wxmp-draft-mediaid-fix/`（proposal / design / tasks）
- [x] `openspec/records/wxmp-draft-mediaid-fix.md`
- [x] `CHANGELOG.md`
- [x] `.quality-gates.md` 本次执行记录

## 6. 门禁

- [x] 相关域测试 7 文件 152 例全绿
- [ ] desktop 全量 vitest（跑完再填）
- [x] `node .github/scripts/check-max-lines.js`
- [ ] QM-1 打包（`electron-builder --win --dir`）
- [x] ESLint

## 7. 真机复核（交付门槛，未完成即标注 PENDING）

- [ ] 真机发一条图文，抓 `/cgi-bin/operate_appmsg` 保存请求，确认响应体字段名是 `appMsgId`
- [ ] 若字段名不同 ⇒ 只改 `wechat-mp-draft-mediaid.js` 的 `D3` 键名表（不动判据）
- [ ] 真机核对草稿箱出现该图文，且历史记录为 success
- [ ] 若 `_waitForResponse` 拿不到 body ⇒ 评估是否给 `_waitForResponseExclusive` 补 CDP `Network.getResponseBody`
