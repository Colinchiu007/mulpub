# 快手 `hxfalcon` VM 指令集全解 + `sig3_data` 来源 + 289 URL 三分类

> **文档性质**：纯静态读码 + exe latin1 扫描。不反编译、不执行、不联网。
> **取证日期**：2026-10-19
> **脚本**：`02-analysis-scripts/extract-hxfalcon-opcodes.cjs`、`extract-url-classification.cjs`
> **机器可读**：`04-rea-evidence/hxfalcon-opcode表.json`、`WEMedia.exe.URL三分类.json`
>
> 本篇解决上一轮留下的三个遗留：① `sig3_data` 从哪来；② `hxfalcon` 的 `$encode` 里是什么；
> ③ 289 个 URL 的分类。

---

## 1. `sig3_data` 从哪来：原生 `%s` 填值

exe 里快手签名注入模板的**完整拼接形态**（@13408464 附近）：

```
get_kuaishou_sig3_param                    ← 注入入口名（原生按名索引）
';var sig3_data='                          ← 模板片段①
<%s>                                       ← 原生把 sig3_data 填进来（NUL 占位）
var sig3=gen__NS_sig3(sig3_data);window.JsKuaishouGetSig3(_account_id,sig3);
get_xiaohongshu_x_t_param                  ← 下一个入口名
```

⇒ **注入入口名与模板交替存放**，形成一个静态注册表：

```
get_douyin_bd_ticket_guard_client_data → <ticket-guard 模板>
（无名字段，紧跟其后）                  → a_bogus / X-Bogus / X-s/X-t / 头条 模板
get_kuaishou_sig3_param                → ';var sig3_data=<%s>' + gen__NS_sig3 调用
get_xiaohongshu_x_t_param              → <仅取 X-T 的变体模板>
```

**结论**：`sig3_data` 不是页面拼的，是**原生构造后经 `%s` 填入**（NUL 占位符已实证）。
这与 `ticket-guard` 的 `_timestamp` 同一模式 —— **所有平台签名的输入都由原生侧组装**。

**新发现 `anti-content`**（@13409056）：又一个小红书系风控头，紧邻 `set-cookie`，
说明竞品的请求头装配清单里还有这一项。此前 7 平台清单未单列。

---

## 2. `hxfalcon` 指令集全解：78 条 opcode，全部语义化

### 2.1 机器形态

| 维度 | 取证值 |
| --- | --- |
| 指令表位置 | `chuangzuozhe.js` module 7606 内 @32827~@46955（**13.8 KB**）|
| opcode 总数 | **78** |
| 指令名 | **全部为空串 `""`**（靠 `id` 递增编号，不走名字索引）|
| 指令类工厂 | `d(name, exec, calculateFactor)`，`o.prototype.id = t++` |
| 字节码载体 | `script.instructions` 数组 + `script.strings` / `script.regexps` / `script.scripts` 常量池 |
| 入口 | `a.fromJSON(JSON.parse(e))` → `run(script, t)` → `createFiber` → `t.run()` |
| 执行循环 | `for (; this.ip !== this.exitIp && !this.paused && 0 !== this.fiber.timeout;) e[this.ip++].exec(this, this.evalStack, this.scope, this.realm)` |
| 形参约定 | `(e, t, n, r)` = (VM 上下文， 求值栈， 作用域， realm)；**第 4 参出现 ⇒ 该指令带常量 `this.args`** |

### 2.2 语义分类（78 条全覆盖）

| 类别 | 数量 | op 编号 | 说明 |
| --- | --- | --- | --- |
| **栈操作** | 16 | 0,1,2,19,22~27 | pop/push/top/dup/swap |
| **二元运算** | 13 | 42~52, 61, 62 | `+ - * / % << >> >>> \| & ^ in instanceof` |
| **比较** | 8 | 53~60 | `== != === !== < <= > >=` |
| **寄存器** | 6 | 9~14 | `fiber.r1/r2/r3` 读写（跨指令的临时槽）|
| **一元** | 6 | 36~41 | `- ! ~ ++ --` |
| **控制流** | 5 | 18, 64~67 | jmp / 条件真跳 / 条件假跳 / 迭代 next |
| **作用域** | 4 | 30, 31, 34, 35 | 进/出作用域、with 作用域链 |
| **调试** | 4 | 74~77 | 子脚本、行号、列号、断点 |
| **try 守卫** | 3 | 6, 7, 8 | 压/弹异常守卫 |
| **迭代** | 3 | 15, 16, 17 | iterator 挂载 / 枚举键 / next |
| **全局** | 3 | 20, 32, 33 | 推 global、读/写全局变量 |
| **load 常量** | 3 | 69, 70, 71 | 整数 / 字符串表 / 正则表 |
| **fiber** | 2 | 4, 5 | 停机 / 协程 yield |
| **ret** | 1 | 3 | 函数返回 |
| **call** | 1 | 21 | 调用（含 `this.args[0]`=是否构造、`args[1]`=this 绑定）|

### 2.3 读几条关键指令的原文

```javascript
// op65: 无条件跳转
return e.ip = this.args[0]

// op66: 条件真跳
if (t.pop()) return e.ip = this.args[0]

// op42: 加法（注意操作数顺序：先 pop 的是右操作数）
return t.push(r.add(t.pop(), t.pop()))

// op70: 推字符串常量
return t.push(e.script.strings[this.args[0]])

// op74: 子脚本（函数字面量 → script 常量池）
var o = this.args[0]; return t.push(h(e.script.scripts[o], n, r, this.args[1]))

// op32: 读全局（带严格性检查）
return s(r.global, this.args[0]) || this.args[1]
    ? t.push(r.global[this.args[0]])
    : _(e, new Error(this.args[0] + " is not defined"))

// op21: 唯一的调用指令
var o = this.args[0], i = this.args[1], a = n.get(1);   // args[0]=是否 new，args[1]=this 来源
```

