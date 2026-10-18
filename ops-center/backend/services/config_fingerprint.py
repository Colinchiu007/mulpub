"""运行时配置内容指纹（2026-10-08 ops-center-resilience）

为什么单独成模块：`runtime_service.py` 已因本 change 逼近 max-lines 门禁（CI 按 LF 计 500 行硬上限），
而 hash 计算 + 数值校验是一个**边界清晰、可独立测试**的纯函数单元，留在 service 里只会让它继续膨胀。

契约单一真源：`openspec/changes/ops-center-resilience/design.md` §1。
桌面端对等实现见 `apps/desktop/electron/services/ops-runtime-snapshot.js`
（`computeConfigHash` / `assertNoFractionalNumbers`），两端固定向量互相锚定。
"""
import hashlib
import math

from models import RuntimeConfigVersion  # noqa: F401  （保持与 models 的导入时序一致）

#: 参与内容指纹计算的 14 个下发数据块。新增下发块时 MUST 同步加入此处，
#: 否则该块变更不会体现在 config_hash 上 → 客户端不会收到 ACK → 看板显示「未生效」。
#: ⚠️ 这份白名单与桌面端 `ops-runtime-snapshot.js` 的 `RUNTIME_BLOCKS` **必须成对改**：
#: 只改一端 ⇒ 两端 canonical 输入不同 ⇒ config_hash 不同 ⇒ 客户端 ACK 永不被认可。
RUNTIME_BLOCKS = (
    "announcements",
    "update_policy",
    "content_policy",
    "feature_flags",
    "platform_defs",
    "content_templates",
    "keyword_watchlist",
    "rewrite_strategies",
    "rewrite_hard_constraints",
    "rewrite_ai_taste_map",
    "pipelineOptions",
    "appMenu",
    "contentCategories",
    "storyTextLimit",
)

#: JS 侧 Number 能精确表示的最大整数。超过则 JS 丢精度、Python 不丢 ⇒ 两端 hash 必不同。
MAX_SAFE_INTEGER = 9007199254740992


def compute_config_hash(payload: dict, canonical_json) -> str:
    """14 个下发数据块 canonical JSON 的 SHA-256 前 16 位。

    参数 ``canonical_json`` 由调用方注入（复用 runtime_service 那个与桌面端逐字节对齐的
    实现，避免在这里复制第二份序列化器 —— 那正是两端漂移的来源）。

    四条不可违背的约束（design.md §1.2）：
    1. 只取 RUNTIME_BLOCKS 白名单——synced_at 每次请求都变，纳入则 hash 永远变、
       客户端每次都发 ACK，直接变成推送地狱。
    2. 缺失键以 ``None`` 参与而非跳过——否则「删掉一个数据块」与「该键本来不存在」
       产生同一个 hash，运营删除配置会静默不升版。
    3. 不得纳入 config_version / config_hash / signature（自指）。
    4. **白名单内每个块的载荷本身也不得含「每请求变化的时钟产物」**（synced_at /
       syncedAt / 任何 `_now()` 产物）——只把顶层 synced_at 挡在白名单外是不够的：
       2026-10-18 之前 appMenu 与 contentCategories 两个块各自返回了块内 synced_at，
       注释第 1 条明明写对了，实现却对不上，实测后果是「内容没变 hash 也变」：
       每次 bootstrap 的 config_hash 都不同、config_version 每次 +1、
       生效看板「已确认率」永远上不去、RuntimeConfigVersion 表随请求数无限增长。
       回归锁：`ops-center/backend/tests/test_config_hash_stability.py`
       （同一库连构两次 bootstrap，hash 必须逐字相等）。

       ⚠️ **只禁「时钟产物」，不禁「内容属性」**：`updated_at` / `created_at` 属于内容属性
       ——运营改了这条配置，它跟着变，hash 随之变化是**正确**行为（否则「内容变更升版」
       这条语义会被一起判死）。区别在于：synced_at 是每次请求现生成的、与内容无关；
       updated_at 记录的是「这条内容最后一次被改」。判据因此分两层：
       不变量测试抓「值在变」，静态锁只查 synced_at 键、刻意不查 updated_at。

    第四道锁：**数值必须两端序列化一致**，否则 raise ValueError。
    """
    subset = {name: (payload.get(name) if isinstance(payload, dict) else None) for name in RUNTIME_BLOCKS}
    assert_integer_numbers(subset)
    return hashlib.sha256(canonical_json(subset).encode("utf-8")).hexdigest()[:16]


def assert_integer_numbers(value, path: str = "") -> None:
    """递归校验：非有限数与「序列化文本与 JS 不一致」的 number 一律 raise（fail-closed）。

    错误信息必须带**完整路径**与**实际值**：bootstrap 数据来自 39 个运营页面，
    只说「含非整数」等于让人自己猜是哪个页面的哪个字段。
    """
    if isinstance(value, bool):  # bool 是 int 的子类，先摘出去
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(
                f"config_hash 输入含非有限数 @ {path or '<root>'}：{value!r}（跨端序列化不一致，必须先清理）"
            )
        if not _number_serializes_like_js(value):
            raise ValueError(
                f"config_hash 输入含跨端不一致的数值 @ {path or '<root>'}：{value!r}"
                "（Python 与 JS 序列化文本不同，会导致两端 config_hash 不一致）"
            )
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError(
                f"config_hash 输入超出双精度安全整数范围 @ {path or '<root>'}：{value!r}"
                "（JS 侧 Number 会丢精度，两端 hash 不一致）"
            )
        return
    if isinstance(value, dict):
        for key in value:
            assert_integer_numbers(value[key], f"{path}.{key}" if path else str(key))
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            assert_integer_numbers(item, f"{path}[{index}]")


def _number_serializes_like_js(value: float) -> bool:
    """该 float 的 JSON 文本是否与 JS 端对同一数值的输出逐字相同。

    JS 侧走 ``JSON.stringify(number)``：整数值的 float 一律输出不带小数点、不带指数的十进制
    整数（1.0→"1"、1e16→"10000000000000000"、-0.0→"0"）；非整数可能走指数形式（1.5e-7→"1.5e-7"）。
    Python 侧 ``json.dumps`` 保留 ``1.0`` / ``1e+16`` / ``1.5e-07`` / ``-0.0`` 这类写法。

    判据刻意不是 ``value.is_integer()`` —— `1e16.is_integer()` 与 `(-0.0).is_integer()`
    **都是 True**（值确实是整数），但序列化文本仍不同。
    """
    if not float(value).is_integer():
        return False  # 非整数一律拒绝：JS 可能用指数形式，两端文本必不同
    as_int = int(value)
    if as_int == 0 and math.copysign(1.0, value) < 0:
        return False  # -0.0：Python 写 "-0.0"，JS 写 "0"
    return float(as_int) == value and abs(as_int) <= MAX_SAFE_INTEGER