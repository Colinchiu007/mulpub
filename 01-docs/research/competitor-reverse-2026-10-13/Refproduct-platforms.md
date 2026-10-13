# 参考产品 36 平台配置全量

> 来源：`packages/main/dist/index.cjs`（webpack bundle，已压缩）
> 提取方式：定位每个 `class XxxAuthorizeConfig`，从其后 2500 字符内取 `authorizeUrl` / `entryUrl`

---

## 1. 平台配置表

| # | 类名 | 平台名 | authorizeUrl（登录页）| entryUrl（登录后入口）|
|---|---|---|---|---|
| 1 | `AI_DouBaoAuthorizeConfig` | AI_DouBao | https://www.doubao.com/chat/ | https://www.doubao.com/chat/ |
| 2 | `AiQiYiAuthorizeConfig` | AiQiYi | https://mp.iqiyi.com/ | https://mp.iqiyi.com/ |
| 3 | `AZhanAuthorizeConfig` | AZhan | https://www.acfun.cn/login/?returnUrl=http://member.acfun.cn%2F | https://member.acfun.cn/ |
| 4 | `BaiJiaHaoAuthorizeConfig` | BaiJiaHao | https://baijiahao.baidu.com/builder/theme/bjh/login | https://baijiahao.baidu.com/builder/rc/home |
| 5 | `BilibiliAuthorizeConfig` | Bilibili | https://passport.bilibili.com/login | https://member.bilibili.com/platform |
| 6 | `CheJiaHaoAuthorizeConfig` | CheJiaHao | https://account.autohome.com.cn/?backurl=https%3A%2F%2Fcreator.autohome.com.cn%2Fweb%2Fhome | https://creator.autohome.com.cn/web/home |
| 7 | `CSDNAuthorizeConfig` | CSDN | https://mp.csdn.net/ | https://mp.csdn.net/ |
| 8 | `DaYuHaoAuthorizeConfig` | DaYuHao | https://mp.dayu.com/ | https://mp.dayu.com/dashboard/index |
| 9 | `DeWuAuthorizeConfig` | DeWu | https://creator.dewu.com/login | https://creator.dewu.com/release |
| 10 | `DouBanAuthorizeConfig` | DouBan | https://accounts.douban.com/passport/login?redir=https://www.douban.com/ | https://www.douban.com/ |
| 11 | `DouYinAuthorizeConfig` | DouYin | https://creator.douyin.com/ | https://creator.douyin.com/creator-micro/home |
| 12 | `DuoDuoShiPinAuthorizeConfig` | DuoDuoShiPin | https://live.pinduoduo.com/login/anchor | https://live.pinduoduo.com/n-creator/live/home |
| 13 | `FengWangAuthorizeConfig` | FengWang | http://o.fun.tv/account/login/ | http://o.fun.tv/account/home |
| 14 | `JianShuAuthorizeConfig` | JianShu | https://www.jianshu.com/sign_in | https://www.jianshu.com/ |
| 15 | `KuaiChuanHaoAuthorizeConfig` | KuaiChuanHao | https://kuaichuan.360kuai.com/#/console/dashboard | https://kuaichuan.360kuai.com/#/console/dashboard |
| 16 | `KuaiShouAuthorizeConfig` | KuaiShou | https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts%3FfollowUrl%3Dhttps%253A%252F%252Fcp.kuaishou.com%252Fprofile%26setRootDomain%3Dtrue | https://cp.kuaishou.com/profile |
| 17 | `MeiPaiAuthorizeConfig` | MeiPai | https://www.meipai.com/medias/video_convert_list | https://www.meipai.com/medias/video_convert_list |
| 18 | `MeiYouAuthorizeConfig` | MeiYou | https://mp.meiyou.com/page/sso/login | https://mp.meiyou.com/home |
| 19 | `PiPiXiaAuthorizeConfig` | PiPiXia | https://pipix.com/ | https://pipix.com/mp/upload |
| 20 | `QiEHaoAuthorizeConfig` | QiEHao | https://om.qq.com/userAuth/index | https://om.qq.com/main |
| 21 | `SouHuHaoAuthorizeConfig` | SouHuHao | https://mp.sohu.com/mpfe/v4/login | https://mp.sohu.com/mpfe/v4/contentManagement/first/page |
| 22 | `SouHuShiPinAuthorizeConfig` | SouHuShiPin | https://tv.sohu.com/s/center/index.html#/ | https://tv.sohu.com/s/center/index.html#/ |
| 23 | `TengXunShiPinAuthorizeConfig` | TengXunShiPin | https://mp.v.qq.com/ | https://mp.v.qq.com/ |
| 24 | `TengXunWeiShiAuthorizeConfig` | TengXunWeiShi | https://h5.weishi.qq.com/weishi/account/login?r_url=http%3A%2F%2Fmedia.weishi.qq.com%2F | https://media.weishi.qq.com/ |
| 25 | `TouTiaoHaoAuthorizeConfig` | TouTiaoHao | https://mp.toutiao.com/auth/page/login | https://mp.toutiao.com/profile_v4 |
| 26 | `WangYiHaoAuthorizeConfig` | WangYiHao | https://mp.163.com/login.html | https://mp.163.com/subscribe_v4/index.html#/ |
| 27 | `WeiXinGongZhongHaoAuthorizeConfig` | WeiXinGongZhongHao | https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome | https://mp.weixin.qq.com/cgi-bin/home |
| 28 | `WeiXinShiPinHaoAuthorizeConfig` | WeiXinShiPinHao | https://channels.weixin.qq.com/login.html | https://channels.weixin.qq.com/platform |
| 29 | `WifiWanNengYaoShiAuthorizeConfig` | WifiWanNengYaoShi | https://mp.lsttnews.com/index.html#/login | https://mp.lsttnews.com/index.html#/home |
| 30 | `XiaoHongShuAuthorizeConfig` | XiaoHongShu | https://creator.xiaohongshu.com/login | https://creator.xiaohongshu.com/new/home |
| 31 | `XiaoHongShuShangJiaHaoAuthorizeConfig` | XiaoHongShuShangJiaHao | https://customer.xiaohongshu.com/login?service=https://ark.xiaohongshu.com/app-system/home | https://ark.xiaohongshu.com/app-system/home |
| 32 | `XinLangWeiBoAuthorizeConfig` | XinLangWeiBo | https://passport.weibo.com/sso/signin | https://me.weibo.com/ |
| 33 | `XueQiuHaoAuthorizeConfig` | XueQiuHao | https://xueqiu.com/account/login?url=https://mp.xueqiu.com | https://mp.xueqiu.com/ |
| 34 | `YiCheHaoAuthorizeConfig` | YiCheHao | https://i.yiche.com/authenservice/login.html?returnurl=https://mp.yiche.com/ | https://mp.yiche.com/ |
| 35 | `YiDianHaoAuthorizeConfig` | YiDianHao | https://mp.yidianzixun.com/ | https://mp.yidianzixun.com/ |
| 36 | `ZhiHuAuthorizeConfig` | ZhiHu | https://www.zhihu.com/signin?next=%2Fcreator | https://www.zhihu.com/creator |

