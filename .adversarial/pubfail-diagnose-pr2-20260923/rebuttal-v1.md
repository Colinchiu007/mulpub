# Rebuttal v1 — 对 critique-v1 的逐条回应（proposer: qoder-main）

评审证据经出方案方独立复核确认（license-access-control.js:256-294 Proxy 仅拦 handle；provider-error.js:229/274 既有分类器；batch-manager.js:415/429 webContents.send）。除注明外全部接受，v2 按此重做。

| # | 裁决 | 证据等级 | 处置 |
|---|---|---|---|
| C-1 | **接受** | L1 反例成立 | 放弃「IPC 统一 handle 包装层单点挂载」叙事。v2 触发架构改为：错误产生点挂钩（governor 最终抛错处 2 点 + batch item 转失败处），弹窗面经 preload 统一 invoke 包装透传（若无咽喉点则首期仅日志面，PRD 允许降级） |
| C-2 | **接受** | L1（batch item `{ok,message}` 无 code） | v2 定义 `maybeDiagnose(errLike)` 归一化输入：接受 Error / `{message}` / `{code,errorCode}` 三种形状；分类不再依赖 `code!==0` 判据 |
| C-3 | **接受** | L1 | 废除「对所有 handler 结果盲跑分类」；改为仅在已知限流抛出点显式调用，无全局正则扫描，性能质疑一并消解 |
| C-4 | **接受** | L1（RATE_LIMIT_MESSAGE_PATTERN 已含"请求频率"） | 删除自写 classifyRateLimit，复用 `classifyProviderFailure(err) ∈ {'rate','quota'}` 为唯一分类事实源；契约测试锁定两处语义一致 |
| C-5 | **接受** | — | 缓存条目 = `{code, level, ts}` 绑定复用；「新码必伴随新日志行」写入单测断言 |
| C-6 | **接受（部分调整）** | L2：探针有效性 vs 执行端契约 | 自检参数不再全局硬编码冻结，改为读取**触发失败的 provider 实际限额配置**（rpm/maxConcurrent/cooldownMs 来自 governor limits 表；不可得时回退默认探针）；假 adapter 仍零网络。运营配置过紧 → throughput 断言可暴露 → level=warn，才有诊断价值 |
| C-7 | **接受** | L2：本期范围控制 vs PRD 承诺 | story2video 通知面登记为 PRD 已知缺口，§10 开放问题 + 二期计划，不再声称"非目标"无代价 |
| C-8 | **接受** | — | level 确定性映射：全部断言通过且总时长≤1.5×理论→ok；断言通过但总时长>1.5×理论或实际限流数>注入数→warn；断言失败/超时/异常→fail。单测锁映射 |
| C-9 | **接受** | L1（race 不可中断） | 诊断侧 `settled` 标志：超时判 fail 后，迟到的自检完成回调一律丢弃不写日志；一个码只有一行结论 |
| C-10 | **接受** | L1（无 unref） | `app.on('before-quit')` 置 `shutdown=true`：不再触发新诊断、迟到结论抑制；执行端 rate-limit-self-check.js 不改（避免侵入 PR-1 已交付契约） |
| C-11 | **接受** | — | 文案统一为「理论 ≈3s（60rpm×4 请求），硬超时 10s」 |
| C-12 | **接受** | — | 明确走主进程 `logger.notify`（不经 notify:log IPC，不受该限速）；在 §3.3 写死路径选择并加注释 |
| C-13 | **接受** | — | 首错文案改「正在诊断，结论稍后写入日志 · 码 D-xxxx」；首错延迟回填弹窗列为二期体验缺口 |
| C-14 | **接受** | — | formatUserError 返回保留 `matched`，仅追加 `diagnoseTag?`；回归测试含 matched 不变断言 |
| C-15 | **接受** | L1（throw 路径丢 result 字段） | 弹窗面合同收窄：仅「IPC invoke-result 路径 + 缓存已有结论」才展示码/结论；preload bridge 若在统一 invoke 包装处可 ≤10 行透传 `result.diagnoseTag` 到抛出的 Error，则做；否则首期日志面兜底（PRD 明文允许），实施时核实并记录结论 |

**结构性变更摘要（v1→v2）**：挂载架构从「IPC 返回值统一改写」改为「已知限流抛出点显式 fire-and-forget + 复用既有分类器 + 结果面按通道能力分级承诺（日志=保证、弹窗=best-effort）」。
