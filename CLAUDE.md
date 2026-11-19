# Agent guidance — lolotam/openinary

Guidance for AI agents (Claude Code, OpenCode/Kimi, Codex, Grok and others) working on this fork.
`AGENTS.md` carries the same rules for agents that read that file instead.

## Project constraints (unchanged)

- Report the root cause before changing anything.
- Production, servers (musalam-2 / Dokploy), secrets and any HOLD stay Waleed's decision.
- `main` auto-deploys to production through Dokploy (`openinary.walidmohamed.com`). Merging to `main` is a production release.
- Workflow/CI changes go in a dedicated reviewed CI PR, separate from product work (Waleed's CI rule, 2026-11-18).

## Delivery tiers (Light / Medium / Heavy Implementation Pipeline)

Owner decision, 2026-11-19 (reference: PosPay PP-195, lolotam/PayPos.systems#1085). Waleed, verbatim:

> «ابعت بقي ملفات وخطة ال3 pip lines دي لكل المديرين علشان يسجلوها وينفزوها كقاعدة عنهم في كل الشغل ويعملولها merg علطول بدون مراجعة light task كاضافة وثائق في ملفات المشاريع cladue.md file and agent file»

### 1. Tier card before every new task

Before every new task, including side tasks and follow-up issues, send Waleed an AskUserQuestion card in Arabic with 3 options. Put the recommended option first and mark it «(المقترح)». The card states:

- the tier;
- the recommendation;
- a one-line reason;
- an exception option, such as an extra review or step on top of the tier.

Do not start before Waleed answers. Put the tier and any exception in the implementer brief and the PR body. Fix rounds inside a running task need no new card.

### 2. LIGHT

- **Scope:** docs, specs, plans, ADRs, roadmap/status files, i18n, and small CSS/UI changes of up to about 150 lines.
- **Never Light:** money, permissions/auth, DB/migrations, API, or a new dependency.
- **Who implements:** the manager or the cheapest implementer.
- **Merge:** immediately when CI is green, with no wait for review bots. This repo has no PR CI today (0 GitHub Actions runs as of 2026-11-18), so Light PRs merge directly.
- **Deploy:** no deploy of its own. It ships with the next deploy.

### 3. MEDIUM

- **Reviews:** at most 3 review rounds. Each round is a local review (`/code-review`) plus the project's review bots: CodeRabbit and Socket Security on this repo. Skip a bot stuck for more than 1 hour, and say so in the merge report.
- **CI:** green on the exact head commit, where CI exists.
- **After round 3:** P2/P3 findings become follow-up issues; P0/P1 findings block the merge.
- **Deploy:** in daily batches. This repo has no separate staging: `main` deploys straight to production through Dokploy, so batch Medium merges.

### 4. HEAVY

- **Scope:** migrations (e.g. `auth.db` schema), money, permissions/auth, security, and long background jobs (e.g. the video job queue).
- **Planning:**
  - Claude Fable 5.2 (medium effort) writes the implementation plan.
  - Codex Astra 6.2 (medium effort) debates it for ONE round before implementation starts.
- **Review:** full review plus CI, within the project's round cap.
- **Merge:**
  - A PR that touches migrations, money or permissions/auth merges ONLY after Waleed approves it on a card, after all gates pass.
  - Other Heavy work: the manager merges after all gates pass.
- **Deploy:** alone, right after the merge. If there is a migration, take a DB snapshot first and keep a receipt.

### 5. Implementer fallback, fixed order

- **Light:** manager or GLM, then Claude Sonnet.
- **Medium and Heavy:** Kimi (OpenCode CLI, Kimi K3.1 Pro), then MiniMax, then GLM, then Grok, then Claude Sonnet. Heavy work on Sonnet runs at high effort.
- **When to move on:** after 2 failures or exhausted quota, move to the next lane without asking.
- **Missing lanes:** use only the lanes available in the session, and keep this order.

### 6. Plan summary after every merge

After every merge, post the active plan in 3 parts:

- «ما تم»: the main tasks done, with PR numbers.
- «الباقي»: each remaining main task, with its sub-tasks underneath and their status.
- «التوصية».

Fold side tasks into the plan under their main task, and keep any roadmap/status file in sync. End every report with these headings exactly: «المطلوب منك»، «الخطوة الجاية اللي أنصح بيها»، «ملاحظة» (write «مفيش» if there is nothing to say).

### How the tiers relate to existing rules

- **Kept:** every project constraint above. The tiers do not change production, server, secrets or HOLD ownership.
- **Language:** tier cards and post-merge plan reports are in Arabic, as this rule requires. This overrides the general English-reply default only for those two outputs.
- **CI changes:** a CI/workflow change is at least Medium, and still goes in its own dedicated CI PR.
