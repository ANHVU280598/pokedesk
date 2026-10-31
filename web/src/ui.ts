import { EMPLOYEES, employeeById, type DeskRun, type EmployeeId, type Issue, type WorkEvent } from "@pulse/shared";
import { renderBrief } from "./brief";
import { channelDrafts, sectionList } from "./issueView";
import { MOCK_EVENTS, MOCK_ISSUE } from "./mock";

export type Speed = 1 | 2 | 0;
export type SheetName = "log" | "issue" | "team" | "profile";

export type Ui = {
  setStatus(text: string): void;
  toast(message: string): void;
  open(name: SheetName): void;
  close(): void;
  showProfile(id: EmployeeId): void;
  events(): WorkEvent[];
  issue(): Issue | null;
  setEvents(events: WorkEvent[]): void;
  setIssue(issue: Issue | null): void;
  onRun(handler: () => void): void;
  onApprove(handler: (issue: Issue) => void | Promise<void>): void;
  onSave(handler: (issue: Issue) => void | Promise<void>): void;
  onSpeed(handler: (speed: Speed) => void): void;
  onFollow(handler: (on: boolean) => void): void;
  setBusy(on: boolean): void;
  setStep(step: number, total: number): void;
  markFailed(): void;
  setDesk(desk: { issue: Issue | null; run: DeskRun | null; setAside: boolean }): void;
  setDemo(on: boolean): void;
  speed(): Speed;
  autoFollow(): boolean;
};

const TOUR_KEY = "pulse-desk-tour-v1";

