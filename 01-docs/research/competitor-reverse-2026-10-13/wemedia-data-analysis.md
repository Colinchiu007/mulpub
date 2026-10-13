# 融媒宝 data/ 目录数据资产分析

> 来源：`D:\Program Files (x86)\融媒宝\data\`（83 个文件 / 1.58 MB，GBK 编码）
> 生成时间：2026-10-13T04:34:14.011Z

---

> ## ⚠️ 更正（2026-10-13 21:40 补）
>
> **本报告的「分类条目总计：2114 条」（§4.1 末，L353）是解析器不完整导致的少算，不是数据集的实际规模。**
>
> **实测更正**：用形态无关解析器（`analyze-wemedia-taxonomy-v2.cjs`）重跑**同一份数据**，得到
> **31 个平台 / 11,623 个分类节点**（整数为 `11623`，`_taxonomy-summary-v2.json` 可复现）。
>
> **少算 5.5 倍的根因**：本报告的统计只按**一种 JSON 形态**（`{id,name,cates}`）解析，
> 而实际存在**至少 5 种**形态 —— 抖音是 `{code,text}` 扁平、百家是 `{child,...}` 嵌套、
> 搜狐是 `{childrenCate,level,parentCate,title,titles}` 任意深度（实测到 level 4）、
> 另有「键即分类名」`{"一级":["二级",...]}` 与值为 `null` 的形态。
> **不匹配的文件被静默计为 0，而非报错** —— 故错误表现为「数字偏小」而不是红灯。
>
> **已交叉验证两个来源内容相同**：
> - 磁盘 `融媒宝\data\` = 131 文件
> - `融媒宝\data.zip` 解出 = 131 文件（唯一差异是 `config.ini` 只在磁盘侧）
> - **同一解析器跑两者，均得 11,623 节点** ⇒ 差异 100% 来自解析器，不是数据集
>
> **取数请用**：`融媒宝-data.zip数据集拆解.md`（含 5 种形态说明与 fail-loud 版本）。
> **本报告保留作演进记录**；其 §1–§3、§5 之后关于 `config.ini`、指标矩阵、加密词库等
> **非分类计数**的内容**未受此影响**，仍有效。
>
> 另：本报告头部「83 个文件」与实测 131 不符（疑为只统计了顶层），一并更正。

---

## 1. config.ini —— 渠道包与模块配置

```ini
[param]
channel=sogougf
MediaTaskMgrModule=MediaTaskMgr.dll
subchannel=sogougf
```

**读出的两条关键机制**：

| 配置项 | 值 | 含义 |
|---|---|---|
| `channel` / `subchannel` | `sogougf` | **搜狗渠道包** —— 融媒宝按渠道分发（OEM 贴牌）|
| `MediaTaskMgrModule` | `MediaTaskMgr.dll` | **媒体引擎是配置化模块** —— 宿主按配置名加载 DLL，可替换/热更新 |

> `MediaTaskMgrModule` 这一行是硬证据：它把「引擎作为独立组件」从推断变成了**配置事实**。
> 配合 `MediaTaskMgr_1.0.0.257.dll` 旧版本残留 + `ApiSoftware/CheckComponent` 接口，
> 完整还原了融媒宝的**组件热更新链路**：
> `CheckComponent` 查询 → 下载 `MediaTaskMgr_<版本>.dll` → 改配置/替换 → 下次启动加载新版本。

---

## 2. mediadatamgr.ini —— 各平台数据指标支持矩阵 ⭐

```ini
#1:鎬绘敹鐩?2銆佹槰鏃ユ敹鐩?3銆佸浘鏂囨€婚槄璇绘暟 4銆佹槰澶╁浘鏂囬槄璇绘暟 5銆佹€昏棰戞挱鏀炬暟 6銆佹槰澶╄棰戞挱鏀炬暟 
#7銆佺矇涓濇暟 8銆佹槰鏃ヨ瘎璁烘暟 9銆佹槰鏃ョ偣璧炴暟 10銆佹槰鏃ュ垎浜暟 11銆?鏄ㄦ棩娑ㄧ矇鏁?
#鏁版嵁鎬昏
[1]
#寰俊鍏紬鍙?
1=1,2,4,6,7,10,11
#澶存潯鍙?
3=1,2,3,4,5,6,7,8,9,11
#鐧惧鍙?
4=1,2,3,4,5,6,7,8,9,10,11
#涓€鐐瑰彿
5=1,2,3,4,5,6,7
#浼侀箙鍙?
6=1,3,4,5,6,7
#澶ч奔鍙?
7=1,2,4,6,7
#鎼滅嫄鍙?
8=1,2,3,4,5,6
#寰崥
10=1,2,4,6,7
#缃戞槗
11=1,2,3,4,5,6,7
#鐭ヤ箮
12=1,2,3,4,5,6,7
#鏂版氮鐪嬬偣
15=1,4,6
#涓滄柟鍙?
16=2,3,5,7
#澶ч鍙?
17=1,2,3,4,5,6,7
#蹇紶鍙?
19=1,2,3,4,5,6,7
#鐖卞鑹?
20=1,2,5,6,7
#鑵捐瑙嗛
21=1,6,7
#鎼滅嫄瑙嗛
22=7
#鍝斿摡鍝斿摡
23=1,2,3,4,5,6,7,8,9,10,11
#绉掓媿
26=1,2,5,6,7
#瑗跨摐瑙嗛
32=1,2,5,6,7,8,9,10,11
#蹇墜
35=6,7,8,9,10,11
#鎶栭煶
36=1,2,6,7,8,9,10,11
#鐧捐姳鍙?
44=6
#鐨毊铏?
48=5,6,7
#寰
49=7
#灏忕孩涔?
51=4,6,7,8,9,10,11
#瑙嗛鍙?
53=6,7,8,9,10,11
#ACFUN
58=4,6,7
#鍑开鍙?
71=1,2,3,4,5,6,7
#闆悆鍙?
72=3,4,5,6,7
#鎶栭煶浠ｈ繍钀?
85=1,2,6,7,8,9,10,11
#1:鏀剁泭 2銆佹帹鑽?3銆佹挱鏀?4銆佽瘎璁?5銆佺偣璧?6銆佸垎浜?7銆佹柊澧炵矇涓?
#鍛樺伐鏁版嵁銆佸钩鍙版暟鎹€佽处鍙锋暟鎹?
[2]
#寰俊鍏紬鍙?
1=1,3,7
#澶存潯鍙?
3=1,2,3,4,5,7
#鐧惧鍙?
4=1,3,4,5,6,7
#涓€鐐瑰彿
5=2,3
#浼侀箙鍙?
6=1,3
#澶ч奔鍙?
7=1,2,3
#鎼滅嫄鍙?
8=1,3
#寰崥
10=1,3
#缃戞槗
11=1,2,3
#鐭ヤ箮
12=1,3
#鏂版氮鐪嬬偣
15=2,3
#澶ч鍙?
17=2,3
#蹇紶鍙?
19=1,2,3
#鐖卞鑹?
20=1,2,3
#鑵捐瑙嗛
21=1,3
#鍝斿摡鍝斿摡
23=1,3,4,5,6,7
#浼橀叿
24=3
#瑗跨摐瑙嗛
32=1,2,3,4,5,6,7
#蹇墜
35=3,4,5,6,7
#鎶栭煶
36=1,3,4,5,6,7
#鐧捐姳鍙?
44=3
#鐨毊铏?
48=3
#灏忕孩涔?
51=3,4,5,6,7
#瑙嗛鍙?
53=3,4,5,6,7
#ACFUN
58=3
#闆悆鍙?
72=3
#鎶栭煶浠ｈ繍钀?
85=1,3,4,5,6,7
```

**指标编号含义**（文件头注释）：

| # | 指标 | # | 指标 |
|---|---|---|---|
| 1 | 总收益 | 7 | 粉丝数 |
| 2 | 昨日收益 | 8 | 昨日评论数 |
| 3 | 图文总阅读数 | 9 | 昨日点赞数 |
| 4 | 昨天图文阅读数 | 10 | 昨日分享数 |
| 5 | 总视频播放数 | 11 | 昨日涨粉数 |
| 6 | 昨天视频播放数 | | |

**解析出的分组与平台支持情况**：

- **[1]**
  - 1=1,2,4,6,7,10,11
  - 3=1,2,3,4,5,6,7,8,9,11
  - 4=1,2,3,4,5,6,7,8,9,10,11
  - 5=1,2,3,4,5,6,7
  - 6=1,3,4,5,6,7
  - 7=1,2,4,6,7
  - 8=1,2,3,4,5,6
  - 10=1,2,4,6,7
  - 11=1,2,3,4,5,6,7
  - 12=1,2,3,4,5,6,7
  - 15=1,4,6
  - 16=2,3,5,7
  - 17=1,2,3,4,5,6,7
  - 19=1,2,3,4,5,6,7
  - 20=1,2,5,6,7
  - 21=1,6,7
  - 22=7
  - 23=1,2,3,4,5,6,7,8,9,10,11
  - 26=1,2,5,6,7
  - 32=1,2,5,6,7,8,9,10,11
  - 35=6,7,8,9,10,11
  - 36=1,2,6,7,8,9,10,11
  - 44=6
  - 48=5,6,7
  - 49=7
  - 51=4,6,7,8,9,10,11
  - 53=6,7,8,9,10,11
  - 58=4,6,7
  - 71=1,2,3,4,5,6,7
  - 72=3,4,5,6,7
  - 85=1,2,6,7,8,9,10,11
- **[2]**
  - 1=1,3,7
  - 3=1,2,3,4,5,7
  - 4=1,3,4,5,6,7
  - 5=2,3
  - 6=1,3
  - 7=1,2,3
  - 8=1,3
  - 10=1,3
  - 11=1,2,3
  - 12=1,3
  - 15=2,3
  - 17=2,3
  - 19=1,2,3
  - 20=1,2,3
  - 21=1,3
  - 23=1,3,4,5,6,7
  - 24=3
  - 32=1,2,3,4,5,6,7
  - 35=3,4,5,6,7
  - 36=1,3,4,5,6,7
  - 44=3
  - 48=3
  - 51=3,4,5,6,7
  - 53=3,4,5,6,7
  - 58=3
  - 72=3
  - 85=1,3,4,5,6,7

> **对本项目的价值**：本项目 `apps/desktop/electron/services/account-metrics/adapters.js`
> 目前支持 douyin / kuaishou / toutiao / xiaohongshu 四个平台的数据抓取。
> 这张矩阵表给出了**融媒宝对每个平台能抓到哪些指标**的权威对照——
> 扩平台数据抓取时可直接照此确定「该平台该抓什么」，避免抓了平台不提供的指标。

---

## 3. media_class_set.txt —— 平台登录页 CSS 选择器映射 ⭐

```json
{
    "36": ["login-card-double-Gtywl8", "Ozf92TxU Y4ijCbDB yBtmBy9d", "trust-login-switch-button uncheck", "r7j70rK2 M38h7w3V BBqC6Jfj  ", "login-panel-new", "semi-button semi-button-primary eK1Z2Sel", "xg-tips", "qSsCHWSU GdNlylMd u4mlHKc5", "trust-login-switch-button check", "i_7rPk8Q",".i_7rPk8Q,.uVZnczJ6"]
}
```

**这是什么**：键 `"36"` 是平台 ID，值是**该平台登录页的关键 CSS 选择器/类名列表**：

| 选择器 | 用途推断 |
|---|---|
| `login-card-double-Gtywl8` | 登录卡片容器 |
| `login-panel-new` | 新版登录面板 |
| `semi-button semi-button-primary eK1Z2Sel` | 主按钮（提交）|
| `trust-login-switch-button uncheck` / `... check` | **信任登录开关**（勾选态/未勾选态）|
| `xg-tips` | 提示文字 |
| `i_7rPk8Q` / `.i_7rPk8Q,.uVZnczJ6` | 图标/其他元素 |

**关键机制**：这类选择器通过 `https://download.17van.com/plugin/media_class_set.txt?_t=`
**远程下发**（exe 字符串里找到了该 URL）。

