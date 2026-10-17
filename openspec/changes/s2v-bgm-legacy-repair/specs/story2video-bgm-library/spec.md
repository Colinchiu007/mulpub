# story2video-bgm-library（delta）

## MODIFIED Requirements

### Requirement: 下拉选择与配置兼容

BGM 配置区 SHALL 位于「声音」选项分组内，以下拉选择库内条目（含「不使用背景音乐」空选项）；选中项映射为既有 `s2vConfig.bgmPath`，compose 参数 `bgm.enabled/path/volume` 契约不变；当既有 `bgmPath` 不在库中时 SHALL 保留为独立选项，且 MUST 通过主进程只读通道区分「文件仍可用 / 文件已丢失 / 文件不可用」三种状态，不得只以「未入库」一词承载。

#### Scenario: 下拉选择生效
- **WHEN** 用户从下拉选择库内音乐
- **THEN** `s2vConfig.bgmPath` 更新为该条目路径，发起合成时 `bgm.enabled=true` 且 `bgm.path` 为该路径

#### Scenario: 历史路径兼容且可区分存在性
- **WHEN** 恢复的配置 `bgmPath` 非空但不在库中
- **THEN** 下拉保留该路径为独立选项，并按主进程核验结果显示「未入库但可用」或「文件已丢失」或「文件不可用」，不得静默把丢失文件当作可用配置

#### Scenario: 分组归属
- **WHEN** 用户展开「声音」折叠区
- **THEN** 「背景音乐」与「背景音乐音量」位于该区内；「画面」折叠区不再包含二者

## ADDED Requirements

### Requirement: 历史背景音乐存在性核验通道

系统 SHALL 提供只读 IPC `story2video:bgm-library-status`，接受 `{ filePath }`，按与 compose 相同的受控读取合同（音频扩展名、单文件 ≤15MB、普通文件且非符号链接、位于允许媒体根内）返回 `{ path, exists, readable, size, extension, inLibrary, libraryItemId, reason }`；`reason` MUST 为 `ok | invalid_argument | format_unsupported | missing | not_a_file | size_exceeded | not_allowed | unreadable` 之一。通道 MUST 走可信来源校验、未登录可用，且 MUST NOT 对非音频扩展名执行文件系统探测。

#### Scenario: 核验可用历史文件
- **WHEN** renderer 对允许媒体根内存在的 ≤15MB mp3 调用核验且它不在库中
- **THEN** 返回 `exists=true, readable=true, inLibrary=false, reason='ok'`

#### Scenario: 核验已丢失文件
- **WHEN** renderer 对一个已不存在的路径调用核验
- **THEN** 返回 `exists=false, readable=false, reason='missing'`，且不抛错

#### Scenario: 拒绝探测任意文件
- **WHEN** 传入非音频扩展名（如 `.exe`）或非法/相对路径
- **THEN** 分别返回 `format_unsupported` / `invalid_argument`，且不读取目标文件内容

#### Scenario: 未登录可用
- **WHEN** 用户未登录或未激活许可证
- **THEN** 核验通道仍可调用（与 `bgm-library-list` 同级 public）

### Requirement: 历史路径修复动作与启动门禁

桌面端 SHALL 对「历史引用、未入库」的 BGM 提供显式修复动作：【加入素材库】（复用 `bgm-library-add`，成功后自动选中库内新路径）与【清除背景音乐选择】；当核验结论为 `missing` 或 `unusable` 时 MUST 阻断启动并在启动提示中给出可修复原因；当核验通道不可用（`unknown`）时 MUST 失败开放，不得阻断。

#### Scenario: 丢失文件阻断启动
- **WHEN** 当前 `bgmPath` 核验为 `missing`
- **THEN** 「启动流水线」禁用，阻塞原因显示“所选背景音乐文件已丢失，请重新选择或清除背景音乐后再启动”

#### Scenario: 加入素材库
- **WHEN** 核验为可用未入库，用户点击【加入素材库】且导入成功
- **THEN** 该文件被复制入库、库列表刷新，`s2vConfig.bgmPath` 更新为库内新路径，状态复位为常规库内选择

#### Scenario: 清除选择
- **WHEN** 用户点击【清除背景音乐选择】
- **THEN** `s2vConfig.bgmPath` 置空、状态复位、启动门禁解除

#### Scenario: 核验不可用时不阻断
- **WHEN** IPC 通道缺失或返回错误（浏览器态/旧主进程）
- **THEN** 界面保持既有“未入库”兼容行为，`canStartPipeline` 不因核验失败而禁用
