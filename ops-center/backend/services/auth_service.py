"""Auth service — ops-center 自包含管理员登录（替代 orchestrator 认证依赖）。

- 密码：PBKDF2-SHA256（随机 salt，200000 迭代），存储格式 pbkdf2_sha256$iterations$salt_hex$hash_hex
- JWT：HS256，OPS_JWT_SECRET，payload {sub, username, role: "admin", exp: now + 8h}
- 限流：内存计数（username+IP），5 次失败锁定 60s（单机可接受；多实例/重启后重置，生产可换 Redis）
- fail-closed：未配置管理员且 admins 表为空 → 503（无默认口令）
"""
import datetime
import hashlib
import hmac
import logging
import secrets

from jose import jwt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models import AdminUser

logger = logging.getLogger("ops-center.auth")

PBKDF2_ITERATIONS = 200000
TOKEN_TTL_HOURS = 8
MAX_LOGIN_FAILURES = 5
LOGIN_LOCK_SECONDS = 60
USERNAME_MAX_LEN = 64
PASSWORD_MAX_LEN = 128
# 改密端点独立限流（与登录分离）：改密前必须验原密码，若共用登录计数等于给
# 「在线爆破原密码」开一条绕过登录限速的旁路；也避免改密失败把正常登录锁死。
MAX_CHANGE_PWD_FAILURES = 5
CHANGE_PWD_LOCK_SECONDS = 60

# 内存限流：key=username|ip -> {"failures": int, "locked_until": float}
_login_attempts: dict = {}
_change_pwd_attempts: dict = {}

def _now_ts() -> float:
    return datetime.datetime.now().timestamp()


def _sweep_expired_attempts(store: dict | None = None) -> None:
    """清理已过期的限流记录，避免随机用户名爆破导致内存无界增长。

    登录与改密共用同一套计数结构，故按 store 参数化；默认清理登录表以兼容既有调用。
    """
    target = store if store is not None else _login_attempts
    now = _now_ts()
    expired = [k for k, v in target.items() if v["locked_until"] <= now and v["failures"] == 0]
    for k in expired:
        target.pop(k, None)


def hash_password(password: str, salt: bytes | None = None, iterations: int = PBKDF2_ITERATIONS) -> str:
    """PBKDF2-SHA256 哈希，返回 pbkdf2_sha256$iterations$salt_hex$hash_hex。"""
    if salt is None:
        salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """常量时间校验存储的哈希。"""
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


# 用户不存在时用于抹平时耗的 dummy 哈希（任意固定值）
_DUMMY_HASH = hash_password("dummy-password-for-timing")


async def ensure_admin_seeded(db: AsyncSession) -> None:
    """启动时若 admins 表为空且配置了 OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD 则创建管理员。"""
    existing = (await db.execute(select(AdminUser))).scalars().first()
    if existing is not None:
        return
    username = (settings.admin_username or "").strip()
    password = (settings.admin_password or "").strip()
    if not username or not password:
        return  # 未配置：登录时 fail-closed
    db.add(AdminUser(username=username, password_hash=hash_password(password)))
    try:
        await db.commit()
    except IntegrityError:
        # 并发启动竞态：另一 worker 已创建同一用户名 → 忽略
        await db.rollback()


def _is_locked(key: str, store: dict | None = None) -> bool:
    target = store if store is not None else _login_attempts
    entry = target.get(key)
    if not entry:
        return False
    if entry["locked_until"] and entry["locked_until"] > _now_ts():
        return True
    return False


