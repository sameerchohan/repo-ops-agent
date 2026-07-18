# Repo Ops Agent

An agentic AI system that triages GitHub issues autonomously — reading new issues, detecting duplicates, applying labels, flagging urgent problems, and deferring on vague reports — using a multi-step tool-calling loop rather than a single prompt-response call. Every decision the agent makes is persisted to Postgres and surfaced in a live React dashboard, so its behavior is auditable, not a black box.

## Why this project

Most "AI wrapper" projects are a single LLM call formatted nicely. This one is deliberately built around an agentic decision loop: the model reads context, chooses from a set of tools, examines the results of that tool call, and then decides on a next action — sometimes across multiple turns — before taking a final, irreversible action (applying a label, marking a duplicate, flagging urgency). The interesting engineering problems are in that loop and in what surrounds it — persistence, verification, observability — not in the prompt.

## Architecture

```
GitHub Issue
     │
     ▼
[ Fetch issue via GitHub REST API ]
     │
     ▼
[ LLM (DeepSeek, OpenAI-compatible tool-calling) ]
     │
     ├─ may call search_similar_issues (non-terminal, loops back)
     │
     ▼
[ Terminal action: apply_label | mark_duplicate | flag_urgent | request_more_info ]
     │
     ▼
[ Code-level validation before any write ]
     │
     ├────────────────────────────┐
     ▼                            ▼
[ GitHub REST API mutation ]  [ Postgres: agent_decisions ]
 (label / comment)                  │
                                     ▼
                          [ Express API (read-only) ]
                                     │
                                     ▼
                          [ React dashboard (live view) ]
```

Three independent pieces talk to each other only over well-defined interfaces — the agent and the API both read/write the same Postgres database, and the dashboard only ever talks to the API, never touches the database directly. That separation is deliberate: it's the same shape a real production system would take, not a monolith that happens to work.

**Stack:** TypeScript end to end. Node.js + Octokit (GitHub REST API client) + DeepSeek API (OpenAI-compatible function calling) for the agent. PostgreSQL for persistence. Express for the read API. React (Vite) for the dashboard.

## Project layout

```
repo-ops-agent/
  src/          agent loop, Postgres client, seed-data reset script
  api/          Express API — reads agent_decisions, serves JSON
  dashboard/    React dashboard — fetches from the API, renders live
```

## Key design decisions

**Why a multi-turn loop instead of one-shot classification.**
Early versions called the model once per issue and asked it to pick a label directly. This fails on duplicates — the model has no way to know what else exists in the repo. The fix was giving the model a `search_similar_issues` tool it can call before committing to a final decision, turning triage into a genuine multi-step reasoning process: gather context, then decide.

**Why the model never touches the GitHub API directly.**
The LLM only ever returns a tool name and arguments. All actual GitHub writes (`addLabels`, `createComment`) happen in application code, not inside the model's turn. This means every action the agent can take is enumerable, reviewable, and rate-limitable — the model cannot do anything outside the fixed set of tools it's given, regardless of what it "decides."

**Why some rules are enforced in code, not just the prompt — finding #1.**
During testing, two issues describing the same bug (large image upload crashing the app) were each processed independently. The model marked issue #5 as a duplicate of #6, reasoning that #6 was created earlier — which was factually wrong; #5 was actually the older issue. Because `mark_duplicate` independently re-fetches both issues' `created_at` timestamps and rejects any duplicate claim pointing at a newer issue, this incorrect decision was caught and blocked before any label was applied. When issue #6 was processed next, it correctly identified #5 as the original and was marked as a duplicate of it. This behavior reproduced identically on a later full-sweep retest, confirming the guard, not luck, is what's catching it.

This is the core lesson the project is built around: the model's stated reasoning is not a source of truth. Anything with a checkable invariant (here: "a duplicate must be older than its original") should be verified in code, not trusted from the model's output — even when the reasoning sounds confident and plausible. Prompting can reduce how often this happens; only code can guarantee it never causes a bad write.

