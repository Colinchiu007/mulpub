# 账号云同步的落点是业务 API，不是运营中心

账号云镜像需要"按登录用户归属"，所以落在 `packages/api-publish-engine` 的新端点 `/api/v1/me/accounts`（Postgres + Logto 身份 + 既有 `Authorization: Bearer` + `X-Device-Id` 客户端封装）。运营中心 `ops-center/backend` 虽有四个"本地→云端 POST ingest"先例（publish/usage/diagnostics/feedback），但它是配置下发与脱敏聚合域、鉴权是静态 `X-Catalog-Key`，把用户私有账号数据放进去归属维度天然缺失。

## 备选方案

- 落 `ops-center`：复用现成 ingest 模式最快，且运营者能在后台直接看账号列表；被否决，因为账号是用户私有数据，运营域没有用户身份这一维。
- 落 `platform-orchestrator`（`cloud-publisher.js` 在用的 `ORCHESTRATOR_URL`）：未取证其是否有可建表的数据库，风险不可控。

## 后果

本仓库的 `python-backend` 仍是本地唯一真源，云端只是从属镜像；跨库一致性由客户端同步流程负责，服务端之间不互相引用。
