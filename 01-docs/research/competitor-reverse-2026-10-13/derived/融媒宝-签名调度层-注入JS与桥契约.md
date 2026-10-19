# 融媒宝的签名调度层：从 `WEMedia.exe` 里挖出的注入 JS 与桥契约

> **文档性质**：纯静态扫描 `WEMedia.exe`（18,114,584 B）的 latin1 视图，取连续可打印 ASCII 段并按特征分类。
> **不反编译、不执行、不联网。**
> **取证日期**：2026-10-19 ｜ 机器可读：`04-rea-evidence/WEMedia.exe.注入JS片段.json`（289 URL / 7 桥 / 856 段）
> **脚本**：`02-analysis-scripts/extract-exe-injected-js.cjs`
>
> **这是目前挖到的最深一层。** 此前只知道「有 63 个 JS→原生回调」，本篇给出了**它们的实参契约**，
> 以及竞品**怎么把签名算出来**的完整链路。

---

## 1. 核心机制：原生不实现签名，只**注入 JS 让页面算**

竞品的原生层**没有**任何平台的签名算法实现。做法是：

```
① 原生用 CefBrowser 在页面里执行一段 JS（片段以字符串常量存在 exe 里）
② 该 JS 调用页面上的签名函数（getABogus / getXBogus / cssSign / gen__NS_sig3 …）
③ 页面算完，调 window.JsXxx(_account_id, 签名) 回调原生
④ 原生把签名拼进请求（&a_bogus=… / X-s: …）
```

**为什么这个设计值得记**：它把「签名算法」这一最易变、最难逆向的部分**外置成可替换的 JS**，
平台改算法时只需换 js/html 文件，不用重编 exe。这也解释了 §5 那个「注入片段是格式串」的现象。

---

## 2. ★ 完整签名分发表（5 个平台 + 1 个深度子系统）

**全部为 exe 内字符串的逐字引用**（`_url`/`_postdata`/`_useragent` 由原生用 `%s` 格式化后拼进去）：

### 2.1 抖音 `a_bogus`

```javascript
var abogus=getABogus(_url,_postdata,_useragent);
window.JsDouyinGetABogus(_account_id,abogus);
```
紧接着的字符串：`a_bogus` · `msToken` · `&msToken=` · `&a_bogus=`

⇒ 请求实际拼成 `…&msToken=<token>&a_bogus=<44字符>`。
**与我完整还原的 `a_bogus`（44 字符、SM3 链）完全对得上**（见 `融媒宝-签名算法-a_bogus与SM3.md`）。

### 2.2 抖音 `X-Bogus`

```javascript
var abogus=getXBogus(_url,_postdata,_useragent);
window.JsDouyinGetXBogus(_account_id,abogus);
```

⚠ **这条路径有问题，见 §5**。

### 2.3 小红书 `X-s` / `X-t`

```javascript
var jsonPostData=JSON.parse(_postdata);
var res=window.cssSign(_url,jsonPostData);
window.JsXiaohongshuGetX_S(_account_id,res['X-s'],res['X-t'].toString());
```

⇒ 小红书是**双头签名**（`X-s` 与 `X-t`），且 `X-t` 要 `.toString()`（时间戳数字）。
`cssSign` 是**平台页面自己提供的全局函数** —— 竞品不实现，直接调。
**`sign2.js`（6.3 MB）与 `main.js`（2.0 MB）就是小红书官方 bundle** —— 派生物证：`webpackChunkugc_monorepo`
+ `xiaohongshu` 命中 105 / 92 次 + `cssSign` 定义 1 处 + `X-s`/`X-t` 各 5 处。
⇒ 竞品**整包搬了小红书前端**，注入脚本里的 `window.cssSign` 就是从这两个 bundle 来的。
（对照：`chuangzuozhe.js` 3.4 MB **无** webpack chunk 名，性质另论；`sign3.js`/`sign4.js` 才是自研签名。）

### 2.4 头条 `a_bogus`

```javascript
var abogus=getABogus(_url,_postdata,_useragent);
window.JsToutiaoGetABogus(_account_id,abogus);
```

⇒ **头条与抖音共用同一套 `a_bogus`**（同一个 `getABogus` 函数、同样的三参数）。
这是「一次逆向覆盖两个平台」的实例。

### 2.5 快手 `sig3`

```javascript
var sig3=gen__NS_sig3(sig3_data);
window.JsKuaishouGetSig3(_account_id,sig3);
```

⇒ 快手用 `gen__NS_sig3`（`__NS_sig3` 是快手公开的签名名），输入是 `sig3_data` 对象。

### 2.6 汇总表

