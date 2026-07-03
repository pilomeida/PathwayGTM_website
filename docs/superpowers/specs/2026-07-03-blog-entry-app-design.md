# Blog Editorial Planner + Writer — Design Spec

Date: 2026-07-03 · Status: approved by Pedro, ready for implementation planning

## Purpose

Today, "Beyond the Brief" editorial planning and drafting happens entirely inside Claude
Code conversations, hand-editing markdown files in `PathwayGTM_website/drafts/` and
manually converting approved drafts into the site's HTML article template (see
`~/Desktop/Claude_Corner/brainstorms/2026-07-02-editorial-calendar-design.md` for the
full process this replaces the UI-less version of). Pedro wants this accessible from a
browser UI at `blog-entry.pathwaygtm.com`, without needing Claude Code open, and without
ever needing to touch github.com directly.

## Non-goals

- Not a public-facing tool — single user (Pedro), gated by Cloudflare Access.
- Not a general CMS — scoped specifically to this editorial process (WP/STAR/source
  pairings, the N² module taxonomy, the site's specific article HTML template).
- Not fully autonomous drafting — the writer is markdown-first with an on-demand AI
  assist panel, not one-click full-article generation.

## Architecture

- **New repo**: `pilomeida/pathwaygtm-blog-entry` — React (Vite) frontend + Python
  (FastAPI) backend. This mirrors `CareerOutreachCRM`'s architecture exactly (same repo
  shape, same deploy pattern) rather than introducing a new stack.
- **Hosting**: self-hosted on the existing Hetzner VPS (`167.233.51.113`), not Vercel —
  zero incremental cost, reuses infrastructure Pedro already operates. New systemd
  service on port `8006` (verify free at setup time; `8000`, `8001`, `8004`, `5000` are
  already in use by other services), new nginx server block, deployed via GitHub Actions
  (rsync + systemd restart) on push to `main` — identical shape to
  `CareerOutreachCRM/.github/workflows/deploy.yml`.
- **DNS/Access**: `blog-entry.pathwaygtm.com` — Cloudflare A record → VPS IP, proxied
  (orange cloud), same as `engagements.` and `eu-track.` subdomains. A Cloudflare Access
  application is added on top of this hostname, policy = Pedro's email only (one-time
  code or Google login). No app-level auth code needed.
- **The public `pathwaygtm.com` site is unaffected** — it stays on Vercel, unchanged,
  and continues to auto-deploy from `PathwayGTM_website`'s `main` branch exactly as it
  does today. This app is a separate tool that happens to read/write into that repo.
- **Content source of truth**: the `pilomeida/PathwayGTM_website` repo. This app holds
  no local copy of drafts or articles — everything is read/written via the GitHub REST
  API using a fine-grained PAT scoped to just that repo (contents + pull-requests,
  read/write).
- **AI calls**: server-side only, via the Anthropic API. Key stored as a backend env
  var, never reaches the browser.

## Data model

New file in `PathwayGTM_website`: **`drafts/calendar.json`** — structured source of
truth for the planner. Fields per entry:

```
id, title, slug, wp, track (A/B/C), source (STAR ref or external source name),
category (N² module — gtm-readiness/deal-generation/customer-success/govern-steer),
format (Resource/Playbook, Case-in-Point, Quick Take, Long-form Insight),
publishTarget (date), status (idea/outline/drafting/ready-for-review/published),
draftFile (path under drafts/), heroImage (path or null), teaser (short text —
used for both listing card and meta description)
```

On every save, the app regenerates `drafts/README.md`'s queue table from
`calendar.json`, so that human-readable view stays accurate without being hand-maintained
in two places.

Draft bodies remain plain `.md` files under `drafts/` — no front-matter, since all
metadata now lives in `calendar.json`.

`EDITORIAL-PRINCIPLES.md` and `VOICE-NOTES.md` are read-only inputs, fed into the assist
panel's system prompt. `CROSS-LINKS.md` is read, and updated by the publish step when it
resolves a pending forward-reference.

## Planner

A queue/table view rendering `calendar.json`: WP, track, category, format, status,
publish target per row. Add / edit / reorder entries inline. Clicking a row opens that
entry in the Writer.

## Writer + assist panel

