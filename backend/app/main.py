from fastapi import FastAPI
from app.api.v1.workouts import router as workout_router

app = FastAPI(title="MODE Backend", version="1.0.0")

app.include_router(workout_router, prefix="/workouts", tags=["workouts"])

@app.get("/")
async def root():
    return {"message": "MODE API"}