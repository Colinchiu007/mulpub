# PRD：中文字体自包含 + 创作内容字体（得意黑 SmileySans）

- **分支**：`cjk-font-selfcontained`
- **日期**：2026-10-16
- **状态**：已实现（待 CI 合并）
- **关联**：`apps/desktop/electron/services/font-resolver.js`、`apps/desktop/src/public/fonts/`、`openspec/records/cjk-font-selfcontained.md`

---

## 1. 背景与问题

### 1.1 触发问题（用户原话）

1. 「我担心将来有用户是用英文版 Windows 系统，但是他需要使用中文」
2. 「现在应用中进行视频创作时，添加中文字幕时指定具体中文字体了吗？中文字幕需要改成使用得意黑」
3. 「把得意黑这套字体文件也包含到项目中，而且在发布打包成安装文件时也要包含」
4. 「这里面的 4 个文件，你分析一下，都需要用吗？需要考虑到在未来，这个客户端软件，是用在 Windows 系统和 macOS 系统」

### 1.2 代码现状勘察结论（2026-10-16，实证）

**中文字体曾经自包含，后被误删。** 三个事实：

| 事实 | 证据 |
| --- | --- |
| PR #1361（`83b97cee6`，2026-09-03）引入过 Noto Sans CJK SC + Noto Color Emoji，共约 26 MB | `git ls-tree -r -l 83b97cee6 -- apps/desktop/src/public` 给出两个 blob（16,437,364 B / 10,673,480 B） |
| `08e7d95a6`（2026-09-04）「chore: normalize line endings + accumulated workspace changes」把两个字体文件**删除** | `git show --name-status 08e7d95a6 -- apps/desktop/src/public` 输出两行 `D`；提交信息完全没提删字体 |
| 删除只删了一半：`extraResources` 声明与 CSS `@font-face` 都还在，指向不存在的文件 | `apps/desktop/package.json:157` 的 `{from:"dist/fonts"}` 每轮打包报 `file source doesn't exist`；CSS 的 `url('/fonts/NotoSansCJKsc-Regular.otf')` 恒 404 |

### 1.3 三条链路的实际风险（分等级）

| 链路 | 渲染引擎 | 字体来源 | 无 CJK 字体时的后果 | 等级 |
| --- | --- | --- | --- | --- |
| **封面生成**（图文发布必需） | sharp → librsvg/Pango | SVG `font-family` 系统栈 | **实测封面 5.639% 像素差异，标题/徽章/关键词三条中文全灭**（豆腐块） | 🔴 高 |
| **视频字幕 / 水印** | ffmpeg `drawtext` | `fontfile` 或 fontconfig | 中文渲染成方块，且 `rc=0`、stderr 干净 | 🔴 高 |
| **占位图**（`asset-generator`） | ffmpeg `drawtext` | 原先**完全不注入 fontfile** | 必定豆腐块（2026-10-09 快手足图文实锤 `img_9400.png`，仅 ASCII 可读） | 🔴 高 |
| **Python 后端模板** | HTML 模板 | 首选项 `'Noto Sans CJK SC'` | 首选项落空，回落 `Segoe UI` 无 CJK 字形 | 🟠 中 |
| **应用界面 UI** | Electron/Chromium | `'Noto Sans CJK SC','PingFang SC','Microsoft YaHei'` | 英文版 Windows 有雅黑 ⇒ 正常；精简镜像/headless Linux ⇒ 豆腐块 | 🟡 低 |

**关键澄清（避免误判风险面）**：Windows 的 CJK 字体（`msyh.ttc`/`simsun.ttc`/`simhei.ttf`）是**镜像内建**的，不随语言包安装，因此「英文版 Windows + 中文」在 UI 层通常没问题。真正的风险不在语言，而在**字体解析链本身不可控**：精简/企业定制镜像、LTSC、用户手动卸载字体、headless Linux、以及**应用被安装到含中文的路径**（见 §3）。

### 1.4 用户诉求拆解