- Markdown source editor + rendered prose preview, side by side (uses the site's
  `.article-prose` styling for the preview so it reads close to final, without being the
  full page template — that full-template preview happens at publish time instead).
- On-demand assist actions (never automatic):
  - **Check against principles** — runs `EDITORIAL-PRINCIPLES.md` §7's Definition-of-Done
    checklist via Claude, returns flagged issues.
  - **Suggest cross-links** — checks `CROSS-LINKS.md`'s pending rows against this draft.
  - **Ask AI** — free-form chat scoped to the current draft (rewrite a paragraph,
    tone-check, tighten a section) — the in-browser equivalent of today's Claude Code
    workflow.
- Metadata fields (WP, category, format, teaser, hero image, status) bound to this
  entry's `calendar.json` record.
- "Mark as ready for publish" status transition.

## Publish pipeline

1. **Template**: deterministic HTML generation (not a fresh LLM rewrite each time),
   built from the existing shipped-article structure as the canonical reference — slots
   in title, meta-bar (category + format + computed read-time), hero image, markdown-
   rendered body (existing conventions carry over: blockquotes, `info-table` markup,
   image classes via inline HTML the draft already contains), the CTA box, footer tags,
   and prev/next nav computed from `calendar.json` order.
2. **Category**: auto-computed from the WP → N² Module mapping already documented in
   `VOICE-NOTES.md`.
3. **Translation**: PT and ES versions generated via Claude, applying the same
   deterministic template.
4. **Cross-link resolution**: detects any `CROSS-LINKS.md` row this article resolves,
   and proposes the specific text edit to the older, already-published article — shown
   to Pedro for approval via the same ask-for-changes loop below, never silently
   auto-applied.
5. **Preview / adjust loop** (no code exposed to Pedro): renders the generated HTML in
   an iframe using the site's real `css/style.css`, so it looks exactly like production.
   Alongside it, a plain-language "ask for changes" box — Pedro describes what's wrong
   ("the image should be smaller," "fix the numbering on point 4"), the app sends the
   current HTML + instruction to Claude, gets back a revision, and the preview updates.
   Repeats until approved. A read-only "view source" toggle exists for transparency but
   is never required.
6. **Publish**: commits all changed files (new article HTML in EN/PT/ES, listing-card
   insertion in `beyond-the-brief.html` × 3 languages, nav-link updates on adjacent
   articles, `CROSS-LINKS.md` resolution, `calendar.json` status → `published`) to a new
   branch in `PathwayGTM_website`, opens a PR.
7. **In-app review**: the app fetches and renders that PR's diff inside its own UI.
   Pedro clicks **"Merge & Go Live"** or **"Discard"** — both call the GitHub API
   directly. Pedro never opens github.com.

## One-time setup (outside this app's code)

- GitHub fine-grained PAT scoped to `PathwayGTM_website` (contents + pull-requests,
  read/write) — backend env var.
- Anthropic API key — backend env var.
- Cloudflare Access application for `blog-entry.pathwaygtm.com`, policy = Pedro's email.
- Cloudflare DNS A record → VPS IP, proxied.
- New systemd service + nginx server block on the VPS (port `8006`, verify free first).
- GitHub Actions deploy workflow in the new repo + `VPS_SSH_PRIVATE_KEY` secret (reuse
  the existing VPS deploy key already used by other projects on this box, if present).

## Documentation deliverables

- `docs/pathwaygtm-blog-sysadmin.md` (new repo) — VPS details, systemd/nginx config,
  env vars, deploy process, secrets checklist. Mirrors
  `CareerOutreachCRM/docs/SYSADMIN.md`'s structure.
- `docs/pathwaygtm-blog-architecture.md` (new repo) — data model, publish pipeline
  mechanics, and exactly how the app talks to `PathwayGTM_website`, so a future session
  can pick this up without re-deriving it.

## Open items for the implementation plan to resolve

- Exact markdown → HTML body conversion rules (which existing site conventions —
  blockquote styling, `info-table`, `diagram-img` classes — need explicit handling vs.
  which already work via plain markdown + inline HTML passthrough).
- Read-time computation formula (word count heuristic, matching what's already on
  shipped articles).
- Whether `calendar.json` needs a migration step to backfill the 11 already-locked
  calendar entries from the current `drafts/README.md` table.
