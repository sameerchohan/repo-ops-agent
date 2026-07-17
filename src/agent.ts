import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const OWNER = process.env.GITHUB_OWNER!;
const REPO = process.env.GITHUB_REPO!;

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_similar_issues",
      description: "Fetch all other open issues in the repo to compare against, for detecting duplicates. Call this first if the issue might be a duplicate of something already reported.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_duplicate",
      description: "Mark this issue as a duplicate of another existing issue",
      parameters: {
        type: "object",
        properties: {
          duplicate_of: { type: "number", description: "The issue number this duplicates" },
          reasoning: { type: "string", description: "Why these are duplicates" },
        },
        required: ["duplicate_of", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_label",
      description: "Apply a label to the issue: bug, enhancement, question, needs-triage",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["label", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_urgent",
      description: "Flag as urgent — production outages, security issues affecting many users",
      parameters: {
        type: "object",
        properties: { reasoning: { type: "string" } },
        required: ["reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_more_info",
      description: "Use when the issue is too vague to act on",
      parameters: {
        type: "object",
        properties: { reasoning: { type: "string" } },
        required: ["reasoning"],
      },
    },
  },
];

async function executeTool(name: string, args: any, issueNumber: number): Promise<string> {
  if (name === "search_similar_issues") {
    const { data: issues } = await octokit.issues.listForRepo({
      owner: OWNER, repo: REPO, state: "open", per_page: 50,
    });
    const others = issues
      .filter((i) => i.number !== issueNumber)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: (i.body || "").slice(0, 200),
        created_at: i.created_at,
      }));
    return JSON.stringify(others);
  }

  if (name === "mark_duplicate") {
    const { data: original } = await octokit.issues.get({
      owner: OWNER, repo: REPO, issue_number: args.duplicate_of,
    });
    const { data: current } = await octokit.issues.get({
      owner: OWNER, repo: REPO, issue_number: issueNumber,
    });

    if (new Date(original.created_at) > new Date(current.created_at)) {
      return `Rejected: #${args.duplicate_of} was created after this issue, can't be the original`;
    }

    await octokit.issues.addLabels({
      owner: OWNER, repo: REPO, issue_number: issueNumber, labels: ["duplicate"],
    });
    await octokit.issues.createComment({
      owner: OWNER, repo: REPO, issue_number: issueNumber,
      body: `This looks like a duplicate of #${args.duplicate_of}. ${args.reasoning}`,
    });
    return `Marked as duplicate of #${args.duplicate_of}`;
  }

  if (name === "apply_label") {
    await octokit.issues.addLabels({
      owner: OWNER, repo: REPO, issue_number: issueNumber, labels: [args.label],
    });
    return `Applied label "${args.label}"`;
  }

  if (name === "flag_urgent") {
    await octokit.issues.addLabels({
      owner: OWNER, repo: REPO, issue_number: issueNumber, labels: ["urgent"],
    });
    return `Flagged as urgent`;
  }

  if (name === "request_more_info") {
    return `Would request more info (logging only, not posting)`;
  }

  return `Unknown tool: ${name}`;
}

async function triageIssue(issueNumber: number) {
  const { data: issue } = await octokit.issues.get({
    owner: OWNER, repo: REPO, issue_number: issueNumber,
  });

  console.log(`\n--- Issue #${issueNumber}: ${issue.title} ---`);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a GitHub issue triage agent. If the issue might be a duplicate, call search_similar_issues first. Only call mark_duplicate if you find an EARLIER issue (older created_at) describing the same problem — never mark an issue as a duplicate of a newer one. Otherwise call apply_label, flag_urgent, or request_more_info. Always end by calling exactly one terminal action: mark_duplicate, apply_label, flag_urgent, or request_more_info.",
    },
    { role: "user", content: `Title: ${issue.title}\nBody: ${issue.body}` },
  ];

  const terminalTools = ["mark_duplicate", "apply_label", "flag_urgent", "request_more_info"];
  const maxTurns = 4;

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages,
      tools,
    });

    const msg = response.choices[0]?.message;
    const call = msg?.tool_calls?.[0];

    if (!msg || !call || call.type !== "function") {
      console.log("No tool call. Raw response:", msg?.content);
      return;
    }

    const args = JSON.parse(call.function.arguments || "{}");
    console.log(`Turn ${turn + 1} — model called: ${call.function.name}`, args);

    const result = await executeTool(call.function.name, args, issueNumber);
    console.log(`  -> ${result}`);

    if (terminalTools.includes(call.function.name)) {
      return; // done
    }

    // Not terminal (e.g. search_similar_issues) — feed result back and continue
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls ?? [] });
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }

  console.log("Hit max turns without a terminal action.");
}

async function main() {
  // Issues 5 & 6 are the duplicate pair (large image upload crash)
  for (const issueNum of [5, 6]) {
    await triageIssue(issueNum);
  }
}

main().catch(console.error);
