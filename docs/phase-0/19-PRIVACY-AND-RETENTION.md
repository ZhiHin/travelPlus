# Privacy and data-retention design

**Status:** Phase 0 · 2026-08-19

Travel data is unusually sensitive in a specific way: **a trip itinerary with dates reveals that a
home is empty on those dates**, and a location history reveals where a person physically was. The
design treats those two as the crown jewels, not the email address.

---

## 1. Data inventory and classification

| Class | Data | Handling |
| --- | --- | --- |
| **Critical** | Session tokens, password hashes, `ENCRYPTION_KEY` | Never logged, never cached client-side, hashed or encrypted at rest |
| **Sensitive** | Trip itineraries with dates, location history, booking confirmation references, precise coordinates of private places | Encrypted where noted, minimised to the model, never in logs, excluded from share links by default |
| **Personal** | Email, display name, home time zone, locale, preferences | Minimum collection, never disclosed across trips |
| **Behavioural** | AI conversation content, search queries, analytics events | Governed by explicit user settings |
| **Public** | Places, transit feeds, route snapshots, weather | No personal data; freely cacheable |

Route snapshots sit in **Public** deliberately: they are answers about public transport and contain
no personal data. The *link* between a snapshot and a trip lives in `itinerary_items`, which is
member-protected. Someone who guesses a snapshot ID learns that a bus goes from A to B, not who is
riding it.

## 2. Privacy by default

Every privacy-relevant setting defaults to the restrictive value. A user who never opens settings is
in the most private configuration.

| Setting | Default | Effect when off |
| --- | --- | --- |
| Location history | **Off** | Geolocation used transiently for the current action, never persisted |
| Analytics | **Off** | No behavioural events recorded |
| AI input retention | **`SESSION`** | Conversation content dropped after the job; only structural metadata kept |
| Share profile on shared trips | **Off** | Collaborators see a display name, nothing else |
| Trip visibility | **`PRIVATE`** | No link access until explicitly created |
| Share link includes bookings | **Off** | Private booking detail excluded |

`ai_input_retention` has three values and each is enforced in storage, not merely in UI:

- `NONE` — `messages.content` stores structural metadata only; no user text is persisted
- `SESSION` — content retained for the duration of the job, then purged by a scheduled sweep
- `RETAINED` — content kept for the trip's life, so the conversation is re-readable

## 3. Data minimisation to the AI provider

Before any model call:

1. Only the current planning scope is sent — the day or trip being planned, not the account.
2. Email, display name, other trips and collaborator identities are **never** included.
3. Coordinates are sent at the precision routing requires and no more.
4. Secrets are redacted by an allow-list serializer, so a careless object spread cannot leak one.
5. Untrusted third-party text is delimited and labelled as data (`12-AI-PLANNING-WORKFLOW.md` §6).

`ai_tool_events` records that a tool ran and a summary of its output — not the full payload.

## 4. Logging restrictions

Never logged: passwords, tokens or their hashes, session identifiers, full AI prompts, booking
confirmation references, precise private coordinates, provider credentials, or request bodies
containing personal data. A redaction layer strips known-sensitive keys before serialisation, so the
rule holds even when someone logs an object carelessly.

**Coordinates in logs are rounded to roughly 1 km.** Knowing a route was planned in Kuala Lumpur is
operationally useful; knowing which building someone stood in front of is a liability with no
operational value.

`audit_events` records that a sensitive change happened, by whom, and against what — never the
sensitive value itself.

## 5. Retention schedule

