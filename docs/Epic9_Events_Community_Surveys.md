# Epic 9.0 — Community Survey Events & Repeat Monitoring

> Backlog spec for the **Events** feature, written in the InvaTrace / FIT5120 TM10 board house style
> (Epic → User Story → Acceptance Criteria). Source material: `Events_SDG15_Visual_Brief.html`
> (team Events proposal) + `FIT5120 2026S2 TM10.csv` (current board export, epics 1.0–6.0).
>
> **Numbering note:** the board currently tops out at **Epic 6.0**. This document is numbered **9.0**
> as requested. If Events should follow the sequence, do a find-and-replace of `9.` → `7.` (epic, all
> `US 9.x`, all `AC 9.x.x`). Nothing else changes.

---

## 1. Epic card

**Card type:** Epic · **Title:** `Epic 9.0: Community Survey Events & Repeat Monitoring`

> **Goal:** Let any InvaTrace user host a local event at a place, choosing what it is for — a survey to
> find and record invasive plants, a safe removal, a monitoring revisit, or another activity they
> describe. Others discover it near a place they care about, join it, check in on the day, record what
> they find through the existing scan and report flow, and return to monitor the area afterwards. Events
> turn one-off willingness to help into organised activity and repeated monitoring that support SDG 15
> target 15.8, without treating attendance or record counts as proof of ecological improvement. Whatever
> the type, finding and recording is always available, and joining or hosting an event never grants
> blanket permission to remove a plant — a removal event still runs the existing Epic 3.0 safe-response
> and permission checks, per person and per location.

**Persona (from the Events brief):** the everyday nature-enthusiast user — **Aina**, "a contributor who
cares about local green spaces," who enjoys nature but worries about identifying the wrong plant or
responding unsafely. This is the same "nature enthusiast" role used throughout Epics 1.0–6.0. There is
**no separate organiser role**: hosting an event is an action any user can take. The host is identified
only by the optional display name on their Epic 2.0 anonymous profile (which may be skipped — shown as
"Community host" when unset).

**MoSCoW at epic level:** Proposed extension for Iteration 3. Validate with a small pilot before broad
release (per the Events brief). During the pilot, hosting may be soft-limited for safety, but in the
product hosting is a user capability, not a privileged role.

---

## 2. Why this is an epic (context & boundaries)

**What it builds on (no new identity or data-collection model):**

| Reused capability | From | Events uses it for |
|---|---|---|
| Anonymous identity (`public_token`, `recovery_key`, no PII) | Epic 2.0 | Joining, check-in and event-linked reports are tied to the active anonymous identity — no email, name or password. |
| Scan → classify → Malaysian status | Epic 1.0 | On-site identification during an event. A scan still never becomes a public report automatically. |
| Report submission + automated screening | Epic 4.0 / 2.0 | Event observations are ordinary screened community reports, tagged with `event_id`. |
| Safe-response guidance + protected-area / location context | Epic 3.0 | Safety and permission guidance stays visible during events; a removal-type event surfaces the full safe-response steps and per-location permission checks. |
| Places, geometry, catalogue | Epic 5.0 | An event is anchored to a supported place (`place_id`) and target species (`species_id`). |
| Adopted areas + monitoring indicators | Epic 6.0 | After an event, users can adopt/follow the area and see later community activity. |

**Scope boundaries (what Events is NOT):**

- An event has a **type the host chooses** (survey, removal, monitoring or other). The type sets the
  on-site task and guidance, but never changes the safety model: joining, checking in or attending — even
  a removal event — is **not** authorisation to act on any plant. Any removal still runs the Epic 3.0
  permission and protected-area checks per person and per location. (Epic 3.0 permission model is unchanged.)
- Event summaries report **counts of community activity only** — never ecological improvement, eradication,
  invasion density or a recovery score. (Consistent with Epic 6.0 monitoring language.)
- Event-linked observations are **community-reported, not expert-verified**, and still pass Epic 2.0/4.0
  screening. Screening is **event-aware, not bypassed**: exact-image and completeness checks are unchanged,
  but the spatial near-duplicate merge and the anti-spam rate limit are scoped so that many participants
  observing the same area in the same session are not wrongly merged or throttled (see AC 9.4.3 and AC 9.4.6).
- Capacity is an **optional, informational** field only — the MVP does not enforce a waitlist or headcount.
  Sharing an event's findings outside the app is a **Could-Have** for a later iteration, not MVP.
- The MVP does **not** add messaging, payments, ticketing, or public exposure of who attended.
  Participation is private to the anonymous identity. Because any user can host, hosting is kept safe by a
  per-identity cap on live events and a participant "report this event" control (US 9.6).

**SDG 15 mapping (target 15.8 — prevent, reduce impact of, and control invasive alien species):**

- *Proposed action* → Organise activity — surveys, removals or monitoring — at a place, time and purpose people can plan around.
- *Expected output* → Useful records (event-linked observations feed ongoing monitoring).
- *Potential long-term contribution* → Help identify places needing further observation or response.
- *Stated boundary* → Attendance and record counts do not directly prove ecological improvement.

---

## 3. Data model & API surface (implied)

New relational tables (no external dataset required for the events layer itself — same pattern as
adopted-areas in Epic 6.0):

- `events` — `event_id`, `host_identity_id` (the anonymous user who created it — no organiser role/flag), `place_id` (FK → Places),
  `event_type` (`survey` | `removal` | `monitoring` | `other`), `title`, `purpose`,
  `target_species_ids[]`, `meeting_lat`, `meeting_lon`, `meeting_note`, `start_at`, `end_at`,
  `safety_notes`, `permission_context` (`unknown` | `explicit_permission`), `chat_link` (nullable, host-provided external URL),
  `capacity` (nullable, informational),
  `hidden` (bool, default false — set by moderation), `status`
  (`draft` | `published` | `cancelled` | `completed`), `created_at`, `geometry_version`.
