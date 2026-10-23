---
record: wechat-pay-env-convention
task: 支付凭据独立成文件（deploy/payment/wechat-pay.env），与 Logto 的 api.env 分离
date: 2026-10-23
---

# 支付凭据该注入到哪个文件

## 1. 用户的一个质疑把设计问对了

用户反问：

> `deploy/logto/api.env` 不是给第三方用户系统 Logto 用的吗？微信支付商户的信息一定要混在一起吗？不是应该有单独一个 env 文件才更合理吗？

**他是对的。** 三件事混在了一起：

| 事实 | 问题 |
|---|---|
| `deploy/logto/api.env` 其实装的是**业务 API 自己**的环境（Logto / PostgreSQL / entitlement），目录名是历史遗留 | 名字误导，让人以为它是"Logto 的配置" |
| 上一版把微信商户凭据写进了这个文件 | 域混了：改身份认证的人手上握着商户私钥 |
| 轮换支付密钥要动身份认证的配置文件 | 变更半径无谓放大 |

## 2. 拆分方案

支付凭据独立成 `deploy/payment/wechat-pay.env`（模板 `deploy/payment/wechat-pay.env.example`）。

启动时传**两个** `--env-file`（Docker Compose v2.24+ 支持多文件，后者覆盖前者；本机 v5.1.4 实测通过）：

```bash
docker compose -f packages/api-publish-engine/docker-compose.yml \
  --env-file deploy/logto/api.env \
  --env-file deploy/payment/wechat-pay.env \
  up -d
```

| 文件 | 装什么 |
|---|---|
| `deploy/logto/api.env` | 业务 API 自身：`LOGTO_*` / `BUSINESS_DATABASE_URL` / `ENTITLEMENT_*` |
| `deploy/payment/wechat-pay.env` | **只有**微信商户：`PAYMENT_PROVIDER` + 10 个 `WECHAT_PAY_*` |
| 根 `.env.example` | 本地开发直接 `node` 跑时用（不进容器） |

三份模板的定位已写进各自文件头，避免下一个人再问同样的问题。

## 3. 拆分引入的新风险，以及怎么堵

**漏传第二个 `--env-file`** 时：`PAYMENT_PROVIDER` 读不到 ⇒ 退回 `none` ⇒ 前端显示「支付通道暂未开放」。

而改造前的 `payment-preflight` 在 `none` 时是 **SKIP + 退出码 0** —— 这个错误会**静默通过预检**。

新增判据（`payment-preflight.js`）：

> 若 `PAYMENT_PROVIDER=none` 但**任意一个** `WECHAT_PAY_*` 有值 ⇒ **FAIL**，
> 文案直接点名「多半是漏了第二个 `--env-file`（deploy/payment/wechat-pay.env）」。

把"拆分带来的操作风险"变成可执行检查。

## 4. gitignore（防私钥入库）

```gitignore
deploy/payment/wechat-pay.env*
!deploy/payment/wechat-pay.env.example
deploy/logto/api.env*
!deploy/logto/api.env.example
deploy/logto/.env
```

**为什么 `*` + 取反**：`api.env~` / `.bak` / `.swp` 这类编辑器备份同样含私钥；但只写 `api.env*` 会把模板一起忽略，模板就再也进不了库。

实测：

| 路径 | 期望 | 实测 |
|---|---|---|
| `deploy/payment/wechat-pay.env` | 忽略 | rc=0 |
| `deploy/payment/wechat-pay.env~` | 忽略 | rc=0 |
| `deploy/payment/wechat-pay.env.example` | **不忽略** | rc=1 |
| `deploy/logto/api.env.example` | **不忽略** | rc=1 |

## 5. 判据

| 测试 | 例数 |
|---|---|
| `payment-env-passthrough.test.js` | **7**（新增：支付模板键集合 与 compose 透传集合**双向**相等；gitignore 四条） |
| `payment-preflight.test.js` | **23**（新增 3：半配置 FAIL / 纯 none 仍 SKIP / 只填 NOTIFY_URL 也算半配置） |

### 变异反证（四条，均双向）

| 变异 | 结果 |
|---|---|
| 收窄 `.gitignore` 为 `api.env`（丢备份覆盖） | 5 pass / 1 fail |
| 删掉模板取反 `!api.env.example` | 5 pass / 1 fail |
| 去掉半配置检测（`if (strayKeys.length)` → `if (false)`） | 21 pass / 3 fail |
| 支付模板少声明一个键 | 6 pass / 1 fail |

均逐字节还原 True。

## 6. 两条自查出来的假绿（评审都没提）

| # | 假绿形态 | 修正 |
|---|---|---|
| 1 | 反向断言「模板必须**不**被忽略」用 `git check-ignore`（**默认跳过已跟踪文件**）⇒ 永远不可能失败 | 加 `--no-index`，按纯模式匹配判定 |
| 2 | 集合断言只查「模板 ⊆ compose」，模板**少一个键**时 `missing` 为空 ⇒ 假绿 | 补反方向「compose 里的支付键 ⊆ 模板」 |

> 同一个教训出现两次：**断言的形状对，但判据域选错，就永远红不了**。

## 7. 外部评审（1 Critical + 1 High）

| # | 意见 | 核验 | 处置 |
|---|---|---|---|
| 1 | Critical：`assert.doesNotThrow(execFileSync(...))` 在 git 缺失时**空过** | **不成立** —— `execFileSync` 在 ENOENT / 非零退出时都会**抛**，`doesNotThrow` 会红 | 仍改为 `spawnSync` + 显式退出码（0 命中 / 1 未命中 / 其它或 null = 判据故障也红） |
| 2 | High：只匹配精确文件名，备份文件未覆盖 | 成立 | `*` + 取反 |
| 3 | Medium：`deploy/logto/.env` 只靠全局 `.env` | 成立 | 显式一条 |
| 4 | Low：模板缺「不要填真实值」横幅 | 成立 | 加两行横幅 |

## 8. 仍未做

| 项 | 阻塞 |
|---|---|
| E2E-1~7 真机执行 | 商户凭据填进新文件 + 商户平台回调配置 + 公网域名 |

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
