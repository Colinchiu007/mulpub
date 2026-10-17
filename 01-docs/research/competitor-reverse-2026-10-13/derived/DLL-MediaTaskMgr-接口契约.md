# MediaTaskMgr.dll — 原生引擎接口契约与调用时序（REA 反编译衍生）

> **文档性质**：由 REA（Ghidra 12.1.4）对**已交付产物** `MediaTaskMgr.dll` 的静态反编译结果整理而成。
> 它**不是**厂商原始头文件，也没有任何厂商文档背书 —— 凡标注「推断」的条目都属分析结论。
> **证据等级**：符号表/导出表 = 观察（shipped-artifact）；伪代码 = 观察（`confidence: observed`）；调用时序 = 推断。
> **数据来源**：`01-docs/research/competitor-reverse-2026-10-13/原生层分析报告.md`、
> `mtm-decompile-init.json`（REA Evidence `ev_072f2d2f70b9…`，operation `procedure_pseudo_code`）、`mtm-procedures.json`。
> **更新日期**：2026-10-17（本轮新增派生文档，未重新跑反编译，只做已有证据的整理与规范化）。

---

## 1. 分析对象与「能分析 / 不能分析」的边界

| 项 | 值 |
| --- | --- |
| 文件 | `MediaTaskMgr.dll` |
| 版本 | **1.0.0.264**（同目录残留旧版 `_1.0.0.257.dll` ⇒ 组件级热更新）|
| 体积 / 架构 | 9.99 MB / **x86**（32 位）/ 8 个段 |
| `.text` | **8,239,104 B**（7.86 MB）|
| 规模 | **66,199 个函数 / 13,120 条字符串** |
| 分析代价 | 每次 CLI 调用都是一次新 Ghidra 会话（必须重新全量 auto-analysis）⇒ **单次查询约 20–25 分钟** |

**⛔ 先否证两条「以为有其实没有」的期待**（避免后来者重复投入）：

1. **主程序 `WEMedia.exe` 不可反编译**：`.text` 12.4 MB **且加壳**，三档超时（默认 / 30 min / 60 min）**全部失败**。
2. **参考产品 exe 同样不可反编译**：196.4 MB，超过 REA 的 128 MB 快照预算。

⇒ 本层**没有 exe 代码成果**。所有原生层代码级成果都来自这个 DLL（未加壳、体量勉强可分析），
以及可分析的 JS 层（参考产品 asar / 融媒宝 CEF 前端）。

---

## 2. 导出契约（5 个函数，符号表实证）

| 导出函数 | 地址（image base 内）| 职责 | 方向 |
| --- | --- | --- | --- |
| `InitMediaTaskMgr` | `0x101D69A0` | 初始化任务引擎 | 宿主 → 引擎 |
| `SetMediaTaskMgrPostMsgCallback` | `0x101D6990` | **注册消息回调**（任务完成 / 进度回传）| 宿主 → 引擎 |
| `SetTaskMgrIdleCallback` | `0x101D6F50` | **注册空闲回调**（引擎空闲通知）| 宿主 → 引擎 |
| `GetMediaTaskMgr` | `0x101D6E90` | **取单例**（C 风格，非 COM）| 宿主 → 引擎 |
| `UnInitMediaTaskMgr` | `0x101D6EA0` | 反初始化（释放资源）| 宿主 → 引擎 |

**架构判读**：这是**极简 C 风格导出契约**，不是 COM、不是 C++ 导出类。
宿主通过这 5 个函数把媒体任务引擎嵌进自己的消息循环 —— 结果与进度经 `PostMsgCallback` 回传，
空闲经 `IdleCallback` 通知。**接口/实现分离**（`ITaskMgr` 纯虚接口 + `VCTaskManager` 实现）说明引擎预留了替换扩展点。

---

## 3. 调用时序（推断，依据 §2 + §4 伪代码）

```
宿主启动
  │
  ├─ InitMediaTaskMgr(hostTag)          ← 幂等：已初始化则先销毁旧实例
  │     ├─ （首次）new 引擎对象 256 B
  │     ├─ 写入宿主标识 hostTag
  │     ├─ curl_global_init()           ← 仅一次，带全局幂等标记
  │     ├─ 线程池 / 事件循环初始化
  │     └─ new 管理器对象 52 B → 设置到虚表第 2 个方法
  │
  ├─ SetMediaTaskMgrPostMsgCallback(cb) ← 必须先于任务提交注册，否则结果无出口
  ├─ SetTaskMgrIdleCallback(cb)         ← 可选
  │
  ├─ pMgr = GetMediaTaskMgr()           ← 单例指针（C++ 对象，含虚表）
  ├─ 提交任务 / 查询状态（经虚表方法，见 §9 未闭合）
  │
  └─ UnInitMediaTaskMgr()               ← 释放在 §3-Init 里分配的一切
```