- `event_participants` — `participation_id`, `event_id`, `anonymous_identity_id`, `joined_at`,
  `status` (`joined` | `withdrawn`). Unique on (`event_id`, `anonymous_identity_id`).
- `event_checkins` — `checkin_id`, `event_id`, `anonymous_identity_id`, `checked_in_at`, `lat`,
  `lon`, `accuracy_m`.
- `reports` gains a nullable `event_id` FK (an ordinary report that was captured during an event).
- `event_flags` — `flag_id`, `event_id`, `reporter_identity_id`, `reason`, `created_at` (participant reports of a concerning event).

**Migration & regression note:** Events add new tables plus a nullable `event_id` on `reports`; this needs
a database migration signed off by the data owner. Because `POST /api/v1/reports` gains an optional
`event_id`, the existing Epic 4.0 report path must be regression-tested — a report submitted with no
`event_id` must behave exactly as before.

Endpoint summary:

```
GET    /api/v1/events?bbox={w,s,e,n}&from={iso}&to={iso}&species_id={optional}   discover on map
GET    /api/v1/places/{place_id}/events                                          events for a place
GET    /api/v1/events/{event_id}                                                 one event detail
POST   /api/v1/events/{event_id}/participants                                    join (anonymous)
DELETE /api/v1/events/{event_id}/participants/{participation_id}                 withdraw
POST   /api/v1/events/{event_id}/check-in                                        on-site check-in (fresh GPS)
POST   /api/v1/reports                       (existing, now accepts event_id)    event-linked observation
GET    /api/v1/events/{event_id}/summary                                         post-event outcome
POST   /api/v1/events            (any signed-in user → becomes host)             create / publish
PATCH  /api/v1/events/{event_id} (host only — ownership check)                   edit
DELETE /api/v1/events/{event_id} (host only — ownership check)                   cancel
POST   /api/v1/events/{event_id}/flag        (any signed-in user)                report a concerning event
```

---

## 4. User stories & acceptance criteria

Seven stories cover the full journey for one nature-enthusiast persona (Aina), on the same user role
(no organiser persona):

- **Participant flow:** discover (9.1) → view & join (9.2) → check in on-site (9.3) → scan & submit an
  event-linked observation (9.4) → review the outcome & revisit the area (9.5).
- **Host flow (same persona, step 0):** create and publish an event (9.6) → set the place, task and
  safety notes → run the session.
- **Keeping it healthy (9.7):** cancel, per-identity hosting cap, report a concerning event, and
  automatic completion after the event ends.

Check-in (9.3) is the gate that lets an observation be tagged to an event; without it a user can still
submit an ordinary report, so reporting is never blocked.

| ID | Story | MoSCoW |
|---|---|---|
| US 9.1 | Discover nearby invasive-plant survey events | Must Have |
| US 9.2 | View an event and join it anonymously | Must Have |
| US 9.3 | Check in on the day of the event | Must Have |
| US 9.4 | Submit event-linked observations | Must Have |
| US 9.5 | Review the event outcome and revisit the area | Should Have |
| US 9.6 | Host and publish an event | Must Have |
| US 9.7 | Keep the event list safe and current | Must Have |

---

### US 9.1: Discover nearby invasive-plant survey events

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Must Have

**As a** nature enthusiast who cares about a local green space
**I want** to find upcoming invasive-plant survey events near a park, forest or trail I follow
**So that** I have a clear reason and a clear next step to take part instead of only browsing the map alone

**Description**  Published events appear on the shared map and in an accessible list, anchored to a
supported place from Epic 5.0. Each result shows the essentials needed to decide whether to attend —
place, date, time, event type (survey, removal, monitoring or other) and target species — and is clearly
labelled as a community activity, not an official government operation.

**Data or system dependency**  Relational `events` records; stored place geometry and names from the
Epic 5.0 Places dataset (Geofabrik Malaysia / Singapore / Brunei OSM extract); no personal data.

**API and implementation contract**  `GET /api/v1/events?bbox={west,south,east,north}&from={iso}&to={iso}&species_id={optional}`
returns `event_id`, `title`, `event_type`, `place_id`, `place_name`, `start_at`, `end_at`, `meeting_lat`,
`meeting_lon`, `target_species` summary and `status`. Only `status = published` events are returned.
`GET /api/v1/places/{place_id}/events` returns the same shape scoped to one place. Invalid bbox: HTTP 400.

**Acceptance criteria**

**AC 9.1.1 Show only published, upcoming events**
> **Given** the user opens the shared map or an event list
> **When** events are requested for the visible area and date range
> **Then** only events with `status = published` and an `end_at` in the future are shown, each with its
> title, place name, date, time, event type and target species.
>
> **Exact implementation rule**  Draft, cancelled and completed events must never appear in the public
> discovery response. Filtering by `status` and time must be enforced server-side, not in the browser.
> On the `/events` discovery page the **Custom dates** filter picks whole days only — a first day and a
> last day on one calendar, with no time of day. A single chosen day filters that day. The client sends
> `from` = local midnight at the start of the first day and `to` = local midnight after the last day; past
> days cannot be picked.
> **API:** `GET /api/v1/events?bbox=&from=&to=`
> **Datasets/Sources:** Relational `events` records; place geometry from Geofabrik Malaysia / Singapore / Brunei OSM extract — https://download.geofabrik.de/asia/malaysia-singapore-brunei.html

