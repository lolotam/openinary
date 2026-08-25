# Openinary — Roadmap (lolotam fork)

**Compiled 2026-08-25.** There is no roadmap file in this repo and issues are
disabled on the fork, so nothing below is an official upstream plan. It is
derived from four sources of evidence, each cited inline:

| Source | What it tells us |
| --- | --- |
| `openinary/openinary` open issues & PRs | What upstream is actually working on |
| `apps/docs/cloudinary-comparison.mdx` | The project's own honest gap table (its `✗` column) |
| `apps/docs/changelog.mdx` | Shipping cadence and direction of travel |
| `git` fork divergence | What this fork carries that upstream does not |

Issue and PR numbers refer to `openinary/openinary`. Re-check them before
acting — they were accurate on the compile date.

---

## Where this fork stands

`lolotam/openinary` is **5 commits ahead, 2 behind** `openinary/openinary@main`.

**Ahead — fork-only work:**

- Two-factor authentication (TOTP + backup codes) — `8309ec1`
- Root `Dockerfile` / compose deployment on port 3000 — `f88e2a0`
- Raw and document asset support: zip, pdf, html, Office, json — `4c76d90` (PR #1)
- Upload picker fix for those new types — `eef0dfd`

**Behind — not yet pulled:**

- `fdcff9e` `fix(cloud): run the video metering cron hourly, not every 5 minutes` — functional
- `297bd20` CLA bot signature — noise

---

## Tier 0 — sync and land what already exists

Cheapest work with real value. Do this before starting anything new.

1. **Pull the two upstream commits.** Only the metering cron matters, and only
   if the Cloud app is in use here.
2. **Upstream the raw/document support.** Upstream issue **#39**
   *"Passthrough serving for unsupported file types (SVG, GIF, WAV, etc.)"* is
   labelled `enhancement, good first issue` and is still open — PR #1 in this
   fork implements a superset of it. Contributing it back removes a permanent
   merge burden from this fork.
3. **Upstream the picker fix** (`eef0dfd`). `useFsAccessApi: false` is a plain
   bug fix against upstream code; carrying it privately means re-resolving it on
   every rebase.

---

## Tier 1 — open bugs, ordered by how close they sit to this fork's code

These are upstream's currently-open issues. The ordering is a judgment call
about relevance to this fork, not upstream's own priority.

| # | Issue | Why it matters here | Status upstream |
| --- | --- | --- | --- |
| 135 | Large bulk uploads hang when selecting 127 files | Same component this fork just fixed (`upload-section.tsx`); the fork now accepts more file types, so batches get bigger | PR **#138** open |
| 102 | Cached derivatives served with the source file's Content-Type, inconsistent ETag | This fork widened what gets delivered (zip/pdf/html), so a wrong `Content-Type` on a cached derivative is now a broader correctness problem | No PR |
| 136 | JPEG processing fails with `VipsJpeg Invalid SOS parameters` | Core image path | PR **#137** open |
| 78 | Restrictive Nginx max file size | Fork-specific: this fork ships its own `Dockerfile`/compose, so the limit has to be set in *this* deployment | No PR |
| 56 | Delete or move uploads (documentation) | Docs gap | No PR |

**Recommendation:** #135 first. It is adjacent to code just touched, a fix
already exists upstream to review rather than write, and bulk upload is the
workflow most affected by the new asset types.

---

## Tier 2 — feature gaps the project names itself

Every row below is a `✗` in `cloudinary-comparison.mdx`. Ordering is by value
against effort — a judgment call, stated so you can disagree with it.

### Near term

1. **Image overlays and watermarks** — upstream issue **#43**, PR **#122**
   (`Feature/image overlays`) already in flight. The single most-requested
   missing capability, and the whole "Overlays & composition" table is empty.
   Review and land rather than rebuild.
2. **Image effects** — blur, sharpen, grayscale, brightness/contrast/saturation.
   The entire effects table is `✗`, but `sharp` is already in the stack and
   exposes all of these. Mechanically cheap relative to its visible surface.
3. **Named and chained transformations** — structural. Named transformations
   unlock upload presets; chaining removes URL sprawl. Both are prerequisites
   for a lot of Tier 3 work, so doing them early compounds.

### Medium term

4. **Tags, custom metadata, and search** — the DAM table is almost entirely
   `✗`. Search is unusable-at-scale territory once a library grows, and the
   dashboard already has folder browsing to hang it off.
5. **Webhooks** — upload-complete and transform-complete. Currently `✗` while
   SSE queue events exist, so the eventing primitives are half-built already.
   This is the main blocker for third-party integration.
6. **Node SDK** — Openinary is REST-only today. `packages/ui` already contains
   signing and upload plumbing that could be extracted rather than written from
   scratch.
7. **Multi-user and RBAC** — upstream is one account, one admin. This fork has
   already invested in auth (2FA), so access control is the natural continuation
   of work already done here rather than a cold start.

### Deferred — large, and not what this project is currently good at

- Adaptive bitrate streaming (HLS/DASH), video effects, codec control, subtitles
- All AI and generative features (background removal, generative fill, OCR,
  auto-tagging, moderation)
- Approval workflows, version history, usage analytics
- CMS plugins, non-JS SDKs

The comparison doc is explicit that Cloudinary is the better choice for these
today. Chasing them is unlikely to be a good use of a fork's effort.

---

## Fork-specific decisions to make

- **2FA has no docs.** It exists in code (`8309ec1`) but is not documented in
  `apps/docs`. Either document it or upstream it — undocumented auth features
  get misconfigured.
- **Divergence strategy.** At 5 commits ahead, rebasing is easy. That stops
  being true fast. Decide now whether this fork upstreams its work or accepts
  permanent divergence.
- **Storage prefix** — upstream PR **#133** makes the media storage prefix
  configurable. Relevant if this deployment needs a non-default bucket layout.

---

## Keeping this current

Issues are disabled on the fork, so upstream is the only tracker:

```bash
gh issue list --repo openinary/openinary --state open
gh pr list    --repo openinary/openinary --state open
gh api repos/openinary/openinary/compare/main...lolotam:main \
  --jq '"ahead \(.ahead_by) / behind \(.behind_by)"'
```

The `✗` column in `apps/docs/cloudinary-comparison.mdx` is maintained by the
project and is the most reliable feature-gap list available — re-read it rather
than trusting this file when the two disagree.
