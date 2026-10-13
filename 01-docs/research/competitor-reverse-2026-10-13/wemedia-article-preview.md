# 融媒宝 ArticlePreview —— 7 平台承载形态取证

> 来源：`D:\Program Files (x86)\融媒宝\Asset\ArticlePreview\`
> 目的：**交叉验证本项目的 `content-formatter` 承载形态登记表**
> 生成时间：2026-10-13T05:50:07.923Z

---

## 1. 机制：`ArticlePreview.setContent()`

var ArticlePreview = {
    setContent: function(title, content, account, author, headimg, media) {
        document.getElementById("title").innerHTML = title;
        document.getElementById("account_name").innerHTML = account;
        document.getElementById("content").innerHTML = content;
        var authorEle = document.getElementById("author_name");
        if (authorEle)
            authorEle.innerHTML = author;
        document.getElementById("preview_time").innerHTML = this.getPreviewTimeStr(media);
        var imgEle = document.getElementById("account_img");
        //console.log(imgEle.imgEle.getElementsByTagName("img")[0])
        imgEle.getElementsByTagName("img")[0].setAttribute("src", headimg);
    },


**关键**：内容通过 **`document.getElementById("content").innerHTML = content`** 注入 —— 
即**整篇内容被当作 HTML 解析**。

这解释了为什么 7 个平台各有一份预览页：**每个平台的正文渲染规则不同**，
融媒宝用「独立预览页 + 独立 CSS」来模拟各平台的实际显示效果。

---

## 2. 7 个平台的预览页与样式表

| 平台 | 预览页 | 样式表 | Frame CSS 大小 |
|---|---|---|---:|
| 百家号 baijiahao | `BaijiaPreview.html` | `BaijiaFrame.css` | 1.6 KB |
| 大鱼号 dayu | `DayuPreview.html` | `DayuFrame.css` | 3.2 KB |
| 企鹅号 qie | `QiePreview.html` | `QieFrame.css` | 0.8 KB |
| 搜狐号 sohu | `SohuPreview.html` | `SohuFrame.css` | 0.0 KB |
| 头条号 toutiao | `ToutiaoPreview.html` | `ToutiaoFrame.css` | 1.1 KB |
| 微信公众号 weixin | `WeixinPreview.html` | `WeixinFrame.css` | 1.1 KB |
| 一点号 yidian | `YidianPreview.html` | `YidianFrame.css` | 0.6 KB |

公共基础样式：`FrameBase.css`（所有预览页共同引用）

---

## 3. ⭐ 各平台测试夹具（暴露期望的内容形态）

每个预览页的 `test()` 里有一段**硬编码的示例内容**——这是开发者对「该平台正文长什么样」的理解。

### 百家号 baijiahao

```javascript
title = "场均出场46分钟砍41"
content = "<h1>efkowef</h1><blockquote><p>fewfewfewf</p></blockquote>"
// setContent(..., media="baijia")
```

### 大鱼号 dayu

```javascript
title = "场均出场46分钟砍41"
content = "<h1>efkowef</h1><blockquote><p>fewfewfewf</p></blockquote>"
// setContent(..., media="dayu")
```

### 企鹅号 qie

```javascript
title = "场均出场46分钟砍41"
content = "<h1>efkowef</h1><blockquote><p>fewfewfewf</p></blockquote>"
// setContent(..., media="qie")
```

### 搜狐号 sohu

```javascript
content = (未找到夹具)
```

### 头条号 toutiao

```javascript
title = "场均出场46分钟砍41"
content = "<p>r32r23r23r23r2r3</p><h1>efkowef</h1><blockquote><p>fewfewfewf</p></blockquote><p>r32r23r23r23r2r3</p>"
// setContent(..., media="toutiao")
```

### 微信公众号 weixin

```javascript
title = "场均出场46分钟砍41"
content = "<h1>efkowef</h1><blockquote><p>fewfewfewf</p></blockquote>"
// setContent(..., media="weixin")
```

### 一点号 yidian

```javascript
title = "场均出场46分钟砍41"
content = "<h1>efkowef</h1><blockquote><p>fewfewfewf</p></blockquote>"
// setContent(..., media="yidian")
```

---

## 4. ⭐ 各平台 Frame CSS（真实渲染规则）

### 百家号 baijiahao —— `BaijiaFrame.css`

```css
#title {
    margin-top: 15px;
    font-size: 20px;
}

