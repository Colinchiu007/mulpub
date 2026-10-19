# 本次执行记录：失败行进度的「解法入口」可点链接（publish-gate-help-ui，2026-10-19）【混合 PR】

- 分支：`publish-gate-help-ui`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前置链：#3960（CSRF `2cdb761af3`）→ #3971（账号闸门订正 `0a9c83ae95`）→ #3977（账号未完善检测，引擎侧）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.7.5（本轮把「UI 未接线」关闭）

## 一、这轮补的是上一轮的欠账

上一轮（#3977）只交付了**引擎侧数据**（失败结果里带 `helpUrl`），界面上仍是纯文本 ——
用户看得到「账号信息未完善」，但**点不到去哪里解决**。本轮把它接上。

## 二、真正的断点不在引擎，在结果收敛器

原以为「引擎返回 helpUrl → 界面渲染」就完了。实测读了链路才发现中间有一道**字段收敛**：

```js
// packages/api-publish-engine/src/publish/core/publish-mode-runner.js
const base = { platform, mode, degraded: false, reasonCode: REASON.ok }
...
return Object.assign(base, { track: 'api', success: false, reasonCode, stopped: true,
                             error: apiRes && apiRes.error, code: apiRes && apiRes.code, ... })
```

它**重建对象**、只挑 `error` / `code` 等少数字段往下传 ⇒ **新增字段 `helpUrl` 默认不透出**。

所以本轮的接法是：渲染层**不依赖 `helpUrl` 透传**，改为用**稳定失败码**反查链接。
好处是跨层只依赖一个已经在传的字段（`code`），不会因为收敛器将来再挑字段而静默失效。

## 三、改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/shared-utils/src/publish-gate-help.js` | **新增**（CJS，主进程）：`PUBLISH_GATE_HELP` 表 + `helpForCode(code)` |
| `packages/shared-utils/src/publish-gate-help.browser.js` | **新增**（ESM，渲染进程）：同一张表（浏览器不能执行 CJS，本仓既有双份先例） |
| `packages/shared-utils/test/publish-gate-help-parity.test.js` | **新增 8 例**：两份逐字段一致 + **与引擎常量一致** + url 合规 + 未知码返回 null |
| `apps/desktop/src/stores/publishProgress.js` | 任务态新增 `code` 字段（初始 null；进度事件 `data.code` 落盘）。主进程 `phase4-events` 本来就发 `code: task.errorCode`，此前渲染层把它丢了 |
| `apps/desktop/src/components/PublishProgressTaskRow.vue` | 失败行在**有对应表项时**渲染可点链接：`href` 过 `safeHttpUrl`、`target="_blank"`、`rel="noopener noreferrer"`；文案走 i18n |
| `apps/desktop/src/locales/publish-page/{zh,en}.js` | 成对新增 `publishFlow.gateHelp.{accountNotVerified,noPublishPermission}` |
| `apps/desktop/src/components/PublishProgressTaskRow.gate-help.test.js` | **新增 5 例**（见下） |

## 四、为什么链接表要放在 `shared-utils` 而不是各写一份

三处都会用到同一个 URL：

1. `shared-utils` CJS（主进程）
2. `shared-utils` ESM（渲染进程）
3. `api-publish-engine` 的 `ACCOUNT_FIX_URL`（引擎侧 `helpUrl`）

第 3 处**不能** require 本包 —— `packages/api-publish-engine` 是**零 workspace 依赖运行时**
（见该包 `src/publish/category-resolver.js` 头注释、`package.json` 的 `files` 与 Docker COPY 清单）。
所以按同包先例（`cloud-accounts/validate-account.js`「按同一批形态规则重写 + 测试做 parity 锁」），
引擎自带常量，由 parity 测试**静态读源码**比对：

```js
const ENGINE_SRC = '.../toutiao-video-publish.js'
src.match(/const ACCOUNT_FIX_URL = '([^']+)'/)  ===  PUBLISH_GATE_HELP.ACCOUNT_NOT_VERIFIED.url
```

**为什么必须机械锁**：三处任一处漂移，用户会被送到**错页面**，而且**不会报错**（看起来一切正常）。

## 五、UI 判据（本仓既有契约，不是本轮自定）

`apps/desktop/src/href-scheme-contract.test.js` 有一条硬判据：
**成链点的 `v-if` 与 `:href` 必须取同一个判据表达式**（防二者分叉成「点了没反应的死锚点」）。

第一版我写成 `v-if="gateHelp"` + `:href="safeHttpUrl(gateHelp.url)"` ⇒ 当场被它判红。
按契约改成同一个表达式：

```html
<a v-if="safeHttpUrl(gateHelp.url)" :href="safeHttpUrl(gateHelp.url)"
   target="_blank" rel="noopener noreferrer">{{ gateHelpLabel }}</a>
```

无入口时 `gateHelp.url === ''`，`safeHttpUrl('')` 返回 `null` ⇒ 链接**根本不渲染**，
不会出现「点不动的链接」这种形态。

## 六、测试

| 用例 | 断言重点 |
| --- | --- |
| `ACCOUNT_NOT_VERIFIED` | 链接存在；`href` **精确等于** `https://mp.toutiao.com/profile_v4/personal/landing-type`；`target=_blank`；`rel` 含 `noopener` 与 `noreferrer` |
| `NO_PUBLISH_PERMISSION` | 同样给出入口（同一问题的另一条触发路径） |
| 无对应入口的码 | `null` / `undefined` / `''` / `TRANSIENT_ERROR` 等**一律不渲染链接** |
| 非 failed 相位 | `success` / `start` / `progress` / `queued` **不渲染** |
| 文案不泄漏 | 链接文本非空，且**不含** `publishPage.` / `gateHelp`（不得把 i18n key 原样显示） |

## 七、门禁读数

| 项 | 读数 |
| --- | --- |
| `shared-utils` parity | **8 passed** |
| `PublishProgressTaskRow.gate-help` | **5 passed** |
| 受影响的桌面 4 个测试文件 | **91 passed**（含 `href-scheme-contract`） |
| `check-locale-sync --pair-base origin/main` | **PASS** |
| `check-locale-sync --cjk` | **PASS**（无新增硬编码，当前 1188 ≤ 基线 1331） |
| `check-max-lines` | **✅ 无新增超大文件** |
| `check-unwired-tests` | **OK**（108 个域内测试文件均已接线） |
| QM-1 `build:vue` | **rc=0**（39.8s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：stderr **0 字节** / stdout 21,999 字节 |


## 八、未闭合

1. **只在「进度面板」这一处渲染**。单篇发布流程（`usePublishFlow`）的失败 toast 仍是纯文本 ——
   它拿到的是 `publishBatch` 的入队响应（`code === 0`），平台失败是**异步**经进度事件回来的，
   所以那一条链要接就得改 toast 通道（`ElMessageBox` + VNode），本轮没动。
2. 表里目前只有头条两个码。其它平台的「账号状态类」失败若要接，往
   `publish-gate-help.js` / `.browser.js` **成对**加即可（parity 测试会强制两边一致）。
3. 链接「点进去是否一定能解决」未验证（该页面对未登录 / 其它账号的行为未知）。

## 九、远程同步

| 远程同步 | 由门禁推导 |
