"""抖音发布器 — 认证模块（从 douyin.py 拆分）

负责 DouyinPublisher 的全部认证逻辑：
1. 登录扫码流程
2. cookies / localStorage / IndexedDB 三层捕获
3. 认证数据持久化（auth_{platform}.json）
4. 认证数据恢复到浏览器上下文
5. 过期检查与实际登录验证

设计模式
--------
所有函数都是 standalone async/sync 函数，第一个参数为 ``publisher``
（DouyinPublisher 实例）。这样：
- 函数无副作用依赖，便于单元测试（用 SimpleNamespace 构造 mock publisher）
- DouyinPublisher 方法变为薄委托 wrapper，公共接口保持不变
- 认证逻辑可独立演进（如未来支持其他扫码方式）

publisher 宿主对象需提供的属性：
- ``_cookie_path`` (str): 旧格式 cookies 文件路径
- ``_auth_data_path`` (str): 新格式完整认证数据文件路径
- ``_login_timeout`` (int): 登录扫码等待秒数
- ``_selectors`` (dict): CSS 选择器字典
- ``config`` (PublisherConfig): 含 data_dir / proxy_config
- ``_playwright_app``: Playwright 应用对象
- ``_context`` / ``_page``: 浏览器上下文与页面（运行时填充）
"""

from __future__ import annotations

import asyncio
import json
import os
import time

from loguru import logger

from multi_publish.publishers.legacy_auth_policy import require_legacy_plaintext_auth

# ═══════════════════════════════════════════════════════════
# 认证数据持久化（同步文件 I/O）
# ═══════════════════════════════════════════════════════════


def save_cookies(publisher, cookies: list[dict]) -> None:
    """保存 Cookie 到文件（兼容旧格式）。

    Args:
        publisher: 宿主对象，需提供 ``_cookie_path``
        cookies: Cookie 字典列表
    """
    require_legacy_plaintext_auth()
    os.makedirs(os.path.dirname(publisher._cookie_path), exist_ok=True)
    with open(publisher._cookie_path, "w") as f:
        json.dump(cookies, f)


def save_auth_data(
    publisher,
    cookies: list[dict],
    local_storage: dict,
    indexed_db: dict,
) -> None:
    """保存完整认证数据（cookies + localStorage + IndexedDB）。

    参考产品关键发现：抖音的 security-sdk 认证需要全部三层数据，
    仅保存 cookies 会导致发布时登录态频繁失效。

    Args:
        publisher: 宿主对象，需提供 ``_auth_data_path``
        cookies: Cookie 字典列表
        local_storage: localStorage 键值对
        indexed_db: IndexedDB 嵌套字典 {db_name: {store_name: {key: value}}}
    """
    require_legacy_plaintext_auth()
    os.makedirs(os.path.dirname(publisher._auth_data_path), exist_ok=True)
    auth_data = {
        "cookies": cookies,
        "local_storage": local_storage,
        "indexed_db": indexed_db,
        "captured_at": time.time(),
    }
    with open(publisher._auth_data_path, "w") as f:
        json.dump(auth_data, f, ensure_ascii=False, indent=2)


def load_cookies(publisher) -> list[dict]:
    """从文件加载 Cookie（兼容旧格式）。

    Args:
        publisher: 宿主对象，需提供 ``_cookie_path``

    Returns:
        Cookie 字典列表，文件不存在时返回空列表
    """
    require_legacy_plaintext_auth()
    if not os.path.exists(publisher._cookie_path):
        return []
    with open(publisher._cookie_path) as f:
        return json.load(f)


