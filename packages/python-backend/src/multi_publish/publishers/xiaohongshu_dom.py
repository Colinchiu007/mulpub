"""小红书 DOM 轨的底层控件操作（纯函数，无状态）。

从 xiaohongshu.py 拆出，满足新代码单文件行数门禁（.github/scripts/check-max-lines.js）。

为什么是**纯函数**而不是第二个 mixin：本轨的关键常量（风控选择器、风控词表、上传
等待上限）必须在发布器模块命名空间里读取，然后作为参数传进来——这样
``monkeypatch.setattr(xhs, "RISK_OVERLAY_SELECTOR", ...)`` 才会真正改变行为。若把
这些逻辑做成 mixin 并让它自己 import 常量，patch 发布器模块的同名常量会静默失效：
能力看起来还在，实际已不响应任何配置。这正是 rpa-xiaohongshu-dom-hardening 要防的
"静默失效"类，不能由拆分本身重新引入。
"""

from __future__ import annotations

import asyncio
import re

from loguru import logger

from multi_publish.publishers.base import wait_until


async def visible_texts(page, sel: str, *, limit: int) -> list[str]:
    """该选择器命中的**可见**元素文案（空文案不保留），最多读取 limit 个元素。

    上限是硬需要：`[class*="modal"]` 这类宿主选择器在 SPA 模板页可命中整页元素，
    逐元素 inner_text 会把发布链路拖死。真实风控层是页面上最靠前的可见容器之一。

    本函数只服务**文案轨**；"有可见容器"这种存在性判定请用 `visible_count`——
    把空串留在返回列表里靠列表真值判风控，是过滤空串就会静默漏判的偶然耦合。
=======
    """该选择器命中的**可见**元素文案（空文案不保留），最多读取 limit 个元素。

    上限是硬需要：`[class*="modal"]` 这类宿主选择器在 SPA 模板页可命中整页元素，
    逐元素 inner_text 会把发布链路拖死。真实风控层是页面上最靠前的可见容器之一。

    本函数只服务**文案轨**；"有可见容器"这种存在性判定请用 `visible_count`——
    把空串留在返回列表里靠列表真值判风控，是过滤空串就会静默漏判的偶然耦合。
>>>>>>> 2d4d94b72 (fix(xhs-dom): CCG 深评 i3/i4 落地——日志锚点改机器可读键、风控占位轨改存在性判定)
    """
    try:
        loc = page.locator(sel)
        total = min(await loc.count(), limit)
    except Exception:
        return []
    out: list[str] = []
    for i in range(total):
        item = loc.nth(i)
        try:
            if not await item.is_visible():
                continue
            text = (await item.inner_text()) or ""
            if text:
                out.append(text)
=======
>>>>>>> 2d4d94b72 (fix(xhs-dom): CCG 深评 i3/i4 落地——日志锚点改机器可读键、风控占位轨改存在性判定)
        except Exception:
            continue
    return out


async def visible_count(page, sel: str, *, limit: int) -> int:
    """该选择器命中的**可见**元素个数（最多探测 limit 个，读文案不需要）。"""
    try:
        loc = page.locator(sel)
        total = min(await loc.count(), limit)
    except Exception:
        return 0
    n = 0
    for i in range(total):
        try:
            if await loc.nth(i).is_visible():
                n += 1
        except Exception:
            continue
    return n


=======
>>>>>>> 2d4d94b72 (fix(xhs-dom): CCG 深评 i3/i4 落地——日志锚点改机器可读键、风控占位轨改存在性判定)
async def risk_present(page, *, overlay_selector: str, hosts: list[str], pattern: str, limit: int) -> bool:
    """风控判定双轨：占位选择器（Tier2 待回填）+ 浮层内可见文案（本仓已实战口径）。

    两轨都要求元素**可见**：SPA 常驻的隐藏 modal 模板自带默认风控文案，
    不可见也当风控就会每次发布误判并中止草稿保存——误判比漏判更有害。

    占位轨只看存在性，不看文案：回填后的目标是纯图形/拼图验证层，本来就无可匹配文案。
    代价是这条轨的准确性完全押在选择器精度上，回填必须由活体取证把关。
    """
    if overlay_selector and await visible_count(page, overlay_selector, limit=limit) > 0:
=======

    占位轨只看存在性，不看文案：回填后的目标是纯图形/拼图验证层，本来就无可匹配文案。
    代价是这条轨的准确性完全押在选择器精度上，回填必须由活体取证把关。
    """
    if overlay_selector and await visible_count(page, overlay_selector, limit=limit) > 0:
>>>>>>> 2d4d94b72 (fix(xhs-dom): CCG 深评 i3/i4 落地——日志锚点改机器可读键、风控占位轨改存在性判定)
        return True
    for host in hosts:
        for text in await visible_texts(page, host, limit=limit):
            if re.search(pattern, text, re.I):
                logger.warning(f"[小红书] 可见浮层文案命中风控口径: {text[:60]!r}")
                return True
    return False


