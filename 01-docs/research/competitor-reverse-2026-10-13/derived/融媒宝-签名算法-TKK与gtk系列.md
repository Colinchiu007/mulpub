# 融媒宝签名体系（三）：`TKK` / `gtk` 系列挑战签名 —— 竞品唯一可完整移植的一档

> **文档性质**：算法由**静态阅读竞品已交付的明文 JS** 还原，并用**竞品原件当测试预言机**做差分验证。
> 没有厂商文档、没有运行竞品、没有联网。
> **取证日期**：2026-10-19
> **前置**：本目录已有 `签名方案深度分析.md`（5 种签名策略全景）、`深挖补充报告-第5轮.md`（X-Bogus 取证）。
> **本文补的是第三种、也是唯一「读得懂 + 抄得走 + 测得通」的那一档。**

---

## 1. 为什么这一档特别重要

竞品对**抖音 `X-Bogus`** 用的是**内嵌 jsVMP 字节码**（`sign2/sign4.js`，28.8 KB），
必须把 VM 和字节码一起搬过去才能跑 —— 不可读、不可审计、不可单元测试。

而本文这一档是 **纯 JS、无 VM**：

| 签名档 | 承载文件 | 体积 | 可读性 | 可移植性 |
| --- | --- | --- | --- | --- |
| **`TKK`/`gtk` 系列**（本文）| `Asset/Sign/sign.js`(0.9 KB)、`Asset/GoogleSign/googleSign.html`(1.4 KB) | **< 2 KB** | ✅ 完整明文 | ✅ **可直接移植** |
| `a_bogus`（抖音）| `sign2/sign3.js` | 13.7 KB | ✅ 明文（SM3 实现，初值 1937774191…）| ✅ 可移植 |
| `X-Bogus`（抖音）| `sign2/sign4.js` | 28.8 KB | ❌ **jsVMP 字节码** | ❌ 须搬 VM |

⇒ **本档是竞品签名体系里唯一「读得懂 + 抄得走 + 测得通」的**。

---

## 2. 两个承载文件（两个变体）

### 2.1 `Asset/GoogleSign/googleSign.html`（`TKK` 命名，**无截断**）

```javascript
var b = function (a, b) {                      // 位运算核心
    for (var d = 0; d < b.length - 2; d += 3) {
        var c = b.charAt(d + 2),
            c = "a" <= c ? c.charCodeAt(0) - 87 : Number(c),
            c = "+" == b.charAt(d + 1) ? a >>> c : a << c;
        a = "+" == b.charAt(d) ? a + c & 4294967295 : a ^ c
    }
    return a
}

var tk = function (a, TKK) {                    // 主函数
    for (var e = TKK.split("."), h = Number(e[0]) || 0, g = [], d = 0, f = 0; f < a.length; f++) {
        var c = a.charCodeAt(f);
        // …手写 UTF-8 编码（含代理对 4 字节分支）…
    }
    a = h;
    for (d = 0; d < g.length; d++) a += g[d], a = b(a, "+-a^+6");
    a = b(a, "+-3^+b+-f");
    a ^= Number(e[1]) || 0;
    0 > a && (a = (a & 2147483647) + 2147483648);
    a %= 1E6;
    return a.toString() + "." + (a ^ h)
}

function sign(content, tkk, flag) {
    var s = tk(content, tkk)
    if (!flag) flag = '';
    window.JsGoogleSign(s, flag);                // ← 回传原生
}
```

### 2.2 `Asset/Sign/sign.js`（`gtk` 命名，**有 30 字符截断**）

同算法，两处差异：
1. 参数名 `TKK` → `gtk`，函数名 `tk` → `hash`，位运算核心 `b` → `a`
2. **多了 30 字符截断**：
```javascript
var o = r.length;
o > 30 && (r = "" + r.substr(0, 10) + r.substr(Math.floor(o / 2) - 5, 10) + r.substr(-10, 10));
```

配套页面 `Asset/Sign/bdsign.html`：
```javascript
function sign(content, gtk, flag) {
    var res = hash(content, gtk)
    if (!flag) flag = '';
    window.JsBaiduSign(res, flag);
}
```