**Why grounding in real documentation matters, not just tool access — finding #2.**
Issue #14 ("How do I reset my password?") is answered in the testbed repo's own `FAQ.md`. Across two separate test runs, the agent classified it two different ways: `question` in one run, `enhancement` in another — reasoning the second time that "the reset workflow doesn't seem to exist yet." Both decisions were internally consistent with the agent's own tools, and neither was a bug — the agent has no way to check `FAQ.md`, so it's guessing at product intent from the issue text alone, and guessing inconsistently. This is a concrete, logged case (not a hypothetical) for why the planned `search_docs` tool matters: without it, the agent's answer quality on documentation-adjacent questions is genuinely non-deterministic, and no amount of prompt tuning fixes that — it needs the tool.

**Why tools are split into terminal vs. non-terminal actions.**
`search_similar_issues` is non-terminal — it feeds information back into the conversation and the loop continues. `apply_label`, `mark_duplicate`, `flag_urgent`, and `request_more_info` are terminal — each one ends the triage run for that issue after exactly one such call. This distinction exists so the agent can gather arbitrarily more context without risking multiple conflicting actions being taken on the same issue in one run.

**Why every decision is persisted, including rejections.**
`executeTool` returns `{ result, accepted, rejectionReason }` for every tool call, and every turn — not just the final one — is written to a Postgres `agent_decisions` table (issue, turn, tool, args, reasoning, result, accepted, rejection reason, timestamp) before the loop continues. The rejected `mark_duplicate` call from finding #1 is a real row in that table with `accepted = false`, not something that had to be reconstructed from logs after the fact. An agent that can silently fail is a liability; one that leaves a durable, queryable trail of every decision — including the ones it got wrong and had corrected — is auditable.

**Why the API and dashboard are separate services, not a single Next.js app.**
The read API (`api/server.ts`) is a small, independent Express service with its own two endpoints (`/api/decisions`, `/api/stats`) and no knowledge of the agent's internals beyond the shared database schema. The dashboard only ever calls that API over HTTP with CORS, never imports agent code or touches Postgres directly. This is more setup than a single bundled app, but it's the honest shape of what you'd actually deploy — a UI that can be redeployed, scaled, or swapped independently of the service producing the data it displays.

**Why the dashboard's color choices aren't arbitrary.**
The five tool-type colors (used consistently across badges and the usage-breakdown meter) were run through an automated colorblind-safety and contrast validator rather than picked by eye — checked for CVD-safe separation and contrast against both the dark and light theme surfaces before shipping. Every color-coded element also carries a visible text label (the tool name), so identity is never conveyed by color alone.

## What's tested

A 14-issue seed set was built to specifically stress-test the agent's decision boundaries, not just prove happy-path behavior:

- Straightforward bugs (clear label, no ambiguity)
- A genuine duplicate pair, used to validate the ordering fix above
- Feature requests vs. bug reports (classification accuracy)
- Deliberately vague issues ("it doesn't work") to test `request_more_info` instead of the model guessing a label
- A production-outage-worded issue, to test `flag_urgent` triggering correctly instead of a generic `bug` label
- A question already answered in the repo's FAQ, to test whether the agent can ground a response in real documentation rather than inventing one (see finding #2 above — currently exposes a real gap rather than passing cleanly)

Every one of these runs is logged to Postgres and visible in the dashboard, including which decisions were accepted vs. rejected by the code-level guards.

## Known limitations / not yet built

- No `search_docs` tool yet — the agent can't ground answers in `FAQ.md`/`README.md`, which is the direct cause of finding #2 above
- No retry/backoff on the LLM API call itself (added for GitHub API calls, not yet for DeepSeek calls)
- No authentication on the API or dashboard — fine for a local single-user tool, not for anything shared
- Not containerized or deployed yet — everything (Postgres, API, agent, dashboard) runs locally only
- The dashboard polls the API on an interval rather than pushing updates (WebSocket/SSE would be the natural next step for true real-time)

## What I'd do differently at scale

Running this against a high-volume repo would need: rate-limit-aware batching instead of one issue at a time, idempotency checks so a crashed run doesn't double-post a duplicate comment on retry, and a confidence threshold below which the agent defers to a human instead of acting — right now every terminal tool call is treated as equally trustworthy, which is fine for a 14-issue test set but wouldn't be for a real, high-traffic repo. The dashboard would also need auth, pagination beyond the current 200-row cap, and push-based updates instead of polling.
