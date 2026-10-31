# Pulse Desk Media: Build Plan

A full-screen 3D office where five AI employees run a daily crypto newsletter. You watch the workflow happen, approve the result, and publish.

---

## 1. Product in one paragraph

Open the app and you see a calm, low-poly office floor from above. Five characters walk between stations. When the daily run starts, Maya (PM) assigns work, Rex fetches data, Luna writes, Victor checks facts, Ivy adds monetization. A glowing document travels between them. At the end, a bottom sheet shows the finished issue and an **Approve** button.

## 2. Users and goals

- **You (owner):** see what the team did, approve or edit, publish. Under 2 minutes per day.
- **Visitors (optional later):** watch the public demo, read the latest issue, subscribe.

---

## 3. Design spec

### 3.1 Look and feel
- Style: soft low-poly "toy office", clean and friendly, not realistic.
- Light mode palette: floor `#EDE9DF`, grid lines `#DDD8CA`, background fog `#F6F5F1`, text `#1D1D1B`.
- Dark mode palette: floor `#23262E`, grid `#2E323C`, fog `#15161A`, text `#ECEBE6`.
- Lighting: one soft directional light (shadows on), one hemisphere light. No harsh contrast.
- Everything uses flat-shaded materials (`MeshStandardMaterial`, `flatShading: true`).

### 3.2 The ground (the main stage)
- A square floor, about 30 x 30 units, with a faint grid and rounded edges.
- Five **zones** painted on the floor as soft colored rectangles, so the layout is readable at a glance:

| Zone | Position (x, z) | Color | Props |
|---|---|---|---|
| Planning board (Maya) | (0, -10) | blue `#3A5BD9` | big whiteboard with moving sticky notes |
| Data desk (Rex) | (-10, -2) | orange `#C2570C` | two monitors, small bar charts that animate |
| Writing desk (Luna) | (-6, 8) | magenta `#B0338A` | desk, lamp, floating text lines |
| Fact-check booth (Victor) | (6, 8) | green `#2F7D6D` | magnifier prop, stamp that thumps on approval |
| Growth desk (Ivy) | (10, -2) | purple `#7A4FD1` | megaphone, small rising chart |

- Center of the floor: an **outbox tray** where the finished issue lands.

### 3.3 Characters
- Built in code from primitives (no model files at first): capsule body, sphere head, two small eyes, simple arms.
- Each has their signature color (same as their zone) and a name tag floating above in a rounded pill.
- Different shapes for personality: Maya is tall and upright, Rex slightly hunched with big glasses, Luna has a ponytail, Victor wears a flat cap, Ivy has a headset.
- Animations:
  - Idle: gentle bob (sin wave, 2 px).
  - Walking: body tilts forward, legs swap, small dust puff.
  - Working: arms move in a typing motion and a small icon pops up (chart, pen, magnifier, megaphone).
  - Done: tiny hop and a green check bubble.
  - Error: head shake and a red "!" bubble.

### 3.4 Speech bubbles
- Short (under 90 characters), shown above the speaker for 3 seconds, tap to expand to full text.
- Each bubble uses the employee's color as a left border so you know who is talking.
- Example: Victor: "Removed a price prediction. Rewrote it as a neutral fact."

### 3.5 Handoffs
- A small glowing document cube floats from sender to receiver along a curved path (about 1 second).
- Color of the document shifts from the sender's color to the receiver's color as it travels.

### 3.6 Camera
- Default: angled top-down (about 55 degrees), the whole floor visible.
- Drag to rotate, pinch to zoom (limits: min 8, max 40 units).
- Tap a character: camera glides to a close follow view and opens their **profile card**. Tap the floor to return.
- "Auto-follow" mode: camera smoothly frames whoever is working. Toggle in the HUD.

### 3.7 UI overlay (minimal, the 3D scene is the star)
The screen is 100% canvas. Only these UI pieces float on top:

1. **Top bar** (transparent, 48 px): app name on the left, a status pill on the right ("Idle", "Running 3/7", "Waiting for approval").
2. **Bottom dock** (rounded, 64 px high, thumb-reachable) with 4 buttons:
   - **Run** (primary, large, center): starts the workflow.
   - **Log**: opens the work log sheet.
   - **Issue**: opens the latest newsletter.
   - **Team**: opens the roster.
3. **Bottom sheets** (swipe up/down to open and close, three heights: peek, half, full):
   - Work log: timeline of events with colored dots per employee.
   - Issue: the newsletter text, an **Edit** button, a green **Approve and send** button.
   - Team: five cards with name, role, traits, signature quote.
   - Profile: opens when a character is tapped (personality, current task, last 5 outputs).
4. **Toasts** at the top for errors or finished runs, auto-dismiss after 4 seconds.

### 3.8 Ease of use rules
- One obvious action: **Run**. Everything else is optional.
- Every tap target is at least 44 px.
- First visit shows a 3-step tooltip tour: "This is your team", "Press Run", "Approve the result".
- A **Speed** toggle (1x, 2x, Skip animation) so a daily run never feels slow.
- Respect `prefers-reduced-motion`: use fades and instant moves instead of walking.
- Dark mode follows the system.
- Text bubbles and sheets use 16 px minimum font size and high contrast.
- Screen reader fallback: the work log is real HTML text, so everything shown in 3D is also readable.

