from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ScreenContext(BaseModel):
    active_tab: str | None = None
    viewer_role: str | None = None
    route_name: str | None = None
    trainer_id: str | None = None
    client_id: str | None = None
    session_id: str | None = None


class DebugContext(BaseModel):
    app_version: str | None = None
    build: str | None = None
    platform: str | None = None
    device: str | None = None
    api_base_url: str | None = None
    timestamp: str | None = None


class CreateFeedbackReportRequest(BaseModel):
    report_type: Literal["bug", "feature_request", "feedback"]
    summary: str = Field(min_length=1, max_length=2000)
    steps_to_reproduce: str | None = Field(default=None, max_length=4000)
    screen_context: ScreenContext = Field(default_factory=ScreenContext)
    debug_context: DebugContext = Field(default_factory=DebugContext)
    screenshot_bucket: str | None = None
    screenshot_object_path: str | None = None


class FeedbackReportResponse(BaseModel):
    id: str
    report_type: str
    summary: str
    status: str
    created_at: str


class AdminUpdateReportRequest(BaseModel):
    status: Literal["open", "in_review", "resolved", "dismissed"] | None = None
    admin_notes: str | None = Field(default=None, max_length=8000)


class AdminFeedbackReportResponse(FeedbackReportResponse):
    steps_to_reproduce: str | None = None
    screen_context: dict[str, Any]
    debug_context: dict[str, Any]
    screenshot_bucket: str | None = None
    screenshot_object_path: str | None = None
    admin_notes: str | None = None
    last_reviewed_by: str | None = None
    updated_at: str
    user_id: str


class AdminScreenshotUrlResponse(BaseModel):
    signed_url: str
    expires_in: int
