import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type Decision = {
  id: number;
  issue_number: number;
  issue_title: string;
  issue_url: string | null;
  turn: number;
  tool_name: string;
  tool_args: Record<string, any>;
  reasoning: string | null;
  result: string;
  accepted: boolean;
  rejection_reason: string | null;
  created_at: string;
};

type Stats = {
  total_decisions: number;
  accepted_count: number;
  rejected_count: number;
  issues_processed: number;
};

type ViewMode = "flat" | "grouped";
type FilterMode = "all" | "accepted" | "rejected";
type ConnState = "connecting" | "live" | "disconnected";
type Theme = "dark" | "light";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";
const POLL_INTERVAL_MS = 8000;
const THEME_KEY = "ropsTheme";

const TOOL_CLASS: Record<string, string> = {
  search_similar_issues: "tool-search",
  apply_label: "tool-apply",
  mark_duplicate: "tool-duplicate",
  flag_urgent: "tool-flag",
  request_more_info: "tool-info",
};

function toolClass(name: string) {
  return TOOL_CLASS[name] ?? "tool-default";
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggle];
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.4 14.7A8.5 8.5 0 1 1 9.3 3.6a7 7 0 0 0 11.1 11.1Z" />
    </svg>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function ToolBadge({ name }: { name: string }) {
  return (
    <span className={`tool-badge ${toolClass(name)}`}>
      <span className="tool-dot" />
      {name}
    </span>
  );
}

