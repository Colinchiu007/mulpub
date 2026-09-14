---
name: github-project-analysis
description: >
  系统性逆向分析竞品（开源项目或商业产品）的技术架构、实现思路和可复用价值。
  支持 4 种输入方式：需求驱动搜索、关键词驱动、文档驱动、URL 直接分析。
  覆盖 GitHub 搜索筛选、架构深度分析、复用评估、报告生成全流程。
version: 2.0.0
tags: [research, competitive-intelligence, architecture-analysis, code-review, github-search]
---

# GitHub 项目分析

## When to Use

- 用户在 GitHub 看到与当前项目类似的产品，想让 AI 分析其架构和技术实现
- 发现有趣的开源项目/工具，评估能否复用到当前项目
- 想了解竞品的技术选型、设计思路、踩坑经验
- 做技术选型时需要横向对比多个方案

## Analysis Objectives

从专业角度分析以下维度：

| 维度 | 分析内容 |
|------|---------|
| **技术栈** | 编程语言、框架、依赖、基础设施 |
| **架构设计** | 模块划分、服务拆分、设计模式、数据流 |
| **核心实现** | 关键算法、核心逻辑、API 设计 |
| **工程实践** | 代码组织、测试策略、CI/CD、文档质量 |
| **复用价值** | 哪些可直接借用、哪些思路可参考、哪些完全不匹配 |

## Workflow

### 1. 确认分析目标与输入方式

支持 4 种输入方式：

| 方式 | 说明 | 示例 |
|------|------|------|
| **方式 1：需求驱动** | 描述需求/功能/技术点，AI 自动生成搜索关键词清单 | "我想做一个多平台内容发布工具" |
| **方式 2：关键词驱动** | 直接提供搜索关键词 | "multi-platform publish, social media scheduler" |
| **方式 3：文档驱动** | 提供包含关键词列表的文档路径 | 提供 .md 文件路径 |
| **方式 4：URL 驱动** | 直接提供 GitHub 项目 URL | `https://github.com/user/repo` |

**关键词生成规则**（方式 1 自动执行）：
- 从需求中提取**核心功能**关键词（如 `multi-platform publish`）
- 从技术实现中提取**技术栈**关键词（如 `electron playwright rpa`）
- 从产品类型中提取**产品分类**关键词（如 `social media scheduler`）
- 包含**中文关键词**（用于搜索中国平台相关项目）
- 生成**组合关键词**（用于精确搜索）

**如果用户只给了产品名称或 URL，先搜索确认准确的 GitHub 仓库。**

### 2. 分类分析对象

**方式 4（URL 驱动）— 直接进入分析：**
```
开源项目 → 直接 clone 源码深度分析
商业产品 → web 逆向 + 文档 + 招聘信息 + 技术博客
混合     → 两者结合
```

**方式 1-3（搜索模式）— 先搜索再分析：**
```
生成关键词清单 → GitHub API 搜索 → 按条件筛选 → 保存项目列表 → 逐个深入分析
```

**GitHub 搜索条件与筛选：**

| 筛选条件 | 默认值 | 说明 |
|----------|--------|------|
| Star 数 | > 100 | 可自定义范围（如 5000-10K） |
| 最近更新 | < 24 个月 | 确保项目仍活跃 |

**搜索执行规则：**
- 使用 GitHub API `search/repositories` 端点搜索
- 每个关键词依次搜索，控制 API 速率限制（每分钟 10 次）
- 同一项目匹配多个关键词时**去重**
- 按 Star 数降序排列
- 生成关键词清单和项目列表并保存为 .md 文件

### 3. 获取信息

**第一步：GitHub API 快速评估（优先于 clone）**

先通过 GitHub API 和 WebFetch 快速评估项目，无需 clone 即可判断是否值得深入分析。

```bash
# 1. 获取项目目录结构
curl -s "https://api.github.com/repos/<user>/<repo>/contents/"

# 2. 获取 README 头 50 行
curl -s "https://raw.githubusercontent.com/<user>/<repo>/main/README.md" | head -50

# 3. 获取关键配置文件
curl -s "https://raw.githubusercontent.com/<user>/<repo>/main/pyproject.toml"
curl -s "https://raw.githubusercontent.com/<user>/<repo>/main/package.json"
```

**速判规则 — 值得 clone 的信号**：
- ⭐≥100 且 最近 commit < 1年 → 值得深入分析
- 目录结构显示有核心业务逻辑（`src/`、`lib/`、`core/` 等）
- 技术栈与当前项目相关（Python/Node.js/Electron 等）
- README 有架构图或清晰的模块说明

**速判规则 — 不值得 clone 的信号**：
- ⭐<100 且 文件<5 且 最近 commit>1年 → 直接给 3-5 句总结不 clone
- 只有配置文件/Doc/Theme 无核心代码
- 拿不准时：curl README 头 20 行 + 看目录结构 → 快速判断

**第二步：许可证检查（必须，不可跳过）**

在深入分析前，必须先检查项目的许可证。这是决定代码能否复用的**法律前提**。

```bash
# 检查 LICENSE 文件
curl -s "https://raw.githubusercontent.com/<user>/<repo>/main/LICENSE" | head -20
```

常见许可证的复用限制：

