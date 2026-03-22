from app.modules.profile.repository import ProfileRepository
from app.modules.profile.schemas import FitnessProfile


class ProfileService:
    def __init__(self, repository: ProfileRepository):
        self.repository = repository

    def get_or_create_profile(self, client_id: str) -> dict:
        profile = self.repository.get_by_client_id(client_id)
        if profile:
            return profile
        return self.repository.create_empty(client_id)

    def get_profile_model(self, client_id: str) -> FitnessProfile:
        return FitnessProfile(**self.get_or_create_profile(client_id))

    def upsert_profile_patch(self, client_id: str, fields: dict) -> FitnessProfile:
        self.get_or_create_profile(client_id)
        updated = self.repository.update_fields(client_id, fields)
        merged = {**self.get_or_create_profile(client_id), **updated}
        return FitnessProfile(**merged)
