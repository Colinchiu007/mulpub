# 融媒宝的风控过验链：百度 `verifyToken` 与那段「看起来在工作、其实从没跑过」的采集代码

> **文档性质**：纯静态阅读竞品随包 JS（`Asset/BaiduVerifyToken/`，40 KB + 一个小页面），
> 不执行竞品、不联网。
> **取证日期**：2026-10-19
> **实现**：`02-analysis-scripts/baidu-verify-token.cjs` ｜ **测试**：`baidu-verify-token.test.js`（**10 例全绿**）

---

## 1. 一句话结论

> 竞品为了过百度风控，随包带了一套 **百度 JS 挑战的过验件**。
> 但**真正被用到的只有「AES 加密」这一步**；文件里那一大段鼠标轨迹采集**是死代码**，
> 从没被调用过 —— 上报动作由原生（`WEMedia.exe`）自己做。

证据链见 §3 与 §5。

---

## 2. 三个文件的分工

### 2.1 `bdverifyToken.html`（19 行，全貌）

```html
<script type="text/javascript" src="verifyToken.js"></script>
<script type="text/javascript">
    function verify(a, b, c, flag) {
        var res = R(a, b, c);                    // AES(data, key=b, iv=c)
        if (!flag) flag = '';
        window.JsBaiduVerifyToken(res, flag);    // ← CEF → 原生的桥
    }
</script>
```

**这个页面只做两件事**：调 `R()` 加密、把结果经 `window.JsBaiduVerifyToken` 交回原生。
**它自己不发任何网络请求**（无 `XMLHttpRequest`、无 `fetch`）。

### 2.2 `verifyToken.js`（40 KB）真正被引用的部分

只有一个函数被 `bdverifyToken.html` 用到：

```javascript
function R(e, d, l) {
    d = B.enc.Utf8.parse(d);      // key
    l = B.enc.Utf8.parse(l);      // iv
    e = B.enc.Utf8.parse(e);      // 明文
    return B.AES.encrypt(e, d, { iv: l }).ciphertext.toString(B.enc.Base64)
}
```

`B` 是内嵌的 **CryptoJS**。所以算法是：
**AES-CBC + PKCS7，输出裸密文 base64**（不是口令加密，所以**没有** `Salted__` 头）。

### 2.3 密钥从哪来 —— 不是硬编码

调用点在 `verifyToken.js` 自己的尾部（虽然那段是死代码，但它泄露了契约）：

```javascript
c = R(JSON.stringify(N),
      window.yjs_js_challenge_token.substring(0, 16),   // key = token[0:16]
      window.yjs_js_challenge_token.substring(16))      // iv  = token[16:]
```

⇒ **key 与 iv 都从 `yjs_js_challenge_token` 派生**，长度各 16 字符 → **AES-128**。

> 这也是我第一轮误判的原因：搜「AES 密钥字面量」一无所获，就以为不是 AES。
> **动态派生密钥在字面量扫描下是隐形的。**

---

## 3. ★ 那段采集代码为什么是死代码（可复算的判据）

`verifyToken.js` 尾部确实有完整的采集逻辑：
`Q()` 取鼠标坐标 → `C.push()` 累积 → `setInterval` 每 10ms 递减计数 `T`（初值 59）→
攒够就 `R()` 加密 → `E()` 用 `XMLHttpRequest` POST 到：

```
/yjs-cgi/security/js_challenge/verify?token=<window.yjs_js_challenge_token>
```

**但它从未被触发。四条判据：**

| # | 判据 | 实测 |
| --- | --- | --- |
| ① | 三个触发器 `V` / `W` / `T` **各自全文只出现 1 次**（只有定义） | `V`@38711、`W`@39564、`T` 作为函数@40323 —— 各 1 次 |
| ② | 全文**没有** `addEventListener` | 0 命中 |
| ③ | 全文**没有** `onmousemove / onclick / ontouchstart / onscroll` 赋值 | 0 命中 |
| ④ | 文件**没有任何 `window.X = ...` 导出** | 0 命中 |

⇒ 文件执行完就结束了：定义了函数、定义了三个 debounced 处理器，**然后没了**。
没有绑定、没有调用、没有导出。**它在当前部署里什么都不做。**

### 3.1 那 `T` 变量冲突是什么

`T` 被用成两种东西：

```javascript
, T = 59                      // ① 计数器初值
P = setInterval(function() {
    T--;                      // ② 递减
    if (0 >= T) { ... }
}, 10)
...
T = S(function(e) { ... })    // ③ 又被赋成函数
```

同一名字先当计数器、后当函数。即使那段代码被接上，`T--` 也会在 `T` 变成函数后得到 `NaN`。
**这条路径连自己内部都是坏的** —— 与「它是死代码」互相印证。

---

## 4. AES 环节的验证（两层）

### 4.1 独立正确性（不依赖竞品）

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 标准向量 | NIST SP 800-38A F.2.1（AES-128-CBC，key `2b7e1516…`，IV `000102…0f`）| ✅ 第 1 块密文 = `7649abac8119b246cee98e9b12e9197d` |
| PKCS7 证据 | 16 字节明文 ⇒ 32 字节密文；解密 `final()` 还原原文并剥离填充 | ✅ |
| 裸密文 | 输出 base64 解码后**不以 `Salted__` 开头** | ✅ |

> **我在这里踩了一次自己的坑**：首版断言把第 2 块密文写成「填充明文的 hex」`'10'.repeat(16)`，
> 把**加密结果**当成了**填充内容**。正解是「断言长度 + 解密还原」，不是猜密文长什么样。