def load_auth_data(publisher) -> dict | None:
    """加载完整认证数据。

    优先使用新的 ``auth_{platform}.json``，不存在时回退到旧
    ``cookies_{platform}.json``。

    Args:
        publisher: 宿主对象，需提供 ``_auth_data_path`` 和 ``_cookie_path``

    Returns:
        完整认证数据字典，或 None（无任何认证文件时）
    """
    require_legacy_plaintext_auth()
    if os.path.exists(publisher._auth_data_path):
        with open(publisher._auth_data_path) as f:
            return json.load(f)
    # 兼容旧格式
    cookies = load_cookies(publisher)
    if cookies:
        return {"cookies": cookies, "local_storage": {}, "indexed_db": {}}
    return None


# ═══════════════════════════════════════════════════════════
# 认证数据捕获（async，调用 Playwright page.evaluate）
# ═══════════════════════════════════════════════════════════


async def _capture_local_storage(publisher) -> dict[str, str]:
    """从浏览器捕获 localStorage 中的所有数据。

    关键捕获项（抖音 security-sdk）：
    - security-sdk/s_sdk_crypt_sdk
    - security-sdk/s_sdk_sign_data_key/web_protect

    Args:
        publisher: 宿主对象，需提供 ``_page``

    Returns:
        localStorage 键值对字典；page.evaluate 抛异常时返回空字典
    """
    try:
        return await publisher._page.evaluate("""() => {
            const data = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                try { data[key] = localStorage.getItem(key); } catch(e) {}
            }
            return data;
        }""")
    except Exception as e:
        logger.warning(f"localStorage 捕获失败: {e}")
        return {}


async def _capture_indexed_db(publisher) -> dict[str, dict]:
    """从浏览器捕获 IndexedDB 中的数据。

    参考产品反编译发现抖音在 IndexedDB secure-store 中存储了 SDK 证书：
    - security-sdk/s_sdk_cert_key
    - security-sdk/s_sdk_sign_data_key/web_protect
    - security-sdk/s_sdk_crypt_sdk

    Args:
        publisher: 宿主对象，需提供 ``_page``

    Returns:
        ``{db_name: {store_name: {key: value, ...}}, ...}``；
        page.evaluate 抛异常时返回空字典
    """
    try:
        return await publisher._page.evaluate("""() => {
            return new Promise((resolve) => {
                const result = {};
                const dbName = 'secure-store';
                const request = indexedDB.open(dbName);

                request.onsuccess = (event) => {
                    const db = event.target.result;
                    const storeNames = Array.from(db.objectStoreNames);

                    if (storeNames.length === 0) {
                        db.close();
                        resolve({});
                        return;
                    }

                    let completed = 0;
                    storeNames.forEach((storeName) => {
                        const transaction = db.transaction(storeName, 'readonly');
                        const store = transaction.objectStore(storeName);
                        const getAllReq = store.getAll();
                        const getKeysReq = store.getAllKeys();

                        Promise.all([
                            new Promise((res) => { getAllReq.onsuccess = () => res(getAllReq.result); }),
                            new Promise((res) => { getKeysReq.onsuccess = () => res(getKeysReq.result); })
                        ]).then(([values, keys]) => {
                            if (!result[dbName]) result[dbName] = {};
                            result[dbName][storeName] = {};
                            keys.forEach((key, idx) => {
                                try {
                                    result[dbName][storeName][key] = values[idx];
                                } catch(e) {}
                            });
                            completed++;
                            if (completed === storeNames.length) {
                                db.close();
                                resolve(result);
                            }
                        }).catch(() => {
                            completed++;
                            if (completed === storeNames.length) {
                                db.close();
                                resolve(result);
                            }
                        });
                    });
                };

                request.onerror = () => resolve({});
                request.onupgradeneeded = () => resolve({});
            });
        }""")
    except Exception as e:
        logger.warning(f"IndexedDB 捕获失败: {e}")
        return {}


# ═══════════════════════════════════════════════════════════
# 登录流程
# ═══════════════════════════════════════════════════════════


