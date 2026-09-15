"""
数据模型

平台类型、发布任务、发布结果等核心数据结构。
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class PlatformCategory(Enum):
    """平台内容分类（决定发布策略和UI展示）"""

    VIDEO = "video"  # 短视频平台（抖音、快手、视频号、B站、YouTube、TikTok）
    IMAGE_TEXT = "image_text"  # 图文平台（公众号、知乎、微博、头条、百家号）
    MIXED = "mixed"  # 混合平台（小红书，支持图文+视频）


class PlatformType(Enum):
    """支持的平台类型"""

    WECHAT_MP = "wechat_mp"  # 微信公众号
    ZHIHU = "zhihu"  # 知乎
    WEIBO = "weibo"  # 微博
    DOUYIN = "douyin"  # 抖音
    XIAOHONGSHU = "xiaohongshu"  # 小红书
    TENCENT_VIDEO = "tencent_video"  # 视频号（与 config/platforms.yaml 一致）
    KUAISHOU = "kuaishou"  # 快手
    TOUTIAO = "toutiao"  # 今日头条
    YOUTUBE = "youtube"  # YouTube
    TIKTOK = "tiktok"  # TikTok
    BILIBILI = "bilibili"  # B站
    BAJIAHAO = "baijiahao"  # 百家号


class TaskStatus(Enum):
    """任务状态"""

    PENDING = "pending"  # 等待执行
    QUEUED = "queued"  # 已入队
    RUNNING = "running"  # 执行中
    SUCCESS = "success"  # 成功
    FAILED = "failed"  # 失败
    CANCELLED = "cancelled"  # 已取消


class PublishMode(Enum):
    """发布模式"""

    DRAFT = "draft"  # 仅保存草稿
    PUBLISH = "publish"  # 正式发布
    SCHEDULE = "schedule"  # 定时发布


class PublishPhase(Enum):
    """发布阶段（参考产品风格进度管理）"""

    PREPARING = "preparing"  # 准备中
    AUTHENTICATING = "authenticating"  # 验证登录态
    UPLOADING = "uploading"  # 上传中
    PUBLISHING = "publishing"  # 发布中
    DONE = "done"  # 完成
    FAILED = "failed"  # 失败


@dataclass
class AuthData:
    """
    平台认证数据（cookies + localStorage + IndexedDB）

    从参考产品反编译发现，仅保存 cookies 不足以维持抖音登录态，
    必须同步保存 localStorage 中的 security-sdk/* 值和 IndexedDB secure-store 数据。
    """

    cookies: list[dict] = field(default_factory=list)
    local_storage: dict[str, str] = field(default_factory=dict)
    indexed_db: dict[str, dict] = field(default_factory=dict)

    def is_empty(self) -> bool:
        return not self.cookies and not self.local_storage and not self.indexed_db

    def to_dict(self) -> dict:
        return {
            "cookies": self.cookies,
            "local_storage": self.local_storage,
            "indexed_db": self.indexed_db,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AuthData":
        return cls(
            cookies=data.get("cookies", []),
            local_storage=data.get("local_storage", {}),
            indexed_db=data.get("indexed_db", {}),
        )


@dataclass
class PublishProgress:
    """
    发布进度

    与前端通信的进度数据结构，包含当前阶段、百分比、消息。
    """

    task_id: str
    phase: PublishPhase = PublishPhase.PREPARING
    percent: int = 0
    message: str = ""
    platform: str = ""


@dataclass
class PublishResult:
    """
    发布结果

    Attributes:
        success: 是否成功
        platform: 平台名称
        article_id: 平台文章 ID
        url: 发布后的文章链接
        error: 错误信息
        duration: 耗时（秒）
    """

    success: bool
    platform: str
    article_id: str | None = None
    url: str | None = None
    error: str | None = None
    duration: float = 0.0


@dataclass
class PublishTask:
    """
    发布任务

    Attributes:
        id: 任务 ID
        title: 文章标题
        content: 文章内容
        platforms: 目标平台列表
        status: 当前状态
        results: 各平台发布结果
        created_at: 创建时间
        scheduled_at: 定时发布时间（None 表示立即执行）
        retry_count: 重试次数
        max_retries: 最大重试次数
        media_paths: 媒体文件路径列表（视频/图片）
        metadata: 额外元数据（封面图、标签、分类等）
    """

    id: str
    title: str
    content: str
    platforms: list[PlatformType]
    status: TaskStatus = TaskStatus.PENDING
    results: dict[PlatformType, PublishResult] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    scheduled_at: datetime | None = None
    retry_count: int = 0
    max_retries: int = 3
    media_paths: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_finished(self) -> bool:
        return self.status in (TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.CANCELLED)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "platforms": [p.value for p in self.platforms],
            "status": self.status.value,
            "results": {
                p.value: {
                    "success": r.success,
                    "url": r.url,
                    "error": r.error,
                }
                for p, r in self.results.items()
            },
            "created_at": self.created_at.isoformat(),
            "retry_count": self.retry_count,
            "media_paths": self.media_paths,
            "scheduled_at": self.scheduled_at.isoformat() if self.scheduled_at else None,
        }


@dataclass
class ProxyConfig:
    """
    SOCKS5 代理配置（P2-1）

    每个账号可绑定独立 SOCKS5 代理，多账号多 IP 防平台限流。

    Attributes:
        server: 代理服务器地址，格式 'socks5://host:port'
        username: 代理认证用户名（可选）
        password: 代理认证密码（可选）
    """

    server: str
    username: str | None = None
    password: str | None = None

    def to_dict(self) -> dict | None:
        """转为 API 传输用字典"""
        if not self.server:
            return None
        d = {"server": self.server}
        if self.username:
            d["username"] = self.username
        if self.password:
            d["password"] = self.password
        return d

    @classmethod
    def from_dict(cls, data: dict | None) -> "ProxyConfig | None":
        """从 API 字典还原"""
        if not data or not data.get("server"):
            return None
        return cls(
            server=data["server"],
            username=data.get("username"),
            password=data.get("password"),
        )

    def to_playwright_dict(self) -> dict | None:
        """转为 Playwright 代理参数字典"""
        if not self.server:
            return None
        result = {"server": self.server}
        if self.username:
            result["username"] = self.username
        if self.password:
            result["password"] = self.password
        return result


@dataclass
class PlatformAccount:
    """
    平台账号配置

    Attributes:
        id: 账号 ID
        platform: 平台类型
        name: 账号名称（显示用）
        config: 认证配置（加密存储）
        proxy: SOCKS5 代理配置（可选，P2-1）
        is_active: 是否启用
        last_validated: 最后验证时间
        created_at: 创建时间
    """

    id: str
    platform: PlatformType
    name: str
    config: dict[str, Any]  # 加密后的配置
    proxy: ProxyConfig | None = None  # P2-1: 每个账号独立代理
    is_active: bool = True
    last_validated: datetime | None = None
    created_at: datetime = field(default_factory=datetime.now)


# ─── 平台元数据 ─────────────────────────────────────────────

PLATFORM_META: dict[PlatformType, dict] = {
    PlatformType.WECHAT_MP: {
        "name": "微信公众号",
        "tech": "api",
        "publish_type": "article",
        "category": "image_text",
        "homepage": "https://mp.weixin.qq.com/",
    },
    PlatformType.DOUYIN: {
        "name": "抖音",
        "tech": "api_rpa",  # dual mode: try API first, fallback to RPA
        "publish_type": "video",
        "category": "video",
        "homepage": "https://creator.douyin.com/",
        "creator_url": "https://creator.douyin.com/creator-micro/content/upload",
    },
    PlatformType.ZHIHU: {
        "name": "知乎",
        "tech": "rpa",
        "publish_type": "article",
        "category": "image_text",
        "homepage": "https://www.zhihu.com/",
    },
    PlatformType.WEIBO: {
        "name": "微博",
        "tech": "rpa",
        "publish_type": "article",
        "category": "image_text",
        "homepage": "https://weibo.com/",
    },
    PlatformType.XIAOHONGSHU: {
        "name": "小红书",
        "tech": "rpa",
        "publish_type": "article",
        "category": "mixed",
        "homepage": "https://creator.xiaohongshu.com/",
    },
    PlatformType.TENCENT_VIDEO: {
        "name": "视频号",
        "tech": "rpa",
        "publish_type": "video",
        "category": "video",
        "homepage": "https://channels.weixin.qq.com/",
    },
    PlatformType.KUAISHOU: {
        "name": "快手",
        "tech": "rpa",
        "publish_type": "video",
        "category": "video",
        "homepage": "https://cp.kuaishou.com/",
    },
    PlatformType.TOUTIAO: {
        "name": "今日头条",
        "tech": "rpa",
        "publish_type": "article",
        "category": "image_text",
        "homepage": "https://mp.toutiao.com/",
    },
    PlatformType.YOUTUBE: {
        "name": "YouTube",
        "tech": "rpa",
        "publish_type": "video",
        "category": "video",
        "homepage": "https://studio.youtube.com/",
    },
    PlatformType.TIKTOK: {
        "name": "TikTok",
        "tech": "rpa",
        "publish_type": "video",
        "category": "video",
        "homepage": "https://www.tiktok.com/upload/",
    },
    PlatformType.BILIBILI: {
        "name": "Bilibili",
        "tech": "rpa",
        "publish_type": "video",
        "category": "video",
        "homepage": "https://www.bilibili.com/",
    },
    PlatformType.BAJIAHAO: {
        "name": "百家号",
        "tech": "rpa",
        "publish_type": "article",
        "category": "image_text",
        "homepage": "https://baijiahao.baidu.com/",
    },
}