- P0：中文字幕必须使用**得意黑**（用户点名）。
- P0：得意黑**必须随安装包分发**（不能依赖用户系统）。
- P0：修复三处遗留（`extraResources` 死配置 / CSS `@font-face` / `resolveCjkFont` 未接线）。
- P1：给出 4 个字体文件的取舍结论，并覆盖 **Windows + macOS** 双平台。
- P1：详细文档（数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字）。

---

## 2. 字体资产决策（4 个文件取舍）

### 2.1 实测元数据（`dfont` 级解析，非猜测）

| 文件 | 体积 | 容器 | 轮廓 | cmap | CJK 基本区 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `SmileySans-Oblique.otf` | 1.91 MB | CFF/OTF | CFF | fmt12 | 8050 | ✅ **入库** |
| `SmileySans-Oblique.ttf` | 2.51 MB | TrueType | glyf | fmt12 | 8050 | ❌ 不入库（与 otf 同字形、大 0.6 MB） |
| `SmileySans-Oblique.otf.woff2` | 1.30 MB | WOFF2 | — | — | — | ❌ 不入库（ffmpeg/sharp 不认） |
| `SmileySans-Oblique.ttf.woff2` | 1.15 MB | WOFF2 | — | — | — | ❌ 不入库（同上） |

字形覆盖实测：`total 9440` 码位 = CJK 基本区 **8050** + 扩展 A **79** + CJK 标点 **20** + 全角 **100** + ASCII **95**。覆盖 GB2312 一级+二级字，字幕/封面场景足够。

字体元数据：`family=得意黑`、`subfamily=Regular`、`fullname=得意黑 斜体`、`italicAngle=-8.0`、`fsSelection italic=1`。
→ **得意黑 2.0.0 只发布斜体（Oblique）字形，不存在正体版本**；`-8°` 倾斜是字体设计本身，不是 CSS 倾斜。

### 2.2 为什么只带 `.otf`

1. **两者字形完全一致**（同一 release 的两种轮廓编码），OTF 小 0.6 MB。
2. **ffmpeg drawtext 实测两者都可用**（`SmileySans-Oblique.otf` 与 `.ttf` 渲染字节 5495 / 5553，视觉一致）。
3. **sharp/Pango 两者都可用**（验证方式：fontconfig 唯一字体源指向该目录时，`format=sans-serif` 也渲染出得意黑字形，sha `66a901dc912f`）。
4. **woff2 对 ffmpeg/sharp 完全无效** —— 它是 Web 专用压缩容器，只有 Chromium 能解。本方案 UI **不使用**得意黑（见 §5），故 woff2 无消费方。
5. macOS 兼容：OTF 是跨平台格式，macOS 原生支持；且**同一份文件**同时服务 Windows 与 macOS，无需按平台分叉。

### 2.3 许可

SIL OFL 1.1，允许自由使用/修改/再分发/商用，**硬性要求「每份副本必须包含版权声明与本许可证」**。
落地：`apps/desktop/src/public/fonts/SmileySans-OFL-LICENSE.txt`（含 OFL 1.1 全文 + 字体来源 + 版权 + 「本 release 为斜体」说明），并纳入打包（同目录随 `extraResources` 进包）。

---

## 3. 技术难点与方案（含被否证的方案）

### 3.1 难点一：ffmpeg `fontfile` 对非 ASCII 路径**静默失败**

**实测（四组隔离对照）**：

| 目录 | 文件名 | 结果 |
| --- | --- | --- |
| ASCII | ASCII | `bytes=5495` ✅ 有字形 |
| ASCII | 中文 | `bytes=765` ❌ 豆腐块 |
| 中文 | ASCII | `bytes=765` ❌ 豆腐块 |
| 中文 | 中文 | `bytes=765` ❌ 豆腐块 |

