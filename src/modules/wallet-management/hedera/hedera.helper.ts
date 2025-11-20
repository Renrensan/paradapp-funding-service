export function toMirrorId(txId: string): string {
  // Remove any extra whitespace
  txId = txId.trim();

  // If it already contains '-', it's already in mirror format
  if (txId.includes("-")) {
    return txId;
  }

  // If it contains '@', convert from compact to mirror format
  if (txId.includes("@")) {
    const [account, timestamp] = txId.split("@");
    const [seconds, nanos] = timestamp.split(".");

    // Pad nanoseconds to 9 digits if needed (some tools omit trailing zeros)
    const paddedNanos = nanos.padEnd(9, "0");

    return `${account}-${seconds}-${paddedNanos}`;
  }

  // Fallback: return as-is if format is unrecognized (or throw)
  console.warn(`Unrecognized txId format: ${txId}`);
  return txId;
}