async def login(publisher) -> bool:
    """打开抖音创作服务平台登录页，等待用户扫码登录后捕获完整认证数据。

    捕获范围（参考产品认证体系）：
    1. Cookies — sid_tt, sessionid, bd_ticket_guard_client_data 等
    2. localStorage — security-sdk/* 系列键
    3. IndexedDB — secure-store 存储中的 SDK 证书和签名密钥

    Args:
        publisher: 宿主对象，需提供 ``_playwright_app``, ``_selectors``,
            ``_login_timeout``, ``config``, ``_save_auth_data``,
            ``_save_cookies``, ``close``

    Returns:
        True 登录成功；False 超时或失败
    """
    logger.info("启动抖音登录流程...")

    # 注：原 douyin.py 中此处有 bug —
    #   os.path.join(self.config.data_dir, "browser_data", proxy=self.proxy_config)
    # os.path.join 不接受关键字参数，运行时会抛 TypeError。修复方式：把 proxy
    # 移到 launch_persistent_context 的 kwargs 中。
    launch_kwargs: dict = {
        "user_data_dir": publisher._get_browser_data_dir(),
        "headless": False,
        "viewport": {"width": 1280, "height": 800},
    }
    proxy = getattr(publisher, "proxy_config", None)
    if proxy:
        launch_kwargs["proxy"] = proxy

    publisher._context = await publisher._playwright_app.chromium.launch_persistent_context(**launch_kwargs)

    publisher._page = await publisher._context.new_page()

    await publisher._page.goto("https://creator.douyin.com/", wait_until="domcontentloaded")
    logger.info("请在浏览器中扫码登录抖音创作服务平台...")

    start = time.time()
    logged_in = False

    while time.time() - start < publisher._login_timeout:
        try:
            current_url = publisher._page.url
            if "creator.douyin.com" in current_url and "/login" not in current_url:
                avatar_exists = await publisher._page.locator(
                    publisher._selectors["login_avatar"]
                ).count()
                if avatar_exists > 0:
                    logged_in = True
                    break

            dash_exists = await publisher._page.locator(
                publisher._selectors["login_success_indicator"]
            ).count()
            if dash_exists > 0 and "creator.douyin.com" in current_url:
                logged_in = True
                break
        except Exception:
            pass

        await asyncio.sleep(2)

    if not logged_in:
        logger.error("登录超时，未能检测到登录状态")
        await publisher.close()
        return False

    logger.info("登录成功，正在捕获认证数据（cookies + localStorage + IndexedDB）...")

    # ─── 捕获完整认证数据 ──────────────────────────────
    cookies = await publisher._context.cookies()

    local_storage = await _capture_local_storage(publisher)
    indexed_db = await _capture_indexed_db(publisher)

    # 保存完整认证数据
    save_auth_data(publisher, cookies, local_storage, indexed_db)

    # 兼容旧格式（仅 cookies）
    save_cookies(publisher, cookies)

    ls_count = len(local_storage)
    idb_count = sum(len(v) for v in indexed_db.values()) if indexed_db else 0
    logger.info(
        f"认证数据已保存: {len(cookies)} cookies, {ls_count} localStorage items, {idb_count} IndexedDB items"
    )

    await publisher._context.close()
    publisher._context = None

    return True


# ═══════════════════════════════════════════════════════════
# 认证数据恢复
# ═══════════════════════════════════════════════════════════


