export function toMirrorId(txId: string) {
  const [account, rest] = txId.split("@");
  const [seconds, nanos] = rest.split(".");
  return `${account}-${seconds}-${nanos}`;
}
