# Tasks: heygen-adapter-contract

| # | 任务 | 判据 |
|---|---|---|
| T1 | 先改测试：`generateVideo` 断言官方对象形状 + `dimension` + `X-Api-Key` | 旧实现下测试必须 RED（证明锁有效） |
| T2 | 先改测试：`getVideoStatus` 断言 `/v1/video_status.get?video_id=`，且不含 `/v2/video/status` | 旧实现下 RED |
| T3 | 实现 adapter 契约修正（请求体/轮询/认证头/`testConnection`） | 定向测试全绿，既有错误分类测试不回归 |
| T4 | 真实 Key 到位后的最小实跑（不在本轮范围，留待执行） | 真实账号跑出 1 条成片 + `video_url` 可下载 |
| T5 | 门禁：lint、max-lines、QM-1 打包 | 全绿 |
| T6 | 执行记录 + CHANGELOG 条目 + PR | `openspec/records/heygen-adapter-contract.md` |
