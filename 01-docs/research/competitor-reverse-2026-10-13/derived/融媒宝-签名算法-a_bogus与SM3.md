# 融媒宝签名体系（四）：`a_bogus` 完整还原 —— 含 SM3 国标向量验证与竞品缺陷复现

> **文档性质**：算法由**静态阅读竞品已交付的明文 JS**（`Asset/sign2/sign3.js`，13,990 B）还原，
> 并用**竞品原件当测试预言机**做差分验证。不执行竞品、不联网。
> **取证日期**：2026-10-19
> **实现**：`02-analysis-scripts/abogus-signature.cjs` ｜ **测试**：`abogus-signature.test.js`（**12 例全绿**）
> **前置**：`derived/融媒宝-签名算法-TKK与gtk系列.md`（第三档，已完整移植）

---

## 1. 结论先行

| 项 | 结果 |
| --- | --- |
| `a_bogus` 能否完整还原 | ✅ **能** —— 纯 JS 明文，无 VM |
| 输出形态 | **44 字符**，取自 **64 字符**字母表（11 组 × 4）|
| 底层哈希 | **SM3**（GB/T 32905-2016）—— 竞品自实现，非 MD5/SHA |
| **SM3 正确性** | ✅ **命中 2 个国标向量**（`"abc"` 与 64 字节 `"abcd"×16`），**不依赖竞品** |
| **与竞品逐字符一致** | ✅ **112 组组合**（4 URL × 4 data × 7 UA）全部相等 |
| 发现的竞品缺陷 | ✅ 1 个（UA 长度恰 29 时抛 `ReferenceError`，见 §6）|

⇒ 这是竞品签名体系里**第二档被完整攻克**的（第一档是 `TKK`/`gtk`）。
与 `X-Bogus` 形成对比：后者虽然也**大部分是明文**，但竞品那份 `sign4.js` **产出的签名与任何输入无关**（见调度层文档 §5），**不可用作参照**。

---

## 2. 六个部件（缺一不可复现）

```
params = url 问号后全部 + "bds"           ← 注意这个 "bds" 后缀
data   = 请求体 + "bds"
        ↓
① SM3(SM3(params))  → params_arr[21], params_arr[22]
   SM3(SM3(data))    → data_arr[21],   data_arr[22]
   SM3(encrypt_browser(ua)) → browser_arr[23], browser_arr[24]
        ↓
② arr29：29 字节，拼时间戳分量 + 上述 6 个哈希字节 + 常量
   arr[28] = arr[0..27] 的 XOR 校验
        ↓
③ arr4：从 timestamp3 派生的 4 字节
        ↓
④ RC4(key="\x83") 作用于 arr29 → 29 字节
        ↓
⑤ garbled = arr4(4) + RC4出(29) = 33 字节
        ↓
⑥ 自造 base64：每 3 字节 → 4 字符，共 11 组 = 44 字符
```

### 2.1 `encrypt_browser(ua)` 的两段式（最容易漏的一段）

```
① RC4 变体（固定 S 盒为初始状态）→ 与 UA 等长的字节串 oo
② 若 ua.length !== 29：把 oo 用**另一套**字母表 str0 做 base64
   且 ua.length % 3 !== 0 时，末位**恒定换成 1 个 "="**
```

> **★ 这是我在本轮唯一一次真踩坑**：第一版只实现了 ①，结果 `encrypt_browser` 输出 111 字符
> 而竞品是 148 字符。因为没看到 ②，`a_bogus` 的差分就在 2–3 个字符上错。
> 用分层诊断工具（`probe-abogus-layers.cjs`）从最底层往上比，才定位到漏了 base64 这一整段。
> **教训：链式算法必须从底层逐层比对，不要从最终输出猜。**

### 2.2 两套字母表**不通用**（易错点）

| 用途 | 变量名 | 字母表 |
| --- | --- | --- |
| `a_bogus` **输出** | `short_str` | `Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe` |
| `encrypt_browser` 内部 base64 | `str0` | `ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe` |

两套都是 **64 字符**、都含 `-` 与 `+` 两个非标准 base64 字符，但**排列完全不同**。
`X-Bogus`（`sign4.js`）用的是第三套。**混用即错**。

---

## 3. SM3 的独立验证（不依赖竞品）

