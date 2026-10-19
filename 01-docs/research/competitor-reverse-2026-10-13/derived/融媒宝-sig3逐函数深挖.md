# 快手 `sig3` 逐函数深挖 —— VM 内函数 Hook 法、opcode 语义表四大更正、密钥流提取

> **文档性质**：字节码反汇编 + 沙箱内 VM 内部函数直接 hook 调用 + 原文回读交叉验证。
> **取证日期**：2026-10-19
> **核心脚本**：
> - `02-analysis-scripts/sig3-hook14.cjs` —— ★ **31 函数全量 Hook 法**（本轮最核心技术突破）
> - `02-analysis-scripts/sig3-vmexec2.cjs` —— VM realm 内直调全部函数
> - `02-analysis-scripts/sig3-io-probe.cjs` / `sig3-analyze-fn.cjs` / `sig3-ftable.cjs` —— 批量 I/O 提取
> - `02-analysis-scripts/sig3-keystream.cjs` —— 512B 密钥流提取
> - `02-analysis-scripts/sig3-opcheck.cjs` / `sig3-op25.cjs` / `sig3-callvalue.cjs` / `sig3-stacksim.cjs` —— opcode 原文回读
> - `02-analysis-scripts/sig3-read-dollar.cjs` / `sig3-read-d.cjs` / `sig3-readF.cjs` / `sig3-readG.cjs` —— 逐函数反汇编
> **证据**：`04-rea-evidence/sig3-keystream.json`、`sig3-F-table.json`、`hxfalcon-encode-disasm-v2.txt`
>
> **本轮把 sig3 从「结构终版」推进到「每一个标准件都已拿到 I/O 对、每一个 opcode 都已回读原文」**。

---

## 1. ★★★ 技术突破：VM 内部 31 函数全量 Hook 法

### 1.1 问题

字节码子脚本（`t`/`p`/`d`/`F`/`N`/`s`/`g`/`k`/`x`…）是闭包，只在主 fiber 的 locals 槽里，**外部不可达**。

### 1.2 解法（四重障碍逐一排除）

| # | 障碍 | 现象 | 解法 |
| --- | --- | --- | --- |
| 1 | 顶层壳 locals 未初始化 | `Cannot read properties of undefined (reading '0')` | 追加指令必须放**主脚本**（45 个 local 槽），不是顶层壳 |
| 2 | `ld-local` 非 with 作用域下不 push | 栈空 ⇒ set-mem 弹 undefined | 不用 ld-local 复用槽，改用 **make-closure 重建** |
| 3 | 追加位置在主 31 组 make-closure **之后** | 第 32 次 make-closure 栈溢出 ⇒ **只挂 1 个** | 插到主脚本**最前面**（栈还空）⇒ **31/31 全部挂上** |
| 4 | VM 内 globalThis ≠ realm.global | `globalThis.d is not a function` | 走 `__NS_hxfalcon.realm.global[fn]` |

### 1.3 最终代码形态

```javascript
// 1) 主脚本最前插入 62 条（31 组 × 2）
for (let k = 30; k >= 0; k--) {
  ins.splice(0, 0, [75, k, false],   // make-closure scripts[k] → 压函数
                    [34, name])       // global-store args=[name] → global[name]=func
}
// 2) VM realm 内直调（无跨 realm 问题）
vm.runInContext(`__NS_hxfalcon.realm.global["F"]("AB", 0)`, sb)
```

### 1.4 关键约束

- `global-store` 也 push 返回值 ⇒ 末尾追加会导致 `Evaluation stack has 31 items after execution`
- 这是 **VM 的收尾栈检查**，被 eval 的 try/catch 吞掉 ⇒ 功能无损但要知道
- **VM 内 suc 回调**是驱动 `$encode` 的唯一可靠姿势（宿主回调跨 realm ⇒ 收到 null）

---

## 2. opcode 语义表四大更正（原文回读）

