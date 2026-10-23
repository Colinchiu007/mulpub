---
record: payment-reconcile-params
task: 修复对账脚本在真实 PostgreSQL 上必失败（占位符与绑定参数不匹配）
date: 2026-10-23
---

# 对账脚本一条 SQL 都跑不出来

## 1. 现象

在生产容器里跑 `node scripts/payment-reconcile.js`：

```
PAYMENT_RECONCILE_FAILED: could not determine data type of parameter $1
```

不是某一条判据失败，是**整脚本一条 SQL 都没跑成**。

## 2. 根因

脚本原来的约定写在注释里：

> `sql` 约定两个参数：`$1` = 起始时间，`$2` = LIMIT（未使用时也照样传，**PG 允许多余参数绑定**）。

**这句话是错的。** 五条判据里有两条的 SQL 只写了 `$2`、完全没出现 `$1`：

| 判据 | 用到的占位符 |
|---|---|
| `paid-without-entitlement` | `$1` + `$2` |
| **`entitlement-without-paid-order`** | **只有 `$2`** |
| `event-processed-order-pending` | `$1` + `$2` |
| `paid-order-without-event` | `$1` + `$2` |
| **`stuck-processing`** | **只有 `$2`** |

调用点统一传 `[since, limit]`，于是 PostgreSQL 收到一个**从未在语句里出现**的 `$1`——
它无法推断类型，直接报 `could not determine data type of parameter $1`。

## 3. 为什么测试没抓到（逃逸分析）

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 假 client 是 `async query (sql, params) { calls.push({sql, params}); ... }` —— **把参数数组原样收下，从不校验个数**。多绑一个它照收。 |
| 集成测试 | 没有连真库的用例；`payment-reconcile` 全是逻辑判定测试。 |
| 手工验证 | 原 PR 只跑到「dry-run 输出结构正确」，没在真实 PG 上执行过。 |

**系统性漏洞**：假对象只记录不校验，等于把「SQL 与参数是否自洽」这条**完全交给运行期**。
同型风险在 `payment-preflight` 的 schema 检查（`() => ({rows:[...]})`）上也存在，但那处已被
「零行也算缺失」的判据补过。

## 4. 改法

1. 每条判据新增 `params` 声明自己绑几个参数：`['since','limit']` 或 `['limit']`；
2. 两个只用 LIMIT 的判据把 `LIMIT $2` 改成 `LIMIT $1`（占位符从 `$1` 连续编号）；
3. 调用点按声明绑定：`check.params.map((name) => name === 'since' ? since : limit)`；
4. **装配期自检**：模块加载时遍历 CHECKS，断言每条 SQL 的占位符集合恰好是 `1..params.length`，
   不满足直接抛 `PAYMENT_RECONCILE_SQL_PARAM_MISMATCH` —— 这类错误漏到线上是整条 SQL 失败，
   没有任何部分结果，所以必须在加载期就炸。

## 5. 判据（payment-reconcile.test.js，28 例）

新增两条：

1. **每条判据的占位符必须从 `$1` 连续编号，且与 params 声明一致** —— 逐条比对
   `[...new Set(sql.matchAll(/\$(\d+)/g))]` 与 `1..params.length`，同时校验绑定值与类型；
2. **严格假 client：占位符个数与绑定个数不等就当场红** —— 把「假对象只记录不校验」这个逃逸口堵上。

### 变异反证

| 变异 | 结果 |
|---|---|
| 把某条判据的 `LIMIT $1` 改回 `$2` | 装配期自检抛错 + 用例红（占位符不连续） |
| 把调用点改回 `[since, limit]` | 严格假 client 红（绑 2 个、SQL 只用 1 个） |

## 6. 真库验证（2026-10-23）

把修好的脚本只读挂载进生产容器，对真实库执行：

```bash
docker run --rm --network multi-publish-logto_default \
  --env-file /etc/multi-publish/secrets/wechat-pay.env \
  --env-file <release>/secrets/api.env \
  -v /tmp/payment-reconcile-fixed.js:/app/packages/api-publish-engine/scripts/_rec.js:ro \
  --entrypoint node <image> scripts/_rec.js --json
```

结果：**五条判据全部返回**，count 均为 0（当前无真实支付订单），rc=0。
修复前同一位置报 `could not determine data type of parameter $1`。

## 7. 教训

**「PG 允许多余参数绑定」这类断言必须实测**，不能凭印象写进注释——注释会被下一个人当规格照抄。
另一个是**假对象只记录不校验**的通用形态：它让「调用方与被调方的形状契约」完全无人守门，
而真库只在生产才会揭穿。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
