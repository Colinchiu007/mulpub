"""端点鉴权面（auth surface）单一真源 —— 反射 FastAPI 依赖声明，产出机器可读清单。

## 为什么要有这个模块

2026-10-15（auth-single-source）之前，ops-center 的鉴权有**两种挂法**：

1. **路由依赖声明**（`Depends(require_admin)` 等）—— 可被 `route.dependant` 反射读到；
2. **函数体内调用**（`_require_catalog_key(request)` 之类）—— 反射**读不到**。

第 2 种导致三个后果，全部实测存在过：
- 同一段静态 key 校验逻辑在 `routers/diagnostics.py`、`routers/publish_metrics.py`、
  `routers/usage.py` **各有一份逐字重复**的实现，`routers/feedback.py` 还从 `diagnostics`
  跨模块 import 私有名；
- `routers/runtime.py` 与 `routers/telemetry.py` 用了**同名/近名但语义不同**的包装
  （那两处是「Bearer 或 key」双通道，与前三处的「仅静态 key」不同）—— 鉴权强度要靠
  「读的是哪个文件的私有函数」来区分；
- 任何「以路由依赖声明为真源」的检查都会把这些端点的鉴权**读成空**，产出假阴性。

本模块配合那次收敛（8 个端点全部改为依赖声明、5 个私有包装删除）建立：
**唯一真源 = `app.routes[*].dependant` 的反射结果**，本文件只做三件事——
发现（反射）、出清单（`--emit`）、对账（`--check` 与 PRD 断言）。

## 用法

```bash
cd ops-center/backend
python scripts/auth_surface.py --emit          # 重新生成 tests/fixtures/auth-surface.json
python scripts/auth_surface.py --check         # 对照清单，漂移则 rc=1
```

CI 载体是**既有**的 `ops-center-ci.yml`（`cd ops-center/backend && python -m pytest tests/`），
断言见 `tests/test_auth_surface.py` —— 未新增 workflow 与 job，避免改动「谁来守门」。
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# ── 鉴权依赖词表（唯一真源里允许出现的名字）────────────────────────────────
# 语义分级是**给判据用的**，不是文档备注：
#   session  —— 需要登录身份（Bearer JWT 或 HttpOnly 会话 Cookie）
#   apikey   —— 仅静态 X-Catalog-Key（常量时间比较），不读 Bearer
#   dual     —— Bearer(Logto JWT) 优先，或 X-Catalog-Key（两条通道）
KNOWN_AUTH_DEPS: dict[str, str] = {
    "get_current_user": "session",
    "get_current_user_optional": "session-optional",
    "require_admin": "session+role",
    "require_catalog_key": "apikey",
    "verify_bearer_or_catalog_key": "dual",
}

# ── 公开端点显式登记（无任何鉴权依赖的路由必须在此列出）────────────────────
# 判据意义：新增一个「忘了挂鉴权」的端点会立刻变红，而不是静默变成公开端点。
PUBLIC_ALLOWLIST: dict[str, str] = {
    "POST /api/auth/login": "登录入口，必须免鉴权（它本身签发会话）",
    "POST /api/auth/logout": "登出入口，无凭据也应可调用（幂等清理）",
    "GET /health": "存活探针，供外部监控与容器编排",
    "GET /api/v1/rewrite-ai-taste/runtime": "已知暴露面：桌面端零调用，bootstrap 走 service 直调（见 tests/test_auth_surface.py 的 # 已知暴露面 断言）",
    "GET /api/v1/rewrite-hard-constraints/runtime": "同上",
    "GET /api/v1/rewrite-strategies/runtime": "同上",
}

# ── PRD 鉴权描述的机械对账表 ──────────────────────────────────────────────
# 判据方向：实现是唯一真源（本模块反射出来的），PRD 被判。
#
# **只判「做了鉴权声称」的行**，这是 2026-10-15 实测收敛出来的判据：
# PRD 里同一路径会出现在多种语境下 —— 鉴权契约行、配置来源行、下发通道行、变更记录行。
# 早期版本要求「每一处提到该路径的行都必须含关键词」，实测 22 条报错里绝大多数是误报
# （例：L4596「经 GET /api/v1/model-presets/catalog 同步到桌面端」根本没说鉴权）。
# 现在只判同时满足两条的行：①含该路径 ②含任一鉴权关键词（AUTH_KEYWORDS）。
#
# `require_mention=True` 表示 PRD **已经**在描述该端点 ⇒ 描述不得被删掉（防"删掉就不会红"）；
# `False` 表示 PRD 本就没写（如 runtime/ack、telemetry/degradation）⇒ 不强制 PRD 覆盖，
# 因为 PRD 不是端点清单，强求覆盖会退化成"为了过门禁往 PRD 里灌水"。
AUTH_KEYWORDS = ("鉴权", "认证", "Bearer", "X-Catalog-Key", "x-catalog-key", "Logto", "无需登录")

PRD_AUTH_EXPECTATIONS: list[dict] = [
    {
        "endpoint": "GET /api/v1/model-presets/catalog",
        "require_all": ["Bearer", "X-Catalog-Key"],
        "forbid": [],
        "require_mention": True,
        "why": "实现为 dual（verify_bearer_or_catalog_key）",
    },
    {
        "endpoint": "GET /api/v1/runtime/bootstrap",
        "require_all": ["Bearer", "X-Catalog-Key"],
        "forbid": [],
        "require_mention": True,
        "why": "实现为 dual",
    },
    {
        "endpoint": "POST /api/v1/runtime/ack",
        "require_all": ["Bearer", "X-Catalog-Key"],
        "forbid": [],
        "require_mention": False,
        "why": "实现为 dual（与 bootstrap 同款）；PRD 未单列该端点",
    },
    {
        "endpoint": "POST /api/v1/telemetry/degradation",
        "require_all": ["Bearer", "X-Catalog-Key"],
        "forbid": [],
        "require_mention": False,
        "why": "实现为 dual；PRD 未单列该端点",
    },
    {
        "endpoint": "POST /api/v1/usage/ingest",
        "require_all": ["X-Catalog-Key"],
        "forbid": ["Bearer"],
        "require_mention": True,
        "why": "实现为 apikey（仅静态 key）；桌面端 usage-reporter 只发 X-Catalog-Key。"
               "PRD 曾写「Bearer(Logto JWT) 优先」——过度声称，2026-10-15 修正",
    },
    {
        "endpoint": "POST /api/v1/publish/ingest",
        "require_all": ["X-Catalog-Key"],
        "forbid": ["Bearer"],
        "require_mention": True,
        "why": "实现为 apikey；桌面端 publish-reporter 只发 X-Catalog-Key。同上",
    },
    {
        "endpoint": "POST /api/v1/diagnostics/ingest",
        "require_all": ["X-Catalog-Key"],
        "forbid": [],
        "require_mention": False,
        "why": "实现为 apikey；PRD 未以鉴权契约形式单列",
    },
    {
        "endpoint": "POST /api/v1/feedback",
        "require_all": ["X-Catalog-Key"],
        "forbid": [],
        "require_mention": False,
        "why": "实现为 apikey；PRD 未以鉴权契约形式单列",
    },
]

# 函数体内不得出现的鉴权调用名（防止退回「反射读不到」的形态）
FORBIDDEN_IN_BODY_GUARDS = (
    "_require_catalog_key",
    "_require_client_key",
    "_require_bearer",
    "verify_bearer_or_catalog_key",
    "require_catalog_key",
    "require_admin",
    "get_current_user",
)

PRD_RELATIVE = Path("01-docs") / "PRD.md"


def _dep_names(route) -> set[str]:
    return {getattr(d.call, "__name__", "") for d in route.dependant.dependencies}


def _iter_api_routes(routes, prefix: str = "", depth: int = 0):
    """版本无关地枚举带 `dependant` 的路由（`(path, route)` 二元组）。

    **为什么必须递归**（2026-10-15 CI 抓出，本地全绿）：
    FastAPI 0.133 的 `app.include_router()` 把子路由**展平**进 `app.routes`，
    所以 `[r for r in app.routes if hasattr(r, "dependant")]` 直接拿到 153 个 `APIRoute`。
    但 **FastAPI 0.143 改成了惰性**：`app.routes` 里放的是 **`_IncludedRouter` 占位对象**
    （实测 37 项，仅 1 项带 `dependant`），真实路由挂在 `placeholder.original_router.routes`，
    前缀在 `placeholder.include_context.prefix`。

    本机是 0.133、CI 装的是 0.143（`requirements.txt` 只约束 `>=0.115,<1.0`），
    于是同一份反射代码**本地得到 153 条、CI 得到 0 条** —— 门禁只在本地有效，属「假绿」。
    递归后两版得到**同一份**清单（已用两版分别 `--check` 实测）。
    """
    if depth > 8:  # 防御：占位对象理论上不会自嵌套，但不做无限递归
        return
    for r in routes:
        if hasattr(r, "dependant"):
            yield prefix + getattr(r, "path", ""), r
            continue
        original = getattr(r, "original_router", None)
        if original is None:
            continue
        ctx = getattr(r, "include_context", None)
        sub_prefix = (getattr(ctx, "prefix", "") or "") if ctx is not None else ""
        yield from _iter_api_routes(getattr(original, "routes", []) or [], prefix + sub_prefix, depth + 1)


def build_surface(app) -> dict:
    """反射 FastAPI app，产出确定性的端点→鉴权清单。

    `other_deps` 记录**既不是 get_db、也不在 KNOWN_AUTH_DEPS 里**的依赖名。
    必须有这个字段，否则「词表锁」会退化成 no-op：若只记录已按词表过滤过的 `auth`，
    那么新冒出一个未登记的守卫时它在清单里**根本不可见**，断言 `used - KNOWN` 恒为空。
    （这是本 PR 自查发现的：初版词表锁正是如此，靠准备变异反证时才看出来。）
    """
    routes = []
    for full_path, r in _iter_api_routes(app.routes):
        methods = sorted(getattr(r, "methods", []) or [])
        names = _dep_names(r)
        auth = sorted(n for n in names if n in KNOWN_AUTH_DEPS)
        other = sorted(n for n in names if n not in KNOWN_AUTH_DEPS and n != "get_db")
        routes.append({
            "path": full_path,
            "methods": methods,
            "auth": auth,
            "auth_kinds": sorted({KNOWN_AUTH_DEPS[n] for n in auth}),
            "other_deps": other,
        })
    routes.sort(key=lambda x: (x["path"], ",".join(x["methods"])))
    return {"total": len(routes), "routes": routes}


def find_route(surface: dict, endpoint: str) -> dict | None:
    method, _, path = endpoint.partition(" ")
    for r in surface["routes"]:
        if r["path"] == path and method in r["methods"]:
            return r
    return None


def in_body_guard_hits(routers_dir: Path) -> list[str]:
    """AST 扫所有 router 模块：函数体内是否还在调用鉴权原语。

    只扫**函数体内**（含嵌套与 lambda），模块级 `def require_xxx` 定义本身不算命中；
    注释与字符串也不命中（AST 天然免疫）。
    """
    hits: list[str] = []
    for path in sorted(routers_dir.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for sub in ast.walk(node):
                if not isinstance(sub, ast.Call):
                    continue
                fn = sub.func
                name = getattr(fn, "id", None) or getattr(fn, "attr", None)
                if name in FORBIDDEN_IN_BODY_GUARDS:
                    hits.append(f"{path.name}:{node.name} -> {name}()")
    return hits


# 否定前缀：出现在关键词之前时，表示**否认**该通道，不应算作"声称接受"。
# 背景（2026-10-15 实测）：修正后的 PRD 文案是「仅接受 `X-Catalog-Key`…**不接受 Bearer**」，
# 朴素的 `"Bearer" in window` 判据把**自我否定**读成了声称 —— 判据必须读语义，不能读子串。
NEGATION_MARKERS = ("不接受", "不支持", "不认", "不读", "不启用", "无需", "不再", "禁止", "非", "无", "不")


def claims_keyword(window: str, kw: str) -> bool:
    """窗口是否**声称接受** kw（忽略被否定的出现）。"""
    idx = 0
    while True:
        i = window.find(kw, idx)
        if i < 0:
            return False
        idx = i + 1
        prefix = window[max(0, i - 8):i]
        if not any(m in prefix for m in NEGATION_MARKERS):
            return True


def prd_auth_violations(surface: dict, prd_text: str) -> list[str]:
    """对账 PRD 的鉴权描述与反射真源。返回违规说明列表（空 = 一致）。

    **按「提及窗口」判，不按整行判** —— 这是本 PR 实测出来的第二条判据修正：
    `01-docs/PRD.md` 是追加式文档，存在**巨型行**（实测单行 11494 字符，把整节需求
    挤在一行里）。按行判时，「该路径出现在本行」与「本行别处出现 Bearer」会撞在一起，
    于是把无关段落的 Bearer 算成该端点的鉴权声称 —— 修完真实描述后仍然报红。
    窗口取端点提及处 `-40 / +260` 字符，既覆盖 `（无需登录；鉴权 …）` 这类内联从句，
    也不会把同行的其他段落牵连进来。
    """
    problems: list[str] = []
    for spec in PRD_AUTH_EXPECTATIONS:
        endpoint = spec["endpoint"]
        route = find_route(surface, endpoint)
        if route is None:
            problems.append(f"{endpoint}: 清单中不存在该端点（登记项已过期？）")
            continue
        path = endpoint.partition(" ")[2]
        claims: list[tuple[int, str]] = []
        idx = 0
        while True:
            i = prd_text.find(path, idx)
            if i < 0:
                break
            idx = i + 1
            window = prd_text[max(0, i - 40):i + 260]
            if not any(kw in window for kw in AUTH_KEYWORDS):
                continue
            lineno = prd_text.count("\n", 0, i) + 1
            claims.append((lineno, window))
        if not claims:
            if spec.get("require_mention"):
                problems.append(
                    f"{endpoint}: PRD 未再以鉴权契约形式描述该端点"
                    f"（登记为 require_mention=True；实现 auth={route['auth']}）"
                )
            continue
        for lineno, window in claims:
            for kw in spec["require_all"]:
                if kw not in window:
                    problems.append(
                        f"{endpoint}: PRD L{lineno} 的鉴权描述缺少 {kw!r}"
                        f"（实现 auth={route['auth']} kinds={route['auth_kinds']}；{spec['why']}）"
                    )
            for kw in spec["forbid"]:
                if claims_keyword(window, kw):
                    problems.append(
                        f"{endpoint}: PRD L{lineno} 的鉴权描述声称接受 {kw!r}，但实现不接受该通道"
                        f"（auth={route['auth']} kinds={route['auth_kinds']}；{spec['why']}）"
                    )
    return problems


def public_routes(surface: dict) -> list[str]:
    return [
        ",".join(r["methods"]) + " " + r["path"]
        for r in surface["routes"]
        if not r["auth"]
    ]


def _load_app():
    sys.path.insert(0, str(BACKEND_ROOT))
    from main import app  # noqa: PLC0415

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="端点鉴权面单一真源")
    parser.add_argument("--emit", action="store_true", help="把反射结果写入 fixtures JSON")
    parser.add_argument("--check", action="store_true", help="对照 fixtures JSON，漂移则 rc=1")
    args = parser.parse_args(argv)

    # 清单路径**固定**，不开放为命令行参数：本工具是本地/CI 用的开发脚本，
    # 接受外部路径会让安全扫描把它读成路径遍历入口（实测 `.ccg` 的 verify-security
    # 在旧版上因 `--fixture` 报 2 处「路径遍历」高危）。固定路径同时更简单。
    fixture = BACKEND_ROOT / "tests" / "fixtures" / "auth-surface.json"
    surface = build_surface(_load_app())

    if args.emit:
        fixture.parent.mkdir(parents=True, exist_ok=True)
        fixture.write_text(json.dumps(surface, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"emitted {surface['total']} routes -> {fixture}")
        return 0

    if args.check:
        want = json.loads(fixture.read_text(encoding="utf-8"))
        if want != surface:
            print("DRIFT: 反射结果与清单不一致")
            old = {f"{','.join(r['methods'])} {r['path']}": r["auth"] for r in want["routes"]}
            new = {f"{','.join(r['methods'])} {r['path']}": r["auth"] for r in surface["routes"]}
            for k in sorted(set(old) | set(new)):
                if old.get(k) != new.get(k):
                    print(f"   {k}: {old.get(k)} -> {new.get(k)}")
            return 1
        print(f"OK: {surface['total']} routes 与清单一致")
        return 0

    print(f"total={surface['total']} public={len(public_routes(surface))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
