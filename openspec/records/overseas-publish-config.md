---
record: overseas-publish-config
task: 海外平台发布链第一刀——YouTube 改 fail-closed，并新增「发布后回读核验」层
date: 2026-10-24
---

## 本次执行记录：海外平台发布链第一刀（overseas-publish-config，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：分支 `overseas-publish-config`（裸 task 名，无斜杠）；沙箱内 clone 检出，非共享主目录 |
| 第一性原因（QM-5 ①） | ✅ | 旧 `_publish_youtube` 有 5 处 **fail-open**：上传超时只 warn 继续、发布按钮点不到仍返回 success:true、无「受众非儿童向」、无标签、无发布后回读。⇒ 平台侧「返回成功但内容没人看得见」的形态无法被区分 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸口是**把「点了发布按钮」当成「发出去了」**。helper 的 `_click` 恒返回 true 且不抛错 ⇒ 点击成功与否无法靠返回值判定 ⇒ 旧实现只能无条件 `return {success:true}`。修法：判据改落在**平台侧可回读的事实**（作品 URL / 作品 ID / 作者 ID / 正文）上 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `rpa-overseas/youtube.js`（fail-closed 14 步）+ `rpa-overseas/shared.js`（核验层）+ `rpa-overseas/youtube.test.js`（**35 例 / 6 组**，逐条钉住 5 个失败路径必须 `success:false`；含 4 条**宿主方法契约锁**） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 旧实现**迁出**而非复制（`rpa-view-platforms.js` 净减 80 行，欠债减债而非抬基线）② 海外链放独立目录 `rpa-overseas/`，不往点名还账文件里加行 ③ 选择器**按块**标注来源（`[真机]`/`[参考]`/`[推测]`），**未标注真机取证的选择器不冒充已验证** |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等（`rpa-view-manager.js` +6/-2、`rpa-view-platforms.js` -80、`config/platforms.yaml` +7）；删除 80 行**全部归因**：78 行 = 旧 `_publish_youtube` 迁出到 `rpa-overseas/youtube.js`；2 行 = `collectPublishIds`/`extractPublishIdsFromResponseBody` 两个**既有死 import**（eslint 确认 unused，顺手清理＝降债） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → RC=0（检查域内 133 个测试文件全部已接线）；`electron/services/**/*.test.js` 覆盖子目录 ⇒ 新测试文件**在 vitest include 白名单内**，无需改 config |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（新增独立目录 + 主进程服务层，无 UI 改动、无 asar 文件清单变化） |
| QM-6 CCG 双模型外部评审 | **未执行** | 本机无 `codeagent-wrapper`（外部评审引擎不在本仓），按规范如实记「未执行」，**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`） |

### 遗留（不假装已闭合）

- **TikTok / X / Instagram / Facebook 的专属发布链尚未实现**：本 PR 只交付 YouTube 一条。
  这四个平台仍走 `_publish_generic`，而通用链**没有「点创建/上传入口」这一步**
  （全仓 `create_btn`/`upload_btn` 零命中）⇒ 仍会在「找不到表单」处失败。
  ⇒ 已在 `rpa-overseas/selectors.js` 备好各平台选择器，但**本 PR 不加它们的 `publish_url`**：
  **配置与实现同批落地**，避免出现「配置说能发、实现仍不能」的半吊子状态误导后续维护者。
- **宿主方法契约锁（补漏）**：测试里 `publishYoutube` 依赖的宿主方法**全部被 mock**
  ⇒ 方法名拼错时测试仍全绿、只有真机才炸（「可加载 ≠ 能用」同型）。
  ⇒ 已补 4 条**读真实 mixin 源码**的结构锁（`_navigateAndWait` / `_waitForElement` /
  `_waitForCondition` / `_setFileInput` / `_setElementContentSafe` / `_click` / `_sleep` /
  `_fillInput` / `_getPlatformConfig` / `_emitProgress` / 动态分发点），把这类盲区钉住。
- **自审第二轮抓到的两处真缺陷（已修，已加锁）**：
  1. **Next 循环会连点多点**：`_waitForElement` 是 querySelector 语义（取**第一个**匹配），
     原实现点完 Next 立刻再判、等待超时只有 2s ⇒ 页面没渲染出可见性步骤时会**再点一次 Next**
     ⇒ 可能连跳两步、**跳过可见性设置**。修法：点完 Next 必须 `sleep` 再判（已加锁）。
  2. **可见性 radio 选择器硬编码在实现里**：与 `selectors.js` 的定义重复
     ⇒ 违反「选择器单一真源」。修法：改为**只从选择器表取**（已加锁）。
- **平台选择器全部标注为 `[参考]`（未在本仓真机验证）**：来源是开源实现
  （`dreammis/social-auto-upload` / `EdwardZehuaZhang/...` / `fawazahmed0/youtube-uploader`）。
  真机验证需要 5 个平台的真实账号，尚未进行。⇒ **本次只证明了「链路的失败路径会正确失败」，
  没有证明「成功路径能发出去」**。
- **发布后核验的「期望值比对」未做**：`shared.js` 的 `readAccountIdentity` 只**产出**身份锚点
  （IG `ds_user_id` / YouTube `/channel/<id>` / X `twid`），
  「当前登录的是不是这个账号」的比对需要账号元数据里存期望值 ⇒ 属账号管理侧改动。
- **`shared.js` 的 Facebook 核验是弱证据**（平台无稳定作品级标识）⇒ 已显式标注 `weak: true`。
- **X 网页轨不声称已核验**：X 的正证据在官方 API 返回的 tweet id 上，网页轨只能读到发布提示。

---

## CHANGELOG 条目

# feat(publish): YouTube 发布改 fail-closed，并新增「发布后回读核验」层

- YouTube 发布不再把「点了发布按钮」当成「发出去了」：上传未传完、详情对话框未就绪、
  发布按钮点不到、发布后回读不到作品链接，**一律判失败**（此前一律判成功）。
- 补齐 YouTube 发布缺失的步骤：受众「非儿童向」、标签、封面。
- 新增跨平台「发布后回读核验」层：按平台回读作品 URL / 作品 ID / 作者 ID / 正文，
  区分「已发出且已确认」「没核验到」「核验过程出错」三种结论——
  **核验失败不等于发布失败**（平台改版会让核验器失效，而内容可能已经发出去了）。

## learnings

### lesson: 「点了按钮就当成功」的 fail-open，修法是判据改落在平台侧可回读的事实上

**现场**：Mulpub 的 `_publish_youtube` 有 5 处 fail-open——上传等待超时只 `log.warn` 就继续点发布、
发布按钮点击失败被 `catch` 吞掉后仍 `return {success:true}`。用户侧表现为「发布成功了但平台上找不到」。

**根因**：helper 的 `_click` **恒返回 true 且不抛错**（点击成功与否要靠回读判定），
所以旧实现在「点了发布按钮」这个动作上**没有任何可用于判定的信号** ⇒ 只能无条件报成功。
⇒ 这不是漏写了一个 if，而是**判据选错了层**：判据落在「我调用了发布动作」上，
而真正要判的是「平台侧现在能看到这条内容」。

**可复用的 N 条**：

1. **判据要落在可回读的事实上，不落在「我做了动作」上**。
   YouTube ⇒ 回读作品链接；Instagram ⇒ 回读 `og:url` + `instapp:owner_user_id` + `al:ios:url`。
2. **核验结果要三态，不要两态**：`verified:true` / `verified:false` / `error`。
   「核验失败」≠「发布失败」——平台改版会让核验器失效，此时内容可能已经发出去了；
   压成两态 ⇒ 用户重发 ⇒ 重复内容。
3. **「点了按钮」这类动作没有返回值可依赖时，判据必须换层**，
   而不是给动作加一个假的成功标记。
4. **迁出而不是复制**：把旧实现从点名还账文件里**迁走**（净减 80 行），
   既拿到新行为，又不触发零容差门禁，还避免了两份实现并存。
5. **等待语义有 querySelector 的「取第一个匹配」隐含前提**：
   用一组候选选择器表示「页面到了某一步」时，**首个候选必须是该步骤独有的**，
   否则在**上一步**就会误命中、导致后续步被跳过。⇒ 候选顺序不是审美问题，是语义。
   配套：**点完「下一步」必须等页面渲染再判**（否则等待超时会被读成「还没到下一步」⇒ 连点多点）。
6. **选择器要标注来源等级**（`[真机]`/`[参考]`/`[推测]`）：
   全部标 `[参考]` 就是「一个都没在真机验证过」——
   写清楚比让人误以为「已验证」安全。