### 2.4 这意味着什么

1. **`hxfalcon` 是一个完整但小型的 JS 解释器**：78 条指令足以覆盖 ES5 语义
  （没有 `class`/箭头函数/`async`，但有 fiber 协程 —— **协程是它超越 ES5 的部分**，
   `suc` 回调的异步签名计算靠它实现）。
2. **`$encode` 的算法就在这套字节码里**（@14736 的混淆字符串表 + `script.strings` 常量池）。
   要继续逆 sig3 算法本身，需要：**解字节码 JSON 格式 → 反汇编 instructions → 逆 78 条指令的宏语义**。
   门槛已从「不知道是什么」降到「有完整指令语义表」—— 这是可做但费工的下一步。
3. **指令名全空 + id 编号** 说明**字节码是按 opcode 序号编码的**（不是按名字），
   反汇编器写起来直接：`instructions[i] = { op: id, args: [...] }`。

---

## 3. 289 个 URL 三分类：20 平台 / 9 自家 / 33 other

### 3.1 分类总表

| 类 | host 数 | 代表 |
| --- | --- | --- |
| **平台域** | 20 | mp.toutiao.com(25) · baijiahao.baidu.com(10) · cp.kuaishou.com(7) · om.qq.com(6) · member.bilibili.com(5) · studio.ixigua.com(5) · creator.douyin.com(3) · mp.weixin.qq.com(3) · fanyi.baidu.com(2) |
| **自家后端** | 9 | interface.17van.com(**70**) · toolsdownload(20) · bkend(16) · public(9) · download(5) · action(2) · static(2) · www(2) · api(1) |
| **other** | 33 | 证书链（digicert/globalsign×12）+ 5 个**第三方数据平台** |
| **noise** | 1 | w3.org |

### 3.2 平台域路径面暴露的功能重心

| host | 出现 | 路径语义 |
| --- | --- | --- |
| mp.toutiao.com | 25 | **收益类占绝对多数**（`/pgc/mp/income/*` 提现/对账单/来源分析、`/mp/agw/statistic/*`）|
| baijiahao.baidu.com | 10 | 创作者中心（粉丝分析/图文编辑）|
| cp.kuaishou.com | 7 | **付费推广**（`/promote/trading/recharge`、`/rest/v2/creator/pc/fanstop/money/*` 充值/余额）|
| om.qq.com | 6 | 腾讯广告收益（`/income/adSettle`）|
| member.bilibili.com | 5 | 创作激励（`/platform/allowance/*` 充电/激励/互选）|
| studio.ixigua.com | 5 | 西瓜创作（收益/上传）|
| creator.douyin.com | 3 | 创作者中心 + **`/web/api/media/aweme/post/`**（发布接口，与 ticket-guard 的 path 呼应）|

⇒ **竞品嵌这些页面不是为了「发布」，是为了「收益/变现数据」** —— 12 个平台 host 里
收益与充值相关路径占压倒性多数。这与竞品官网宣称的「数据看板」功能对应。

### 3.3 自家后端：`interface.17van.com` 一个域 70 条

高频路径（前 12）：

```
/key/map   /PcActivity/getTicket   /PcActivity/newUserPreferential
/PcDouyinLetter/getSubUserAccountMew   /danger/check   /danger/danger
/pc/activate   /pc/addAccounts   /pc/addCollect   /pc/addFollow   /pc/backup   /pc/checkPhone
```

⇒ 前缀为 `/pc/*` 的账号管理面（addAccounts/addFollow/checkPhone/backup）+
`/danger/*` 风控自检。`/key/map` 值得注意 —— **可能是密钥分发端点**（未证）。

### 3.4 other 里的 5 个第三方数据平台

```
mp.yuncheapp.cn      /wemedia-server/api/v1/accoun…   ← 另一个多账号管理平台
baowen.zimtzs.com    /article/lists /article/search    ← 文章聚合
rong.tt.cn           /east-other/hot/dataTotal         ← 热点数据
mp.cashtoutiao.com   /cash/total                       ← 现金收益
kuaichuan.360kuai.com /stat/userTotalNew               ← 统计
```

⇒ 竞品不只对接 7 个发布平台，还嵌了 **5 个第三方内容/收益平台的页面**。
`mp.yuncheapp.cn` 出现 `/wemedia-server/api/v1/account…` —— 竞品同类竞品的数据接口，
**这些 URL 直接写在 exe 里**，说明竞品会加载它们的页面（可能是「热点追踪」功能的数据源）。

---

## 4. 复现

```bash
node extract-hxfalcon-opcodes.cjs       # 78 条 opcode 全表 + 语义分类
node extract-url-classification.cjs     # 289 URL 三分类
```

---

## 5. 未闭合

| # | 项 |
| --- | --- |
| 1 | **`$encode` 字节码本体未反汇编** —— 指令语义已全表化（78 条），字节码 JSON 格式（`fromJSON` 输入）未解；下一步是解 `script.instructions` 的 JSON 结构并反汇编 |
| 2 | **`/key/map` 端点用途未证** —— 疑似密钥分发，未请求验证 |
| 3 | **`anti-content` 的注入上下文未取证** —— 只见头名与 `set-cookie` 相邻 |
| 4 | **`sig3_data` 的字段结构未取证** —— 只知由原生拼（`%s`），字段未见 |
| 5 | **全部为静态** —— 未运行、未联网 |
