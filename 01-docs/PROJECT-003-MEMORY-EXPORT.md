# Multi-Publish (PROJECT-003) 记忆导出

> 导出时间: 2026-06-17 | 版本: v1.1.7
> 用途: 供另一设备的 OpenCode 导入，快速了解所有工作情况

---

## 一、项目全局记忆 (projects/global/MEMORY.md)

### 1.1 项目概览

**PROJECT-003: Multi-Publish（多平台一键发布）**
- **GitHub**: Colinchiu007/Multi-Publish
- **技术栈**: Electron 33.4.0 + Vue 3 + Playwright RPA + SQLite + Python (FastAPI)
- **打包**: electron-builder 25.1.8, NSIS installer
- **当前版本**: v1.1.7（所有 package.json 已统一）
- **安装包**: 236MB（含 Playwright Chromium 浏览器），GitHub Release 已发布
- **状态**: 12个平台支持，59单元测试通过

**已支持平台**: 微信公众号、知乎、微博、抖音、小红书、视频号、快手、今日头条、YouTube、TikTok、B站、百家号

**架构**: Monorepo
```
apps/desktop/          — Electron 桌面应用 (Vue 3 + Playwright)
packages/rpa-engine/   — 12平台 RPA 发布引擎
packages/shared-utils/ — 共享工具库
packages/python-backend/ — Python FastAPI 后端
```

**关键特性**:
- Playwright RPA 自动化发布
- Cookie AES-256-GCM 加密存储
- 定时发布 + 批量发布 (并发3任务)
- 分屏监控 (2/3/4/6屏)
- 系统托盘 + 全局快捷键
- 自动更新 (GFW 静默)
- 内容采集 (URL HTTP + Playwright 双模式)

---

### 1.2 参考产品逆向分析集成 (v1.0.13)

从参考产品逆向分析提取的8个可复用模块：
- `account-state-restorer` — JSONL 持久化
- `credential-store` — AES-256-GCM 加密
- `api-platform-adapter` — HTTP API 发布
- `publish-monitor` — 发布后状态查询
- `video-uploader` — 视频分片上传
- `system-tray` — 托盘 + 最小化 + 告警闪烁
- `content-aggregator-bridge` — 内容采集
- `api-mode-publisher` — API + RPA 混合自动回退

---

### 1.3 项目间关系

```
PROJECT-012 (分句) ←桥接→ PROJECT-011 (提示词优化) ←协作→ PROJECT-010 (视频生成)
                                                                    ↑
PROJECT-003 (多平台发布) ←集成 PROJECT-001 (内容聚合改写，不在本次范围)
```

- 012 → 011: 分句结果通过 PromptEngineExporter 送入 011 优化为图片 prompt
- 012 → 010: 分句结果可用于 010 的视频字幕和分段
- 003 → 001: 内容聚合后一键发布

---

### 1.4 确认的开发方向

- **开发优先级**: 003优先（商业化路线），010/011/012辅助推进
- **项目目标**: 商业化产品（非开源/非个人工具/非技术验证）
- **003平台状态**: 12个平台选择器配置已补全，SelectorEngine已实现
- **长期规划**: 5阶段渐进式（基础巩固→集成打通→产品化→增长功能→运营商业化，12周）
- **核心管线**: 文案→012分句→011提示词优化→010视频生成→003多平台发布
- **AI韧性层**: 分阶段实现，先Level 1+2（选择器降级），Level 3（AI看图）后续迭代
- **版本号管理**: 所有项目统一使用pyproject.toml/package.json中的版本号

---

## 二、开发进度总结

### Phase 1-4 全部完成 ✅

| Phase | 任务 | 状态 |
|-------|------|------|
| Phase 1 | T1: 12平台RPA发布器修复 | ✅ |
| Phase 1 | T2: Python后端进程守护 | ✅ (已有完整实现) |
| Phase 1 | T3: 012→011 context注入验证 | ✅ |
| Phase 1 | T4: 010测试补充 (12个) | ✅ |
| Phase 2 | T5: SelectorEngine (Level 1+2) | ✅ |
| Phase 2 | T6: 012+011联合测试 | ✅ |
| Phase 2 | T7: 010集成012分句 | ✅ |
| Phase 3 | T8: 012→011→010完整管线 | ✅ |
| Phase 3 | T9: 011 PyPI准备 | ✅ |
| Phase 3 | T10: 012 PyPI准备 | ✅ |
| Phase 4 | T11: 版本号统一 | ✅ |
| Phase 4 | T12: 测试修复 | ✅ |
| Phase 4 | T13: 构建验证 | ✅ |
| Phase 4 | T14: 010 PyInstaller | ✅ (spec+脚本) |
| Phase 4 | T15: electron-builder打包 | ✅ (v1.1.6 103MB) |
| Phase 4 | T17: GitHub Release v1.1.6 | ✅ |
| **最新** | T18: Playwright浏览器打包 | ✅ (v1.1.7 236MB) |