| op | 我此前的标注 | 原文回读 | 影响 |
| --- | --- | --- | --- |
| **op29** | ld-local（取） | `push(scopeChain[args[0]].set(args[1], pop()))` —— **st-local（存）** | 全部槽位存取方向对调 |
| **op30** | ld-local（取）✓ | `for (…n instanceof WithScope…) if (n.has(i)) return push(n.get(i))` —— 作用域链查找 | op29/op30 命名对调 |
| **op16** | 无操作（分隔符） | `f(e, 0, "iterator", pop())` —— **消费一个栈值** | 此前用它做「分隔符」属巧合无害 |
| **op70** | push-int 字面量 | `push(e.script.strings[this.args[0]])` —— **strings 下标**（与「字面量」双形态并存） | 追加指令必须用下标 |

### 2.1 call 三兄弟的完整语义（原文回读）

```javascript
// p(e, argc, fn, thisObj, ctorFlag, isConstruct) —— 直接调
p = function(e, t, n, r, o, i) {
  if (typeof n !== "function") throw "object is not a function"
  for (var a=e.evalStack, s=e.fiber, c=e.realm, u={length:t, callee:n}; t;) u[--t]=a.pop()
  r = r || c.global, u = Array.prototype.slice.call(u)
  try { var l = i ? v(n,u) : n.apply(r, u); if (!s.paused) return a.push(l) }
  catch(f) { _(e, f) }        // ← 失败抛 VM 异常，被 call 的 try/catch 吞 ⇒ undefined
}

// f(e, argc, thisObj, methodName, ctorFlag) —— call-value 用
f = function(e, t, n, r, o) {
  var i = e.evalStack, a = e.realm
  if (null == r) throw "Cannot call method '"+n+"' of ..."
  a = a.get(r, n)             // ← realm.get(thisObj, methodName)
  return a instanceof Function ? p(e, t, a, r, o)
       : null == a ? (i.pop(), throw "has no method '"+n+"'")
       : (i.pop(), throw "Property '"+n+"' is not a function")
}
```

**call-value 的 method 名从栈上取**（不是 args[1]）—— 这是本轮探针失败的原因，已记入遗留。

---

## 3. 31 函数的 I/O 对（全部实测）

| 函数 | 条数 | 实测 I/O | 定性 |
| --- | --- | --- | --- |
| **F** | 215 | `F("A")=[19]` `F("AB")=[19,221]` `F("ABCD")=[19,221,63,207]` | **固定密钥流生成器**（与输入无关，512B 已提取） |
| **k** | 43 | `k("AB",32)=[0xAB]` `k("deadbeef",32)=[0xde,0xad,0xbe,0xef]` | **hex 字符串 → 字节数组** |
| **x** | 45 | `x([1,2,3],0)="010203"` | **字节数组 → hex 字符串** |
| **I** | 43 | `I(305419896,0)=[120,86,52,18]`（0x12345678 → LE） | **u32 → 4 字节小端** |
| **s** | 74 | `s("ABCDEFGH",0)="abcced00"` | 摘要取段变换（hex 化 + 补零） |
| **g** | 67 | `g("ABCDEFGH",0)="99"` | 摘要取段（2 字符） |
| **G** | 158 | `G("AB",0)=63` `G("中",0)=204` | **LFSR/CRC 位循环**（8 轮，掩码族 0x7FFFFFFE/0x40000020/0x10000012） |
| **$** | 210 | `$("AB",0)="AB"` `$("中",0)="中"` | **UTF-8 编码器**（surrogate + 1/2/3/4 字节分支） |
| **n** | 115 | `n("x",0)="b58fda08-41c2-4301-8f64-be333982b003"` | **随机 UUID 生成器** |
| **j** | 61 | `j("data","key")="00000000"` | 拼装步进（8 位零串） |
| **c/u/D/Z/e** | 43~45 | `c([1,2,3,4],0)=[0,0]` `u("中",0)=[0,0,0,0]` `D("AB",0)=8×NUL` | 辅助 |
| **d/p/t/N** | 240/374/195/146 | **直调必崩**（内部死循环 ⇒ maxDepth 1e3） | 必须走 t() 主流程 |

### 3.1 F 的密钥流（512 字节，无周期，与 startupRandom 无关）

```
13 dd 3f cf 5e f7 b3 dd 3b 26 ef 26 f6 cd 19 d2 99 7c b3 dd 49 ff 6c bf 4e f3 cc d9 f3 f7 f3 9e …
```

