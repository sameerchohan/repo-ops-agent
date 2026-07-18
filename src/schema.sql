CREATE TABLE IF NOT EXISTS agent_decisions (
  id SERIAL PRIMARY KEY,
  issue_number INT NOT NULL,
  issue_title TEXT NOT NULL,
  turn INT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL,
  reasoning TEXT,
  result TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT true,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_issue
  ON agent_decisions (issue_number);