判据：**目录名或文件名任一含非 ASCII 字符即失败**，且 `rc=0`、stderr 干净、不抛异常。
风险面：用户把应用装到 `D:\软件\社媒管家\`，或 Windows 用户名含中文导致 `%TEMP%` 路径含中文 —— 自包含字体形同虚设。

**方案**：`font-resolver` 统一把字体复制到 **ASCII 安全路径**（`os.tmpdir()/mp-fonts/SmileySans-Oblique.otf`），并把副本路径交给 ffmpeg。副本名与目录名均为模块级常量（纯 ASCII），命中已存在副本时跳过拷贝（幂等，1.9 MB 不重复写）。

### 3.2 难点二：sharp **无法**加载未注册到 fontconfig 的字体

**被否证的三个方案**（全部实测无效）：

| 方案 | 结果 |
| --- | --- |
| sharp `font` 选项传**字体文件路径** | 与不传逐字节相同（`sha` 相同）⇒ 选项被静默忽略 |
| sharp `font` 选项传**字体目录** | 同上，无效 |
| CSS `@font-face` + `url()` | SVG 经 sharp 栅格化时**不读 @font-face** |

**唯一可行方案**：给渲染**子进程**注入 `FONTCONFIG_FILE`，把自带字体目录写入 `<dir>`。
- 必须是**子进程**：`FONTCONFIG_FILE` 由 libfontconfig 在进程启动时读取，同进程改 `process.env` 后再调 sharp 完全无效（单例已初始化）。
- `<dir>` 必须是**目录**（传单个 `.ttf`/`.otf` 文件路径会被当成目录，静默失效）。
- 路径必须转**正斜杠**：fontconfig 遇反斜杠报 `ambiguous path` 并静默跳过该目录（实测 V3 变体因此失败）。
- 必须**同时保留系统字体目录**，否则西文一起变豆腐块。

**有效性判据（前后 sha 不同）**：仅系统字体时 `sha=85c1cc5c8df0`；加入得意黑目录后 `sha=66a901dc912f` ⇒ 字体确实被采用，而非回落系统字体。

### 3.3 难点三：各链自抄解析逻辑必然漂移

四条链（字幕 / 水印 / 封面 / 占位图）+ 一条 UI 链都要同一判据。
**方案**：单一实现 `electron/services/font-resolver.js`，导出 `resolveContentCjkFont()`（ffmpeg 用）与 `buildFontconfigForSharp()`（sharp 用）。

### 3.4 难点四（本 PR 最严重的缺陷）：`extraResources` 的落点是 `resources` 目录，不是安装根

**缺陷形态**：首版 `resolveAppRoot()` 把 `process.resourcesPath` 的**父目录**当成字体根：

```js
// ❌ 事故写法
return path.dirname(process.resourcesPath)   // <installRoot>/resources → <installRoot>
// 候选推出 → <installRoot>/fonts/SmileySans-Oblique.otf   ← 不存在
```

而 `extraResources` 的 `to: "fonts"` 是相对 **`resources` 目录**展开的，字体实际在：

```
<installRoot>/resources/fonts/SmileySans-Oblique.otf   ← 真实位置
```

**后果（真实产物实测，覆写 `process.resourcesPath`）**：

| | `packagedFontCandidates()` | `resolveContentCjkFont()` |
| --- | --- | --- |
| 修复前 | `<win-unpacked>/fonts/...` `exists=false`<br>`<win-unpacked>/src/public/fonts/...` `exists=false` | `{"fontFile":"C:\\Windows\\Fonts\\msyh.ttc","source":"system"}` |
| 修复后 | `<win-unpacked>/resources/fonts/...` `exists=true` | `{"fontFile":"...\\mp-fonts\\SmileySans-Oblique.otf","source":"bundled"}` |

**即：安装后的应用永远不会使用自带得意黑**，无 CJK 字体的机器上照样豆腐块 ——
**整个「自包含」特性在生产上完全失效，而打包 `rc=0`、启动 stderr 0 字节、全量测试全绿。**

**为什么测试没抓到（两个系统性盲区）**：

1. **断言是条件式的**：`if (r.fontFile && r.source === 'bundled') { … }` —— `source` 不是 `bundled` 时**静默跳过**整段断言，等于没有断言。
2. **测试环境的 cwd 恰好掩盖了缺陷**：从 `apps/desktop` 作 cwd 跑 vitest 时，dev 候选 `<cwd>/src/public/fonts/` **真实存在** ⇒ 测试里恒为 `bundled`；缺陷**只在打包态显形**。

**修法与锁**：

```js
// ✅ 正确：to 相对 resources 展开
function packagedFontCandidates () {
  return [path.join(process.resourcesPath, 'fonts', BUNDLED_FONT_BASENAME)]
}
```

`font-resolver.test.js` 契约⑥（4 例）：**自建真实 `resources/fonts/` 布局 + 覆写 `process.resourcesPath`**，
**无条件**断言 `source === 'bundled'`、副本字节等于那份假字体、且副本不在 `resources` 下。

**定向变异 M8**（把落点改回 `dirname(resourcesPath)`）：正控 GREEN ⇒ **CAUGHT**，2 条指名用例变红，还原逐字节 IDENTICAL。

**可推广教训**：`fs.existsSync` 型判据里凡出现 `process.resourcesPath` / `app.getAppPath()` / `__dirname`，必须先问「**这个相对基准在打包前后是否同一个**」——
打包态与开发态的目录层级**经常差一级**，而 dev 候选的存在会让测试给出与生产相反的结论。
判据侧的对策是：**验打包语义的锁必须自造打包布局**，不能靠「在仓库里跑一跑」。

---

## 4. 功能逻辑

### 4.1 字体解析优先级（`resolveContentCjkFont`）

```
① 自包含得意黑（bundled）
   ├─ 候选路径：<installRoot>/fonts/SmileySans-Oblique.otf      （打包态，extraResources）
   │            <appRoot>/src/public/fonts/SmileySans-Oblique.otf（开发态，Vite publicDir）
   ├─ 复制到 ASCII 副本 → 返回副本路径，source='bundled'
   └─ 源存在但拷贝失败 ⇒ 不静默当"无字体"，继续 ②
