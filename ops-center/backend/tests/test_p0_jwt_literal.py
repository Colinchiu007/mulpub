"""
P0-8 回归：systemd `Environment=` 不展开 `${VAR}`，未展开的模板字面量一旦流入进程，
就成了仓库里可复算的公开常量（体检报告问题 8 的攻击面）。启动校验必须按「模式」拒绝，
而不是只靠长度判据顺带拦下。
Run: cd ops-center/backend && python -m pytest tests/test_p0_jwt_literal.py -x -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LONG_LITERAL = "${OPS_JWT_SECRET_DO_NOT_EXPAND_" + "a" * 32 + "}"   # >=32 字符
CMD_SUBST = "$(" + "b" * 40 + ")"


class TestUnexpandedVariableLiteral:
    def _v(self):
        from config import _validate_jwt_secret
        return _validate_jwt_secret

    def test_rejects_short_unexpanded_literal(self):
        # 报告点名的真实值：长度判据也能拦下，但归因必须是「未展开字面量」
        with pytest.raises(SystemExit, match="unexpanded"):
            self._v()("${PO_SECRET_KEY}")

    def test_rejects_long_unexpanded_literal(self):
        # 长度 >=32 的未展开字面量：只能靠模式判据拦下（本用例在修复前必红）
        assert len(LONG_LITERAL) >= 32
        with pytest.raises(SystemExit, match="unexpanded"):
            self._v()(LONG_LITERAL)

    def test_rejects_command_substitution(self):
        assert len(CMD_SUBST) >= 32
        with pytest.raises(SystemExit, match="unexpanded"):
            self._v()(CMD_SUBST)

    def test_rejects_marker_anywhere_in_value(self):
        with pytest.raises(SystemExit, match="unexpanded"):
            self._v()("a" * 20 + "${X}" + "a" * 20)

    def test_still_accepts_strong_random(self):
        self._v()("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")  # 不得抛

    def test_helpers_covered_for_encryption_key(self):
        """同一 systemd 机制也作用于 OPS_ENCRYPTION_KEY：启动检查须走同一判据。"""
        import inspect
        import config
        src = inspect.getsource(config)
        assert "_UNEXPANDED_MARKERS" in src, "未展开字面量判据常量缺失"
        checks = inspect.getsource(config.run_startup_security_checks)
        assert "_reject_unexpanded" in checks, "P0-4 加密主密钥未复用同一判据"
