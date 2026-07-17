# Repo Ops Agent

An agentic AI system that triages GitHub issues autonomously — reading new issues, detecting duplicates, applying labels, flagging urgent problems, and deferring on vague reports — using a multi-step tool-calling loop rather than a single prompt-response call.

## Why this project

Most "AI wrapper" projects are a single LLM call formatted nicely. This one is deliberately built around an agentic decision loop: the model reads context, chooses from a set of tools, examines the results of that tool call, and then decides on a next action — sometimes across multiple turns — before taking a final, irreversible action (applying a label, marking a duplicate, flagging urgency). The interesting engineering problems are in that loop, not in the prompt.

## Architecture
GitHub Issue
|
v
[ Fetch issue via GitHub REST API ]
|
v
[ LLM (DeepSeek, OpenAI-compatible tool-calling) ]
|
|--- may call search_similar_issues (non-terminal, loops back)
|
v
[ Terminal action: apply_label | mark_duplicate | flag_urgent | request_more_info ]
|
v
[ Code-level validation before any write ]
|
v
[ GitHub REST API mutation (label / comment) ]

**Stack:** TypeScript, Node.js, Octokit (GitHub REST API client), DeepSeek API (OpenAI-compatible function calling).

## Key design decisions

**Why a multi-turn loop instead of one-shot classification.**
Early versions called the model once per issue and asked it to pick a label directly. This fails on duplicates — the model has no way to know what else exists in the repo. The fix was giving the model a `search_similar_issues` tool it can call before committing to a final decision, turning triage into a genuine multi-step reasoning process: gather context, then decide.

**Why the model never touches the GitHub API directly.**
The LLM only ever returns a tool name and arguments. All actual GitHub writes (`addLabels`, `createComment`) happen in application code, not inside the model's turn. This means every action the agent can take is enumerable, reviewable, and rate-limitable — the model cannot do anything outside the fixed set of tools it's given, regardless of what it "decides."

**Why some rules are enforced in code, not just the prompt — with a concrete example.**
During testing, two issues describing the same bug (large image upload crashing the app) were each processed independently. The model marked issue #5 as a duplicate of #6, reasoning that #6 was created earlier — which was factually wrong; #5 was actually the older issue. Because `mark_duplicate` independently re-fetches both issues' `created_at` timestamps and rejects any duplicate claim pointing at a newer issue, this incorrect decision was caught and blocked before any label was applied. When issue #6 was processed next, it correctly identified #5 as the original and was marked as a duplicate of it.

This is the core lesson the project is built around: the model's stated reasoning is not a source of truth. Anything with a checkable invariant (here: "a duplicate must be older than its original") should be verified in code, not trusted from the model's output — even when the reasoning sounds confident and plausible. Prompting can reduce how often this happens; only code can guarantee it never causes a bad write.

**Why tools are split into terminal vs. non-terminal actions.**
`search_similar_issues` is non-terminal — it feeds information back into the conversation and the loop continues. `apply_label`, `mark_duplicate`, `flag_urgent`, and `request_more_info` are terminal — each one ends the triage run for that issue after exactly one such call. This distinction exists so the agent can gather arbitrarily more context without risking multiple conflicting actions being taken on the same issue in one run.

## What's tested

A 14-issue seed set was built to specifically stress-test the agent's decision boundaries, not just prove happy-path behavior:

- Straightforward bugs (clear label, no ambiguity)
- A genuine duplicate pair, used to validate the ordering fix above
- Feature requests vs. bug reports (classification accuracy)
- Deliberately vague issues ("it doesn't work") to test `request_more_info` instead of the model guessing a label
- A production-outage-worded issue, to test `flag_urgent` triggering correctly instead of a generic `bug` label
- A question already answered in the repo's FAQ, to test whether the agent can ground a response in real documentation rather than inventing one

## Known limitations / not yet built

- No persistence layer yet — every run is stateless; decisions aren't logged anywhere durable (planned: Postgres table for issue, tool called, reasoning, timestamp, accepted/rejected)
- No retry/backoff on the LLM API call itself (added for GitHub API calls, not yet for DeepSeek calls)
- No dashboard / manual override UI yet
- Not containerized or deployed yet — runs locally only

## What I'd do differently at scale

Running this against a high-volume repo would need: rate-limit-aware batching instead of one issue at a time, idempotency checks so a crashed run doesn't double-post a duplicate comment on retry, and a confidence threshold below which the agent defers to a human instead of acting — right now every terminal tool call is treated as equally trustworthy, which is fine for a 14-issue test set but wouldn't be for a real, high-traffic repo.