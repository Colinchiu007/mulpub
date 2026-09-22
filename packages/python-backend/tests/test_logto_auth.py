import asyncio
import base64
import importlib.util
import inspect
import json
import sys
import time
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi import Request

_MODULE_PATH = Path(__file__).parents[1] / "src" / "multi_publish" / "auth" / "logto.py"
_SPEC = importlib.util.spec_from_file_location("multi_publish_logto_auth_test_target", _MODULE_PATH)
logto_auth = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = logto_auth
_SPEC.loader.exec_module(logto_auth)


def _encode(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=").decode()


def _token(private_key, claims: dict, kid: str = "key-1") -> str:
    header = _encode({"alg": "RS256", "typ": "JWT", "kid": kid})
    payload = _encode(claims)
    signing_input = f"{header}.{payload}".encode()
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{payload}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def _ec_token(private_key, claims: dict, kid: str = "ec-key-1", alg: str = "ES384") -> str:
    header = _encode({"alg": alg, "typ": "JWT", "kid": kid})
    payload = _encode(claims)
    signing_input = f"{header}.{payload}".encode()
    der_signature = private_key.sign(signing_input, ec.ECDSA(hashes.SHA384()))
    r, s = decode_dss_signature(der_signature)
    signature = r.to_bytes(48, "big") + s.to_bytes(48, "big")
    return f"{header}.{payload}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def _rsa_jwk(private_key, kid: str) -> dict:
    numbers = private_key.public_key().public_numbers()
    return {
        "kid": kid,
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "n": base64.urlsafe_b64encode(numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big"))
        .rstrip(b"=")
        .decode(),
        "e": base64.urlsafe_b64encode(numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big"))
        .rstrip(b"=")
        .decode(),
    }


def _ec_jwk(private_key, kid: str) -> dict:
    numbers = private_key.public_key().public_numbers()
    return {
        "kid": kid,
        "kty": "EC",
        "alg": "ES384",
        "crv": "P-384",
        "use": "sig",
        "x": base64.urlsafe_b64encode(numbers.x.to_bytes(48, "big")).rstrip(b"=").decode(),
        "y": base64.urlsafe_b64encode(numbers.y.to_bytes(48, "big")).rstrip(b"=").decode(),
    }


class LogtoAuthTest(unittest.TestCase):
    def test_fastapi_dependency_declares_request_type(self):
        dependency = logto_auth.create_fastapi_dependency(
            logto_auth.LogtoJwtVerifier("https://id.example.com", "audience")
        )
        parameter = inspect.signature(dependency).parameters["request"]
        self.assertIn(parameter.annotation, (Request, "Request"))

    def test_rejects_insecure_non_local_issuer(self):
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_ISSUER_INVALID"):
            logto_auth.LogtoJwtVerifier("http://id.example.com", "audience")

    def test_allows_http_localhost_for_development(self):
        verifier = logto_auth.LogtoJwtVerifier("http://127.0.0.1:8080", "audience")
        self.assertEqual(verifier.issuer, "http://127.0.0.1:8080")

    def test_rejects_cross_origin_jwks_without_trust(self):
        async def fetcher(url):
            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": "https://id.example.com", "jwks_uri": "https://keys.example.net/jwks"}
                    return {"keys": []}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier("https://id.example.com", "audience", fetcher=fetcher)
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_DISCOVERY_INVALID"):
            import asyncio

            asyncio.run(verifier._get_keys())

    def test_allows_cross_origin_jwks_from_explicitly_trusted_host(self):
        async def fetcher(url):
            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": "https://id.example.com", "jwks_uri": "https://keys.example.net/jwks"}
                    return {"keys": []}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier(
            "https://id.example.com",
            "audience",
            fetcher=fetcher,
            trusted_jwks_hosts=frozenset({"keys.example.net"}),
        )
        import asyncio

        self.assertEqual(asyncio.run(verifier._get_keys()), {})

    def test_rejects_malformed_jwks_url_as_auth_error(self):
        async def fetcher(url):
            class Response:
                status_code = 200

                def json(self):
                    return {"issuer": "https://id.example.com", "jwks_uri": "https://id.example.com:bad/jwks"}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier("https://id.example.com", "audience", fetcher=fetcher)
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_DISCOVERY_INVALID"):
            import asyncio

            asyncio.run(verifier._get_keys())

    def test_fetch_errors_are_normalized_to_auth_error(self):
        async def fetcher(_url):
            raise TimeoutError("network down")

        verifier = logto_auth.LogtoJwtVerifier("https://id.example.com", "audience", fetcher=fetcher)
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_JWKS_UNAVAILABLE"):
            import asyncio

            asyncio.run(verifier._get_keys())

    def test_jwks_filters_encryption_and_unsupported_ec_keys(self):
        async def fetcher(url):
            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": "https://id.example.com", "jwks_uri": "https://id.example.com/jwks"}
                    return {
                        "keys": [
                            {"kid": "enc", "kty": "RSA", "use": "enc", "alg": "RSA-OAEP", "n": "bad", "e": "AQAB"},
                            {"kid": "ec", "kty": "EC", "use": "sig", "alg": "ES256"},
                        ]
                    }

            return Response()

        verifier = logto_auth.LogtoJwtVerifier("https://id.example.com", "audience", fetcher=fetcher)
        import asyncio

        self.assertEqual(asyncio.run(verifier._get_keys()), {})

    def test_jwks_accepts_logto_es384_p384_key(self):
        private_key = ec.generate_private_key(ec.SECP384R1())
        public_numbers = private_key.public_key().public_numbers()
        jwk = {
            "kid": "ec-key-1",
            "kty": "EC",
            "alg": "ES384",
            "crv": "P-384",
            "use": "sig",
            "x": base64.urlsafe_b64encode(public_numbers.x.to_bytes(48, "big")).rstrip(b"=").decode(),
            "y": base64.urlsafe_b64encode(public_numbers.y.to_bytes(48, "big")).rstrip(b"=").decode(),
        }

        async def fetcher(url):
            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": "https://id.example.com", "jwks_uri": "https://id.example.com/jwks"}
                    return {"keys": [jwk]}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier("https://id.example.com", "audience", fetcher=fetcher)
        keys = asyncio.run(verifier._get_keys())
        self.assertEqual(list(keys), ["ES384:ec-key-1"])

    def test_verifies_logto_es384_token_and_rejects_wrong_curve_or_signature_length(self):
        private_key = ec.generate_private_key(ec.SECP384R1())
        wrong_curve_key = ec.generate_private_key(ec.SECP256R1())
        now = int(time.time())
        claims = {
            "sub": "sub-es384",
            "iss": "https://id.example.com/oidc",
            "aud": "https://api.multi-publish.com",
            "scope": "publish:read",
            "iat": now - 10,
            "exp": now + 300,
        }
        token = _ec_token(private_key, claims)
        auth = logto_auth.verify_logto_jwt(
            token,
            public_key=private_key.public_key(),
            issuer=claims["iss"],
            audience=claims["aud"],
            now=now,
        )
        self.assertEqual(auth, {"subject": "sub-es384", "scopes": ["publish:read"]})
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_KEY_INVALID"):
            logto_auth.verify_logto_jwt(
                token,
                public_key=wrong_curve_key.public_key(),
                issuer=claims["iss"],
                audience=claims["aud"],
                now=now,
            )
        header, payload, _ = token.split(".")
        short_signature = base64.urlsafe_b64encode(b"short").rstrip(b"=").decode()
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_SIGNATURE_INVALID"):
            logto_auth.verify_logto_jwt(
                f"{header}.{payload}.{short_signature}",
                public_key=private_key.public_key(),
                issuer=claims["iss"],
                audience=claims["aud"],
                now=now,
            )
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_ALGORITHM_INVALID"):
            logto_auth.verify_logto_jwt(
                _ec_token(private_key, claims, alg="ES256"),
                public_key=private_key.public_key(),
                issuer=claims["iss"],
                audience=claims["aud"],
                now=now,
            )

    def test_verify_logto_jwt_checks_signature_claims_and_scopes(self):
        auth_error_type = logto_auth.AuthError
        require_scopes = logto_auth.require_scopes
        verify_logto_jwt = logto_auth.verify_logto_jwt

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        claims = {
            "sub": "sub-1",
            "iss": "https://id.example.com/oidc",
            "aud": "https://api.multi-publish.com",
            "scope": "publish:read publish:submit",
            "iat": now - 10,
            "exp": now + 300,
        }
        token = _token(private_key, claims)
        auth = verify_logto_jwt(
            token,
            public_key=private_key.public_key(),
            issuer=claims["iss"],
            audience=claims["aud"],
            now=now,
        )
        self.assertEqual(auth, {"subject": "sub-1", "scopes": ["publish:read", "publish:submit"]})
        self.assertTrue(require_scopes(auth, ["publish:submit"]))
        with self.assertRaisesRegex(auth_error_type, "AUTH_SCOPE_MISSING"):
            require_scopes(auth, ["admin:users"])
        with self.assertRaisesRegex(auth_error_type, "AUTH_AUDIENCE_INVALID"):
            verify_logto_jwt(
                token,
                public_key=private_key.public_key(),
                issuer=claims["iss"],
                audience="https://wrong.example",
                now=now,
            )

    def test_rejects_algorithm_downgrade_and_expired_token(self):
        auth_error_type = logto_auth.AuthError
        verify_logto_jwt = logto_auth.verify_logto_jwt

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        expired = _token(
            private_key,
            {"sub": "sub-1", "iss": "issuer", "aud": "audience", "iat": now - 500, "exp": now - 120},
        )
        with self.assertRaisesRegex(auth_error_type, "AUTH_TOKEN_EXPIRED"):
            verify_logto_jwt(
                expired,
                public_key=private_key.public_key(),
                issuer="issuer",
                audience="audience",
                now=now,
            )
        _, payload, signature = expired.split(".")
        bad_header = _encode({"alg": "none", "typ": "JWT", "kid": "key-1"})
        with self.assertRaisesRegex(auth_error_type, "AUTH_ALGORITHM_INVALID"):
            verify_logto_jwt(
                f"{bad_header}.{payload}.{signature}",
                public_key=private_key.public_key(),
                issuer="issuer",
                audience="audience",
                now=now,
            )

    def test_non_string_or_list_scope_never_grants_permission(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        token = _token(
            private_key,
            {"sub": "sub-1", "iss": "issuer", "aud": "audience", "scope": 123, "exp": now + 300},
        )

        auth = logto_auth.verify_logto_jwt(
            token,
            public_key=private_key.public_key(),
            issuer="issuer",
            audience="audience",
            now=now,
        )

        self.assertEqual(auth["scopes"], [])
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_SCOPE_MISSING"):
            logto_auth.require_scopes(auth, ["123"])

    def test_rejects_non_finite_and_boolean_numeric_dates(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        base_claims = {"sub": "sub-1", "iss": "issuer", "aud": "audience", "exp": now + 300}

        for invalid_exp in (True, float("nan"), float("inf"), float("-inf")):
            with self.subTest(exp=invalid_exp):
                token = _token(private_key, {**base_claims, "exp": invalid_exp})
                with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_TOKEN_EXPIRED"):
                    logto_auth.verify_logto_jwt(
                        token,
                        public_key=private_key.public_key(),
                        issuer="issuer",
                        audience="audience",
                        now=now,
                    )

        for invalid_nbf in (True, float("nan"), float("inf"), float("-inf")):
            with self.subTest(nbf=invalid_nbf):
                token = _token(private_key, {**base_claims, "nbf": invalid_nbf})
                with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_TOKEN_NOT_ACTIVE"):
                    logto_auth.verify_logto_jwt(
                        token,
                        public_key=private_key.public_key(),
                        issuer="issuer",
                        audience="audience",
                        now=now,
                    )

        for invalid_nbf in (None, "123"):
            with self.subTest(nbf=invalid_nbf):
                token = _token(private_key, {**base_claims, "nbf": invalid_nbf})
                with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_TOKEN_NOT_ACTIVE"):
                    logto_auth.verify_logto_jwt(
                        token,
                        public_key=private_key.public_key(),
                        issuer="issuer",
                        audience="audience",
                        now=now,
                    )

    def test_malformed_base64_is_normalized_to_auth_error(self):
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_TOKEN_INVALID"):
            logto_auth._decode_part("a")

    def test_invalid_discovery_is_not_cached_for_a_later_request(self):
        calls = []

        async def fetcher(url):
            calls.append(url)

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": "https://id.example.com", "jwks_uri": "http://127.0.0.1:9/private"}
                    return {"keys": []}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier("https://id.example.com", "audience", fetcher=fetcher)
        import asyncio

        for _ in range(2):
            with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_DISCOVERY_INVALID"):
                asyncio.run(verifier._get_keys())
        self.assertEqual(calls.count("https://id.example.com/.well-known/openid-configuration"), 2)
        self.assertEqual(verifier._discovery, None)

    def test_unknown_kid_refresh_is_single_flight_and_bounded(self):
        calls = []

        async def fetcher(url):
            calls.append(url)

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": "https://id.example.com", "jwks_uri": "https://id.example.com/jwks"}
                    return {"keys": []}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier(
            "https://id.example.com", "audience", fetcher=fetcher,
            unknown_kid_cache_ttl_seconds=60, forced_refresh_cooldown_seconds=60,
            unknown_kid_cache_max=8,
        )
        import asyncio

        def unknown_token(kid):
            return f'{_encode({"alg": "RS256", "kid": kid})}.{_encode({"sub": "x"})}.AA'

        async def run():
            return await asyncio.gather(
                *(verifier.verify(unknown_token(f"random-{index}")) for index in range(100)),
                return_exceptions=True,
            )

        errors = asyncio.run(run())
        self.assertTrue(all(isinstance(error, logto_auth.AuthError) for error in errors))
        self.assertLessEqual(calls.count("https://id.example.com/jwks"), 2)
        self.assertLessEqual(len(verifier._unknown_kid_cache), 8)
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_KEY_NOT_FOUND"):
            asyncio.run(verifier.verify(unknown_token("x" * 129)))

    def test_unknown_kid_negative_cache_is_isolated_by_algorithm(self):
        issuer = "https://id.example.com"
        audience = "audience"
        now = int(time.time())
        claims = {
            "sub": "subject-1",
            "iss": issuer,
            "aud": audience,
            "iat": now - 10,
            "exp": now + 300,
        }
        rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ec_key = ec.generate_private_key(ec.SECP384R1())

        async def assert_isolated(jwk, missing_token, valid_token, expected_cache_key):
            async def fetcher(url):
                class Response:
                    status_code = 200

                    def json(self):
                        if url.endswith("openid-configuration"):
                            return {"issuer": issuer, "jwks_uri": f"{issuer}/jwks"}
                        return {"keys": [jwk]}

                return Response()

            verifier = logto_auth.LogtoJwtVerifier(
                issuer,
                audience,
                fetcher=fetcher,
                unknown_kid_cache_ttl_seconds=60,
                forced_refresh_cooldown_seconds=60,
                now=lambda: now,
            )
            with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_KEY_NOT_FOUND"):
                await verifier.verify(missing_token)
            self.assertIn(expected_cache_key, verifier._unknown_kid_cache)
            self.assertEqual((await verifier.verify(valid_token))["subject"], "subject-1")

        async def run():
            await assert_isolated(
                _rsa_jwk(rsa_key, "shared-kid"),
                _ec_token(ec_key, claims, kid="shared-kid"),
                _token(rsa_key, claims, kid="shared-kid"),
                "ES384:shared-kid",
            )
            await assert_isolated(
                _ec_jwk(ec_key, "shared-kid"),
                _token(rsa_key, claims, kid="shared-kid"),
                _ec_token(ec_key, claims, kid="shared-kid"),
                "RS256:shared-kid",
            )

        asyncio.run(run())


class JwksResilienceTest(unittest.TestCase):
    """账号页首开 25s 事故的回归保护。

    根因：身份服务（Logto）JWKS 拉取一次超时会被放大成「后端 503 伪装成 401 →
    客户端刷新令牌再重放 → 每次都重新付 5~10s 超时」，账号页因此长时间无数据。
    """

    def _issuer(self):
        return "https://id.example.com"

    def _ok_fetcher(self, private_key, calls=None, slow=False):
        issuer = self._issuer()

        async def fetcher(url):
            if calls is not None:
                calls.append(url)
            if slow and url.endswith("/jwks"):
                await asyncio.sleep(0.05)

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": issuer, "jwks_uri": f"{issuer}/jwks"}
                    return {"keys": [_rsa_jwk(private_key, "key-1")]}

            return Response()

        return fetcher

    def test_jwks_fetch_failure_is_503_not_401(self):
        """AUTH_JWKS_UNAVAILABLE 是上游不可用，不是令牌失效；否则调用方会误做「刷新令牌 + 重放」。"""

        async def fetcher(_url):
            raise TimeoutError("network down")

        verifier = logto_auth.LogtoJwtVerifier(self._issuer(), "audience", fetcher=fetcher)
        with self.assertRaises(logto_auth.AuthError) as ctx:
            asyncio.run(verifier._get_keys())
        self.assertEqual(ctx.exception.code, "AUTH_JWKS_UNAVAILABLE")
        self.assertEqual(ctx.exception.status, 503)

    def test_jwks_non_2xx_is_503(self):
        async def fetcher(_url):
            class Response:
                status_code = 502

                def json(self):
                    return {}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier(self._issuer(), "audience", fetcher=fetcher)
        with self.assertRaises(logto_auth.AuthError) as ctx:
            asyncio.run(verifier._get_keys())
        self.assertEqual(ctx.exception.status, 503)

    def test_fastapi_dependency_returns_503_for_jwks_unavailable(self):
        from types import SimpleNamespace

        from fastapi import HTTPException

        verifier = SimpleNamespace(verify=_raise_jwks_unavailable)
        dependency = logto_auth.create_fastapi_dependency(verifier, [])
        request = SimpleNamespace(headers={"authorization": "Bearer token"})
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(dependency(request))
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.detail, "AUTH_JWKS_UNAVAILABLE")

    def test_jwks_failure_is_backed_off_within_window(self):
        """失败退避：一次抖动只付一次超时，退避窗口内不再重复打网络。"""
        now = {"value": 1000}
        calls = []

        async def fetcher(url):
            calls.append(url)
            raise TimeoutError("network down")

        verifier = logto_auth.LogtoJwtVerifier(
            self._issuer(), "audience", fetcher=fetcher,
            jwks_failure_backoff_seconds=15, now=lambda: now["value"],
        )
        for _ in range(3):
            with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_JWKS_UNAVAILABLE"):
                asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 1)

        # 退避窗口结束后必须重试，否则身份服务恢复后仍会永久拒绝。
        now["value"] += 16
        with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_JWKS_UNAVAILABLE"):
            asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 2)

    def test_valid_discovery_failure_is_not_backed_off(self):
        """discovery 校验失败是快速失败（不是超时），必须允许下一次请求立刻重试。"""
        calls = []

        async def fetcher(url):
            calls.append(url)

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": self_issuer, "jwks_uri": "http://127.0.0.1:9/private"}
                    return {"keys": []}

            return Response()

        self_issuer = self._issuer()
        verifier = logto_auth.LogtoJwtVerifier(
            self_issuer, "audience", fetcher=fetcher, jwks_failure_backoff_seconds=15,
        )
        for _ in range(2):
            with self.assertRaisesRegex(logto_auth.AuthError, "AUTH_DISCOVERY_INVALID"):
                asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 2)

    def test_failure_backoff_also_blocks_forced_refresh(self):
        """退避对 force 同样生效，否则故障期每次 unknown-kid 验签都会重新付一遍超时。"""
        now = {"value": 1000}
        calls = []

        async def fetcher(url):
            calls.append(url)
            raise TimeoutError("network down")

        verifier = logto_auth.LogtoJwtVerifier(
            self._issuer(), "audience", fetcher=fetcher,
            jwks_failure_backoff_seconds=15, now=lambda: now["value"],
        )
        with self.assertRaises(logto_auth.AuthError):
            asyncio.run(verifier._get_keys())
        for _ in range(3):
            with self.assertRaises(logto_auth.AuthError):
                asyncio.run(verifier._get_keys(force=True))
        self.assertEqual(len(calls), 1)

    def test_successful_fetch_clears_failure_backoff(self):
        now = {"value": 1000}
        issuer = self._issuer()
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        state = {"fail": True}

        async def fetcher(url):
            if state["fail"]:
                raise TimeoutError("network down")

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": issuer, "jwks_uri": f"{issuer}/jwks"}
                    return {"keys": [_rsa_jwk(private_key, "key-1")]}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier(
            issuer, "audience", fetcher=fetcher, jwks_failure_backoff_seconds=15,
            cache_ttl_seconds=300, stale_cache_grace_seconds=3600, now=lambda: now["value"],
        )
        with self.assertRaises(logto_auth.AuthError):
            asyncio.run(verifier._get_keys())
        self.assertIsNotNone(verifier._keys_failed_at)

        state["fail"] = False
        now["value"] += 16
        keys = asyncio.run(verifier._get_keys())
        self.assertIn("RS256:key-1", keys)
        self.assertTrue(verifier._keys_loaded)
        # 时间戳必须清零，否则下一次故障会沿用旧的退避起点。
        self.assertIsNone(verifier._keys_failed_at)

    def test_stale_keys_served_while_refreshing_in_background(self):
        """stale-while-revalidate：TTL 过期不得把刷新成本压到用户请求路径上。"""
        now = {"value": 1000}
        issuer = self._issuer()
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        calls = []
        slow = {"value": False}

        async def fetcher(url):
            calls.append(url)
            if slow["value"] and url.endswith("/jwks"):
                await asyncio.sleep(0.05)

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": issuer, "jwks_uri": f"{issuer}/jwks"}
                    return {"keys": [_rsa_jwk(private_key, "key-1")]}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier(
            issuer, "audience", fetcher=fetcher, cache_ttl_seconds=300,
            stale_cache_grace_seconds=3600, now=lambda: now["value"],
        )
        asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 2)

        slow["value"] = True
        now["value"] += 301
        loop = asyncio.new_event_loop()
        try:
            stale_started = loop.time()
            stale = loop.run_until_complete(verifier._get_keys())
            elapsed = loop.time() - stale_started
            pending = [task for task in (verifier._background_refresh,) if task is not None]
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        finally:
            loop.close()
        self.assertIn("RS256:key-1", stale)
        self.assertLess(elapsed, 0.04, "过期刷新不得阻塞请求路径")
        self.assertGreater(len(calls), 2, "后台必须真正刷新，不能永久停留在旧 keys")
        self.assertGreater(verifier._keys_at, 1000)

    def test_background_refresh_is_skipped_during_failure_backoff(self):
        """失败退避窗口内后台刷新也不打网络，否则每个请求都白付一次刷新成本。"""
        now = {"value": 1000}
        issuer = self._issuer()
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        calls = []
        fail = {"value": False}

        async def fetcher(url):
            calls.append(url)
            if fail["value"] and url.endswith("/jwks"):
                raise TimeoutError("network down")

            class Response:
                status_code = 200

                def json(self):
                    if url.endswith("openid-configuration"):
                        return {"issuer": issuer, "jwks_uri": f"{issuer}/jwks"}
                    return {"keys": [_rsa_jwk(private_key, "key-1")]}

            return Response()

        verifier = logto_auth.LogtoJwtVerifier(
            issuer, "audience", fetcher=fetcher, cache_ttl_seconds=300,
            stale_cache_grace_seconds=3600, jwks_failure_backoff_seconds=15,
            now=lambda: now["value"],
        )
        asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 2)

        async def drain_background():
            pending = [task for task in (verifier._background_refresh,) if task is not None]
            await asyncio.gather(*pending, return_exceptions=True)

        loop = asyncio.new_event_loop()
        try:
            fail["value"] = True
            now["value"] += 301
            loop.run_until_complete(verifier._get_keys())
            loop.run_until_complete(drain_background())
            self.assertEqual(len(calls), 3, "首次后台刷新应真实尝试一次")
            self.assertIsNotNone(verifier._keys_failed_at)

            now["value"] += 1
            stale = loop.run_until_complete(verifier._get_keys())
            loop.run_until_complete(drain_background())
            self.assertIn("RS256:key-1", stale)
            self.assertEqual(len(calls), 3, "退避窗口内后台刷新不得重复打网络")

            fail["value"] = False
            now["value"] += 15
            loop.run_until_complete(verifier._get_keys())
            loop.run_until_complete(drain_background())
            self.assertGreater(len(calls), 3, "退避结束后后台刷新必须恢复")
        finally:
            loop.close()

    def test_stale_keys_beyond_grace_require_blocking_refresh(self):
        now = {"value": 1000}
        issuer = self._issuer()
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        calls = []

        verifier_fetcher = self._ok_fetcher(private_key, calls)
        verifier = logto_auth.LogtoJwtVerifier(
            issuer, "audience", fetcher=verifier_fetcher, cache_ttl_seconds=300,
            stale_cache_grace_seconds=600, now=lambda: now["value"],
        )
        asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 2)
        now["value"] += 300 + 601
        asyncio.run(verifier._get_keys())
        self.assertEqual(len(calls), 3)

    def test_prefetch_warms_cache_and_never_raises(self):
        issuer = self._issuer()
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ok_verifier = logto_auth.LogtoJwtVerifier(
            issuer, "audience", fetcher=self._ok_fetcher(private_key),
        )
        async def failing_fetcher(_url):
            raise TimeoutError("network down")

        bad_verifier = logto_auth.LogtoJwtVerifier(issuer, "audience", fetcher=failing_fetcher)

        async def run():
            self.assertTrue(await ok_verifier.prefetch())
            self.assertIn("RS256:key-1", ok_verifier._keys)
            self.assertFalse(await bad_verifier.prefetch())

        asyncio.run(run())

    def test_http_client_is_reused_and_closed(self):
        """每次请求新建 client 会重做 TCP+TLS 握手，代理路由下是主要耗时来源。"""
        created = []

        class FakeResponse:
            status_code = 200

            def json(self):
                return {"issuer": self_issuer, "jwks_uri": "https://id.example.com/jwks"}

        class FakeClient:
            def __init__(self):
                self.closed = False

            async def get(self, _url):
                return FakeResponse()

            async def aclose(self):
                self.closed = True

        self_issuer = self._issuer()
        verifier = logto_auth.LogtoJwtVerifier(self_issuer, "audience")

        def factory():
            client = FakeClient()
            created.append(client)
            return client

        verifier._new_http_client = factory
        asyncio.run(verifier._get_json(f"{self_issuer}/.well-known/openid-configuration"))
        asyncio.run(verifier._get_json(f"{self_issuer}/jwks"))
        self.assertEqual(len(created), 1)
        asyncio.run(verifier.aclose())
        self.assertTrue(created[0].closed)
        self.assertIsNone(verifier._http_client)


async def _raise_jwks_unavailable(_token):
    raise logto_auth.AuthError("AUTH_JWKS_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