② 系统 CJK 字体（system，仅 win32）
   msyh.ttc → msyh.ttf → simhei.ttf → simsun.ttc → msjh.ttc
   └─ 每项必须过 ASCII 校验
③ 无可用字体 ⇒ fontFile='', source='none'
   └─ 调用方不注入 fontfile，交由 fontconfig 处理（不报错、不阻断）
```

**返回值契约**：`{ fontFile: string, source: 'bundled'|'system'|'none' }`
- `fontFile` 非空 ⇒ **必为 ASCII 路径**（正则 `^[\x20-\x7E]+$`）。
- **任何情况下不抛异常**（字体问题只影响字形，不该炸掉发布/合成链）。

### 4.2 fontconfig 生成（`buildFontconfigForSharp`）

```
输入：fontDir（ASCII 安全目录，含得意黑）
输出：{ fontconfigFile, injected }
逻辑：
  dirs = []
  if fontDir 存在且为目录且 ASCII 安全 ⇒ dirs.push(fontDir)
  if dirs 为空 ⇒ return { injected: false }（不伪造配置文件）
  dirs.unshift(系统字体目录)   // C:/Windows/Fonts 或 /usr/share/fonts
  写 <tmpRoot>/mp-fonts/fonts.conf：
    <fontconfig>
      <dir prefix="cwd">C:/Windows/Fonts</dir>
      <dir prefix="cwd"><fontDir，正斜杠></dir>
      <cachedir><tmpRoot>/mp-fonts/fontconfig-cache</cachedir>
    </fontconfig>
```

### 4.3 字幕与水印（`story2video-compose-engine`）

- `resolveCjkFont()` 改为委托 `resolveContentCjkFont()`，结果缓存（同进程内稳定，不重复拷 1.9 MB）。
- `buildSubtitleFilter()` 与 `buildWatermarkFilter()` **都**注入 `fontfile`（此前只有字幕侧有断言覆盖，水印侧无覆盖）。
- 转义沿用 `escapeFontFilePath()`：反斜杠归一为正斜杠 + 冒号转义为 `\:`。
- **顺带修复一处历史 bug**：原 `CJK_FONT_CANDIDATES` 写作 `'C:\\\\Windows\\\\Fonts\\\\msyh.ttc'`（JS 字符串里双层反斜杠 ⇒ 实际值 `C:\\Windows\\...`），`fs.existsSync` 永远匹配不到真实路径 ⇒ **系统字体回落实际上一直是失效的**。候选清单已移入 `font-resolver` 并改为单反斜杠。

### 4.4 占位图（`asset-generator.generateImage`）

`drawtext` 滤镜新增 `fontfile` 注入（此前完全不注入 ⇒ 中文必定豆腐块，2026-10-09 实锤）。
解析失败时 `fontOption=''`（不阻断占位图生成，西文 prompt 仍可渲染）。

### 4.5 封面（`local-cover-generator`）

- 字体栈：`'Smiley Sans','Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif`（自包含优先，系统栈次选）。
- 栅格化改走**子进程** `electron/services/.cover-rasterize-worker.js`，由父进程注入 `FONTCONFIG_FILE` + `FONTCONFIG_PATH`。
- worker 缺失（裁剪过的产物）时**退回直接 `sharp()` 渲染**，至少有系统字体兜底。
- worker 参数用 `--svg-file <ASCII 临时文件>` 而非命令行传 SVG 内容，避免中文/超长参数问题。
- 子进程超时 60 s；超时/非零退出/产物缺失均抛错，由 `generateLocalCover` 统一转 `code:-1`。

