"""Tests for logto_verifier — ops-center sync endpoint Bearer JWT verification."""
import asyncio
import os
import sys
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException


class TestLogtoSyncVerifier(unittest.TestCase):
    def setUp(self):
        # Reset singleton before each test
        from services.logto_verifier import reset_verifier_cache
        reset_verifier_cache()

    def test_disabled_when_no_config(self):
        """No OPS_LOGTO_ENDPOINT -> get_logto_verifier returns None."""
        from services.logto_verifier import get_logto_verifier
        with patch("config.settings") as mock_settings:
            mock_settings.logto_endpoint = ""
            mock_settings.logto_api_resource = ""
            result = get_logto_verifier()
            self.assertIsNone(result)

    def test_issuer_normalization(self):
        """Issuer auto-appends /oidc if missing."""
        from services.logto_verifier import LogtoSyncVerifier
        v = LogtoSyncVerifier(issuer="https://auth.example.com", audience="api")
        self.assertTrue(v.issuer.endswith("/oidc"))

    def test_issuer_no_double_append(self):
        """Already ending with /oidc -> no double append."""
        from services.logto_verifier import LogtoSyncVerifier
        v = LogtoSyncVerifier(issuer="https://auth.example.com/oidc", audience="api")
        self.assertEqual(v.issuer, "https://auth.example.com/oidc")

    def test_enabled_property(self):
        from services.logto_verifier import LogtoSyncVerifier
        v = LogtoSyncVerifier(issuer="https://auth.example.com", audience="api")
        self.assertTrue(v.enabled)
        v2 = LogtoSyncVerifier(issuer="", audience="api")
        self.assertFalse(v2.enabled)

    def test_verify_token_rejects_invalid_format(self):
        """Non-JWT string -> 401."""
        from services.logto_verifier import LogtoSyncVerifier
        v = LogtoSyncVerifier(issuer="https://auth.example.com", audience="test-aud")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(v.verify_token("not-a-jwt"))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_verify_token_expired(self):
        """Expired token -> 401 with '过期' message."""
        from services.logto_verifier import LogtoSyncVerifier
        from jose import jwt as jose_jwt
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        # Generate a test RSA key
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

        token = jose_jwt.encode(
            {"aud": "test-aud", "iss": "https://auth.example.com/oidc", "scope": "publish:read", "exp": int(time.time()) - 100},
            private_pem,
            algorithm="RS256",
            headers={"kid": "test-kid"},
        )

        v = LogtoSyncVerifier(issuer="https://auth.example.com", audience="test-aud")
        # Mock JWKS to return our test key
        pub_key = private_key.public_key().public_numbers()
        import base64

        def _int_to_b64url(n):
            b = n.to_bytes((n.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

        mock_jwk = {"kid": "test-kid", "kty": "RSA", "n": _int_to_b64url(pub_key.n), "e": _int_to_b64url(pub_key.e)}

        async def _mock_ensure():
            return {"test-kid": mock_jwk}

        v._ensure_jwks = _mock_ensure
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(v.verify_token(token))
        self.assertIn("过期", ctx.exception.detail)

    def test_verify_token_missing_scope(self):
        """Valid JWT but missing publish:read -> 403."""
        from services.logto_verifier import LogtoSyncVerifier
        from jose import jwt as jose_jwt
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

        token = jose_jwt.encode(
            {"aud": "test-aud", "iss": "https://auth.example.com/oidc", "scope": "profile", "exp": int(time.time()) + 3600},
            private_pem,
            algorithm="RS256",
            headers={"kid": "test-kid"},
        )

        v = LogtoSyncVerifier(issuer="https://auth.example.com", audience="test-aud")
        pub_key = private_key.public_key().public_numbers()
        import base64

        def _int_to_b64url(n):
            b = n.to_bytes((n.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

        mock_jwk = {"kid": "test-kid", "kty": "RSA", "n": _int_to_b64url(pub_key.n), "e": _int_to_b64url(pub_key.e)}

        async def _mock_ensure():
            return {"test-kid": mock_jwk}

        v._ensure_jwks = _mock_ensure
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(v.verify_token(token, required_scope="publish:read"))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_verify_token_success(self):
        """Valid JWT with correct scope -> returns claims."""
        from services.logto_verifier import LogtoSyncVerifier
        from jose import jwt as jose_jwt
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

        token = jose_jwt.encode(
            {"aud": "test-aud", "iss": "https://auth.example.com/oidc", "scope": "openid profile publish:read", "exp": int(time.time()) + 3600, "sub": "user123"},
            private_pem,
            algorithm="RS256",
            headers={"kid": "test-kid"},
        )

        v = LogtoSyncVerifier(issuer="https://auth.example.com", audience="test-aud")
        pub_key = private_key.public_key().public_numbers()
        import base64

        def _int_to_b64url(n):
            b = n.to_bytes((n.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

        mock_jwk = {"kid": "test-kid", "kty": "RSA", "n": _int_to_b64url(pub_key.n), "e": _int_to_b64url(pub_key.e)}

        async def _mock_ensure():
            return {"test-kid": mock_jwk}

        v._ensure_jwks = _mock_ensure
        claims = asyncio.run(v.verify_token(token))
        self.assertEqual(claims["sub"], "user123")


class TestVerifyBearerOrCatalogKey(unittest.TestCase):
    """Integration-level tests for the dual auth dependency."""

    def test_no_auth_headers_rejected(self):
        """Neither Bearer nor X-Catalog-Key -> 401/404."""
        from services.logto_verifier import verify_bearer_or_catalog_key
        mock_request = MagicMock()
        mock_request.headers = {}
        with patch("config.settings") as ms:
            ms.catalog_api_key = "some-key"
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(verify_bearer_or_catalog_key(mock_request))
            # With catalog key configured but no x-catalog-key header -> 401
            self.assertIn(ctx.exception.status_code, (401, 404))

    def test_catalog_key_still_works(self):
        """X-Catalog-Key path unchanged when no Bearer present."""
        from services.logto_verifier import verify_bearer_or_catalog_key
        mock_request = MagicMock()
        mock_request.headers = {"x-catalog-key": "correct-key", "authorization": ""}
        with patch("config.settings") as ms:
            ms.catalog_api_key = "correct-key"
            asyncio.run(verify_bearer_or_catalog_key(mock_request))  # Should not raise

    def test_bearer_with_no_verifier_raises(self):
        """Bearer present but Logto not configured -> 401."""
        from services.logto_verifier import verify_bearer_or_catalog_key, reset_verifier_cache
        reset_verifier_cache()
        mock_request = MagicMock()
        mock_request.headers = {"authorization": "Bearer faketoken", "x-catalog-key": ""}
        with patch("config.settings") as ms:
            ms.catalog_api_key = "key"
            ms.logto_endpoint = ""
            ms.logto_api_resource = ""
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(verify_bearer_or_catalog_key(mock_request))
            self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
