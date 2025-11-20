import { AccountId } from "@hashgraph/sdk";

export function validateBtcAddress(addr: string): boolean {
  if (!addr) return false;

  const prefix = addr.slice(0, 4);
  const validPrefixes = ["bc1q", "bc1p"];
  const validChars = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;

  return (
    validPrefixes.includes(prefix) &&
    addr.length >= 42 &&
    addr.length <= 62 &&
    validChars.test(addr.slice(3))
  );
}

export async function validateHbarEvm(addr: string): Promise<boolean> {
  if (!addr) return false;
  if (!addr.startsWith("0x")) return false;
  if (!/^0x[a-fA-F0-9]+$/.test(addr)) return false;
  if (addr.length !== 42) return false;
  return true;
}

export async function toEvmAddressIfNeeded(addr: string): Promise<string> {
  if (!addr) return addr;

  if (await validateHbarEvm(addr)) return addr;

  if (!/^0\.0\.\d+$/.test(addr)) return addr;

  const numericId = AccountId.fromString(addr).num.toString();

  const url = `${process.env.MIRROR_NODE}/accounts/${numericId}`;

  const res = await fetch(url);
  if (!res.ok) return addr;

  const data = await res.json();

  return data.evm_address ? `${data.evm_address}` : addr;
}
