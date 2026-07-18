import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "../src/db.js";

dotenv.config();

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;

const app = express();
app.use(cors());
app.use(express.json());

// Get all decisions, most recent first
app.get("/api/decisions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, issue_number, issue_title, turn, tool_name, tool_args,
              reasoning, result, accepted, rejection_reason, created_at
       FROM agent_decisions
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const rows = result.rows.map((row) => ({
      ...row,
      issue_url: OWNER && REPO ? `https://github.com/${OWNER}/${REPO}/issues/${row.issue_number}` : null,
    }));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch decisions" });
  }
});

// Summary stats for the dashboard header
app.get("/api/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total_decisions,
        COUNT(*) FILTER (WHERE accepted = true)::int AS accepted_count,
        COUNT(*) FILTER (WHERE accepted = false)::int AS rejected_count,
        COUNT(DISTINCT issue_number)::int AS issues_processed
      FROM agent_decisions
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
