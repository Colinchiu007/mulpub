"""应用菜单配置服务（2026-09-15）— 应用端左侧边栏菜单项的显示/隐藏与排序。

跨端契约
--------
CATALOG 的 key 与分组顺序与桌面端 `apps/desktop/src/config/sidebar-menu.js`
的 `SIDEBAR_MENU_DEFINITION` 严格对齐，是唯一的跨端契约：

- 运营端 **拒绝** 未知 key（fail-closed）—— 避免脏数据被下发后无声无息地失效。
- 应用端 **忽略** 未知 key（fail-open）—— 避免运营端未同步时新菜单项消失。

二者方向相反是刻意的：写入口要严，读出口要宽。

强制显示项
----------
`FORCED_VISIBLE_KEYS` 中的四项（发布/账号/采集/视频创作）在运营端开关灰显不可关闭；
服务端**再次强制纠正**为可见并回传 corrections 列表（防御纵深：即使绕过 UI 直接调 API
也无法让这四项在应用端消失；同时留痕以便排查异常来源）。
"""

import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from models import AppMenuItem

MENU_GROUP_PRIMARY = "primary"  # 一级导航（平铺）
MENU_GROUP_MORE = "more"  # 「更多」折叠菜单
MENU_GROUPS = (MENU_GROUP_PRIMARY, MENU_GROUP_MORE)

# 强制显示项 —— 与桌面端 SIDEBAR_FORCED_VISIBLE_KEYS 严格对齐
FORCED_VISIBLE_KEYS = ("publish", "accounts", "create", "collection")

# 上限：防超大 payload 造成应用端渲染 DoS（与桌面端 MAX_APP_MENU_ITEMS 对齐）
MAX_MENU_ITEMS = 200
MAX_SORT_ORDER = 9999

# 菜单目录：(key, 展示名, 分组, 说明)
# 顺序即默认排序；应用端 sidebar-menu.js 必须保持同序
CATALOG = (
    # ── 一级导航（平铺）─────────────────────────────
    ("home", "主页", MENU_GROUP_PRIMARY, "应用默认落地页，关闭后登录仍会进入主页"),
    ("publish", "发布", MENU_GROUP_PRIMARY, "强制显示：核心发布入口"),
    ("accounts", "账号", MENU_GROUP_PRIMARY, "强制显示：平台账号管理入口"),
    ("dashboard", "数据", MENU_GROUP_PRIMARY, "本地数据看板"),
    ("create", "视频创作", MENU_GROUP_PRIMARY, "强制显示：核心创作入口"),
    ("collection", "采集", MENU_GROUP_PRIMARY, "强制显示：内容采集入口"),
    ("rewrite", "文案改写", MENU_GROUP_PRIMARY, "改写策略应用入口（2026-09-15 提级到一级导航，与应用端 sidebar-menu.js 同步）"),
    # ── 「更多」折叠菜单 ────────────────────────────
    ("calendar", "发布日历", MENU_GROUP_MORE, "发布排期日历"),
    ("comments", "私信评论", MENU_GROUP_MORE, "平台私信与评论聚合"),
    ("cloud-publish", "CLI", MENU_GROUP_MORE, "命令行发布能力"),
    ("library", "素材库", MENU_GROUP_MORE, "本地素材管理"),
    ("keywords", "关键词监控", MENU_GROUP_MORE, "关键词监测目录"),
    ("viral", "爆款分析", MENU_GROUP_MORE, "爆款内容分析"),
    ("prompt-eval", "提示词评估", MENU_GROUP_MORE, "提示词效果评估"),
    ("hot-topics", "热门选题", MENU_GROUP_MORE, "多平台热门选题聚合"),
    ("model-providers", "模型提供商", MENU_GROUP_MORE, "模型服务商配置"),
    ("knowledge-base", "知识库", MENU_GROUP_MORE, "本地知识库"),
    ("performance-insights", "数据洞察", MENU_GROUP_MORE, "表现归因与洞察"),
    ("member-center", "会员中心", MENU_GROUP_MORE, "账号与权益中心"),
)

