# Accessibility requirements

**Status:** Phase 0 · 2026-08-19 · target **WCAG 2.2 AA**, verified in CI from Phase 1

Accessibility is a phase-gate condition here, not a polish item. Two things make that necessary
rather than aspirational: the navigation model is built entirely from floating surfaces
(ADR-0018), and one of the seven personas — P7, the traveller with access needs — is the sharpest
test of the whole confidence model. If the product cannot tell a wheelchair user "the feed does not
say", it has failed at its central claim, not at an accessibility checkbox.

---

## 1. The two structural commitments

### A11Y-S1 — The map is never the only access path

Every route, marker and geometry rendered on the map has an equivalent, complete,
keyboard-navigable list or step representation carrying the same information **including
provenance and status**. Not a summary — the same information.

This is ADR-0018a, and it is why the transit leg detail screen (`21-WIREFRAMES.md` §3) is a list
rather than a map annotation.

### A11Y-S2 — Status is never conveyed by colour alone

The six confidence states are distinguished by **text, stroke texture and node fill** as well as
hue (`23-DESIGN-DIRECTION.md` §4):

| State | Words | Stroke | Node |
| --- | --- | --- | --- |
| `REALTIME` | "live · updated 41 s ago" | solid | filled + pulse |
| `SCHEDULED` | "scheduled" | solid | filled |
| `ESTIMATED` | "estimated" | dashed | filled |
| `MANUAL` | "you entered this" | solid | filled, outlined |
| `STALE` | "out of date · 11:04" | dashed | hollow |
| `UNAVAILABLE` | "not available" | dotted | hollow |

The design's signature element and its accessibility solution are the same object. That is
deliberate — an accessibility affordance that is also the memorable visual is one nobody is tempted
to remove.

## 2. Requirements by WCAG principle

### Perceivable

| ID | Requirement |
| --- | --- |
| A-P1 | Text contrast ≥ 4.5:1; large text and UI components ≥ 3:1, in both themes |
| A-P2 | Translucent surfaces contrast-checked against the busiest map tile in the style; if they fail, they become opaque |
| A-P3 | Destination imagery has text alternatives; decorative imagery is `aria-hidden` |
| A-P4 | Route geometry has a text equivalent (A11Y-S1) |
| A-P5 | 200% zoom and text resizing without loss of content or function |
| A-P6 | Reflow at 320px width with no two-dimensional scrolling |
| A-P7 | Content is not restricted to a single orientation |
| A-P8 | All six confidence states legible in greyscale — a visual-regression test case |

### Operable

| ID | Requirement |
| --- | --- |
| A-O1 | Every interactive element reachable and operable by keyboard, including map controls |
| A-O2 | **Focus is never trapped in the map canvas** |
| A-O3 | Visible focus indicator, ≥ 3:1 against adjacent colours, never removed |
| A-O4 | Skip link to the itinerary list precedes the map |
| A-O5 | Itinerary reorder has a keyboard path of **equal power** — same cross-day moves, same preview contract |
| A-O6 | Dialogs and mobile sheets trap focus while modal and restore focus to the opener on close |
| A-O7 | Desktop sheets are non-modal so the map stays operable |
| A-O8 | The dock is one tab stop with arrow-key navigation inside |
| A-O9 | Interactive targets ≥ 44×44 px |
| A-O10 | No hover-only information; every hover reveal has tap and focus equivalents |
| A-O11 | Scrolling is never hijacked; no custom JS scrolling unless essential |
| A-O12 | Scrollbars are visible, theme-aware and pointer-usable — never `scrollbar-width: none` on scrollable content |
| A-O13 | `prefers-reduced-motion: reduce` sets all durations to 0 and replaces fly-to with a cut |
| A-O14 | Drag-and-drop has a non-dragging alternative (WCAG 2.2 §2.5.7) |
| A-O15 | Focus is never obscured by the dock, pill or a sheet (WCAG 2.2 §2.4.11) |

A-O15 is the requirement most at risk from this specific design. Floating surfaces anchored to
viewport edges are exactly what hides a focused element, so camera and scroll padding must account
for every floating surface at every breakpoint and sheet detent.

### Understandable

