import type { Issue, WorkEvent } from "@pulse/shared";
import { MOCK_EVENTS, MOCK_ISSUE } from "./mock";

const SAMPLE_ISSUE = MOCK_ISSUE;
const SAMPLE_EVENTS = MOCK_EVENTS;

export function mountBrief(): void {
  const aside = document.createElement("aside");
  aside.id = "brief";
  aside.setAttribute("aria-label", "Today's issue");
  const sticky = document.createElement("div");
  sticky.className = "brief-sticky";
  const kicker = document.createElement("p");
  kicker.id = "brief-kicker";
  kicker.className = "brief-kicker";
  const approval = document.createElement("p");
  approval.id = "brief-approval";
  approval.className = "brief-approval";
  sticky.append(kicker, approval);
  const body = document.createElement("div");
  body.id = "brief-body";
  aside.append(sticky, body);
  const overlay = document.querySelector("#overlay");
  (overlay ?? document.body).appendChild(aside);
}

export function renderBrief(issue: Issue | null, events: WorkEvent[]): void {
  const root = document.querySelector("#brief");
  const kicker = document.querySelector<HTMLElement>("#brief-kicker");
  const approval = document.querySelector<HTMLElement>("#brief-approval");
  const body = document.querySelector<HTMLElement>("#brief-body");
  if (!root || !kicker || !approval || !body) return;

  const sample = !issue;
  const shown = issue ?? SAMPLE_ISSUE;
  const log = sample ? SAMPLE_EVENTS : events;
  kicker.hidden = !sample;
  kicker.textContent = "Sample issue. A real run replaces this.";
  approval.textContent = `${approvalLabel(shown.status)} Nothing is auto-sent.`;

  body.replaceChildren(
    block("Maya", "Today's assignment", "maya brief-assign", paragraph(assignmentText(log))),
    block("Rex", "Where the data was searched", "rex", rexBlock(shown, log)),
    block("Luna", "Summary", "luna", summaryBlock(shown)),
    block("Victor", "Fact-check", "victor", victorBlock(log)),
    block("Ivy", "Subject, affiliates, and footer", "ivy", ivyBlock(shown)),
    block("Maya", "Approval", "maya brief-close", paragraph(`${approvalLabel(shown.status)} Nothing is auto-sent.`)),
  );
}

function assignmentText(events: WorkEvent[]): string {
  const event = events.find((item) => item.action === "assign");
  return event?.fullText || event?.summary || "Maya assigned today's issue from public market data. Nothing is sent from the run.";
}

function rexBlock(issue: Issue, events: WorkEvent[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.appendChild(paragraph("Searched CoinGecko trending and top movers."));
  const found = events.find((item) => item.action === "research");
  if (found?.summary) wrap.appendChild(paragraph(found.summary));
  const list = document.createElement("ul");
  list.className = "brief-sources";
  const sources = issue.sources.length > 0 ? issue.sources : [];
  if (sources.length === 0) {
    wrap.appendChild(paragraph("No source links were saved with this issue."));
    return wrap;
  }
  for (const source of sources) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.rel = "noreferrer";
    link.target = "_blank";
    link.append(document.createTextNode(source.title));
    const host = document.createElement("span");
    host.className = "brief-host";
    host.textContent = ` · ${sourceHost(source.url)}`;
    link.append(host);
    const url = document.createElement("span");
    url.className = "brief-url";
    url.textContent = source.url;
    item.append(link, url);
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

function summaryBlock(issue: Issue): HTMLElement {
  const text = document.createElement("div");
  text.className = "brief-summary";
  text.tabIndex = 0;
  text.textContent = issue.body || "The summary is not written yet.";
  return text;
}

function victorBlock(events: WorkEvent[]): HTMLElement {
  const wrap = document.createElement("div");
  const event = events.find((item) => item.action === "factcheck");
  const checked = event?.summary || event?.fullText || "Victor checked the draft against the CoinGecko source links.";
  wrap.append(
    paragraph("What changed: Price predictions were removed."),
    paragraph(`What was checked: ${checked}`),
  );
  return wrap;
}

function ivyBlock(issue: Issue): HTMLElement {
  const wrap = document.createElement("div");
  wrap.appendChild(paragraph(`Subject line: ${issue.subject || "No subject yet."}`));
  if (issue.preheader) wrap.appendChild(paragraph(issue.preheader));
  if (issue.affiliates.length === 0) {
    wrap.appendChild(paragraph("No affiliate links on this issue."));
  }
  for (const affiliate of issue.affiliates) {
    const row = document.createElement("p");
    row.className = "brief-copy";
    const link = document.createElement("a");
    link.href = affiliate.href;
    link.textContent = affiliate.label;
    link.rel = "noreferrer";
    link.target = "_blank";
    row.append(link, document.createTextNode(` ${affiliate.disclosure}`));
    wrap.appendChild(row);
  }
  const footer = document.createElement("p");
  footer.className = "brief-footer";
  footer.textContent = issue.footer || "Not financial advice.";
  wrap.appendChild(footer);
  return wrap;
}

function sourceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function approvalLabel(status: Issue["status"]): string {
  if (status === "approved") return "Approved.";
  if (status === "failed") return "This run failed.";
  return "Waiting for approval.";
}

function block(who: string, title: string, tone: string, content: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.className = `brief-block brief-${tone}`;
  section.dataset.block = title;
  const heading = document.createElement("h2");
  const name = document.createElement("span");
  name.textContent = who;
  heading.append(name, document.createTextNode(` ${title}`));
  section.append(heading, content);
  return section;
}

function paragraph(text: string): HTMLParagraphElement {
  const copy = document.createElement("p");
  copy.className = "brief-copy";
  copy.textContent = text;
  return copy;
}
