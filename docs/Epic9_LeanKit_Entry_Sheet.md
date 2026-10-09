# Epic 9 — LeanKit entry sheet (FIT5120 TM10)

Copy each card below into LeanKit by hand. Only the fields LeanKit actually uses are here — no CSV columns, no quotes, no export IDs. For every card set **Card type**, **Parent** and **Assignee** as shown, apply the shared **Card fields** below, and drop it in the lane shown.

Each card's **Description** block is spaced with a blank line between every part, so when you paste it into the LeanKit description editor each line stays on its own line.

### Card fields

These match the values a real card on our board carries (see any existing Epic card: Header, Planned Start, Planned Finish, Priority, Size, Blocked, Lane). Every Epic 9 card carries its own **Fields** line below, already filled in — copy it straight across.

**Same on every card:**

| Field | Value | Notes |
|---|---|---|
| Header | Iteration 3 | The free-text label at the top of the card (same slot that reads "Iteration 1" on older cards). |
| Priority | Normal | Every card on the board is Normal. |
| Size | 0 | The board leaves Size at 0. |
| Blocked | Unblocked | Set a block reason later only if a card is actually stuck. |

**Varies per card (already set on each Fields line):**

- **Lane** — by card type: the Epic goes in the **Epic** lane; User Story cards go in **To Do This Iteration → User Story**; AC cards go in **To Do This Iteration → Acceptance Criteria**.
- **Planned Start / Planned Finish** — staggered in dependency order across Iteration 3 (**Mon 28 Sep → Mon 12 Oct 2026**, iteration ends Mon 12 Oct 11:55 PM). Every card's window sits inside that fortnight. The Epic spans the whole window. Dates are `MM/DD/YYYY`, matching the board.

### Schedule at a glance

Build order is: host/create → discover → view & join → check in → report → review → keep-safe. Tracks run in parallel across the seven people, so windows overlap.

| Story block | Window | Lead cards |
|---|---|---|
| Epic 9.0 | 09/28 → 10/12 | umbrella, spans the iteration |
| US 9.6 Host & publish | 09/28 → 10/02 | events must exist first |
| US 9.1 Discover | 09/29 → 10/03 | list + map over published events |
| US 9.2 View & join | 10/01 → 10/04 | detail, anonymous join, chat link |
| US 9.3 Check in | 10/03 → 10/06 | on-day geofenced check-in |
| US 9.4 Event-linked report | 10/05 → 10/09 | scan → tagged report |
| US 9.7 Keep list safe | 10/07 → 10/12 | cancel, cap, flag, auto-complete |
| US 9.5 Review & revisit | 10/08 → 10/11 | summary + adopt area |

- **Numbering:** Epic 9 is final (Epics 7 and 8 are owned by other sub-teams).
- **Assignees** are a suggested split by each person's past focus — reassign freely.
- **Limits** (hosting cap, flag threshold, per-event report budget) are set to sensible defaults below — adjust to taste.
- **Adjust freely:** if your sprint opened before Mon 28 Sep, or you want tighter per-card ranges, shift the dates — they are a sensible default plan, not a hard schedule.

---

## Team members (assignee reference)

| Name | LeanKit email | Usual focus |
|---|---|---|
| Zhuya Song | zson0048@student.monash.edu | design, UI flows, prototype |
| Omran | oalh0005@student.monash.edu | maps, places, location context |
| Zack | zzha0614@student.monash.edu | data, screening, catalogue |
| Nikhil | nbha0007@student.monash.edu | monitoring, area indicators |
| Ali | msho0015@student.monash.edu | backend, geospatial, integration, deploy |
| Qixin (Klinya) | qche0101@student.monash.edu | frontend, lists, acceptance criteria |
| Ethan | yche0954@student.monash.edu | security, anonymity, moderation |

## Assignment map

| Card | Assignee(s) |
|---|---|
| Epic 9.0 | Ali, Omran, Zhuya |
| US 9.1 Discover | Omran (lead), Qixin |
| — AC 9.1.1 / 9.1.2 | Omran |
| — AC 9.1.3 / 9.1.4 / 9.1.5 / 9.1.6 | Qixin |
| US 9.2 View & join | Ethan (lead), Zhuya |
| — AC 9.2.2 / 9.2.4 / 9.2.5 | Ethan |
| — AC 9.2.1 / 9.2.3 | Zhuya |
| — AC 9.2.6 | Qixin |
| US 9.3 Check in | Ali (lead), Omran |
| — AC 9.3.2 / 9.3.3 | Ali |
| — AC 9.3.1 / 9.3.4 | Omran |
| US 9.4 Event-linked report | Zack (lead), Ali |
| — AC 9.4.1 / 9.4.2 / 9.4.3 / 9.4.4 | Zack |
| — AC 9.4.5 / 9.4.6 | Ali |
| US 9.5 Review & revisit | Nikhil (lead), Zack |
| — AC 9.5.1 / 9.5.2 / 9.5.3 | Nikhil |
| — AC 9.5.4 | Zack |
| US 9.6 Host & publish | Zhuya (lead), Ethan |
| — AC 9.6.1 / 9.6.2 / 9.6.3 / 9.6.4 / 9.6.5 | Zhuya |
| — AC 9.6.6 / 9.6.7 | Ethan |
| US 9.7 Keep list safe & current | Ethan (lead), Ali |
| — AC 9.7.1 / 9.7.2 / 9.7.3 / 9.7.5 | Ethan |
| — AC 9.7.4 | Ali |

Rough AC load: Ethan 8, Zhuya 7, Ali 5, Zack 5, Qixin 5, Omran 4, Nikhil 3. (37 ACs total)

