# AI 影视创作开源项目深度研究报告与落地实施方案

> **日期**：2026-10-19 ｜ **状态**：研究完成，待实施
> **调研对象**：16 个 AI 影视创作开源项目（已克隆至本机临时目录 `<AI_FILM_RESEARCH_DIR>`；`--depth 1`。实际路径按本机自行指定，见附录 B）
> **目标项目**：mulpub / Multi-Publish（`<REPO_ROOT>`，即本仓库根）
> **取证口径**：所有结论均基于实际克隆源码，标注 `仓库相对路径:行号`；许可证逐仓核实 LICENSE 文件前若干行；未读到的功能明确标注「未确认」，不推测。

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

## 一、总览：16 个项目全景

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

### 1.2 形态四分类

按**工程形态**划分，这决定了复用方式根本不同：

```
16 个项目
├── A. 完整工程流水线（8 个）
│   ZJT / waoowaoo / huobao-drama / moyin-creator / Toonflow / Jellyfish
│   FastMovieAI / novelvids / Pixelle-Video / autoclip / ai-art-engine / showvi
│   → 复用「架构思路 + 数据结构 + 算法」，不复制代码（许可证多受限）
│
├── B. 闭源/半成品（2 个）
│   BigBanana-AI-Director（仅文档+截图）/ app.yumcut.com（PolyForm NC）
│   → 只可参考产品形态与交互设计
│
├── C. Prompt / 剧作知识资产（2 个）★ 最高性价比
│   short-drama-skills（MIT）/ short-drama（MIT）
│   → 可直接集成到 mulpub 的 ai-writer / 剧本套用引擎
│
└── D. 专项能力库（1 个）★ 高价值
    ZJT/jianying —— 剪映多轨道草稿生成库（Apache-2.0）
    → 可直接复用于 mulpub 的发布链路
```

---

## 二、许可证合规矩阵（前置结论）

> ⚠️ **这是本章最重要的部分**：mulpub 是**商业闭源**项目（虽开源在 GitHub，但定位是商业产品）。因此**任何 copyleft 或禁止商用的许可证代码都不得复制进 mulpub**。

### 2.1 逐仓核实结果

| 许可证 | 项目 | 商用 | 修改 | 分发 | 对 mulpub 的结论 |
|---|---|---|---|---|---|
| **Apache-2.0** | Jellyfish, FastMovieAI, Pixelle-Video | ✅ | ✅ | ✅ | ✅ **可安全复用**（需保留 NOTICE） |
| **修改版 Apache-2.0** | **ZJT** | ✅ | ✅ | ✅ | 🟡 **可用但须署名**：① 必须保留 LOGO 与版权署名，显著位置展示「智剧通（ZJT）」，不得声称独立原创；② 禁止用其源码运营多工作区 SaaS（mulpub 为单用户桌面端，**不触发**）；③ 禁止逆向企业版授权校验（不碰即不触发）。**结论：需在 NOTICE/About 页声明 "Based on 智剧通 (ZJT)"** |
| **MIT** | Toonflow-app, showvi, autoclip, short-drama-skills, short-drama | ✅ | ✅ | ✅ | ✅ **可安全复用**（需保留版权声明） |
| **Elastic License 2.0** | waoowaoo | ⚠️ | ⚠️ | ⚠️ | 🟢 **桌面端实际可用**：三条限制①不得作为托管/管理服务提供给第三方 ②不得规避 license key 功能 ③不得移除被 license key 保护的功能。**mulpub 是本地桌面端、用户自装自用，不构成「向第三方提供托管服务」，不触发**。且是唯一与 mulpub 同为 TypeScript 栈的项目，抽取成本最低 |
| **GPL** | ai-art-engine | ✅ | ✅ | ✅ | ⚠️ **Copyleft**：衍生作品必须开源。**不可复制代码，仅可参考思路** |
| **AGPL** | moyin-creator | ✅ | ✅ | ✅ | ⚠️ **强 Copyleft**：网络使用也视为分发。**不可复制代码** |
| **Elastic License 2.0** | waoowaoo | ❌ | ⚠️ | ❌ | 🚫 **禁止商用**：不得作为托管服务提供、不得绕过付费功能<br>🟢 **但科研项目非商用 + 桌面端自用 → 可用**（详见 2.2 决策树） |
| **PolyForm Noncommercial 1.0.0** | app.yumcut.com | ❌ | ❌ | ❌ | 🚫 **禁止商用** |
| **CC BY-NC-SA 4.0** | huobao-drama | ❌ | ✅ | ❌ | 🚫 **禁止商用 + SA 传染** |
| **CC BY-NC 4.0** | novelvids | ❌ | ✅ | ❌ | 🚫 **禁止商用** |
| **BigBanana Community License 1.0** | BigBanana-AI-Director | 需确认 | 需确认 | 需确认 | ⚠️ **自定义社区版**，且无源码可复用 |

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
├─ 许可证只含 NC（app.yumcut.com / novelvids）
│   → 科研非商用 ✅ 直接用，记得署名（CC 系需 Attribution）
├─ 许可证含 SA 或 copyleft（huobao-drama / ai-art-engine / moyin-creator）
│   → 问自己：我的项目会开源吗？
│      ├─ 会开源（且能接受同协议）→ ✅ 可复制代码
│      └─ 要闭源             → ❌ 仍只能参考思路 + 重写
└─ 许可证为 MIT / Apache / Elastic
    → ✅ 直接用（Elastic 别做成托管服务；ZJT 记得署名）
