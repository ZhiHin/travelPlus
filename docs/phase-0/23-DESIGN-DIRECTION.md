# Design direction — "Transit Cartography"

**Status:** Phase 0 · 2026-08-19

## 1. Where this direction comes from

Not from travel blogs. From **transit wayfinding**: the diagram on a station wall, the route bullet
on a bus, the departure board, the tick marks on a printed timetable. That vernacular is precise,
built for people in a hurry who do not speak the local language, and it already has a visual
grammar for the exact thing this product must communicate — *how confident are we about this*.

The brief asks for "premium editorial travel aesthetic combined with precise transit information".
The editorial half is the destination. The transit half is the diagram. This direction resolves the
tension by giving each half a different register and letting them meet at the Journey Ribbon.

**The one rule that shapes everything else: colour is a confidence channel, not a decoration
channel.** The vivid route blue is reserved exclusively for geometry and facts that came from a
provider response. Nothing else in the product may use it — not a primary button, not a link, not a
brand flourish. When a traveller sees that blue, it means *this was verified*. Spending it on a
"Save" button would be spending the product's credibility on a button.

## 2. Palette

Six named values. The warm off-white is **paper**, not cream — ticket stock and map margin, not a
latte.

```css
:root {
  --paper:    #F7F5F1;  /* surfaces — warm, low-chroma, printed-map white */
  --ink:      #16181C;  /* primary text — charcoal with a cool cast */
  --graphite: #5B6069;  /* secondary text, hairlines, node strokes */
  --route:    #0B5FFF;  /* RESERVED: verified transit + routed geometry only */
  --caution:  #B45309;  /* estimated and stale — amber, never red */
  --void:     #9AA0A8;  /* unavailable — deliberately inert, desaturated */
}
```

**Destination accent** is derived per trip, not chosen from a swatch list: sample the dominant hue
of the destination's cover image, then clamp chroma and lightness into a band that guarantees
contrast against both `--paper` and `--ink`. Lisbon comes out tiled-blue-green, Marrakesh
ochre-red, Reykjavík slate. It colours the trip's atmosphere — cover wash, day headers, marker
fills — and **never** the route line.

Why amber rather than red for caution: red means *danger* in transit signage, and "we estimated
this walking time" is not danger. Reserving red keeps it available if a genuine safety state is
ever needed.

**Dark theme is designed, not inverted.** The paper becomes a deep blue-black slate rather than a
darkened cream, and the route blue brightens to hold its contrast:

```css
:root[data-theme="dark"] {
  --paper:    #0E1116;
  --ink:      #E8E6E1;
  --graphite: #9BA1AA;
  --route:    #4D8BFF;   /* brightened: 0B5FFF fails contrast on a dark ground */
  --caution:  #F0A868;
  --void:     #6B7178;
}
```

## 3. Typography — three roles, three jobs

| Role | Face | Job |
| --- | --- | --- |
| Display | **Archivo** (variable, width axis) — set expanded, 600–700 | Destination names. Wide, horizon-like, poster presence |
| Body / UI | **Instrument Sans** | Everything a person reads in sentences |
| Data | **IBM Plex Mono**, tabular figures | Times, route numbers, durations, distances, stop codes |

The mono face is a functional requirement before it is a stylistic one: departure times stacked in a
list must align on the colon, and durations must not reflow as digits change. `font-variant-numeric:
tabular-nums` on every numeric field.

Deliberately **not** a high-contrast display serif. That pairing — serif display, cream ground,
terracotta accent — is the current default look for anything travel-adjacent, and it would make this
product look like every AI-generated landing page. The expanded grotesque reads as signage and
horizon, which is what a destination name actually is.

Scale, 1.25 ratio, clamped for fluid sizing:

```
display-xl  clamp(2.75rem, 6vw, 5rem)   Archivo Expanded 700, tracking -0.02em
display-l   clamp(2rem, 4vw, 3rem)      Archivo Expanded 600
title       1.5rem   Instrument Sans 600
body        1rem     Instrument Sans 400, line-height 1.55
label       0.8125rem Instrument Sans 500, tracking 0.02em, sentence case
data        0.8125rem IBM Plex Mono 500, tabular-nums
data-sm     0.6875rem IBM Plex Mono 500  — stop codes, platform, minimum size
```

`data-sm` at 11px is the floor. Nothing carrying meaning goes smaller, and it must survive 200%
zoom without truncation.

## 4. The signature: one stroke grammar at three scales

The Journey Ribbon is drawn as a transit diagram, and **the stroke itself encodes data confidence**.
The same grammar appears on the map geometry, in the ribbon, and in the step detail — one language,
three zoom levels.