---

## Cards to create

### Epic 9.0

- **Card type:** Epic
- **Title:** Epic 9.0: Community Survey Events and Repeat Monitoring
- **Assignee:** Ali; Omran; Zhuya
- **Fields:** Header: Iteration 3 | Lane: Epic (in progress) | Planned Start: 09/28/2026 | Planned Finish: 10/12/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Goal: Give people who care about a place a reason to show up and do something about invasive plants together. An event is an organised outing at a park, forest or trail, and the host chooses what it is for: a survey to find and record plants, a safe removal, a monitoring revisit, or another activity they describe. Any InvaTrace user who has reported at least three sightings can host one, choosing from the activities the place's mapped land status allows (removal only outside mapped protected land); others discover it near a place they follow, join it, check in on the day, record what they find through the existing scan and report flow, and come back to watch the area over time. This turns a one-off wish to help into organised activity and repeat monitoring under SDG 15 target 15.8. The safe defaults hold whatever the type: finding and recording is always available, attendance and record counts are never dressed up as ecological improvement, and joining or hosting an event never grants blanket permission to remove a plant — a removal event still runs through the existing Epic 3.0 safe-response and permission checks, per person and per location.

Persona: the everyday nature enthusiast, Aina. There is no organiser role; hosting is simply something a user can do once they have reported three sightings, and the host is shown only by an optional display name.

Builds on Epics 1.0 to 6.0: scan and status, anonymous access, safe guidance, reporting, place discovery and adopted areas.

---

### US 9.1: Discover nearby invasive-plant survey events

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.1: Discover nearby invasive-plant survey events
- **Assignee:** Omran; Qixin
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 09/29/2026 | Planned Finish: 10/01/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Must Have

As a nature enthusiast who cares about a local green space

I want to find upcoming invasive-plant survey events near a park, forest or trail I follow

So that helping stops being vague: there is a specific survey, at a place I follow, that I can actually turn up to.

Description: Events sit on the same shared map as sightings and in a matching accessible list, each one pinned to a supported place from Epic 5.0. Every card shows the place, date, time, the event type (survey, removal, monitoring or other) and the plants it focuses on, and is clearly marked a community activity rather than an official operation, so no one mistakes a volunteer outing for a government activity.

Data dependency: events records; Epic 5.0 place geometry and names (Geofabrik Malaysia Singapore Brunei OSM extract); no personal data.

API: GET /api/v1/events?bbox=&from=&to=&species_id= returns event_id, title, place_id, place_name, start_at, end_at, meeting_lat, meeting_lon, target_species and status. Only published events are returned. GET /api/v1/places/{place_id}/events returns the same scoped to one place. Invalid bbox returns HTTP 400.

---

- **Card type:** AC
- **Parent:** US 9.1
- **Title:** AC 9.1.1 Show only published, upcoming events
- **Assignee:** Omran
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/29/2026 | Planned Finish: 09/30/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the user opens the shared map or an event list

When events are requested for the visible area and date range

Then only events with status published and an end_at in the future are shown, each with its title, place name, date, time and target species.

Rule: Draft, cancelled and completed events must never appear in the public discovery response. Status and time filtering is enforced server-side, not in the browser. On the /events discovery page the Custom dates filter picks whole days only — a first day and a last day on one calendar, with no time of day. A single chosen day filters that day. The client sends from = local midnight at the start of the first day and to = local midnight after the last day; past days cannot be picked.

API: GET /api/v1/events?bbox=&from=&to=

Sources: events records; Geofabrik Malaysia Singapore Brunei OSM extract.

---

- **Card type:** AC
- **Parent:** US 9.1
- **Title:** AC 9.1.2 Anchor every event to a supported place
- **Assignee:** Omran
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/30/2026 | Planned Finish: 10/01/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given an event is returned in discovery results

When its card or marker is displayed

Then the event references a valid supported place_id and shows the mapped place name and place type.

Rule: An event whose place_id no longer resolves to a supported place must not be published. The marker position uses the event meeting coordinates, not an arbitrary client coordinate.

API: GET /api/v1/places/{place_id}/events

Sources: Epic 5.0 places dataset (Geofabrik OSM extract); geoBoundaries Malaysia ADM0.

---

- **Card type:** AC
- **Parent:** US 9.1
- **Title:** AC 9.1.3 Community-survey labelling
- **Assignee:** Qixin
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/29/2026 | Planned Finish: 09/30/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given any event is displayed in the list or on the map

When the user reads its heading

Then it shows its event type (survey, removal, monitoring or other) and is labelled a community activity hosted by a community member, visually distinct from a sighting marker and from an official protected-area notice.

Rule: The UI must not describe an event as an official eradication programme or imply government authorisation. The event type and the host optional display name, or Community host, come from the events record.

API: GET /api/v1/events/{event_id}

Sources: events records.

---

- **Card type:** AC
- **Parent:** US 9.1
- **Title:** AC 9.1.4 Accessible list fallback
- **Assignee:** Qixin
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/30/2026 | Planned Finish: 10/01/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given the discovery map cannot be operated directly (keyboard-only or screen-reader use)

When the same area and date range are shown

Then every event marker has a matching keyboard-accessible list item exposing the same title, place, date, time and target species, and the active filter and result count are announced.

Rule: The list and map must render from the same query result so counts match exactly.

API: GET /api/v1/events?bbox=&from=&to=

Sources: events records.

---

- **Card type:** AC
- **Parent:** US 9.1
- **Title:** AC 9.1.5 Empty state without fabrication
- **Assignee:** Qixin
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/01/2026 | Planned Finish: 10/02/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given no published upcoming events exist for the selected area and date range

