# 快手 `sig3` 与它的 `hxfalcon` 引擎 —— 顺带修掉我自己一个「假的失败」

> **文档性质**：纯本地静态读码 + 在 Node `vm` 里加载竞品文件做行为实测。不联网、不向平台发请求。
> **取证日期**：2026-10-19
> **脚本**：`02-analysis-scripts/probe-kuaishou-sig3.cjs`
>
> **本文解决两个问题**：
> ① 定性 `chuangzuozhe.js`（3.4 MB）—— 此前项目里唯一「性质未定」的大文件；
> ② 顺带修掉一个**方法论级别**的坑：我上一轮把「我的 harness 坏了」误判成「竞品的代码坏了」。

---

## 1. 定性：`chuangzuozhe.js` 是**快手**的 bundle

此前怀疑是抖音/字节的 `ugc_monorepo`。**都不对。** 判据是文件末尾的三行：

```javascript
var __NS_hxfalcon = pack_loads(7606)

function gen__NS_sig3(data) {
    let sign;
    __NS_hxfalcon.call("$encode", [data, {
        suc: function (lt, gt) { sign = lt; },
    }])
    return sign
}
```

**`gen__NS_sig3` 正是 exe 注入脚本里调用的那个函数**（见 `融媒宝-签名调度层-注入JS与桥契约.md` §2.5）：

```javascript
var sig3=gen__NS_sig3(sig3_data); window.JsKuaishouGetSig3(_account_id,sig3);
```

⇒ **`chuangzuozhe.js` 就是快手 `sig3` 的载体**。旁证：

| 证据 | 值 |
| --- | --- |
| 文件内 `kuaishou` 命中 | **21 次** |
| 文件内 `sign` 命中 | 6 次 |
| 模块加载器 | `pack_loads`（**不是 webpack**，是快手自建）|
| `pack_loads` 调用 | 3 次 |
| 抖音/小红书标识 | **0 次** |
| 体积 / 行数 | 3,440,293 字符 / 85,223 行 |
| 驱动页 | `sign5.html`（只有 `<script src="chuangzuozhe.js">`）|

至此三个大 bundle 全部定性完毕：

| 文件 | 体积 | 归属 | 提供什么 |
| --- | --- | --- | --- |
| `sign2.js` | 6.3 MB | **小红书**官方 bundle（`webpackChunkugc_monorepo`）| `window.cssSign`（`X-s`/`X-t`）|
| `main.js` | 2.0 MB | **小红书**官方 bundle | 同上 |
| **`chuangzuozhe.js`** | **3.4 MB** | **快手**官方 bundle | **`gen__NS_sig3`**（`sig3`）|
| `sign3.js` | 13.7 KB | 竞品自研 | `a_bogus`（已完整还原）|
| `sign4.js` | 28.8 KB | 竞品自研（坏）| `X-Bogus`（见 §4）|

---

## 2. `hxfalcon` 是什么：快手自研的 **JS 字节码 VM**

`pack_loads(7606)` 取出模块 7606，它自执行成一个 `a` 类实例：

```javascript
7606: function(e) {
    !function(t, n) { e.exports = n() }(window, (function() {
        return n = {}, e.m = t = [function(e, t) { ... }], ...
```

### 2.1 API 面（运行期实测）

我在 `vm` 里载入后枚举原型链：

| 层级 | 成员 |
| --- | --- |
| 自身 | `realm` |
| 原型 | **`eval` · `run` · `call` · `createFiber`** |