### 待完成任务
- T16: 011/012 PyPI发布 — 需要PyPI账号+API Token
- 003 AI韧性层Level 3（AI看图）
- 003 RPA引擎独立npm包发布
- 010 PyInstaller实际构建（spec已就绪）
- 011 Web UI拆分(index.html 1070行→Vue SFC)

---

## 三、关键技术决策

### 3.1 Playwright浏览器打包 (v1.1.7)

**决策**: 将 Playwright Chromium 浏览器完整打包进安装包
- 原因: 用户担心网络不通畅，需要离线可用
- 安装包: 103MB → 236MB (NSIS压缩后增量133MB)
- 浏览器: chromium-1223 (412MB) + ffmpeg-1011 (3.3MB)
- first-run.js: 移除 playwright install 调用，改为验证 browsersPath 存在性
- main.js: 打包后自动设置 PLAYWRIGHT_BROWSERS_PATH

### 3.2 SelectorEngine 三层级设计

```
Level 1: 配置选择器 (platform-selectors.js 12平台配置)
  ↓ 失败
Level 2: 语义 fallback (text=/role=/placeholder)
  ↓ 失败
Level 3: AI 看图 (预留)
```

### 3.3 RPA发布器修复

- 12平台 `_doPublish` 成功标志Bug全部修复
- 额外修复: weibo静默失败→throw、zhihu假成功→检查错误状态、wechat-mp错误掩盖→返回false
- bilibili-rpa.js 架构最完善，可作重构参考模板

### 3.4 测试基础设施

- Jest配置精确匹配 `tests/**/*.test.js`，排除 `__tests__/`
- 非Jest测试文件重命名为 `manual-*.js`
- rimraf v3 API兼容: `rimraf.rimrafSync || rimraf.sync`
- 基类测试用try/catch包裹避免Jest worker崩溃

---

## 四、竞品分析

