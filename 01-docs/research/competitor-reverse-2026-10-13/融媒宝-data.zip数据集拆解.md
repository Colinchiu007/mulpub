# 融媒宝 `data.zip` 数据集完整拆解

> 分析日期：2026-10-13
> 分析对象：`D:\Program Files (x86)\融媒宝\data.zip`（761.9 KB，136 条目）
> 解出位置：`D:\Data\projects\rea\analysis\wemedia-data-zip\data\`（130 文件 / 1.57 MB）
> 取证脚本：`extract-wemedia-datazip.cjs`、`probe-wemedia-data-encoding.cjs`、`analyze-wemedia-taxonomy-v2.cjs`、`probe-wemedia-data-misc.cjs`
> 性质：**纯静态只读分析**。源 zip 未被修改，解出物未执行。

---

## 0. 一句话结论

`data.zip` 是融媒宝的**平台数据字典包**（不是代码，是数据）：**31 个平台的分类体系共 11,623 个分类节点**、**平台指标能力矩阵**、**各平台数据看板 URL 表**、**采集脚本注入规则**、**爆文库/热榜分类**、以及一份**加密的敏感词库**。

**对 mulpub 的价值集中在「分类 ID」这一项** —— mulpub 走 API 发布时，多数平台的发布接口需要**平台侧分类 ID**；这份数据里 26 个平台的分类带真实 ID（抖音 `code`、百家号中文 ID、微博 16 位数字 ID 等）。其余（看板 URL、采集注入规则）是 RPA 监控能力，属可选参考。

---

## 1. 为什么之前没读它

前几轮的拆解都聚焦 `Asset/dist`（前端 bundle）与 `MediaTaskMgr.dll`（原生层），`data.zip` 一直躺在安装根目录未被打开。本轮按用户要求解开并彻底分析。

**它不是可执行内容**，所以既不进之前的字符串扫描，也不进 API 提取。

---

## 2. 解压：一个必须绕过的坑

### 2.1 直接用 `Expand-Archive` 会得到乱码文件名

该 zip 的条目**未置 UTF-8 标志位**（general purpose bit 11 = 0），文件名以系统 ANSI 码页（**GBK**）存字节。.NET / PowerShell 会按码页解成乱码：

```
data/doc/⟨U+FFFD×8⟩.csv        ← Expand-Archive 的结果
data/doc/内容数据.csv         ← 正确解码
```

**处置**：自写提取器 `extract-wemedia-datazip.cjs`，自行解析中央目录，按规则判名：

| 规则 | 命中数 | 何时用 |
|---|---|---|
| `ascii` | 124 | 全 ASCII 名 |
| `gbk` | 6 | 置标志位 = 0 且含高位字节、严格 UTF-8 解码失败 |

**结果**：130 文件全部解出，**含 U+FFFD 替换字符的文件名 = 0**。6 个中文名全部正确还原：`内容数据.csv`、`平台数据.csv`、`平台数据详情.csv`、`数据总览.csv`、`账号数据.csv`、`账号详情-内容数据.csv`。

清单落在 `_extract-manifest.json`（含每个条目的**原始文件名字节 hex**，供事后核对解码是否正确）。

### 2.2 文件内容本身也有两种编码

解出来只是第一步 —— **内容**同样混编。用严格 UTF-8 试探 + GBK 回退：

| 编码 | 文件数 |
|---|---|
| **GBK** | **78** |
| UTF-8 | 51 |
| 二进制（1 个 gif） | 1 |

**这一步不做，后面全是乱码。** 实测未按 GBK 读时，`media_url_list.txt` 的注释渲染成 `//΢⟨U+FFFD×1⟩Ź⟨U+FFFD×2⟩ں⟨U+FFFD×1⟩`（应为 `//微信公众号`），`deepsearchercat.txt` 渲染成 `"⟨U+FFFD×1⟩ۺ⟨U+FFFD×1⟩"`（应为 `"综合"`）。

---

## 3. 完整内容清单（按价值排序）

### 3.1 平台分类映射 ★★★★★（核心资产）

**64 个文件**，命名规律：

