from fastapi import APIRouter

from app.api.v1.chat import router as chat_router
from app.api.v1.checkin import router as checkin_router
from app.api.v1.plans import router as plans_router
from app.api.v1.profiles import router as profiles_router
from app.api.v1.trainer_assignment import router as trainer_assignment_router
from app.api.v1.trainer_clients import router as trainer_clients_router
from app.api.v1.trainer_home import router as trainer_home_router
from app.api.v1.trainer_knowledge import router as trainer_knowledge_router
from app.api.v1.trainer_personas import router as trainer_personas_router
from app.api.v1.trainer_review import router as trainer_review_router
from app.api.v1.workouts import router as workouts_router


api_router = APIRouter(prefix="/api/v1")
api_router.include_router(chat_router, prefix="/chat", tags=["chat"])
api_router.include_router(checkin_router, prefix="/checkin", tags=["checkin"])
api_router.include_router(profiles_router, prefix="/profiles", tags=["profiles"])
api_router.include_router(plans_router, prefix="/plans", tags=["plans"])
api_router.include_router(workouts_router, prefix="/workouts", tags=["workouts"])
api_router.include_router(trainer_assignment_router, prefix="/trainer-assignment", tags=["trainer-assignment"])
api_router.include_router(trainer_home_router, prefix="/trainer-home", tags=["trainer-home"])
api_router.include_router(trainer_clients_router, prefix="/trainer-clients", tags=["trainer-clients"])
api_router.include_router(trainer_personas_router, prefix="/trainer-personas", tags=["trainer-personas"])
api_router.include_router(trainer_knowledge_router, prefix="/trainer-knowledge", tags=["trainer-knowledge"])
api_router.include_router(trainer_review_router, prefix="/trainer-review", tags=["trainer-review"])
