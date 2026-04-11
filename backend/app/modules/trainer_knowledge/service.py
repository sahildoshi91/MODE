from app.modules.trainer_knowledge.repository import TrainerKnowledgeRepository
from app.modules.trainer_knowledge.schemas import TrainerKnowledgeDocument, TrainerKnowledgeDocumentCreate


class TrainerKnowledgeService:
    def __init__(self, repository: TrainerKnowledgeRepository):
        self.repository = repository

    def list_documents(self, trainer_id: str) -> list[TrainerKnowledgeDocument]:
        return [TrainerKnowledgeDocument(**row) for row in self.repository.list_by_trainer(trainer_id)]

    def create_document(self, trainer_id: str, document: TrainerKnowledgeDocumentCreate) -> TrainerKnowledgeDocument:
        payload = document.model_dump()
        payload["trainer_id"] = trainer_id
        created = self.repository.create(payload)
        return TrainerKnowledgeDocument(**created)