### 4.6 UI 字体栈（`cohere-design-system.css`，20 处）

| 层 | 字体 | 理由 |
| --- | --- | --- |
| 1 | `'PingFang SC'` | macOS 系统中文字体，非斜体，适合长文阅读 |
| 2 | `'Microsoft YaHei'` | Windows 系统中文字体，同上 |
| 3 | `'Smiley Sans'` | 自包含兜底（**斜体**）：仅当系统无中文字体时生效 |
| 4 | `ui-sans-serif, system-ui, sans-serif` | 通用兜底 |

`@font-face` 声明改为指向真实存在的 `SmileySans-Oblique.otf`：
```css
@font-face {
  font-family: 'Smiley Sans';
  src: local('Smiley Sans'), local('得意黑'),
       url('/fonts/SmileySans-Oblique.otf') format('opentype');
  font-display: swap;
}
```
`local()` 在前 ⇒ 系统已装该字体时不重复下载。

**为什么 UI 不用得意黑打头**：得意黑是 `-8°` 斜体设计，整屏中文倾斜会显著降低长时间阅读舒适度，且与 `DESIGN.md` 的字体规范冲突。UI 定位为「系统字体优先，得意黑兜底」。

### 4.7 打包（`extraResources`）

```json
{ "from": "dist/fonts", "to": "fonts" }
```
- 源：Vite `publicDir` 默认 `<root>/public` = `src/public` ⇒ 构建时 `src/public/fonts/` 拷到 `dist/fonts/`。
- 目标：`<resourcesPath>/fonts/`（asar 之外，松散资源树）。
- **此条从「死配置」变为真配置**：源目录现已存在，打包不再报 `file source doesn't exist`。

---

## 5. 数据校验

| # | 校验项 | 判据 | 失败行为 |
| --- | --- | --- | --- |
| V1 | 字体源文件存在 | `fs.existsSync(FONT_FILE)` | 回落系统字体；测试 `bundled-font-packaging` 判红 |
| V2 | 体积区间 | `> 1 MiB && < 8 MiB`（防 0 字节空壳 / 防误塞巨型文件） | 测试判红 |
| V3 | sfnt 魔数 | 前 4 字节 == `OTTO`（CFF/OpenType） | 测试判红 |
| V4 | 无 WOFF2 入库 | 目录内 `.woff2` 计数 == 0 | 测试判红 |
| V5 | 副本字节一致 | `copiedSize === sourceSize`，否则视为拷贝失败 | 返回 `''`，继续回落 |
| V6 | **ASCII 安全** | `^[\x20-\x7E]+$` 命中 `fontFile` | 返回 `''`；`font-resolver.test.js` 契约⓪/①/④b 判红 |
| V7 | 副本落点稳定 | `basename === 'SmileySans-Oblique.otf'` 且 `dirname` 以 `mp-fonts` 结尾 | 测试判红（写死字面量，不用导入常量当期望） |
| V8 | 幂等性 | 二次调用不改写副本（mtime 不变） | 测试判红 |
| V9 | 许可证存在且正确 | 含 `SIL OPEN FONT LICENSE` + `Version 1.1` + `得意黑` + `SmileySans` | 测试判红 |
| V10 | `extraResources` 声明 | 存在 `to === 'fonts'` 且 `from === 'dist/fonts'` | 测试判红 |
| V11 | CSS 不指向已删字体 | 不含 `NotoSansCJKsc-Regular.otf` / `NotoColorEmoji.ttf` | 测试判红 |
| V12 | 字体栈顺序 | 栈首为 `'PingFang SC'`，`'Smiley Sans'` 在系统字体之后 | 测试判红 |
| V13 | **打包落点正确** | 覆写 `process.resourcesPath` 到自建布局后，`packagedFontCandidates()[0] === <resourcesPath>/fonts/<basename>` | 测试判红（契约⑥第 1 例） |
| V14 | **打包态必须解析到 bundled** | 自建真实 `resources/fonts/` 后 `resolveContentCjkFont()` 的 `source === 'bundled'`，且副本字节 == 那份源文件、副本不在 `resources` 下 | 测试判红（契约⑥第 2 例；**该条若缺失，V13 单独不足以防事故**） |
| V15 | 打包态候选优先 | `bundledFontCandidates()` 的前 N 项 == `packagedFontCandidates()` | 测试判红（契约⑥第 3 例） |
| V16 | 开发态候选指向 Vite publicDir | `devFontCandidates()[0]` 后缀匹配 `/apps/desktop/src/public/fonts/SmileySans-Oblique\.otf$` 且文件存在 | 测试判红（契约⑥第 4 例） |

