# PRD — 改写页视觉重构与列宽稳定性修复

> **文档编号**: PRD-REWRITE-PAGE-UI-2026-09-16
> **立项日期**: 2026-09-16
> **关联分支**: `fix-rewrite-page-ui`
> **影响页面**: 文案改写页（`/rewrite`，`apps/desktop/src/views/RewriteView.vue`）
> **类型**: UI/UX 变更 + Bug 修复（列宽抖动）
> **复杂度**: 中（1 个视图 + 1 个设计系统文件 + 2 个测试文件）

---

## 一、背景与问题

### 1.1 用户反馈现象

1. **改写页右侧主内容区 UI 设计不合理、视觉混乱**；
2. **点击「开始改写」后，页面内容宽度突然被撑宽**，体验非常奇怪。

### 1.2 根因定位（含实测数据）

宽度抖动**不是**改写结果本身的问题，而是页面容器的布局语义问题。

```
DOM 层级：
main.mp-workspace.cohere-main        ← display:flex; flex-direction:column
  └─ div.rewrite-page                ← width:auto; max-width:900px; margin:0 auto
       ├─ div.cohere-page-header
       └─ div.cohere-content
            ├─ div.cohere-card.rewrite-input-card
            ├─ div.cohere-card.rewrite-config-card
            └─ div.cohere-card.rewrite-result-card   ← 改写后才有
```

- 父容器 `.cohere-main` 是 **`flex-direction: column`** 的 flex 容器；
- `.rewrite-page` 只声明了 `max-width: 900px; margin: 0 auto`，**没有显式 `width`**；
- 在 flex 布局中，**交叉轴方向上的 `auto` margin 会抑制 `align-self: stretch`**，使该 flex item 的宽度退化为 `fit-content`，即由「最宽的那个后代元素」的 max-content 决定；
- 改写前，最宽内容只有输入卡片；改写结果卡片出现后，其中的元信息行、质量指标行、动作行把 max-content 抬高，整列随之变宽。

**Chromium 实测（视口 1440×900）：**

| 状态 | `.cohere-main` | `.rewrite-page` | 卡片宽度 |
|------|---------------|-----------------|---------|
| 无改写结果 | 1240 | **474.11** | 410.11 |
| 结果卡片出现后 | 1240 | **543.69** | 479.69 |
| 修复后（无结果） | 1240 | **900** | 836 |
| 修复后（有结果） | 1240 | **900** | 836 |

父容器宽度全程恒定为 1240，页面自身却从 474.11 跳到 543.69——这直接对应「点击改写后被撑宽」的主观感受。

### 1.3 「视觉混乱」的具体构成

除宽度抖动外，逐项核对出以下问题：

| # | 问题 | 技术成因 |
|---|------|---------|
| 1 | 勾选框浮在标题上方/行中央，与文字脱离 | `.config-checkbox` 是 `flex-direction: column` 容器，`<input type=checkbox>` 作为 flex item 被 `align-self: stretch` 拉伸到整行宽，原生勾选框绘制在拉伸后的框中央 |
| 2 | 卡片标题毫无视觉层级 | 全局类 `.cohere-section-title` **在 CSS 中没有任何定义**，退化为继承字号（14px） |
| 3 | 字段布局不统一 | 「改写模式/字数控制」是标签独占一行；「目标平台」是 `<label>`（inline）与 `<select>`（inline-block）同行——全页唯一例外 |
| 4 | 表单卡片显示手型光标并随悬停浮起 | 全局 `.cohere-card` 是「卡片墙」语义：`cursor: pointer` + `:hover` 变色加阴影 |
| 5 | 两个复选框各占一个大边框块，信息密度低 | 每块 `padding: 10px 14px` + 标题行 + 说明行 |
| 6 | 质量报告卡片套卡片 | `.rewrite-quality-report` 在结果卡片内又加了 `border` + `background` |
| 7 | 结果元信息是灰底小方块 | `.rewrite-result-meta` 带 `padding` + `background: var(--soft-stone)` + `border-radius` |
| 8 | 三个动作按钮等权重并排 | 主操作（去发布）与次操作（存草稿/视频创作）无主次区分 |
| 9 | 样式引用了未定义的 CSS 变量 | `--text-primary` / `--text-secondary` / `--surface-secondary` / `--border` / `--coral-bg` 在 `cohere-design-system.css` 中均无定义，靠 `var()` fallback 或继承色兜底 |
| 10 | 字数区间前有 8px 隐形空隙 | `WordCountRangeInput` 的 `.word-count-label` 传空串时仍占位，flex `gap: 8px` 生效 |

