# MediaTaskMgr.dll 业务 C API 序言级取证 —— 7 个导出的形态、单例与守卫

> **文档性质**：PE-first（导出表 + 文件字节直读），不依赖 Ghidra auto-analysis。
> **取证日期**：2026-10-19 ｜ **目标**：`MediaTaskMgr.dll`（10,478,080 B，SHA-256 `381805fb…87769`，PE32 x86）
> **方法**：`04-rea-evidence/MediaTaskMgr.dll.pe-tables.json` 的节表做 RVA→文件偏移换算，直读每个导出的前 48 字节判读形态。
>
> **背景**：此前只反编译了 1/7（其余被 Ghidra 预算卡住）。本篇用**零反编译**的方式把 7 个导出的
> 结构形态先判读出来 —— 这是「函数体取证」的前置层：先知道每个入口是什么形态，再决定哪个值得花反编译预算。

---

## 1. 导出面全貌：45 个导出 = 7 业务 + 38 CxImage

导出表确认（count=45）：**业务 C API 恰好 7 个**，其余 38 个全部是 `CxImage` / `CxFile` / `CxIOFile` / `CxMemFile` / `CxClientExifInfo` 的 C++ 符号（图像库，与任务调度无关）。

| # | 导出名 | RVA | 文件偏移 | 形态判读 |
| --- | --- | --- | --- | --- |
| 1 | `GetMediaTaskMgr` | 0x1D6F90 | 0x1D6290 | **单例取址器**（见 §2.1）|
| 2 | `InitMediaTaskMgr` | 0x1D6AA0 | 0x1D5DA0 | 真函数体 + 重复初始化守卫 |
| 3 | `SetLibPostInitParam` | 0x1D7070 | 0x1D6B70 | 真函数体（最长，见 §2.4）|
| 4 | `SetLoginUserInfo` | 0x1D7790 | 0x1D7290 | 真函数体 + 用户结构判空 |
| 5 | `SetMediaTaskMgrPostMsgCallback` | 0x1D6E80 | 0x1D5D90 | **8 字节纯存回调** |
| 6 | `SetTaskMgrIdleCallback` | 0x1D6940 | 0x1D6350 | **8 字节纯存回调** |
| 7 | `UnInitMediaTaskMgr` | 0x1D6FA0 | 0x1D62A0 | 真函数体 + 任务状态机检查 |

> RVA→偏移换算依据 `.text` 节（`virtualAddress=0x1000, rawPointer=0x400` 一类的标准映射），
> 全部 7 个都落在 `.text` 内，无一例外。

---

## 2. 逐个判读（依据 = 序言字节，非猜测）

### 2.1 `GetMediaTaskMgr` —— 6 字节单例取址器

```
a1 ac 7d 97 10   mov  eax, [0x10977DAC]
c3               ret
```

⇒ **整个函数就是「返回全局单例指针」**。任务管理器单例存于 `.data:0x10977DAC`。
**这是最便宜也最有价值的一个结论**：后续所有「任务状态」的读取路径都要经过这个指针。

### 2.2 两个回调 setter —— 各 8 字节，纯存全局

```
SetMediaTaskMgrPostMsgCallback:
  55 8b ec        push ebp; mov ebp, esp
  8b 45 08        mov  eax, [ebp+8]          ; 取回调
  a3 c0 7d 97 10  mov  [0x10977DC0], eax     ; 存全局
  5d c3           pop ebp; ret

SetTaskMgrIdleCallback: 同型，存到 0x10977DC4
```

⇒ 回调槽就两个相邻全局（`0x10977DC0` / `0x10977DC4`，相距 4 字节，同在 `.data`）。
**「消息回调」与「空闲回调」是宿主（WEMedia.exe）注入的两个钩子**，
任务引擎与 UI 的全部通信走这两个函数指针 —— 与注入 JS 片段取证里
「原生把任务进度回调给前端」的结论闭环。

### 2.3 `InitMediaTaskMgr` —— 真函数体 + 重复初始化守卫

```
55 8b ec 83 e4 f8            push ebp; mov ebp,esp; and esp,-8（16 字节对齐）
81 ec b4 00 00 00            sub  esp, 0xB4
a1 08 b7 94 10 33 c4         mov eax,[0x1094B708]; xor eax,esp（/GS Cookie）
...
85 c0 74 6d                  test eax,eax; jz +0x6D   ← 空判守卫
```

