"""灌入价格卡种子 —— 幂等，且**绝不改价**。

**为什么需要它**：`model_price_cards` 是版本化价格表（10-08 §4.1 / 10-11 §4），
改价 = 插新行 + 给旧行补 `effective_to`（**禁 UPDATE 单价**）。
所以本脚本的行为是「**只插不改**」：

  · card id 不存在 ⇒ 插入
  · card id 已存在且**单价/采购形状完全一致** ⇒ 跳过（幂等，可反复跑）
  · card id 已存在但**单价不同** ⇒ **报错退出**（fail-closed）
    ⇒ 绝不静默改价：那会毁掉历史成本的可复算性（10-11 §6）。

**只灌 `priced`，不灌 `pending`**：待确认项一律不写库 ——
缺价必须产生「缺价格」告警（10-11 §13 原则 3：UNKNOWN + fail-closed，不填暂定数字）。
⚠️ 尤其**绝不插 unit_price_micros=0 的行**：0 价卡会被回算静默命中，
既不告警、又被当成「免费」。

用法（ops-center/backend 目录下）：
    python3 scripts/seed_credit_price_cards.py            # 灌入 priced
    python3 scripts/seed_credit_price_cards.py --dry-run  # 只报告不写库
    python3 scripts/seed_credit_price_cards.py --check    # 只报差异（判断是否已灌过）
"""
import argparse
import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy as sa  # noqa: E402

from database import async_session, init_db  # noqa: E402
from models_credit import ModelPriceCard  # noqa: E402

# ⚠️ 种子数据放 `seed/`，**不放 `data/`** ——
# 仓根 `.gitignore` 第 12 行的 `data/` 会把整个 `ops-center/backend/data/` 目录排除掉
# （现有的 `scene_context_rules.template.json` 也不在版本控制里）⇒ 放那里等于种子数据进不了仓。
SEED_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "seed", "model_price_cards.seed.json",
)

# ⚠️ 这些字段参与「是否同一张卡」的比较：任一不同 ⇒ 视为**改价** ⇒ 报错，不静默覆盖。
IDENTITY_FIELDS = (
    "provider_id", "model_id", "action_type", "unit", "spec", "quality_tier",
    "unit_price_micros", "currency", "proc_discount", "credit_multiplier", "billed_by",
)