| 许可证 | 商用 | 修改 | 分发 | 需保留版权 | 备注 |
|--------|------|------|------|-----------|------|
| **MIT** | ✅ | ✅ | ✅ | ✅ | 最宽松，可任意使用 |
| **Apache 2.0** | ✅ | ✅ | ✅ | ✅ | 需保留 NOTICE 文件 |
| **BSD 2/3-Clause** | ✅ | ✅ | ✅ | ✅ | 类似 MIT |
| **GPL v2/v3** | ✅ | ✅ | ✅ | ✅ | **Copyleft**：衍生作品必须开源 |
| **LGPL** | ✅ | ✅ | ✅ | ✅ | 链接可闭源，修改需开源 |
| **AGPL** | ✅ | ✅ | ✅ | ✅ | 网络使用也视为分发 |
| **MPL 2.0** | ✅ | ✅ | ✅ | ✅ | 文件级 Copyleft |
| **无许可证** | ❌ | ❌ | ❌ | — | 默认保留所有权利，不可用 |

**许可证检查结果标记在报告中的独立字段**，并在复用评估中注明许可证限制。

**开源项目（深度分析路径，需 clone）：**
```bash
git clone --depth 1 --filter=blob:none --sparse <repo-url> /tmp/<project-name>
git sparse-checkout set -- cone <key-dirs>
```
关键文件读取优先级：
1. `README.md` / `CONTRIBUTING.md` → 项目定位和架构说明
2. `package.json` / `requirements.txt` / `Cargo.toml` → 依赖和技术栈
3. 顶层目录结构 → 模块划分
4. `src/` / `lib/` / 核心模块 → 核心实现
5. `tests/` → 测试策略
6. `docs/` → 架构文档、API 设计

**商业产品（逆向路径）：**
1. 访问产品官网，截图/分析前端技术（browser_get_images + browser_snapshot）
2. 搜索技术博客、演讲、招聘信息推断技术栈
3. 查看 API 文档（如果有）
4. 搜索 GitHub 上的相关开源组件或 SDK

### 4. 架构深度分析（核心步骤）

按以下结构拆解：

```
├── 技术栈 (Tech Stack)
│   ├── 前端: framework, state management, UI library
│   ├── 后端: language, framework, ORM, message queue
│   ├── 数据库: relational, cache, search, object storage
│   └── 基础设施: hosting, CI/CD, monitoring
│
├── 架构设计 (Architecture)
│   ├── 模块划分: 核心模块、辅助模块、依赖关系
│   ├── 设计模式: 单例/工厂/观察者/策略 等
│   ├── 数据流: 请求→处理→响应的完整链路
│   └── 关键决策: 为什么这么设计，权衡了什么
│
├── 核心实现 (Key Implementations)
│   ├── 关键算法/逻辑: 伪代码或核心函数
│   ├── API 设计: REST/gRPC/GraphQL, 端点设计
│   ├── 配置管理: config 模式, 环境变量, 多环境
│   └── 错误处理: 异常体系, 重试机制
│
├── 服务层分析 (Service Layer) — 适用于 FastAPI/微服务等项目
│   ├── Router 组织: 按资源拆分还是按功能拆分
│   ├── 依赖注入: FastAPI Depends / 手动 DI
│   ├── 服务注册: 插件化/工厂模式/自动发现
│   ├── 中间件链: CORS/鉴权/限流/日志 的组织方式
│   └── 异步任务: 后台任务/Celery/任务队列 的实现
│
├── AI/API 提供商适配层 (Provider Adapter) — 适用于 AI 工具项目
│   ├── Provider 注册: 统一的适配器接口
│   ├── 多模型管理: 供应商切换/回退/并发控制
│   ├── Prompt 管理: 独立文件/Database/模板引擎
│   └── 媒体生成管线: TTS/图像/视频 的编排方式
│
└── 工程实践 (Engineering Practices)
    ├── 代码组织: 目录结构规范
    ├── 测试: 单元测试/E2E 覆盖率, mocking 策略
    └── 文档: README, API docs, 架构图

├── 代码质量评估 (Code Quality)
│   ├── 代码规范: linting, 格式化, 命名一致性
│   ├── 测试覆盖: 覆盖率数据, 测试策略
│   ├── 错误处理: 异常体系, 重试机制, 降级策略
│   ├── 文档质量: README, API 文档, 注释密度
│   └── 性能优化: 基准测试, 内存占用, 响应速度

├── 依赖分析 (Dependency Analysis)
│   ├── 关键依赖: 第三方库名称、版本、许可证
│   ├── 依赖风险: 已知漏洞、维护状态、替代品
│   └── 依赖树: 依赖深度, 冲突风险

├── 安全性评估 (Security Assessment)
│   ├── 认证机制: OAuth/API Key/Session
│   ├── 数据加密: 传输加密, 存储加密
│   ├── 漏洞风险: 已知 CVE, 输入校验
│   └── 依赖安全: 第三方库漏洞情况

├── 维护状态 (Maintenance Status)
│   ├── 提交频率: 最近 commit 日期, 活跃度评级
│   ├── Issue 响应: 响应时间, 关闭率
│   ├── 贡献者: 核心贡献者数量, 社区参与度
│   └── 版本发布: 发布频率, 版本号规范

└── 市场机会 (Market Opportunity) — 适用于竞品分析
    ├── 市场需求: 目标用户痛点, 市场规模
    ├── 竞争格局: 直接竞品, 间接竞品, 市场份额
    ├── 差异化: 可改进方向, 创新机会
    └── 商业模式: 开源/付费/企业版/混合
```

### 5. 复用价值评估

对每个发现的组件/思路，评估三个等级：