```
  ●━━━━━━━━━━●          solid stroke, filled nodes    → routed from provider data
  ●╌╌╌╌╌╌╌╌╌╌●          dashed stroke                 → ESTIMATED
  ○┈┈┈┈┈┈┈┈┈┈○          dotted stroke, hollow nodes    → UNAVAILABLE / not routed
  ●━━━━╋━━━━━●          cross tick mid-stroke          → transfer
  ◎━━━━━━━━━━●          ringed node                    → locked item
  ●━━━━━━━━━━●  ⟨live⟩   solid + pulse dot at the node  → REALTIME, inside freshness window
```

This does three jobs at once, which is why it earns the "signature" slot:

1. It is memorable and specific to this product.
2. It satisfies WCAG "not by colour alone" **structurally** — stroke texture and node fill carry
   status independently of hue, so the same diagram works in greyscale and for colour-blind users.
3. It scales down to a 4px-tall ribbon on mobile and still reads.

Everything else stays quiet. One bold idea, executed precisely; no second flourish competing with it.

## 5. Surfaces and geometry

- **Radius:** 14px on floating surfaces (dock, sheets, islands), 8px on inline controls, **0 on the
  route diagram** — the diagram is technical drawing and should not look soft.
- **Elevation:** two levels only. Floating surfaces get `0 1px 2px rgb(0 0 0 / .06), 0 8px 24px
  rgb(0 0 0 / .10)`. Inline cards get a 1px `--graphite` hairline at 15% and no shadow. A page of
  identical drop-shadowed cards is the dashboard look this product is defined against.
- **Translucency:** only on the dock and the command pill, only `backdrop-filter: blur(20px)` over a
  ≥88% opaque ground, and **only after** a contrast check against the busiest map tile in the style.
  If it fails, it becomes opaque. Legibility outranks the effect every time.
- **Hairlines:** 1px `--graphite` at 15–20%. They separate; they do not box things in.

## 6. Motion

Motion explains state changes and nothing else.

| Moment | Treatment |
| --- | --- |
| Itinerary scroll → map focus | 420ms `cubic-bezier(.32,.72,0,1)` fly-to, camera only |
| Marker select → itinerary scroll | 280ms scroll with a 1-beat node flash |
| Drag preview | affected legs restroke live; unaffected legs do not move at all |
| Replan diff | old stroke fades to 30%, new stroke draws in over 500ms, both visible together |
| Long AI job | ribbon nodes fill left to right as legs resolve — real progress, not a spinner |
| Realtime badge | 2s pulse on the node, amplitude under 15% |

No ambient motion. No parallax on scroll except a restrained cover-image shift on trip cards. Route
geometry animates to explain direction or a state change, never as decoration.

`prefers-reduced-motion: reduce` sets every duration to 0ms and replaces the fly-to with a cut. Not
a degraded path — a designed one, and one of the visual-regression test cases.

## 7. Scrollbar

Standards CSS only, theme-aware, never hidden:

```css
* { scrollbar-width: thin; scrollbar-color: var(--graphite) transparent; }
```

Thin, not none. Content that scrolls must show that it scrolls, and the thumb must stay large enough
to grab with a mouse. No JavaScript scroll hijacking anywhere in the product.

## 8. Attribution as a designed element

Attribution is a licence condition (`07-COVERAGE-STRATEGY.md` §5.5) and it occupies real
estate on a map-first mobile screen. It is designed, not bolted on:

- Persistent bottom-right chip in `data-sm`, `--graphite`, over a translucent scrim
- Expands on tap to full per-source attribution: tiles, geocoder, weather, each transit feed
- Never hidden behind a toggle; never off-screen; never below the safe area
- Feed attribution renders from `transit_feeds.attribution` so it cannot drift from the data

## 9. Writing

- Buttons name the outcome: "Generate plan", not "Submit". The word survives into the result:
  "Plan generated".
- Missing data states what is missing and offers the next move: **"No transit data for this area
  yet. Showing walking and driving routes."** Not "Something went wrong".
- Never apologise for a data gap. State it and offer a fallback.
- Confidence language is fixed vocabulary, used identically everywhere: **live · scheduled ·
  estimated · you entered this · out of date · not available**. Six phrases, mapped one-to-one to
  the six `DataStatus` values. No synonyms — a person learning "scheduled" once should never meet
  "timetabled" later.
- Empty screens invite: "No saved places yet. Search or drop a pin to start collecting."

## 10. Quality floor

Not announced in the UI, simply true: responsive to 320px, visible keyboard focus on every
interactive element including map controls, reduced motion honoured, 44×44px minimum targets,
200% zoom without loss of function, all six confidence states legible in greyscale.
