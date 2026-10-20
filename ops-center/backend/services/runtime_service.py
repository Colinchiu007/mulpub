"""Runtime policy service — 运营公告 / 版本发布策略 / 内容安全策略。

管理 CRUD 供运营后台使用；get_runtime_bootstrap 供桌面端 runtime/bootstrap 只读拉取。
校验失败抛 ValueError，router 层转 400。

签名契约（Stage -1.6）：
- get_runtime_bootstrap_signed 用 Ed25519 私钥对 canonical JSON 签名，返回 payload + signature(base64)。
- canonical 序列化必须与桌面端 canonicalJson 完全一致：
  json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))，UTF-8 字节。
  双端交叉验证见 ops-center-sync.test.js 固定向量。
"""
import base64
import datetime
import hashlib
import json
import logging
import math
import re

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from models import Announcement, ContentPolicy, RuntimeConfigVersion, UpdatePolicy
from services import config_fingerprint

logger = logging.getLogger(__name__)

_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
SEVERITIES = ("info", "warning", "maintenance")


# ─── 配置版本号 / 内容指纹（2026-10-08 ops-center-resilience）────────────
# 实现已下沉到 services/config_fingerprint.py：该模块已逼近 max-lines 门禁（CI 按 LF 计 500 行），
# 而 hash 计算 + 数值校验是边界清晰的纯函数单元。此处只做**转发**，不保留第二份实现 ——
# 两处各写一份正是跨端漂移的来源。
#
# canonical_json 由本模块注入（与桌面端逐字节对齐的那个实现），避免指纹模块再复制一份序列化器。
RUNTIME_BLOCKS = config_fingerprint.RUNTIME_BLOCKS
assert_integer_numbers = config_fingerprint.assert_integer_numbers


def compute_config_hash(payload: dict) -> str:
    return config_fingerprint.compute_config_hash(payload, canonical_json)


async def resolve_config_version(db: AsyncSession, config_hash: str) -> int:
    """读时推导的版本号分配：内容指纹变则升版，没变则版本不动。

    刻意不做「配置变更钩子」：那要改 39 个运营页面的写路径，回归面远大于收益。
    代价是每次 bootstrap 多一次 SELECT（唯一索引覆盖，成本可忽略）。

    **绝不向上抛异常**：本函数失败绝不能让整个 bootstrap 失败——bootstrap 一挂，
    全部客户端的运行时策略（公告/版本/敏感词/菜单）同时失效，代价远大于版本号少一次。
    任何异常一律降级为返回 0 并留日志。
    """
    try:
        latest = (await db.execute(
            sa.select(RuntimeConfigVersion).order_by(RuntimeConfigVersion.version.desc()).limit(1)
        )).scalars().first()
        if latest is not None and latest.config_hash == config_hash:
            return latest.version
        existing = (await db.execute(
            sa.select(RuntimeConfigVersion).where(RuntimeConfigVersion.config_hash == config_hash)
        )).scalars().first()
        if existing is not None:
            # 并发下另一个请求已占过同一个指纹的号，直接复用
            return existing.version
        next_version = (latest.version if latest is not None else 0) + 1
        db.add(RuntimeConfigVersion(version=next_version, config_hash=config_hash))
        await db.commit()
        return next_version
    except Exception as exc:  # noqa: BLE001 - 见上方 docstring：失败必须降级不得抛出
        try:
            await db.rollback()
        except Exception:  # pragma: no cover - rollback 失败无进一步可做
            pass
        logger.warning("config_version 解析失败，降级为 0：%s", exc)
        return 0


def _now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