---

## 3. ★ 差异被精确隔离到「截断」这一维（差分实测）

用两个原件互为对照，逐长度扫描：

| 输入长度 | `googleSign.html` | `Sign/sign.js` | 判定 |
| --- | --- | --- | --- |
| 5 | `338590.203232` | `338590.203232` | 一致 |
| 10 | `126133.516043` | `126133.516043` | 一致 |
| 30 | `1438.407264` | `1438.407264` | 一致 |
| **31** | `860975.725073` | `279451.159973` | ★ **首次分歧** |
| 40 | `923434.533588` | `675287.818857` | 不同 |
| 200 | `69569.474303` | `675287.818857` | 不同（且**与 40 同值**）|

**三条推论**（都有上表作证）：

1. **≤30 字符时两者逐字符相同** ⇒ 位运算核心、UTF-8 编码器、两轮常量、输出格式**完全等价**。
2. **`len=31` 是唯一分歧起点** ⇒ 差异**只来自**那行 `o > 30 &&` 截断，不是算法不同。
3. **`40` 与 `200` 在百度版给出同一个值** ⇒ 截断把两者都压成同一个 30 字符串，
   这是「截断确实发生」的**独立证据**（不依赖对源码的信任）。

> ⚠ 这条修正了我的第一版判断：我最初写「两处函数体逐语义等价」，**被差分测试当场否证**。
> 保留这段是因为它说明一个通用教训：**肉眼读两个相似函数不足以断言等价，必须跑数据。**

---

## 4. `bd` 到底指百度还是字节跳动 —— 取证过程

`bdsign.html` + `JsBaiduSign` 看起来像「百度」，但 `TKK`/`gtk`/`+-a^+6` 是**字节跳动 `_signature` 家族的常量**，
而 `TKK` 又是 **Google Translate `tk` 的变量名**。三个身份指向三个不同厂商 ⇒ **必须取证，不能猜**。

### 4.1 原生侧字符串（`WEMedia.exe` 内，UTF-16）

在 `bdsign` 命中点附近取到的字符串序列：

```
WEMediaGetBaiTranslationSignWndClass007
WEMediaGetBaiTranslationSignWnd007
GetBaiTranslationSignWnd
GetBaiTranslationSignWnd.xml
\Asset\GoogleSign\googleSign.html
\Asset\Sign\bdsign.html
cef_browser_get_sign
sign('%s','%s','%s')
yjs_js_challenge_token
```

### 4.2 判读

| 证据 | 指向 |
| --- | --- |
| `GetBaiTranslationSign`（Bai = 百度）| **百度**（百度翻译）|
| `yjs_js_challenge_token` | **百度**（百度系 JS challenge token 命名）|
| `\Asset\Sign\bdsign.html` 与 `\Asset\GoogleSign\googleSign.html` **并列**在同一字符串簇 | 两者是**同级**的两个签名页，各自服务一个平台 |
| `JsBaiduSign` 与 `JsGoogleSign` 并列在同一个 JS 回调名列表里 | 同上 |

⇒ **`bd` = 百度（Baidu）**，这条是**百度翻译/百度挑战的签名**，与抖音无关。
**但它的算法与 Google Translate `tk`、字节跳动 `_signature` 同源** ——
这不是竞品抄错，而是这三家平台历史上共用同一套挑战算法族。

### 4.3 竞品的「签名归一化」策略（与其他档一起看）

| 平台 | 签名档 | 承载形态 | 竞品做法 |
| --- | --- | --- | --- |
| Google | `tk`（TKK）| 明文 JS | **直接搬算法** |
| 百度 | `sign`（gtk）| 明文 JS | **直接搬算法** |
| 抖音 `a_bogus` | SM3 | 明文 JS（`sign3.js` 内含 SM3 初值常量）| 直接搬算法 |
| 抖音 `X-Bogus` | jsVMP | 字节码 | **搬 VM + 字节码**（不逆向 VM）|

⇒ 竞品策略是**按平台逐个选成本最低的承载方式**，而非统一方案。
对本项目的含义：**挑战签名不要自研，要按平台照搬最省事的那一档**。