| 文件名模式 | 数量 | 语义 |
|---|---|---|
| `<平台>categortmap.txt` | — | 图文分类（带平台 ID） |
| `<平台>videocategortmap.txt` | — | 视频分类（带平台 ID） |
| `<平台>subcategort.txt` | — | 图文的二级分类（**只有名字，无 ID**） |
| `<平台>videosubcategort.txt` | — | 视频的二级分类（无 ID） |

注意文件名里的 **`categort`** 是**产品自己的拼写错误**（应为 `category`），全包一致，属可依赖的稳定特征。

### 3.2 平台分类体系统计（31 个平台 / 11,623 节点）

| 平台 | 节点 | 去重 | 深度 | KB | 平台 id 键 | 各层节点 |
|---|---|---|---|---|---|---|
| sohu | 2038 | 1939 | **4** | 371.6 | `id` | L1:63 L2:411 L3:887 L4:677 |
| qqkandian | 1084 | 906 | 3 | 77.1 | `channel_id` | L1:94 L2:278 L3:712 |
| baijia | 876 | 778 | 3 | 57.9 | `id` | L1:88 L2:644 L3:144 |
| qutoutiao | 756 | 668 | 2 | 15.2 | `id` | L1:79 L2:677 |
| dafeng | 525 | 507 | 2 | 31.7 | `id` | L1:117 L2:408 |
| wangyi | 422 | 418 | 2 | 13.6 | `id` | L1:84 L2:338 |
| weixin | 411 | 370 | 2 | 3.9 | — | L1:39 L2:372 |
| weibo | 381 | 366 | 2 | 28.6 | `id` | L1:38 L2:343 |
| bilibili | 358 | 353 | 2 | 11.9 | `id` | L1:60 L2:298 |
| huitoutiao | 320 | 320 | 2 | 6.1 | `id` | L1:90 L2:230 |
| tencent | 310 | 310 | 2 | 16.8 | `id` | L1:40 L2:270 |
| kuaishou | 305 | 268 | 2 | 5.0 | — | L1:38 L2:267 |
| yidian | 285 | 242 | 2 | 5.9 | — | L1:39 L2:246 |
| **douyin** | **272** | 272 | 2 | 26.7 | **`code`** | L1:63 L2:209 |
| sogou | 231 | 228 | 2 | 2.1 | — | L1:34 L2:197 |
| acfun | 218 | 218 | 2 | 4.5 | `id` | L1:34 L2:184 |
| qie | 205 | 205 | 2 | 2.0 | — | L1:29 L2:176 |
| sinakandian | 202 | 196 | 2 | 4.0 | `id` | L1:80 L2:122 |
| sohumedia | 192 | 192 | 2 | 9.1 | `id` | L1:50 L2:142 |
| kaidi | 136 | 134 | 2 | 6.6 | `id` | L1:34 L2:102 |
| zhihu | 135 | 135 | 2 | 3.1 | `id` | L1:51 L2:84 |
| meipai | 134 | 114 | 2 | 2.6 | `id` | L1:24 L2:110 |
| baihua | 132 | 132 | 2 | 4.3 | `id` | L1:18 L2:114 |
| dongfang | 108 | 101 | 2 | 1.1 | — | L1:45 L2:63 |
| miaopaimedia | 77 | 77 | 1 | 2.0 | `id` | L1:77 |
| kuaichuan | 50 | 50 | 1 | 1.4 | `id` | L1:50 |
| dayu | 42 | 42 | 1 | 0.6 | — | L1:42 |
| wutiao | 36 | 36 | 1 | 0.5 | — | L1:36 |
| aiqiyimedia | 29 | 29 | 1 | 1.9 | `id` | L1:29 |
| toutiao | 25 | 25 | 1 | 0.4 | — | L1:25 |
| **合计** | **11,623** | | 最深 4 | 723 | | |

### 3.3 ★ 五种互不相同的 JSON 形态（复用时的最大障碍）

**这是本数据集最需要注意的一点**：同一个用途的文件，**形态不统一**。按出现顺序：