```

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

> 🔴 **F1 重大修正（v3，评审实测发现）**：初稿主张新建 `film-kit/prompt-skills/`。**复核发现 mulpub 已有同类的完整提示词方法论资产**：
> - `apps/desktop/electron/film-kit/prompt-doctrine.json` —— **7 blocks**（SCENE CONTEXT / GEO SPATIAL LAYOUT / ACTION TIMING / AUDIO / CHARACTER ACTING / STYLE / POSITIVE CONSTRAINTS）+ **10 rules** + **6 glossary**，中英双语（`zh`/`en` 双字段）
> - `film-kit/prompt-doctrine.zh.md` —— 方法论完整中文版
> - **已完整接线**：UI 方法论标签页绑定，且 `BUGFIX-FILM-ENGINEERING-FINDINGS-2026-10-19.md:302-308` 已建同源锁测试
>
> ⚠️ **后果**：若新建 `prompt-skills/`，会造出**第二套并存的提示词规范**，两处口径必然漂移。
>
> ✅ **正确做法**：把 short-drama-skills 的**增量规则**（长台词 7 手法 T1-T7、动作戏 17 条、时长估算公式、视觉描述四维度禁代词）**并入既有 `prompt-doctrine.json` 的 blocks/rules**，复用其已有的 UI 绑定与同源锁测试。工作量由「小」调整为「中」（需做增量合并 + 回归）。

**原设计的保留部分**（仅作参考，实际不新建目录）：
```
electron/film-kit/prompt-skills/   ← ❌ 不采用，改为扩展 prompt-doctrine.json
```
| **F2** | 单镜时长计算公式（正常/争吵/深情） | `auto-plan.js` + `auto-constants.js` | 小 |
| **F3** | 镜头语言枚举（景别/运镜/机位/VFX） | `film-kit/shot-grammar.json` + Shot schema | 中 |
| **F4** | 剧本合规审核清单 | `film-kit/compliance-checklist.json` | 小 |
| **F3b** | 模型能力外置目录 + CI 校验 | `shared-utils/src/model-capabilities/` | 小 |
| **F6b** | 首/尾/关键帧 21 条强约束 prompt | `story2video-engine/src/prompts/shotFrame.md` | 小 |

**F1 详细设计**：
```
electron/film-kit/prompt-skills/
├── manifest.json           # 7 条 skill 的元信息（id/name/zh/en/适用阶段）
├── 01-narrative-breakdown.json   # 通用叙事拆解（含时长估算公式）
├── 02-emotion.json               # 深度情绪刻画
├── 03-action.json                # 详细动态描述（17 条规则）
├── 04-episode-split.json         # 按剧情连贯拆分副本
├── 05-prompt-polish.json         # 单视频提示词润色
├── 06-high-energy.json           # 高能戏剧化
└── 07-slow-pace.json             # 慢节奏细腻质感
```
校验规则（fail-closed，与现有 kit-loader 同构）：
- `manifest.json` 必须存在且 `schemaVersion === 1`
- 每条 skill 必须有 `id`（枚举）、`name`、`systemPrompt`（非空 ≤50000）
- 引用不存在的 skill id 即失败

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

1. **16 个项目中，10 个可安全复用代码**（MIT 5 个 + Apache-2.0 3 个 + 修改版 Apache 1 个 + Elastic 2.0 桌面端可用 1 个）。4 个项目许可证禁止商用，2 个是 copyleft。**许可证检查不是形式主义 —— 它直接改变了本次调研的复用路径**。但深度核实后有两个重要修正：ZJT 的「修改版 Apache」只需署名即可用，waoowaoo 的 Elastic 2.0 对桌面端不触发 —— 这比我最初的判断宽松，也让这两个项目从「禁区」回到「可用」。

2. **最高性价比的复用不是代码，是 Prompt 资产**。`short-drama-skills`（MIT）是 LuxReal 内部生产流水线核心规则，上万创作者验证过，直接补上 mulpub「LLM 润色恒不生效」的缺口，且**做成 JSON 数据资产零运行时风险**。

3. **一条交叉验证的硬规则**：novelvids（`storyboard_system.md:25`）与 short-drama-skills（`prompt.zh-CN.md:99`）**两个独立团队得出完全相同的结论** —— 「禁止代词、必须在每个动作段重复完整实体名」。两个不同形态的项目收敛到同一约束，说明这是视频生成 prompt 的关键约束，**建议 mulpub 直接采纳为硬性规则并写入渲染器校验**。

4. **mulpub 影视工程的主要差距不在「生成」，在「工程化控制」**：单镜锁定、指纹缓存、按场次并发、VLM 质检闭环、就绪度闸门 —— 这些业界都已实现，mulpub 需重写（GPL 来源）或直接搬（MIT/Apache 来源）。

5. **audio-aligner 是本次调研最大的单点受益包**。三个独立项目给出了互补方案：Pixelle-Video 的三态时长对齐（Apache）、showvi 的 adelay+amix 音画同步（MIT）、waoowaoo 的两遍 loudnorm + BGM ducking（Elastic 桌面端可用）。这三项几乎可以原样搬入，直接根治「音画不同步」「静音误判」「响度不达标」三类问题。

6. **ZJT 的剪映草稿生成库是被低估的资产**（修改版 Apache，需署名）。它打通了「AI 成片 → 剪映精修」最后一公里，是专业剪辑师的刚需入口，且 mulpub 作为发布工具天然需要这个出口。

7. **合成环节是三个项目的共同缺口**：Jellyfish 无 ffmpeg/时间线（只到生成镜头），BigBanana 的 CutOS 闭源，yumcut 的分片合成不可商用。**mulpub 的 `remotion-composer` + `story2video-engine/slideshow.ts` 必须自己补强** —— 这是差异化环节，不应寻找外部复用。

### 7.2 一句话总结

```
mulpub 影视工程 = 《Hell Grind》工程方法（已有）
                + LuxReal 分镜 Prompt 规则（F1，直接拿）
                + Jellyfish 数据地基（Shot 模型 + 枚举 + 就绪度闸门，直接拿）
                + audio-aligner 三件套（F8b/F8c/F8d，直接拿）
                + 剪映草稿导出（F10，直接拿，需署名 ZJT）
                + ai-art-engine / moyin 的工程控制机制（F5/F12/F13/F15/F16，重写不抄）
                = 从「能出片」升级为「可控、可复现、可交付剪辑师」的工业流水线
