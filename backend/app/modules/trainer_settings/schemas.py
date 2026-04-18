from pydantic import BaseModel


class TrainerSettingsResponse(BaseModel):
    trainer_id: str
    default_meeting_location: str | None = None
    auto_fill_meeting_location: bool = True


class TrainerSettingsPatchRequest(BaseModel):
    default_meeting_location: str | None = None
    auto_fill_meeting_location: bool | None = None

