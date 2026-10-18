"""故事讲述文案字数控制服务（2026-10-18）— 运营中心「字数控制」的唯一真源。

跨端契约（`01-docs/PRD-STORY-TEXT-LIMIT-CONTROL-2026-10-18.md` §4.3 / §5.2）
----------------------------------------------------------------------------
下发块名固定为 ``storyTextLimit``，形状固定为::

    {"story2video": {"maxChars": 10000, "warnPercent": 90}}

三条不可破的约束：

1. **只能是整数。** 两端 config_hash 的 canonical 序列化对浮点不一致
   （Python 写 ``1.5e-07`` / JS 写 ``1.5e-7``），一旦混入非整数，
   ``config_fingerprint.assert_integer_numbers`` 直接抛错 ⇒ 服务端 config_hash 降级为空串
   ⇒ 全量客户端永远判「hash 未变」⇒ 运营看板上的「是否生效」从此失真。
   因此预警阈值用**百分比整数**表达，而不是 ``0.9``（PRD §5.4 唯一被否决的方案）。
2. **enabled=false 的 scope 整键不出现**（不是出现并带 false）：
   「块里没有这个 key = 用内置默认」是桌面端唯一的单一判据。
3. **块必须落在 Ed25519 签名覆盖范围内**：由 runtime_service 组装到 payload 再签名，
   本模块只负责「返回什么值」，不参与签名环节。

写入口严、读出口宽（与 app_menu_service / content_category_service 同口径）
----------------------------------------------------------------------------
- **写入 fail-closed**：未知 scope / 非整数 / 越界 / 非布尔 / 备注超长 → ``ValueError``
  （router 转 400）。且**先全量校验再落库**：批量保存的语义是「这一批是一个整体」，
  部分成功会留下运营端看不见的脏状态（「保存成功但实际没生效」正是这条要防的）。
- **下发 fail-open**：库内非法行（历史脏数据 / 直接改库）逐条跳过，绝不把脏值下发；
  整块读取异常时返回 ``None``，桌面端回落内置默认（10000 字 / 90%），不阻塞创作。

目录供给（防「新 scope 在运营端永久消失」）
--------------------------------------------
``_provision_from_catalog`` 在每次读取 / 写入 / 下发前按 CATALOG 补齐缺失行，
语义是「只补欠账、不覆盖运营者已有值」（同 ``app_menu_service._provision_from_catalog``）：
表非空后旧逻辑若只做「表空才播种」，新增 scope 会在运营端页面永久缺失，
而桌面端照常按内置默认运行，两侧就此漂移（2026-09-25 事故复盘）。
"""

import datetime
import logging

import sqlalchemy as sa
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models import StoryTextLimit

logger = logging.getLogger(__name__)

# ─── 契约常量（改这里等于改跨端契约，必须与桌面端 story-text-limit 解析器同步）──
RUNTIME_BLOCK_NAME = "storyTextLimit"

DEFAULT_MAX_CHARS = 10000  # 本次需求由 6000 提升而来
DEFAULT_WARN_PERCENT = 90
MIN_MAX_CHARS = 1000
MAX_MAX_CHARS = 50000
MIN_WARN_PERCENT = 50
MAX_WARN_PERCENT = 99
MAX_NOTE_LEN = 200

# 作用域目录：(scope, 展示名, 说明)。
# 顺序即运营端页面顺序；scope 是跨端契约键，发布后不得改名。
CATALOG = (
    ("story2video", "故事讲述", "视频创作页「故事讲述」流水线的文案输入框字数上限"),
)
CATALOG_MAP = {scope: (scope, label, desc) for scope, label, desc in CATALOG}
CATALOG_SCOPES = tuple(scope for scope, _label, _desc in CATALOG)


def _now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


# ─── 校验（写入口，fail-closed）───────────────────────────────────────────