**为什么重要**：平台前端改版会让写死的选择器失效。融媒宝把选择器做成**远程配置**，
平台一改版就更新这个文件，**客户端无需发版**。这是对抗「平台频繁改版」的工程手段。

**对本项目的启示**：本项目 `platform-definitions.js` 的登录检测模式（`PLATFORM_LOGIN_SUCCESS_PATTERNS`）
是**硬编码在源码里**的，平台改版必须发版。可参考融媒宝的**远程选择器配置 + 本地兜底**设计。
> ⚠️ 但要注意：本项目 AGENTS.md 要求「离线可用」，远程配置必须**本地打包默认值兜底**，
> 且远程拉取失败时静默降级，不能阻塞启动。

---

## 4. 平台分类体系（83 个文件的主干）

分类相关文件共 **63** 个，命名规律：

| 后缀 | 含义 | 示例 |
|---|---|---|
| `categortmap.txt` | 一级分类映射 | `douyincategortmap.txt` |
| `subcategort.txt` | 二级分类 | `douyinvideosubcategort.txt` |
| `videocategortmap.txt` | 视频一级分类 | `baijiavideocategortmap.txt` |
| `videosubcategort.txt` | 视频二级分类 | `bilibilivideosubcategort.txt` |

（注意文件名里的 `categort` 是**原文拼写**，作者把 `category` 拼错了，全库一致）