| # | 形态 | 实例 | 结构 |
|---|---|---|---|
| A | 扁平 `{code,text}` | `douyincategortmap.txt`（27 项） | `[{"code":117,"text":"动植物"}, …]` |
| B | `{id,name,cates:[{id,name}]}` | `qutoutiaocategortmap.txt` | 二级固定 |
| C | `{child,id,name}` | `baijiavideocategortmap.txt` | 子节点键叫 `child`，可为 `null` |
| D | `{childrenCate,level,parentCate,title,titles,upset,index}` | `sohuvideocategortmap.txt` | **任意深度**（实测到 level 4），带 `titles` 逗号路径 |
| E | `{分类名: [子分类名…]}` 或 `{分类名: null}` | `douyinvideosubcategort.txt` / `sohusubcategort.txt` | **键即分类名**，无 ID；值为 `null` 表示无二级 |

**只按其中一种写解析器会静默少算。** 本例实测：

| 版本 | 识别文件 | 节点总数 |
|---|---|---|
| v1（只认形态 B） | 64 判成功但 A/C/D/E **静默产出 0** | 3,838 |
| v2 首版（形态无关遍历，但要求「有 name 字段」） | 28 / 64 | 8,926 |
| v2 二版（加「键即名」形态） | 50 / 64 | — |
| **v2 终版（再允许值 `null`）** | **64 / 64，未识别 0** | **11,623** |

**v1 少算了 67%。** 这条必须写进任何复用该数据的实现里：**解析器必须对形态 fail-loud，不能把「没匹配上」当成「这个平台没有子分类」。**

### 3.4 平台指标能力矩阵 ★★★★

**`mediadatamgr.ini`**（1.8 KB，UTF-8）—— 明文定义了「哪个平台能拿到哪些指标」：

```
#1:总收益 2、昨日收益 3、图文总阅读数 4、昨天图文阅读数 5、总视频播放数 6、昨天视频播放数
#7、粉丝数 8、昨日评论数 9、昨日点赞数 10、昨日分享数 11、 昨日涨粉数
#数据总览
[1]
#微信公众号
1=1,2,4,6,7,10,11
#头条号
3=1,2,3,4,5,6,7,8,9,11
#百家号
4=1,2,3,4,5,6,7,8,9,10,11
```

**读法**：`平台ID = 该平台可取的指标 ID 列表`。例：微信公众号只有 7 项（无「图文总阅读数」「昨日评论数」），百家号拿得到全部 11 项，哔哩哔哩也是全 11 项。

**为什么有价值**：这是**「平台能力矩阵」的现成实现** —— 与 mulpub 的 publish-capabilities 概念同构，但维度是**数据指标**而非发布能力。可作 mulpub 后续做「发布后数据回收」时的能力表参考：**哪些平台拿不到哪些数，不该编造。**

### 3.5 各平台数据看板 URL 表 ★★★

**`media_url_list.txt`**（7.2 KB，GBK，**252 行**）—— 每个平台的四类页面 URL：

```
#EMEDIATYPE_WEIXIN, //微信公众号
[1]
comment_url=https://mp.weixin.qq.com/misc/appmsgcomment
msg_url=https://mp.weixin.qq.com/cgi-bin/message
#EMEDIATYPE_TOUTIAO, //今日头条
[3]
data_url=https://mp.toutiao.com/profile_v4/analysis/works-overall/all
income_url=https://mp.toutiao.com/profile_v4/analysis/income-overview
comment_url=https://mp.toutiao.com/profile_v4/manage/comment/all
msg_url=https://mp.toutiao.com/profile_v4/personal/message?type=message_letter
monitor_url=https://mp.toutiao.com/profile_v4/personal/message?type=digg
```

字段含义：`data_url` 内容数据 / `income_url` 收益 / `comment_url` 评论 / `msg_url` 私信 / `monitor_url` 互动监控。

**性质**：这是**账号数据回收的抓取目标表**（RPA 用）。用于发布无关，但若 mulpub 要做「发布后数据看板」，这是现成的入口清单。

**注意**：URL 会随平台改版失效，这份数据来自打包时的冻结快照，**不能当长期契约**。

### 3.6 采集脚本注入规则 ★★

**`comment_media_js.json`**（15 KB，UTF-8，328 行）—— 按平台 ID 定义「何时注入什么 JS」：

```json
"1" : {
   "LoadEnd" : [
      { "exactmatch": false, "jspos": 0, "return": false,
        "url" : "https://mp.weixin.qq.com/misc/appmsgcomment" },
```

