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
| 分析代价 | 每次 CLI 调用都是一次新 Ghidra 会话（必须重新全量 auto-analysis）⇒ **单次查询实测 1832 s / 1859 s / 1910 s（约 30–32 分钟）** |

**⛔ 先否证三条「以为有其实没有」的期待**（避免后来者重复投入）：

1. **主程序 `WEMedia.exe` 在本机超时预算内无法反编译**：`.text` 12.4 MB，三档超时（默认 330 s / 30 min / 60 min）**全部失败**。
   ⚠ **2026-10-19 更正「加壳」这一归因**：字节级复核**未发现任何已知加壳器特征**
   （VMProtect / Themida / ASPack / UPX / PECompact / NsPack 全未命中；入口 `0x005D5B2A` 处是
   正常 MSVC C++ 序言 —— `push fs:[0]` 结构化异常登记 + `lea/sub esp`，不是壳的 `pushad` 前导）。
   真实瓶颈是 **`.text` 12.4 MB 的体量**（对比 DLL 的 8.24 MB 已需 30 分钟，外推约 45–60 分钟以上），
   不是壳。**「加壳」这个结论此前没有字节级证据，现予撤回**。
2. **参考产品 exe 同样不可反编译**：196.4 MB，超过 REA 的 128 MB 快照预算。
3. **`--snapshot` 不缓存分析**（2026-10-19 实测）：`analyze --snapshot` 只写 **8,080 字节**的概览元数据，
   后续任何 `search` / `function` 拿着快照仍会**重跑完整 auto-analysis**（实测 1,910 s）。
   ⇒ 想省钱只能「一次 analyze 拿全，别分多次查询」，或先走 PE 表（见 §2bis 的效率对比）。


⇒ 本层**没有 exe 代码成果**。所有原生层代码级成果都来自这个 DLL（未加壳、体量勉强可分析），
以及可分析的 JS 层（参考产品 asar / 融媒宝 CEF 前端）。

---

## 2. 导出契约（**7 个业务 C API**，PE 导出表实证）

> **2026-10-19 更正**：本节原写「5 个函数」。重新直读 PE 导出表后发现 `MediaTaskMgr.dll` 共 **45 个导出**，
> 其中业务 C API **7 个**（原文档漏记 2 个），其余 38 个是**嵌入式第三方图像库 CxImage 的 C++ mangled 导出**。
> 证据：`inspect_pe_resources` 之外的独立取证 —— 直接解析导出目录（`DataDirectory[0]`，RVA `0x00948A10`，size 1592）。

| 导出函数 | 地址（image base 内）| 职责 | 方向 |
| --- | --- | --- | --- |
| `InitMediaTaskMgr` | `0x101D69A0` | 初始化任务引擎 | 宿主 → 引擎 |
| `SetMediaTaskMgrPostMsgCallback` | `0x101D6990` | **注册消息回调**（任务完成 / 进度回传）| 宿主 → 引擎 |
| `SetTaskMgrIdleCallback` | `0x101D6F50` | **注册空闲回调**（引擎空闲通知）| 宿主 → 引擎 |
| `GetMediaTaskMgr` | `0x101D6E90` | **取单例**（C 风格，非 COM）| 宿主 → 引擎 |
| `UnInitMediaTaskMgr` | `0x101D6EA0` | 反初始化（释放资源）| 宿主 → 引擎 |
| **`SetLibPostInitParam`** | `0x101D7770` | ⚠ **原文档漏记**。库初始化后参数注入入口（签名未证）| 宿主 → 引擎 |
| **`SetLoginUserInfo`** | `0x101D7E90` | ⚠ **原文档漏记**。**登录态注入**入口（签名未证）| 宿主 → 引擎 |

**`SetLoginUserInfo` 的意义**：它证明「登录凭据由宿主（`WEMedia.exe`）持有并压进引擎」，
而不是引擎自己管账号 —— 这解释了为什么该 DLL 的导入表里只有 `CRYPT32.dll` 的 **1 个**函数（不持凭证体系）。
对本项目的含义：**不必从该 DLL 找账号存储格式**，那条线在宿主侧。

**架构判读**：业务面仍是**极简 C 风格导出契约**（非 COM、非 C++ 导出类）。
宿主通过这几个函数把媒体任务引擎嵌进自己的消息循环 —— 结果与进度经 `PostMsgCallback` 回传，
空闲经 `IdleCallback` 通知。**接口/实现分离**（`ITaskMgr` 纯虚接口 + `VCTaskManager` 实现）说明引擎预留了替换扩展点。

### 2.1 另外 38 个导出 = 嵌入式 **CxImage** 开源图像库

导出表里除上述 7 个外，其余 38 条全是 CxImage 的 C++ mangled 名，按类归组：

| 类 | 导出数 | 典型符号 |
| --- | --- | --- |
| `CxFile` / `CxIOFile` / `CxMemFile` | ~29 | `?Open@CxIOFile@@QAE_NPB_W0@Z`、`?Read@CxIOFile@@UAEIPAXII@Z`、`?Seek@CxIOFile@@UAE_NJH@Z` |
| `CxImage` | ~6 | `??1CxImage@@UAE@XZ`、`??_FCxImage@@QAEXXZ`、`??_OCxImage@@QAEXAAV0@@Z` |
| `CxClientExifInfo` | ~3 | `?CopyInfo@CxClientExifInfo@@QAEXABU1@@Z` |

⇒ **判读**：图像编解码/EXIF **不是自研**，是引了开源 CxImage 并把它一起导出。
对本项目：**零借鉴价值**（`sharp`/`jimp` 已覆盖，且 CxImage 是 2000 年代库、无 AVIF/HEIC）。

