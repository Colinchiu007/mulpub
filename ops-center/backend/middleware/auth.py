"""认证中间件 —— 双通道：Bearer JWT（机器对机器）+ HttpOnly 会话 Cookie（管理后台）。

P1-15（体检报告问题 15）：管理后台会话不再把 JWT 交给 localStorage，改由
`POST /api/auth/login` 下发 HttpOnly + SameSite=Lax Cookie（见 routers/auth.py）。
本模块负责两条通道的解析与优先级：

1. **Bearer 优先**：`Authorization: Bearer <jwt>` 存在即只走该通道（桌面端 / 脚本 /
   scheduler 上报），**不受 CSRF 自定义头约束**（浏览器跨站脚本无法伪造该头到别的 origin，
   且该通道完全不涉及 Cookie 自动携带）。Bearer 非法时直接 401，不回落到 Cookie，
   避免「攻击者用垃圾 Bearer 触发回落」这类语义歧义。
2. **Cookie 会话**：无 Bearer 时读 `settings.session_cookie_name`。因 SameSite=Lax 只
   拦截跨站**子请求/POST**，为纵深防御，写操作（非幂等方法）必须额外带
   `settings.csrf_header`（默认 `X-Ops-Session`）自定义头 —— 跨站页面无法设置自定义头
   （设置了也会因预检失败），因此「带自定义头」即可判定请求由本前端脚本发起。
   读操作（GET/HEAD/OPTIONS/TRACE）不要求该头，保持书签直达与只读页面可用。

错误语义保持向后兼容：无凭据 401「未提供认证令牌」；令牌非法 401「令牌无效」；
JWT 密钥未配置 503「认证服务配置不完整」（fail-closed，不把配置缺陷伪装成凭据问题）。
"""
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from config import settings

security = HTTPBearer(auto_error=False)

# 幂等方法：不改变服务端状态，CSRF 风险面为零，故不强制自定义头。
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def _decode_token(token: str) -> dict:
    """校验并解码 HS256 JWT；配置缺失抛 RuntimeError，令牌非法抛 JWTError。"""
    return jwt.decode(
        token,
        settings.get_jwt_secret(),
        algorithms=[settings.jwt_algorithm],
    )


async def _reject_revoked(payload: dict) -> None:
    """口令凭据指纹校验（改密即失效）。

    JWT 无状态，改密无法直接「删除」已签发的 token。这里在每次鉴权时把 token 中的
    pwd_fp 与库中当前口令哈希的指纹比对：不一致说明口令在签发之后被改过，该凭据即
    失效 → 401「凭据已失效，请重新登录」。

    语义边界（重要）：
    - **有 pwd_fp 才校验**。桌面端脚本、历史 token、单测直接签发的 token 不带该字段，
      一律保持既有行为（放行），避免一刀切打死 Bearer 通道；
    - 查不到管理员（如 admins 被清空）时不校验，交由既有 fail-closed 路径处理，
      不引入新的失败模式。
    """
    fp = payload.get("pwd_fp")
    if not fp:
        return
    username = payload.get("username") or payload.get("sub")
    if not username:
        return

    from database import async_session
    from models import AdminUser
    from services.auth_service import password_fingerprint
    from sqlalchemy import select

    async with async_session() as db:
        row = (await db.execute(select(AdminUser).where(AdminUser.username == username))).scalar_one_or_none()
        if row is None:
            return
        if password_fingerprint(row.password_hash) != fp:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="凭据已失效，请重新登录")


def _decode_or_http(token: str) -> dict:
    """把解码异常映射成既定 HTTP 语义（必须在依赖图内抛出，否则 FastAPI 会返回 500）。"""
    try:
        return _decode_token(token)
    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="认证服务配置不完整",
        )
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌无效")


async def _resolve_session(request: Request | None, credentials: HTTPAuthorizationCredentials | None):
    """统一凭据解析。

    返回 `(payload, via_cookie)`；完全无凭据时返回 `(None, False)`。
    """
    if credentials is not None and credentials.credentials:
        # 通道 1：Bearer 优先
        payload = _decode_or_http(credentials.credentials)
        await _reject_revoked(payload)
        return payload, False

    # 通道 2：HttpOnly 会话 Cookie（浏览器自动携带，脚本读不到）
    cookie_token = request.cookies.get(settings.session_cookie_name) if request is not None else None
    if cookie_token:
        if request is not None and request.method not in SAFE_METHODS:
            if not request.headers.get(settings.csrf_header):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"跨站请求伪造防护：基于 Cookie 会话的写操作必须携带自定义头 "
                        f"{settings.csrf_header}（前端 axios 拦截器默认注入）"
                    ),
                )
        payload = _decode_or_http(cookie_token)
        await _reject_revoked(payload)
        return payload, True

    return None, False


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    request: Request = None,
):
    """返回已认证 payload。无凭据 401；令牌无效 401；密钥未配置 503。

    `request` 带默认值仅为兼容既有直接调用（单测以位置参数传 credentials）；
    经 FastAPI 注入时一定会拿到真实 Request，从而启用 Cookie 会话通道。
    """
    payload, _via_cookie = await _resolve_session(request, credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未提供认证令牌")
    return payload


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    request: Request = None,
) -> dict | None:
    """双通道可选版（如 scheduler 上报）：无任何凭据返回 None；带了指纹不对仍 401。"""
    payload, _via_cookie = await _resolve_session(request, credentials)
    if payload is None:
        return None
    return payload


async def require_admin(user: dict = Depends(get_current_user)):
    """Require admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def require_catalog_key(request: Request) -> None:
    """FastAPI 依赖：**仅**接受静态 `X-Catalog-Key`（常量时间比较），不接受 Bearer。

    与 `services.logto_verifier.verify_bearer_or_catalog_key` 的区别是**刻意的**：
    后者是「Bearer(Logto JWT) 优先，或 X-Catalog-Key」的双通道；本函数是**单通道**。
    客户端脚本类上报（用量/发布计数/诊断/反馈）在未登录态也用固定目录 Key，
    因此这些端点只挂本依赖。

    2026-10-15 收敛（auth-single-source）：此前同一段逻辑以 `_require_catalog_key`
    为名在 `routers/diagnostics.py`、`routers/publish_metrics.py`、`routers/usage.py`
    各有一份**逐字重复**的实现，`routers/feedback.py` 还从 `diagnostics` 里跨模块
    import 私有名；而 `routers/runtime.py` 与 `routers/telemetry.py` 用了**同名/近名
    但语义不同**的包装（Bearer 或 key）。同名不同语义 + 四份重复是本函数上收的动因：
    鉴权强度不能再靠「读的是哪个文件的私有函数」来区分。

    错误语义与原实现逐一保持（未配置 → 404「Not found」，不匹配 → 401）。
    """
    import hmac as _hmac

    expected = settings.catalog_api_key
    if not expected:
        raise HTTPException(404, "Not found")
    provided = request.headers.get("x-catalog-key", "")
    if not _hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(401, "目录同步 Key 无效")