| 等级 | 符号 | 标准 |
|------|------|------|
| **高** | ⭐⭐⭐ | 代码/架构可直接复用到当前项目，适配成本低 |
| **中** | ⭐⭐ | 设计思路/模式值得参考，代码需重写 |
| **低** | ⭐ | 完全不匹配，但可作为长期参考 |

### 6. 生成双格式报告

**方式 4（URL 驱动）— 直接输出：**
- JSON → `~/projects/research/<project-name>/report.json`
- Markdown → `~/projects/research/<project-name>/report.md`

**方式 1-3（搜索模式）— 三阶段结构化输出：**

| 阶段 | 输出文件 | 内容 |
|------|---------|------|
| **阶段 A：关键词清单** | `GitHub-关键词清单-{日期}.md` | 关键词列表、分类、每个关键词搜到的项目数 |
| **阶段 B：项目列表** | `GitHub-项目列表-{日期}.md` | 项目名称、URL、Star、语言、描述、匹配关键词 |
| **阶段 C：分析报告** | `GitHub-项目分析报告-{日期}.md` | 每个项目的详细分析 + 综合总结 |

**项目数 < 100** 时：一份完整汇总报告，不删减不精简。
**项目数 ≥ 100** 时：每个项目单独报告 + 综合总结报告。

目录结构：
```
~/projects/research/<project-name>/
├── report.json          # 结构化数据
├── report.md            # 人工可读报告
├── src/                 # 克隆的源码（如开源）
└── screenshots/         # 截图（如商业产品）
```

## Prompt Template for User

当用户想发起分析时，可以按以下模板描述：

**方式 1 — 需求驱动：**
```
分析需求: <需求描述>
当前项目: <当前项目名或路径>
```

**方式 2 — 关键词驱动：**
```
搜索关键词: <关键词1>, <关键词2>, ...
当前项目: <当前项目名或路径>
```

**方式 3 — 文档驱动：**
```
使用 <文档路径> 中的关键词
当前项目: <当前项目名或路径>
```

**方式 4 — URL 驱动：**
```
分析竞品: <GitHub URL / 产品名称 / 产品 URL>
关注点: <可选，如"重点关注它的 RAG 实现""架构设计参考">
当前项目: <当前项目名或路径>
```

简化版也可以：
```
分析下这个: <GitHub URL>
扫一下: <领域描述>
```

## Batch-Scan Variant (已集成到主流程 v2.0)

以下功能已在 v2.0.0 中集成到主流程：
- **GitHub 搜索+筛选**：方式 1-3 的搜索模式已内置（关键词生成→API 搜索→筛选→项目列表）
- **结构化输出阶段**：关键词清单→项目列表→分析报告

保留以下参考文件：
- `references/github-batch-scan-workflow.md` — 批量扫描的历史参考
- `references/post-analysis-reuse-extraction.md` — For "把这些复用点实现在项目中": after 2+ deep-dive reports, consolidate all ⭐⭐⭐ findings into a single `research/reuse-checklist.md` with 第 1/2/3 梯队 priority ranking. Bridge between research output and development input.

## JSON Schema (report.json)

```json
{
  "project_name": "项目名称",
  "url": "项目链接",
  "type": "open_source | commercial | hybrid",
  "summary": "2-3 句话概述",
  "tech_stack": {
    "frontend": {"framework": "", "libraries": []},
    "backend": {"language": "", "framework": "", "libraries": []},
    "database": {"primary": "", "cache": "", "search": ""},
    "infrastructure": {"hosting": "", "ci_cd": "", "monitoring": ""}
  },
  "license": {
    "type": "MIT | Apache-2.0 | GPL-v3 | ... | none",
    "restrictions": "对复用的限制说明（如 Copyleft、NOTICE 要求）",
    "requires_notice": true
  },
  "architecture": {
    "modules": [{"name": "", "responsibility": "", "depends_on": []}],
    "design_patterns": ["Factory", "Observer", ...],
    "data_flow": "描述关键数据流",
    "key_decisions": [{"decision": "", "rationale": ""}],
    "service_layer": {
      "router_organization": "按资源/按功能",
      "dependency_injection": "DI 框架或手动注入方式",
      "middleware_chain": "中间件列表和顺序",
      "async_tasks": "后台任务方案"
    },
    "provider_adapter": {
      "registration": "Provider 注册方式",
      "multi_model": "多模型管理/切换/回退策略",
      "prompt_management": "Prompt 管理方式",
      "media_pipeline": "TTS/图像/视频编排"
    }
  },
  "core_implementations": [
    {
      "name": "实现名称",
      "description": "做什么",
      "location": "源码中的位置",
      "code_snippet": "核心代码（可选）"
    }
  ],
  "code_quality": {
    "standards": "代码规范评估（1-5星）",
    "test_coverage": "测试覆盖评估（1-5星）",
    "error_handling": "错误处理评估（1-5星）",
    "documentation": "文档质量评估（1-5星）",
    "performance": "性能优化评估（1-5星）"
  },
  "dependencies": [
    {"name": "", "version": "", "license": "", "purpose": "", "risk": "low | medium | high"}
  ],
  "security": {
    "authentication": "认证机制",
    "encryption": "加密方式",
    "vulnerability_risk": "漏洞风险评级",
    "dependency_security": "依赖安全情况"
  },
  "maintenance": {
    "last_commit": "最近提交日期",
    "commit_frequency": "提交频率评级",
    "issue_response": "Issue 响应时间评级",
    "contributors": "贡献者数量",
    "release_frequency": "版本发布频率"
  },
  "market_opportunity": {
    "user_pain_points": ["痛点1", "痛点2"],
    "competitive_landscape": "竞争格局描述",
    "differentiation": "差异化机会",
    "business_model": "商业模式"
  },
  "reuse_assessment": [
    {
      "component": "组件名",
      "level": "high | medium | low",
      "description": "为什么这个等级",
      "adaptation_cost": "适配到当前项目的成本: low | medium | high",
      "recommendation": "具体建议: 直接用 / 参考思路重写 / 暂不考虑"
    }
  ],
  "pros_cons": {
    "strengths": ["优点1", "优点2"],
    "weaknesses": ["缺点1", "缺点2"],
    "lessons_learned": ["踩坑经验1", "踩坑经验2"]
  },
  "reuse_paths": [
    {
      "path": "src/modules/xxx.py",
      "priority": "high | medium | low",
      "target_file": "当前项目中建议放置的位置",
      "source_file": "源项目中的原始位置",
      "effort": "low | medium | high",
      "benefit": "复用后带来的具体收益"
    }
  ],
  "architecture_references": [
    {
      "pattern": "设计模式名称",
      "description": "该模式在源项目中如何使用",
      "source_location": "源码位置",
      "relevance": "high | medium | low"
    }
  ],
  "analyzed_at": "ISO timestamp"
}
```

