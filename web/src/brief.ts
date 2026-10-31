import type { DeskRun, Issue, WorkEvent } from "@pulse/shared";
import {
  channelDrafts,
  coinNames,
  cronLine,
  failureLine,
  freshnessLine,
  placeholderCount,
  progressIndex,
  progressSteps,
  removedPhrases,
  sectionList,
  statusLine,
} from "./issueView";
import { MOCK_EVENTS, MOCK_ISSUE } from "./mock";

const SAMPLE_ISSUE = MOCK_ISSUE;
const SAMPLE_EVENTS = MOCK_EVENTS;

export type BriefDesk = {
  run: DeskRun | null;
  setAside: boolean;
};

export function mountBrief(): void {
  const aside = document.createElement("aside");
  aside.id = "brief";
  aside.setAttribute("aria-label", "Today's issue");
  const sticky = document.createElement("div");
  sticky.className = "brief-sticky";
  sticky.id = "brief-sticky";
  const body = document.createElement("div");
  body.id = "brief-body";
  aside.append(sticky, body);
  const overlay = document.querySelector("#overlay");
  (overlay ?? document.body).appendChild(aside);
}

export function renderBrief(issue: Issue | null, events: WorkEvent[], desk: BriefDesk = { run: null, setAside: false }): void {
  const root = document.querySelector<HTMLElement>("#brief");
  const sticky = document.querySelector<HTMLElement>("#brief-sticky");
  const body = document.querySelector<HTMLElement>("#brief-body");
  if (!root || !sticky || !body) return;

  const sample = !issue;
  const shown = issue ?? SAMPLE_ISSUE;
  const log = sample ? SAMPLE_EVENTS : events;
  root.dataset.sample = sample ? "1" : "0";
  sticky.replaceChildren(...summaryNodes(shown, log, desk, sample));
  body.replaceChildren(
    block("Maya", "Today's assignment", "maya brief-assign", paragraph(assignmentText(log))),
    block("Rex", "Where the data was searched", "rex", rexBlock(shown, log)),
    block("Luna", "Summary", "luna", summaryBlock(shown)),
    block("Victor", "Fact-check", "victor", victorBlock(shown, log)),
    block("Ivy", "Subject, affiliates, and footer", "ivy", ivyBlock(shown)),
    block("Maya", "Approval", "maya brief-close", approvalBlock(shown)),
  );
}

function summaryNodes(issue: Issue, events: WorkEvent[], desk: BriefDesk, sample: boolean): Node[] {
  const nodes: Node[] = [];
  if (sample) nodes.push(line("brief-kicker", "SAMPLE, not from today's data"));
  const failed = failureLine(desk.run, sample ? null : issue);
  if (failed) nodes.push(line("brief-failure", failed));
  const cron = sample ? null : cronLine(issue, desk.run);
  if (cron) nodes.push(line("brief-cron", cron));
  if (desk.setAside) nodes.push(line("brief-aside", "An older unapproved draft was set aside."));
  nodes.push(line("brief-approval", statusLine(issue)));
  nodes.push(line("brief-subject", `Subject: ${issue.subject || "No subject yet."}`));
  nodes.push(line("brief-preheader", issue.preheader || "No preheader yet."));
  nodes.push(line("brief-coins", `Coins: ${coinNames(issue).join(", ")}`));
  nodes.push(line("brief-fresh", freshnessLine(issue, events)));
  nodes.push(removedNode(removedPhrases(issue, events)));
  const placeholders = placeholderCount(issue);
  nodes.push(line(
    "brief-placeholders",
    placeholders === 0 ? "No affiliate links on this issue." : `${placeholders} affiliate ${placeholders === 1 ? "link is a placeholder" : "links are placeholders"}.`,
  ));
  if (issue.status === "approved") nodes.push(channelList(issue));
  else nodes.push(line("brief-hold", "Beehiiv, X, Reddit, and Telegram stay unsent. Approval does not send."));
  nodes.push(progressNode(events, sample ? null : issue));
  if (!sample && issue.createdAt > 10_000_000_000 && failed) {
    nodes.push(line("brief-dated", `Last saved issue, ${freshnessLine(issue, events).replace(/^Data from CoinGecko trending and top movers, /, "")}`));
  }
  return nodes;
}

function removedNode(phrases: string[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "brief-removed";
  if (phrases.length === 0) {
    wrap.append(line("brief-copy", "No prediction phrase was in this draft. Victor still removes price predictions before approval."));
    return wrap;
  }
  wrap.append(line("brief-copy", "Victor removed these phrases:"));
  const list = document.createElement("ul");
  list.className = "brief-struck";
  const shown = phrases.slice(0, 3);
  for (const phrase of shown) {
    const item = document.createElement("li");
    const strike = document.createElement("s");
    strike.textContent = phrase;
    item.appendChild(strike);
    list.appendChild(item);
  }
  wrap.appendChild(list);
  if (phrases.length > shown.length) {
    wrap.append(line("brief-copy", `+${phrases.length - shown.length} more in the fact-check below.`));
  }
  return wrap;
}

function channelList(issue: Issue): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "brief-channels";
  for (const channel of channelDrafts(issue)) {
    const row = document.createElement("p");
    row.className = "channel-row";
    const label = document.createElement("span");
    label.textContent = `${channel.label} · Prepared · not sent`;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(channel.payload).then(
        () => { copy.textContent = "Copied"; },
        () => { copy.textContent = "Copy failed"; },
      );
    });
    row.append(label, copy);
    wrap.appendChild(row);
  }
  return wrap;
}

