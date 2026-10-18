# 第三方软件声明

## FFmpeg 与 ffprobe

Multi-Publish 将 FFmpeg 和 ffprobe 作为独立命令行程序随桌面安装包分发，并通过子进程调用。桌面应用不链接这些二进制文件。

- npm 包：`ffmpeg-ffprobe-static@6.1.2-rc.1`
- 二进制发布：`b6.1.2-rc.1`
- 二进制发布页：https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/tag/b6.1.2-rc.1
- FFmpeg 上游源码：https://git.ffmpeg.org/ffmpeg.git

该 npm 包的许可证元数据为 GNU GPL 第 3 版或更高版本；每个平台二进制的实际构建参数和适用条款以随包文件为准。安装目录中的 `resources/media-tools/FFMPEG-BUILD.txt` 保存本次打包二进制的真实版本与构建参数，`FFMPEG-LICENSE.txt` 保存二进制发布方提供的许可证说明，`GPL-3.0.txt` 保存 GPLv3 许可证原文，`FFMPEG-WRAPPER-LICENSE.txt` 保存 npm 包装层许可证，`FFMPEG-PACKAGE-README.md` 保存各平台二进制来源与构建说明。

Multi-Publish 未修改随包分发的 FFmpeg/ffprobe 二进制。公开分发安装包时，发布负责人还必须按适用许可证提供对应源代码及构建材料的获取方式；本声明不能替代许可证原文或法律审查。

## Lucide 图标（内联 SVG 几何）

顶部浏览器导航区的后退 / 前进 / 刷新按钮，标签栏与导航栏的加载指示器，以及标签栏最左侧「左侧菜单收起 / 展开」按钮（双 chevron），其 SVG 路径几何取自 Lucide 图标库，以「内联 SVG 组件」形态复制进本仓库，不随包分发 Lucide 的任何代码或 npm 包。

- 项目主页：https://lucide.dev
- 上游仓库：https://github.com/lucide-icons/lucide
- 许可证：ISC License，Copyright (c) 2026 Lucide Icons and Contributors
- 许可证原文：https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE
- 取用日期：2026-09-29（取自上游 `main` 分支）

本仓库内的具体落点与所用图标：

| 文件 | 上游图标名 | 许可证 |
| --- | --- | --- |
| `src/components/icons/ArrowLeftIcon.vue` | `arrow-left` | ISC + 下列 Feather MIT |
| `src/components/icons/ArrowRightIcon.vue` | `arrow-right` | ISC + 下列 Feather MIT |
| `src/components/icons/ReloadIcon.vue` | `rotate-cw` | ISC |
| `src/components/icons/SpinnerIcon.vue` | `loader-circle` | ISC |
| `src/components/icons/SidebarToggleIcon.vue` | `chevron-left` + `chevron-right` | ISC |

按上游 LICENSE 声明，`arrow-left` 与 `arrow-right` 属自 Feather 项目派生的图标，该部分另受 MIT License 约束，Copyright (c) 2013-present Cole Bemis；上游 LICENSE 原文中包含其完整条款。`rotate-cw` 与 `loader-circle` 不在上游列出的 Feather 派生清单内，仅受 ISC 约束。

本仓库对上述几何做了两处适配：移除 `width`/`height`/`xmlns` 等固定属性，改由组件的 `size` prop 驱动；其余 `viewBox`、`fill`、`stroke`、`stroke-width`、`stroke-linecap`、`stroke-linejoin` 与各 `path` 的 `d` 值均保持上游原样，未做重绘。