| # | 平台 | 页面函数 | 回调桥 | 实参契约 |
| --- | --- | --- | --- | --- |
| 1 | 抖音 | `getABogus` | `JsDouyinGetABogus` | `(_account_id, abogus)` |
| 2 | 抖音 | `getXBogus` | `JsDouyinGetXBogus` | `(_account_id, abogus)` |
| 3 | 小红书 | `window.cssSign` | `JsXiaohongshuGetX_S` | `(_account_id, res['X-s'], res['X-t'].toString())` |
| 4 | 头条 | `getABogus` | `JsToutiaoGetABogus` | `(_account_id, abogus)` |
| 5 | 快手 | `gen__NS_sig3` | `JsKuaishouGetSig3` | `(_account_id, sig3)` |
| 6 | 抖音（深层）| `ZTSDK.SecureSDK…signWithHmac` | `JsDouyinGetRegSign` | 8 个参数，见 §3 |

**每个回调的第一个参数都是 `_account_id`** ⇒ 签名结果按账号回传，多账号并发时不会串。

---

## 3. ★ 抖音 `ticket-guard`：比 `a_bogus` 更深的一层（ECDH）

exe 里另有一整段注入脚本（10 段，`签名-抖音-ticketGuard` 分类），做的是**注册凭证签名**：

```javascript
async function get_regsign(t) {
    try {
        const result = await window.ZTSDK.SecureSDK.cryptoSDK.cryptoSDK.signWithHmac(
            t, window.ZTSDK.SecureSDK.cryptoSDK._ecdh_key_cache.values().next().value.values().next().value.key);
        return result.result;
    } catch (error) { }
    return '';
}

async function calcRegSign() {
    // 从 localStorage 读三处安全 SDK 数据
    var crpt_data = window.localStorage.getItem('security-sdk/s_sdk_crypt_sdk');
    if(!crpt_data){ window.JsDouyinGetRegSign(_account_id,'','','','','','',0); return false; }
    var jsonCrpt = JSON.parse(crpt_data); var jsonData = JSON.parse(jsonCrpt.data);
    _private_key = jsonData.ec_privateKey; _public_key = jsonData.ec_publicKey;
    var sign_key_data = window.localStorage.getItem('security-sdk/s_sdk_sign_data_key/web_protect')
                     || window.localStorage.getItem('security-sdk/s_sdk_sign_data_key/token');
    // 取 ticket / ts_sign / client_cert
    var t = 'ticket=' + _ticket + '&path=/web/api/media/aweme/create/&timestamp=' + _timestamp;
    var reg_sign = await get_regsign(t);
    var _server_data={ticket:_ticket, ts_sign:_ts_sign, client_cert:_client_cert};
    var md5_sign_str={publicKey:_public_key, cert:_client_cert, serverData:JSON.stringify(_server_data)};
    _md5cookie = JSON.stringify(md5_sign_str);
    window.JsDouyinGetRegSign(_account_id, reg_sign, _public_key, _ree_public_key, _ts_sign, '', _md5cookie, ecdhflag);
    return true;
}
calcRegSign();
```

### 3.1 关键判读

| 观察 | 含义 |
| --- | --- |
| `signWithHmac(t, ecdh_key)` | 抖音用 **ECDH 协商出的密钥做 HMAC**，不是固定密钥 |
| 签的内容是 `ticket=…&path=…&timestamp=…` | **带 path 的绑定签名** ⇒ 签名与具体接口路径强绑定，不能跨接口复用 |
| 两条 path 分支：`/web/api/media/aweme/create/` 与 `…/create_v2/` | 对应抖音两个版本的发布接口 |
| 读 `security-sdk/s_sdk_crypt_sdk`、`…/sign_data_key/web_protect`、`…/sign_data_key/token` | 抖音把密钥材料放在 **localStorage 三处特定键**，且有 `web_protect` 与 `token` 两种兜底 |
| 缺任一项就回 `('','','','','','',0)` | 失败路径明确（8 个参数里前 7 个空、最后 0）|
| `_ecdh_key_cache.values().next().value.values().next().value.key` | 从 Map 的 Map 里取密钥 —— **两级嵌套取值**，说明有多账号/多会话维度 |
| 相关字符串：`bd-ticket-guard-client-data`、`bd-ticket-guard-ree-public-key`、`get_douyin_bd_ticket_guard_client_data`、`"req_content":"ticket,path,timestamp","req_sign":"` | 对应的**请求头/字段名**与 JSON 形态 |

**这一层比 `a_bogus` 重要得多**：`a_bogus` 是流控签名（防爬），`ticket-guard` 是**发布凭证**
（抖音用它确认「这次发布来自合法客户端」）。竞品靠**直接调用页面上的 `ZTSDK`** 拿到，
而不是自己实现 —— 又一次「用架构规避算法」。

---

## 4. 顺带挖到的其他层面

