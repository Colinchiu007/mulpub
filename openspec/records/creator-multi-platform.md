---
record: creator-multi-platform
task: 博主监控多平台扩展——抖音/小红书接入（会话 Cookie 复用 + 纯算法签名）+ 视频号评估
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

# 博主监控多平台扩展（creator-multi-platform，2026-10-12）

> 分支：`creator-multi-platform`（隔离 worktree `mp-creator-multi-platform`，**非 C 盘**）；共享根保持 `main`。
> 范围：🛠 运行时代码变更（桌面主进程 + Python 后端 + 渲染层）+ 📝 文档 ⇒ 完整质量节拍。
> 上游依据：`01-docs/PRD-CREATOR-MULTI-PLATFORM-2026-10-12.md`（本次新增）。

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---------- |
| 变更类型与隔离 | PASS | `git rev-parse --abbrev-ref HEAD` = `creator-multi-platform`；worktree 非 C 盘；`verify-worktree-deps.js` OK（11 项消费方） |
| 方案与规格先行 | PASS | 先完成开源调研（GitHub API 实测 MediaCrawler/Evil0ctal/xhshow/视频号项目）→ PRD（§0 结论表/§2 调研/§3 架构/§4 数据校验/§5 流程/§6 签名失效模式/§7 交互/§8 提示文字/§9 九条回归锁/§10 未闭合）→ 实现 |
| TDD | PASS | 桌面 27 文件 **606 例全绿**：platforms 14（fail-closed 解析/互不混判）、adapters-web 12（零请求原则/签名失败不静默/无 ID 丢弃）、dispatch 9（形态分发/不支持可见失败/YouTube 隔离）、IPC 多平台 6（canonical 落库/零副作用/platforms 清单）、渲染层 5（平台选择/自动识别/徽标/错误文案）；Python **5 例**（确定性+变输入变输出+SM3 修正暴露+缺依赖可操作报错） |
| 变异反证 | PASS（已实测变红后修正） | ① SM3 `W1` 公式写错（+16）⇒ 确定性测试当场 IndexError 红，修正后绿；② 签名头全空未拦截 ⇒ 「resolved 而非 rejected」红，补拦截后绿；③ xhs `code=-100` 落入签名分支 ⇒ credential_missing 断言红，改分因后绿 |
| 静态门禁 | PASS | `check-ipc-bridge` 460/478/0；`check-ipc-sender-guard` PASS（新通道全部带 withSenderCheck）；`check-locale-sync --pair-base/--cjk/--keys`（1932 keys）；`check-unwired-tests` OK；ESLint 改动文件 0 error（清理 2 处 no-useless-assignment + 死代码导出） |
| Python 质量 | PASS | `py_compile` 全通过；`pytest tests/test_creator_sign.py` 5/5；签名路由的可选依赖缺包 → HTTP 503 + 安装指引（非裸 500） |
| QM-1 打包 | PASS | `pnpm run build:dir` rc=0；asar 含新模块（creator-platforms/adapters-web/dispatch/session-cookie/http）；`creator:platforms` 通道字面量在产物中；extract 后 require 新模块成功（见下方明细） |
| QM-2 代码审查必检项 | PASS | require 路径可解析；preload 改源后**两个** bundle 已重生成；IPC 参数纯 JSON；**Cookie 值零日志**（只记 platform/accountId/数量）；签名服务只读校验、不接受任意代码 |
| QM-4 视觉 | N/A | 添加弹窗新增平台 chip（新元素）、列表项新增平台徽标（新元素）；基线漂移交 CI Gate 7b |
| QM-6 双模型评审 | PASS | 后端 claude：**Critical 0 / Warning 2 / Info 4**（session 23b34b14）。W1 抖音 HTTP 200 + status_code!=0 静默降级 ⇒ 已修（业务码分因 + body 签名判定挪出 >=400 守卫）；W2 query_str 未排序 ⇒ 已修（签名前按 key 排序）；I1 xhs 整串 Cookie 兜底 ⇒ 已修（只传 a1，缺 a1 报 400）；I2 503 回显 ImportError 原文 ⇒ 已修（固定指引、原文进日志）；另两条 CONFIRMED_CLEAN 正面确认（Cookie 复用无泄露 / fail-closed 解析无误配）。前端 opencode 未出标准 JSON 但其工作摘要命中 9 项候选 findings，全部处置：localeKey 透传缺失（真 bug）、platformLabel 中文硬编码、自动识别不选平台（真 bug）、unsupported chip disabled、platform 重置、字符串兼容分支删除、死键删除、hasSession 未登录小标；「detectedPlatform 与主进程判定重复」保留（渲染层仅预选提示，判定在主进程 fail-closed）。Python 全量 35 失败分域核实为 main 既有（32 例集中 test_xiaohongshu_dom_hardening.py，与本增量零交集） |
| 未闭合（诚实登记） | — | ① 真机端到端需用户已登录抖音/小红书账号（单测以注入式 Cookie/httpGet 覆盖，不假装已验证）；② 签名算法是移动靶（降级路径已建：signature_failed → Tier B → 引导重登）；③ 视频号 unsupported（PRD §0 留证据）；④ 抖音/小红书暂无字幕转写（quality=stub/partial）；⑤ 单账号会话（多账号轮巡为后续切片） |
| 记忆沉淀 | PASS | PRD + 本记录 + CHANGELOG + learnings 置顶（签名库选型/会话复用/SM3 教训）+ gstack + EverOS（详见收尾链） |
| 远程同步 | PENDING | 待本 PR 合并后回填 PASS + merge SHA，同一次提交删除 ledger 登记项 |

### QM-1 明细（asar 核对）

- 产物 `apps/desktop/dist-electron/win-unpacked/resources/app.asar`；`asar list` 含
  `\electron\services\creator-platforms.js / creator-adapters-web.js / creator-platform-dispatch.js / creator-session-cookie.js / creator-http.js`；
  asar 明文命中 `creator:platforms`（preload bundle 已随源码重生成）；
  `asar extract` 后 require `creator-platforms.js` 调 `parseCreatorInput` 成功。

### QM-6（占位，合并前补跑双模型评审并回写）

- 后端：pending；前端：pending。Critical 未清零前不合入。

### 本增量在做什么（一句话）

让「博主监控」在 YouTube 之外接入抖音与小红书：**复用应用内已登录账号的会话 Cookie**，
签名交给 Python 后端的纯算法库（xhshow / abogus），输入解析 fail-closed、平台按 canonical ID
形态分发，签名失败/登录态失效/链接给错平台都有可操作的专门文案；视频号经调研如实保持不支持。

### 不做的事（边界）

- 不引入 Playwright / 新 Node 依赖；不动 YouTube 主腿与既有配额体系；不做评论抓取；
- 不做视频号（PRD §0 证据）；不做多账号轮巡监控。
