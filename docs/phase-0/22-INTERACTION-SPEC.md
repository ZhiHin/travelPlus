# Interaction model

**Status:** Phase 0 · 2026-08-19 · ADR-0018

## 1. Navigation

No permanent sidebar. Four surfaces, each with a defined job:

| Surface | Position | Job | Keyboard |
| --- | --- | --- | --- |
| **Command pill** | top, floating, centred | Search, create, command palette, theme, account | `⌘K` / `Ctrl+K` opens palette; `/` focuses search |
| **Journey dock** | bottom, floating, centred (desktop **and** mobile) | Trips · Discover · Plan · Today · Profile | `⌘1`–`⌘5`; arrow keys within |
| **Floating islands** | contextual, near their subject | Map controls, day switcher, mode toggles, undo | Tab order follows visual order |
| **Sheets** | right (desktop) / bottom (mobile) | Itinerary story, place detail, leg detail, settings | `Esc` closes, focus returns to opener |

The dock is centred on desktop rather than pinned left because the map is the ground plane and a
left-anchored bar would reintroduce the sidebar the product is defined against.

**Focus management, specified rather than improvised** — this is where floating-UI designs usually
fail accessibility (R-12):

- Opening a sheet moves focus to its first heading; `Esc` closes it and returns focus to the element
  that opened it.
- Sheets are modal on mobile (focus trapped, background inert) and non-modal on desktop (focus
  moves in, background stays operable) — because the desktop map must remain interactive.
- The dock is a single tab stop with arrow-key navigation inside, so a keyboard user does not tab
  through five items to reach the map.
- A visible skip link precedes the map: **"Skip to itinerary list"**.
- Focus is never trapped in the map canvas.

## 2. Map ↔ itinerary coupling

The two are one surface. The coupling is bidirectional and must not oscillate.

| Trigger | Response |
| --- | --- |
| Scroll the itinerary | Map eases to the item entering the focus band; camera only, no zoom change unless the geometry does not fit |
| Select a marker | Itinerary scrolls the matching item into the focus band and selects it |
| Select an item | Marker highlights; its inbound leg geometry emphasises |
| Hover a leg (desktop) | Geometry emphasises — **never** the only way to get the information |
| Change day | Map fits the day's bounds with padding for the floating surfaces |

**Loop prevention:** each side sets a source flag on the event. A map move caused by an itinerary
scroll does not re-trigger the itinerary. Programmatic camera moves are marked and ignored by the
listener.

**Focus band:** the item nearest the vertical centre of the panel's visible area — not the topmost.
This keeps the active item where the eye already is.

Camera padding accounts for the floating panel, dock and pill, so the active node is never behind
a floating surface. On mobile the padding changes with the sheet detent.

## 3. Drag, reorder and preview-before-commit

The contract: **the user sees the consequence before it happens.**

1. Drag begins → the dragged item lifts; valid drop targets show insertion points.
2. Over a target → only the **affected** legs restroke live. Unaffected legs do not move at all,
   which is the visual proof that recalculation is incremental (`10-ARCHITECTURE.md`
   §6).
3. Preview shows the arrival-time delta and any new conflicts before release.
4. Release commits; a version snapshot is written.
5. Undo is one action (`⌘Z`) and restores the previous version, not just the visual position.

Locked items refuse drops with a reason ("Lunch is locked to 13:00"), not a silent bounce.
Cross-day drags scroll the ribbon at the edges. A drop that creates an impossible transfer commits
**with the conflict shown** rather than being auto-corrected — resolving it is the user's decision,
and silently fixing it would violate "explain changes".

**Keyboard equivalent, of equal power:** `Space` grabs, `↑`/`↓` move within a day, `⌥↑`/`⌥↓` move
across days, `Space` drops, `Esc` cancels. Each step announces through a live region, and the same
preview appears before the drop. Not a lesser path — the same contract.

## 4. Search

Constrained by ADR-0011: no autocomplete anywhere. The design owns this rather than apologising.

