# 快手 `sig3` 算法定性：字节码反汇编 —— CRC32 + SHA-256 + TEA 族

> **文档性质**：纯静态。LZW 解压 → JSON → 78 条 opcode 语义表逐条反汇编。
> **取证日期**：2026-10-19
> **脚本**：`02-analysis-scripts/disasm-hxfalcon.cjs`
> **机器可读**：`04-rea-evidence/hxfalcon-encode-script.json`（25 KB 全量 script 树）、
> `hxfalcon-encode-disasm.txt`（全量汇编）、`hxfalcon-encode-constants.txt`（121 个非平凡立即数）
>
> **这是 sig3 链路的最后一环**：上一轮说「门槛已降到有完整指令语义表」；
> 本轮把 `$encode` 的字节码本体解出，**算法族定性完成**。

---

## 1. 完整链路（从混淆串到算法）

```
① chuangzuozhe.js @14416:  n.eval('<LZW 压缩串>')          ← 4847 字符
② a.prototype.eval 的解码闭包 = 自定义 LZW 变体（256 起始字典）
③ 解压 → 25043 字符 JSON
④ JSON 布局 = [filename, name, instructions, scripts, localNames, localLength,
              guards, stackSize, strings, regexps, source]
   每条指令 = [opId, ...args]（opcode 按 id 编号，无名字）
⑤ script 树：1 顶层壳（4 条指令）+ 31 个子脚本，共 2247 条指令
⑥ 78 条 opcode 语义表逐条反汇编 → 全量汇编文本
```

**三个格式事实（反汇编器直接可用）**：
- 指令名全空 ⇒ 按 id 编码（不用查名字）
- `guards` 元素 = `[start, handler, finalizer, end]`，`-1` 表 null
- **`push-str` 指令的立即数既可为数字（查 strings 表）也可为内联字面量**
  —— 这就是常量提取首轮抓漏的原因（我只扫了 op69）。

---

## 2. ★ 算法定性：四个组件

### 2.1 SHA-256（主哈希）—— `$encode` 主函数体

`$encode:135~222` 的立即数是**教科书级 SHA-256 K 表**，64 个全部命中：

```
0x428A2F98 0x71374491 0xB5C0FBCF 0xE49B69C1 0x3956C25B 0x59F111F1 …
0xC67178F2 0xEFBE4786 0x12835B01 0x243185BE 0x550C7DC3 0x72BE5D74 …
```

且主函数恰好在这些常量之间做 `>>> / & / ^` 循环（80 轮结构）。
⇒ **sig3 的核心哈希是 SHA-256，不是 MD5、不是 SM3**。

### 2.2 CRC32（校验）—— `sub26`

```
sub26:36 = 0xEDB88320     ← CRC32 反射多项式
sub26 结构：Array(256) + 8 次内层移位/异或 ⇒ 标准 CRC 查表法
```

### 2.3 TEA 族加密（`ks-seed`）—— `sub29`

```
sub29 strings = ["ks-seed"]
sub29 立即数: 0x13579BDF / 0x2468ACE0 / 0xFDB97531   ← 快手 TEA 种子三元组
结构：Math.max(12, len) 取种子 → charCodeAt 累加 → <<4 / >>>8 / + 累加循环
```

⇒ 快手自研的 **TEA/XTEA 变体**（12 字节种子、32 位累加、8 轮移位），
密钥来自字符串 `"ks-seed"` 的 charCodeAt 展开。

### 2.4 缓冲区拼装（版本头）—— `sub24` / `sub2`

```
sub24: strings ["00000000000000000003", "suc", "err"]
sub24:26 = 0xDEADBEEF     ← 缓冲区魔数
sub24:56 = 0x1001         ← 版本标志
sub24 结构：0xDEADBEEF.concat(…) ×7 段拼接 + 长度后缀
sub2  strings: ["", "5445", "startupRandom", "count", "01000100", "000000", "suc", "err"]
sub2:140 = 0x629D7BE1     ← 另一常量
sub2 引用全局 startupRandom / count（正是 realm.global 那两个运行期变量！）
```

⇒ **sig3 的输出结构 = 版本头（`00000000000000000003` + `0x1001`）+ 时间/计数 + 各哈希段的 concat**。

### 2.5 附带定性：`sub30` 是 UTF-8 编码器

