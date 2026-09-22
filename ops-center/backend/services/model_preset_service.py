"""Model preset catalog service — ops-center 预设模型/多模态能力管理。

运营人员在运营后台维护模型预设目录：
  - 控制哪些模型在前端【模型设置】中显示（is_visible）
  - 每个模型可维护最多 10 条技术文档网页链接
  - 多模态模型可手工配置支持的能力、每能力默认模型与每能力文档链接（最多 10 条）
  - 运营信息字段：端口URL(base_url)、获取模型ID URL(models_url)、默认模型ID(default_model)、
    接口技术文档URL(doc_links)、每分钟连接次数(rate_per_minute)、5小时限额次数(limit_per_5h)；允许为空，按类型校验。
"""
import asyncio
import datetime
import ipaddress
import json
import logging
import re
import socket

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models import ModelPreset

logger = logging.getLogger("ops-center")

MODEL_CATEGORIES = ["llm", "tts", "speech_recognition", "image", "video", "audio", "multimodal"]

MAX_DOC_LINKS = 10
MAX_URL_LENGTH = 500
MAX_MODELS = 500
MAX_RATE_PER_MINUTE = 100000
MAX_LIMIT_PER_5H = 10000000

# 多模态模型按能力展示的技术文档 URL 输入框（7 类固定能力）
MULTIMODAL_DOC_CAPABILITIES = [
    "llm",              # 文字推理接口
    "image",            # 图片生成
    "video",            # 视频生成
    "tts",              # TTS语音生成
    "voice_clone",      # TTS语音克隆
    "speech_recognition",  # 语音识别
    "vision",           # 视觉识别
]
# capability_doc_links 允许的键（含兼容旧数据的 audio）
ALLOWED_DOC_KEYS = set(MULTIMODAL_DOC_CAPABILITIES) | {"audio"}

_HTTP_URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)

# 198.18.0.0/15：RFC 2544 基准测试段（Python >=3.12 标记为 is_private=True），
# Clash/TUN 类 fake-ip 代理用它接管公网流量；仅在显式开启开关时放行。
_BENCHMARK_V4 = ipaddress.ip_network("198.18.0.0/15", strict=False)
# CGNAT(100.64.0.0/10)：is_private 在不同 Python 版本覆盖不一致，显式补充
_CGNAT_V4 = ipaddress.ip_network("100.64.0.0/10", strict=False)


def _validate_optional_url(value, field_name):
    """校验可空 URL：空返回 ''；非空必须为 http(s)，含主机名、无 userinfo、长度受限。"""
    from urllib.parse import urlparse
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if len(text) > MAX_URL_LENGTH:
        raise ValueError(f"{field_name} 长度不能超过 {MAX_URL_LENGTH} 字符")
    if not _HTTP_URL_RE.match(text):
        raise ValueError(f"{field_name} 必须是 http(s) 地址")
    try:
        parsed = urlparse(text)
    except ValueError:
        raise ValueError(f"{field_name} 必须是 http(s) 地址")
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not parsed.hostname:
        raise ValueError(f"{field_name} 必须是 http(s) 地址（含主机名）")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name} 不允许包含用户名/密码")
    return text


