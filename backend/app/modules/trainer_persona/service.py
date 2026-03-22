from app.modules.trainer_persona.repository import TrainerPersonaRepository
from app.modules.trainer_persona.schemas import TrainerPersona


class TrainerPersonaService:
    def __init__(self, repository: TrainerPersonaRepository):
        self.repository = repository

    def list_personas(self, trainer_id: str) -> list[TrainerPersona]:
        return [TrainerPersona(**row) for row in self.repository.list_by_trainer(trainer_id)]

    def create_persona(self, trainer_id: str, persona: TrainerPersona) -> TrainerPersona:
        payload = persona.model_dump()
        payload["trainer_id"] = trainer_id
        created = self.repository.create(payload)
        return TrainerPersona(**created)