When the request completes

Then the app displays No upcoming survey events found here and offers a Browse the plant catalogue or Adopt this area action instead.

Rule: The page must not create sample or placeholder events and must not imply the area has no invasive plants.

API: GET /api/v1/events?bbox=&from=&to=

Sources: events records.

---

- **Card type:** AC
- **Parent:** US 9.1
- **Title:** AC 9.1.6 Surface events for a followed area
- **Assignee:** Qixin
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/02/2026 | Planned Finish: 10/03/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given the user has adopted an area (Epic 6.0)

When the user opens that adopted area

Then any published upcoming events anchored to that place are listed on the area, so a follower of a place learns about surveys there.

Rule: Reuses GET /api/v1/places/{place_id}/events scoped to the adopted place. A push or email notification is out of scope for the MVP (a Could-Have for a later iteration).

API: GET /api/v1/places/{place_id}/events

Sources: events records; Epic 6.0 adopted-area records.

---

### US 9.2: View an event and join it anonymously

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.2: View an event and join it anonymously
- **Assignee:** Ethan; Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 10/01/2026 | Planned Finish: 10/03/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Must Have

As a privacy-conscious user who wants to take part

I want to see an event purpose, meeting point, time and safety notes, and join without giving personal details

So that I know exactly when to arrive, where to meet and what we will do before I commit, and I can join without handing over any personal details.

Description: The event detail reuses the Epic 2.0 anonymous identity. Joining records that I intend to attend against that identity alone, with no email, name or password. Safety and permission guidance stays on screen the whole time, because saying yes to an event is not saying yes to removing a plant. Once I join, I also see any group-chat link the host added, so the group can talk (AC 9.2.6).

Data dependency: events and event_participants records; active anonymous session (Epic 2.0); Epic 3.0 safe-response and permission context.

API: GET /api/v1/events/{event_id} returns the full event. POST /api/v1/events/{event_id}/participants returns HTTP 201 with participation_id, event_id and joined_at. Unknown event HTTP 404. Repeated join returns the existing participation. Join on a cancelled or completed event HTTP 409.

---

- **Card type:** AC
- **Parent:** US 9.2
- **Title:** AC 9.2.1 Complete event detail
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/02/2026 | Planned Finish: 10/03/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the user opens a published event

When the detail view loads

Then it shows the title, purpose, target species, meeting point on a map with a text description, start and end time, the host shown by optional display name, and any safety notes.

Rule: All fields come from GET /api/v1/events/{event_id} and must not be hardcoded. Times are stored in UTC and displayed in local time.

API: GET /api/v1/events/{event_id}

Sources: events records; place geometry from Geofabrik OSM extract.

---

- **Card type:** AC
- **Parent:** US 9.2
- **Title:** AC 9.2.2 Join with the anonymous identity only
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/01/2026 | Planned Finish: 10/02/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the user has an active anonymous session and selects Join this event

When the join request is submitted

Then, provided the event status is published, a participation record is created for that anonymous identity and the control changes to Joined.

Rule: Join is accepted only while the event status is published; a join on a draft, cancelled, completed or hidden event is rejected with HTTP 409 and creates no participation. POST /api/v1/events/{event_id}/participants must not accept or require any email, phone number, legal name or password. The endpoint authenticates via the existing anonymous session credential.

API: POST /api/v1/events/{event_id}/participants

Sources: event_participants records; Epic 2.0 anonymous-identity records.

---

- **Card type:** AC
- **Parent:** US 9.2
- **Title:** AC 9.2.3 Idempotent join and withdraw
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/03/2026 | Planned Finish: 10/04/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the user has already joined an event

When the same join request is repeated, or the user selects Withdraw

Then a repeated join returns the existing participation without creating a duplicate, and a withdrawal sets the participation status to withdrawn without affecting any reports the user submitted.

Rule: Uniqueness is enforced on event_id plus anonymous_identity_id. DELETE /api/v1/events/{event_id}/participants/{participation_id} verifies ownership through the active session.

API: POST and DELETE /api/v1/events/{event_id}/participants

Sources: event_participants records.

---

- **Card type:** AC
- **Parent:** US 9.2
- **Title:** AC 9.2.4 Participation is not removal permission
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/02/2026 | Planned Finish: 10/03/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the event detail or the join confirmation is displayed

When the user reads it

Then the interface states that joining an event — including a removal event — is not blanket permission to remove any plant or to enter restricted land, and that any removal still depends on the Epic 3.0 permission and protected-area checks that run per person and per location on the day.

Rule: This wording appears on both the event detail and the join confirmation, and the Epic 3.0 permission and protected-area guidance stays reachable from the event. Joining a removal event must never pre-authorise removal.

API: GET /api/v1/events/{event_id}

Sources: Epic 3.0 InvaTrace Plant Guidance v1; events records.

---

- **Card type:** AC
- **Parent:** US 9.2
- **Title:** AC 9.2.5 Private participation
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/03/2026 | Planned Finish: 10/04/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given any user views an event

When the detail response is returned

Then the response does not expose the list of participants, any participant public token, recovery key or session credential; it may expose a non-identifying joined count only.

Rule: The public event response must never include participant identifiers. A joined count, if shown, must not be broken down per identity.

API: GET /api/v1/events/{event_id}

Sources: event_participants records.

---

- **Card type:** AC
- **Parent:** US 9.2
- **Title:** AC 9.2.6 Optional group-chat link for participants
- **Assignee:** Qixin
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/03/2026 | Planned Finish: 10/04/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given the host has added a discussion link to the event (for example a WhatsApp group invite)

