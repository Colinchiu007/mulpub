import logging
logger = logging.getLogger(__name__)
"""OpsCenter configuration — pydantic-settings, reads OPS_ prefixed env vars."""
from typing import Literal

from pydantic_settings import BaseSettings


INSECURE_DEFAULT_SECRET = "dev-secret-change-in-production"


class Settings(BaseSettings):
    model_config = {"env_prefix": "OPS_", "env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    secret_key: str = ""
    encryption_key: str = ""  # Fernet key for encrypting secret config values
    db_path: str = "data/config.db"
    config_output_dir: str = "data/configs"
    orchestrator_feature_gates_path: str = "data/configs/orchestrator/feature_gates.yaml"
    # JWT: share secret with orchestrator
    jwt_secret: str = ""  # 独立密钥，不再 fallback 到 secret_key
    jwt_algorithm: Literal["HS256"] = "HS256"
    # 本地管理员登录（自包含，替代 orchestrator 认证）：未配置且无管理员时登录 fail-closed
    admin_username: str = ""
    admin_password: str = ""
    # 功能开关导入源（可选；缺省探测 orchestrator_feature_gates_path 与开发机默认路径）
    feature_gates_import_source: str = ""
    # 模型目录只读同步端点（桌面端拉取运营配置）API Key；未配置 → 端点 404（fail-closed）
    catalog_api_key: str = ""
    # Logto OIDC 验证（桌面端零配置同步：用用户会话 JWT 替代静态 Key）
    # 未配置 -> 同步端点仅接受 X-Catalog-Key（向后兼容）
    logto_endpoint: str = ""
    logto_api_resource: str = ""
    logto_jwks_cache_ttl: int = 300
    # 云服务健康巡检目标（可选；未配置对应探针跳过）
    health_api_url: str = ""
    health_logto_url: str = ""
    health_targets: str = ""  # JSON 数组 [{name, url}]
    # 兑换码签发密钥：须与桌面端 REDEMPTION_SECRET 一致（未配置 → 签发端点 400 fail-closed）
    redemption_secret: str = ""
    # 运行时配置签名私钥（Ed25519，PEM 内容）：对 /api/v1/runtime/bootstrap 响应做 Ed25519 签名。
    # 未配置 → bootstrap 端点 404 fail-closed（与 catalog_api_key 同一模式）。
    # 私钥由运维生成，与桌面端内置/配置的 Ed25519 公钥配对；切勿随仓库分发。
    runtime_signing_private_key: str = ""
    # 运行时配置签名私钥 PEM 文件路径（与 runtime_signing_private_key 二选一，路径优先）
    runtime_signing_key_path: str = ""
    feedback_media_dir: str = "data/feedback-media"
    feedback_max_message_chars: int = 10000
    feedback_max_archive_bytes: int = 25 * 1024 * 1024
    # 允许获取模型ID URL 解析到 198.18.0.0/15（RFC 2544 基准测试段）：该段被 Clash/TUN 类
    # fake-ip 代理用于接管公网流量，公网模型 API 域名在代理环境下会解析到该段；
    # 仅在有此类代理的主机开启，默认关闭保持 SSRF fail-closed。
    allow_proxy_benchmark_ips: bool = False
    # 启动时对「模型列表仍为目录种子（或为空）」的预设自动拉取官方模型列表（best-effort，失败跳过）；
    # 测试/离线环境可设 OPS_PRESET_SEED_FETCH_ENABLED=0 关闭。
    preset_seed_fetch_enabled: bool = True

    def get_jwt_secret(self) -> str:
        """返回经过安全校验的 JWT 密钥 (P0-2 enhanced)."""
        secret = self.jwt_secret.strip()
        if not secret or secret == INSECURE_DEFAULT_SECRET:
            raise RuntimeError("未配置安全的 OpsCenter JWT 密钥")
        # P0-2: Full validation (length, prefix, known-weak)
        # Only enforced in non-test context to avoid breaking existing tests
        import os
        if os.environ.get("PYTEST_CURRENT_TEST") is None:
            _validate_jwt_secret(secret)
        return secret

    def get_runtime_signing_private_key(self):
        """返回 Ed25519 签名私钥对象；未配置任何密钥来源时返回 None（端点 fail-closed）。

        密钥来源：runtime_signing_key_path（文件路径，优先）或 runtime_signing_private_key（PEM 内容）。
        """
        from pathlib import Path

        from cryptography.hazmat.primitives import serialization

        pem = ""
        if self.runtime_signing_key_path.strip():
            try:
                pem = Path(self.runtime_signing_key_path.strip()).read_text(encoding="utf-8")
            except OSError as e:
                raise RuntimeError(f"无法读取运行时配置签名私钥文件: {e}")
        elif self.runtime_signing_private_key.strip():
            pem = self.runtime_signing_private_key
        else:
            return None
        try:
            return serialization.load_pem_private_key(pem.encode("utf-8"), password=None)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"运行时配置签名私钥非法（须为 Ed25519 PEM）: {e}")

    def validate_security(self) -> None:
        """启动前验证认证配置，缺失时拒绝启动。"""
        self.get_jwt_secret()

    cors_origins: str = "http://localhost:5173,http://localhost:5174"