## Output Template (report.md)

```markdown
# 竞品分析报告: <Project Name>

## 概述
<2-3 句总结>

## 许可证
| 项目 | 详情 |
|------|------|
| 许可证类型 | MIT / Apache-2.0 / GPL-v3 / ... |
| 商用 | ✅/❌ |
| Copyleft | ✅/❌ |
| 注意事项 | 需保留版权 / 需开源衍生作品 / 无限制 |

## 技术栈
| 层级 | 技术选型 | 备注 |
|------|---------|------|
| 前端 | ... | ... |
| 后端 | ... | ... |
| 数据库 | ... | ... |
| 基础设施 | ... | ... |

## 架构设计
### 模块划分
[模块关系图或描述]

### 关键设计模式
1. **模式名** - 在项目中怎么用的

### 数据流
请求 → 处理 → 响应的关键链路

### 服务层（FastAPI/微服务时展开）
- Router 组织方式
- 依赖注入方案
- 中间件链
- 异步任务方案

### Provider 适配层（AI 工具时展开）
- Provider 注册方式
- 多模型管理/回退策略
- Prompt 管理
- TTS/图像/视频编排

## 核心实现
### 1. <实现名称>
- 做什么
- 源码位置
- 核心代码/伪代码

## 架构参考（可借鉴的设计模式）
| # | 模式 | 描述 | 源码位置 | 相关度 |
|---|------|------|---------|--------|
| 1 | ... | ... | ... | ⭐⭐⭐ |

## 复用评估（对接当前项目: <Project Name>）
| 组件/思路 | 等级 | 适配成本 | 建议 |
|-----------|------|---------|------|
| ... | ⭐⭐⭐ | low | 直接复用 |
| ... | ⭐⭐ | medium | 参考思路 |

## 复用路径（源文件 → 目标位置）
| # | 源文件 | 目标位置 | 优先级 | 工作量 | 收益 |
|---|--------|---------|--------|--------|------|
| 1 | src/xxx.py | packages/yyy/ | ⭐⭐⭐ | low | ... |

## 优缺点与经验
### 优点
- ...

### 缺点
- ...

### 踩坑经验
- ...

## 结论
<可复用性总结和行动建议>

## 与目标项目的对比

| 维度 | 竞品 | 当前项目 |
|------|------|---------|
| 核心定位 | ... | ... |
| 案例量 | ... | ... |
| 分类能力 | ✅/❌ | ✅/❌ |
| ... | ... | ... |

## 可直接复用的点

| # | 组件/思路 | 等级 | 适配成本 | 建议 |
|---|-----------|------|---------|------|
| 1 | ... | ⭐⭐⭐ | low | 直接复用 — ... |
| 2 | ... | ⭐⭐ | medium | 参考思路 — ... |
| 3 | ... | ⭐ | high | 暂不考虑 — ... |
```

## Pitfalls

- **不要只做表面分析** — 必须深入源码/核心模块，只看 README 没有价值
- **速判规则 — 不值得 clone 的信号**：分析前先 curl README 判断。如果 ⭐<100 且文件<5 且最近 commit>1年，直接给 3-5 句总结不 clone。拿不准时 curl README 头 20 行快速判断
- **区分"能用"和"值得用"** — 不是所有代码都值得复用到当前项目，要考虑技术栈差异、耦合度
- **Windows 路径注意** — 使用 Path 对象或 bash 路径，不要硬编码反斜杠
- **不要一次性 clone 大仓库** — 用 `--depth 1` + `sparse-checkout` 只拉需要的部分
- **商业产品分析不要编造** — 能推断的推断，推断不了标明"推测"，不编造不确定的技术细节
- **GitHub 网络不通时** — 用代理扫描端口：`for port in 7890 7891 7892 10808 10809; do curl --max-time 2 -x http://127.0.0.1:$port https://httpbin.org/ip && break; done`。找到后 `git -c http.proxy=http://127.0.0.1:PORT clone ...`
- **当前项目上下文很重要** — 评估复用价值时必须结合用户当前项目的技术栈和需求，否则分析是空洞的
- **「要」之后必须先出计划再动手** — 用户说「要」/「全部复用」/「这些都实现」后，不能直接写代码。必须先出 `PM-PRD-<version>.md` 计划（哪怕只有一行），经用户确认后再进入实现阶段。跳过此步是用户明确纠正过的问题
- **「已分析过」的处理** — 当用户给出的 URL 是之前分析过的项目，不要重新分析。直接回答：
  - 分析结论（3-5 句话）
  - 复用情况（已复用哪些）
  - 报告位置（`research/<name>/report.md`）