### 参考产品逆向分析
- 路径: `C:\Users\邱领\projects\ui-reference\`
- 架构: Electron + React 19 + Node 22 + webpack + TypeScript + Tailwind
- 核心发现: WebContentsView + session.fromPartition() 替代 Playwright 弹出窗口
- 6大模块: 登录/Session/发布适配器/视频上传/Cookie管理

### 融媒宝逆向
- 路径: `C:\Users\邱领\projects\rongmeibao-reverse\docs\` (13份文档)
- 架构: C++ + DuiLib + CEF + VLC 混合
- MediaTaskMgr.dll (10.5MB) 核心引擎

### Infinity (CVPR 2025 Oral)
- 可复用: P0 PromptRewriter, P1 BitwiseClassifier, P2 PromptDisturber

---

## 五、用户偏好

- 中文用户，北京
- 独立开发者，主力系统 Windows 10
- 偏好本地优先、零API成本的工具
- 偏好零交互全自动工作流
- 重视产品化（PRD → 开发 → 测试 → 发布）
- 项目编号体系：003/010/011/012
- 代理: Clash Verge 端口7892
- Python双环境: C:\Python312\ 和 AppData\Local\Programs\Python\Python312\
- 团队协作: Agent-Team-WorkFlow (GitHub: Colinchiu007/Agent-Team-WorkFlow)

---

## 六、已知技术债务

### 已修复
- ✅ cookie-store测试: rimraf v3 API兼容
- ✅ registry测试: 12平台+getPublisherClass断言修复
- ✅ cover-processor测试: 重写匹配实际API
- ✅ task-queue测试: 超时时序+暂停逻辑修复
- ✅ 011 __init__.py版本号同步
- ✅ 003 package.json版本号统一到v1.1.7
- ✅ Playwright浏览器打包 (v1.1.7)
- ✅ first-run.js简化 (移除不可行的asar内执行)

### 待解决
- 010 PyInstaller实际构建（spec已就绪，需执行build_exe.py）
- 011 Web UI拆分 (index.html 1070行→Vue SFC)
- 003 AI韧性层Level 3（AI看图）
- 003 RPA引擎独立npm包发布
- 3个manual-*.js测试文件需实现或删除

---

## 七、发现的持久知识

### rimraf v3 vs v4 API差异
- rimraf v3: `require('rimraf').sync(path)`
- rimraf v4+: `require('rimraf').rimrafSync(path)`
- 兼容写法: `const rm = rimraf.rimrafSync || rimraf.sync`

### makeApiRpa返回匿名类
- registry.js中zhihu/weibo/douyin等平台使用`makeApiRpa()`包装
- 返回匿名类，测试应验证`typeof cls === 'function'`

### 非Jest测试文件识别
- `__tests__/test-*.js`会被Jest自动收集
- 解决方案：重命名为`manual-*.js`或创建jest.config.js用testMatch精确匹配

### electron-builder打包经验
- `npm run build:win` = `vite build` + `electron-builder --win --x64`
- Playwright浏览器通过`extraResources`捆绑
- 签名跳过：`sign: false, signAndEditExecutable: false`
- 大文件上传GitHub需要timeout>300秒

### GitHub Release流程
1. 打tag: `git tag -a v1.1.7 -m "..."`
2. 推送: `git push origin main --tags`
3. 创建Release: `gh release create v1.1.7 --title "v1.1.7" --notes "..." --latest`
4. 上传附件: `gh release upload v1.1.7 "path/to/file" --clobber`

### Playwright浏览器打包
- 全局安装: `%USERPROFILE%/AppData/Local/ms-playwright/`
- 项目本地: `apps/desktop/.playwright-browsers/`
- 打包路径: `resources/playwright-browsers/`
- asar是虚拟文件系统，不可spawn/spawnSync执行内部文件

---

## 八、Session Checkpoint (最新)

### 当前状态
- **Topic**: 003 v1.1.7 Playwright浏览器打包完成
- **版本**: v1.1.7
- **安装包**: 236MB, 已上传GitHub Release
- **下一待办**: 010 PyInstaller构建 / 011/012 PyPI发布 / 商业化启动

### 最近完成的工作
1. ✅ Playwright Chromium浏览器复制到`.playwright-browsers/` (416MB)
2. ✅ first-run.js重写: 移除spawnSync + getPlaywrightExe()
3. ✅ 版本号统一到v1.1.7 (4个package.json)
4. ✅ npm run build:win 重建安装包 (236MB)
5. ✅ git tag v1.1.7 + push
6. ✅ gh release create v1.1.7 + upload

### 关键文件路径
- 安装包: `apps/desktop/dist-electron/Multi-Publish.Setup.1.1.7.exe`
- 解压版: `apps/desktop/dist-electron/win-unpacked/`
- 浏览器: `apps/desktop/.playwright-browsers/chromium-1223/`
- 主进程: `apps/desktop/electron/main.js`
- 首运行: `apps/desktop/electron/first-run.js`
- 选择器: `packages/rpa-engine/src/selector-engine.js`
- 12平台配置: `packages/rpa-engine/src/platform-selectors.js`

---

## 九、LLM 配置

- 011 当前默认 LLM: minimax（API Key 需续费）
- 011 备选: openai_compat → openrouter.ai
- 012 LLM: OpenAI Provider（需 API Key）

---

## 十、导入说明

将此文件复制到新设备后，OpenCode 可通过以下方式快速了解项目：

1. **阅读本文件** — 获取项目全局记忆、开发进度、技术决策
2. **阅读 `PROJECT-003-FILE-INVENTORY.md`** — 获取完整文件清单
3. **阅读项目根目录文件**:
   - `README.md` — 项目说明
   - `CHANGELOG.md` — 版本历史
   - `AGENTS.md` — AI Agent 工作指南
   - `PRD.md` — 产品需求文档
   - `INTEGRATION.md` — 集成文档
4. **检查 GitHub Release**: https://github.com/Colinchiu007/Multi-Publish/releases

### 关键命令
```bash
# 克隆项目
git clone https://github.com/Colinchiu007/Multi-Publish.git
cd multi-publish

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建安装包
npm run build:win

# 运行测试
npx jest --config packages/rpa-engine/jest.config.js
npx jest --config packages/shared-utils/jest.config.js

# 查看版本
git tag -l