这是本文最硬的证据层：SM3 是**国标算法**，有公开测试向量，所以可以**完全不看竞品**就验证实现对错。

| 输入 | 期望（国标） | 实测 | |
| --- | --- | --- | --- |
| `"abc"` | `66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0` | 同 | ✅ |
| `"abcd"×16`（64 字节，整分组边界）| `debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732` | 同 | ✅ |

对照竞品原件自身的 `get_arr("abc")` 输出也是同一个值 ⇒ **竞品的 SM3 没改过**（是标准实现）。

### 3.1 竞品 SM3 实现里三个必须照抄的细节

1. **IV 与国标一致**：`1937774191, 1226093241, 388252375, 3666478592, 2842636476, 372324522,
   3817729613, 2969243214`（= `0x7380166F…0xB0FB0E4E`）
2. **P1 置换**：`n ^ ROL(n,15) ^ ROL(n,23)` —— 竞品写作 `le(n,15)^le(n,23)`，`le` 就是 ROL
3. **UTF-8 编码器用 `encodeURIComponent` 拼** —— 对**孤立代理项**的处理与
   `Buffer.from(s,'utf8')` 不同（后者替换成 U+FFFD）。为逐字节一致，本实现复刻了它的写法。

---

## 4. 差分验证：112 组全等

**没有构造任何期望值。** 把竞品原件加载进隔离 `vm`，把 `Date.now` / `Math.random`
替换成常量以获得确定性，然后逐字符比对：

| 维度 | 覆盖 |
| --- | --- |
| URL | 4 个（长 query / 带 aweme_id / 带 item_ids / 极短 query）|
| data | 4 种（空串 / JSON / form-encoded / `{}`）|
| UA | 7 种（Chrome / Safari / Edge / iOS / Android / 单字符 / 空串）|
| **合计** | **112 组，全部相等** |

同时**逐层**验证中间量（`arr29` 逐元素、`encrypt_browser` 逐字符、各 SM3 输入哈希），
保证不是「最终碰巧相等」。

### 4.1 差分测试的确定性处理

竞品 `getGarbledString` 内部调用 `Date.now()` 一次、`Math.random()` 两次：

```javascript
timestamp1 = Date.now()
timestamp2 = timestamp1 - Math.floor(Math.random() * 1000)
timestamp3 = timestamp1 + Math.floor(Math.random() * 30000)
```

冻结成 `Date.now() → T1`、`Math.random() → 0.5` 后，`t2 = T1-500`、`t3 = T1+15000` 完全确定，
本实现则**显式接收三个时间戳**作参数 ⇒ 两边可逐字符比较。

> **踩过的坑**：沙箱里只给 `Math = { random, floor }` 会因竞品代码用到 `Math.min`
> 而 `TypeError`。正解是 `Object.create(Math)` 后只覆盖 `random` —— **只封目标方法，不削其余能力**。

---

## 5. SM3 与 a_bogus 的关系（一次口径修正）

此前文档写「抖音 `a_bogus` = SM3」。这句话**不完整**，正确口径是：

> `a_bogus` **用** SM3 作哈希原语，但 SM3 只是六个部件之一。
> 能否复现 `a_bogus`，缺 SM3 固然不行，**只有 SM3 也远远不够** ——
> 还要 `encrypt_browser` 的两段式、arr29 的确切字节布局、arr4 的位运算、RC4 的 key、以及那套 64 字符字母表。

本轮之前「a_bogus = SM3」被读成「已知算法所以不难」，实际是**六部件链式结构**。

---

## 6. ★ 发现的竞品缺陷：UA 长度恰 29 时抛 `ReferenceError`

### 6.1 现象

`encrypt_browser` 末尾的 base64 段写成：

```javascript
if(ua.length != 29){
    str0 = "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe"
    oo2 = ""                      // ← 没有 var，是隐式全局
    for (j = 0; j < oo.length; j += 3) { ... }
    if ((ua.length % 3) != 0) { oo2 = oo2.slice(0, -1) + "=" }
}
return oo2;                        // ← 当 ua.length === 29 时 oo2 从未存在
```

⇒ `ua.length === 29` 时 `oo2` **从未被声明**（无 `var`、且只在 `!= 29` 分支里赋值），
`return oo2` 抛 **`ReferenceError: oo2 is not defined`**。