function progressNode(events: WorkEvent[], issue: Issue | null): HTMLElement {
  const list = document.createElement("ol");
  list.className = "brief-progress";
  const current = progressIndex(events, issue);
  progressSteps().forEach((step, index) => {
    const item = document.createElement("li");
    item.textContent = step.label;
    if (current >= 0 && index < current) item.className = "is-done";
    if (index === current) {
      item.className = "is-current";
      item.setAttribute("aria-current", "step");
    }
    list.appendChild(item);
  });
  return list;
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
  if (issue.sources.length === 0) {
    wrap.appendChild(paragraph("No source links were saved with this issue."));
    return wrap;
  }
  for (const source of issue.sources) {
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
  const wrap = document.createElement("div");
  const text = document.createElement("div");
  text.className = "brief-summary is-clamped";
  text.tabIndex = 0;
  for (const section of sectionList(issue)) {
    const card = document.createElement("article");
    card.className = "brief-section";
    const heading = document.createElement("h3");
    heading.textContent = section.heading;
    const copy = document.createElement("p");
    copy.textContent = section.text;
    card.append(heading, copy);
    text.appendChild(card);
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "brief-expand";
  toggle.textContent = "Read full draft";
  toggle.addEventListener("click", () => {
    const open = text.classList.toggle("is-clamped");
    toggle.textContent = open ? "Read full draft" : "Show less";
  });
  wrap.append(text, toggle);
  return wrap;
}

function victorBlock(issue: Issue, events: WorkEvent[]): HTMLElement {
  const wrap = document.createElement("div");
  const event = events.find((item) => item.action === "factcheck");
  const checked = event?.summary || "Victor checked the draft against the CoinGecko source links.";
  const phrases = removedPhrases(issue, events);
  wrap.append(paragraph("What changed:"));
  if (phrases.length === 0) {
    wrap.append(paragraph("No prediction phrase was in this draft. Victor still removes price predictions before approval."));
  } else {
    const list = document.createElement("ul");
    list.className = "brief-struck";
    for (const phrase of phrases) {
      const item = document.createElement("li");
      const strike = document.createElement("s");
      strike.textContent = phrase;
      item.appendChild(strike);
      list.appendChild(item);
    }
    wrap.appendChild(list);
  }
  wrap.append(paragraph(`What was checked: ${checked}`));
  if (issue.sources.length > 0) {
    wrap.append(paragraph("Checked against these source links:"));
    const links = document.createElement("ul");
    links.className = "brief-sources";
    for (const source of issue.sources) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.rel = "noreferrer";
      link.target = "_blank";
      link.textContent = source.title;
      item.appendChild(link);
      links.appendChild(item);
    }
    wrap.appendChild(links);
  }
  return wrap;
}

function ivyBlock(issue: Issue): HTMLElement {
  const wrap = document.createElement("div");
  wrap.appendChild(paragraph(`Subject line: ${issue.subject || "No subject yet."}`));
  if (issue.preheader) wrap.appendChild(paragraph(issue.preheader));
  if (issue.affiliates.length === 0) wrap.appendChild(paragraph("No affiliate links on this issue."));
  for (const affiliate of issue.affiliates) {
    const row = document.createElement("p");
    row.className = "brief-copy";
    const chip = document.createElement("span");
    chip.className = "placeholder-chip";
    chip.textContent = "PLACEHOLDER, replace before use";
    row.appendChild(chip);
    row.append(document.createTextNode(` ${affiliate.label}. ${affiliate.disclosure}`));
    wrap.appendChild(row);
  }
  const footer = document.createElement("p");
  footer.className = "brief-footer";
  footer.textContent = issue.footer || "Not financial advice.";
  wrap.appendChild(footer);
  return wrap;
}

function approvalBlock(issue: Issue): HTMLElement {
  const wrap = document.createElement("div");
  wrap.appendChild(paragraph(statusLine(issue)));
  if (issue.status === "approved") {
    const when = issue.updatedAt > 10_000_000_000
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
          timeZoneName: "short",
        }).format(new Date(issue.updatedAt))
      : "";
    wrap.appendChild(paragraph(when ? `Not sent anywhere. Approved by you at ${when}. Payloads are only prepared.` : "Not sent anywhere. Payloads are only prepared."));
    wrap.appendChild(channelList(issue));
  }
  return wrap;
}

function sourceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function block(who: string, title: string, tone: string, content: HTMLElement): HTMLElement {
  const section = document.createElement("details");
  section.className = `brief-block brief-${tone}`;
  section.dataset.block = title;
  const summary = document.createElement("summary");
  const heading = document.createElement("h2");
  const name = document.createElement("span");
  name.textContent = who;
  heading.append(name, document.createTextNode(` ${title}`));
  summary.appendChild(heading);
  section.append(summary, content);
  return section;
}

function paragraph(text: string): HTMLParagraphElement {
  return line("brief-copy", text);
}

function line(className: string, text: string): HTMLParagraphElement {
  const copy = document.createElement("p");
  copy.className = className;
  copy.textContent = text;
  return copy;
}
