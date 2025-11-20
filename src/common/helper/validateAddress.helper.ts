import { AccountId } from "@hashgraph/sdk";
import axios from "axios";

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

export async function toNativeAddress(
  evmAddress: string
): Promise<string | null> {
  if (!evmAddress) return null;

  // If it's already native format, return as-is
  if (/^0\.0\.\d+$/.test(evmAddress)) {
    return evmAddress;
  }

  // Must be 0x + 40 hex chars
  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
    return null;
  }

  const cleanHex = evmAddress.slice(2).toLowerCase();

  // ───── Long-zero format (most common) → super fast, no API call ─────
  if (cleanHex.startsWith("000000000000000000000000")) {
    const accountNum = parseInt(cleanHex.slice(-8), 16);
    return `0.0.${accountNum}`;
  }

  // ───── Real ECDSA alias (20-byte pubkey) → resolve via mirror node ─────
  try {
    const mirrorUrl = process.env.MIRROR_NODE;
    const response = await axios.get(
      `${mirrorUrl}/api/v1/accounts/${evmAddress}`,
      {
        timeout: 5000,
      }
    );

    if (response.data?.account) {
      return response.data.account; // e.g. "0.0.1234567"
    }
  } catch (err: any) {
    console.warn(
      "Mirror node lookup failed for ECDSA alias:",
      evmAddress,
      err.message
    );
  }

  return null;
}