### 6.2 旁证：那条分支专用的 S 盒也是坏的

| S 盒 | 用在哪 | 形态 |
| --- | --- | --- |
| `sboxUaOther` | `ua.length !== 29`（正常路径）| ✅ 0..255 的**正常置换** |
| `sboxUa29` | `ua.length === 29`（坏分支）| ❌ **`0` 出现两次、缺 `62`** |

**一个从没被执行过的分支，S 盒和返回值一起烂掉是合理的** —— 两条证据互相印证
「`ua.length === 29` 这条路从未被走过」。

### 6.3 现实影响 ≈ 0，但值得记

真实浏览器 UA 都是 100+ 字符，不会命中 29。所以这是**死代码缺陷**，不是可利用漏洞。
但它的价值在于：**它说明竞品这份签名代码有未被测试覆盖的分支** ——
若将来平台要求某种短 UA，这条路径会立刻崩。

本实现的选择：**显式抛同样的 `ReferenceError` 并附归因字段**，而不是静默返回 `undefined`
或"顺手修好"。理由是差分测试要求**忠实复现**竞品行为；"修好"会让两边不一致，反而掩盖真实分歧。

---

## 7. 算法要点速查（实现时自查用）

| 部件 | 数值 / 规则 |
| --- | --- |
| `params` | `url.slice(url.indexOf("?") + 1) + "bds"` |
| `data` | `data + "bds"` |
| 三层哈希 | 都做**两遍** SM3（`SM3(SM3(x))`），取数组形态 |
| 取用下标 | `params_arr[21..22]`、`data_arr[21..22]`、`browser_arr[23..24]` |
| `arr[0]` | 固定 **65** |
| `arr[10]` / `arr[22]` / `arr[27]` | 固定 **1** / **14** / **3** |
| `arr[28]` | `arr[0..27]` 逐字节 XOR |
| RC4 key | `"\x83"`（单字节 0x83）|
| `get_arr4` 常量 | `[[3,66]]` `[3,66]` `170` `85`，`b.slice(7)` 取 4 个 |
| 输出分组 | `for (i = 0; i <= 30; i += 3)` → 11 组 |
| 分组位运算 | `baseNum = c2 \| (c1<<8) \| (c0<<16)`，取 `&16515072>>18`、`&258048>>12`、`&4032>>6`、`&63` |

> `c0` 是**高位**字节（`<<16`），不是低位 —— 这个顺序写反了签名就完全不对，且 44 字符长度照样正确，**不会报错**。

---

## 8. 复现

```bash
# 从竞品原件机械提取常量（两套 S 盒 + 两套字母表）
node extract-abogus-constants.cjs

# 12 例验证（含 2 个 SM3 国标向量 + 112 组差分 + 缺陷复现）
node --test abogus-signature.test.js

# 单次计算
node abogus-signature.cjs "<url>" "<data>" "<ua>"

# 分层诊断（整体差分不一致时用）
node probe-abogus-layers.cjs
```

---

## 9. 未闭合

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | **`a_bogus` 是否被平台接受（活体验证）** | 全部结论都是与竞品原件比对，**没有向抖音发过任何请求**。签名"算得对"≠"平台认" |
| 2 | **UA 长度 29 之外的边界未穷举** | 只测了 4 URL × 4 data × 7 UA；未测超长 data、非 ASCII 参数、缺 `?` 的 URL |
| 3 | ~~X-Bogus 未攻克~~ | ✅ **已澄清（2026-10-19）**：不是「难」，是**竞品这份实现坏了** —— `sign4.js` 输出只随时间戳变化，params/data/UA 全丢（根因已定位到 `_0x1f3b8d` 收到 WordArray 而非 hex 串）。详见 `融媒宝-签名调度层-注入JS与桥契约.md` §5 |
| 4 | **`encrypt_browser` 的 S 盒来源未知** | 两套 256 元素表从哪来（平台下发？固定常量？）未取证 |
| 5 | **`"bds"` 后缀的含义未知** | 猜测是厂商标记（bd + s?），未验证 |
| 6 | **`.slice(0,-1)+"="` 的非标准补齐未解释** | 标准 base64 应按缺失字节数补 `=`；竞品恒定替换 1 个字符。本实现照抄，但这是否是平台要求未知 |
