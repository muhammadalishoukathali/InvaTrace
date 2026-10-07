"""Cancel hidden events that have remained unpublished to the public for too long."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.config import get_settings
from app.db.base import SessionLocal
from app.db.models import AuditEvent, Event


def cancel_stale_hidden_events(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=get_settings().event_hidden_auto_cancel_days)
    with SessionLocal() as session:
        events = session.scalars(
            select(Event)
            # Measure the 14-day window from when the event was hidden, not
            # from its last edit: a host editing the title must not keep a
            # hidden event in limbo indefinitely.
            .where(
                Event.status == "published",
                Event.hidden.is_(True),
                func.coalesce(Event.hidden_at, Event.updated_at) < cutoff,
            )
            .with_for_update(skip_locked=True)
        ).all()
        for event in events:
            event.status = "cancelled"
            session.add(
                AuditEvent(
                    event_type="event.auto_cancelled",
                    subject_type="event",
                    subject_id=str(event.id),
                    metadata_json={"cancelled_at": now.isoformat()},
                )
            )
        session.commit()
        return len(events)