---

## 5. 完整实现（已验证）

参考实现与差分测试都在 `<REA_WORKSPACE>` 的 `tk-signature.cjs` / `tk-signature.test.js`。
核心 API：

```javascript
const { sign } = require('./tk-signature.cjs')

sign('hello', '406398.2087938574')                       // → '338590.203232'（百度变体，截断）
sign('hello', '406398.2087938574', { truncate: false })  // Google 变体（不截断）
```

### 5.1 三要素（缺一不可复现正确）

| 要素 | 说明 |
| --- | --- |
| **位运算核心** | 把常量串按 3 字符一组解码成「加/异或 + 左移/右移 + 位移量」指令流 |
| **手写 UTF-8 编码器** | 含代理对（emoji）的 4 字节分支；用 `Buffer.from(s,'utf8')` 替代**不等价**（后者对孤立代理项处理不同）|
| **两轮常量变换** | `"+-a^+6"` 与 `"+ -3^+b+-f"`（原文无空格），逐字固定 |

`"+-a^+6"` 的实际语义（手算对齐，已进回归测试）：
```
s1 = (a + (a << 10)) & 0xFFFFFFFF
out = s1 ^ (s1 >>> 6)
```
`"+-3^+b+-f"`：
```
s1 = (a + (a << 3))  & 0xFFFFFFFF
s2 = s1 ^ (s1 >>> 11)
out = (s2 + (s2 << 15)) & 0xFFFFFFFF
```

---

## 6. 验证方式：用竞品原件当 oracle（差分测试，10 例全绿）

**没有构造任何期望值。** 而是把竞品的两个原件加载进隔离 `vm` 上下文，与实现逐一对比：

| 测试 | 内容 | 结果 |
| --- | --- | --- |
| 1 | `{truncate:false}` vs Google 原件，14 内容 × 6 组 tkk = 84 组 | ✅ 全等 |
| 2 | 默认（截断）vs 百度原件，84 组 | ✅ 全等 |
| 3 | 两原件差异精确隔离（≤30 全等 / 31 首次分歧 / 40≡200）| ✅ |
| 4 | 输出格式恒为 `数字.数字`，首段 ∈ [0, 1e6) | ✅ |
| 5 | 确定性（同输入同输出，无隐藏状态）| ✅ |
| 6 | tkk 高位影响输出 | ✅ |
| 7 | >30 截断规则（长串 ≡ 三段拼接）| ✅ |
| 8 | ≤30 不触发截断（边界）| ✅ |
| 9 | UTF-8 编码器（emoji 4 字节 / 中文 3 字节 / ASCII 1 字节）| ✅ |
| 10 | 位运算核心手算对齐 | ✅ |

### 6.1 这个测试自身踩过的两个坑（留档）

1. **抽取正则不匹配 ⇒ 空断言风险**
   第一版用「正则截取 `var b = function…` 到 `var tk = function…`」，在真实页面上**匹配失败**。
   若不改成「整段 `<script>` 丢进 vm」，这条测试会退化成「永远抛错」或「永远通过」。
2. **竞品原件有模块级缓存 ⇒ 差分会串味**
   `Sign/sign.js` 有 `var C = null`，首次调用后 `C` 被赋值且**不再更新**（后续调用复用第一个 gtk）。
   差分测试必须**每次重建 vm 上下文**，否则第二组输入的 gtk 是错的 ⇒ 假通过/假失败。

---

## 7. 未闭合

| # | 项 |
| --- | --- |
| 1 | **`gtk` / `TKK` 的实际来源未取证** —— 算法需要它作输入，但谁生成、何时刷新、从哪个接口取，未追（这是下一个有意义的靶点）|
| 2 | **未做活体验证** —— 所有输出都是与竞品原件比对，**没有向真实平台发过请求**，因此「签名有效」未证 |
| 3 | **`yjs_js_challenge_token` 的生成方未知** —— 它与本签名是否同一条链路未证 |
| 4 | **Google 侧是否真在用** —— 有页面也有原生入口（`JsGoogleSign`），但抓不到「哪个功能触发它」的调用点 |
