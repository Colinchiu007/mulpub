# 快手 `sig3` 管道中间值捕获 —— 摘要段定性、VM 内插桩法、SHA-256 变体排除

> **文档性质**：沙箱内 VM 内建插桩（不改字节码）+ 管道中间值捕获 + 算法排除实验。
> **取证日期**：2026-10-20
> **核心脚本**：
> - `02-analysis-scripts/sig3-cca.cjs` —— ★ **charCodeAt 插桩**（捕获管道全部中间字符串）
> - `02-analysis-scripts/sig3-pipe6.cjs` —— ★ **fromCharCode 插桩**（多 payload 管道序列）
> - `02-analysis-scripts/sig3-middig.cjs` —— 摘要段与 count/sr 的无关性证明
> - `02-analysis-scripts/sig3-stage3.cjs` —— 阶段3 = 摘要段的 32/32 验证
> - `02-analysis-scripts/sig3-variantsha.cjs` —— 6 个 SHA-256 变体排除
> - `02-analysis-scripts/sig3-prefs.cjs` / `sig3-powlen.cjs` / `sig3-arrpush2.cjs` —— p 结构与调用模式
> **证据**：`04-rea-evidence/sig3-keystream.json`（上轮）、本轮管道序列
>
> **本轮把 sig3 的「摘要段」从黑盒变成可观测对象**：管道三段结构、摘要段的独立变量域、
> 以及 SHA-256 变体的系统性排除，全部落定。

---

## 1. ★★★ 技术突破：VM 内建插桩法（不改字节码）

### 1.1 方法

在 `vm.runInContext` 内用 **IIFE 隔离**替换 VM realm 的内建方法，记录调用参数：

```javascript
R(`globalThis.__L = { fcc: [] };
(function () {
  var __o = String["fromCharCode"];      // ← IIFE 隔离 __o（避免多 patch 冲突）
  String["fromCharCode"] = function () {
    var __r = __o.apply(String, arguments);
    globalThis.__L["fcc"].push(Array.prototype.slice.call(arguments).map(Number));
    return __r;
  };
})();`)
```

### 1.2 关键约束（实测）

| 约束 | 说明 |
| --- | --- |
| **必须 VM 内替换** | 宿主侧替换 `realm.global.String.fromCharCode` 无效（VM 缓存了方法引用） |
| **IIFE 隔离 `__o`** | 多个 patch 共用 `var o` 会互相覆盖 ⇒ 无限递归/错乱（两两组合全破坏的根因） |
| **驱动必须用 `gen__NS_sig3`** | `hf.call("$encode", ...)` 的 suc 回调路径不稳（返回 null）；`gen__NS_sig3` 内部闭包稳定 |
| **安全替换集** | `String.fromCharCode` / `Math.pow` / `Math.floor` / `Math.ceil` / `Array.prototype.push` / `Array.prototype.slice` 全部安全（输出不变） |
| **`String.prototype.charCodeAt` 单装安全** | 131 次调用完整记录（此前「组合破坏」是 IIFE 缺失导致） |

### 1.3 沙箱双全局的真相

```
sandbox String === realm.global.String  →  true（同一对象）
宿主 String !== realm.global.String      →  true（VM 内部构造）
```

⇒ VM 字节码的 `global-load "String"` 与 `vm.runInContext` 代码的 `String` **是同一个**，
   但宿主侧的 `String` 不是 ⇒ 插桩必须在 VM 内做。

---

## 2. ★★★ 管道三段结构（完整捕获）

```
payload ──$() UTF-8──▶ "payload\x80" ──p() 哈希──▶ 32 字节摘要（Latin-1 串）──j×4/g/s──▶ 56 hex
```

### 2.1 实测序列（`fromCharCode` 插桩）

| payload | 序列长度 | 序列（hex） |
| --- | --- | --- |
| `""` | 34 | `80 f9 54 be 74 5a 60 61 91 b7 25 55 28 78 fd 14 c4 49 49 0f 35 35 43 cd 1a bf 10 bb 3e 53 77 ac e4 80` |
| `"a"` | 35 | `61 80 ae 0b e6 10 07 e6 11 56 5b 9e bc fa 7b 73 5f d7 e0 b3 8d 6a da 45 04 e9 1a 51 1c b6 24 9b 2b 48 80` |
| `"abc"` | 37 | `61 62 63 80 5d 16 48 3e fe 03 aa 96 1e 91 31 53 4c bc 4a 1f 47 5d ae da 51 b7 88 d3 69 ef f7 0a e9 89 2a 42 80` |
| `"hello"` | 39 | `68 65 6c 6c 6f 80 ae 5d c0 74 7c 37 85 22 54 c7 b9 c5 b1 5a 33 5f 9e 82 24 2c c4 04 07 1f 48 98 65 11 a9 19 ab 1d 80` |

**结构**：`[payload 原样字符] + 0x80 分隔符 + [32 字节摘要] + 0x80 结尾`

### 2.2 中间字符串（`charCodeAt` 插桩的 this）