async def restore_auth_data(publisher) -> bool:
    """恢复完整认证数据到浏览器上下文。

    恢复顺序（与参考产品一致）：
    1. 写入 cookies
    2. 写入 localStorage
    3. 写入 IndexedDB
    4. 页面重载

    Args:
        publisher: 宿主对象，需提供 ``_context``, ``_page``，
            以及 ``_load_auth_data`` 方法（或调用方先调用 load_auth_data）

    Returns:
        True 恢复成功；False 文件不存在或外层异常
    """
    auth_data = load_auth_data(publisher)
    if not auth_data:
        return False

    try:
        # 1. 恢复 cookies
        if auth_data.get("cookies"):
            await publisher._context.add_cookies(auth_data["cookies"])

        # 2. 恢复 localStorage
        if auth_data.get("local_storage"):
            try:
                await publisher._page.evaluate(
                    """(data) => {
                    for (const [key, value] of Object.entries(data)) {
                        try { localStorage.setItem(key, value); } catch(e) {}
                    }
                }""",
                    auth_data["local_storage"],
                )
            except Exception as e:
                logger.warning(f"localStorage 恢复失败（不影响发布）: {e}")

        # 3. 恢复 IndexedDB
        if auth_data.get("indexed_db"):
            try:
                await publisher._page.evaluate(
                    """(data) => {
                    return new Promise((resolve) => {
                        const allPromises = [];
                        for (const [dbName, stores] of Object.entries(data)) {
                            const request = indexedDB.open(dbName);
                            allPromises.push(new Promise((res) => {
                                request.onsuccess = (event) => {
                                    const db = event.target.result;
                                    let completed = 0;
                                    const storeNames = Object.keys(stores);
                                    if (storeNames.length === 0) { db.close(); res(); return; }
                                    storeNames.forEach((storeName) => {
                                        try {
                                            const transaction = db.transaction(storeName, 'readwrite');
                                            const store = transaction.objectStore(storeName);
                                            const items = stores[storeName];
                                            for (const [key, value] of Object.entries(items)) {
                                                try { store.put(value, key); } catch(e) {}
                                            }
                                            transaction.oncomplete = () => {
                                                completed++;
                                                if (completed === storeNames.length) { db.close(); res(); }
                                            };
                                        } catch(e) {
                                            completed++;
                                            if (completed === storeNames.length) { db.close(); res(); }
                                        }
                                    });
                                    // Fallback if no valid stores
                                    setTimeout(() => { db.close(); res(); }, 3000);
                                };
                                request.onerror = () => res();
                                request.onupgradeneeded = () => res();
                            }));
                        }
                        Promise.all(allPromises).then(() => resolve());
                    });
                }""",
                    auth_data["indexed_db"],
                )
            except Exception as e:
                logger.warning(f"IndexedDB 恢复失败（不影响发布）: {e}")

        return True

    except Exception as e:
        logger.warning(f"认证数据恢复失败: {e}")
        return False


# ═══════════════════════════════════════════════════════════
# 认证状态检查
# ═══════════════════════════════════════════════════════════


async def check_auth(publisher) -> bool:
    """检查认证数据是否有效。

    检查层次（对应三层认证体系）：
    1. 认证文件是否存在
    2. 文件是否过期（7天阈值）
    3. 实际登录验证（RPA 页面测试）

    Args:
        publisher: 宿主对象，需提供 ``_playwright_app``, ``config``，
            以及 ``_load_auth_data`` 方法

    Returns:
        True 认证有效；False 文件缺失/已过期/登录验证失败
    """
    auth_data = load_auth_data(publisher)
    if not auth_data:
        return False

    # 检查是否有足够的认证数据
    has_essential = bool(auth_data.get("cookies"))
    if not has_essential:
        return False

    # 检查过期时间
    captured_at = auth_data.get("captured_at", 0)
    days_old = (time.time() - captured_at) / 86400
    if days_old > 7:
        logger.info(f"认证数据已 {days_old:.0f} 天未更新，建议重新登录")
        return False

    # 实际验证：尝试用认证数据访问首页
    try:
        ctx = await publisher._playwright_app.chromium.launch_persistent_context(
            user_data_dir=publisher._get_browser_data_dir(check=True),
            headless=True,
        )
        page = await ctx.new_page()
        await page.goto("https://creator.douyin.com/", wait_until="domcontentloaded")

        if auth_data.get("cookies"):
            await ctx.add_cookies(auth_data["cookies"])
            await page.reload()
            await asyncio.sleep(3)

        current_url = page.url
        logged_in = "creator.douyin.com" in current_url and "/login" not in current_url
        await ctx.close()
        return logged_in
    except Exception:
        return False