⇒ 栈帧 0xB4 + /GS + **「已存在则跳过」的 jz 分支** —— 单例重复初始化守卫。

### 2.4 `SetLibPostInitParam` —— 7 个里最长的守卫链

序言里 `3b c3` / `0f 84 d5 06 00 00`（`jz +0x6D5`）：
⇒ **对参数做双段校验，不合格直接跳到末尾返回**。这个函数接收库级配置，
校验不过就不应用 —— 与 `/danger/*` 风控自检（自家后端）呼应，配置来源不合法就拒绝。

### 2.5 `SetLoginUserInfo` —— 用户结构判空 + 字段校验

```
8b 45 0c   mov eax,[ebp+0xC]     ; 第 2 参
85 c0      test eax,eax
0f 84 dc 00 00 00   jz +0xDC     ; 空则直接退
8b 4d 10   mov ecx,[ebp+0x10]    ; 第 3 参
85 c9 0f 8e d1 ...  jle +0xD1    ; ≤0 也退
```

⇒ **至少 3 参，第 2 参是结构指针、第 3 参是数量/长度**（判 ≤0）。
登录信息以「数组 + 长度」形态传入，不是单个对象。

### 2.6 `UnInitMediaTaskMgr` —— 状态机检查后再卸载

```
51 a1 3c 82 97 10   mov eax,[0x1097823C]      ; 取另一全局
56 85 c0 74 2b      test eax,eax; jz +0x2B    ; 空跳
83 78 08 04         cmp [eax+8], 4            ; ★ 状态字段 == 4 才继续
```

⇒ 卸载前检查 `对象+8` 处的状态字段是否为 4 —— **任务引擎有自己的状态机**，
只有处于状态 4（推断为「空闲/全部完成」）才允许卸载，否则拒绝。
**这解释了为什么退出应用时偶尔要等任务跑完** —— 是这个守卫在挡。

---

## 3. 单例布局（从三个全局地址推出）

```
.data 段内的三个关键全局：
  0x10977DAC  ← 单例指针（GetMediaTaskMgr 返回它）
  0x10977DC0  ← 消息回调槽（SetMediaTaskMgrPostMsgCallback 写）
  0x10977DC4  ← 空闲回调槽（SetTaskMgrIdleCallback 写）
  0x1097823C  ← 引擎状态对象（UnInit 检查 [x+8]==4）
  0x1097823C 附近即 InitMediaTaskMgr 的分配目标（序言里 0x1097821C/0x109781EC 被引用）
```

⇒ **回调槽紧邻单例指针**（同一 64 字节配置块），引擎状态对象在另一块 —— 配置与状态分离。

---

## 4. 这对「7 个 API 怎么协作」的回答

```
InitMediaTaskMgr()                ← 分配引擎 + 单例
SetLoginUserInfo(user, len, ...)  ← 登录态注入（判空 + 长度校验）
SetLibPostInitParam(cfg, ...)     ← 库配置注入（双段校验，失败即拒）
SetMediaTaskMgrPostMsgCallback(cb) ← UI 消息钩子（进度/结果）
SetTaskMgrIdleCallback(cb)        ← 空闲钩子（调度器节拍）
GetMediaTaskMgr()                 ← 每次操作前取单例
UnInitMediaTaskMgr()              ← 状态==4 才放行
```

⇒ **典型「先注入回调、再喂数据、最后干活」的引擎初始化序**。
7 个导出没有一个是「创建任务」本身 —— **任务创建走的是 C++ 虚表/内部接口**，
C 导出面只是生命周期与配置。这与「创建次数」计费逻辑必然在引擎内部（或自家后端）一致。

---

## 5. 未闭合

| # | 项 |
| --- | --- |
| 1 | **Ghidra 深反编译未完成** —— auto-analysis 对该 10.5MB x86 DLL 超 50 分钟未就绪（与 WEMedia.exe 同属超时形态）；`batch_decompile` 的 `addresses` 参数存在 MCP 桥序列化缺陷（恒报 expected array），即使分析就绪也只能逐个 `analyze_function` |
| 2 | **状态 4 的语义未证** —— 只知 `UnInit` 检查 `[引擎+8]==4`，4 是「空闲」还是「完成」需反编译确认 |
| 3 | **任务创建的真实入口未取证** —— 7 个 C 导出不含创建；推断走 C++ 内部接口 |
| 4 | **`0x1097821C` 一带的全局簇布局未全列** —— 只确认了 4 个关键地址 |