1. Type freely. Nothing fires. No spinner, no flicker, no request per keystroke.
2. `Enter` or **Search** submits.
3. If the global 1 req/s limiter is busy, show **"Waiting for the geocoder… (about 1 s)"** — a named
   state, not a generic spinner.
4. Results are cached; a repeated query returns instantly and says **"from your recent searches"**.
5. Recent searches and saved places **are** offered as you type — these are local, so they cost no
   provider request and give the type-ahead feel where it is legitimate.

Point 5 is what makes the constraint liveable: the affordance users expect exists, sourced from data
we already hold.

## 5. AI planning

**Progress is honest.** Stages map one-to-one to the pipeline, and each shows real counters:

```
Understanding your preferences  ✓
Finding candidate places        ✓  12 candidates
Matching to real places         ✓  10 matched · 2 unmatched
Routing between stops           ⟳  6 of 9 legs
Checking your constraints       ·
```

Never a fake progress bar. The ribbon fills node by node as legs resolve, so progress and outcome
are the same visual object.

**Chain-of-thought is never exposed.** Stage names and counters only.

**Cancellable at every stage**, with partial results retained where they are valid.

**Review before apply is mandatory for destructive changes.** Per-change checkboxes; unresolved
candidates shown, unchecked and unappliable; unmet constraints listed with the specific preference
they violated.

**"Sources checked"** is projected from `ai_tool_events` rows. If the application did not make the
call, the claim cannot be rendered — the master prompt's rule is enforced by the data flow, not by
prompt discipline.

## 6. Confidence, everywhere, consistently

Six states, one vocabulary, three channels (text, stroke, node fill) — never colour alone.

| State | Words | Stroke | Node |
| --- | --- | --- | --- |
| `REALTIME` | "live · updated 41 s ago" | solid | filled + pulse |
| `SCHEDULED` | "scheduled" | solid | filled |
| `ESTIMATED` | "estimated" | dashed | filled |
| `MANUAL` | "you entered this" | solid | filled, outlined |
| `STALE` | "out of date · 11:04" | dashed | hollow |
| `UNAVAILABLE` | "not available" | dotted | hollow |

`REALTIME` and `STALE` always show a time, because "live" without an age is a claim nobody can
check.

## 7. Replanning and diffs

Never an unexplained replacement. Before/after are visible together: the old stroke fades to 30%
and the new one draws over 500ms. A change list states what moved and why in one sentence each.
Locked items are protected; moving an important item asks first. Accept all, accept selected, edit,
or reject.

## 8. Responsive behaviour

**Desktop ≥1280px** — full-bleed map, floating dock, itinerary panel 36–44% when expanded, map
always interactive and visible.

**Tablet 768–1279px** — map plus adaptable overlay sheet; dock condenses to icons with accessible
names retained; planner works in both orientations.

**Mobile <768px** — bottom dock and a three-detent draggable sheet (peek / half / full); safe-area
insets on every fixed element; 44×44px minimum targets; route steps readable one-handed; no
hover-only controls; the AI planner uses staged questions and chips rather than one long form.

The dock stays above the on-screen keyboard, and the sheet re-measures its detents when the keyboard
opens — otherwise the full detent lands under the keyboard, which is the classic mobile-sheet bug.

## 9. Motion and reduced motion

Motion explains: map focus, drag preview, diff draw, progress fill, realtime pulse. Nothing
ambient, and scrolling is never hijacked.

`prefers-reduced-motion: reduce` → all durations 0ms; fly-to becomes a cut; diff appears rather than
draws; progress is numeric rather than animated; the realtime pulse becomes a static dot with its
age in text. A designed variant, and a visual-regression test case.

## 10. Offline

Offline chip in the command pill from the moment connectivity drops. Unavailable capabilities are
visibly disabled **with a reason** — search, planning and rerouting need a connection — never
silently failing. Cached content shows a captured-at time. Safe edits queue with a visible pending
count and reconcile on reconnect; a conflict opens the same diff surface as a live version conflict
rather than a separate, weaker flow.
