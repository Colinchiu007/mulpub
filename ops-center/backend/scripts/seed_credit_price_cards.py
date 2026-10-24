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
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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


async def seed(dry_run: bool, check_only: bool) -> int:
    data = load_seed()
    priced = data.get("priced", [])
    pending = data.get("pending", [])
    if not priced:
        print("❌ 种子文件里没有任何 priced 条目 —— 拒绝执行（空种子会让人误以为已灌）")
        return 2

    # ⚠️ `init_db()` 只做 `create_all`（幂等、**不写任何数据**）⇒ 三种模式都调它。
    # 早期版本只在真灌时调 ⇒ `--check` / `--dry-run` 撞「no such table: model_price_cards」。
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
