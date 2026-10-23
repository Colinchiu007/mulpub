---
record: wechat-pay-env-convention
task: 支付凭据注入落点：补 api.env 模板支付段 + 把 api.env 加入 gitignore
date: 2026-10-23
---

# 支付凭据该注入到哪个文件

## 1. 用户问的问题暴露了两个坑

用户问「凭据都在哪看、怎么注入本地 `.env`」。核对仓库后发现问题不在"怎么填"，而在**填错地方**：

| # | 坑 | 实测 |
|---|---|---|
| 1 | **生产用的不是根目录 `.env`** | 仓内既有约定是 `docker compose -f packages/api-publish-engine/docker-compose.yml --env-file deploy/logto/api.env up -d`（见 `01-docs/RUNBOOK-LOGTO-PRODUCTION.md:87`） |
| 2 | **`deploy/logto/api.env.example` 没有支付段** | #4249 只往根目录 `.env.example` 加了支付变量，生产模板漏了 ⇒ 照模板填的人**永远看不到** `WECHAT_PAY_*` |
| 3 | **`deploy/logto/api.env` 未被 gitignore** | `git check-ignore -v` rc=1。`.gitignore:330` 的 `.env` **只匹配名为 `.env` 的文件**，匹配不到 `api.env` |

第 3 条最危险：让用户把商户私钥填进一个**没有忽略规则**的文件，等于给"私钥入库"铺好了路。

## 2. 改法

| 文件 | 改动 |
|---|---|
| `.gitignore` | 新增 `deploy/logto/api.env`，并写明为什么 `.env` 那条盖不住它 |
| `deploy/logto/api.env.example` | 新增完整支付段（11 个变量 + 每个值的获取位置 + 证书路径的容器内语义） |
| `.env.example`（根） | 头部加一句：**本文件供本地 node 跑用；生产/compose 用 `deploy/logto/api.env`，两份都要填** |
| `test/payment-env-passthrough.test.js` | 新增回归锁：`git check-ignore deploy/logto/api.env` 必须命中 |

## 3. 回归锁为什么放在既有文件里

`payment-env-passthrough.test.js` 已经在比对 `.env.example` 与 compose 的支付键集合，属同一主题
（"支付凭据的落点与完整性"）。放这里不必新增 CI 接线，也不会有孤儿测试的风险。

判据：

```js
execFileSync('git', ['check-ignore', '-q', 'deploy/logto/api.env'], { cwd: root })
// rc=0 ⇒ 命中忽略规则；1 ⇒ 未忽略（抛错即红）
```

## 4. 判据

- `payment-env-passthrough.test.js` **6/6 通过**（原 5 例 + 新 1 例）
- 变异：删掉 `.gitignore` 里那行 → **5 pass / 1 fail**，新用例精确变红；逐字节还原 True
- `git check-ignore -v deploy/logto/api.env` → 命中 `.gitignore:335`

## 5. 给用户的注入步骤（与文档一致）

1. `cp deploy/logto/api.env.example deploy/logto/api.env`（该文件已被忽略）
2. 填 11 个支付变量 + 原有 Logto/DB 变量
3. 证书放 `packages/api-publish-engine/config/wechat-pay/apiclient_key.pem`
   （compose 把它 bind 到容器内 `/app/packages/api-publish-engine/config`，所以 `WECHAT_PAY_CERT_PATH` 要写**容器内路径**）
4. `docker compose -f packages/api-publish-engine/docker-compose.yml --env-file deploy/logto/api.env up -d`
5. 预检：`docker compose ... exec publish-api node packages/api-publish-engine/scripts/payment-preflight.js`

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