形态是**声明式注入规则表**：`平台 → 事件(LoadEnd) → [{url 匹配, jspos 位置, exactmatch 是否精确, return 是否中断}]`。

**推断**：`jspos` 是脚本在注入序列中的位置索引，`return: false` 表示执行后继续后续规则。**未确认**：具体注入的 JS 内容不在本文件里（应是内嵌在宿主代码中），故这只是**规则骨架**。

### 3.7 DOM 类名指纹 ★★

**`media_class_set.txt` / `media_class_set_new.txt`**（UTF-8）：

```json
{
  "36": ["login-card-double-Gtywl8", "Ozf92TxU Y4ijCbDB yBtmBy9d",
         "trust-login-switch-button uncheck", "r7j70rK2 M38h7w3V BBqC6Jfj", ...]
}
```

**读法**：`平台 ID → 一组 CSS 类名`。类名里带随机后缀（`login-card-double-`**`Gtywl8`**、`eK1Z2Sel`）—— 这是**平台侧为反爬而随机化的类名**。

**推断**：这份表是**页面状态探测器**的指纹库 —— 当目标页出现这些类名时，判定「登录页已渲染 / 账号已失效」等状态。`_new` 版是更新后的快照。

**意义**：说明融媒宝的账号失效检测**依赖硬编码的类名指纹**，而平台随时会换后缀 ⇒ **这是一种注定需要持续维护的方案**。mulpub 若做同类检测，应优先用**语义特征**（文案/结构）而非混淆类名。

### 3.8 爆文库 / 热榜 / 媒体活动分类 ★★★

四个按平台切分的目录：

| 目录 | 文件数 | 内容 | 样例 |
|---|---|---|---|
| `explosivearticle/` | 17 | 图文爆款分类名 | `baijia.txt`: `["全部","生活","社会","科学","科技",…]` |
| `explosivevideo/` | 17 | 视频爆款分类名 | 同上（含 douyin/kuaishou/xigua/huoshan 等） |
| `mediahot/` | 4 | 热榜分类（**带 id**） | `qiecat.txt`: `[{"id":"0","name":"全部"},{"id":"10001","name":"社会"},…]` |
| `mediaactivity/` | 4 | 媒体活动分类（id 可为**逗号列表**） | `{"id":"3,4,5","name":"腾讯看点"}` |

**覆盖的平台组合不同**：`explosivearticle` 含 `jianshu/kelai/kuaizixun/sina/wifimasterkey`（图文向），`explosivevideo` 含 `douyin/kuaishou/xigua/huoshan/bilibili`（视频向）。**这说明产品对「爆文」和「爆款视频」用的是两套独立平台集**。

`mediaactivity` 的 `{"id":"3,4,5","name":"腾讯看点"}` 是**一个名字映射多个平台 ID** —— 实现时不能假设 id 是单值。

### 3.9 搜索引擎清单 ★★

**`deepsearchercat.txt`**（3.5 KB，GBK，73 行）—— 按主题分组、带 `%s` 占位符的搜索 URL 模板：

```json
{
   "综合" : [
      {"name":"百度搜索","url":"https://www.baidu.com/s?wd=%s"},
      {"name":"360搜索","url":"https://www.so.com/s?q=%s"},
      {"name":"搜狗搜索","url":"https://www.sogou.com/web?query=%s"},
      {"name":"必应搜索","url":"https://cn.bing.com/search?q=%s"},
      {"name":"中国搜索","url":"http://www.chinaso.com/search/pagesearch.htm?q=%s"}
   ],
   "知识" : [
      {"name":"百度知道","url":"https://zhidao.baidu.com/search?word=%s"},
      {"name":"知乎","url":"https://www.zhihu.com/search?type=content&q=%s"},
      {"name":"百度百科","url":"https://baike.baidu.com/search/none?word=%s"},
      ...
   ],
```

**这就是「多源聚合搜索」的现成源清单**（mulpub 已有 ContentIntelligence 的 Reddit/HN/GitHub 三源）。**分组维度是「综合/知识/…」**，可对照 mulpub 的选题调研功能。

**注意**：全部是**中文搜索引擎**，且多为 HTML 抓取（无官方 API）—— 复用时要考虑反爬与合规。

### 3.10 数据导出模板 ★★

**`doc/*.csv`** 6 个文件 —— **导出功能的列定义 + 真实示例数据**：