- **「已分析过」快速识别方法** — 用户给 URL 之前先 `ls ~/projects/research/` 看下是否已存在同名目录。已分析的 URL **必须**在第一句话就声明「这个已分析过」，避免用户疑惑「为什么没重新分析」。本次发现 Infinity / dynamicprompts / prompt-optimizer / awesome-gpt-image-2 / gpt4o-image-prompts / sd-dynamic-prompts / Infinity 等多次被重复问 |
- **「已分析但无 report」的补填** — 部分早期项目没有正式报告。用户说「补」时，用 `--depth 1` 重新 clone 出完整报告，否则 3-5 句给结论即可
- **「0 可复用点」的处理** — 当分析返回 0 个可复用时，也出完整报告（含 JSON + Markdown），在结论段明确说明「0 个可复用点 + 原因」。不要让用户读完报告还要追问「所以能不能用？」
- **清理无复用源码** — 分析完成后，如果结论是 0 可复用，询问用户是否删除 `src/` 目录（仅保留 `report.md` + `report.json`）。已复用/已集成的项目保留源码备查。删除时注意 Windows `.git/objects/pack/` 可能有权限锁定，用 `rm -rf` 而非 `shutil.rmtree`。
- **许可证检查不可跳过** — 深度分析前必须先检查 LICENSE 文件。GPL/AGPL 项目的代码不能直接复制到闭源项目中；无许可证项目默认保留所有权利，不可用。许可证结果必须标记在报告的独立字段中
- **搜索模式不去重会重复分析** — 同一项目匹配多个关键词时必须去重（按 repo 全名去重），否则同一个项目会被分析多次
- **GitHub API 速率限制** — 搜索 API 每分钟 10 次请求。大批量搜索时注意控制频率，遇到 429 响应需等待重试
- **关键词不能只用英文** — 分析中国平台（抖音/小红书/B站）相关项目时，必须同时生成中文关键词，否则会遗漏大量国内优质项目
- **搜索结果不代表质量** — Star 数高不代表适合复用，还需结合最近更新时间、代码质量、许可证等因素综合判断
- **竞品扫描优先于逐个分析** — 当用户说「查一下上面还有没有可分析的」，先用 `execute_code` + GitHub API（`search/repositories` 端点）扫描同领域高 ⭐ 项目，产出 `research/github-scan.md`。已分析的标记 ✅，未分析但高相关的标记推荐度。**参考 `references/github-scan-landscape.md`** 了解已覆盖的赛道
- **多项目分析后必出"复用清单"** — 分析 2+ 个项目后，必须合并出 `research/reuse-checklist.md`（按 第1/2/3 梯队排序），不要让用户重读 N 份报告来决定"用哪个"。详见 `references/post-analysis-reuse-extraction.md`
- **"复用清单"是规划文件不是代码** — 出了 checklist 后**停下来**，不要自动开始 TDD。等用户说"go"或"做这 3 个"再切到 `professional-ai-coding-workflow`

## Post-Analysis → Implementation Handoff

当用户说「要」（复用分析结果）时，**切换出本 skill**，改走 `professional-ai-coding-workflow` 的开发流程。

参考 `references/reuse-extraction-implementation-pipeline.md` 了解完整的竞品分析→复用提取→批量实现流水线（PROJECT-012 实战模式：5 项目 → 12 复用点 → 2 批次实现 → 全部落地 GitHub）。

```
github-project-analysis (本 skill)
    ↓ 报告输出
用户说「要」
    ↓
professional-ai-coding-workflow (开发流程)
    ├─ PM-PRD 计划 (必须，不可跳过)
    ├─ CEO 签字
    ├─ ARCH 文档
    ├─ TDD (如果涉及代码)
    ├─ 文档同步 (CHANGELOG/README/AGENTS/PRD)
    └─ 发布
```

关键：竞品分析只产出「报告」和「复用建议」。用户说「要」之后，实现阶段必须走开发流程 skill，不能直接写代码。

## Post-Analysis Implementation Phase

Analysis without implementation is incomplete. After the report is generated, if the user wants to **integrate findings**, follow this workflow:

### 1. Extract Structured Data

When the competitor has structured data (style lists, keyword tables, configuration presets):

```python
# Fetch repo file tree
url = 'https://api.github.com/repos/<user>/<repo>/git/trees/main?recursive=1'
# Download each data file → parse → flatten → filter
# Store as JSON in project's data/ directory
```

**Key patterns for DB key mapping:**
MJ DB keys use irregular capitalization (e.g. `Drawing_and_Art_Mediums`, `SFX_and_Shaders`). The `.title()` builtin produces `Drawing_And_Art_Mediums` which mismatches. **Use a hardcoded dict** instead of algorithmic conversion.