### 4.2 与竞品内嵌 CryptoJS 的差分

把 `verifyToken.js`（含 CryptoJS）加载进隔离 `vm`，直接调它的 `R()`，与我的 Node `crypto` 实现逐字符比对：

| 维度 | 覆盖 |
| --- | --- |
| token | 4 组（含全同字符 / 大小写混合 / 多字节中文）|
| 载荷 | 5 组（真实 `{width,height,data}` / 空 data / 10 点轨迹 / 空对象 / 纯字符串）|
| **结果** | **全部逐字节一致** |

⇒ 我的实现不是「近似」，是**与竞品输出完全相同**。
这一步也间接证明了 §2.2 的判断：竞品用的就是 AES-128-CBC + PKCS7 + 裸密文 base64。

---

## 5. 原生侧的确证（链路的另一半）

在 `WEMedia.exe`（17.3 MB）里按两种编码分别搜：

| 字符串 | UTF-16 | ASCII | 含义 |
| --- | --- | --- | --- |
| `yjs_js_challenge_token` | **1** | 0 | 挑战 token 的变量名（JS 侧读它）|
| `js_challenge` | **1** | 1 | 挑战接口路径片段 |
| `yjs-cgi` | 0 | **1** | 上报接口路径前缀 |
| `JsBaiduVerifyToken` | 0 | **1** | **CEF 桥的回调名** |
| `bdverifyToken` | **2** | 0 | 页面文件名 |
| `BaiduVerifyToken` | **1** | **1** | 目录名 |

⇒ 六项全部在原生侧出现，**`JsBaiduVerifyToken` 是 ASCII（导出符号表形态）**，
与 `cef_browser_*` 一致 ⇒ **C++ 注册的回调名，与 JS 侧 `window.JsBaiduVerifyToken(...)` 对得上。**

### 5.1 复原出的完整链路

```
① 原生把百度页面载入 CEF
② 百度下发 JS 挑战 → 原生取到 token，注入 window.yjs_js_challenge_token
③ 原生调 CEF 页面的 verify(payload, key, iv, flag)
      payload = { width, height, data: [{x,y}...] }  ← 轨迹由原生自己构造
      key = token[0:16]、iv = token[16:]
④ 页面 R() 做 AES-128-CBC → base64 → window.JsBaiduVerifyToken(res, flag)
⑤ 原生收到 res，POST 到 /yjs-cgi/security/js_challenge/verify?token=<token>
```

**关键判读**：③ 的 `payload` 由原生拼，不是由那段 JS 采集 —— 所以 JS 里的采集代码可以烂掉。
**竞品只借用了 `verifyToken.js` 的「AES 助手」这一个能力。**

---

## 6. 这条发现的价值

### 6.1 对「过风控」这件事的具体认知

| 常见误解 | 实际情况（本次取证） |
| --- | --- |
| 「风控要逆向加密算法 + 找到硬编码密钥」 | **密钥是 token 派生的**，没有硬编码；算法就是标准 AES-128-CBC |
| 「要模拟真实鼠标轨迹」 | 竞品**没有**真的做轨迹模拟（那段是死代码）；它的 `payload` 是原生拼的 |
| 「要照抄整份挑战 JS」 | 竞品只抄了 **40 KB 里的一个 6 行函数**（`R`）|

⇒ **风控件的难点不在密码学，在「拿到 token」和「请求时序」。**
竞品那段 `500 < d ? E(c) : setTimeout(E(c), 500 - d)` 说明它注意到**上报要有最小延迟**
（不足 500ms 就等），这是行为风控的一个可观测点 —— 虽然这段也是死代码，
但**时序意识保留在代码里**，说明作者知道要做，只是没接到 JS 侧（改成原生做了）。

### 6.2 对广告/账号风控类需求的可复用结论

1. **AES 用「token 前 16 位作 key、之后作 iv」是常见做法**（省一次协商，但 key/iv 全暴露在 JS 里）。
2. **挑战件的正确复用单位是「一个函数」而不是「整个文件」** —— 竞品就是这么干的。
3. **看到「有采集代码」不等于「在做采集」**，必须查它**有没有被接上**（本例四条判据）。

---

## 7. 复现

```bash
# 自检：与竞品内嵌 CryptoJS 逐字节比对
node baidu-verify-token.cjs --demo

# 10 例验证（含 NIST 向量 + 差分 + 三条结构事实）
node --test baidu-verify-token.test.js

# 单次加密
node baidu-verify-token.cjs '{"width":1280,"height":720,"data":[]}' "<32位以上token>"
```

---

## 8. 未闭合

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | **`yjs_js_challenge_token` 的生成与格式未取证** | 只知道它 ≥32 字符（前 16 作 key、之后作 iv）；谁生成、多久过期、是否含服务端签名，未知 |
| 2 | **`payload` 的确切结构未取证** | 只从死代码里看到 `{width, height, data:[{x,y}]}`；原生实际拼什么未验证 |
| 3 | **`verify` 的第 4 参 `flag` 语义未知** | 页面里只做 `if (!flag) flag = ''` 后原样回传 |
| 4 | **上报的响应格式与判定逻辑未知** | 原生侧解析逻辑在 `WEMedia.exe` 里，未反编译（该 exe 2 小时预算内跑不完，见主程序结案文档）|
| 5 | **这套件服务于哪个百度功能未取证** | 推断是百度翻译/百度系发布，但没有调用点证据 |
| 6 | **未做活体验证** | 没有向百度发过任何请求；「能否过验」完全未证 |
