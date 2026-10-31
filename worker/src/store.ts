import type { AffiliateBlock, EmployeeId, EventStatus, Issue, IssueStatus, SourceLink, StationId, WorkEvent } from "@pulse/shared";

export type RunRow = {
  id: string;
  status: "running" | "succeeded" | "failed";
  source: string;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  tokens: number;
  model: string | null;
};

export interface Store {
  createRun(row: { id: string; source: string; startedAt: number }): Promise<void>;
  finishRun(id: string, status: "succeeded" | "failed", error: string | null, tokens: number, model: string | null): Promise<void>;
  getRun(id: string): Promise<RunRow | null>;
  tryLock(runId: string, now: number, until: number): Promise<boolean>;
  releaseLock(runId: string): Promise<void>;
  dayTokens(day: string): Promise<number>;
  addTokens(day: string, amount: number): Promise<number>;
  addEvent(event: WorkEvent): Promise<void>;
  listEvents(runId: string, afterId?: string): Promise<WorkEvent[]>;
  saveIssue(issue: Issue): Promise<void>;
  getIssue(id: string): Promise<Issue | null>;
  latestIssue(approvedOnly: boolean): Promise<Issue | null>;
  updateIssue(id: string, patch: Partial<Pick<Issue, "subject" | "body" | "status">> & { updatedAt: number }): Promise<Issue | null>;
}

export function createMemoryStore(): Store {
  const runs = new Map<string, RunRow>();
  const events: WorkEvent[] = [];
  const issues: Issue[] = [];
  const days = new Map<string, number>();
  let lock: { runId: string; until: number } | null = null;

  return {
    async createRun(row) {
      runs.set(row.id, { ...row, status: "running", finishedAt: null, error: null, tokens: 0, model: null });
    },
    async finishRun(id, status, error, tokens, model) {
      const run = runs.get(id);
      if (!run) return;
      run.status = status;
      run.error = error;
      run.tokens = tokens;
      run.model = model;
      run.finishedAt = Date.now();
    },
    async getRun(id) {
      return runs.get(id) ?? null;
    },
    async tryLock(runId, now, until) {
      if (lock && lock.until > now) return false;
      lock = { runId, until };
      return true;
    },
    async releaseLock(runId) {
      if (lock?.runId === runId) lock = null;
    },
    async dayTokens(day) {
      return days.get(day) ?? 0;
    },
    async addTokens(day, amount) {
      const next = (days.get(day) ?? 0) + amount;
      days.set(day, next);
      return next;
    },
    async addEvent(event) {
      events.push(event);
    },
    async listEvents(runId, afterId) {
      const ordered = events.filter((event) => event.runId === runId).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
      if (!afterId) return ordered;
      const index = ordered.findIndex((event) => event.id === afterId);
      return index < 0 ? ordered : ordered.slice(index + 1);
    },
    async saveIssue(issue) {
      issues.push(issue);
    },
    async getIssue(id) {
      return issues.find((issue) => issue.id === id) ?? null;
    },
    async latestIssue(approvedOnly) {
      const pool = approvedOnly ? issues.filter((issue) => issue.status === "approved") : issues;
      return pool.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    },
    async updateIssue(id, patch) {
      const issue = issues.find((item) => item.id === id);
      if (!issue) return null;
      if (patch.subject !== undefined) issue.subject = patch.subject;
      if (patch.body !== undefined) issue.body = patch.body;
      if (patch.status !== undefined) issue.status = patch.status;
      issue.updatedAt = patch.updatedAt;
      return issue;
    },
  };
}

type EventRow = {
  id: string;
  run_id: string;
  employee: EmployeeId;
  action: string;
  summary: string;
  full_text: string;
  station: StationId;
  status: EventStatus;
  ts: number;
};

