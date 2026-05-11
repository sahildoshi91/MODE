from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.api.v1.workouts import router as workout_router
from app.core.config import settings
from app.core.startup_guards import run_startup_guards

run_startup_guards()

app = FastAPI(
    title="MODE Backend",
    version="1.0.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins_list,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=settings.cors_allow_methods_list,
    allow_headers=settings.cors_allow_headers_list,
)

app.include_router(workout_router, prefix="/workouts", tags=["workouts"])
app.include_router(api_router)

@app.get("/")
async def root():
    return {"message": "MODE API", "version": "multi-tenant foundation"}


@app.get("/healthz")
async def healthz():
    return {"ok": True}
