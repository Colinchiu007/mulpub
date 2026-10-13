# MediaTaskMgr.dll 字符串清单分析

> 来源：REA `search .{4,} --kind strings` on `MediaTaskMgr.dll`
> 字符串总数：**13115**
> 生成时间：2026-10-13T02:55:34.460Z

---

## 分类统计

| 类别 | 数量 |
|---|---|
| 任务类型（task registry） | 44 |
| ffmpeg 操作 | 22 |
| 视频处理 | 690 |
| 音频处理 | 77 |
| 图片处理 | 735 |
| 平台名 | 1027 |
| HTTP/API | 2082 |
| 文件/路径 | 2016 |
| 配置项 | 1 |
| 日志/错误 | 809 |
| 线程/同步 | 173 |
| 内存/资源 | 278 |
| COM/接口 | 8 |
| SQL/存储 | 217 |
| （未分类） | 8182 |

---

## ⭐ 任务类型注册表（原生任务调度器的核心）

共 227 条含 "task" 的字符串：

```
&taskid=
..\WEMedia\ArticleCheckRiskTaskEx.cpp
..\WEMedia\CheckIncomeStateTask.cpp
..\WEMedia\GetHotArticleTask.cpp
..\WEMedia\GetHotTopicTask.cpp
..\WEMedia\GetMediaActivityTask.cpp
..\WEMedia\GetUserInfoTask.cpp
..\WEMedia\GetVipInfoTask.cpp
..\WEMedia\ParseWebArticleTask.cpp
..\WEMedia\SearchGifTask.cpp
..\WEMedia\SearchImgTask.cpp
..\WEMedia\SyncArticleTask.cpp
..\WEMedia\SyncDynamicTask.cpp
..\WEMedia\SyncSmallVideoTask.cpp
..\WEMedia\SyncVideoTask.cpp
.?AV?$_Ref_count@VArticleCheckRiskTask@@@tr1@std@@
.?AV?$_Ref_count@VBaseAsyncTask@@@tr1@std@@
.?AV?$_Ref_count@VCAddAutoReplyPolicyTask@@@tr1@std@@
.?AV?$_Ref_count@VCBaseTask@@@tr1@std@@
.?AV?$_Ref_count@VCChangeAutoReplyPolicyStatuTask@@@tr1@std@@
.?AV?$_Ref_count@VCDeleteAuthAccountListTask@@@tr1@std@@
.?AV?$_Ref_count@VCDeleteAutoReplyPolicyTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetAccountContentListTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetAuthAccountInfoTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetAuthAccountListTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetAuthAccountListUnReadCountTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetAuthAccountStatuTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetAutoReplyPolicyListTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetCommentReplyTimesTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetContentCommentListTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetContentCommentReplyListTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetMediaCommentTask@@@tr1@std@@
.?AV?$_Ref_count@VCGetUserInfoTask@@@tr1@std@@
.?AV?$_Ref_count@VCReplyCommentTask@@@tr1@std@@
.?AV?$_Ref_count@VCTaskManager@@@tr1@std@@
.?AV?$_Ref_count@VCheckIncomeStateTask@@@tr1@std@@
.?AV?$_Ref_count@VCheckLoginStateTask@@@tr1@std@@
.?AV?$_Ref_count@VCheckVerifyStateTask@@@tr1@std@@
.?AV?$_Ref_count@VDeleteMediaContentTask@@@tr1@std@@
.?AV?$_Ref_count@VDouyinGetMusicListTask@@@tr1@std@@
.?AV?$_Ref_count@VDouyinGetPositionTask@@@tr1@std@@
.?AV?$_Ref_count@VFFMpegFuncTask@@@tr1@std@@
.?AV?$_Ref_count@VGetHotArticleTask@@@tr1@std@@
.?AV?$_Ref_count@VGetHotTopicTask@@@tr1@std@@
.?AV?$_Ref_count@VGetLaveRightTimesTask@@@tr1@std@@
.?AV?$_Ref_count@VGetMediaActivityTask@@@tr1@std@@
.?AV?$_Ref_count@VGetMediaAuthorContentListTask@@@tr1@std@@
.?AV?$_Ref_count@VGetVipInfoTask@@@tr1@std@@
.?AV?$_Ref_count@VMediaGetMusicListTask@@@tr1@std@@
.?AV?$_Ref_count@VMediaGetPositionTask@@@tr1@std@@
.?AV?$_Ref_count@VMediaGetShopListTask@@@tr1@std@@
.?AV?$_Ref_count@VParseMediaAuthorInfoTask@@@tr1@std@@
.?AV?$_Ref_count@VParseWebArticleTask@@@tr1@std@@
.?AV?$_Ref_count@VSearchGifTask@@@tr1@std@@
.?AV?$_Ref_count@VSearchImgTask@@@tr1@std@@
.?AV?$_Ref_count@VSyncArticleTask@@@tr1@std@@
.?AV?$_Ref_count@VSyncDynamicTask@@@tr1@std@@
.?AV?$_Ref_count@VSyncSmallVideoTask@@@tr1@std@@
.?AV?$_Ref_count@VSyncVideoTask@@@tr1@std@@
.?AVArticleCheckRiskTask@@
.?AVBaseAsyncTask@@
.?AVCAddAutoReplyPolicyTask@@
.?AVCBaseTask@@
.?AVCChangeAutoReplyPolicyStatuTask@@
.?AVCDeleteAuthAccountListTask@@
.?AVCDeleteAutoReplyPolicyTask@@
.?AVCGetAccountContentListTask@@
.?AVCGetAuthAccountInfoTask@@
.?AVCGetAuthAccountListTask@@
.?AVCGetAuthAccountListUnReadCountTask@@
.?AVCGetAuthAccountStatuTask@@
.?AVCGetAutoReplyPolicyListTask@@
.?AVCGetCommentReplyTimesTask@@
.?AVCGetContentCommentListTask@@
.?AVCGetContentCommentReplyListTask@@
.?AVCGetMediaCommentTask@@
.?AVCGetUserInfoTask@@
.?AVCReplyCommentTask@@
.?AVCTaskManager@@
.?AVCheckIncomeStateTask@@
.?AVCheckLoginStateTask@@
.?AVCheckVerifyStateTask@@
.?AVDeleteMediaContentTask@@
.?AVDouyinGetMusicListTask@@
.?AVDouyinGetPositionTask@@
.?AVFFMpegFuncTask@@
.?AVGetHotArticleTask@@
.?AVGetHotTopicTask@@
.?AVGetLaveRightTimesTask@@
.?AVGetMediaActivityTask@@
.?AVGetMediaAuthorContentListTask@@
.?AVGetVipInfoTask@@
.?AVITaskMgr@@
.?AVMediaGetMusicListTask@@
.?AVMediaGetPositionTask@@
.?AVMediaGetShopListTask@@
.?AVMediaTaskMgr@@
.?AVParseMediaAuthorInfoTask@@
.?AVParseWebArticleTask@@
.?AVSearchGifTask@@
.?AVSearchImgTask@@
.?AVSyncArticleTask@@
.?AVSyncDynamicTask@@
.?AVSyncSmallVideoTask@@
.?AVSyncVideoTask@@
AddCheckIncomeStateData GetTask NULL
AddGetMediaCommentData GetTask NULL
CancelArticleInputSendCode GetTask NULL
CancelArticleScanWeixinQrCode GetTask NULL
CancelCheckIncomeStateDataTask GetTask NULL
CancelInputSendCode GetTask NULL
CancelSafetyVerity GetTask NULL
CancelUploadVideo GetTask NULL
CoTaskMemFree
DouyinGetPositionTask
FFMpegFuncTask.cpp
GetHotArticleTask ParseHotArticleResult Fail
GetHotArticleTask SogouWeixinGetArticle Fail
GetHotArticleTask SogouWeixinSearchArticle Fail
GetHotTopicTask GetToutiaoRedian Fail
GetHotTopicTask GetWeiboHotSearch Fail
GetHotTopicTask GetWeiboRedian Fail
GetHotTopicTask GetWeiboXinShiDai Fail
GetMediaTaskMgr
InitMediaTaskMgr
MediaGetPositionDataTask
MediaTaskMgr.cpp
MediaTaskMgr.dll
ParseWebArticleTask Get Content Fail url: %s, ret:%d
ParseWebArticleTask Parse360DocArticleContent Fail url: %s
ParseWebArticleTask ParseBaijiaArticleContent1 Fail url: %s
ParseWebArticleTask ParseDafengArticleContent Fail url: %s
ParseWebArticleTask ParseDafengArticleContent2 Fail url: %s
ParseWebArticleTask ParseDayuArticleContent Fail url: %s
ParseWebArticleTask ParseDongfangArticleContent Fail url: %s
ParseWebArticleTask ParseHuitoutiaoArticleContent Fail url: %s
ParseWebArticleTask ParseHuitoutiaoArticleContent2 Fail url: %s
ParseWebArticleTask ParseJianshuArticleContent Fail url: %s
ParseWebArticleTask ParseKuaichuanArticleContent Fail url: %s
ParseWebArticleTask ParseKuaichuanArticleContent2 Fail url: %s
ParseWebArticleTask ParseOtherArtcielContent Fail url: %s
ParseWebArticleTask ParseQQKandianArticleContent Fail url: %s
ParseWebArticleTask ParseQieArticleContent Fail url: %s
ParseWebArticleTask ParseQieArticleContent3 Fail url: %s
ParseWebArticleTask ParseQutoutiaoArticleContent Fail url: %s
ParseWebArticleTask ParseSinaKandianArticleContent2 Fail url: %s
ParseWebArticleTask ParseSouhuArticleContent Fail url: %s
ParseWebArticleTask ParseToutiaoArticleContent Fail url: %s
ParseWebArticleTask ParseWangyiArticleContent Fail url: %s
ParseWebArticleTask ParseWangyiArticleContent2 Fail url: %s
ParseWebArticleTask ParseWangyiArticleContent3 Fail url: %s
ParseWebArticleTask ParseWeiboArticleContent Fail url: %s
ParseWebArticleTask ParseWeixinArticleContent Fail url: %s
ParseWebArticleTask ParseYidianArticleContent Fail url: %s
ParseWebArticleTask _url empty
ParseWebArticleTask result empty
RefreshArticleSendCode GetTask NULL
RefreshSafetyVerityInfo GetTask NULL
RefreshSendCode GetTask NULL
SearchGifTask ParseJsonStr Fail
SearchGifTask ReadJsonValueObject data Fail
SearchGifTask ReadJsonValueObject list Fail
SearchGifTask SooGifSearchGif Fail
SearchGifTask dataList empty
SearchGifTask dataList not array
SearchImgTask BaiduImgSearchImg Fail
SearchImgTask ParseJsonStr Fail
SearchImgTask ReadJsonValueObject data Fail
SearchImgTask dataList empty
SearchImgTask dataList not array
SetArticleSendCodeData GetTask NULL
SetMediaTaskMgrPostMsgCallback
SetOepnUserCenterPageFlag GetTask NULL
SetParseArticleToutiaoData GetTask NULL
SetPublishContentParam GetTask NULL
SetSafetyVerityData GetTask NULL
SetSendCodeData GetTask NULL
SetTaskMgrIdleCallback
UnInitMediaTaskMgr
\MediaTaskMgrSync
\MediaTaskMgr_
associateTaskId
associateTasks
begin InitMediaTaskMgr.
begin UnInitMediaTaskMgr.
commercial_zhitask_bind_info
end InitMediaTaskMgr.
end UnInitMediaTaskMgr.
ffmpeg_task_from_video_auto_cut
ffmpeg_task_from_video_clip
ffmpeg_task_from_video_compress
ffmpeg_task_from_video_convert
ffmpeg_task_from_video_create_task_center
ffmpeg_task_from_video_cut
ffmpeg_task_from_video_extrat_subtitle
ffmpeg_task_from_video_merge
ffmpeg_task_from_video_mix
ffmpeg_task_from_video_snap
ffmpeg_task_from_video_speed
ffmpeg_task_from_video_split_audio
ffmpeg_task_from_video_subtitle
ffmpeg_task_from_video_to_gif
ffmpeg_task_from_video_watermark
https://baijiahao.baidu.com/author/eco/tasksystem/getArticleTaskDetailCms?task_type=2&task_id=
https://baijiahao.baidu.com/author/eco/tasksystem/getSquareMissionList
https://baijiahao.baidu.com/builder/rc/stores/newTask/articles?taskId=
https://baijiahao.baidu.com/builder/rc/stores/newTask/taskSquare?aside=0
https://mp.toutiao.com/profile_v4/activity/task-list
life_task_name
life_task_order_title
real remove task. 
relateTask
start ArticleCheckRiskTask
taskId
taskTag
taskTime
task_
task_end
task_id
task_name
task_origin
task_status
task_subtitle
task_tag
task_type
urlCdnTaskId
videoClipTaskId
```

## ffmpeg 相关（原生层直接操作）

共 22 条：

```
.?AV?$_Ref_count@UFFMpegFuncMsg@@@tr1@std@@
.?AV?$_Ref_count@VFFMpegFuncTask@@@tr1@std@@
.?AVFFMpegFuncTask@@
FFMpegFunc
FFMpegFuncTask.cpp
ffmpeg.exe
ffmpeg_task_from_video_auto_cut
ffmpeg_task_from_video_clip
ffmpeg_task_from_video_compress
ffmpeg_task_from_video_convert
ffmpeg_task_from_video_create_task_center
ffmpeg_task_from_video_cut
ffmpeg_task_from_video_extrat_subtitle
ffmpeg_task_from_video_merge
ffmpeg_task_from_video_mix
ffmpeg_task_from_video_snap
ffmpeg_task_from_video_speed
ffmpeg_task_from_video_split_audio
ffmpeg_task_from_video_subtitle
ffmpeg_task_from_video_to_gif
ffmpeg_task_from_video_watermark
ffmpegpath
```

## 视频处理相关（690 条，节选前 80）

