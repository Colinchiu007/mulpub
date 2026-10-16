"""端点鉴权面锁 —— 以 FastAPI 路由依赖声明为唯一真源。

五条断言，各自挡一类回归：

1. `test_surface_matches_committed_fixture` —— **清单漂移锁**：任何鉴权改动都必须同步
   `tests/fixtures/auth-surface.json`（`python scripts/auth_surface.py --emit`）。
   挡的是「改了鉴权但没人发现」。
2. `test_every_public_route_is_explicitly_registered` —— **公开端点白名单锁**：无鉴权依赖的
   路由必须逐条登记在 `scripts/auth_surface.py::PUBLIC_ALLOWLIST`。挡的是「新端点忘了挂鉴权
   ⇒ 静默变成公开」。2026-10-16 起名单只剩 3 条**自证合理**的公共端点（login/logout/health）
   —— 原先 3 条以「供 bootstrap 内部组装使用」为由豁免的 `GET /<资源>/runtime` 已改为
   `get_current_user`（change: harden-runtime-endpoints-auth），其反向断言与非空转守卫见
   `tests/test_runtime_endpoints_require_auth.py`。
3. `test_no_auth_guard_called_inside_handler_body` —— **AST 结构锁**：router 模块的函数体内
   不得再出现鉴权原语调用。挡的是「退回反射读不到的形态」（2026-10-15 之前 8 个端点就是如此，
   且 4 份重复实现 + 1 处同名不同义）。
4. `test_auth_dependencies_come_from_known_vocabulary` —— **词表锁**：路由依赖只能用
   `KNOWN_AUTH_DEPS` 里的名字。挡的是「又冒出一个没登记的自定义守卫」。
5. `test_prd_auth_descriptions_match_implementation` —— **PRD 对账锁**：按
   `PRD_AUTH_EXPECTATIONS` 逐条核对 PRD 文本。挡的是「PRD 声称的鉴权强度与实现不符」
   （实测抓到 3 处：usage/publish ingest 曾写「Bearer 优先」，model-presets catalog 的
   docstring 漏了 Bearer 通道）。
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from scripts.auth_surface import (  # noqa: E402
    KNOWN_AUTH_DEPS,
    PRD_RELATIVE,
    PUBLIC_ALLOWLIST,
    build_surface,
    in_body_guard_hits,
    prd_auth_violations,
    public_routes,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "auth-surface.json"


def _surface():
    from main import app

    return build_surface(app)


class TestAuthSurface(unittest.TestCase):
    def test_surface_is_not_degenerate(self):
        """规模下界锁：反射结果不能退化成空集/极小集。

        2026-10-15 CI 实测教训：FastAPI 0.143 把 `include_router` 改成惰性后，
        朴素反射在 CI 上得到 **0 条路由**，于是「词表锁」的 `unused` 断言报出
        「5 个依赖都没人用」—— 报错**指向登记表**（看起来像人手写错了），
        而真因是**解析退化成空集合**。这条下界锁把该形态变成一眼可辨的失败。
        （纪律出处：AGENTS.md「对解析结果加规模下界断言，否则解析退化成空集合会让通配锁假绿」。）
        """
        surface = _surface()
        self.assertGreaterEqual(
            surface["total"], 100,
            f"反射结果只有 {surface['total']} 条路由，疑似真源解析退化（FastAPI 版本行为差异？）",
        )
        with_auth = [r for r in surface["routes"] if r["auth"]]
        self.assertGreaterEqual(len(with_auth), 100, f"带鉴权的端点只有 {len(with_auth)} 个，疑似解析退化")

    def test_surface_matches_committed_fixture(self):
        """清单漂移锁：反射结果必须与已提交清单逐字节一致。"""
        self.assertTrue(FIXTURE.exists(), f"清单不存在：{FIXTURE}（先跑 python scripts/auth_surface.py --emit）")
        committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
        current = _surface()
        if committed != current:
            old = {f"{','.join(r['methods'])} {r['path']}": r["auth"] for r in committed["routes"]}
            new = {f"{','.join(r['methods'])} {r['path']}": r["auth"] for r in current["routes"]}
            diff = [
                f"  {k}: {old.get(k)} -> {new.get(k)}"
                for k in sorted(set(old) | set(new))
                if old.get(k) != new.get(k)
            ]
            self.fail(
                "端点鉴权面与已提交清单不一致，请跑 "
                "`python scripts/auth_surface.py --emit` 并复核 diff：\n" + "\n".join(diff)
            )

    def test_every_public_route_is_explicitly_registered(self):
        """公开端点白名单锁：无鉴权的路由必须逐条登记。"""
        surface = _surface()
        unregistered = [r for r in public_routes(surface) if r not in PUBLIC_ALLOWLIST]
        self.assertEqual(
            unregistered,
            [],
            "检测到未登记的公开端点（无任何鉴权依赖）。若确实应公开，"
            "请加入 scripts/auth_surface.py::PUBLIC_ALLOWLIST 并写明理由：\n  "
            + "\n  ".join(unregistered),
        )
        # 反向：登记项不得陈旧（端点已消失或已改为有鉴权）
        current = set(public_routes(surface))
        stale = [k for k in PUBLIC_ALLOWLIST if k not in current]
        self.assertEqual(stale, [], f"PUBLIC_ALLOWLIST 存在陈旧登记项：{stale}")

    def test_no_auth_guard_called_inside_handler_body(self):
        """AST 结构锁：函数体内不得再调用鉴权原语（防退回反射读不到的形态）。"""
        hits = in_body_guard_hits(BACKEND_ROOT / "routers")
        self.assertEqual(
            hits,
            [],
            "路由的鉴权必须写成 Depends(...) 依赖声明，不得在函数体内调用；"
            "后者对 route.dependant 反射不可见，会使本清单失真：\n  " + "\n  ".join(hits),
        )

    def test_auth_dependencies_come_from_known_vocabulary(self):
        """词表锁：不得出现未登记的依赖（否则新守卫对反射不可见，清单会失真）。"""
        surface = _surface()
        # 未登记依赖必须为空 —— 这是本锁的**有效性前提**：清单的 other_deps 记录的是
        # 既非 get_db 也不在 KNOWN_AUTH_DEPS 的名字；若它非空，说明有依赖绕过了词表。
        offenders = {
            f"{','.join(r['methods'])} {r['path']}": r["other_deps"]
            for r in surface["routes"]
            if r["other_deps"]
        }
        self.assertEqual(
            offenders,
            {},
            "出现未登记的依赖名。若它是新的鉴权守卫，必须先登记进 "
            "scripts/auth_surface.py::KNOWN_AUTH_DEPS（并写明语义分级），"
            "否则反射清单会漏掉它：\n  "
            + "\n  ".join(f"{k}: {v}" for k, v in offenders.items()),
        )
        used = {n for r in surface["routes"] for n in r["auth"]}
        unknown = sorted(used - set(KNOWN_AUTH_DEPS))
        self.assertEqual(unknown, [], f"出现未登记的鉴权依赖名：{unknown}")
        # 每个已登记的鉴权依赖都应至少被一个端点用到（防陈旧登记）
        unused = sorted(set(KNOWN_AUTH_DEPS) - used)
        self.assertEqual(unused, [], f"KNOWN_AUTH_DEPS 中登记但无人使用的依赖：{unused}")

    def test_prd_auth_descriptions_match_implementation(self):
        """PRD 对账锁：实现是唯一真源，PRD 的鉴权描述被判。"""
        prd_path = REPO_ROOT / PRD_RELATIVE
        self.assertTrue(prd_path.exists(), f"找不到 PRD：{prd_path}")
        problems = prd_auth_violations(_surface(), prd_path.read_text(encoding="utf-8"))
        self.assertEqual(
            problems,
            [],
            "PRD 的鉴权描述与实现不一致：\n  " + "\n  ".join(problems),
        )


if __name__ == "__main__":
    unittest.main()