**时序上的三条硬约束（从伪代码读出，非猜测）**：

1. **幂等**：`InitMediaTaskMgr` 里 `if (全局实例 != 0)` 先 `destroy` 再进 `== 0` 分支新建 ⇒ **重复 Init 安全**，但会**丢弃旧实例及其已注册回调**（重新 Init 后必须**重设两个回调**）。
2. **`curl_global_init` 只跑一次**（全局布尔标记），所以 Init 调两次不会重复初始化 HTTP 栈 —— 也意味着**进程级共享 curl 状态**，宿主不要自行 `curl_global_cleanup`。
3. **`GetMediaTaskMgr` 返回的是带虚表的 C++ 对象**，不是 POD 结构。跨语言使用必须匹配 vtable 布局（**未验证**，见 §9）。

---

## 4. 伪代码实证：`InitMediaTaskMgr`（`0x101D69A0`）

Ghidra 反编译出的真实片段（节选，完整 6,019 字符见 Evidence）。关键行：

```c
void InitMediaTaskMgr(char *param_1)
{
  local_c = DAT_1094b708 ^ (uint)auStack_bc;     // MSVC /GS 栈 cookie

  if (DAT_109781ec != (wchar_t *)0x0) {           // ← 幂等守卫
    FUN_101e3850();  FUN_101f82b0();
    if (7 < local_4c) operator_delete(local_60);  // std::string SSO 阈值 = 7（32 位 MSVC）
    ...
  }
  FUN_101d6310();

  if (DAT_109781ec == (wchar_t *)0x0) {           // ← 首次初始化
    pvVar4 = operator_new(0x100);                 // 256 B 引擎对象
    ...
    if (*(int *)(DAT_109781ec + 0x4e) == 0) {
      local_d0 = "WEMediaSetup";                  // 宿主标识（写入引擎）
      FUN_10004b40();
    }
    local_d0 = "WEMedia1.0";
    FUN_10004b40();
    local_d0 = "WEMedia";
    FUN_10004b40();
    local_d0 = "pc";                              // 平台标识
    FUN_10004b40();
  }

  if (DAT_10977d9b == '\0') {
    DAT_10977d9b = '\x01';
    curl_global_init();                           // HTTP 栈 = libcurl，只初始化一次
  }

  FUN_10519d40();  FUN_10507190();                // 线程池 / 事件循环

  pvVar4 = operator_new(0x34);                    // 52 B 管理器对象
  DAT_10977dac = (int *)FUN_101d7fa0();
  local_d0 = param_1;
  (**(code **)(*DAT_10977dac + 4))();             // ★ 虚表第 2 个方法分派
  __security_check_cookie(local_14 ^ (uint)&stack0xffffff3c);
  return;
}
```

**从伪代码读出的 6 个硬事实**：

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | 引擎是**品牌无关的通用组件** —— 初始化时写入宿主传入的标识字符串 | 伪代码里 4 个 `local_d0 = "…"` 写入 |
| 2 | HTTP 栈是 **libcurl** | `curl_global_init()` + 模块依赖 `libcurl.dll` |
| 3 | 管理器访问走 **C++ 虚表**（不是 C 结构偏移）| `(**(code **)(*p + 4))()` |
| 4 | **初始化幂等**（重复 Init 安全，但会丢旧实例）| `if (非 0) 先清理` + `if (==0) 新建` |
| 5 | **MSVC 编译 + /GS 栈保护** | `__security_check_cookie` |
| 6 | 编译代际 ≈ **VS 2008~2015** | 32 位 `std::string` SSO 阈值 = 7、RTTI 出现 `std::tr1::_Ref_count` |

---

## 5. 类层次（由 MSVC RTTI 描述符还原）

```
CBaseTask                       ← 任务基类
BaseAsyncTask / VBaseAsyncTask  ← 异步任务基类（引用计数）
ITaskMgr                        ← 任务管理器【纯虚接口】
VCTaskManager                   ← 任务管理器实现
MediaTaskMgr / VMediaTaskMgr    ← 媒体任务管理器（本 DLL 主体）
FFMpegFuncTask / UFFMpegFuncMsg ← ffmpeg 任务与其消息
```

**读法**：任务统一继承 `CBaseTask`；管理器按「接口 `ITaskMgr` + 实现 `VCTaskManager`」分离。
⇒ 若将来要对接这层，**应对 `ITaskMgr` 契约而不是具体实现类**。

---

## 6. 能力面清单（该 DLL 实际能干什么）

