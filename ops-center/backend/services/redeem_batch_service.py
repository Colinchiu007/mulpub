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

import re

import httpx

from config import settings

#: 代理对外契约上限。engine 侧上限是 500。
#: 最初收窄到 200 是为了压住「碰撞静默少发」的潜在损失——engine 侧补齐碰撞
#: 补足（REDEEM_TOPUP_MAX_ROUNDS）后该风险已消除，此处保持 200 作为运营侧的
#: 保守批量上限，不再是止损手段。
MAX_BATCH = 200

#: engine `createRedeemBatch` 拒 `free`（PLAN_INVALID），且只认 `standard|pro`。
#: ops 旧枚举里的 `trial` 在 engine 侧不存在，此处收敛为真实存在的付费档。
SUPPORTED_PLANS = ("standard", "pro")

#: 列表分页上限。engine 侧同样是 1-200，这里不额外放宽。
MAX_PAGE_SIZE = 200

#: engine `identity_redeem_codes.status` 的 CHECK 约束同源。
#: ops 旧契约用的是 `revoked`——engine 没有这个词，必须在转发层映射掉，
#: 否则前端会把 `revoked` 传下去、engine 返回 400 且错误信息难以定位。
REDEEM_STATUSES = ("active", "used", "disabled")

#: 与 engine `REDEEM_CODE_PATTERN` 同源（4-4-4，排除 I/L/O/0/1）。
REDEEM_CODE_RE = re.compile(
    r"^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$"
)


def _new_client():
    return httpx.AsyncClient(timeout=15)


class EngineAdminError(Exception):
    """status 为透传给前端的 HTTP 状态码，code 为机器可读错误码。

    payload 用于承载需要**原样回给前端**的业务载荷——目前只有
    REDEEM_BATCH_INCOMPLETE：engine 已签发了一部分码却补足失败，
    若只回错误码，调用方既不知道拿到了多少、也拿不到可交付的那部分。
    丢弃已签发码等于让运营重签，纯错误码在这里是有损的。
    """

    def __init__(self, status: int, code: str, detail: str = "", payload: dict | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.detail = detail
        self.payload = payload or None


async def _call_engine(method: str, path: str, **kwargs) -> dict:
    """engine admin 调用的唯一出口：配置检查、鉴权头、错误映射都在这里收口。"""
    base = (settings.engine_admin_base_url or "").strip().rstrip("/")
    token = (settings.engine_admin_token or "").strip()
    if not base or not token:
        raise EngineAdminError(503, "ENGINE_ADMIN_NOT_CONFIGURED")

    client = _new_client()
    try:
        resp = await client.request(
            method,
            f"{base}{path}",
            headers={"Authorization": f"Bearer {token}"},
            **kwargs,
        )
    except httpx.HTTPError as e:
        raise EngineAdminError(502, "ENGINE_ADMIN_UNREACHABLE", str(e))
    finally:
        await client.aclose()

    if resp.status_code >= 400:
        try:
            body = resp.json()
            code = str(body.get("error") or "ENGINE_ADMIN_ERROR")
        except Exception:
            body = {}
            code = "ENGINE_ADMIN_ERROR"
        # 只有引擎明确带了业务载荷才原样带回，其余错误只透传 code——
        # 不把 engine 的原始响应体整包转发，避免泄露内部字段。
        extra = {
            k: body[k]
            for k in ("requested", "generated", "rounds", "codes")
            if k in body
        }
        raise EngineAdminError(
            resp.status_code,
            code,
            payload=extra if code == "REDEEM_BATCH_INCOMPLETE" else None,
        )

    return resp.json()


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
    payload = _validate(body if isinstance(body, dict) else {})
    # engine 返回 { success, batch, plan, durationDays, requested, generated, codes[] }。
    # 透传完整响应体：generated < requested 时前端必须能看到差额，不能静默。
    return await _call_engine("POST", "/api/v1/admin/member/redeem-codes", json=payload)


async def list_redeem_codes(params: dict) -> dict:
    """运营列表，转发 engine。

    engine 默认返回掩码；只有显式 reveal=true 才给完整码，且 engine 会把
    「谁揭了哪些」写进 audit log。本层不缓存、不放宽——透传即可。
    """
    query: dict = {}

    plan = params.get("plan")
    if isinstance(plan, str) and plan.strip():
        if plan not in SUPPORTED_PLANS:
            raise EngineAdminError(400, "PLAN_INVALID", f"plan 必须是 {SUPPORTED_PLANS} 之一")
        query["plan"] = plan

    status = params.get("status")
    if isinstance(status, str) and status.strip():
        # ops 旧契约是 revoked；映射到 engine 的 disabled，而不是把 400 甩给前端
        normalized = "disabled" if status.strip() == "revoked" else status.strip()
        if normalized not in REDEEM_STATUSES:
            raise EngineAdminError(
                400, "STATUS_INVALID", f"status 必须是 {REDEEM_STATUSES} 之一或 revoked"
            )
        query["status"] = normalized

    batch = params.get("batch")
    if isinstance(batch, str) and batch.strip():
        query["batch"] = batch.strip()

    limit = params.get("limit")
    if limit is None:
        query["limit"] = 20
    else:
        try:
            limit_int = int(limit)
        except (TypeError, ValueError):
            raise EngineAdminError(400, "LIST_LIMIT_INVALID", "limit 必须是整数")
        if limit_int < 1 or limit_int > MAX_PAGE_SIZE:
            raise EngineAdminError(400, "LIST_LIMIT_INVALID", f"limit 必须是 1-{MAX_PAGE_SIZE}")
        query["limit"] = limit_int

    offset = params.get("offset")
    if offset is None:
        query["offset"] = 0
    else:
        try:
            offset_int = int(offset)
        except (TypeError, ValueError):
            raise EngineAdminError(400, "LIST_OFFSET_INVALID", "offset 必须是整数")
        if offset_int < 0:
            raise EngineAdminError(400, "LIST_OFFSET_INVALID", "offset 不能为负")
        query["offset"] = offset_int

    reveal = params.get("reveal")
    # 只有严格 true 才放行完整码；"1"/"yes" 一律按 false 处理，
    # 避免调用方以为已开启却拿到掩码、或误传真值造成非预期暴露。
    query["reveal"] = "true" if reveal is True or reveal == "true" else "false"

    return await _call_engine("GET", "/api/v1/admin/member/redeem-codes", params=query)


async def disable_redeem_code(body: dict) -> dict:
    """吊销（禁用）兑换码，转发 engine。ops 不落库，状态一律以 engine 为准。"""
    if not isinstance(body, dict):
        raise EngineAdminError(400, "REDEEM_CODE_FORMAT", "请求体必须是对象")

    code = body.get("code")
    if not isinstance(code, str) or not REDEEM_CODE_RE.match(code.strip()):
        raise EngineAdminError(400, "REDEEM_CODE_FORMAT", "兑换码格式不合法")

    return await _call_engine(
        "POST",
        "/api/v1/admin/member/redeem-codes/disable",
        json={"code": code.strip()},
    )
