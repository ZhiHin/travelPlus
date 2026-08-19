# Roles and permissions

**Status:** Phase 0 · 2026-08-19

Authorization is resolved **server-side on every request**, from `trip_members`, never from a
client-supplied field. Row-level security enforces the same rules at the database as defence in
depth (`15-DATABASE-STRATEGY.md`).

---

## 1. Actor types

| Actor | Identity | How they reach a trip |
| --- | --- | --- |
| **Anonymous** | none | Marketing page, auth screens, and a valid share link only |
| **Authenticated user** | session cookie | Their own profile and preferences |
| **Trip member** | `trip_members` row | The trip they are a member of, at their role |
| **Share-link reader** | unguessable token | One trip, read-only projection, no account required |
| **System worker** | `travelplus_worker_sys` role | Feed sync, cache sweep, outbox drain — no user or trip tables |

A share-link reader is deliberately **not** a role on the trip. They are resolved before the database
session opens, through a dedicated read model, so no `OR is_public` branch ever weakens the member
policies.

## 2. Trip roles

| Capability | Owner | Editor | Viewer | Share reader |
| --- | --- | --- | --- | --- |
| View itinerary, days, items, routes | ✅ | ✅ | ✅ | ✅ |
| View places, notes, checklists | ✅ | ✅ | ✅ | ✅ |
| View bookings | ✅ | ✅ | ✅ | ❌ *(excluded by default)* |
| View confirmation references (unmasked) | ✅ | ✅ | ❌ | ❌ |
| View budget and expenses | ✅ | ✅ | ✅ | ❌ |
| Create / edit / delete itinerary items | ✅ | ✅ | ❌ | ❌ |
| Reorder, lock, unlock items | ✅ | ✅ | ❌ | ❌ |
| Run AI planning | ✅ | ✅ | ❌ | ❌ |
| Apply a change set | ✅ | ✅ | ❌ | ❌ |
| Restore a prior version | ✅ | ✅ | ❌ | ❌ |
| Create / edit bookings | ✅ | ✅ | ❌ | ❌ |
| Create / edit budget and expenses | ✅ | ✅ | ❌ | ❌ |
| Edit notes and checklists | ✅ | ✅ | ❌ | ❌ |
| Save places to the trip | ✅ | ✅ | ❌ | ❌ |
| Comment (Phase 7) | ✅ | ✅ | ✅ | ❌ |
| Vote on places (Phase 7) | ✅ | ✅ | ✅ | ❌ |
| Edit trip settings, dates, destinations | ✅ | ❌ | ❌ | ❌ |
| Invite or remove members | ✅ | ❌ | ❌ | ❌ |
| Change a member's role | ✅ | ❌ | ❌ | ❌ |
| Create or revoke share links | ✅ | ❌ | ❌ | ❌ |
| Change trip visibility | ✅ | ❌ | ❌ | ❌ |
| Archive, restore, delete the trip | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |

**Viewers may comment and vote.** Reading a plan and having an opinion about it are different from
editing it, and a group trip where only editors can express a preference defeats the collaboration
feature (persona P4).

## 3. Rules that constrain the model

| # | Rule | Enforcement |
| --- | --- | --- |
| R1 | Exactly one owner per trip, always | Partial unique index on `trip_members` |
| R2 | An owner cannot leave their own trip; they must transfer ownership first | Service check + R1 |
| R3 | Ownership transfer is atomic — demote and promote in one transaction | Transaction |
| R4 | A non-member requesting a real trip gets `404`, never `403` | `17-ERROR-CODES.md` |
| R5 | A confirmed member with the wrong role gets `403 INSUFFICIENT_ROLE` | Service |
| R6 | Role never comes from the request body | Zod schemas omit it from writable fields |
| R7 | Viewers see edit affordances **absent**, not present-and-failing | UI, plus server rejection |
| R8 | Share readers never receive private booking detail unless the owner opts in per field | Read model |
| R9 | Revoked and never-existent share tokens are indistinguishable in shape and timing | Read model |
| R10 | Invitation binds to an exact email, is single-use, and expires | `invitations` constraints |
| R11 | Accepting an invitation requires an authenticated session matching that email | Service |
| R12 | The system worker role has no grant on user or trip tables | Database grants |

R4 is the one most often got wrong. Distinguishing "exists but forbidden" from "does not exist" lets
an attacker enumerate trips by ID, so both return the same thing.

## 4. Permission checks in the request path

```
request
  → resolve session            (401 if absent or expired)
  → resolve trip membership    (404 if no membership row and no valid share token)
  → check role capability      (403 INSUFFICIENT_ROLE if the verb exceeds the role)
  → open txn, set app.current_user_id
  → service executes; RLS independently re-filters every row
```

Two independent gates. The service check produces good error messages; RLS produces safety when the
service check is missing. A repository that loses its `WHERE` clause returns zero rows rather than
another user's trip — and that is a tested property, not an assumption
(`15-DATABASE-STRATEGY.md` §5, test 4).

## 5. AI tool authorization

The planning model has four read-only tools. Each **re-authorizes against the session actor**, never
against an identifier supplied by the model:

| Tool | Authorization |
| --- | --- |
| `searchPlaces(query, bbox)` | Rate-limited; no trip scope needed |
| `getSavedPlaces(tripId)` | Session actor must be a member of `tripId` |
| `getTripContext(tripId)` | Session actor must be a member of `tripId` |
| `getWeather(coord, date)` | No trip scope needed |

No tool writes. No tool fetches a URL. No tool sends mail. A model instructed by an injection payload
to read another trip receives a denial, and the attempt is recorded in `ai_tool_events` and alerted
on (`27-OBSERVABILITY.md` §7).

## 6. Privacy interaction

Roles govern trip data. They do not override a user's own privacy settings: a collaborator never
sees another member's location history, home time zone, saved profile places or AI conversation
history, regardless of role. Trip-scoped conversations are visible to trip members; profile-scoped
data is not (`19-PRIVACY-AND-RETENTION.md`).