# 查看Release
gh release view v1.1.7
```

---

## 十一、Story2Video 历史断点恢复当前模型（2026-08-19）

- **需求决策**：History 的【从断点继续】保持一键操作，不增加“旧模型/当前模型”选择器和确认弹窗；恢复时未完成的文字推理、图片、TTS、视频调用读取当前设置模型，已经完成且有效的本地图片、音频、视频按 `scene index` 复用。
- **实现边界**：`prepareResumeParams()` 对 Story2Video 参数做 JSON-safe 克隆，清理旧图片/TTS/视频路由字段并写入内部 `__resumeUseCurrentModels` 标记；保留 prompt、场景文本、比例、voiceId、语速、音调、情绪等内容参数。`video_plan.provider/model` 在恢复时不再覆盖当前视频能力配置。
- **资产校验**：`generate_assets.resume.completed` 逐资产校验合法整数 `index`、受控媒体根目录、文件存在/可读性、扩展名、大小与符号链接边界。图片、音频、视频独立复用，旧快照可只有其中一种资产；无效路径被丢弃后按当前模型重新生成。
- **语音风险决策**：保留原 `voiceId`，不静默更换音色。当前 provider/model 的 voice catalog 或 adapter 不兼容时沿用既有 fail-closed、默认音色回退和 re-clone 合同；语速、音调、情绪继续作为内容参数。
- **远程视频边界**：当前 `taskId` 未持久化，恢复时不会把未知的远程任务伪造成完成，也不会盲切新模型去查询旧任务；有本地有效视频则复用，无有效产物则走当前模型的正常提交/失败回退。
- **测试结果**：聚焦 `resume-orchestration.test.js`、`story2video-stages.test.js`、`pipeline-story2video-contract.test.js` 共 3 个文件，175 个测试通过；补充 Windows runner 干净临时目录初始化，并用 `realpathSync.native()` 断言规范化后的媒体路径，覆盖当前图片/TTS/video、legacy Python 路径、当前 LLM 视频场景判断、旧 video plan 路由清理、部分资产复用、失效路径再生成和跨镜 final frame。
- **质量过程**：外部 Antigravity 因账户/地域资格不可用，Claude wrapper 因本机代理/API 连接失败；按流程降级为三个独立本地只读审查探针，审查结论已记录在归档 task 的 `review.md`，未发现未修复 Critical/Major。
- **交付记录**：代码在隔离 worktree `codex/s2v-resume-current-models` 开发，文档 rebase 冲突已保留双方章节并解决；PR #1031（https://github.com/Colinchiu007/Multi-Publish/pull/1031）已于 2026-08-19T16:41:30Z 合并，merge SHA `ef980f08a74232890569b5823e47d4e3c7a93e3a`；PR CI 中 Story2Video 恢复相关用例未失败，UI/ResultView、视觉、Browser E2E、Coverage 连带和 Autonomous 失败属于已记录主线基线例外。正式规格已同步至 `openspec/specs/story2video-resume-current-models/spec.md`，OpenSpec change 已归档至 `openspec/changes/archive/2026-08-20-s2v-resume-current-models`，CCG task 与 review 已归档至 `.ccg/tasks/archive/2026-08/s2v-resume-current-models`。归档 PR #1035（https://github.com/Colinchiu007/Multi-Publish/pull/1035）已于 2026-08-19T16:55:21Z 合并，merge SHA `49cf867e4b7dc5b7cf0ff574cd3b864646562db9`；最终元数据 PR #1036（https://github.com/Colinchiu007/Multi-Publish/pull/1036）已于 2026-08-19T17:00:26Z 合并，merge SHA `89f1aec4a7f4c4fdf58d1628646b93e9e28a88df`；`origin/main` 已核验包含这些提交。

## 十二、Story2Video 历史卡片与非运行任务编辑（2026-08-20）

- **任务与隔离**：在 worktree `D:/Data/projects/mp-worktrees/mp-video-history-card-detail` 的分支 `codex/video-history-card-detail` 开发；共享仓库根保持 `main`，不直接修改运行时代码。
- **卡片合同**：all/running/paused/failed/completed/cancelled 六个标签复用同一结构。显示标题、任务文案预览、首场景缩略图、视频时长、任务执行耗时、更新时间、创建时间、状态和标识。标题回退为 title → params.title/publishTitle → task content → pipeline name → untitled；文案预览只取任务文案，120 个 JavaScript 字符后加 …。
- **缩略图合同**：第一场景合法图片优先；没有图片时取第一个合法视频的第 0 秒 FFmpeg 首帧。项目/媒体根目录、普通文件、大小、格式、符号链接和临时文件安装均受校验；失败返回结构化状态并显示“未生成”，不阻塞历史。
- **project/run 数据真源**：先用 projectId、项目 runId、legacy id 匹配。项目标题、文案、分段和素材优先；run status/stage/checkpoint/error/activeMs/runId 补充；只有 runId 的纯 run 不创建编辑项目。
- **编辑边界**：paused/failed/completed/cancelled 且已启动、有 projectId 的任务可进入 `/create/result` 编辑；running 保留流水线控制；cancelled 可保存修改但不允许从断点继续。
- **更新时间**：成功保存文案、分段、素材、提示词、翻译、字幕、语音，以及暂停、继续、取消、失败、完成状态写回都更新时间，且同一项目单调递增；合并取双方最新有效时间。
- **缺失素材**：ResultView 的图片、视频、提示词、翻译、字幕和语音槽位保持稳定，缺失、失败、不可读或被清理均显示固定空背景与“未生成”，其他场景仍可编辑。
- **质量记录**：定向回归已通过（最新小修复前 7 files/866 tests）；内部审查无 Critical。Antigravity 因区域/账户不可用，Claude wrapper 因超时/代理失败，外部双模型报告缺失，已在 `.ccg/tasks/video-history-card-detail/review.md` 记录。残余风险包括 video2 生成槽位仍是既有能力边界，以及真实 Electron 窗口/打包 smoke 需在交付门禁完成。
