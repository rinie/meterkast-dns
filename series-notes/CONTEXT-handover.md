<!--
Copied verbatim from rinie.github.io/CONTEXT-handover.md on 2026-07-18, for
provenance. This is the parent Gutenberg/Semantic blog series' own working
handover note — it documents the series' vocabulary, house style, and the
queue of undrafted seed notes, including `note-reflection-external-resolver.md`,
the seed note this repo's design was inspired by (title only; this session
never saw that note's actual contents — see README.md §3).

Included here so the design in this repo is traceable back to its source
context without depending on the other repo staying reachable or unchanged.
Everything below the rule is the original file, unedited.
-->

---

# Gutenberg/Semantic Series — Handover Note

Purpose: hand this file, the README, and the `note-*.md` seed notes to a new
conversation so it can continue the series without losing context. The posts
and notes are self-contained; this file captures the working conventions and
standing decisions that lived in conversation rather than in any file.

## Current state
- Series is at 72 posts. The README table is the authoritative index — every
  post, its date, its URL slug, and a one-line description.
- Posts drip-feed one per day. Latest drafted is post 72 (2026-07-25).
- All drafts and notes are in this folder (`outputs/`).

## Undrafted seed notes still on the shelf (the queue)
- note-hiding-seams-not-best-practice.md (rich, ready — the fence/seam material)
- note-waterline-evolution.md (libc, OS page size growth)
- note-let-the-90-win.md (CarPlay, Tesla, glued SIM)
- note-train-left-on-time.md (vanity metrics, the car that waits)
- note-schmiel-painter-386-move.md (non-technical "next version won't be clean")
- note-reflection-external-resolver.md (kept by explicit request)
- note-page15-vs-uuid-postit.md (UUID-as-living-room-brick angle still unused;
  the page/tar/zip/Parquet core already became post 68)

## Working conventions (the house style)
- No cheerleading, no performed enthusiasm. State the observation and stop.
- Avoid "honest/genuine" vocabulary in notes and posts; use "direct/real/actually".
- Standing prior: assume the user is correct and the Def is wrong until evidence
  shows otherwise. "The odds are worse for the Def."
- Breadth-first before drafting: check new material against existing posts for
  overlap before writing, not after. (This caught the post-63/living-room-bricks
  overlap.)
- 24-hour time notation.
- Each post ends with a "part of the series / Related:" footnote linking 3-ish
  prior posts by slug.
- Posts carry front matter: layout, title, date, tags, level (general|technical),
  description.
- Primary sources are the spine of the strongest posts (Brooks, Gall, Shirky,
  the nanomsg/Sustrik rationale). Anchor on a named, on-record source where one
  exists; present synthesis across domains as the author's framing, not as an
  established result.
- Keep the reader honest about epistemic status: where the series is re-deriving
  a known idea, say so; where it's extrapolating, flag it.

## Recurring vocabulary (so a new thread speaks the same language)
Gutenberg layer (carrier/infrastructure) vs Semantic layer (meaning); the
waterline between them; the seam and the fence that marks it; Def-Push vs
Use-Pull; the external resolver; "the user does not sux"; the 90% signal;
breadth-first seam-finding; the iceberg (frameworks) and defrosting it;
worse-is-better; logarithmic vs exponential improvement; MIT-PDCA vs
New Jersey-PDCA; essential vs accidental complexity; pace layering;
"only time will tell".

## How to continue in a new conversation
1. Upload: README.md, this file, and whichever `note-*.md` you want to draft.
2. Say which note to draft and the target date/post number.
3. The new Claude drafts the post, then adds it to the README table (bump the
   count word, append one row, verify no duplicate row numbers).

## Note on tooling
A batch of browser-automation tools has been attaching to turns in this thread;
none of the work needs them — it's all local file editing. They can be ignored.