When a participant who has joined, or the host, opens the event

Then the link is shown as an external link with a clear "opens outside InvaTrace" note, so they can join the group chat and talk there.

Rule: chat_link is an optional host-provided https URL, validated when the event is saved. It is shown only to the host and joined participants, never to users who have not joined, and never once the event is hidden or cancelled. The app must not auto-open it or present it as InvaTrace-run; a bad link is handled by the report-event control (AC 9.7.3).

API: GET /api/v1/events/{event_id} — chat_link is returned only to the host and joined participants.

Sources: events records.

---

### US 9.3: Check in on the day of the event

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.3: Check in on the day of the event
- **Assignee:** Ali; Omran
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 10/03/2026 | Planned Finish: 10/05/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Must Have

As a participant who has arrived at the meeting point

I want to check in when I am at the event, on the day, and see the task for the session

So that I know my next step the moment I arrive, and the observations I submit are tied to a real on-site visit rather than a guess.

Description: Check-in follows the Epic 3.0 and 4.0 fresh-GPS pattern. The server only accepts a check-in that happens during the event window and inside the event place, meaning its mapped boundary or the 750 metre trail buffer from Epics 5.0 and 6.0. A valid check-in opens the session task and is what lets later observations be tagged to this event. The location always comes from the device; the user can never type a coordinate.

Data dependency: event_checkins records; browser Geolocation API; server time; stored event meeting coordinates; Epic 5.0 place geometry for the membership test.

API: POST /api/v1/events/{event_id}/check-in accepts latitude, longitude and accuracy_m and returns HTTP 201 with checkin_id and checked_in_at when accepted. Outside the window, insufficient accuracy, or outside the place: HTTP 422 with a reason code and no stored check-in.

---

- **Card type:** AC
- **Parent:** US 9.3
- **Title:** AC 9.3.1 Fresh device location only
- **Assignee:** Omran
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/03/2026 | Planned Finish: 10/04/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the user selects Check in

When the check-in screen opens

Then the browser requests a fresh device location and shows the measured accuracy before enabling submission.

Rule: Latitude and longitude must come from browser geolocation. The form must not provide editable coordinate fields.

API: POST /api/v1/events/{event_id}/check-in

Sources: browser Geolocation API; events meeting coordinates.

---

- **Card type:** AC
- **Parent:** US 9.3
- **Title:** AC 9.3.2 Server-side time-window and place validation
- **Assignee:** Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/03/2026 | Planned Finish: 10/05/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a check-in request contains a fresh location

When POST /api/v1/events/{event_id}/check-in is processed

Then the server accepts it only when the event status is published, the server time is within the event window (from a short grace period before start_at to end_at), accuracy_m is 250 metres or better, and the point falls inside the event place — within its mapped polygon, or within the 750 metre trail buffer for a trail place; if the caller has not yet joined, a valid check-in auto-creates the participation so a separate join step is never a blocker.

Rule: A check-in is rejected for any status other than published (draft, cancelled, completed or hidden). Membership is computed on the server against the event stored geometry_version using PostGIS (ST_Contains or ST_DWithin), the same geometry rule as place discovery in Epic 5.0. A frontend calculation alone does not satisfy this.

API: POST /api/v1/events/{event_id}/check-in

Sources: events records; Epic 5.0 place geometry (Geofabrik OSM extract); server clock.

---

- **Card type:** AC
- **Parent:** US 9.3
- **Title:** AC 9.3.3 Rejected check-in is explained, not stored
- **Assignee:** Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/05/2026 | Planned Finish: 10/06/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given GPS is unavailable, accuracy is worse than 250 metres, the user is outside the event place boundary or trail buffer, or the current time is outside the event window

When check-in is attempted

Then no check-in is stored and the app explains which condition failed (location, accuracy, place or timing).

Rule: The API returns a machine-readable error code and must not partially record a check-in. A failure must never default to checked in.

API: POST /api/v1/events/{event_id}/check-in

Sources: event_checkins records.

---

- **Card type:** AC
- **Parent:** US 9.3
- **Title:** AC 9.3.4 Session task view after check-in
- **Assignee:** Omran
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/04/2026 | Planned Finish: 10/05/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given a check-in has been accepted

When the event workspace opens

Then it shows the session task for this event's type — a survey lists the plants to find and record, a removal adds the Epic 3.0 safe-response steps and their permission checks, monitoring points at the sightings to re-check — and every type offers a clear action to start a scan.

Rule: The task view keeps Epic 1.0 identification-uncertainty and Epic 3.0 safety guidance visible. Find-and-record is available for every type. Removal steps appear only for a removal event and only after the Epic 3.0 permission and protected-area checks pass. After a successful check-in the task view replaces the check-in screen in the app's history (Back returns to the event, never to check-in), and from then on the event page leads to the task instead of offering check-in again.

API: GET /api/v1/events/{event_id}

Sources: events records; Epic 1.0 catalogue; Epic 3.0 guidance.

---

### US 9.4: Submit event-linked observations

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.4: Submit event-linked observations
- **Assignee:** Zack; Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 10/05/2026 | Planned Finish: 10/08/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Must Have

As a participant taking part in the survey

I want to identify plants with the scan flow and submit my observations tagged to this event

So that my time in the field leaves a record other people can actually trust and build on.

Description: This reuses the Epic 1.0 scan flow and the Epic 4.0 and 2.0 report flow. A report carries an event_id only when it genuinely belongs to that event — the submitter has checked in, and the observation sits inside the event's place and time window (with a short grace period for photos captured during the event but uploaded a little later). If any of that fails the scan is kept and the user can resubmit it as an ordinary report, so nothing is ever lost. Scanning never publishes on its own, and event reports still face full screening, with the duplicate and rate rules scoped so a crowd working the same patch is not wrongly merged or throttled.

