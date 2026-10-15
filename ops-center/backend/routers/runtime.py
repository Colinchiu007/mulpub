"""Runtime policy API — 运营公告 / 版本发布策略 / 内容安全策略。

- 管理 CRUD 走登录鉴权（require_admin）
- GET /api/v1/runtime/bootstrap 与 POST /api/v1/runtime/ack 走
  「Bearer(Logto JWT) 优先，或 X-Catalog-Key」双通道（`verify_bearer_or_catalog_key`），
  与模型目录端点同鉴权。

2026-10-15（auth-single-source）：这两个端点此前经本模块私有包装 `_require_catalog_key`
在函数体内调用 —— 该包装**与 diagnostics/usage/publish_metrics 里的同名函数语义不同**
（那三处只认静态 key，本处 Bearer 双通道），同名不同语义是真实隐患。现统一改为
`Depends(verify_bearer_or_catalog_key)`，鉴权强度由依赖名唯一表达。
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from middleware.auth import get_current_user, require_admin
from services import resilience_service, runtime_service
from services.logto_verifier import verify_bearer_or_catalog_key

router = APIRouter(tags=["runtime"])


# ─── 公告 ────────────────────────────────────────────────

@router.get("/api/v1/announcements")
async def list_announcements(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    items = await runtime_service.list_announcements(db)
    return {"items": items, "count": len(items)}


@router.post("/api/v1/announcements")
async def create_announcement(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await runtime_service.upsert_announcement(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.put("/api/v1/announcements/{announcement_id}")
async def update_announcement(
    announcement_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await runtime_service.upsert_announcement(db, body, announcement_id=announcement_id)
    except KeyError:
        raise HTTPException(404, "公告不存在")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/api/v1/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    ok = await runtime_service.delete_announcement(db, announcement_id)
    if not ok:
        raise HTTPException(404, "公告不存在")
    return {"ok": True}


# ─── 版本发布策略 ────────────────────────────────────────

@router.get("/api/v1/update-policy")
async def get_update_policy(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return await runtime_service.get_update_policy(db)


@router.put("/api/v1/update-policy")
async def put_update_policy(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await runtime_service.upsert_update_policy(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ─── 内容安全策略 ────────────────────────────────────────

@router.get("/api/v1/content-policy")
async def get_content_policy(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await runtime_service.get_content_policy(db)


@router.put("/api/v1/content-policy")
async def put_content_policy(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await runtime_service.upsert_content_policy(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ─── 运行时只读 bootstrap（桌面端）────────────────────────

@router.get("/api/v1/runtime/bootstrap")
async def get_runtime_bootstrap(
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(verify_bearer_or_catalog_key),
):
    # 签名私钥未配置 → 404 fail-closed（与 catalog_api_key 未配置同一模式）：
    # 未签名响应将被桌面端整体拒绝（尤其 pipelineOptions 阻塞），弱配置必须显式暴露。
    try:
        signing_key = settings.get_runtime_signing_private_key()
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    if signing_key is None:
        raise HTTPException(404, "运行时签名未启用（未配置 OPS_RUNTIME_SIGNING_PRIVATE_KEY）")
    return await runtime_service.get_runtime_bootstrap_signed(db, signing_key)


# ─── 生效回执 / 生效聚合（2026-10-08 ops-center-resilience）────────────
# 这两个端点回答运营负责人的核心问题：「我改完设置，到底有多少客户端真的生效了」。
# 契约见 openspec/changes/ops-center-resilience/design.md §2。


@router.post("/api/v1/runtime/ack")
async def post_runtime_ack(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(verify_bearer_or_catalog_key),
):
    """客户端上报生效回执（鉴权与 bootstrap 同款）。"""
    try:
        return await resilience_service.record_client_ack(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/v1/runtime/rollout")
async def get_runtime_rollout(
    version: int | None = Query(None, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """配置生效看板数据（仅管理员；目录同步 Key 不得读取——这是内部运营数据）。"""
    return await resilience_service.rollout_summary(db, version=version, limit=limit)