| Data | Retention | Trigger | Rationale |
| --- | --- | --- | --- |
| Sessions | Until expiry, then purged | Scheduled sweep | No value after expiry |
| Verification tokens | Until consumed or expired | Sweep | Single-use by design |
| `messages` content | Per user's `ai_input_retention` | Sweep | The setting must have teeth |
| `ai_tool_events` | 90 days | Sweep | Security investigation window |
| `provider_cache_entries` | Per-provider TTL | Daily sweep | Provider policy compliance |
| `route_snapshots` unreferenced by a live version | 90 days | Sweep | Grows unboundedly by design |
| `service_alert_snapshots` | 30 days past `active_to` | Sweep | Historical value decays fast |
| `itinerary_versions` | Life of the trip | Trip deletion | Restore is a product feature |
| Soft-deleted trips | 30 days, then hard delete | Sweep | Recovery window |
| `audit_events` | 24 months | Sweep | Investigation and dispute window |
| Location history (if enabled) | 90 days, user-purgeable at any time | Sweep + user action | Sensitive; short by default |
| Analytics events (if enabled) | 12 months, aggregated after 90 days | Sweep | — |
| Deleted account | Purged within 30 days | Deletion request | See §6 |

Retention is implemented as scheduled worker jobs with their own tests. A retention policy that is
documented but not executed is worse than none, because it creates a false record of compliance.

## 6. Account deletion cascade

A deletion request is honoured within 30 days, with a grace period during which it can be cancelled.

| Data | On deletion |
| --- | --- |
| `users`, `auth_accounts`, `sessions`, preferences, privacy settings | Hard deleted |
| Trips solely owned by the user | Hard deleted with all children |
| Trips where the user was a member | Membership removed; the trip survives for its other members |
| **Trips the user owned with other members** | **Ownership must be transferred or the trip is deleted — the user is asked to choose** |
| `messages`, `ai_planning_jobs`, `ai_tool_events` | Hard deleted |
| Bookings, expenses, notes, checklists authored by the user | Deleted with their trip; in surviving shared trips, authorship is anonymised |
| `audit_events` | Actor ID anonymised, event retained — the audit trail must survive its subject |
| Route snapshots | Retained — they contain no personal data |

The shared-ownership case is the one that needs a product decision rather than a cascade rule, which
is why it prompts the user instead of guessing.

## 7. Account export

Machine-readable JSON containing profile, preferences, trips owned or joined, itineraries, saved
places, bookings (with confirmation references decrypted for the owner), budget, expenses, notes and
checklists. Excludes other users' personal data and excludes route snapshots by reference rather than
value. Generated as a job, delivered through a single-use expiring link.

## 8. Geolocation

- Requested only after an explicit user action — never on page load
- Never continuous; a single fix per action
- Not persisted unless location history is explicitly enabled
- Denied permission degrades cleanly: Today mode works from the plan
- Never sent to a third party

## 9. Share links and privacy

Read-only, revocable, unguessable (256-bit token, hashed at rest). Private booking detail excluded by
default, with per-field owner opt-in. Revocation is immediate rather than cache-dependent. Revoked
and never-existent tokens are indistinguishable in shape and timing.

Because share readers are resolved **before** the database session opens, through a dedicated read
model, there is no "public" branch inside the member policies waiting to be got wrong
(`15-DATABASE-STRATEGY.md` §4).

## 10. Third-party data flow

| Provider | Receives | Does not receive |
| --- | --- | --- |
| Nominatim | Search query text, via our server | User identity, session, trip context |
| OTP (self-hosted) | Coordinates and times | Everything else — it is ours |
| Open-Meteo | Coordinates and dates | User identity |
| Wikimedia | Place references | User identity |
| Ollama (local) | Minimised planning context | Email, other trips, collaborators |
| OpenFreeMap | Tile requests from the browser | Nothing we send deliberately |

Because every provider except tiles is server-proxied, no user identity attaches to any third-party
request. The tile provider necessarily sees browser IP addresses — that is inherent to map rendering
and is disclosed rather than hidden.

## 11. Compliance posture

Not a legal opinion. The design supports the common data-subject rights structurally: access
(export), erasure (deletion cascade), rectification (everything is editable), portability
(machine-readable export), and restriction (privacy toggles that genuinely change what is stored).
A jurisdiction review is a pre-launch task, not a Phase 0 deliverable.