#account {
    margin-top: 20px;
    position: relative;
}

#account_name {
    position: absolute;
    font-size: 12px;
    top: 0;
    left: 40px;
}

#preview_time {
    position: absolute;
    font-size: 10px;
    top: 15px;
    left: 40px;
    color: #666666;
}

blockquote, span.bjh-blockquote {
    margin: 18px 0 5px;
    padding: 6px 0 20px 30px;
    color: #989898;
    background-color: #fff;
    position: relative;
    line-height: 30px;
}

strong, bold, span.bjh-strong, span.bjh-bold {
    font-weight: 700;
}

h1 {
    position: relative;
    font-size: 18px;
    line-height: 26px;
    padding-left: 11px;
    font-weight: bold;
    margin: 1em 0;
}

h1::after {
    content: '';
    width: 3px;
    height: 17px;
    position: absolute;
    left: 0;
    top: 5px;
    background: #3c76ff;
}


blockquote:before {
    content: '';
    background-image: url('download.png');
    background-repeat: no-repeat;
    background-position: center center;
    width: 20px;
    height: 20px;
    position: absolute;
    display: inline-block;
    left: 0;
    top: 12px;
}

#content>h1 {
    font-size: 16px;
    margin: 1em 0;
}

body pre,body code{
    font-size:12px;
    line-height:1.5em;
    padding:10px;
    margin:15px 0;
    display:block;
    background:#F0F0F0;
    -webkit-border-radius:3px;
    -moz-border-radius:3px;
    border-radius:3px;
    font-family:monaco,Consolas,"Liberation Mono",Courier,monospace;
    white-space:pre;
    word-wrap:break-word;
    overflow-x:auto
}
```

### 大鱼号 dayu —— `DayuFrame.css`

```css
#title {
    padding: 20px 35px 12px;
    text-align: center;
    font-size: 20px;
    font-weight: bolder;
    margin: 0;
}

#account_img {
    text-align: center;
    line-height: 30px;
}

#account_img img {
    vertical-align: middle;
}


#account_name {
    margin-left: 10px;
    font-weight: bolder;
    font-size: 16px;
    
}

#preview_time_wrapper {
    text-align: center;
    margin-top: 15px;
}

#dayu_tip {
    display: inline-block;
    font-size: 13px;
    color: #bbb;
    margin-right: 8px;
}

#dayu_tip:before {
    content: ' ';
    display: inline-block;
    margin-right: 9px;
    font-size: 15px;
    -webkit-transform: rotate(26deg);
    transform: rotate(26deg);
    width: 0;
    height: 12px;
    border-left: 1px solid #bbb;
    position: relative;
    top: 2px;
}

#dayu_tip:after {
    content: ' ';
    display: inline-block;
    margin-left: 7px;
    font-size: 15px;
    -webkit-transform: rotate(26deg);
    transform: rotate(26deg);
    width: 0;
    height: 12px;
    border-right: 1px solid #bbb;
    position: relative;
    top: 2px;
}

#preview_time {
   font-size: 13px;
   color: #bbb;
   margin-right: 8px; 
}

@font-face {font-family: "iconfont";
  src: url('Dayufont.ttf') format("truetype"); 
}