---

## 二、目标与非目标

### 2.1 目标

1. **列宽恒定**：页面宽度只由容器宽度与 `max-width` 决定，与内容多少完全解耦；
2. **字段分组**：配置项按语义分段，段内字段行布局完全统一；
3. **层级清晰**：卡片标题 > 字段标签 > 控件 > 说明文字，字号/字重/颜色形成稳定阶梯；
4. **信号不误导**：静态容器不长成可点击的样子；勾选态有明确视觉反馈；
5. **零交互行为变更**：不改动任何 IPC 调用、传参契约、校验规则与文案 key。

### 2.2 非目标

- 不重构改写引擎、不改动后端 `aiRewrite` 参数契约；
- 不改动共享组件 `RewriteStrategyPicker` / `WordCountRangeInput` 的内部实现（它们被 `Collection.vue`、`CopyRewriteModal.vue` 复用）；
- 不改动质量评估的结论文案语义（`合格/需注意/不合格`）——该语义由另一条并行任务处理；
- 不引入新的 i18n 文案键。

---

## 三、功能逻辑与信息架构

### 3.1 页面三层结构

```
① 页面头  .cohere-page-header
   ├─ 标题「文案改写」
   └─ 副标题（价值说明）

② 主内容  .cohere-content
   ├─ 卡片 A：输入文案
   │    ├─ 标题
   │    ├─ 文本域（8 行，可纵向拉伸）
   │    └─ 底部信息行：左＝字数计数 / 右＝校验错误
   ├─ 卡片 B：改写设置
   │    ├─ 标题
   │    ├─ 【段 1｜内容依据】两个来源开关（两列并排）
   │    ├─ 【段 2｜改写模式】模式 chips
   │    ├─ 【段 3｜输出控制】字数控制 ＋ 目标平台（两列并排）
   │    │                   改写策略（单选 + 下拉）
   │    ├─ 分隔线
   │    └─ 执行区：开始改写按钮
   └─ 卡片 C：改写结果（仅在有结果时渲染）
        ├─ 标题
        ├─ 元信息行（策略 / AI 味 / 字数）
        ├─ 质量评估面板（左侧结论强调条）
        ├─ 结果文本域（可编辑）
        └─ 动作行：左＝存草稿、视频创作；右＝去发布
```

### 3.2 配置区分段依据

配置区从「7 个控件平铺」改为 **3 段**，分段依据是**用户的心智模型**：

| 段 | 控件 | 回答用户的问题 |
|----|------|---------------|
| 内容依据 | 结合爆款库、结合个人经历 | **改写的素材从哪来？** |
| 改写模式 | 智能仿写 / 扩写爆款 / 选题创作 | **这次要做什么类型的事？** |
| 输出控制 | 字数控制、目标平台、改写策略 | **产出要满足什么约束？** |

三段之间用 24px（`--space-xl`）间距分隔，段内字段用 16px（`--space-lg`）间距——**间距差本身就是分组信号**，不引入新的分组标题文案。

### 3.3 并排策略

- **内容依据**：两个开关两列并排。二者互不从属、可同时开启，并排后垂直占用从约 120px 降至约 60px；
- **字数控制 + 目标平台**：两个短字段两列并排，利用宽卡片右半侧闲置空间，减少一屏滚动；
- **改写模式 / 改写策略**：控件本身较宽（3 个 chip、radio + 下拉），保持整行独占。