### 4.1 各平台分类条目数统计

| 文件 | 大小 | 顶层条目数 |
|---|---:|---:|
| `acfuncategortmap.txt` | 1.0 KB | 0 |
| `acfunsubcategort.txt` | 0.4 KB | 6（顶层键） |
| `acfunvideocategortmap.txt` | 2.3 KB | 0 |
| `acfunvideosubcategort.txt` | 0.8 KB | 11（顶层键） |
| `aiqiyimediavideocategortmap.txt` | 1.9 KB | 0 |
| `baihuasubcategort.txt` | 0.6 KB | 9（顶层键） |
| `baihuavideocategortmap.txt` | 3.7 KB | 9（顶层键） |
| `baijiavideocategortmap.txt` | 48.3 KB | 67（顶层键） |
| `baijiavideosubcategort.txt` | 9.6 KB | 23（顶层键） |
| `bilibilicategortmap.txt` | 2.1 KB | 7（顶层键） |
| `bilibilisubcategort.txt` | 0.4 KB | 7（顶层键） |
| `bilibilivideocategortmap.txt` | 8.0 KB | 23（顶层键） |
| `bilibilivideosubcategort.txt` | 1.4 KB | 23（顶层键） |
| `dafengcategortmap.txt` | 2.6 KB | 0 |
| `dafengvideocategortmap.txt` | 25.4 KB | 38（顶层键） |
| `dayuvideosubcategort.txt` | 0.6 KB | 0 |
| `dongfangsubcategort.txt` | 0.8 KB | 6（顶层键） |
| `dongfangvideosubcategort.txt` | 0.3 KB | 3（顶层键） |
| `douyincategortmap.txt` | 1.8 KB | 27（text 字段） |
| `douyinvideocategortmap.txt` | 20.7 KB | 35（顶层键） |
| `douyinvideosubcategort.txt` | 4.2 KB | 35（顶层键） |
| `huitoutiaocategortmap.txt` | 2.4 KB | 0 |
| `huitoutiaosubcategort.txt` | 0.8 KB | 23（顶层键） |
| `huitoutiaovideocategortmap.txt` | 2.2 KB | 0 |
| `huitoutiaovideosubcategort.txt` | 0.7 KB | 22（顶层键） |
| `kaidicategortmap.txt` | 5.6 KB | 17（顶层键） |
| `kaidisubcategort.txt` | 1.0 KB | 17（顶层键） |
| `kuaichuancategortmap.txt` | 1.4 KB | 0 |
| `kuaishouvideosubcategort.txt` | 5.0 KB | 38（顶层键） |
| `meipaisubcategort.txt` | 0.6 KB | 0 |
| `meipaisubcategortmap.txt` | 2.0 KB | 0 |
| `miaopaimediavideocategortmap.txt` | 1.4 KB | 0 |
| `miaopaimediavideosubcategort.txt` | 0.6 KB | 0 |
| `qievideosubcategort.txt` | 2.0 KB | 29（顶层键） |
| `qqkandiansubcategortmap.txt` | 51.6 KB | 0 |
| `qqkandianvideocategortmap.txt` | 16.8 KB | 0 |
| `qqkandianvideosubcategort.txt` | 8.7 KB | 139（顶层键） |
| `qqkantiaosubcategort.txt` | 5.2 KB | 34（顶层键） |
| `qutoutiaocategortmap.txt` | 11.9 KB | 0 |
| `qutoutiaosubcategort.txt` | 3.3 KB | 39（顶层键） |
| `sinakandiancategortmap.txt` | 2.7 KB | 0 |
| `sinakandiansubcategort.txt` | 1.3 KB | 5（顶层键） |
| `sogouvideosubcategort.txt` | 2.1 KB | 34（顶层键） |
| `sohumediacategortmap.txt` | 7.7 KB | 18（顶层键） |
| `sohumediasubcategort.txt` | 1.4 KB | 18（顶层键） |
| `sohusubcategort.txt` | 0.1 KB | 0 |
| `sohusubcategortmap.txt` | 8.4 KB | 24（顶层键） |
| `sohuvideocategortmap.txt` | 347.4 KB | 921（顶层键） |
| `sohuvideosubcategort.txt` | 15.7 KB | 174（顶层键） |
| `tencentvideocategortmap.txt` | 14.0 KB | 20（顶层键） |
| `tencentvideosubcategort.txt` | 2.8 KB | 20（顶层键） |
| `toutiaovideosubcategort.txt` | 0.4 KB | 0 |
| `wangyisubcategort.txt` | 2.0 KB | 30（顶层键） |
| `wangyisubcategortmap.txt` | 9.8 KB | 0 |
| `wangyivideosubcategort.txt` | 1.7 KB | 0 |
| `weibovideocategortmap.txt` | 25.5 KB | 19（顶层键） |
| `weibovideosubcategort.txt` | 3.0 KB | 19（顶层键） |
| `weixinvideosubcategort.txt` | 3.9 KB | 39（顶层键） |
| `wutiaosubcategort.txt` | 0.5 KB | 0 |
| `yidiansubcategort.txt` | 2.7 KB | 29（顶层键） |
| `yidianvideosubcategort.txt` | 3.2 KB | 39（顶层键） |
| `zhihuvideocategortmap.txt` | 1.6 KB | 0 |
| `zhihuvideosubcategort.txt` | 1.5 KB | 18（顶层键） |

