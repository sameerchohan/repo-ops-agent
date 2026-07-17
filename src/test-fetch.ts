import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function main() {
  const { data: issue } = await octokit.issues.get({
    owner: process.env.GITHUB_OWNER!,
    repo: process.env.GITHUB_REPO!,
    issue_number: 1,
  });

  console.log("Title:", issue.title);
  console.log("Body:", issue.body);
  console.log("Current labels:", issue.labels);
}

main().catch(console.error);