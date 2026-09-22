"""Model preset catalog API — 预设模型设置 / 多模态能力设置 / 获取模型ID。"""
import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from middleware.auth import get_current_user, require_admin
from services import model_preset_service

router = APIRouter(prefix="/api/v1/model-presets", tags=["model-presets"])
def _secret() -> str:
    return settings.secret_key



@router.get("")
async def list_model_presets(
    category: str | None = None,
    include_hidden: bool = False,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """列出模型预设目录（登录用户可读；含已隐藏需 admin）。

    语义：
    - 运营目录对已登录用户只读可见（前端【模型设置】目录来源）。
    - include_hidden=true（含已隐藏）暴露隐藏项，属于运营管理操作，仅 admin 可用。
    """
    if include_hidden and user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限才能查看隐藏项")
    presets = await model_preset_service.list_model_presets(db, category=category, include_hidden=include_hidden)
    return {"presets": presets, "count": len(presets)}


@router.get("/catalog")
async def get_model_preset_catalog(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """模型目录只读同步端点（桌面端拉取运营配置，无需登录）。

    鉴权：X-Catalog-Key 头 == OPS_CATALOG_API_KEY（常量时间比较）。
    - 未配置 OPS_CATALOG_API_KEY → 404（不暴露端点存在性）
    - key 错误 → 401
    返回 is_visible=1 的目录（限流/模型/能力，不含敏感字段）。
    """
    from services.logto_verifier import verify_bearer_or_catalog_key
    await verify_bearer_or_catalog_key(request)
    items = await model_preset_service.list_catalog(db)
    return {"items": items, "count": len(items), "synced_at": datetime.datetime.utcnow().isoformat() + "Z"}

@router.get("/{preset_id}")
async def get_model_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    row = await model_preset_service.get_model_preset(db, preset_id)
    if row is None:
        raise HTTPException(404, f"Model preset not found: {preset_id}")
    # 隐藏项门禁与列表 include_hidden 语义一致：非 admin 不得读取隐藏预设
    if not row.is_visible and user.get("role") != "admin":
        raise HTTPException(404, f"Model preset not found: {preset_id}")
    return model_preset_service._to_dict(row)


@router.post("")
async def create_model_preset(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """创建模型预设（校验 doc_links/capability_doc_links 数量与格式）。"""
    try:
        return await model_preset_service.upsert_model_preset(db, body, updated_by=user.get("username", "admin"))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.put("/{preset_id}")
async def update_model_preset(
    preset_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    body = dict(body)
    body["id"] = preset_id
    try:
        return await model_preset_service.upsert_model_preset(db, body, updated_by=user.get("username", "admin"))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{preset_id}/reorder")
async def reorder_model_preset(
    preset_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """预设模型自定义排序（admin-only，所见即所得）：action ∈ top/up/down/bottom，点击即持久化。

    请求可携带 body.visible_ids（当前可见/筛选序列，按显示序）：仅在序列内重排，
    序列外预设绝对位置不变；缺省时退化为全量列表内移动（向后兼容）。移动后 sort_order
    归一化 0..n-1，边界操作幂等返回 200（result=noop，不写库）。响应结构同 GET 列表。
    """
    action = str((body or {}).get("action", "")).strip()
    raw_visible = (body or {}).get("visible_ids")
    if raw_visible is not None and not isinstance(raw_visible, list):
        raise HTTPException(400, "visible_ids 必须是数组")
    visible_ids = [str(x) for x in raw_visible] if isinstance(raw_visible, list) else None
    try:
        result = await model_preset_service.reorder_model_preset(db, preset_id, action, visible_ids=visible_ids)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if result == "not-found":
        raise HTTPException(404, f"Model preset not found: {preset_id}")
    presets = await model_preset_service.list_model_presets(db, include_hidden=True)
    return {"presets": presets, "count": len(presets), "result": result}


@router.post("/{preset_id}/fetch-models")
async def fetch_models(
    preset_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """从预设的获取模型ID URL 拉取全部支持的模型 ID（admin-only，SSRF 防护）。

    支持 body.models_url 覆盖（前端「获取模型」按钮使用未保存的表单 URL）；
    成功回写 models/models_url（default_model 若不在新列表则清空），失败不改动已有数据。
    """
    override = (body or {}).get("models_url") if isinstance(body, dict) else None
    try:
        models, default_model, models_url = await model_preset_service.fetch_models_from_url(db, preset_id, override)
    except ValueError as e:
        raise HTTPException(400, str(e))
    row = await model_preset_service.get_model_preset(db, preset_id)
    if row is None:
        # 拉取期间预设被并发删除：不写行、返回 404（避免 AttributeError 500）
        raise HTTPException(404, f"Model preset not found: {preset_id}")
    row.models = json.dumps(models, ensure_ascii=False)
    row.default_model = default_model
    row.models_url = models_url
    row.updated_at = datetime.datetime.utcnow().isoformat()
    await db.commit()
    await db.refresh(row)
    return {"models": models, "default_model": default_model, "count": len(models)}



@router.post("/{preset_id}/test")
async def test_model_preset(
    preset_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """测试模型预设连通性（admin-only）：用配置的 API Key 真实调用 API，验证连通性。

    探测策略（OpenAI 兼容最小请求）：
    1) POST {base}/chat/completions（max_tokens=1）——覆盖 llm/vision/chat 类；
    2) 若返回 404/405，或 400 且错误体命中模型关键字 → fallback GET {base}/models —— 覆盖 image 类；
    3) 均不可达 → 报错并提示「请用真实生成验证」。
    """
    from services import model_preset_service
    try:
        return await model_preset_service.test_provider_connection(db, preset_id, body or {}, _secret())
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"连通性测试失败: {e}")

@router.delete("/{preset_id}")
async def delete_model_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    ok = await model_preset_service.delete_model_preset(db, preset_id)
    if not ok:
        raise HTTPException(404, f"Model preset not found: {preset_id}")
    return {"deleted": preset_id}
