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

`lolotam/openinary` is **ahead of** `openinary/openinary@main` (re-check with the compare command at the bottom). Merge `19baf21` (PR **#2**) landed the three items below.

**Ahead — fork-only work:**

- Two-factor authentication (TOTP + backup codes) — `8309ec1`
- Root `Dockerfile` / compose deployment on port 3000 — `f88e2a0`
- Raw and document asset support: zip, pdf, html, Office, json — `4c76d90` (PR #1)
- Upload picker fix for those new types — `eef0dfd`
- Asset index, folder covers, and batched bulk uploads — `19baf21` (PR **#2**)

---

## Done on this fork (2026-08-25, PR #2)

Verified in source on `main`. These were the three items requested and they are implemented.

| Item | What shipped | Where |
| --- | --- | --- |
| **1. Bulk-upload hang (~127 files)** | Dashboard uploads go in sequential batches of **20**, not one giant multipart. HTTP 429 is retried up to **3 total attempts** with wait clamped to **1–60s**. A persistent 429 stops later batches and keeps already-succeeded files. Nested folder paths are sent as `names`. | `packages/ui/src/components/upload-batch.ts`, wired in `upload-section.tsx`. Tests: `packages/ui/test/upload-batch.test.ts` (127 files → 7 requests). Upstream issue **#135** / PR **#138**. |
| **2. Asset index + search** | SQLite `assets` table + FTS5 over filename, path, and `custom_metadata`. Upload/delete/rename/copy/move keep the index coherent. Live folder listing (`readdirSync` / S3) is unchanged. `GET /assets/search?q=&type=&folder=` is auth-protected. Dashboard header has a search bar with type filter. | Schema/store: `packages/core/src/utils/asset-index/`. Routes: `GET /assets/search`. UI: `packages/ui/src/components/asset-search.tsx`. **Not shipped:** tags, a metadata editor, replacing listing with the index. |
| **3. Folder covers** | `POST /folders/thumbnail` and `DELETE /folders/thumbnail` store a cover image path per folder. Listing includes `coverPath`. Grid tiles render that image with immediate `onError` fallback. Context menu **Set as Folder Cover** is **off by default** (`folderCoverEnabled`); self-hosted dashboard turns it on, Cloud stays off. | API: `packages/core/src/routes/folder-thumbnail.ts`. UI: `packages/ui/src/media-grid.tsx`. |

Gates that passed on the merge: `pnpm --filter @openinary/core test` (166), `pnpm --filter api test` (17), `pnpm --filter @openinary/ui test` (25). `/t` and `/raw` (including 416 ranges) were not changed.

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

| # | Issue | Why it matters here | Status upstream | This fork |
| --- | --- | --- | --- | --- |
| 135 | Large bulk uploads hang when selecting 127 files | Dashboard folder uploads | PR **#138** open | **Done** — batched uploads of 20 (PR **#2**) |
| 102 | Cached derivatives served with the source file's Content-Type, inconsistent ETag | This fork widened what gets delivered (zip/pdf/html), so a wrong `Content-Type` on a cached derivative is now a broader correctness problem | No PR | Open |
| 136 | JPEG processing fails with `VipsJpeg Invalid SOS parameters` | Core image path | PR **#137** open | Open |
| 78 | Restrictive Nginx max file size | Fork-specific: this fork ships its own `Dockerfile`/compose, so the limit has to be set in *this* deployment | No PR | Open |
| 56 | Delete or move uploads (documentation) | Docs gap | No PR | Open |

**Recommendation:** #102 next among upstream bugs. #135 is already fixed here.

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

4. **Tags and a custom-metadata editor** — FTS search by filename, path, and
   stored `custom_metadata` **shipped** on this fork (PR **#2**, dashboard
   header + `GET /assets/search`). The comparison row is still `✗` for
   Cloudinary-style **tags** and a metadata editor; those remain open. Folder
   covers also shipped here and are not in that comparison table.
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
- **Divergence strategy.** This fork is further ahead after PR **#2**. Decide
  whether to upstream batched uploads / asset search / folder covers or accept
  permanent divergence. Rebasing gets harder from here.
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