**失败不抛异常**（契约）：所有路径 `try/catch` 吞掉异常并返回安全值；字体缺失只影响字形，**不得阻断发布/合成链**。

**⛔ 断言形态纪律（V13–V16 的由来）**：凡「验打包语义」的断言，必须满足两条 ——
① **无条件**（不得写成 `if (source === 'bundled') { … }`，那在 `source` 不符时静默跳过）；
② **自造打包布局**（覆写 `process.resourcesPath` 指向临时 `resources/fonts/`），
不得依赖「在仓库里跑一跑」——dev 候选的存在会让测试恒绿而生产恒红。

---

## 6. 交互逻辑

本特性**无新增用户交互**（纯渲染管线修复），但影响既有交互的**结果可见性**：

| 触发交互 | 受影响产物 | 预期变化 |
| --- | --- | --- |
| 图文发布 → 选封面 → AI 生图失败 | 本地兜底封面 | 中文标题/徽章/关键词从「豆腐块」变为**正确字形**（得意黑） |
| 视频创作 → 添加中文字幕 | 成片字幕 | 中文从「方块」变为**得意黑字形**（`-8°` 倾斜） |
| 视频创作 → 启用水印 | 成片水印 | 同上 |
| Story2Video → 生图失败 | ffmpeg 占位图 | 中文从「方块」变为正确字形 |
| 播客/视频 → Python 模板渲染 | 模板页 | 中文字体栈首选项不再落空 |
| 应用启动（无中文字体机器） | 界面中文 | 从「豆腐块」变为得意黑（斜体）兜底 |

---

## 7. 显示项与提示文字

**本特性不新增任何用户可见文案，因此不新增 locale 键**（`apps/desktop/src/locales/{zh,en}.js` 零改动）。

理由：字体是**渲染管线内部行为**。产品语义上「字幕用什么字体」是既有能力的实现修正，不产生新 UI 元素、新按钮、新提示。若强行加「已启用中文字体」提示条，属无价值打扰。

**受影响的既有显示项**（内容变了，文案不变）：

| 显示项 | 位置 | 变化 |
| --- | --- | --- |
| 封面徽章文字 | `local-cover-generator` SVG `bitmap label` | 字形从方块 → 得意黑 |
| 封面标题 | 同上 `bitmap tspans` | 同上 |
| 封面关键词行 | 同上 | 同上 |
| 视频字幕 | ffmpeg `drawtext` | 同上 |
| 视频水印 | 同上 | 同上 |
| 占位图文字 | `asset-generator` ffmpeg | 同上 |

**字体栈文档化提示**（给后续维护者，写进代码注释而非 UI）：
- 「UI 用系统字体优先、得意黑兜底」——改动此顺序会让整屏中文变斜体。
- 「创作内容一律走 `font-resolver`，禁止各链自抄」——自抄必然漂移出「某条链还是有豆腐块」。

