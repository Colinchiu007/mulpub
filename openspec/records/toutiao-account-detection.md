# 本次执行记录：头条账号未完善的提交前检测 + 平台解法链接（toutiao-account-detection，2026-10-19）【混合 PR】

- 分支：`toutiao-account-detection`（worktree：`<仓库父目录>/mp-worktrees/mp-video-publish-4`，非 C 盘）
- 前序：#3960（头条 CSRF `2cdb761af3`）、#3971（头条账号闸门订正 `0a9c83ae95`）
- 关联 PRD：`01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md` §12.7（本轮新增）

## 一、能不能在发布时检测到「头条号没完善信息所以发不了」——能

**能，而且不需要等提交失败**。判据是 `GetPublishAuth.authorPermission.IsIdentifyAuth`：

真机读数（活会话、只读、零副作用）：

```
identityVerified = false    canPublish = true    blockStatus = 0
→ 闸门结果 ACCOUNT_NOT_VERIFIED
→ helpUrl = https://mp.toutiao.com/profile_v4/personal/landing-type
```

关键点：**`DisablePublish` / `BlockStatus` 在这种账号上仍是 `false` / `0`**，
所以它们**不能**用来判断「能否发布」；`IsIdentifyAuth` 是目前唯一的提交前信号。

## 二、解法链接用的是头条自己的页面，不需要新建飞书文档

真机录到的证据：发布页点「发布」→ 平台弹模态框「账号信息未完善」→ 点弹窗里的
**「去完善」**，实测弹出目标：

```
https://mp.toutiao.com/profile_v4/personal/landing-type
```

这就是**平台自己给用户的解法入口**（用户点进去即可完善），因此按「有现成的就用现成的」原则直接采用，
**不需要在飞书新建《汤姆鱼使用问题指南》**。另备二级入口：

```
https://mp.toutiao.com/profile_v4/personal/auth?enter_from=main_page   （头条认证页）
```

## 三、代码改动

| 文件 | 改动 |
| --- | --- |
| `src/publish/platforms/toutiao-video-publish.js` | 新增 `CODE_ACCOUNT_NOT_VERIFIED`、`ACCOUNT_FIX_URL`、`ACCOUNT_AUTH_URL`、`buildAccountNotVerifiedResult()`、`isAccountIncomplete()`、**`buildPublishGateResult()`**（把「无权限」与「账号未完善」两种不该提交的情形收敛到一处）+ 导出 |
| `src/publish/platforms/toutiao-video-probes.js` | `probePublishAuth` 把 `IsIdentifyAuth` 映射成 `identityVerified`（唯一新增行） |
| `src/publish/platforms/toutiao-video.js` | `run()` 把原来 12 行的「无权限」内联闸门换成 2 行 `buildPublishGateResult(auth)`（**净减 10 行**，496 → 491，避免撞 500 行硬闸） |
| `test/toutiao-video-chain.test.js` | 26 → **30 例**（见下） |

### 3.1 新增测试（4 例）

| 用例 | 断言重点 |
| --- | --- |
| 账号未完善 → `ACCOUNT_NOT_VERIFIED` | `helpUrl === ACCOUNT_FIX_URL` 且含 `mp.toutiao.com`；文案含「账号信息未完善」且**不含「未实名」**（不臆断） |
| 不误拦 | `identityVerified: true` / `null` / **字段缺省** 都必须返回 `null`（老响应没这个字段时不得当成 false 拦掉） |
| 两条闸门不互相覆盖 | `canPublish:false` 仍走 `NO_PUBLISH_PERMISSION` |
| `run()` 零上传中止 | 账号未完善时 **`Action=ApplyUploadInner` 请求数必须为 0**（不浪费一次真实上传） |

## 四、判据边界（如实标注）

1. `IsIdentifyAuth` 与弹窗文案「账号信息未完善」**是否完全等价未被单独证实**——
   弹窗用的是更宽的「账号信息」，所以**提示语只如实说「账号信息未完善」，不写「未实名」**。
2. 该闸门放在**上传之前**（拦在不该发生的上传之前），代价是：若平台日后允许「先传后补」，
   这里会提前拦一次。判断依据是当前真机行为（点击发布即被拦，与是否已上传无关）。
3. **UI 侧的「弹窗 + 可点链接」尚未接线**（见 §六）。

## 五、门禁读数

| 项 | 读数 |
| --- | --- |
| `test/toutiao-video-chain.test.js` | **30 passed**（26 → 30） |
| `packages/api-publish-engine` 全量 | **rc=0**（44 个 vitest 文件） |
| `check-max-lines.js` | **✅ 无新增超大文件**（`toutiao-video.js` 491 行） |
| 编码 / 品牌 / 绝对路径 / 记录债务 | **OK / PASS / PASS / OK**（10,498 / 4,280 文件） |
| QM-1 `build:vue` | **rc=0**（39.0s） |
| QM-1 `electron-builder --win --dir` | **rc=0** |
| QM-1 启动验证 | **PASS**：stderr **0 字节** / stdout 7,846 字节 |


## 六、还没做的（不假装）

**UI 的弹窗与可点链接尚未接线**。引擎已返回 `{ code, error, helpUrl, helpLabel }`，
但渲染层的发布失败走 `apps/desktop/src/composables/usePublishFlow.js` 的
`notifyFailure(title, body)` → `notifyError(...)`，目前只显示纯文本、不渲染链接；
且本仓有 `apps/desktop/src/href-scheme-contract.test.js` 约束外链的打开方式
（`setWindowOpenHandler → openExternalUrl → isAllowedExternalUrl` 白名单），
**不应在收尾阶段抢改**。下一步的接线点已定位：

1. `notifyFailure` 增加第三个参数 `help`（`{url,label}`）；
2. `res.code === 'ACCOUNT_NOT_VERIFIED'` 分支把 `helpUrl` 透传进来；
3. 用 `ElMessageBox.alert` 弹出（按钮触发跳转，**不用** `dangerouslyUseHTMLString`，避免 XSS 面），
   或按现有外链契约走 `openExternalUrl` 白名单（需先确认 `mp.toutiao.com` 在白名单内）。
4. 同步补 `locales/zh.js` / `en.js` 成对文案（Gate 7 locale-sync 要求成对）。

## 七、远程同步

| 远程同步 | 由门禁推导 |