---

## 四、交互逻辑

### 4.1 状态矩阵

| 元素 | 默认态 | 改写中（`rewriting = true`） | 有错误 |
|------|--------|---------------------------|--------|
| 输入文本域 | 可编辑 | `disabled` | — |
| 来源开关 ×2 | 可勾选 | `disabled` + `opacity: .6` + 光标 `default` | — |
| 改写模式 chips | 可点击 | `disabled` + `opacity: .5` | — |
| 字数输入 ×2 | 可编辑 | `disabled` | 输入框下方显示校验错误 |
| 目标平台下拉 | 可用 | `disabled` | — |
| 策略单选 / 下拉 | 可用 | `disabled` | — |
| 开始改写按钮 | 文案「🔄 开始改写」，内容非空且字数合法时可用 | 文案「改写中...」+ `disabled` + `opacity: .5` | — |
| 错误条 | 隐藏 | 隐藏 | 显示 `rewriteError` |
| 结果卡片 | 不渲染 | — | — |

### 4.2 控件交互细则

**来源开关（`.config-switch`）**

- 整块 `<label>` 可点击，点击任意位置切换勾选；
- 勾选态：边框 `var(--coral)`、背景 `var(--coral-soft)`（浅红）、勾选框 `accent-color: var(--coral)`；
- 未勾选态：边框 `var(--border-light)`、背景 `var(--canvas)`；
- 悬停（可用态）：边框转为 `var(--coral)`，**不改变背景**；
- 禁用态：`opacity: .6`，悬停不再变色，光标为 `default`；
- 勾选框固定 16×16、左置、与标题首行对齐（`margin-top: 2px`）——**不得被 flex 拉伸**。

**字数控制**

- `WordCountRangeInput` 的 `label` 传空串时，空标签必须隐藏，避免 flex `gap` 产生 8px 空隙；
- 校验错误独占一行（`flex-basis: 100%`），避免把「- 2000 字」挤到下一行。

**结果区动作**

- 左对齐：存入草稿、视频创作（次要操作，悬停时浅红底 + 珊瑚色文字）；
- 右对齐：去发布（主要操作，填充胶囊按钮），通过 `margin-left: auto` 推到最右；
- 动作行与正文之间用 1px 分隔线断开。

### 4.3 改写流程（本次未改动，记录以保持文档完整）

```
用户输入文案
  ↓ 点「开始改写」
① 前置校验：内容非空 → 字数区间合法 → 登录门禁
  ↓ 任一失败：inline 提示，流程终止
② 若上次改写结果未保存/未发布 → 上报 rejected 知识反馈
③ 清空上次结果 / 质量报告 / 知识引用
④ 调用 aiRewrite(params)
  ↓ 成功
⑤ 写入结果、质量报告、元信息；consume 知识引用
  ↓ 「改写中」期间配置区全部禁用，防止参数漂移
⑥ 保存草稿 → 采纳反馈；去发布 / 视频创作 → 草稿失效逻辑
```

---

## 五、数据校验

### 5.1 输入层校验

| 校验项 | 规则 | 提示文字（key） | 触发时机 |
|--------|------|----------------|---------|
| 内容非空 | `content.trim().length > 0` | `rewritePage.contentEmpty`「请输入文案内容」 | 点击开始改写时；同时作为按钮 `disabled` 条件 |
| 字数下限 | 0–5999 的整数 | `wordCountMinInvalid`「最小字数需为 0-5999 的整数」 | 输入即时 |
| 字数上限 | 1–6000 的整数 | `wordCountMaxInvalid`「最大字数需为 1-6000 的整数」 | 输入即时 |
| 区间顺序 | `max >= min` | `wordCountMaxLtMin`「最大字数不能小于最小字数」 | 输入即时 |
| 登录态 | `ensureLogin()` 返回 true | `needLogin`「AI 改写需要登录后使用，是否立即登录？」 | 点击开始改写时 |

