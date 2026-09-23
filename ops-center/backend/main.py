"""OpsCenter — FastAPI application entry point."""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import init_db
from routers import config, sync, secrets, snapshots, env, model_presets, auth, runtime, usage, licenses, health, feature_flags, platform_defs, content_templates, publish_metrics, redemption_codes, keyword_watchlist, pipeline_dependencies, diagnostics, scheduler, scene_context, prompt_eval, feedback, pipeline_options, quality_eval, rewrite_strategies, app_menu, rewrite_hard_constraints




from services.model_preset_service import ensure_catalog_seeded, ensure_model_preset_columns
from services.key_service import ensure_official_key_columns
from services.platform_def_service import ensure_platform_def_seeded
from services.content_template_service import ensure_content_templates_seeded
from services.rewrite_strategy_service import ensure_rewrite_strategies_seeded
from services.rewrite_hard_constraint_service import ensure_rewrite_hard_constraints_seeded
from services.pipeline_dependency_service import ensure_pipeline_deps_seeded
from services.scheduler_service import ensure_scheduler_verification_table
from services.usage_migration import ensure_usage_columns
from services.prompt_eval_migration import ensure_prompt_eval_scene_columns, ensure_prompt_eval_dual_columns, ensure_prompt_eval_video_columns, ensure_provider_default_column
from services.auth_service import ensure_admin_seeded
from services.config_seed_service import ensure_feature_gates_seeded, ensure_projects_seeded
from services.feature_flag_service import ensure_feature_flags_seeded
from services.quality.service import ensure_quality_eval_table
from database import async_session

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("ops-center")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init DB. Shutdown: cleanup."""
    settings.validate_security()
    logger.info("Initializing database...")
    await init_db()
    # 模型预设表：存量库补充新列（models_url/rate_per_minute/limit_per_5h）并补齐种子（不覆盖用户修改）
    async with async_session() as db:
        await ensure_model_preset_columns(db)
        await ensure_official_key_columns(db)
        await ensure_catalog_seeded(db)
        await ensure_platform_def_seeded(db)
        await ensure_content_templates_seeded(db)
        await ensure_rewrite_strategies_seeded(db)
        await ensure_rewrite_hard_constraints_seeded(db)
        await ensure_pipeline_deps_seeded(db)
        await ensure_scheduler_verification_table(db)
        await ensure_usage_columns(db)
        await ensure_prompt_eval_scene_columns(db)
        await ensure_prompt_eval_dual_columns(db)
        await ensure_prompt_eval_video_columns(db)
        await ensure_provider_default_column(db)
        await ensure_admin_seeded(db)
        await ensure_projects_seeded(db)
        await ensure_feature_gates_seeded(db)
        await ensure_feature_flags_seeded(db)
        await ensure_quality_eval_table()
    logger.info("OpsCenter ready")
    yield
    logger.info("OpsCenter shutting down")


app = FastAPI(
    title="OpsCenter",
    description="一站式运营配置中心",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# P1-15：统一安全响应头。后端同时服务 API 与（反向代理后面的）静态资源，
# 即便 SPA 由 nginx 托管，这里也保证「直连后端端口」不会漏发头。
# CSP 为空字符串时显式不下发（交由 CDN / nginx 统一下发，避免双重头导致浏览器取交集后失效）。
@app.middleware("http")
async def security_headers(request, call_next):
    """下发 CSP / X-Content-Type-Options / Referrer-Policy / X-Frame-Options。

    - ``Content-Security-Policy``：default-src 'self' 起步，配合 ``frame-ancestors 'none'``
      阻断被点击劫持嵌框；``object-src 'none'`` / ``base-uri 'self'`` / ``form-action 'self'``
      封死插件、<base> 劫持与表单重定向这三条经典 XSS 落地路径。
    - ``X-Content-Type-Options: nosniff``：禁止把 JSON 响应嗅探成脚本（旧版 IE/兜底攻击面）。
    - ``Referrer-Policy: no-referrer``：避免带 token 的 URL 经 Referer 外泄给第三方。
    - ``X-Frame-Options: DENY``：为不支持 CSP 的老浏览器保留的嵌框兜底。
    """
    response = await call_next(request)
    csp = (settings.content_security_policy or "").strip()
    if csp:
        response.headers.setdefault("Content-Security-Policy", csp)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    frame_options = (settings.x_frame_options or "").strip()
    if frame_options:
        response.headers.setdefault("X-Frame-Options", frame_options)
    return response

# Routers
app.include_router(config.router)
app.include_router(sync.router)
app.include_router(secrets.router)
app.include_router(snapshots.router)
app.include_router(env.router)
app.include_router(model_presets.router)
app.include_router(runtime.router)
app.include_router(usage.router)
app.include_router(diagnostics.router)
app.include_router(licenses.router)
app.include_router(health.router)
app.include_router(feature_flags.router)
app.include_router(scene_context.router)
app.include_router(platform_defs.router)
app.include_router(publish_metrics.router)
app.include_router(keyword_watchlist.router)
app.include_router(pipeline_dependencies.router)
app.include_router(scheduler.router)
app.include_router(redemption_codes.router)
app.include_router(prompt_eval.router)
app.include_router(feedback.router)
app.include_router(quality_eval.router)

app.include_router(content_templates.router)
app.include_router(pipeline_options.router)
app.include_router(rewrite_strategies.router)
app.include_router(rewrite_hard_constraints.router)
app.include_router(app_menu.router)



app.include_router(auth.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ops-center", "version": "0.1.0"}


# Run: uvicorn main:app --reload --port 8010
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8010, reload=True)





# P0: Run security gates on startup (fail-closed)
from config import run_startup_security_checks, settings as _p0_settings

@app.on_event("startup")
async def _p0_startup_gates():
    run_startup_security_checks(_p0_settings)
    logger.info("[P0] Startup security checks passed.")
