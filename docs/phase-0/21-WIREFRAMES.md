# Low-fidelity wireframes

**Status:** Phase 0 · 2026-08-19 · structure and hierarchy only, no visual styling

Legend: `▓` map canvas · `┃` journey ribbon stroke · `●` routed node · `○` unrouted node ·
`◎` locked · `╋` transfer

---

## 1. Journey canvas — desktop (≥1280px)

The core screen. Full-bleed map; itinerary is a floating story panel at 36–44%; no sidebar anywhere.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│        ╭──────────────────────────────────────────────────╮                  │
│        │ ⌕  Search, or type a command            ⌘K   ◑ ⚙ │  ← command pill  │
│        ╰──────────────────────────────────────────────────╯                  │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ┌───────────────────────────────────────────┐│
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ LISBON            Day 2 of 6   ‹ Apr 11 › ││
│ ▓▓▓▓▓▓▓ ●───────▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ───────────────────────────────────────── ││
│ ▓▓▓▓▓▓▓▓▓╲▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ┃                                         ││
│ ▓▓▓▓▓▓▓▓▓▓●▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ● 09:00  Jerónimos Monastery        1h30 ││
│ ▓▓▓▓▓▓▓▓▓▓▓╲▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ┃   ↓ tram 15E · 12 min · scheduled       ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓●▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ● 11:00  Pastéis de Belém           0h45 ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ┃   ↓ walk 350 m · 5 min · estimated      ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ◎ 13:00  Lunch — booked             1h30 ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ┃   ↓ ╋ metro + walk · 24 min · live      ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ○ 15:30  Miradouro          not available ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │      ⚠ No route found for this time.      ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │        Try walking · Move later · Remove  ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ───────────────────────────────────────── ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ⊕ ▓ │  + Add stop        ⤺ Undo    ⟲ Versions   ││
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ⊖ ▓ └───────────────────────────────────────────┘│
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  OpenFreeMap © OSM ⌃       │
│            ╭────────────────────────────────────────────╮                    │
│            │  Trips   Discover   ◆Plan   Today   Profile │  ← journey dock    │
│            ╰────────────────────────────────────────────╯                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes: the map is never occluded — the panel floats over it with the camera offset so the active
node stays visible. Scrolling the panel moves the map camera; selecting a marker scrolls the panel.
The 15:30 item shows the `UNAVAILABLE` treatment: hollow node, dotted stroke, inline explanation,
three concrete fallbacks. This is a designed state, not an error.

---

## 2. Journey canvas — mobile (375px)

```
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│ ╭───────────────────╮ │   │ ╭───────────────────╮ │   │ ‹ Back      Day 2  ⋯ │
│ │ ⌕ Search      ⌘  │ │   │ │ ⌕ Search      ⌘  │ │   ├───────────────────────┤
│ ╰───────────────────╯ │   │ ╰───────────────────╯ │   │ ┃                     │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ● 09:00 Jerónimos     │
│ ▓▓▓▓▓●▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ▓▓▓▓▓●▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ┃  ↓ tram 15E  12 min │
│ ▓▓▓▓▓▓╲▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   ├───────────────────────┤   │ ┃    scheduled        │
│ ▓▓▓▓▓▓▓●▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ═══════ (grabber)     │   │ ● 11:00 Pastéis       │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ Day 2 · Sat 11 Apr    │   │ ┃  ↓ walk 350 m 5 min │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ┃                     │   │ ┃    estimated       │
├───────────────────────┤   │ ● 09:00 Jerónimos     │   │ ◎ 13:00 Lunch· booked │
│ ═══════ (grabber)     │   │ ┃  ↓ tram 15E 12 min  │   │ ┃  ↓ ╋ metro  24 min  │
│ Day 2 · 4 stops       │   │ ● 11:00 Pastéis       │   │ ┃    live · 2 min ago │
│ ● ┃ ● ┃ ◎ ┃ ○   ← ribbon │ ┃  ↓ walk 5 min       │   │ ○ 15:30 Miradouro     │
│ 09:00 → 17:30         │   │ ◎ 13:00 Lunch         │   │   ⚠ No route found.   │
├───────────────────────┤   │ ┃  ↓ ╋ metro 24 min   │   │   Walking · Later ·   │
│ Trips Disc ◆ Today Me │   │ ○ 15:30 Miradouro  ⚠  │   │   Remove              │
└───────────────────────┘   └───────────────────────┘   └───────────────────────┘
   PEEK (map-dominant)         HALF (default)              FULL (list-dominant)
```