Data dependency: Epic 1.0 scan record; Epic 4.0 report submission; Epic 2.0 screening; event_checkins (the check-in that authorises event tagging); reports with a nullable event_id.

API: POST /api/v1/reports now accepts an optional event_id alongside scan_id, latitude, longitude, accuracy_m, an optional captured_at and optional note. Success HTTP 201 with report_id, report_status, submitted_at and event_id. The event tag is accepted only when the event_id references a published or completed event, the caller holds a valid check-in, and the observation falls inside the event's place and time window; otherwise the event tag is rejected with HTTP 422 and no event-linked report is created — the scan is kept so the user can resubmit it as an ordinary report. Completeness, Malaysian-status and exact-image checks apply unchanged; near-duplicate and rate limit apply in an event-scoped form.

---

- **Card type:** AC
- **Parent:** US 9.4
- **Title:** AC 9.4.1 A scan does not become an event report automatically
- **Assignee:** Zack
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/05/2026 | Planned Finish: 10/06/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the participant captures and classifies a plant during an event

When the classification result is shown

Then the observation is a local scan record only, and a separate explicit Submit to this event action is required to create a report.

Rule: No report is created from a scan without an explicit submit action, even inside an event.

API: Epic 1.0 on-device classification to local scan record.

Sources: Epic 1.0 released model manifest; GBIF occurrence images.

---

- **Card type:** AC
- **Parent:** US 9.4
- **Title:** AC 9.4.2 Report is tagged to the event
- **Assignee:** Zack
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/06/2026 | Planned Finish: 10/07/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the participant chooses Submit to this event

When POST /api/v1/reports is processed with a valid event_id

Then the created report stores that event_id and is returned with it, while remaining an ordinary screened community report.

Rule: event_id must reference an event with status published or completed. An invalid, draft or cancelled event_id is rejected with HTTP 422 and creates no report; the scan is kept so it can be resubmitted as an ordinary report (see AC 9.4.5). This is the same reject-but-keep-the-scan behaviour AC 9.4.5 applies when the place, time or check-in conditions fail.

API: POST /api/v1/reports (with event_id)

Sources: reports and events records.

---

- **Card type:** AC
- **Parent:** US 9.4
- **Title:** AC 9.4.3 Event-aware duplicate screening
- **Assignee:** Zack
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/07/2026 | Planned Finish: 10/08/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given an event-linked report is submitted

When duplicate screening runs

Then exact-image (SHA-256) and completeness checks apply exactly as for any report, but the 25 metre 10 minute near-duplicate merge is evaluated per anonymous identity for event-linked reports, so two different participants observing plants close together in the same session both publish.

Rule: An event_id must never exempt a report from exact-image or completeness checks. The spatial near-duplicate merge must not collapse reports from different identities within the same event; a single identity re-submitting a near-duplicate is still merged.

API: POST /api/v1/reports

Sources: report records; GRIIS Malaysia v1.3; server timestamps.

---

- **Card type:** AC
- **Parent:** US 9.4
- **Title:** AC 9.4.4 Community-reported labelling preserved
- **Assignee:** Zack
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/08/2026 | Planned Finish: 10/09/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given an event-linked report appears on the shared map or in My Records

When its detail is displayed

Then it is labelled community-reported rather than expert-verified, and it may additionally show that it was captured during a named event.

Rule: The event association must not upgrade a report trust status or imply expert validation.

API: GET /api/v1/reports/{report_id}

Sources: reports records.

---

- **Card type:** AC
- **Parent:** US 9.4
- **Title:** AC 9.4.5 Event tagging requires a check-in, and the right place and time
- **Assignee:** Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/06/2026 | Planned Finish: 10/08/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a user submits a report with an event_id

When the server processes it

Then it accepts the event tag only when all three hold: the caller has a valid check-in for that event, the observation's coordinates fall inside the event's place (its polygon or 750 metre trail buffer), and the observation belongs to the event's time window. If any condition fails, the event tag is rejected with HTTP 422 and no event-linked report is created — the scan is kept and the user can resubmit it as an ordinary report, so the observation is never lost.

Rule: The check-in ownership test uses the active anonymous session. Location is checked server-side against the event's stored geometry_version, the same rule as check-in (AC 9.3.2). The observation's captured_at must fall inside the event's time window; the report may be uploaded up to a bounded grace period (default 24 hours after end_at), but that grace applies only to the upload time (submitted_at), never to captured_at. A report whose captured_at is outside the window, or uploaded after the grace, is not event-tagged. This reject-but-keep-the-scan behaviour is identical to AC 9.4.2, so the two never disagree.

API: POST /api/v1/reports (with event_id)

Sources: event_checkins, events (place geometry and time window) and reports records; server clock.

---

- **Card type:** AC
- **Parent:** US 9.4
- **Title:** AC 9.4.6 Event-scoped rate limit
- **Assignee:** Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/08/2026 | Planned Finish: 10/09/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a checked-in participant submits several reports during an active event

When the anti-spam rate limit is evaluated

Then a per-identity event submission budget applies instead of the default anti-spam throttle, so genuine repeated observations during the session are accepted up to a default of 60 event-linked reports per identity per event.

Rule: The event budget is per anonymous identity and capped (default 60 reports per identity per event); it counts reports by their captured_at within the event window, not by upload time, and must not lift IP-level abuse protection or allow unlimited submissions.

API: POST /api/v1/reports

Sources: reports and event_checkins records; server timestamps.