| 阶段 | 字符串 | 说明 |
| --- | --- | --- |
| 1 | `"abc"` | payload 原样（charCodeAt 0/1/2 = 97/98/99） |
| 2 | `"abc\x80"` | payload + 分隔符（charCodeAt 3=128，4+ 越界 NaN） |
| 3 | 32 字符 Latin-1 串 | **摘要段**（charCode 序列 = 摘要 32 字节，32/32 验证） |

---

## 3. ★★★ 摘要段的独立变量域（决定性）

| 差分维度 | 摘要段差异 |
| --- | --- |
| payload 变 | **32/32 全变** |
| count 变（100→108） | **0/32 不变** |
| startupRandom 变（T=1750000000000 vs 1730000000000） | **0/32 不变** |

⇒ **摘要段 = f(payload)，与 count/startupRandom 完全独立**
⇒ 与此前「count/sr 在 p() 之后拼进输出串」的结论完全一致
⇒ count/sr 只影响**最终拼装**（j×4/g/s），不影响哈希段

---

## 4. SHA-256 变体系统性排除（6 个全试）

| 变体 | 结果 |
| --- | --- |
| `SHA-256(payload)` | ❌ |
| `SHA-256(payload + ks-seed/0130/5445/…)` | ❌ |
| `SHA-256(prefix + payload + suffix)`（7×6 组合） | ❌ |
| `SHA-256(SHA-256(payload))` | ❌ |
| 变体：消息 16 字从字符串读、越界补 0 | ❌ |
| 变体：消息 64 字全从字符串读、越界补 0 | ❌ |
| 变体：16 字消息 + 调度时读字符串 | ❌ |
| 摘要段 XOR 固定密钥 = SHA-256(payload) | ❌ |
| 摘要段 = 反转/半交换(SHA-256(payload)) | ❌ |

⇒ 摘要段**不是标准 SHA-256 的任何简单变形**。

---

## 5. p(374) 的结构确认

| 特征 | 证据 |
| --- | --- |
| SHA-256 压缩循环 | 常量 `64`（轮数）、`7`/`15`/`16`（消息调度偏移）、`4294967295`（0xFFFFFFFF 掩码）、`0..7`（状态索引） |
| 3 层循环 | 跳转：`@22~62`（外层）、`@59~120`（中层）、`@111~240`（内层）+ 收尾 `@362~371` |
| 调 6 个辅助函数 | `m`/`y`/`w`/`M`/`A`/`S`（20~28 条小函数） |
| **越界读 bug** | `charCodeAt(4..10)` 返回 NaN（字符串长度 4）⇒ 位运算中 `NaN|0=0` ⇒ 消息调度越界补 0 |
| pow 调用恒定 | `pow(2,8)×55 + pow(2,32)×2`，与 payload 长度无关 |

⇒ p 是**有 bug 的 SHA-256**（消息调度越界读补 0），但**输入不是 payload 原样**
（否则标准 SHA-256 变形应能匹配）。

---

## 6. 消息块观测（`Array.push` 插桩）

`payload="abc"` 的第一个数字数组构建序列（28 字节，跨实例完全稳定）：

```
54 45 01 30 | 80 e1 4e 68 64 00 00 00 | 36 81 8b b2 | c1 24 8f 62 01 00 00 10 00 00 00 00 | ef
"UE\x01\x30"    固定 8B                    payload 相关 4B   固定 12B                    payload 相关 1B
```

- 跨实例稳定（3 次 fresh 全同）⇒ 非随机
- 与 count/sr 无关
- 位 11~14 与末字节随 payload 变

⇒ 这是 d() 打包后的中间表示（非 SHA-256 消息，仅 28 字节）。

---

## 7. 复刻剩余（收敛后）

| # | 任务 | 状态 |
| --- | --- | --- |
| 1 | 逐条翻译 d(240) 位重排 + p(374) 压缩 | 未开始（约 600 条指令） |
| 2 | 摘要段算法（非标准 SHA-256，疑为 d 变换后进 p） | 依赖 #1 |
| 3 | j×4/g/s 拼装（count/sr 在此进入） | 未开始 |
| 4 | 差分验证器 | 未开始 |

**已可交付**：
- 管道三段结构 + 摘要段独立变量域 ✓
- VM 内建插桩法（可复用）✓
- 6 个 SHA-256 变体排除 ✓
- p 的结构与 bug 特征 ✓

---

## 8. 复现

```bash
node sig3-cca.cjs        # charCodeAt 插桩（管道中间字符串）
node sig3-pipe6.cjs      # fromCharCode 插桩（多 payload 序列）
node sig3-middig.cjs     # 摘要段与 count/sr 无关性
node sig3-stage3.cjs     # 阶段3 = 摘要段验证
node sig3-variantsha.cjs # SHA-256 变体排除
node sig3-prefs.cjs      # p 的结构
node sig3-powlen.cjs     # pow 调用模式
node sig3-arrpush2.cjs   # 消息块观测
```

---

## 9. 未闭合

| # | 项 |
| --- | --- |
| 1 | 摘要段算法（d 变换 + p 压缩的精确组合） |
| 2 | j×4/g/s 拼装语义 |
| 3 | 活体验证 |
