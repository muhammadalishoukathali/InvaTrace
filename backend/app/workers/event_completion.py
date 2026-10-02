"""Advance elapsed published events to completed exactly once."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import AuditEvent, Event


def complete_elapsed_events(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    with SessionLocal() as session:
        events = session.scalars(
            select(Event)
            .where(Event.status == "published", Event.end_at < now)
            .with_for_update(skip_locked=True)
        ).all()
        for event in events:
            event.status = "completed"
            session.add(
                AuditEvent(
                    event_type="event.completed",
                    subject_type="event",
                    subject_id=str(event.id),
                    metadata_json={"completed_at": now.isoformat()},
                )
            )
        session.commit()
        return len(events)