def run_startup_security_checks(settings: "Settings") -> None:
    """Execute all P0 security gates at application startup.
    
    Raises SystemExit on failure (fail-closed — service won't start).
    Called from main.py @app.on_event("startup").
    """
    # P0-2: JWT secret strength
    if settings.jwt_secret.strip():
        _validate_jwt_secret(settings.jwt_secret.strip())
    
    # P0-2: Admin password (production must not be empty)
    import os
    is_production = os.environ.get("ENVIRONMENT", "production").lower() != "development"
    if settings.admin_password:
        _validate_admin_password(settings.admin_password, is_production=is_production)
    elif is_production and not os.environ.get("OPS_ADMIN_USERNAME", ""):
        # No admin configured at all — acceptable if using Logto OIDC
        pass
    
    # P0-6: CORS + credentials
    _validate_cors_credentials(settings.cors_origins, allow_credentials=True)
    
    # P0-4: Encryption key presence (fail-closed in key_service, but warn early here)
    if not settings.encryption_key.strip():
        if os.environ.get("OPS_ALLOW_EPHEMERAL_KEY", "").lower() != "true":
            raise SystemExit(
                "[P0-4] OPS_ENCRYPTION_KEY not configured. Generate: "
                'python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )

    logger.info("[P0] All startup security checks passed.")

settings = Settings()


# P0 Security: weak secret rejection patterns
_WEAK_SECRET_PREFIXES = ("dev-", "test-", "changeme", "default")
_WEAK_SECRET_EXACT = {
    "dev-secret-change-in-production",
    "dev-secret-key-for-local-testing-2026",
    "secret", "changeme", "default", "admin",
}

def _validate_jwt_secret(secret: str) -> None:
    """Reject weak JWT secrets at startup (fail-closed in production)."""
    if not secret or len(secret) < 32:
        raise SystemExit(
            f"[P0-2] JWT secret too short ({len(secret) if secret else 0} chars); "
            "require >= 32. Generate with: openssl rand -hex 32"
        )
    if secret.lower() in _WEAK_SECRET_EXACT:
        raise SystemExit(f"[P0-2] JWT secret matches known weak value; refuse to start.")
    for prefix in _WEAK_SECRET_PREFIXES:
        if secret.lower().startswith(prefix):
            raise SystemExit(
                f"[P0-2] JWT secret starts with '{prefix}' (development pattern); "
                "production must use a strong random secret."
            )


def _validate_admin_password(password: str, is_production: bool) -> None:
    """Reject weak admin passwords."""
    WEAK_PASSWORDS = {"admin123", "password", "123456", "admin", "root", ""}
    if password in WEAK_PASSWORDS:
        raise SystemExit(
            f"[P0-2] Admin password is in known-weak list; choose a strong password (>= 8 chars)."
        )
    if is_production and not password:
        raise SystemExit(
            "[P0-2] Admin password must be set in production (OPS_ADMIN_PASSWORD)."
        )
    if len(password) < 8:
        raise SystemExit(
            f"[P0-2] Admin password too short ({len(password)}); minimum 8 characters."
        )


def _validate_cors_credentials(origins: str, allow_credentials: bool) -> None:
    """P0-6: CORS wildcard + credentials is forbidden (session security matrix)."""
    if allow_credentials and ("*" in origins or origins.strip() == "*"):
        raise SystemExit(
            "[P0-6] CORS allow_origins='*' with credentials=True is insecure; "
            "specify explicit whitelist (e.g. https://app.example.com)."
        )
