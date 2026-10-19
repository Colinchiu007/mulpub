"""强制升级版本门（forced-update-gate，2026-10-19）。

执法层：桌面端真实消费的机器端点（catalog / runtime-ack / telemetry-degradation）
在 update_policy.enforce_enabled=1 且客户端版本低于 enforce_min_version 时返回
426 Upgrade Required。

豁免面（缺一不可，见 01-docs/PRD-FORCED-UPDATE-GATE-2026-10-19.md §5.5）：
- Cookie 会话（运营后台人工操作）；
- GET /api/v1/runtime/bootstrap（策略通道自锁排除：被阻断客户端必须仍能拿到
  策略与阻断标志，否则永远无法得知要升级）——bootstrap 端点**不挂**本依赖。

fail-closed 语义：机器通道（Bearer / X-Catalog-Key）缺头或坏头一律按旧版处理
→ 426。存量旧客户端不发 X-Client-Version 头，它们正是执法对象；"缺头放行"
会让执法层对本要拦截的对象完全失效。
"""
import re

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db

_VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")
_HEADER_NAME = "x-client-version"


def _cmp_version(a: str, b: str) -> int:
    """按点分段整数比较，短段补 0；非法段按 0。返回 -1/0/1。"""
    def parse(v: str):
        try:
            return tuple(int(x) if x.isdigit() else 0 for x in v.split("."))
        except (ValueError, AttributeError):
            return (0,)
    pa, pb = parse(a), parse(b)
    for i in range(max(len(pa), len(pb))):
        x = pa[i] if i < len(pa) else 0
        y = pb[i] if i < len(pb) else 0
        if x != y:
            return -1 if x < y else 1
    return 0


def _is_admin_cookie_session(request: Request) -> bool:
    """Cookie 会话（运营后台）判别：Cookie JWT **验签通过**才豁免。

    QM-6 i2 修复：此前只判 cookie 名存在（值不验），攻击者带任意值假 cookie
    + 打包在 exe 里的静态 catalog key 即可绕过 426（两道闸各放一半）。现在
    豁免必须过 HS256 验签（与 middleware/auth 同一密钥与算法）；伪造值验签
    必败 → 不豁免 → 机器通道 fail-closed 生效。角色校验交由各端点既有依赖，
    版本门只负责"豁免面收窄到真会话"。
    """
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return False
    try:
        from middleware.auth import _decode_token
        _decode_token(token)
        return True
    except Exception:
        return False


async def _load_enforce_policy(db: AsyncSession) -> tuple[str, bool]:
    """读取单行 policy 的阻断配置；无行 → ("", False)。"""
    from models import UpdatePolicy

    row = (await db.execute(sa.select(UpdatePolicy).order_by(UpdatePolicy.id).limit(1))).scalar_one_or_none()
    if row is None:
        return "", False
    min_v = getattr(row, "enforce_min_version", None) or ""
    enabled = bool(getattr(row, "enforce_enabled", 0))
    return min_v, enabled


async def enforce_version_gate(request: Request, db: AsyncSession = Depends(get_db)):
    """FastAPI 依赖：低于阻断线（或缺头/坏头）的机器流量 → 426。"""
    if _is_admin_cookie_session(request):
        return
    min_v, enabled = await _load_enforce_policy(db)
    if not enabled or not min_v:
        return
    client_version = (request.headers.get(_HEADER_NAME) or "").strip()
    if not client_version or not _VERSION_RE.match(client_version):
        # fail-closed：缺头/坏头按旧版处理（WARN 出声，不静默）
        import logging
        logging.getLogger("ops.version_gate").warning(
            "version-gate: missing-or-bad %s header from %s -> 426",
            _HEADER_NAME, request.client.host if request.client else "unknown",
        )
        client_version = "0"
    if _cmp_version(client_version, min_v) < 0:
        raise HTTPException(
            status_code=426,
            detail={
                "code": "upgrade_required",
                "min_version": min_v,
                "message": "当前版本过低，必须升级后才能使用",
            },
        )