export function mountUi(): Ui {
  const useMock = new URLSearchParams(window.location.search).has("mock");
  let events = useMock ? MOCK_EVENTS.map((event) => ({ ...event })) : [];
  let issue: Issue | null = useMock ? structuredClone(MOCK_ISSUE) : null;
  let speed: Speed = 1;
  let follow = false;
  let speedHandler: (next: Speed) => void = () => {};
  let followHandler: (on: boolean) => void = () => {};
  let runHandler = () => {
    events = MOCK_EVENTS.map((event) => ({ ...event }));
    issue = structuredClone(MOCK_ISSUE);
    renderAll();
    setStatus("Waiting for approval");
    toast("Draft is ready. Nothing was sent.");
  };
  let approveHandler: ((issue: Issue) => void | Promise<void>) | null = null;
  let saveHandler: ((issue: Issue) => void | Promise<void>) | null = null;
  let sheet: SheetName = "log";
  let editing = false;
  let profileId: EmployeeId = "maya";
  let run: DeskRun | null = null;
  let setAside = false;
  let busy = false;
  let lastFailed = false;

  const root = document.createElement("div");
  root.id = "overlay";
  root.innerHTML = `
    <header id="topbar">
      <strong id="brand">Pulse Desk</strong>
      <div class="cluster">
        <div class="seg" role="group" aria-label="Speed">
          <button type="button" data-speed="1" aria-pressed="true">1x</button>
          <button type="button" data-speed="2" aria-pressed="false">2x</button>
          <button type="button" data-speed="0" aria-pressed="false">Skip</button>
        </div>
        <button type="button" id="follow" aria-pressed="false">Follow</button>
        <span id="status" class="pill">Idle</span>
      </div>
    </header>
    <div id="toasts"></div>
    <div id="bubbles"></div>
    <nav id="dock">
      <button type="button" id="open-log">Log</button>
      <button type="button" id="run">Run</button>
      <button type="button" id="open-issue">Issue</button>
      <button type="button" id="open-team">Team</button>
    </nav>
    <section id="sheet" aria-hidden="true">
      <div id="handle" role="slider" aria-label="Resize sheet" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0" tabindex="0"><span></span></div>
      <div id="sheet-body"></div>
    </section>
    <div id="tour" hidden>
      <p id="tour-text"></p>
      <div class="row">
        <button type="button" id="tour-skip">Skip</button>
        <button type="button" id="tour-next">Next</button>
      </div>
    </div>
    <div id="live" class="sr" aria-live="polite"></div>
  `;
  document.body.appendChild(root);

  const status = root.querySelector<HTMLElement>("#status")!;
  const sheetEl = root.querySelector<HTMLElement>("#sheet")!;
  const body = root.querySelector<HTMLElement>("#sheet-body")!;
  const handle = root.querySelector<HTMLElement>("#handle")!;
  const toasts = root.querySelector<HTMLElement>("#toasts")!;
  const live = root.querySelector<HTMLElement>("#live")!;
  const heights = ["closed", "peek", "half", "full"] as const;
  let heightIndex = 0;

  function setStatus(text: string): void {
    status.textContent = text;
    live.textContent = text;
  }

  function toast(message: string): void {
    const item = document.createElement("p");
    item.className = "toast";
    item.textContent = message;
    toasts.appendChild(item);
    window.setTimeout(() => item.remove(), 4000);
  }

  function applyHeight(index: number): void {
    heightIndex = Math.max(0, Math.min(3, index));
    sheetEl.dataset.height = heights[heightIndex];
    sheetEl.setAttribute("aria-hidden", heightIndex === 0 ? "true" : "false");
    handle.setAttribute("aria-valuenow", String(heightIndex));
  }

  function open(name: SheetName): void {
    sheet = name;
    editing = false;
    renderAll();
    applyHeight(name === "profile" ? 2 : 2);
  }

  function close(): void {
    applyHeight(0);
  }

function paintBrief(): void {
    renderBrief(issue, events, { run, setAside });
  }

  function channelBlock(current: Issue): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "brief-channels";
    for (const channel of channelDrafts(current)) {
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

  function applyRunButton(): void {
    const button = root.querySelector<HTMLButtonElement>("#run");
    if (!button) return;
    if (busy) {
      button.disabled = true;
      return;
    }
    button.disabled = false;
    button.textContent = document.body.dataset.demo === "1" ? "Watch" : lastFailed ? "Retry" : "Run";
  }

  function renderAll(): void {
    body.replaceChildren();
    if (sheet === "log") body.appendChild(renderLog());
    if (sheet === "issue") body.appendChild(renderIssue());
    if (sheet === "team") body.appendChild(renderTeam());
    if (sheet === "profile") body.appendChild(renderProfile(profileId));
  }

  function renderLog(): HTMLElement {
    const wrap = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "Work log";
    wrap.appendChild(title);
    const list = document.createElement("ol");
    list.className = "log";
    for (const event of events) {
      const employee = employeeById(event.employee);
      const item = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = employee.color;
      const copy = document.createElement("div");
      const who = document.createElement("strong");
      who.textContent = employee.name;
      const summary = document.createElement("p");
      summary.textContent = event.summary;
      const more = document.createElement("button");
      more.type = "button";
      more.textContent = "Full text";
      const full = document.createElement("p");
      full.className = "full";
      full.hidden = true;
      full.textContent = event.fullText;
      more.addEventListener("click", () => {
        full.hidden = !full.hidden;
        more.textContent = full.hidden ? "Full text" : "Hide text";
      });
      copy.append(who, summary, more, full);
      item.append(dot, copy);
      list.appendChild(item);
    }
    wrap.appendChild(list);
    return wrap;
  }

  function renderIssue(): HTMLElement {
    const wrap = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "Issue";
    wrap.appendChild(title);
    if (!issue) {
      const empty = document.createElement("p");
      empty.textContent = "No issue yet. Press Run.";
      wrap.appendChild(empty);
      return wrap;
    }
    const subject = document.createElement("p");
    subject.className = "subject";
    subject.textContent = issue.subject;
    const pre = document.createElement("p");
    pre.textContent = issue.preheader;
    wrap.append(subject, pre);
    if (editing) {
      const field = document.createElement("textarea");
      field.id = "issue-edit";
      field.value = `${issue.subject}\n\n${issue.body}`;
      wrap.appendChild(field);
    } else {
      for (const section of sectionList(issue)) {
        const heading = document.createElement("h3");
        heading.textContent = section.heading;
        const paragraph = document.createElement("p");
        paragraph.textContent = section.text;
        wrap.append(heading, paragraph);
      }
    }
    const foot = document.createElement("p");
    foot.className = "footer-copy";
    foot.textContent = issue.footer;
    wrap.appendChild(foot);
    for (const affiliate of issue.affiliates) {
      const block = document.createElement("p");
      const chip = document.createElement("span");
      chip.className = "placeholder-chip";
      chip.textContent = "PLACEHOLDER, replace before use";
      const note = document.createElement("span");
      note.textContent = ` ${affiliate.label}. ${affiliate.disclosure}`;
      block.append(chip, note);
      wrap.appendChild(block);
    }
    const row = document.createElement("div");
    row.className = "row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.id = "edit-issue";
    edit.textContent = editing ? "Save" : "Edit";
    edit.addEventListener("click", () => {
      void saveOrEdit();
    });
    const approve = document.createElement("button");
    approve.type = "button";
    approve.id = "approve";
    approve.textContent = "Approve draft (does not send)";
    const needsAck = issue.affiliates.length > 0 && issue.status === "pending_approval";
    if (needsAck) {
      const label = document.createElement("label");
      label.className = "ack";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.id = "ack-placeholder";
      label.append(box, document.createTextNode(" These affiliate links are placeholders. Approving does not send."));
      wrap.appendChild(label);
      approve.disabled = true;
      box.addEventListener("change", () => {
        approve.disabled = !box.checked;
      });
    } else {
      approve.disabled = issue.status !== "pending_approval";
    }
    approve.addEventListener("click", () => {
      void approveIssue();
    });
    row.append(edit, approve);
    wrap.appendChild(row);
    const state = document.createElement("p");
    state.textContent = issue.status === "approved"
      ? "Not sent anywhere. Payloads are only prepared."
      : "Not sent anywhere. Waiting for you.";
    wrap.appendChild(state);
    if (issue.status === "approved") wrap.appendChild(channelBlock(issue));
    return wrap;
  }

  async function saveOrEdit(): Promise<void> {
    if (!issue) return;
    if (!editing) {
      editing = true;
      renderAll();
      return;
    }
    const field = body.querySelector<HTMLTextAreaElement>("#issue-edit");
    const raw = field?.value ?? issue.body;
    const [subject, ...rest] = raw.split("\n\n");
    issue = {
      ...issue,
      subject: subject.trim() || issue.subject,
      body: rest.join("\n\n").trim() || issue.body,
      updatedAt: Date.now(),
    };
    editing = false;
    if (saveHandler) {
      await saveHandler(issue);
      renderAll();
      return;
    }
    renderAll();
    toast("Saved on this desk.");
  }

  async function approveIssue(): Promise<void> {
    if (!issue || issue.status !== "pending_approval") {
      toast("Nothing is waiting for approval.");
      return;
    }
    if (approveHandler) {
      await approveHandler(issue);
      return;
    }
    issue = { ...issue, status: "approved", updatedAt: Date.now() };
    renderAll();
    setStatus("Idle");
    toast("Approved. Nothing was sent.");
  }

  function renderTeam(): HTMLElement {
    const wrap = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "Team";
    wrap.appendChild(title);
    for (const employee of EMPLOYEES) {
      wrap.appendChild(card(employee.id));
    }
    return wrap;
  }

  function renderProfile(id: EmployeeId): HTMLElement {
    const wrap = document.createElement("div");
    wrap.appendChild(card(id));
    const task = document.createElement("p");
    const latest = [...events].reverse().find((event) => event.employee === id);
    task.textContent = latest ? `Current task: ${latest.summary}` : "Current task: waiting for a run.";
    wrap.appendChild(task);
    const heading = document.createElement("h3");
    heading.textContent = "Last outputs";
    wrap.appendChild(heading);
    const recent = events.filter((event) => event.employee === id).slice(-5);
    if (recent.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No outputs yet.";
      wrap.appendChild(empty);
    }
    for (const event of recent) {
      const line = document.createElement("p");
      line.textContent = event.fullText;
      wrap.appendChild(line);
    }
    return wrap;
  }

  function card(id: EmployeeId): HTMLElement {
    const employee = employeeById(id);
    const article = document.createElement("article");
    article.className = "card";
    article.style.borderLeftColor = employee.color;
    const name = document.createElement("h3");
    name.textContent = employee.name;
    const role = document.createElement("p");
    role.textContent = employee.role;
    const traits = document.createElement("p");
    traits.textContent = employee.traits.join(" · ");
    const quote = document.createElement("p");
    quote.textContent = employee.quote;
    article.append(name, role, traits, quote);
    return article;
  }

  root.querySelector("#open-log")!.addEventListener("click", () => open("log"));
  root.querySelector("#open-issue")!.addEventListener("click", () => open("issue"));
  root.querySelector("#open-team")!.addEventListener("click", () => open("team"));
  root.querySelector("#run")!.addEventListener("click", () => runHandler());
  root.querySelector("#follow")!.addEventListener("click", () => {
    follow = !follow;
    const button = root.querySelector<HTMLButtonElement>("#follow")!;
    button.setAttribute("aria-pressed", String(follow));
    followHandler(follow);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      speed = Number(button.dataset.speed) as Speed;
      root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === button));
      });
      speedHandler(speed);
    });
  });

  let dragStart = 0;
  let dragIndex = 0;
  let dragY = 0;
  let dragging = false;
  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    dragStart = event.clientY;
    dragY = event.clientY;
    dragIndex = heightIndex;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dragY = event.clientY;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    const steps = Math.round((dragStart - dragY) / 90);
    applyHeight(dragIndex + steps);
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", () => {
    dragging = false;
  });

  const tour = root.querySelector<HTMLElement>("#tour")!;
  const tourText = root.querySelector<HTMLElement>("#tour-text")!;
  const steps = [
    { text: "This is your team. Five people share the floor.", target: "" },
    { text: "Press Run. That is the only required step.", target: "#run" },
    { text: "Approve the result when the issue looks right.", target: "#open-issue" },
  ];
  let step = 0;
  function showTour(): void {
    const current = steps[step];
    tour.hidden = false;
    tourText.textContent = current.text;
    root.querySelectorAll(".hint").forEach((el) => el.classList.remove("hint"));
    if (current.target) root.querySelector(current.target)?.classList.add("hint");
    const next = root.querySelector<HTMLButtonElement>("#tour-next")!;
    next.textContent = step === steps.length - 1 ? "Done" : "Next";
  }
  function finishTour(): void {
    tour.hidden = true;
    root.querySelectorAll(".hint").forEach((el) => el.classList.remove("hint"));
    localStorage.setItem(TOUR_KEY, "1");
  }
  root.querySelector("#tour-next")!.addEventListener("click", () => {
    step += 1;
    if (step >= steps.length) finishTour();
    else showTour();
  });
  root.querySelector("#tour-skip")!.addEventListener("click", finishTour);
  if (!localStorage.getItem(TOUR_KEY)) showTour();

  applyHeight(0);
  renderAll();
  paintBrief();
  setStatus(useMock ? "Waiting for approval" : "Idle");

  return {
    setStatus,
    toast,
    open,
    close,
    showProfile(id) {
      profileId = id;
      open("profile");
    },
    events: () => events,
    issue: () => issue,
    setEvents(next) {
      events = next;
      paintBrief();
      if (sheet === "log" || sheet === "profile") renderAll();
    },
    setIssue(next) {
      issue = next;
      paintBrief();
      if (sheet === "issue") renderAll();
    },
    onRun(handler) {
      runHandler = handler;
    },
    onApprove(handler) {
      approveHandler = handler;
    },
    onSave(handler) {
      saveHandler = handler;
    },
    onSpeed(handler) {
      speedHandler = handler;
    },
    onFollow(handler) {
      followHandler = handler;
    },
    setBusy(on) {
      busy = on;
      if (on) lastFailed = false;
      const button = root.querySelector<HTMLButtonElement>("#run");
      if (button && on) {
        button.disabled = true;
        if (!button.textContent?.startsWith("Running")) button.textContent = "Running";
      }
      if (!on) applyRunButton();
    },
    setStep(step, total) {
      busy = true;
      lastFailed = false;
      const button = root.querySelector<HTMLButtonElement>("#run");
      if (!button) return;
      button.disabled = true;
      button.textContent = `Running step ${step} of ${total}`;
    },
    markFailed() {
      busy = false;
      lastFailed = true;
      applyRunButton();
    },
    setDesk(desk) {
      issue = desk.issue;
      run = desk.run;
      setAside = desk.setAside;
      lastFailed = desk.run?.status === "failed";
      paintBrief();
      applyRunButton();
      if (sheet === "issue") renderAll();
    },
    setDemo(on) {
      document.body.dataset.demo = on ? "1" : "0";
      const brand = root.querySelector("#brand");
      if (brand && on) brand.textContent = "Pulse Desk demo";
      applyRunButton();
    },
    speed: () => speed,
    autoFollow: () => follow,
  };
}