| 文件 | 列 |
|---|---|
| `内容数据.csv` | 账号,备注,平台,标题,类型,推荐,阅读（播放）,评论,分享,收藏,点赞,发布时间,链接 |
| `平台数据.csv` | 平台,收益,推荐量,阅读（播放）量,评论数,点赞数,涨粉数,更新时间 |
| `平台数据详情.csv` | 时间,收益,推荐量,播放（阅读）量,评论量,点赞量,涨粉量（**按日**，38 行） |
| `数据总览.csv` | 账号,备注,平台,总收益,昨日收益,总播放量,昨日播放量,粉丝数,昨日评论,昨日点赞,昨日涨粉,更新时间 |
| `账号数据.csv` | 时间,收益,推荐量,播放（阅读）量,评论量,点赞量,涨粉量（带 `总计` 行） |
| `账号详情-内容数据.csv` | 标题,类型,推荐,阅读（播放）,评论,分享,收藏,点赞,发布时间,链接 |

**这是产品数据模型的直接投影** —— 三类实体（**账号 / 平台 / 内容**）× 两类粒度（**汇总 / 按日或按条**）。

> ⚠️ **隐私观察**：示例数据**不是占位的**。`内容数据.csv` 里留着作者自己账号的真实抖音分享链接 `https://www.iesdouyin.com/share/video/7470053959021940004/`，`数据总览.csv` 里有哔哩哔哩账号的真实数据（粉丝 11、总播放 7850）。**发布产品里夹带开发者的真实账号数据**，属打包卫生问题。本报告**不复现**账号名（原文已部分脱敏为 `犀**`、`z**`）。

### 3.11 OEM / 渠道定制文案 ★★

三组文案各有多个渠道变体：

| 家族 | 变体 |
|---|---|
| `new_user_guide` | 无后缀、`_oem`、`_ym`、`_tjj888` |
| `common_question` | 无后缀、`_oem`、`_ym` |
| `software_notify` | 无后缀、`_oem`、`_ym`（**三份 125 B 完全相同**） |

**含义**：同一套「新手引导 / 常见问题 / 软件公告」按**发行渠道**（OEM 贴牌、`ym`、`tjj888`）出多份。`software_notify` 三份字节相同 ⇒ 该渠道差异只体现在另外两家族。

**对 mulpub 的启发**：若要做贴牌发行，文案外置 + 渠道后缀是**已在生产验证的轻量做法**（比把渠道判断写进代码简单）。

### 3.12 加密的敏感词库 ★（不可直读）

**`sensitivelibrary.txt`**（793 KB / 812,056 B）—— 判定结果：

| 判据 | 值 |
|---|---|
| 前 64 KB 中 base64 字符集占比 | **100.00%** |
| 空白字符占比 | **0.00%** |
| 换行数 | **0** |
| 首 80 字节 hex | `4f3847316d385a34…`（`O8G1m8Z4…`） |

**结论**：**不是明文词库**，而是**整体 base64 / 加密载荷**（无换行、零空白）。词条需解密后才能取得。

**本报告不尝试破解**。可作为一条结论记录：**融媒宝把敏感词库作为受保护资产**（对照：其他数据文件全是明文 JSON/txt，仅此一个被加密）。

**对 mulpub**：若需要敏感词能力，**不应**指望从这份数据取词；合规词库应走正版来源。

---

## 4. 与 mulpub 的对照

### 4.1 平台覆盖对照（mulpub 现有 15 个平台）

| mulpub 平台 | 本数据集是否覆盖 | 对应文件 |
|---|---|---|
| douyin | ✅ | `douyin*`（**带 `code`**） |
| xiaohongshu | ❌ | — |
| kuaishou | ✅ | `kuaishou*` + `kuaichuan*` |
| bilibili | ✅ | `bilibili*` |
| tencent_video | ✅ | `tencent*`（视频） |
| weibo | ✅ | `weibo*` |
| zhihu | ✅ | `zhihu*` |
| youtube / tiktok / twitter / instagram / facebook | ❌ | 全无（该产品不做海外） |
| baijiahao | ✅ | `baijia*` |
| toutiao | ✅ | `toutiao*` + `huitoutiao*` + `qqkandian*` |
| wechat_mp | ✅ | `weixin*` |