function ToolBreakdown({ decisions }: { decisions: Decision[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of decisions) map.set(d.tool_name, (map.get(d.tool_name) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [decisions]);

  const total = decisions.length || 1;

  if (counts.length === 0) return null;

  return (
    <div className="breakdown">
      <div className="breakdown-title">Tool usage</div>
      <div className="breakdown-bars">
        {counts.map(([name, count]) => (
          <div className="breakdown-row" key={name}>
            <span className={`breakdown-label ${toolClass(name)}`}>{name}</span>
            <div className="breakdown-track">
              <div
                className={`breakdown-fill ${toolClass(name)}`}
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
            <span className="breakdown-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionCard({ d }: { d: Decision }) {
  return (
    <div className={`decision-row ${d.accepted ? "" : "rejected"}`}>
      <div className="decision-main">
        {d.issue_url ? (
          <a className="issue-number" href={d.issue_url} target="_blank" rel="noreferrer">
            #{d.issue_number}
          </a>
        ) : (
          <span className="issue-number">#{d.issue_number}</span>
        )}
        <span className="issue-title">{d.issue_title}</span>
        <ToolBadge name={d.tool_name} />
        <span
          className={`status-dot ${d.accepted ? "accepted" : "rejected"}`}
          title={d.accepted ? "Accepted" : "Rejected"}
        />
      </div>
      {d.reasoning && <div className="reasoning">{d.reasoning}</div>}
      {!d.accepted && d.rejection_reason && (
        <div className="rejection">Rejected: {d.rejection_reason}</div>
      )}
      <div className="meta">
        turn {d.turn} · {new Date(d.created_at).toLocaleString()}
      </div>
    </div>
  );
}

function GroupedIssueCard({ entries }: { entries: Decision[] }) {
  const [open, setOpen] = useState(false);

  const sorted = [...entries].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const latest = sorted[sorted.length - 1];
  const hasRejection = sorted.some((d) => !d.accepted);

  if (!latest) return null;

  return (
    <div className={`issue-group ${hasRejection ? "has-rejection" : ""} ${open ? "open" : ""}`}>
      <button
        type="button"
        className="issue-group-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="issue-number-link">
          {latest.issue_url ? (
            <a
              href={latest.issue_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              #{latest.issue_number}
            </a>
          ) : (
            `#${latest.issue_number}`
          )}
        </span>
        <span className="issue-title">{latest.issue_title}</span>
        <ToolBadge name={latest.tool_name} />
        {hasRejection && <span className="warn-chip">had rejected attempt</span>}
        <span
          className={`status-dot ${latest.accepted ? "accepted" : "rejected"}`}
          title={latest.accepted ? "Accepted" : "Rejected"}
        />
        <span className="chevron">▸</span>
      </button>
      <div className="turn-trail-wrap">
        <div className="turn-trail-inner">
          <div className="turn-trail">
            {sorted.map((d) => (
              <div key={d.id} className={`turn-step ${d.accepted ? "" : "rejected"}`}>
                <div className="turn-step-head">
                  <span className="turn-index">turn {d.turn}</span>
                  <ToolBadge name={d.tool_name} />
                  <span className="meta">{new Date(d.created_at).toLocaleString()}</span>
                </div>
                {d.reasoning && <div className="reasoning">{d.reasoning}</div>}
                {!d.accepted && d.rejection_reason && (
                  <div className="rejection">Rejected: {d.rejection_reason}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnBadge({ state, lastSynced }: { state: ConnState; lastSynced: Date | null }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const label =
    state === "live" ? "Live" : state === "connecting" ? "Connecting…" : "Disconnected";

  return (
    <div className={`conn-badge ${state}`}>
      <span className="pulse-dot" />
      <span className="conn-label">{label}</span>
      {lastSynced && <span className="conn-synced">· synced {timeAgo(lastSynced.toISOString())}</span>}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="skeleton-row">
      <div className="skeleton-bar w-30" />
      <div className="skeleton-bar w-60" />
      <div className="skeleton-bar w-40" />
    </div>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [view, setView] = useState<ViewMode>("grouped");
  const [search, setSearch] = useState("");

  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [decisionsRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/decisions`),
          fetch(`${API_BASE}/stats`),
        ]);
        if (!decisionsRes.ok || !statsRes.ok) throw new Error("API request failed");
        const [decisionsJson, statsJson] = await Promise.all([decisionsRes.json(), statsRes.json()]);
        if (cancelled) return;
        setDecisions(decisionsJson);
        setStats(statsJson);
        setConn("live");
        setLastSynced(new Date());
        hasLoadedOnce.current = true;
      } catch (err) {
        if (cancelled) return;
        if (!hasLoadedOnce.current) {
          setFatalError("Couldn't reach the API. Is it running on port 4000?");
        }
        setConn("disconnected");
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const searched = useMemo(() => {
    if (!search.trim()) return decisions;
    const q = search.trim().toLowerCase();
    return decisions.filter(
      (d) => String(d.issue_number).includes(q) || d.issue_title.toLowerCase().includes(q)
    );
  }, [decisions, search]);

  const flatFiltered = useMemo(() => {
    return searched.filter((d) => {
      if (filter === "accepted") return d.accepted;
      if (filter === "rejected") return !d.accepted;
      return true;
    });
  }, [searched, filter]);

  const groups = useMemo(() => {
    const map = new Map<number, Decision[]>();
    for (const d of searched) {
      const arr = map.get(d.issue_number) ?? [];
      arr.push(d);
      map.set(d.issue_number, arr);
    }
    let entries = [...map.entries()];
    if (filter === "accepted") {
      entries = entries.filter(([, ds]) => ds.every((d) => d.accepted));
    } else if (filter === "rejected") {
      entries = entries.filter(([, ds]) => ds.some((d) => !d.accepted));
    }
    entries.sort((a, b) => {
      const latestA = Math.max(...a[1].map((d) => new Date(d.created_at).getTime()));
      const latestB = Math.max(...b[1].map((d) => new Date(d.created_at).getTime()));
      return latestB - latestA;
    });
    return entries;
  }, [searched, filter]);

  const topbar = (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <h1>Repo Ops Agent</h1>
          <p className="subtitle">Autonomous GitHub issue triage — decision log</p>
        </div>
        <div className="topbar-actions">
          <ConnBadge state={conn} lastSynced={lastSynced} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>
    </div>
  );

  if (initialLoading) {
    return (
      <div className="shell">
        {topbar}
        <div className="main">
          <div className="skeleton-stats">
            {Array.from({ length: 4 }).map((_, i) => (
              <div className="skeleton-card" key={i} />
            ))}
          </div>
          <div className="decision-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="shell">
        {topbar}
        <div className="state-message error">{fatalError}</div>
      </div>
    );
  }

  const isEmpty = view === "flat" ? flatFiltered.length === 0 : groups.length === 0;

  return (
    <div className="shell">
      {topbar}
      <div className="main">
        {stats && (
          <div className="stats-row">
            <StatCard label="Total decisions" value={stats.total_decisions} />
            <StatCard label="Accepted" value={stats.accepted_count} />
            <StatCard label="Rejected" value={stats.rejected_count} />
            <StatCard label="Issues processed" value={stats.issues_processed} />
          </div>
        )}

        <ToolBreakdown decisions={decisions} />

        <div className="controls-row">
          <div className="filter-row" role="tablist" aria-label="Filter by outcome">
            {(["all", "accepted", "rejected"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={`filter-btn ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="view-toggle" role="tablist" aria-label="View mode">
            {(["grouped", "flat"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={`filter-btn ${view === v ? "active" : ""}`}
                onClick={() => setView(v)}
              >
                {v === "grouped" ? "By issue" : "Flat log"}
              </button>
            ))}
          </div>

          <input
            className="search-input"
            type="search"
            placeholder="Search by issue # or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search decisions"
          />
        </div>

        {isEmpty ? (
          <div className="empty-state">No decisions match this filter.</div>
        ) : view === "flat" ? (
          <div className="decision-list">
            {flatFiltered.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <div className="decision-list">
            {groups.map(([issueNumber, entries]) => (
              <GroupedIssueCard key={issueNumber} entries={entries} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