```
 -acodec 
 -vcodec 
 -y -f concat -safe 0 -i "%s" %s "%s"
 -y -i "%s" -vcodec copy -acodec copy "%s"
 LZWSetupDecode
","x:cdn":"video.5tiao.net","x:imageUpdateUrl":"http://mp-server.wutiao.com/upFile/setVideoPic"}
%s: Encoder error: %s
%s: Invalid %stag "%s" (not supported by codec)
%satrim=duration=%.2f%s
%strim=duration=%.2f%s
&FileType=video&IsInner=1&SpaceName=
&FileType=video&IsInner=1&SpaceName=aweme&Version=2020-11-19&app_id=2906&s=
&amp;width=480&amp;height=270&amp;auto=0" type="video" width="480"></iframe></p>
..\WEMedia\SyncSmallVideoHelper.cpp
..\WEMedia\SyncSmallVideoTask.cpp
..\WEMedia\SyncVideoHelper.cpp
..\WEMedia\SyncVideoTask.cpp
.?AV?$_Ref_count@UBaijiaVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UBilibiliVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UDafengVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UDouyinVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UQQKandianVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@USohuVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@USyncVideoMsg@@@tr1@std@@
.?AV?$_Ref_count@UTencentVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UUploadVideoFileMsg@@@tr1@std@@
.?AV?$_Ref_count@UZhihuVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@VSyncSmallVideoTask@@@tr1@std@@
.?AV?$_Ref_count@VSyncVideoTask@@@tr1@std@@
.?AV?$codecvt@_WDH@std@@
.?AVSyncSmallVideoTask@@
.?AVSyncVideoTask@@
.?AVcodecvt_base@std@@
.?AVcodecvt_error_cat@?A0xc83bcab9@@
.?AVwindows_file_codecvt@@
.\crypto\evp\encode.c
.aliyuncs.com/video/
/api/galerie/large_file/v1/video/upload_complete
/api/galerie/large_file/v1/video/upload_init
/api/galerie/large_file/v1/video/upload_part
/v1/store_video
/video-content-input/video/
/zhihu-video-input/
?%s: decoder table overflow

??0?$codecvt@_WDH@std@@QAE@I@Z
??1?$codecvt@_WDH@std@@MAE@XZ
?_Getcat@?$codecvt@DDH@std@@SAIPAPBVfacet@locale@2@PBV42@@Z
?_Getcat@?$codecvt@_WDH@std@@SAIPAPBVfacet@locale@2@PBV42@@Z
?action=UpdateVideoUploadInfos&
?always_noconv@codecvt_base@std@@QBE_NXZ
?do_length@?$codecvt@_WDH@std@@MBEHABHPBD1I@Z
?id@?$codecvt@DDH@std@@2V0locale@2@A
?id@?$codecvt@_WDH@std@@2V0locale@2@A
?in@?$codecvt@DDH@std@@QBEHAAHPBD1AAPBDPAD3AAPAD@Z
?out@?$codecvt@DDH@std@@QBEHAAHPBD1AAPBDPAD3AAPAD@Z
?out@?$codecvt@_WDH@std@@QBEHAAHPB_W1AAPB_WPAD3AAPAD@Z
?params=%7B%22type%22%3A%22video%22%2C%22column%22%3Afalse%2C%22ugc%22%3Afalse%2C%22useImageX%22%3Atrue%7D
?unshift@?$codecvt@DDH@std@@QBEHAAHPAD1AAPAD@Z
CancelUploadVideo GetTask NULL
Cannot transcode due to multiple use of quantization table %d
CompassVideo
CompassVideoId
CompassVideoName
CompassVideoType
Concat
CxImageGIF::Encode cannot create animated GIFs with a true color frame. Use DecreaseBpp before
CxImageMNG::Decode cannot create image
CxImageRAW: missing raw decoder
Decode: Unknown or wrong format
DecodePointer
DouyinEndUploadVideo Fail
DumpModeDecode: Not enough data for scanline %d
Encode: Unknown format
EncodePointer
EndDecode
EndUploadVideo Fail
Fax3Decode1D
Fax3Decode2D
Fax3DecodeRLE
Fax4Decode
```

## 音频处理相关（77 条，节选前 80）

```
' volume='
..\WEMedia\GetMediaActivityTask.cpp
.?AV?$_Ref_count@UGetMediaActivityMsg@@@tr1@std@@
.?AV?$_Ref_count@UMediaActivityItem@@@tr1@std@@
.?AV?$_Ref_count@VGetMediaActivityTask@@@tr1@std@@
.?AVGetMediaActivityTask@@
.mp3
</mstts:express-as>
</prosody></voice></speak>
<audio height=
<audio height="0"
<mstts:backgroundaudio src='
<mstts:express-as 
<mstts:silence  type='Leading-exact' value='
<mstts:silence  type='Tailing-exact' value='
<prosody volume='
<speak version='1.0' xml:lang='zh-CN' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts'>
<voice name='
>wavelet_denoise()
AACompromise
EulliiggPPccuutteerreevvee;;iyrrcc;;rr;;rraavveepphhaa;;aaccrr;;dd;;gpoonn;;ff;;ppllyyFFuunnccttiioonn;;iinnggcsrr;;iiggnn;;iillddeemmllaucrkkssllaasshh;;vw;;ee
GetVolumeInformationW
GetXiaomixiangkanUserInfo Fail
GetXiaomixiangkanUserInfo Fail.
Wavelet denoising...

[0:a]volume=%.1f%s;
[audioatrim%d]
\baijiaactivityinfo.txt
_setjmp3
aaControls
ai_tts
amix=inputs=%d:duration=first:dropout_transition=0,dynaudnorm=f=500:g=30:p=0.8:m=20
amix=inputs=%d:duration=first:dropout_transition=0:normalize=0
audio
audio-16khz-32kbitrate-mono-mp3
audioFormat
audioLanguage
audioUrls
audio_address
audio_info0
audioduration
audiolist
audiopath
audios
begin AliTextToAudio.
begin AudioSilenceRemove.
begin MicrosoftTextConvertAudio.
begin MicrosoftTextToAudio.
begin TextToAudio.
bg_music_voice
deleteaudio
end AliTextToAudio.
end AudioSilenceRemove.
end MicrosoftTextConvertAudio.
end MicrosoftTextToAudio.
end TextToAudio.
ffmpeg_task_from_video_mix
ffmpeg_task_from_video_split_audio
http://public.17van.com/voice/MicrosoftToken
http://public.17van.com/voice/Synthetic
https://chinaeast2.tts.speech.azure.cn/cognitiveservices/v1
https://interface.17van.com/voice/rmbDuration
https://interface.17van.com/voice/rmbGetToken
https://nls-gateway.cn-shanghai.aliyuncs.com/rest/v1/tts/async
https://om.qq.com/mstatistic/ommixin/GetArticleReadpvStatistic
https://om.qq.com/mstatistic/ommixin/GetVideoPlayvvStatistic
multipart/mixed; boundary=2067456weiboPro
share_voice_id0
startTs
video_good_voice
voice
voicerole
voicestyle
voicestyledegree
volume
volume=%.1f
{"audio_infos":[{"audio_id":"","appmsg_album_info":{"id":"","title":""}}]}
```

## 图片处理相关（733 条，节选前 80）

```
    with %d x %d thumbnail image
  JPEG Table Data: <present>, %lu bytes

  JPEG Tables: (%lu bytes)

 USING COVERING INDEX 
 data-bjh-cover="https://b0.bdstatic.com/topic/server/1/5e211532c3ed.jpg" data-bjh-src="https://m.baidu.com/tc?w_qd=
 data-image="
!custom.jpg
" data-image-height="
" data-image-width="
","x:cdn":"video.5tiao.net","x:imageUpdateUrl":"http://mp-server.wutiao.com/upFile/setVideoPic"}
"><img src="
"nsImageResaveSign":"
"nsImageUploadSign":"
"nsImgCutSign":"
"nsOutsiteImgUploadSign":"
%s: Must set "ImageWidth" before writing data
%s: You must link dcraw with libjpeg!!

%u BitsPerSample not allowed for JPEG
,"cover_height":
,"cover_type":"upload"}
-i "%s" -f image2 -y -frames 1  "%s"
-i "%s" -s %s -f image2 -y -frames 1  "%s"
-vf crop=%d:%d:%d:%d
-y -ss %s -i "%s" %s -f image2 %s "%s"
..\WEMedia\SearchImgTask.cpp
.?AV?$_Ref_count@USearchImgItem@@@tr1@std@@
.?AV?$_Ref_count@USearchImgMsg@@@tr1@std@@
.?AV?$_Ref_count@USyncCoverImgMsg@@@tr1@std@@
.?AV?$_Ref_count@USyncImgData@@@tr1@std@@
.?AV?$_Ref_count@USyncImgFormatData@@@tr1@std@@
.?AV?$_Ref_count@USyncImgMsg@@@tr1@std@@
.?AV?$_Ref_count@VCxImage@@@tr1@std@@
.?AV?$_Ref_count@VSearchImgTask@@@tr1@std@@
.?AVCxImage@@
.?AVCxImageBMP@@
.?AVCxImageGIF@@
.?AVCxImageICO@@
.?AVCxImageJAS@@
.?AVCxImageJPG@@
.?AVCxImageMNG@@
.?AVCxImagePCX@@
.?AVCxImagePNG@@
.?AVCxImageRAW@@
.?AVCxImageSKA@@
.?AVCxImageTGA@@
.?AVCxImageTIF@@
.?AVCxImageWBMP@@
.?AVCxImageWMF@@
.?AVSearchImgTask@@
.JPEG
.WEBP
.jpeg
.jpg
.png
.png_tmp
.webp
.xximg
/ex/kandian/image/toinner?token=
/v3/store_image
0123456789ABCDEFlibpng error: %s

<!--{img:
<a class="img-wrap"
<a class="wrap-img"
<div class="exeditor-image-card" data-widget="image" data-src="
<div type="image"
<figure class="img-box" contenteditable="false">
<figure class="section img">
<img src=
<img src="
<img src="//
<img src="https://
??1CxImage@@UAE@XZ
??_7CxImage@@6B@
??_FCxImage@@QAEXXZ
??_OCxImage@@QAEXAAV0@@Z
?TIFF IMAGE
?action=GetImageUploadInfos&
?imageMogr2/auto-orient/strip
?imageMogr2/auto-orient/strip%7CimageView2/2/w/1240
?params=%7B%22type%22%3A%22video%22%2C%22column%22%3Afalse%2C%22ugc%22%3Afalse%2C%22useImageX%22%3Atrue%7D
```

## 平台相关字符串

共 1027 条（节选前 80）：

```

--2067456weiboPro
 ::WeiboGetPayInfo Fail %d
 ::WeiboSetPayInfo Fail %d
 https://accounts.douban.com/
 https://cp.kuaishou.com
 https://cp.kuaishou.com/statistics/article
 https://creator.xiaohongshu.com
 https://creator.xiaohongshu.com/creator/home
 https://pro.xiaohongshu.com/enterprise/undefined
&domain=.weibo.com&ua=php-sso_sdk_client-0.6.28&_rand=
&weixinnum=
--2067456weiboPro
.?AV?$_Ref_count@UAcFunTypeData@@@tr1@std@@
.?AV?$_Ref_count@UAuthDouyinAccountMsgUnReadCount@@@tr1@std@@
.?AV?$_Ref_count@UBilibiliVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UDouyinGetMusicListMsg@@@tr1@std@@
.?AV?$_Ref_count@UDouyinGetPositionMsg@@@tr1@std@@
.?AV?$_Ref_count@UDouyinMusicInfo@@@tr1@std@@
.?AV?$_Ref_count@UDouyinPositionData@@@tr1@std@@
.?AV?$_Ref_count@UDouyinVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UDouyinWorkDeatailRequestParam@@@tr1@std@@
.?AV?$_Ref_count@UGetAuthDouyinAccountListUnReadCountMsg@@@tr1@std@@
.?AV?$_Ref_count@UHuitoutiaoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UMeipaiTypeData@@@tr1@std@@
.?AV?$_Ref_count@UQutoutiaoTypeData@@@tr1@std@@
.?AV?$_Ref_count@USohuVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@UWeiboSubTypeData@@@tr1@std@@
.?AV?$_Ref_count@UWeiboTypeData@@@tr1@std@@
.?AV?$_Ref_count@UWeixinQrCodeMsg@@@tr1@std@@
.?AV?$_Ref_count@UZhihuVideoTypeData@@@tr1@std@@
.?AV?$_Ref_count@VDouyinGetMusicListTask@@@tr1@std@@
.?AV?$_Ref_count@VDouyinGetPositionTask@@@tr1@std@@
.?AVDouyinGetMusicListTask@@
.?AVDouyinGetPositionTask@@
.zhihu.com
/qncdn-miaopai/
/zhihu-pics/
/zhihu-video-input/
163.com
:acfun
:douyin
:weixinshipinhao
:xiaohongshu
:xueqiu
<a href="//www.sohu.com/
<a href=\"\/weibo\/
<a href_to=\"\/weibo\/
AcFunSyncArticle GetCookie Fail
AiqiyiMediaGetAccountInfo Fail.
BiliBiliGetAccountInfo Fail.
BilibiliGetInfo GetCookie Fail
BilibiliSyncArticle GetCookie Fail
CancelArticleScanWeixinQrCode GetTask NULL
DayuGetAccountInfo Fail.
DayuGetUploadImgSign Fail %d
DayuSyncArticle GetCookie Fail
DoubanGetAccountInfo Fail.
DouyinEndUploadVideo Fail
DouyinGetAccountInfo Fail.
DouyinGetInfo GetCookie Fail
DouyinGetMusicList
DouyinGetPositionTask
DouyinProtocol.cpp
GetAcFunUserInfo Fail
GetAcFunUserInfo Fail.
GetAiqiyiUserInfo Fail
GetBilibiliUserInfo Fail
GetDayuUserInfo Fail
GetDoubanUserInfo Fail
GetDouyinDyyUserInfo Fail
GetDouyinDyyUserInfo Fail.
GetDouyinLaikeUserInfo Fail
GetDouyinLaikeUserInfo Fail.
GetDouyinLiveUserInfo Fail
GetDouyinLiveUserInfo Fail.
GetDouyinUserInfo Fail
GetDouyinlanVUserInfo Fail
GetDouyinlanVUserInfo Fail.
GetDouyinxiaodianUserInfo Fail
GetDouyinxiaodianUserInfo Fail.
```