**联动规则**：任一校验不通过 → `canStartRewrite` 为 false → 开始改写按钮 `disabled`。改写进行中所有配置控件锁定，防止「改写参数在飞行途中被改」。

### 5.2 入参契约（保持不变）

```js
{
  mode: 'imitate' | 'expand' | 'create',
  content: string,                    // trim 后
  userSettings: {
    platform: string | undefined,     // 空串按 undefined 传（走通用）
    wordCountRange: { min: number, max: number },
    knowledgeOptions: {
      useViralLibrary: boolean,
      usePersonalKnowledge: boolean,  // 注意：与 UI 变量名 usePersonalExperience 不同
    },
  },
  strategyId: string | null,          // 手动=所选 id（未选 null）；自动=null
}
```

### 5.3 响应层数据校验（保持不变，本次仅为其补视觉呈现）

质量报告 `quality` 必须为**纯对象**（非数组、非 null），否则整体降级为「未生成质量评估」占位：

| 字段 | 校验规则 | 非法值处理 |
|------|---------|-----------|
| `verdict` | 白名单 `pass` / `warn` / `fail` | 回退 `fail`（显示「不合格」） |
| `method` | 仅 `embedding` 视为向量；其余 | 回退 `simhash` |
| `suggestions` | 必须为数组 | 非数组时不渲染建议列表（不逐字符迭代） |

**本次新增**：`verdict` 除驱动文案颜色外，同时驱动质量面板**左侧强调条颜色**（`quality-accent-pass/warn/fail`），让结论等级在扫视时即可辨识。

---

## 六、显示项规格

### 6.1 布局规格

| 元素 | 属性 | 值 |
|------|------|-----|
| `.rewrite-page` | `width` | `100%`（**核心修复**：阻断 fit-content 退化） |
| | `max-width` | `900px` |
| | `margin` | `0 auto` |
| | `box-sizing` | `border-box` |
| `.cohere-content` | `padding` | `var(--space-xl) var(--space-xxl)` = 24px 32px |
| 卡片 | `padding` | `var(--space-xl)` = 24px |
| | `margin-bottom` | `var(--space-lg)` = 16px |
| | `cursor` | `default`（覆盖全局 `pointer`） |
| `.config-switches` | `display` | `grid`，2 列 `minmax(0,1fr)` |
| | `gap` | `var(--space-sm)` = 8px |
| | `margin-bottom` | `var(--space-xl)` = 24px |
| `.config-grid` | `display` | `grid`，2 列 `minmax(0,1fr)` |
| | `column-gap` | `var(--space-xl)` = 24px |
| `.config-row` | `margin-bottom` | `var(--space-lg)` = 16px |
| `.rewrite-submit` | `margin-top` / `padding-top` | `var(--space-lg)`，另加 `border-top: 1px solid var(--border-light)` |
| 字段标签 | `display` / `margin-bottom` | `block` / 6px |
| 下拉类控件 | `max-width` / `width` | `280px` / `100%` |

### 6.2 字号与颜色阶梯

| 层级 | 字号 | 字重 | 颜色 |
|------|------|------|------|
| 卡片标题 | 15px | 600 | `var(--ink)` |
| 开关标题 / 模式 chip | 14px / 13px | 500 | `var(--ink)` |
| 字段标签 | 13px | 500 | `var(--ink)` |
| 说明文字 / 元信息 / 计数 | 12px | 400 | `var(--muted)` |
| 结论文案 pass | 12px | 600 | `#2e9e5b` |
| 结论文案 warn | 12px | 600 | `#d97706` |
| 结论文案 fail | 12px | 600 | `#dc2626` |
| 强调条 pass / warn / fail | 3px 左边框 | — | `#2e9e5b` / `#d97706` / `#dc2626` |

