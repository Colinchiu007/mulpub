# -*- coding: utf-8 -*-
"""test_fetch_hell_grind_kit - L1 全量导入器（--full）单测（film-full-corpus-production 任务组 2，TDD RED 起点）

覆盖契约（design.md D3/D4/D7、tasks 2.1-2.4）：
  - prompt 规范化（trim + 折叠连续空白）与 SHA1 去重键
  - 同键末次 completed 且有 results 的 job 为采纳版；is_favourite 不被依赖
  - iterationCount / adoptedJobAt 统计
  - FILM_PROMPT_MAX_LEN=50000 超限拒绝（进 rejected 清单）
  - shot 扩展字段 durationSec/width/height/aspectRatio/model/resultUrl
  - film-manifest 写入 allowedHosts（resultUrl 域名清单）
  - --full 每场景全部唯一分镜；默认精选模式行为不变（向后兼容回归锚）
"""
import hashlib
import importlib.util
import json
import os

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "fetch_hell_grind_kit", os.path.join(_HERE, "fetch-hell-grind-kit.py")
)
fhg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fhg)

CDN_HOST = "d8j0ntlcm91z4.cloudfront.net"


def _job(jid, prompt, created_at, status="completed", model="seedance_2_0",
         duration=12, width=2016, height=864, aspect="21:9", favourite=False,
         with_results=True):
    results = {}
    if with_results and status == "completed":
        results = {
            "raw": {"url": "https://%s/ud/%s.mp4" % (CDN_HOST, jid), "thumbnail_url": "https://%s/ud/%s.webp" % (CDN_HOST, jid)},
            "min": {"url": "https://%s/ud/%s_min.mp4" % (CDN_HOST, jid)},
        }
    return {
        "id": jid,
        "status": status,
        "created_at": created_at,
        "is_favourite": favourite,
        "job_set_type": model,
        "params": {"prompt": prompt, "duration": duration, "width": width, "height": height, "aspect_ratio": aspect},
        "results": results,
    }


def _make_source(tmp_path, folders):
    """folders: [{name, id, jobs:[job...]}]；生成 source_dir（folder-tree.json + items/*.jsonl）"""
    items_dir = os.path.join(str(tmp_path), "items")
    os.makedirs(items_dir, exist_ok=True)
    children = []
    for f in folders:
        fid = f["id"]
        fname = f["name"]
        lines = [json.dumps({"type": "job", "job": j}, ensure_ascii=False) for j in f["jobs"]]
        path = os.path.join(items_dir, "%s_%s.jsonl" % (fid[:8], fhg.sanitize(fname)))
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        children.append({"id": fid, "name": fname, "count": len(f["jobs"]), "children": []})
    tree = {"id": "root", "name": "Hell Grind", "count": 0, "children": children}
    with open(os.path.join(str(tmp_path), "folder-tree.json"), "w", encoding="utf-8") as fh:
        json.dump(tree, fh, ensure_ascii=False)
    return tree


# ---------- D3：规范化与去重键 ----------

def test_normalize_prompt_trims_and_collapses_whitespace():
    assert fhg.normalize_prompt("  a\n\t b   c  ") == "a b c"
    assert fhg.normalize_prompt("a\r\n b") is not None


def test_prompt_key_is_sha1_of_normalized():
    key = fhg.prompt_key("  hello\n  world ")
    assert key == hashlib.sha1("hello world".encode("utf-8")).hexdigest()
    # 仅空白差异必须同键
    assert fhg.prompt_key("hello world") == key


# ---------- D3：采纳版启发式 ----------

def test_pick_adopted_last_completed_with_results_wins():
    jobs = [
        _job("j1", "p one", 100.0),                          # 早期完成
        _job("j2", "p one", 200.0, status="failed"),         # 失败，跳过
        _job("j3", "p one", 300.0),                          # 末次完成且有 results → 采纳
        _job("j4", "p one", 400.0, with_results=False),      # completed 但无 results → 不作采纳版
    ]
    adopted, iterations = fhg.pick_adopted_for_prompt(jobs)
    assert adopted["id"] == "j3"
    assert iterations == 3  # 该唯一 prompt 的 job 总数（含失败/无结果，供人工复核）


def test_is_favourite_is_not_depended_on():
    base = [_job("j1", "p", 100.0), _job("j2", "p", 200.0)]
    flipped = [dict(j, is_favourite=True) for j in [_job("j1", "p", 100.0), _job("j2", "p", 200.0)]]
    a1, n1 = fhg.pick_adopted_for_prompt(base)
    a2, n2 = fhg.pick_adopted_for_prompt(flipped)
    assert a1["id"] == a2["id"] == "j2"  # 无论 is_favourite 如何，末次 completed 胜出
    assert n1 == n2


def test_image_model_jobs_excluded_from_full_corpus():
    """唯一分镜口径 = 视频 job 的 prompt 去重；图像 job（nano_banana 等）不计。"""
    jobs = [
        _job("v1", "video prompt", 100.0, model="seedance_2_0"),
        _job("i1", "video prompt", 200.0, model="nano_banana_2"),  # 同 prompt 的图像 job
    ]
    adopted, iterations = fhg.pick_adopted_for_prompt(jobs)
    assert adopted["id"] == "v1"
    assert iterations == 1


