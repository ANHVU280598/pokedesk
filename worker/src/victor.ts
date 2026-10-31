import { hasPrediction, predictionPhrases } from "@pulse/shared";

export { hasPrediction };

export const PREDICTION_NOTE =
  "Removed a price prediction. Rewrote it as a neutral fact.";

const REMOVAL_NOTE =
  "Price targets and return predictions were removed. What remains is a neutral description of recent public market data.";

export function stripPredictions(text: string): { text: string; phrases: string[] } {
  const phrases = predictionPhrases(text);
  const kept: string[] = [];
  for (const chunk of text.split(/\n+/)) {
    const line: string[] = [];
    for (const part of chunk.split(/(?<=[.!?])\s+/)) {
      const trimmed = part.trim();
      if (!trimmed || hasPrediction(trimmed)) continue;
      line.push(trimmed);
    }
    if (line.length) kept.push(line.join(" "));
  }
  return { text: kept.join("\n\n").trim(), phrases };
}

export function reviewDraft(text: string): { text: string; removed: boolean; phrases: string[] } {
  const stripped = stripPredictions(text);
  const next = stripped.phrases.length
    ? (stripped.text ? `${REMOVAL_NOTE}\n\n${stripped.text}` : REMOVAL_NOTE)
    : stripped.text;
  return { text: next, removed: stripped.phrases.length > 0, phrases: stripped.phrases };
}

export function assertNeutral(fields: string[]): void {
  for (const field of fields) {
    if (hasPrediction(field)) {
      throw new Error("Victor rejected a price prediction. The run stopped and nothing was sent.");
    }
  }
}
