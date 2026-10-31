import type { Issue, WorkEvent } from "@pulse/shared";

const root = import.meta.env.VITE_API_BASE ?? "";

function ownerHeaders(): HeadersInit {
  const token = import.meta.env.VITE_OWNER_TOKEN ?? "";
  return token ? { "x-owner-token": token } : {};
}

async function read(response: Response): Promise<Record<string, unknown>> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof data.error === "string" ? data.error : "The desk could not finish that request.";
    throw new Error(error);
  }
  return data;
}

export async function startRun(): Promise<string> {
  const data = await read(await fetch(`${root}/api/run`, { method: "POST", headers: ownerHeaders() }));
  const runId = data.runId;
  if (typeof runId !== "string") throw new Error("The run did not start.");
  return runId;
}

export async function getEvents(runId: string, after?: string): Promise<WorkEvent[]> {
  const query = new URLSearchParams({ runId });
  if (after) query.set("after", after);
  const data = await read(await fetch(`${root}/api/events?${query}`));
  return (data.events as WorkEvent[] | undefined) ?? [];
}

export async function getRun(runId: string): Promise<{ status: string; error: string | null }> {
  const data = await read(await fetch(`${root}/api/runs/${runId}`));
  const run = data.run as { status?: string; error?: string | null } | undefined;
  return { status: run?.status ?? "running", error: run?.error ?? null };
}

export async function getLatestIssue(approvedOnly = false): Promise<Issue | null> {
  const query = approvedOnly ? "?public=1" : "";
  const data = await read(await fetch(`${root}/api/issues/latest${query}`));
  return (data.issue as Issue | null) ?? null;
}

export async function saveIssue(id: string, subject: string, body: string): Promise<Issue> {
  const data = await read(await fetch(`${root}/api/issues/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({ subject, body }),
  }));
  return data.issue as Issue;
}

export async function approveIssue(id: string): Promise<Issue> {
  const data = await read(await fetch(`${root}/api/issues/${id}/approve`, {
    method: "POST",
    headers: ownerHeaders(),
  }));
  return data.issue as Issue;
}

export async function prepareIssuePublish(id: string): Promise<{ reason: string; channels: { id: string; sent: boolean; configured: boolean }[] }> {
  const data = await read(await fetch(`${root}/api/issues/${id}/publish`, {
    method: "POST",
    headers: ownerHeaders(),
  }));
  return data.plan as { reason: string; channels: { id: string; sent: boolean; configured: boolean }[] };
}
