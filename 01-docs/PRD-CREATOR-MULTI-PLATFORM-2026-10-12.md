# PRD：博主监控多平台扩展——抖音 / 小红书（P0）+ 视频号评估（2026-10-12）

> 分支 `creator-multi-platform`（隔离 worktree，非 C 盘）。上游依据：
> `01-docs/PRD-CREATOR-MONITOR-COLLECT-2026-10-07.md`（单平台 YouTube 版，§1–§17）、
> `openspec/specs/creator-monitor/spec.md`（平台能力分层 Requirement）。
> 本文是**多平台扩展**的规格真源；与旧 PRD 冲突处以本文为准。

## 0. 结论先行（TL;DR）

| 平台 | 本期能力 | 等级 | 依据 |
|---|---|---|---|
| YouTube | 发现 + 采集（官方 API） | `official` | 既有实现（2026-10-07） |
| **抖音** | **发现 + 采集（web 端点 + 账号 Cookie）** | `official`（官方 web 端点 + 用户自有登录态） | MediaCrawler 的 `creator` 模式契约 + 本仓账号分区 Cookie |
| **小红书** | **发现 + 采集（creator 端点 + 账号 Cookie）** | `official`（同上） | MediaCrawler `xhs` creator 模式 + `X-s` 签名算法（公开实现） |
| 视频号 | **不做** | `unsupported` | 全部开源方案（knowing-top/ChannelsDownloader 等）均为「微信桌面端抓包监听」型，无法无人值守；且本仓 `PLATFORM_SESSION_COOKIE_MARKERS` 无视频号条目（登录态捕获机制不存在） |

> **等级判据修正**（对旧 PRD「official=官方 API」的收紧）：`official` = 官方/web 端点 + 用户自有登录态，
> 失效模式可预期（401/风控 → 按失败分级降级）；`best_effort` = 依赖非官方算法或易碎签名；
> 抖音/小红书按此归 `official`（端点官方、凭证是用户自己的），签名算法按 best effort 处理并允许
> `best_effort` 降级路径（见 §6）。

## 1. 用户故事

- 作为内容创作者，我想**关注抖音/小红书的博主**（粘贴主页链接），让系统定期检查他们的新作品并提示我，
  这样我不用手动刷 App。
- 我想在**同一个博主列表**里混合关注三个平台的博主，角标与发现列表统一。
- 添加时如果**没登录对应平台**或**链接不是博主主页**，我要能立刻看懂原因并知道下一步（去登录 / 换链接）。
- 采集来的内容进入与 YouTube 同一条后续链路（爆款库 / AI 写作），不产生第二套入口。

## 2. 开源调研结论（2026-10-12，GitHub API 实测）

