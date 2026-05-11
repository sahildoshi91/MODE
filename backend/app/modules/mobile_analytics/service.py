from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.auth import AuthenticatedUser
from app.modules.mobile_analytics.repository import MobileAnalyticsRepository
from app.modules.onboarding.schemas import AnalyticsEventsRequest, AnalyticsEventsResponse


class MobileAnalyticsService:
    MAX_EVENTS_PER_REQUEST = 100

    def __init__(self, repository: MobileAnalyticsRepository):
        self.repository = repository

    def ingest_events(
        self,
        *,
        user: AuthenticatedUser,
        request: AnalyticsEventsRequest,
    ) -> AnalyticsEventsResponse:
        accepted_rows: list[dict[str, Any]] = []
        for event in (request.events or [])[: self.MAX_EVENTS_PER_REQUEST]:
            name = str(event.name or "").strip()
            if not name:
                continue
            accepted_rows.append(
                {
                    "user_id": user.id,
                    "event_name": name,
                    "event_timestamp": (
                        event.event_timestamp.astimezone(timezone.utc).isoformat()
                        if event.event_timestamp
                        else datetime.now(timezone.utc).isoformat()
                    ),
                    "session_id": event.session_id,
                    "properties": event.properties or {},
                }
            )

        if not accepted_rows:
            return AnalyticsEventsResponse(accepted=0)

        try:
            inserted = self.repository.insert_events(rows=accepted_rows)
        except Exception:
            # Analytics should be non-blocking for mobile clients.
            return AnalyticsEventsResponse(accepted=0)

        return AnalyticsEventsResponse(accepted=inserted)