```python
# ✓ Correct approach
_CATEGORY_DB_MAP = {
    StyleCategory.LIGHTING: "Lighting",
    StyleCategory.DRAWING_AND_ART_MEDIUMS: "Drawing_and_Art_Mediums",
    StyleCategory.SFX_AND_SHADERS: "SFX_and_Shaders",
    # ... one entry per category
}

# ✗ Wrong approach
db_key = cat.value.replace("_", " ").title().replace(" ", "_")
# "drawing_and_art_mediums" → "Drawing_And_Art_Mediums" ✗
# Should be: "Drawing_and_Art_Mediums"
```

**More key patterns:**
- GitHub API tree endpoint for file discovery: `git/trees/main?recursive=1`
- Raw content fetching: `raw.githubusercontent.com/<user>/<repo>/main/<path>`
- Use Python's `urllib.request` (lightweight, no extra deps)
- CSV/table parsing from markdown: split on `|`, filter header/separator rows
- Noise filtering pipeline: short words → technical acronyms → HTML remnants → pure digits

### 2. Build a Classifier (Zero-Shot)

When the extracted data needs to map user input to categories:

```python
# Chinese + English synonym mapping for cross-language classification
CN_SYNONYMS: dict[StyleCategory, set[str]] = {
    CategoryA: {"中文词1", "中文词2", "english_keyword"},
    CategoryB: {"中文词3", "keyword2"},
}

def keyword_match(prompt: str) -> tuple[...]:
    # Phase 1: Chinese synonym match (covers Chinese prompts)
    # Phase 2: English database keyword match (covers English prompts)
    # Skip content-heavy categories (song lyrics, experimental text)
    # Return normalized scores + matched keywords
```

**Key patterns:**
- Dual-path matching: CN synonyms first (fast), EN database second (deep)
- Score normalization: `v / max(scores.values())`
- Skip categories whose data is content, not style (Song_Lyrics, Experimental)
- Category → StyleType mapping with priority ordering (mediums > design > photo > tech > landscape)
- **Category feedback loop**: After building a classifier, close the loop by passing detected categories back to the injection/optimization pipeline. This makes keyword injection context-aware rather than random.

### 3. Integrate into Existing Architecture

- Add models: new enums + result classes in `models.py`
- Add classifier as standalone module (zero-shot, no training data needed)
- Integrate into the core engine (optimizer/controller)
- Expose via API (REST endpoints + MCP tools)
- Export from package `__init__.py`
- Update existing strategies to consume the new data
- **API endpoint gotcha:** When adding endpoints to REST/MCP servers, ensure ALL model classes used by the endpoint (not just the request/response types) are imported in the API module. For example, a category-listing endpoint using `StyleCategory.LIGHTING` inline needs `StyleCategory` imported explicitly even if `StyleCategoryResult` covers the serializer.

#### 3a. Lazy Package Imports (Critical for Startup Time)

When the new module triggers imports that connect to external services (LLM APIs, databases), protect startup time by making `__init__.py` lazy:

```python
# DON'T do this — triggers LLM connection on import!
from prompt_engine.optimizer import Optimizer

# DO this instead:
def __getattr__(name: str):
    """Lazy import: only loads Optimizer when first accessed."""
    if name == "Optimizer":
        from prompt_engine.optimizer import Optimizer
        return Optimizer
    raise AttributeError(...)

__all__ = ["Optimizer", ...]  # __all__ still works with __getattr__
```

This prevents 18-second startup delay when importing lightweight sub-modules.

#### 3b. Optional Dependency Lazy Loading

When modules have heavy dependencies (torch, tensorflow), import lazily inside the function:

```python
# ✗ WRONG — import at module level forces torch install
import torch
class MyClassifier(nn.Module): ...

# ✓ CORRECT — lazy inside __init__
class MyClassifier:
    def __init__(self):
        import torch
        import torch.nn as nn
        self._torch = torch
        self._nn = nn
    def __call__(self, x):
        return self.forward(x)
    def forward(self, x) -> "torch.Tensor":
        torch = self._torch
        return torch.stack([...])
```

#### 3c. Category Feedback Loop (Classify -> Inject)

After building a classifier, close the loop by feeding detected categories back into the output pipeline:

```
classifier.classify(prompt) -> [Lighting, Camera]
    |
    v
_style_category_to_db_key(cat) -> ["Lighting", "Camera"]
    |  (use hardcoded dict, not algorithmic conversion)
    v
inject_style_keywords(prompt, preferred_categories=db_keys)
    |
    v
"prompt text, Volumetric Lighting, Shallow DOF."
```

#### 3d. Test Adaptation for Side Effects

When `post_process` gains side effects (keyword injection), tests checking exact output break. Update them to verify **behavior** not **exact string**:

```python
# ✗ FRAGILE — breaks when injection appends keywords
assert result == "hello world"

# ✓ ROBUST — verifies the behavior (quotes stripped) not the full output
assert '"' not in result.split(",")[0], f"Quotes not stripped: {result}"
assert "hello world" in result
```

### 4. Multi-Finding Batch Reuse

When a single analysis produces **multiple reusable items** (e.g. F1/F2/F3), track them individually through implementation.

**4a. Write a PM-PRD Plan First**

Create `PM-PRD-<version>.md` in the project root listing all findings with priority, dependency, workload, and feature type:

| Finding | Level | Feature Type | TDD? | Workload |
|---------|-------|-------------|------|----------|
| F1: Agent Skill | ⭐⭐⭐ | Documentation | No | small |
| F2: RAG Seed | ⭐⭐⭐ | Data | Yes | medium |
| F3: Template Engine | ⭐⭐ | Code | Yes | medium |