**共 36 个平台。**

---

## 2. 各平台是否有自定义登录判定

| 平台 | 自定义 `waitForLoginFinish` | 需处理 session cookie |
|---|---|---|
| AI_DouBao | — | — |
| AiQiYi | — | ✅ 是 |
| AZhan | — | — |
| BaiJiaHao | — | ✅ 是 |
| Bilibili | — | ✅ 是 |
| CheJiaHao | — | — |
| CSDN | — | — |
| DaYuHao | — | ✅ 是 |
| DeWu | — | — |
| DouBan | — | — |
| DouYin | ✅ 有 | — |
| DuoDuoShiPin | — | — |
| FengWang | — | — |
| JianShu | — | — |
| KuaiChuanHao | — | — |
| KuaiShou | — | ✅ 是 |
| MeiPai | — | — |
| MeiYou | — | — |
| PiPiXia | — | — |
| QiEHao | — | ✅ 是 |
| SouHuHao | — | ✅ 是 |
| SouHuShiPin | — | — |
| TengXunShiPin | — | — |
| TengXunWeiShi | — | ✅ 是 |
| TouTiaoHao | — | ✅ 是 |
| WangYiHao | ✅ 有 | ✅ 是 |
| WeiXinGongZhongHao | — | — |
| WeiXinShiPinHao | — | ✅ 是 |
| WifiWanNengYaoShi | — | — |
| XiaoHongShu | — | ✅ 是 |
| XiaoHongShuShangJiaHao | — | — |
| XinLangWeiBo | — | ✅ 是 |
| XueQiuHao | — | — |
| YiCheHao | — | — |
| YiDianHao | — | — |
| ZhiHu | — | ✅ 是 |

> 有自定义 `waitForLoginFinish` 的平台 = 该平台**不能**用通用 URL 判定登录，需要平台特定的探测逻辑。

---

## 3. 平台域名分布

