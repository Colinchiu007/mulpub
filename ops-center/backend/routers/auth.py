"""Auth router — ops-center 本地管理员登录（自包含，不依赖 orchestrator）。

P1-15：登录成功不再把 JWT 放进响应体（旧实现直接把 token 回传给前端，前端存
localStorage，任何 XSS 都能把凭据外带 → 管理员会话接管）。改为下发 HttpOnly Cookie：
浏览器自动携带、JS 不可读；同时保留 Bearer 通道给桌面端/脚本（机器对机器）。
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from middleware.auth import get_current_user
from services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str = Field(..., max_length=auth_service.USERNAME_MAX_LEN)
    password: str = Field(..., max_length=auth_service.PASSWORD_MAX_LEN)


class ChangePasswordBody(BaseModel):
    """改密表单。

    三个字段均必填：old_password 确认操作人（防离开工位被改密接管）；
    confirm_password 防输错（新密码不可见，输错即把自己锁在门外）。
    长度上限取 PASSWORD_MAX_LEN —— 放宽会放大未认证/高频 PBKDF2 的 CPU 成本。
    """
    old_password: str = Field(..., max_length=auth_service.PASSWORD_MAX_LEN)
    new_password: str = Field(..., max_length=auth_service.PASSWORD_MAX_LEN)
    confirm_password: str = Field(..., max_length=auth_service.PASSWORD_MAX_LEN)


def _clear_session_cookie(response: Response) -> None:
    """下发过期 Cookie（Max-Age=0），让浏览器立即丢弃会话凭据。"""
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.is_session_cookie_secure(),
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )


def _issue_session_cookie(response: Response, token: str) -> None:
    """签发会话 Cookie：HttpOnly（JS 不可读）+ SameSite=Lax（挡跨站携带）+ Path=/。"""
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.get_session_max_age_seconds(),
        path="/",
        secure=settings.is_session_cookie_secure(),
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )


@router.post("/login")
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """本地管理员登录：成功则签发 HS256 JWT 并**只**落在 HttpOnly 会话 Cookie 里。

    响应体刻意不含 token / access_token，前端只需知道「是谁、还能用多久、写操作要带什么头」。
    既有登录限速（同 username|ip 连续 5 次失败锁 60s → 429）保持不变。
    """
    client_ip = request.client.host if request.client else "unknown"
    row, err_code, err_detail = await auth_service.authenticate(db, body.username, body.password, client_ip)
    if err_code == "locked":
        raise HTTPException(429, "尝试次数过多，请稍后再试")
    if err_code == "not_configured":
        raise HTTPException(503, "未配置管理员账号，请设置 OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD")
    if err_code == "invalid":
        raise HTTPException(401, "用户名或密码错误")
    # 带上口令凭据指纹：改密后该 token 会被判失效（见 middleware/auth._reject_revoked）。
    token = auth_service.create_access_token(row.username, auth_service.password_fingerprint(row.password_hash))
    _issue_session_cookie(response, token)
    return {
        "username": row.username,
        "role": "admin",
        "expires_in": settings.get_session_max_age_seconds(),
        # 基于 Cookie 的写操作必须携带该自定义头（CSRF 第二层），前端据此注入
        "csrf_header": settings.csrf_header,
    }


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """修改当前管理员口令。

    安全契约（与 tests/test_change_password_api.py 一一对应）：
    - 必须验原密码（401）；
    - 新密码过弱口令表 + ≥8 位（400），判据复用 config._validate_admin_password；
    - 两次新密码须一致（400）；新密码不得与当前密码相同（400）；
    - 走 Cookie 会话的写操作须带 X-Ops-Session（403，由 middleware/auth 统一拦）；
    - 成功后**清会话 Cookie 并使旧 token 失效**（pwd_fp 变更），强制重新登录。

    响应不含任何哈希材料。
    注意：本端点只改库，不同步 .env（OPS_ADMIN_PASSWORD）；见文档 §11.3 ——
    ensure_admin_seeded 仅在 admins 表为空时写入，正常运行不会用 .env 覆盖本改动。
    """
    client_ip = request.client.host if request.client else "unknown"
    username = user.get("username") or user.get("sub") or ""
    ok, err_code, err_detail = await auth_service.change_password(
        db, username, body.old_password, body.new_password, body.confirm_password, client_ip
    )
    if err_code == "locked":
        raise HTTPException(429, err_detail)
    if err_code == "invalid_old":
        raise HTTPException(401, err_detail)
    if err_code == "weak":
        raise HTTPException(400, err_detail)

    # 成功：旧会话作废（清 Cookie；pwd_fp 已随哈希变更，旧 token 后续也通不过校验）
    _clear_session_cookie(response)
    return {"ok": True, "detail": "密码已更新，请使用新密码重新登录"}


@router.post("/logout")
async def logout(response: Response):
    """登出：清除会话 Cookie。

    刻意不要求认证，也不要求 CSRF 头 —— 该接口无副作用（仅让浏览器丢弃本地 Cookie），
    且在会话已过期时也必须可用，否则前端「登出」按钮会退化成 401 报错。
    """
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.is_session_cookie_secure(),
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    """返回当前登录用户信息（受保护）；同时作为前端会话探测/水合入口。"""
    return {"username": user.get("username", user.get("sub")), "role": user.get("role")}


# 体检报告原文使用 `/api/auth/session` 指代「会话探测」端点；与 /me 同一实现，
# 保留别名以便文档、运维手册与前端代码口径一致（不引入第二份鉴权逻辑）。
@router.get("/session")
async def session(user: dict = Depends(get_current_user)):
    """/me 的别名：有效会话返回用户信息，否则 401（前端启动时水合登录态）。"""
    return {"username": user.get("username", user.get("sub")), "role": user.get("role")}
