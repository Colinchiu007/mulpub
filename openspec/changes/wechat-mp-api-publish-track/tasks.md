# 任务（wechat-mp-api-publish-track）

## 1. 文档与规格

- [x] `proposal.md` / `design.md` / `specs/**/spec.md` / `tasks.md`
- [x] `01-docs/PRD-WECHAT-MP-API-TRACK-2026-10-12.md`（功能逻辑 / 数据校验 / 流程 / 交互与显示项 / 提示文字 / 验收标准）
- [ ] `CHANGELOG.md` 收口
- [ ] `.quality-gates.md` 执行记录（含远程同步 PENDING + 台账登记）

## 2. TDD（先红后绿）

- [ ] `packages/api-publish-engine/test/wechat-mp-session.test.js`
      - 会话正则逐字段（token/nick_name/uin/user_name/ticket）
      - token 缺失 ⇒ `needRelogin`（反证：把判据删掉必须变红）
      - 群发保护判据三态：无 `wx.cgiData` ⇒ 放行 / `protect_status:1` ⇒ 拦 / `protect_status:0` ⇒ 放行
- [ ] `packages/api-publish-engine/test/wechat-mp-assets.test.js`
      - URL 轨：命中 `uploadimg2cdn`，`t=ajax-editor-upload-img`，`imgUrl` 被编码
      - 本地文件轨：命中 `filetransfer`，`action=upload_material` 且 `scene=8`，`ticket_id`/`ticket` 来自会话
      - 回包无 URL ⇒ 抛 `cover-upload-failed`（反证：改成"回退用输入路径"必须变红）
- [ ] `packages/api-publish-engine/test/wechat-mp-draft.test.js`
      - `buildDraftBody` 纯函数：字段名带序号、值被 `encodeURIComponent`、封面 5 槽位同值
      - `content_source_url` ⇒ `sourceurl0`；非 http 开头不写
      - 评论三态映射（关闭 / 仅粉丝 / 仅粉丝N天 / 所有人）
      - `createDraft`：顶层参数齐全；`ret==="64714"` ⇒ `originality-required`；无 `appMsgId` ⇒ `draft-not-created`
      - `readbackDraft`：标题/正文/封面三项判据各自可反证
- [ ] `packages/api-publish-engine/test/wechat-mp-adapter.test.js`
      - **回归锁（本 PR 的核心）**：`publish()` 不再打 `appmsgpublish?sub=list`；
        无 `appMsgId` 时**必须** `success:false`（反证：恢复旧实现必须变红）
      - `contentList.length > 1` ⇒ `multi-article-unsupported`
      - 封面本地路径 ⇒ 走 multipart；封面 URL ⇒ 走 uploadimg2cdn
- [ ] `apps/desktop/electron/services/wechat-mp-dom-guard.test.js`
      - 群发保护：`massSend` 未开 ⇒ **不发请求**；开了且 protect_status=1 ⇒ 返回可操作文案
      - `fillSourceUrl`：命中候选 ⇒ 填值并派发事件；无候选 ⇒ 返回 `{filled:false}` **不抛**
      - 非 http(s) 输入不填

## 3. 实现

- [ ] `packages/api-publish-engine/src/adapters/wechat-mp/session.js`
- [ ] `packages/api-publish-engine/src/adapters/wechat-mp/assets.js`
- [ ] `packages/api-publish-engine/src/adapters/wechat-mp/draft.js`
- [ ] 改写 `packages/api-publish-engine/src/adapters/wechat_mp.js`（接线 + 消灭假成功）
- [ ] `apps/desktop/electron/services/wechat-mp-dom-guard.js`
- [ ] `apps/desktop/electron/services/rpa-view-platforms.js` 接线 ≤4 行（该文件 `targets=1476`，当前 1469）
- [ ] 草稿保存失败文案映射（原创性 / 群发保护）落到既有公众号模块

## 4. 变异反证（每条都要实跑变红）

- [ ] M1 删掉「无 appMsgId 即失败」⇒ 适配器测试变红
- [ ] M2 把 `createDraft` 端点换回 `appmsgpublish?sub=list` ⇒ 适配器测试变红
- [ ] M3 封面 5 槽位只写 `cdn_url0` ⇒ draft 测试变红
- [ ] M4 会话缺 token 时返回空 token 继续 ⇒ session 测试变红
- [ ] M5 群发保护预检在未开群发时也发请求 ⇒ dom-guard 测试变红
- [ ] M6 `readbackDraft` 去掉正文长度判据 ⇒ draft 测试变红

## 5. 门禁与静态检查

- [ ] `node .github/scripts/check-max-lines.js`（新文件 ≤500；`rpa-view-platforms.js` ≤1476）
- [ ] `pnpm run lint` 0 error
- [ ] `node scripts/check-text-encoding-integrity.js` / `check-no-brand-residue.js`（文档里不得出现参考产品真名）
- [ ] locale-sync（本 PR 无 locales 变更，须证明确实没有）
- [ ] `node scripts/check-unwired-tests.js`（新测试文件必须被登记）
- [ ] `node scripts/check-pr-exec-record.js --base=origin/main --head=HEAD --mode=enforce`
- [ ] `openspec/records/wechat-mp-api-track.md`（含 `sync_*` 三字段 + 远程同步行）

## 6. 交付

- [ ] 推送分支 + 开 PR
- [ ] CI 全绿后 `gh pr merge --squash --delete-branch`
- [ ] 回填远程同步 PASS + merge SHA + 删 `sync_*` + 销账（同一次提交）
- [ ] worktree 按 R1-R7 清理

## 7. 真机门槛（本 PR 不闭合，如实记录）

- [ ] 真机验证 API 轨（需可用公众号账号）：导出 `loginpage` HTML 核对正则命中、真发一条图文核对草稿三项齐全
- [ ] 真机验证后决定是否把 `platforms.yaml` 的 `wechat_mp` 切到 `has_api:true` / `api-then-dom`
- [ ] 复核 `api-then-dom` 的「回读不一致 ⇒ DOM 降级 ⇒ 可能重复草稿」取舍（需产品决策）