**本数据集独有、mulpub 未覆盖的平台 20 个**：`acfun`、`aiqiyimedia`、`baihua`、`dafeng`、`dayu`、`dongfang`、`kaidi`、`meipai`、`miaopaimedia`、`qie`、`qqkantiao`、`qutoutiao`、`sinakandian`、`sogou`、`sohu`、`sohumedia`、`tencent`、`wangyi`、`wutiao`、`yidian`。

**两边都不含小红书** —— 融媒宝的分类集里确实没有 `xhs`/`xiaohongshu` 字样（已检索确认）。这与另一份拆解中「小红书在本产品里走不同链路」的观察一致。

### 4.2 可直接复用的部分

| 优先级 | 内容 | 理由 | 移植成本 |
|---|---|---|---|
| **P0** | **带 ID 的分类表**（抖音 `code`、百家号中文 id、微博 16 位数字、网易 `VC…`、大风 24 位 hex 等，共 26 个文件） | mulpub 走 API 发布时**多数平台需要平台侧分类 ID**；这是最难自行收集、且最容易过期的一类数据 | 低（解析 5 种形态 + 落成 mulpub 的 `platforms.yaml` 结构） |
| **P1** | **平台指标能力矩阵**（`mediadatamgr.ini`） | mulpub 做发布后数据回收时，**能力边界必须显式**，否则会编造拿不到的数 | 低（11 指标 × ~30 平台的布尔矩阵） |
| **P2** | **多源搜索清单**（`deepsearchercat.txt`） | mulpub 已有 ContentIntelligence，可补中文源；但纯 HTML 抓取有反爬/合规成本 | 中 |
| **P2** | **数据模型列定义**（`doc/*.csv`） | 三类实体 × 两粒度的导出结构，可作 mulpub 数据模块的设计参照 | 低（只读结构） |
| **P3** | **看板 URL 表 / 采集注入规则 / 类名指纹** | 属 RPA 数据回收能力，与 mulpub 的 API 优先路线不同；且 URL/类名**必然过期** | 高（需持续维护） |

### 4.3 明确**不建议**照搬的部分

1. **类名指纹方案**（3.7）—— 依赖平台随机化类名，注定持续返工。mulpub 应走语义特征。
2. **硬编码的平台 ID 表**（`mediadatamgr.ini` / `media_url_list.txt` 用数字平台 ID `1,3,4,5,6,7,8,10,11,12,15,16,17,19,20,21,22,23…`）—— 该产品用**整型内部 ID** 指代平台；mulpub 用字符串 slug（`douyin`/`weibo`），**更可读也更抗重排**。直接抄会把 mulpub 拖回易错的数字映射。
3. **敏感词库**（3.12）—— 加密且不可直读；合规词库应走正版来源。

---

## 5. 分析过程中的自我纠错（如实记录）

**本次分析中我的判断被证据推翻了 4 次**，全部来自「按一种形态写解析器，然后当成通用」：

| # | 我最初的判断 | 证据 | 纠正 |
|---|---|---|---|
| 1 | 「`.txt` 是文本，直接读即可」 | `media_url_list.txt` 注释渲染成 `//΢⟨U+FFFD×1⟩Ź⟨U+FFFD×2⟩ں⟨U+FFFD×1⟩` | **78/130 文件是 GBK**，必须显式解码 |
| 2 | 「分类映射是 `{id,name,cates}` 一种形态」 | `douyin` 是 `{code,text}`、`baijia` 是 `{child,id,name}`、`sohu` 是 `{childrenCate,level,parentCate,title,titles}` | **至少 5 种形态**，必须形态无关遍历 |
| 3 | 「v2 的形态无关遍历已覆盖全部」 | 36 个 `*subcategort.txt` 判为未识别 | 还有一种**「键即分类名」**形态（`{名:[名…]}`） |
| 4 | 「剩下的 14 个是异常文件」 | `sohusubcategort.txt` 是 `{"新闻资讯":null, …}` | 值可以是 **`null`**（一级无二级），不是异常 |

**共同根因**：把「我见过的形态」当成「全部形态」，且解析器**静默返回 0** 而不报错 —— 于是错误表现为**数字偏小**而不是**红灯**。

