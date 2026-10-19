# 抖音 `ticket-guard` 的完整注入契约 —— 3 个 localStorage 键、4 道守卫、8 参回调

> **文档性质**：纯静态扫描 `WEMedia.exe`（latin1 视图，区间 @13404800~13409900），逐字提取注入模板。
> 不反编译、不执行、不向平台发请求。
> **取证日期**：2026-10-19 ｜ 机器可读：`04-rea-evidence/WEMedia.exe.ticket-guard契约.json`（16/16 锚点全中）
> **脚本**：`02-analysis-scripts/extract-ticket-guard-contract.cjs`
>
> 此前 `融媒宝-签名调度层-注入JS与桥契约.md` §3 只给了这段的**摘要**。
> 本篇把 1.4 KB 注入模板**逐字还原**，给出参数流全貌 —— 并纠正一处我上一轮的表述。

---

## 1. 这段注入模板是什么

`get_douyin_bd_ticket_guard_client_data` 是竞品内部对这段的命名。它在**页面里直接执行**：

```javascript
;window.localStorage.removeItem(cache_key);          // 先清发布表单缓存
var cache_key='publish_form_cache:<%s>'
async function get_regsign( t ){
    try {
        const result = await window.ZTSDK.SecureSDK.cryptoSDK.cryptoSDK.signWithHmac(
            t,
            window.ZTSDK.SecureSDK.cryptoSDK._ecdh_key_cache
                .values().next().value        // ← 第一级 Map
                .values().next().value        // ← 第二级 Map
                .value.key                    // ← 密钥对象
        );
        return result.result;
    } catch (error) { }
    return '';
}
async function calcRegSign(){
    var _private_key; var _public_key; var _ree_public_key;
    var _ticket; var _ts_sign; var _client_cert; var _md5cookie; var reg_sign;
    var _timestamp='<%s>'                       // ← 原生 %s 填值
    ...
}
calcRegSign();                                  // ← 注入后立即执行
```

⇒ **整段是一个自执行脚本**：注入即跑，不需要页面事件触发。

---

## 2. 参数流全貌（三个 localStorage 键 → 8 参回调）

### 2.1 三道数据闸门（守卫），每道失败都走同一出口

```
闸门①  security-sdk/s_sdk_crypt_sdk
        └ 缺 → 回调(_account_id, '','','','','','', 0)  return false
        └ JSON.parse(crpt_data).data → JSON.parse → { ec_privateKey, ec_publicKey }
        └ private/public 任一缺 → 同上失败出口

闸门②  security-sdk/s_sdk_sign_data_key/web_protect
        └ 缺 → 回退 security-sdk/s_sdk_sign_data_key/token
        └ 两个都缺 → 同上失败出口
        └ JSON.parse(sign_key_data).data → JSON.parse → { ticket, ts_sign, client_cert }

闸门③  ticket / ts_sign / client_cert 任一缺 → 同上失败出口
```

**4 处失败守卫，出口完全一致**：

```javascript
window.JsDouyinGetRegSign(_account_id, '', '', '', '', '', '', 0)
return false
```

⇒ **第 8 参 `0` 是失败标志**，第 7 参空字符串是「没有 `_md5cookie` 可给」。
原生侧只需判 `args[7] === 0` 就知道这条路没走通。

### 2.2 成功路径的完整赋值链

```javascript
_ticket      = jsonSignData.ticket
_ts_sign     = jsonSignData.ts_sign
_client_cert = jsonSignData.client_cert

var _ree_public_key = '';          // ← 全程空字符串！
var ecdhflag = 1;                  // ← 成功标志

var t = 'ticket=' + _ticket + '&path=/web/api/media/aweme/create/&timestamp=' + _timestamp;
// 或 create_v2/（两个版本并存）

var reg_sign = await get_regsign(t);

var _server_data = { ticket: _ticket, ts_sign: _ts_sign, client_cert: _client_cert };
var md5_sign_str = { publicKey: _public_key, cert: _client_cert, serverData: JSON.stringify(_server_data) };
_md5cookie = JSON.stringify(md5_sign_str);

window.JsDouyinGetRegSign(_account_id, reg_sign, _public_key, _ree_public_key, _ts_sign, '', _md5cookie, ecdhflag);
```

### 2.3 ★ 我上一轮说错的一处：`_ree_public_key` 全程是空串

上一轮我写「`ecdhflag` 与 `_ree_public_key` 的语义未知」。现在取证清楚：

```javascript
var _ree_public_key='';   // 声明后**从未被赋值**，直接进了回调第 4 参
```

⇒ **`_ree_public_key` 恒为 `''`**。它可能是为「REE（Rich Execution Environment）侧公钥」预留的槽位，
当前实现没填。**回调第 4 参永远拿不到值** —— 这是又一个「留了槽没接上」的形态
（同型：`SetDownloadFontResult` 空实现、`sign4.js` 的坏实现）。