### 4.1 登录自动化规模（431 段，占比最大）

| 分类 | 段数 | 例子 |
| --- | --- | --- |
| 登录自动化-点选 | **285** | `document.getElementsByClassName('semi-radio')`、`.web-login-tab-list__item`、`.web-login-button`、`.inputLoginBtn scanicon-toLogin js-qrcode-switch`、`.fm-button fm-submit password-login` |
| 登录自动化-取账号 | 93 | `window.GetAccountInfo('%s',user,passwd,'%s')` |
| 登录自动化-填表 | 93 | 按 `placeholder` / `name` 定位输入框（`phoneNum`、`password`）|

具体到平台的选择器：
- **淘宝**：`fm-login-id` / `fm-login-password` / `.fm-button fm-submit password-login`
- **微博**：`TANGRAM__PSP_4__userName` / `TANGRAM__PSP_4__password` / `TANGRAM__PSP_4__footerULoginBtn`
- **字节系**：`.semi-radio`（Semi Design）、`.web-login-tab-list__item`、`.web-login-button`
- 用 `document.createEvent('MouseEvents')` + `initMouseEvent('mousedown', …)` **手工派发鼠标事件**
  —— 为了绕过「必须有真实鼠标事件」的前端校验。

⇒ **他们的登录是「模拟人在页面上点」**，不是调登录 API。这解释了为什么必须用 CEF 而不是 HTTP 客户端。

### 4.2 界面净化（14 段）

```javascript
var x=document.getElementsByClassName('arco-layout-header');  if(x.length>0){x[0].style='display: none;';}
var y=document.getElementsByClassName('wrapper___1Xj6Z');     if(y.length>0){y[0].style='display: none;';}
var z=document.getElementsByClassName('arco-layout-footer footer-container___PN1Sf'); …
var m=document.getElementsByClassName('athena-survey-entry__inner'); …
```

⇒ 把平台页面自己的顶栏/底栏/调研弹窗**隐藏掉**，让用户只看到嵌进来的操作区。
`arco-` = 字节 Arco Design、`athena-` = 字节内部平台名。

### 4.3 数据库 schema（48 段）

```sql
drop table tb_account_group;
create table tab_client_version(id INTEGER, client_version text);
insert into tab_client_version (id, client_version) values (:id,:client_version);
```

⇒ 用 **SQLite**（`sqlite3` 参数占位 `:id` 风格）。`tb_` 与 `tab_` 两种前缀混用。

### 4.4 UA（1 段，与 CEF 版本吻合）

```
Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.5414.120 Safari/537.36
```

⇒ **UA 里的 Chrome 版本 = 内置 CEF 的版本（109.0.5414.120）**，不是 Windows 上装的 Chrome。
WOW64 = 32 位进程（印证 §组件文档里「27/27 全部 PE32」）。

### 4.5 其他有价值的字符串

| 字符串 | 含义 |
| --- | --- |
| `https://action.17van.com/action/deliver-solve` | 自家发布接口的**新端点**（此前只知 `/action/deliver`）|
| `https://static.17van.com/bc/zh/`、`/bc/z/` | 静态资源（`bc` 疑为「补充/播测」缩写，未证）|
| `var cache_key='publish_form_cache:` | 发布表单**本地缓存**键前缀（防丢失）|
| `MediaInfo_Open_Buffer_*` 等 8 个 | MediaInfo 的 **buffer API**（流式解析，不落盘）|

---

## 5. ⚠ 一处必须更正我此前的判断：`sign4.js` 的 X-Bogus 是坏的

### 5.1 此前我怎么写的

> 「`X-Bogus` = jsVMP 字节码（`sign4.js` 28.8 KB），**须搬 VM**」

### 5.2 实际是什么（三层更正）

**更正一：`sign4.js` 不是字节码，是可读的明文 JS。**
文件 29,411 字符里：
- `jsvmp` **解释器本身**占 21,515 字符（73%）
- **VM 字节码只有 1 处**：2,240 个 hex 字符 = **1,120 字节**（7.6%）
- 其余是明文：`getXBogus` / `getGarbledString` / `get_arr` / RC4 变体，**都有中文注释**

唯一走 VM 的是 **UA 变换这一个助手**（`ua()` → `_0x38c772` → `jsvmp(...)`）。

**更正二：`sign4.js` 产出的 28 字符与任何输入无关 —— 它是坏的。**
实测（冻结时钟，逐个变输入）：

| 变更 | 输出变化 |
| --- | --- |
| 换 params | ❌ 不变 |
| 换 data | ❌ 不变 |
| 换 UA | ❌ 不变 |
| 换时间戳 | ✅ **变**（末几位） |

⇒ 它只编码了时间戳，**params/data/UA 全部丢失**。

