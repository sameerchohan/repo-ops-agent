import { Pool } from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("Schema ready");
}

export async function logDecision(entry: {
  issueNumber: number;
  issueTitle: string;
  turn: number;
  toolName: string;
  toolArgs: any;
  reasoning?: string | undefined;
  result: string;
  accepted: boolean;
  rejectionReason?: string | undefined;
}) {
  await pool.query(
    `INSERT INTO agent_decisions
      (issue_number, issue_title, turn, tool_name, tool_args, reasoning, result, accepted, rejection_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.issueNumber,
      entry.issueTitle,
      entry.turn,
      entry.toolName,
      JSON.stringify(entry.toolArgs),
      entry.reasoning ?? null,
      entry.result,
      entry.accepted,
      entry.rejectionReason ?? null,
    ]
  );
}