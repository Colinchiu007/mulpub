"""Logto JWT verifier for ops-center sync endpoints.

Validates Bearer tokens issued by Logto OIDC (same pattern as python-backend's LogtoJwtVerifier,
simplified for the sync use case). Used by catalog/runtime endpoints as an alternative to static
X-Catalog-Key.

Config:
  OPS_LOGTO_ENDPOINT       -- Logto base URL (e.g. https://auth.example.com)
  OPS_LOGTO_API_RESOURCE   -- expected audience claim
  OPS_LOGTO_JWKS_CACHE_TTL -- seconds between JWKS refetch (default 300)
"""
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import HTTPException, Request
from jose import jwt as jose_jwt


@dataclass
class LogtoSyncVerifier:
    """Lightweight Logto JWT verifier scoped to sync endpoint usage."""

    issuer: str
    audience: str
    cache_ttl: int = 300
    _discovery: dict[str, Any] | None = field(default=None, repr=False)
    _jwks: dict[str, Any] = field(default_factory=dict, repr=False)
    _fetched_at: float = field(default=0.0, repr=False)

    def __post_init__(self):
        if not self.issuer:
            return
        self.issuer = self.issuer.rstrip("/")
        if not self.issuer.endswith("/oidc"):
            self.issuer = f"{self.issuer}/oidc"

    @property
    def enabled(self) -> bool:
        return bool(self.issuer and self.audience)

    async def _ensure_jwks(self) -> dict[str, Any]:
        """Fetch and cache OIDC discovery + JWKS keys."""
        now = time.time()
        if self._jwks and (now - self._fetched_at) < self.cache_ttl:
            return self._jwks
        async with httpx.AsyncClient(timeout=10) as client:
            # Discovery
            if self._discovery is None:
                resp = await client.get(f"{self.issuer}/.well-known/openid-configuration")
                if resp.status_code != 200:
                    raise HTTPException(503, "身份服务不可用")
                self._discovery = resp.json()
            jwks_uri = self._discovery.get("jwks_uri", "")
            if not jwks_uri:
                raise HTTPException(503, "身份服务配置错误")
            resp = await client.get(jwks_uri)
            if resp.status_code != 200:
                raise HTTPException(503, "身份服务不可用")
            body = resp.json()
        keys = {}
        for k in body.get("keys", []):
            kid = k.get("kid")
            if kid:
                keys[kid] = k
        self._jwks = keys
        self._fetched_at = now
        return keys

    async def verify_token(self, token: str, required_scope: str = "publish:read") -> dict[str, Any]:
        """Verify a Logto-issued JWT. Raises HTTPException(401/403) on failure."""
        if not self.enabled:
            raise HTTPException(401, "身份验证未启用")
        try:
            header = jose_jwt.get_unverified_header(token)
        except Exception:
            raise HTTPException(401, "令牌格式无效")
        kid = header.get("kid")
        jwks = await self._ensure_jwks()
        if kid and kid in jwks:
            key = jwks[kid]
        elif jwks:
            # Fallback: try first key (handles key rotation with overlap)
            key = next(iter(jwks.values()))
        else:
            raise HTTPException(503, "无可用的验证密钥")
        try:
            claims = jose_jwt.decode(
                token,
                key,
                audience=self.audience,
                issuer=self.issuer,
                algorithms=["RS256", "ES256"],
            )
        except jose_jwt.ExpiredSignatureError:
            raise HTTPException(401, "登录会话已过期")
        except Exception:
            raise HTTPException(401, "令牌验证失败")
        # Scope check
        scope_str = claims.get("scope", "")
        scopes = set(scope_str.split()) if isinstance(scope_str, str) else set(scope_str)
        if required_scope and required_scope not in scopes:
            raise HTTPException(403, f"权限不足，需要 scope: {required_scope}")
        return claims


# ─── Module-level singleton (lazily configured) ────────────────────────

_verifier: LogtoSyncVerifier | None = None


def get_logto_verifier() -> LogtoSyncVerifier | None:
    """Return the configured verifier, or None if Logto auth is not set up."""
    global _verifier
    if _verifier is not None:
        return _verifier if _verifier.enabled else None
    from config import settings
    endpoint = getattr(settings, "logto_endpoint", "").strip()
    resource = getattr(settings, "logto_api_resource", "").strip()
    if not endpoint or not resource:
        return None
    ttl = getattr(settings, "logto_jwks_cache_ttl", 300)
    _verifier = LogtoSyncVerifier(issuer=endpoint, audience=resource, cache_ttl=ttl)
    return _verifier


def reset_verifier_cache():
    """For testing: reset the singleton."""
    global _verifier
    _verifier = None


async def verify_bearer_or_catalog_key(request: Request) -> None:
    """FastAPI dependency: accept Bearer JWT OR X-Catalog-Key.

    Priority:
      1. If Authorization: Bearer <token> present -> verify via Logto (401/403 on fail)
      2. Elif X-Catalog-Key present -> verify via static key (401 on fail)
      3. Neither -> 401
    """
    import hmac as _hmac
    from config import settings

    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        verifier = get_logto_verifier()
        if verifier is None:
            raise HTTPException(401, "Logto 身份验证未配置")
        await verifier.verify_token(token, required_scope="publish:read")
        return  # Success

    # Fallback: static catalog key
    expected = settings.catalog_api_key
    if not expected:
        raise HTTPException(404, "Not found")
    provided = request.headers.get("x-catalog-key", "")
    if not _hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(401, "目录同步 Key 无效")