---

## 2bis. 导入表：15 个 DLL / 460 个函数（能力面直读）

PE 导入目录（`DataDirectory[1]`，RVA `0x009459BC`）逐个解析所得：

| DLL | 函数数 | 能读出什么 |
| --- | --- | --- |
| `KERNEL32.dll` | 140 | 基础 Win32 |
| `MSVCR100.dll` / `MSVCP100.dll` | 175 / 79 | **VC++ 2010 运行时**（印证 §4 事实 6 的「VS 2008~2015」）|
| `GDI32.dll` | 18 | 图像绘制（配合 CxImage）|
| `libcurl.dll` | 12 | **HTTP 栈之一** |
| `USER32.dll` | 7 | 窗口/消息 |
| `ADVAPI32.dll` | 6 | 注册表/加密服务 |
| `SHLWAPI.dll` | 5 | 路径工具 |
| `WINHTTP.dll` | 4 | **HTTP 栈之二**（`WinHttpOpen` / `WinHttpGetProxyForUrl` / `WinHttpGetIEProxyConfigForCurrentUser` / `WinHttpCloseHandle`）|
| `WS2_32.dll` | 4 | **HTTP 栈之三**（原始套接字）|
| `ole32.dll` / `VERSION.dll` | 3 / 3 | COM 基础 / 版本查询 |
| `SHELL32.dll` | 2 | |
| `CRYPT32.dll` | **1** | 仅 1 个函数 ⇒ 印证 §2「不持凭证体系」|
| `dxgi.dll` | 1 | GPU（视频解码/缩放）|

**三条判读**：
1. **三套网络栈并存**（libcurl + WINHTTP + WS2_32）—— 这不是设计优雅，而是历史叠加：
   业务主体用 libcurl，代理探测单独走 WINHTTP（`WinHttpGetIEProxyConfigForCurrentUser` 读 IE 代理设置），
   WS2_32 可能被 WINHTTP/CxImage 间接拉入。**本项目做代理时只需一套**（已用 `undici` + 自管代理）。
2. `CRYPT32` 只有 1 个函数 ⇒ 没有本地加密体系（与 §2 的 `SetLoginUserInfo` 互补印证）。
3. `dxgi` + `GDI32` + CxImage ⇒ 图像处理是 **CPU 为主 + 少量 GPU**，无 CUDA/编解码硬加速依赖。

### 2ter. 方法论：**先 PE 表，后 Ghidra**（2026-10-19 立）

本节 §2/§2bis 的全部内容（45 个导出 + 15 个 DLL / 460 个导入）是**直接解析 PE 导出/导入目录**得到的，
耗时 **约 4 秒**。而 Ghidra 报告同一批导出符号需要 **30 分钟**（且只是「照抄导出表」，没有增量信息）。

| 取证面 | 手段 | 耗时 | 增量 |
| --- | --- | --- | --- |
| 导出符号 / 地址 | 解析 `DataDirectory[0]` | **~4 s** | — |
| 导入 DLL / 函数 | 解析 `DataDirectory[1]` | **~4 s** | — |
| 段表 / 入口 / 体量 | 解析 COFF + Optional Header | **~1 s** | — |
| 加壳判据 | 字符串扫 + 入口字节比对 | **~2 s** | — |
| 函数体伪代码 / 交叉引用 / 调用图 | **Ghidra 全量分析** | **30–32 min** | ✅ 唯一不可替代 |

**结论**：Ghidra 的价值在**函数体逻辑与引用图**，不在符号面。任何时候想「先看看这 DLL 有什么」，
都应当先走 PE 表；只有需要读某个函数**内部怎么实现**时才付 30 分钟。
—— 这条同样适用于将来复现：`parse-pe-imports.cjs`（已在 `01-docs/research/.../*.cjs`）就是这条路径的脚本化。



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
| 1 | **7 个业务导出里只有 1 个有反编译证据** | 仅 `InitMediaTaskMgr` 有 `procedure_pseudo_code`；其余 6 个（含新发现的 `SetLibPostInitParam` / `SetLoginUserInfo`）的签名/参数类型来自**导出表 + 符号表推断**。反编译它们需每个 ~30 分钟（新 Ghidra 会话）|
| 2 | **`Set*Callback` / `SetLoginUserInfo` 的签名未知** | 需要反编译 `0x101D6990` / `0x101D6F50` / `0x101D7E90`；未做 |
| 3 | **`param_1` 的语义未证** | 伪代码只显示它被写入管理器；推断是「宿主标识」，**未验证** |
| 4 | **vtable 布局未验证** | 只知「第 2 个方法」被调用；完整方法表、ABI、结构体大小均未知 ⇒ 跨语言直连**不可行** |
| 5 | **地址依赖 image base** | 表中地址是分析时的 image base 内偏移（本机实测 image base = `0x10000000`，与导出表 RVA 加和逐位吻合）；DLL 重定位后需重算 |
| 6 | **版本漂移** | 分析的是 1.0.0.264；同目录已有 1.0.0.257 残留 ⇒ 该组件会热更，契约可能变 |
| 7 | **38 个 CxImage 导出未逐个核对** | 只按类归组，未验证这些导出是否真被宿主使用（可能是链接期未被裁剪的副作用）|
| 8 | **WEMedia.exe 是否真的分析不完，本轮仍未定论** | 2026-10-19 以 **2 小时**预算重跑中；此前最高只测到 60 分钟 |


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