根因是**两个互相独立的缺陷**（本篇首发时写成单一原因，已由后续取证更正 —— 见 `融媒宝-快手sig3与hxfalcon引擎.md` §4）：

**缺陷 A —— 影响 params / data：`CryptoJS.MD5()` 对「非字符串、非 WordArray」的输入返回常量。**

```javascript
let paramsarr1 = _0x1f3b8d(md5(_0x1f3b8d(md5(params).toString())).toString());
```

干净沙箱实测：`md5(Uint8Array([1..16]))` 与 `md5(Uint8Array([16..1]))`、`md5([1,2,3])` 与 `md5([3,2,1])`
**全部返回同一个常量 `487f7b22f68312d2c1bbc93b1aea445b`**（而字符串输入正常逐字变化）。
双重哈希链第二层正是 `md5(_0x1f3b8d(...))`，`_0x1f3b8d` 返回 `Uint8Array` ⇒ 该层恒为常量 ⇒ params/data 全丢。

**缺陷 B —— 影响 UA：`_0x1f3b8d` 收到 WordArray ⇒ 长度为 0。**

`let uaStr = _0x1f3b8d(md5(ua(userAgent).toString()));` 里 `md5(...)` 返回 WordArray（未再 `.toString()`），
`_0x1f3b8d` 内部 `a.length >> 1` ⇒ `undefined >> 1 = 0` ⇒ 空数组。

更正说明：本篇首发时把两者都归因于「空数组」—— `paramsarr1` 实测**长度是 16 不是 0**，
但内容恒等（`paramsarr1(A)` 与 `paramsarr1(B)` 的 `[14][15]` 都是 `68,91`）。结论（输入无关）不变。
实测：`paramsarr1` 长度 0、`uaStr` 长度 0，而 `arr[4]`/`arr[8]` 就是 `undefined`。

**更正三：这条路径很可能是「已被平台弃用后留下的残留」。**
- 抖音现在要的是 `a_bogus`（`a_bogus` 那条**确实跑得通**，我已完整复现且 112 组全等）
- `getXBogus` 在**整个 `Asset/` 里只有 `sign4.js` 自己引用**，没有任何页面绑定它
- 抖音官方已从 `X-Bogus` 迁到 `a_bogus`

⇒ **最可能的判读**：竞品两套都留着，`a_bogus` 在用、`X-Bogus` 是历史残留且已坏。
**不是我们的逆向失败，是它本来就坏了。**

> ⚠ 边界：我只证明了「`sign4.js` 的输出与输入无关」这一**代码事实**。
> 「这条路径在生产中从未被触发」是**推断**，未做活体验证。

### 5.3 对结论的影响

| 此前的表述 | 更正后 |
| --- | --- |
| X-Bogus 须搬 jsVMP，是硬骨头 | X-Bogus 的实现**大部分是明文**；难点不在 VM，而在**竞品这份实现是坏的** |
| 三档签名：TKK ✅ / a_bogus ⏳ / X-Bogus ❌ | **TKK ✅ / a_bogus ✅ / X-Bogus 竞品自身已失效** |

⇒ **真正只剩一档没攻克的说法不成立了。** 剩下的是**小红书 `cssSign`**（依赖平台页面）、
**快手 `gen__NS_sig3`**、**抖音 ticket-guard ECDH** —— 这三个都属「平台页面/客户端自算」，
竞品同样是**调用**而非实现。

---

## 6. 复现

```bash
node extract-exe-injected-js.cjs
```

输出 `04-rea-evidence/WEMedia.exe.注入JS片段.json`：12 个分类 / 856 段 / 7 个桥 / 289 URL / 3 个 storage 键。

---

## 7. 未闭合

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | **注入片段是怎么传给 CEF 的** | 只看到片段字符串与格式串（`%s`），没看到调用点（`ExecuteJavaScript` 的参数装配在反编译不可达的 exe 里）|
| 2 | **`cssSign` 的实现未取证** | 它是小红书页面自己的全局函数；竞品不实现 ⇒ 要拿它只能抓小红书页面 |
| 3 | **`gen__NS_sig3` 的 `sig3_data` 结构未取证** | 只看到调用，没看到 `sig3_data` 怎么构造 |
| 4 | **抖音 ticket-guard 的 `ZTSDK` 来源未取证** | 它是抖音页面内置的 SDK；竞品直接读 `localStorage` 的 `security-sdk/*` |
| 5 | **`bc/zh/` `bc/z/` 的含义未证** | 两个 static 路径前缀 |
| 6 | **289 个 URL 未分类** | 只抽了集合，未区分「平台 / 自家后端 / 静态资源」|
| 7 | **未做活体验证** | 全部静态；「这些注入在真实平台上是否成功」未证 |
