import { predictionPhrases, type DeskRun, type Issue, type IssueSection, type WorkEvent } from "@pulse/shared";

const STEPS = [
  { action: "assign", label: "Maya" },
  { action: "research", label: "Rex" },
  { action: "draft", label: "Luna" },
  { action: "factcheck", label: "Victor" },
  { action: "revise", label: "Luna" },
  { action: "monetize", label: "Ivy" },
  { action: "finish", label: "Maya" },
] as const;

export type ChannelDraft = {
  id: string;
  label: string;
  payload: string;
};

export function coinNames(issue: Issue): string[] {
  const names = issue.sources.map((source) => source.title).filter(Boolean);
  return names.length > 0 ? names.slice(0, 3) : ["No coins saved"];
}

export function statusLine(issue: Issue): string {
  if (issue.status === "approved") return "Not sent anywhere. Approved by you.";
  if (issue.status === "failed") return "Nothing was sent. This run failed.";
  return "Not sent anywhere. Waiting for you.";
}

export function freshnessLine(issue: Issue, events: WorkEvent[]): string {
  const research = events.find((event) => event.action === "research");
  const ts = issue.fetchedAt || research?.ts || issue.createdAt;
  if (!ts || ts < 10_000_000_000) return "Data source: CoinGecko trending and top movers.";
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(ts));
  return `Data from CoinGecko trending and top movers, ${when}.`;
}

export function removedPhrases(issue: Issue, events: WorkEvent[]): string[] {
  if (issue.removed.length > 0) return issue.removed;
  const found = new Set<string>();
  for (const event of events) {
    if (!["draft", "factcheck", "revise", "research"].includes(event.action)) continue;
    for (const phrase of predictionPhrases(event.fullText)) found.add(phrase);
  }
  return [...found];
}

export function sectionList(issue: Issue): IssueSection[] {
  if (issue.sections.length > 0) return issue.sections;
  const parts = issue.body.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return [{ heading: "Summary", text: "The summary is not written yet." }];
  return parts.map((text, index) => {
    const [first, ...rest] = text.split("\n");
    if (rest.length > 0 && first.length < 80) return { heading: first, text: rest.join("\n").trim() };
    return { heading: parts.length > 1 ? `Part ${index + 1}` : "Summary", text };
  });
}

export function failureLine(run: DeskRun | null, issue: Issue | null): string | null {
  if (!run || run.status !== "failed") return null;
  if (issue && run.id === issue.runId && issue.status !== "failed") return null;
  const error = run.error || "The run stopped.";
  return /nothing was sent/i.test(error) ? error : `${error} Nothing was sent.`;
}

export function cronLine(issue: Issue, run: DeskRun | null): string | null {
  const fromCron = issue.runSource === "cron" || (run?.id === issue.runId && run.source === "cron");
  if (!fromCron || issue.status !== "pending_approval") return null;
  const ts = issue.createdAt > 10_000_000_000 ? issue.createdAt : null;
  const when = ts
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
        timeZoneName: "short",
      }).format(new Date(ts))
    : "overnight";
  return `Drafted automatically ${when}, not yet reviewed.`;
}

export function progressIndex(events: WorkEvent[], issue: Issue | null): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const found = STEPS.findIndex((step) => step.action === events[index].action);
    if (found >= 0) return found;
  }
  return issue ? STEPS.length - 1 : -1;
}

export function progressSteps(): { label: string }[] {
  return STEPS.map((step) => ({ label: step.label }));
}

export function channelDrafts(issue: Issue): ChannelDraft[] {
  const summary = `${issue.subject}\n\n${issue.preheader}\n\n${issue.footer}`;
  return [
    { id: "beehiiv", label: "Beehiiv", payload: `${issue.subject}\n\n${issue.body}` },
    { id: "x", label: "X", payload: issue.subject },
    { id: "reddit", label: "Reddit", payload: `${issue.subject}\n\n${summary}` },
    { id: "telegram", label: "Telegram", payload: summary },
  ];
}

export function placeholderCount(issue: Issue): number {
  return issue.affiliates.length;
}