def load_seed():
    with open(SEED_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def zero_price_ids(priced) -> list:
    """返回 priced 里**单价为 0 或非整数**的条目 id（写库前的 fail-closed 守卫）。

    抽成模块级函数是为了**可测**：守卫写在 `seed()` 里的话，测试只能靠
    「改种子文件」来触发 ⇒ 种子文件是仓内固定资产 ⇒ 那条测法会反过来要求
    仓里常驻一条 0 价假数据（而 0 价卡正是本脚本要拒的东西）。
    ⇒ 守卫必须是纯函数、能在不碰种子文件的前提下被直接测到。
    """
    return [
        c.get("id") for c in priced
        if not isinstance(c.get("unit_price_micros"), int) or c["unit_price_micros"] <= 0
    ]


async def _table_exists(session, name: str) -> bool:
    """只读探测某张表在不在（不建表、不建索引）。"""
    row = (
        await session.execute(
            sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name = :n"),
            {"n": name},
        )
    ).first()
    return row is not None


async def _table_columns(session, name: str) -> set:
    """只读取某张表的列名集合（表不存在 ⇒ 空集）。"""
    if not await _table_exists(session, name):
        return set()
    rows = (await session.execute(sa.text(f"PRAGMA table_info({name})"))).fetchall()
    return {r[1] for r in rows}


# ⚠️ 旧 schema → 新 schema 的列名映射（#4322 用「分」，本 PR 改「微元」）。
# SQLite 的 `create_all` **不改已有表** ⇒ 跑过 #4322 的存量库上这几张表仍是旧列名
# ⇒ 灌种子会 `OperationalError: no such column: model_price_cards.unit_price_micros`。
LEGACY_COLUMNS = {
    "model_price_cards": {"unit_price_cents": "unit_price_micros"},
    "credit_price_config": {"credit_unit_price_cents": "credit_unit_price_micros"},
}


async def detect_legacy_schema(session) -> list:
    """探测存量旧 schema，返回人类可读的问题清单（空 ⇒ 已是当前 schema）。

    ⚠️ **只诊断、不自动修**：改唯一约束在 SQLite 上只能**重建表**，
    而仓内既有的 4 处迁移全是「加列」、**没有表重建先例**；重建表要搬运营
    可能已建的价格卡数据 ⇒ 不可逆 ⇒ 自动重建的风险高于收益。
    ⇒ 这里只把「会静默炸」变成「明确报错 + 人工修复指引」。
    """
    problems = []
    for table, mapping in LEGACY_COLUMNS.items():
        cols = await _table_columns(session, table)
        if not cols:
            continue
        for legacy, current in mapping.items():
            if legacy in cols and current not in cols:
                problems.append(f"{table} 仍是旧列名 `{legacy}`（应为 `{current}`）")
    # 唯一约束：旧版漏了 `unit` 维度 ⇒ 同一 provider 的 in/out/cache 三张卡存不下。
    # ⚠️ 判据必须落在「**唯一约束实际覆盖的列集合**」上，不能拿整段建表 sql 做子串匹配：
    #    ① 表里那一列**本来就叫 unit** ⇒ `"unit" not in sql` 恒不成立（漏报）；
    #    ② SQLAlchemy 的 `UniqueConstraint(...)` 是**表级约束**，在 `sqlite_master` 里属于
    #       `type='table'` 那行的 sql；`type='index'` 的行只有自动索引（sql 为 NULL）。
    # ⇒ 两个来源都查：表定义里的 `UNIQUE (...)` 列表 + 独立创建的 UNIQUE 索引。
    unique_col_sets = []
    tbl_sql = (
        await session.execute(sa.text(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='model_price_cards'"
        ))
    ).first()
    if tbl_sql and tbl_sql[0]:
        for m in re.finditer(r"UNIQUE\s*\(([^)]*)\)", tbl_sql[0], re.IGNORECASE):
            unique_col_sets.append({
                c.strip().strip('"').strip("`").lower()
                for c in m.group(1).split(",")
            })
    idx_rows = (
        await session.execute(sa.text(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='model_price_cards'"
        ))
    ).fetchall()
    for r in idx_rows:
        sql = r[0] or ""
        if "UNIQUE" not in sql.upper():
            continue
        # ⚠️ 独立索引的列在 `ON <表名> (cols)` 部分，**不在** `UNIQUE (...)` 部分
        # （`CREATE UNIQUE INDEX x ON t (a, b)`）⇒ 用错正则会**漏判**。
        m = re.search(r"ON\s+[^\s(]+\s*\(([^)]*)\)", sql, re.IGNORECASE)
        if m:
            unique_col_sets.append({
                c.strip().strip('"').strip("`").lower()
                for c in m.group(1).split(",")
            })
    if unique_col_sets and not any("unit" in cols for cols in unique_col_sets):
        problems.append(
            "model_price_cards 的唯一约束未含 `unit` 维度"
            "（旧 schema 漏列 ⇒ LLM 的 in/out/cache 三张卡存不下）"
        )
    return problems


async def seed(dry_run: bool, check_only: bool) -> int:
    data = load_seed()
    priced = data.get("priced", [])
    pending = data.get("pending", [])
    if not priced:
        print("❌ 种子文件里没有任何 priced 条目 —— 拒绝执行（空种子会让人误以为已灌）")
        return 2

    # ⚠️ **0 价卡必须在写库前拦住**（fail-closed）。
    # 0 价卡会被回算静默命中 ⇒ 成本算成 0 ⇒ 既不告警、又被当成「免费」
    # ⇒ 成本统计系统性偏低且无信号。口径原文：绝不插 unit_price_micros=0 的行。
    # ⇒ 三种模式都查（`--check` / `--dry-run` 也要能看出种子文件本身有问题）。
    zero_priced = zero_price_ids(priced)
    if zero_priced:
        print("❌ 种子文件里存在 0 价（或非整数）条目 —— 拒绝执行：")
        for cid in zero_priced:
            print(f"    - {cid}")
        print("   0 价卡会被回算静默命中（成本算成 0、不告警），请改成真实单价或移进 pending。")
        return 2

    read_only = dry_run or check_only
    # ⚠️ **先探测存量旧 schema**（只读探测，不改任何东西）：
    #   本 PR 改了列名（分 → 微元）与唯一约束（加 `unit`），而 SQLite 的 `create_all`
    #   **不改已有表** ⇒ 跑过 #4322 的存量库上灌种子会直接 `OperationalError`。
    #   ⇒ 真灌模式 **fail-closed 拒绝**并给人工修复指引（不自动重建表：改唯一约束
    #   在 SQLite 上只能重建表，而仓内既有迁移全是「加列」、无表重建先例 ⇒ 不可逆）。
    async with async_session() as probe:
        has_table = await _table_exists(probe, "model_price_cards")
        legacy = await detect_legacy_schema(probe)
    if legacy:
        for line in legacy:
            print(f"⚠️ 存量旧 schema：{line}")
        if not read_only:
            print("❌ 拒绝执行（fail-closed）：本库的表结构还是「分」口径的旧 schema，")
            print("   直接灌会撞 `no such column: model_price_cards.unit_price_micros`。")
            print()
            print("   人工修复指引：")
            print("     ① 列改名（SQLite 3.25+ 支持 RENAME COLUMN）：")
            print("        ALTER TABLE model_price_cards RENAME COLUMN unit_price_cents TO unit_price_micros;")
            print("        ALTER TABLE credit_price_config RENAME COLUMN credit_unit_price_cents TO credit_unit_price_micros;")
            print("     ② 唯一约束含 `unit` 维度：SQLite **不能**给已有表加 UNIQUE ⇒ 需重建表")
            print("        （CREATE TABLE new + INSERT SELECT 搬数据 + DROP old + RENAME new）")
            print("     —— 这一步会动数据，故本脚本不自动做。")
            return 2

    if read_only:
        # ⚠️ **只读模式不调 `init_db()`**：它是 DDL 写（建库文件 + create_all 建 3 张表），
        # 而 `--check` / `--dry-run` 的承诺是「只报差异 / 未写库」。
        # 早期版本三种模式都调它 ⇒ 在 OPS_DB_PATH 配错的机器上跑 --check 会静默新建一个空库
        # 并回答「5 条待插入」⇒ 对真实库给出错误的「是否已灌过」结论。
        # ⇒ 这里改成只读探测：表不存在 ⇒ 视为「没灌过」，全部记为待插入，且不建任何表。
        # （SQLite 连接本身可能创建 0 字节空库文件；那不含任何表，结论仍然正确。）
        async with async_session() as probe:
            has_table = await _table_exists(probe, "model_price_cards")
        if not has_table:
            print(f"ℹ️ 库里还没有 {ModelPriceCard.__tablename__} 表 ⇒ **未灌过**（不建表、不写库）")
            for c in priced:
                print(f"  + 待插入 {c['id']:32s} {c['unit']:22s} {c['unit_price_micros']:>10d} 微元")
            print()
            print(f"priced  {len(priced):>3d} 条 ⇒ 待插入 {len(priced)} / 跳过 0 / 冲突 0")
            print(f"pending {len(pending):>3d} 条 ⇒ **不入库**（待用户确认，缺价必须告警）")
            print()
            print("CHECK-ONLY：未写库" if check_only else "DRY-RUN：未写库")
            return 0
    else:
        # ⚠️ 真灌时才建表（`init_db()` 只做 `create_all`，幂等、不写任何数据）。
        await init_db()

    inserted, skipped, conflicts = 0, 0, 0
    async with async_session() as session:
        for card in priced:
            existing = await session.get(ModelPriceCard, card["id"])
            if existing is None:
                if not dry_run and not check_only:
                    session.add(ModelPriceCard(**card))
                inserted += 1
                print(f"  + 插入 {card['id']:32s} {card['unit']:22s} {card['unit_price_micros']:>10d} 微元")
                continue
            diffs = [
                f"{f}: {getattr(existing, f)!r} → {card[f]!r}"
                for f in IDENTITY_FIELDS
                if getattr(existing, f) != card[f]
            ]
            if diffs:
                conflicts += 1
                print(f"  ! 冲突 {card['id']:32s} 已存在但内容不同 —— **不覆盖**")
                for d in diffs:
                    print(f"      {d}")
                print(f"      改价请走：插新行 + 给旧行补 effective_to（禁 UPDATE 单价）")
            else:
                skipped += 1
                print(f"  = 跳过 {card['id']:32s} 已存在且一致")

        if not dry_run and not check_only:
            await session.commit()

    print()
    print(f"priced  {len(priced):>3d} 条 ⇒ 插入 {inserted} / 跳过 {skipped} / 冲突 {conflicts}")
    print(f"pending {len(pending):>3d} 条 ⇒ **不入库**（待用户确认，缺价必须告警）")
    if pending:
        print("  待确认清单（provider / 类别 / 缺什么）：")
        for p in pending:
            print(f"    - {p['provider_id']:22s} {p['action_type']:8s} {p.get('status', '待确认')}"
                  f" — {p.get('missing', '')[:80]}")
    if conflicts:
        print()
        print(f"❌ {conflicts} 条与库内已有卡冲突 —— **未覆盖任何单价**（请按版本化改价流程处理）")
        return 1
    if check_only:
        print()
        print("CHECK-ONLY：未写库")
    elif dry_run:
        print()
        print("DRY-RUN：未写库")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="灌入模型价格卡种子（只插不改价）")
    ap.add_argument("--dry-run", action="store_true", help="只报告不写库")
    ap.add_argument("--check", action="store_true", help="只报差异（判断是否已灌过）")
    args = ap.parse_args()
    return asyncio.run(seed(args.dry_run, args.check))


if __name__ == "__main__":
    raise SystemExit(main())