| 域名 | 出现次数 |
|---|---:|
| `www.doubao.com` | 2 |
| `mp.iqiyi.com` | 2 |
| `baijiahao.baidu.com` | 2 |
| `mp.csdn.net` | 2 |
| `mp.dayu.com` | 2 |
| `creator.dewu.com` | 2 |
| `creator.douyin.com` | 2 |
| `live.pinduoduo.com` | 2 |
| `o.fun.tv` | 2 |
| `www.jianshu.com` | 2 |
| `kuaichuan.360kuai.com` | 2 |
| `www.meipai.com` | 2 |
| `mp.meiyou.com` | 2 |
| `pipix.com` | 2 |
| `om.qq.com` | 2 |
| `mp.sohu.com` | 2 |
| `tv.sohu.com` | 2 |
| `mp.v.qq.com` | 2 |
| `mp.toutiao.com` | 2 |
| `mp.163.com` | 2 |
| `mp.weixin.qq.com` | 2 |
| `channels.weixin.qq.com` | 2 |
| `mp.lsttnews.com` | 2 |
| `creator.xiaohongshu.com` | 2 |
| `mp.yidianzixun.com` | 2 |
| `www.zhihu.com` | 2 |
| `www.acfun.cn` | 1 |
| `member.acfun.cn` | 1 |
| `passport.bilibili.com` | 1 |
| `member.bilibili.com` | 1 |
| `account.autohome.com.cn` | 1 |
| `creator.autohome.com.cn` | 1 |
| `accounts.douban.com` | 1 |
| `www.douban.com` | 1 |
| `passport.kuaishou.com` | 1 |
| `cp.kuaishou.com` | 1 |
| `h5.weishi.qq.com` | 1 |
| `media.weishi.qq.com` | 1 |
| `customer.xiaohongshu.com` | 1 |
| `ark.xiaohongshu.com` | 1 |
| `passport.weibo.com` | 1 |
| `me.weibo.com` | 1 |
| `xueqiu.com` | 1 |
| `mp.xueqiu.com` | 1 |
| `i.yiche.com` | 1 |
| `mp.yiche.com` | 1 |

---

## 4. 全部 URL（去重）

共 **64** 个唯一 URL：

```
http://o.fun.tv/account/home
http://o.fun.tv/account/login/
https://account.autohome.com.cn/?backurl=https%3A%2F%2Fcreator.autohome.com.cn%2Fweb%2Fhome
https://accounts.douban.com/passport/login?redir=https://www.douban.com/
https://ark.xiaohongshu.com/app-system/home
https://baijiahao.baidu.com/builder/rc/home
https://baijiahao.baidu.com/builder/theme/bjh/login
https://channels.weixin.qq.com/login.html
https://channels.weixin.qq.com/platform
https://cp.kuaishou.com/profile
https://creator.autohome.com.cn/web/home
https://creator.dewu.com/login
https://creator.dewu.com/release
https://creator.douyin.com/
https://creator.douyin.com/creator-micro/home
https://creator.xiaohongshu.com/login
https://creator.xiaohongshu.com/new/home
https://customer.xiaohongshu.com/login?service=https://ark.xiaohongshu.com/app-system/home
https://h5.weishi.qq.com/weishi/account/login?r_url=http%3A%2F%2Fmedia.weishi.qq.com%2F
https://i.yiche.com/authenservice/login.html?returnurl=https://mp.yiche.com/
https://kuaichuan.360kuai.com/#/console/dashboard
https://live.pinduoduo.com/login/anchor
https://live.pinduoduo.com/n-creator/live/home
https://me.weibo.com/
https://media.weishi.qq.com/
https://member.acfun.cn/
https://member.bilibili.com/platform
https://mp.163.com/login.html
https://mp.163.com/subscribe_v4/index.html#/
https://mp.csdn.net/
https://mp.dayu.com/
https://mp.dayu.com/dashboard/index
https://mp.iqiyi.com/
https://mp.lsttnews.com/index.html#/home
https://mp.lsttnews.com/index.html#/login
https://mp.meiyou.com/home
https://mp.meiyou.com/page/sso/login
https://mp.sohu.com/mpfe/v4/contentManagement/first/page
https://mp.sohu.com/mpfe/v4/login
https://mp.toutiao.com/auth/page/login
https://mp.toutiao.com/profile_v4
https://mp.v.qq.com/
https://mp.weixin.qq.com/cgi-bin/home
https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome
https://mp.xueqiu.com/
https://mp.yiche.com/
https://mp.yidianzixun.com/
https://om.qq.com/main
https://om.qq.com/userAuth/index
https://passport.bilibili.com/login
https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts%3FfollowUrl%3Dhttps%253A%252F%252Fcp.kuaishou.com%252Fprofile%26setRootDomain%3Dtrue
https://passport.weibo.com/sso/signin
https://pipix.com/
https://pipix.com/mp/upload
https://tv.sohu.com/s/center/index.html#/
https://www.acfun.cn/login/?returnUrl=http://member.acfun.cn%2F
https://www.douban.com/
https://www.doubao.com/chat/
https://www.jianshu.com/
https://www.jianshu.com/sign_in
https://www.meipai.com/medias/video_convert_list
https://www.zhihu.com/creator
https://www.zhihu.com/signin?next=%2Fcreator
https://xueqiu.com/account/login?url=https://mp.xueqiu.com
```
