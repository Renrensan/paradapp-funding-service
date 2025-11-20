import { randomUUID } from "crypto";

export function traceId(provided?: string) {
  if (provided) return provided;
  return randomUUID().slice(0, 8);
}