## URL / API 端点

共 1338 条：

```
http://
http://101.227.174.72/upload
http://a.mp.uc.cn/article.html?
http://api.my.tv.sohu.com/comment/h5/getVoteAndCommentCount
http://baijiahao.baidu.com
http://baijiahao.baidu.com/po
http://baijiahao.baidu.com/po/
http://baijiahao.baidu.com/s?
http://baijiahao.baidu.com/s?id=
http://c.v.qq.com/fvupready
http://c.v.qq.com/vmodifyvideo
http://content.wemedia.cashtoutiao.com/content/getContent
http://content.wemedia.cashtoutiao.com/content/getContent/reason
http://content.wemedia.cashtoutiao.com/content/getContent/reason?articleId=3824904&weMediaState=3
http://content.wemedia.cashtoutiao.com/snapshot
http://content.wemedia.cashtoutiao.com/user/login/uploadImage
http://content.wemedia.cashtoutiao.com/video/manager/delete
http://content.wemedia.cashtoutiao.com/video/manager/get
http://content.wemedia.cashtoutiao.com/video/manager/reason
http://content.wemedia.cashtoutiao.com/video/upload
http://content.wemedia.cashtoutiao.com/video/upload/modify
http://content.wemedia.cashtoutiao.com/wemedia/article/addRelease
http://content.wemedia.cashtoutiao.com/wemedia/article/content/uploadImg
http://content.wemedia.cashtoutiao.com/wemedia/article/modify/
http://creator.miaopai.com
http://creator.miaopai.com/
http://creator.miaopai.com/profile/getInfo?type=full&ptype=0
http://creator.miaopai.com/upload
http://creator.miaopai.com/video
http://creator.miaopai.com/video/asynPublish
http://creator.miaopai.com/video/checkVideoStatus
http://creator.miaopai.com/video/checkvideodupl
http://creator.miaopai.com/video/coverTrans
http://creator.miaopai.com/video/getList
http://creator.miaopai.com/video/getUptoken2Cover
http://creator.miaopai.com/video/mutiCreate
http://creator.miaopai.com/video/saveDrafts
http://creator.miaopai.com/video/videoTransNew
http://d.ifengimg.com/q100/img1.ugc.ifeng.com/newugc/
http://dy.163.com/v2/article/detail/
http://dy.163.com/wemedia/upload/doUpload
http://fhh.ifeng.com
http://fhh.ifeng.com/api/homePage/homePageData
http://fhh.ifeng.com/api/video/add
http://fhh.ifeng.com/publish/article
http://fhhuser.ifeng.com/api/video/updateStatus
http://gxtest.cn-bj.ufileos.com/
http://gxtest.ufile.ucloud.cn/
http://h5.hao0202.com/m/
http://hs.blog.sina.com.cn/users/
http://html.1sapp.com/detail/
http://imgaliyuncdn.miaopai.com/
http://interface.17van.com/UserExtend/deductCreate
http://kuaibao.qq.com/getSubNewsContent
http://kuaibao.qq.com/s/
http://kuaichuan.360.cn
http://kuaichuan.360.cn/
http://kuaichuan.360kuai.com
http://kuaichuan.360kuai.com/
http://kuaichuan.360kuai.com/income/incomeList
http://kuaichuan.360kuai.com/stat/user
http://kuaichuan.360kuai.com/stat/userTotalNew
http://kuaichuan.360kuai.com/stat/userVideo
http://m.uczzd.cn
http://mini.eastday.com/mobile/
http://mini.xibolao.com:9091/getABogus
http://mp.163.com
http://mp.163.com/
http://mp.163.com/api/v2/upload/nos/water
http://mp.163.com/api/v3/upload/picupload
http://mp.163.com/article/postpage/
http://mp.163.com/index.html
http://mp.163.com/video/postpage/
http://mp.163.com/wemedia/article/checkTitle
http://mp.163.com/wemedia/data/content/article/count.do?_=%s&wemediaId=%s
http://mp.163.com/wemedia/data/content/article/pv/list.do
http://mp.163.com/wemedia/data/content/video/count.do?_=%s&wemediaId=%s
http://mp.163.com/wemedia/data/content/video/pv/list.do
http://mp.163.com/wemedia/index/count.do?_=%s&wemediaId=%s
http://mp.163.com/wemedia/navinfo.do
http://mp.163.com/wemedia/profit/list.do
http://mp.163.com/wemedia/profit/view.do?_=%s
http://mp.163.com/wemedia/publishreader/publish.do
http://mp.163.com/wemedia/upload/batchUploadImgUrl
http://mp.163.com/wemedia/video/publish.do
http://mp.163.com/wemedia/video/status/api/getToken.do
http://mp.163.com/wemedia/video/update.do
http://mp.cashtoutiao.com
http://mp.cashtoutiao.com/
http://mp.cashtoutiao.com/content/add
http://mp.cashtoutiao.com/content/edit/
http://mp.cashtoutiao.com/content/list
http://mp.cashtoutiao.com/dist/pages/video_content/add.js
http://mp.cashtoutiao.com/video_content/add
http://mp.cashtoutiao.com/video_content/list
http://mp.ifeng.com
http://mp.sina.com.cn
http://mp.sina.com.cn/#/Home/Notice
http://mp.sina.com.cn/aj/article
http://mp.sina.com.cn/aj/article/blend/drafts
http://mp.sina.com.cn/aj/article/blend/send
http://mp.sina.com.cn/aj/article/category
http://mp.sina.com.cn/aj/article/checkartsubmit
http://mp.sina.com.cn/aj/article/detail
http://mp.sina.com.cn/aj/article/getsendcode
http://mp.sina.com.cn/aj/article/list
http://mp.sina.com.cn/aj/article/refreshsendcode
http://mp.sina.com.cn/aj/article/upload?type=article&json=1
http://mp.sina.com.cn/aj/article/verifisendcode
http://mp.sina.com.cn/aj/article/video/drafts
http://mp.sina.com.cn/aj/article/video/send
http://mp.sina.com.cn/aj/image?action=cut
http://mp.sina.com.cn/aj/media/power
http://mp.sina.com.cn/aj/newvms/s3/complete
http://mp.sina.com.cn/aj/newvms/s3/init
http://mp.sina.com.cn/aj/newvms/s3/multipart
http://mp.sina.com.cn/aj/reward/billsummary?_=%s
http://mp.sina.com.cn/aj/statistic/general
http://mp.sina.com.cn/aj/statistic/today?_=%s
http://mp.sina.com.cn/aj/userstatus
http://mp.sina.com.cn/main/editor?vt=4
http://mp.sogou.com
http://mp.sogou.com/1/articles
http://mp.sogou.com/api/
http://mp.sogou.com/api/1/articles?status=
http://mp.sogou.com/api/articles
http://mp.sogou.com/api/articles/draft
http://mp.sogou.com/api/articles/video
http://mp.sogou.com/api/articles/video-draft
http://mp.sogou.com/api/articles/video/authVOD
http://mp.sogou.com/api/if-login?status=81
http://mp.sogou.com/api/image?name=file
http://mp.sogou.com/articles/
http://mp.sogou.com/articles/videos/
http://mp.sogou.com/dashboard
http://mp.sogou.com/new-article
http://mp.sogou.com/new-video
http://mp.weixin.qq.com/s
http://mparticle.uc.cn/article.html?
http://my.sina.com.cn/
http://my.tv.sohu.com
http://my.tv.sohu.com/user/a/profile/currinfo.do
http://my.tv.sohu.com/user/a/rvideo/wmvideolist.do
http://my.tv.sohu.com/user/video/upload.do
http://open.babytree.com/default/index#/index
http://open.babytree.com/register/get_user_info?data_types=content_draft_count,bill_info,role_info,homepage_switch
http://p1.pstatp.com/origin/
http://page.om.qq.com/page
http://portrait7.sinaimg.cn/
http://post.mp.qq.com/kan/article/
http://public.17van.com/info/getCreate
http://public.17van.com/info/getVipInfo
http://public.17van.com/info/team-vip-get
http://public.17van.com/voice/MicrosoftToken
http://public.17van.com/voice/Synthetic
http://push.my.tv.sohu.com/user/a/fa/count.do
http://qncdn-miaopai.oss-cn-beijing.aliyuncs.com/
http://rym.quwenge.com/baidu_tiaozhuan.php
http://rym.quwenge.com/baidu_tiaozhuan.php?
http://s.weibo.com/top/summary?cate=realtimehot
http://s.weibo.com/top/summary?cate=socialevent
http://s.weibo.com/weibo/
http://sc.youku.com/ajax/complete/
http://sc.youku.com/ajax/create/
http://sc.youku.com/ajax/save/
http://sh.qihoo.com/pc/detail
http://share.iclient.ifeng.com/vampire/shareNews?
http://static.1sapp.com/
http://top.baidu.com/buzz?b=1&c=513
http://top.baidu.com/buzz?b=11&c=513
http://top.baidu.com/buzz?b=341&c=513
http://top.baidu.com/buzz?b=342&c=513
http://top.baidu.com/buzz?b=344&c=513
http://transmission.ifeng.com/query
http://transmission.ifeng.com/upload
http://ugc.ifeng.com/index.php/user/getid
http://ugc.ifeng.com/index.php/user/info
http://ugcv.ws.netease.com/resumable/transcode
http://up-z2.qiniup.com/
http://upload.youku.com/api/get_server_address/
http://upload0302.if.iqiyi.com/upload
http://video.5tiao.net/
http://video.qq.com/fcgi-bin/get_user_profile
http://vm.tudou.com/video/list/search
http://vstat.v.blog.sohu.com/dostat.do
http://war.163.com/
http://weixin.sogou.com
http://weixin.sogou.com/pcindex/pc/
http://weixin.sogou.com/weixin
http://wemedia.ifeng.com/
http://www.360doc.com/ajax/chat.ashx
http://www.360doc.com/chat/chatnew.html
http://www.360doc.com/myfollow.aspx
http://www.360kuai.com/
http://www.360kuai.com/pc/detail
http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd
http://www.jianshu.com/p/
http://www.sohu.com/a/
http://www.soogif.com/material/query/
http://www.toutiao.com/
http://www.w3.org/1998/Math/MathML
http://www.w3.org/1999/xhtml
http://www.w3.org/1999/xlink
http://www.w3.org/2000/svg
http://www.w3.org/TR/REC-html40/strict.dtd
http://www.w3.org/TR/html4/strict.dtd
http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd
http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd
http://www.yidianzixun.com/article/
http://www.zimeika.com/article
http://wxapp.tc.qq.com
https://
https://7.mgtv.com
https://7.mgtv.com/dashboard
https://a.mp.uc.cn/article.html?
https://access.v.qq.com/trpc.creator_center.backend.UploadSvc/UploadSuccNotify
https://access.v.qq.com/trpc.creator_center.backend.UploadSvc/UploadWebInit
https://access.v.qq.com/trpc.creator_center.backend.VideoFusion/CreateVideo
https://access.v.qq.com/trpc.creator_center.backend.VideoFusion/UpdateVideo
https://access.v.qq.com/trpc.creator_center.backend.video_managerment/GetUserVideoList
https://access.v.qq.com/trpc.creator_center.data_center.data_center/GetTrendAnalysis?refer=vcc_web&last_days=30&origin=1
https://access.v.qq.com/trpc.creator_center.data_center.data_center/GetTrendAnalysis?refer=vcc_web&last_days=7&origin=1
https://access.v.qq.com/trpc.creator_center.entrance.Entrance/GetAccountInfo
https://access.v.qq.com/trpc.creator_center.entrance.ImageUpload/BlobUpload?refer=vcc_web&filename=%s&width=%d&height=%d&vid=%s&origin=1&g_vstk=%s
https://access.v.qq.com/trpc.creator_center.settlement.IncomeAnalysis/GetIncomeTrend?refer=vcc_web&origin=1
https://access.v.qq.com/trpc.creator_center.settlement.IncomeAnalysis/GetTotalIncome?refer=vcc_web&incomeTag=short_video&origin=1
https://access.v.qq.com/trpc.video_app_short_video.trpc_user_subscribe_service.UserSubscribeData/GetFansList?refer=vcc_web&page=1&pageSize=30
https://accounts.douban.com/passport/setting
https://action.17van.com/action/collection
https://action.17van.com/action/deliver-solve
https://ad.ifeng.com/promote/bidding/forecastAll
https://ad.ifeng.com/promote/bidding/incomeOverview
https://api.admin.cp.cashtoutiao.com/headLine/h5Api
https://api.bilibili.com/studio/growup/web/up/wallet/summary?s_locale=zh_CN
https://api.bilibili.com/studio/growup/web/up/withdraw/detail
https://api.bilibili.com/x/article/creative/article/list
https://api.bilibili.com/x/article/creative/article/submit
https://api.bilibili.com/x/article/creative/article/upcover
https://api.bilibili.com/x/article/creative/article/upwatermark
https://api.bilibili.com/x/article/creative/draft/addupdate
https://api.bilibili.com/x/earnings/up/income/trend?days=30&s_locale=zh_CN
https://api.bilibili.com/x/v2/reply/up/fulllist/
https://api.bilibili.com/x/web-interface/nav
https://api.look.360.cn/kan/uploadCommit
https://api.look.360.cn/kan/uploadRequest
https://api.pinduoduo.com/get_endpoint
https://api.qiniu.com/v2/query
https://api.weishi.qq.com/trpc.weishi.weishi_h5_proxy.weishi_h5_proxy/UploadPic
https://api.zhihu.com/content/drafts
https://api.zhihu.com/images
https://api.zhihu.com/images/
https://author.baidu.com/
https://author.baidu.com/home
https://baijiahao.baidu.com
https://baijiahao.baidu.com/
https://baijiahao.baidu.com/author/eco/income2/newtotalincome
https://baijiahao.baidu.com/author/eco/income2/totalincometrend
https://baijiahao.baidu.com/author/eco/statistic/getreaderprofile
https://baijiahao.baidu.com/author/eco/statistics/ArticleStatisticV2
https://baijiahao.baidu.com/author/eco/statistics/appStatistic
https://baijiahao.baidu.com/author/eco/statistics/appStatisticV3
https://baijiahao.baidu.com/author/eco/statistics/articleDailyListStatisticV2
https://baijiahao.baidu.com/author/eco/statistics/articleListStatistic
https://baijiahao.baidu.com/author/eco/statistics/getFansBasicInfo
https://baijiahao.baidu.com/author/eco/tasksystem/getArticleTaskDetailCms?task_type=2&task_id=
https://baijiahao.baidu.com/author/eco/tasksystem/getSquareMissionList
https://baijiahao.baidu.com/builder/app/appinfo?
https://baijiahao.baidu.com/builder/author/originalAnnounce/announceOriginal
https://baijiahao.baidu.com/builder/author/originalAnnounce/checkAnnounce
https://baijiahao.baidu.com/builder/author/video/compuploadVideo
https://baijiahao.baidu.com/builder/author/video/preuploadVideo
https://baijiahao.baidu.com/builder/preview/s
https://baijiahao.baidu.com/builder/rc/analysiscontent/single
https://baijiahao.baidu.com/builder/rc/analysiscontent?app_id=
https://baijiahao.baidu.com/builder/rc/analysisfans/basedata
https://baijiahao.baidu.com/builder/rc/content?type=moment&collection=&pageSize=10&currentPage=
https://baijiahao.baidu.com/builder/rc/edit?type=events
https://baijiahao.baidu.com/builder/rc/edit?type=events&app_id=
https://baijiahao.baidu.com/builder/rc/edit?type=news
https://baijiahao.baidu.com/builder/rc/edit?type=news&app_id=
https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1
https://baijiahao.baidu.com/builder/rc/edit?type=videoV2
https://baijiahao.baidu.com/builder/rc/edit?type=videoV2&is_from_cms=1
https://baijiahao.baidu.com/builder/rc/stores/newTask/articles?taskId=
https://baijiahao.baidu.com/builder/rc/stores/newTask/taskSquare?aside=0
https://baijiahao.baidu.com/builderinner/api/content/file/image/dump
https://baijiahao.baidu.com/materialui/picture/auto_cutting
https://baijiahao.baidu.com/materialui/picture/uploadProxy
https://baijiahao.baidu.com/pcui/Brain/CoordRcmd
https://baijiahao.baidu.com/pcui/Brain/TitleDiag
https://baijiahao.baidu.com/pcui/Picture/CuttingPic
https://baijiahao.baidu.com/pcui/Picture/CuttingPicproxy
https://baijiahao.baidu.com/pcui/article/lists
https://baijiahao.baidu.com/pcui/article/publish
https://baijiahao.baidu.com/pcui/article/save
https://baijiahao.baidu.com/pcui/home/index
https://baijiahao.baidu.com/pcui/pcpublisher/deletedynamic
https://baijiahao.baidu.com/pcui/pcpublisher/listdynamic
https://baijiahao.baidu.com/pcui/pcpublisher/publishdynamic
https://baijiahao.baidu.com/pcui/pcpublisher/searchtopic
https://baijiahao.baidu.com/pcui/picture/upload
https://baijiahao.baidu.com/pcui/picture/uploadproxy
https://baijiahao.baidu.com/pcui/topic/topicuserauthcheck?
https://baijiahao.baidu.com/po
https://baijiahao.baidu.com/po/
https://baijiahao.baidu.com/s?
https://baobao.baidu.com/browse
https://bkend.17van.com/ApiAd/GetAlertInfo
https://bkend.17van.com/ApiAd/GetAllInfo
https://bkend.17van.com/ApiAd/GetRotateInfo
https://bkend.17van.com/ApiAd/GetSideInfo
https://bkend.17van.com/ApiInterface/GetSoftwareNotice
https://bkend.17van.com/ApiInterface/WordChangeZip
https://bkend.17van.com/ApiInterface/WordChangeZipOLD
https://bkend.17van.com/ApiWebsite/Feedback
https://bkend.17van.com/apiInterface/AjaxWordChange
https://bkend.17van.com/apiInterface/GetAnnounceInfo
https://bkend.17van.com/apiInterface/GetQiNiuToken
https://bkend.17van.com/apiInterface/getUsersConf
https://bkend.17van.com/apiInterface/setUsersConf
https://boodo.qq.com
https://boodo.qq.com/
https://buyin.jinritemai.com/dashboard
https://buyin.jinritemai.com/index/getUser
https://card.weibo.com
https://card.weibo.com/article/v3/aj/editor/draft/create
https://card.weibo.com/article/v3/aj/editor/draft/publish
https://card.weibo.com/article/v3/aj/editor/draft/publishtiming
https://card.weibo.com/article/v3/aj/editor/draft/save
https://card.weibo.com/article/v3/aj/editor/settings/getpayinfo
https://card.weibo.com/article/v3/aj/editor/settings/setpayinfo
https://card.weibo.com/article/v3/editor
https://cc.v.qq.com
https://cc.v.qq.com/
https://cc.v.qq.com/account
https://cc.v.qq.com/api/video/list
https://cc0.cn/sou/index.php
https://cgi.boodo.qq.com/cgi-bin/comicpc_async_cgi
https://channels.weixin.qq.com
https://channels.weixin.qq.com/
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_parse_mp_link
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_search_location
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/get-finder-post-trace-key
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/get_bgm_list
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_clip_video
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_clip_video_result
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_create
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_list
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_search_event
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/statistic/feed_aggreagate_data_by_tab_type
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/statistic/new_post_total_data
https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/statistic/post_list
https://channels.weixin.qq.com/index
https://channels.weixin.qq.com/micro/content/cgi-bin/mmfinderassistant-bin/post/finder_get_object_tag_list
https://channels.weixin.qq.com/micro/content/post/create
https://channels.weixin.qq.com/platform
https://channels.weixin.qq.com/platform/post/create
https://channels.weixin.qq.com/platform/post/finderNewLifeCreate
https://channels.weixin.qq.com/platform/statistic/post
https://channels.weixin.qq.com/platform/statistic/postDetail?isImageMode=0
https://channels.weixin.qq.com/post/create
https://channels.weixin.qq.com/post/list
https://channels.weixin.qq.com/statistic/post
https://chinaeast2.tts.speech.azure.cn/cognitiveservices/v1
https://cmstool.youku.com/cms/player/userinfo/user_info?specialTest=test&client=pc
https://contents.meituan.com/api/author/creator/author/certificate/query
https://contentweb.alipay.com/life/getAppEnv.json
https://cp.kandian.qq.com/cgi-bin/authormgr/QueryAccountBasicInfo
https://cp.kandian.qq.com/publish/video
https://cp.kuaishou.com
https://cp.kuaishou.com/
https://cp.kuaishou.com/article/manage/video
https://cp.kuaishou.com/article/publish/video
https://cp.kuaishou.com/article/publish/video?tabType=2
https://cp.kuaishou.com/profile
https://cp.kuaishou.com/rest/cp/creator/analysis/pc/author/overview
https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list
https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/single/diagnose
https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/single/info
https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/single/overview
https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/single/traffic/source
https://cp.kuaishou.com/rest/cp/creator/pc/analysis/photo/has/opened
https://cp.kuaishou.com/rest/cp/creator/pc/analysis/photo/single/trending
https://cp.kuaishou.com/rest/cp/creator/pc/home/infoV2
https://cp.kuaishou.com/rest/cp/works/atlas/pc/publish/submit
https://cp.kuaishou.com/rest/cp/works/atlas/pc/publishInfo/snapshot/save
https://cp.kuaishou.com/rest/cp/works/atlas/pc/upload/music/search
https://cp.kuaishou.com/rest/cp/works/atlas/pc/upload/pre
https://cp.kuaishou.com/rest/cp/works/atlas/pc/upload/single/finish
https://cp.kuaishou.com/rest/cp/works/v2/common/pc/ip2poi
https://cp.kuaishou.com/rest/cp/works/v2/video/pc/photo/list
https://cp.kuaishou.com/rest/cp/works/v2/video/pc/relation/list
https://cp.kuaishou.com/rest/cp/works/v2/video/pc/submit
https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/cover/upload
https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/finish
https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/pre
https://cp.kuaishou.com/rest/cp/works/v4/video/pc/cover/edit/cover/upload
https://cp.kuaishou.com/rest/pc/authority/account/current
https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current
https://cp.kuaishou.com/rest/zt/location/wi/poi/nearby
https://cp.kuaishou.com/rest/zt/location/wi/poi/search
https://cp.kuaishou.com/statistics/article
https://cp.kuaishou.com/statistics/article/detail/
https://cp.kuaishou.com/statistics/works
https://create.xiaohongshu.com
https://create.xiaohongshu.com/
https://creator.douyin.com
https://creator.douyin.com/
https://creator.douyin.com/aweme/janus/creator/data/overview/all/
https://creator.douyin.com/aweme/v1/creator/data/item/audience/
https://creator.douyin.com/aweme/v1/creator/data/item/wordCloud/
https://creator.douyin.com/aweme/v1/creator/income/category/detail/
https://creator.douyin.com/aweme/v1/creator/income/category/summary/
https://creator.douyin.com/aweme/v1/creator/user/info/
https://creator.douyin.com/aweme/v1/life/video_api/post/permission/
https://creator.douyin.com/aweme/v1/life/video_api/search/poi/
https://creator.douyin.com/aweme/v1/open/publish/limit_app_groups/
https://creator.douyin.com/aweme/v1/poi/search/spu
https://creator.douyin.com/content/upload
https://creator.douyin.com/creator-micro/content/manage
https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page
https://creator.douyin.com/creator-micro/content/publish
https://creator.douyin.com/creator-micro/content/publish-media/image-text
https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page
https://creator.douyin.com/creator-micro/creative-guidance?discover_menu=2
https://creator.douyin.com/creator-micro/data-center/content
https://creator.douyin.com/creator-micro/data-center/operation
https://creator.douyin.com/creator-micro/revenue/overview?from=sider
https://creator.douyin.com/creator-micro/work-management/work-detail/
https://creator.douyin.com/data/stats/overview
https://creator.douyin.com/janus/douyin/creator/bff/data/bullet/analysis/v2
https://creator.douyin.com/janus/douyin/creator/data/item_analysis/metrics_trend
https://creator.douyin.com/janus/douyin/creator/data/overview/dashboard
https://creator.douyin.com/janus/douyin/creator/data/realtime/analysis/data_center
https://creator.douyin.com/web/api/creator/item/list
https://creator.douyin.com/web/api/creator/item/mget
https://creator.douyin.com/web/api/creator/material/center/billboard/
https://creator.douyin.com/web/api/media/anchor/search
https://creator.douyin.com/web/api/media/anchor/search/
https://creator.douyin.com/web/api/media/aweme/create/
https://creator.douyin.com/web/api/media/aweme/create_v2/
https://creator.douyin.com/web/api/media/aweme/search/post/auth
https://creator.douyin.com/web/api/media/collection/song/
https://creator.douyin.com/web/api/media/music/list
https://creator.douyin.com/web/api/media/poi/search/
https://creator.douyin.com/web/api/media/shop/draft/update/
https://creator.douyin.com/web/api/media/shop/draft/update/?cookie_enabled=true&screen_width=
https://creator.douyin.com/web/api/media/shop/promotion/link/
https://creator.douyin.com/web/api/media/shop/promotion/link/?cookie_enabled=true&screen_width=
https://creator.douyin.com/web/api/media/upload/auth/v5/
https://creator.douyin.com/web/api/media/user/cart/
https://creator.douyin.com/web/api/media/user/info/
https://creator.douyin.com/web/api/media/video/enable/
https://creator.douyin.com/web/api/media/video/transend/
https://creator.guanghe.taobao.com/#/
https://creator.guanghe.taobao.com/creator/account/v2/queryAccountCard
https://creator.huoshan.com
https://creator.huoshan.com/
https://creator.huoshan.com/content/manage
https://creator.huoshan.com/content/publish
https://creator.huoshan.com/content/publish/poster/
https://creator.huoshan.com/content/upload
https://creator.huoshan.com/web/api/media/aweme/create/
https://creator.huoshan.com/web/api/media/aweme/post/
https://creator.huoshan.com/web/api/media/upload/auth/
https://creator.huoshan.com/web/api/media/user/info/
https://creator.huoshan.com/web/api/media/video/enable/
https://creator.huoshan.com/web/api/media/video/transend/
https://creator.huoshan.com/web/api/v2/discover/search/?browser_version=5.0+(Windows+NT+10.0%3B+Win64%3B+x64)+AppleWebKit%2F537.36+(KHTML,+like+Gecko)+Chrome%2F96.0.4664.45+Safari%2F537.36
https://creator.iqiyi.com
https://creator.iqiyi.com/
https://creator.xiaohongshu.com
https://creator.xiaohongshu.com/
https://creator.xiaohongshu.com/api/galaxy/creator/data/note_detail_new
https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/analyze/list
https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/audience/source/detail
https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/base
https://creator.xiaohongshu.com/api/galaxy/creator/home/data_overall
https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info
https://creator.xiaohongshu.com/api/galaxy/creator/note/user/posted
https://creator.xiaohongshu.com/api/galaxy/user/info
https://creator.xiaohongshu.com/api/galaxy/v2/creator/datacenter/account/base
https://creator.xiaohongshu.com/api/media/v1/upload/web/permit
https://creator.xiaohongshu.com/creator/home
https://creator.xiaohongshu.com/creator/home?roleType=creator
https://creator.xiaohongshu.com/creator/notemanage
https://creator.xiaohongshu.com/creator/notes
https://creator.xiaohongshu.com/creator/notes?roleType=creator
https://creator.xiaohongshu.com/publish/imgNote
https://creator.xiaohongshu.com/publish/publish?source=%7B%22extraInfo%22%3A%7B%22subType%22%3A%22web%22,%22topic_id%22%3A%22%22%7D,%22type%22%3A%22web%22,%22ids%22%3A%22%22%7D
https://creator.xiaohongshu.com/statistics/account
https://creator.xiaohongshu.com/statistics/data-analysis
https://creator.xiaohongshu.com/statistics/note-detail?noteId=
https://czz.meituan.com
https://czz.meituan.com/
https://czz.meituan.com/new/personalHomePage
https://damang.api.mgtv.com/admin/up/info
https://doujia.douyin.com/api/v1/user/info
https://doujia.douyin.com/orders
https://dr.jd.com
https://dr.jd.com/
https://dr.jd.com/page/app.html#/home
https://dream.haokan.com/author
https://dream.haokan.com/creator/getauthorinfo
https://dss.sc.weibo.com/pc/aj/chart/content/weiboReadTrend
https://dss.sc.weibo.com/pc/aj/chart/overview/lastDay?_=%s
https://dss.sc.weibo.com/pc/index
https://dy.163.com/v2/article/detail/
https://e.douyin.com/aweme/v1/bluev/user/info
https://e.douyin.com/site/
https://e.weibo.com/v1/eps/manage/home
https://e.weibo.com/v1/eps/native/info
https://e.weibo.com/v1/public/paid/initpid
https://edith.xiaohongshu.com/web_api/sns/v1/local/poi/creator/search
https://edith.xiaohongshu.com/web_api/sns/v1/search/topic
https://edith.xiaohongshu.com/web_api/sns/v2/note
https://edith.xiaohongshu.com/web_api/sns/v5/creator/note/user/posted
https://feed.baidu.com/feed/api/box/landing
https://feng.ifeng.com/c/
https://ff.dayu.com/contents/
https://ff.dayu.com/contents/origin/
https://fhhuser.ifeng.com/api/article/insert
https://fhhuser.ifeng.com/api/article/listPC
https://fhhuser.ifeng.com/api/article/update
https://fhhuser.ifeng.com/api/statistics/getDayData
https://fhhuser.ifeng.com/api/statistics/getTotalData?type=1
https://fhhuser.ifeng.com/api/statistics/getTotalData?type=2
https://fhhuser.ifeng.com/api/video/add?
https://fhhuser.ifeng.com/api/video/update?
https://fhhuser.ifeng.com/api/video/videoListPC
https://fhhuser.ifeng.com/napi/account/queryinfo?
https://file-b.pinduoduo.com
https://finder.video.qq.com
https://finderassistancea.video.qq.com/applyuploaddfs
https://finderassistancea.video.qq.com/completepartuploaddfs
https://finderassistanced.video.qq.com/uploadpartdfs
https://fxg.jinritemai.com/ffa/mshop/homepage/index
https://h5.cp.cashtoutiao.com/m/news/detail
https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/
https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUploadVideo
https://h5.weishi.qq.com/weishi/feed/
https://h5.weishi.qq.com/weishi/getauthinfo
https://hot.newrank.cn/
https://hot.newrank.cn/xdnphb/original/getHotSearch
https://hot.newrank.cn/xdnphb/original/getIncidentArticleListAll
https://html.1sapp.com/detail/
https://i.autohome.com.cn/
https://i.autohome.com.cn/message
https://i.snssdk.com/video/fedata/1/pgc/
https://i.yiche.com/u
https://i.youku.com/i/index
https://ifeng-cos-ugc-upload-1300722751.cos.ap-beijing.myqcloud.com
https://image.baidu.com/
https://image.baidu.com/search/acjson
https://image.om.qq.com/cpom_pimage/ArchacaleUploadViaFile
https://image.om.qq.com/cpom_pimage/ContentImageUploadViaUrl
https://image.om.qq.com/cpom_pimage/ListImageUploadViaFile
https://image.om.qq.com/cpom_pimage/ListImageUploadViaUrl
https://image.yidianzixun.com/submit?src=
https://imagex.bytedanceapi.com/?
https://index.toutiao.com/api/news/reports/normal?page=1&size=12&search=
https://index.toutiao.com/topic/
https://interface.17van.com/PcDouyinLetter/batchDel
https://interface.17van.com/PcDouyinLetter/batchStatus
https://interface.17van.com/PcDouyinLetter/getRules
https://interface.17van.com/PcDouyinLetter/getSubUserAccount
https://interface.17van.com/PcDouyinLetter/getSubUserAccountMew
https://interface.17van.com/pc/delAuth
https://interface.17van.com/pc/getDouyinUrl
https://interface.17van.com/pc/getPermission
https://interface.17van.com/pc/getUserInfo
https://interface.17van.com/pc/login
https://interface.17van.com/pc/selectAuthVideo
https://interface.17van.com/pcdouyin/batchDel
https://interface.17van.com/pcdouyin/batchStatus
https://interface.17van.com/pcdouyin/getRules
https://interface.17van.com/pcdouyin/unbind
https://interface.17van.com/pczfb/getUrl
https://interface.17van.com/subUsers/addAccount
https://interface.17van.com/subUsers/getVipInfo
https://interface.17van.com/subUsers/login
https://interface.17van.com/teamVip/get
https://interface.17van.com/users/addAccount
https://interface.17van.com/voice/rmbDuration
https://interface.17van.com/voice/rmbGetToken
https://ishare.ifeng.com
https://kandian.mp.qq.com
https://kandian.mp.qq.com/page/article
https://kandian.mp.qq.com/page/video
https://kuaibao.qq.com/s/
https://kuaichuan.360kuai.com
https://kuaichuan.360kuai.com/
https://kuaichuan.360kuai.com/#/console/dashboard
https://kuaichuan.360kuai.com//videoManage/publish
https://kuaichuan.360kuai.com/apiData/viewUse
https://kuaichuan.360kuai.com/articleManage/doDraft
https://kuaichuan.360kuai.com/articleManage/publish
https://kuaichuan.360kuai.com/content/contentList
https://kuaichuan.360kuai.com/token/gettoken
https://kuaichuan.360kuai.com/upload/convertImg?source=post&picarule_facedetect=1
https://kuaichuan.360kuai.com/upload/img
https://kuaichuan.360kuai.com/upload/img?source=post
https://kuaichuan.360kuai.com/user/detail
https://kuaichuan.360kuai.com/video/list
https://kuaichuan.360kuai.com/videoManage/doDraft
https://lens.zhihu.com/api/v4/videos
https://live.kuaishou.com/rest/wd/photo/upload
https://live.kuaishou.com/upload-video
https://live.pinduoduo.com
https://live.pinduoduo.com/
https://live.pinduoduo.com/api/backbone/goods/check
https://live.pinduoduo.com/api/backbone/video/publish
https://live.pinduoduo.com/api/backbone/video/query
https://live.pinduoduo.com/calpis/mms/user/verify_login
https://live.pinduoduo.com/creator/index
https://live.pinduoduo.com/creator/video-manage
https://live.pinduoduo.com/live/galerie/signature
https://live.pinduoduo.com/login/anchor
https://live.pinduoduo.com/n-creator/live/home
https://live.pinduoduo.com/n-creator/video/home
https://live.pinduoduo.com/sprite/obs/anchor/info?
https://livedata.douyin.com/live/data/creator/prepare
https://livedata.douyin.com/webcast/api/livedata/v1/init/user_info
https://login.sina.com.cn/sso/login.php?url=
https://m.360buyimg.com/
https://m.toutiaocdn.com/
https://mbd.baidu.com
https://mbd.baidu.com/newspage/data/videolanding?nid=sv_
https://mbd.baidu.com/webpage
https://me.weibo.com/api/proxy/native/dataprofit
https://me.weibo.com/api/proxy/profit/trand?type=month
https://me.weibo.com/income/overview
https://media.douyin.com
https://media.douyin.com/
https://media.douyin.com/#/
https://media.douyin.com/content/manage
https://media.douyin.com/web/api/media/aweme/post/
https://media.douyin.com/web/api/media/sync/income/
https://media.weishi.qq.com
https://media.weishi.qq.com/
https://media.weishi.qq.com/media-api/PublishVideo
https://media.weishi.qq.com/media-api/getPersonalInfo
https://media.weishi.qq.com/media-api/getVideoList
https://media.weishi.qq.com/media/edit?pid=
https://mediacloud.kuaishou.com/api/upload/complete
https://mediacloud.kuaishou.com/api/upload/fragment
https://member.acfun.cn
https://member.acfun.cn/
https://member.acfun.cn/article-data-center
https://member.acfun.cn/article-history
https://member.acfun.cn/article/api/postArticle
https://member.acfun.cn/common/api/getQiniuToken
https://member.acfun.cn/common/api/getUrlAfterUpload
https://member.acfun.cn/dataCenter/api/overview
https://member.acfun.cn/list/api/queryContributeList
https://member.acfun.cn/post-article
https://member.acfun.cn/rest/pc-direct/image/upload/getToken
https://member.acfun.cn/upload-video
https://member.acfun.cn/video/api/createDouga
https://member.acfun.cn/video/api/createVideo
https://member.acfun.cn/video/api/getKSCloudToken
https://member.acfun.cn/video/api/uploadFinish
https://member.bilibili.com
https://member.bilibili.com/
https://member.bilibili.com/article-text/home?
https://member.bilibili.com/article-text/home?aid=
https://member.bilibili.com/platform/data-up/index
https://member.bilibili.com/platform/data-up/video/dataCenter/video
https://member.bilibili.com/platform/releasecenter
https://member.bilibili.com/platform/upload-manager/text
https://member.bilibili.com/platform/upload/video/frame
https://member.bilibili.com/preupload
https://member.bilibili.com/v2
https://member.bilibili.com/v2#/home
https://member.bilibili.com/video/upload.html
https://member.bilibili.com/x/vu/web/add/v3
https://member.bilibili.com/x/vu/web/cover/up
https://member.bilibili.com/x/web/activity/videoall
https://member.bilibili.com/x/web/archives
https://member.bilibili.com/x/web/data/archive/index
https://member.bilibili.com/x/web/data/archive_diagnose/overview
https://member.bilibili.com/x/web/data/archive_diagnose/trend
https://member.bilibili.com/x/web/data/article
https://member.bilibili.com/x/web/data/v2/overview/stat/graph
https://member.bilibili.com/x/web/data/v2/overview/stat/num
https://member.bilibili.com/x/web/data/v3/archive/view
https://member.bilibili.com/york/data-center-web/dataCenter/archive
https://member.bilibili.com/york/data-center-web/dataCenter/archive?tmid=&tab=&bvid=
https://mi.mbd.baidu.com/
https://mini.eastday.com/mobile/
https://mp-api.iqiyi.com/base/api/1.0/get_role
https://mp-api.iqiyi.com/base/api/1.0/iqiyi-authorize
https://mp-api.iqiyi.com/base/api/1.0/person-authorize
https://mp-api.iqiyi.com/income/api/1.0/home_aggregate
https://mp-api.iqiyi.com/income/api/1.0/summary
https://mp-api.iqiyi.com/stat/api/1.0/free/video/data/user_trend
https://mp-api.iqiyi.com/stat/api/1.0/user/yesterday?pgcType=wemedia
https://mp-api.iqiyi.com/stat/api/1.0/video/data/user_trend
https://mp-api.iqiyi.com/v-catalog/api/1.0/union-catalog/save
https://mp-api.iqiyi.com/v-catalog/api/1.0/union-catalog/saveDraft
https://mp-api.iqiyi.com/v-tool/api/1.0/cover/upload_crop_save
https://mp-api.iqiyi.com/v-tool/api/1.0/image/covers_enhance
https://mp-api.iqiyi.com/v-tool/api/1.0/image/image/resolution
https://mp-api.iqiyi.com/v-tool/api/1.0/porn_detect/check
https://mp-api.iqiyi.com/video/api/1.0/pgc/channels?level=video&site=cn
https://mp-api.iqiyi.com/video/api/1.0/upgc/selfmedia/videos
https://mp-api.iqiyi.com/video/api/1.0/upgc/smallvideo/videos
https://mp-api.iqiyi.com/writer/api/1.0/short-img-text/publish
https://mp-api.iqiyi.com/writer/api/1.0/short-img-text/search-feeds
https://mp-server.wutiao.com/UpFile/getSecurityToken
https://mp-server.wutiao.com/UpFile/getSecurityToken?type=1
https://mp-server.wutiao.com/article/articleList
https://mp-server.wutiao.com/article/publishArticle
https://mp-server.wutiao.com/upFile/getVideoPic
https://mp-server.wutiao.com/user/info/get
https://mp.163.com/subscribe_v4/index.html
https://mp.163.com/wemedia/article/status/api/publishV2.do
https://mp.163.com/wemedia/content/manage/list.do?
https://mp.163.com/wemedia/material/picture/addPic.do
https://mp.cashtoutiao.com
https://mp.cloud.huawei.com
https://mp.cloud.huawei.com/
https://mp.cloud.huawei.com/mediaopenportalservice/statistic/queryRealtimeData
https://mp.cloud.huawei.com/mediaopenportalservice/trend/queryTrendData
https://mp.cloud.huawei.com/mediaopenportalservice/user/isLogin
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/content/commitCombinedContentDraft
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/content/getContentDetail
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/content/listAllContents
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/content/publishContentDraft
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/media/reportFinishUpload
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/media/tcpFullUpload
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/poster/reportFinishUpload
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/contentservice/poster/tcpFullUpload
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/getCsrfToken
https://mp.cloud.huawei.com/mediaopenportalservice/v2/api/user/queryUserInfo
https://mp.cloud.huawei.com/mediaopenportalservice/vue/
https://mp.cloud.huawei.com/mediaopenportalservice/vue/#/frame/dashboard
https://mp.csdn.net/
https://mp.dayu.com
https://mp.dayu.com/api/stat/wemedia/summary
https://mp.dayu.com/autoCovers
https://mp.dayu.com/confirm_info
https://mp.dayu.com/dashboard/addMaterial
https://mp.dayu.com/dashboard/article/getCoverSelection
https://mp.dayu.com/dashboard/article/write
https://mp.dayu.com/dashboard/getArticleList?
https://mp.dayu.com/dashboard/getArticleList?keyword=&currentView=all&page=1
https://mp.dayu.com/dashboard/getNewContentList
https://mp.dayu.com/dashboard/index
https://mp.dayu.com/dashboard/minivideo/submitVideo
https://mp.dayu.com/dashboard/minivideo/write
https://mp.dayu.com/dashboard/save-draft
https://mp.dayu.com/dashboard/stat/getConsumptionData
https://mp.dayu.com/dashboard/submit-article
https://mp.dayu.com/dashboard/ucAd/getReports
https://mp.dayu.com/dashboard/unifiedSettlement/getAccount
https://mp.dayu.com/dashboard/video/write
https://mp.dayu.com/dashboard/video/write?spm=a2s0i.db_index.menu.4.15fb3caa3k611P
https://mp.dayu.com/get_sign
https://mp.dayu.com/imageupload
https://mp.dayu.com/upload-image?src=
https://mp.ifeng.com
https://mp.ifeng.com/
https://mp.ifeng.com/manage/originalArticle
https://mp.iqiyi.com
https://mp.iqiyi.com/
https://mp.iqiyi.com/creator/video/ugc/add
https://mp.iqiyi.com/fans/stat
https://mp.iqiyi.com/wemedia/video/ugc/add
https://mp.meiyou.com/home/
https://mp.meiyou.com/user
https://mp.qq.com
https://mp.qq.com/
https://mp.qq.com/api/analysis/get_grade
https://mp.qq.com/api/article_manager/article/list
https://mp.qq.com/api/home/index/getArticle
https://mp.qq.com/api/home/index/getFans
https://mp.qq.com/api/home/index/getVideo
https://mp.qq.com/api/revenue/get_amount
https://mp.qq.com/api/revenue/get_amount_detail
https://mp.qq.com/api/revenue/get_month_revenue
https://mp.qq.com/api/revenue/get_table_detail
https://mp.qq.com/api/revenue/get_trend_revenue
https://mp.qq.com/api/revenue/get_yesterday_revenue
https://mp.qq.com/api/video/create
https://mp.qq.com/api/video/get_video_info
https://mp.qq.com/api/video/token
https://mp.qq.com/ex/kandian/image/toinner
https://mp.qq.com/ex/kandian/image/upload
https://mp.qq.com/ex/kandian/material/save-box
https://mp.qq.com/ex/kandian/publish/publish
https://mp.qq.com/ex/kandian/publish/publish-video
https://mp.qq.com/page/article
https://mp.qq.com/page/video#video_pub
https://mp.qutoutiao.net
https://mp.qutoutiao.net/page/first-page
https://mp.qutoutiao.net/publish-content/article
https://mp.qutoutiao.net/publish-content/video
https://mp.qutoutiao.net/static/ueditor/dialogs/image/image.html?r=1002
https://mp.sohu.com
https://mp.sohu.com/
https://mp.sohu.com/commons/front/outerUpload/image/file
https://mp.sohu.com/commons/mp/chunkUploadDone
https://mp.sohu.com/commons/mp/createVideo
https://mp.sohu.com/commons/mp/uploadVideo
https://mp.sohu.com/commons/upload/file
https://mp.sohu.com/commons/upload/url
https://mp.sohu.com/commons/v2/upload/file
https://mp.sohu.com/mp-accounts/watermark
https://mp.sohu.com/mpbp/bp/account/common/auth
https://mp.sohu.com/mpbp/bp/account/listV2
https://mp.sohu.com/mpbp/bp/news/v4/news/draft
https://mp.sohu.com/mpbp/bp/news/v4/news/publish
https://mp.sohu.com/mpbp/bp/news/v4/news/publishVideo/v2
https://mp.sohu.com/mpbp/bp/news/v4/news/rejectReason?newsId=
https://mp.sohu.com/mpbp/bp/news/v4/news/schedulePublish
https://mp.sohu.com/mpbp/bp/news/v4/news/video/draft/v2
https://mp.sohu.com/mpbp/bp/news/v4/users/news
https://mp.sohu.com/mpbp/bp/news/v4/users/stat/data/trend
https://mp.sohu.com/mpbp/bp/news/v4/users/stat/overall/detail?type=0&timeRange=1&accountId=%s
https://mp.sohu.com/mpfe/v3/main/first/page?newsType=1
https://mp.sohu.com/mpfe/v3/main/news/addarticle?contentStatus=1
https://mp.sohu.com/mpfe/v3/main/news/addarticle?spm=smmp.articlelist.0.0&contentStatus=2&id=
https://mp.sohu.com/mpfe/v3/main/news/addvideo
https://mp.sohu.com/mpfe/v3/main/plateform/profitnew
https://mp.sohu.com/mpfe/v3/main/watermark
https://mp.sohu.com/mpfe/v4/contentManagement/first/page
https://mp.sohu.com/mpfe/v4/contentManagement/news/addvideo
https://mp.sohu.com/mpfe/v4/data/analysis
https://mp.sohu.com/platform-profit/profit/totalProfit?accountId=%s&_=%s
https://mp.sohu.com/platform-profit/profit/trend
https://mp.sohu.com/v3/users/news/?newsType=1&statusType=1&pno=1&psize=10&_=1523329965235
https://mp.sohu.com/v3/users/profile
https://mp.toutiao.com
https://mp.toutiao.com/
https://mp.toutiao.com/api/feed/hotboard_online/v1/
https://mp.toutiao.com/api/feed/mp_provider/v1/
https://mp.toutiao.com/api/feed/mp_search/v1/
https://mp.toutiao.com/comment/author_receive_comment/
https://mp.toutiao.com/feoffline/mp-article-preview/graphic
https://mp.toutiao.com/media/permissions/article/post/
https://mp.toutiao.com/media_income/data/ad_video_income/
https://mp.toutiao.com/mp/agw/activity/list/v2/
https://mp.toutiao.com/mp/agw/article/publish
https://mp.toutiao.com/mp/agw/article/wtt
https://mp.toutiao.com/mp/agw/article/wtt/list
https://mp.toutiao.com/mp/agw/article_material/photo/upload_picture
https://mp.toutiao.com/mp/agw/creator_center/delete_draft?app_id=1231
https://mp.toutiao.com/mp/agw/creator_center/list
https://mp.toutiao.com/mp/agw/creator_center/user_info
https://mp.toutiao.com/mp/agw/creator_helper/spell_check_switch
https://mp.toutiao.com/mp/agw/creator_helper/suggest_words
https://mp.toutiao.com/mp/agw/income/overview/income/details?start_date=%s&end_date=%s&only_mid_income=0
https://mp.toutiao.com/mp/agw/media/get_media_info
https://mp.toutiao.com/mp/agw/statistic/profile/profile_stat
https://mp.toutiao.com/mp/agw/statistic/v2/content/stat_trends?type=0&from=%s&to=%s
https://mp.toutiao.com/mp/agw/statistic/v2/content_stat?type=0
https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat
https://mp.toutiao.com/mp/agw/statistic/v2/helper/latest_ready_date?type=0
https://mp.toutiao.com/mp/agw/statistic/v2/item/income_analyse
https://mp.toutiao.com/mp/agw/statistic/v2/item/info
https://mp.toutiao.com/mp/agw/statistic/v2/item/list
https://mp.toutiao.com/mp/agw/statistic/v2/item/traffic_analyse
https://mp.toutiao.com/mp/agw/statistic/v2/item/traffic_source
https://mp.toutiao.com/mp/agw/statistic/v2/item/user_property
https://mp.toutiao.com/pgc/mp/income/income_statement_abstract?only_mid_income=false&days=30
https://mp.toutiao.com/profile_v2/articles/own
https://mp.toutiao.com/profile_v3/index
https://mp.toutiao.com/profile_v3/smallvideo
https://mp.toutiao.com/profile_v3/smallvideo/publish
https://mp.toutiao.com/profile_v3/weitoutiao
https://mp.toutiao.com/profile_v3/xigua/content-manage
https://mp.toutiao.com/profile_v3/xigua/upload-video
https://mp.toutiao.com/profile_v4/activity/hot-spot
https://mp.toutiao.com/profile_v4/activity/task-list
https://mp.toutiao.com/profile_v4/analysis/works-single/article
https://mp.toutiao.com/profile_v4/analysis/works-single/small_video
https://mp.toutiao.com/profile_v4/analysis/works-single/video
https://mp.toutiao.com/profile_v4/analysis/works-single/weitoutiao
https://mp.toutiao.com/profile_v4/analysis/works-single/wenda
https://mp.toutiao.com/profile_v4/graphic/publish
https://mp.toutiao.com/profile_v4/manage/comment/all
https://mp.toutiao.com/profile_v4/manage/draft
https://mp.toutiao.com/profile_v4/weitoutiao/publish
https://mp.toutiao.com/profile_v4/xigua/content-manage-v2?is_new_connect=0&is_new_user=0
https://mp.toutiao.com/profile_v4/xigua/upload-video
https://mp.toutiao.com/profile_v4/xigua/upload-video/
https://mp.toutiao.com/thread/delete_thread/
https://mp.toutiao.com/tools/catch_picture/?&
https://mp.toutiao.com/tools/upload_picture/?pgc_watermark=0
https://mp.toutiao.com/tools/upload_picture/?type=ueditor&action=uploadimage&encode=utf-8
https://mp.toutiao.com/tt-anti-token
https://mp.toutiao.com/ugc/publish/video/v1/get_token/
https://mp.toutiao.com/ugc/publish/video/v4/commit/
https://mp.toutiao.com/ugc/video/v1/aweme/is_sync/
https://mp.toutiao.com/video/video_api/
https://mp.toutiao.com/xigua/api/contract/GetContractInfoList/
https://mp.toutiao.com/xigua/api/upload/PublishVideo
https://mp.toutiao.com/xigua/api/upload/getAuthKey/
https://mp.toutiao.com/xigua/api/video/getarticlesv2/
https://mp.v.qq.com
https://mp.v.qq.com/
https://mp.weixin.qq.com
https://mp.weixin.qq.com/cgi-bin/
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=5&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/videomsg_edit&action=video_edit&type=15&isNew=1&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/appmsgpublish
https://mp.weixin.qq.com/cgi-bin/cropimage
https://mp.weixin.qq.com/cgi-bin/filetransfer
https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssend
https://mp.weixin.qq.com/cgi-bin/masssend?action=check_ad&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssend?action=check_hot_time
https://mp.weixin.qq.com/cgi-bin/masssend?action=check_music
https://mp.weixin.qq.com/cgi-bin/masssend?action=check_same_material
https://mp.weixin.qq.com/cgi-bin/masssend?action=check_same_material&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssend?action=check_send_time&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssend?action=get_appmsg_copyright_stat&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssend?action=time_send&t=ajax-response&lang=zh_CN&
https://mp.weixin.qq.com/cgi-bin/masssend?action=time_send&t=ajax-response&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssend?t=ajax-response&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/masssendpage
https://mp.weixin.qq.com/cgi-bin/masssendpage?t=mass/send&type=10&appmsgid=%s&token=%s&lang=zh_CN
https://mp.weixin.qq.com/cgi-bin/operate_appmsg
https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=update&type=77&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/uploadimg2cdn?lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/user_tag?action=get_all_data&lang=zh_CN&token=
https://mp.weixin.qq.com/cgi-bin/video?action=operate_mp_video
https://mp.weixin.qq.com/cgi-bin/videoupload
https://mp.weixin.qq.com/misc/appmsganalysis?action=report&token=
https://mp.weixin.qq.com/misc/datacubequery
https://mp.weixin.qq.com/misc/getheadimg?fakeid=
https://mp.weixin.qq.com/misc/safeassistant?1=1&lang=zh_CN&token=
https://mp.weixin.qq.com/misc/useranalysis?=&token=
https://mp.weixin.qq.com/misc/useranalysis?begin_date=
https://mp.weixin.qq.com/misc/useranalysis?token=
https://mp.weixin.qq.com/misc/videoanalysis?action=stat_all_video_page&token=
https://mp.weixin.qq.com/promotion/publisher/publisher_stat
https://mp.weixin.qq.com/s
https://mp.weixin.qq.com/safe/safeqrcode?ticket=%s&uuid=%s&action=check&type=msgs&msgid=%s
https://mp.weixin.qq.com/safe/safeqrconnect?1=1&lang=zh_CN&token=
https://mp.weixin.qq.com/safe/safeuuid?timespam=%s&lang=zh_CN&token=%s
https://mp.wutiao.com
https://mp.wutiao.com/
https://mp.wutiao.com/main
https://mp.wutiao.com/main/manage
https://mp.wutiao.com/main/manage/video
https://mp.wutiao.com/main/publish
https://mp.wutiao.com/main/publish/video
https://mp.wutiao.com/static/ueditor/dialogs/image/image.html?r=1002
https://mp.xueqiu.com
https://mp.xueqiu.com/
https://mp.xueqiu.com/dataview/content
https://mp.xueqiu.com/write/
https://mp.xueqiu.com/xq/analysis/creator/data_center/analysis_overview.json
https://mp.xueqiu.com/xq/analysis/creator/data_center/query_overview.json
https://mp.xueqiu.com/xq/photo/upload.json
https://mp.xueqiu.com/xq/provider/session/token.json?api_path=%2Fstatuses%2Fupdate.json
https://mp.xueqiu.com/xq/search/statuses/long.json
https://mp.xueqiu.com/xq/statuses/draft/fail_list.json
https://mp.xueqiu.com/xq/statuses/draft/save.json
https://mp.xueqiu.com/xq/statuses/original/user_status_info.json
https://mp.xueqiu.com/xq/statuses/update.json
https://mp.yiche.com/
https://mp.yidianzixun.com
https://mp.yidianzixun.com/
https://mp.yidianzixun.com/api/get-Article-id
https://mp.yidianzixun.com/api/post/publish?
https://mp.yidianzixun.com/api/post/schedule/create
https://mp.yidianzixun.com/api/refact-get-main-data2?_rk=%s
https://mp.yidianzixun.com/api/settlement-system/cpm-income-info?_rk=%s
https://mp.yidianzixun.com/api/settlement-system/current-info?_rk=%s
https://mp.yidianzixun.com/api/source-data
https://mp.yidianzixun.com/model/Activity
https://mp.yidianzixun.com/model/Article
https://mp.yidianzixun.com/model/Article/
https://mp.yidianzixun.com/upload
https://mp.youku.com
https://mp.youku.com/new/upload?detail=true
https://mp.youku.com/new/video?vertical=0
https://mp.youku.com/new/video?vertical=1
https://mp.youku.com/pdo/query
https://mp.youku.com/video-upload/complete.json
https://mp.youku.com/video-upload/create.json
https://mp.youku.com/video-upload/file-complete.json
https://mp.youku.com/video-upload/save.json
https://mp.youku.com/video/get
https://mp.yuncheapp.cn
https://mp.yuncheapp.cn/admin/html/media/summary.html
https://mp.yuncheapp.cn/admin/html/media/works/publish.html?_t=
https://mp.yuncheapp.cn/wemedia-server/api/v1/account/info?
https://mp.yuncheapp.cn/wemedia-server/api/v1/editor/save
https://mp.yuncheapp.cn/wemedia-server/api/v1/uploadFile
https://mpapi.qutoutiao.net/content/changeStatus
https://mpapi.qutoutiao.net/content/checkTitle
https://mpapi.qutoutiao.net/content/getList
https://mpapi.qutoutiao.net/content/saveNew
https://mpapi.qutoutiao.net/content/setLocalChannel
https://mpapi.qutoutiao.net/upload/grabImage
https://mpapi.qutoutiao.net/video/edit
https://mpapi.qutoutiao.net/video/getList
https://mpapi.qutoutiao.net/video/signature
https://mpapi.qutoutiao.net/video/uploadReport
https://mparticle.uc.cn/article.html?
https://mssdk.bytedance.com/web/common
https://mvimg11.meitudata.com/
https://my.pcauto.com.cn/
https://my.pcauto.com.cn/index.jsp
https://my.pcauto.com.cn/intf/checkLogin.jsp
https://my.pcauto.com.cn/setting/face.jsp
https://my.tv.sohu.com/user/a/wvideo/captcha
https://my.tv.sohu.com/user/a/wvideo/pup
https://my.tv.sohu.com/user/a/wvideo/save.do
https://my.tv.sohu.com/user/a/wvideo/update.do
https://nls-gateway.cn-shanghai.aliyuncs.com/rest/v1/tts/async
https://nls-gateway.cn-shanghai.aliyuncs.com/stream/v1/FlashRecognizer
https://ns.dayu.com/article/imageResave
https://ns.dayu.com/article/imageUpload
https://ns.dayu.com/article/imagecut
https://ns.dayu.com/article/outsiteImgUpload
https://om.qq.com
https://om.qq.com/
https://om.qq.com/VideoManager/UpdateVideoInfo?relogin=1
https://om.qq.com/VideoUpload/FtnReady?g_tk=
https://om.qq.com/article/articlePublish
https://om.qq.com/image/cropupload?relogin=1
https://om.qq.com/image/orginalupload
https://om.qq.com/maccountsetting/basicinfo/?relogin=1
https://om.qq.com/main
https://om.qq.com/main/creation/article
https://om.qq.com/main/creation/video
https://om.qq.com/main/feature/crowd
https://om.qq.com/main/feature/crowdDetail?id=
https://om.qq.com/main/feature/hot-events
https://om.qq.com/main/statistic/article
https://om.qq.com/main/statistic/video
https://om.qq.com/marticle/article/list
https://om.qq.com/marticlepublish/getPublishRemain
https://om.qq.com/marticlepublish/omBatchPublish
https://om.qq.com/marticlepublish/omBatchSave
https://om.qq.com/marticlepublish/omPublish
https://om.qq.com/marticlepublish/omSave
https://om.qq.com/marticlepublish/omSchedulePublish
https://om.qq.com/marticlepublish/upload/omFinishUpload
https://om.qq.com/marticlepublish/upload/omPrepareUpload
https://om.qq.com/mindex/homeInfo?app=all&relogin=1
https://om.qq.com/mother/crowdsource/getactivityInfo4Media
https://om.qq.com/mother/crowdsource/haveSigned
https://om.qq.com/mother/crowdsource/signContract
https://om.qq.com/mother/hot-events/getList
https://om.qq.com/mstatistic/income/GetFlowIncomeList
https://om.qq.com/mstatistic/ommixin/GetArticleReadpvStatistic
https://om.qq.com/mstatistic/ommixin/GetVideoPlayvvStatistic
https://om.qq.com/userAuth/SignIn?relogin=1
https://oss-cn-
https://p26-passport.byteacctimg.com/img/motor-img/f01ea16499ec70084a0765d80320da9e~noop.jpg
https://page.om.qq.com/page
https://passport.baidu.com/v3/api/user/info
https://passport.baidu.com/v6/ucenter
https://passport.iqiyi.com/apis/user/info.action
https://passport.weibo.com/visitor/visitor
https://passport.weibo.com/visitor/visitor?entry=miniblog&a=enter&url=
https://pbaccess.video.qq.com/com.tencent.qqlive.protocol.pb.PublishService/doPublishAction
https://pbaccess.video.qq.com/trpc.creator_center.backend.UploadSvc/SetVideoInfo
https://pbaccess.video.qq.com/trpc.creator_center.backend.UploadSvc/UploadSuccNotify
https://pbaccess.video.qq.com/trpc.creator_center.backend.UploadSvc/UploadWebInit
https://pbaccess.video.qq.com/trpc.creator_center.entrance.CreatorProfileService/GetProfile?origin=1
https://pic2.zhimg.com/80/
https://picupload.weibo.com/interface/pic_upload.php
https://plat-gw.jd.com/daren/author/query
https://post.mp.qq.com/kan/article/
https://pro.xiaohongshu.com/api/eros/user/info
https://pro.xiaohongshu.com/enterprise/home
https://public.17van.com/info/check
https://public.17van.com/info/getCommentLimit
https://public.17van.com/info/getUserInfo
https://public.17van.com/info/rmbCheck
https://public.17van.com/office/DocxToHtml
https://public.17van.com/office/read
https://q.qlogo.cn/g?b=qq&nk=
https://qac-qupost.qutoutiao.net/member/getMemberInfo
https://qac.vip.qq.com/pages/myWork.html#/creator/create
https://qqzz.qq.com
https://qqzz.qq.com/index
https://qqzz.qq.com/public/index/trpc?nameSpace=AccountRead&cmd=GetUserOverviewData
https://quanmin.baidu.com
https://quanmin.baidu.com/web/publish/manage
https://quanmin.baidu.com/web/publish/upload
https://quanmin.baidu.com/wise/video/pcpub/Videolist
https://quanmin.baidu.com/wise/video/pcpub/finishupload
https://quanmin.baidu.com/wise/video/pcpub/getuploadid?video_num=1
https://quanmin.baidu.com/wise/video/pcpub/publishvideo
https://quanmin.baidu.com/wise/video/pcpub/uploadposter
https://quanmin.baidu.com/wise/video/pcpub/uploadvideopart
https://quanmin.baidu.com/wise/video/pcpub/userinfo?isAjax=1
https://qupload.qutoutiao.net/api/v2.0/image/uploadBase64
https://qupload.qutoutiao.net/api/v2.0/image/watermark
https://qupload.qutoutiao.net/api/v2.0/ueditor/controller
https://qupost-oss.1sapp.com/
https://rong.tt.cn
https://rong.tt.cn/deldraftlist
https://rong.tt.cn/east-content/dfh/contentModule/originalFileUploadController/originalImageUpload
https://rong.tt.cn/east-content/dfh/contentModule/publishArticleController/getContentListInfo
https://rong.tt.cn/east-content/dfh/contentModule/publishArticleController/publishNewArticle
https://rong.tt.cn/east-content/dfh/contentModule/publishVideoController/publishVideo
https://rong.tt.cn/east-content/dfh/contentModule/publishVideoController/uploadVideo
https://rong.tt.cn/east-content/dfh/contentModule/selfMediaDraftController/addSelfMediaDraft
https://rong.tt.cn/east-content/dfh/contentModule/selfMediaDraftController/editSelfMediaDraft
https://rong.tt.cn/east-content/dfh/contentModule/ueditor/config?action=catchimage&
https://rong.tt.cn/east-content/dfh/contentModule/ueditor/config?action=uploadimage&encode=utf-8
https://rong.tt.cn/east-usercenter/user_center/user_manager/usercenter1
https://rong.tt.cn/index.html
https://rong.tt.cn/newpagewrit
https://rong.tt.cn/newpagewrite?
https://rong.tt.cn/pagearticlelist.html
https://rong.tt.cn/pageindex
https://rsbjh.baidu.com/builder/author/video/canceluploadVideo
https://rsbjh.baidu.com/builder/author/video/uploadVideo
https://rym.quwenge.com/baidu_tiaozhuan.php
https://rym.quwenge.com/baidu_tiaozhuan.php?
https://secupload.iqiyi.com/common_upload
https://sh.qihoo.com/pc/detail
https://sh.ugc.ftn.qq.com/ftn_handler
https://share.iclient.ifeng.com/vampire/shareNews?
https://sign.17van.com/code/deliver
https://sign.17van.com/dryab/deliver
https://sign.17van.com/krs/deliver
https://sign.17van.com/trt/deliver
https://skserver.ifeng.com/cos/getCredential
https://static.17van.com/bc/z/
https://static.17van.com/bc/zh/
https://studio.ixigua.com
https://studio.ixigua.com/
https://studio.ixigua.com/?is_new_connect=0&is_new_user=0
https://studio.ixigua.com/api/comment/GetCreatorCommentList/
https://studio.ixigua.com/api/content/list
https://studio.ixigua.com/api/content/short_list
https://studio.ixigua.com/api/data/data_trend_v2
https://studio.ixigua.com/api/data/home
https://studio.ixigua.com/api/data/overview_data_v3
https://studio.ixigua.com/api/income/overview
https://studio.ixigua.com/api/income/total
https://studio.ixigua.com/api/upload/CreateItem/
https://studio.ixigua.com/api/upload/getAuthKey/
https://studio.ixigua.com/comment
https://studio.ixigua.com/content
https://studio.ixigua.com/data
https://studio.ixigua.com/upload
https://studio.ixigua.com/upload?from=post_article
https://studio.ixigua.com/upload?gid=
https://studio.ximalaya.com/
https://studio.ximalaya.com/api/home/userInfo
https://summon.bytedance.com/secsdk_csrf_token
https://sweb.alipay.com
https://sweb.alipay.com/
https://sweb.alipay.com/p/talent/index
https://tieba.baidu.com
https://tieba.baidu.com/c/u/pc/homeSidebarRight?subapp_type=pc&_client_type=20&sign=e9b101df871c39eedcf9a232c2d26ec8
https://tieba.baidu.com/home/main
https://transmission.ifeng.com/fileInfo
https://transmission.ifeng.com/upload
https://tsearch.amemv.com/openapi/aweme/v1/music/search/
https://tv.sohu.com
https://tv.sohu.com/
https://ums-origin-file.oss-cn-hangzhou.aliyuncs.com
https://upload-oss.vzuu.com/
https://upload.iqiyi.com/split_upload_finish
https://upload.iqiyi.com/split_upload_request
https://upload.kuaishouzt.com
https://upload.qiniup.com/
https://userapi-ums.uc.cn/3/certificate/get
https://userapi-ums.uc.cn/3/certificate/init
https://v-api-plus.huya.com/jsapi/getUserInfo
https://v.163.com/static/1/
https://v.douyu.com
https://v.douyu.com/member/mycreate/center
https://v.douyu.com/member/mycreate/center#/home
https://v.douyu.com/member/user/getUserInfo
https://v.huya.com/
https://v.huya.com/videomanage/published
https://v.qq.com
https://v.qq.com/
https://v.qq.com/cm/upload/index.html
https://v.qq.com/x/page/
https://v.youku.com/v_show/id_
https://vas-lf-x.snssdk.com/video/openapi/v1/
https://vas-lf-x.snssdk.com/video/openapi/v1/?action=UpdateVideoUploadInfos&
https://vas.snssdk.com/video/openapi/v1/
https://video-content-input.oss-cn-
https://video-content-input.oss-cn-shanghai.aliyuncs.com/video/
https://video-yidian.ks3-cn-beijing.ksyun.com/
https://video.kuaishou.com/short-video/
https://videotranspond.3g.qq.com/busiproxy/auth
https://videotranspond.3g.qq.com/busiproxy/notify
https://videotranspond.3g.qq.com/v2/upload/finishupload
https://videotranspond.3g.qq.com/v2/upload/uploadpart
https://videotranspond.3g.qq.com/v2/video/prepare
https://videotranspondplus.3g.qq.com/v2/upload/finishupload
https://videotranspondplus.3g.qq.com/v2/upload/uploadpart
https://vod.bytedanceapi.com/
https://vod.bytedanceapi.com/?
https://vod2.qcloud.com/v3/index.php?Action=ApplyUploadUGC
https://vod2.qcloud.com/v3/index.php?Action=CommitUploadUGC
https://war.163.com/
https://we.taobao.com/
https://weibo.com
https://weibo.com/
https://weibo.com/aj/account/watermark
https://weibo.com/aj/mblog/del
https://weibo.com/ajax/multimedia/dispatch?
https://weibo.com/ajax/statuses/mymblog
https://weibo.com/ajax/statuses/schedule/upload
https://weibo.com/ajax/statuses/update
https://weibo.com/ajax/statuses/user/count_limit
https://weibo.com/ttarticle
https://weibo.com/ttarticle/
https://weibo.com/u/
https://weibo.com/upload/channel
https://weibo.com/zimtzs/home
https://weibo.com/zimtzs/home?wvr=5&lf=reg
https://weixin.sogou.com
https://www.163.com/dy/article/
https://www.360kuai.com/
https://www.360kuai.com/pc/detail
https://www.9kd.com
https://www.9kd.com/api/kd-content/income/articleIncomeDetail
https://www.9kd.com/api/kd-content/kd/contents/list
https://www.9kd.com/api/kd-content/kd/contents/save
https://www.9kd.com/api/kd-group/oss/uploadFile
https://www.9kd.com/api/kd-ucenter/personal/info
https://www.9kd.com/api/kd-ucenter/user/income/queryUserIncomeInfo
https://www.9kd.com/kdhao/home
https://www.9kd.com/note/
https://www.acfun.cn/rest/pc-direct/user/personalInfo
https://www.baidu.com/
https://www.baidu.com/ssid=0/from=844b/s
https://www.bilibili.com/read/cv
https://www.bilibili.com/video/av
https://www.douyin.com
https://www.douyin.com/aweme/v1/web/notice/
https://www.douyin.com/user/self?from_tab_name=main&showTab=like
https://www.duxuntoutiao.cn
https://www.duxuntoutiao.cn/member/article.do
https://www.duxuntoutiao.cn/member/submitarticle.do
https://www.duxuntoutiao.cn/ueditor/jsp/controller.jsp
https://www.duxuntoutiao.cn/webservice/getcategorydict.do
https://www.duxuntoutiao.cn/webservice/getmemberfromid.do
https://www.ixigua.com/
https://www.jianshu.com
https://www.jianshu.com/
https://www.jianshu.com/author/notebooks
https://www.jianshu.com/author/notes/
https://www.jianshu.com/p/
https://www.jianshu.com/u/
https://www.jianshu.com/upload_images/token.json
https://www.jianshu.com/writer
https://www.meipai.com
https://www.meipai.com/media/
https://www.meipai.com/medias/convert_request
https://www.meipai.com/medias/get_token
https://www.meipai.com/medias/get_upload_token
https://www.meipai.com/medias/upload
https://www.meipai.com/medias/video_convert_list
https://www.meipai.com/medias/video_status
https://www.meipian.cn
https://www.meipian.cn/api/user/getInfo
https://www.meipian.cn/mine/
https://www.pipix.com
https://www.pipix.com/
https://www.pipix.com/api
https://www.pipix.com/api/mp/bds/webapi/get_auth/
https://www.pipix.com/api/mp/bds/webapi/item_list/
https://www.pipix.com/api/mp/bds/webapi/item_post/
https://www.pipix.com/api/mp/bds/webapi/media_type_stat/
https://www.pipix.com/api/mp/bds/webapi/overall_stats/
https://www.pipix.com/mp/manage
https://www.pipix.com/mp/upload
https://www.sohu.com/a/
https://www.toutiao.com
https://www.toutiao.com/
https://www.toutiao.com/a
https://www.toutiao.com/api/pc/feed/
https://www.toutiao.com/article/
https://www.toutiao.com/video/
https://www.weibo.com/
https://www.xiaohongshu.com/explore/
https://www.xiaohongshu.com/fe_api/burdock/v1/notes
https://www.xiaohongshu.com/fe_api/burdock/v2/shield/registerCanvas?p=cc&callFrom=creator-platform
https://www.xiaohongshu.com/fe_api/burdock/web/v2/poi/position/list
https://www.xiaohongshu.com/fe_common_api/burdock/upload/v4/qcloud/token
https://www.xiaohongshu.com/fe_common_api/burdock/upload/v4/qiniu/token
https://www.yidianzixun.com/article/
https://www.youku.com/profile/index
https://www.zhihu.com
https://www.zhihu.com/
https://www.zhihu.com/api/v3/scraper
https://www.zhihu.com/api/v4/content/publish
https://www.zhihu.com/api/v4/creators/analysis/aggregation/tab/article
https://www.zhihu.com/api/v4/creators/analysis/aggregation/tab/follow
https://www.zhihu.com/api/v4/creators/analysis/aggregation/tab/video
https://www.zhihu.com/api/v4/creators/analysis/realtime/member/daily
https://www.zhihu.com/api/v4/creators/benefit/daily_statistics
https://www.zhihu.com/api/v4/creators/benefit/income_statistics
https://www.zhihu.com/api/v4/creators/creations/article
https://www.zhihu.com/api/v4/creators/creations/pin
https://www.zhihu.com/api/v4/creators/creations/zvideo
https://www.zhihu.com/api/v4/me
https://www.zhihu.com/api/v4/pins
https://www.zhihu.com/creator/manage/creation/pin
https://www.zhihu.com/creator/video-support
https://www.zhihu.com/organization/manage/creation/article
https://www.zhihu.com/organization/manage/creation/zvideo
https://www.zhihu.com/organization/question/hot
https://www.zhihu.com/organization/question/recommend
https://www.zhihu.com/pin/
https://www.zhihu.com/upload-video
https://www.zhihu.com/zvideo/
https://www.zhihu.com/zvideo/upload-video
https://wx3.sinaimg.cn/large/
https://xavatar.imedao.com/
https://xueqiu.com/
https://xueqiu.com/statuses/original/show.json
https://zhidao.baidu.com/ihome/homepage
https://zhidao.baidu.com/ihome/set/profile
https://zhihu-pics-upload.zhimg.com/
https://zhiyou.smzdm.com/user
https://zhiyou.smzdm.com/user/info/jsonp_get_current
https://zhuanlan.zhihu.com
https://zhuanlan.zhihu.com/api/articles/
https://zhuanlan.zhihu.com/api/articles/drafts
https://zhuanlan.zhihu.com/p/
https://zhuanlan.zhihu.com/write
```

