const PREDICTION =
  /\b\d+\s?x\b|\bto the moon\b|\bprice target\b|\bwill (hit|reach|surge|soar|moon|pump|explode)\b|\bprice will\b|\bguaranteed (gain|return|profit|rally)\b|\bgoing to (hit|reach|moon|pump)\b/i;

export const PREDICTION_NOTE =
  "Removed a price prediction. Rewrote it as a neutral fact.";

export function hasPrediction(text: string): boolean {
  return PREDICTION.test(text);
}

export function reviewDraft(text: string): { text: string; removed: boolean } {
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  let removed = false;
  for (const part of parts) {
    if (part.trim() && hasPrediction(part)) {
      removed = true;
      continue;
    }
    if (part.trim()) kept.push(part.trim());
  }
  let next = kept.join(" ").replace(/\s+/g, " ").trim();
  if (removed) {
    const note =
      "Price targets and return predictions were removed. What remains is a neutral description of recent public market data.";
    next = next ? `${note} ${next}` : note;
  }
  return { text: next, removed };
}

export function assertNeutral(fields: string[]): void {
  for (const field of fields) {
    if (hasPrediction(field)) {
      throw new Error("Victor rejected a price prediction. The run stopped and nothing was sent.");
    }
  }
}