export function createD1Store(db: D1Database): Store {
  return {
    async createRun(row) {
      await db.prepare("INSERT INTO runs (id, status, source, started_at, tokens) VALUES (?1, 'running', ?2, ?3, 0)").bind(row.id, row.source, row.startedAt).run();
    },
    async finishRun(id, status, error, tokens, model) {
      await db.prepare("UPDATE runs SET status = ?2, error = ?3, tokens = ?4, model = ?5, finished_at = ?6 WHERE id = ?1").bind(id, status, error, tokens, model, Date.now()).run();
    },
    async getRun(id) {
      const row = await db.prepare("SELECT id, status, source, started_at, finished_at, error, tokens, model FROM runs WHERE id = ?1").bind(id).first<{
        id: string;
        status: RunRow["status"];
        source: string;
        started_at: number;
        finished_at: number | null;
        error: string | null;
        tokens: number;
        model: string | null;
      }>();
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        source: row.source,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        error: row.error,
        tokens: row.tokens,
        model: row.model,
      };
    },
    async tryLock(runId, now, until) {
      const result = await db.prepare("UPDATE run_lock SET run_id = ?1, until_ts = ?2 WHERE id = 1 AND (run_id IS NULL OR until_ts < ?3)").bind(runId, until, now).run();
      return (result.meta.changes ?? 0) > 0;
    },
    async releaseLock(runId) {
      await db.prepare("UPDATE run_lock SET run_id = NULL, until_ts = 0 WHERE id = 1 AND run_id = ?1").bind(runId).run();
    },
    async dayTokens(day) {
      const row = await db.prepare("SELECT tokens FROM token_days WHERE day = ?1").bind(day).first<{ tokens: number }>();
      return row?.tokens ?? 0;
    },
    async addTokens(day, amount) {
      await db.prepare("INSERT INTO token_days (day, tokens) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET tokens = tokens + ?2").bind(day, amount).run();
      return this.dayTokens(day);
    },
    async addEvent(event) {
      await db.prepare("INSERT INTO events (id, run_id, employee, action, summary, full_text, station, status, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(event.id, event.runId, event.employee, event.action, event.summary, event.fullText, event.station, event.status, event.ts)
        .run();
    },
    async listEvents(runId, afterId) {
      const rows = await db.prepare("SELECT id, run_id, employee, action, summary, full_text, station, status, ts FROM events WHERE run_id = ?1 ORDER BY ts ASC, id ASC").bind(runId).all<EventRow>();
      const ordered = (rows.results ?? []).map(toEvent);
      if (!afterId) return ordered;
      const index = ordered.findIndex((event) => event.id === afterId);
      return index < 0 ? ordered : ordered.slice(index + 1);
    },
    async saveIssue(issue) {
      await db.prepare("INSERT INTO issues (id, run_id, subject, preheader, body, footer, sources_json, affiliates_json, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
        .bind(issue.id, issue.runId, issue.subject, issue.preheader, issue.body, issue.footer, JSON.stringify(issue.sources), JSON.stringify(issue.affiliates), issue.status, issue.createdAt, issue.updatedAt)
        .run();
    },
    async getIssue(id) {
      const row = await db.prepare("SELECT * FROM issues WHERE id = ?1").bind(id).first<IssueRow>();
      return row ? toIssue(row) : null;
    },
    async latestIssue(approvedOnly) {
      const sql = approvedOnly
        ? "SELECT * FROM issues WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1"
        : "SELECT * FROM issues ORDER BY created_at DESC LIMIT 1";
      const row = await db.prepare(sql).first<IssueRow>();
      return row ? toIssue(row) : null;
    },
    async updateIssue(id, patch) {
      const current = await this.getIssue(id);
      if (!current) return null;
      const next: Issue = {
        ...current,
        subject: patch.subject ?? current.subject,
        body: patch.body ?? current.body,
        status: (patch.status as IssueStatus | undefined) ?? current.status,
        updatedAt: patch.updatedAt,
      };
      await db.prepare("UPDATE issues SET subject = ?2, body = ?3, status = ?4, updated_at = ?5 WHERE id = ?1")
        .bind(id, next.subject, next.body, next.status, next.updatedAt)
        .run();
      return next;
    },
  };
}

type IssueRow = {
  id: string;
  run_id: string;
  subject: string;
  preheader: string;
  body: string;
  footer: string;
  sources_json: string;
  affiliates_json: string;
  status: IssueStatus;
  created_at: number;
  updated_at: number;
};

function toEvent(row: EventRow): WorkEvent {
  return {
    id: row.id,
    runId: row.run_id,
    employee: row.employee,
    action: row.action,
    summary: row.summary,
    fullText: row.full_text,
    station: row.station,
    status: row.status,
    ts: row.ts,
  };
}

function toIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    runId: row.run_id,
    subject: row.subject,
    preheader: row.preheader,
    body: row.body,
    footer: row.footer,
    sources: JSON.parse(row.sources_json) as SourceLink[],
    affiliates: JSON.parse(row.affiliates_json) as AffiliateBlock[],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