async def resolve_visible(page, candidates: list[str]):
    """按候选回退链解析首个可见 locator，返回 (locator, selector) 或 (None, None)。"""
    for sel in candidates:
        try:
            loc = page.locator(sel).first
            if await loc.is_visible():
                return loc, sel
        except Exception:
            continue
    return None, None


async def await_control(page, candidates: list[str], *, key: str, label: str,
                        timeout_s: float, interval_s: float):
    """轮询候选链中首个可见控件，返回 locator 或 None；超时留痕但不臆断失败。

    返回 None 只表示"没等到"，是否中止由调用方决定（媒体上传必须中止，编辑器就绪可降级）。
    留痕同时带 `key`（机器可读的控件名，改名/换文案不会变）和 `label`（给用户看的措辞）：
    回归测试钉 `key` 而不是 `label`，否则措辞一改就假红。

    轮询命中后**直接返回轮询中拿到的那个 locator**，不再二次解析：命中与二次解析之间
    控件被移除或隐藏会返回 None，上传路径于是把"刚可见又消失"的瞬时抖动当成
    "控件从未挂载"报 CODE_UPLOAD_FAILED，属于错误归因。locator 本身是惰性的，
    元素真消失了会在执行动作时抛错，由调用方的 except 给出准确文案。
    """
    hit = None

    async def visible() -> bool:
        nonlocal hit
        loc, _ = await resolve_visible(page, candidates)
        if loc is None:
            return False
        hit = loc
        return True

    if not await wait_until(visible, timeout_s=timeout_s, interval_s=interval_s):
        logger.warning(f"[{key}] {label}在 {timeout_s}s 内未就绪（站点结构变化或首屏未完成）")
        return None
    return hit
    """轮询候选链中首个可见控件，返回 locator 或 None；超时留痕但不臆断失败。

    返回 None 只表示"没等到"，是否中止由调用方决定（媒体上传必须中止，编辑器就绪可降级）。
    留痕同时带 `key`（机器可读的控件名，改名/换文案不会变）和 `label`（给用户看的措辞）：
    回归测试钉 `key` 而不是 `label`，否则措辞一改就假红。
    """
    hit = None

    async def visible() -> bool:
        nonlocal hit
        loc, _ = await resolve_visible(page, candidates)
        if loc is None:
            return False
        hit = loc
        return True

    if not await wait_until(visible, timeout_s=timeout_s, interval_s=interval_s):
        logger.warning(f"[{key}] {label}在 {timeout_s}s 内未就绪（站点结构变化或首屏未完成）")
        return None
    loc, _ = await resolve_visible(page, candidates)
    return loc
=======
    return hit
>>>>>>> 44799e73f (fix(xhs-rpa): 采纳第二轮 CCG 深评两项裁决，修正等待容忍度与控件抖动误判)


async def set_field(page, candidates: list[str], text: str, *, label: str) -> bool:
    """标题/正文填写：优先原生 fill，contenteditable 回退 evaluate + dispatch 事件。"""
    loc, _ = await resolve_visible(page, candidates)
    if loc is None:
        return False
    try:
        await loc.click()
    except Exception:
        pass
    try:
        await loc.fill(text)
        return True
    except Exception:
        try:
            await loc.evaluate(
                "(el, t) => { el.textContent = t;"
                " el.dispatchEvent(new Event('input', { bubbles: true }));"
                " el.dispatchEvent(new Event('change', { bubbles: true })); }",
                text,
            )
            return True
        except Exception as e:
            logger.warning(f"[小红书] 字段 {label} 填写失败: {e}")
            return False


async def add_tags(page, *, tag_candidates: list[str], suggestion_candidates: list[str], tags: list[str]) -> None:
    """逐个 type + 尽力选下拉首个候选（修覆盖式 fill 只留最后一个）。"""
    loc, _ = await resolve_visible(page, tag_candidates)
    if loc is None:
        logger.debug("未找到标签输入框，跳过标签")
        return
    for tag in tags[:5]:
        try:
            await loc.click()
            await loc.type(tag, delay=50)
            sugg, _ = await resolve_visible(page, suggestion_candidates)
            if sugg is not None:
                await sugg.click()
            else:
                await loc.press("Enter")
        except Exception as e:
            logger.debug(f"[小红书] 标签 {tag} 添加失败（不影响草稿保存）: {e}")


async def set_cover(page, *, upload_candidates: list[str], input_candidates: list[str], cover_path: str) -> None:
    try:
        btn, _ = await resolve_visible(page, upload_candidates)
        if btn is None:
            return
        await btn.click()
        await asyncio.sleep(2)
        inp, _ = await resolve_visible(page, input_candidates)
        if inp is not None:
            await inp.set_input_files(cover_path)
    except Exception as e:
        logger.warning(f"封面上传失败（不影响发布）: {e}")
