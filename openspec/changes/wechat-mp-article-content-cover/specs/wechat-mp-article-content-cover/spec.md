## ADDED Requirements

### Requirement: 图文自动封面兜底的触发完备性

发布页在**非视频**发布且所选平台命中自动封面集合时，若表单**既无图片也无任何封面**且标题非空，SHALL 自动生成一张封面；生成成功 SHALL **同时**写入图片通道（`images` / `image_files`）与封面通道（`cover_path` / `cover_file`）。自动封面集合 SHALL 为 `IMAGE_TEXT_PLATFORMS ∪ ['wechat_mp']` 的**单一真源常量**。表单已存在任一封面键（`cover_path` / `cover_file` / `cover_url`）时 SHALL NOT 触发生成。生成失败 SHALL NOT 阻断发布。

#### Scenario: 只发微信公众号且表单无图无封面

- **WHEN** 用户选择唯一平台「微信公众号」、填了标题与正文、未选任何图片与封面，点击发布
- **THEN** 系统自动生成一张封面，并把它同时写入本次发布的 `images`/`image_files` 与 `cover_path`/`cover_file`

#### Scenario: 只发快手（回归保护）

- **WHEN** 用户只选快手的图文发布、表单无图，点击发布
- **THEN** 自动生成封面并写入图片通道（行为与改造前一致），同时写入封面通道；快手图文模式 SHALL NOT 因封面通道重复注入同一张图

#### Scenario: 用户已选封面

- **WHEN** 用户已选择本地封面文件，且未选其它图片，点击发布
- **THEN** SHALL NOT 触发生成（不得用生成封面覆盖用户选择），进度面板 SHALL 如实说明「已使用你选择的封面图」

#### Scenario: 生成失败

- **WHEN** 封面生成返回非 0 或抛错
- **THEN** 发布继续（不阻断），进度面板记「封面图生成失败，本次按无封面继续」

### Requirement: 微信公众号正文的可信注入与验证

微信公众号发布链 SHALL NOT 以直接改写正文编辑器 DOM（`innerHTML` 赋值）的方式注入正文。注入 SHALL 走浏览器编辑管线（焦点 + 全选 + `execCommand('insertText')`），并 SHALL 在注入后经**稳定性回读**验证（静置后重读编辑器文本长度，且与注入前基线比较是否增长）。验证未通过时 SHALL 以明确 error 终止本次发布，SHALL NOT 记录为成功。无正文（去空白后为空）时 SHALL 跳过注入且不视为失败。

#### Scenario: 编辑器为模型驱动富文本（ProseMirror）

- **WHEN** 正文编辑器命中 `.ProseMirror` 且提供了非空正文
- **THEN** 注入走 `execCommand('insertText')`；静置 800ms 后回读文本长度大于注入前基线 → 判定生效；保存草稿继续

#### Scenario: 注入未生效

- **WHEN** 注入后回读文本长度为 0（或未超过基线）且原文非空
- **THEN** 返回失败，error 含「正文未写入编辑器」，不得保存草稿、不得落库 success

#### Scenario: 无正文

- **WHEN** `article.content` 去空白后为空
- **THEN** 跳过正文注入，本次发布的失败原因 SHALL NOT 归因于正文

### Requirement: 微信公众号封面的上传与验证

微信公众号发布链在保存草稿**之前** SHALL 尝试上传 `article.cover_path` 指定的本地封面：点击封面入口 → 在弹层内以 `DataTransfer` 向 `input[type=file]` 注入文件 → 以「封面容器内 `img` 数量超过注入前基线」为生效判据。存在封面但判据未通过时 SHALL 以明确 error 终止发布；无封面时 SHALL NOT 因封面失败而阻断（error 文案不得归因于封面）。上传前 SHALL 校验文件存在且不超过 2MB。

#### Scenario: 有本地封面且上传生效

- **WHEN** `article.cover_path` 指向一个 ≤2MB 且存在的图片文件
- **THEN** 封面被注入且封面容器内 `img` 数超过注入前基线，随后才点击保存草稿

#### Scenario: 有本地封面但上传未生效

- **WHEN** 封面注入后 `img` 数未超过基线
- **THEN** 返回失败，error 含「封面图上传未生效」，不得保存草稿、不得落库 success

#### Scenario: 封面文件不存在或超限

- **WHEN** `cover_path` 指的文件不存在，或大小超过 2MB
- **THEN** 直接返回失败，error 分别含「封面图文件不存在」/「不能超过 2MB」，且不点击保存草稿

#### Scenario: 未提供封面

- **WHEN** `article.cover_path` 为空
- **THEN** 跳过封面上传段，行为与本变更前一致（不新增阻断）

### Requirement: 发布历史记录封面字段的落库

发布历史记录写入点（`task:success` 与 `task:failed`）SHALL 落库本次发布实际使用的封面，产出两个键：`cover_path`（本地绝对路径）与 `cover_url`（远程 `http(s)` 地址）。取值优先级 SHALL 为 `cover_path` → `cover_file.path` → `cover_url`（须过共享协议判据）→ `images[0]`。无值时 SHALL 写空串，SHALL NOT 写 `undefined`/`null`。既有键 SHALL NOT 被改动。

#### Scenario: 图文发布带本地封面

- **WHEN** 一次图文发布成功，`task.article.cover_path = 'D:/covers/a.png'`
- **THEN** 历史记录包含 `cover_path: 'D:/covers/a.png'` 与 `cover_url: ''`

#### Scenario: 只有首图

- **WHEN** `task.article.images = ['D:/img/first.png']` 且无任何封面键
- **THEN** 历史记录的 `cover_path` 为 `'D:/img/first.png'`

#### Scenario: 发布失败

- **WHEN** 一次发布失败
- **THEN** 失败记录同样落库封面字段（与成功记录同源），使失败详情与重试入口也能看到当时使用的封面

### Requirement: 发布历史页真实封面缩略图

发布历史页 SHALL 优先渲染记录中的真实封面：`cover_path` 非空时经既有 `cover:read-data` IPC 转 dataURL 渲染（渲染层不得直接以本地绝对路径作 `<img src>`）；`cover_url` 非空且通过共享协议判据 `safeHttpUrl` 时直接渲染；两者都取不到或读取失败时 SHALL 回退为平台图标，SHALL NOT 渲染损坏的图片元素。解析结果 SHALL 按路径缓存，且响应写回前 SHALL 校验请求序号（迟到响应不得覆盖新状态）。组件卸载 SHALL 作废在途请求。

#### Scenario: 有本地封面

- **WHEN** 记录含 `cover_path` 且 `cover:read-data` 返回 dataURL
- **THEN** 卡片预览区渲染该真实封面

#### Scenario: 读取失败

- **WHEN** `cover:read-data` 返回非 0 或抛错
- **THEN** 该条回退平台图标，且不出现空白/破图的 `<img>`

#### Scenario: 存量记录

- **WHEN** 记录没有 `cover_path`/`cover_url`（本期之前的存量）
- **THEN** 行为与本变更前一致（平台图标），SHALL NOT 报错

#### Scenario: 迟到响应

- **WHEN** 用户快速切换筛选导致同一卡片的封面请求被重新发起
- **THEN** 较早发出的响应 SHALL NOT 覆盖较新的封面状态