- 256 个单字节输入**全部映射到同一值** ⇒ 密钥流与输入完全无关
- 不同 `startupRandom` 下密钥流相同 ⇒ 只由 `global["ks-seed"]` 驱动
- 512 字节内无周期 ⇒ 长流（对应 F 内部的 4 个循环：种子展开 → 常量混合 → G 位循环）

---

## 4. F(215) 的完整语义重建

```javascript
function F(str, key) {
  var r  = global["ks-seed"]              // 固定种子串
  var v34 = 324508639   (0x13579BDF)      // TEA 三元组
  var v35 = 610839776   (0x2468ACE0)
  var v36 = 4256789809  (0xFDB97531)
  var t  = Math.max(12, r.length)         // 长度下限 12
  var a  = new Array(t)
  // 循环1：种子展开到 12 字节（charCodeAt 循环）
  for (e = 0; e < r.length; e++) a[e] = r.charCodeAt(e % r.length)
  // 循环2：继续填充到 t
  for (; e < t; e++) a[e] = a[e % r.length]
  // 循环3：三元常量混合（各 <<8 | a[e+4]）
  for (e = 0; e < 4; e++) { v34 = (v34<<8)|a[e+4]; v35 = (v35<<8)|a[e+5]; v36 = (v36<<8)|a[e+6] }
  // 循环4：主变换 —— 每字节调 G（LFSR）
  for (e = 0; e < r.length; e++) o[e] = G(a[e], v44)
  return o
}
```

---

## 5. 高位表两段结构（实验证实）

| payload | 高位 nibble（28 个） |
| --- | --- |
| `""` | `fea924ecc aaad790793 dbbbbbbba` |
| `"xy"` | `fea924ecc aaa6f0d793 dbbbbbbba` |
| `"a"` | `45129f577 111af2ec28 600000001` |

- `""` 与 `"xy"` **前 9 nibble 相同** ⇒ 前 9 = 版本字段哈希（`global[""]`/`global["5445"]` 经 `$→d→p` 管道）
- 后 19 nibble = payload 段（随 payload 全雪崩）
- 单字符 payload 走不同切片分支（`a` 与 `""` 前 9 也不同）⇒ 切片起点是 `payload.length` 的函数

---

## 6. 复刻剩余（明确清单）

| # | 任务 | 状态 | 卡点 |
| --- | --- | --- | --- |
| 1 | **中间值探针**（t() 内 12 个 call-value 的输入输出） | ❌ 未成 | call-value 的 method 名从**栈上**取，改 args[1] 无效；改 strings 表也无效；插入 dump 指令破坏流程 |
| 2 | d(240) 字数组打包的精确算法 | ⚠ 已读代码未对拍 | 直调必崩（内部死循环） |
| 3 | p(374) SHA-256 压缩循环 | ⚠ 常量族已知 | 同上 |
| 4 | t(195) 主流程拼装序 | ⚠ 12 调用点已列 | 需要 #1 才能逐段验证 |
| 5 | N(146) 拼装段 concat 顺序 | ⚠ 已读 | 同上 |

**已可交付的部分复刻**：
- F 密钥流（512B 查表）✓
- k/x/I 三个标准件 ✓
- 低位通道 28×16 查找表 ✓（上轮）
- 三元气模型 ✓

---

## 7. 复现

```bash
node sig3-hook14.cjs      # 31 函数全量 hook（核心技术）
node sig3-vmexec2.cjs     # VM 内直调 + I/O 提取
node sig3-keystream.cjs   # 512B 密钥流
node sig3-readF.cjs       # F 全文反汇编
node sig3-stacksim.cjs    # t() 栈模拟（method 名来源分析）
node sig3-structure-final.cjs  # 三元气/雪崩/通道（上轮）
```

---

## 8. 未闭合

| # | 项 | 备注 |
| --- | --- | --- |
| 1 | t() 中间值探针 | method 名从栈取，需先破译 `@13 st-local [1,25]` 的 push 值来源 |
| 2 | d/p/t/N 直调 | 内部死循环，必须走主流程 |
| 3 | SHA-256 管道的精确 I/O 格式 | 依赖 #1 |
| 4 | 活体验证 | 未做 |
