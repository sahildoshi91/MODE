from pydantic import BaseModel


class TrainerSettingsResponse(BaseModel):
    trainer_id: str
    default_meeting_location: str | None = None
    auto_fill_meeting_location: bool = True
    assistant_display_name: str | None = None


class TrainerSettingsPatchRequest(BaseModel):
    default_meeting_location: str | None = None
    auto_fill_meeting_location: bool | None = None
    assistant_display_name: str | None = None
