## ADDED Requirements

### Requirement: 知乎发布成功判据必须是严格终态

知乎图文发布的成功判据 SHALL 只认**公开文章页**：URL 主机为 `zhuanlan.zhihu.com` 或 `www.zhihu.com`（大小写不敏感）、协议为 `http:` / `https:`、路径严格匹配 `^/p/(\d+)/?$`（**无 `/edit`、无其它尾段**；查询串与锚点允许）。任一不满足 SHALL 判为**未发布**。SHALL NOT 使用「URL 含 `/p/`」「含 `publish`」「含 `success`」「含 `article`」一类子串判据，SHALL NOT 保留「发布按钮消失即成功」的兜底出口（一个动作有两条成功出口时，判据的宽度等于两者之并）。

#### Scenario: 只落草稿（本次事故形态）

- **WHEN** 点击「发布」后 URL 为 `https://zhuanlan.zhihu.com/p/<id>/edit`
- **THEN** 判据 SHALL 判为**草稿编辑页**而非文章页；若确认流程最终未到达公开文章页，结果 SHALL 为 `success: false`

#### Scenario: 真发布成功

- **WHEN** 确认流程观察到 URL 严格等于 `https://zhuanlan.zhihu.com/p/<id>`
- **THEN** 结果 SHALL 为 `{success: true, url, platform: 'zhihu', postId: '<id>'}`

#### Scenario: 尾段与域名伪装

- **WHEN** URL 为 `/p/<id>/draft`、`/p/<id>/manage`、`/write`、`zhuanlan.zhihu.com.evil.example.com/p/<id>` 或 `javascript:…`
- **THEN** 全部 SHALL 判为**未发布**

### Requirement: 两段式发布必须补点且补点至多一次

知乎发布 SHALL 按两段式确认：先轮询等待公开文章页；**仅当确证停在草稿编辑页**时，才等待该页「发布」按钮并就绪后**补点一次**，再轮询公开文章页。补点的总次数 SHALL NOT 超过 1 次（合计至多 2 次「发布」点击）。若停在写作页或未知页面，SHALL NOT 补点（避免重复点击造出第二份草稿）。

#### Scenario: 草稿编辑页补点后成功

- **WHEN** 首段轮询结束时 URL 为 `/p/<id>/edit`，补点后 URL 变为 `/p/<id>`
- **THEN** 结果 SHALL 为 `success: true`

#### Scenario: 补点后仍未离开草稿页

- **WHEN** 补点一次后 URL 仍为 `/p/<id>/edit`
- **THEN** 结果 SHALL 为 `success: false`，reason SHALL 为 `draft-editor-still-not-published`

#### Scenario: 草稿页按钮缺失

- **WHEN** 停在草稿编辑页但「发布」按钮在时限内未就绪
- **THEN** 结果 SHALL 为 `success: false`，reason SHALL 为 `draft-editor-publish-button-missing`，且 SHALL NOT 发生点击

#### Scenario: 停在写作页

- **WHEN** 首段轮询结束时 URL 仍为 `https://zhuanlan.zhihu.com/write`
- **THEN** 结果 SHALL 为 `success: false`，reason SHALL 为 `unexpected-page`，且「发布」点击总数 SHALL 恰为 1

### Requirement: 未确认必须如实失败并给出机器可读原因

凡未确证到达公开文章页，`_publish_zhihu` SHALL 返回 `success: false`，并 SHALL 提供逐字形态的错误串 `zhihu: publish not confirmed (<reason>) url=<url>`，其中 `<reason>` 取值 SHALL 限于 `unexpected-page` / `draft-editor-publish-button-missing` / `draft-editor-still-not-published`。SHALL NOT 写入「已发布」发布记录；SHALL NOT 以 `post_id` 为空的形式留下一条成功记录。读 URL 抛错 SHALL 在状态机内收敛为空串（fail-closed：判据不成立即失败），SHALL NOT 冒泡为「发布失败」之外的其他语义。

#### Scenario: 失败串形态

- **WHEN** 确认为 `unexpected-page`
- **THEN** 返回的 `error` SHALL 为 `zhihu: publish not confirmed (unexpected-page) url=https://zhuanlan.zhihu.com/write`
- **AND** 日志 SHALL 含 `[WARN] RpaView [zhihu] publish not confirmed reason=unexpected-page url=<url>`

#### Scenario: 结构锁

- **WHEN** 实现被改成绕过确认状态机、自行拼接 URL 子串判据或恢复 `panelGone` 兜底
- **THEN** `apps/desktop/electron/services/rpa-view-platforms-zhihu-publish.test.js` 的结构锁 SHALL 变红

### Requirement: 知乎发布判据的回归夹具不得替实现作保

针对知乎发布终态的测试夹具 SHALL 使用**真实形态**的 URL（`/write` → `/p/<id>/edit` → `/p/<id>`），且 SHALL 至少包含一条「草稿编辑页 ⇒ `success: false`」的反例。SHALL NOT 用草稿编辑页 URL 断言成功（2026-09-29 的历史测试正是如此把缺陷锁成了契约，使后续任何改动都不会变红）。

#### Scenario: 夹具写反

- **WHEN** 有人把 `/p/<id>/edit` 的期望值改回 `success === true`
- **THEN** 该用例 SHALL 与判据实现冲突并变红，SHALL NOT 静默通过