.iconfont {
  font-family:"iconfont" !important;
  font-size:16px;
  font-style:normal;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.simple-ui {
    text-align: justify;
    overflow: hidden;
}

.simple-ui blockquote {
    position: relative;
    margin: 25.5px 0;
    padding: 25.5px 0;
}

.simple-ui blockquote:before {
    left: 20px;
}

.simple-ui blockquote:after {
    right: 20px;
}

.simple-ui blockquote .icon-quota .iconfont {
    font-size: 14px!important;
}

.simple-ui blockquote:before, .simple-ui blockquote:after, .simple-ui blockquote p:last-child::after {
    display: block;
    position: absolute;
    background-color: rgba(0,0,0,.05);
    height: 2px;
    top: 0;
    width: 40%;
    content: '';
}

.simple-ui blockquote .icon-quota {
    position: absolute;
    top: 0;
    left: 50%;
    margin: -12.5px 0 0 -12.5px;
    width: 25px;
    height: 25px;
    border-radius: 25px;
    background-color: #666;
    text-align: center;
    color: #FFF;
    line-height: 25px;
    font-size: 13px;
    padding: 0;
    -webkit-text-size-adjust: none!important;
}

.wm-icon-yinyong:before {
    content: "\e606";
}

.simple-ui h1, .simple-ui h2 {
    position: relative;
    font-size: 19px;
    color: #333;
    font-weight: 700;
    padding: 0 15px;
    padding-left: 25px;
}

.simple-ui p, .simple-ui h1, .simple-ui h2, .simple-ui hr, .simple-ui .weixin {
    margin: 20px 0;
}

.simple-ui blockquote p {
    color: #999;
    text-align: center;
    font-size: 16px;
    line-height: 32px;
    padding: 0 35px;
    margin: 0;
}

.simple-ui blockquote p:last-child::after {
    top: auto;
    left: 20px;
    right: 20px;
    bottom: 0;
    width: auto;
}

.simple-ui h1:before, .simple-ui h2:before {
    position: absolute;
    display: block;
    left: 15px;
    top: 5px;
    bottom: 5px;
    width: 4px;
    content: '';
    background-color: #333;
}
```

### 企鹅号 qie —— `QieFrame.css`

```css
#title {
    margin-top: 15px;
    font-size: 20px;
}

#account {
    margin-top: 20px;
    position: relative;
}

#account_name {
    position: absolute;
    font-size: 12px;
    top: 0;
    left: 40px;
}

#preview_time {
    position: absolute;
    font-size: 10px;
    top: 15px;
    left: 40px;
    color: #666666;
}

h1 {
    font-weight: normal;
    font-size: 16px;
    margin: 1em 0;
}

body pre,body code{
    font-size:12px;
    line-height:1.5em;
    padding:10px;
    margin:15px 0;
    display:block;
    background:#F0F0F0;
    -webkit-border-radius:3px;
    -moz-border-radius:3px;
    border-radius:3px;
    font-family:monaco,Consolas,"Liberation Mono",Courier,monospace;
    white-space:pre;
    word-wrap:break-word;
    overflow-x:auto
}
```

### 搜狐号 sohu —— `SohuFrame.css`

```css

```

### 头条号 toutiao —— `ToutiaoFrame.css`

```css
#title {
    margin-top: 15px;
    font-size: 20px;
}

#account {
    margin-top: 20px;
    position: relative;
}

#account_name {
    position: absolute;
    font-size: 12px;
    top: 0;
    left: 40px;
}

#preview_time {
    position: absolute;
    font-size: 10px;
    top: 15px;
    left: 40px;
    color: #666666;
}

blockquote {
    line-height:1.4;
    padding:12px 8px;
    color:#999;
    background-color:#F3F4F5;
    margin:10px 0
}

h1 {
    font-weight: 700;
    line-height: 24px;
    padding-left: 12px;
    font-size: 18px;
    position: relative;
    margin: 1em 0;
}

h1::after {
    content: "";
    width: 4px;
    height: 18px;
    background: #f85959;
    top: 3px;
    position: absolute;
    left: 0;
}