**AC 9.1.2 Anchor every event to a supported place**
> **Given** an event is returned in discovery results
> **When** its card or marker is displayed
> **Then** the event references a valid supported `place_id` and shows the mapped place name and place type.
>
> **Exact implementation rule**  An event whose `place_id` no longer resolves to a supported place must
> not be published; the map marker position uses the event `meeting_lat`/`meeting_lon`, not an arbitrary
> client coordinate.
> **API:** `GET /api/v1/places/{place_id}/events`
> **Datasets/Sources:** Epic 5.0 Places dataset (Geofabrik OSM extract); geoBoundaries Malaysia ADM0 for boundary validation.

**AC 9.1.3 Event-type and community labelling**
> **Given** any event is displayed in the list or on the map
> **When** the user reads its heading
> **Then** it shows the event type (survey, removal, monitoring or other) and is labelled a community
> activity hosted by a community member, visually distinct from a sighting marker and from an official
> protected-area notice.
>
> **Exact implementation rule**  The UI must not describe an event as an official eradication programme
> or imply government authorisation. The event type and the host's optional display name (or "Community host") come from the `events` record.
> **API:** `GET /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `events` records.

**AC 9.1.4 Accessible list fallback**
> **Given** the discovery map cannot be operated directly (keyboard-only or screen-reader use)
> **When** the same area and date range are shown
> **Then** every event marker has a matching, keyboard-accessible list item exposing the same title,
> place, date, time and target species, and the active area/date filter and result count are announced.
>
> **Exact implementation rule**  The list and map must render from the same query result so counts match
> exactly. (Mirrors the Epic 4.0 accessible-map-fallback rule.)
> **API:** `GET /api/v1/events?bbox=&from=&to=`
> **Datasets/Sources:** Relational `events` records.

**AC 9.1.5 Empty state without fabrication**
> **Given** no published upcoming events exist for the selected area and date range
> **When** the request completes
> **Then** the app displays "No upcoming survey events found here" and offers a "Browse the plant
> catalogue" or "Adopt this area" action instead.
>
> **Exact implementation rule**  The page must not create sample or placeholder events, and must not
> imply the area has no invasive plants.
> **API:** `GET /api/v1/events?bbox=&from=&to=`
> **Datasets/Sources:** Relational `events` records.

**AC 9.1.6 Surface events for a followed area**
> **Given** the user has adopted an area (Epic 6.0)
> **When** the user opens that adopted area
> **Then** any published, upcoming events anchored to that place are listed on the area, so a follower of
> a place learns about surveys there.
>
> **Exact implementation rule**  This reuses `GET /api/v1/places/{place_id}/events` scoped to the adopted
> place. A push or email notification is out of scope for the MVP (a Could-Have for a later iteration).
> **API:** `GET /api/v1/places/{place_id}/events`
> **Datasets/Sources:** Relational `events` records; Epic 6.0 adopted-area records.

---

### US 9.2: View an event and join it anonymously

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Must Have

**As a** privacy-conscious user who wants to take part
**I want** to see an event's purpose, meeting point, time and safety notes, and join without giving
personal details
**So that** I know exactly when to arrive, where to meet and what we will do, and can plan to attend

**Description**  The event detail view reuses the anonymous identity from Epic 2.0. Joining records an
intent to attend against the active anonymous identity only — no email, name or password. The detail
view keeps safety and permission guidance visible: joining an event is not permission to remove plants.

**Data or system dependency**  Relational `events` and `event_participants` records; active anonymous
session (Epic 2.0); Epic 3.0 safe-response / permission context.

**API and implementation contract**  `GET /api/v1/events/{event_id}` returns the full event
(`title`, `purpose`, `place_id`, `place_name`, `meeting_lat`, `meeting_lon`, `meeting_note`, `start_at`,
`end_at`, `target_species`, `safety_notes`, `permission_context`, `host_display_name`, `status`).
`POST /api/v1/events/{event_id}/participants` accepts the active session and returns HTTP 201 with
`participation_id`, `event_id` and `joined_at`. Unknown event: HTTP 404. Repeated join by the same
identity: the existing participation is returned (idempotent). Join on a cancelled or completed event: HTTP 409.

**Acceptance criteria**

**AC 9.2.1 Complete event detail**
> **Given** the user opens a published event
> **When** the detail view loads
> **Then** it shows the title, purpose, target species, meeting point on a map with a text description,
> start and end time, the host (shown by optional display name), and any safety notes.
>
> **Exact implementation rule**  All fields come from the `GET /api/v1/events/{event_id}` response and
> must not be hardcoded. Times are stored in UTC and displayed in the user's local time.
> **API:** `GET /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `events` records; place geometry from Geofabrik OSM extract.

**AC 9.2.2 Join with the anonymous identity only**
> **Given** the user has an active anonymous session and selects "Join this event"
> **When** the join request is submitted
> **Then**, provided the event `status = published`, a participation record is created for that anonymous identity and the control changes to "Joined".
>
> **Exact implementation rule**  Join is accepted only while the event `status = published`; a join on a draft, cancelled, completed or hidden event is rejected with HTTP 409 and creates no participation. `POST /api/v1/events/{event_id}/participants` must not accept or require
> any email, phone number, legal name or password. The endpoint authenticates via the existing anonymous
> session credential.
> **API:** `POST /api/v1/events/{event_id}/participants`
> **Datasets/Sources:** Relational `event_participants` records; Epic 2.0 anonymous-identity records.