---

### US 9.5: Review the event outcome and revisit the area

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.5: Review the event outcome and revisit the area
- **Assignee:** Nikhil; Zack
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 10/08/2026 | Planned Finish: 10/10/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Should Have

As a participant after an event

I want to see what the event recorded and easily follow the area

So that a single visit turns into ongoing attention, and I leave knowing where to point my next one.

Description: Once an event ends, a plain summary is built from its event-linked reports: how many were submitted, which species turned up, and where. From there I can follow the area (Epic 6.0) and see the next survey for that place. The summary counts activity and nothing more; it never claims the place became healthier.

Data dependency: event-linked reports; Epic 6.0 adopted areas; events records.

API: GET /api/v1/events/{event_id}/summary returns reports_submitted_count, distinct_species_count, place_id, place_name, start_at, end_at and a next_event reference for the same place when one exists. Counts exclude rejected and deleted reports.

---

- **Card type:** AC
- **Parent:** US 9.5
- **Title:** AC 9.5.1 Factual event summary
- **Assignee:** Nikhil
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/08/2026 | Planned Finish: 10/09/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given an event has ended

When the user opens its summary

Then it shows the number of screened reports submitted during the event, the distinct supported species recorded, the place, and the event dates.

Rule: Counts exclude rejected and deleted reports and are computed from stored event_id-tagged reports whose captured_at falls inside the event window, not typed in by the host and never counted by upload time. Distinct species count uses species_id.

API: GET /api/v1/events/{event_id}/summary

Sources: event-linked reports records.

---

- **Card type:** AC
- **Parent:** US 9.5
- **Title:** AC 9.5.2 Monitoring language, not outcome claims
- **Assignee:** Nikhil
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/09/2026 | Planned Finish: 10/10/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given the event summary is displayed

When the user reads its headings and text

Then it is labelled community survey activity and must not describe the counts as ecological improvement, eradication, invasion density or a recovery score.

Rule: No combined health or improvement score may be derived from event report counts.

API: GET /api/v1/events/{event_id}/summary

Sources: reports records.

---

- **Card type:** AC
- **Parent:** US 9.5
- **Title:** AC 9.5.3 Adopt the area from the summary
- **Assignee:** Nikhil
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/10/2026 | Planned Finish: 10/11/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given the user is viewing an event summary for a supported place

When the user selects Follow this area for monitoring

Then the place is adopted for that anonymous identity using the existing Epic 6.0 flow, and the control changes to Adopted.

Rule: Adoption reuses POST /api/v1/adopted-areas and remains a non-exclusive monitoring bookmark that grants no ownership or removal permission.

API: POST /api/v1/adopted-areas

Sources: Epic 6.0 adopted-area records.

---

- **Card type:** AC
- **Parent:** US 9.5
- **Title:** AC 9.5.4 Surface the next survey
- **Assignee:** Zack
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/09/2026 | Planned Finish: 10/10/2026 | Priority: Normal | Size: 0 | Blocked: Unblocked

**Description**

Given a later published event exists for the same place

When the summary is displayed

Then it offers a link to that next event; when none exists it invites the user to follow the area instead, without inventing a placeholder event.

Rule: next_event must reference a real published event with a future start_at, or be absent.

API: GET /api/v1/events/{event_id}/summary

Sources: events records.

---

### US 9.6: Host and publish an event

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.6: Host and publish an event
- **Assignee:** Zhuya; Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 09/28/2026 | Planned Finish: 09/30/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Must Have

As a nature enthusiast who cares about a local place

I want to pick a place I care about, see what its mapped land status allows, and create an event there — choosing what it is for (survey, removal, monitoring or other) from the activities allowed at that place, with its purpose, meeting point, time, target species and safety notes — and publish it when it is ready

So that I can rally other people around a place I care about, for the kind of activity it actually needs, without waiting on an admin or creating an account.

Description: Hosting is open to any active Epic 2.0 identity once it has reported at least three sightings (reports not rejected or sent back for a rescan). There is no organiser role: whoever creates the event is its host, shown only by an optional display name (Community host if they skip it). The host picks the place first; InvaTrace looks it up in the mapped protected-area data and shows its land status, and the host then chooses the event type from the types allowed there. The type decides the on-site task and guidance participants see (US 9.3). The host is never asked to self-declare land-manager permission. The host may also add an optional discussion link, such as a WhatsApp group invite, so participants can talk before and after — it is shown only to people who join (AC 9.2.6). Events begin as drafts and go public only when the host publishes them, and a host can only edit their own. Cancelling, moderation and completion are handled separately in US 9.7.

Data dependency: events records; the active anonymous identity, its optional display name and its report count; Epic 5.0 places for place_id and geometry; the active OSM protected-area release.

API: POST /api/v1/events accepts the active session plus place_id, event_type, title, purpose, target_species_ids, meeting coordinates, meeting_note, start_at, end_at, safety_notes, an optional discussion chat_link and an optional informational capacity (a legacy permission_context is accepted and ignored); it sets host_identity_id from the session, derives and stores the place's land_status, and returns HTTP 201 with event_id and status draft. Fewer than three counted reports HTTP 403 hosting_locked. An event type the place's land status does not allow HTTP 422 removal_not_allowed_here. GET /api/v1/events/host-eligibility returns eligible, report_count and required; GET /api/v1/places/{place_id}/land-status returns the land status, protected-area name and operator when known, and the allowed event types. PATCH /api/v1/events/{event_id} edits a draft or published event including publish or cancel. DELETE /api/v1/events/{event_id} cancels. Editing or cancelling an event the caller does not host HTTP 403. No active session HTTP 401. Invalid place_id or end_at before start_at HTTP 422.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.1 Hosting unlocks after three sightings; only the host can manage
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/28/2026 | Planned Finish: 09/29/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a user with an active anonymous session who has reported at least three sightings creates an event

