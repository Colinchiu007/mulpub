"""
P0 Security Tests: config guards, decrypt fallback, SSRF.
Run: cd ops-center/backend && python -m pytest tests/test_p0_security.py -x -v
"""
import os
import sys
import pytest
from unittest.mock import patch, MagicMock

# Ensure ops-center/backend is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ==================== Problem 2: JWT weak secret ====================

class TestJWTSecretValidation:
    """P0-2: Reject weak/dev JWT secrets at startup."""

    def _get_validator(self):
        from config import _validate_jwt_secret
        return _validate_jwt_secret

    def test_rejects_too_short(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="too short"):
            v("abc")

    def test_rejects_exactly_weak_value(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="too short|weak value"):
            v("dev-secret-change-in-production")

    def test_rejects_dev_prefix(self):
        v = self._get_validator()
        # 32+ chars but starts with "dev-"
        with pytest.raises(SystemExit, match="development pattern"):
            v("dev-secret-key-for-local-testing-2026-extra")

    def test_rejects_test_prefix(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="development pattern"):
            v("test-something-long-enough-to-pass-length")

    def test_accepts_strong_random(self):
        v = self._get_validator()
        # Should not raise
        v("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")


# ==================== Problem 2: Admin password ====================

class TestAdminPasswordValidation:
    """P0-2: Reject weak admin passwords."""

    def _get_validator(self):
        from config import _validate_admin_password
        return _validate_admin_password

    def test_rejects_admin123(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="known-weak"):
            v("admin123", is_production=True)

    def test_rejects_empty_production(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="known-weak|must be set"):
            v("", is_production=True)

    def test_rejects_short(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="too short"):
            v("abc", is_production=False)

    def test_accepts_strong_password(self):
        v = self._get_validator()
        v("MyStr0ng!Pass#2026", is_production=True)  # no raise


# ==================== Problem 6: CORS wildcard + credentials ====================

class TestCORSSecurity:
    """P0-6: Reject CORS wildcard with credentials."""

    def _get_validator(self):
        from config import _validate_cors_credentials
        return _validate_cors_credentials

    def test_rejects_wildcard_with_credentials(self):
        v = self._get_validator()
        with pytest.raises(SystemExit, match="insecure"):
            v("*", allow_credentials=True)

    def test_allows_explicit_origins(self):
        v = self._get_validator()
        v("https://app.example.com,https://admin.example.com", allow_credentials=True)

    def test_allows_wildcard_without_credentials(self):
        v = self._get_validator()
        v("*", allow_credentials=False)  # read-only API, acceptable


# ==================== Problem 4: Fail-closed key ====================

class TestEncryptionKeyFailClosed:
    """P0-4: OPS_ENCRYPTION_KEY must be set or explicit dev override."""

    def test_fail_closed_logic_present(self):
        """Verify the fail-closed SystemExit code path exists in key_service."""
        import inspect
        from services.key_service import _get_fernet
        source = inspect.getsource(_get_fernet)
        assert "SystemExit" in source, "P0-4: fail-closed SystemExit missing"
        assert "OPS_ENCRYPTION_KEY is required" in source, "P0-4: error message missing"
        assert "OPS_ALLOW_EPHEMERAL_KEY" in source, "P0-4: dev bypass flag missing"

    def test_allows_ephemeral_with_flag(self):
        from services.key_service import _get_fernet
        with patch('config.settings') as mock_settings:
            mock_settings.encryption_key = ""
            with patch.dict(os.environ, {"OPS_ALLOW_EPHEMERAL_KEY": "true"}):
                # Should not raise, just warn
                result = _get_fernet()
                assert result is not None


# ==================== Problem 7: SSRF guard ====================

class TestSSRFGuard:
    """P0-7: Block SSRF via test_provider_connection."""

    def _get_validator(self):
        from services.model_preset_service import _validate_target_url
        return _validate_target_url

    def test_rejects_non_http_scheme(self):
        v = self._get_validator()
        with pytest.raises(ValueError, match="Unsupported"):
            v("ftp://evil.com/api")

    def test_rejects_localhost(self):
        v = self._get_validator()
        with pytest.raises(ValueError, match="internal address"):
            v("http://localhost:8080/api")

    def test_rejects_private_ip(self):
        v = self._get_validator()
        with pytest.raises(ValueError, match="private"):
            v("http://192.168.1.1/api")

    def test_rejects_loopback(self):
        v = self._get_validator()
        with pytest.raises(ValueError, match="internal|private"):
            v("http://127.0.0.1/metadata")

    def test_rejects_metadata_endpoint(self):
        v = self._get_validator()
        with pytest.raises(ValueError, match="private"):
            v("http://169.254.169.254/latest/meta-data/")

    def test_accepts_public_https(self, monkeypatch):
        # In proxy environments, public DNS resolves to 198.18.x.x (benchmark range)
        monkeypatch.setenv("OPS_ALLOW_PROXY_BENCHMARK_IPS", "true")
        v = self._get_validator()
        result = v("https://api.openai.com/v1")
        assert "api.openai.com" in result

    def test_allow_private_bypass(self):
        v = self._get_validator()
        # With allow_private=True (dev mode), localhost passes
        result = v("http://localhost:11434/v1", allow_private=True)
        assert "localhost" in result


# ==================== Problem 1: .env.example PEM check ====================

class TestEnvExampleNoSecret:
    """P0-1: .env.example must not contain usable private keys."""

    def test_no_pem_in_env_example(self):
        env_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            '.env.example'
        )
        with open(env_path, 'r', encoding='utf-8') as f:
            content = f.read()
        assert 'BEGIN PRIVATE KEY' not in content, "PEM key material found in .env.example!"
        assert 'MC4CAQAwBQYDK2Vw' not in content, "Ed25519 key bytes in .env.example!"
        # Placeholder is OK
        assert 'REPLACE_WITH_YOUR_GENERATED' in content