**变量使用纪律**：只使用 `cohere-design-system.css` 中**确有定义**的令牌（`--ink`、`--muted`、`--canvas`、`--surface`、`--border-light`、`--card-border`、`--coral`、`--coral-soft`、`--error`、`--r-sm`、`--space-*`）。历史代码引用的 `--text-primary`、`--text-secondary`、`--surface-secondary`、`--border`、`--coral-bg` 均未定义，本次已全部替换。

### 6.3 响应式断点

| 断点 | 行为 |
|------|------|
| `> 820px` | 来源开关两列并排；字数控制 + 目标平台两列并排 |
| `<= 820px` | 两者均回落单列 |

### 6.4 空态 / 加载态 / 错误态

| 状态 | 表现 |
|------|------|
| 输入为空 | 计数显示「0 字」；开始改写按钮 disabled |
| 改写中 | 按钮文案切换为「改写中...」，全部配置控件禁用，结果卡片保持上次内容直至新结果写入 |
| 改写失败 | 卡片 B 底部显示错误条（浅红底 + 红色 12px 文字），按钮恢复可用 |
| 无质量报告 | 结果卡片内显示灰色小字「本次改写未生成质量评估」 |
| 结果为空 | 结果卡片整体不渲染 |

---

## 七、提示文字清单（本次零新增，全部复用现有 key）

| key | 中文文案 | 出现位置 |
|-----|---------|---------|
| `rewritePage.title` | 文案改写 | 页面主标题 |
| `rewritePage.subtitle` | AI 驱动的多策略文案改写引擎，结合爆款库与个人经历提升原创性 | 页面副标题 |
| `rewritePage.inputSection` | 输入文案 | 卡片 A 标题 |
| `rewritePage.inputPlaceholder` | 输入或粘贴需要改写的文案内容（最多 6000 字）... | 文本域占位符 |
| `rewritePage.charCount` | 字 | 计数后缀（显示为「N 字」） |
| `rewritePage.contentEmpty` | 请输入文案内容 | 内容为空时 |
| `rewritePage.configSection` | 改写设置 | 卡片 B 标题 |
| `rewritePage.useViralLibrary` | 结合爆款库 | 开关 1 标题 |
| `rewritePage.useViralLibraryHint` | 优先匹配爆款文案策略，提升内容吸引力和传播潜力 | 开关 1 说明 |
| `rewritePage.usePersonalExperience` | 结合个人经历 | 开关 2 标题 |
| `rewritePage.usePersonalExperienceHint` | 注入本地知识库中的个人偏好、写作风格和历史成功案例 | 开关 2 说明 |
| `rewritePage.modeLabel` | 改写模式 | 字段标签 |
| `rewritePage.modeImitate` / `modeExpand` / `modeCreate` | 智能仿写 / 扩写爆款 / 选题创作 | 模式 chips |
| `rewritePage.wordCountLabel` | 字数控制 | 字段标签 |
| `rewritePage.wordCountMinPlaceholder` / `MaxPlaceholder` | 最小 / 最大 | 输入框占位符 |
| `rewritePage.wordCountUnit` | 字 | 区间单位 |
| `rewritePage.wordCountMinInvalid` | 最小字数需为 0-5999 的整数 | 校验错误 |
| `rewritePage.wordCountMaxInvalid` | 最大字数需为 1-6000 的整数 | 校验错误 |
| `rewritePage.wordCountMaxLtMin` | 最大字数不能小于最小字数 | 校验错误 |
| `rewritePage.platformLabel` | 目标平台 | 字段标签 |
| `rewritePage.strategyLabel` | 改写策略 | 字段标签 |
| `rewritePage.strategyAuto` / `strategyManual` | 自动匹配 / 手动选择 | 单选 |
| `rewritePage.strategyPreview` + `strategyPreviewColon` | 将匹配策略： | 自动模式预览前缀 |
| `rewritePage.strategySelectPlaceholder` | -- 选择策略 -- | 下拉占位项 |
| `rewritePage.rewriteBtn` / `rewritingBtn` | 🔄 开始改写 / 改写中... | 主按钮两态 |
| `rewritePage.needLogin` | AI 改写需要登录后使用，是否立即登录？ | 登录门禁 |
| `rewritePage.resultSection` | 改写结果 | 卡片 C 标题 |
| `rewritePage.metaStrategy` / `metaAiTaste` | 策略 / AI味等级 | 元信息标签 |
| `rewritePage.metaLength` | `{original} 字 → {result} 字` | 元信息（**含参数插值，视觉改造不得拆散**） |
| `rewritePage.qualitySection` | 质量评估 | 质量面板标题 |
| `rewritePage.qualitySufficiency` / `qualitySemantic` / `qualityOriginality` | 改写充分度 / 语义保持度 / 原创性 | 指标标签 |
| `rewritePage.qualityVerdict` + `Pass` / `Warn` / `Fail` | 结论 + 合格 / 需注意 / 不合格 | 结论项 |
| `rewritePage.qualityMethod` + `Simhash` / `Embedding` | 评估方式 + SimHash 指纹 / 语义向量 | 评估方式 |
| `rewritePage.qualitySuggestions` | 改进建议 | 建议列表标题 |
| `rewritePage.qualityNone` | 本次改写未生成质量评估 | 无质量报告占位 |
| `rewritePage.saveDraft` / `goVideo` / `goPublish` | 💾 存入草稿 / 🎬 视频创作 / 🚀 去发布 | 结果区动作 |