---

## 8. 流程（端到端）

### 8.1 打包流程

```
pnpm build:vue（或 build:dir）
  └─ Vite 以 root=src、publicDir=src/public 构建
       └─ src/public/fonts/{SmileySans-Oblique.otf, SmileySans-OFL-LICENSE.txt}
            ↓ 原样拷贝
          dist/fonts/{同上}
electron-builder --win --dir
  └─ extraResources: { from: "dist/fonts", to: "fonts" }
       └─ dist-electron/win-unpacked/resources/fonts/{同上}
```

### 8.2 运行期解析流程

```
[ffmpeg 链：字幕 / 水印 / 占位图]
  调用 resolveContentCjkFont()
    ├─ 找 <installRoot>/fonts/SmileySans-Oblique.otf（打包态）
    ├─ 拷到 <os.tmpdir()>/mp-fonts/（ASCII 副本，幂等）
    └─ 返回 ASCII 副本路径
  ↓
  escapeFontFilePath() → "D\:/Temp/mp-fonts/SmileySans-Oblique.otf"
  ↓
  drawtext=text='...':fontfile='D\:/Temp/mp-fonts/SmileySans-Oblique.otf':...

[sharp 链：封面]
  调用 buildFontconfigForSharp({ fontDir: <ASCII 副本目录> })
    └─ 写 <os.tmpdir()>/mp-fonts/fonts.conf（系统目录 + 得意黑目录，正斜杠）
  ↓
  spawn(node, [.cover-rasterize-worker.js, --svg-file <ASCII tmp.svg>, --out <png>],
        { env: { FONTCONFIG_FILE, FONTCONFIG_PATH } })
  ↓
  worker 读 SVG → sharp() → PNG
```

### 8.3 排障流程

| 现象 | 首查 | 判据 |
| --- | --- | --- |
| 字幕/水印仍是方块 | `resolveContentCjkFont()` 返回值 | `source` 是否 `bundled`；`fontFile` 是否 ASCII |
| 封面中文是方块 | 子进程 env | `FONTCONFIG_FILE` 是否注入；`fonts.conf` 的 `<dir>` 是否正斜杠 |
| 打包后字体不在包内 | `resources/fonts/` 是否存在 | `dist/fonts/` 是否在打包前存在 |
| 界面中文变斜体 | 是否符合预期 | 系统无中文字体 ⇒ 兜底生效，属预期 |

---

## 9. 验收标准

| # | 标准 | 证据 |
| --- | --- | --- |
| A1 | 得意黑随包分发 | `resources/fonts/SmileySans-Oblique.otf` 在 QM-1 产物内 + OFL 许可证同目录 |
| A2 | 字幕使用得意黑 | `buildSubtitleFilter` 注入的 `fontfile` 指向 ASCII 副本；`font-resolver.test.js` 契约 |
| A3 | 水印使用得意黑 | 同上，且与字幕**同一路径**（专项测试断言二者相等） |
| A4 | 无 CJK 字体环境下封面中文正常 | 端到端实测：fontconfig 隔离为无 CJK，`generateLocalCover` 产出封面中文完整渲染（目视 + sha 对比） |
| A5 | 非 ASCII 安装路径下仍正常 | 四组隔离对照证明 ASCII 副本绕过 ffmpeg 路径敏感性 |
| A6 | 三处遗留全部修复 | `extraResources` 有真源、CSS 指向存在文件、`resolveCjkFont` 委托 `font-resolver` |
| A7 | 无不必要入库的字体文件 | `bundled-font-packaging.test.js` 契约①第 4 条（无 `.woff2`） |
| A8 | 零回归 | desktop 全量 **16974 passed / 5 skipped（954 文件）**，exit 0 |
| A9 | **打包态真的用上自带字体** | 真实产物 + 覆写 `process.resourcesPath` ⇒ `source === 'bundled'`、副本字节 2,003,884 == 源（**该条是本 PR 最严重的验收项** —— 修复前为 `source === 'system'`，特性在生产完全失效而全部其它判据均为绿） |
| A10 | 字体进包且三处字节一致 | `src/public/fonts` → `dist/fonts` → `resources/fonts` 的 SHA256 全等 `139B5DCBE70D6D52`；OFL 许可证同目录 |