`: 这是**一个完整的 JS 解释器**，不是普通函数库。`createFiber` 说明它支持**协程/可暂停执行**。

### 2.2 内部结构（读码取证）

```
this.realm = new r(e)                    // 执行域
this.realm.global.startupRandom = Date.parse(new Date) / 1e3
a.prototype.run = function(e, t) {
    if (t = this.createFiber(e, t), t.run(), !t.paused) return t.rexp
}
a.prototype.call = function(e, t) {
    try { return this.realm.global[e].apply(this, t) }
    catch (o) {}                         // ★★ 空 catch
}
a.prototype.createFiber = function(e, t) {
    return t = new i(this.realm, t), t.pushFrame(e, this.realm.global), t
}
```

Fiber 内部（另一段）：`this.ip++`（**指令指针**）、`this.evalStack`、`this.scope`、
`new d(n, e.localNames, e.localLength)`（**局部变量表**）、`this.fiber.timeout--`、
`this.maxDepth = 1e3`、`this.paused`。

⇒ 具备**指令指针 / 求值栈 / 局部变量表 / 超时与深度守卫 / 可暂停 fiber** —— 标准字节码 VM 的六件套。

### 2.3 `realm.global` 的 27 个键（实测）

```
window · undefined · Object · Function · Number · Boolean · String · Array · Date
RegExp · Error · StopIteration · Math · JSON · console · encodeURIComponent
unescape · Uint8Array · parseInt · escape · decodeURIComponent · global
startupRandom · count · $encode · $encr…（余下被截断）
```

⇒ `$encode` **确实存在**且是函数。`StopIteration` 这个键是**迭代器协议内建**，
进一步印证它是解释器（而不是业务库）。

`$encode` 的处理逻辑在 @14736 附近，是一整片**混淆字符串表**：
`ğŽŵŷ37ƃű3ŴşĖ3ŗŮŌŚ2ƎũƐŢƓřűġƆƏČ3ůů…`（大量 Unicode 私有区字符）
⇒ 真正的 sig3 算法在**该字节码里**，不在这层明文。

---

## 3. ★ 我上一轮把自己的 harness bug 误判成了「竞品代码坏了」

### 3.1 现象

第一次测 `gen__NS_sig3`，**所有输入都返回 `undefined`**：

```
gen__NS_sig3({"a":1})        → undefined
gen__NS_sig3({"signData":"x"}) → undefined
gen__NS_sig3("abc")          → undefined
```

当时的直觉结论是「快手这条路径也是坏的」（与 `sign4.js` 并列）。

### 3.2 实际原因：我的沙箱把**宿主内建**塞进了 vm context

第一版沙箱长这样：

```javascript
const sb = { console, setTimeout, ..., Object, Array, String, Number, Math, JSON, Date, ... }
vm.createContext(sb)
```

把**宿主 realm 的 `Object` / `Array` / `Function` 等塞进 vm 上下文**后，VM 内部会：
- 用它自己的 trampoline 访问属性（`u.get` → `r` → `hasOwnProperty`）
- 而 `realm.global.Object` 是**宿主**的 `Object` ⇒ 跨 realm 原型链
- ⇒ **无限递归** `RangeError: Maximum call stack size exceeded`
- ⇒ 被 `call` 的**空 catch 静默吞掉** ⇒ 外面只看到 `undefined`

**修法只要一行：不要把宿主内建塞进 `vm` 上下文**，让 context 用它自己的 intrinsics。

```javascript
// ✅ 正确：只放环境相关的宿主对象，内建一律不传
const sb = { console, setTimeout, setInterval, TextEncoder, TextDecoder, Buffer }
sb.window = sb; sb.self = sb; sb.globalThis = sb
sb.navigator = {...}; sb.document = {...}; sb.localStorage = {...}   // 环境
vm.createContext(sb)
```

修完后立刻正常：

```
gen__NS_sig3({"a":1})          → "42521525ec60c57b7a1f1c1d64c528b1c7238b67030301010e0f0c16"
gen__NS_sig3({"signData":"x"}) → "41511626ef63c678781c1f1e67c62bb2c4208864000002020d0c0f15"
```

**52 位 hex、随输入变化** ⇒ **快手 `sig3` 路径是通的**。

### 3.3 这个坑为什么值得单独写一节

三条叠加，让它极难发现：

| # | 因素 | 后果 |
| --- | --- | --- |
| ① | 把宿主内建传进 vm context | 跨 realm 原型链 → 递归爆栈 |
| ② | 竞品 `call` 是**空 catch** | 异常被完全吞掉，无任何痕迹 |
| ③ | 症状是「返回 undefined」 | 与「函数本身没返回值」**完全同形** |

⇒ **「返回 undefined」在带空 catch 的代码里不构成任何证据。**
正确做法：**先把 catch 打补丁让它抛**，再判断。我这次就是靠替换 `h.call` 为
「不吞异常版本」才拿到 `RangeError` 并定位到跨 realm。

---

## 4. 顺带复核：`sign4.js` 的 X-Bogus 结论仍然成立（但根因需修正）

上一轮我判定 `sign4.js` 产出的 X-Bogus「与输入无关」。
本轮用**修正后的干净沙箱**重跑，结论**不变**：

| 变更 | 输出变化 |
| --- | --- |
| 换 params | ❌ 不变 |
| 换 data | ❌ 不变 |
| 换 UA | ❌ 不变 |
| 换时间戳 | ✅ 变 |

⇒ 「这份实现是坏的」这个结论站得住（不是 harness 造成的）。

### 4.1 ⚠ 但根因我写错了，现更正为**两个独立缺陷**

上一轮我写「`_0x1f3b8d` 收到 WordArray ⇒ 空数组 ⇒ params/data 都丢」。**params/data 不是这个原因。**

**缺陷 A（影响 params / data）：`CryptoJS.MD5()` 对非字符串、非 WordArray 的输入返回常量。**

实测（干净沙箱）：

```
md5(Uint8Array([1..16]))  = 487f7b22f68312d2c1bbc93b1aea445b
md5(Uint8Array([16..1]))  = 487f7b22f68312d2c1bbc93b1aea445b   ← 完全相同
md5([1,2,3])              = 487f7b22f68312d2c1bbc93b1aea445b
md5([3,2,1])              = 487f7b22f68312d2c1bbc93b1aea445b   ← 完全相同
md5("abc")                = 900150983cd24fb0d6963f7d28e17f72   ← 字符串正常
md5("abd")                = 4911e516e5aa21d327512e0c8b197616
```

而 `sign4.js` 的双重哈希链第二层正是 `md5(_0x1f3b8d(...))`，而 `_0x1f3b8d` 返回 **`Uint8Array`**
⇒ 该层**恒为常量** ⇒ params / data 全部丢失。

**缺陷 B（影响 UA）：`_0x1f3b8d` 收到 WordArray ⇒ 长度为 0。**

```javascript
let uaStr = _0x1f3b8d(md5(ua(userAgent).toString()));
//                    ↑ 这里 md5(...) 返回 WordArray（没再 .toString()）
```

`_0x1f3b8d` 内部 `var b = a.length >> 1`，WordArray 无 `.length` ⇒ `undefined >> 1 = 0` ⇒ 空数组。
实测 `uaStr` 长度 **0**（期望 16）。

### 4.2 两个缺陷的影响面

| 缺陷 | 丢的东西 | 证据 |
| --- | --- | --- |
| A：`md5(数组/typed array)` 塌成常量 | **params · data** | `paramsarr1(A)` 与 `paramsarr1(B)` 的 `[14][15]` 都是 `68,91`（长度都是 16，但内容恒等）|
| B：`_0x1f3b8d(WordArray)` 返回 0 长度 | **UA** | `uaStr.length === 0` |

⇒ 修正我上一轮的说法：**不是「`paramsarr1` 长度 0」，而是「长度 16 但恒为常量」**。
结论（输入无关）不变，根因更准了。

---

## 5. 现在签名路径的真实状态（三条线路全部澄清）

| 平台 | 承载 | 状态 | 证据 |
| --- | --- | --- | --- |
| 百度 / Google | 竞品自研明文 JS（`TKK`/`gtk`）| ✅ **已完整还原 + 移植** | 10 例差分全绿 |
| 抖音 `a_bogus` | 竞品自研明文 JS（`sign3.js`）| ✅ **已完整还原 + 移植** | SM3 国标向量 + 112 组差分全等 |
| 头条 `a_bogus` | 复用抖音同一函数 | ✅ 同上 | exe 注入脚本共用 `getABogus` |
| 小红书 `X-s`/`X-t` | 小红书官方 bundle 的 `cssSign` | 🟡 **可用**（整包已随竞品交付）| `sign2.js` 6.3 MB |
| **快手 `sig3`** | **快手官方 bundle 的 `gen__NS_sig3` + `hxfalcon` VM** | ✅ **可用（本轮打通）** | 52 位 hex、随输入变化 |
| 抖音 `X-Bogus` | 竞品自研（`sign4.js`）| ❌ **实现自身有缺陷**（§4）| 输入无关 |
| 抖音 `ticket-guard` | 抖音页面内的 `ZTSDK` | ⏳ 契约已知，实现未取证 | 见调度层文档 §3 |

---

## 6. 复现

```bash
node probe-kuaishou-sig3.cjs
```

脚本会：载入 `chuangzuozhe.js` → 枚举 `__NS_hxfalcon` API → **打补丁让 `call` 抛异常** →
打印 `gen__NS_sig3` 对多组输入的输出。

---

## 7. 未闭合

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | **`$encode` 的字节码未解** | 它在 @14736 的混淆字符串表里；要逆推得解 `hxfalcon` 的字节码格式 |
| 2 | **`sig3_data` 的确切结构未取证** | exe 注入的是 `gen__NS_sig3(sig3_data)`，但 `sig3_data` 怎么构造没看到 |
| 3 | **快手侧是否还有别的校验字段** | 只确认 `sig3` 一个回调；`__NS_sig3` 之外可能还有配套 header |
| 4 | **VM 的 `startupRandom` 依赖 `Date.parse(new Date)`** | 说明输出可能与启动时刻有关；本实验只验证了「随输入变化」，未验证跨启动一致性 |
| 5 | **未做活体验证** | 没有向快手发过任何请求 |