---

## 八、测试与回归保护

### 8.1 CSS 契约测试（`src/styles/cohere-design-system.test.js`）

直接读取 CSS 文件断言规则体，**不依赖浏览器即可在 CI 拦截回退**：

| 断言 | 防的是什么 |
|------|-----------|
| `.rewrite-page` 含 `width: 100%` / `max-width: 900px` / `box-sizing: border-box` | 有人删掉宽度修复，抖动复发 |
| `.rewrite-result-meta` 含 `flex-wrap: wrap` | 结果元信息改用单行排布，重新撑宽页面 |

### 8.2 组件视觉契约测试（`src/views/RewriteView.test.js`）

读取 SFC 源码断言样式规则 + 渲染 DOM 断言结构：

| 断言 | 防的是什么 |
|------|-----------|
| `.config-switch input[type="checkbox"]` 含 `flex: 0 0 auto` + `width/height: 16px` | 勾选框重新被 flex 拉伸、脱离文字 |
| 源码含 `cursor: default`、`box-shadow: none` | 卡片回归「卡片墙」语义（手型光标 + 悬停浮起） |
| `.rewrite-quality-report` 含 `background: transparent` + `border-left: 3px` | 质量面板回退成卡片套卡片 |
| `.cohere-section-title` 含 `font-size: 15px` + `font-weight: 600` | 卡片标题重新失去层级 |
| `.config-switch` 数量为 2，且首个子元素是 `checkbox` | 勾选框位置被挪到文字右侧 |
| 勾选后 `is-on` 类跟随状态变化 | 视觉信号与真实状态脱钩 |
| `.config-grid` 存在且含 2 个 `.config-row` | 短字段并排结构被拆散 |
| `.rewrite-submit` 存在且内含开始改写按钮 | 执行区与配置区重新混在一起 |
| 质量报告带 `quality-accent-pass` | 结论强调条丢失 |

### 8.3 实测验证（Chromium via Playwright）

| 场景 | 断言 | 结果 |
|------|------|------|
| 初始态列宽 | `.rewrite-page` 宽度 = min(容器宽, 900) | 900 ✓ |
| 结果态列宽 | 与初始态**完全相同** | 900 ✓（修复前 474.11 → 543.69） |
| 窄屏 760px | 开关与字段回落单列 | `578px` 单列 ✓ |
| 浅色/深色 | 全部使用设计令牌，自动适配 | ✓ |

---

## 九、Bug 反思（QM-5 五步）