| ID | Requirement |
| --- | --- |
| A-U1 | Page language declared; per-element language on foreign place names |
| A-U2 | Six-phrase confidence vocabulary used identically everywhere — no synonyms |
| A-U3 | Errors identify what went wrong and how to fix it, in the interface's voice |
| A-U4 | Labels and instructions on every input; placeholder is never the only label |
| A-U5 | Navigation is consistent across screens |
| A-U6 | No unexpected context change on focus or input |
| A-U7 | Dates, times, currency, distance, temperature and pluralisation localised |

### Robust

| ID | Requirement |
| --- | --- |
| A-R1 | Valid, semantic HTML; landmarks for banner, main, navigation, complementary |
| A-R2 | Custom components expose correct name, role and value |
| A-R3 | Live regions announce AI job status, itinerary changes and reorder steps |
| A-R4 | Status messages use `role="status"`; alerts use `role="alert"` |

## 3. Component-specific specifications

**Journey dock** — `role="navigation"` with an accessible name; one tab stop; arrow keys move
between items; `aria-current="page"` on the active section.

**Command pill** — `⌘K` opens the palette, `/` focuses search; the palette is a modal dialog with
focus trapped, `aria-activedescendant` for the result list, and `Esc` to close.

**Journey ribbon** — an ordered list. Each node is a list item whose accessible name includes the
place, the time and the confidence state in words. The stroke is presentational and `aria-hidden`.

**Peek sheet** — three detents exposed as a resizable region; detent changes announced; the map
remains reachable in one gesture at every detent.

**Map** — `role="application"` with a described keyboard model; every marker has a list equivalent;
markers are not individually tab-focusable (that would produce hundreds of tab stops) — the list is
the keyboard path.

**Reorder** — `Space` grabs, `↑`/`↓` move within a day, `⌥↑`/`⌥↓` across days, `Space` drops, `Esc`
cancels. Announced at each step: *"Pastéis de Belém, position 2 of 4. Moving up. Position 1 of 4.
Two legs will change."*

**AI progress** — `role="status"`, `aria-live="polite"`; stage names and counters, never
chain-of-thought.

## 4. Accessibility data, and telling the truth about it

The product's own accessibility features are one thing; reporting the *world's* accessibility is
another, and it is where honesty matters most.

- `ACCESSIBILITY_UNKNOWN` is a **distinct** violation code from `ACCESSIBILITY_UNSATISFIED`
- "The feed does not say whether this station is step-free" is the correct answer when true, and is
  more useful than a confident guess
- `wheelchair_confidence` is `FEED`, `INFERRED` or `UNKNOWN`, stored per segment
- A step-free requirement with no accessible route **says so** and never silently routes someone up
  stairs
- Whether the pilot region's Prasarana feeds populate `wheelchair_boarding` is **unverified** and is
  an open item in `09-PILOT-REGION.md` §8

## 5. Verification

| Method | When | Scope |
| --- | --- | --- |
| axe-core automated | CI, every push from Phase 1 | Every core flow |
| Keyboard-only walkthrough | Every phase gate | That phase's flows |
| Screen reader (NVDA + VoiceOver) | Every phase gate | Dock, ribbon, sheets, reorder, AI progress |
| Greyscale visual regression | CI | All six confidence states |
| Reduced-motion visual regression | CI | All animated surfaces |
| 200% zoom + 320px reflow | CI visual regression | All breakpoints |
| Long-translation rendering | CI visual regression | Dock, ribbon, badges |
| Manual audit | Phase 8 | Full WCAG 2.2 AA |

Automated tooling catches perhaps a third of real issues, so the keyboard and screen-reader
walkthroughs are gate conditions in their own right rather than optional extras.

## 6. Known accessibility risks

| Risk | Mitigation |
| --- | --- |
| Floating UI obscures focus (A-O15) | Padding accounts for every floating surface at every detent; explicit test |
| Map-first design excludes non-visual users | A11Y-S1 makes the list a first-class path, not a fallback |
| Confidence conveyed by colour | A11Y-S2 uses three channels; greyscale test in CI |
| Drag-only reorder | Keyboard path of equal power (A-O5, A-O14) |
| Long translations break the dock | Visual regression with long-string locales |
| Late discovery | axe-core runs from Phase 1 on the shell, before there is much to fix |
