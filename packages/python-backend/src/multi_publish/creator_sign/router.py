# -*- coding: utf-8 -*-
"""creator_sign 路由：/api/creator/sign/{douyin,xhs}（PRD §3/§6）。

安全边界：签名服务**只**对可信调用方（本机 Electron 主进程经 pythonBridge）
开放；输入只接受「待签名的查询串/URI + Cookie 摘要要素」，不接受任意代码。
Cookie 值**不落日志**（与 creator-credential 同一口径）。
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from multi_publish.creator_sign.abogus import generate_a_bogus

router = APIRouter(prefix="/api/creator/sign", tags=["creator-sign"])


class DouyinSignRequest(BaseModel):
    query_str: str
    user_agent: str


class DouyinSignResponse(BaseModel):
    a_bogus: str


class XhsSignRequest(BaseModel):
    uri: str
    a1: str = ""
    b1: str = ""
    payload: Optional[dict] = None
    method: str = "GET"


class XhsSignResponse(BaseModel):
    x_s: str
    x_t: str
    x_s_common: str
    x_b3_traceid: str


def _lazy_xhshow():
    """xhshow 是可选依赖（creator-sign extra）。缺包时给出可操作错误，而不是 500 栈。"""
    try:
        from xhshow import Xhshow  # noqa: PLC0415 - 延迟导入：缺依赖不应拖垮整个后端
        return Xhshow()
    except ImportError as exc:  # pragma: no cover - 依赖缺失分支
        # 不把 ImportError 原文（含路径信息）回显给调用方（QM-6 后端评审 I2）：
        # 响应只带可操作指引，原文进服务端日志。
        logger.warning("xhshow import failed: {}", exc)
        raise HTTPException(
            status_code=503,
            detail="creator sign dependency missing. Run: pip install 'multi-publish-backend[creator-sign]'",
        ) from exc


@router.post("/douyin", response_model=DouyinSignResponse)
def sign_douyin(req: DouyinSignRequest) -> DouyinSignResponse:
    if not req.query_str or not req.user_agent:
        raise HTTPException(status_code=400, detail="SIGN_INVALID_INPUT: query_str and user_agent are required")
    return DouyinSignResponse(a_bogus=generate_a_bogus(req.query_str, req.user_agent))


@router.post("/xhs", response_model=XhsSignResponse)
def sign_xhs(req: XhsSignRequest) -> XhsSignResponse:
    if not req.uri:
        raise HTTPException(status_code=400, detail="SIGN_INVALID_INPUT: uri is required")
    if not req.a1:
        # a1 是 x-s-common 的必要要素（来自用户会话 Cookie）；缺失就如实报错，
        # 不接受「整串 Cookie 兜底」——那会扩大明文流动面（QM-6 I1）。
        raise HTTPException(status_code=400, detail="SIGN_A1_MISSING: a1 cookie is required (sign in to Xiaohongshu in Accounts first)")
    client = _lazy_xhshow()
    if req.method.upper() == "POST":
        headers = client.sign_headers_post(uri=req.uri, cookies=req.a1, payload=req.payload or {})
    else:
        headers = client.sign_headers_get(uri=req.uri, cookies=req.a1, params=req.payload or {})
    return XhsSignResponse(
        x_s=str(headers.get("x-s", "")),
        x_t=str(headers.get("x-t", "")),
        x_s_common=str(headers.get("x-s-common", "")),
        x_b3_traceid=str(headers.get("x-b3-traceid", "")),
    )