### ① 第一性原因溯源

`.rewrite-page` 的 `max-width + margin: 0 auto` 是**被当作块级居中写法**写下的（该写法对普通块级父容器成立）。但它实际位于 `display: flex; flex-direction: column` 的 `.cohere-main` 中——在 flex 格式化上下文中，交叉轴 `auto` margin 会抑制 stretch，语义变成「按内容收缩后居中」。**写法正确但前提假设（父容器是普通块级）不成立**，且该假设从未被验证。

### ② 测试逃逸分析

| 测试层级 | 为什么没拦住 |
|---------|-------------|
| 单元测试（vitest + jsdom） | jsdom **没有布局引擎**，`getBoundingClientRect()` 恒返回 0，任何宽度断言都不可能失败 |
| 视觉测试（Playwright 截图） | `all-views.visual.test.js` 的 `rewrite` 条目只断言选择器存在，**不校验尺寸稳定性**；且截图在「无改写结果」状态拍摄，抖动状态根本没被覆盖 |
| 代码审查 | 静态审查 CSS 很难发现「flex 交叉轴 auto margin 抑制 stretch」这类**语义级**问题 |
| 人工验收 | 需要「改写成功 + 结果卡片渲染」这一特定路径才能复现，且是渐变式抖动，容易被当作渲染卡顿忽略 |

### ③ 系统性漏洞定位

- **视觉测试套件的断言语义不足**：`tests/visual-testing/views/all-views.visual.test.js` 的 `checks` 只支持 `{selector}` / `{text}`（存在性），**没有尺寸/布局断言能力**（见 `test-runner.js` 的 `aiVisionTest`）。
- **CSS 契约测试覆盖面缺口**：项目已有 `cohere-design-system.test.js` 这一正确的机制，但只覆盖了顶部导航，**未覆盖在 flex 容器内使用 auto margin 的页面根容器**。

### ④ 修复 + 回归保护测试

**修复**（`src/styles/cohere-design-system.css`）：

```css
.rewrite-page {
  width: 100%;          /* 新增：阻断 fit-content 退化 */
  max-width: 900px;
  margin: 0 auto;
  box-sizing: border-box; /* 新增：避免 padding 参与宽度计算 */
}
```

**回归保护**：

1. `cohere-design-system.test.js` → `describe('改写页列宽合同')`，2 条 CSS 断言；
2. `RewriteView.test.js` → `describe('RewriteView — 视觉契约')` + `describe('RewriteView — 设置区结构与布局契约')`，共 11 条；
3. Playwright 实测脚本验证「有/无结果卡片时列宽一致」。

### ⑤ 预防措施

1. **已落地**：把「flex 容器内页面根容器必须显式声明 width」写入 CSS 注释（就在规则旁边，改代码的人必然看到）；
2. **已落地**：CSS 契约测试新增「改写页列宽合同」分组，作为该类问题的拦截点；
3. **待排期（已登记）**：为 `tests/visual-testing` 的 `checks` 增加 `minWidth` / `maxWidth` / `stableWidth` 断言类型，使视觉套件具备尺寸稳定性校验能力；
4. **已登记**：排查其它页面是否同样在 flex 容器内用 `margin: 0 auto` 做居中（同类风险），逐个确认。

---

## 十、遗留与后续

| 项 | 说明 | 优先级 |
|----|------|--------|
| 视觉套件尺寸断言能力 | `checks` 增加尺寸稳定性断言类型 | P1 |
| 同类风险普查 | 其它 `margin: 0 auto` 页面根容器在 flex 容器中的宽度行为 | P1 |
| 未定义 CSS 变量清理 | 全仓仍有 `--text-primary` / `--text-secondary` / `--surface-secondary` / `--border` / `--coral-bg` 的引用（本次仅清理改写页） | P2 |
| 共享组件字号统一 | `RewriteStrategyPicker` 内部 12px 字号由父级 `:deep()` 覆盖，非根治 | P2 |