**AC 9.2.3 Idempotent join and withdraw**
> **Given** the user has already joined an event
> **When** the same join request is repeated, or the user selects "Withdraw"
> **Then** a repeated join returns the existing participation without creating a duplicate, and a
> withdrawal sets the participation `status = withdrawn` without affecting any reports the user submitted.
>
> **Exact implementation rule**  Uniqueness is enforced on (`event_id`, `anonymous_identity_id`).
> `DELETE /api/v1/events/{event_id}/participants/{participation_id}` must verify ownership through the
> active anonymous session.
> **API:** `POST` and `DELETE /api/v1/events/{event_id}/participants`
> **Datasets/Sources:** Relational `event_participants` records.

**AC 9.2.4 Joining is never blanket removal permission**
> **Given** the event detail or the join confirmation is displayed
> **When** the user reads it
> **Then** the interface states that joining an event — including a removal event — is not blanket
> permission to remove any plant or to enter restricted land, and that any removal still depends on the
> Epic 3.0 permission and protected-area checks that run per person and per location on the day.
>
> **Exact implementation rule**  This wording must appear on both the event detail and the join
> confirmation, the Epic 3.0 permission and protected-area guidance must remain reachable from the event,
> and joining a removal event must never pre-authorise removal.
> **API:** `GET /api/v1/events/{event_id}`
> **Datasets/Sources:** Epic 3.0 InvaTrace Plant Guidance v1; relational `events` records.

**AC 9.2.5 Private participation**
> **Given** any user views an event
> **When** the detail response is returned
> **Then** the response does not expose the list of participants, any participant's public token, recovery
> key or session credential; it may expose a non-identifying joined count only.
>
> **Exact implementation rule**  The public event response must never include participant identifiers.
> A joined count, if shown, must not be broken down per identity.
> **API:** `GET /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `event_participants` records.

**AC 9.2.6 Optional group-chat link for participants**
> **Given** the host has added a discussion link to the event (for example a WhatsApp group invite)
> **When** a participant who has joined, or the host, opens the event
> **Then** the link is shown as an external link with a clear "opens outside InvaTrace" note, so they can
> join the group chat and talk there.
>
> **Exact implementation rule**  `chat_link` is an optional host-provided `https` URL, validated when the
> event is saved. It is returned and shown only to the host and joined participants — never to users who
> have not joined, and never once the event is `hidden` or `cancelled`. The app must not auto-open it or
> present it as InvaTrace-run; a bad link is handled by the report-event control (AC 9.7.3).
> **API:** `GET /api/v1/events/{event_id}` — `chat_link` returned only to the host and joined participants.
> **Datasets/Sources:** Relational `events` records.

---

### US 9.3: Check in on the day of the event

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Must Have

**As a** participant who has arrived at the meeting point
**I want** to check in when I am at the event, on the day, and see the task for the session
**So that** I know my next step and my observations can be reliably linked to this event

**Description**  Check-in reuses the Epic 3.0/4.0 fresh-GPS pattern: the browser collects a live
location, and the server validates that the check-in happens within the event time window and inside the
event's place (its mapped boundary, or the 750 m trail buffer used in Epics 5.0/6.0). A valid check-in
unlocks the event task view and is what authorises later observations to be tagged to this event; it is
never a coordinate the user can type.

**Data or system dependency**  `event_checkins` records; browser Geolocation API; server time; stored
event `meeting_lat`/`meeting_lon`; Epic 5.0 place geometry (for the boundary/trail-buffer membership test).

**API and implementation contract**  `POST /api/v1/events/{event_id}/check-in` accepts `latitude`,
`longitude` and `accuracy_m` from browser geolocation and returns HTTP 201 with `checkin_id` and
`checked_in_at` when accepted. Outside the time window, insufficient accuracy, or beyond the permitted
radius: HTTP 422 with a machine-readable reason code and no stored check-in.

**Acceptance criteria**

**AC 9.3.1 Fresh device location only**
> **Given** the user selects "Check in"
> **When** the check-in screen opens
> **Then** the browser requests a fresh device location and shows the measured accuracy before enabling
> submission.
>
> **Exact implementation rule**  Latitude and longitude must come from browser geolocation. The form must
> not provide editable coordinate fields. (Mirrors AC 4.5.2.)
> **API:** `POST /api/v1/events/{event_id}/check-in`
> **Datasets/Sources:** Browser Geolocation API; relational `events` meeting coordinates.

**AC 9.3.2 Server-side time-window and vicinity validation**
> **Given** a check-in request contains a fresh location
> **When** `POST /api/v1/events/{event_id}/check-in` is processed
> **Then** the server accepts it only when the event `status = published`, the server time is within the event window (from a short grace
> period before `start_at` to `end_at`), `accuracy_m` is 250 metres or better, and the point falls inside
> the event's place — within its mapped polygon, or within the 750 m trail buffer for a trail place; if the
> caller has not yet joined, a valid check-in auto-creates the participation so a separate join step is never a blocker.
>
> **Exact implementation rule**  A check-in is rejected for any status other than `published` (draft, cancelled, completed or hidden). Membership must be computed on the server against the event's stored
> `geometry_version` using PostGIS (`ST_Contains` / `ST_DWithin`), the same geometry rule as place
> discovery in Epic 5.0. A frontend calculation alone does not satisfy this criterion.
> **API:** `POST /api/v1/events/{event_id}/check-in`
> **Datasets/Sources:** Relational `events` records; Epic 5.0 place geometry (Geofabrik OSM extract); server clock.

**AC 9.3.3 Rejected check-in is explained, not stored**
> **Given** GPS is unavailable, accuracy is worse than 250 metres, the user is outside the event's place
> boundary or trail buffer, or the current time is outside the event window
> **When** check-in is attempted
> **Then** no check-in is stored and the app explains which condition failed (location, accuracy, distance
> or timing).
>
> **Exact implementation rule**  The API must return a machine-readable error code and must not partially
> record a check-in. A failure must never default to "checked in". (Mirrors AC 4.5.4.)
> **API:** `POST /api/v1/events/{event_id}/check-in`
> **Datasets/Sources:** Relational `event_checkins` records.

**AC 9.3.4 Session task view matches the event type**
> **Given** a check-in has been accepted
> **When** the event workspace opens
> **Then** it shows the session task for this event's type — a survey lists the plants to find and record,
> a removal adds the Epic 3.0 safe-response steps and their permission checks, monitoring points at the
> sightings to re-check — and every type offers a clear action to start a scan.
>
> **Exact implementation rule**  The task view must keep Epic 1.0 identification-uncertainty and Epic 3.0
> safety guidance visible. Find-and-record is available for every type. Removal steps appear only for a
> removal event and only after the Epic 3.0 permission and protected-area checks pass.
> **API:** `GET /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `events` records; Epic 1.0 catalogue; Epic 3.0 guidance.

