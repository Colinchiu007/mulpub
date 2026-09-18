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
import json
import re

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from models import Announcement, ContentPolicy, UpdatePolicy

_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
SEVERITIES = ("info", "warning", "maintenance")


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
    now = _now()
    row = (await db.execute(sa.select(UpdatePolicy).order_by(UpdatePolicy.id).limit(1))).scalar_one_or_none()
    if row is None:
        row = UpdatePolicy(min_version=min_version, force_version=force_version,
                           gray_ratio=gray_ratio, enabled=enabled, note=note, updated_at=now)
        db.add(row)
    else:
        row.min_version = min_version
        row.force_version = force_version
        row.gray_ratio = gray_ratio
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

async def get_runtime_bootstrap(db: AsyncSession) -> dict:
    from services.feature_flag_service import list_runtime_feature_flags
    from services.platform_def_service import list_runtime_platform_defs
    from services.content_template_service import list_runtime_content_templates
    from services.keyword_watchlist_service import list_runtime_watchlist
    from services.rewrite_strategy_service import list_runtime_rewrite_strategies
    from services.rewrite_hard_constraint_service import get_default_runtime as get_default_hard_constraint

    return {
        "announcements": await list_active_announcements(db),
        "update_policy": await get_update_policy(db),
        "content_policy": await get_content_policy(db),
        "feature_flags": await list_runtime_feature_flags(db),
        "platform_defs": await list_runtime_platform_defs(db),
        "content_templates": await list_runtime_content_templates(db),
        "keyword_watchlist": await list_runtime_watchlist(db),
        "rewrite_strategies": await list_runtime_rewrite_strategies(db),
        "rewrite_hard_constraints": await get_default_hard_constraint(db),
        "pipelineOptions": await _get_pipeline_options(db),
        "appMenu": await _get_app_menu(db),
        "synced_at": _now(),
    }


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
