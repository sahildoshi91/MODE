from fastapi import FastAPI
from app.api.v1 import api_router
from app.api.v1.workouts import router as workout_router

app = FastAPI(title="MODE Backend", version="1.0.0")

app.include_router(workout_router, prefix="/workouts", tags=["workouts"])
app.include_router(api_router)

@app.get("/")
async def root():
    return {"message": "MODE API", "version": "multi-tenant foundation"}


@app.get("/healthz")
async def healthz():
    return {"ok": True}