---

### US 9.4: Submit event-linked observations

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Must Have

**As a** participant taking part in the survey
**I want** to identify plants with the scan flow and submit my observations tagged to this event
**So that** my participation leaves a useful, verifiable record that supports ongoing monitoring

**Description**  Reuse the Epic 1.0 scan flow and the Epic 4.0/2.0 report flow. A report carries an
`event_id` only when it genuinely belongs to that event: the submitter has checked in, and the
observation sits inside the event's place and time window (with a short grace period for photos captured
during the event but uploaded a little later). If any of that fails, the scan is kept and the user can
resubmit it as an ordinary report, so nothing is ever lost. A scan still never becomes a public report
automatically, and event-linked reports still pass automated screening — with the near-duplicate and
rate-limit rules scoped for the event context so co-located participants are not wrongly merged or throttled.

**Data or system dependency**  Epic 1.0 scan record; Epic 4.0 report submission; Epic 2.0 screening;
`event_checkins` (the check-in that authorises event tagging); relational `reports` with a nullable `event_id`.

**API and implementation contract**  `POST /api/v1/reports` (existing) now accepts an optional `event_id`
and an optional `captured_at` in addition to `scan_id`, `latitude`, `longitude`, `accuracy_m` and optional
`note`. Success: HTTP 201 with `report_id`, `report_status`, `submitted_at` and `event_id`. The event tag
is accepted only when the `event_id` references a published or completed event, the caller holds a valid
check-in, and the observation falls inside the event's place and time window; otherwise the event tag is
rejected with HTTP 422 and no event-linked report is created — the scan is kept so the user can resubmit
it as an ordinary report. Completeness, Malaysian-status and exact-image checks apply unchanged; the
near-duplicate merge and anti-spam rate limit apply in an event-scoped form (AC 9.4.3, AC 9.4.6).

**Acceptance criteria**

**AC 9.4.1 A scan does not become an event report automatically**
> **Given** the participant captures and classifies a plant during an event
> **When** the classification result is shown
> **Then** the observation is a local scan record only, and a separate explicit "Submit to this event"
> action is required to create a report.
>
> **Exact implementation rule**  No report is created from a scan without an explicit submit action, even
> inside an event. (Consistent with User Story 2.2 / Epic 4.0.)
> **API:** Epic 1.0 on-device classification → local scan record.
> **Datasets/Sources:** Epic 1.0 released 31/32-class model manifest; GBIF occurrence images.

**AC 9.4.2 Report is tagged to the event**
> **Given** the participant chooses "Submit to this event"
> **When** `POST /api/v1/reports` is processed with a valid `event_id`
> **Then** the created report stores that `event_id` and is returned with it, while remaining an ordinary
> screened community report.
>
> **Exact implementation rule**  `event_id` must reference an event with `status` in {published, completed}.
> An invalid, draft or cancelled `event_id` is rejected with HTTP 422 and creates no report; the scan is
> kept so it can be resubmitted as an ordinary report (see AC 9.4.5). This is the same reject-but-keep-the-scan
> behaviour AC 9.4.5 applies when the place, time or check-in conditions fail.
> **API:** `POST /api/v1/reports` (with `event_id`)
> **Datasets/Sources:** Relational `reports` and `events` records.

**AC 9.4.3 Event-aware duplicate screening**
> **Given** an event-linked report is submitted
> **When** duplicate screening runs
> **Then** exact-image (SHA-256) and completeness checks apply exactly as for any report, but the 25 m /
> 10 min near-duplicate merge is evaluated **per anonymous identity** for event-linked reports, so two
> different participants observing plants close together in the same session both publish.
>
> **Exact implementation rule**  An `event_id` must never exempt a report from exact-image or completeness
> checks. The spatial near-duplicate merge must not collapse reports from different identities within the
> same event; a single identity re-submitting a near-duplicate is still merged. (Refines User Story 2.3
> for the event context.)
> **API:** `POST /api/v1/reports`
> **Datasets/Sources:** Relational report records; GRIIS Malaysia v1.3; server timestamps.

**AC 9.4.4 Community-reported labelling preserved**
> **Given** an event-linked report appears on the shared map or in My Records
> **When** its detail is displayed
> **Then** it is labelled community-reported rather than expert-verified, and it may additionally show
> that it was captured during a named event.
>
> **Exact implementation rule**  The event association must not upgrade a report's trust status or imply
> expert validation.
> **API:** `GET /api/v1/reports/{report_id}`
> **Datasets/Sources:** Relational `reports` records.