```

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
└── novelvids/ autoclip/ short-drama-skills/ short-drama/

# 复现命令（替换 $AI_FILM_RESEARCH_DIR 为本机实际路径）
mkdir -p "$AI_FILM_RESEARCH_DIR" && cd "$AI_FILM_RESEARCH_DIR"
for r in jeffstric/ZJT waooAI/waoowaoo chatfire-AI/huobao-drama MemeCalculate/moyin-creator \
         HBAI-Ltd/Toonflow-app Forget-C/Jellyfish shuyu-labs/BigBanana-AI-Director \
         IgorShadurin/app.yumcut.com xhadmincn/FastMovieAI Justin-sky/ai-art-engine \
         sjtuplayer/showvi ATH-MaaS/Pixelle-Video Anning01/novelvids zhouxiaoka/autoclip \
         YvonneMovingon/short-drama-skills 0xsline/short-drama; do
  git clone --depth 1 https://github.com/$r
done
```

## 附录 B：许可证核实方法

```powershell
# 逐仓读取 LICENSE 前 5 行判定
foreach($d in (Get-ChildItem $AI_FILM_RESEARCH_DIR -Directory)){
  $lic = Get-ChildItem $d.FullName -Filter "LICENSE*" -File | Select-Object -First 1
  if($lic){ Get-Content $lic.FullName -TotalCount 5 }
}
```

判定关键词：`MIT License` / `Apache License` / `GNU GENERAL PUBLIC`（GPL）/ `GNU AFFERO`（AGPL）/ `PolyForm Noncommercial` / `Attribution-NonCommercial`（CC BY-NC）/ `Elastic License`。