### 3.9 Performance targets
- 60 fps on a mid-range phone, under 500 draw calls.
- Cap pixel ratio at 2, use instanced meshes for grid lines and props.
- Render on demand when nothing is animating (saves battery).
- Total JS under 600 KB gzipped.

---

## 4. Architecture

```
/web      Vite + TypeScript + Three.js   -> Cloudflare Pages
/worker   Cloudflare Worker (Hono)       -> API, cron, Claude calls
/shared   Shared types
```

**Data flow**
1. Run button (or the daily cron) calls `POST /api/run`.
2. The Worker runs Maya, then Rex, Luna, Victor, Luna (revision), Ivy, Maya.
3. After each step it writes a `WorkEvent` to D1:
   `{ id, runId, employee, action, summary, fullText, station, status, ts }`
4. The frontend polls `GET /api/events?runId=...&after=<id>` every 1.5 seconds and plays each event as animation.
5. When finished, the issue is saved with status `pending_approval`.
6. `POST /api/issues/:id/approve` marks it approved. Publishing is a separate step.

**Cloudflare resources:** Pages, Worker, D1 (events, issues), KV (rate limits, run lock), Cron Trigger (daily 06:00).

**Security**
- `ANTHROPIC_API_KEY` is a Worker secret only.
- Protect write routes with a simple owner password (`OWNER_TOKEN` secret) sent as a header.
- Rate limit `/api/run` to 1 active run at a time and a daily token budget.

---

## 5. Phases and Cursor prompts

Do one phase per Cursor chat. Start each chat with: "Read PLAN.md and .cursorrules, then do Phase N only."

### Phase 0: Scaffold (30 min)
**Prompt:**
> Create the monorepo with /web (Vite + TypeScript + Three.js), /worker (Cloudflare Worker with Hono and D1 binding), and /shared (types). Add scripts to run both locally. Add WorkEvent, Employee, and Issue types in /shared. Show me how to run it.

**Done when:** a blank 3D canvas loads and `/api/health` returns ok.

### Phase 1: 3D ground and zones (day 1-2)
**Prompt:**
> Build the office floor, grid, fog, and lighting from section 3.1 and 3.2. Place the five colored zones and simple props with primitives. Add the angled camera with orbit and pinch zoom limits. Support light and dark mode. Make it smooth on a phone.

**Done when:** you can rotate and zoom a good-looking empty office on your phone.

### Phase 2: Characters and animation (day 2-4)
**Prompt:**
> Build the five characters from section 3.3 using primitives. Add name tags, idle, walk, working, done, and error animations. Add a `moveTo(zone)` function using waypoint walking that avoids other characters. Add a debug panel with buttons to test each animation.

**Done when:** every character can walk to any zone and play every animation from the debug panel.

### Phase 3: UI overlay (day 4-5)
**Prompt:**
> Build the top bar, bottom dock, and bottom sheets from section 3.7 in plain HTML and CSS on top of the canvas. Use mock data. Include the Work log, Issue, Team, and Profile sheets, swipe gestures, dark mode, and the first-visit tour.

**Done when:** the whole UI works with fake data and feels good with one thumb.

### Phase 4: Backend employees (day 5-8)
**Prompt (Rex first):**
> In /worker, build the Rex module: fetch trending coins and top movers from the CoinGecko API, ask claude-haiku-5-5 (with Rex's personality system prompt from employees.ts) to pick the 3 most newsworthy items, and return JSON validated with zod including source links. Add a test route and show me the output.

Then one prompt each for Luna (draft), Victor (fact-check, rejects predictions), Ivy (subject line, disclosed affiliates, footer), and Maya (orchestrator that writes WorkEvents to D1 after each step).

**Done when:** `POST /api/run` produces a complete issue and a full event log.

### Phase 5: Connect work to motion (day 8-10)
**Prompt:**
> Connect the frontend to the events API with polling. Map each event to animations: move the employee to its zone, play the working animation, show the speech bubble, and animate the document handoff. Add the Speed toggle and the auto-follow camera. Handle errors and a dropped connection gracefully.

**Done when:** pressing Run plays a full, believable workflow end to end.

### Phase 6: Approval, safety, deploy (week 2)
**Prompt:**
> Add the approval flow, editing, rate limiting, daily token budget, and the owner token. Add the daily cron. Write deployment steps for Cloudflare Pages and Workers, including `wrangler secret put` commands. Deploy and give me the live URL.

**Done when:** it runs by itself every morning and waits for your approval.

### Phase 7: Publish and earn (week 3+)
- Send the approved issue to beehiiv (API or emailed draft).
- Add disclosed affiliate links and the ad network.
- Share issues on X, Reddit, and Telegram.
- Add a public read-only demo page for visitors.

---

## 6. Testing checklist
- [ ] Works at 390x844 and on desktop
- [ ] Light and dark mode
- [ ] Reduced-motion mode
- [ ] API key not visible in browser dev tools or the repo
- [ ] Run fails safely if CoinGecko or Claude is down
- [ ] Victor catches a deliberately bad draft ("this coin will 10x")
- [ ] Daily token budget stops runaway costs

## 7. Risks
- **Claude costs:** use Haiku where possible, cap tokens per step.
- **Bad facts:** Victor plus your approval step. Never auto-send.
- **Google and ad-network quality rules:** add your own commentary, don't publish raw AI output.
- **Crypto content rules:** no price predictions, always "Not financial advice", disclose affiliates.
