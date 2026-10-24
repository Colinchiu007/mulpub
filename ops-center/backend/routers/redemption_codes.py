"""Redemption codes API — 兑换码批量签发（admin）。

⚠️ 收敛说明（2026-10-12）：本 router 原本自建 HMAC 兑换码（表 `redemption_codes`，
格式 `MP-RAND-RAND-SIG`），与桌面端 `electron/services/redemption-codes.js` 配套。
但那条桌面端兑换路径依赖 `license:activate`，该 IPC 在正式构建已被拒收（#3085），
**这套码签发得出来、兑不了**，等于第二套权威。

现改为纯转发：签发能力归 engine（`identity_redeem_codes` 表），本 router 不再
生成、存储或管理任何兑换码。

engine 侧补齐运营能力后（A2）已恢复列表与吊销：

- `GET  /api/v1/redemption-codes`          —— 转发 engine 列表（默认掩码）
- `POST /api/v1/redemption-codes/disable`  —— 转发 engine 吊销

**删除端点不下线**：engine 无 delete 能力，做软删除会造出第三套状态语义。
ops 不落库，所有状态一律以 engine 为准。
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from middleware.auth import require_admin
from services import redeem_batch_service
from services.redeem_batch_service import EngineAdminError

router = APIRouter(prefix="/api/v1/redemption-codes", tags=["redemption-codes"])


def _raise_http(e: EngineAdminError) -> None:
    """EngineAdminError → HTTPException，带上需要原样透传的业务载荷。

    REDEEM_BATCH_INCOMPLETE 携带的已签发码必须到达前端：engine 已签了一部分码
    却补足失败，若这里只回 400 文本，运营既不知道拿到了几个、也拿不到可交付的码。

    ⚠️ `detail`（人可读原因）也要透传：此前被丢弃 ⇒ 前端只剩一个错误码，
    运营看不懂「到底失败在哪」。它只来自本层的固定文案，不含 engine 原始响应体。
    """
    payload = dict(e.payload) if e.payload else {}
    if e.detail:
        payload["message"] = e.detail
    if payload:
        raise HTTPException(e.status, {"error": e.code, **payload})
    raise HTTPException(e.status, e.code)


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
        _raise_http(e)


@router.get("")
async def list_codes(
    plan: str | None = Query(default=None),
    status: str | None = Query(default=None),
    batch: str | None = Query(default=None),
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    reveal: bool = Query(default=False),
    user: dict = Depends(require_admin),
):
    """运营列表，转发 engine。

    默认返回**掩码**兑换码（`ABCD-****-****`）。确需原码时带 `reveal=true`，
    engine 会把该次操作写入 audit log。旧契约的 `revoked` 在本层映射为
    engine 的 `disabled`。
    """
    try:
        return await redeem_batch_service.list_redeem_codes(
            {"plan": plan, "status": status, "batch": batch,
             "limit": limit, "offset": offset, "reveal": reveal}
        )
    except EngineAdminError as e:
        _raise_http(e)


@router.post("/disable")
async def disable_code(
    body: dict,
    user: dict = Depends(require_admin),
):
    """吊销兑换码，转发 engine。重复吊销返回 200 + idempotent=true。

    已兑换的码返回 409（权益已发放，不可回滚）；不存在返回 404。
    """
    try:
        return await redeem_batch_service.disable_redeem_code(body)
    except EngineAdminError as e:
        _raise_http(e)
