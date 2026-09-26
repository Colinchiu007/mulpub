# app-menu Specification

## Purpose
运营中心「应用菜单」与桌面端左侧边栏之间的跨端契约：以代码内 `CATALOG` 为目录真源、`app_menu_items` 表为运营者配置载体，规定目录如何随版本演进供给存量库、页面视图与运行时下发载荷如何保持一致、模型目录与运行时两条同步通道如何互不门控，以及「同步对用户透明、应用端界面不出现任何运营入口」这一产品约束。
## Requirements
### Requirement: 菜单目录供给（DB 跟随 CATALOG 演进）

运营中心 SHALL 在每次列表读取、批量保存、恢复默认与运行时下发之前，按 `CATALOG` 补齐 `app_menu_items` 中缺失的行；补齐 MUST 只写入目录默认值（label / group / visible=1 / sort_order=目录序号 / forced_visible），且 MUST NOT 修改任何已存在行的字段。

#### Scenario: 历史库缺失目录新增项
- GIVEN `app_menu_items` 已在某项加入 `CATALOG` 之前完成播种（该项无行）
- WHEN 运营者打开「应用菜单」页
- THEN 列表包含该项，项目总数等于 `CATALOG` 长度
- AND 该项分组与 `sort_order` 取目录默认值

#### Scenario: 回填不得覆盖运营者配置
- GIVEN 运营者已把「素材库」设为隐藏且 `sort_order=42`
- WHEN 目录新增项被补齐
- THEN 「素材库」仍为隐藏且 `sort_order=42`

#### Scenario: 空表首次供给
- GIVEN `app_menu_items` 为空
- WHEN 任一入口首次被调用
- THEN 按 `CATALOG` 全量播种，顺序与目录一致

### Requirement: 页面视图与下发载荷不得发散

「应用菜单」页所显示的项目集合与顺序，与应用端实际收到的下发载荷 SHALL 始终一致：两者的 key 集合 MUST 等于 `CATALOG` 的 key 集合；DB 缺行项在载荷中的 `sort_order` MUST 取其目录序号，MUST NOT 取 0。

#### Scenario: 缺行项的兜底顺序
- GIVEN 某目录项在 DB 中无行
- WHEN 生成 runtime bootstrap 的 `appMenu`
- THEN 该项 `visible=true`、`group` 取目录默认分组、`sort_order` 等于其目录序号
- AND 一级导航按 `sort_order` 升序排列后的 key 序列等于 `CATALOG` 中 primary 组的声明顺序

#### Scenario: 历史脏 key 两侧都不出现
- GIVEN DB 中存在不在 `CATALOG` 内的历史 key（如已移除的 `monitor`）
- WHEN 运营者打开「应用菜单」页
- THEN 页面不显示该项（`list_items` 按 `CATALOG_KEYS` 过滤），因为下发侧本就过滤，显示它只会再次制造「两侧不同步」的错觉
- AND 该项不出现在下发载荷中，且不影响其余项
- AND 该行不被删除（删除不可逆，保留以便人工判断）

### Requirement: 运营配置与模型目录两条同步通道彼此独立

桌面端一次同步 SHALL 并行拉取模型目录与运行时策略（含应用菜单），任一通道的失败 MUST NOT 阻止另一通道被拉取与应用；整体超时预算 MUST 保持为单请求超时（10 秒），不得因两条通道而叠加。

#### Scenario: 目录失败但运营配置生效
- GIVEN 模型目录端点返回 500
- WHEN 执行一次同步
- THEN 运行时策略仍被拉取并应用，`runtimeApplied=true`
- AND 应用菜单配置落入本地缓存，重启后仍可恢复
- AND 同步结果如实上报目录失败原因

#### Scenario: 模型服务未就绪
- GIVEN 模型服务商管理器尚未注入
- WHEN 执行一次同步
- THEN 返回「模型服务未就绪」
- AND 运行时策略仍被拉取与应用

#### Scenario: 两条通道同时超时
- GIVEN 两个端点均无响应
- WHEN 10 秒超时触发
- THEN 两个端点各被请求一次
- AND 结果 `code=-1`、`message` 含超时、`runtimeApplied=false`

### Requirement: 启动同步完成后应用端自动刷新（不新增用户入口）

主进程每次成功应用运行时策略后 SHALL 通知渲染端，侧边栏据此重拉菜单配置并更新渲染；该通知 MUST NOT 携带配置内容（仅时间戳），配置读取仍走原有受验签保护的 IPC 路径。

#### Scenario: 同步完成后菜单即时更新
- GIVEN 应用已启动且侧边栏已渲染
- WHEN 运营配置被同步并成功应用
- THEN 主进程向主窗口广播 `ops-center:runtime-updated`，载荷仅含服务端同步时间
- AND 侧边栏重拉配置后一级导航按新配置显隐与排序，用户无需二次重启（启动同步晚于首帧渲染，不广播则本次改动要等到下次启动才可见）

#### Scenario: 窗口不可用时不得报错
- GIVEN 主窗口尚未创建或已销毁
- WHEN 广播被触发
- THEN 通知静默跳过且不抛异常
- AND 已应用的运行时状态保持不变

#### Scenario: 重拉失败保留上一份配置
- GIVEN 侧边栏已应用一份有效运营配置
- WHEN 后续重拉失败（IPC 报错或服务不可达）
- THEN 侧边栏保留上一份配置，不瞬时回退为本地默认菜单

#### Scenario: 首帧无配置时 fail-open
- GIVEN 从未取得运营配置
- WHEN 侧边栏首次渲染
- THEN 使用本地默认菜单定义

### Requirement: 运营同步对用户透明

运营配置同步链路 SHALL NOT 在应用端界面出现任何入口或文案（含同步地址、API Key、「立即同步」按钮、同步结果 toast）。桌面端 `ModelProviders.vue` 已隐藏运营同步配置卡片，该决策为产品约束；目录与运行时两条通道的失败区分 SHALL 由主进程日志承担。系统 SHALL NOT 为不可达的反馈路径新增 locale 键。

#### Scenario: 界面不暴露运营同步
- GIVEN 任意已登录或未登录的桌面端会话
- WHEN 渲染设置页与模型服务页
- THEN 不存在任何运营中心地址、API Key 或手动同步入口
- AND 目录失败与运行时策略失败均可在主进程日志中区分（`runtime sync skipped: <原因>` 等）

### Requirement: 运营端页面须说明真实生效时机

「应用菜单」页的说明文案 SHALL 与实际机制一致：目录新增项由后端自动补齐（无需点「恢复默认」）；应用端**只在启动时同步一次**，故运营端改动在客户端下次启动时生效，那次同步完成后自动刷新侧边栏；文案 SHALL NOT 指引最终用户去应用端执行任何同步操作（应用端不暴露同步入口）；系统不提供服务端主动推送。

#### Scenario: 文案与机制一致
- WHEN 运营者打开「应用菜单」页
- THEN 说明中包含自动补齐、主动同步入口与「无服务端推送」三项事实
- AND 不再出现「必须重启应用才生效」的表述