## 错误/日志格式串（反映内部设计）

共 785 条（节选前 60）：

```
 (INVALID PSS PARAMETERS)

 ::WeiboGetPayInfo Fail %d
 ::WeiboSetPayInfo Fail %d
 ?warning: specified rate is unreasonably large (%lu > %lu)

 uncorrected errors
%lu: Invalid strip byte count, strip %lu
%lu: Invalid tile byte count, tile %lu
%s constraint failed
%s constraint failed: %s
%s(%d): OpenSSL internal error, assertion failed: %s

%s: Decoding error at scanline %d, %s
%s: Encoder error: %s
%s: Error fetching directory count
%s: Error fetching directory link
%s: Error writing SubIFD directory link
%s: Invalid %stag "%s" (not supported by codec)
%s: Invalid InkNames value; expecting %d names, found %d
%s: Read error at row %ld, col %ld, tile %ld; got %lu bytes, expected %lu
%s: Read error at row %ld, col %ld; got %lu bytes, expected %lu
%s: Read error at scanline %lu, strip %lu; got %lu bytes, expected %lu
%s: Read error at scanline %lu; got %lu bytes, expected %lu
%s: Read error on strip %lu; got %lu bytes, expected %lu
%s: Seek error at row %ld, col %ld, tile %ld
%s: Seek error at scanline %lu
%s: Seek error at scanline %lu, strip %lu
%s: Write error at scanline %lu
%s: zlib error: %s
.?AU?$error_info_injector@Vlock_error@boost@@@exception_detail@boost@@
.?AU?$error_info_injector@Vthread_resource_error@boost@@@exception_detail@boost@@
.?AUbad_alloc_@exception_detail@boost@@
.?AUbad_exception_@exception_detail@boost@@
.?AV?$clone_impl@U?$error_info_injector@Vlock_error@boost@@@exception_detail@boost@@@exception_detail@boost@@
.?AV?$clone_impl@U?$error_info_injector@Vthread_resource_error@boost@@@exception_detail@boost@@@exception_detail@boost@@
.?AV?$clone_impl@Ubad_alloc_@exception_detail@boost@@@exception_detail@boost@@
.?AV?$clone_impl@Ubad_exception_@exception_detail@boost@@@exception_detail@boost@@
.?AV?$sp_counted_impl_p@Um_imp@filesystem_error@filesystem@boost@@@detail@boost@@
.?AV?$sp_counted_impl_p@V?$clone_impl@Ubad_alloc_@exception_detail@boost@@@exception_detail@boost@@@detail@boost@@
.?AV?$sp_counted_impl_p@V?$clone_impl@Ubad_exception_@exception_detail@boost@@@exception_detail@boost@@@detail@boost@@
.?AVCAtlException@ATL@@
.?AVCppSQLite3Exception@@
.?AVException@Json@@
.?AVLogicError@Json@@
.?AVRuntimeError@Json@@
.?AV_Node_assert@tr1@std@@
.?AVbad_exception@std@@
.?AVclone_base@exception_detail@boost@@
.?AVcodecvt_error_cat@?A0xc83bcab9@@
.?AVerror_category@system@boost@@
.?AVexception@boost@@
.?AVexception@std@@
.?AVfilesystem_error@filesystem@boost@@
.?AVgeneric_error_category@?A0x50f87f8e@system@boost@@
.?AVlock_error@boost@@
.?AVlogic_error@std@@
.?AVruntime_error@std@@
.?AVsystem_error@system@boost@@
.?AVsystem_error_category@?A0x50f87f8e@system@boost@@
.?AVthread_exception@boost@@
.?AVthread_resource_error@boost@@
0123456789ABCDEFlibpng error: %s

```

