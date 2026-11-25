export type ClaimSelection = { kind: "public" | "directed"; hearts: number };
export type PendingClaim = ClaimSelection & { requestId: string };
export type PendingEntry = { input: PendingClaim; persistent: boolean };

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderIdPattern = /^[0-9a-f]{24}$/i;
const memoryClaims = new Map<string, PendingClaim>();

function readPendingClaim(raw: string | null): PendingClaim | undefined {
  if (raw === null) return;
  try {
    const claim = JSON.parse(raw) as Partial<PendingClaim> | null;
    if (!claim) return;
    const { kind, hearts, requestId } = claim;
    if ((kind === "public" || kind === "directed") && typeof hearts === "number" &&
        Number.isSafeInteger(hearts) && hearts > 0 && typeof requestId === "string" && requestIdPattern.test(requestId)) {
      return { kind, hearts, requestId };
    }
  } catch {
    // Ignore malformed storage entries.
  }
}

export function savePendingClaim(prefix: string, orderId: string, input: PendingClaim) {
  const key = `${prefix}${orderId}:${input.requestId}`;
  try {
    localStorage.setItem(key, JSON.stringify(input));
  } catch {
    memoryClaims.set(key, input);
  }
}

export function clearPendingClaim(prefix: string, orderId: string, requestId: string) {
  const key = `${prefix}${orderId}:${requestId}`;
  memoryClaims.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // If the stored record survives, its request can still be replayed.
  }
}

export function readPendingClaims(prefix: string) {
  const pending = new Map<string, PendingEntry[]>();
  function add(key: string, input: PendingClaim, persistent: boolean) {
    const [orderId, requestId] = key.slice(prefix.length).split(":");
    if (!orderIdPattern.test(orderId) || requestId !== input.requestId) return;
    const entry = { input, persistent };
    const entries = pending.get(orderId);
    if (entries) entries.push(entry);
    else pending.set(orderId, [entry]);
  }

  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const claim = readPendingClaim(localStorage.getItem(key));
      if (claim) add(key, claim, true);
    }
  } catch {
    // Loading the board is still useful when browser storage is unavailable.
  }
  for (const [key, claim] of memoryClaims) {
    if (key.startsWith(prefix)) add(key, claim, false);
  }
  return pending;
}