| 项目 | ★ | 与本特性的关系 |
|---|---|---|
| NanmiCoder/**MediaCrawler** | 66.7k | **端点与流程的参考真源**：`media_platform/{douyin,xhs}/core.py` 均有 `creator` 模式（主页作品分页枚举）；douyin 用 web 端点 `aweme/v1/web/aweme/post/`（`sec_uid` + 分页 `a_bogus` 签名）；xhs 用 `creator` 端点 + `X-s`/`X-s-common` 签名。**强依赖 Playwright 登录态页面内 JS 签名**——本仓不引 Playwright，改为 Node 侧实现签名 + 复用账号分区 Cookie |
| Evil0ctal/**Douyin_TikTok_Download_API** | 20.6k | 自托管 REST 形态参考（可挂 python-backend），但同样以分享链接解析为主，签名问题等价；不引入，避免双后端 |
| 视频号（knowing-top/ChannelsDownloader 等） | <25 | 全部是「微信桌面端 + 抓包监听」型，需人工开微信、手动播放；**无无人值守可行方案** → `unsupported` |

**采纳**：端点契约与数据形状照 MediaCrawler（channel_id/sec_uid、note_id/用户 ID、分页游标）；
签名算法取公开 JS 实现移植到 Node（`a_bogus`、`X-s`/`X-s-common`），**签名失败绝不静默**——
按错误码上抛并在 UI 给「登录态可能过期」的可操作提示。

## 3. 架构（最小改动）

```
CreatorCollector（按平台分发）
  ├─ youtube    → 既有 Data API 实现（不动）
  ├─ douyin     → 新 adapter：Cookie + web 端点 + a_bogus
  └─ xiaohongshu→ 新 adapter：Cookie + creator 端点 + X-s
凭证层 creator-credential：youtube API Key（既有）+ 会话 Cookie 提供者（新，读账号分区）
失败分级 / 配额 / 存储（creator-store）/ 监控调度：平台无关，不动
```

- **adapter 接口**（与 YouTube 现有形状一致，新增平台 MUST 实现全部四方法）：
  `parseCreatorInput(raw) → {kind, ...}`、`resolveCreatorId(input) → canonicalId`、
  `listPosts(id, {cursor}) → Post[]`、`collectBody(externalId) → {content, transcriptSource, contentQuality}`。
- **canonical ID**：抖音 = `sec_uid`（`MS4wLjABAAAA…`）；小红书 = 用户 ID（主页 URL 的 `/user/profile/{id}`）。
- **存储**：`creator_accounts.platform` / `creator_discoveries` 已有 `platform` 列，`(platform, external_id)`
  唯一键天然支持混平台。
- **配额**：抖音/小红书不走 YouTube 配额池；用**每平台最小间隔 + 单次上限**（复用 `creator-limits`
  的 `COLLECT_DEFAULTS` 与 `resolveEffectiveLimit`），失败按既有 Tier A/B/C 分级。

## 4. 数据校验（三层）

| 层 | 判据 | 违反后果 |
|---|---|---|
| 渲染层 | 非空；≤512 字符；**平台前缀检测**（输入含 `douyin.com` / `v.douyin` → 抖音；`xiaohongshu.com` / `xhslink` → 小红书；无 URL 时按已选平台处理） | 内联报错，不发请求 |
| 主进程·形态 | 抖音：主页 URL 必须含 `/user/`；作品/播放列表链接 → `not_a_channel`。小红书：主页 URL 匹配 `/user/profile/[0-9a-f]+`；笔记链接 → `not_a_channel`。**两平台互不混判**（抖音链接给小红书 → `creator:wrong_platform`） | `creator:invalid_input` / `creator:not_a_channel` / `creator:wrong_platform` |
| 主进程·会话 | 该平台账号分区存在有效 Cookie（标记位齐全）；缺失 → `creator:credential_missing`（文案引导去账号页登录） | 拒绝并提示，不产生半行数据 |
| 正文字段 | 标题 ≤200（超长截断 + `truncated:true`）；正文非空；URL http/https；缩略图仅取返回的 thumbnails | 该条判失败，保持 pending 可重试 |

## 5. 流程

### 5.1 添加博主（抖音/小红书）
```
粘贴主页链接 → 平台识别（域名）→ 会话检查（该平台 Cookie？）
  ├─ 无 → creator:credential_missing（文案：请先在「账号管理」登录抖音/小红书）
  ├─ 形态非法 → invalid_input / not_a_channel / wrong_platform
  ├─ resolveCreatorId（profile 页解析，1 请求）
  ├─ upsertCreator(platform, canonicalId) + upsertFollow
  └─ 立即首次探测（不取正文）
```

### 5.2 定期探测（平台无关）
调度器按 `check_interval_min` 到期 → 按平台分发 adapter.listPosts → `INSERT OR IGNORE`
`creator_discoveries`（`platform+external_id` 幂等）→ 失败分级（Tier A 节流 / B 连败 auto_paused /
C fatal_paused）→ 角标推送。

### 5.3 采集正文
- 抖音：作品描述（web 端点返回 `desc`）为正文主体；视频转写**本期不做**（`content_quality=stub/partial`）。
- 小红书：笔记正文取 note feed 返回的 `desc`；`content_quality=stub`。
- 统一写 `viral_library`（`source='creator'`），outbox/最终化协议沿用旧 PRD §8.3.1。

## 6. 签名与失效模式（诚实登记）

| 项 | 抖音 | 小红书 |
|---|---|---|
| 签名 | `a_bogus`（query 上的防重放参数） | `X-s` / `X-s-common`（请求头） |
| 算法来源 | 公开 JS 实现移植（MediaCrawler 同源） | 同左 |
| 依赖登录态 | 是（Cookie + msToken from localStorage 语义，Node 侧用 Cookie 中的值） | 是 |
| 失效模式 | 403/`signature not found` → `creator:signature_failed`（Tier B，连败 3 次 auto_paused） | 461/406/461-code → 同左 |
| 风控 | 触发验证码 → 同上，提示「去账号页重新登录」 | 同左 |

**签名失败 MUST NOT 静默降级为空列表**（那是「监控看起来正常但永远采不到」的静默事故形态）。

## 7. 交互逻辑与显示项

- **添加弹窗**：输入框上方新增**平台选择**（三个 chip：抖音 / 小红书 / YouTube；自动识别时高亮并允许改）。
  自动识别规则：URL 域名命中 → 锁定该平台并显示「已识别为抖音/小红书/YouTube」；纯 ID 输入 → 用当前选择。
- **博主列表项**：`creator-avatar` 旁新增**平台小徽标**（抖/红/You 字样或 icon，`data-platform` 属性供测试）。
- **错误提示（zh/en 全对）**：
  - `creatorErrWrongPlatform`：这是其他平台的链接，请切换平台后重试。
  - `creatorErrCredentialMissingForPlatform`：未登录{name}账号，请先到「账号管理」登录后重试。
  - `creatorErrSignatureFailed`：{name}接口校验失败，登录态可能已过期，请到「账号管理」重新登录后重试。
  - `creatorErrUnsupportedPlatform`：暂不支持该平台。
- **能力徽章**：列表项按 `capability_tier` 渲染（沿用），抖音/小红书 = 官方接口；视频号 = 暂不支持（平台选择器里禁用 + tooltip 说明）。

## 8. 提示文字（zh/en 键名与文案）

| 键 | zh |
|---|---|
| `creatorPlatformDouyin` / `creatorPlatformXiaohongshu` / `creatorPlatformYoutube` | 抖音 / 小红书 / YouTube |
| `creatorAddPlatformLabel` | 平台 |
| `creatorAddPlatformAuto` | 已识别为 {platform} |
| `creatorErrWrongPlatform` | 这是其他平台的链接，请切换平台后重试。 |
| `creatorErrCredentialMissingForPlatform` | 未登录 {platform} 账号。请先到「账号管理」登录后再添加博主。 |
| `creatorErrSignatureFailed` | {platform} 接口校验失败，登录态可能已过期。请到「账号管理」重新登录后重试。 |
| `creatorErrUnsupportedPlatform` | 暂不支持该平台的博主监控。 |
| `creatorQualityStubNote` | 该平台暂只能获取标题与简介，正文质量有限。 |

（en 侧同义成对，见实现。）

## 9. 回归锁（实现 PR MUST 全带）

1. **平台分发锁**：`parseCreatorInput` 对三平台样本（抖音主页/作品、小红书主页/笔记、YouTube 全形态）
   逐条断言 kind 与平台，且互不混判（抖音链接给小红书 → `wrong_platform`）。
2. **会话前置锁**：无该平台 Cookie 时 `resolveCreatorId` 拒绝且**零网络请求**。
3. **签名失败锁**：httpGet 返回 403/461 时抛 `creator:signature_failed`，**绝不返回空列表**。
4. **幂等锁**：同平台同 ID 重复探测不产生重复行（`platform+external_id` 唯一键）。
5. **跨平台幂等**：不同平台相同 external_id 不互相覆盖。
6. **正文质量**：抖音/小红书采集物 `content_quality` 判定与 PRD §5.3 一致。
7. **UI 平台徽章**：列表项 `data-platform` 正确渲染；添加弹窗平台选择与自动识别联动。
8. **视频号**：平台选择器禁用 + `creatorErrUnsupportedPlatform`。
9. **反证**：摘掉平台分发 → 锁 1 红；把签名失败改成返回空列表 → 锁 3 红。

## 10. 未闭合（诚实登记）

1. **签名算法是移动靶**：抖音 `a_bogus`、小红书 `X-s` 算法会随平台升级；本实现带「签名失败 → 明确错误码
   → 引导重新登录」的降级路径，不做「算法追赶承诺」。
2. **视频号**：`unsupported` 是**当前事实**不是永久结论；若未来本仓实现视频号登录态捕获
   （`PLATFORM_SESSION_COOKIE_MARKERS` 补条目），可按本 PRD 架构加 adapter。
3. **评论/互动数据**不在本期（MediaCrawler 的评论抓取能力未纳入）。
4. **真机端到端**：需用户在应用内登录抖音/小红书账号后实测（单测以注入式 Cookie 与 httpGet 覆盖）。
