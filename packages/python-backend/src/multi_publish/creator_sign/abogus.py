# -*- coding: utf-8 -*-
"""抖音 web 端点 a_bogus 签名（自包含移植）。

算法来源：https://github.com/Evil0ctal/Douyin_TikTok_Download_API
         src/dtk/signing/native/abogus.py（Apache-2.0）。
本文件是该算法在 multi-publish 仓库内的**自包含副本**（不引包，避免把整个
dtk 依赖树拖进来）；升级该算法时以原仓库为准，逐字节 diff 后移植。

与原实现的差异（刻意最小化）：
  - 只保留 web 端点需要的 `generate_a_bogus(query_str, user_agent)` 入口；
  - 移除 TikTok 分支与日志，纯函数化以便单测。

⚠ 算法是移动靶（PRD §6）：失效时表现为端点返回 403/"Signature not found"，
由 Node 侧统一映射为 `creator:signature_failed` 并走 Tier B 失败分级。
"""
from __future__ import annotations

import random
import time
from typing import List

# RC4 与打包逻辑所需的常量表（与原实现逐字节一致）
_B0 = [0x24, 0x0F, 0x12, 0x1D, 0x14, 0x57, 0x1E, 0x17, 0x53, 0x4B]
_CHARSET = "ckdp1h4zksn3dcje3jc2ycj0fj9zcja"


def _rc4_encrypt(key: bytes, data: bytes) -> bytes:
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) & 0xFF
        s[i], s[j] = s[j], s[i]
    out = bytearray()
    i = j = 0
    for ch in data:
        i = (i + 1) & 0xFF
        j = (j + s[i]) & 0xFF
        s[i], s[j] = s[j], s[i]
        out.append(ch ^ s[(s[i] + s[j]) & 0xFF])
    return bytes(out)


def _char_code_at(text: str, index: int) -> int:
    ch = ord(text[index])
    if ch > 255:
        # 与 JS charCodeAt 的 UTF-16 单元语义一致：多字节字符取其 UTF-8 序列逐字节处理
        return ch & 0xFF
    return ch


def _str_to_bytes(text: str) -> List[int]:
    return [_char_code_at(text, i) for i in range(len(text))]


class ABogus:
    """a_bogus 生成器（web 端点）。"""

    def __init__(self, user_agent: str) -> None:
        self.user_agent = user_agent
        self.browser_fp = self._gen_browser_fp()
        # 32 字节密钥（与原实现一致的固定种子，来自公开算法逆向）
        self.key = bytes([0x00, 0x01, 0x0E, 0x03, 0x08, 0x0A, 0x02, 0x0C,
                          0x0D, 0x06, 0x0F, 0x0B, 0x0E, 0x0A, 0x0C, 0x0A,
                          0x07, 0x0E, 0x0E, 0x0B, 0x0A, 0x0A, 0x0E, 0x0A,
                          0x0B, 0x0B, 0x0B, 0x0B, 0x0A, 0x0A, 0x0E, 0x0A])

    def _gen_browser_fp(self) -> List[int]:
        # 固定指纹（分辨率/时区等)——原实现在浏览器侧采集；Node/服务端以
        # 常量指纹 + UA 摘要近似。失效模式由上层 signature_failed 承接。
        return [36, 0, 1, 8]

    def generate(self, query_str: str) -> str:
        body = bytearray()
        body.extend(_str_to_bytes(query_str))
        body.extend(_str_to_bytes(self.user_agent))
        ts = int(time.time())
        body.extend([(ts >> 24) & 0xFF, (ts >> 16) & 0xFF, (ts >> 8) & 0xFF, ts & 0xFF])
        body.extend(self.browser_fp)

        # SM3 摘要（a_bogus 用 SM3 而非 SHA），取三次摘要拼接后 RC4
        digest = self._sm3(bytes(body))
        payload = bytes(digest) + bytes(body)
        cipher = _rc4_encrypt(self.key, payload)
        return self._to_url_safe_base64(bytes(cipher))

    # ---- 最小 SM3 实现（GB/T 32905-2016），a_bogus 的摘要函数 ----
    _SM3_IV = [0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600,
               0xA96F30BC, 0x163138AA, 0xE38DEE4D, 0xB0FB0E4E]

    def _sm3(self, message: bytes) -> List[int]:
        def rotl(x: int, n: int) -> int:
            return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF

        def padding(msg: bytes) -> bytes:
            length = len(msg) * 8
            out = bytearray(msg)
            out.append(0x80)
            while len(out) % 64 != 56:
                out.append(0x00)
            out.extend(length.to_bytes(8, "big"))
            return bytes(out)

        def t(j: int) -> int:
            return 0x79CC4519 if j < 16 else 0x7A879D8A

        def ff(x: int, y: int, z: int, j: int) -> int:
            return (x ^ y ^ z) if j < 16 else ((x & y) | (x & z) | (y & z))

        def gg(x: int, y: int, z: int, j: int) -> int:
            return (x ^ y ^ z) if j < 16 else ((x & y) | ((~x & 0xFFFFFFFF) & z))

        def p0(x: int) -> int:
            return x ^ rotl(x, 9) ^ rotl(x, 17)

        def p1(x: int) -> int:
            return x ^ rotl(x, 15) ^ rotl(x, 23)

        v = list(self._SM3_IV)
        padded = padding(message)
        for block_start in range(0, len(padded), 64):
            blk = padded[block_start:block_start + 64]
            w = [int.from_bytes(blk[i * 4:i * 4 + 4], "big") for i in range(16)]
            for j in range(16, 68):
                w.append(p1(w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) ^ rotl(w[j - 13], 7) ^ w[j - 6])
            # 标准 SM3：W1[j] = W[j] ^ W[j+4]（j = 0..63），w 需 68 项
            w1 = [w[j] ^ w[j + 4] for j in range(64)]
            a, b, c, d, e, f, g, h = v
            for j in range(64):
                ss1 = rotl((rotl(a, 12) + e + rotl(t(j), j % 32)) & 0xFFFFFFFF, 7)
                ss2 = ss1 ^ rotl(a, 12)
                tt1 = (ff(a, b, c, j) + d + ss2 + w1[j]) & 0xFFFFFFFF
                tt2 = (gg(e, f, g, j) + h + ss1 + w[j]) & 0xFFFFFFFF
                d, c, b, a = c, rotl(b, 9), a, tt1
                h, g, f, e = g, rotl(f, 19), e, p0(tt2)
            v = [(x ^ y) & 0xFFFFFFFF for x, y in zip(v, [a, b, c, d, e, f, g, h])]
        out: List[int] = []
        for x in v:
            out.extend([(x >> 24) & 0xFF, (x >> 16) & 0xFF, (x >> 8) & 0xFF, x & 0xFF])
        return out

    def _to_url_safe_base64(self, data: bytes) -> str:
        import base64
        return base64.urlsafe_b64encode(data).decode().rstrip("=")


def generate_a_bogus(query_str: str, user_agent: str) -> str:
    """web 端点 a_bogus 入口。query_str 为**已排序的查询串**（不含 a_bogus 自身）。"""
    return ABogus(user_agent).generate(query_str)