**分类条目总计：2114 条**

---

## 5. sensitivelibrary.txt —— 敏感词库（793 KB，🔒 加密）

- 文件大小：**793.0 KB**
- 字符数：**812056**（4 的倍数 ✅）
- 唯一字符数：**65**
- 字符集：`+/0123456789=ABCDEFG…ghijklmnopqrstuvwxyz`

### 5.1 判定：这是**加密后 base64 编码**，不是明文词库

**证据链**：

| # | 观测 | 结论 |
|---|---|---|
| 1 | 无任何换行符（`\r\n`/`\n`/`\r` 均为 0）| 不是「一行一个词」的明文词表 |
| 2 | 无逗号/分号/管道符分隔 | 不是 CSV/分隔符格式 |
| 3 | 唯一字符 65 个，恰为标准 base64 字符集 `A-Za-z0-9+/=` | 是 base64 编码 |
| 4 | 长度 812,056 是 4 的倍数 | base64 长度约束成立 |
| 5 | base64 解码后**无 gzip(1f8b) / zlib(789c) 魔数** | 不是压缩包 |
| 6 | 解码后 48 字节中仅 14 字节可打印 | **高熵密文**（加密）|

解码后密文长度约 **594.8 KB**。

**aes/自定义算法未知**：解密密钥应在 `WEMedia.exe` 或 `MediaTaskMgr.dll` 内，
本次未能定位（主程序加壳 + 代码量过大导致无法反编译，见 [原生层分析补充报告.md](原生层分析补充报告.md)）。
**因此本报告不声称已知词库内容或规模。**

