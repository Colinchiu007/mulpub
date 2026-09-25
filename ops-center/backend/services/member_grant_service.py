"""Member grant service — 订阅手动开通转发 engine admin 端点。

engine 侧 /api/v1/admin/member/grant 只认带 admin:users scope 的 logto JWT（静态主密钥被显式
拒绝，防花钱端点被 key 滥用），故 ops 后端必须经 M2M token 转发；本服务不自持权益逻辑。
"""
from __future__ import annotations

import httpx

from config import settings


def _new_client():
    return httpx.AsyncClient(timeout=15)


class EngineAdminError(Exception):
    """status 为透传给前端的 HTTP 状态码，code 为机器可读错误码。"""

    def __init__(self, status: int, code: str, detail: str = ""):
        super().__init__(code)
        self.status = status
        self.code = code
        self.detail = detail


async def grant_plan(*, user_id: str, plan: str, duration_days: int, operator: str) -> dict:
    base = (settings.engine_admin_base_url or "").strip().rstrip("/")
    token = (settings.engine_admin_token or "").strip()
    if not base or not token:
        raise EngineAdminError(503, "ENGINE_ADMIN_NOT_CONFIGURED")
    payload = {"userId": user_id, "plan": plan, "durationDays": duration_days, "operator": operator}
    client = _new_client()
    try:
        resp = await client.post(
            f"{base}/api/v1/admin/member/grant",
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
    return resp.json()