def _record_failure(key: str, store: dict | None = None,
                    max_failures: int | None = None,
                    lock_seconds: int | None = None) -> None:
    """记录一次失败并按需锁定。

    ⚠️ 阈值必须在**函数体内**读取模块级常量，不能写成默认参数值：
    Python 的默认参数在 def 时求值一次并绑定，`monkeypatch.setattr(module, "MAX_LOGIN_FAILURES", 3)`
    （既有测试 test_auth_login.py 提速限流用例的做法）改的是模块变量、改不动已绑定的
    默认值 —— 把常量写成默认参数会让这类提速手段静默失效。
    """
    target = store if store is not None else _login_attempts
    # 阈值归属：改密表用改密阈值，登录表用登录阈值（便于各自 monkeypatch 提速）
    if max_failures is None:
        max_failures = MAX_CHANGE_PWD_FAILURES if target is _change_pwd_attempts else MAX_LOGIN_FAILURES
    if lock_seconds is None:
        lock_seconds = CHANGE_PWD_LOCK_SECONDS if target is _change_pwd_attempts else LOGIN_LOCK_SECONDS
    _sweep_expired_attempts(target)
    now = _now_ts()
    entry = target.get(key) or {"failures": 0, "locked_until": 0}
    if entry["locked_until"] and entry["locked_until"] <= now:
        entry = {"failures": 0, "locked_until": 0}
    entry["failures"] += 1
    if entry["failures"] >= max_failures:
        entry["locked_until"] = now + lock_seconds
        entry["failures"] = 0
    target[key] = entry


def _clear_failures(key: str, store: dict | None = None) -> None:
    target = store if store is not None else _login_attempts
    target.pop(key, None)


async def authenticate(db: AsyncSession, username: str, password: str, client_ip: str):
    """校验凭据；返回 (user, err_code, err_detail)。

    err_code: "locked"(429) / "not_configured"(503) / "invalid"(401)；成功时 (user, None, None)。
    """
    # 长度限制：防未认证 PBKDF2 CPU DoS / 内存放大
    if len(username) > USERNAME_MAX_LEN or len(password) > PASSWORD_MAX_LEN:
        return None, "invalid", "用户名或密码错误"

    key = f"{username.strip().lower()}|{client_ip}"
    if _is_locked(key):
        return None, "locked", "尝试次数过多，请稍后再试"

    row = (await db.execute(select(AdminUser).where(AdminUser.username == username.strip()))).scalar_one_or_none()
    if row is None:
        # 抹平时间侧信道：无论用户是否存在都执行一次 PBKDF2 校验
        verify_password(password, _DUMMY_HASH)
        if not settings.admin_username and not settings.admin_password:
            # 未配置管理员（fail-closed）：也计数，防探测
            _record_failure(key)
            logger.warning("login blocked: admin not configured (ip=%s)", client_ip)
            return None, "not_configured", "未配置管理员账号，请设置 OPS_ADMIN_USERNAME/OPS_ADMIN_PASSWORD"
        _record_failure(key)
        logger.warning("login failed: unknown user (username=%s, ip=%s)", username.strip(), client_ip)
        return None, "invalid", "用户名或密码错误"

    if not verify_password(password, row.password_hash):
        _record_failure(key)
        logger.warning("login failed: wrong password (username=%s, ip=%s)", username.strip(), client_ip)
        return None, "invalid", "用户名或密码错误"

    _clear_failures(key)
    logger.info("login ok (username=%s, ip=%s)", username.strip(), client_ip)
    return row, None, None


def validate_new_password(password: str) -> str:
    """校验新口令，返回空串表示通过，否则返回可直接展示的中文原因。

    判据**复用** config._validate_admin_password（启动期校验 OPS_ADMIN_PASSWORD 的同一套：
    弱口令表 + 长度 ≥8），不在此处写第二套规则 —— 两份口径必然漂移，
    历史上正是「种子与渲染端护栏值漂移」的同型事故（见 platform_def_service 注释）。

    _validate_admin_password 内部以 SystemExit 表达拒绝（启动期语义），这里转成原因串。
    """
    from config import _validate_admin_password

    if not password:
        return "新密码不能为空"
    if len(password) > PASSWORD_MAX_LEN:
        return f"新密码长度不得超过 {PASSWORD_MAX_LEN} 个字符"
    try:
        _validate_admin_password(password, is_production=False)
    except SystemExit:
        # 该函数的三类拒绝（弱口令表 / 生产非空 / 过短）对用户都收敛为同一条可读提示
        return "新密码强度不足：至少 8 位，且不得使用 admin123、password、123456 等常见弱口令"
    return ""