## 配置键（反映可调参数）

共 292 条：

```
CellWidth
CollectCount
CommentCount
DiggCount
FlushConsoleInputBuffer
GetAuthAccountListUnReadCount
GetExitCodeThread
GetFileSize
GetTickCount
HeapSize
ImageFullWidth
ImageWidth
ImpressionCount
InitializeCriticalSectionAndSpinCount
MemMax
OffsetLimit
OverallBitRate
PageSize
Pagecount
PlayCount
RepinCount
ResetCount
ResumeThread
TerminateThread
TileWidth
TotalCount
VideoHeight
VideoViewCount
VideoWidth
XResolution
YResolution
abitrate
account
accountLimit
articleCollectCount
articleCommentCount
articleViewCount
asspath
attitudes_count
audiopath
authLimit
backup_account_from_addaccount
backup_account_from_loginaccount
bg_music_file_path
blockCount
busy_timeout
cache_size
can_account
cardlimit
cblkheight
cblkwidth
change_count
checkincomethreadcount
clipPath
clippath
collectCount
collect_count
collected_count
commentCount
commentLimit
comment_count
comment_monitor_limit
comments_count
cookiePath
coverSize
cover_image_path
cover_path
coverpath
custom_cover_image_height
custom_cover_image_width
dSAQuality
danmaku_count
default_cache_size
destbitrate
detail_play_effective_count
diggCount
digg_count
discussLimit
dislike_count
display_count
dougaPlayCount
download_count
dy_account
endDayCount
failedcount
failureCount
fansCount
fans_change_count
fans_count
farward_count
favCount
fav_count
favorite_count
favourLimit
ffmpegpath
filePath
fileSize
file_count
file_path
file_save_path
file_size
filepath
filesize
finalpath
first_level
followCount
follow_count
follower_count
followers_count
fontsize
format_height
format_width
forwardAggregationCount
forwardAllChatCount
forwardCount
forwardSnsCount
forward_aggregation_count
forward_allchat_count
forward_count
forward_sns_count
fragment_count
freelist_count
fsize
getVideoPlayCount
getmediacommentthreadcount
getnetimagefromsyncarticleretry
global_wechat_qrcode_path
go_detail_count
gt_scenen_thread
history_day_count
homepage_visit_count
imLimit
im_monitor_limit
image_avg_view_count
img_height
img_width
imgheight
imgsize
imgwidth
impression_count
increase_fans_count
increment_status_view_count
inputPath
journal_size_limit
large_file_size
lastBuffer
likeCount
like_count
likes_count
longimageheight
longimagewidth
markerHeight
markerWidth
markerheight
markerwidth
max_page_count
max_part_size
mmap_size
new_fans_count
opendir
oriHeight
oriWidth
overallbitrate
pageCount
pageSize
page_count
page_size
pagesize
partSize
partsize
pathcount
pictureCount
pictureFilePath
playCount
playLimit
play_count
plevel
poi_count
poster_height
poster_width
praiseCount
prcheight
prcwidth
psize
publisharticleretry
pvCount
quanmin
readCount
read_count
readdir
reads_count
realheight
realwidth
rec_count
recommendCount
recommend_count
recommended_count
redtip_remain_count
repeatCount
repeatcount
replyLimit
reply_count
reposts_count
retweet_count
ring_set_count
ringsetCount
rise_fans_count
rootdir
saveHeight
saveWidth
screen_height
screen_width
second_level
send_remain_count
shareCount
share_count
shared_count
showCount
singleLevelQuality
size_count
sliceSize
slice_size
sns_cover_count
snscoverCount
soft_heap_limit
status_ref_count
statusrefCount
storagePath
storepath
subUserLimit
subscribe_count
subscriberCount
subtreeMaximumQuality
subtreeMinimumQuality
succount
sumCount
syncArticleLimit
syncVideoLimit
syncarticleretry
targetHeight
targetWidth
textPath
textpath
thumb_height
thumb_width
tileheight
tilewidth
totalCount
totalFileSize
totalSubscribeCount
total_article_read_count
total_comment_count
total_count
total_digg_count
total_fans_count
total_farward_count
total_play_count
total_read_count
total_read_play_count
total_recommend_count
total_subscribe_count
total_video_play_count
unsubscribe_count
upCount
uploadTotalSize
uploadedSize
url_width_height
vbitrate
videoFileSize
videoLimit
videoSize
videoWatchCount
video_height
video_width
videocount
videopath
videosize
viewCount
view_count
viewcount
views_count
visit_count
winFileSize
wordcount
yesterdayReadCount
yesterday_article_read_count
yesterday_comment_count
yesterday_digg_count
yesterday_fans_count
yesterday_farward_count
yesterday_read_count
yesterday_video_play_count
```