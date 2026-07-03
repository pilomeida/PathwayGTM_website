# Beyond the Brief — Voice Notes
Extracted from the 6 shipped articles (designing-growth, conscious-design, misalignment, nerve, whole-picture, n2-nexus-nerve). Read this before drafting any outline below into a full article.

## What the voice does
- **"We" is Pathway's voice** for framework/argument passages — confident, declarative, no hedging ("Most companies don't design their go-to-market engines — they assemble them.").
- **Rhetorical question → direct answer** is a recurring reframe device: "who actually delivers the customer experience? The answer: everyone does."
- **Bold marks key phrases, not sentences.** Used sparingly, for the words that carry the argument.
- **Blockquotes are aphoristic pull-quotes** — one or two per article, standalone enough to be screenshotted. ("GTM isn't a department. It's the business, in motion.")
- **Section arc:** open with a reframe of a common misconception → build the mechanism/framework → show payoff or result → "Coming Next" teaser → CTA box. Never ends cold.
- **Lists use bold lead-ins** on each item, not plain bullets ("**Operations** is unprepared for spikes...").
- **TL;DR tables** appear when introducing an external framework (see `designing-growth`'s Revenue Architecture table) — useful for the concept-based (Track C) articles.
- **No em dashes.** Use plain hyphens, or restructure the sentence into two. (Ruling 2026-07-03 — see below; overrides the em-dash usage visible in the 6 already-shipped articles, which predate this rule and are not being retrofitted.)

## SUPERSEDED — how STAR-grounded (Track B) pieces handle voice
~~Keep "we" for framework passages, switch to first-person "I" only inside the STAR narrative itself.~~ **Reversed by Pedro (2026-07-03).** Never use "I" in article body copy — rephrase to avoid it, always "we." This isn't a style preference, it's a privacy/identifiability control: "I" ties a story to a specific named individual whose employment history is public (LinkedIn). Combined with any specific, identifying detail (see below), that's a re-identification risk Pedro is not willing to carry. "We" plus proper anonymization (below) is the only pattern used going forward, for Track A, B, and C alike.

## Anonymization — hard rule, not a style choice (2026-07-03)
**Never name a company, employer, product, or "sales object" in article body copy** — anything specific enough that a reader could cross-reference it against Pedro's LinkedIn profile and identify the real situation or the real people involved. This applies to every real-world example drawn from Pedro's own career history AND from Pathway client engagements alike.

- Instead of naming the company/product, characterize it generically: sector, rough size, and the specific mechanics of the situation carry the credibility — not the brand name. ("An industrial B2B company that had grown to roughly 120 commercial FTEs..." not "[Company], which makes [product]...")
- This applies to career-wiki STAR material specifically when it's translated into public blog copy. **The STAR pages themselves, in the private career wiki, keep full identifying detail — that wiki is for Pedro's own interview use and is never published.** The anonymization rule applies at the point of adapting STAR content for the public blog, not to the source STAR page itself.
- Check: could a reader who knows Pedro's work history match this passage to a specific employer or product from what's written? If yes, generalize further.

## Structural elements to reuse
- `.article-meta-bar`: **category · format · read time** (redesigned 2026-07-03 — see below; was previously an inconsistent tag + module-tag-or-nothing pairing).
- Banner diagram image after the opening hook (`diagram-img diagram-img--banner`)
- `.article-cta-box` — reuse existing copy verbatim (reach-out + partner links)
- `.article-nav-bar` — prev/next between articles (arrows point by publish-date order, not reading order — see pathwaygtm-site-clone-patterns.md)
- No yellow CTA band on article pages — nav + CTA box only
- "Coming Next" section teases the next article by name/theme, every time — link directly to the article once it's published; don't promise a date

## Category & format system (2026-07-03 — replaces the old ad hoc tags)
The site's "Explore by Category" filter and every article's meta-bar slot 1 now use the **same 4 categories, mapped directly to N²'s own Modules** — not generic blog-category labels. This was a deliberate harmonization: the old categories (GTM Strategy / Execution / Leadership / Technology & Data) were never tied to anything structural, had drifted out of sync with each article's actual filter tag on ~half the shipped articles, and "Technology & Data" had zero content and no plausible content in the next 5 planned articles either.

**The 4 categories (slug → label → icon):**
- `gtm-readiness` → GTM Readiness → compass
- `deal-generation` → Deal Generation → forward-arrow
- `customer-success` → Customer Success → hand-holding-heart
- `govern-steer` → Govern & Steer → gear

Assign every new article's category by its primary N² Module (WP-level articles map directly — see each `drafts/0N-*.md` file's `wp:` field). An article spanning multiple modules gets a multi-value `data-category` on its listing card (space-separated, for filtering) but only its primary module in the visible tag and meta-bar slot 1, to avoid a cluttered badge.

**Meta-bar slot 2 is now always format**, not a repeated module tag: "Resource / Playbook," "Quick Take," or "Long-form Insight" (case-in-point/other formats can be added as they're needed). This resolved the redundancy that would otherwise exist between slot 1 (now the module) and the old slot 2 (which used to say "Nexus: [same module]").

**Known imbalance, accepted deliberately:** 6 of 7 shipped articles are `gtm-readiness`. This is an honest reflection of the site being Nexus-heavy so far, not a tagging error — it self-corrects as Module 2/3/4 articles (Lead Generation is next, per the calendar) ship.
