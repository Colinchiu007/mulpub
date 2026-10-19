# AI 影视创作开源项目深度研究报告与落地实施方案

> **日期**：2026-10-19（v2 增补 3 个新项目） ｜ **状态**：研究完成，待实施
> **调研对象**：**19 个** AI 影视创作开源项目（已克隆至本机临时目录 `<AI_FILM_RESEARCH_DIR>`；`--depth 1`。实际路径按本机自行指定，见附录 B）
> **目标项目**：mulpub / Multi-Publish（`<REPO_ROOT>`，即本仓库根）
> **取证口径**：所有结论均基于实际克隆源码，标注 `仓库相对路径:行号`；许可证逐仓核实 LICENSE 文件前若干行；未读到的功能明确标注「未确认」，不推测。
> **v2 增补**：`FireRed-OpenStoryline`（小红书 FireRed，Apache-2.0）、`smy-seedance-storyboard`（**无许可证**）、`ToonCrafter`（Apache-2.0，学术模型）。详见 §3.17–§3.19。

---

## 目录

- [零、Skill 选型与调研方法论](#零skill-选型与调研方法论)
- [一、总览：16 个项目全景](#一总览16-个项目全景)
- [二、许可证合规矩阵（前置结论）](#二许可证合规矩阵前置结论)
- [三、逐项深度分析](#三逐项深度分析)
- [四、横向对比与复用价值排名](#四横向对比与复用价值排名)
- [五、落地实施方案](#五落地实施方案)
- [六、风险与反模式清单](#六风险与反模式清单)
- [七、结论](#七结论)

---

## 零、Skill 选型与调研方法论

用户明确要求「看看有什么 skill 能帮助你更好的完成工作」。本次调研实际启用并验证了以下 4 个 skill：

| Skill | 用途 | 本次实际贡献 |
|---|---|---|
| **`github-project-analysis`** | 竞品/开源项目逆向分析主流程 | **主方法论**：提供了「许可证先行 → 速判是否值得 clone → 架构深度拆解 → 复用评估 ⭐等级 → 复用路径（源文件→目标位置）」五步法。本报告结构直接遵循其 Output Template |
| **`adversarial-review-loop`** | 跨家族模型对抗评审循环 | 用于本报告第五章落地方案的**双模型审核与对抗性审核**：proposal → critique → rebuttal → 收敛，产物配对落盘 |
| **`ccg-skills`** | CCG 质量关卡与多智能体编排 | 提供「双模型交叉审查」定义（backend 视角 + frontend 视角独立并行），是「CCG 双模型审核」的机制依据 |
| **`subagent-driven-development`** | 并行子代理调研 | 实际用于 4 组分头深挖 16 个项目（组 A/B/C/D，每组 4 个），配合目标项目现状调研子代理 |

**方法论要点**（来自 `github-project-analysis`，本次严格执行）：
1. **许可证检查不可跳过** —— 这是决定代码能否复用的**法律前提**，本报告第二章独立成章。
2. **不要只做表面分析** —— 必须进核心模块，只读 README 没有价值。本次对每个项目都读了目录结构 + 核心模块源码。
3. **区分「能用」和「值得用」** —— 结合 mulpub 现有技术栈判断，不做空洞推荐。
4. **多项目分析后必出复用清单** —— 第四章按梯队排序，不让读者重读 16 份分析。

---

## 一、总览：19 个项目全景

### 1.1 客观指标盘点

| # | 项目 | 许可证 | 文件数 | 最近提交 | 技术栈形态 | 一句话定位 |
|---|---|---|---|---|---|---|
| 1 | **ZJT** | Apache-2.0 | 1962 | 2026-10-14 | Node + Python | 短剧/小说转视频全流程 + **剪映草稿生成** |
| 2 | waoowaoo | **Elastic 2.0** | 1341 | 2026-09-21 | Next.js + Prisma | 多人协作 AI 动漫短剧创作平台 |
| 3 | huobao-drama | **CC BY-NC-SA 4.0** | 256 | 2026-10-06 | Nuxt + Hono + Electron | AI 短剧创作：剧本→分镜→生图→生视频→合成 |
| 4 | moyin-creator | **AGPL-3.0** | 338 | 2026-08-27 | Electron + React | 影视级 AI 创作：剧本→分镜→视角变体→生图→生视频 |
| 5 | Toonflow-app | MIT | 868 | 2026-10-13 | Bun + Electrobun | 无限画布 + 角色/场景资产 + 图片/视频节点 |
| 6 | Jellyfish | Apache-2.0 | 791 | 2026-04-20 | React + FastAPI | 剧本→智能分镜→一致性管理→生视频→后期剪辑 |
| 7 | BigBanana-AI-Director | **BigBanana 社区版** | 32 | 2026-10-06 | 无源码（文档+图片） | 小说导入→世界观→剧本→分镜→成片（闭源） |
| 8 | app.yumcut.com | **PolyForm NC** | 1898 | 2026-09-03 | Node | 在线视频剪辑/创作平台 |
| 9 | FastMovieAI | Apache-2.0 | 8181 | 2026-02-19 | PHP/Webman + Vue3 | 一站式短剧创作平台（含支付/会员） |
| 10 | ai-art-engine | **GPL** | 1840 | 2026-10-18 | Electron + 节点图 | 本地优先 AI 创作工作站（影视工作台四阶段） |
| 11 | showvi | MIT | 153 | 2026-05-25 | Python 3.12 | 多智能体端到端视频生产 + VLM 质检闭环 |
| 12 | Pixelle-Video | Apache-2.0 | 313 | 2026-06-14 | Python + ComfyUI | 全自动短视频引擎：文案→配图→配音→合成 |
| 13 | novelvids（猫影短剧） | **CC BY-NC 4.0** | 915 | 2026-09-28 | FastAPI + Vue3 | 小说转短剧全流程生产平台 |
| 14 | autoclip | MIT | 1314 | 2026-10-15 | Python + Tauri | 长视频→高光切片→竖版成片（字幕驱动） |
| 15 | short-drama-skills | MIT | 20 | 2026-07-01 | **纯 Prompt 资产** | 7 条工业化验证的分镜拆解 Skill |
| 16 | short-drama | MIT | 12 | 2026-04-18 | **纯 Prompt 资产** | 微短剧剧本创作 Skill（50-100 集） |
| **17** | **FireRed-OpenStoryline** | **Apache-2.0** | 141 | 2026-07-31 | Python FastAPI + MCP + 19 节点 | **小红书 FireRed**：对话式 agentic 剪辑流水线（素材搜索→切镜→理解→编排→AI 转场→渲染） |
| **18** | **smy-seedance-storyboard** | 🔴 **无许可证** | 20 | 2026-10-08 | **纯 Claude Skill 资产** | 上美影风格短剧生成器（SKILL.md + 7 篇 references + 2 个完整示例工程） |
| **19** | **ToonCrafter** | **Apache-2.0** | 81 | 2025-03-19 | PyTorch 扩散模型 | 卡通**首尾帧插值**（SIGGRAPH Asia 2024，CUHK + 腾讯 AI Lab） |

> ⚠️ **第 18 号 `smy-seedance-storyboard` 无任何许可证文件、README/SKILL 中亦无版权声明** —— 按伯尔尼公约默认**版权保留（All Rights Reserved）**，其文本**不可复制**。仅可参考其组织结构。见 §2.3。

### 1.2 形态四分类

按**工程形态**划分，这决定了复用方式根本不同：

```
19 个项目
├── A. 完整工程流水线（9 个）
│   ZJT / waoowaoo / huobao-drama / moyin-creator / Toonflow / Jellyfish
│   FastMovieAI / novelvids / Pixelle-Video / autoclip / ai-art-engine / showvi
│   FireRed-OpenStoryline ★v2 新增（小红书，19 节点 agentic 剪辑）
│   → 复用「架构思路 + 数据结构 + 算法」，不复制代码（许可证多受限）
│
├── B. 闭源/半成品（2 个）
│   BigBanana-AI-Director（仅文档+截图）/ app.yumcut.com（PolyForm NC）
│   → 只可参考产品形态与交互设计
│
├── C. Prompt / 剧作知识资产（3 个）★ 最高性价比
│   short-drama-skills（MIT）/ short-drama（MIT）
│   smy-seedance-storyboard（🔴 **无许可证** —— 只能参考结构，文本不可复制）
│   → 可直接集成到 mulpub 的 ai-writer / 剧本套用引擎（smy 除外，见 §2.3）
│
├── D. 专项能力库（1 个）★ 高价值
│   ZJT/jianying —— 剪映多轨道草稿生成库（Apache-2.0）
│   → 可直接复用于 mulpub 的发布链路
│
└── E. 生成模型仓库（1 个）⚠️ 形态特殊 ★v2 新增
    ToonCrafter（Apache-2.0，PyTorch 扩散模型）
    → 不是工程流水线而是「能力」，需 GPU + 512×320，桌面端不可直接接入
```

> 💡 **v2 新增三个项目恰好填满了三个不同类别**：FireRed 是最接近 mulpub「成片剪辑」段的对标（进 A 类）；smy 是纯 Prompt 资产但**许可证最危险**（进 C 类但单列）；ToonCrafter 是**首个「生成模型」形态**（进 E 类）——这也暴露了本轮 19 个项目里只有 1 个是模型仓库，说明这个生态的主体仍在「流程编排」而非「底层生成」。

---

## 二、许可证合规矩阵（前置结论）

> ⚠️ **这是本章最重要的部分**。判据分两层，**不要混为一谈**：
> 1. **NC（非商业）层**——由「是否商用」决定。mulpub 当前定位为**科研项目（非商用）**，因此 NC 类（PolyForm NC / CC BY-NC）**可用**。
> 2. **SA / copyleft 层**——由「是否开源衍生作品」决定，**与是否商用无关**。GPL / AGPL / CC BY-NC-SA 的传染性**不因非商用而解除**。
>
> 🔴 **还有第三层，比前两层都严格**：**无许可证 = 默认版权保留（All Rights Reserved）**，连「非商用使用」都不构成授权。见 §2.3。

### 2.1 逐仓核实结果

| 许可证 | 项目 | 商用 | 修改 | 分发 | 对 mulpub 的结论 |
|---|---|---|---|---|---|
| **Apache-2.0** | Jellyfish, FastMovieAI, Pixelle-Video, **FireRed-OpenStoryline** ★v2, **ToonCrafter** ★v2 | ✅ | ✅ | ✅ | ✅ **可安全复用**（需保留 NOTICE） |
| **修改版 Apache-2.0** | **ZJT** | ✅ | ✅ | ✅ | 🟡 **可用但须署名**：① 必须保留 LOGO 与版权署名，显著位置展示「智剧通（ZJT）」，不得声称独立原创；② 禁止用其源码运营多工作区 SaaS（mulpub 为单用户桌面端，**不触发**）；③ 禁止逆向企业版授权校验（不碰即不触发）。**结论：需在 NOTICE/About 页声明 "Based on 智剧通 (ZJT)"** |
| **MIT** | Toonflow-app, showvi, autoclip, short-drama-skills, short-drama | ✅ | ✅ | ✅ | ✅ **可安全复用**（需保留版权声明） |
| **Elastic License 2.0** | waoowaoo | ⚠️ | ⚠️ | ⚠️ | 🟢 **桌面端实际可用**：三条限制①不得作为托管/管理服务提供给第三方 ②不得规避 license key 功能 ③不得移除被 license key 保护的功能。**mulpub 是本地桌面端、用户自装自用，不构成「向第三方提供托管服务」，不触发**。且是唯一与 mulpub 同为 TypeScript 栈的项目，抽取成本最低 |
| **GPL-3.0** | ai-art-engine | ✅ | ✅ | ✅ | ⚠️ **Copyleft**：衍生作品必须开源。**不可复制代码，仅可参考思路**（除非项目整体开源） |
| **AGPL-3.0** | moyin-creator | ✅ | ✅ | ✅ | ⚠️ **强 Copyleft**：网络使用也视为分发。**不可复制代码**（除非整体开源或购商业许可） |
| ~~**Elastic License 2.0**~~ | ~~waoowaoo（重复行，已并入上方）~~ | — | — | — | 🔧 **v2 修正**：上一版把 `waoowaoo` 列了两行且结论互斥（一行「桌面端可用」、一行「禁止商用」）。该许可证三条限制**都不是「禁止商用」**——禁的是「作为托管服务提供」与「移除 license key 功能」，与是否收费无关。已合并为上方单行 |
| **PolyForm Noncommercial 1.0.0** | app.yumcut.com | ❌ | ❌ | ❌ | 🟢 **科研非商用可用**（NC 已解除）；商业使用禁止 |
| **CC BY-NC-SA 4.0** | huobao-drama | ❌ | ✅ | ❌ | ⚠️ NC 已解除（非商用 OK），但 **SA 未解除**：衍生作品须同协议授权 |
| **CC BY-NC 4.0** | novelvids | ❌ | ✅ | ❌ | 🟢 **科研非商用可用**（需署名 Attribution），无 SA 传染 |
| **BigBanana Community License 1.0** | BigBanana-AI-Director | 需确认 | 需确认 | 需确认 | ⚠️ **自定义社区版**，且无源码可复用 |
| 🔴 **无许可证** | **smy-seedance-storyboard** ★v2 | ❌ | ❌ | ❌ | 🔴 **默认版权保留（All Rights Reserved）**：无 LICENSE 文件、README/SKILL 中亦无任何版权声明。**文本不可复制**；仅可参考「SKILL.md + references/ 分层」「剧组色盘单一声明」「尾帧衔接」等**抽象做法**，且须自行重写表达。见 §2.3 |

### 2.2 硬结论（按「科研项目、非商用」场景重估）

> **用户 2026-10-19 明确**：本项目作为**科研项目**，非商业产品。因此原先基于「商业闭源」假设的禁令需要重估。

#### ⚠️ 关键法律区分：非商用 ≠ 豁免 copyleft

这是本次重估**最需要说清的一点**。两类限制的作用机制完全不同：

| 限制类型 | 作用条件 | 非商用能否豁免 |
|---|---|---|
| **NC（非商业）** | 只在你「商业使用」时触发 | ✅ **能豁免** —— 科研/非商用正是 NC 允许的用途 |
| **SA（相同方式共享）** | 只要你「创作衍生作品」就触发，**与是否商用无关** | ❌ **不能豁免** |
| **Copyleft（GPL/AGPL）** | 只要你「分发/链接衍生作品」就触发，**与是否商用无关** | ❌ **不能豁免** |

**所以「科研项目」这个前提解开了 NC 的锁，但没有解开 SA 与 copyleft 的锁。**

#### 重估后的三档结论

**🟢 第一档：完全可复用（无限制或限制已解除）— 11 个项目**

| 项目 | 许可证 | 说明 |
|---|---|---|
| ZJT | 修改版 Apache-2.0 | 需署名 "Based on 智剧通 (ZJT)"（署名义务与是否商用无关，仍需保留） |
| Jellyfish / FastMovieAI / Pixelle-Video | Apache-2.0 | 保留 NOTICE/版权头即可 |
| Toonflow-app / showvi / autoclip / short-drama-skills / short-drama | MIT | 保留版权声明即可 |
| waoowaoo | Elastic 2.0 | 原本禁「作为托管服务提供第三方」；科研项目自用**不触发**（且非商用） |
| **app.yumcut.com** | **PolyForm NC 1.0** | ⭐ **解锁**：NC 类，非商用可正常使用（仍**禁止**商业使用） |

**🟡 第二档：可用但衍生作品须同协议开源（SA / copyleft）— 3 个项目**

| 项目 | 许可证 | 科研场景下的约束 |
|---|---|---|
| **ai-art-engine** | **GPL-3.0** | ⚠️ **若复制其代码，你的衍生作品必须以 GPL-3.0 开源**。科研项目若本就打算公开源码 → 可接受；若要闭源 → 不可复制代码 |
| **moyin-creator** | **AGPL-3.0** | ⚠️ 同上且更强（网络服务视为分发）。注意：作者提供**商业双许可**，但科研非商用场景**本就在 AGPL 允许范围内**，无需购买 |
| **huobao-drama** | **CC BY-NC-SA 4.0** | ⚠️ **NC 已解除**（非商用 OK），但 **SA 未解除**：衍生作品须同样以 CC BY-NC-SA 授权 |

**🔴 第三档：仍需谨慎 — 2 个项目**

| 项目 | 许可证 | 说明 |
|---|---|---|
| **novelvids** | **CC BY-NC 4.0** | ⭐ **解锁**：仅 NC 无 SA，非商用可自由使用（需署名 Attribution） |
| **BigBanana-AI-Director** | 社区版（非 OSI）+ README 标 CC BY-NC-SA | ⚠️ ① 仓库**无源码**（作者因抄袭转闭源镜像分发），无代码可复用；② 即使有，SA 条款仍约束 |

#### 一句话决策树

```
你要复用某个项目 ？
├─ 仓库没有 LICENSE 文件，README 也没写许可（smy-seedance-storyboard）
│   → 🔴 默认版权保留。连"非商用"都不构成授权 ⇒ 只能参考抽象做法 + 完全重写
├─ 许可证只含 NC（app.yumcut.com / novelvids）
│   → 科研非商用 ✅ 直接用，记得署名（CC 系需 Attribution）
├─ 许可证含 SA 或 copyleft（huobao-drama / ai-art-engine / moyin-creator）
│   → 问自己：我的项目会开源吗？
│      ├─ 会开源（且能接受同协议）→ ✅ 可复制代码
│      └─ 要闭源             → ❌ 仍只能参考思路 + 重写
└─ 许可证为 MIT / Apache / Elastic
    → ✅ 直接用（Elastic 别做成托管服务；ZJT 记得署名）
```

### 2.3 🔴 无许可证项目：比 copyleft 更严格的第三类

`v2` 新发现的 `smy-seedance-storyboard` 引出一个前 16 个项目都没出现的问题：**仓库完全没有许可证**。

| 核查项 | 结果 |
|---|---|
| `LICENSE` / `LICENSE.md` / `COPYING` 文件 | **不存在** |
| `README.md` 中的许可声明 | **无**（全文仅 1 处匹配 "licen"，是 "Video editing" 单词误命中） |
| `SKILL.md` frontmatter | **无** license 字段（只有 name/description） |
| `package.json` / `pyproject.toml` | 不存在（纯文档仓库） |

**法律后果**：依《伯尔尼公约》与大多数国家著作权法，**作品自创作完成即自动受版权保护**，无需声明。「没有许可证」不等于「随便用」，而是**保留了全部权利（All Rights Reserved）**——反向理解才是对的：**许可证是「授予他人权利」的文件，缺了它，你连复制一份的权利都没有**。

这意味着：
- ❌ 不能复制其 `SKILL.md`、`references/*.md` 的文本（含那 26KB 上美影风格指南、30KB Seedance 手册）
- ❌ 不能复制其两个示例工程（鲁智深 / 罗刹市）的剧本与提示词
- ❌ 「非商用就能用」——**不成立**，NC 类许可至少有明确授权，无许可证连授权都没有
- ✅ 可以阅读后**理解其做法**，然后**用自己的表达完全重写**（思想/方法不受版权保护，表达受保护）
- ✅ 可以在文档里**引用仓库名并给出链接**做事实陈述

**可借鉴的抽象做法**（重写，不抄文本）：
1. **SKILL.md + references/ 双层结构**：主文件写工作流，细节规范放 references/ 单一事实来源
2. **剧组色盘单一声明**：一部剧先定死一组颜色（如朱砂红/鎏金/墨黑/青瓷绿），全剧复用防跑色
3. **尾帧说明跨集衔接**：「每集最后一帧的画面描述，下一集接着用」
4. **风格硬约束后缀**：所有生图提示词末尾附咆哮体禁令（"2D FLAT COLORS ONLY. NO SHADING, NO GRADIENTS"）
5. **文-资-视-剪四阶段**：把「文图视音剪」五段压缩为四段

> 💡 **这一条值得写进流程**：以后做同类调研，**第一步应检查 LICENSE 是否存在**，而不是只读 README 的 license 徽章（smy 的 README 甚至没有徽章，容易被当成"没写就是开源"）。

> 💡 **两个关键修正**（深度核实后的结论，比初判更精确）：
> 1. **ZJT 是「修改版 Apache-2.0」而非标准 Apache**：附加署名义务（须声明 "Based on 智剧通 (ZJT)"）与禁多工作区 SaaS 条款。mulpub 是单用户桌面端，**不触发 SaaS 禁令**，代价仅是在 NOTICE/About 页署名 —— 成本极低，可接受。
> 2. **waoowaoo 的 Elastic License 2.0 对桌面端实际可用**：它禁的是「作为托管服务提供给第三方」，而 mulpub 是用户本地安装的桌面应用。且它是**唯一与 mulpub 同为 TypeScript 栈**的项目，工程质量是 16 个里最高的（七层测试套件 + 6 个自研架构守护脚本 + 20 篇模块文档）。
>
> 💡 **科研场景带来的实际收益**：`app.yumcut.com`（PolyForm NC）与 `novelvids`（CC BY-NC）从「禁止」变为「可用」。其中 **novelvids 价值显著** —— 它的 `@{实体}` 引用协议与 19 字段分镜 Schema 是 16 个项目里最接近 mulpub 现有 `story2video-engine` 形态的，之前因 NC 被排除，现在可以直接参考其实现。
>
> 💡 **仍未解锁的**：`moyin-creator` 和 `ai-art-engine` 恰恰是**功能最贴近 mulpub 影视工程**的两个项目（都有剧本→分镜→视角变体→批量拍摄的完整链路），但它们是 AGPL/GPL。**若科研项目打算开源，则可直接复用其代码**；若闭源，则仍走「参考思路重写」——**提示词不受版权保护**，moyin 的角色身份锚点、Contact Sheet、组级多镜头提示词等核心资产无论哪种情况都可重抄思路。

---

## 三、逐项深度分析

> 按复用价值从高到低排列。每个项目标注许可证风险等级。

### 3.1 ⭐⭐⭐ ZJT（Apache-2.0）—— 含剪映草稿生成库

**定位**：短剧/小说转视频全流程工具，Node + Python 混合，自带 Web UI。

**目录结构要点**（`ZJT/:1-30`）：
```
ZJT/
├── jianying/            ★ 剪映多轨道草稿生成库（独立子库）
│   ├── src/core.py      多轨道草稿核心
│   ├── src/draft_generator.py   草稿生成器
│   ├── src/media_utils.py       媒体时长获取
│   └── config.py        剪映配置管理
├── script_writer_core/  剧本创作核心
├── llm/                 LLM 适配
├── web/                 前端
└── services/ services
```

**核心实现 1：剪映多轨道草稿生成**（`ZJT/jianying/src/draft_generator.py:24-62`）
```python
def generate_draft(self, copy_media_files: bool = True,
                   media_source_dir: Optional[str] = None) -> str:
    draft_path = os.path.join(self.library.output_dir, self.library.draft_name)
    os.makedirs(draft_path, exist_ok=True)
    resources_path = os.path.join(draft_path, "Resources")
    # 写入 draft_content.json
    content_path = os.path.join(draft_path, "draft_content.json")
    with open(content_path, 'w', encoding='utf-8') as f:
        json.dump(self._build_draft_content(), f, ensure_ascii=False, indent=2)
    # 写入 draft_meta_info.json
    meta_path = os.path.join(draft_path, "draft_meta_info.json")
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(self._build_draft_meta_info(), f, ensure_ascii=False, indent=2)
    return draft_path
```
产出两个 JSON（`draft_content.json` + `draft_meta_info.json`），复制到剪映草稿目录后重启剪映即可打开多轨道工程。

**核心实现 2：剪映 scale 适配铁律**（`ZJT/jianying/src/draft_generator.py:282-283`）
```python
# scale=1.0 为剪映默认适配基准：素材自动等比适应画布（保持长宽比、不裁切、不变形）。
# 切勿按"画布/素材尺寸比例"计算后写入——剪映会在该适配基准上叠加，导致过度放大、画面双向溢出只看到中间。
```
⚠️ 这是**踩过坑才写得出来的注释**。直接抄这个常量能省掉一轮「画面只看到中间」的 bug。

**核心实现 3：素材路径构建**（`ZJT/jianying/src/core.py:85-89`）
```python
def _build_material_path(self, filename):
    if self.platform == 'windows':
        return f"{base}\\{self.draft_name}\\Resources\\local\\{filename}"
    local_path = os.path.join(self.output_dir, self.draft_name, "Resources", "local", filename)
```

**工程实践**：`jianying/` 下有完整 README + examples + tests（`test_two_videos.py`）。代码质量中等偏上，注释是中文且带有踩坑说明。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| 剪映多轨道草稿生成库 | ⭐⭐⭐ | `packages/remotion-composer` 或新建 `packages/jianying-draft/` | low | **极高**：打通「AI 成片 → 剪映精修」最后一公里，是专业剪辑师的刚需入口 |
| scale=1.0 适配铁律 | ⭐⭐⭐ | 知识库 `01-docs/learnings.md` | 0 | 避免一轮视觉 bug |
| 剧本创作核心 | ⭐⭐ | `packages/ai-writer` | medium | 可参考其分场/角色抽取 |

**踩坑经验**：
- 剪映草稿的 `scale` 不是「画布/素材」比例，是**叠加基准**，写错会导致画面溢出（`draft_generator.py:282`）
- 草稿必须同时写 `draft_content.json` 和 `draft_meta_info.json`，缺一不可

**⭐ 核心实现 4：时长控制算法（把分镜总时长钉死在目标值）**（`llm/script_parser.py:1179-1268`）
先按 CJK 字符占比混合朗读速率估算剧本时长（`:868-886`），再抽出**真正需念的台词**（`extract_script_dialogue_text`，跳过 `【#[` 开头行、整行括号行、`时间|地点|人物|场景|幕|场|章节|备注|BGM|音效:` 元信息行，`:891-931`），然后双向归一：
```python
scale = float(target_seconds) / total_before
for s in shots:
    # 关键：单镜头下限 = max(全局最小秒数, 该镜头台词朗读秒数) —— 台词必须念完
    shot_floor = max(min_shot, compute_shot_dialogue_seconds(s))
    s["duration"] = round(max(shot_floor, _safe_float(s.get("duration", 0)) * scale), 1)
```
⚠️ **核心约束**：压不下去就逐个把全局最短镜头并入同组相邻镜头（`_merge_shot_into`，duration 取 max）；仍超限则接受超出并写 `dialogue_floor_exceeded_seconds`。低于下限时反向放大，但**单镜头封顶 10s** —— 「增加总时长靠增加镜头数而非拉长单镜头」。

**⭐ 核心实现 5：AcceptedRegistry 全局 ID 注册表**（`services/script_split_registry.py:36-100`）
解决分段拼接时实体 ID 冲突（第二段模型不知道第一段造了哪些角色）：
```python
def id_reservations(self) -> Dict[str, str]:
    """当前段可用的下一组新 ID（游标预留）。"""
    return {
        "character_start": f"char_{self._cursors['char']:03d}",
        "location_start":  f"loc_{self._cursors['loc']:03d}",
        "prop_start":      f"prop_{self._cursors['prop']:03d}",
    }
```
配合 `_normalize_name` 去【】〖〗标记+小写化做同名反查，新实体**只有拿到预留号段才合法**。这是「让 LLM 产出可拼接结构化数据」的通用范式。

**核心实现 6：两阶段增量分段拆分 + 检查点续跑**（`services/script_split_engine.py:487-566`）
长剧本拆成「规划→逐段生成→合并→发布」四步，每步间落检查点并释放租约，崩溃后从断点续跑。锚点化是纯函数（`script_split_planner.py:20-80`）：按空行切自然段，`场景|Scene #N`、`幕|Act #N` 作强制边界，每块记 `start_line/end_line/content_sha256`，**绝不改变原文内容与顺序** —— 让分段可被校验、可重放。

---

### 3.2 ⭐⭐⭐ short-drama-skills（MIT）—— 工业化分镜拆解 Prompt

**定位**（`short-drama-skills/README.zh-CN.md:24`）：
> Short Drama Skills 是一套经过工业化验证的提示词规则包。告诉 AI 怎么拆镜头、怎么写画面描述、每个镜头该多长，让 AI 从「能出视频」变成「能出连续剧」。

**来源**：LuxReal（AI 短剧工业化制作平台）的内部生产流水线核心规则（`README.zh-CN.md:144-148`），**上万 AIGC 创作者真实生产验证过**。

**7 条 Skill 结构**（`README.zh-CN.md:73-88`）：

| # | Skill | 用途 |
|---|---|---|
| 01 | 通用叙事拆解 | 剧本 → 带时长的镜头序列（覆盖 80% 日常剧情） |
| 02 | 深度情绪刻画 | 基于权力博弈拆解对话戏 |
| 03 | 详细动态描述 | 17 条专项规则拆解动作戏 |
| 04 | 按剧情连贯拆分副本 | 长剧本分集保持节奏不断裂 |
| 05 | 单视频提示词润色 | 剧情描述 → 结构化视频提示词 |
| 06 | 高能戏剧化情节润色 | 好莱坞动作风格高冲击力提示词 |
| 07 | 慢节奏细腻质感润色 | 文艺抒情风格细腻情感提示词 |

**核心规则（01 通用叙事拆解）**（`README.zh-CN.md:43-49`）：

| 类别 | 核心规则 |
|---|---|
| **节奏控制** | 信息密度原则——**不提供新信息就不切镜**；非叙事镜头占比 ≤ 20% |
| **叙事拆分** | 空间转场切镜、时间跳跃切镜、人数超 2 人拆散、复杂动作三段式 |
| **情绪处理** | 情绪突变切特写、渐变切景别、对话视线乒乓（**反应镜头比说话更重要**） |
| **长台词切分** | 超过 8s 的台词强制拆分，7 种视听手法分配，T1 占比 ≤ 60% |
| **时长估算** | 正常语速 `round(字数÷8)+1s`，争吵 `÷10+1s`，深情 `÷5+1s`，每镜 ≤ 12s |

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| 7 条分镜 Prompt 规则包 | ⭐⭐⭐ | **并入既有** `apps/desktop/electron/film-kit/prompt-doctrine.json`（**不新建目录** — 该文件已有 7 blocks + 10 rules 且完整接线） | **low** | **高**：为既有方法论补充「长台词切分 / 动作戏 / 时长估算 / 视觉描述四维度」等增量规则<br>⚠️ 初稿「直接补上 LLM 润色恒不生效缺口」的表述**过头**——未查明润色失败根因，见下方说明 |
| 时长估算公式 | ⭐⭐⭐ | `auto-plan.js` 的 `AUTO_SHOT_SECONDS` 常量 | low | mulpub 目前单镜时长只有 5/8/10 秒三档，这套公式能算出贴合台词的时长 |
| 剧作方法论文档 | ⭐⭐ | `01-docs/` | low | 补充分镜方法论 |

**为什么这是高性价比**：mulpub 的 `auto-plan.js:41` 硬编码 `AUTO_SHOT_SECONDS = 5,8,10`，而真实剧本的每镜时长应该由台词字数决定。这套规则直接给出公式。

> ⚠️ **两处自我修正（v3，评审实测）**：
> 1. **「补上 LLM 润色恒不生效缺口」的表述过头**。评审指出：本报告**从未查明润色链路失败的根因**（是 DI 传 `llm:null`？还是 `llm.enhance` 不可用？还是阶段侧硬编码 `llmEnabled:false`？三种可能对应完全不同的修法），就直接承诺「这套规则能补上」。**正确表述应为**：这套规则为**分镜拆分质量**提供经过工业化验证的增量规则；而「LLM 润色不生效」是一个独立缺陷，需先定位根因再决定修法。
> 2. **不新建目录**。见第五章 F1 修正说明 —— mulpub 已有 `prompt-doctrine.json` 且完整接线，新建会造第二套规范。

---

### 3.3 ⭐⭐⭐ short-drama（MIT）—— 微短剧剧本创作 Skill

**定位**：50-100 集微短剧剧本创作方法论，纯 Prompt 资产。

**工作目录约定**（`short-drama/SKILL.md:9-21`）：
```
{项目目录}/
├── creative-plan.md      # 创作方案
├── characters.md         # 角色档案
├── episode-directory.md  # 分集目录
├── episodes/ep001.md     # 分集剧本
├── compliance-report.md  # 合规报告
└── export/{剧名}-完整剧本.md
```

**状态机**（`SKILL.md:28-39`）：
```json
{
  "currentStep": "start|plan|characters|outline|episode|review|export",
  "genre": [], "audience": "", "tone": "",
  "totalEpisodes": 0, "completedEpisodes": [],
  "language": "zh-CN", "mode": "domestic|overseas", "dramaTitle": ""
}
```

**8 个 references 知识文件**（`SKILL.md:46-55`）：
genre-guide（13 种题材）、opening-rules（开篇黄金法则）、paywall-design（付费卡点）、rhythm-curve（节奏曲线）、satisfaction-matrix（爽点矩阵）、villain-design（4 层反派）、hook-design（5 种钩子）、compliance-checklist（合规审核）。

**单集剧本格式**（`SKILL.md:231-273`）：
```markdown
## 场次一
**场景：** 内景/外景 · {地点} · 日/夜
**出场人物：** {人物列表}
△ （全景）{场景描写，交代环境}
△ （中景）{人物动作描写}
**{角色名}**（{语气/动作指示}）："{台词}"
△ （特写）{关键细节描写}
♪ 音乐提示：{音乐氛围描述}
> 🎣 本集钩子：{悬念描述}
```

**出海模式**（`SKILL.md:445-471`）：自动切换好莱坞标准格式（INT./EXT.、WIDE SHOT/CLOSE-UP）+ 文化适配（替换中式孝道、宫斗；换成慈善晚宴、法庭、圣诞聚会）。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| 剧本创作状态机 + 8 个 references | ⭐⭐⭐ | `packages/ai-writer` 的短剧剧本模板 | medium | 让 mulpub 从「你给剧本我拆镜」延伸到「我帮你写剧本」 |
| 合规审核清单 | ⭐⭐⭐ | 发布前检查 | low | **国内短剧发布刚需**，避免违规下架 |
| 场景格式解析（△/♪/内景外景） | ⭐⭐⭐ | `script-adapt.js` 的 `splitScript` | medium | mulpub 现有分场只认 `\n{2,}`，可增强为识别标准剧本格式 |
| 出海模式 | ⭐⭐ | i18n | medium | mulpub 已有 zh/en 成对，可扩展 |

---

### 3.4 ⭐⭐⭐ showvi（MIT）—— 多智能体 + VLM 质检闭环

**定位**（`showvi/README.md:25-33`）：多智能体端到端视频生产，核心是「持续自我优化的生产闭环」。

**6 个专职 Agent 流水线**（`README.md:52`）：
```
剧本 → 依赖分组 → 实体状态追踪 → 分镜转换 → 连续性导演 → 自动验证修复
```

**核心实现 1：跨分段实体状态追踪**（`README.md:29,53`）
> 自动识别角色换装、受伤、变身、道具损坏等跨分段状态变化，生成衍生参考图

这解决了长视频「角色突然变脸」的根因——不是靠生图时锁参考图，而是**在剧本阶段就追踪状态变化**。

**核心实现 2：VLM 质检闭环**（`README.md:33,55`）
```
Generate → Critique → Rewrite → Retry
Gemini 多维评审：画面质量、角色一致性、物理合理性
```

**核心实现 3：16 宫格关键帧传递 + 转场桥接**（`README.md:29,57`）
> 16 宫格关键帧传递 + 转场桥接 + 连续性导演，分段画面无缝衔接

**核心实现 4：断点续跑**（`README.md:59`）
> 每步保存 checkpoint，崩溃后自动恢复云端在飞任务，**已替换素材受保护不被覆盖**

**⭐ 核心实现：adelay + amix 音画同步**（`showvi/tools/video_concat.py:121-202`）
```python
def _concat_crossfade(normalized_paths, output_path, fade=0.5) -> bool:
    """
    IMPORTANT: Audio synchronization fix.
    The original implementation had audio/video desync because acrossfade
    doesn't support offset parameter. This version uses adelay + amix to
    ensure audio stays in sync with video xfade transitions.
    """
    # 视频链：链式 xfade（offset 递进）
    video_offset = durations[0] - fade
    for i in range(1, n):
        video_parts.append(f"[{prev_v}][{i}:v]xfade=...:offset={video_offset}[{out_v}]")
        video_offset += durations[i] - fade
    # 音频链：用 adelay 手动对齐每段绝对起始时刻（acrossfade 不支持 offset）
    current_time = 0.0
    for i in range(n):
        delay_ms = int(current_time * 1000)
        audio_parts.append(f"[{i}:a]afade=...,adelay={delay_ms}|{delay_ms}[a{i}]")
        current_time += durations[i] - fade
    audio_parts.append(f"{''.join(audio_streams)}amix=inputs={n}:duration=longest:normalize=0[aout]")
```
⚠️ **关键洞见**：`acrossfade` **不支持 `offset` 参数**，直接用它必然音画不同步。正解是用 `adelay` 手动对齐每段音频的绝对起始时刻再 `amix`（`normalize=0` 因为已 loudnorm 过）。

⚠️ **但注意**：showvi 视频侧用**链式 xfade**（`offset` 递进），而 ai-art-engine 明确指出链式 xfade 会累计漂移。**最优解 = showvi 的 adelay+amix 音频方案 + ai-art-engine 的「独立段 + 一次性 concat」视频方案**。

> 🔴 **v3 修正（评审实测发现公式错）**：报告说「两者结合」却**没给出该用哪个延迟公式**，这是错的：
> - showvi 的延迟量 `Σ(durations[j] - fade)`（`:183`）**恰好是链式 xfade 的 offset 序列**（因为有 fade 重叠，后一段起点 = 前一段终点 - fade）。
> - 若改用**无重叠 concat**（ai-art-engine 方案），后一段起点 = 前一段终点，**正确值应为 `Σ durations[j]`**（不含 `-fade`）。
> - 直接套用 showvi 公式 ⇒ 音频超前 `(n-1) × fade` 秒。**10 镜 × 0.5s fade = 音频超前 4.5 秒**。
>
> ✅ **正确做法**：延迟公式必须与视频合成方式**同构** ——
> | 视频方案 | 音频延迟公式 |
> |---|---|
> | 链式 xfade（有重叠） | `Σ(durations[j] - fade)` |
> | 独立段 + concat（无重叠） | `Σ durations[j]` |
>
> 由于 mulpub 当前**已是 concat 直拷**（`film-render.js:308`），未来若要加转场，**必须先确定走哪种方案，再选对应公式**，不能混用。这一条应写入实施时的注释与单测。

**核心实现 6：断点续跑 —— history_id 只轮询不重提交**（`showvi/agent.py:1744-1803`）
```python
def resume_pending_attempts(self):
    """重启后恢复：对所有 IN_PROGRESS 的 attempt 继续轮询，而不是重新提交。
    从 checkpoint 里读取 history_id / backend，调用对应 client 继续等待并下载结果。"""
    for unit in self.project_state.script.work_units:
        for attempt in unit.attempts:
            if attempt.status != AttemptStatus.IN_PROGRESS: continue
            history_id = (attempt.metadata or {}).get("history_id")
            if not history_id:
                attempt.status = AttemptStatus.FAILED   # 无 ID 可恢复 → 明确失败
                continue
            result = get_seeddance_client().wait_for_video(history_id)   # 只轮询，不重提交
```
⚠️ **核心模式**：把云端任务 ID 持久化进 checkpoint，重启后**只轮询不重提交** —— 避免重复扣费。生视频是最贵环节，这个模式直接省钱。

**核心实现 7：WorkUnit attempts[] 历史 + 人工选优锁定**（`showvi/models.py:39-102`）
```python
class WorkUnit(BaseModel):
    attempts: List[GenerationAttempt] = []   # 完整历史数组，非覆盖
    escalation_level: int = 1                # 逐级降级
    final_attempt_locked: bool = False       # 人工锁定最优
```
支持「多次生成后人工挑选最优」，mulpub 生视频阶段可直接借鉴。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| **adelay + amix 音画同步** | ⭐⭐⭐⭐⭐ | `packages/audio-aligner` | **low** | **极高**：根治 xfade 音画不同步，MIT 零风险 |
| checkpoint + history_id 只轮询不重提交 | ⭐⭐⭐⭐⭐ | `story2video-engine` 任务队列 | medium | 避免重启重复扣费 |
| VLM 质检闭环（生成→评审→改写→重试） | ⭐⭐⭐⭐⭐ | `video-gen.js` 后增加 QC 阶段 | medium | **极高**：mulpub 目前生视频失败只能手动重试 |
| WorkUnit attempts[] 历史 + 人工选优 | ⭐⭐⭐⭐ | `story2video-engine` 生视频阶段 | medium | 支持多次生成择优 |
| 断点续跑 + 已替换素材保护 | ⭐⭐⭐ | `auto-runner.js`（已有类似，可强化） | low | mulpub 已有「磁盘为真」续跑 |
| 素材归一化（分辨率/帧率/loudnorm） | ⭐⭐⭐⭐ | 合成阶段 | low | concat 成功的必要前置 |
| continuity_anchor 段间衔接 prompt | ⭐⭐⭐⭐ | `story2video-engine` 分镜 | low | 解决段间硬切 |
| 16 宫格关键帧传递 | ⭐⭐ | `video-reference-inputs.js` | medium | mulpub 参考图仅 3 个 provider 支持 |
| 违规自适应改写 | ⭐⭐ | 提示词预处理 | medium | 国内发布刚需 |

**工程实践**：Python 3.12，MIT，153 个文件（轻量）。`clients/` 下有 `gemini.py`、`openai_image.py`、`llm_client.py`、`browser_workers.py`（即梦网页自动化）。
⚠️ 缺点：ffmpeg 用 `subprocess.run` 裸调**无超时控制**（长任务可能挂死）；强绑定 Seedance/即梦。

---

### 3.5 ⭐⭐⭐ autoclip（MIT）—— 字幕驱动的长视频切片

**定位**：长视频 → 高光切片 → 竖版成片，**字幕驱动**是其核心设计。

**核心实现 1：ASR 词级时间戳 sidecar**（`autoclip/backend/utils/word_timing.py:46-72`）
```python
def write_word_timing(srt: Path, segments, language=None, source='faster-whisper'):
    if source not in {'faster-whisper', 'sensevoice'}:
        raise ValueError('Unsupported ASR word timing source')
    payload = {..., 'srt_sha256': hashlib.sha256(srt.read_bytes()).hexdigest(), ...}
    target = sidecar_path(srt)

def load_word_timing(srt: Path):
    payload = json.loads(sidecar_path(srt).read_text(encoding='utf-8'))
    if payload.get('schema_version') != 1 or payload.get('source') not in {...}:
        return None
    if payload.get('srt_sha256') != hashlib.sha256(srt.read_bytes()).hexdigest():
        return None   # ★ SRT 被编辑过 → sidecar 失效
```
⚠️ **关键设计**：SRT 只有句级时间，ASR 词级时间存 sidecar，用 `srt_sha256` 绑定 —— **编辑字幕即失效**。这正是 mulpub `audio-aligner` 需要的防陈旧机制。

**核心实现 2：字幕策略多路回退**（`autoclip/backend/utils/bilibili_downloader.py:214-232`）
```python
async def _try_alternative_subtitle_strategies(self, url, safe_title):
    for strategy in [self._try_different_langs, self._try_no_cookies, self._try_from_metadata]:
        try:
            subtitle_path = await strategy(url, safe_title)
            if subtitle_path: return subtitle_path
        except Exception as e:
            logger.warning(f"备用字幕策略失败 {strategy.__name__}: {e}")
    logger.warning("所有字幕获取策略都失败了")
```

**核心实现 3：SRT 时间转 ffmpeg 时间**（`autoclip/backend/utils/video_processor.py:69-80`）
```python
@staticmethod
def convert_srt_time_to_ffmpeg_time(srt_time: str) -> str:
    """SRT时间格式 (如 "00:00:06,140" 或 "00:00:06.140")"""
    return srt_time.replace(',', '.')
```

**核心实现 4：基于字幕删除的视频重剪辑**（`autoclip/backend/utils/video_editor.py:26-60`）
```
edit_video_by_subtitle_deletion(subtitle_data, deleted_segments)
  → generate_edited_video_timeline() → 时间线重算 → ffmpeg 裁切
```

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| ASR sidecar + srt_sha256 失效机制 | ⭐⭐⭐ | `packages/audio-aligner/` | low | **直接可用**：防止字幕编辑后时间戳陈旧 |
| 字幕多路回退策略 | ⭐⭐⭐ | `packages/collection-engine/` | medium | mulpub 有 collection-engine，可参考其降级链 |
| 字幕驱动切片算法 | ⭐⭐ | `packages/story2video-engine` | medium | 与影视工程互补（一个是生成，一个是裁切） |
| B 站字幕下载（ai-zh 优先） | ⭐⭐ | `collection-engine` | low | `bilibili_downloader.py:159` 的 `['ai-zh','zh-Hans','zh','en']` 顺序可直接抄 |

**工程实践**：**极高质量**。1314 文件，有 CHANGELOG（记录大量真实 bug 修复）、RELEASE_CHECKLIST、SECURITY.md、8 种语言 README、benchmarks、docs。MIT 许可证。这是 16 个项目里工程实践最成熟的之一。

---

### 3.6 ⭐⭐ Toonflow-app（MIT）—— 无限画布 + 资产画布

**定位**（`Toonflow-app/README.md:128`）：面向短剧、漫剧和短视频创作者的开源 AI 创作工具，无限画布编写剧本与分镜、管理角色和场景素材。

**架构**（monorepo，Bun + Electrobun）：
```
Toonflow-app/
├── apps/web/        Vue 3 前端
├── apps/desktop/    Electrobun 桌面端
├── packages/
│   ├── teams/storyboardTeam/   ★ 分镜团队 Agent
│   └── tools/workspace/        工作区文件（readTextSnapshot/writeTextSnapshot）
└── docs/readme/     20+ 语言 README
```

**核心实现 1：文本快照 + 期望修订号写入**（`apps/web/src/lib/workspaceFiles.ts:98-109`）
```typescript
async function readTextSnapshot(path, options?): Promise<TextSnapshot> {
  const { data } = await client.get("/read", { params: { directory, path, snapshot: true, ... } })
}
async function writeTextSnapshot(path, text, snapshot) {
  params: { directory, path, expectedRevision: snapshot.revision, encoding: snapshot.encoding }
}
```
⚠️ **乐观锁**：写入必须带 `expectedRevision`，防止并发覆盖。文档编辑器 `documentSession.ts:496-498` 还有「磁盘内容已变化，请重新搜索」的校验。

**核心实现 2：分镜团队 Agent**（`bun.lock:602-603`）：`@toonflow/team-storyboard`

**核心实现 3：多语言 README**（20+ 语言，从阿拉伯语到孟加拉语）—— 国际化工程实践值得学习。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| 文本快照 + expectedRevision 乐观锁 | ⭐⭐⭐ | `auto-project.js` 的项目文件写入 | low | **直接可用**：mulpub 的 project.json 写入可加此保护 |
| 画布 + 资产画布分离 | ⭐⭐ | `useFilmCanvas.js` | medium | mulpub 画布只有分镜，无角色/场景资产画布 |
| 插件市场架构 | ⭐ | 无对应 | high | 暂不考虑 |

---

### 3.7 ⭐⭐ Jellyfish（Apache-2.0）—— 一致性为一等公民

**定位**（`Jellyfish/README.md:44`）：
> **Treat consistency as a first-class problem**: Centralized character, scene, prop, and costume management reduces drift across shots.

**架构**：React + FastAPI，OpenAPI 代码生成（`front/src/services/generated/`）。

**核心实现 1：镜头枚举体系**（`backend/app/models/types.py:67-188`）
```python
class CameraShotType(str, Enum): ...      # 景别
class CameraAngle(str, Enum): ...         # 机位角度
class CameraMovement(str, Enum): ...      # 运镜
class ShotFrameType(str, Enum): ...       # 帧类型
class VFXType(str, Enum):                 # 特效类型
    'NONE' | 'PARTICLES' | 'VOLUMETRIC_FOG' | 'CG_DOUBLE' | 'DIGITAL_ENVIRONMENT'
    | 'MATTE_PAINTING' | 'FIRE_SMOKE' | 'WATER_SIM' | 'DESTRUCTION'
    | 'ENERGY_MAGIC' | 'COMPOSITING_CLEANUP' | 'SLOW_MOTION_TIME' | 'OTHER'
```
⚠️ **这套枚举是影视专业的完整镜头语言体系**，比 mulpub 的 `aspectRatio/durationSec` 丰富得多。

**核心实现 2：任务执行器抽象**（`backend/app/services/worker/task_executor.py:43-193`）
```python
class AbstractLLMResultGenerator(ABC): ...
class AbstractWorkerTaskExecutor(ABC): ...
class AbstractAsyncDelegatingExecutor(AbstractWorkerTaskExecutor): ...
```

**核心实现 3：交付策略模式**（`backend/app/core/task_manager/strategies.py:16-69`）
```python
class DeliveryStrategy(ABC): ...
class StreamingDeliveryStrategy(DeliveryStrategy): ...
class AsyncPollingDeliveryStrategy(DeliveryStrategy): ...
```
⚠️ **流式 vs 轮询双策略** —— mulpub 的 `video-gen.js` 只有轮询（10s×10min），可参考增加流式。

**⭐ 核心实现 4：就绪度闸门 shot_video_readiness**（`backend/app/services/studio/shot_video_readiness.py:77-203`）
```python
missing = [frame.value for frame in required_frames
           if not frame_map.get(frame) or not frame_map[frame].file_id]
# 检查项：duration / extraction / prompt / reference_frames / video_model / provider
# 每项返回 {ok, message}；ready = all(...)
```
⚠️ **这是「生成前闸门」范式**：消灭「生成一半才发现缺参考图 / 没配模型」。mulpub 的自动模式（`PRD-FILM-AUTO-MODE`）必须有此闸门才能安全跑批。

**⭐ 核心实现 5：视频能力协商表**（`backend/app/core/integrations/video_capabilities.py:11-115`）
```python
DEFAULT_RATIO_TO_SIZE_MAPPING = {"16:9":"1280x720", "9:16":"720x1280", "21:9":"1680x720", ...}
class VideoModelCapability(BaseModel):
    supports_seed: bool; supports_watermark: bool
    allowed_ratios: list; default_ratio: str
    ratio_to_size_mapping: dict
    min_seconds: int; max_seconds: int
def validate_video_options(): ...   # 按 model 前缀解析能力后校验 ratio/seconds/seed/watermark
```
⚠️ **业务层只传 `ratio`，size/duration/seed 由能力表派生** —— 新增供应商 = 注册一条 capability，零业务代码改动。mulpub 目前 `video-gen.js` 是硬编码档位，这是更优解。

**核心实现 6：四段式提示词流水线**（`backend/app/services/studio/generation/{frame,asset_image,video}/`）
```
build_base（LLM 出基础提示词）
  → build_context（注入实体上下文）
  → build_submission（拼提交体 + 图片映射）
  → derive_preview（用户预览后再生成）
```
**基础提示词与图片映射分离**，每个生成环节同构。比 mulpub 的单体 prompt 组装更易维护。

**核心实现 7：首/尾/关键帧提示词 21 条强约束**（`backend/app/chains/agents/shot_frame_prompt_agents.py:100-170`）
```python
_FRAME_FOCUS = {
  "首帧": "...只表现触发瞬间或最初反应，不要直接写成后续完成动作、最终姿态或情绪爆发完成态",
  "尾帧": "强调动作收束、人物结束姿态、视线落点或情绪余韵",
  "关键帧": "最具戏剧张力或信息密度最高的瞬间",
}
# 21 条约束含相邻镜头承接（previous_shot_*/next_shot_*）：
# 13. 承接上一镜头的动作、空间方向、视线或情绪
# 15. 明确主体相对位置、朝向与动作峰值，减少构图和轴线突变
# 17. 保持人物左右关系、视线落点与反打轴线稳定，不要无故翻转
```
⚠️ **「首帧写未完成态」「反打轴线稳定」是质量分水岭**，直接提升连贯性。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| **Shot/ShotDetail 模型 + 全套枚举** | ⭐⭐⭐⭐⭐ | `python-backend/app/models/film/shot.py` + `shared-utils/src/film/shotTypes.ts` | **low** | mulpub 分镜缺标准 schema，这是从「脚本」升级为「工程」的地基 |
| **就绪度闸门 shot_video_readiness** | ⭐⭐⭐⭐⭐ | `story2video-engine/src/shotReadiness.ts` | low | 消灭「生成一半才知缺参考图/没配模型」 |
| **视频能力协商表** | ⭐⭐⭐⭐⭐ | `python-backend/app/integrations/videoCapabilities.py` | low | 新增供应商从改业务代码变为注册一行配置 |
| 镜头语言枚举体系 | ⭐⭐⭐⭐ | `film-kit` 数据资产 + Shot schema | medium | 让 mulpub 的分镜从「只有 prompt」升级为「结构化镜头语言」 |
| 首/尾/关键帧 21 条约束 | ⭐⭐⭐⭐ | `story2video-engine/src/prompts/shotFrame.md` | low | 直接提升连贯性 |
| 四段式提示词流水线 | ⭐⭐⭐ | 重构 `storyboard-prompt.ts` | medium | 解耦基础提示词与图片映射 |
| 流式/轮询双交付策略 | ⭐⭐⭐ | `video-gen.js` | medium | 改善长任务体验 |
| FileUsage 资产用途追踪 | ⭐⭐ | `python-backend/app/models/film/fileUsage.py` | low | 多平台发布需追溯素材来源 |

> ⚠️ **Jellyfish 的短板**：全项目 grep 无 ffmpeg/concat —— **成片合成阶段缺失**。需 mulpub 用 `remotion-composer` 自行接上。

---

### 3.8 ⭐⭐ Pixelle-Video（Apache-2.0）—— 原子能力可替换

**定位**（`Pixelle-Video/README.md:19-25`）：输入一个主题，自动完成文案 → 配图/视频 → 语音解说 → 背景音乐 → 合成。

**核心实现：原子能力灵活组合**（`README.md:62`）
> 支持 ComfyUI / RunningHub 工作流，也支持直连 API 模型，可按需替换图像、视频、TTS、VLM 等能力

**核心实现：固定脚本多种分割方式**（`README.md:43`）
> 支持固定脚本多种分割方式（段落/行/句子）

**⭐ 核心创新：TTS 时长驱动视频时长**（`pixelle_video/services/frame_processor.py:19-20,151-195,225-275`）
```python
# 文件头注释点明设计意图：
# TTS-driven video duration: Audio duration from TTS is passed to video generation
# workflows to ensure perfect sync between audio and video (no padding, no trimming needed)

# Step 1: 先生成音频，从音频反推帧时长
audio_path = await self.core.tts(**tts_params)
frame.audio_path = audio_path
frame.duration = await self._get_audio_duration(audio_path)

# Step 2: 把音频时长作为视频生成的目标时长
if is_video_workflow and frame.duration:
    media_params["duration"] = frame.duration
```
⚠️ **这是顺序倒置的范式级创新**：不是「先生成固定时长视频再配音对齐」，而是「先 TTS 拿到真实时长，再让视频服务按此时长产出」，**从源头消除 padding/trimming**。

**⭐ 核心实现：三态时长对齐 + 容差**（`pixelle_video/services/video.py:300-421`）
```python
def merge_audio_video(self, video, audio, output, pad_strategy="freeze",
                      auto_adjust_duration=True, duration_tolerance=0.3):
    """- If video < audio: Pad video to match audio (avoid black screen)
       - If video > audio (within tolerance): Keep as-is (acceptable)
       - If video > audio (exceeds tolerance): Trim video to match audio"""
    diff = video_duration - audio_duration
    if diff < 0:
        video = self._pad_video_to_duration(video, audio_duration, pad_strategy)
    elif diff > duration_tolerance:
        video = self._trim_video_to_duration(video, audio_duration)
    # else: 0 <= diff <= tolerance → 容差内不动，避免无谓重编码
    # freeze 策略：tpad 克隆最后一帧（观感优于黑屏）
    video_stream.filter('tpad', stop_mode='clone', stop_duration=pad_duration)
```
**三态决策 + 0.3s 容差**是很实用的工程折中：小差异不动，大差异才 pad/trim。

**核心实现：双 concat 策略**（`services/video.py:169-253`）
```python
def _concat_demuxer(self, videos, output):   # concat demuxer：快，无重编码
    ffmpeg.input(filelist, format='concat', safe=0).output(output, c='copy')
def _concat_filter(self, videos, output):    # concat filter：慢，但兼容不同格式
    filter_complex = f"{stream_spec}concat=n={n}:v=1:a=1[v][a]"
```
按「是否需要重编码」自动选路。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| **TTS 时长驱动视频时长** | ⭐⭐⭐⭐⭐ | `packages/audio-aligner` + `story2video-engine` | medium | **范式级**：从源头消除音画对齐开销 |
| **三态时长对齐（pad/trim/容差）** | ⭐⭐⭐⭐⭐ | `packages/audio-aligner` | **low** | **几乎可原样搬**：audio-aligner 的核心算法 |
| 双 concat 策略 | ⭐⭐⭐⭐ | 合成阶段 | low | 按是否重编码自动选路 |
| cover/contain 缩放 + BGM amix | ⭐⭐⭐⭐ | 合成阶段 | low | 行业共识写法 |
| 任务持久化 + index 重建 | ⭐⭐⭐⭐ | `story2video-engine` 任务管理 | medium | 完整 CRUD + 断点恢复 |
| 原子能力可替换架构 | ⭐⭐ | 参考 mulpub 已有 AdapterRegistry | low | mulpub 已有更完善的 registry，此项仅作验证 |
| 脚本分割方式（段落/行/句子） | ⭐⭐ | `script-adapt.js:splitScript` | low | mulpub 现仅按 `\n{2,}` 分段，可增强 |

> ⚠️ 注意：Pixelle-Video 强绑定 ComfyUI（重依赖）；字幕粒度粗（每帧一条 narration，**无词级/句级时间轴**）；`moviepy 1.0.3` 老旧。复用时应只取算法层，不引入 ComfyUI 依赖。

---

### 3.9 ⭐⭐ FastMovieAI（Apache-2.0）—— 商业化平台架构

**定位**：一站式短剧创作平台，含用户管理、支付、VIP 会员。

**技术栈**：PHP 8.1+ / Webman 2.1+ / Vue 3.5 / TypeScript 5.9 / Vite 7.1（8181 文件，规模最大）。

**核心实现**：支付集成（支付宝、微信）、VIP 会员体系、角色管理、语音合成、可视化剧本编辑器。

**复用评估**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| 可视化剧本编辑器 + 分镜头管理 | ⭐⭐ | `FilmEngineeringView.vue` | medium | 可参考其剧本编辑交互 |
| 支付/会员体系 | ⭐ | 无对应（mulpub 用 license-access-control） | high | 暂不考虑 |
| 平台对标分析 | ⭐ | 竞品文档 | low | 其 README 列出了商汤 Seko、幻舟、巨日禄等竞品，可作竞品清单 |

---

### 3.10 ⭐ moyin-creator（AGPL-3.0）🚫 仅参考思路

**定位**：影视级 AI 创作：剧本 → 分镜 → **视角变体** → 生图 → 生视频。Electron + React。

**核心数据结构**（`demo-data/projects/_p/*/scenes.json:1`）：
```json
{
  "name": "1-1 乡村公路/大巴车-过道与座位全景",
  "location": "乡村公路/大巴车", "time": "day", "atmosphere": "peaceful",
  "styleId": "jp_3d_render_2d", "folderId": null, "projectId": "...",
  "parentSceneId": "scene_1770384985495_xthopro",
  "viewpointId": "aisle_overview", "viewpointName": "过道与座位全景",
  "shotIds": ["shot_...", "shot_..."],
  "isViewpointVariant": true, "id": "scene_...", "createdAt": ..., "updatedAt": ...
}
```

**⭐ 核心创新：视角变体（Viewpoint Variant）**
同一场景（1-1 乡村公路/大巴车）派生出多个视角：
- `aisle_overview` 过道与座位全景
- `floor_closeup` 过道地面特写
- `window_view` 车窗外景
- `seat_interaction` 座位对话视角

每个变体通过 `parentSceneId` 关联父场景，`isViewpointVariant: true` 标记。

**复用价值（仅思路）**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| **视角变体模型** | ⭐⭐⭐ | `film-kit` 的 Scene schema 增加 `parentSceneId` + `viewpointId` | medium | **极高思路价值**：mulpub 的 Scene 只有树形层级，没有「同一场景多机位」概念 |
| 视觉风格库 | ⭐⭐ | `visual-styles.ts` → mulpub 风格预设 | medium | 其 `src/lib/constants/visual-styles.ts:115-132` 有 10+ 风格（含 Genshin、Guilty Gear 等） |
| imagePrompt / videoPrompt / endFramePrompt 三分 | ⭐⭐⭐ | Shot schema | low | mulpub 的 Shot 只有 `prompt`，应拆为首帧/视频/尾帧三类 |

**踩坑经验**（`scenes.json` 中 `director.json`）：prompt 同时存中英双语（`imagePrompt` + `imagePromptZh`），便于调试。

---

### 3.11 ⭐ ai-art-engine（GPL）🚫 仅参考思路

**定位**：本地优先 AI 创作工作站，7.6.0 版本有完整「影视工作台（`film.workbench`）」。

**核心实现：影视工作台四阶段**（`website/manual.html:309-313`）
```
① 分镜拆解：文本模型按剧情自动拆出结构化镜头列表（景别、运镜、单镜时长、台词、
   画面与动态提示词，镜头数随剧情决定）与角色/场景/道具实体表
② 导演审核：AI 导演对照剧本逐镜审查，不通过的镜头自动重写修订并复审
   （已锁定的镜头不改写）
③ 角色场景设定：生成角色定妆图与环境锚点图
④ 批量拍摄：按每镜出场名单自动以 @1/@2 挂载设定图生成关键帧
   （开启同场次连续性与视觉质检自动重拍）→ 以关键帧为首帧批量生成镜头视频
```

**核心实现：单镜锁定**（`website/guide-short-video.en.html:287-288`）
> Any shot card with its Lock icon toggled on (`locked: true`) is protected from both re-breakdown and director auto-revision

**核心实现：指纹缓存**（`website/guide-short-video.en.html:249,257`）
> existing keyframes hit the fingerprint cache 100% without redrawing
> Edit one shot, reshoot only one shot — all unchanged shots hit the fingerprint cache and skip immediately

**核心实现：跨集全剧角色表 Series Bible**（`CHANGELOG.md:19`）
> 把第 1 集的 `out-cast` 扇出连到后续第 2〜100 集的 `in-cast`；分镜拆解阶段自动将「全剧固定角色与场景名录」注入系统提示词

**核心实现：角色多造型 `#变体`**（`CHANGELOG.md:20`）
> `沈念#晚礼服`、`林澈#战损` —— 自动查找基础角色定妆图作为首张参考图，保证跨造型五官骨相一致

**核心实现：按场次并发渲染**（`CHANGELOG.md:21`）
> 同一场次内镜头串行传递上一镜末帧/首帧保证空间连续性，不同场次并行执行，单集耗时降低 60%-75%

**复用价值（仅思路）**：
| 组件 | 等级 | mulpub 落点 | 成本 | 收益 |
|---|---|---|---|---|
| **单镜锁定 locked:true** | ⭐⭐⭐ | Shot schema 加 `locked` 字段 | **low** | **极高**：mulpub 重跑分镜会覆盖手工编辑，这是刚需 |
| **指纹缓存（改一镜只重跑一镜）** | ⭐⭐⭐ | `auto-runner.js` 重生成逻辑 | medium | mulpub 已有「已完成镜绝不重做」，可参考其指纹粒度 |
| **按场次并发（场内串行、场间并行）** | ⭐⭐ | `production-driver.js` | medium | ⚠️ **现状描述已修正**：mulpub 实为**批内并发 2**（`production-runner.js:14` `PRODUCTION_BATCH_CONCURRENCY=2`，`auto-runner.js:156` 同），非「全并行」。故收益方向是「场间提并发」而非「场内串行」，风险为 provider 限流 |
| 跨集 Series Bible | ⭐⭐⭐ | film-kit 增加 `cast` 资产 | medium | mulpub 是单集模型，这是多集扩展的方向 |
| 角色 `#变体` 造型继承 | ⭐⭐ | 参考图机制 | medium | 换装/战损不换脸 |

---

### 3.12 🚫 禁止商用复用（5 个）

| 项目 | 许可证 | 形态 | 可参考什么 |
|---|---|---|---|
| **waoowaoo** | Elastic 2.0 | Next.js + Prisma，多人协作 AI 动漫短剧 | 仅产品形态：多人协作、项目/分镜管理交互 |
| **huobao-drama** | CC BY-NC-SA 4.0 | Nuxt + Hono + Electron，完整短剧流水线 | 仅架构：其 `backend/src/services/adapters/registry.ts:14-43` 的图像/视频 adapter 注册表设计（**思路可抄，代码不可抄**） |
| **novelvids** | CC BY-NC 4.0 | FastAPI + Vue3，小说转短剧 | 仅流程：章节拆分/视频理解→实体提取→设定资产→分镜→多模态生成→成片合并 |
| **app.yumcut.com** | PolyForm NC | Node 在线剪辑 | 仅产品形态 |
| **BigBanana-AI-Director** | 社区版 | 无源码（32 文件，全是图片+文档） | 仅产品形态：其截图展示了「导演工作台」「镜头九宫格」「世界观」「道具」等模块布局 |

**huobao-drama 的 adapter 注册表思路**（`backend/src/services/adapters/registry.ts:14-43`）：
```typescript
export const imageAdapters: Record<string, ImageProviderAdapter> = { ... }
export const videoAdapters: Record<string, VideoProviderAdapter> = { ... }
export function getImageAdapter(provider: string): ImageProviderAdapter { ... }
export function getVideoAdapter(provider: string): VideoProviderAdapter { ... }
```
mulpub 的 `AdapterRegistry` 已有等价能力且更完善（含 `getAdaptersByCapability` 按能力筛选 + 版本校验 + 注册时自动 validateConfig），**此项仅作交叉验证，无需引入**。

### 3.17 ⭐⭐⭐⭐ FireRed-OpenStoryline（Apache-2.0）—— 小红书出品，最接近「成片剪辑」段的对标

> **v2 新增**。这是 19 个项目里**唯一一个把「剪辑」本身做成 agentic 流水线**的项目，来自小红书 FireRed 团队（Apache-2.0，可安全复用）。

**定位**：把视频创作变成对话体验。核心链路是「智能素材搜索下载 → 片段拆分与理解 → 文案生成 → 配音/选曲/字体推荐 → 对话式精修 → 渲染」，并支持**把一次剪辑逻辑沉淀成可复用 Skill**。

**技术栈**：Python ≥3.11 + FastAPI + **MCP**（Model Context Protocol）+ LangChain + `skillkit` + **TransNetV2**（镜头边界检测）。141 个文件，1.1 MB。

**架构**（`src/open_storyline/`）：
```
agent_fastapi.py (3728 行)          Agent 服务入口
src/open_storyline/
├── nodes/                          节点系统
│   ├── node_schema.py    (513 行)  19 个节点的 Pydantic Input/Output 契约
│   ├── node_manager.py   (168 行)  节点注册 / 拓扑排序 / check_excutable
│   ├── node_summary.py   (236 行)
│   └── core_nodes/                 19 个节点实现
│       render_video.py        (1023 行)  ← 最大
│       plan_timeline.py        (907 行)
│       plan_timeline_pro.py    (728 行)
│       generate_voiceover.py   (651 行)
│       split_shots.py          (611 行)  ← TransNetV2
│       generate_ai_transition.py (571 行)
├── mcp/                            MCP 集成（register_tools / sampling / node_interceptors）
├── skills/skills_io.py   (83 行)   Skill 发现与「沉淀」
├── storage/                        session / file / agent_memory
└── utils/                          prompts(100) / ffmpeg(305) / ai_transition_client(349)

prompts/tasks/<task>/{zh,en}/{system,user}.md   ← 任务化 + 中英成对的 prompt 库
.storyline/skills/<name>/SKILL.md               ← 5 个内置 Skill
```

**⭐ 核心实现 1：任务化 + 中英成对的 Prompt 库**（`src/open_storyline/utils/prompts.py:1-100`，仅 100 行）

这是本次调研里**最干净、最可搬**的 prompt 组织形式：

```python
PROMPTS_DIR = Path("prompts/tasks")

def _load_template(self, task: str, role: str, lang: str) -> str:
    cache_key = f"{task}:{role}:{lang}"
    if cache_key in self._cache: return self._cache[cache_key]
    template_path = self.prompts_dir / task / lang / f"{role}.md"   # prompts/tasks/filter_clips/zh/system.md
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")   # fail-closed
    ...

def render(self, task, role, lang="zh", **variables):
    return re.sub(r"{{(.*?)}}", lambda m: str(variables[m.group(1)]), template)
```

四个设计点都值得直接抄：
1. **目录即契约**：`prompts/tasks/<task>/<lang>/<role>.md`，加任务只需建目录，不改代码
2. **中英成对是强制结构**：`zh/` 与 `en/` 并列，语言缺失直接抛 `FileNotFoundError` —— 这恰好满足 mulpub 的 **CI Gate 7（locale 成对）**，是天然的合规结构
3. **`{{var}}` 正则插值**，不引入模板引擎依赖
4. **按 `task:role:lang` 缓存**，且 fail-closed

**已覆盖的 11 个任务**：`elementrec_text`、`filter_clips`、`generate_ai_transition`、`generate_script`、`generate_title`、`generate_voiceover`、`group_clips`、`instruction`、`select_bgm`、`speech_rough_cut`、`understand_clips`。每个任务都有 system/user 两份、zh/en 两语言 —— 约 40 个 prompt 文件。

**⭐ 核心实现 2：19 节点 agentic 剪辑流水线**

| 节点 | 作用 |
|---|---|
| `LoadMedia` / `SearchMedia` | 本地加载 / 在线搜索下载素材 |
| `SplitShots` | **TransNetV2 镜头边界检测** |
| `LocalASR` / `SpeechRoughCut` | 本地语音识别 / **口播粗剪** |
| `UnderstandClips` | VLM 理解片段内容（overall + detail 两级） |
| `FilterClips` / `GroupClips` | 筛选 / 按主题分组 |
| `GenerateScript` / `RecommendScriptTemplate` | 生成文案 / 推荐仿写模板（few-shot 风格复刻） |
| `GenerateVoiceover` / `SelectBGM` / `RecommendText` | 配音 / 选曲（含卡点）/ 推荐字体 |
| `RecommendTransition` / `GenerateAITransition` | 推荐转场 / **AI 转场生成** |
| `PlanTimeline` / `PlanTimelineAITransition` | 时间线编排（含转场版本） |
| `RenderVideo` | 最终渲染 |

**⭐ 核心实现 3：TransNetV2 镜头边界检测**（`nodes/core_nodes/split_shots.py:30-115`）

mulpub **完全没有**这个能力（film-kit 的镜头是人工预设的），而它是「拿到一段原片 → 自动切分」的前置：

```python
# split_shots.py:30-36
# TransNetV2 expects frames with shape [..., 27, 48, 3]
TRANSNETV2_INPUT_HEIGHT = 27
TRANSNETV2_INPUT_WIDTH  = 48
DEFAULT_SCENE_DETECTION_FRAMES_PER_SECOND = 25
DEFAULT_SCENE_DETECTION_THRESHOLD = 0.5
```
处理链（`:77`）：`ffmpeg → frames(uint8) → model.predict_raw → predictions_to_scenes_with_data`；`device` 可配 `cpu`（`config.py:139`），意味着**桌面端 CPU 也能跑**，不强制 GPU —— 这一点很关键。

**⭐ 核心实现 4：AI 转场的「强制介质掩护」**（`prompts/tasks/generate_ai_transition/zh/system.md`）

首尾帧生视频的四条硬规则，第 3 条是真正的一线经验：

> **绝对禁止**让两个物理形态差异巨大的实体直接发生形变！必须在形变发生时引入符合全局基调的**过渡介质**掩盖计算过程。
> 示例：`blinded by a massive warm lens flare`、`camera passes through a thick motion blur`、`explodes into glowing particles`

另三条：① 强指令前缀 `"Smooth continuous single shot, seamlessly morphing from the start frame to the end frame..."`；② 锁定运镜轨迹 + 稳定词；③ 兜底后缀 `"High quality, cinematic masterpiece, absolutely no hard cuts, no sudden jumps, flawless transition."`

**⚙️ 核心实现 5：Skill 沉淀 + 路径穿越防护**（`skills/skills_io.py:22-83`）

```python
target_path = base_path / skill_dir / f"cutskill_{clean_name}"
final_path = target_file_path.resolve()
if base_path not in final_path.parents:            # ← 路径穿越防护
    return {"status": "error", "message": f"Security Alert: Writing to paths outside..."}
```

「沉淀」的含义：agent 干完一次剪辑 → 把逻辑写成 `SKILL.md` → 下次 `SkillManager.adiscover()` 自动发现并转成 LangChain tools。**这是「一次工作产出可复用能力」的机制**。

**⚙️ 核心实现 6：ASR 口播粗剪规则**（`prompts/tasks/speech_rough_cut/zh/system.md`）

- **中间删除即拆分**：若删除了句子中间的内容，**必须**拆成多个独立片段（因为音频不能拼接）；仅首尾删除则只调 start/end
- **时间戳逐字对齐**：`Start` = 片段第一个字的 `timestamp[0]`，`End` = 最后一个字的 `timestamp[1]`；约束在原 `[start,end]` 内、片段间不重叠、禁止跨句
- **重复语句删前不删后**，但「**根据上下文观察当前是否是最后一次重复，如果是则保留当前句子**」—— 这条细节很讲究
- **`reason` 字段优先输出**，强制模型解释改了什么、为什么

**可复用点评估**：

| 项目 | 等级 | 落点 | 工作量 | 预期收益 |
|---|---|---|---|---|
| **任务化中英成对 prompt 库** | ⭐⭐⭐ | `electron/film-kit/prompts/tasks/<task>/{zh,en}/` + 加载器 | 小 | 天然满足 CI Gate 7；加任务不改代码；结构比单文件 `prompt-doctrine.json` 更适合「按任务」扩展（两者互补：doctrine 存方法论，tasks 存具体任务 prompt） |
| **AI 转场介质掩护规则** | ⭐⭐⭐ | `story2video-engine` 的 `endFramePrompt` 规则集 | 小 | 直接降低「首尾帧形变崩坏」的废片率 |
| **Skill 沉淀机制** | ⭐⭐ | `packages/ai-writer/src/skills/`（**实测该目录不存在，需新建**） | 中 | 把一次性产出固化为可复用能力；需配路径穿越防护 |
| **ASR 口播粗剪规则** ✅ | ⭐⭐ | `python-backend/.../analysis/` 新增规则层（**对接既有 `transcriber.py`**） | 中 | 中间删除拆分 + 逐字时间戳是可落地的算法约束 |
| ~~**TransNetV2 镜头边界检测**~~ | ⚠️ **降级** | — | — | 🔴 **实测发现 mulpub 已有等价能力**，见下方修正 |
| 19 节点编排思路 | ⭐ | 参考 | — | mulpub 的 `PipelineEngine` 已是阶段式，节点图收益有限 |

> 🔴 **TransNetV2 项的重大修正（自查，实测取证）**>
> 初稿把「TransNetV2 镜头边界检测」列为 ⭐⭐⭐「补 mulpub 原片自动切分缺口」。**实测后发现该判断是错的** —— mulpub 已经有完整实现：
>
> - `packages/python-backend/src/multi_publish/video_creation/analysis/scene_detect.py`（**282 行**）
> - `class SceneDetect(BaseTool)`，`tier = ToolTier.CORE`、`capability = "analysis"`
> - **封装 PySceneDetect**（三种方法：`content` / `threshold` / `adaptive`），`dependencies = ["cmd:ffmpeg"]`
> - **带 ffmpeg 回退**：`_has_pyscenedetect()` 检测不到 PySceneDetect 时自动降级到 ffmpeg 检测
> - `scenedetect` 与 `torch` 在 `requirements-runtime.txt` / `pyproject.toml` 中**均不存在** → 都是可选依赖
>
> **正确结论**：TransNetV2 **不是补缺口，而是一个「可选精度增强」**。取舍如下：
>
> | | 现有 PySceneDetect | TransNetV2 |
> |---|---|---|
> | 原理 | 内容/阈值/自适应算法 | 深度网络（transnetv2-pytorch） |
> | 依赖 | `scenedetect[opencv]`（可选） | `torch` + `transnetv2-pytorch`（**重**） |
> | 精度 | 良好 | 特定内容（如渐变转场、快速剪辑）更稳 |
> | 桌面端代价 | 低（纯 CPU 可行） | **需引入 torch，包体积 +1~2 GB** |
>
> ✅ **建议**：**不进批次一**。降级为「若现有 PySceneDetect 在真实素材上漏检率高，再评估引入」的备选项 —— 因为它要付出的代价（torch 依赖）与 mulpub 桌面端的分发体积极不相称。**这一条是本轮唯一被实测推翻的复用判断，保留原始记录以示取证诚实。**

> ✅ **反向确认：ASR 口播粗剪是真实缺口（实测）**
>
> 为免重复上一条的错误，对「ASR 粗剪」也做了实测：
> - ✅ **ASR 基建已有**：`packages/python-backend/src/multi_publish/video_creation/analysis/transcriber.py`（**247 行**，封装 faster-whisper / WhisperX），output_schema 明确含 **`word_timestamps`** —— 词级时间戳正是 FireRed 那套规则的前提
> - ❌ **粗剪/口水词逻辑没有**：全仓搜 `口水词|filler|rough.?cut|口头禅|语气词` 无命中（`podcast-tts-colloquialize.js` 是反向的「把文本口语化」，不是清洗）
>
> **结论**：这是一处**真实缺口，且能与既有基础设施无缝对接**（直接消费 `transcriber.py` 的 `word_timestamps`），无需引入新依赖。**建议进批次三**，落 `python-backend/.../analysis/` 新增规则层。

**踩坑与缺点**：
- `agent_fastapi.py` **3728 行**巨型文件，与 moyin/novelvids 同病
- 依赖 `skillkit`、`transnetv2-pytorch` 等非主流包，Python 生态适配成本需实测
- `SplitShots` 返回的 `clip_captions` 复用 `Clip` 模型，**镜头切分结果与字幕单元耦合**，抽取时需解耦
- 重量级依赖（MCP + LangChain）与 mulpub 现有技术栈不重合，只能取**单个模块**而非整体架构

#### 3.17.1 第二层深挖（v3）：合成与时间线算法的「怎么做到」

> 第一层回答了「有什么节点」，这一层读三个最大节点的**实现细节** —— `render_video.py`（1023 行）、`plan_timeline.py`（907 行）、`generate_ai_transition.py`（571 行）。**这层的结论改变了第一层的一个判断**：FireRed 与其他项目在合成上的差异不是「另一个 ffmpeg 包装」，而是**完全不同的合成栈**。

**深挖 1：成片合成不用 ffmpeg filter_complex，而是 MoviePy + Pillow**

| 项目 | 成片合成技术 |
|---|---|
| mulpub | `concat demuxer -c copy`（直拷，无转场） |
| showvi / yumcut / huobao | ffmpeg `filter_complex`（xfade/amix） |
| mulpub `remotion-composer` | Remotion（React 渲染） |
| **FireRed** | **MoviePy（`CompositeVideoClip`）+ Pillow 画字幕** |

FireRed 用 `moviepy` 的 Python 对象模型组装时间线，字幕用 **`PillowSubtitleRenderer`**（`render_video.py:422-567`）逐字测量宽度换行 —— `draw.textlength(candidate, font=font) <= max_width_px` 逐字符累积、超宽即断行（`:557-565`）。**这是 CJK 逐字换行，不是空格分词**，对中文字幕是正确的做法。

**深挖 2：`SUBCLIP_END_SAFETY_MARGIN_S` —— MoviePy 的隐性失败模式**

`render_video.py:24`：`SUBCLIP_END_SAFETY_MARGIN_S = 1e-3`。所有 `subclipped(0, end)` 的 end 都要**减去 1ms**（`:596`、`:613`、`:650`、`:662` 四处统一使用）。这是 MoviePy 的一个坑：**取到素材的最后一帧可能触发解码器截断错误或时长超界**。1ms 的安全边距人眼不可见，但能避免随机崩溃。**只有真在 MoviePy 上踩过随机崩溃的人才会加这个常量** —— 它不在任何文档里。

**深挖 3：AudioTrackComposer 的三轨模型与「双窗口」**

`render_video.py:574-667`，三个音轨层合成：
1. **video 原声层**：`with_volume_scaled(VIDEO_VOLUME_SCALE)`
2. **voiceover 层**：`source_window`（素材内取哪段）→ `timeline_window`（放到时间线哪里）。**关键处理：`expected = min(expected, max_available)`（`:623`）—— 时间线窗口想要的时长若超过素材实有，clamp 而非报错**，宁可配音短一点也不让整条渲染崩掉
3. **BGM 层**：先 concat 所有 BGM 段，然后**三态** —— 短于成片则 `_loop_audio` 循环补齐、超长则裁剪、容差内不动（`:659-662`）。与 Pixelle 的视频三态（pad/trim/容差）完全同构，**再次印证「三态 + 容差」是音视频对齐的行业共识**

**深挖 4：`_allocate_clip_durations_using_beats` —— 「卡点」的完整算法**（`plan_timeline.py:654-728`）

这是整个 FireRed 里**算法密度最高**的一段，注释写明四步：

```
1) 按各素材源时长加权分配（总和 = 组目标时长）
2) 每个 clip 的结束点吸附到最近的节拍边界；差值结转（carry over）给下一个 clip
3) 最后一个 clip 向上取整，保证总时长 ≥ 组目标
4) 整数截断漂移用「小数部分排序补偿」修平（fractional_parts 按余数降序，前 remainder 个各 +1ms）
```

配套防御：`SNAP_SAFETY_MAX_STEPS = 10_000`（`:24`）—— 吸附循环超过一万步即抛 `RuntimeError("snap_to_nearest_beat safety exceeded")`（`:720-721`），防止节拍表异常时死循环。**这是「数据异常时 fail-fast 而不是挂死」的标准写法。**

**深挖 5：`_compute_title_music_offset` —— 让片头字幕结束在节拍上**（`plan_timeline.py:488-521`）

反向问题：不是「镜头卡节拍」，而是「**BGM 该从音乐的哪一毫秒开始播，才能让片头字幕的结束点恰好落在节拍上**」。算法：按节拍时长累计走查，找到第一个 ≥ title_duration 的节拍点，反推 `music_offset_ms = cumulative - title_duration`。注释还特意说明「原版代码假设节拍表非空，否则 modulo 崩溃，这里加了守卫」—— 又一个「开源化时补防御」的痕迹。

**深挖 6：AI 转场的实现侧 —— 首尾帧预处理与可取消轮询**

`generate_ai_transition.py:455-537` `_preprocess_first_last_frame`：
- 色彩归一：非 RGB 一律 `convert("RGB")`（API 不收 alpha 通道）
- 尺寸对齐：**先按 `max(dst_w/src_w, dst_h/src_h)` 放大再中心裁剪**（LANCZOS），而不是直接拉伸 —— 保住宽高比
- **逐像素断言**：`assert aligned_first_frame.size == aligned_last_frame.size == target_size`（`:535`）—— 首尾帧尺寸不一致直接 fail-fast，不带病提交
- **每步 transformation 记入 meta**（`resize_with_center_crop` / `none`），渲染产物可审计「哪帧被动过什么」

`utils/ai_transition_client.py:63-70` `_sleep_with_cancel`：轮询间隔 15s，但 **sleep 切成 0.2s 小片、每片检查取消标志** —— 用户点取消最迟 0.2s 生效，而不是等完整个轮询周期。错误响应统一 `_format_response_error`（截断 2000 字符防止日志爆炸）。

**对 mulpub 的增量结论（相对第一层）**：

| 第一层结论 | 第二层修正 |
|---|---|
| 「19 节点编排思路 ⭐，节点图收益有限」 | **维持，但补充**：`plan_timeline` 的节拍分配算法是独立可搬的**纯函数算法**（约 130 行，含测试友好的纯计算），不需要接受整个节点图 |
| 「render_video 是普通渲染」 | **修正**：MoviePy 栈与 mulpub 现有 ffmpeg 直拷是**两个物种**。若 mulpub 要上「字幕烧录 + 多音轨混音」，MoviePy 路线提供了一整套**已被踩过坑的参考实现**（安全边距/双窗口 clamp/BGM 三态）；若坚持 ffmpeg filter_complex，则 `SUBCLIP_END_SAFETY_MARGIN_S` 这类 MoviePy 坑不适用，但 `expected = min(expected, max_available)` 的 clamp 语义仍值得抄 |
| 「Skill 沉淀 ⭐⭐」 | 维持。且补充：`_sleep_with_cancel` 的**协作式取消切片**模式适用于 mulpub 所有长任务轮询（包括 video-gen 的 10s×10min 轮询） |

> 💡 **一句话**：第一层看到的是「小红书做了个 agentic 剪辑」，第二层看到的是**「一个把 MoviePy 踩坑经验沉淀成常量的团队」**——后者的信息量远大于前者。

#### 3.17.2 第三层深挖（v4）：ASR 口播粗剪的编排层 —— 与 mulpub 现有基建的逐点对接

> 第二层只读了那篇 prompt（规则层），这一层读 `speech_rough_cut.py`（259 行，编排层）—— **「LLM 说了什么」与「剪辑实际怎么切」是两个环节**，中间还有三道工程处理。这是把 ASR 粗剪从「规则集」落到「可实施」的关键一层。

**深挖 1：LLM 只做「句子级裁决」，不做「切点计算」**（`:73-103`）

```
for i, sentence in enumerate(asr_sentence_info):        ← 逐句循环
    user_prompt = get_prompt("speech_rough_cut.user",
        curr_asr_sentence_info=..., pre_ctx=前一句, nxt_ctx=后一句,
        asr_text=全文, history_rough_cut_jsons=历史裁决)
    raw = await llm.complete(..., temperature=0.1, top_p=0.9)
    rough_cut_json += parse_json_dict(raw).get('res', [])
```

三个设计点：
1. **逐句调用而非整篇给 LLM** —— 每次只裁决一个句子，带前后各一句作上下文。这是为规避「长上下文下 LLM 对中间句子的注意力衰减」；代价是句子数 = 调用次数（一段 10 分钟口播约 150+ 次调用）
2. **`temperature=0.1` + 历史裁决回喂**（`history_rough_cut_jsons`）—— 保证同类句子裁决一致（前面删了「然后」，后面同样的「然后」也应删）
3. **LLM 失败 fail-soft**（`:100-102`）：`except` 只 `add_warning`，该句**回退为原 ASR 结果保留** —— 一句裁决失败不会废掉整条粗剪

**深挖 2：切口不信任 LLM —— 按句间静默重新分组**（`:159-199`）

LLM 返回的是「句子级保留/删除/拆分」裁决，但**真正下刀的位置由代码重算**：

```python
def group_sentences(self, items, gap_threshold=400):      # ← 默认 400ms
    # 相邻两句间隔 > gap_threshold 即切段 —— 切口落在【自然停顿】上
def ranges_to_cut_points(self, ranges, buffer_ms=100):
    # 每个切口前后各加 100ms 缓冲；缓冲重叠时取中点（防负片段）
```

**这是整条链最聪明的一步**：LLM 说「这里删」只决定**删哪些**，而**从哪毫秒切**由「句间静默 > 400ms」这个声学事实决定 —— 切口必然落在没人说话的间隙，不会腰斩半句话。`buffer_ms=100` 再给切口留呼吸位；两段缓冲若重叠（极短句），取中点一刀切（`:192-195` 防止产生负长度片段）。

**深挖 3：切完重校 ASR 时间戳 —— 前缀和 remap**（`:202-246`）

删除片段后，字幕/ASR 的时间轴全变了。`calibrate_asr_times` 用**前缀和**一次线性重映射：

```python
# remap_time(t) 三种情形：
#   删除区间之前 → t - deleted_before（减累计删除量）
#   删除区间之内 → 收敛到区间左端（start - deleted_before）
#   删除区间之后 → t - 全部删除量
```

这让**粗剪后的视频与字幕保持同步** —— 没有这步，删完视频字幕全错位。

**深挖 4：代码里的真实痕迹（开源仓库的诚实）**
- `:98` 有一行调试残留 `print(parsed_json)` —— 生产路径上裸 print
- `:241` `if new_start is None or new_end is None: continue` 是**死代码**——`remap_time` 的三条路径都必然返回数值。防御性检查写了个永远不会触发的分支

**与 mulpub 的对接结论（把 ASR 粗剪升级为可直接实施）**：

| FireRed 环节 | mulpub 现状 | 对接方式 |
|---|---|---|
| ASR 句子级时间戳 | ✅ `transcriber.py` 已有 `word_timestamps`（faster-whisper/WhisperX） | 直接复用，需聚合为句级 |
| LLM 逐句裁决 | FireRed 走 `node_state.llm` | mulpub 走 `ai-writer` 的 LLM 通道 |
| 句间静默分组 | 无 | **纯算法 ~40 行，可直接搬（Apache-2.0）**，落 `python-backend/.../analysis/` |
| ffmpeg 切段 | `scene_detect.py` 同包已有 ffmpeg 依赖 | 复用 `ffmpeg_utils` 模式 |
| 时间戳重校 | 无 | **前缀和 remap ~30 行，直接搬** |

> 💡 **一句话**：这层的价值是把「ASR 口播粗剪」的工作量从「模糊的中」收敛为**「三段纯函数（约 70 行）+ 一条逐句 LLM 编排 + prompt 已有」**——且「切口落在静默处、失败回退、字幕重校」这三个设计，比「让 LLM 直接给切点」可靠一个量级。

---

### 3.18 🔴 smy-seedance-storyboard（**无许可证**）—— 纯 Skill 资产包，只能学结构不能抄文本

> **v2 新增**。这是 19 个项目里**唯一没有许可证**的，因此复用等级被许可证硬性锁死在「只可参考抽象做法」。

**定位**：一个 **Claude Skill 资产包**（不是软件），把「上美影风格（上海美术电影制片厂复古手绘动画）」短剧生成的全套方法论做成可调用的 Skill。**20 个文件、0.2 MB、零代码**。

**结构**（全部是 Markdown/文本）：
```
SKILL.md                              27.9 KB  Skill 定义与工作流（含 YAML frontmatter）
README.md                             12.6 KB
references/
  上美影风格指南.md                    26.3 KB  ← 自称「单一事实来源」
  seedance-manual.md                  30.0 KB  Seedance 2.0 手册（含「模板十七：上美影国风动画类」）
  上美影原始提示词.txt                 11.5 KB  实测素材（山海经 5 条 + 水浒 3 条成品示例）
  故事转视频脚本-转换工具.md           12.7 KB
  分镜优化与声音设计.md                 8.8 KB
  好剧本.md                            6.9 KB
  优化分镜.md                          1.9 KB
鲁智深醉闹五台山项目/                  7 个文件（剧本 + 素材清单 + E01–E05 分镜 + 使用指南）
罗刹市奇幻故事项目/                    3 个文件（剧本 + 资产提示词 + 分镜提示词）
```

**它的核心做法**（以下均为「抽象做法」，可自行重写；**具体文本不可复制**）：

1. **单一事实来源（Single Source of Truth）**：所有风格定义集中在 `references/上美影风格指南.md`，其他文件只引用不重复 —— 避免多处风格描述漂移
2. **剧组色盘（Palette Declaration）**：一部剧开拍前先声明一组颜色（如朱砂红/鎏金/墨黑/青瓷绿），全剧复用防跑色
3. **尾帧说明跨集衔接**：「每集最后一帧的画面描述，下一集接着用，集与集无缝衔接」—— 这正是 mulpub F8 `endFramePrompt` 想做的事
4. **咆哮体硬约束后缀**：所有生图提示词末尾附 `CRITICAL: 2D FLAT COLORS ONLY. ABSOLUTELY NO SHADING, NO GRADIENTS, NO 3D VOLUME.` —— 用大写+绝对化词压住模型默认倾向
5. **两级风格配方分离**：图片端禁阴影渐变（纯 2D），视频端保留手绘肌理但禁 3D 渲染/写实感/体积光 —— **同一风格在「静帧」与「运动」两端约束不同**
6. **文-资-视-剪四阶段**：把常见「文图视音剪」五段压缩为四段（音并入视）
7. **Seedance 2.0 延长法**：第二集起把上一集视频上传并选「延长」，而非重新生成 —— 平台特有的跨集连续性手段

**许可证结论**（核查明细见 §2.3）：无 `LICENSE` 文件、README/SKILL 无版权声明 → **默认 All Rights Reserved**。

**可复用点评估**：

| 项目 | 等级 | 说明 |
|---|---|---|
| SKILL.md + references/ 双层结构 | ⭐⭐ | 结构可参考（这是通用范式，非其独创） |
| 剧组色盘单一声明 | ⭐⭐ | 概念可借，需自行实现为 film-kit 资产 |
| 尾帧说明跨集衔接 | ⭐⭐ | 与 mulpub F8 同源，可交叉验证 |
| 咆哮体硬约束后缀 | ⭐ | 属通用 prompt 技巧，无需参考 |
| **其任何文本 / 示例工程** | ❌ **禁止复制** | 无许可证，连非商用都不构成授权 |

> 💡 **这是本轮最有价值的一条方法论教训**：`smy` 的 README **没有 license 徽章**，很容易被误以为「没写就是开源」。正确做法是**第一步检查 LICENSE 文件是否存在**，而不是看 README。这与前 16 个项目形成对照 —— 它们全都有明确的 LICENSE 文件。

#### 3.18.1 第二层深挖（v3）：读了「单一事实来源」的实体内容

> 第一层只看了文件结构，这一层把两份核心文档读透 —— `上美影风格指南.md`（379 行，11 个章节）与 `seedance-manual.md`（726 行，16 个模板）。**法律边界不变：以下全部是「抽象做法」层面的理解， mulpub 落地必须用自写表达。** 但这两份文档的组织方式本身就是「风格类 Skill 该怎么写」的最佳标本。

**深挖 1：全仓含金量最高的资产是「失败模式表」**（风格指南 §十，`上美影风格指南.md:353-371`）

一张 **11 条「症状 → 原因 → 修复」** 的实测翻车清单：

| 症状（摘） | 原因 | 修复方向 |
|---|---|---|
| 视频平涂对了但没手绘味（像干净 CG） | v2 视频行**删光了质感词族**（水粉肌理/笔触/手工感） | 恢复质感词，否定词只留「反 3D 三连」 |
| 子风格视频无敦煌感 | 视频首行「斑驳壁画肌理」+「无渐变」**自相矛盾** | 按子风格替换媒介质感词，删「纯 2D 平涂」 |
| 画面出现阴影/渐变/3D 体积 | 柔边晕染类短语或模型默认渲染倾向 | 末尾硬约束 + 清除 soft glow/晕染 + 负面词 |
| 跨集人物漂移 | 风格行/色盘不一致 | **逐字校验 + 四视图资产 + 尾帧接力**三重机制 |
| 视频端风格丢失 | 提示词过长 | 首行只用精简版，动作精简，总长控制 |
| 异兽画成普通野兽 | 缺神性标记 | 补鎏金部位/发光器官/独有纹样 |

更关键的是表头那段**迭代史**：2026-08-25 当天三轮实测 —— 第一轮达标 → 第三轮扩大测试（鲁智深 5 段 + 罗刹 1 段敦煌）**发现视频端失效**，定位根因是「v2 精简版删光质感词族 + 敦煌子风格自相矛盾」，出 v3 后定版。

**为什么这张表是全仓最值钱的**：它记录的不是「成功的 prompt」，而是**「prompt 为什么会失效」**。mulpub 的 `prompt-doctrine.json` 有 10 条 rules，但**没有一张「症状→原因→修复」的失败模式对照表**。做 F1 增补时，最有价值的不是再抄几条成功规则，而是**建立 mulpub 自己的翻车台账** —— 每次生成失败记录「症状/根因/修法」，让规范随失败而进化。

**深挖 2：风格约束的「分层配方」结构**（§二）

同一套风格被拆成 **6 层**，各有明确用途：

```
§2.1 完整版·平涂强化（中文）     → 生图主用
§2.2 英文对照版                 → Midjourney 等英文模型
§2.3 精简版                     → Seedance 视频提示词首行专用（防「提示词过长丢风格」）
§2.4 硬约束层（咆哮体）         → 所有生图提示词必附
§2.5 负面提示词库               → 与正面块配套
§2.6 MJ 实测原版（归档）        → 只留证不使用
```

配套**使用规则**明确「哪一层用在哪个端」。这个「**同一语义、多端配方、分层维护**」的结构，直接回答了 mulpub 一个悬而未决的问题：`prompt-doctrine.json` 里 zh/en 双字段之外，**还应该有「长版/首行版」之分** —— 因为 FireRed 的失败模式表恰好证明了「视频首行用长版会丢风格」。

**深挖 3：色盘防漂移是一个闭环而非一句声明**（§3.3–3.5）

```
开工：素材清单头部声明色盘（中文 + 英文逐字对照）
  ↓
使用：所有资产提示词 + 每集分镜首行【逐字引用同一字符串】
  ↓
扩展：最多加 2 个扩展色；「怪色点缀」优先占额、只用于小面积
     （滚边/器物/印章/一朵花/一只蝴蝶）
  ↓
修漂移：跨集人物漂移 → 逐字校验 + 四视图资产 + 尾帧接力三重机制
```

配套一张 **情绪—色彩映射表**（仙气宁静=青瓷绿/月白，冲突爆发=朱砂红/墨黑，神性宝物=鎏金/藤黄……）—— 写分镜氛围时按情绪选加重色，**色彩从「装饰选择」变成「叙事工具」**。

**对 mulpub 的增量结论**：
1. F1 增补 `prompt-doctrine.json` 时，**新增两类结构**：①「失败模式台账」（symptom/cause/fix 三列）②「分端配方」（full/firstline 双版本字段）。这两类在现有 7 blocks/10 rules/6 glossary 里都没有。
2. 「剧组色盘」应做成 **film-kit 资产**（`palette.json`：每部剧声明 4 主色 + ≤2 扩展色，中英对照），生成资产提示词与分镜首行时**机械注入同一字符串** —— 防漂移靠机制不靠自觉。
3. **再次强调许可证边界**：以上全部是「做法」层面；`smy` 的具体文字、模板原文、示例工程仍然不可复制。

---

### 3.19 ⭐ ToonCrafter（Apache-2.0）—— 唯一「生成模型」形态，桌面端不可直接接入

> **v2 新增**。它不属于「流水线工具」，而是一个**扩散模型**，因此复用路径与其余 18 个根本不同。

**定位**：SIGGRAPH Asia 2024 Journal Track 论文实现（CUHK + 腾讯 AI Lab）。**卡通首尾帧插值** —— 给两张卡通图（起始帧 + 结束帧），用预训练 image-to-video 扩散先验生成中间帧。

**技术栈**：PyTorch 2.0 + `pytorch_lightning 1.9.3` + `xformers` + `open_clip_torch` + `diffusers`。81 文件 / 11.9 MB。

**结构**：
```
lvdm/          扩散模型实现（models/samplers/autoencoder_dualref/ddpm3d/modules/attention_svd...）
main/          推理入口
configs/       三档分辨率配置（320×512 / 576×1024 / 256）
scripts/       运行脚本
gradio_app.py  Web Demo
```

**推理约束**（实测 `gradio_app.py:8-43`、`configs/*.yaml`）：
| 项 | 值 |
|---|---|
| 分辨率 | **512×320**（默认）/ 1024×576 / 256×256 |
| 采样步数 | **50** |
| CFG scale | 7.5 |
| eta | 1.0 |
| fps | **10** |
| 输入 | 起始帧 + 结束帧 + 文本 prompt + seed |
| 硬件 | **需 GPU**（torch 2.0 + xformers） |

**与 mulpub 的适配性判断**：
- mulpub 的影视工程目标画幅是 **1280×720**、帧率 **24fps**（`FILM_FRAME_RATE=24`），而 ToonCrafter 输出 **512×320 @ 10fps** —— **分辨率差 4 倍、帧率差 2.4 倍**，直接用于正片不可行
- 它需要 GPU，而 mulpub 是 Electron 桌面端，用户机器规格不可控
- 它解决的是「两张图之间补帧」，而 mulpub 的当前链路是「每镜独立生成视频再 concat」，**没有插值需求**

**唯一有价值的场景**（低优先）：若将来做「离线 GPU sidecar」（用户自备显卡），可用于**低成本补间镜头**（如两镜之间插一个过渡镜头），作为 `GenerateAITransition` 的替代/补充。

**可复用点评估**：

| 项目 | 等级 | 说明 |
|---|---|---|
| 首尾帧插值能力 | ⭐ | 仅概念参考；实际接入需 GPU sidecar + 超分 + 补帧，工程量远超收益 |
| 双参考 autoencoder 设计 | ⭐ | `autoencoder_dualref.py` 的双参考条件注入思路可参考（学术层面） |
| 代码 | ⭐ | Apache-2.0 允许复制，但**没有可插入的位置** |

> ⚠️ **它自己 README 顶部有防伪声明**：「We have not set up any official profit-making projects or web applications. Please be cautious!!!」—— 说明存在冒名站点。若日后调研其在线 Demo，需确认域名。

#### 3.19.1 第二层深挖（v3）：首尾帧约束在模型层是怎么实现的

> 第一层只确认了「需要 GPU、512×320」。这一层把**「两张图怎么同时约束一段视频的生成」**这个问题读透 —— 这是理解所有「首尾帧生视频」产品（可灵/即梦/FireRed 的 AI 转场）底层原理的一把钥匙。Apache-2.0，机制描述可自由引用。

**深挖 1：推理侧的三路条件拼接**（`scripts/gradio/i2v_test_application.py:38-100`）

`get_image()` 的完整条件构造，一步不漏：

```
① 文本条件    text_emb = get_learned_conditioning([prompt])
② 图像条件    img_emb  = embedder(首帧图) → image_proj_model → 投影
              imtext_cond = cat([text_emb, img_emb])     ← 文本与首帧图语义拼接
③ 结构条件    c_concat：
   a. 首帧编码 → videos  repeat 到 frames//2 份（占前半）
      尾帧编码 → videos2 repeat 到 frames//2 份（占后半）
      torch.cat([videos, videos2], dim=2)            → 全长隐变量序列
   b. img_tensor_repeat = zeros_like(z)
      img_tensor_repeat[:,:,:1,:,:]  = z[:,:,:1,:,:]   ← 只把【第 1 帧】填成首帧 latent
      img_tensor_repeat[:,:,-1:,:,:] = z[:,:,-1:,:,:]  ← 只把【最后 1 帧】填成尾帧 latent
   c. 其余中间帧全零 → 交给扩散去「补」
cond = {"c_crossattn": [imtext_cond], "fs": fs, "c_concat": [img_tensor_repeat]}
```

**核心设计**：`c_concat` 是一个与输出同形状的 latents 张量，**只有头尾两帧有值、中间全零**。扩散模型以「concat 条件」方式接收它 —— 每一步去噪都被迫「贴近首帧开始、贴着尾帧结束」。中间不是插值出来的，而是**在被两端钉死的约束下新生成的**。这就是「插值」的本质：**不是数学插值，是受约束的生成**。

另一个细节（`:70,79`）：首尾帧各自 `repeat` 到 `frames//2` 后拼成全长序列再编码 —— 即 **VAE 编码时首尾帧各自「假装」占了半段视频**，这样 encoder 提取的隐状态带有时间上下文，而不是单帧孤立编码。

**深挖 2：`get_latent_z_with_hidden_states` —— 隐状态也要首尾的**（`:127-141`）

```python
encoder_posterior, hidden_states = model.first_stage_model.encode(x, return_hidden_states=True)
### use only the first and last hidden states
hidden_states_first_last.append(hid_new)
```
encoder 的多层 hidden states **只取第一层和最后一层**，传给 `batch_ddim_sampling(..., hs=hs)` —— 与 decoder 的 `attn_refinement` 配套：采样时中间帧对「首尾帧的深层特征」做 cross-attention。

**深挖 3：模型层的 Fusion 注意力 + zero-init**（`lvdm/models/autoencoder_dualref.py:256-292`）

- `ref_context: b c 2 h w`（注释明确 **2 = starting and ending frame**，`:490`）
- decoder 每一级都有 `attn_refinement`（`:467`），中间特征作为 query，**首帧与尾帧的 k/v 拼接**作为 context：
  ```python
  k = torch.cat([k[:, [0] * (bt//b)], k[:, [1]*(bt//b)]], dim=2)   # :287
  v = torch.cat([v[:, [0] * (bt//b)], v[:, [1]*(bt//b)]], dim=2)   # :291
  ```
  即生成的**每一帧**都同时「看见」起点与终点 —— 空间上越靠近哪端，注意力自然越偏向哪端
- **`nn.init.zeros_(self.to_out[0].weight/bias)`（`:261-262`）：Fusion 层输出零初始化** —— ControlNet 式的经典技巧：训练初期该分支不扰动预训练权重，从零学起。这说明「首尾帧约束」是**外挂微调**，不动 backbone

**深挖 4：两个工程细节**
- 步数硬顶：`if steps > 60: steps = 60`（`:48-49`）—— 防 GUI 侧把步数拉满烧卡
- 尾帧处理：`if image2 is None: batch_samples[...,:-1,...]`（`:102-104`）—— 单图模式（图生视频）时**生成的最后一帧就是输入帧本身，要裁掉**，否则成片首尾会有两帧重复。这个「末帧重复」问题在 concat 型流水线里同样会出现，值得记住

**对 mulpub 的增量结论（相对第一层）**：

| 第一层结论 | 第二层修正 |
|---|---|
| 「仅概念参考，没有可插入的位置」 | **维持不接入的判定，但知识价值上调** —— 它解释了「首尾帧生视频」类 API（可灵/即梦/FireRed 转场所用）的能力边界：**中间内容是「受两端约束的新生成」，不是保真插值**。因此：① 中间运动符合两端语义但细节可能「脑补」→ 对卡通/风格化内容安全，对需要精确动作衔接的实拍感内容要抽查；② **首尾帧的尺寸/色彩一致性必须在喂给 API 前自己做对齐**（参照 FireRed `_preprocess_first_last_frame` 的中心裁剪 + 逐像素断言）；③ 输出帧率（如 10fps）与成片帧率（24fps）不一致时需要光流补帧或接受抽帧感 |
| F31（介质掩护）的底层依据 | **补上了**：既然中间是「受约束的新生成」，两端语义差异越大、模型自由度越大、翻车概率越高 —— 这正是 FireRed 那条「禁止形态差异巨大的实体直接形变，必须加介质掩护」的**模型层解释**。两条证据（prompt 层经验 + 模型层机制）互相印证 |

> 💡 **一句话**：ToonCrafter 对 mulpub 的价值不在「用它的代码」，而在**「看懂了首尾帧生视频这个黑盒的内部」** —— 之后 mulpub 对接任何首尾帧 API 出了怪结果（中间画面脑补、尾帧重复、风格漂移），都能对着这三个机制（c_concat 钉两端 / Fusion 注意力 / 末帧裁剪）定位原因。

---

### 3.20 第三层综合（v4）：分镜数据模型四方对照 —— mulpub 的 Shot 在生态里处于什么位置

> 前三层都是「单个项目往深里看」，这一节反过来做**横向收束**：把四个代表性项目的「分镜/镜头数据模型」摆在同一张表上对照。对照基线是 mulpub 自己的 kit（**实测**：`shot-library.json` 153 条、`film-manifest.json` 162 个 Scene，见下）。

**mulpub 现状实测**（2026-10-19，`apps/desktop/electron/film-kit/`）：

```
Shot（shot-library.json，153 条）字段：
  shotId / sceneId / model / prompt / refTokens / width / height
  / thumbnailUrl / resultUrl
  ⚠️ 153 条 Shot 的 sceneId 全部互不相同（153 shot ↔ 153 scene，1:1）
  ⚠️ 无 imagePrompt / videoPrompt / endFramePrompt / locked / duration 字段
  ⚠️ 单条 prompt 实测最长 13,922 字符（含实体 token 引用）
  model 分布：seedance_2_0 ×143 / nano_banana_2 ×5 / 其他 ×5

Scene（film-manifest.json，162 条）字段：
  id / parentId / name / level / count
  ✅ 已有 parentId 树结构（kit-loader 做树校验+无环校验）
```

**四方对照**：

| 维度 | **mulpub**（现状） | **novelvids** | **FireRed** | **moyin** |
|---|---|---|---|---|
| 镜头标识 | `shotId`(UUID) + `sceneId`(UUID) | 镜头序号 + 19 字段 Schema | `clip_id`（`clip_0001` 定宽零填充）+ `media_id` | 分镜序号 + S 级组号 |
| 实体引用 | ✅ **`refTokens`（UUID 数组）**，prompt 内以 `<<<uuid>>> [img_soroh]` 内联锚定 | `@{实体名}` 文本协议 | 无实体系统（素材库按 `media_id` 引用） | 参考图优先级声明（最早=身份锚点） |
| prompt 结构 | **单字段**（`prompt`，最长 13.9k 字符，一段到底） | 19 字段结构化（画面/运镜/时长/音效…分离） | 不存 prompt（prompt 在 `prompts/tasks/` 按任务外置） | 三层提示词（外观/场景/动作）可合并 |
| 时长字段 | ❌ 无（由 `AUTO_SHOT_SECONDS=[5,8,10]` 全局档位决定） | ✅ 每镜头独立时长 | `timeline_window`（毫秒，双窗口） | 按组配置 |
| 场景层级 | ✅ `parentId` 树（162 Scene，有根有环校验） | 场景表 + 场景-分镜关联 | 无场景概念（flat clips） | 场景库 + 多视角联合图 |
| 连续性载体 | 无显式字段（靠 kit 预编排） | `@{实体}` 引用 + 剧集锚 | `source_ref`（素材源窗口） | **尾帧接力** + 联合图一次生成 |
| 生成结果回填 | ✅ `resultUrl` / `thumbnailUrl` 直接在 Shot 上 | 独立结果表 | `clips` 输出（节点间流转） | 作品库 |

**四条收束结论**：

1. **mulpub 的 `refTokens` 机制比想象中领先**。它不是简单文本协议，而是 **UUID 强引用 + prompt 内 `<<<uuid>>>` 内联锚定 + 参考图 token 映射** —— 与 novelvids 的 `@{实体}`（纯文本、易碎）和 moyin 的「最早参考图=锚点」（隐式、靠排序）相比，**这是四者中唯一机器可校验的实体绑定**。novelvids 的 19 字段 Schema 值得参考的部分，其实 mulpub 用「refTokens + prompt 内锚」已经解决了最难的实体一致性，**缺的只是字段拆分与时长，不是实体机制**。

2. **mulpub 最刺眼的缺口是「prompt 单字段 13.9k」**。一条 prompt 塞了角色锚定 + 场景 + 动作 + 约束全部内容（实测样本 13,922 字符），等于把 FireRed 失败模式表警告的「提示词过长丢约束」风险**常态化**了。F8（三分 prompt）的紧迫性应上调 —— 这不是「锦上添花的结构化」，而是**当前生成质量的一个现实风险点**。

3. **`sceneId` 全部 1:1 暴露了 Scene 层「有结构无使用」**。162 个 Scene 有 parentId 树，但 153 条 Shot 每条挂在独立 Scene 下——**树结构建好了，生成侧完全没用上**（既没有「同 Scene 多镜」也没有跨镜引用）。F7（视角变体）与 F13（场次并发）实施时，第一步不是加字段，而是**让既有 Scene 树被生成侧消费**。

4. **时长是四方中 mulpub 唯一完全缺失的维度**。novelvids 有每镜时长、FireRed 有毫秒双窗口、moyin 按组配置，mulpub 只有全局三档。F2（时长公式）+ F29（TTS 时长驱动）合并看，实际是「给 Shot 补一个 `durationMs` 字段并确定它的来源优先级（用户设定 > TTS 实测 > 公式估算 > 档位默认）」——**这是一个字段决策问题，不是三个独立功能**。

---

### 3.21 第三层综合（v4）：连续性机制全景 —— 19 个项目里「让第 N 镜记得第 N-1 镜」的七种武器

> 「角色/画面跨镜跨集一致」是 AI 视频生产的第一难题。把 19 个项目的解法收拢，实际只有**七种武器**，按「约束强度」排序：

| # | 武器 | 代表项目 | 作用层 | 强度 | mulpub 现状 |
|---|---|---|---|---|---|
| 1 | **实体强引用**（UUID/token 锚定 + prompt 内联） | **mulpub `refTokens`**、novelvids `@{实体}` | 数据层 | ★★★★★ | ✅ 已有（四方最强） |
| 2 | **参考图优先级声明**（最早=身份锚，后续仅环境） | moyin | prompt 层 | ★★★★ | ❌ 无，F15 可补 |
| 3 | **固定风格行逐字复用**（色盘+风格块每次原样粘贴） | smy（色盘闭环）、waoowaoo（风格块） | prompt 层 | ★★★★ | 部分（prompt-doctrine 有块但无逐字复用纪律） |
| 4 | **尾帧/首帧接力**（上一镜末帧 = 下一镜首帧输入） | smy（跨集）、FireRed（AI 转场取相邻帧）、可灵类 API | 输入层 | ★★★★ | ❌ 无，F24（依赖 F8 endFramePrompt） |
| 5 | **多视角/多镜一次生成**（同 Scene 6 视角一张图 / 3 镜一段视频） | moyin（Contact Sheet / S 级组） | 生成策略层 | ★★★☆ | ❌ 无，F16/F7 |
| 6 | **受约束的生成**（首尾帧钉死 + 中间新生成） | ToonCrafter（c_concat 模型层） | 模型层 | ★★★ | 间接（用 API 时生效） |
| 7 | **生成后校验回滚**（VLM 质检 + 就绪度闸门 + 重试） | showvi（VLM 闭环）、Jellyfish（readiness） | 验收层 | ★★★ | ❌ 无（F12 依赖 VLM 适配器不存在） |

**三条收束结论**：

1. **mulpub 在「约束强度」最高的第 1 档已经就位**（`refTokens`），却在第 2–5、7 档全部空缺 —— **连续性短板不在数据层，而在 prompt 纪律（3）、输入接力（4）、生成策略（5）与验收闭环（7）**。这意味着：补连续性不需要动 Shot schema 的实体部分（F8/F9 的 schema 改动是另一件事），而应优先落 **F15（锚点声明）、F31→F6b（尾帧约束）、F16（组级生成）**。

2. **七种武器不是互斥而是叠加**——smy 的「三重机制」（逐字校验 + 四视图资产 + 尾帧接力）实际是武器 3+1+4 的组合；moyin 的 S 级是 5+4 的组合。**单武器强度有限，2 档以上叠加才达到工业可用**。mulpub 现在只有 1 档，任何单项 F 的连续性收益都会被其余空档稀释——这解释了为什么「角色串脸」在 mulpub 侧难以根治。

3. **唯一在「验收层」有武器的两个项目（showvi/Jellyfish）都把校验做成了独立阶段而非生成内联** —— 这与 mulpub F12 的教训一致（VLM 质检必须过成本闸、QC 插在下载后写 manifest 前）。**验收层武器的正确形态是「独立 QC 阶段 + 分级闸门」**，不是生成过程的一部分。

> 💡 **一句话**：连续性不是「一个功能」而是「七个档位的组合覆盖」。mulpub 手里握着最强的一张牌（refTokens）却只打了一档——**先补 prompt 纪律与尾帧接力（低成本两档），再谈生成策略与 QC（高成本两档）**，是连续性路线图里投入产出最陡的一段。


---

### 3.22 第四层收束（v5）：从七档覆盖图到实施排期 —— 三层研究的最终合并

> 前三层分别产出了「复用清单（第一层）」「实现细节与失败模式（第二层）」「横向结构定位（第三层）」。这一层把它们**合并为一张可执行的排期视图**：每个 F 对应补哪一档连续性武器、依赖被三层发现重排成什么样、以及一份三层演变总账。

#### 3.22.1 F 清单 × 七档覆盖映射（连续性视角的排期依据）

把 §3.21 的七档与 §五 的 F 清单交叉，得到每个 F 的「连续性档位贡献」——**这是排期优先级的第一判据，高于工作量**：

| F | 内容 | 补哪一档 | 档位强度 | 依赖 | 排期判定 |
|---|---|---|---|---|---|
| — | （已有）`refTokens` | 1 实体强引用 | ★★★★★ | — | ✅ 已就位，无需动 |
| **F15** | 角色身份锚点 + 参考图优先级 | **2 参考图优先级** | ★★★★ | 无 | **批次一提级**（原批次四）——最低成本换最强档 |
| **F6b+F31** | 首/尾帧约束 prompt + 介质掩护 | **4 尾帧接力（prompt 半边）** | ★★★★ | 无 | **批次一提级**（与 F15 相邻） |
| **F3b-palette** | 剧组色盘声明资产 | **3 固定风格行复用** | ★★★★ | 无 | **新增**（来源 §3.18.1 深挖 3），落 film-kit |
| **F24** | 场次内末帧传递 | **4 尾帧接力（输入半边）** | ★★★★ | F8 | 维持批次五 |
| **F16** | 组级多镜头提示词 | **5 多镜一次生成** | ★★★☆ | F8 | 维持批次四 |
| **F7** | Scene 视角变体（消费既有 parentId 树） | 5（前提） | ★★☆ | 无 | 维持批次二，实施说明改为「先让 Scene 树被消费」 |
| **F12-0+F12** | VLM 适配器 + 质检闭环 | **7 生成后校验回滚** | ★★★ | F12-0 前置 | 维持（成本闸约束不变） |
| **F11c** | 就绪度闸门 | 7（轻量半边） | ★★★ | F3b | 维持批次三 |

**排期结论（连续性视角）**：批次一应**新增/提级三项** —— F15（批次四→一）、F6b+F31（排序提前）、**F3b-palette（新增）**。理由：这三项是「2/3/4 档」里成本最低的三块，且互相独立、可并行。补齐后 mulpub 的连续性覆盖从 **1/7 → 4/7**（1+2+3+4 档），「串脸」问题的主体即可收敛。

#### 3.22.2 三层发现催生的三个新 F / 修订

| 项 | 类型 | 内容 | 来源 | 落点 | 工作量 |
|---|---|---|---|---|---|
| **F3b-palette** | 新增 | `film-kit/palette.json`：每部剧声明 4 主色 + ≤2 扩展色（中英对照），生成资产与分镜首行时**机械注入同一字符串**（防漂移靠机制不靠自觉） | §3.18.1 深挖 3（smy 色盘闭环，仅做法） | `electron/film-kit/palette.json` + `KIT_FILES` 登记 | 小 |
| **F1 增补** | 修订 | `prompt-doctrine.json` 除 blocks/rules/glossary 外，**新增两类结构**：①「失败模式台账」（symptom/cause/fix）②「分端配方」（full/firstline 双版本字段） | §3.18.1 深挖 1/2 | 同 F1 | 计入 F1（中） |
| **F34** | 新增 | **Shot 增加 `durationMs` 字段 + 来源优先级链**（用户设定 > TTS 实测 > 公式估算 > 档位默认）；F2/F17/F29 的产出统一写到这一个字段 | §3.20 结论 4（时长是四方唯一缺失维度） | Shot schema + `auto-plan.js` | 小（字段+链路）；三条来源全接为大 |

> ⚠️ **F34 的关键澄清**：它不是把 F2（公式）、F17（双向归一）、F29（TTS 驱动）合并成一个功能——三个来源**依然独立实施**，但产出统一写到 Shot 的 `durationMs`，消费方（plan/render/剪映导出）只读这一个字段。三个功能可任意顺序分批上，互不阻塞。

#### 3.22.3 依赖重排（三层发现导致的顺序修正）

相对 §5.3 的原依赖图，四处顺序修正：

```
修正 1：F15 从批次四 → 批次一（连续性档位 2，成本最低）
修正 2：F6b+F31 提到批次一最前（连续性档位 4 的 prompt 半边，先于 F24）
修正 3：F8（三分 prompt）紧迫性上调 —— §3.20 实测单条 prompt 已达
        13,922 字符，「过长丢约束」已常态化；且 F24/F16/F31 都以
        endFramePrompt 存在为前提 ⇒ F8 是连续性路线的咽喉
修正 4：F24 → F25 顺序维持，但 F24 的前置从「F8 完成」细化为
        「F8 的 endFramePrompt 字段在 kit-loader 归一化后非空」
```

**修正后的连续性关键路径**：

```
F8（三分 prompt + kit-loader 归一化）
  ├→ F6b+F31（尾帧约束 prompt）      ← 批次一
  ├→ F15（参考图优先级）              ← 批次一
  ├→ F3b-palette（色盘资产）          ← 批次一
  └→ F24（末帧传递）→ F25（场间并发） ← 批次五
```

**批次一修订后的完整清单**（加粗为新增/提级项）：

| 顺序 | 项 | 一句话 |
|---|---|---|
| 1 | **F8** | 三分 prompt（咽喉，先做） |
| 2 | **F6b+F31** | 首/尾帧约束 + 介质掩护 |
| 3 | **F15** | 角色身份锚点 + 参考图优先级 |
| 4 | **F3b-palette** | 剧组色盘资产 |
| 5 | F1（含失败模式台账 + 分端配方） | prompt-doctrine 增补 |
| 6 | F2 | 时长公式（产出写 F34 的 durationMs） |
| 7 | F30 | 任务化 prompt 库（FireRed 形态） |
| 8 | F3 / F4 / F6b 其余 / F3b 能力表 | 维持原判定 |

#### 3.22.4 三层演变总账（研究过程的自我修正记录）

| 轮 | 判断 | 后续被推翻/修正 | 教训 |
|---|---|---|---|
| v1 | F8b adelay+amix 可直接落地 | mulpub 是 concat 直拷无 xfade ⇒ 降格为前置知识 | 先看自己链路再定位问题 |
| v1 | F3b 新建能力目录 | 已有 publish-capabilities.json ⇒ 改为扩展 | 先查既有实现 |
| v3 | F1 新建 prompt-skills/ | 已有 prompt-doctrine.json ⇒ 改为并入 | 同上（第 2 次） |
| v3 | F13「批大小 10 全并行」 | 实测批内并发 2 ⇒ 收益方向反转 | 现状描述必须实测 |
| v4 | F32 TransNetV2 补镜头切分缺口 | 已有 SceneDetect/PySceneDetect ⇒ 删除 | 同上（第 3 次） |
| v4 | ASR 粗剪 ⚠️ 待核实 | transcriber.py 已有 word_timestamps ⇒ 确认真缺口 | 核实要双向：既查重复也查前置 |
| v4 | F7 引入 parentSceneId | 已有 parentId ⇒ 复用 | schema 增补前先盘点 |

> 💡 **七次自我修正的模式完全一致**：每一次都是「调研外部项目时得出的判断，被『回到 mulpub 实测一遍』推翻」。这不是研究不严谨——恰恰是**外部对标与内部实测两个视角都必须独立走完**的证据。任何一次跳过实测，都会把错误直接送进实施批次。

> 💡 **一句话总结四层研究**：第一层给了清单，第二层给了细节与失败模式，第三层给了结构与位置感，这一层把它们**压成一张排期表**——批次一的顺序因此从「按项目价值排序」变成「**按连续性档位缺口排序**」，F8 成为咽喉，F15 / F6b+F31 / F3b-palette 三项低成本高覆盖项提级。

---

---

### 3.23 第五层新视角（v6）：成本经济学、失败哲学与 prompt 演化机制

> 前四层回答了「有什么 / 怎么做到 / 在生态什么位置 / 怎么排期」。这一层换三个此前完全未覆盖的视角：**钱**（每次生成的成本结构与谁在管钱）、**失败**（对「生成失败」的根本态度）、**演化**（prompt 改错了怎么知道）。素材主要来自 waoowaoo 的企业级架构文档（19 条 BA 不变量 + 5 条 FG 不变量）、moyin 的限额常量、showvi 的逆向 API 实战。

#### 3.23.1 成本经济学：AI 视频生产的「钱」是怎么被管的

**对照事实**：mulpub 的成本控制目前只有一处——`video-gen.js` 的 `cost_confirmation` 闸（用户确认后放行，`costCheck` 逐镜清单）。这属于**「事前一次性授权」**，而业界已经走得更远。

**① waoowaoo 的 19 条计费不变量（BA-01 ~ BA-19）**——这是 19 个项目里唯一的「把钱当一等公民设计」的完整体系，关键条目：

| 不变量 | 一句话 | 对 mulpub 的意义 |
|---|---|---|
| **BA-01 价格唯一表示** | 价格只有一份运行时目录；「运行时读 TS、校验脚本读 JSON 镜像」的双轨曾让镜像停在 52 条而运行时已有 70 条，**校验脚本恒 OK 但完全不能说明用户被收了多少钱** | ⚠️ 直接命中 mulpub 的 `publish-capabilities.json`（CJS/ESM 双版本消费）——**双版本之间漂移的风险是真实发生过的行业事故，不是理论** |
| **BA-01B 跨 provider 同价** | 同一能力经不同 provider 提供时成本可不同，**零售价必须一致** | mulpub 多家视频模型适配器若未来计费，适用 |
| **BA-01D 计价单位=真实基准** | 按 token 计价的模型不得把「每百万单价」注册成整次金额；无法表达的基准必须 fail closed | 防止「单价×数量」口径错配 |
| **BA-02 计划先于副作用** | 付费前完成全部校验，PlanSnapshot 创建前不得提交 Provider | mulpub 的 cost_confirm 闸已是此形态 ✅ |
| **BA-03 冻结同一输入** | Snapshot 冻结资源版本+参数+quote；**执行快照就是该 Snapshot，不建第二份冻结** | 防「确认时的参数 ≠ 执行时的参数」 |
| **BA-08 attempt 与收费分离** | Provider attempt 可重试，**同一业务执行只持一份授权和费用**；未提交 Provider 的失败释放冻结 | **直接回答 F12 的遗留问题**：VLM QC 重试如何不重复扣费 |
| **BA-09 批量仍是一次计划** | 整批一次校验/报价/授权，失败项续跑**复用原 Snapshot，不重新收费成功项** | mulpub 批量生成（120 镜）续跑场景适用 |
| **BA-17 LLM 后付** | 模型价格跑完才知道 → 事前只做门禁，**逐调用实时结算** | 解释了为什么 mulpub「事前闸」之后仍需账本 |

**② moyin 的提交前限额校验**（`sclass-prompt-builder.ts:80-85`）——把平台硬限制做成**常量 + 提交前校验 + overLimit/limitWarnings 结构**：

```javascript
export const SEEDANCE_LIMITS = {
  maxImages: 9, maxTotalFiles: 12, maxPromptChars: 5000,
  // overLimit / limitWarnings 由 builder 计算并随提交返回
}
```

mulpub 的对应物是 `auto-plan.js` 的 `MAX_AUTO_SHOTS=120` 等——但**只挡总量，不挡「单次提交的参数组合」**。若 mulpub 接 Seedance 2.0 组级生成（F16），这套限额常量结构可直接搬。

**③ showvi 的逆向 API 形态**（`clients/SEEDDANCE.md`）——即梦 Cookie `sessionid` 认证、模型矩阵（3.0/pro/fast/s2.0 + seedance-2.0 需 Playwright）、时长档位 5/10s 与 4-15s。**价值是「平台能力矩阵的实测记录」而非代码**——它证明即梦系模型的多图参考（seedance-2.0）与即梦 3.0 的单图参考在**客户端层面就是两套协议**。mulpub 的 `video-reference-inputs.js` 只覆盖 minimax/agnes 三家，扩展即梦系时可参考此矩阵。

**成本经济学收束**：mulpub 当前「事前一次性确认」模式对单镜生成够用，但**三个缺口在批量场景会放大**：① 续跑是否重复计费（BA-08/09）；② 参数漂移（确认 5s 执行 8s，BA-03）；③ 能力目录双版本漂移（BA-01，mulpub 的 publish-capabilities.json CJS/ESM 双版本就是同一形态）。**建议**：F12 实施时按 BA-08 语义实现「attempt 与收费分离」；给 `publish-capabilities.json` 的 CJS/ESM 双版本加一个「同源校验」测试（两侧加载同一 JSON 文件，防 BA-01 事故重演）。

#### 3.23.2 失败哲学：对「生成失败」的根本态度决定架构形态

**waoowaoo 的 failure-governance（FG-01~05）是 19 个项目里唯一的「失败处理设计文档」**，核心主张一句话：**外部异常是开放集合，产品错误码是封闭集合——把未知异常翻译成错误码会永久丢失诊断事实**。

| 不变量 | 一句话 |
|---|---|
| **FG-01 原生证据是失败事实** | 任何失败必须形成版本化 FailureRecord（脱敏有界的 name/message/code/status/request id/cause）；后续只能追加 context，**不得用统一 code 或包装文案覆盖原始证据** |
| **FG-02 解释不裁决重放** | 产品错误码只管展示与 i18n；**自动重放的输入不得使用错误码或 retryable 标志** |
| **FG-03 registry 是唯一重放裁判** | 每个可重放动作声明封闭 operation identity（重试次数/幂等语义/副作用）；**调用方不得传 retry 次数**；提交结果未知时禁止重提 |
| **FG-05 绕过必须机器失败** | CI conformance 穷尽 registry，拒绝裸 Provider 响应、通用 retrying fetch、无绑定 catch；**文档提醒不算边界** |

**「踩过的坑」四段实录**（同文档）——每一段都是「局部修复 → 下一层再丢」的教训链：
1. FailureRecord v1 把 code/message 当事实 → COS 返回未知 `UserNetworkTooSlow` 被坍缩为 INTERNAL_ERROR → 又被判不可重试 → **传输统一 ≠ 证据完整**
2. 给 COS 加错误名白名单只修一个已知实例 → **开放世界的下一个错误仍会落空** → 白名单整体删除
3. 媒体预检把未知异常包装成 `INVALID_PARAMS` → **多个用户被错误引导去改创作参数**（真实用户伤害）
4. Provider 错误只修了三段中的一段 → 其余层仍丢原文 → **局部翻译统一 ≠ 失败事实统一**

**对照 19 个项目的失败处理形态**：

| 形态 | 项目 | 对失败的根本态度 |
|---|---|---|
| **证据保全派** | waoowaoo | 失败是事实，先保真再解释（FG 体系） |
| **fail-soft 降级派** | FireRed（ASR 裁决失败回退原句）、Pixelle（三态对齐） | 局部失败不阻塞整体 |
| **fail-closed 拒绝派** | mulpub film-kit、Jellyfish readiness | 条件不满足就整体拒绝 |
| **静默吞掉派** | 多个项目（`except: pass` / 正则假测试） | 无体系，随机丢诊断 |

**对 mulpub 的增量结论**：
1. mulpub 的 fail-closed（kit-loader、成本闸）与 FireRed 的 fail-soft 是**两种都正确的态度，但适用层不同**——**配置/输入层 fail-closed（坏数据宁可不做），执行层 fail-soft（单镜失败不废整批）**。mulpub 当前两层的边界没有明文化，`production-driver.js` 的「已开始的批跑完、未开始的保持 pending」实际上是执行层 fail-soft 的雏形，值得明文确立。
2. **FG-03 对 mulpub 的 F19（checkpoint + history_id 只轮询不重提交）是现成的设计依据**——「提交受理结果未知时始终禁止重提」这条不变量，正是 F19 想解决的问题的规范表述。F19 实施时可直接引用 FG-03 作为设计依据。
3. mulpub 若要建立自己的 FailureRecord，最小形态是：**在 `production-driver` 的失败批记录中追加「原始 provider 错误体」字段**（现在只有归因结论），使续跑决策与排障都能看到第一手证据。

#### 3.23.3 Prompt 演化机制：改 prompt 之后，怎么知道没改坏

这是 19 个项目里**最隐蔽也最关键的空白**：prompt 是所有项目的核心资产，但**有回归验证机制的只有 waoowaoo 一家**。

**waoowaoo 的 canary 机制**（`standards/prompt-canary/*.canary.json`，4 份）：
- 形态：**固定输入 → 期望输出**的 JSON 对（如 `storyboard_panels.canary.json`：给定 source_text，期望产出含 `panel_number/description/characters/location/shot_type/camera_move/video_prompt/duration` 的结构化分镜数组）
- **关键发现：开源仓里 canary 没有消费代码**——全仓搜索仅 `package-lock.json` 命中。结合其 `ee/` 闭源目录的存在，判定：**canary 的执行器在闭源 EE 侧**，开源仓只放基线数据。这本身就是一条信息：**canary 基线被视为「标准」而与代码分离存放**（`standards/` 目录），连闭源侧也要遵循同一份基线
- 另一个演化机制在 FireRed：`.claude/skills/openstoryline-use/`——**把自己的安装与使用方法做成 Claude Skill**，即「AI 使用 AI 产品」的技能化封装；加上第二层发现的「Skill 沉淀」（剪辑逻辑 → SKILL.md），FireRed 的 prompt/技能演化是**用户参与式**的

**对照各项目的 prompt 演化能力**：

| 项目 | prompt 存放 | 版本化 | 回归验证 | 演化机制 |
|---|---|---|---|---|
| waoowaoo | `standards/prompt-canary/*.json` | ✅ 文件级 | ✅ canary（执行器在 EE） | 基线随版本发布 |
| FireRed | `prompts/tasks/**` | ✅ git | ❌ 无 | Skill 沉淀（用户参与） |
| smy | references/ 单一来源 | ✅ git | **✅ 实测迭代记录写进文档**（三轮定版史） | 人工实测台账 |
| mulpub | prompt-doctrine.json | ✅ git + 同源锁测试 | **部分**（结构锁有，语义回归无） | 无 |
| 其余 14 个 | 散落代码/文档 | 部分 | ❌ | 无 |

**对 mulpub 的增量结论（升级 F30/F1 的设计）**：
1. mulpub 现有的「同源锁测试」（`BUGFIX-FILM-ENGINEERING-FINDINGS:302-308`）锁的是**结构与绑定**（doctrine 文件 ↔ UI 标签页），**锁不了语义**——改一条 rule 的措辞导致生成质量下降，现有机制完全无感。这正好是 canary 填的坑。
2. **最小 canary 形态建议**（不必等 F30）：为 prompt-doctrine 的**每条 rule** 建一条「输入示例 → 期望产出要点」断言（JSON 放 `film-kit/prompt-canary/`），测试断言「渲染后的完整 prompt 必含/必不含某些关键片段」（如禁代词规则 → 渲染后 prompt 不含「他/她/它」指代角色的段落）。**这不需要调 LLM**——断言的是 prompt 组装结果，不是生成结果，纯本地可跑、零成本。
3. **「失败模式台账 + canary」是一对闭环**：台账记录「症状→修法」，canary 把修法固化为回归断言——**下次改 prompt 时，之前翻过的车不会再翻**。smy 用人肉做到了这一点（三轮定版史），mulpub 可以用机制做到。

> 💡 **一句话总结第五层**：前三层研究的是「怎么把视频做出来」，这一层研究的是「**做出来之后，钱、失败、迭代怎么管**」——这三样在 19 个项目里几乎无人成体系，而 waoowaoo 用 19+5 条不变量证明这三样恰恰是「能用」与「能长期用」的分界线。mulpub 的 cost_confirm 闸是很好的起点，但 BA-08（attempt 与收费分离）、FG-03（重放裁判）、canary（prompt 回归）三个缺口在批量生产场景会持续放大。

---

---

### 3.24 第六层新视角（v7）：同平台协议差异、接模型的工程化、prompt 资产量盘点

> 本层回答三个此前三层未碰的具体问题：**①同一家模型平台（Seedance/ARK）在不同项目里的接入协议差在哪**（直接服务 mulpub 的 adapter 层维护）；②**「接一个新模型」这件事本身被工程化到什么程度**；③各项目的 prompt 资产量盘点。

#### 3.24.1 Seedance/ARK 四实现协议对照 —— 同一平台，四种工程形态

实测 19 个项目中有 **8 个接了 Seedance/即梦**，其中 4 个真正实现了 API 客户端。同一官方 ARK API（`ark.cn-beijing.volces.com/api/v3`），四种形态：

| 维度 | **waoowaoo**（TS，最完整） | **Pixelle-Video**（Python） | **showvi**（Python，双实现） | **FireRed**（Python） |
|---|---|---|---|---|
| externalId 格式 | `ARK:VIDEO:requestId`（**结构化可解析**，含 type 前缀） | 无统一 id 格式（内部变量） | 与 Sora 对齐的返回格式 | — |
| videoUrl 提取 | **双形态兼容**：`content.video_url` 或 `content[].video_url.url` 数组遍历（`poll.ts:31-44`） | 单一形态 | — | — |
| token 计量 | ✅ 回传 `actualVideoTokens`（实际消耗与预估分离） | ❌ | ❌ | ❌ |
| 失败处理 | `createProviderAsyncTaskFailure` + `captureProviderHttpFailure`（FG 体系内） | logger.warning | — | — |
| 错误码解析 | **独立 `readArkErrorCode` 模块**（ARK 错误码单独建模） | 无 | — | — |
| 代理 | `fetchWithProviderProxy`（出站统一走代理层） | `local_proxy` 参数 | — | — |
| 认证来源 | `context.getProviderConfig(userId,'ark')`（**按用户存配置**） | 环境变量 `ARK_API_KEY` | Cookie `sessionid`（逆向） | config.toml |

**三个关键差异点（mulpub adapter 层直接可用）**：

1. **`video_url` 的双形态**：ARK 返回的 `content` 可能是对象（`{video_url}`）也可能是数组（`[{video_url:{url}}]`）——waoowaoo 的 `readArkVideoUrl` 两种都接。mulpub `video-gen.js:190` 用 `data.taskId || data.videoId || data.id || data.task_id` 的**或链兜底**，但对**响应体 videoUrl 的形态兼容**未必做过同样防御——接入 Seedance 时这是第一个会踩的坑。
2. **`actualVideoTokens` 分离**：waoowaoo 把「预估 token」与「实际消耗 token」分开回传——这是 BA-01D（计价单位=真实基准）在 provider 层的落地。mulpub 若做成本核算，**应从响应里取实际值而非按请求参数估算**。
3. **错误码独立建模**：waoowaoo 为 ARK 单独建了 `readArkErrorCode`/`toArkPollHttpError`——平台错误码进入 FG-01 的 FailureRecord 时**保留原生语义**，而不是坍缩成 INTERNAL_ERROR。

> 💡 mulpub 的 `film-engineering-auto.js` 等四处已有 seedance 字样（需确认是配置还是实现）；若 mulpub 的 Seedance 接入尚在计划，**waoowaoo 的 ark 四件套（async-task/poll/error/pricing）就是最完整的 TS 参考实现（Elastic 2.0 桌面端可用）**。

#### 3.24.2 「接一个新模型」的工程化程度对照 —— ZJT 把它做成了 Skill

**ZJT 的 `.claude/skills/add-video-driver/SKILL.md`**：把「接入新视频模型」的完整流程写成 AI 可执行的 Skill——这是 19 个项目里唯一把「扩模型」变成**可委托给 AI 的标准作业程序**的。

其流程骨架（四步）：
1. **常量与任务配置**：`unified_config.py` 注册驱动实现名 + `ALL_TASK_CONFIGS` 加任务条目
2. **驱动类实现**：继承 `base_video_driver.py`，经 `driver_factory` 注册
3. **三层映射**：`任务类型(ID) → 业务驱动名 → 实现驱动名 → 驱动类`（如 `14 → vidu_i2v → vidu_default → ViduDefaultDriver()`）——**业务名与实现名解耦**，换底层实现不动业务配置
4. **配置与热更新**：`config.example.yml` 加供应商段 + `default_configs.py` 加热更新项（`quick_config: True` 进管理后台快速弹窗、`is_sensitive: True` 日志脱敏）

**对照各项目「接新模型」的成本**：

| 项目 | 接新模型要动几处 | 形态 |
|---|---|---|
| **ZJT** | 4 处，**有 Skill 指导 AI 完成** | 流程文档化 + AI 可执行 |
| waoowaoo | provider 目录一个子模块（async-task/poll/error/pricing 四件套）+ 目录注册 | 结构约定清晰，但无 Skill |
| mulpub | **adapter 一件 + KNOWN_METHODS 校验 + capabilities() + PUBLIC_CHANNELS**（IPC 三层防御） | 防御最强，但步骤靠记忆 |
| moyin | feature-router 绑定 + use-xxx-generation composable | 前端直连，无独立 adapter 层 |

**对 mulpub 的结论**：mulpub 的 adapter 接入防御（版本校验 + validateConfig + IPC 防御）是四者最严的，但「**接一个模型的完整步骤清单**」没有文档化——ZJT 的 Skill 形态（流程 + 检查点 + 文件清单）值得在 `01-docs/` 落一份《新增视频模型接入 SOP》，把「四处必改 + 测试要求」固化，甚至未来做成 mulpub 自己的 add-video-adapter Skill。

#### 3.24.3 Prompt 资产量盘点 —— 谁在真正经营 prompt 资产

按「含 prompt 相关内容的文件数」实测：

| 项目 | 文件数 | 形态 |
|---|---|---|
| waoowaoo | **33** | 分散于 canary 基线 + 架构文档 + 代码模板 |
| smy-seedance-storyboard | 17 | 全部是资产本身（Skill + references + 实例工程） |
| FireRed-OpenStoryline | 14 | **任务化外置**（prompts/tasks/，每个任务 zh/en 双份 system+user） |
| short-drama-skills | 14 | 全部是资产本身 |
| moyin-creator | 9 | 散落 composable/文档 |
| short-drama | 0* | 文件名不含 prompt 但内容全是（SKILL.md 本体） |

*注：short-drama 的 0 是文件名层统计的盲区——它整仓就是剧本方法论，不自称 prompt。

**收束**：FireRed 的 14 个文件是**组织最好的**（任务化 + 双语 + 外置 + fail-closed 加载），waoowaoo 的 33 个是**治理最好的**（canary 基线 + 输出契约文档），而 **mulpub 的对应物只有 prompt-doctrine.json 一个文件**——这就是 F30（任务化外置）与 F1（失败模式台账）的量化依据：mulpub 的 prompt 资产管理成熟度约为 FireRed 的 1/14、waoowaoo 的 1/33。

> 💡 **一句话总结第六层**：把「同一平台四种接法」「接模型做成 Skill」「prompt 资产量化盘点」三个具体问题答完——**Seedance 接入看 waoowaoo 四件套，接模型 SOP 抄 ZJT 的 Skill 形态，prompt 资产经营的差距用数字摆了出来**。

---

---

## 四、横向对比与复用价值排名

### 4.1 mulpub 现状 vs 竞品能力对照

| 能力维度 | mulpub 现状 | 业界最优 | 差距 | 来源 |
|---|---|---|---|---|
| 剧本→分镜确定性模板 | ✅ 有（本地模板） | LLM + 工业化 Prompt 规则 | **中**：LLM 润色恒不生效 | short-drama-skills |
| 单镜时长决策 | ⚠️ 硬编码 5/8/10 秒 | 按台词字数计算 | **中** | short-drama-skills 公式 |
| 镜头语言结构化 | ⚠️ 只有 prompt 文本 | 景别/运镜/机位/VFX 枚举 | **大** | Jellyfish types.py |
| 首帧/视频/尾帧三分 prompt | ❌ 只有单一 prompt | 三类分离 | **中** | moyin-creator |
| 视角变体（同场景多机位） | ❌ 无 | `parentSceneId` + `viewpointId` | **大** | moyin-creator |
| 单镜锁定（防重跑覆盖） | ❌ 无 | `locked: true` | **中** | ai-art-engine |
| 指纹缓存（改一镜重跑一镜） | ✅ 磁盘为真续跑 | 指纹级粒度 | **小** | ai-art-engine 强化 |
| VLM 质检自动重拍 | ❌ 无 | Generate→Critique→Rewrite→Retry | **大** | showvi |
| 按场次并发 | ⚠️ **批内并发 2**（实测 `production-runner.js:14`） | 场内串行 + 场间并行 | **中** | ai-art-engine |
| 跨集角色一致性 | ❌ 单集模型 | Series Bible 扇出 | **大** | ai-art-engine |
| 剪映草稿导出 | ❌ 无 | 多轨道草稿生成 | **大** | ZJT/jianying |
| ASR 时间戳防陈旧 | ⚠️ 有 audio-aligner | srt_sha256 sidecar 绑定 | **小** | autoclip |
| 剧本合规审核 | ❌ 无 | compliance-checklist | **中** | short-drama |
| 发布链路 | ✅ rpa/api-publish-engine | — | — | — |

### 4.2 复用价值三梯队排名

#### 🥇 第一梯队：立即可落地（MIT / Apache-2.0，低成本高收益）

| 排名 | 复用项 | 来源 | 许可证 | 落点 | 工作量 |
|---|---|---|---|---|---|
| 1 | **剪映多轨道草稿生成库** | ZJT/jianying | Apache-2.0 | 新建 `packages/jianying-draft/` | 中 |
| 2 | **7 条工业化分镜 Prompt 规则**（并入既有 prompt-doctrine） | short-drama-skills | MIT | `film-kit/prompt-doctrine.json` | 中 |
| 3 | **单镜时长按台词计算** | short-drama-skills | MIT | `auto-plan.js` | 小 |
| 4 | **ASR sidecar + srt_sha256 失效** | autoclip | MIT | `packages/audio-aligner/` | 小 |
| 5 | **文本快照 expectedRevision 乐观锁** | Toonflow | MIT | `auto-project.js` | 小 |
| 6 | **剧本创作状态机 + 8 个 references** | short-drama | MIT | `packages/ai-writer` | 中 |
| 7 | **B 站字幕多路回退下载** | autoclip | MIT | `collection-engine` | 小 |
| 8 | **镜头语言枚举体系** | Jellyfish | Apache-2.0 | `film-kit` Shot schema | 中 |
| 9 | ~~模型能力外置目录~~ **改为复用现有能力体系** | waoowaoo | Elastic 2.0 | 扩展 `publish-capabilities.json` 模式 | 中 |
| 10 | **两遍 loudnorm + BGM ducking 三态判定** ⚠️ | waoowaoo | Elastic 2.0 | `packages/audio-aligner/aligner/loudness.py`（**纯 Python 包**） | **大（混合 PR）** |
| 11 | **出站媒体 SSRF 防护** | waoowaoo | Elastic 2.0 | `shared-utils/src/net/safe-fetch.js`（**纯 JS 包**） | 小 |
| 12 | **就绪度闸门 shot_video_readiness** | Jellyfish | Apache-2.0 | `story2video-engine/src/shotReadiness.ts` | 小 |
| 13 | **视频能力协商表（ratio→size 派生）** | Jellyfish | Apache-2.0 | `python-backend/src/multi_publish/video_creation/` | 小 |
| 14 | **首/尾/关键帧 21 条强约束** | Jellyfish | Apache-2.0 | `story2video-engine/src/prompts/shotFrame.md` | 小 |
| **15** | **任务化中英成对 prompt 库** ★v2 | **FireRed-OpenStoryline** | Apache-2.0 | `film-kit/prompts/tasks/<task>/{zh,en}/` | 小 |
| **16** | **AI 转场「介质掩护」规则** ★v2 | **FireRed-OpenStoryline** | Apache-2.0 | `story2video-engine` 的 endFramePrompt 规则 | 小 |
| **17** | ~~TransNetV2 镜头边界检测~~ **已降级为备选**（实测 mulpub 已有 `SceneDetect`/PySceneDetect） | ~~FireRed-OpenStoryline~~ | — | — | ❌ 不进批次 |
| **18** | **Skill 沉淀机制 + 路径穿越防护** ★v2 | **FireRed-OpenStoryline** | Apache-2.0 | 新建 `packages/ai-writer/src/skills/`（实测不存在） | 中 |

> 🆕 **v2 新增 3 项第一梯队 + 1 项被推翻**，全部来自 `FireRed-OpenStoryline`（Apache-2.0，小红书）。它是本轮新增项目里**唯一进第一梯队**的 —— 因为它是唯一同时满足「Apache-2.0 + 与 mulpub 能力缺口正面对齐 + Python 侧可直接移植」的项目。
>
> 🔴 **第 17 项（TransNetV2）被实测推翻**：mulpub 已有 `video_creation/analysis/scene_detect.py`（282 行，`SceneDetect(BaseTool)`，封装 PySceneDetect + ffmpeg 回退）。引入 TransNetV2 需 torch（**+1~2 GB**），与桌面端分发体积极不相称 ⇒ 降级为备选，不进批次。
>
> `smy-seedance-storyboard` 与 `ToonCrafter` **均未进任何梯队**：前者许可证锁死（无 LICENSE，只能参考抽象做法），后者与桌面端形态不兼容（需 GPU、512×320@10fps）。

> ⚠️ **第 10 项的硬墙（实测）**：`apps/desktop/scripts/stage-media-tools.js:10-22` 的 `REQUIRED_FILTERS` 仅 11 个滤镜（scale/pad/zoompan/rotate/boxblur/drawtext/fade/xfade/acrossfade/anullsrc/amix），**不含 `loudnorm`/`adelay`/`tpad`**。仓内 `podcast-episode-tts-adapters.js:89-90` 已明文禁止，`01-docs/REUSE-CATALOG-2026-10-13.md:536` 明写引入需「同 PR 改 `media-tools-lock.json` + before-pack 校验 + 重打包实测」。**故第 10 项工作量由「小」上调为「大（混合 PR）」** —— 初稿标「小」是错的。同理第 12 项若用 tpad 也受此约束。
>
> ⚠️ **落点语言修正（实测）**：`packages/shared-utils` 为纯 JS 包（113 个 `.js`、**0 个 `.ts**、无 tsconfig）→ 落点后缀用 `.js`；`packages/audio-aligner` 为纯 Python 包（8 个 `.py`、**无 package.json**）→ 落点后缀用 `.py`，且意味着「复用」实际是**按算法重写为 Python**，非直接搬运 TS 源码。

**新增项的细节**（来自深度核实）：
- **F9' 模型能力外置目录**（`waoowaoo/standards/capabilities/image-video.catalog.json:1-60`，15.9KB）：按 `modelType/provider/modelId/capabilities` 声明每个模型支持的 `resolutionOptions`/`qualityOptions`/`durationOptions`/`generationModeOptions`/`generateAudioOptions`。UI 从它推导可选值，`npm run check:capability-catalog` 在 CI 校验 —— **新增模型 = 改 JSON，不改代码**。直接消除「提交非法参数导致失败扣费」。
- **F10' 两遍 loudnorm + BGM ducking**（`waoowaoo/src/lib/video-compose/video-merge-audio.ts:23-90`）：主音轨 `-16 LUFS / TP -1.5`，BGM `-6 LUFS`，ducking `threshold 0.08 / ratio 3 / attack 80ms / release 450ms`。**最见功力的是三态判定**（`:62-89`）：数字静音（`input_i === '-inf' && input_tp === '-inf'`）是**协议定义的正常表示，绝不能被当成解析失败** —— 这一条能避免「静音片段被误判失败」导致合成中断。
- **F3b 修正（自查发现，重要）**：初稿把「模型能力外置目录」列为新建 `shared-utils/src/model-capabilities/`。**复核 mulpub 现有实现后发现该项目已有同构的数据驱动能力注册表**：
  - `packages/shared-utils/src/publish-capabilities.json`（15 平台发布能力单一真源，含 `limits`/`titleMode`，CJS + ESM 双版本消费）
  - `packages/api-publish-engine/src/publish/capabilities/{douyin,bilibili,xiaohongshu,...}-capabilities.js`（每平台一个）
  - `packages/python-backend/src/multi_publish/video_creation/providers/video/engines/capabilities.py`
  - 规范见 `01-docs/PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` 与 `openspec/changes/publish-capability-registry/`

  ⚠️ **结论修正**：F3b **不应新建独立目录**，而应复用 `publish-capabilities.json` 已有的**数据驱动 + CJS/ESM 双版本 + openspec 规范**这套成熟模式，把它**扩展到「图像/视频模型能力」域**。waoowaoo 的价值从「提供新架构」降为「**交叉验证了这套模式的正确性**」—— 两个独立项目收敛到同一设计（能力外置为 JSON + CI 校验 + UI 从之推导），说明这是行业共识写法。

  修正后 F3b 的实际工作量从「小（新建）」变为「**中（扩展现有）**」，但**避免了重复造轮子**，且能复用已有的测试与 CI 门禁。
- **F11' SSRF 防护**（`waoowaoo/src/lib/media/outbound-fetch.ts:58-90`）：AI 平台普遍接受 URL 作参考图输入，用户传 `http://169.254.169.254/` 就打穿云元数据。防护含私网 IP 段黑名单（`isIpv4InRange`）+ DoH（`cloudflare-dns.com/dns-query`）防 DNS rebinding + 每次重定向后重跑校验。纯函数可直接搬。
  ⚠️ **需先核查 mulpub 是否已有等价防护**（`packages/shared-utils` 或 `python-backend` 的网络层），避免重复引入。

**v2 新增项细节**：
- **#15 任务化中英成对 prompt 库**（`FireRed-OpenStoryline/src/open_storyline/utils/prompts.py:1-100`）：100 行加载器，目录即契约 `prompts/tasks/<task>/<lang>/<role>.md`，`{{var}}` 正则插值，`task:role:lang` 缓存，缺文件抛 `FileNotFoundError`（fail-closed）。**与 mulpub 现有 `film-kit/prompt-doctrine.json` 是互补关系而非替代**：doctrine 存「方法论」（7 blocks + 10 rules + 6 glossary），本项存「具体任务的 system/user prompt」。且 `zh/` `en/` 并列结构**天然满足 CI Gate 7 的 locale 成对要求**。
- **#16 AI 转场「介质掩护」**（`FireRed-OpenStoryline/prompts/tasks/generate_ai_transition/zh/system.md`）：核心是「**绝对禁止让形态差异巨大的实体直接形变，必须引入过渡介质掩盖计算过程**」（镜头光斑 / 运动模糊 / 粒子爆散）。配三条：强指令前缀、锁定运镜轨迹、兜底反幻觉后缀。这是**降低废片率的一线经验**，直接补 F8 `endFramePrompt` 的执行细节。
- **~~#17 TransNetV2 镜头边界检测~~（已删除）**：初稿称「mulpub 完全没有原片自动切分能力」。**实测推翻** —— `packages/python-backend/src/multi_publish/video_creation/analysis/scene_detect.py`（282 行）已封装 PySceneDetect（content/threshold/adaptive）+ ffmpeg 回退。TransNetV2 需 torch（+1~2 GB），与桌面端不匹配。**这条记录的保留价值在于：它证明了「必须先查目标仓」这条纪律的有效性 —— 若不做实测，这个错误会直接进入实施批次。**
- **#18 Skill 沉淀 + 路径穿越防护**（`FireRed-OpenStoryline/skills/skills_io.py:22-83`）：把 agent 一次性的剪辑逻辑写成 `SKILL.md` 落盘，下次 `SkillManager.adiscover()` 自动发现并转成工具。**必须同时移植路径穿越防护**：`if base_path not in final_path.parents: return error`。落点 `packages/ai-writer/src/skills/` **实测不存在，需新建**。

#### 🥈 第二梯队：需重写实现（思路明确，代码需自研）

| 排名 | 复用项 | 来源 | 许可证 | 落点 | 工作量 |
|---|---|---|---|---|---|
| 9 | **单镜锁定 locked:true** | ai-art-engine | GPL→仅思路 | Shot schema | 小 |
| 10 | **VLM 质检闭环** | showvi | MIT | `video-gen.js` 后增 QC | 中 |
| 11 | **按场次并发（场内串行/场间并行）** | ai-art-engine | GPL→仅思路 | `production-driver.js` | 中 |
| 12 | **首帧/视频/尾帧三分 prompt** | moyin-creator | AGPL→仅思路 | Shot schema | 中 |
| 13 | **视角变体模型** | moyin-creator | AGPL→仅思路 | Scene schema | 中 |
| 14 | **流式/轮询双交付策略** | Jellyfish | Apache-2.0 | `video-gen.js` | 中 |
| 15 | **跨集 Series Bible** | ai-art-engine | GPL→仅思路 | film-kit cast 资产 | 大 |
| 16 | **指纹缓存粒度强化** | ai-art-engine | GPL→仅思路 | `auto-runner.js` | 中 |
| 17 | **剧本合规审核清单** | short-drama | MIT | 发布前检查 | 中 |
| 18 | **角色 #变体 造型继承** | ai-art-engine | GPL→仅思路 | 参考图机制 | 中 |
| 19 | **角色身份锚点 + 参考图优先级** | moyin-creator | AGPL→**提示词可抄** | `story2video-engine/src/prompt/identity-anchor.ts` | 小 |
| 20 | **多视角 Contact Sheet（6 格一次生成）** | moyin-creator | AGPL→仅思路 | `story2video-engine/src/prompt/contact-sheet.ts` | 中 |
| 21 | **S 级组级多镜头提示词 + 限额校验** | moyin-creator | AGPL→**提示词可抄** | `story2video-engine/src/prompt/group-prompt.ts` | 中 |
| 22 | **时长控制算法（台词锚定+双向归一）** | ZJT | 修改版 Apache→需署名 | `story2video-engine/src/duration/` | 中 |
| 23 | **AcceptedRegistry 实体 ID 注册表** | ZJT | 修改版 Apache→需署名 | `shared-utils/src/entity-registry.ts` | 中 |
| 24 | **分段拆分两步式 + 检查点续跑** | ZJT | 修改版 Apache→需署名 | `story2video-engine` 长剧本路径 | 大 |
| 25 | **分片渲染 parts.txt（三级时长回退）** | app.yumcut | NC→仅思路 | `story2video-engine/src/partsTimeline.ts` | 小 |
| 26 | **外部工具版本强校验 + doctor** | app.yumcut | NC→仅思路 | `python-backend/app/startup/doctor.py` | 小 |

**新增项的细节**：
- **F19' 角色身份锚点**（`moyin-creator/src/components/panels/director/split-scenes.tsx:210-252`）：把身份拆成骨相（faceShape/jawline/cheekbones）+ 五官（eyeShape/noseShape/lipShape）+ 发色/瞳色/唇色，**硬上限 4 条**（提示词越长模型越容易丢约束）。更关键的是**参考图优先级**：`the earliest character references are canonical identity anchors; later references are only for scene, lighting, framing, and mood`。以及多人同框防串脸：`Do not swap face identity, body identity, speaking ownership, or action ownership between named characters` —— **说话归属与动作归属也要防串**，这是多角色场景最常见失败模式。
- **F21' 组级多镜头提示词**（`moyin-creator/src/components/panels/sclass/sclass-prompt-builder.ts:1-70`）：把 3 个分镜合并成「镜头1→镜头2→镜头3」一段提交，**既省钱（1 次生视频代替 3 次）又天然保证段内角色与场景连续**。提交前校验 Seedance 2.0 限额（≤9 图 + ≤3 视频 + ≤3 音频，总 ≤12，prompt ≤5000 字符）。
- **F22' 时长控制算法**（`ZJT/llm/script_parser.py:1179-1268`）：见 3.1 节核心实现 4。**「台词必须念完」是硬约束** —— 单镜头下限 = max(全局最小秒数, 该镜头台词朗读秒数)。这直接消除后期「音画不同步 / 配音被截断」返工。
- **F25' 分片渲染**（`app.yumcut/scripts/daemon/helpers/video/parts-timeline.ts`）：blocks 转 parts.txt，**三级时长回退**（parsedEnd → nextStart → durationFromField → 2500ms 兜底）。长视频整体渲染会内存/超时，分片后可并行 + 失败只重渲一片。
- **F26' 外部工具体检**（`app.yumcut/scripts/daemon/helpers/ffmpeg.ts`）：`MIN_FFMPEG_VERSION='7.1.1'` 强制校验 + `doctor-external-tools.ts`。mulpub 依赖 ffmpeg/Remotion/Chromium，启动体检能消灭大量「环境问题」工单。

> ⚠️ **一个跨项目的隐性坑**（huobao-drama 暴露）：Seedance 等国内视频模型引用本地参考资源需**公网地址**，桌面版做不到。mulpub 接国内视频模型时，**本地图片必须先传到公网图床才能作为参考图提交**。
>
> 🔴 **评审指出：报告识别了这个阻塞项，但 19 个 F 里没有一项负责它** —— 识别出阻塞却不排期，等于没解决。**v3 补充 F28**。

**新增（v3，回应遗漏项）**：

| ID | 内容 | 来源 | 落点 | 工作量 |
|---|---|---|---|---|
| **F28** | **参考图公网图床上传**（本地图 → 公网 URL，供 Seedance/可灵等国内模型消费） | huobao-drama 暴露的约束 | `video-reference-inputs.js` 前置 | 中 |
| **F29** | **TTS 时长驱动视频时长**（先 TTS 取真实时长 → 再按此时长生成视频） | Pixelle-Video（Apache-2.0） | `story2video-engine` 分镜时长决策 | 中 |

> 🔴 **F29 是评审指出的取舍颠倒**：本报告在 §3.9 把 Pixelle 的「TTS 时长驱动视频时长」评为 ⭐⭐⭐⭐⭐「范式级创新」，但四批次 27 个 F 中**查无此项**；反而把本该被它消除的 F8c（事后 pad/trim 对齐）选进了批次三。
> ✅ 正确取舍：**F29（事前对齐）优先级应高于 F8c（事后补救）**。若 F29 可行（需视频模型支持 duration 入参），F8c 的必要性大幅下降。建议先做 F29 的可行性验证，再决定 F8c 是否保留。
>
> F28 是**多个复用项的共同前置**：F15（角色身份锚点）、F24（末帧传递）、F27（Series Bible）都依赖参考图能提交给模型，而国内模型要求公网地址。**不解决 F28，这些项在接国内模型时全部跑不通**。

> F28 是**多个复用项的共同前置**：F18（角色身份锚点）、F24（末帧传递）、F27（Series Bible）都依赖参考图能提交给模型，而国内模型要求公网地址。**不解决 F28，这些项在接国内模型时全部跑不通**。
> 设计要点：① 图床可配置（用户自备 OSS/七牛/Cos，或可选的内置通道）；② **上传前必须显式告知用户「图片将上传到公网」**（隐私合规，参考 autoclip 的 `docs/PRIVACY.md` 做法）；③ 失败时降级为纯文本生图并明确 warning，不静默失败。

#### 🥉 第三梯队：长期参考

| 排名 | 复用项 | 来源 | 说明 |
|---|---|---|---|
| 19 | 跨分段实体状态追踪 | showvi | 长视频连贯性根因方案 |
| 20 | 16 宫格关键帧传递 | showvi | 替代参考图注入的方案 |
| 21 | 违规自适应改写 | showvi | 国内发布刚需 |
| 22 | 视觉风格库（10+ 风格） | moyin-creator | Genshin/Guilty Gear 等 |
| 23 | 多人协作架构 | waoowaoo | 仅产品形态（科研项目非商用场景**可复用**，见 2.2 决策树） |
| 24 | 支付/会员体系 | FastMovieAI | 与 mulpub license 体系不同 |

---

## 五、落地实施方案

> 本节是**待实施部分**，将接受 CCG 双模型审核与对抗性审核（见 `.adversarial/` 目录）。

### 5.1 实施原则

1. **许可证铁律**：第一梯队全部来自 MIT/Apache-2.0，可安全复制；第二梯队标注「仅思路」的必须**重写实现，不复制源码**。
2. **数据资产优先**：能做成 `film-kit` 数据资产（JSON）的，优先做成数据而非代码 —— 与 mulpub 现有 film-kit 架构一致，且零运行时风险。
3. **不破坏现有 fail-closed 契约**：film-kit 加载是 fail-closed（`kit-loader.js`），新增资产必须同样校验。
4. **每个 F 独立提交**：按 `github-project-analysis` 的「Multi-Finding Batch Reuse」模式，一个 finding 一次提交（代码+测试+文档）。

### 5.2 四个实施批次

#### 批次一：数据资产层（零运行时风险，最高性价比）

| ID | 内容 | 落点 | 工作量 |
|---|---|---|---|
| **F1** | 分镜 Prompt 规则 → **扩展既有 `prompt-doctrine.json`**（不新建目录） | `electron/film-kit/prompt-doctrine.json` | 中 |
| **F2** | 单镜时长计算公式（正常/争吵/深情） | `auto-plan.js` + `auto-constants.js` | 小 |
| **F3** | 镜头语言枚举（景别/运镜/机位/VFX） | `film-kit/shot-grammar.json` + Shot schema | 中 |
| **F4** | 剧本合规审核清单 | `film-kit/compliance-checklist.json` | 小 |
| **F3b** | 模型能力外置目录 + CI 校验 | `shared-utils/src/model-capabilities/` | 小 |
| **F6b** | 首/尾/关键帧 21 条强约束 prompt | `story2video-engine/src/prompts/shotFrame.md` | 小 |
| **F30** ★v2 | **任务化中英成对 prompt 库**（FireRed 模式） | `film-kit/prompts/tasks/<task>/{zh,en}/` + 加载器 | 小 |
| **F31** ★v2 | **AI 转场「介质掩护」规则集** | 并入 F6b 的 `shotFrame.md` 规则 | 小 |
| ~~**F32**~~ ★v2 | ~~TransNetV2 镜头边界检测~~ **🔴 已删除（实测重复）** | — | — |
| **F33** ★v2 | **Skill 沉淀机制 + 路径穿越防护** | 新建 `packages/ai-writer/src/skills/`（实测不存在） | 中 |

> 🔴 **F32 已从方案中删除（自查，实测取证）**：初稿把「TransNetV2 镜头边界检测」列为补缺口项。**实测发现 mulpub 已有完整实现** ——
> `packages/python-backend/src/multi_publish/video_creation/analysis/scene_detect.py`（282 行，`SceneDetect(BaseTool)`，封装 **PySceneDetect** 的 content/threshold/adaptive 三方法，且带 **ffmpeg 回退**；`scenedetect` 与 `torch` 均不在运行时依赖里，都是可选项）。
>
> 引入 TransNetV2 需额外 `torch` + `transnetv2-pytorch`（**包体积 +1~2 GB**），与桌面端分发体积极不相称。**故删除，仅作为「若 PySceneDetect 在真实素材上漏检率高」时的备选记录在 §3.17。**
>
> 这是本轮**唯一被实测推翻的复用判断** —— 也是对本报告 §3 教训（「先调研目标仓自身」）的又一次印证。

> 🔴 **F1 重大修正（v3，评审实测发现）**：初稿主张新建 `film-kit/prompt-skills/`。**复核发现 mulpub 已有同类的完整提示词方法论资产**：
> - `apps/desktop/electron/film-kit/prompt-doctrine.json` —— **7 blocks**（SCENE CONTEXT / GEO SPATIAL LAYOUT / ACTION TIMING / AUDIO / CHARACTER ACTING / STYLE / POSITIVE CONSTRAINTS）+ **10 rules** + **6 glossary**，中英双语（`zh`/`en` 双字段）
> - `film-kit/prompt-doctrine.zh.md` —— 方法论完整中文版
> - **已完整接线**：UI 方法论标签页绑定，且 `BUGFIX-FILM-ENGINEERING-FINDINGS-2026-10-19.md:302-308` 已建同源锁测试
>
> ⚠️ **后果**：若新建 `prompt-skills/`，会造出**第二套并存的提示词规范**，两处口径必然漂移。
>
> ✅ **正确做法**：把 short-drama-skills 的**增量规则**（长台词 7 手法 T1-T7、动作戏 17 条、时长估算公式、视觉描述四维度禁代词）**并入既有 `prompt-doctrine.json` 的 blocks/rules**，复用其已有的 UI 绑定与同源锁测试。工作量由「小」调整为「中」（需做增量合并 + 回归）。

> 🆕 **F30–F33（v2 新增，全部来自 FireRed-OpenStoryline / Apache-2.0）**
>
> **F30 与 F1 的关系**：**互补，不是替代**。
> - `prompt-doctrine.json`（已有）存**方法论**：7 blocks + 10 rules + 6 glossary，是「怎么写分镜」的元规则
> - `prompts/tasks/<task>/{zh,en}/`（F30）存**具体任务的 system/user prompt**：如 `generate_script`、`filter_clips`、`understand_clips`
> - 采用 FireRed 的**目录即契约**形态，加任务只建目录不改代码；`zh/` `en/` 并列**天然满足 CI Gate 7**
>
> **F31 的价值**：`FireRed-OpenStoryline/prompts/tasks/generate_ai_transition/zh/system.md` 的第 3 条规则是**降低废片率的一线经验** ——
> 「**绝对禁止**让两个物理形态差异巨大的实体直接发生形变！必须在形变发生时引入符合全局基调的**过渡介质**掩盖计算过程」（镜头光斑 / 运动模糊 / 粒子爆散）。这条直接补上 F6b `endFramePrompt` 的执行细节。
>
> **~~F32 的价值~~（已删除）**：初稿误判「mulpub 完全没有原片自动切分能力」。**实测推翻** —— `packages/python-backend/src/multi_publish/video_creation/analysis/scene_detect.py`（282 行）已封装 PySceneDetect（content/threshold/adaptive）+ ffmpeg 回退。TransNetV2 需 torch（+1~2 GB），与桌面端分发体积极不相称，故不进方案。
>
> **F33 的注意点**：必须同时移植路径穿越防护 `if base_path not in final_path.parents: return error`（`skills_io.py:45-51`）—— 因为该机制的本质是「把 agent 生成的内容写盘」，不设防等于开了任意写入口。

**F1 详细设计（v2 修订：改为扩展既有文件，不新建目录）**：
```javascript
// ❌ 不采用：新建 film-kit/prompt-skills/ 目录（会造第二套并存规范）
// ✅ 采用：按既有 prompt-doctrine.json 的 blocks/rules 结构追加增量
{
  "blocks": [ ...既有 7 blocks..., { /* 新增：长台词切分手法 T1-T7 等 */ } ],
  "rules":  [ ...既有 10 rules..., { /* 新增：动作戏 17 条 / 时长估算 / 禁代词 */ } ],
  "glossary": [ ...既有 6 条... ]
}
```
校验由既有 `kit-loader.js` 承担（fail-closed，与其余 4 个 kit 文件同构）；新增 `KIT_FILES` 无需改动（同一文件）。

**F2 详细设计**（替换 `auto-plan.js:41` 的硬编码）：
```javascript
// 现状：AUTO_SHOT_SECONDS = [5, 8, 10]
// 改为：按台词字数计算后向上取到模型支持的档位
function estimateShotSeconds(text, emotion) {
  const n = countChineseChars(text)
  const raw = emotion === 'argument' ? Math.round(n / 10) + 1
            : emotion === 'tender'   ? Math.round(n / 5) + 1
            :                          Math.round(n / 8) + 1
  return clampToTiers(Math.min(raw, 12))   // 每镜 ≤ 12s，映射到 [5,8,10]
}
```

#### 批次二：schema 增强（补结构化缺口）

| ID | 内容 | 落点 | 工作量 |
|---|---|---|---|
| **F5** | Shot 增加 `locked` 字段（防重跑覆盖） | Shot schema + `auto-project.js` | 小 |
| **F6** | Shot prompt 三分：`imagePrompt` / `videoPrompt` / `endFramePrompt` | Shot schema + `video-gen.js` | 中 |
| **F7** | Scene 增加视角变体标识（**复用既有 `parentId`**，另加 `viewpointId`） | film-manifest schema | 中 |

**F5 详细设计**：
```javascript
// Shot schema 增加
{ ..., "locked": false }
// 重跑分镜 / 导演审核时：if (shot.locked) continue
// UI：分镜卡片加锁图标（参考 ai-art-engine 交互）
```

**F6 详细设计 + 存量数据兼容方案（回答 b4，v3 补充）**：

⚠️ **这是初稿提出却未回答的问题**，实测后补充：

| 事实 | 证据 |
|---|---|
| 存量 `shot-library.json` 是 **153 条**，每条**只有单一 `prompt`** | 实测 |
| 无 `imagePrompt`/`locked` 等新字段 | 实测 |
| `kit-loader.js` 是 **fail-closed**：任一 kit 文件 schema 非法 → 整体 `FILM_KIT_UNAVAILABLE` | `kit-loader.js:13-14` |
| `FILM_PROMPT_MAX_LEN = 50000` 的单字段口径 | `kit-loader.js:24` |

**兼容方案（三选一，推荐①）**：

1. **① 加载时归一化（推荐）**：在 `loadFilmKit()` 内一次性补全 —— `imagePrompt ??= prompt; videoPrompt ??= prompt; endFramePrompt ??= ''`。存量数据**零改动**，新字段对下游恒非空。**改一处即可，下游无分支**。
2. ② 保持可选 + 下游 `??` 兜底：会在 N 个消费点重复实现，且遗漏即静默降级。
3. ③ 迁移存量 153 条数据：需重写 kit 文件并重新走 fail-closed 校验，**风险最高（改坏即整个影视工程不可用）**，不推荐。

**同时必须处理的连带项**：
- `kit-loader.js:24` 的 `FILM_PROMPT_MAX_LEN=50000` 需明确三字段口径（是各 50000 还是合计 50000）。
- `video-gen.js` 的 `costCheck` 逐镜口径需同步（成本预估基于哪个 prompt）。

**F7 修正（实测）**：film-manifest 的 Scene **已有 `parentId`**（`kit-loader.js:72-83` 含树校验 + 无环校验，162 处使用）。故**不应引入同义的 `parentSceneId` 造成两个真相源**，而应**复用 `parentId`**，仅新增 `viewpointId` 表达视角变体。

#### 批次三：算法与工程机制

| ID | 内容 | 落点 | 工作量 |
|---|---|---|---|
| **F8** | ASR 词级 sidecar + `srt_sha256` 失效机制 | `packages/audio-aligner/aligner/` | 小 |
| **F9** | 文本快照 `expectedRevision` 乐观锁 | `auto-project.js` | 小 |
| **F10** | 剪映多轨道草稿生成（**需 spike 验证**） | 新建 `packages/jianying-draft/` | **大** |
| **F11** | B 站字幕多路回退下载 | `packages/collection-engine/` | 小 |
| ~~F8b~~ | ~~adelay + amix 音画同步~~ | — | **已降格**（见下） |
| **F8c** | 三态时长对齐（pad/trim/容差 0.3s）— **需 tpad，受滤镜白名单约束** | `packages/audio-aligner/aligner/` | 中 |
| **F8d** | 两遍 loudnorm + BGM ducking — **需 loudnorm，受滤镜白名单约束** | `packages/audio-aligner/aligner/loudness.py` | **大（混合 PR）** |
| **F11b** | 出站媒体 SSRF 防护（私网段+DoH） | `shared-utils/src/net/safe-fetch.js` | 小 |
| **F11c** | 就绪度闸门（**内联进既有 costCheck，非新增第二道闸**） | `story2video-engine/src/shotReadiness.ts` | 小 |
| **F11d** | 外部工具体检（**复用既有体检面**） | `python-backend/src/multi_publish/core/doctor.py` | 小 |

> ⚠️ **F8d/F8c 的滤镜白名单硬墙（实测，v3 修正）**：见本章第一梯队表的说明。`loudnorm`/`tpad` 不在 `REQUIRED_FILTERS` 内，引入需走混合 PR（改 `media-tools-lock.json` + before-pack 校验 + 重打包实测）。初稿把这两项标「小」是错的。
>
> ⚠️ **F11c 与既有成本闸的关系（实测）**：`video-gen.js:280-286` **已有** `cost_confirmation` 闸（零 provider 调用 + `costCheck` 逐镜清单）。故 F11c **应内联进 `costCheck.shots[].ready`**，而非新增第二道 checkpoint —— 否则用户会被拦两次。
>
> ⚠️ **F11d 落点修正（实测）**：`packages/python-backend/app/` 不存在（真实根 `src/multi_publish/`）。修正为 `src/multi_publish/core/doctor.py`。且**必须先复用既有体检面**（`server.py:941`、`audio_probe.py:74-77`、各 tool 的 `dependencies=['cmd:ffmpeg']`），避免造第二套；硬钉 ffmpeg ≥7.1.1 会误判大量环境，建议只做存在性校验。
>
> ⚠️ **F10 工作量上调**：闭源草稿格式需实测多个剪映版本，非照抄代码即可跑通。增加**前置 spike**：先用 ZJT `jianying/` 子库在目标剪映版本实际生成并打开，通过后才移植。

**F10 详细设计**（复用 ZJT/jianying，Apache-2.0）：
```
packages/jianying-draft/
├── src/
│   ├── core.js            # 多轨道草稿核心（draft_id、素材路径）
│   ├── draft-generator.js # 生成 draft_content.json + draft_meta_info.json
│   ├── media-utils.js     # 媒体时长获取（ffprobe）
│   └── config.js          # 剪映草稿目录配置
├── SCHEMA.md
└── index.js
```
关键约束（来自 `ZJT/jianying/src/draft_generator.py:282`）：
> `scale = 1.0` 是剪映默认适配基准，**切勿**按「画布/素材尺寸比例」计算后写入 —— 剪映会在该基准上叠加，导致过度放大、画面双向溢出只看到中间。

**⚠️ F8b 适用性自查修正（重要）**：

初稿把 F8b（showvi 的 adelay+amix 音画同步）列为「直接落地」，但**复核 mulpub 现有实现后发现该问题在当前链路不存在**：

`apps/desktop/electron/services/film-engineering/film-render.js:308` 实际用的是 **concat demuxer 直拷**：
```javascript
await tool(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalPath])
```
且 `film-render.js:10-11` 明确：「全部片段编解码规格一致 → concat demuxer -c copy 零重编码直拷；不一致 → 仅做最小 scale+pad 归一」；`:12` 注明**无转场/调色/字幕/音轨处理**。

**结论**：mulpub 当前**不使用 xfade**，因此 `acrossfade` 无 offset 导致的音画不同步问题**在现有链路不成立**。F8b 的正确定位应修正为：

| 原定位 | 修正后定位 |
|---|---|
| 修现有 bug（直接落地） | **未来引入转场时的前置知识**——若后续版本要加 xfade 转场（这是合理的演进方向），则必须同时采用 adelay+amix，否则必然音画不同步 |

修正后的价值：**不是修 bug，是避免未来引入 bug**。这是本报告自我修正的一处，保留原始记录以示取证诚实。

同理，**F8c（Pixelle 三态时长对齐）需重新审视**：mulpub 单镜时长硬编码 5/8/10 秒且合成走 concat 直拷，音画对齐压力本就小于「先生成固定时长视频再配音」的链路。F8c 的适用场景是**未来引入 TTS 配音轨时**（届时视频时长与音频时长会出现差值），而非当下。

#### 批次四：智能化增强（需重写，不抄 GPL 代码）

| ID | 内容 | 落点 | 工作量 |
|---|---|---|---|
| **F12-0** | **前置：接入 VLM 适配器**（F12 的依赖，不可跳过） | `adapters/_base/base.js` KNOWN_METHODS | 中 |
| **F12** | VLM 质检闭环（**受成本闸约束 + 重试上限**） | `video-gen.js` 后增 QC 阶段 | 中 |
| **F13** | 按场次并发（**现状实为批内并发 2**，方向是场间提并发） | `production-driver.js` | 中 |
| **F14** | 跨集 Series Bible（角色/场景名录扇出） | film-kit `cast` 资产 | 大 |
| **F15** | 角色身份锚点 + 参考图优先级（**按其结构自行撰写**） | `story2video-engine/src/identity-anchor.ts` | 小 |
| **F16** | 组级多镜头提示词 + 限额校验（**按其结构自行撰写**） | `story2video-engine/src/group-prompt.ts` | 中 |
| **F17** | 时长控制算法（台词锚定 + 双向归一）**需署名 ZJT** | `story2video-engine/src/duration/` | 中 |
| **F18** | 分片渲染 parts.txt + 三级时长回退 | `story2video-engine/src/partsTimeline.ts` | 小 |
| **F19** | checkpoint + history_id 只轮询不重提交 | `story2video-engine` 任务队列 | 中 |

> 🔴 **F12 的两处硬约束（v3，评审实测）**：
> 1. **会绕过成本闸 = 未授权扣费**。实测 `video-gen.js:279-286` 的成本闸契约**由测试锁死**（`film-video-checkpoint-integration.test.js:140-172`「任何恢复路径都须重过闸」）。而 F12 的 Rewrite→Retry 是**系统自动发起的新计费调用**，不在用户确认过的批次内。
>    ✅ 处置：F12 必须满足 —— ① 自动重试**次数上限**（建议 ≤2）；② 重试产生的额外调用**必须计入或重过成本闸**；③ 默认关闭，开启需用户显式确认预算。初稿只写「默认关闭」，**零提及成本闸，且无重试上限**，是重大疏漏。
> 2. **依赖的 VLM 适配器不存在**。实测 `adapters/_base/base.js:37-50` 的 `KNOWN_METHODS` **无任何视觉方法**（无 vision/analyzeImage/vlmCritique），而 `capabilities()` 正是 `KNOWN_METHODS.filter(...)` ⇒ `getAdaptersByCapability` **筛不出 VLM 适配器**。
>    ✅ 处置：拆出 **F12-0「接入 VLM 适配器」**作为前置任务，未完成则 F12 不可开工。
>
> ⚠️ **F15/F16 落点修正（实测）**：`packages/story2video-engine/src/` 下 18 个 `.ts` **平铺，无 `prompt/` 子目录**。落点改为 `src/identity-anchor.ts` / `src/group-prompt.ts`（与既有平铺约定一致）。且措辞从「重抄提示词」改为「**按其结构自行撰写**」。
>
> ⚠️ **F17 署名义务**：ZJT 是修改版 Apache-2.0，复用其时长算法必须在 NOTICE/About 页声明 "Based on 智剧通 (ZJT)"。Apache-2.0 §4(b) 还要求对**修改过的文件注明更改**——若重写实现，建议保留来源注释；署名是否及于「算法思路」存疑，采取保守策略（见 6.x）。

### 5.3 实施顺序与依赖

```
批次一（数据资产，零风险）
  F1 → F2 → F3 → F4
    ↓
批次二（schema 增强，需改 IPC 契约）
  F5 → F6 → F7
    ↓
批次三（算法与工程机制）
  F8 → F9 → F10 → F11
    ↓
批次四（智能化，依赖前两批稳定）
  F12 → F13 → F14
```

**依赖关系**：
- F2 依赖 F1（时长公式来自 01 号 skill 规则）
- F6 依赖 F3（三分 prompt 需要镜头语言词汇）
- F12 依赖 F6（质检需要分别评审首帧与视频）
- F14 依赖 F7（Series Bible 需要场景变体概念）

### 5.4 验收标准

每个 F 必须满足：

1. **TDD**：代码类 F 先写测试（RED → GREEN）；数据资产类 F 跳过 TDD 但必须有 schema 校验测试
2. **i18n**：用户可见文案 zh/en 成对（CI Gate 7 拦截）；**Python 侧另有 CJK 基线**（`check-locale-sync.js` 的 `locale-py-cjk-baseline.json`），涉及 Python 文案的 F 需同步
3. **IPC 契约**：新增通道必须 `withSenderCheck` + 入参校验，加入 PUBLIC_CHANNELS
4. **文档同步**：CHANGELOG + README + 相应 PRD 更新
5. **打包验证**：涉及 Electron 主进程的必须跑 QM-1
6. **⚠️ ffmpeg 滤镜白名单（v3 新增，最高优先级排查项）**：凡引入新 ffmpeg 滤镜/编码器，先查 `apps/desktop/scripts/stage-media-tools.js:10-22` 的 `REQUIRED_FILTERS`。不在清单内 → **按混合 PR 排期**（改 `media-tools-lock.json` + before-pack 校验 + 重打包实测），**不得标「小」**
7. **⚠️ kit 资产登记（v3 新增）**：新增 film-kit 资产必须同步改 `kit-loader.js:20` 的 `KIT_FILES`，否则**静默不生效**
8. **⚠️ 落点目录/语言（v3 新增）**：落点需实测父目录存在 + 包语言匹配（`shared-utils` 纯 JS / `audio-aligner` 纯 Python / `python-backend` 根为 `src/multi_publish/`）

### 5.5 防膨胀硬约束（v3 新增）

> 🔴 **先自省**：本报告批评 novelvids 的 `ShortDramaStoryboardPage.vue` 达 124KB、ai-art-engine 的 `NodeGraphEditor.vue` 达 338KB、moyin 的 `split-scenes.tsx` 达 4066 行。**但本仓 `apps/desktop/src/views/CreateView.vue` 实测 308,964B，比 novelvids 那一个还大 2.5 倍。** 批评别人之前必须先承认自己更严重。
>
> 且本仓已有实证：「写进记忆、文档与提交信息**都没能阻止第 5 次**同类问题」（AGENTS.md 删除守卫铁律 R0）。**因此「单文件 ≤500 行」这类写在文档里的约束是无效的**，必须机械拦截。

1. **prompt 文本一律外置**为 `.md`/`.json`（套用已有 `film-kit/prompt-doctrine.json` 模式），禁止内联进代码。
2. **机械契约锁**：新增门禁脚本（如 `scripts/check-file-size-gate.js`）对新增/修改文件做行数/字节数断言，**接线进不被 docs-only 短路的 CI job**（参照 AGENTS.md「前提锁」：白名单内的数据文件，其校验必须挂在不被短路的 job，否则等于给自己关掉校验）。
3. **外置 prompt 同样走 kit-loader 的 fail-closed 校验**，且必须同步改 `KIT_FILES`。

---

## 六、风险与反模式清单

### 6.1 许可证风险（最高优先级）

| 风险 | 影响 | 缓解 |
|---|---|---|
| 误将 GPL/AGPL 代码复制进 mulpub | **法律传染**：衍生作品必须开源 | 第二梯队所有 GPL/AGPL 来源项已标注「仅思路」，实施时必须重写 |
| 误将 NC 许可证项目用于商业产品 | 违约 | app.yumcut.com / novelvids / huobao-drama 为 NC 类，**商用前须确认**；科研非商用场景已解锁 |
| 误将 SA/copyleft 代码并入闭源衍生作品 | 传染 | huobao-drama(SA) / ai-art-engine(GPL) / moyin-creator(AGPL) —— **与是否商用无关**，闭源即违规 |
| 复制代码未保留版权声明 | 违反 MIT/Apache 要求 | 复用文件头部必须保留原 LICENSE 与版权声明 |

### 6.2 技术风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| F6 三分 prompt 破坏现有 Shot 契约 | 现有 153 镜 kit 数据不兼容 | 向后兼容：`prompt` 保留，三分字段可选；加载时 `prompt ?? imagePrompt` |
| F10 剪映草稿与剪映版本不兼容 | 生成的草稿打不开 | 需实测目标剪映版本；`scale=1.0` 铁律必须遵守 |
| F12 VLM 质检增加成本 | 每次生成多一次 VLM 调用 | 设为可选开关，默认关闭；仅在「高质量模式」启用 |
| F13 场次并发导致末帧传递错乱 | 同场次空间连续性丢失 | 场内必须串行，仅场间并行（ai-art-engine 已验证） |
| 新增资产破坏 film-kit fail-closed | 整个影视工程不可用 | 新资产必须走 kit-loader 校验，任一失败即 `FILM_KIT_UNAVAILABLE` |

### 6.3 反模式（本次调研观察到别人踩过的坑）

1. **剪映 scale 算错**（ZJT 注释）：按「画布/素材比例」计算 → 画面只看到中间。正解 `scale=1.0`。
2. **Vue reactive proxy 过 IPC**（ai-art-engine `CHANGELOG.md:40`）：`An object could not be cloned.` 导致 4 分半生成的镜头全丢。**mulpub 的 AGENTS.md 已记载此坑**（IPC 参数必须 `JSON.parse(JSON.stringify())` 脱壳）。
3. **视频时长档位硬编码**（ai-art-engine `CHANGELOG.md:41`）：上游返回 1s/2s，而模型支持 4-15s → 9 镜里 6 镜被打回。正解：运行期解析具体模型档位。
4. **SRT 编辑后 ASR 时间戳陈旧**（autoclip `word_timing.py:72`）：正解 `srt_sha256` 绑定 sidecar。
5. **并发写入覆盖**（Toonflow `workspaceFiles.ts:109`）：正解 `expectedRevision` 乐观锁。

---

## 七、结论

### 7.1 核心结论

1. **19 个项目中，12 个可安全复用代码**（MIT 5 + Apache-2.0 5 + 修改版 Apache 1 + Elastic 2.0 桌面端可用 1）。3 个是 NC 类（科研非商用可解禁），3 个含 SA/copyleft 传染，**1 个完全没有许可证（最严格）**。**许可证检查不是形式主义 —— 它直接改变了本次调研的复用路径**。深度核实后有三个重要修正：ZJT 的「修改版 Apache」只需署名即可用；waoowaoo 的 Elastic 2.0 三条限制都不是「禁止商用」（禁的是托管服务与移除 license key）；smy 的「无 LICENSE」= 版权保留，比 copyleft 更严。

2. **最高性价比的复用不是代码，是 Prompt 资产**。`short-drama-skills`（MIT）是 LuxReal 内部生产流水线核心规则，上万创作者验证过；**v2 新增的 `FireRed-OpenStoryline` 提供了这套资产的「工程化组织形态」** —— `prompts/tasks/<task>/{zh,en}/{system,user}.md`，目录即契约、中英强制成对、加载器仅 100 行。两者组合才是完整答案：**内容是 short-drama-skills 的，结构是 FireRed 的**。

3. **一条交叉验证的硬规则**：novelvids（`storyboard_system.md:25`）与 short-drama-skills（`prompt.zh-CN.md:99`）**两个独立团队得出完全相同的结论** —— 「禁止代词、必须在每个动作段重复完整实体名」。**v2 又出现第三个证据**：FireRed 的 `speech_rough_cut` 与 smy 的「尾帧说明」也都要求**每次重复完整实体/画面描述**而非指代。三个不同形态的项目收敛到同一约束，**建议 mulpub 直接采纳为硬性规则并写入渲染器校验**。

4. **mulpub 影视工程的主要差距不在「生成」，在「工程化控制」**：单镜锁定、指纹缓存、按场次并发、VLM 质检闭环、就绪度闸门 —— 这些业界都已实现，mulpub 需重写（GPL 来源）或直接搬（MIT/Apache 来源）。**v2 的一个重要反向发现**：原以为「原片自动切分」是缺口，实测 **mulpub 已有 `SceneDetect`（PySceneDetect + ffmpeg 回退，282 行）**，故 TransNetV2 项被删除 —— 这条错误若不做实测会直接进实施批次，印证了「先查目标仓」的纪律。

5. **audio-aligner 是本次调研最大的单点受益包**。三个独立项目给出了互补方案：Pixelle-Video 的三态时长对齐（Apache）、showvi 的 adelay+amix 音画同步（MIT）、waoowaoo 的两遍 loudnorm + BGM ducking（Elastic 桌面端可用）。这三项几乎可以原样搬入，直接根治「音画不同步」「静音误判」「响度不达标」三类问题。

6. **ZJT 的剪映草稿生成库是被低估的资产**（修改版 Apache，需署名）。它打通了「AI 成片 → 剪映精修」最后一公里，是专业剪辑师的刚需入口，且 mulpub 作为发布工具天然需要这个出口。

7. **合成环节是三个项目的共同缺口**：Jellyfish 无 ffmpeg/时间线（只到生成镜头），BigBanana 的 CutOS 闭源，yumcut 的分片合成不可商用。**mulpub 的 `remotion-composer` + `story2video-engine/slideshow.ts` 必须自己补强** —— 这是差异化环节，不应寻找外部复用。**v2 补充**：FireRed 的 `render_video.py`（1023 行）+ `plan_timeline.py`（907 行）是目前唯一一个**把「时间线编排 + 渲染」都做完整**的开源实现，可作为自研合成层的**结构参考**（Apache-2.0 允许参考甚至借鉴代码）。

8. **v2 新增项目印证了一个生态判断**：19 个项目里**只有 1 个是生成模型**（ToonCrafter），其余 18 个都是「流程编排 + 提示词工程」。说明这个生态当前的价值集中点不在底层生成能力，而在**如何把已有模型编排成可用的生产线** —— 这与 mulpub 的定位一致，也解释了为什么「Prompt 资产」和「工程控制机制」的复用价值高于「模型」。

### 7.2 一句话总结

```
mulpub 影视工程 = 《Hell Grind》工程方法（已有）
                + LuxReal 分镜 Prompt 规则（F1，直接拿）
                + FireRed 的 prompt 组织形态（F30，直接拿）★v2
                + FireRed 的 AI 转场介质掩护经验（F31，直接拿）★v2
                + Jellyfish 数据地基（Shot 模型 + 枚举 + 就绪度闸门，直接拿）
                + audio-aligner 三件套（F8c/F8d，直接拿）
                + 剪映草稿导出（F10，直接拿，需署名 ZJT）
                + ai-art-engine / moyin 的工程控制机制（F5/F12/F13/F15/F16，重写不抄）
                = 从「能出片」升级为「可控、可复现、可交付剪辑师」的工业流水线
```

> **v2 删掉了一项**：TransNetV2 镜头边界检测（F32）。原因是实测发现 mulpub 已有 `SceneDetect`/PySceneDetect —— **不是所有「看起来缺的能力」都真的缺**。

### 7.3 下一步

审核产物落 `<REPO_ROOT>/.adversarial/ai-film-research-2026-10-19\`（该目录被 gitignore，公开记录见「审核记录」文档）。

---

## 附录 A：文档导航（f9 修订项）

`01-docs/` 下影视工程相关文档已达 10 份，按阅读场景导航：

| 场景 | 读这份 |
|---|---|
| **想了解架构** | `ARCH-FILM-ENGINEERING-2026-08-14.md` |
| **想提需求/看功能规划** | `PRD-FILM-ENGINEERING-CANVAS-2026-09-24.md` / `PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md` / `PRD-FILM-AUTO-MODE-2026-10-09.md` |
| **想使用功能** | `USER-MANUAL-FILM-ENGINEERING-COMPLETE-2026-10-19.md`（最新完整版） |
| **想运维/排障** | `FILM-ENGINEERING-PIPELINE-OPERATIONS-2026-10-09.md` |
| **想看竞品调研与落地方案** | **本文件** + `RESEARCH-AI-FILM-REVIEW-2026-10-19.md`（审核记录） |
| **已知 bug / 排查结论** | `BUGFIX-FILM-ENGINEERING-FINDINGS-2026-10-19.md` |

**建议阅读顺序**（新接手 agent）：架构 → 最新使用手册 → 本调研报告 → 审核记录。

---

## 附录 B：克隆位置与复现命令

```bash
# 所有项目已克隆至本机临时目录（--depth 1）
# 目录路径按本机自行指定，下文以 $AI_FILM_RESEARCH_DIR 代称
$AI_FILM_RESEARCH_DIR/
├── ZJT/ waoowaoo/ huobao-drama/ moyin-creator/
├── Toonflow-app/ Jellyfish/ BigBanana-AI-Director/ app.yumcut.com/
├── FastMovieAI/ ai-art-engine/ showvi/ Pixelle-Video/
├── novelvids/ autoclip/ short-drama-skills/ short-drama/
└── ★v2 新增：FireRed-OpenStoryline/ smy-seedance-storyboard/ ToonCrafter/

# 复现命令（替换 $AI_FILM_RESEARCH_DIR 为本机实际路径）
mkdir -p "$AI_FILM_RESEARCH_DIR" && cd "$AI_FILM_RESEARCH_DIR"
for r in jeffstric/ZJT waooAI/waoowaoo chatfire-AI/huobao-drama MemeCalculate/moyin-creator \
         HBAI-Ltd/Toonflow-app Forget-C/Jellyfish shuyu-labs/BigBanana-AI-Director \
         IgorShadurin/app.yumcut.com xhadmincn/FastMovieAI Justin-sky/ai-art-engine \
         sjtuplayer/showvi ATH-MaaS/Pixelle-Video Anning01/novelvids zhouxiaoka/autoclip \
         YvonneMovingon/short-drama-skills 0xsline/short-drama \
         FireRedTeam/FireRed-OpenStoryline liangdabiao/smy-seedance-storyboard \
         Doubiiu/ToonCrafter; do
  git clone --depth 1 https://github.com/$r
done
```

## 附录 C：许可证核实方法

```powershell
# 逐仓读取 LICENSE 前 5 行判定
foreach($d in (Get-ChildItem $AI_FILM_RESEARCH_DIR -Directory)){
  $lic = Get-ChildItem $d.FullName -Filter "LICENSE*" -File | Select-Object -First 1
  if($lic){ Get-Content $lic.FullName -TotalCount 5 }
  else {
    # ⚠️ 无 LICENSE 文件 ≠ 开源：默认版权保留（All Rights Reserved）
    Write-Host "[无许可证] $($d.Name) —— 默认版权保留，不可复制" -ForegroundColor Red
    # 再确认 README/SKILL 里是否另有声明
    Get-ChildItem $d.FullName -Filter "*.md" -File |
      Select-String -Pattern "license|licence|copyright|版权|授权|许可" |
      Select-Object -First 3
  }
}
```

判定关键词：`MIT License` / `Apache License` / `GNU GENERAL PUBLIC`（GPL）/ `GNU AFFERO`（AGPL）/ `PolyForm Noncommercial` / `Attribution-NonCommercial`（CC BY-NC）/ `Elastic License`。

> 🔴 **本轮最重要的取证纪律（v2 新增）**：**第一步就检查 LICENSE 文件是否存在，而不是看 README 的 license 徽章**。
> `smy-seedance-storyboard` 的 README 连徽章都没有，极易被误判成「没写就是开源」。实际是**全部权利保留** —— 比任何 copyleft 都严格，因为它连「授权使用」这件事本身都没发生。
