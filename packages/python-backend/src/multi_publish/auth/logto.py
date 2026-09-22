"""Logto OIDC Access Token 验证。

该模块只接受 RS256/RSA 与 ES384/EC P-384，禁止把 JWT decode 当作验证，也不允许对称算法降级。
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import HTTPException, Request

_LOGGER = logging.getLogger(__name__)

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _parse_secure_url(value: str, error_code: str):
    if not isinstance(value, str):
        raise AuthError(error_code)
    parsed = urlparse(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
        raise AuthError(error_code)
    try:
        _ = parsed.port
    except ValueError as exc:
        raise AuthError(error_code) from exc
    if parsed.scheme != "https" and parsed.hostname.lower() not in _LOCAL_HOSTS:
        raise AuthError(error_code)
    return parsed


def _origin(parsed):
    host = parsed.hostname.lower()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme == "https" else 80
    return parsed.scheme, host, port


def _trusted_host(parsed, trusted_hosts: frozenset[str]) -> bool:
    host = parsed.hostname.lower()
    netloc = parsed.netloc.lower()
    return host in trusted_hosts or netloc in trusted_hosts


# 上游身份服务不可用：语义是 5xx，绝不能伪装成 401，否则调用方会误做「刷新令牌 + 重放」把耗时翻倍。
_SERVICE_UNAVAILABLE_CODES = frozenset(
    {"AUTH_JWKS_UNAVAILABLE", "AUTH_JWKS_INVALID", "AUTH_CONFIG_INVALID"}
)

# 会触发失败退避的取键错误（超时 / 非 2xx / 响应体非法）。
_JWKS_FAILURE_CODES = frozenset({"AUTH_JWKS_UNAVAILABLE", "AUTH_JWKS_INVALID"})


class AuthError(Exception):
    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code = code
        self.status = status or (503 if code in _SERVICE_UNAVAILABLE_CODES else 401)


def parse_bearer_token(header: str | None) -> str:
    if not isinstance(header, str):
        raise AuthError("AUTH_TOKEN_MISSING")
    parts = header.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise AuthError("AUTH_TOKEN_MISSING")
    return parts[1]


def _decode_part(value: str) -> dict[str, Any]:
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode()).decode()
        result = json.loads(decoded)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AuthError("AUTH_TOKEN_INVALID") from exc
    if not isinstance(result, dict):
        raise AuthError("AUTH_TOKEN_INVALID")
    return result


def _audience_matches(actual: Any, expected: str) -> bool:
    return actual == expected or isinstance(actual, list) and expected in actual


def _public_key_from_jwk(jwk: dict[str, Any]):
    algorithm = jwk.get("alg")
    key_type = jwk.get("kty")
    if (algorithm, key_type, jwk.get("crv")) not in {
        ("RS256", "RSA", None),
        ("ES384", "EC", "P-384"),
    }:
        raise AuthError("AUTH_KEY_INVALID")
    if jwk.get("use") not in (None, "sig"):
        raise AuthError("AUTH_KEY_INVALID")
    key_ops = jwk.get("key_ops")
    if key_ops is not None and (not isinstance(key_ops, list) or "verify" not in key_ops):
        raise AuthError("AUTH_KEY_INVALID")
    try:
        if algorithm == "RS256":
            n = int.from_bytes(base64.urlsafe_b64decode(jwk["n"] + "=" * (-len(jwk["n"]) % 4)), "big")
            e = int.from_bytes(base64.urlsafe_b64decode(jwk["e"] + "=" * (-len(jwk["e"]) % 4)), "big")
            return RSAPublicNumbers(e, n).public_key()
        x_bytes = base64.urlsafe_b64decode(jwk["x"] + "=" * (-len(jwk["x"]) % 4))
        y_bytes = base64.urlsafe_b64decode(jwk["y"] + "=" * (-len(jwk["y"]) % 4))
        if len(x_bytes) != 48 or len(y_bytes) != 48:
            raise ValueError("P-384 坐标长度无效")
        return ec.EllipticCurvePublicNumbers(
            int.from_bytes(x_bytes, "big"),
            int.from_bytes(y_bytes, "big"),
            ec.SECP384R1(),
        ).public_key()
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthError("AUTH_KEY_INVALID") from exc


def verify_logto_jwt(
    token: str,
    *,
    public_key,
    issuer: str,
    audience: str,
    now: int | None = None,
    clock_tolerance: int = 60,
) -> dict[str, Any]:
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 3:
        raise AuthError("AUTH_TOKEN_INVALID")
    header = _decode_part(parts[0])
    claims = _decode_part(parts[1])
    algorithm = header.get("alg")
    if algorithm not in {"RS256", "ES384"}:
        raise AuthError("AUTH_ALGORITHM_INVALID")
    if algorithm == "RS256" and not isinstance(public_key, rsa.RSAPublicKey):
        raise AuthError("AUTH_KEY_INVALID")
    if algorithm == "ES384" and (
        not isinstance(public_key, ec.EllipticCurvePublicKey)
        or not isinstance(public_key.curve, ec.SECP384R1)
    ):
        raise AuthError("AUTH_KEY_INVALID")
    try:
        signature = base64.urlsafe_b64decode(parts[2] + "=" * (-len(parts[2]) % 4))
        signing_input = f"{parts[0]}.{parts[1]}".encode()
        if algorithm == "RS256":
            public_key.verify(signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
        else:
            if len(signature) != 96:
                raise ValueError("ES384 签名长度无效")
            der_signature = encode_dss_signature(
                int.from_bytes(signature[:48], "big"),
                int.from_bytes(signature[48:], "big"),
            )
            public_key.verify(der_signature, signing_input, ec.ECDSA(hashes.SHA384()))
    except Exception as exc:  # cryptography 使用统一异常类型，避免把密钥细节返回调用方
        raise AuthError("AUTH_SIGNATURE_INVALID") from exc
    if claims.get("iss") != issuer:
        raise AuthError("AUTH_ISSUER_INVALID")
    if not _audience_matches(claims.get("aud"), audience):
        raise AuthError("AUTH_AUDIENCE_INVALID")
    current = int(time.time()) if now is None else now
    expires_at = claims.get("exp")
    if type(expires_at) not in (int, float) or not math.isfinite(expires_at) or expires_at <= current - clock_tolerance:
        raise AuthError("AUTH_TOKEN_EXPIRED")
    if "nbf" in claims:
        not_before = claims["nbf"]
        if type(not_before) not in (int, float) or not math.isfinite(not_before) or not_before > current + clock_tolerance:
            raise AuthError("AUTH_TOKEN_NOT_ACTIVE")
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise AuthError("AUTH_SUBJECT_INVALID")
    scope = claims.get("scope", "")
    if isinstance(scope, list):
        scopes = [item for item in scope if isinstance(item, str)]
    elif isinstance(scope, str):
        scopes = scope.split()
    else:
        scopes = []
    return {"subject": subject, "scopes": scopes}


def require_scopes(auth: dict[str, Any], required_scopes: list[str]) -> bool:
    available = set(auth.get("scopes", []))
    if not all(scope in available for scope in required_scopes):
        raise AuthError("AUTH_SCOPE_MISSING", 403)
    return True


@dataclass
class LogtoJwtVerifier:
    issuer: str
    audience: str
    fetcher: Callable[[str], Any] | None = None
    cache_ttl_seconds: int = 300
    unknown_kid_cache_ttl_seconds: int = 30
    forced_refresh_cooldown_seconds: int = 1
    unknown_kid_cache_max: int = 256
    now: Callable[[], int] = lambda: int(time.time())
    trusted_jwks_hosts: frozenset[str] = field(default_factory=frozenset)
    jwks_failure_backoff_seconds: int = 15
    stale_cache_grace_seconds: int = 3600
    connect_timeout_seconds: float = 2.0
    read_timeout_seconds: float = 5.0

    def __post_init__(self):
        self.issuer = self.issuer.rstrip("/")
        _parse_secure_url(self.issuer, "AUTH_ISSUER_INVALID")
        self.trusted_jwks_hosts = frozenset(str(item).lower() for item in self.trusted_jwks_hosts)
        self._discovery: dict[str, Any] | None = None
        self._keys: dict[str, Any] = {}
        self._keys_at = 0
        self._keys_loaded = False
        self._last_forced_refresh_at = 0
        self._refresh_lock = None
        self._refresh_loop = None
        self._unknown_kid_cache: dict[str, int] = {}
        self._keys_failed_at: int | None = None
        self._http_client = None
        self._background_refresh = None
        self._closing_tasks: set[Any] = set()

    def _get_refresh_lock(self):
        loop = asyncio.get_running_loop()
        if self._refresh_lock is None or self._refresh_loop is not loop:
            self._refresh_lock = asyncio.Lock()
            self._refresh_loop = loop
        return self._refresh_lock

    def _new_http_client(self):
        """共享连接池：每次请求新建 client 会重做 TCP+TLS 握手，走代理时是主要耗时来源。"""
        import httpx

        timeout = httpx.Timeout(
            self.read_timeout_seconds,
            connect=self.connect_timeout_seconds,
            pool=self.connect_timeout_seconds,
        )
        return httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=4, max_connections=8),
            follow_redirects=False,
        )

    def _get_http_client(self):
        if self._http_client is None:
            self._http_client = self._new_http_client()
        return self._http_client

    def _invalidate_http_client(self) -> None:
        client, self._http_client = self._http_client, None
        if client is None:
            return
        try:
            task = asyncio.get_running_loop().create_task(client.aclose())
        except RuntimeError:
            return
        self._closing_tasks.add(task)
        task.add_done_callback(self._closing_tasks.discard)

    async def aclose(self) -> None:
        """进程退出时收尾共享连接池。"""
        client, self._http_client = self._http_client, None
        if client is not None:
            await client.aclose()

    def _schedule_background_refresh(self) -> None:
        if self._background_refresh is not None and not self._background_refresh.done():
            return
        try:
            task = asyncio.get_running_loop().create_task(self._refresh_quietly())
        except RuntimeError:
            return
        self._background_refresh = task
        task.add_done_callback(self._clear_background_refresh)

    def _clear_background_refresh(self, task) -> None:
        if self._background_refresh is task:
            self._background_refresh = None

    def _note_fetch_failure(self, exc: AuthError) -> None:
        """取键失败必须开启退避窗口——后台刷新与前台请求共用同一套退避纪律。"""
        if exc.code in _JWKS_FAILURE_CODES:
            self._keys_failed_at = self.now()

    async def _refresh_quietly(self) -> None:
        # 后台刷新失败只记日志：旧 key 仍在宽限期内可用，下一次请求会再试。
        try:
            async with self._get_refresh_lock():
                if self._in_failure_backoff(self.now()):
                    # 退避窗口内后台同样不重复打网络，否则每个请求都白付一次刷新超时。
                    return
                await self._fetch_keys()
        except AuthError as exc:
            self._note_fetch_failure(exc)
            _LOGGER.warning("JWKS background refresh failed: %s", exc)
        except Exception as exc:
            _LOGGER.warning("JWKS background refresh failed: %s", exc)

    async def _get_json(self, url: str) -> dict[str, Any]:
        try:
            if self.fetcher:
                response = await self.fetcher(url)
            else:
                response = await self._get_http_client().get(url)
            if response.status_code < 200 or response.status_code >= 300:
                raise AuthError("AUTH_JWKS_UNAVAILABLE")
        except AuthError:
            raise
        except Exception as exc:
            # 连接可能已被代理或网络栈打断，丢掉连接池让下一次请求重建。
            self._invalidate_http_client()
            raise AuthError("AUTH_JWKS_UNAVAILABLE") from exc
        try:
            body = response.json()
        except Exception as exc:
            raise AuthError("AUTH_JWKS_INVALID") from exc
        if not isinstance(body, dict):
            raise AuthError("AUTH_JWKS_INVALID")
        return body

    async def prefetch(self) -> bool:
        """启动预热：把 discovery + JWKS 冷启动代价挪出用户请求路径。

        预热失败不抛异常（退避会接管后续请求），否则后端会在身份服务抖动时启动失败。
        """
        try:
            await self._get_keys()
            return True
        except AuthError as exc:
            _LOGGER.warning("JWKS prefetch failed: %s", exc.code)
            return False
        except Exception:
            _LOGGER.warning("JWKS prefetch raised unexpectedly", exc_info=True)
            return False

    def _in_failure_backoff(self, current: int) -> bool:
        if self._keys_failed_at is None:
            return False
        return current - self._keys_failed_at < self.jwks_failure_backoff_seconds

    def _cached_keys_usable(self, current: int) -> bool:
        """stale-while-revalidate：未过期直接命中；过期但在宽限期内先回旧 key，刷新丢到后台。"""
        if not self._keys_loaded:
            return False
        age = current - self._keys_at
        if age < self.cache_ttl_seconds:
            return True
        if age >= self.stale_cache_grace_seconds:
            return False
        self._schedule_background_refresh()
        return True

    async def _get_keys(self, force: bool = False) -> dict[str, Any]:
        current = self.now()
        if not force and self._cached_keys_usable(current):
            return self._keys
        async with self._get_refresh_lock():
            current = self.now()
            if not force and self._cached_keys_usable(current):
                return self._keys
            if (
                force
                and self._keys_loaded
                and current - self._last_forced_refresh_at < self.forced_refresh_cooldown_seconds
            ):
                return self._keys
            if self._in_failure_backoff(current):
                # 退避窗口内不再重复打网络：一次抖动只付一次超时。force 刷新同样受约束，
                # 否则 unknown-kid 触发的强制刷新会在故障期把每次验签都打成超时。
                raise AuthError("AUTH_JWKS_UNAVAILABLE")
            if force:
                self._last_forced_refresh_at = current
            try:
                return await self._fetch_keys()
            except AuthError as exc:
                self._note_fetch_failure(exc)
                raise

    async def _fetch_keys(self) -> dict[str, Any]:
        if self._discovery is None:
            discovery = await self._get_json(f"{self.issuer}/.well-known/openid-configuration")
            jwks_uri = discovery.get("jwks_uri")
            if discovery.get("issuer") != self.issuer or not isinstance(jwks_uri, str):
                raise AuthError("AUTH_DISCOVERY_INVALID")
            issuer_origin = _origin(_parse_secure_url(self.issuer, "AUTH_DISCOVERY_INVALID"))
            jwks_url = _parse_secure_url(jwks_uri, "AUTH_DISCOVERY_INVALID")
            if _origin(jwks_url) != issuer_origin and not _trusted_host(jwks_url, self.trusted_jwks_hosts):
                raise AuthError("AUTH_DISCOVERY_INVALID")
            self._discovery = {**discovery, "jwks_uri": jwks_url.geturl()}
        body = await self._get_json(self._discovery["jwks_uri"])
        keys = body.get("keys")
        if not isinstance(keys, list):
            raise AuthError("AUTH_JWKS_INVALID")
        usable_keys: dict[str, Any] = {}
        for key in keys:
            if not isinstance(key, dict) or not isinstance(key.get("kid"), str) or not key.get("kid"):
                continue
            algorithm = key.get("alg")
            profile = (algorithm, key.get("kty"), key.get("crv"))
            if profile not in {("RS256", "RSA", None), ("ES384", "EC", "P-384")}:
                continue
            if key.get("use") not in (None, "sig"):
                continue
            key_ops = key.get("key_ops")
            if key_ops is not None and (not isinstance(key_ops, list) or "verify" not in key_ops):
                continue
            cache_key = f"{algorithm}:{key['kid']}"
            if cache_key in usable_keys:
                continue
            try:
                usable_keys[cache_key] = _public_key_from_jwk(key)
            except AuthError:
                continue
        self._keys = usable_keys
        self._keys_at = self.now()
        self._keys_loaded = True
        self._keys_failed_at = None
        return self._keys

    async def verify(self, token: str) -> dict[str, Any]:
        parts = token.split(".") if isinstance(token, str) else []
        if len(parts) != 3:
            raise AuthError("AUTH_TOKEN_INVALID")
        header = _decode_part(parts[0])
        kid = header.get("kid")
        algorithm = header.get("alg")
        if algorithm not in {"RS256", "ES384"} or not isinstance(kid, str):
            raise AuthError("AUTH_ALGORITHM_INVALID")
        if not kid or len(kid) > 128 or any(not (char.isalnum() or char in "._:-") for char in kid):
            raise AuthError("AUTH_KEY_NOT_FOUND")
        current = self.now()
        cache_key = f"{algorithm}:{kid}"
        negative_expiry = self._unknown_kid_cache.get(cache_key)
        if negative_expiry and negative_expiry > current:
            raise AuthError("AUTH_KEY_NOT_FOUND")
        if negative_expiry:
            self._unknown_kid_cache.pop(cache_key, None)
        keys = await self._get_keys()
        if cache_key not in keys:
            keys = await self._get_keys(force=True)
        if cache_key not in keys:
            if len(self._unknown_kid_cache) >= self.unknown_kid_cache_max:
                self._unknown_kid_cache.pop(next(iter(self._unknown_kid_cache)), None)
            self._unknown_kid_cache[cache_key] = current + self.unknown_kid_cache_ttl_seconds
            raise AuthError("AUTH_KEY_NOT_FOUND")
        self._unknown_kid_cache.pop(cache_key, None)
        return verify_logto_jwt(
            token,
            public_key=keys[cache_key],
            issuer=self.issuer,
            audience=self.audience,
            now=self.now(),
        )


def create_fastapi_dependency(verifier: LogtoJwtVerifier, required_scopes: list[str] | None = None):
    """创建可挂到 FastAPI 路由的 Logto 验证依赖。"""

    scopes = required_scopes or []

    async def dependency(request: Request):
        try:
            token = parse_bearer_token(request.headers.get("authorization"))
            auth = await verifier.verify(token)
            require_scopes(auth, scopes)
            request.state.auth = auth
            return auth
        except AuthError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.code) from exc

    return dependency