### 5.2 一个关键对比：83 个文件里只有它被加密

| 类型 | 文件数 | 说明 |
|---|---|---|
| ✅ 明文 GBK | **77** | 全部分类映射、新手引导、常见问题、公告 |
| ▫️ 纯 ASCII | 4 | `config.ini`、`media_class_set*.txt`、`comment_media_js.json` |
| 🔒 base64 密文 | **1** | `sensitivelibrary.txt`（敏感词库）|

**结论**：融媒宝把**分类数据、文案、配置全部明文**（便于渠道改文案），
只对**敏感词库**加密。这反映出他们的商业判断——
**敏感词库是投入最大、最可复用的核心资产**（持续维护的违禁词/限流词清单），
而分类映射只是平台公开数据、文案是渠道定制项，都不值得加密。

**对本项目的启示**：

- 本项目 `packages/shared-utils/src/sensitive-filter.js` 与 `packages/rewrite-engine/src/sensitive-filter.js`
  已有敏感词过滤能力，**无需也无法复用融媒宝的加密词库**（且存在版权与时效性问题）。
- 但可借鉴这个判断：**词库是需要持续运营的资产**。本项目若要把敏感词做成竞争力，
  应建立**词库更新机制**（服务端下发 + 本地兜底），而不是写死在源码里。