body pre,body code{
    font-size:12px;
    line-height:1.5em;
    padding:10px;
    margin:15px 0;
    display:block;
    background:#F0F0F0;
    -webkit-border-radius:3px;
    -moz-border-radius:3px;
    border-radius:3px;
    font-family:monaco,Consolas,"Liberation Mono",Courier,monospace;
    white-space:pre;
    word-wrap:break-word;
    overflow-x:auto
}
```

### 微信公众号 weixin —— `WeixinFrame.css`

```css
body {
    font-size: 14px;
}

#title {
    margin-top: 15px;
    font-size: 20px;
}

#account {
    margin-top: 20px;
    font-size: 14px;
}

#account_name {
    margin-left: 10px;
    color:#3f88bf
}

#preview_time {
    color: #666666;
}

#author_name {
    margin-left: 10px;
}

blockquote, span.bjh-blockquote {
    margin: 18px 0 5px;
    padding: 6px 0 20px 30px;
    color: #989898;
    background-color: #fff;
    position: relative;
    line-height: 30px;
}

h1, strong, bold, span.bjh-strong, span.bjh-bold {
    font-weight: 700;
}


blockquote {
    margin: 0;
    padding-left: 10px;
    border-left: 3px solid #dbdbdb;
}

#content>h1 {
    font-size: 16px;
    margin: 1em 0;
}

body pre,body code{
    font-size:12px;
    line-height:1.5em;
    padding:10px;
    margin:15px 0;
    display:block;
    background:#F0F0F0;
    -webkit-border-radius:3px;
    -moz-border-radius:3px;
    border-radius:3px;
    font-family:monaco,Consolas,"Liberation Mono",Courier,monospace;
    white-space:pre;
    word-wrap:break-word;
    overflow-x:auto
}
```

### 一点号 yidian —— `YidianFrame.css`

```css
#title {
    margin-top: 15px;
    font-size: 20px;
}

#account {
    margin-top: 20px;
    position: relative;
}

#account_name {
    position: absolute;
    font-size: 12px;
    top: 0;
    left: 40px;
}

#preview_time {
    position: absolute;
    font-size: 10px;
    top: 15px;
    left: 40px;
    color: #666666;
}

blockquote {
    color: #999;
    border-left: 5px solid #d5d5d5;
    padding-left: 12px;
    margin: 0 0 35px;
}

h1 {
    color: #b2775e;
    text-align: left;
    font-size: 20px;
    font-weight: 700;
    line-height: 26px;
    margin: 1em 0;
}

b, optgroup, strong {
    font-weight: 700;
}
```

---

## 5. 公共基础样式 `FrameBase.css`

```css
@charset "utf-8";
* {
    margin:0;
    padding:0;
}

body {
    font-family: helvetica,Arial,"Hiragino Sans GB","Microsoft YaHei",simsun;
    font-size:16px;
    line-height:1.5;
}

::-webkit-scrollbar  
{  
    width: 5px;  
    height: 5px;  
    background-color: #E3E6EB;  
} 

::-webkit-scrollbar-track  
{  
    border-radius: 20px;  
    background-color: #E3E6EB;  
}

::-webkit-scrollbar-thumb  
{  
    border-radius: 20px;   
    background-color: #A3A9B4;  
}     

#container {
    width: 242px;
    padding:0 15px;
}

#title {
    word-wrap: break-word;
    cursor: text;
}

#content {
    word-wrap: break-word;
    cursor: text;
}

#account_img img {
    width: 30px;
    height: 30px;
    border-radius: 50%;
}


#content>p {
    line-height: 1.5;
    margin: 1em 0;
    display:block;
    text-align:justify
}

#content img {
    max-width: 100%;
    display: block;
    clear: both;
    margin: 0 auto;
}

a {
    color: RGB(90, 118, 158);
    text-decoration:none;
    border:0;
    outline:0
}

a:active {
    border:0;
    outline:0
}
```