When the request reaches POST /api/v1/events

Then the event is created with host_identity_id set to that identity, and any later PATCH or DELETE on it succeeds only for the same identity and returns HTTP 403 for anyone else; a user with fewer than three counted reports gets HTTP 403 hosting_locked, and the app shows "Report 3 sightings to unlock hosting (n/3 so far)" in place of the host form.

Rule: Creation needs no special role or flag — only a valid anonymous session and at least three of that identity's reports whose status is not rejected or needs_rescan (setting EVENT_HOST_MIN_REPORTS, default 3). The rule sits behind EVENT_HOST_GATE_ENABLED, which is switched off during internal testing (anyone with a session can host); setting it to true enforces the three-sighting requirement without other changes. Management ownership is verified server-side from the session, the same way DELETE /api/v1/adopted-areas/{id} verifies ownership in Epic 6.0. No email, name or password is required. Once the event has its first check-in or event-linked report, place_id, meeting coordinates, start_at, end_at and event_type lock: a PATCH changing any of them returns HTTP 409, and only safety_notes, chat_link, capacity, title and purpose stay editable, so existing check-ins and reports never become inconsistent. To change a locked field the host must cancel and re-create.

API: GET /api/v1/events/host-eligibility; POST, PATCH, DELETE /api/v1/events/{event_id}

Sources: Epic 2.0 anonymous-identity records; Epic 1.0 report records.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.2 Host shown by optional display name only
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/29/2026 | Planned Finish: 09/30/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given an event is created or published

When its host is displayed anywhere in the app

Then the host appears only as the optional display name from the host Epic 2.0 profile, or as Community host when no display name is set.

Rule: The public event response must never expose the host public token, recovery key or session credential.

API: GET /api/v1/events/{event_id}

Sources: Epic 2.0 anonymous-identity records.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.3 Valid place and time required
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/29/2026 | Planned Finish: 09/30/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the host submits event details

When the event is created or published

Then the event is accepted only when place_id resolves to a supported place, end_at is after start_at, and the meeting coordinates fall inside the event's check-in area (the place polygon, or the 750 metre trail buffer for a trail place); otherwise the API returns HTTP 422 with field errors.

Rule: The event stores the geometry_version of the place at publish time so the meeting point and place references stay consistent. The meeting-point check uses the same server-side PostGIS test as check-in (AC 9.3.2), so a participant who reaches the meeting point is always inside the area that check-in accepts. The host form defaults the meeting point to a point inside the place (not its bounding-box centre, which can fall outside an irregular boundary) and flags a point outside the boundary before the host can continue.

API: POST /api/v1/events

Sources: Epic 5.0 places dataset (Geofabrik OSM extract); geoBoundaries Malaysia ADM0.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.4 Draft before public
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/30/2026 | Planned Finish: 10/01/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given an event is created

When it has not been explicitly published

Then its status is draft, it is not returned by any public discovery endpoint, and it becomes discoverable only after the host sets status published.

Rule: Discovery endpoints must exclude any status other than published. In the host form, the browser Back gesture returns to the previous step without losing entries, leaving with unsaved changes asks for confirmation, and once saved or published the form is replaced in history so it cannot be reopened blank or submitted twice.

API: PATCH /api/v1/events/{event_id}

Sources: events records.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.5 Safe-by-default event content
- **Assignee:** Zhuya
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/01/2026 | Planned Finish: 10/02/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the host sets the event guidance

When the event is published

Then the event carries safety notes and the server-derived land status of its place, its default framing is observe and report, and it states that hosting or joining does not grant removal permission.

Rule: The event must not present active removal as the default activity, the host is never asked to self-declare land-manager permission, and the Epic 3.0 permission and protected-area guidance stays reachable from the published event.

API: POST, PATCH /api/v1/events/{event_id}

Sources: Epic 3.0 InvaTrace Plant Guidance v1.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.6 Choose the event type and matching guidance
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 09/28/2026 | Planned Finish: 09/30/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the host is creating an event

When they set its details

Then they choose the place first and then an event type — survey (find and record), removal, monitoring, or other — from the types the place's land status allows: removal is offered only when the land status is not_protected; on protected or uncertain land the removal option is not shown at all and only survey, monitoring or other are listed; the published event stores and displays that type.

Rule: The event type drives which on-site task and guidance appear (AC 9.3.4). The server re-checks the land status on create, on any change of place or type, and again on publish; a disallowed type returns HTTP 422 removal_not_allowed_here. A removal event references the Epic 3.0 safe-response guidance, and each participant still passes the Epic 3.0 checks on the day. Every type keeps find-and-record available, and no type grants blanket removal permission.

API: POST /api/v1/events (with event_type), PATCH /api/v1/events/{event_id}

Sources: events records; OSM protected-area release; Epic 3.0 InvaTrace Plant Guidance v1.

---

- **Card type:** AC
- **Parent:** US 9.6
- **Title:** AC 9.6.7 Land status comes from mapped data, not self-declaration
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/09/2026 | Planned Finish: 10/10/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given the host has chosen a place for an event

When the place's land status is looked up

Then InvaTrace reports protected (the place overlaps a mapped protected area, or is itself an OSM protected area, national park or nature reserve — shown with the area name and managing operator when known), not_protected (the place lies inside the dataset coverage and clear of every mapped protected area) or uncertain (no active dataset, place outside coverage, or a failed lookup), always with the disclaimer that mapped status is not ownership, access or removal permission.