**Feature types determine TDD approach:**
- **Code**: full TDD RED → GREEN
- **Data** (parsing/injection): TDD RED → GREEN for parse/inject logic
- **Documentation/Config** (SKILL.md, scripts): skip TDD, direct implement

**4b. Per-Finding Architecture Docs**

Each finding gets an `ARCH-F<编号>-<功能名>.md`:
```
ARCH-F1-agent-skill.md
ARCH-F2-rag-seed.md
ARCH-F3-prompt-template.md
```

**4c. Implementation Loop**

```
for each F in [F1, F2, F3]:
    1. Write ARCH-F.md
    2. If feature type is Code or Data:
        2a. Write test file (TDD RED — all fail)
        2b. Write implementation (TDD GREEN — all pass)
       Else:
        2. Write implementation directly
    3. Create/update entry point (exports, CLI, etc.)
    4. Sync docs: update CHANGELOG + README + PRD for this F
    5. Commit (one commit per F: code + tests + docs)
```

**4d. Final Cleanup**

After all F's done:
- Move `ARCH-*.md` and `PM-PRD-*.md` to `docs/`
- Run full test suite
- Doc audit (verify PRD/CHANGELOG/README/AGENTS are all synced)
- Final commit

### 5. Make Dependencies Optional

When adding modules with heavy deps (torch, tensorflow):

```python
# classifier.py — lazy torch import
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    import torch

class MyClassifier:
    def __init__(self):
        import torch  # lazy load at runtime
```

**If the class inherits from `nn.Module`**, the inheritance makes torch mandatory at import time. Refactor to a plain class with `__call__`:

```python
class MyClassifier:
    """Plain class with __call__ — works without torch installed."""
    def __init__(self):
        import torch
        import torch.nn as nn
        self._torch = torch
        self._nn = nn
        self.bit_heads = nn.ModuleList([...])
    
    def __call__(self, x):
        return self.forward(x)
    
    def forward(self, x) -> "torch.Tensor":  # string annotation
        torch = self._torch
        return torch.stack([...])
    
    @classmethod
    def from_config(cls, ...) -> "MyClassifier":
        return cls(...)
```

This ensures API/MCP servers can boot without torch installed.

### 6. Test Coverage (minimum)

- 15-20 tests per new feature module
- Tests for: loading, matching, edge cases (empty, long, special chars)
- Tests for: LLM fallback (mocked), cross-language matching
- Integration tests: actual classification with realistic prompts
- Full suite: `python -m pytest tests/ -q` before committing

## Example Usage

**方式 4 — 直接分析单个项目:**
```
用户输入:
分析下这个: https://github.com/langchain-ai/langchain

AI 执行:
1. Clone langchain 仓库核心目录
2. 分析架构：模块化设计、Chain/Agent/LCEL 体系
3. 评估：RAG pipeline 架构对 prompt-engine 有直接复用价值（⭐⭐⭐）
4. 输出 JSON + Markdown 报告到 ~/projects/research/langchain/
```

**方式 1 — 需求驱动搜索:**
```
用户输入:
我想做一个多平台内容发布工具，支持小红书、抖音、视频号、B站

AI 执行:
1. 生成关键词清单（功能+技术栈+产品分类+中文，约 40-50 个关键词）
2. 保存为 GitHub-关键词清单-{日期}.md
3. 用每个关键词搜索 GitHub，按 Star>100 + 最近更新<24月 筛选
4. 去重后保存项目列表 → GitHub-项目列表-{日期}.md
5. 逐个项目深入分析
6. 输出综合分析报告 → GitHub-项目分析报告-{日期}.md
```

**方式 2 — 直接关键词:**
```
用户输入:
搜索关键词：multi-platform publish, social media scheduler, video upload

AI 执行:
1. 直接使用提供的关键词
2. 搜索 + 筛选 + 分析 + 报告
```

---

## 扩展技术：多产品对比与架构融合

### 场景

用户要求对比**两个或多个同领域的竞品**，并出组合方案（例如："对比参考产品和融媒宝，怎么做结合"）。

### 分析方法

#### 1. 多维度对比矩阵

同时对两个产品做 Phase 1-3 分析，然后按维度并排对比：

```markdown
| 维度 | 产品 A | 产品 B | 分析 |
|------|--------|--------|------|
| 平台覆盖面 | ~25 个 | 40+ 个 | B 更广 |
| 技术栈 | Electron + React | C++ + DuiLib + CEF | A 迭代快，B 性能好 |
| 视频处理 | ❌ 无 | ✅ VLC + MediaInfo | B 的视频能力可借鉴 |
| AI 功能 | ❌ 无 | ✅ AI 成片/写作 | A 如需要可参考 B |
| 数据同步 | ❌ 无 | ✅ 多平台数据拉取 | 项目003 可借鉴 |
```

#### 2. 优劣势深度分析

对每个维度，3 句话：
- **表现**：实际差异
- **根因**：为什么这么设计（技术栈限制/产品定位）
- **对目标项目的意义**：该学谁

```markdown
### 视频处理
- **表现**：A 无，B 有 VLC 深度集成
- **根因**：A 是 Web 技术栈（Electron），集成 FFmpeg 需要额外进程；B 是 C++ 原生，VLC 作为 DLL 直接调用
- **对项目003 的意义**：B 的方案太重（VLC + 插件 30MB），项目003 用 ffprobe 做轻量视频预检即可，不需要完整转码能力
```