CATALOG_MAP = {key: (key, label, group, desc) for key, label, group, desc in CATALOG}
CATALOG_KEYS = tuple(key for key, _label, _group, _desc in CATALOG)


def _now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


def is_forced_visible(item_key: str) -> bool:
    """是否为强制显示项（运营端不可关闭）。"""
    return item_key in FORCED_VISIBLE_KEYS


def _to_bool(value) -> bool:
    """白名单为真：仅 True/1/'1'/'true' 视为可见，其余一律视为隐藏。"""
    return value in (True, 1, "1", "true")


def _to_sort_order(value, fallback: int) -> int:
    """解析 sort_order；非法值（空/非数字/负数）保留原值而非归零，避免误改用户排序。"""
    if value is None or value == "":
        return fallback
    try:
        num = int(str(value).strip())
    except (TypeError, ValueError):
        return fallback
    if num < 0:
        return fallback
    return min(num, MAX_SORT_ORDER)


async def _seed_if_empty(db: AsyncSession) -> None:
    """表为空时按目录播种（幂等）。首个 GET/PUT/bootstrap 调用触发。"""
    count = (await db.execute(sa.select(sa.func.count()).select_from(AppMenuItem))).scalar_one()
    if count:
        return
    now = _now()
    for index, (key, label, group, description) in enumerate(CATALOG):
        db.add(
            AppMenuItem(
                item_key=key,
                label=label,
                group=group,
                visible=1,
                forced_visible=1 if is_forced_visible(key) else 0,
                sort_order=index,
                description=description,
                updated_at=now,
                updated_by="",
            )
        )
    await db.commit()


def _group_rank():
    """排序权重：primary 组在前。"""
    return sa.case((AppMenuItem.group == MENU_GROUP_PRIMARY, 0), else_=1)


async def list_items(db: AsyncSession) -> list[dict]:
    """列出全部菜单项（按分组 + 排序值）。"""
    await _seed_if_empty(db)
    rows = (
        await db.execute(
            sa.select(AppMenuItem).order_by(
                _group_rank(), AppMenuItem.sort_order, AppMenuItem.item_key
            )
        )
    ).scalars().all()
    return [_item_to_dict(row) for row in rows]


async def upsert_items(db: AsyncSession, items: list, updated_by: str = "") -> dict:
    """批量更新显示/隐藏与排序。

    校验失败一律抛 ValueError（路由层转 400），不做部分写入：
    批量保存的语义是「这一批是一个整体」，部分成功会导致运营端看不到的脏状态。

    :returns: {"items": [...], "corrections": [被服务端强制纠正的 item_key, ...]}
    """
    if not isinstance(items, list):
        raise ValueError("items 必须为数组")
    if len(items) > MAX_MENU_ITEMS:
        raise ValueError(f"菜单项数量超过上限 {MAX_MENU_ITEMS}")

    await _seed_if_empty(db)
    now = _now()
    corrections: list[str] = []
    seen: set[str] = set()

    for raw in items:
        if not isinstance(raw, dict):
            raise ValueError("items 中的每一项都必须是对象")
        key = str(raw.get("item_key", "")).strip()
        if not key:
            raise ValueError("item_key 不能为空")
        if key not in CATALOG_MAP:
            raise ValueError(f"未知菜单项：{key}")
        if key in seen:
            raise ValueError(f"菜单项重复提交：{key}")
        seen.add(key)

        row = (
            await db.execute(sa.select(AppMenuItem).where(AppMenuItem.item_key == key))
        ).scalar_one_or_none()
        if row is None:
            _key, label, group, description = CATALOG_MAP[key]
            row = AppMenuItem(
                item_key=key,
                label=label,
                group=group,
                description=description,
                visible=1,
                forced_visible=1 if is_forced_visible(key) else 0,
                sort_order=CATALOG_KEYS.index(key),
            )
            db.add(row)

        visible = _to_bool(raw.get("visible"))
        if is_forced_visible(key) and not visible:
            # 强制显示项：纠正为可见并留痕（运营端 UI 已灰显，走到这里说明异常来源）
            corrections.append(key)
            visible = True

        # 分组：仅接受已知分组，未知分组视为非法输入（fail-closed，与 key 校验同口径）。
        # 该字段现在会进入下发载荷（见 get_bootstrap_app_menu），是跨组管理的契约一部分。
        raw_group = raw.get("group")
        if raw_group is not None:
            if raw_group not in MENU_GROUPS:
                raise ValueError(f"未知分组：{raw_group}（仅允许 {', '.join(MENU_GROUPS)}）")
            row.group = raw_group

        # 强制显示项锁定在一级导航（防御纵深：即使前端越权把其拖入「更多」也不允许）
        if is_forced_visible(key) and row.group != MENU_GROUP_PRIMARY:
            corrections.append(key)
            row.group = MENU_GROUP_PRIMARY

        row.visible = 1 if visible else 0
        row.sort_order = _to_sort_order(raw.get("sort_order"), int(row.sort_order or 0))
        row.forced_visible = 1 if is_forced_visible(key) else 0
        row.updated_at = now
        row.updated_by = updated_by

    await db.commit()
    return {"items": await list_items(db), "corrections": corrections}