def _iso_or_empty(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    try:
        dt = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("时间必须是 ISO 格式（如 2026-08-10T00:00:00）")
    # 归一化为 naive UTC：带时区偏移的输入（如 +08:00）转 UTC 后去掉 tzinfo，
    # 与 list_active_announcements 的 utcnow().isoformat() 字符串比较保持一致。
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return dt.isoformat()


def _validate_version(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if not _VERSION_RE.match(text):
        raise ValueError("版本号格式必须是 x.y.z（如 2.3.53）")
    return text


def _validate_gray_ratio(value) -> int:
    if value is None or str(value).strip() == "":
        return 100
    try:
        num = int(value)
    except (TypeError, ValueError):
        raise ValueError("灰度比例必须是 0-100 的整数")
    if num < 0 or num > 100:
        raise ValueError("灰度比例必须在 0-100 之间")
    return num


def _validate_word_list(value) -> str:
    if value is None:
        return "[]"
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return "[]"
        try:
            words = json.loads(text)
        except json.JSONDecodeError:
            raise ValueError("敏感词必须是 JSON 数组")
    elif isinstance(value, list):
        words = value
    else:
        raise ValueError("敏感词必须是 JSON 数组")
    cleaned = []
    for w in words:
        if not isinstance(w, str) or not w.strip():
            continue
        if len(w) > 100:
            raise ValueError("单个敏感词长度不能超过 100 字符")
        cleaned.append(w.strip())
    cleaned = list(dict.fromkeys(cleaned))  # 去重保序
    if len(cleaned) > 5000:
        raise ValueError("敏感词数量不能超过 5000")
    return json.dumps(cleaned, ensure_ascii=False)


def _validate_replacement(value) -> str:
    if value is None:
        return "***"
    text = str(value).strip()
    if len(text) > 16:
        raise ValueError("替换串长度不能超过 16 字符")
    return text or "***"


def _announcement_to_dict(row: Announcement) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "content": row.content,
        "severity": row.severity,
        "active_from": row.active_from or "",
        "active_until": row.active_until or "",
        "enabled": bool(row.enabled),
        "sort_order": row.sort_order or 0,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _update_policy_to_dict(row) -> dict | None:
    if row is None:
        return None
    return {
        "id": row.id,
        "min_version": row.min_version or "",
        "force_version": row.force_version or "",
        "gray_ratio": row.gray_ratio if row.gray_ratio is not None else 100,
        # forced-update-gate：存量库补列前 row 上可能没有这两列（迁移前读旧快照），getattr 兜底
        "enforce_min_version": getattr(row, "enforce_min_version", None) or "",
        "enforce_enabled": bool(getattr(row, "enforce_enabled", 0)),
        "enabled": bool(row.enabled),
        "note": row.note or "",
        "updated_at": row.updated_at,
    }


def _content_policy_to_dict(row) -> dict | None:
    if row is None:
        return None
    try:
        words = json.loads(row.word_list or "[]")
    except json.JSONDecodeError:
        words = []
    return {
        "id": row.id,
        "name": row.name or "",
        "word_list": words if isinstance(words, list) else [],
        "replacement": row.replacement or "***",
        "enabled": bool(row.enabled),
        "updated_at": row.updated_at,
    }


# ─── 公告 ────────────────────────────────────────────────

async def list_announcements(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        sa.select(Announcement).order_by(Announcement.sort_order, Announcement.id)
    )).scalars().all()
    return [_announcement_to_dict(r) for r in rows]


async def upsert_announcement(db: AsyncSession, body: dict, announcement_id: int | None = None) -> dict:
    title = str(body.get("title") or "").strip()
    content = str(body.get("content") or "").strip()
    if not title:
        raise ValueError("标题不能为空")
    if len(title) > 200:
        raise ValueError("标题长度不能超过 200 字符")
    severity = str(body.get("severity") or "info").strip()
    if severity not in SEVERITIES:
        raise ValueError("severity 必须是 info/warning/maintenance 之一")
    active_from = _iso_or_empty(body.get("active_from"))
    active_until = _iso_or_empty(body.get("active_until"))
    if active_from and active_until and active_until < active_from:
        raise ValueError("结束时间不能早于开始时间")
    try:
        sort_order = int(body.get("sort_order") or 0)
    except (TypeError, ValueError):
        sort_order = 0
    enabled = 1 if str(body.get("enabled", "true")).lower() in ("true", "1") else 0

    now = _now()
    if announcement_id is None:
        row = Announcement(title=title, content=content, severity=severity,
                           active_from=active_from, active_until=active_until,
                           enabled=enabled, sort_order=sort_order,
                           created_at=now, updated_at=now)
        db.add(row)
    else:
        row = (await db.execute(sa.select(Announcement).where(Announcement.id == announcement_id))).scalar_one_or_none()
        if row is None:
            raise KeyError("公告不存在")
        row.title = title
        row.content = content
        row.severity = severity
        row.active_from = active_from
        row.active_until = active_until
        row.enabled = enabled
        row.sort_order = sort_order
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return _announcement_to_dict(row)


async def delete_announcement(db: AsyncSession, announcement_id: int) -> bool:
    row = (await db.execute(sa.select(Announcement).where(Announcement.id == announcement_id))).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True


# ─── 版本发布策略 ────────────────────────────────────────

async def get_update_policy(db: AsyncSession) -> dict | None:
    row = (await db.execute(sa.select(UpdatePolicy).order_by(UpdatePolicy.id).limit(1))).scalar_one_or_none()
    return _update_policy_to_dict(row)


def _cmp_version(v: str) -> tuple:
    return tuple(int(x) for x in v.split("."))


async def upsert_update_policy(db: AsyncSession, body: dict) -> dict:
    min_version = _validate_version(body.get("min_version"))
    force_version = _validate_version(body.get("force_version"))
    if min_version and force_version and _cmp_version(force_version) >= _cmp_version(min_version):
        raise ValueError("强制版本必须低于最低版本（语义：低于 force 强制升级，force ≤ 版本 < min 提示升级）")
    gray_ratio = _validate_gray_ratio(body.get("gray_ratio"))
    enabled = 1 if str(body.get("enabled", "true")).lower() in ("true", "1") else 0
    note = str(body.get("note") or "").strip()[:200]
    # ── forced-update-gate：强制阻断字段（2026-10-19）──
    enforce_enabled = 1 if str(body.get("enforce_enabled", "false")).lower() in ("true", "1") else 0
    enforce_min_version = _validate_version(body.get("enforce_min_version"))
    if enforce_enabled:
        if not enforce_min_version:
            raise ValueError("启用强制阻断时必须填写 enforce_min_version（低于此版本的客户端将被阻断）")
        if min_version and _cmp_version(enforce_min_version) >= _cmp_version(min_version):
            raise ValueError("强制阻断版本必须低于最低提示版本（阻断线必须严于提示线）")
        # QM-6 i4 修复：min_version 为空时 enforce 无上界 → 误配 99.0.0 会全员硬锁。
        # 上界回落 force_version；两者都空则拒绝启用（先配置提示/强制线再开阻断）。
        if not min_version and force_version and _cmp_version(enforce_min_version) >= _cmp_version(force_version):
            raise ValueError("强制阻断版本必须低于强制下载版本（min_version 为空时以 force_version 为上界）")
        if not min_version and not force_version:
            raise ValueError("启用强制阻断前必须先配置 min_version 或 force_version 作为阻断线上界（防误配全员硬锁）")
    now = _now()
    row = (await db.execute(sa.select(UpdatePolicy).order_by(UpdatePolicy.id).limit(1))).scalar_one_or_none()
    if row is None:
        row = UpdatePolicy(min_version=min_version, force_version=force_version,
                           gray_ratio=gray_ratio, enforce_min_version=enforce_min_version,
                           enforce_enabled=enforce_enabled, enabled=enabled, note=note, updated_at=now)
        db.add(row)
    else:
        row.min_version = min_version
        row.force_version = force_version
        row.gray_ratio = gray_ratio
        row.enforce_min_version = enforce_min_version
        row.enforce_enabled = enforce_enabled
        row.enabled = enabled
        row.note = note
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return _update_policy_to_dict(row)


# ─── 内容安全策略 ────────────────────────────────────────

async def get_content_policy(db: AsyncSession) -> dict | None:
    row = (await db.execute(sa.select(ContentPolicy).order_by(ContentPolicy.id).limit(1))).scalar_one_or_none()
    return _content_policy_to_dict(row)


async def upsert_content_policy(db: AsyncSession, body: dict) -> dict:
    name = str(body.get("name") or "默认内容安全策略").strip()[:100]
    word_list = _validate_word_list(body.get("word_list"))
    replacement = _validate_replacement(body.get("replacement"))
    enabled = 1 if str(body.get("enabled", "true")).lower() in ("true", "1") else 0
    if len(word_list.encode("utf-8")) > 800 * 1024:
        raise ValueError("敏感词库序列化后不能超过 800KB，请精简词库")
    now = _now()
    row = (await db.execute(sa.select(ContentPolicy).order_by(ContentPolicy.id).limit(1))).scalar_one_or_none()
    if row is None:
        row = ContentPolicy(name=name, word_list=word_list, replacement=replacement,
                            enabled=enabled, updated_at=now)
        db.add(row)
    else:
        row.name = name
        row.word_list = word_list
        row.replacement = replacement
        row.enabled = enabled
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return _content_policy_to_dict(row)


# ─── 运行时 bootstrap（桌面端只读）────────────────────────

async def list_active_announcements(db: AsyncSession) -> list[dict]:
    now = datetime.datetime.utcnow().isoformat()
    rows = (await db.execute(
        sa.select(Announcement).where(Announcement.enabled == 1).order_by(Announcement.sort_order, Announcement.id)
    )).scalars().all()
    result = []
    for r in rows:
        if r.active_from and r.active_from > now:
            continue
        if r.active_until and r.active_until < now:
            continue
        result.append({
            "id": r.id,
            "title": r.title,
            "content": r.content,
            "severity": r.severity,
            "active_from": r.active_from or "",
            "active_until": r.active_until or "",
        })
    return result



async def _get_pipeline_options(db: AsyncSession) -> dict:
    """视频创作流水线选项控制（2026-08-31）"""
    from services import pipeline_option_service
    return await pipeline_option_service.get_bootstrap_options(db)


async def _get_app_menu(db: AsyncSession) -> dict:
    """应用端左侧边栏菜单配置（2026-09-15）——显示/隐藏 + 组内排序。

    注意：本函数的返回值位于 bootstrap 响应的 Ed25519 签名覆盖范围内
    （sign_runtime_payload 对整个 payload 的 canonical JSON 签名），
    因此新增字段不会被篡改。改动 payload 结构时不得移除签名步骤。
    """
    from services import app_menu_service
    return await app_menu_service.get_bootstrap_app_menu(db)

async def _get_content_categories(db: AsyncSession) -> dict:
    """统一内容类别下发（2026-10-03）——只下发 enabled=1。

    与 appMenu 同点位：位于 bootstrap 响应的 Ed25519 签名覆盖范围内，
    新增字段不会被篡改。
    """
    from services import content_category_service
    return await content_category_service.get_bootstrap_content_categories(db)


async def _get_story_text_limit(db: AsyncSession) -> dict | None:
    """故事讲述文案字数上限下发（2026-10-18）——运营中心「字数控制」的唯一载荷。

    形状固定为 ``{"story2video": {"maxChars": <int>, "warnPercent": <int>}}``；
    enabled=0 的 scope 整键不出现；整块不可用（读库异常 / 全部禁用）时为 ``None``，
    桌面端据此回落内置默认（10000 字 / 90%）。

    与 appMenu / contentCategories 同点位：位于 bootstrap 响应的 Ed25519 签名覆盖范围内，
    因此运营值不可被中间人改写。数值只能是整数，否则 compute_config_hash 会 fail-closed。
    """
    from services import story_text_limit_service
    return await story_text_limit_service.get_bootstrap_story_text_limit(db)


async def get_runtime_bootstrap(db: AsyncSession) -> dict:
    from services.feature_flag_service import list_runtime_feature_flags
    from services.platform_def_service import list_runtime_platform_defs
    from services.content_template_service import list_runtime_content_templates
    from services.keyword_watchlist_service import list_runtime_watchlist
    from services.rewrite_strategy_service import list_runtime_rewrite_strategies
    from services.rewrite_hard_constraint_service import get_default_runtime as get_default_hard_constraint
    from services.rewrite_ai_taste_service import list_runtime_entries as list_runtime_ai_taste_entries

    payload = {
        "announcements": await list_active_announcements(db),
        "update_policy": await get_update_policy(db),
        "content_policy": await get_content_policy(db),
        "feature_flags": await list_runtime_feature_flags(db),
        "platform_defs": await list_runtime_platform_defs(db),
        "content_templates": await list_runtime_content_templates(db),
        "keyword_watchlist": await list_runtime_watchlist(db),
        "rewrite_strategies": await list_runtime_rewrite_strategies(db),
        "rewrite_hard_constraints": await get_default_hard_constraint(db),
        "rewrite_ai_taste_map": await list_runtime_ai_taste_entries(db),
        "pipelineOptions": await _get_pipeline_options(db),
        "appMenu": await _get_app_menu(db),
        "contentCategories": await _get_content_categories(db),
        "storyTextLimit": await _get_story_text_limit(db),
        "synced_at": _now(),
    }
    # 配置版本号 + 内容指纹（2026-10-08 ops-center-resilience）。
    # 两者都写进 payload 且早于签名步骤，因此落在 Ed25519 覆盖范围内——
    # 客户端可以据此证明「这版号不是我伪造的」，否则 ACK 回执就不可信。
    #
    # hash 计算对「非整数数字」fail-closed（compute_config_hash 抛 ValueError）。
    # 这里**必须**兜住：bootstrap 一挂，全部客户端的运行时策略（公告/版本/敏感词/菜单）
    # 同时失效，代价远大于「看板少一个版本号」。降级为 hash=空串 + version=0，
    # 客户端会因此永远判「hash 未变」⇒ 只发 24h 心跳，不会空烧流量。
    try:
        payload["config_hash"] = compute_config_hash(payload)
        payload["config_version"] = await resolve_config_version(db, payload["config_hash"])
    except ValueError as exc:
        logger.error("配置内容含跨端不一致的数值，版本号降级为 0（策略仍正常下发）：%s", exc)
        payload["config_hash"] = ""
        payload["config_version"] = 0
    return payload


def canonical_json(payload: dict) -> str:
    """canonical JSON 序列化（与桌面端 ops-center-sync.js canonicalJson 对齐）。

    D-7.3：显式 ``allow_nan=False``。合法数据输出逐字节不变（Ed25519 签名兼容）；
    一旦混入非有限浮点（NaN/Infinity，如历史脏数据 "NaN" 字面量经 json.loads 还原），
    宁可在服务端显式失败，也不产出裸 ``NaN`` 这种非法 JSON 令所有客户端整包丢弃
    bootstrap（content_policy 等运行时策略随之失效且零告警）。
    """
    return json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def sign_runtime_payload(payload: dict, signing_key) -> dict:
    """对 canonical payload 做 Ed25519 签名，返回 {**payload, "signature": base64}。"""
    canonical = canonical_json(payload)
    signature = base64.b64encode(signing_key.sign(canonical.encode("utf-8"))).decode("ascii")
    return {**payload, "signature": signature}


async def get_runtime_bootstrap_signed(db: AsyncSession, signing_key) -> dict:
    """签名版 runtime bootstrap（桌面端拉取入口；signing_key 由 router 注入）。"""
    return sign_runtime_payload(await get_runtime_bootstrap(db), signing_key)