---

## 10. 测试

| 测试文件 | 用例数 | 锁什么 |
| --- | --- | --- |
| `electron/services/font-resolver.test.js` | 23 | ASCII 判据正反两面、副本落点、中文源路径、不抛异常、优先级可观测、系统候选 ASCII、**打包态路径解析 4 例（契约⑥）** |
| `electron/tests/bundled-font-packaging.test.js` | 14 | 字体在库/体积/魔数/无 woff2、OFL 许可证、`extraResources` 有真源、CSS 不指向已删字体、字体栈顺序、fontconfig 可用 |
| `electron/services/story2video-compose-engine.test.js` | +4（共 153） | 字幕与水印都注入 ASCII 安全 `fontfile`、二者同源、副本落点固定、结果缓存 |
| `electron/services/local-cover-generator.test.js` | 18 | 子进程栅格化后仍产出合法 PNG 与正确尺寸 |

**变异反证**：8 条变异（M1–M8），正控 GREEN，**7/8 CAUGHT**，还原后逐字节相同。
- **M8（打包落点改回 `dirname(resourcesPath)` 的事故写法）⇒ CAUGHT**，`font-resolver.test.js` 契约⑥ 的 2 条指名用例变红 —— 这是本轮补的关键锁，直接对应 §3.4 的 CRITICAL 缺陷。
- 唯一未捕获的 M3（删掉系统字体候选的 ASCII 校验）：因 `SYSTEM_FONT_CANDIDATES` 是模块级常量且全 ASCII，**删校验在当前数据下语义等价** —— 属防御性冗余，无法用行为区分。如实记录，不制造脆弱测试去凑红。
- 补强过程记录：首轮仅 **1/7** 捕获 → 暴露出四个真实测试盲区（判据函数自身未拷打 / `catch` 分支走不到 / 用导入常量当期望值 / 时间型断言不可靠），逐条补强后 **6/7**；打包后自查又发现第五个盲区（**条件式断言 + dev 候选掩盖打包缺陷**）并补上契约⑥，该盲区由 M8 验证已闭合。

---

## 11. 风险与局限

| 风险 | 等级 | 处置 |
| --- | --- | --- |
| 得意黑只有斜体字形，字幕带 `-8°` 倾斜 | 中 | **已知设计**（字体本身如此），用户点名要求使用该字体；如需正体需另行获取字体文件 |
| 每次进程启动首次调用拷贝 1.9 MB 到 tmp | 低 | 幂等（命中即跳过），仅在首次调用发生一次 |
| tmp 目录被清理后需重新拷贝 | 低 | 幂等逻辑自然处理；失败则回落系统字体 |
| macOS 未实测（无本机环境） | 中 | 本方案不依赖平台分支：ASCII 副本 + fontconfig 均跨平台；`buildFontconfigForSharp` 非 win32 时用 `/usr/share/fonts`。**如实登记为未实测**，由 CI/用户实机承担 |
| 无 CJK 字体 + 系统无 fontconfig 的极端环境 | 低 | `injected:false` 时退回直接渲染，至少有系统兜底，不崩 |
| `os.tmpdir()` 位于含中文路径（Windows 用户名含中文） | 低 | 副本路径会含中文 ⇒ `isAsciiSafe(dest)` 判 false ⇒ 返回 `''` 回落系统字体（诚实降级，不产出豆腐块当成功） |

---

## 12. 档案

- 实现：`apps/desktop/electron/services/font-resolver.js`、`.cover-rasterize-worker.js`、`local-cover-generator.js`、`asset-generator.js`、`story2video-compose-engine.js`
- 资产：`apps/desktop/src/public/fonts/SmileySans-Oblique.otf`、`SmileySans-OFL-LICENSE.txt`
- 配置：`apps/desktop/package.json`（`extraResources`）、`apps/desktop/src/styles/cohere-design-system.css`
- 模板：`packages/python-backend/templates/{1920x1080,1080x1920,1080x1080}/default.html`
- 执行记录：`openspec/records/cjk-font-selfcontained.md`