| 能力面 | 规模 / 细节 | 对本项目 |
| --- | --- | --- |
| 平台 API 端点 | **1,339 个**，覆盖 31 个平台 | 情报（见「平台能力矩阵」）|
| ffmpeg 操作 | **15 种**：自动裁剪 / 剪辑 / 压缩 / 转码 / 任务中心 / 切割 / 提取字幕 / 合并 / 混剪 / 截图 / 变速 / 音视频分离 / 加字幕 / 转 GIF / 加水印 | 命令模板可借鉴（`amix` + `dynaudnorm` 混音归一化最实用）|
| TTS | **3 家**：阿里云 + 微软 Azure（经自有代理取 token）+ 自有代理；含 SSML 前后静音（`Leading-exact`/`Tailing-exact`）、`AudioSilenceRemove` | 可借鉴 SSML 参数面（角色/风格/强度）|
| 发布前预检 | `ArticleCheckRiskTask`（风险检测）+ 网易号 `checkTitle`（**平台侧标题查重**）| ⚠ **本项目没有标题查重**，是真实能力缺口 |
| 上传协议 | 视频号三段式 `applyuploaddfs → uploadpartdfs → completepartuploaddfs` | ✅ 与本项目 `shipinhao-video.js` **完全一致**（交叉验证）|
| 网页解析 | **19 个平台**的文章页解析器 | 情报 |
| 其它 | 活动/任务广场抓取、微信扫码与短信验证码流程、音频时长预估（`rmbDuration`）| 情报 |

---

## 7. 对本项目的判断（该不该复刻）

| 维度 | 结论 |
| --- | --- |
| 任务引擎架构 | **不复刻**。本项目 `task-queue.js`（EventEmitter + 通道调度）+ `task-pool.js` + `progress-emitter.js` 目标一致但更灵活（多监听者 / 异步 / Promise 化）；「幂等初始化」「接口/实现分离」本项目已有（`container.js`）|
| 接口契约形态 | **不复刻**。C 回调函数指针 vs Node EventEmitter，后者能力严格更强 |
| ffmpeg 命令模板 | **可借鉴**（尤其混音 + 动态归一化那两行）|
| 双重预检 | **值得补**：平台侧标题查重是本项目空白 |
| 上传协议 | 无需借鉴 —— 已实证一致，且本项目实现更规范（统一分片抽象 + 进度门控 + 分片重试 + MD5 去重）|

---

## 8. 未闭合边界（不假装已闭合）

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | **「导出契约」只有 1/5 有反编译证据** | 仅 `InitMediaTaskMgr` 有 `procedure_pseudo_code`；其余 4 个的签名/参数类型来自**符号表推断**。反编译它们需每次 ~20–25 分钟（新 Ghidra 会话）|
| 2 | **`Set*Callback` 的回调签名未知** | 需要反编译 `0x101D6990` / `0x101D6F50`；未做 |
| 3 | **`param_1` 的语义未证** | 伪代码只显示它被写入管理器；推断是「宿主标识」，**未验证** |
| 4 | **vtable 布局未验证** | 只知「第 2 个方法」被调用；完整方法表、ABI、结构体大小均未知 ⇒ 跨语言直连**不可行** |
| 5 | **地址依赖 image base** | 表中地址是分析时的 image base 内偏移；DLL 重定位后需重算 |
| 6 | **版本漂移** | 分析的是 1.0.0.264；同目录已有 1.0.0.257 残留 ⇒ 该组件会热更，契约可能变 |

---

## 9. 复现入口

```powershell
# 每个新 pwsh 进程都要重新导出环境（Ghidra + JDK）
$env:GHIDRA_INSTALL_DIR = [Environment]::GetEnvironmentVariable('GHIDRA_INSTALL_DIR','User')
$env:JAVA_HOME          = [Environment]::GetEnvironmentVariable('JAVA_HOME','User')
$env:REA_GHIDRA_STARTUP_TIMEOUT_MS = "2400000"      # 40 分钟；默认 330 s 会超时

# 1. 全量分析（约 5–8 分钟）
rea analyze <TARGET_DLL> --provider ghidra --json

# 2. 导出符号（约 20–25 分钟；每次都要重新 auto-analysis）
rea search <TARGET_DLL> "Task" --kind procedures --provider ghidra --json

# 3. 反编译单个函数（本文用的就是这条）
rea decompile <TARGET_DLL> 0x101D69A0 --provider ghidra --json
```

> `<TARGET_DLL>` 指目标机器上的 `MediaTaskMgr.dll`（安装目录属厂商产物，不入仓）。
> 本文的一切数字都能由上面三条命令 + `原生层分析报告.md` 的锚点复算。