**沉淀的判据（已写进 v2 脚本）**：**解析器必须对无法识别的形态 fail-loud**，把未识别文件单列出来；「0 个节点」必须区分「真的是 0」与「我没看懂」。

**数字影响**：v1 报 3,838 节点 → 终版 **11,623 节点**，**v1 少算 67%**。若不复核，这份报告会把数据集的价值严重低估。

---

## 6. 未闭合的边界（不假装已查清）

1. **`sensitivelibrary.txt` 未解密** —— 只判定其形态（base64/加密），**词条内容未知**。本报告不尝试破解。
2. **`comment_media_js.json` 只看到规则骨架** —— 具体注入的 JS 内容不在该文件内（应内嵌在宿主代码），**未定位**。
3. **平台内部整型 ID → 平台名的映射未完全确认** —— `mediadatamgr.ini` / `media_url_list.txt` 用 ID（1/3/4/5/6/7/8/10/11/12/15/16/17/19/20/21/22/23），部分有 `#注释` 佐证（1=微信、3=头条、4=百家、5=一点、6=企鹅、7=大鱼、8=搜狐、10=微博、11=网易、12=知乎、15=新浪看点、16=东方号、17=大风号、19=快传号、20=爱奇艺、21=腾讯视频、22=搜狐视频、23=哔哩哔哩），**其余 ID 未确认**。
4. **该数据集是打包时冻结的快照**（`data.zip` mtime **2026-07-14 21:34**）—— 平台分类会变，**复用前需重新校验**。这也是「分类 ID 必须能热更新、不能硬编码进 mulpub 源码」的直接理由。
5. **未验证这些 ID 在当前平台侧是否仍然有效** —— 本报告只证明「融媒宝打包时它们是这些值」，**未做任何联网校验**。

---

## 7. 复现方式

```powershell
# 1. 解压（正确处理 GBK 文件名）
node D:\Data\projects\rea\analysis\extract-wemedia-datazip.cjs `
  "D:\Program Files (x86)\融媒宝\data.zip" `
  "D:\Data\projects\rea\analysis\wemedia-data-zip\data"

# 2. 编码判定 + 文件形态（78 GBK / 51 UTF-8 / 1 二进制）
node D:\Data\projects\rea\analysis\probe-wemedia-data-encoding.cjs `
  "D:\Data\projects\rea\analysis\wemedia-data-zip\data"

# 3. 分类体系统计（31 平台 / 11,623 节点 / 5 种形态）
node D:\Data\projects\rea\analysis\analyze-wemedia-taxonomy-v2.cjs `
  "D:\Data\projects\rea\analysis\wemedia-data-zip\data"

# 4. 其余文件形态（csv / ini / 注入规则 / 加密词库判定）
node D:\Data\projects\rea\analysis\probe-wemedia-data-misc.cjs `
  "D:\Data\projects\rea\analysis\wemedia-data-zip\data"
```

产出：`wemedia-data-zip/data/`（130 文件）、`_extract-manifest.json`（含原始文件名字节）、`_taxonomy-summary-v2.json`（31 平台结构统计 + 未识别清单）。

---

## 附：文件清单速查（按类型）

| 类型 | 数量 | 说明 |
|---|---|---|
| 分类映射 | 64 | 31 平台 × (图文/视频) × (map/sub)，5 种形态 |
| 爆文/爆款分类 | 34 | `explosivearticle/` 17 + `explosivevideo/` 17 |
| 热榜/活动分类 | 8 | `mediahot/` 4 + `mediaactivity/` 4 |
| 导出模板 CSV | 6 | `doc/`，含真实示例数据 |
| 引导/问答/公告 | 10 | 3 家族 × 渠道变体 |
| 数据接口表 | 1 | `media_url_list.txt`（252 行） |
| 指标能力矩阵 | 1 | `mediadatamgr.ini` |
| 采集注入规则 | 1 | `comment_media_js.json`（328 行） |
| 类名指纹 | 2 | `media_class_set{,_new}.txt` |
| 搜索源清单 | 1 | `deepsearchercat.txt` |
| 加密词库 | 1 | `sensitivelibrary.txt`（793 KB，不可直读） |
| 其他 | 1 | `hand.gif`（32 KB）、`_extract-manifest.json` |