**AC 9.4.5 Event tagging requires a check-in, and the right place and time**
> **Given** a user submits a report with an `event_id`
> **When** the server processes it
> **Then** it accepts the event tag only when all three hold: the caller has a valid check-in for that
> event, the observation's coordinates fall inside the event's place (its polygon or 750 m trail buffer),
> and the observation belongs to the event's time window. If any condition fails, the event tag is rejected
> with HTTP 422 and no event-linked report is created — the scan is kept and the user can resubmit it as an
> ordinary report, so the observation is never lost.
>
> **Exact implementation rule**  The check-in ownership test uses the active anonymous session. Location is
> checked server-side against the event's stored `geometry_version`, the same rule as check-in (AC 9.3.2).
> The observation's `captured_at` must fall inside the event's time window; the report may be uploaded up to a
> bounded grace period (default 24 hours after `end_at`), but that grace applies only to the upload time
> (`submitted_at`), never to `captured_at`. A report whose `captured_at` is outside the window, or uploaded after
> the grace, is not event-tagged. This reject-but-keep-the-scan behaviour is identical to AC 9.4.2, so
> the two never disagree.
> **API:** `POST /api/v1/reports` (with `event_id`)
> **Datasets/Sources:** Relational `event_checkins`, `events` (place geometry and time window) and `reports` records; server clock.

**AC 9.4.6 Event-scoped rate limit**
> **Given** a checked-in participant submits several reports during an active event
> **When** the anti-spam rate limit is evaluated
> **Then** a per-identity event submission budget applies instead of the default anti-spam throttle, so
> genuine repeated observations during the session are accepted up to a default of 60 event-linked
> reports per identity per event.
>
> **Exact implementation rule**  The event budget must be per anonymous identity and capped (default 60
> reports per identity per event); it counts reports by their `captured_at` within the event window, not by
> upload time, and must not lift IP-level abuse protection or allow unlimited submissions.
> (Refines User Story 2.3 for the event context.)
> **API:** `POST /api/v1/reports`
> **Datasets/Sources:** Relational `reports`, `event_checkins` records; server timestamps.

---

### US 9.5: Review the event outcome and revisit the area

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Should Have

**As a** participant after an event
**I want** to see what the event recorded and easily follow the area
**So that** my one visit connects to continued attention, and I can join a later survey

**Description**  After an event ends, participants can view a factual summary derived from event-linked
reports (how many were submitted, which supported species, within which place). From the summary they can
adopt/follow the area (Epic 6.0) and see the next survey for that place. The summary reports activity
counts only — never ecological improvement.

**Data or system dependency**  Event-linked `reports`; Epic 6.0 adopted-areas; relational `events`.

**API and implementation contract**  `GET /api/v1/events/{event_id}/summary` returns
`reports_submitted_count`, `distinct_species_count`, `place_id`, `place_name`, `start_at`, `end_at` and
a `next_event` reference for the same place when one exists. Counts exclude rejected and deleted reports.

**Acceptance criteria**

**AC 9.5.1 Factual event summary**
> **Given** an event has ended
> **When** the user opens its summary
> **Then** it shows the number of screened reports submitted during the event, the distinct supported
> species recorded, the place, and the event dates.
>
> **Exact implementation rule**  Counts must exclude rejected and deleted reports and must be computed
> from stored `event_id`-tagged reports whose `captured_at` falls inside the event window, not typed in by
> the host and never counted by upload time. Distinct species count uses `species_id`.
> **API:** `GET /api/v1/events/{event_id}/summary`
> **Datasets/Sources:** Relational `reports` (event-linked) records.

**AC 9.5.2 Monitoring language, not outcome claims**
> **Given** the event summary is displayed
> **When** the user reads its headings and text
> **Then** it is labelled community survey activity and must not describe the counts as ecological
> improvement, eradication, invasion density or a recovery score.
>
> **Exact implementation rule**  No combined health or improvement score may be derived from event report
> counts. (Consistent with AC 6.2.4 / AC 6.3.5.)
> **API:** `GET /api/v1/events/{event_id}/summary`
> **Datasets/Sources:** Relational `reports` records.

**AC 9.5.3 Adopt the area from the summary**
> **Given** the user is viewing an event summary for a supported place
> **When** the user selects "Follow this area for monitoring"
> **Then** the place is adopted for that anonymous identity using the existing Epic 6.0 flow, and the
> control changes to "Adopted".
>
> **Exact implementation rule**  Adoption reuses `POST /api/v1/adopted-areas` and remains a non-exclusive
> monitoring bookmark that grants no ownership or removal permission. (Consistent with AC 6.1.1 / AC 6.1.6.)
> **API:** `POST /api/v1/adopted-areas`
> **Datasets/Sources:** Epic 6.0 adopted-area records.

**AC 9.5.4 Surface the next survey**
> **Given** a later published event exists for the same place
> **When** the summary is displayed
> **Then** it offers a link to that next event; when none exists it invites the user to follow the area
> instead, without inventing a placeholder event.
>
> **Exact implementation rule**  `next_event` must reference a real published event with a future
> `start_at`, or be absent.
> **API:** `GET /api/v1/events/{event_id}/summary`
> **Datasets/Sources:** Relational `events` records.

---

### US 9.6: Host and publish an event

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Must Have

**As a** nature enthusiast who cares about a local place
**I want** to create an event on a place I choose — choosing what it is for (survey, removal, monitoring
or other), with its purpose, meeting point, time, target species and safety notes — and publish it when
it is ready
**So that** I can rally other people around a place I care about, for the kind of activity it actually
needs, without waiting on an admin or creating an account

**Description**  Hosting is open to any active Epic 2.0 identity. There is no organiser role: whoever
creates the event is its host, shown only by an optional display name ("Community host" if they skip it).
The host chooses the event type, which decides the on-site task and guidance participants see (US 9.3).
The host may also add an optional discussion link, such as a WhatsApp group invite, so participants can
talk before and after — shown only to people who join (AC 9.2.6). Events begin as drafts and go public
only when the host publishes them, and a host can only edit their own. Cancelling, moderation and
completion are handled in US 9.7.

