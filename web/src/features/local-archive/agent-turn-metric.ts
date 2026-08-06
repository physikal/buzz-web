type JsonRecord = Record<string, unknown>;

const STRING_FIELDS = ["model", "channelId", "sessionId", "turnId"] as const;
const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validOptionalString(record: JsonRecord, field: string) {
  const value = record[field];
  return value === undefined || value === null || typeof value === "string";
}

function validTokenCounts(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  for (const field of TOKEN_FIELDS) {
    const count = value[field];
    if (
      count !== undefined &&
      count !== null &&
      (!Number.isSafeInteger(count) || (count as number) < 0)
    ) {
      return false;
    }
  }
  const cost = value.costUsd;
  return (
    cost === undefined ||
    cost === null ||
    (typeof cost === "number" && Number.isFinite(cost) && cost >= 0)
  );
}

export function parseAgentTurnMetric(plaintext: string) {
  if (new TextEncoder().encode(plaintext).byteLength > 65_535) {
    throw new Error("Agent turn metric plaintext exceeds the protocol limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("Agent turn metric is not valid JSON.");
  }
  if (!isRecord(value)) throw new Error("Agent turn metric must be an object.");
  if (typeof value.harness !== "string" || value.harness.length === 0) {
    throw new Error("Agent turn metric is missing its harness.");
  }
  if (
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp))
  ) {
    throw new Error("Agent turn metric has an invalid timestamp.");
  }
  if (STRING_FIELDS.some((field) => !validOptionalString(value, field))) {
    throw new Error("Agent turn metric has an invalid identifier field.");
  }
  if (!validTokenCounts(value.turn) || !validTokenCounts(value.cumulative)) {
    throw new Error("Agent turn metric has invalid token counts.");
  }
  if (
    value.turnSeq !== undefined &&
    value.turnSeq !== null &&
    (!Number.isSafeInteger(value.turnSeq) || (value.turnSeq as number) < 0)
  ) {
    throw new Error("Agent turn metric has an invalid turn sequence.");
  }
  if (
    value.deltaReliable !== undefined &&
    typeof value.deltaReliable !== "boolean"
  ) {
    throw new Error("Agent turn metric has an invalid delta flag.");
  }
  if (
    value.stopReason !== undefined &&
    value.stopReason !== null &&
    typeof value.stopReason !== "string"
  ) {
    throw new Error("Agent turn metric has an invalid stop reason.");
  }
  if (
    value.cumulative !== undefined &&
    value.cumulative !== null &&
    (typeof value.sessionId !== "string" ||
      value.sessionId.length === 0 ||
      !Number.isSafeInteger(value.turnSeq) ||
      (value.turnSeq as number) < 0)
  ) {
    throw new Error(
      "Cumulative agent metrics require a session and turn sequence.",
    );
  }
  return JSON.stringify(value);
}
