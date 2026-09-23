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


def _resolve_session(request: Request | None, credentials: HTTPAuthorizationCredentials | None):
    """统一凭据解析。

    返回 `(payload, via_cookie)`；完全无凭据时返回 `(None, False)`。
    """
    if credentials is not None and credentials.credentials:
        # 通道 1：Bearer 优先
        return _decode_or_http(credentials.credentials), False

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
        return _decode_or_http(cookie_token), True

    return None, False


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    request: Request = None,
):
    """返回已认证 payload。无凭据 401；令牌无效 401；密钥未配置 503。

    `request` 带默认值仅为兼容既有直接调用（单测以位置参数传 credentials）；
    经 FastAPI 注入时一定会拿到真实 Request，从而启用 Cookie 会话通道。
    """
    payload, _via_cookie = _resolve_session(request, credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未提供认证令牌")
    return payload


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    request: Request = None,
) -> dict | None:
    """双通道可选版（如 scheduler 上报）：无任何凭据返回 None；带了指纹不对仍 401。"""
    payload, _via_cookie = _resolve_session(request, credentials)
    if payload is None:
        return None
    return payload


async def require_admin(user: dict = Depends(get_current_user)):
    """Require admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user
