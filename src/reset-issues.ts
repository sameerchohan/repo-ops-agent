import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const OWNER = process.env.GITHUB_OWNER!;
const REPO = process.env.GITHUB_REPO!;

async function resetIssue(issueNumber: number) {
  await octokit.issues.removeAllLabels({
    owner: OWNER, repo: REPO, issue_number: issueNumber,
  });

  const { data: comments } = await octokit.issues.listComments({
    owner: OWNER, repo: REPO, issue_number: issueNumber,
  });
  for (const comment of comments) {
    await octokit.issues.deleteComment({
      owner: OWNER, repo: REPO, comment_id: comment.id,
    });
  }

  console.log(`Reset #${issueNumber}: labels cleared, ${comments.length} comment(s) deleted`);
}

async function main() {
  const issueNumbers = process.argv.slice(2).map(Number);
  if (issueNumbers.length === 0) {
    console.error("Usage: npx tsx src/reset-issues.ts <issue_number> [issue_number...]");
    process.exit(1);
  }

  for (const num of issueNumbers) {
    await resetIssue(num);
  }
}

main().catch(console.error);