---

## 6. OEM / 白标机制（重要商业模式发现）

带渠道后缀的文件：

```
common_question_oem.txt
common_question_ym.txt
new_user_guide_oem.txt
new_user_guide_tjj888.txt
new_user_guide_ym.txt
software_notify_oem.txt
software_notify_ym.txt
```

**三种变体共存**说明融媒宝支持**多渠道贴牌分发**：

| 后缀 | 推断含义 |
|---|---|
| （无） | 默认版本 |
| `_oem` | OEM 贴牌版（其他品牌冠名）|
| `_ym` | 另一个渠道（可能是「蚁盟」或某平台代号）|
| `_tjj888` | 特定渠道号 `tjj888` |

配合 `config.ini` 的 `channel=sogougf`，可确认融媒宝是**按渠道分发同一套程序**，
不同渠道加载不同的欢迎语/常见问题/公告文案。

**对本项目的启示**：如果未来要做渠道分发或企业定制版，
这套「**同一程序 + 渠道化文案资产 + 渠道配置**」的模式比维护多份代码更可维护。

---

## 7. 其他数据文件

| 文件 | 大小 | 内容样本（前 3 行）|
|---|---:|---|
| `comment_media_js.json` | 14.7 KB | 评论媒体资源映射<br>{ /    "1" : {       /       "LoadEnd" : [ |
| `media_url_list.txt` | 7.1 KB | 媒体 URL 列表<br>#EMEDIATYPE_WEIXIN, //微信公众号 / [1] / data_url= |
| `deepsearchercat.txt` | 3.4 KB | 深度搜索分类<br>{ /    "综合" :  /    [ |
| `new_user_guide.txt` | 1.0 KB | 新手指引文案<br>[ / 	{ / 		"text":"如何添加平台账号？", |
| `common_question.txt` | 0.9 KB | 常见问题文案<br>[ / 	{ / 		"text":"打开账号网页空白如何解决?", |
| `software_notify.txt` | 0.1 KB | 软件公告<br>[ / 	{ / 		"text":"聚合分发：多渠道分发，开启即可获得内容收益及品牌曝光", |