---

## 3. 契约表（原生 ↔ 页面，逐字段）

| # | 回调参数 | 来源 | 语义 |
| --- | --- | --- | --- |
| 1 | `_account_id` | 原生填 | 账号 id（多账号路由）|
| 2 | `reg_sign` | `signWithHmac(t, ecdh_key).result` | **主签名**（HMAC 结果）|
| 3 | `_public_key` | `s_sdk_crypt_sdk → ec_publicKey` | ECDH 公钥 |
| 4 | `_ree_public_key` | **恒为 `''`** | 预留槽位，未填 |
| 5 | `_ts_sign` | `s_sdk_sign_data_key/* → ts_sign` | 时间戳签名 |
| 6 | `''` | 硬编码 | 预留槽位 |
| 7 | `_md5cookie` | `JSON.stringify({publicKey, cert, serverData})` | 供原生算 MD5 的材料 |
| 8 | `ecdhflag` | 成功 `1` / 失败 `0` | **成败标志位** |

### 3.1 签名的输入串

```
t = 'ticket=<ticket>&path=/web/api/media/aweme/create/&timestamp=<timestamp>'
```

| 字段 | 来源 |
| --- | --- |
| `ticket` | `localStorage['security-sdk/s_sdk_sign_data_key/web_protect']`（回退 token）|
| `path` | 两个版本：`/web/api/media/aweme/create/` 与 `.../create_v2/` |
| `timestamp` | **原生 `%s` 填值** —— exe 模板里值位置是 NUL ⇒ **时间戳由原生生成，不是页面** |

⇒ **签名与 path 绑定**：切接口版本要换 path 重新签。两个 path 在模板里**并存**，
说明竞品同时维护两代发布接口。

---

## 4. 同一区间里还挤着 5 个其他平台的注入点

提取区间只有 4.5 KB，却同时容纳了：

| 锚点 | 偏移 | 平台 |
| --- | --- | --- |
| `getABogus(...)` + `JsDouyinGetABogus` | @13407768 | 抖音 a_bogus |
| `getXBogus(...)` + `JsDouyinGetXBogus` | @13407904 | 抖音 X-Bogus（已证坏）|
| `cssSign` + `JsXiaohongshuGetX_S` | @13408200 | 小红书 X-s/X-t |
| `get_xiaohongshu_x_t_param` | @13408592 | 小红书第二处（仅 X-T）|
| `getABogus` + `JsToutiaoGetABogus` | @13408368 | 头条 |
| `gen__NS_sig3` + `JsKuaishouGetSig3` | @13408512 | 快手 sig3 |
| `x-ware-csrf-token` | @13408668 | **淘宝 CSRF**（本轮新发现）|

⇒ **这是竞品的「签名注入常量池」** —— 所有平台的注入模板集中存放、集中管理。
新发现：**淘宝有 CSRF 头注入**（`x-ware-csrf-token`），此前 7 平台清单里没单列。

---

## 5. 这条路径的现实价值与风险

### 5.1 价值

1. **8 参回调的语义全部落实** —— 原生侧拿到 `reg_sign` / `public_key` / `ts_sign` / `md5cookie` 四样东西，
   足以组装 `bd-ticket-guard-client-data` 请求头。
2. **`timestamp` 由原生生成** ⇒ 页面只做「读凭证 + 调 SDK + 拼串」，**时序由原生控制**。
3. **`ecdhflag` 是显式成败位** ⇒ 原生不需要解析签名字符串就能判断成功与否。

### 5.2 风险（未闭合，如实列出）

| # | 风险 | 说明 |
| --- | --- | --- |
| 1 | **`ZTSDK` 的实现未取证** | 它是抖音页面内置的 SDK；竞品只调用。要拿到 `signWithHmac` 的真实行为需抓抖音页面 |
| 2 | **`_ecdh_key_cache` 的两级 Map 键空间未取证** | 只知「第一级的第一个值的第一级的第一个值的 key」—— 多账号时会取到哪个账号的密钥，未证 |
| 3 | **`_timestamp` 的精度与格式未取证** | 只知由原生填；秒级/毫秒级、是否 UTC 未证 |
| 4 | **`md5cookie` 的"md5"在哪算未取证** | 名字暗示原生要算 MD5，但材料里没有现成的 MD5 值 ⇒ 推断原生算，未证 |
| 5 | **`x-ware-csrf-token` 的注入上下文未取证** | 只见字符串，未见完整注入脚本 |
| 6 | **未做活体验证** | 未向抖音发过任何请求 |

---

## 6. 复现

```bash
node extract-ticket-guard-contract.cjs
```

输出 `04-rea-evidence/WEMedia.exe.ticket-guard契约.json`：16 个锚点偏移、契约表、33 个原始段。
