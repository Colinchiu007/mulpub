---
record: docs-p32-final-assessment
task: P3-2 评估最终定稿（三次修正后）—— 判据①②③④ 全部需真机取证
date: 2026-10-14
---

## 本次执行记录：P3-2 评估最终定稿（docs-p32-final-assessment，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见下
  —— 本 PR 只改 `01-docs/PLAN-*.md` ⇒ 预期 `docs-only=true`。

## 为什么是「最终定稿」

对 P3-2 的评估本会话改了三次，前两次都错：

| 次 | PR | 错在哪 |
| --- | --- | --- |
| 1 | #3556 | 只读 PLAN 规格 + 跑自检脚本，**没读目标文件的约束注释** ⇒ 写「四类缺口均可由 agent 完成」 |
| 2 | #3560 | 读了 `platform-definitions.js` 注释，但**没读 YAML 模板字段的取值来源** ⇒ 写「YAML / capabilities / 上限表 / 测试文案可不依赖真机」 |
| 3 | **本笔** | 前两笔漏读汇总后才齐 |

## 本笔新增的取证（读模板的每个值怎么来的）

以判据①全 PASS 的 `kuaishou` 为模板：

| 文件 | 字段 | 真机来源 |
| --- | --- | --- |
| `config/platforms.yaml` | `max_content: 480` | 注释：「实测计数器为 **x/500**（截图取证：921 字时表单红字…）」「取 480 而非 500：实测截断到 500 时平台计数器显示 **505/500**（平台计数与本仓按码点截断存在偏差）」；旧值 1000 的后果是「**被静默拒绝**」 |
| `publish-capabilities.json` | `titleMode: "caption"` | 来自「没有独立标题输入框，作品标题与描述共用一个编辑器」的真机 DOM 观察 |
| `publish-capabilities.json` | `limits.contentMax: 480` | 与 YAML 同源 |

且 AGENTS.md 明写「与注册表一致性由 `content-formatter-registry-sync.test.js` **契约锁钉住**」⇒ 两处必须一致，猜一个**同时错两处**。

## 定稿结论

| 缺口 | 判据 | 依赖真机？ |
| --- | --- | --- |
| `platform-definitions.js` 三个 URL/模式表 | 1/2/3 | ✅ 是（跨源=安全漏洞）|
| `platforms.yaml` 数值类字段 | 4 | ✅ 是（实测计数器）|
| 三张上限表 | 7/8 | ✅ 是（与 YAML 同源）|
| `publish-capabilities.json` 元数据 | 5 | ✅ 是（titleMode 来自真机 DOM）|
| 测试与文案 | 11 | ⚠️ 骨架可写，期望值取自上列 |

**⇒ 判据① 没有真正「不依赖真机」的部分。**

前置条件收敛为一条：**用户提供 `dayu` 或 `qie` 真实账号并登录一次**（取证 URL / 字数上限 / 封面规范 / 标题输入形态）。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致 |
| 品牌残留 | PASS | `check-no-brand-residue.js` exit=0 |
| 文档同步 | PASS | `classify-docs-only.js` → `docs-only=true` |
| 执行记录 | PASS | 本文件即按出路①新增 |
| 远程同步 | PASS | #3563 merge `9fd47b332` |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS（#3563 @ 9fd47b332）

## 备注

- 本笔**推翻自己前两笔的结论**，并在文档里写明「以此节为准」+ 三次错误形态对照表。
- 元教训：**判断「某件事能不能做」之前，要把所有目标文件都读一遍**——特别是已完成同类项的每个值是怎么来的。
  三次改同一个结论比一次改对更浪费，且中间态会误导下一个人。