The sheet has three detents. Dragging between them is continuous; the dock stays anchored above the
safe area at every detent. At FULL the map is still reachable in one gesture — the user is never
trapped in a list.

---

## 3. Transit leg detail — the honesty screen

```
┌───────────────────────────────────────────────────────┐
│ ‹  Pastéis de Belém → Lunch                     ✕     │
│───────────────────────────────────────────────────────│
│  24 min · 1 transfer · 450 m walking                  │
│  ⟨scheduled⟩  retrieved 11:04 · Carris feed v2026-04  │
│───────────────────────────────────────────────────────│
│  ●  Walk 350 m to Belém                        6 min  │
│  ┃                                                    │
│  ●  Board  15E  toward Praça da Figueira      09:12   │
│  ┃  Carris · tram                                     │
│  ┃  4 stops                                           │
│  ●  Alight  Cais do Sodré                     09:24   │
│  ╋  Transfer · walk 5 min                             │
│  ●  Board  Green line  toward Telheiras       09:31   │
│  ┃  Metro de Lisboa                                   │
│  ●  Alight  Baixa-Chiado                      09:35   │
│  ●  Walk 100 m to Lunch                        2 min  │
│───────────────────────────────────────────────────────│
│  ⓘ Platform and accessibility are not in this feed.   │
│  Sources: Carris GTFS v2026-04 · Metro GTFS v2026-03  │
│  ↗ Open in maps                                       │
└───────────────────────────────────────────────────────┘
```

The final note is the point of the whole product. Platform is **absent**, and the screen says so
rather than printing a plausible number. Every element traces to a feed, and the feeds are named.

---

## 4. Proposal and diff review

```
┌────────────────────────────────────────────────────────────────────┐
│  Proposed changes — Day 2                        Generated 14:03   │
│  8 legs routed · 1 estimated · 0 unavailable                       │
│────────────────────────────────────────────────────────────────────│
│  ☑ Remove  Oceanário                                               │
│      Doesn't fit your 2 h 30 travel budget for the day.            │
│      ─────────────  before  ─────────────  after  ───────────      │
│      ● 14:00 Oceanário   →   (removed)                             │
│                                                                    │
│  ☑ Move    Miradouro to 16:00                                      │
│      Golden hour, and it clears your 19:00 dinner booking.         │
│      ● 15:30 → ● 16:00 · leg rerouted · 18 min · scheduled         │
│                                                                    │
│  ☐ Add     Feira da Ladra                                          │
│      ⚠ Couldn't match this to a real place. Not applied.           │
│────────────────────────────────────────────────────────────────────│
│  Couldn't satisfy: max walking per day (2.1 km of your 2 km)       │
│  Sources checked: OpenTripPlanner ×9 · Nominatim ×4 · Open-Meteo ×1│
│────────────────────────────────────────────────────────────────────│
│           [ Apply 2 selected ]    [ Reject all ]                   │
└────────────────────────────────────────────────────────────────────┘
```

Three things this screen must do and does: each change is independently selectable; the unresolved
candidate is **shown and unchecked and unappliable**, not quietly dropped and not invented into
existence; "sources checked" is projected from `ai_tool_events`, so it cannot claim a call that did
not happen.

---

## 5. Trip-space home

```
┌──────────────────────────────────────────────────────────────────────┐
│          ╭──────────────────────────────────────────────╮            │
│          │ ⌕ Search trips and places            ⌘K  ◑ ⚙ │            │
│          ╰──────────────────────────────────────────────╯            │
│                                                                      │
│   Upcoming ────────────────────────────────────────────────────      │
│   ┌──────────────────────┐  ┌──────────────────────┐                 │
│   │ ░░░░ cover ░░░░░░░░░ │  │ ░░░░ cover ░░░░░░░░░ │                 │
│   │ LISBON               │  │ HELSINKI             │                 │
│   │ 10–17 Apr · 2 people │  │ 3–9 Jun · solo       │                 │
│   │ ● ┃ ● ┃ ◎ ┃ ●        │  │ ○ ┈ ○ ┈ ○            │                 │
│   │ ⟨live transit⟩       │  │ ⟨walking only⟩       │                 │
│   └──────────────────────┘  └──────────────────────┘                 │
│                                                                      │
│   Planning ────────────────────────────────────────────────────      │
│   ┌──────────────────────┐  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                 │
│   │ KUALA LUMPUR         │  │        +             │                 │
│   │ dates not set        │  │   New trip           │                 │
│   └──────────────────────┘  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                 │
│          ╭──────────────────────────────────────────────╮            │
│          │  Trips   Discover   ◆Plan   Today   Profile  │            │
│          ╰──────────────────────────────────────────────╯            │
└──────────────────────────────────────────────────────────────────────┘
```

