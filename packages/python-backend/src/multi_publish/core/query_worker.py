"""
QueryWorker — 平台插件化架构

每个平台一个 Worker 类，统一查询接口。
与 BasePublisher 分离：Publisher = 发布，QueryWorker = 查询/验证/数据拉取。

架构参考：参考产品 QueryWorker 模式
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from multi_publish.models import PlatformType

# ============================================================
# 数据模型
# ============================================================


@dataclass
class AuditStatus:
    """发布审核状态"""

    publish_id: str = ""  # 平台侧发布 ID
    doc_id: str = ""  # 文档/作品 ID
    status: str = "unknown"  # inAudit | published | denied | draft | waitExecute
    open_url: str = ""  # 发布后的访问链接
    open_urls: list[str] = field(default_factory=list)  # 多图/多视频链接
    msg: str = ""  # 状态描述/失败原因
    code: int = 0  # 0=正常, 其他=异常
    audit_status: str = "unknown"  # 原始审核状态码


class AuditStatusEnum:
    """审核状态枚举（与参考产品对齐）"""

    IN_AUDIT = "inAudit"  # 审核中
    PUBLISHED = "published"  # 已发布
    DENIED = "denied"  # 审核不通过
    DRAFT = "draft"  # 草稿
    PRE_PUBLISH = "prePublish"  # 预发布/定时发布
    WAIT_EXECUTE = "waitExecute"  # 等待执行
    NOT_PUBLIC = "notPublic"  # 不公开
    NOT_SUITABLE = "notSuitable"  # 不适合公开
    WITHDRAWN = "withdrawn"  # 已撤回
    UNKNOWN = "unknown"  # 未知


@dataclass
class PlatformUserInfo:
    """平台用户信息"""

    platform: str
    account_id: str = ""
    nick_name: str = ""
    avatar: str = ""
    publish_check: bool = False
    identity_verified: bool = False
    raw: dict = field(default_factory=dict)


@dataclass
class TopicInfo:
    """话题标签"""

    name: str
    id: str = ""
    hot: int = 0


@dataclass
class MusicInfo:
    """音乐素材"""

    id: str = ""
    title: str = ""
    artist: str = ""
    url: str = ""
    duration: int = 0


@dataclass
class LocationInfo:
    """位置/城市信息"""

    id: str = ""
    name: str = ""
    address: str = ""
    lat: float = 0.0
    lng: float = 0.0


@dataclass
class ContentItem:
    """已发布内容条目"""

    id: str = ""
    title: str = ""
    cover: str = ""
    type: str = "article"  # article | video | image
    status: str = ""
    create_time: str = ""
    page_url: str = ""
    views: int = 0
    likes: int = 0
    comments: int = 0


@dataclass
class AccountOverview:
    """账号概览数据"""

    platform: str = ""
    fans_count: int = 0
    total_views: int = 0
    total_likes: int = 0
    total_comments: int = 0
    total_published: int = 0
    raw: dict = field(default_factory=dict)


# ============================================================
# 抽象基类
# ============================================================


class QueryWorker(ABC):
    """
    平台查询工作器

    每个平台必须实现以下接口，用于查询账号状态和信息。
    与 BasePublisher 分离，职责明确：
      - BasePublisher: 发布内容
      - QueryWorker: 查询信息、验证状态
    """

    def __init__(self, cookie: str, local_storage: dict | None = None):
        self.cookie = cookie
        self.local_storage = local_storage or {}

    @property
    @abstractmethod
    def platform(self) -> PlatformType:
        """返回平台类型"""
        ...

    def refresh_cookie(self, cookie: str, local_storage: dict | None = None):
        """刷新登录凭证"""
        self.cookie = cookie
        if local_storage:
            self.local_storage = local_storage

    # ========== 核心接口 ==========

    @abstractmethod
    async def get_user_info(self) -> dict:
        """
        获取用户信息

        Returns:
            { code, msg, sourceId, sourceName, userAvatarUrl, ... }
        """
        ...

    @abstractmethod
    async def check_account_alive(self) -> int:
        """
        检查账号登录状态

        Returns:
            0 = 有效, 1 = 已过期, -1 = 异常
        """
        ...

    @abstractmethod
    async def check_audit_status(
        self,
        publish_id: str,
        content_type: str = "article",
        proxy: Any = None,
    ) -> AuditStatus:
        """
        查询发布内容的审核状态

        Args:
            publish_id: 平台侧的发布 ID
            content_type: 内容类型 (article | video | imageText | dynamic)
            proxy: 代理配置

        Returns:
            AuditStatus
        """
        ...

    @abstractmethod
    async def delete_content(
        self,
        doc_id: str,
        publish_id: str = "",
        proxy: Any = None,
    ) -> dict:
        """
        删除已发布内容

        Returns:
            { code, msg }
        """
        ...

    @abstractmethod
    async def search_topic(
        self,
        keyword: str,
        proxy: Any = None,
        limit: int = 10,
    ) -> list[TopicInfo]:
        """
        搜索话题/标签

        Returns:
            [TopicInfo, ...]
        """
        ...

    # ========== 可选接口 ==========

    async def search_music(
        self,
        keyword: str,
        limit: int = 20,
    ) -> list[MusicInfo]:
        """搜索音乐素材"""
        return []

    async def get_location_city(
        self,
        keyword: str,
        proxy: Any = None,
    ) -> list[LocationInfo]:
        """搜索地理位置"""
        return []

    async def search_content_list(
        self,
        page: int = 1,
        page_size: int = 20,
        days: int = 7,
        proxy: Any = None,
    ) -> dict:
        """
        获取已发布内容列表

        Returns:
            { code, msg, data: [ContentItem, ...], total }
        """
        return {"code": 0, "msg": "not implemented", "data": [], "total": 0}

    async def get_shopping_privilege(self) -> dict:
        """检测带货权限"""
        return {"code": 0, "msg": "not implemented", "hasPrivilege": False}

    async def get_overview_data(self) -> AccountOverview:
        """获取账号概览数据（粉丝、阅读等）"""
        return AccountOverview(platform=self.platform.value)


# ============================================================
# Factory
# ============================================================


class QueryWorkerFactory:
    """QueryWorker 工厂 — 根据平台类型创建对应的 Worker"""

    _registry: dict[str, type[QueryWorker]] = {}

    @classmethod
    def register(cls, platform: str):
        """注册 Worker 类"""

        def wrapper(worker_cls: type[QueryWorker]):
            cls._registry[platform] = worker_cls
            return worker_cls

        return wrapper

    @classmethod
    def create(
        cls,
        platform: str,
        cookie: str,
        local_storage: dict | None = None,
    ) -> QueryWorker:
        """
        创建平台对应的 QueryWorker

        Args:
            platform: 平台名称 (PlatformType.value)
            cookie: 登录凭证
            localStorage: localStorage 数据（某些平台需要）

        Returns:
            QueryWorker 实例

        Raises:
            ValueError: 不支持的平台
        """
        worker_cls = cls._registry.get(platform)
        if not worker_cls:
            # 返回默认的不支持提示
            raise ValueError(f"不支持的平台: {platform}")

        return worker_cls(cookie, local_storage)

    @classmethod
    def supports(cls, platform: str) -> bool:
        """检查是否支持指定平台"""
        return platform in cls._registry

    @classmethod
    def list_supported(cls) -> list[str]:
        """列出所有支持的平台"""
        return list(cls._registry.keys())