def _validate_optional_positive_int(value, field_name, max_value):
    """校验可空正整数：空/None/'' 返回 None；否则必须是 [1, max_value] 的整数（拒绝 0/负数/小数/布尔/字符串数字之外类型）。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field_name} 必须是大于等于 1 的整数（允许留空）")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f"{field_name} 必须是整数（允许留空）")
        value = int(value)
    try:
        num = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} 必须是整数（允许留空）")
    if num < 1:
        raise ValueError(f"{field_name} 必须是大于等于 1 的整数（允许留空）")
    if num > max_value:
        raise ValueError(f"{field_name} 不能超过 {max_value}")
    return num


# 种子目录（由 Multi-Publish 桌面端代码事实生成：适配器默认端点 + model-provider-seeds 预设模型 +
#   governor-provider-limits 每分钟连接次数；limit_per_5h 无代码事实留空）
# models_url 白名单（配合「获取模型ID URL」预填：选中预设自动带出、运营仍可编辑）：
#   预置「官方 Models 列表端点」：响应含 id（{data:[{id}]}）或 name/model_id（_extract_model_ids 均已适配），
#   且响应体 ≤ fetch 512KB 上限；排除：OpenRouter（全量响应实测 ~687KB 超上限）、豆包 Ark（返回推理接入点
#   ep-* 而非模型名）、minimax-multimodal（多模态，全量列表会覆盖能力映射模型）、以及无「模型列表」API
#   概念的非模型目录预设（图库/本地服务/部分语音端点）。
OFFICIAL_MODELS_URLS = {
    # OpenAI 兼容官方 Models 列表端点（{base}/models，响应 {data:[{id}]}；同一厂商多预设共用端点）
    "anthropic": "https://api.anthropic.com/v1/models",
    "openai": "https://api.openai.com/v1/models",
    "openai-tts": "https://api.openai.com/v1/models",
    "dall-e": "https://api.openai.com/v1/models",
    "whisper": "https://api.openai.com/v1/models",
    "deepseek": "https://api.deepseek.com/models",
    "mimo-llm": "https://api.xiaomimimo.com/v1/models",
    "grok-image": "https://api.x.ai/v1/models",
    "grok-video": "https://api.x.ai/v1/models",
    "recraft": "https://external.api.recraft.ai/v1/models",
    "opencode-go": "https://opencode.ai/zen/go/v1/models",
    "agnes-llm": "https://apihub.agnes-ai.com/v1/models",
    "agnes-image": "https://apihub.agnes-ai.com/v1/models",
    "agnes-video": "https://apihub.agnes-ai.com/v1/models",
    "sensenova-llm": "https://token.sensenova.cn/v1/models",
    "tianyiyun-coding-plan": "https://eaichat.ctyun.cn/ai/platform/v2/cp/models",
    "cogvideo": "https://open.bigmodel.cn/api/paas/v4/models",
    "minimax-tts": "https://api.minimaxi.com/v1/models",
    "minimax-image": "https://api.minimaxi.com/v1/models",
    "minimax": "https://api.minimaxi.com/v1/models",
    "elevenlabs": "https://api.elevenlabs.io/v1/models",
    # Google：官方 Models 列表（models[].name，_extract_model_ids 已适配并剥离 models/ 前缀）
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
    "imagen": "https://generativelanguage.googleapis.com/v1beta/models",
    "veo": "https://generativelanguage.googleapis.com/v1beta/models",
    # Ollama 本地服务：/api/tags 返回 {models:[{name}]}（环回地址 http 放行）
    "ollama": "http://localhost:11434/api/tags",
}

#   models_url 仅白名单预设预置官方 Models 端点（见 OFFICIAL_MODELS_URLS），其余留空由运营填写
PRESET_CATALOG = [
    # ─── 多模态 ─────────────────────────────
    {
        "id": "minimax-multimodal", "name": "MiniMax", "category": "multimodal",
        "base_url": "https://api.minimaxi.com/v1",
        "is_multimodal": 1,
        "models": ["speech-2.8-turbo","image-01","MiniMax-Hailuo-2.3","MiniMax-M2.7"], "default_model": "MiniMax-M2.7",
        "capabilities": ["llm","tts","image","video"],
        "capability_models": {"llm":"MiniMax-M2.7","tts":"speech-2.8-turbo","image":"image-01","video":"MiniMax-Hailuo-2.3"},
        "rate_per_minute": 20,
        "doc_links": ["https://platform.minimaxi.com/docs/guides/text-generation","https://platform.minimaxi.com/docs/guides/speech-t2a-async","https://platform.minimaxi.com/docs/guides/speech-voice-clone","https://platform.minimaxi.com/docs/guides/image-generation","https://platform.minimaxi.com/docs/guides/video-generation"],
        "capability_doc_links": {"llm":["https://platform.minimaxi.com/docs/guides/text-generation"],"tts":["https://platform.minimaxi.com/docs/guides/speech-t2a-async","https://platform.minimaxi.com/docs/guides/speech-voice-clone"],"image":["https://platform.minimaxi.com/docs/guides/image-generation"],"video":["https://platform.minimaxi.com/docs/guides/video-generation"]},
    },
    # Agnes-AI 多模态（2026-09-18 同步桌面端 agnes-multimodal 预设，中国站统一端点；
    # 与桌面端 model-provider-seeds.js 的 capabilities/capability_models 保持一致）
    {
        "id": "agnes-multimodal", "name": "Agnes-AI", "category": "multimodal",
        "base_url": "https://api.agnes-ai.cn/v1",
        "is_multimodal": 1,
        "models": ["agnes-3.0-flash","agnes-image-2.5-flash","agnes-video-2.5-flash"], "default_model": "agnes-3.0-flash",
        "capabilities": ["llm","image","video"],
        "capability_models": {"llm":"agnes-3.0-flash","image":"agnes-image-2.5-flash","video":"agnes-video-2.5-flash"},
        "rate_per_minute": 20,
        "doc_links": ["https://www.agnes-ai.cn/zh-Hans/docs/agnes-30-flash","https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash","https://www.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash"],
        "capability_doc_links": {"llm":["https://www.agnes-ai.cn/zh-Hans/docs/agnes-30-flash"],"image":["https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash"],"video":["https://www.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash"]},
    },
    # ─── LLM 推理 ─────────────────────────────
    {
        "id": "anthropic", "name": "Anthropic", "category": "llm",
        "base_url": "https://api.anthropic.com",
        "models_url": "https://api.anthropic.com/v1/models",
        "models": ["claude-sonnet-4-20250514","claude-3-5-haiku","claude-3-opus"], "default_model": "claude-sonnet-4-20250514",
        "rate_per_minute": 60,
        "doc_links": ["https://docs.anthropic.com/"],
    },
    {
        "id": "openai", "name": "OpenAI", "category": "llm",
        "base_url": "https://api.openai.com/v1",
        "models_url": "https://api.openai.com/v1/models",
        "models": ["gpt-4o","gpt-4o-mini","gpt-4-turbo","o3-mini"], "default_model": "gpt-4o",
        "rate_per_minute": 120,
        "doc_links": ["https://platform.openai.com/docs/guides/text-generation"],
    },
    {
        "id": "gemini", "name": "Gemini", "category": "llm",
        "base_url": "https://generativelanguage.googleapis.com",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "models": ["gemini-2.0-flash","gemini-2.0-pro","gemini-1.5-pro"], "default_model": "gemini-2.0-flash",
        "rate_per_minute": 60,
        "doc_links": ["https://ai.google.dev/gemini-api/docs"],
    },
    {
        "id": "openrouter", "name": "OpenRouter", "category": "llm",
        "base_url": "https://openrouter.ai/api/v1",
        "models": ["auto","anthropic/claude-sonnet-4-20250514","openai/gpt-4o"], "default_model": "auto",
        "rate_per_minute": 60,
        "doc_links": ["https://openrouter.ai/docs"],
    },
    {
        "id": "ollama", "name": "Ollama (本地)", "category": "llm",
        "base_url": "http://localhost:11434",
        "models_url": "http://localhost:11434/api/tags",
        "models": ["llama3","qwen2","mistral","gemma2"], "default_model": "llama3",
        "rate_per_minute": 120,
        "doc_links": ["https://docs.ollama.com/"],
    },
    {
        "id": "doubao-llm", "name": "豆包", "category": "llm",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "models": ["doubao-pro-128k","doubao-pro-32k","doubao-lite-32k"], "default_model": "doubao-pro-32k",
        "rate_per_minute": 60,
        "doc_links": ["https://www.volcengine.com/docs/82379"],
    },
    {
        "id": "deepseek", "name": "DeepSeek", "category": "llm",
        "base_url": "https://api.deepseek.com",
        "models_url": "https://api.deepseek.com/models",
        "models": ["deepseek-chat","deepseek-reasoner"], "default_model": "deepseek-chat",
        "rate_per_minute": 60,
        "doc_links": ["https://api-docs.deepseek.com/"],
    },
    {
        "id": "mimo-llm", "name": "Xiaomi MiMo", "category": "llm",
        "base_url": "https://api.xiaomimimo.com/v1",
        "models_url": "https://api.xiaomimimo.com/v1/models",
        "models": ["mimo-v2.5-pro","mimo-v2.5"], "default_model": "mimo-v2.5-pro",
        "rate_per_minute": 30,
        "doc_links": ["https://dev.mi.com/xiaomimimo/"],
    },
    {
        "id": "opencode-go", "name": "OpenCode-Go", "category": "llm",
        "base_url": "https://opencode.ai/zen/go/v1",
        "models_url": "https://opencode.ai/zen/go/v1/models",
        "models": ["glm-5.2","kimi-k2.7-code","deepseek-v4-pro","deepseek-v4-flash","mimo-v2.5","mimo-v2.5-pro","glm-5.1","kimi-k2.6"], "default_model": "glm-5.2",
        "rate_per_minute": 30,
        "doc_links": ["https://opencode.ai/"],
    },
    {
        "id": "agnes-llm", "name": "Agnes AI", "category": "llm",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "models_url": "https://apihub.agnes-ai.com/v1/models",
        "models": ["agnes-2.0-flash"], "default_model": "agnes-2.0-flash",
        "rate_per_minute": 30,
        "doc_links": ["https://docs.agnes-ai.com/"],
    },
    {
        "id": "sensenova-llm", "name": "SenseNova", "category": "llm",
        "base_url": "https://token.sensenova.cn/v1",
        "models_url": "https://token.sensenova.cn/v1/models",
        "models": ["deepseek-v4-flash"], "default_model": "deepseek-v4-flash",
        "rate_per_minute": 30,
        "doc_links": ["https://platform.sensenova.cn/"],
    },
    {
        "id": "tianyiyun-coding-plan", "name": "天翼云 Coding Plan", "category": "llm",
        "base_url": "https://eaichat.ctyun.cn/ai/platform/v2/cp",
        "models_url": "https://eaichat.ctyun.cn/ai/platform/v2/cp/models",
        "models": ["deepseek-v4-flash-0731-oc"], "default_model": "deepseek-v4-flash-0731-oc",
        "rate_per_minute": 30,
        "doc_links": ["https://www.ctyun.cn/document/"],
    },
    # ─── TTS 语音 ─────────────────────────────
    {
        "id": "elevenlabs", "name": "ElevenLabs", "category": "tts",
        "base_url": "https://api.elevenlabs.io/v1",
        "models_url": "https://api.elevenlabs.io/v1/models",
        "models": ["eleven_multilingual_v2","eleven_turbo_v2_5","eleven_monolingual_v1"], "default_model": "eleven_multilingual_v2",
        "rate_per_minute": 20,
        "doc_links": ["https://elevenlabs.io/docs/api-reference"],
    },
    {
        "id": "openai-tts", "name": "OpenAI TTS", "category": "tts",
        "base_url": "https://api.openai.com/v1",
        "models_url": "https://api.openai.com/v1/models",
        "models": ["tts-1","tts-1-hd","gpt-4o-mini-tts"], "default_model": "tts-1",
        "rate_per_minute": 30,
        "doc_links": ["https://platform.openai.com/docs/guides/text-to-speech"],
    },
    {
        "id": "doubao-tts", "name": "豆包 TTS", "category": "tts",
        "base_url": "https://openspeech.bytedance.com",
        "models": ["doubao-tts","doubao-streaming-tts"], "default_model": "doubao-tts",
        "rate_per_minute": 20,
        "doc_links": ["https://www.volcengine.com/docs/6561"],
    },
    {
        "id": "google-tts", "name": "Google TTS", "category": "tts",
        "base_url": "https://texttospeech.googleapis.com/v1",
        "models": ["google-tts","waveNet","neural2"], "default_model": "google-tts",
        "rate_per_minute": 30,
        "doc_links": ["https://cloud.google.com/text-to-speech/docs"],
    },
    {
        "id": "piper", "name": "Piper (本地)", "category": "tts",
        "base_url": "http://localhost:5000",
        "models": ["piper"], "default_model": "piper",
        "rate_per_minute": 120,
        "doc_links": ["https://github.com/rhasspy/piper"],
    },
    {
        "id": "mimo-tts", "name": "MiMo TTS", "category": "tts",
        "base_url": "https://api.xiaomimimo.com/v1",
        # mimo-v2.5-tts-voicedesign 项目用不到，已移除（2026-09-18）
        "models": ["mimo-v2.5-tts","mimo-v2.5-tts-voiceclone"], "default_model": "mimo-v2.5-tts",
        "rate_per_minute": 20,
        "doc_links": ["https://dev.mi.com/xiaomimimo/"],
    },
    {
        "id": "minimax-tts", "name": "MiniMax TTS", "category": "tts",
        "base_url": "https://api.minimaxi.com/v1",
        "models_url": "https://api.minimaxi.com/v1/models",
        "models": ["speech-2.8-turbo"], "default_model": "speech-2.8-turbo",
        "rate_per_minute": 20,
        "doc_links": ["https://platform.minimaxi.com/docs/guides/speech-t2a-async","https://platform.minimaxi.com/docs/guides/speech-voice-clone","https://platform.minimaxi.com/faq/system-voice-id"],
    },
    # ─── 语音识别 ─────────────────────────────
    {
        "id": "whisper", "name": "OpenAI Whisper", "category": "speech_recognition",
        "base_url": "https://api.openai.com/v1",
        "models_url": "https://api.openai.com/v1/models",
        "models": ["whisper-1"], "default_model": "whisper-1",
        "rate_per_minute": 30,
        "doc_links": ["https://platform.openai.com/docs/guides/speech-to-text"],
    },
    {
        "id": "google-stt", "name": "Google Speech-to-Text", "category": "speech_recognition",
        "base_url": "https://speech.googleapis.com/v1",
        "models": ["google-stt","google-stt-long"], "default_model": "google-stt",
        "rate_per_minute": 30,
        "doc_links": ["https://cloud.google.com/speech-to-text/docs"],
    },
    {
        "id": "doubao-stt", "name": "豆包语音识别", "category": "speech_recognition",
        "base_url": "https://openspeech.bytedance.com",
        "models": ["doubao-asr","doubao-streaming-asr"], "default_model": "doubao-asr",
        "rate_per_minute": 30,
        "doc_links": ["https://www.volcengine.com/docs/6561"],
    },
    {
        "id": "baidu-stt", "name": "百度语音识别", "category": "speech_recognition",
        "base_url": "https://vop.baidu.com/server_api",
        "models": ["baidu-asr"], "default_model": "baidu-asr",
        "rate_per_minute": 30,
        "doc_links": ["https://cloud.baidu.com/doc/SPEECH/index.html"],
    },
    {
        "id": "local-whisper", "name": "本地 Whisper", "category": "speech_recognition",
        "base_url": "http://localhost:8080",
        "models": ["whisper-cpp","whisper-large-v3"], "default_model": "whisper-cpp",
        "rate_per_minute": 60,
    },
    # ─── 图片生成 ─────────────────────────────
    {
        "id": "flux", "name": "Flux", "category": "image",
        "base_url": "https://api.bfl.ml/v1",
        "models": ["flux-pro","flux-dev","flux-schnell"], "default_model": "flux-pro",
        "rate_per_minute": 15,
        "doc_links": ["https://docs.bfl.ai/"],
    },
    {
        "id": "dall-e", "name": "DALL-E", "category": "image",
        "base_url": "https://api.openai.com/v1",
        "models_url": "https://api.openai.com/v1/models",
        "models": ["gpt-image-1","dall-e-3","dall-e-2"], "default_model": "dall-e-3",
        "rate_per_minute": 10,
        "doc_links": ["https://platform.openai.com/docs/guides/images"],
    },
    {
        "id": "recraft", "name": "Recraft", "category": "image",
        "base_url": "https://external.api.recraft.ai/v1",
        "models_url": "https://external.api.recraft.ai/v1/models",
        "models": ["recraft-v3","recraft-20b"], "default_model": "recraft-v3",
        "rate_per_minute": 15,
        "doc_links": ["https://www.recraft.ai/docs"],
    },
    {
        "id": "imagen", "name": "Imagen", "category": "image",
        "base_url": "https://generativelanguage.googleapis.com",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "models": ["imagen-4.0-generate-001","imagen-4.0-fast-generate-001","imagen-4.0-ultra-generate-001"], "default_model": "imagen-4.0-generate-001",
        "rate_per_minute": 15,
        "doc_links": ["https://ai.google.dev/gemini-api/docs/image-generation"],
    },
    {
        "id": "grok-image", "name": "Grok Image", "category": "image",
        "base_url": "https://api.x.ai/v1",
        "models_url": "https://api.x.ai/v1/models",
        "models": ["grok-image"], "default_model": "grok-image",
        "rate_per_minute": 15,
        "doc_links": ["https://docs.x.ai/docs/models"],
    },
    {
        "id": "pixabay", "name": "Pixabay", "category": "image",
        "base_url": "https://pixabay.com/api/",
        "models": ["pixabay"], "default_model": "pixabay",
        "rate_per_minute": 30,
        "doc_links": ["https://pixabay.com/api/docs/"],
    },
    {
        "id": "pexels", "name": "Pexels", "category": "image",
        "base_url": "https://api.pexels.com/v1",
        "models": ["pexels"], "default_model": "pexels",
        "rate_per_minute": 30,
        "doc_links": ["https://www.pexels.com/api/documentation/"],
    },
    {
        "id": "local-diffusion", "name": "本地扩散", "category": "image",
        "base_url": "http://localhost:7860",
        "models": ["sd-1.5","sdxl","sd3"], "default_model": "sdxl",
        "rate_per_minute": 60,
    },
    {
        "id": "comfyui", "name": "ComfyUI", "category": "image",
        "base_url": "http://localhost:8188",
        "models": ["comfyui"], "default_model": "comfyui",
        "rate_per_minute": 60,
        "doc_links": ["https://docs.comfy.org/"],
    },
    {
        "id": "minimax-image", "name": "MiniMax Image", "category": "image",
        "base_url": "https://api.minimaxi.com/v1",
        "models_url": "https://api.minimaxi.com/v1/models",
        "models": ["image-01"], "default_model": "image-01",
        "rate_per_minute": 15,
        "doc_links": ["https://platform.minimaxi.com/docs/guides/image-generation"],
    },
    {
        "id": "agnes-image", "name": "Agnes Image", "category": "image",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "models_url": "https://apihub.agnes-ai.com/v1/models",
        "models": ["agnes-image-2.1-flash"], "default_model": "agnes-image-2.1-flash",
        "rate_per_minute": 15,
        "doc_links": ["https://docs.agnes-ai.com/"],
    },
    # ─── 视频生成 ─────────────────────────────
    {
        "id": "hunyuan", "name": "腾讯混元", "category": "video",
        "base_url": "https://hunyuan.tencentcloudapi.com",
        "models": ["hunyuan-video"], "default_model": "hunyuan-video",
        "rate_per_minute": 6,
        "doc_links": ["https://cloud.tencent.com/document/product/1729"],
    },
    {
        "id": "cogvideo", "name": "CogVideo", "category": "video",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models_url": "https://open.bigmodel.cn/api/paas/v4/models",
        "models": ["cogvideo"], "default_model": "cogvideo",
        "rate_per_minute": 6,
        "doc_links": ["https://open.bigmodel.cn/dev/api#cogvideox"],
    },
    {
        "id": "grok-video", "name": "Grok Video", "category": "video",
        "base_url": "https://api.x.ai/v1",
        "models_url": "https://api.x.ai/v1/models",
        "models": ["grok-video"], "default_model": "grok-video",
        "rate_per_minute": 6,
        "doc_links": ["https://docs.x.ai/docs/models"],
    },
    {
        "id": "heygen", "name": "HeyGen", "category": "video",
        "base_url": "https://api.heygen.com/v2",
        "models": ["heygen-video"], "default_model": "heygen-video",
        "rate_per_minute": 8,
        "doc_links": ["https://docs.heygen.com/"],
    },
    {
        "id": "kling", "name": "Kling", "category": "video",
        "base_url": "https://api.klingai.com/v1",
        "models": ["kling-video"], "default_model": "kling-video",
        "rate_per_minute": 6,
        "doc_links": ["https://app.klingai.com/global/dev/document-api/"],
    },
    {
        "id": "runway", "name": "Runway", "category": "video",
        "base_url": "https://api.runwayml.com/v1",
        "models": ["runway-gen3","runway-gen4"], "default_model": "runway-gen3",
        "rate_per_minute": 6,
        "doc_links": ["https://docs.dev.runwayml.com/"],
    },
    {
        "id": "veo", "name": "Veo", "category": "video",
        "base_url": "https://generativelanguage.googleapis.com",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "models": ["veo"], "default_model": "veo",
        "rate_per_minute": 6,
        "doc_links": ["https://ai.google.dev/gemini-api/docs/video"],
    },
    {
        "id": "wan", "name": "Wan (万相)", "category": "video",
        "base_url": "https://dashscope.aliyuncs.com/api/v1",
        "models": ["wan-video"], "default_model": "wan-video",
        "rate_per_minute": 6,
        "doc_links": ["https://help.aliyun.com/zh/model-studio/"],
    },
    {
        "id": "minimax", "name": "MiniMax", "category": "video",
        "base_url": "https://api.minimaxi.com/v1",
        "models_url": "https://api.minimaxi.com/v1/models",
        "models": ["MiniMax-Hailuo-2.3","MiniMax-Hailuo-02","T2V-01","I2V-01"], "default_model": "MiniMax-Hailuo-2.3",
        "rate_per_minute": 6,
        "doc_links": ["https://platform.minimaxi.com/docs/guides/video-generation"],
    },
    {
        "id": "agnes-video", "name": "Agnes Video", "category": "video",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "models_url": "https://apihub.agnes-ai.com/v1/models",
        "models": ["agnes-video-v2.0"], "default_model": "agnes-video-v2.0",
        "rate_per_minute": 6,
        "doc_links": ["https://docs.agnes-ai.com/"],
    },
    {
        "id": "ltx", "name": "LTX Video", "category": "video",
        "base_url": "http://localhost:8000",
        "models": ["ltx-video"], "default_model": "ltx-video",
        "rate_per_minute": 6,
        "doc_links": ["https://docs.ltx.ai/"],
    },
    {
        "id": "seedance", "name": "Seedance", "category": "video",
        "base_url": "https://api.seedance.ai/v1",
        "models": ["seedance"], "default_model": "seedance",
        "rate_per_minute": 6,
        "doc_links": ["https://help.aliyun.com/zh/model-studio/"],
    },
    {
        "id": "higgsfield", "name": "Higgsfield", "category": "video",
        "base_url": "https://api.higgsfield.ai/v1",
        "models": ["higgsfield-video"], "default_model": "higgsfield-video",
        "rate_per_minute": 6,
        "doc_links": ["https://docs.higgsfield.ai/"],
    },
    # ─── 音频生成 ─────────────────────────────
    {
        "id": "suno", "name": "Suno", "category": "audio",
        "base_url": "https://api.suno.ai/v1",
        "models": ["suno-v4"], "default_model": "suno-v4",
        "rate_per_minute": 6,
        "doc_links": ["https://platform.suno.ai/docs/api"],
    },
    {
        "id": "musicgen", "name": "MusicGen", "category": "audio",
        "base_url": "http://localhost:5000",
        "models": ["musicgen"], "default_model": "musicgen",
        "rate_per_minute": 6,
    },
    {
        "id": "pixabay-music", "name": "Pixabay Music", "category": "audio",
        "base_url": "https://pixabay.com/api/",
        "models": ["pixabay-music"], "default_model": "pixabay-music",
        "rate_per_minute": 30,
        "doc_links": ["https://pixabay.com/api/docs/"],
    },
    {
        "id": "freesound", "name": "Freesound", "category": "audio",
        "base_url": "https://freesound.org/apiv2",
        "models": ["freesound"], "default_model": "freesound",
        "rate_per_minute": 30,
        "doc_links": ["https://freesound.org/docs/api/"],
    },
    {
        "id": "music-library", "name": "本地音乐库", "category": "audio",
        "base_url": "http://localhost:3000",
        "models": ["local-library"], "default_model": "local-library",
        "rate_per_minute": 120,
    },
]

def _validate_doc_links(links, field_name):
    """校验文档链接：最多 MAX_DOC_LINKS 条，且均为 http(s) URL。"""
    if links is None:
        return []
    if not isinstance(links, list):
        raise ValueError(f"{field_name} 必须是数组")
    if len(links) > MAX_DOC_LINKS:
        raise ValueError(f"{field_name} 最多 {MAX_DOC_LINKS} 条")
    result = []
    for link in links:
        text = str(link).strip()
        if text and not (text.startswith("http://") or text.startswith("https://")):
            raise ValueError(f"{field_name} 中的链接必须是 http(s) 地址：{text}")
        if text:
            result.append(text)
    return result


async def ensure_model_preset_columns(db: AsyncSession):
    """幂等迁移：为存量 model_presets 表补充新增列（SQLite ALTER TABLE ADD COLUMN）。"""
    import sqlalchemy as sa
    cols = {row[1] for row in (await db.execute(sa.text("PRAGMA table_info(model_presets)"))).fetchall()}
    additions = [
        ("models_url", "VARCHAR DEFAULT ''"),
        ("rate_per_minute", "INTEGER"),
        ("limit_per_5h", "INTEGER"),
        ("sort_order", "INTEGER"),
    ]
    for name, ddl in additions:
        if name not in cols:
            await db.execute(sa.text(f"ALTER TABLE model_presets ADD COLUMN {name} {ddl}"))
    await db.commit()


async def ensure_catalog_seeded(db: AsyncSession):
    """INSERT OR IGNORE 风格初始化：填充不存在的预设行；已存在但 rpm/限额/models_url 缺失的行按目录默认值回填。

    回填规则（2026-08-13 / 2026-08-27）：旧目录版本可能遗留 rate_per_minute/limit_per_5h 为 NULL、
    models_url 为空的行；只要目录（PRESET_CATALOG）有默认值且 DB 行为空，就补齐。
    models_url 仅对 base_url 仍为官方默认值的种子行回填，避免给自定义内网网关行注入不同供应商端点。
    仅当目录有值而 DB 为空时才写，避免覆盖运营手工修改过的值。
    """
    changed = False
    for item in PRESET_CATALOG:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == item["id"]))).scalar_one_or_none()
        if row is None:
            row = ModelPreset(
                id=item["id"],
                name=item["name"],
                category=item["category"],
                base_url=item.get("base_url", ""),
                models_url=item.get("models_url", ""),
                models=json.dumps(item.get("models", []), ensure_ascii=False),
                default_model=item.get("default_model", ""),
                rate_per_minute=item.get("rate_per_minute"),
                limit_per_5h=item.get("limit_per_5h"),
                is_multimodal=int(item.get("is_multimodal", 0)),
                capabilities=json.dumps(item.get("capabilities", []), ensure_ascii=False),
                capability_models=json.dumps(item.get("capability_models", {}), ensure_ascii=False),
                doc_links=json.dumps(item.get("doc_links", []), ensure_ascii=False),
                capability_doc_links=json.dumps(item.get("capability_doc_links", {}), ensure_ascii=False),
                is_visible=1,
            )
            db.add(row)
            changed = True
            continue
        if row.rate_per_minute is None and item.get("rate_per_minute") is not None:
            row.rate_per_minute = item["rate_per_minute"]
            changed = True
        if row.limit_per_5h is None and item.get("limit_per_5h") is not None:
            row.limit_per_5h = item["limit_per_5h"]
            changed = True
        # models_url：白名单官方 Models 端点，仅对 base_url 仍为官方默认值的种子行且值为空时回填
        # （不覆盖运营手工值；运营主动清空后重启会恢复官方值 —— 预填语义下可接受）
        # base_url 守卫为精确字符串比较（保守不误伤）；目录端点后续迁移不扩散到存量行，与 rpm 语义一致
        if ((not row.models_url) and item.get("models_url")
                and row.base_url == item["base_url"]):
            row.models_url = item["models_url"]
            changed = True
    if changed:
        await db.commit()

    # 模型列表种子自动填充（2026-08-27，best-effort）：对「models_url 非空且模型列表仍停留在目录静态
    # 种子值或为空」的官方预设行，从 models_url 拉取官方全量模型列表回填；失败（网络/鉴权/限流均可能）
    # 仅记录日志跳过，不影响启动。运营可稍后在「预设模型 → 批量获取模型ID」手动重试。
    # OPS_PRESET_SEED_FETCH_ENABLED=0 关闭（测试/离线环境）。
    if not settings.preset_seed_fetch_enabled:
        return
    candidates = []
    for item in PRESET_CATALOG:
        row = (await db.execute(select(ModelPreset).where(ModelPreset.id == item["id"]))).scalar_one_or_none()
        if row is None or not (row.models_url or "").strip():
            continue
        # 自定义网关（base_url 已被运营修改）不注入官方端点，与 models_url 回填守卫一致
        if row.base_url != item.get("base_url", ""):
            continue
        try:
            db_models = json.loads(row.models or "[]")
        except (ValueError, TypeError):
            db_models = []
        if not isinstance(db_models, list):
            db_models = []
        static_models = [str(m) for m in item.get("models", [])]
        if db_models and db_models != static_models:
            continue  # 已有 fetch/手工覆盖值 → 不覆盖

        async def _fetch_one(r):
            try:
                models, default_model, _ = await fetch_models_from_url(db, r.id)
                if not models:
                    return None
                r.models = json.dumps(models[:MAX_MODELS], ensure_ascii=False)
                if default_model:
                    r.default_model = default_model
                return r.id, len(models)
            except Exception as exc:  # best-effort：任何失败只记日志
                logger.warning("model preset seed fetch skipped %s: %s", r.id, exc)
                return None

        candidates.append(row)
    if candidates:
        results = await asyncio.gather(*[_fetch_one(r) for r in candidates])
        done = [r for r in results if r]
        if done:
            await db.commit()
            logger.info("model preset seed fetch done: %s",
                        ", ".join(f"{p}({n})" for p, n in done))


REORDER_ACTIONS = ("top", "up", "down", "bottom")


def _display_order():
    """预设列表/目录显示序：sort_order NULLS LAST 升序（未排序行由桌面端按拼音序兜底），再多模态优先、类别、名称。"""
    return (ModelPreset.sort_order.is_(None), ModelPreset.sort_order.asc(),
            ModelPreset.is_multimodal.desc(), ModelPreset.category, ModelPreset.name)


async def reorder_model_preset(db: AsyncSession, preset_id: str, action: str) -> str:
    """预设模型自定义排序：全量列表（含隐藏、按显示序）内移动目标行，随后 sort_order 归一化为 0..n-1。

    返回 "changed" | "noop"（已在边界，幂等不写库）| "not-found"；action 非法抛 ValueError。
    一旦开始排序即对全列表显式赋值（全量权威语义）；未排序行为的桌面端拼音序兜底见
    01-docs/PRD-MODEL-LIST-SORT-ORDER-2026-09-23.md。
    """
    import sqlalchemy as sa
    if action not in REORDER_ACTIONS:
        raise ValueError(f"action 必须是 {'/'.join(REORDER_ACTIONS)} 之一")
    rows = list((await db.execute(sa.select(ModelPreset).order_by(*_display_order()))).scalars().all())
    idx = next((i for i, r in enumerate(rows) if r.id == preset_id), -1)
    if idx < 0:
        return "not-found"
    target = {"top": 0, "up": idx - 1, "down": idx + 1, "bottom": len(rows) - 1}[action]
    target = max(0, min(target, len(rows) - 1))
    if target == idx:
        return "noop"
    moved = rows.pop(idx)
    rows.insert(target, moved)
    now = datetime.datetime.utcnow().isoformat()
    for order, r in enumerate(rows):
        if r.sort_order != order:
            r.sort_order = order
            r.updated_at = now
    await db.commit()
    return "changed"


async def list_model_presets(db: AsyncSession, category: str | None = None, include_hidden: bool = False):
    stmt = select(ModelPreset).order_by(*_display_order())
    if category:
        stmt = stmt.where(ModelPreset.category == category)
    if not include_hidden:
        stmt = stmt.where(ModelPreset.is_visible == 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(r) for r in rows]


async def get_model_preset(db: AsyncSession, preset_id: str):
    return (await db.execute(select(ModelPreset).where(ModelPreset.id == preset_id))).scalar_one_or_none()


async def upsert_model_preset(db: AsyncSession, data: dict, updated_by: str = "admin"):
    preset_id = str(data.get("id", "")).strip()
    name = str(data.get("name", "")).strip()
    category = str(data.get("category", "")).strip()
    if not preset_id or not name or not category:
        raise ValueError("id/name/category 为必填项")
    if category not in MODEL_CATEGORIES:
        raise ValueError(f"category 必须是 {MODEL_CATEGORIES} 之一")

    doc_links = _validate_doc_links(data.get("doc_links"), "doc_links")
    base_url = _validate_optional_url(data.get("base_url"), "base_url")
    models_url = _validate_optional_url(data.get("models_url"), "models_url")
    rate_per_minute = _validate_optional_positive_int(data.get("rate_per_minute"), "rate_per_minute", MAX_RATE_PER_MINUTE)
    limit_per_5h = _validate_optional_positive_int(data.get("limit_per_5h"), "limit_per_5h", MAX_LIMIT_PER_5H)

    capabilities = data.get("capabilities", [])
    capability_models = data.get("capability_models", {}) or {}
    capability_doc_links = data.get("capability_doc_links", {}) or {}
    if not isinstance(capabilities, list):
        raise ValueError("capabilities 必须是数组")
    if not isinstance(capability_models, dict):
        raise ValueError("capability_models 必须是对象")
    if not isinstance(capability_doc_links, dict):
        raise ValueError("capability_doc_links 必须是对象")
    for cap in capabilities:
        if cap not in capability_models:
            raise ValueError(f"能力 {cap} 缺少默认模型（capability_models）")
    normalized_cap_docs = {}
    for cap, links in capability_doc_links.items():
        if cap not in ALLOWED_DOC_KEYS:
            raise ValueError(f"未知的能力文档键：{cap}（允许：{', '.join(sorted(ALLOWED_DOC_KEYS))}）")
        normalized_cap_docs[cap] = _validate_doc_links(links, f"capability_doc_links.{cap}")

    models = data.get("models", [])
    if not isinstance(models, list):
        raise ValueError("models 必须是数组")
    if len(models) > MAX_MODELS:
        raise ValueError(f"models 最多 {MAX_MODELS} 个")
    normalized_models = []
    for m in models:
        text = str(m).strip()
        if text and text not in normalized_models:
            normalized_models.append(text)

    default_model = str(data.get("default_model", "")).strip()
    if default_model and normalized_models and default_model not in normalized_models:
        raise ValueError("默认模型 ID 必须在模型列表中")

    row = await get_model_preset(db, preset_id)
    now = datetime.datetime.utcnow().isoformat()
    if row is None:
        row = ModelPreset(id=preset_id, created_at=now)
        db.add(row)
    row.name = name
    row.category = category
    row.base_url = base_url
    row.models_url = models_url
    row.models = json.dumps(normalized_models, ensure_ascii=False)
    row.default_model = default_model
    row.rate_per_minute = rate_per_minute
    row.limit_per_5h = limit_per_5h
    row.is_multimodal = 1 if data.get("is_multimodal") else 0
    row.capabilities = json.dumps(capabilities, ensure_ascii=False)
    row.capability_models = json.dumps(capability_models, ensure_ascii=False)
    row.doc_links = json.dumps(doc_links, ensure_ascii=False)
    row.capability_doc_links = json.dumps(normalized_cap_docs, ensure_ascii=False)
    row.is_visible = 0 if data.get("is_visible") is False else 1
    row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return _to_dict(row)


async def delete_model_preset(db: AsyncSession, preset_id: str):
    row = await get_model_preset(db, preset_id)
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True


def _is_loopback_host(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if host in ("localhost", "localhost.localdomain"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _is_private_or_reserved(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # 198.18.0.0/15 是 RFC 2544 基准测试段（Python >=3.12 标记为 is_private=True），
    # Clash/TUN 类 fake-ip 代理用它接管公网流量，公网模型 API 域名在代理环境下会解析到该段；
    # 它不是真实内网目标，但仅在显式开启 OPS_ALLOW_PROXY_BENCHMARK_IPS 时放行（默认 fail-closed）。
    if settings.allow_proxy_benchmark_ips and addr in _BENCHMARK_V4:
        return False
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast
            or addr.is_reserved or addr.is_unspecified or addr in _CGNAT_V4)


def _is_benchmark_segment(ip: str) -> bool:
    """是否为 RFC 2544 基准测试段 198.18.0.0/15。

    该段被 Clash/TUN 类 fake-ip 代理用于接管公网流量：公网模型 API 域名在代理
    DNS 劫持下会解析到该段。它不是真实内网目标，仅因代理存在才出现；用于区分
    「真实私网/保留地址」与「代理基准段」，从而给出可操作的拒绝提示。
    """
    try:
        return ipaddress.ip_address(ip) in _BENCHMARK_V4
    except ValueError:
        return False


def _extract_model_ids(payload: object) -> list[str]:
    """从常见模型列表响应中提取字符串模型ID：
    {models:[...]} / {data:[{id:...}]} / {data:[...]} / 纯数组 / {model_ids|modelIds} / {items}；
    元素字段优先级 id（OpenAI 兼容）→ model_id/modelId（ElevenLabs 真实 API 标识）→ name（Gemini
    models/xxx、Ollama tags 显示名）；仅 name 字段剥离 models/ 目录前缀，id/model_id 以 models/ 开头
    属于真实模型标识不得改写。"""
    candidates = []
    if isinstance(payload, list):
        candidates = payload
    elif isinstance(payload, dict):
        for key in ("models", "data", "model_ids", "modelIds"):
            if isinstance(payload.get(key), list):
                candidates = payload[key]
                break
        else:
            if isinstance(payload.get("items"), list):
                candidates = payload["items"]
    result = []
    for item in candidates:
        matched_key = None
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict):
            text = ""
            for key in ("id", "model_id", "modelId", "name"):
                val = item.get(key)
                if isinstance(val, str) and val.strip():
                    text = val.strip()
                    matched_key = key
                    break
            if not text:
                continue
        else:
            continue
        # Gemini 的 name 形如 "models/gemini-2.0-flash"，仅对 name 字段剥离目录前缀
        if matched_key == "name" and text.startswith("models/"):
            text = text[len("models/"):].strip()
        if text and text not in result:
            result.append(text)
        if len(result) >= MAX_MODELS:
            break
    return result

async def fetch_models_from_url(db: AsyncSession, preset_id: str, models_url_override: str | None = None):
    """从 preset.models_url（或显式覆盖值）拉取支持的模型 ID 列表。

    SSRF 防护 + 超时 + 大小限制 + JSON 契约。
    已知边界：校验解析(socket.getaddrinfo)与 httpx 实际连接为两次独立 DNS 解析，存在
    DNS 重绑定 TOCTOU 窗口（follow_redirects=False 已防 3xx 跳转），本函数不声称阻断重绑定。
    返回 (models, default_model, models_url)。成功时由调用方负责回写持久化。
    """
    import httpx

    row = await get_model_preset(db, preset_id)
    if row is None:
        raise ValueError(f"Model preset not found: {preset_id}")
    models_url = (models_url_override or row.models_url or "").strip()
    if not models_url:
        raise ValueError("该预设未配置「获取模型ID URL」（models_url）")
    if models_url_override:
        models_url = _validate_optional_url(models_url_override, "models_url")

    try:
        parsed = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(models_url)
    except Exception:
        parsed = None
    if parsed is None or parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("获取模型ID URL 必须是 http(s) 地址")

    hostname = (parsed.hostname or "").lower()
    is_loopback = _is_loopback_host(hostname)
    # 非环回主机：仅允许 https，且解析后的地址不得是私网/保留地址（防 SSRF/DNS 重绑定）
    if not is_loopback:
        if parsed.scheme != "https":
            raise ValueError("非本机地址的获取模型ID URL 必须使用 https")
        try:
            resolved = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            raise ValueError("无法解析获取模型ID URL 的主机名")
        for entry in resolved:
            ip = entry[4][0]
            if _is_private_or_reserved(ip):
                # 区分「真实私网/保留地址」与「fake-ip 代理基准段」：后者不是真实内网目标，
                # 仅因代理 DNS 劫持才解析到 198.18.x.x，给出可操作的指引而非笼统拒绝。
                if _is_benchmark_segment(ip) and not settings.allow_proxy_benchmark_ips:
                    raise ValueError(
                        "获取模型ID URL 在 fake-IP 代理环境下解析到 198.18.x.x（RFC 2544 基准测试段），"
                        "被 SSRF 守卫按保留地址拒绝。这不是真实内网目标，而是 Clash/TUN 类代理接管公网流量的正常现象。"
                        "请二选一解决：① 在运行 ops-center 的环境设置 OPS_ALLOW_PROXY_BENCHMARK_IPS=true 后重启服务；"
                        "② 关闭代理的 fake-IP / DNS 劫持模式后重试。"
                    )
                raise ValueError("获取模型ID URL 解析到私网/保留地址，已拒绝（防 SSRF）")

    headers = {"Accept": "application/json", "User-Agent": "ops-center-model-presets/0.1"}
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.get(models_url, headers=headers)
    except httpx.TimeoutException:
        raise ValueError("获取模型ID请求超时（10 秒）")
    except httpx.RequestError as exc:
        raise ValueError(f"获取模型ID请求失败：{exc.__class__.__name__}")

    if resp.status_code < 200 or resp.status_code >= 300:
        raise ValueError(f"获取模型ID请求返回 HTTP {resp.status_code}")

    body = resp.content or b""
    if len(body) > 512 * 1024:
        raise ValueError("获取模型ID响应体超过 512KB，已拒绝")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ValueError("获取模型ID响应不是合法 JSON")

    models = _extract_model_ids(payload)
    if not models:
        raise ValueError("获取模型ID响应中未找到任何模型ID（支持 {models|data:[...]} 或纯数组）")

    old_default = (row.default_model or "").strip()
    default_model = old_default if old_default in models else ""
    return models, default_model, models_url






import ipaddress as _ipaddress
from urllib.parse import urlparse as _urlparse

def _validate_target_url(url: str, *, allow_private: bool = False) -> str:
    """P0-7 SSRF guard: reject private/reserved IPs and internal hostnames."""
    import os
    parsed = _urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise ValueError(f"[P0-7] Unsupported URL scheme: {parsed.scheme!r}")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("[P0-7] URL has no hostname")
    if not allow_private and hostname in ("localhost", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"):
        raise ValueError(f"[P0-7] Blocked internal address: {hostname}")
    try:
        ip = _ipaddress.ip_address(hostname)
        if not allow_private:
            allow_bench = os.environ.get("OPS_ALLOW_PROXY_BENCHMARK_IPS", "").lower() == "true"
            if allow_bench and ip in _ipaddress.ip_network("198.18.0.0/15"):
                return url
            if ip.is_private or ip.is_reserved or ip.is_loopback or ip.is_link_local:
                raise ValueError(f"[P0-7] Blocked private/reserved IP: {ip}")
        return url
    except ValueError as e:
        if "[P0-7]" in str(e):
            raise
    if not allow_private:
        import socket
        allow_bench = os.environ.get("OPS_ALLOW_PROXY_BENCHMARK_IPS", "").lower() == "true"
        try:
            for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
                addr = _ipaddress.ip_address(info[4][0])
                if allow_bench and addr in _ipaddress.ip_network("198.18.0.0/15"):
                    continue
                if addr.is_private or addr.is_reserved or addr.is_loopback or addr.is_link_local:
                    raise ValueError(f"[P0-7] {hostname} resolves to private IP: {addr}")
        except socket.gaierror:
            pass
    return url


async def test_provider_connection(db: AsyncSession, preset_id: str, body: dict, secret: str) -> dict:
    """测试模型预设连通性（不落库、不产生真实生成费用）。

    探测策略（OpenAI 兼容最小请求）：
    1) POST {base}/chat/completions（max_tokens=1）——覆盖 llm/vision/chat 类；
    2) 若返回 404/405，或 400 且错误体命中模型关键字 → fallback GET {base}/models —— 覆盖 image 类；
    3) 均不可达 → 报错并提示「请用真实生成验证」。
    api_key/base_url 未提供时回退到已保存密钥（按 provider 匹配 official_keys）。
    """
    import httpx
    from sqlalchemy import select as sa_select
    from models import OfficialKey, ModelPreset
    from services.key_service import decrypt_key

    row = await get_model_preset(db, preset_id)
    if row is None:
        raise ValueError(f"Model preset not found: {preset_id}")

    # 优先使用 body 中传入的值，否则从数据库获取
    api_key = str(body.get("api_key") or "").strip()
    base_url = str(body.get("base_url") or "").strip().rstrip("/")
    model = str(body.get("model") or "").strip()

    # base_url：优先 body → 数据库 preset
    if not base_url:
        base_url = (row.base_url or "").strip().rstrip("/")
    if not base_url:
        raise ValueError("未配置 base_url（端口URL），请先填写")

    # api_key：优先 body → official_keys 表（按 provider 匹配）
    if not api_key:
        key_row = (await db.execute(
            sa_select(OfficialKey).where(
                OfficialKey.provider == preset_id,
                OfficialKey.is_active == 1,
            )
        )).scalar_one_or_none()
        if key_row:
            try:
                api_key = decrypt_key(key_row.api_key)
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).warning(
                    "[P0-3] decrypt fallback failed id=%s: %s", key_row.id, type(e).__name__)
                api_key = None
    if not api_key:
        raise ValueError("未配置 API Key，请先填写（表单或模型密钥表）")

    # model：优先 body → preset 的 default_model → 列表第一个
    if not model:
        model = row.default_model or ""
    if not model:
        models_list = json.loads(row.models or "[]")
        if models_list:
            model = models_list[0]
    if not model:
        raise ValueError("未配置模型 ID（default_model 或 models），请先填写")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    def _is_model_error(text: str) -> bool:
        t = text.lower()
        return any(kw in t for kw in ("unknown model", "model not found", "model does not exist",
                                       "invalid model", "not found", "no such model"))

    try:
        base_url = _validate_target_url(base_url)
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            # 策略 1: POST chat/completions
            url = f"{base_url.rstrip('/')}/chat/completions"
            resp = await client.post(url, json={
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            }, headers=headers)
            if resp.status_code < 400:
                return {"ok": True, "detail": "连接成功（chat/completions 可达）"}
            if resp.status_code in (404, 405) or (resp.status_code == 400 and _is_model_error(resp.text)):
                # 策略 2: fallback GET /models
                url2 = f"{base_url.rstrip('/')}/models"
                resp2 = await client.get(url2, headers=headers)
                if resp2.status_code < 400:
                    return {"ok": True, "detail": "连接成功（/models 可达）"}
                raise ValueError(
                    f"连通性探测失败：chat/completions={resp.status_code}，/models={resp2.status_code}；"
                    "该端点可能不支持轻量探测，请改用真实生成/评估验证")
            raise ValueError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    except httpx.HTTPError as e:
        raise ValueError(f"连接失败：{e.__class__.__name__}: {e}")

async def list_catalog(db: AsyncSession) -> list[dict]:
    """目录同步端点数据：仅 is_visible=1，序列化桌面端所需字段（不含敏感项）。"""
    import sqlalchemy as sa

    rows = (await db.execute(
        sa.select(ModelPreset).where(ModelPreset.is_visible == 1).order_by(*_display_order())
    )).scalars().all()
    return [_to_catalog_item(r) for r in rows]


def _to_catalog_item(row: ModelPreset) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "category": row.category,
        "base_url": row.base_url or "",
        "models": json.loads(row.models or "[]"),
        "default_model": row.default_model or "",
        "rate_per_minute": row.rate_per_minute,
        "limit_per_5h": row.limit_per_5h,
        "is_multimodal": bool(row.is_multimodal),
        "capabilities": json.loads(row.capabilities or "[]"),
        "capability_models": json.loads(row.capability_models or "{}"),
        "sort_order": row.sort_order,
        "updated_at": row.updated_at,
    }

def _to_dict(row: ModelPreset) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "category": row.category,
        "base_url": row.base_url or "",
        "models_url": row.models_url or "",
        "models": json.loads(row.models or "[]"),
        "default_model": row.default_model or "",
        "rate_per_minute": row.rate_per_minute,
        "limit_per_5h": row.limit_per_5h,
        "is_multimodal": bool(row.is_multimodal),
        "capabilities": json.loads(row.capabilities or "[]"),
        "capability_models": json.loads(row.capability_models or "{}"),
        "doc_links": json.loads(row.doc_links or "[]"),
        "capability_doc_links": json.loads(row.capability_doc_links or "{}"),
        "is_visible": bool(row.is_visible),
        "sort_order": row.sort_order,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
