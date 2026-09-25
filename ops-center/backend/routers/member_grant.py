"""Member grants API — 订阅手动开通（admin，转发 engine admin grant）。"""
from fastapi import APIRouter, Depends, HTTPException

from middleware.auth import require_admin
from services import member_grant_service
from services.member_grant_service import EngineAdminError

router = APIRouter(prefix="/api/v1/member", tags=["member"])

# 与 engine plan-matrix 对齐：free 不可"开通"，其余付费档位按 engine 校验为准
_GRANTABLE_PLANS = ("standard", "pro")


@router.post("/grants")
async def create_grant(body: dict, user: dict = Depends(require_admin)):
    user_id = body.get("userId")
    plan = body.get("plan")
    days = body.get("durationDays")
    if not isinstance(user_id, str) or not user_id.strip():
        raise HTTPException(400, "USER_ID_REQUIRED")
    if plan not in _GRANTABLE_PLANS:
        raise HTTPException(400, "PLAN_INVALID")
    if not isinstance(days, int) or isinstance(days, bool) or days <= 0:
        raise HTTPException(400, "DURATION_INVALID")
    try:
        return await member_grant_service.grant_plan(
            user_id=user_id.strip(), plan=plan, duration_days=days,
            operator=user.get("username", "unknown"),
        )
    except EngineAdminError as e:
        raise HTTPException(e.status, e.code)