**Data or system dependency**  Relational `events` records; the active anonymous identity and its optional
display name (Epic 2.0); Epic 5.0 Places for `place_id` and geometry.

**API and implementation contract**  `POST /api/v1/events` accepts the active anonymous session plus
`place_id`, `event_type`, `title`, `purpose`, `target_species_ids`, `meeting_lat`, `meeting_lon`, `meeting_note`,
`start_at`, `end_at`, `safety_notes`, `permission_context`, an optional discussion `chat_link` and an
optional informational `capacity`; it sets `host_identity_id` from the session and returns HTTP 201 with
`event_id` and `status = draft`. `PATCH /api/v1/events/{event_id}` edits a draft
or published event (including `status = published` or `cancelled`); `DELETE /api/v1/events/{event_id}`
cancels. Editing or cancelling an event the caller does not host: HTTP 403. No active session: HTTP 401.
Invalid `place_id` or `end_at` before `start_at`: HTTP 422.

**Acceptance criteria**

**AC 9.6.1 Any user can host; only the host can manage**
> **Given** a user with an active anonymous session creates an event
> **When** the request reaches `POST /api/v1/events`
> **Then** the event is created with `host_identity_id` set to that identity, and any later `PATCH` or
> `DELETE` on it succeeds only for the same identity and returns HTTP 403 for anyone else.
>
> **Exact implementation rule**  Creation must not require any special role or flag — only a valid
> anonymous session. Management ownership is verified server-side from the session, the same way
> `DELETE /api/v1/adopted-areas/{id}` verifies ownership in Epic 6.0. No email, name or password is required.
> Once the event has its first check-in or event-linked report, `place_id`, meeting coordinates, `start_at`,
> `end_at` and `event_type` lock: a `PATCH` changing any of them returns HTTP 409, and only `safety_notes`,
> `permission_context`, `chat_link`, `capacity`, title and purpose stay editable, so existing check-ins and
> reports never become inconsistent. To change a locked field the host must cancel and re-create.
> **API:** `POST`, `PATCH`, `DELETE /api/v1/events/{event_id}`
> **Datasets/Sources:** Epic 2.0 anonymous-identity records.

**AC 9.6.2 Host shown by optional display name only**
> **Given** an event is created or published
> **When** its host is displayed anywhere in the app
> **Then** the host appears only as the optional display name from the host's Epic 2.0 profile, or as
> "Community host" when no display name is set.
>
> **Exact implementation rule**  The public event response must never expose the host's `public_token`,
> `recovery_key` or session credential. (Consistent with the Epic 2.0 no-PII model.)
> **API:** `GET /api/v1/events/{event_id}`
> **Datasets/Sources:** Epic 2.0 anonymous-identity records.

**AC 9.6.3 Valid place and time required**
> **Given** the host submits event details
> **When** the event is created or published
> **Then** the event is accepted only when `place_id` resolves to a supported place, `end_at` is after
> `start_at`, and the meeting coordinates fall inside the event's check-in area (the place polygon, or the
> 750 m trail buffer for a trail place); otherwise the API returns HTTP 422 with field errors.
>
> **Exact implementation rule**  The event stores the `geometry_version` of the place at publish time so
> the meeting point and any place references stay consistent. The meeting-point check uses the same
> server-side PostGIS test as check-in (AC 9.3.2), so a participant who reaches the meeting point is always
> inside the area that check-in accepts.
> **API:** `POST /api/v1/events`
> **Datasets/Sources:** Epic 5.0 Places dataset (Geofabrik OSM extract); geoBoundaries Malaysia ADM0.

**AC 9.6.4 Draft before public**
> **Given** an event is created
> **When** it has not been explicitly published
> **Then** its `status = draft`, it is not returned by any public discovery endpoint, and it becomes
> discoverable only after the host sets `status = published`.
>
> **Exact implementation rule**  Discovery endpoints (`GET /api/v1/events`, `/places/{id}/events`) must
> exclude any status other than `published`. (Consistent with AC 9.1.1.)
> **API:** `PATCH /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `events` records.

**AC 9.6.5 Safe-by-default event content**
> **Given** the host sets the event's guidance
> **When** the event is published
> **Then** the event carries safety notes and an explicit `permission_context`; a survey, monitoring or
> other event defaults to observe and record, a removal event carries the Epic 3.0 safe-response context,
> and every type states that hosting or joining does not grant blanket removal permission;
> `explicit_permission` may be set only with a stated basis.
>
> **Exact implementation rule**  The event must not present active removal as the default activity, and the
> Epic 3.0 permission and protected-area guidance must remain reachable from the published event.
> **API:** `POST /api/v1/events`, `PATCH /api/v1/events/{event_id}`
> **Datasets/Sources:** Epic 3.0 InvaTrace Plant Guidance v1.

**AC 9.6.6 Choose the event type and matching guidance**
> **Given** the host is creating an event
> **When** they set its details
> **Then** they must choose an `event_type` — `survey` (find and record), `removal`, `monitoring` or
> `other` — and the published event stores and displays that type.
>
> **Exact implementation rule**  The `event_type` drives which on-site task and guidance appear (AC 9.3.4).
> A `removal` event must carry a `permission_context` and reference the Epic 3.0 safe-response guidance
> before it can be published. Every type keeps find-and-record available, and no type grants blanket removal permission.
> **API:** `POST /api/v1/events` (with `event_type`)
> **Datasets/Sources:** Relational `events` records; Epic 3.0 InvaTrace Plant Guidance v1.

---

### US 9.7: Keep the event list safe and current

**Card type:** User Story · **Parent:** Epic 9.0

**MoSCoW priority**  Must Have

**As a** member of the InvaTrace community
**I want** cancelled, unsafe and finished events cleared away cleanly
**So that** the event list stays trustworthy and I never trip over a stale or harmful survey

**Description**  Four safeguards keep an open hosting model honest. A host can cancel their own event
without wiping the reports or the people attached to it. Each identity can only run a bounded number of
live events, so nobody can flood the board. Anyone can report a concerning event, which hides it for
review once enough distinct people flag it. And every event finishes itself once its `end_at` passes.

**Data or system dependency**  Relational `events`, `event_participants`, `event_flags` and `reports`
records; server clock for completion.

**API and implementation contract**  `DELETE /api/v1/events/{event_id}` cancels (host only).
`POST /api/v1/events/{event_id}/flag` records a report and hides an event once enough distinct identities
flag it. A scheduled job moves an event to `status = completed` after `end_at`, after which
`GET /api/v1/events/{event_id}/summary` serves its outcome.

**Acceptance criteria**

**AC 9.7.1 Cancel without destroying evidence**
> **Given** a published event has participants or event-linked reports
> **When** the host cancels it
> **Then** the event `status = cancelled` and it disappears from discovery, while all submitted reports and
> the participants' anonymous identities are preserved.
>
> **Exact implementation rule**  Cancelling must not delete any report, must not null the `event_id` on
> existing reports, and must not delete participant identities. `DELETE` performs a soft cancel, not a hard
> delete of evidence.
> **API:** `DELETE /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `events`, `event_participants`, `reports` records.

