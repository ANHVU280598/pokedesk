export const EMPLOYEE_IDS = ["maya", "rex", "luna", "victor", "ivy"] as const;

export type EmployeeId = (typeof EMPLOYEE_IDS)[number];

export const STATION_IDS = [
  "planning",
  "data",
  "writing",
  "factcheck",
  "growth",
  "outbox",
] as const;

export type StationId = (typeof STATION_IDS)[number];

export type EventStatus = "working" | "done" | "error";

export type WorkEvent = {
  id: string;
  runId: string;
  employee: EmployeeId;
  action: string;
  summary: string;
  fullText: string;
  station: StationId;
  status: EventStatus;
  ts: number;
};

export type Employee = {
  id: EmployeeId;
  name: string;
  role: string;
  color: string;
  station: StationId;
  position: { x: number; z: number };
  traits: string[];
  quote: string;
};

export type IssueStatus = "pending_approval" | "approved" | "failed";

export type RunSource = "manual" | "cron" | "unknown";

export type IssueSection = {
  heading: string;
  text: string;
};

const PREDICTION =
  /\b\d+\s?x\b|\bto the moon\b|\bprice target\b|\bwill (hit|reach|surge|soar|moon|pump|explode)\b|\bprice will\b|\bguaranteed (gain|return|profit|rally)\b|\bgoing to (hit|reach|moon|pump)\b/i;

export function hasPrediction(text: string): boolean {
  return PREDICTION.test(text);
}

export function predictionPhrases(text: string): string[] {
  const phrases: string[] = [];
  for (const chunk of text.split(/\n+/)) {
    for (const part of chunk.split(/(?<=[.!?])\s+/)) {
      const trimmed = part.trim();
      if (trimmed && hasPrediction(trimmed)) phrases.push(trimmed);
    }
  }
  return [...new Set(phrases)];
}

export type SourceLink = {
  title: string;
  url: string;
};

export type AffiliateBlock = {
  label: string;
  href: string;
  disclosure: string;
};

export type Issue = {
  id: string;
  runId: string;
  subject: string;
  preheader: string;
  body: string;
  footer: string;
  sources: SourceLink[];
  affiliates: AffiliateBlock[];
  sections: IssueSection[];
  removed: string[];
  fetchedAt: number | null;
  runSource: RunSource;
  status: IssueStatus;
  createdAt: number;
  updatedAt: number;
};

export type DeskRun = {
  id: string;
  status: "running" | "succeeded" | "failed";
  source: RunSource;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
};

export type Station = {
  id: StationId;
  label: string;
  x: number;
  z: number;
  color: string;
};

export const STATIONS: Record<StationId, Station> = {
  planning: { id: "planning", label: "Planning board", x: 0, z: -10, color: "#3A5BD9" },
  data: { id: "data", label: "Data desk", x: -10, z: -2, color: "#C2570C" },
  writing: { id: "writing", label: "Writing desk", x: -6, z: 8, color: "#B0338A" },
  factcheck: { id: "factcheck", label: "Fact-check booth", x: 6, z: 8, color: "#2F7D6D" },
  growth: { id: "growth", label: "Growth desk", x: 10, z: -2, color: "#7A4FD1" },
  outbox: { id: "outbox", label: "Outbox", x: 0, z: 0, color: "#8A8175" },
};

export const EMPLOYEES: Employee[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Managing editor",
    color: "#3A5BD9",
    station: "planning",
    position: { x: 0, z: -10 },
    traits: ["calm", "organized", "decisive"],
    quote: "A calm plan beats a loud take.",
  },
  {
    id: "rex",
    name: "Rex",
    role: "Data reporter",
    color: "#C2570C",
    station: "data",
    position: { x: -10, z: -2 },
    traits: ["curious", "skeptical", "fast"],
    quote: "Three numbers, then a story.",
  },
  {
    id: "luna",
    name: "Luna",
    role: "Writer",
    color: "#B0338A",
    station: "writing",
    position: { x: -6, z: 8 },
    traits: ["clear", "warm", "concrete"],
    quote: "Write it so a friend would forward it.",
  },
  {
    id: "victor",
    name: "Victor",
    role: "Fact checker",
    color: "#2F7D6D",
    station: "factcheck",
    position: { x: 6, z: 8 },
    traits: ["precise", "stubborn", "fair"],
    quote: "If it predicts a price, it does not ship.",
  },
  {
    id: "ivy",
    name: "Ivy",
    role: "Growth editor",
    color: "#7A4FD1",
    station: "growth",
    position: { x: 10, z: -2 },
    traits: ["direct", "honest", "commercial"],
    quote: "Earn attention, then say it's an ad.",
  },
];

export function employeeById(id: EmployeeId): Employee {
  const found = EMPLOYEES.find((employee) => employee.id === id);
  if (!found) {
    throw new Error(`Unknown employee ${id}`);
  }
  return found;
}

export const PALETTE = {
  light: {
    floor: "#EDE9DF",
    grid: "#DDD8CA",
    fog: "#F6F5F1",
    text: "#1D1D1B",
  },
  dark: {
    floor: "#23262E",
    grid: "#2E323C",
    fog: "#15161A",
    text: "#ECEBE6",
  },
} as const;
