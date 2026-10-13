"""Redemption codes API — 兑换码批量签发（admin）。

⚠️ 收敛说明（2026-10-12）：本 router 原本自建 HMAC 兑换码（表 `redemption_codes`，
格式 `MP-RAND-RAND-SIG`），与桌面端 `electron/services/redemption-codes.js` 配套。
但那条桌面端兑换路径依赖 `license:activate`，该 IPC 在正式构建已被拒收（#3085），
**这套码签发得出来、兑不了**，等于第二套权威。

现改为纯转发：签发能力归 engine（`identity_redeem_codes` 表），本 router 不再
生成、存储或管理任何兑换码。列表/吊销/删除端点随之下线——engine 侧尚无对应
能力（`status='disabled'` 字段已就位但无 API），补齐前不提供假实现。
补齐后会在本文件恢复对应端点，届时 ops 不再落库，状态一律以 engine 为准。
"""
from fastapi import APIRouter, Depends, HTTPException

from middleware.auth import require_admin
from services import redeem_batch_service
from services.redeem_batch_service import EngineAdminError

router = APIRouter(prefix="/api/v1/redemption-codes", tags=["redemption-codes"])


@router.post("/batch")
async def create_batch(
    body: dict,
    user: dict = Depends(require_admin),
):
    """批量签发兑换码，转发 engine。

    保留原路径 `/api/v1/redemption-codes/batch`，前端与任何已对接的脚本无需改 URL。
    请求体语义随 engine 契约变化（破坏性变更，见 ops-center/frontend 的 PLAN_OPTIONS）：
      - plan:      `free|trial|pro` → `standard|pro`（engine 拒 free，无 trial 档）
      - durationDays: **新增必填**正整数（engine 按固定天数授权，ops 旧语义是"到 expires_at 为止"）
      - note:      移除（engine 无对应概念）
    """
    try:
        return await redeem_batch_service.create_redeem_batch(body)
    except EngineAdminError as e:
        raise HTTPException(e.status, e.code)