#### 3. 分层架构融合方案

将两个产品的优点按架构层次拆解，组合成目标架构：

```markdown
## 项目003 最终架构 (融合两者优点)

### 架构总览图
```
[ASCII 架构图]
```

### 第一层：架构选型
✅ 取 = 产品 A 的 Electron + Vue 3（跨平台、迭代快）
✅ 取 = 产品 B 的 CEF 内嵌浏览器思路（提升登录体验）
❌ 舍 = 产品 A 的自研浏览器引擎（不如 Playwright）
❌ 舍 = 产品 B 的 C++/DuiLib（太重、仅 Windows）

### 第二层：发布能力
✅ 取 = 产品 A 的 Python 后端 + FastAPI
✅ 取 = 产品 B 的平台 URL 配置化
✅ 取 = 产品 B 的 40+ 平台清单
### 第三层：附加能力（按优先级）
✅ 取 = 产品 B 的数据同步系统
✅ 取 = 产品 B 的敏感词库
### 第四层：开发流程
✅ 取 = 产品 A 的快速迭代
```

关键原则：
- **取思路不取代码**：借鉴设计模式，不复制商业代码
- **适合才是最好的**：技术选型要考虑自身团队能力和项目定位
- **区分"能用"和"值得用"**：不是所有功能都需要实现

#### 4. 一句话总结公式

```
产品 A = [优点概括]，但 [缺点概括]
产品 B = [优点概括]，但 [缺点概括]

项目 X = 取 A 的 [核心优势] + 取 B 的 [核心优势]
       = [融合后的定位描述]
       = 把 B 的 [多年积累的能力] 用 A 的 [现代架构] 重新实现
```

### 输出文档

多产品对比应生成一份独立的文档（不在标准 11 份报告模板中）：

```
docs/XX-<产品A>vs<产品B>全面对比与结合方案.md
  ├── 一、产品需求对比（功能矩阵 + 覆盖率）
  ├── 二、技术架构对比（全景 ASCII 图 + 组件对比表）
  ├── 三、技术优劣深度分析（逐维度分析）
  ├── 四、复用评估（综合评分 + 两者都不需要复用的）
  ├── 五、架构融合方案（分层分析 + 路线图）
  └── 六、一句话总结
```

## Relationship to other Skills

- `third-party-analysis`: 侧重开源代码复用的后半段（clone → integrate）。本 skill 覆盖从"用户给 URL"到"分析完成"的**完整前端流程**，侧重分析深度和复用评估方法论。
- `github-project-analysis`（本 skill）: 由原 `competitor-tech-analysis` + `Colinchiu007/github-project-analysis-skill` 合并而来。v2.0.0。
- `infinity-to-project-integration`: 更早的分析 skill，侧重单个学术项目的设计模式提取。功能已被本 skill 覆盖，优先使用本 skill。
- `project-context`: 分析时需要确认当前项目上下文，本 skill 依赖此 skill 准确判断复用价值。
- `spike`: 分析后发现高复用价值的组件，可以用 spike 做快速验证实验。

## Reference Files

- `references/mj-style-database-patterns.md` — Full MJ database extraction patterns, 27-category DB key mapping, noise filtering, Chinese synonym structure, StyleType priority ordering. Refer to this when implementing a style classifier or keyword injection system based on the MJ Style Reference.
- `references/mp-vs-rongmeibao-case.md` — 多产品对比实战案例：参考产品 (Electron) vs 融媒宝 (CEF 原生)。展示了如何对两个同领域竞品做维度对比分析，输出分层架构融合方案。
- `references/pkuseg-crf-multidomain-case.md` — PKUSeg 实战案例：CRF + Cython + 5 标签 BMES 变体模式识别、7 个固定维度的"与目标项目对比"模板、复用价值筛选启发。
- `references/agent-skill-distribution-pattern.md` — Agent Skill 作为产品分发的架构模式（discovered from awesome-gpt-image-2）。适用于以 SKILL.md 为核心的竞品分析。
- `references/prompt-optimizer-analysis.md` — Prompt Optimizer (v2.11.6) 分析案例：模板驱动优化、多模型供应商适配器、评估对比模式。
- `references/gpt4o-image-prompts-analysis.md` — gpt4o-image-prompts (1050 条双语 prompt) 分析案例：双语数据集注入 RAG。
- `references/sd-dynamic-prompts-analysis.md` — sd-dynamic-prompts (2276⭐) 分析案例：模板语法 DSL、四层架构、MagicPrompt。
- `references/infinity-analysis.md` — Infinity (CVPR 2025 Oral) 分析参考：IVC/BSC/rewriter 已复用三个设计模式。
- `references/reuse-vs-integrate.md` — 「已复用」vs「已集成」区分标准，用于回答用户「全部用上了吗」类问题。
- `references/github-scan-landscape.md` — GitHub 竞品扫描结果，标注已分析/未分析的高 ⭐ 项目，避免重复分析。
- `references/integrate-vs-keep-independent.md` — 何时"合并到主项目"vs"独立维护+数据桥接"的判断框架。含 PROJECT-011/012 独立决策的实战分析、3 个桥接模式代码模板、桥接最常踩的 3 个坑（平台名/批量格式/默认值）。当用户问"我应该合并 X 项目吗"或"两个项目怎么配合"时先读这个。