def test_soul_cinematic_is_excluded_as_image_model():
    """soul_cinematic 命中 VIDEO_MODEL_HINT 但属图片模型（1.3 对账修正），必须排除。"""
    jobs = [_job("s1", "p", 100.0, model="soul_cinematic")]
    adopted, iterations = fhg.pick_adopted_for_prompt(jobs)
    assert adopted is None and iterations == 0


# ---------- --full 全量库构建 ----------

def test_full_mode_dedup_per_scene_and_fields(tmp_path):
    prompt_a = "EXACT 3 CHARACTERS — scene alpha"
    prompt_a_iter = "  EXACT 3 CHARACTERS — scene   alpha "  # 仅空白差异 → 同键
    prompt_b = "EXACT 2 CHARACTERS — scene beta"
    tree = _make_source(tmp_path, [{
        "name": "Scene 01",
        "id": "f0000001-1111-1111-1111-111111111111",
        "jobs": [
            _job("a1", prompt_a, 100.0, duration=10),
            _job("a2", prompt_a_iter, 200.0, duration=12),   # 采纳版（末次）
            _job("b1", prompt_b, 150.0, duration=15),
        ],
    }])
    shots, rejected = fhg.build_full_shot_library(str(tmp_path), tree)
    assert rejected == []
    assert len(shots) == 2
    sa = [s for s in shots if s["shotId"] == "a2"][0]
    assert sa["sceneId"] == "f0000001-1111-1111-1111-111111111111"
    assert sa["prompt"] == prompt_a_iter  # 原文逐字符保留（不做规范化写库）
    assert sa["iterationCount"] == 2
    assert sa["adoptedJobAt"] == 200.0
    assert sa["durationSec"] == 12
    assert sa["aspectRatio"] == "21:9"
    assert sa["width"] == 2016 and sa["height"] == 864
    assert sa["model"] == "seedance_2_0"
    assert sa["resultUrl"].startswith("https://%s/" % CDN_HOST)
    assert sa["refTokens"] == []


def test_full_mode_over_limit_rejected(tmp_path):
    big = "x" * (fhg.FILM_PROMPT_MAX_LEN + 1)
    tree = _make_source(tmp_path, [{
        "name": "Scene 02",
        "id": "f0000002-1111-1111-1111-111111111111",
        "jobs": [
            _job("ok1", "fine", 100.0),
            _job("bad1", big, 110.0),
        ],
    }])
    assert fhg.FILM_PROMPT_MAX_LEN == 50000
    shots, rejected = fhg.build_full_shot_library(str(tmp_path), tree)
    assert [s["shotId"] for s in shots] == ["ok1"]
    assert len(rejected) == 1
    assert rejected[0]["shotId"] == "bad1"
    assert "50000" in rejected[0]["reason"] or "超限" in rejected[0]["reason"]


def test_manifest_allowed_hosts_from_result_urls(tmp_path):
    tree = _make_source(tmp_path, [{
        "name": "Scene 03",
        "id": "f0000003-1111-1111-1111-111111111111",
        "jobs": [_job("h1", "p", 100.0)],
    }])
    shots, _ = fhg.build_full_shot_library(str(tmp_path), tree)
    manifest = fhg.build_manifest(tree)
    fhg.enrich_manifest_with_hosts(manifest, shots)
    assert manifest["allowedHosts"] == [CDN_HOST]


def test_dry_run_stats_counts(tmp_path):
    tree = _make_source(tmp_path, [{
        "name": "Scene 04",
        "id": "f0000004-1111-1111-1111-111111111111",
        "jobs": [
            _job("d1", "p one", 100.0),
            _job("d2", "p  one", 200.0),      # 同键迭代
            _job("d3", "x" * (fhg.FILM_PROMPT_MAX_LEN + 5), 300.0),
        ],
    }])
    stats = fhg.compute_full_stats(str(tmp_path), tree)
    assert stats["uniqueVideoPrompts"] == 2
    assert stats["adoptedShots"] == 1        # 超限的那键被拒绝
    assert stats["rejectedOverLimit"] == 1
    assert stats["totalVideoJobs"] == 3


# ---------- 回归锚：精选模式（默认）行为不变 ----------

def test_curated_pick_representative_unchanged():
    jobs = [
        _job("c1", "one", 100.0, model="seedance_2_0"),
        _job("c2", "two", 200.0, model="seedance_2_0"),
        _job("c3", "three", 300.0, status="failed"),
    ]
    rep = fhg.pick_representative(jobs)
    assert rep["id"] == "c2"  # 每文件夹末次完成，一条代表镜


def test_write_json_atomic(tmp_path):
    p = os.path.join(str(tmp_path), "out.json")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write("PRE-EXISTING")
    fhg.write_json_atomic(p, {"ok": True})
    assert os.path.exists(p)
    assert not os.path.exists(p + ".tmp")
    with open(p, encoding="utf-8") as fh:
        assert json.load(fh) == {"ok": True}