**AC 9.7.2 Bounded hosting to limit abuse**
> **Given** an identity is creating or publishing events
> **When** it would exceed 3 concurrent published or upcoming events (the default cap)
> **Then** the API refuses the new publish with HTTP 429 and explains the limit, without affecting the
> identity's existing events.
>
> **Exact implementation rule**  The cap is per anonymous identity and enforced server-side. `capacity`,
> where set, is informational only and must not be enforced as a waitlist.
> **API:** `POST /api/v1/events`, `PATCH /api/v1/events/{event_id}`
> **Datasets/Sources:** Relational `events` records.

**AC 9.7.3 Report a concerning event**
> **Given** a signed-in user is viewing a published event
> **When** the user submits "Report this event" with a reason
> **Then** a flag is recorded and, once 3 distinct identities have flagged it (the default threshold),
> the event is hidden from discovery pending review: it leaves discovery, and new joins, check-ins and
> event-linked reports are blocked, while existing participants and reports are preserved and never deleted.
>
> **Exact implementation rule**  `POST /api/v1/events/{event_id}/flag` stores one flag per identity per
> event. Hiding sets `hidden = true`; it must not delete the event, its participants or their reports. How a
> hidden event is restored or cancelled is defined in AC 9.7.5.
> **API:** `POST /api/v1/events/{event_id}/flag`
> **Datasets/Sources:** Relational `event_flags`, `events` records.

**AC 9.7.4 Events auto-complete after they end**
> **Given** a published event's `end_at` has passed
> **When** the scheduled completion job runs
> **Then** the event moves to `status = completed`, leaves discovery, and its summary (US 9.5) becomes
> available.
>
> **Exact implementation rule**  Completion is time-based on server time and must not require host action;
> a completed event's reports and check-ins are preserved.
> **API:** `GET /api/v1/events/{event_id}/summary`
> **Datasets/Sources:** Relational `events` records; server clock.

**AC 9.7.5 Resolve a hidden event**
> **Given** a flagged event has been hidden from discovery pending review
> **When** the review outcome is decided
> **Then** the event is either restored (`hidden` cleared, flag tally reset, back in discovery) or cancelled
> as a soft cancel (AC 9.7.1); and if it is neither restored nor cancelled within a bounded window (default
> 14 days hidden) a scheduled job auto-cancels it, and in every outcome the reports, participants and
> check-ins are preserved.
>
> **Exact implementation rule**  There is no admin role, so the host is notified when their event is hidden
> and may appeal to restore it, which reopens review; a hidden event that is neither restored nor cancelled
> within the default 14-day window is auto-cancelled. Restoring clears `hidden` and the flag tally;
> cancelling and auto-cancelling reuse the soft cancel of AC 9.7.1 and never delete evidence.
> **API:** `PATCH /api/v1/events/{event_id}` (restore); `DELETE /api/v1/events/{event_id}` (cancel); scheduled job for the 14-day auto-cancel.
> **Datasets/Sources:** Relational `event_flags`, `events`, `event_participants`, `reports` records; server clock.

---

## 5. Definition of Ready / Done reminders (team convention)

Per the team's onboarding SMART actions, before any US 9.x card enters an iteration it should show its
Epic (9.0), its MoSCoW priority, its data/API contract and its dependency note on the reused epics
(1.0–6.0). Each AC should be independently testable via its stated endpoint and dataset.

**Suggested Iteration 3 MVP slice (if scope must shrink):**
US 9.6 (host/publish) + US 9.1 (discover) + US 9.2 (view & join) + US 9.3 (check-in) + US 9.4
(event-linked report) are the Must-Have core that makes Events real end-to-end — check-in is included
because it is the gate that links an observation to an event. US 9.7 (keep the list safe and current) is
Must-Have but can start with the cancel and auto-complete criteria and add the report/cap controls next.
US 9.5 (outcome & revisit) is the Should-Have layer that deepens the "repeat monitoring" value and can
follow once the core is validated.
