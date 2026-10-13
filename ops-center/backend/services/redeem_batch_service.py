"""Redeem batch service — 兑换码批量签发转发 engine admin 端点。

## 为什么转发而不是本地签发

ops-center 曾自建一套 HMAC（`MP-RAND-RAND-SIG`）兑换码签发，与桌面端
`electron/services/redemption-codes.js` 配套。但那条桌面端兑换路径依赖
`license:activate`，而该 IPC 在正式构建已被拒收（#3085），于是这套码
**签发得出来、兑不了**——等于第二套权威。

真源只有一处：engine 的 `POST /api/v1/admin/member/redeem-codes`
（`identity_redeem_codes` 表）。本服务把 ops 后端变成纯转发方，
签发能力归 engine，ops 不再持有任何兑换码生成逻辑。

## 鉴权

engine 侧 admin 端点只认带 `admin:users` scope 的 logto JWT，静态主密钥被
显式拒绝（防花钱端点被 key 滥用）。故 ops 后端必须经 M2M token 转发，
本服务不自持权益判定——与 `member_grant_service.py` 同一模式。
"""
from __future__ import annotations

import httpx

from config import settings

#: 代理对外契约上限。engine 侧上限是 500，此处保守收窄到 200：
#: 一次签发几百个码而 `generated < requested`（DB 碰撞静默丢弃）时，
#: 少发的码无法追溯，收窄批量可把潜在损失压到可接受范围。
#: 待 engine 侧补齐碰撞补足后（见 D1/A2 后续项）再放宽。
MAX_BATCH = 200

#: engine `createRedeemBatch` 拒 `free`（PLAN_INVALID），且只认 `standard|pro`。
#: ops 旧枚举里的 `trial` 在 engine 侧不存在，此处收敛为真实存在的付费档。
SUPPORTED_PLANS = ("standard", "pro")


def _new_client():
    return httpx.AsyncClient(timeout=15)


class EngineAdminError(Exception):
    """status 为透传给前端的 HTTP 状态码，code 为机器可读错误码。"""

    def __init__(self, status: int, code: str, detail: str = ""):
        super().__init__(code)
        self.status = status
        self.code = code
        self.detail = detail


def _validate(body: dict) -> dict:
    """本地先挡掉必然被 engine 拒绝的入参，避免无谓往返。

    这是**前置校验**而非信任边界——engine 仍会独立校验一遍。
    """
    plan = body.get("plan")
    if plan not in SUPPORTED_PLANS:
        raise EngineAdminError(400, "PLAN_INVALID", f"plan 必须是 {SUPPORTED_PLANS} 之一")

    duration_days = body.get("durationDays")
    # bool 是 int 的子类：isinstance(True, int) 为 True，必须显式排除
    if isinstance(duration_days, bool) or not isinstance(duration_days, int) or duration_days <= 0:
        raise EngineAdminError(400, "DURATION_INVALID", "durationDays 必须是正整数")

    count = body.get("count", 1)
    if isinstance(count, bool) or not isinstance(count, int) or count < 1 or count > MAX_BATCH:
        raise EngineAdminError(400, "BATCH_COUNT_INVALID", f"count 必须是 1-{MAX_BATCH} 的整数")

    payload: dict = {"plan": plan, "durationDays": duration_days, "count": count}

    batch = body.get("batch")
    if isinstance(batch, str) and batch.strip():
        payload["batch"] = batch.strip()

    # ops 旧字段名是 expires_at（ISO string）；engine 侧叫 expiresAt。
    # 旧值允许为空串，engine 语义是 null=永不过期。
    expires_at = body.get("expiresAt", body.get("expires_at"))
    if isinstance(expires_at, str) and expires_at.strip():
        payload["expiresAt"] = expires_at.strip()

    # ops 旧表单有 note 字段，engine 侧无对应概念——显式丢弃而不是透传，
    # 透传会让 engine 收到未声明字段，违反「不整包透传」的白名单原则。
    return payload


async def create_redeem_batch(body: dict) -> dict:
    base = (settings.engine_admin_base_url or "").strip().rstrip("/")
    token = (settings.engine_admin_token or "").strip()
    if not base or not token:
        raise EngineAdminError(503, "ENGINE_ADMIN_NOT_CONFIGURED")

    payload = _validate(body if isinstance(body, dict) else {})

    client = _new_client()
    try:
        resp = await client.post(
            f"{base}/api/v1/admin/member/redeem-codes",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError as e:
        raise EngineAdminError(502, "ENGINE_ADMIN_UNREACHABLE", str(e))
    finally:
        await client.aclose()

    if resp.status_code >= 400:
        try:
            code = str(resp.json().get("error") or "ENGINE_ADMIN_ERROR")
        except Exception:
            code = "ENGINE_ADMIN_ERROR"
        raise EngineAdminError(resp.status_code, code)

    data = resp.json()
    # engine 返回 { success, batch, plan, durationDays, requested, generated, codes[] }。
    # 透传完整响应体：generated < requested 时前端必须能看到差额，不能静默。
    return data