_MSG_MAX_CHARS = f"字数上限需为 {MIN_MAX_CHARS}~{MAX_MAX_CHARS} 的整数"
_MSG_WARN_PERCENT = f"预警阈值需为 {MIN_WARN_PERCENT}~{MAX_WARN_PERCENT} 的整数"
_MSG_ENABLED = "启用标记需为布尔值"
_MSG_NOTE_TOO_LONG = f"备注最多 {MAX_NOTE_LEN} 字"


def _validate_scope(raw) -> str:
    """作用域必须是目录内已知键（fail-closed：脏 scope 落库后永不下发，等于静默失效）。"""
    scope = str(raw or "").strip()
    if not scope:
        raise ValueError("作用域不能为空")
    if scope not in CATALOG_MAP:
        raise ValueError(f"未知的作用域：{scope}")
    return scope


def _validate_int(value, message: str, minimum: int, maximum: int) -> int:
    """严格整数校验：bool / float / str / None 一律拒绝，不隐式转换。

    为什么连 ``10000.0`` 这种「值是整数」的 float 也拒绝：它落进 SQLite 的
    REAL 亲和列后可能以浮点回来，随后被原样写进 bootstrap ⇒ ``config_hash`` 两端对不上。
    前端 ``el-input-number`` 与 JS 的 ``JSON.stringify`` 对整数只输出不带小数点的形式
    （``10000`` 而非 ``10000.0``），所以这条严格性不会误伤合法调用方。
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(message)
    if value < minimum or value > maximum:
        raise ValueError(message)
    return value


def _validate_max_chars(raw) -> int:
    return _validate_int(raw, _MSG_MAX_CHARS, MIN_MAX_CHARS, MAX_MAX_CHARS)


def _validate_warn_percent(raw) -> int:
    return _validate_int(raw, _MSG_WARN_PERCENT, MIN_WARN_PERCENT, MAX_WARN_PERCENT)


def _validate_enabled(raw) -> int:
    """启用标记：接受 bool / 0-1 整数 / true-false 字符串；其余（含 None）按 400 拒绝。

    ``None`` 也拒绝而不是回落默认：调用方显式传了 null 说明它以为能表达「关闭」，
    静默当作 true 会让「关闭下发」变成「照常下发」——正好是这条要防的失效。
    """
    if raw is None:
        raise ValueError(_MSG_ENABLED)
    if isinstance(raw, bool):
        return 1 if raw else 0
    if isinstance(raw, int) and raw in (0, 1):
        return raw
    if isinstance(raw, str) and raw.strip().lower() in ("true", "false", "1", "0"):
        return 1 if raw.strip().lower() in ("true", "1") else 0
    raise ValueError(_MSG_ENABLED)


def _validate_note(raw) -> str:
    note = "" if raw is None else str(raw).strip()
    if len(note) > MAX_NOTE_LEN:
        raise ValueError(_MSG_NOTE_TOO_LONG)
    return note


# ─── 目录供给 / 查询 ─────────────────────────────────────────────────────

async def _provision_from_catalog(db: AsyncSession) -> None:
    """按目录供给库：补齐缺失 scope（幂等、并发安全），只补欠账不覆盖已有值。

    两点实现约束（与 app_menu_service / content_category_service 完全同口径）：

    1. **ON CONFLICT DO NOTHING**：本函数每个请求都会跑，页面 GET 与客户端 bootstrap
       可能同时判定同一 scope 缺失并双插，``scope`` 主键会把其中一个打成 IntegrityError。
    2. **只 flush 不 commit**：事务由调用方统一收口，避免「补齐已落盘而后续校验抛错」
       留下部分写入。
    """
    existing = set((await db.execute(sa.select(StoryTextLimit.scope))).scalars().all())
    now = _now()
    rows = [
        {
            "scope": scope,
            "max_chars": DEFAULT_MAX_CHARS,
            "warn_percent": DEFAULT_WARN_PERCENT,
            "enabled": 1,
            "note": "",
            "updated_at": now,
            "updated_by": "catalog",
        }
        for scope, _label, _description in CATALOG
        if scope not in existing
    ]
    if not rows:
        return
    await db.execute(
        sqlite_insert(StoryTextLimit)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["scope"])
    )
    await db.flush()


def _catalog_rank(scope: str) -> int:
    """排序权重：目录顺序；不在目录内的历史行排最后（它们不下发，只占位）。"""
    return CATALOG_SCOPES.index(scope) if scope in CATALOG_SCOPES else len(CATALOG_SCOPES)


async def _ordered_rows(db: AsyncSession) -> list[StoryTextLimit]:
    rows = list((await db.execute(sa.select(StoryTextLimit))).scalars().all())
    return sorted(rows, key=lambda r: (_catalog_rank(r.scope), r.scope))


def _to_dict(row: StoryTextLimit) -> dict:
    label = CATALOG_MAP.get(row.scope, (row.scope, row.scope, ""))[1]
    return {
        "scope": row.scope,
        "label": label,
        "max_chars": row.max_chars,
        "warn_percent": row.warn_percent,
        "enabled": bool(row.enabled),
        "note": row.note or "",
        "updated_at": row.updated_at,
        "updated_by": row.updated_by or "",
    }


async def list_scopes(db: AsyncSession) -> list[dict]:
    """列出目录内可配置项（目录外的历史行不返回：页面与下发必须同一份集合）。"""
    await _provision_from_catalog(db)
    await db.commit()
    rows = [r for r in await _ordered_rows(db) if r.scope in CATALOG_MAP]
    return [_to_dict(r) for r in rows]


# ─── 写入（批量、整体成功或整体失败）─────────────────────────────────────

async def upsert_scopes(db: AsyncSession, items, updated_by: str = "") -> list[dict]:
    """批量保存作用域配置。

    **先全量校验、再统一落库**：任一条非法即整体 400 且一行都不写，
    避免运营端出现「前两行保存成功、第三行失败」的隐形脏状态。

    字段口径：
    - ``scope`` / ``max_chars`` / ``warn_percent`` 必填（缺字段同样按非法拒绝，
      否则前端字段名写错时会「保存成功但值没变」）；
    - ``enabled`` 可选，缺省 true（新建）或保留原值（更新）；
    - ``note`` 可选，缺省空串（新建）或保留原值（更新）。
    """
    if not isinstance(items, list):
        raise ValueError("items 必须为数组")
    if not items:
        raise ValueError("items 不能为空")

    # ① 全量校验（不触库、不改状态）
    await _provision_from_catalog(db)
    existing_rows = {r.scope: r for r in await _ordered_rows(db)}
    normalized: list[dict] = []
    seen: set[str] = set()
    for raw in items:
        if not isinstance(raw, dict):
            raise ValueError("items 中的每一项都必须是对象")
        scope = _validate_scope(raw.get("scope"))
        if scope in seen:
            raise ValueError(f"作用域重复提交：{scope}")
        seen.add(scope)
        existing = existing_rows.get(scope)
        normalized.append(
            {
                "scope": scope,
                "max_chars": _validate_max_chars(raw.get("max_chars")),
                "warn_percent": _validate_warn_percent(raw.get("warn_percent")),
                "enabled": (
                    _validate_enabled(raw.get("enabled"))
                    if "enabled" in raw
                    else (int(existing.enabled or 0) if existing is not None else 1)
                ),
                "note": (
                    _validate_note(raw.get("note"))
                    if "note" in raw
                    else ((existing.note or "") if existing is not None else "")
                ),
            }
        )

    # ② 统一落库
    now = _now()
    for item in normalized:
        row = existing_rows.get(item["scope"])
        if row is None:
            row = StoryTextLimit(scope=item["scope"])
            db.add(row)
        row.max_chars = item["max_chars"]
        row.warn_percent = item["warn_percent"]
        row.enabled = item["enabled"]
        row.note = item["note"]
        row.updated_at = now
        row.updated_by = updated_by or ""
    await db.commit()
    return await list_scopes(db)


async def reset_scopes(db: AsyncSession, updated_by: str = "", scope: str | None = None) -> list[dict]:
    """恢复目录默认（10000 字 / 90% / 启用）。

    ``scope`` 为空时重置目录内全部作用域；指定时只重置该项（未知 scope → ``KeyError``）。
    """
    await _provision_from_catalog(db)
    rows = {r.scope: r for r in await _ordered_rows(db)}
    if scope is not None and scope not in CATALOG_MAP:
        raise KeyError(scope)

    targets = [s for s in CATALOG_SCOPES if scope is None or s == scope]
    now = _now()
    for key in targets:
        row = rows.get(key)
        if row is None:  # 极端兜底：供给刚 flush 过，正常不会缺
            row = StoryTextLimit(scope=key)
            db.add(row)
        row.max_chars = DEFAULT_MAX_CHARS
        row.warn_percent = DEFAULT_WARN_PERCENT
        row.enabled = 1
        row.updated_at = now
        row.updated_by = updated_by or ""
    await db.commit()
    return await list_scopes(db)


# ─── 运行时下发（fail-open）───────────────────────────────────────────────

def _to_runtime_item(row: StoryTextLimit) -> dict | None:
    """把库内行转成下发项；越界/非整数（历史脏数据）返回 None 表示「该 scope 不下发」。

    刻意**不 clamp**：把 999999 夹到 50000 会让「运营配错了」看起来像生效了，
    而桌面端对越界值的既定语义是回落内置默认（PRD §11 E5）。
    """
    max_chars = row.max_chars
    warn_percent = row.warn_percent
    if isinstance(max_chars, bool) or not isinstance(max_chars, int):
        return None
    if isinstance(warn_percent, bool) or not isinstance(warn_percent, int):
        return None
    if not (MIN_MAX_CHARS <= max_chars <= MAX_MAX_CHARS):
        return None
    if not (MIN_WARN_PERCENT <= warn_percent <= MAX_WARN_PERCENT):
        return None
    return {"maxChars": max_chars, "warnPercent": warn_percent}


async def get_bootstrap_story_text_limit(db: AsyncSession) -> dict | None:
    """bootstrap 下发块 ``storyTextLimit``；无可用 scope 或读库异常时返回 ``None``。

    返回值位于 Ed25519 签名覆盖范围内（runtime_service 对整个 payload 签名），
    因此运营值不可被中间人改写。

    **绝不向上抛异常**：本函数只承担一个可缺省的数据块，读库故障不该让整个 bootstrap
    500 —— bootstrap 一挂，全部客户端的运行时策略（公告/版本/敏感词/菜单）同时失效，
    而本块的缺失有内置默认兜底（10000 字 / 90%），代价远小于整包丢弃。
    """
    try:
        await _provision_from_catalog(db)
        await db.commit()
        rows = await _ordered_rows(db)
    except Exception as exc:  # noqa: BLE001 - 见 docstring：失败必须降级不得抛出
        try:
            await db.rollback()
        except Exception:  # pragma: no cover - rollback 失败无进一步可做
            pass
        logger.warning("storyTextLimit 读取失败，整块降级为 null（桌面端回落内置默认）：%s", exc)
        return None

    block: dict[str, dict] = {}
    for row in rows:
        if row.scope not in CATALOG_MAP:  # 读出口 fail-open：目录外的历史行不下发
            continue
        if not row.enabled:  # 关闭后整键不出现，桌面端据此回落内置默认
            continue
        item = _to_runtime_item(row)
        if item is None:
            logger.warning(
                "storyTextLimit 丢弃非法行 scope=%s max_chars=%r warn_percent=%r（下发侧不 clamp）",
                row.scope,
                row.max_chars,
                row.warn_percent,
            )
            continue
        block[row.scope] = item
    # 全部分支被禁用/丢弃时返回 None（而不是 {}）：「整块为 null」是契约里的降级信号，
    # 桌面端两种形态都会回落默认，但 null 更省字节且与 PRD §5.2 的极端情形一致。
    return block or None


async def ensure_story_text_limits_seeded(db: AsyncSession) -> None:
    """启动时按目录供给（生命周期钩子调用），保证页面首次打开前库内已有默认行。"""
    await _provision_from_catalog(db)
    await db.commit()