async def change_password(db: AsyncSession, username: str, old_password: str,
                          new_password: str, confirm_password: str, client_ip: str):
    """修改管理员口令：返回 (ok, err_code, err_detail)。

    err_code: "locked"(429) / "invalid_old"(401) / "weak"(400)；成功时 (True, None, None)。

    安全要点：
    - 必须验原密码（否则会话被劫即等于账户失守）；
    - 新密码不得等于原密码（改密不产生安全收益）；
    - 成功后清零改密失败计数，但**不**清登录计数（两者语义不同）。
    """
    if len(old_password) > PASSWORD_MAX_LEN or len(new_password) > PASSWORD_MAX_LEN:
        return False, "invalid_old", "原密码错误"

    key = f"{username.strip().lower()}|{client_ip}"
    if _is_locked(key, _change_pwd_attempts):
        return False, "locked", "尝试次数过多，请稍后再试"

    row = (await db.execute(select(AdminUser).where(AdminUser.username == username.strip()))).scalar_one_or_none()
    if row is None:
        # 用户不存在也走一次 dummy 校验抹平时序，并计入限流
        verify_password(old_password, _DUMMY_HASH)
        _record_failure(key, _change_pwd_attempts, MAX_CHANGE_PWD_FAILURES, CHANGE_PWD_LOCK_SECONDS)
        logger.warning("change-password failed: unknown user (username=%s, ip=%s)", username.strip(), client_ip)
        return False, "invalid_old", "原密码错误"

    if not verify_password(old_password, row.password_hash):
        _record_failure(key, _change_pwd_attempts, MAX_CHANGE_PWD_FAILURES, CHANGE_PWD_LOCK_SECONDS)
        logger.warning("change-password failed: wrong old password (username=%s, ip=%s)", username.strip(), client_ip)
        return False, "invalid_old", "原密码错误"

    # ---- 原密码已通过，以下为新密码的合规性校验（失败不计入爆破限流）----
    if new_password != confirm_password:
        return False, "weak", "两次输入的新密码不一致"

    if new_password == old_password:
        return False, "weak", "新密码不能与当前密码相同"

    reason = validate_new_password(new_password)
    if reason:
        return False, "weak", reason

    # 换盐重哈希（hash_password 内部生成新 salt，复用/旧盐会让改密形同未改）
    row.password_hash = hash_password(new_password)
    row.updated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    await db.commit()

    _clear_failures(key, _change_pwd_attempts)
    logger.info("change-password ok (username=%s, ip=%s)", username.strip(), client_ip)
    return True, None, None


def password_fingerprint(password_hash: str) -> str:
    """口令凭据指纹：改密后指纹必变，用于让改密前签发的会话失效。

    刻意取哈希的 **sha256 前 16 位**而非哈希原文片段：JWT payload 只做签名不做加密，
    任何人都能解出 payload，直接把哈希片段放进 token 等于向持票人泄露哈希材料
    （可用于离线比对猜测）。二次摘要后 payload 里只有不可逆的比对标记。

    单机/重启后可复现（只依赖库中哈希，不依赖内存），因此不需要额外存储态。
    """
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()[:16]


def create_access_token(username: str, pwd_fp: str | None = None) -> str:
    """签发 HS256 JWT（与现有验证中间件同 secret/算法，role=admin）。

    pwd_fp：口令凭据指纹（见 password_fingerprint）。带了该字段的 token 在改密后会被
    判定为失效；**不带**的 token（桌面端脚本、历史 token、单测直接调用）保持既有
    行为不受影响 —— 指纹校验是「有则校验」，不是「没有就拒绝」，以免一刀切打死
    Bearer 通道与既有测试。
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": username,
        "username": username,
        "role": "admin",
        "iat": now,
        "exp": now + datetime.timedelta(hours=TOKEN_TTL_HOURS),
    }
    if pwd_fp:
        payload["pwd_fp"] = pwd_fp
    return jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)