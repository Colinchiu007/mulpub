---
record: fix-orders-billing-continue-pay-flake
task: 修掉「继续支付」契约用例把异步 chunk 加载轮数写死导致的 flake（主干 Electron CI 偶发红）
date: 2026-10-23
branch: fix-orders-billing-continue-pay-flake
---

# 「继续支付」契约用例的 flake：把 runner 速度写进了断言

## 1. 现场

2026-10-23 主干 `98558636e`（#4329 的 merge）的 `Electron CI` 红了，失败格子是 `electron-tests`
（run `39943401558` / job `120385261113`），唯一失败用例：

```
FAIL  src/views/member-center/OrdersBilling.test.js > OrdersBilling
      > 继续支付：主进程收到该订单的 orderId（复用同一订单，不新建）
AssertionError: 点「继续支付」必须发起复用下单请求: expected undefined to be truthy
  ❯ src/views/member-center/OrdersBilling.test.js:88:1
```

而 `Electron CI` 是 required 的 `Gate Result` 的输入 ⇒ 主干一红，**所有 open PR 一起被挡住**。
实测 `check-main-red.js` 的读数：`verdict=STOP_MAIN_RED exit=2 main=9e95b7fe5 prFail=0 mainFail=1`。

## 2. 归因：不是回归，是 flake

主干 `Electron CI` 结论序列（`actions/workflows/305741872/runs?branch=main`）：

| 主干提交 | 对应 PR | Electron CI |
|---|---|---|
| `7718f8987` | #4310 | **success** |
| `98558636e` | #4329 | **failure** |

两个提交之间的**全部**差异只有 3 个文件，且**没有一行源码或测试改动**：

```
 ...bffedaa510f5ad63ec6271e4ca3cea53352cb696ee.json | 57 ++++++++++++
 .github/scripts/max-lines-baseline.json            |  2 +-
 openspec/records/maxlines-target-bump.md           | 65 +++++++++
```

（#4329 只做了一件事：把 `rpa-view-platforms.js` 的点名还账目标从 1484 上调到 1497。）
⇒ 同一份代码、同一条用例，**上一次绿、这一次红** ⇒ 只能是环境/时序差异 ⇒ flake。

## 3. 根因：用例把「异步 chunk 要几轮事件循环才能挂载」写死成了 2

用例原写法：

```js
await wrapper.get(`[data-testid="order-continue-${ORDER_PENDING.id}"]`).trigger('click')
// defineAsyncComponent 需要两轮微任务才解析出弹窗，之后它才会在 start() 里发下单请求
await flushPromises()
await flushPromises()
const orderCall = invokeMock.mock.calls.find(([method]) => method === 'wechatPayCreateOrder')
expect(orderCall, '点「继续支付」必须发起复用下单请求').toBeTruthy()
```

被测链路：点「继续支付」→ `payOpen = true` → `<WeChatPayDialog>` 是 `defineAsyncComponent`，
**它的 chunk 要加载 + transform 完才挂载** → 挂载后 `watch(() => props.open, …, { immediate: true })`
才会调 `start()` → `start()` 里才发 `wechatPayCreateOrder`。

产品侧两条路径都是对的（组件若在点击前挂载，靠 `open` 变化触发；若在点击后才挂载，靠 `immediate` 触发），
**缺陷在用例**：它假设「两轮 `flushPromises()` 足够把异步组件解析出来」。
这个假设只在 chunk 已被 transform 缓存时成立——Windows runner 上模块还没 transform 完时，
两轮不够，弹窗尚未挂载 ⇒ `wechatPayCreateOrder` 根本没发出去 ⇒ `orderCall` 是 `undefined` ⇒ 红。

## 4. 改法

用仓内既有范式 `vi.waitFor`（全仓已有 117 处）**等条件成立**，而不是猜事件循环转了几轮：

```js
await vi.waitFor(() => {
  expect(
    invokeMock.mock.calls.some(([method]) => method === 'wechatPayCreateOrder'),
    '点「继续支付」必须发起复用下单请求'
  ).toBe(true)
}, { timeout: 10000, interval: 50 })
```

断言强度不变：仍然要求「点了继续支付就必须发出带 orderId 的复用下单请求」，
payload 断言（`{ plan, period, orderId }`）原样保留。

## 5. 验证（本地真跑，四个场景全用**仓库真实文件**）

本地测试台：`/root/vt`（vitest 4.1.12 + @vue/test-utils + jsdom，源码副本来自本仓，
`@` 别名指向 `apps/desktop/src`；`test-setup.js` 里三个全局组件换成最小替身以避开
`@element-plus/icons-vue` 与 `@/i18n` 依赖链，其余装配与本仓一致）。

| # | 用例文件 | 变异 | 期望 | 实测 |
|---|---|---|---|---|
| ① | 修复版 | 无 | 绿 | **7 passed** |
| ② | 修复版 | chunk 多花 50ms 才 resolve | 绿 | **7 passed** |
| ③ | **原版** | chunk 多花 50ms 才 resolve | 红 | **1 failed**，断言消息 `expected undefined to be truthy`——**与主干失败一字不差** |
| ④ | 修复版 | 摘掉 `wechatPayCreateOrder` 调用 | 红 | **1 failed**（10s 超时，`expected false to be true`） |

- ③ 是**复现**：原版在慢 chunk 下以与 CI 完全相同的断言消息失败 ⇒ 根因坐实。
- ④ 是**锁有牙齿**：把「点了没反应」这个产品缺陷注入回去，修复后的用例仍然红 ⇒
  修好的不是「让断言消失」，断言仍守着同一件事。

## 6. 门禁

- `check-text-encoding-integrity`：本文件未引入 U+FFFD（提交前已 grep）
- `check-max-lines`：只动一个测试文件，未触「点名还账」清单
- `check-gate-record-debt`：本文档即执行记录载体，状态列写「由门禁推导」
- `classify-docs-only`：含 `.test.js` 改动 ⇒ 非 docs-only，走全量门禁
- `check-pr-exec-record`：本 PR 携带执行记录 ⇒ 通过

## 7. 遗留与后续

- **主干当前仍是红的**（`98558636e` 的 `electron-tests` 失败）。已对 run `39943401558` 发起
  `rerun-failed-jobs`（`run_attempt=2`）：本 PR 的改动不改变那条用例的判定，重跑绿了即主干转绿。
- 仓内还有 1 处同型写法（`src/components/WeChatPayDialog.test.js:42` 用可控 promise 把组件钉在
  loading 态），**那一处是有意为之**，不是同类缺陷，未改。
- 本次只修这一条用例。`grep -rn "两轮微任务"` 在 `apps/desktop` 下命中 2 处，另一处是
  `sidebar-collapse-chain.test.js:77`（preload.invoke 链，**不涉及异步组件**），同样未改。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