The mini-ribbon on each card carries the same stroke grammar, so coverage tier is legible before the
trip is even opened. The second card's dotted ribbon and "walking only" badge tell the truth at a glance.

---

## 6. Discovery — search without autocomplete

```
┌───────────────────────────────────────────────────────┐
│ ⌕ [ pastéis de nata belém        ]  [ Search ]        │
│                                        ↑              │
│   Press Enter or Search. Results are cached.          │
│───────────────────────────────────────────────────────│
│  ⏳ Waiting for the geocoder… (about 1 s)             │
│───────────────────────────────────────────────────────│
│  ● Pastéis de Belém                                   │
│    Rua de Belém 84–92 · bakery                        │
│    Opening hours not published · typical visit 45 min │
│    OpenStreetMap · ODbL              [ Save ] [ Add ] │
└───────────────────────────────────────────────────────┘
```

There is no type-ahead, because implementing one against the public geocoder is prohibited
(ADR-0011). The design absorbs this honestly: an explicit Search action, a named waiting state, and
cached results — rather than a broken-feeling text field that does nothing as you type.

---

## 7. Today mode — live

```
┌───────────────────────┐
│ Today · Sat 11 Apr    │
│───────────────────────│
│  NOW                  │
│  Pastéis de Belém     │
│  until 12:45          │
│  [ Done ] [ Skip ]    │
│───────────────────────│
│  NEXT                 │
│  ┃ tram 15E           │
│  ┃ dep 12:52 ⟨live⟩   │
│  ┃ 2 min late         │
│  ┃ updated 41 s ago   │
│  ● Lunch  13:00 ◎     │
│───────────────────────│
│  [ Running late… ]    │
│  [ ↗ Open in maps ]   │
│───────────────────────│
│ Trips Disc ◆ Today Me │
└───────────────────────┘
```

One-handed reach: the two primary actions sit in the lower third. The live badge shows an age, not
just a label — "updated 41 s ago" is what makes "live" a claim rather than a decoration, and it is
what turns into "out of date" when the feed goes quiet (R-15).

---

## 8. Offline

```
┌───────────────────────┐
│ ⌕ Search    ⊘ Offline │
│───────────────────────│
│  Saved 2 h ago        │
│  Some things are off  │
│  until you reconnect. │
│───────────────────────│
│  [ map unavailable ]  │
│   Route steps below   │
│   are still readable. │
│───────────────────────│
│  ● 13:00 Lunch        │
│  ┃ ↓ metro · 24 min   │
│  ┃   scheduled        │
│  ● 15:30 Miradouro    │
│───────────────────────│
│  ⊘ Search, planning   │
│    and rerouting need │
│    a connection.      │
│  ↑ 1 change waiting   │
└───────────────────────┘
```

The map area states what it is rather than showing a broken tile grid. Disabled capabilities are
listed with a reason. The pending-change count makes the queue visible instead of hoping the user
trusts it.

---

## 9. Keyboard reorder — the accessible equivalent

Drag-and-drop is not the only way to reorder. The keyboard path has equal power, not a reduced one.

```
┌───────────────────────────────────────────────────────┐
│  Day 2 · reordering                                   │
│  ● 09:00 Jerónimos                                    │
│  ▸ 11:00 Pastéis de Belém        ← grabbed (Space)    │
│  ● 13:00 Lunch ◎ locked                               │
│                                                       │
│  ↑ ↓ move · Space drop · Esc cancel                   │
│                                                       │
│  Preview: 2 legs change. Lunch stays put (locked).    │
└───────────────────────────────────────────────────────┘
```

Announced through a live region at each step: "Pastéis de Belém, position 2 of 4. Moving up.
Position 1 of 4. Two legs will change." The same preview-before-commit contract as dragging.
