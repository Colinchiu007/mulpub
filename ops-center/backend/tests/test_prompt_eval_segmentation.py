"""分句一致性测试：Python 实现 vs esbuild 打包的桌面端 text-segmentation.ts（node 执行）。"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import prompt_eval_segmentation as seg  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "segmentation-ref.mjs")

CORPUS = [
    ("她点燃了柴火，架上铁锅。热气腾腾，香味飘散。", 20, 8, 15),
    ("在一个宁静的村庄里，有一位老妇人正在做饭。她点燃了柴火，架上铁锅。锅里的水慢慢沸腾，蒸汽升腾。", 20, 8, 15),
    ("清晨的阳光洒在庭院。老人推开门，走向菜园。他摘下一把青菜，准备今天的午饭。", 15, 8, 15),
    ("她沿着小路走着，穿过田野，越过小桥。远处传来钟声，教堂的尖顶在暮色中若隐若现。她加快了脚步。", 20, 8, 15),
    # 边界：target 低于 TS 下限 10 → 钳制到 10（calculateTargetWords）
    ("一。一。一。一。一。", 8, 8, 15),
    # 边界：整段无句末标点且超 200 字 → 按 200 字强制分段（maxSentenceLength）
    ("啊，" * 220, 20, 8, 15),
    # 边界：顿号枚举 → 切分点枚举位移（applyEnumerationShift）
    ("她买了苹果、香蕉、橘子、葡萄和西瓜，慢慢走回家。", 20, 8, 15),
    # 边界：target 1（下界）与 200（上界）
    ("今天天气很好。我们一起去公园。", 1, 8, 15),
    ("她点燃了柴火，架上铁锅。热气腾腾，香味飘散。她沿着小路走到院子里。", 200, 8, 15),
]


def _ts_ref(fn, text, **kw):
    code = (
        "import('file:///" + FIXTURE.replace("\\", "/") + "').then(m=>{"
        "const text=process.argv[1];"
        "let out;"
        "if('splitTextToScenes'==='%s'){out=m.splitTextToScenes(text,{config:{scene:{...m.DEFAULT_CONFIG.scene,targetCharsPerScene:Number(process.argv[2])}}});}"
        "else if('splitTextToSubtitles'==='%s'){out=m.splitTextToSubtitles(text,{});}"
        "else {throw new Error('unknown fn');}"
        "console.log(JSON.stringify(out));"
        "}).catch(e=>{console.error('ERR',e.message);process.exit(1)})"
    ) % (fn, fn)
    res = subprocess.run(["node", "-e", code, text, str(kw.get("targetCharsPerScene", 20))],
                         capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise RuntimeError(f"TS ref failed: {res.stderr}")
    return json.loads(res.stdout.strip())


@pytest.mark.parametrize("text,target,sub_min,sub_max", CORPUS)
def test_scenes_consistent_with_ts(text, target, sub_min, sub_max):
    ts = _ts_ref("splitTextToScenes", text, targetCharsPerScene=target)
    py = seg.split_to_scenes(text, target_chars_per_scene=target)
    assert py == ts, f"scenes mismatch\npy={py}\nts={ts}"


@pytest.mark.parametrize("text,target,sub_min,sub_max", CORPUS)
def test_subtitles_consistent_with_ts(text, target, sub_min, sub_max):
    ts = _ts_ref("splitTextToSubtitles", text)
    py = seg.split_to_subtitles(text, sub_min, sub_max)
    assert py == ts, f"subtitle mismatch\npy={py}\nts={ts}"


def test_timeline_proportional():
    text = "她点燃了柴火，架上铁锅。热气腾腾。"
    tl = seg.build_subtitle_timeline(text, 12.0)
    assert tl and abs(tl[-1]["endTime"] - 12.0) < 0.01
    assert all(b["startTime"] <= b["endTime"] for b in tl)
    assert all(b["text"] for b in tl)


def test_scene_config_validation():
    assert seg.normalize_scene_config({})["target_chars_per_scene"] == 20
    with pytest.raises(ValueError):
        seg.normalize_scene_config({"target_chars_per_scene": 0})
    with pytest.raises(ValueError):
        seg.normalize_scene_config({"target_chars_per_scene": 201})
    with pytest.raises(ValueError):
        seg.normalize_scene_config({"subtitle_min_chars": 15, "subtitle_max_chars": 10})
    with pytest.raises(ValueError):
        seg.normalize_scene_config({"subtitle_timing": "foo"})


# ---------------------------------------------------------------------------
# 能力声明一致性锁（2026-10-19）
#
# 动因：本服务此前自称「完整移植桌面端 text-segmentation.ts」，实际缺整个词边界子系统。
# 这种不准确最坏的后果不是文档难看，而是**让人以为这里有一层保护**，于是真正的跨实现
# 对账缺口不会被补。所以把「声明了什么 / 没声明什么」变成判据：
#   1) 两个常量必须存在且不重叠；
#   2) 未移植清单必须点名词边界子系统（漏点名 = 悄悄扩大声称的覆盖面）；
#   3) 源码里必须确实没有那些实现（否则声明落后于实现，同样会误导）。
# 若将来真的移植了词边界子系统：把实现加上、把条目从 NOT_PORTED_SURFACE 移到
# PORTED_SURFACE、并**扩大本文件的对照语料**（现有语料只有标点丰富句式，
# 覆盖不到无标点长块），三件事一起做，否则这条锁会红。
# ---------------------------------------------------------------------------

_SERVICE_SRC = Path(__file__).resolve().parent.parent / "services" / "prompt_eval_segmentation.py"

# 只扫描「代码形态」的标识，不扫描散文：模块 docstring 里刻意写了这些名字用于说明缺口，
# 用裸词匹配会把说明本身判成实现（那是把判据写成永假/永真两端的经典形态）。
_FORBIDDEN_CODE_MARKERS = (
    "def _word_safe_split",
    "def _is_good_cut",
    "def _protected_phrase",
    "def _is_phrase_boundary",
    "WORD_GOOD_",
    "WORD_NO_CUT_",
    "PHRASE_BOUNDARY_",
)


def test_ported_surface_declarations_exist_and_disjoint():
    assert seg.PORTED_SURFACE, "PORTED_SURFACE 不能为空"
    assert seg.NOT_PORTED_SURFACE, "NOT_PORTED_SURFACE 不能为空"
    overlap = set(seg.PORTED_SURFACE) & set(seg.NOT_PORTED_SURFACE)
    assert not overlap, f"同一条能力不能既算已移植又算未移植：{sorted(overlap)}"


def test_not_ported_surface_names_the_word_boundary_gap():
    declared = set(seg.NOT_PORTED_SURFACE)
    for required in (
        "word_good_lead",
        "word_good_tail",
        "word_semantic_lead",
        "word_no_cut_bigrams",
        "phrase_boundary_v1_3",
    ):
        assert required in declared, (
            f"未移植清单缺少 {required!r}。本服务确实没有实现桌面端的词边界子系统与 v1.3 "
            f"短语边界；把它从清单里拿掉等于悄悄声称覆盖了它。"
        )


def test_declared_gap_matches_source():
    """声明说没移植 ⇒ 源码里必须真的没有这些实现（反向也要成立）。"""
    src = _SERVICE_SRC.read_text(encoding="utf-8")
    found = [m for m in _FORBIDDEN_CODE_MARKERS if m in src]
    assert not found, (
        "源码里出现了声明为「未移植」的实现标识："
        f"{found}。若确实移植了，请把条目移进 PORTED_SURFACE 并扩大对照语料；"
        "若只是随手加了个同名 helper，请改名以免与声明冲突。"
    )