Rule: Polygon places use a PostGIS ST_Intersects test against the active protected-area release; trail places use the 750 metre trail buffer from AC 9.3.2. Uncertain fails closed to observe-and-report types. The status and protected-area name are stored on the event (land_status, protected_area_name) and shown on its detail page.

API: GET /api/v1/places/{place_id}/land-status; POST, PATCH /api/v1/events

Sources: OSM Malaysia protected-area release (Geofabrik extract: boundary=protected_area, boundary=national_park, leisure=nature_reserve); Epic 5.0 places.

---

### US 9.7: Keep the event list safe and current

- **Card type:** User Story
- **Parent:** Epic 9.0
- **Title:** US 9.7: Keep the event list safe and current
- **Assignee:** Ethan; Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → User Story | Planned Start: 10/07/2026 | Planned Finish: 10/12/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

MoSCoW: Must Have

As a member of the InvaTrace community

I want cancelled, unsafe and finished events cleared away cleanly

So that the event list stays trustworthy and I never trip over a stale or harmful survey.

Description: Four safeguards keep an open hosting model honest. A host can cancel their own event without wiping the reports or the people attached to it. Each identity can only run a bounded number of live events, so nobody can flood the board. Anyone can report a concerning event, which hides it for review once enough distinct people flag it. And every event finishes itself once its end time passes, so the list never fills with stale surveys.

Data dependency: events, event_participants, event_flags and reports records; server clock for completion.

API: DELETE /api/v1/events/{event_id} cancels (host only). POST /api/v1/events/{event_id}/flag records a report and hides an event once enough distinct identities flag it. A scheduled job moves an event to completed after end_at, after which GET /api/v1/events/{event_id}/summary serves its outcome.

---

- **Card type:** AC
- **Parent:** US 9.7
- **Title:** AC 9.7.1 Cancel without destroying evidence
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/07/2026 | Planned Finish: 10/08/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a published event has participants or event-linked reports

When the host cancels it

Then the event status is cancelled and it disappears from discovery, while all submitted reports and the participants anonymous identities are preserved.

Rule: Cancelling must not delete any report, must not null the event_id on existing reports, and must not delete participant identities. DELETE performs a soft cancel, not a hard delete of evidence.

API: DELETE /api/v1/events/{event_id}

Sources: events, event_participants and reports records.

---

- **Card type:** AC
- **Parent:** US 9.7
- **Title:** AC 9.7.2 Bounded hosting to limit abuse
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/08/2026 | Planned Finish: 10/09/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given an identity is creating or publishing events

When it would exceed 3 concurrent published or upcoming events (the default cap)

Then the API refuses the new publish with HTTP 429 and explains the limit, without affecting the identity existing events.

Rule: The cap (default 3 live events per identity) is per anonymous identity and enforced server-side. capacity, where set, is informational only and must not be enforced as a waitlist.

API: POST, PATCH /api/v1/events/{event_id}

Sources: events records.

---

- **Card type:** AC
- **Parent:** US 9.7
- **Title:** AC 9.7.3 Report a concerning event
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/09/2026 | Planned Finish: 10/10/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a signed-in user is viewing a published event

When the user submits Report this event with a reason

Then a flag is recorded and, once 3 distinct identities have flagged it (the default threshold), the event is hidden from discovery pending review: it leaves discovery, and new joins, check-ins and event-linked reports are blocked, while existing participants and reports are preserved and never deleted.

Rule: POST /api/v1/events/{event_id}/flag stores one flag per identity per event. Hiding sets hidden true; it must not delete the event, its participants or their reports. How a hidden event is restored or cancelled is defined in AC 9.7.5.

API: POST /api/v1/events/{event_id}/flag

Sources: event_flags and events records.

---

- **Card type:** AC
- **Parent:** US 9.7
- **Title:** AC 9.7.4 Events auto-complete after they end
- **Assignee:** Ali
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/10/2026 | Planned Finish: 10/12/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a published event end_at has passed

When the scheduled completion job runs

Then the event moves to status completed, leaves discovery, and its summary (US 9.5) becomes available.

Rule: Completion is time-based on server time and must not require host action; a completed event reports and check-ins are preserved.

API: GET /api/v1/events/{event_id}/summary

Sources: events records; server clock.

---

- **Card type:** AC
- **Parent:** US 9.7
- **Title:** AC 9.7.5 Resolve a hidden event
- **Assignee:** Ethan
- **Fields:** Header: Iteration 3 | Lane: To Do This Iteration → Acceptance Criteria | Planned Start: 10/11/2026 | Planned Finish: 10/12/2026 | Priority: High | Size: 0 | Blocked: Unblocked

**Description**

Given a flagged event has been hidden from discovery pending review

When the review outcome is decided

Then the event is either restored — hidden cleared, flag tally reset, back in discovery — or cancelled as a soft cancel (AC 9.7.1); and if it is neither restored nor cancelled within a bounded window (default 14 days hidden) a scheduled job auto-cancels it, and in every outcome the reports, participants and check-ins are preserved.

Rule: There is no admin role, so the host is notified when their event is hidden and may appeal to restore it, which reopens review; a hidden event that is neither restored nor cancelled within the default 14-day window is auto-cancelled. Restoring clears hidden and the flag tally; cancelling and auto-cancelling reuse the soft cancel of AC 9.7.1 and never delete evidence.

API: PATCH /api/v1/events/{event_id} to restore; DELETE /api/v1/events/{event_id} to cancel; scheduled job for the 14-day auto-cancel.

Sources: event_flags, events, event_participants and reports records; server clock.