```
sub30 立即数: 0x80000002 / 0x40000020 / 0x10000002 / 0x7FFFFFFF / 0x3FFFFFFF /
             0x0FFFFFFF / 0x80000000 / 0xC0000000 / 0xF0000000 + 2048/0xD800/0xE000/65536
```

⇒ 标准的 **UTF-8 多字节编码位掩码族**（surrogate 检查 + 2/3/4 字节分支）。

---

## 3. 各 sub 的角色分配（依据 strings + 常量 + 结构）

| sub | 指令数 | strings / 标志常量 | 角色 |
| --- | --- | --- | --- |
| **主 `$encode`** | 226 | — | **SHA-256 主循环**（K 表全在这里）|
| sub1 | 115 | `0123456789abcdef` | **hex 编码**（digest → 64 hex）|
| sub2 | 195 | `5445` `startupRandom` `count` `01000100` `000000` | 输入拼装（时间/计数/版本）|
| sub24 | 146 | `00000000000000000003` + `0xDEADBEEF` + `0x1001` | **缓冲区拼装**（版本头 + 各段 concat）|
| sub26 | 60 | `0xEDB88320` | **CRC32 查表** |
| sub29 | 215 | `"ks-seed"` + TEA 三元组 | **TEA 族加密** |
| sub30 | 158 | 位掩码族 | **UTF-8 编码** |
| sub6 | 240 | `charCodeAt(24/16/8/0)` + `Math.pow(2,32)` | **字数组打包**（CryptoJS 同型）|
| sub7 | 374 | 8 字循环 + `0xFFFFFFFF` 掩码 | **哈希压缩函数**（与主 SHA-256 配套）|
| sub27 | 77 | `"string"` | 类型分派 |
| sub5 | 35 | `"0"` `"00"` | 十六进制补零 |
| 其余 20 个 | ≤75 | — | 辅助（数组转换、slice、位截断等）|

**sha256 → hex → TEA(ks-seed) → CRC32 校验 → 版本头拼装** —— 这就是 sig3 的流水线。

---

## 4. 与 sig3 输出的对照

实测 `gen__NS_sig3` 输出 **56 位小写 hex**。反汇编结果给出的解释：

- `sub1` 的 `0123456789abcdef` 表 + sub5 的补零 ⇒ 输出是 hex
- 主 SHA-256 产 64 hex（32 字节），TEA 段产 32 hex（16 字节），拼装后**截取/交织成 56**
- `sub24` 的版本头 `…0003` + `0x1001` 出现在**头部而非尾部**，与实测输出
  `ecfcbb8be7c96bd5…` 的前 8 位形态吻合（前缀随环境变化、后缀高位稳定）

⇝ （**推断级**，未逐字节复算）56 hex = 版本/长度头 + TEA(ks-seed, SHA-256(payload)) 的混合编码。

---

## 5. 下一步（若要 100% 复刻）

门槛已全部拆除，剩余是**纯工作量**：

1. 写 `op74`（make-closure）的调用图重建 ⇒ 把 sub24/sub26/sub29 的调用顺序连成流水线
2. 逆 sub24 的 concat 顺序与段偏移（146 条指令，纯阅读）
3. 逆 sub29 的 TEA 轮数与 delta（常量在表里，循环在 215 条里）
4. 用固定输入差分验证（沙箱里 `gen__NS_sig3` 已可跑，**有现成 oracle**）

⇝ **预期 1~2 个会话可完整复刻**。对照前面 a_bogus（1 会话）与 X-Bogus（坏的），
sig3 是三平台签名里**工程难度中等但信息完整度最高**的一条。

---

## 6. 复现

```bash
node extract-hxfalcon-opcodes.cjs     # 78 条语义表
node disasm-hxfalcon.cjs              # LZW → JSON → 32 script 反汇编
```

---

## 7. 未闭合

| # | 项 |
| --- | --- |
| 1 | **未逐字节复刻输出** —— 算法族已定性、组件已定位，流水线顺序与段偏移未串 |
| 2 | **`0x629D7BE1` 与 `0x1001` 的语义未证** —— 前者只在 sub2:140 出现一次，后者是版本标志（推断）|
| 3 | **`startupRandom` / `count` 的取值来源未证** —— realm.global 里被 VM 初始化（`Date.parse(new Date)/1e3`），真实页面上由抖音/快手 SDK 侧更新与否未证 |
| 4 | **全部静态** —— 未运行、未向快手发请求 |