async def reset_items(db: AsyncSession, updated_by: str = "") -> dict:
    """恢复默认：全部可见 + 目录定义顺序 + 强制项标记回归。"""
    await _seed_if_empty(db)
    now = _now()
    rows = (await db.execute(sa.select(AppMenuItem))).scalars().all()
    by_key = {row.item_key: row for row in rows}

    for index, (key, label, group, description) in enumerate(CATALOG):
        row = by_key.get(key)
        if row is None:
            row = AppMenuItem(item_key=key)
            db.add(row)
        row.label = label
        row.group = group
        row.description = description
        row.visible = 1
        row.forced_visible = 1 if is_forced_visible(key) else 0
        row.sort_order = index
        row.updated_at = now
        row.updated_by = updated_by

    await db.commit()
    return {"items": await list_items(db)}


async def get_bootstrap_app_menu(db: AsyncSession) -> dict:
    """运行时下发载荷：仅包含目录内的 key（数据库中可能存在的历史脏 key 不下发）。

    强制显示项在下发前再做一次纠正，保证「无论数据库里是什么，应用端收到的都是可见」。

    下发项含 key / visible / sort_order / group：group 是跨组管理的契约字段
    （2026-09-16 起撤销原 D-GRP 限制）——应用端 sidebar-menu-merge 据此决定菜单项落在
    一级导航还是「更多」折叠菜单。group 非法/缺失时应用端 fail-open 回退本地定义（C1）。
    """
    await _seed_if_empty(db)
    rows = (await db.execute(sa.select(AppMenuItem))).scalars().all()
    by_key = {row.item_key: row for row in rows}

    items = []
    for key, _label, _group, _description in CATALOG:
        row = by_key.get(key)
        visible = bool(row.visible) if row is not None else True
        if is_forced_visible(key):
            visible = True
        sort_order = int(row.sort_order) if row is not None and row.sort_order is not None else 0
        group = row.group if row is not None and row.group else _group
        # 防御纵深：强制显示项永远落在一级导航
        if is_forced_visible(key):
            group = MENU_GROUP_PRIMARY
        items.append(
            {
                "key": key,
                "visible": visible,
                "sort_order": min(max(sort_order, 0), MAX_SORT_ORDER),
                "group": group,
            }
        )
    return {"items": items, "synced_at": _now()}


def _item_to_dict(row: AppMenuItem) -> dict:
    return {
        "id": row.id,
        "item_key": row.item_key,
        "label": row.label,
        "group": row.group,
        "visible": bool(row.visible),
        "forced_visible": bool(row.forced_visible),
        "sort_order": row.sort_order,
        "description": row.description,
        "updated_at": row.updated_at,
        "updated_by": row.updated_by,
    }
