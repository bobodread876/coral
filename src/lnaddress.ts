/**
 * LNURL-pay / lightning-address helpers.
 *
 * Mirrors hustle-link's src/lnaddress.ts (same author, same portfolio) —
 * extract into a shared package once a third consumer appears.
 */

export interface LnurlPayParams {
  callback: string;
  minSendable: number; // millisats
  maxSendable: number; // millisats
  commentAllowed?: number;
  metadata: string;
  tag: string;
}

export interface InvoiceResult {
  pr: string; // BOLT11 payment request
  verify?: string; // LUD-21 verify URL
}

export interface VerifyResult {
  settled: boolean;
  preimage?: string | null;
}

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class LnAddressError extends Error {}

function parseAddress(address: string): { user: string; domain: string } {
  const m = address.trim().match(/^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
  if (!m) throw new LnAddressError(`Invalid lightning address: ${address}`);
  return { user: m[1], domain: m[2] };
}

export async function resolveLnAddress(
  address: string,
  fetchFn: FetchLike = fetch,
): Promise<LnurlPayParams> {
  const { user, domain } = parseAddress(address);
  const url = `https://${domain}/.well-known/lnurlp/${user}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new LnAddressError(
      `LNURL-pay lookup failed for ${address} (HTTP ${res.status})`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (data.status === 'ERROR') {
    throw new LnAddressError(
      `LNURL-pay error for ${address}: ${data.reason ?? 'unknown'}`,
    );
  }
  if (data.tag !== 'payRequest' || typeof data.callback !== 'string') {
    throw new LnAddressError(`${address} is not a payRequest endpoint`);
  }
  return data as unknown as LnurlPayParams;
}

/** Request a BOLT11 invoice for `sats` from a lightning address. */
export async function requestInvoice(
  address: string,
  sats: number,
  opts: { comment?: string; fetchFn?: FetchLike } = {},
): Promise<InvoiceResult> {
  const fetchFn = opts.fetchFn ?? (fetch as FetchLike);
  const params = await resolveLnAddress(address, fetchFn);

  const msats = Math.round(sats * 1000);
  if (msats < params.minSendable || msats > params.maxSendable) {
    throw new LnAddressError(
      `${sats} sats outside allowed range ` +
        `${params.minSendable / 1000}–${params.maxSendable / 1000} for ${address}`,
    );
  }

  const url = new URL(params.callback);
  url.searchParams.set('amount', String(msats));
  if (opts.comment && params.commentAllowed) {
    url.searchParams.set(
      'comment',
      opts.comment.slice(0, params.commentAllowed),
    );
  }

  const res = await fetchFn(url.toString());
  if (!res.ok) {
    throw new LnAddressError(
      `Invoice request failed for ${address} (HTTP ${res.status})`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (data.status === 'ERROR' || typeof data.pr !== 'string') {
    throw new LnAddressError(
      `Invoice request error for ${address}: ${data.reason ?? 'no pr in response'}`,
    );
  }
  return {
    pr: data.pr,
    verify: typeof data.verify === 'string' ? data.verify : undefined,
  };
}

/** LUD-21: poll whether an invoice issued via LNURL-pay has settled. */
export async function verifyPayment(
  verifyUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<VerifyResult> {
  const res = await fetchFn(verifyUrl);
  if (!res.ok) {
    throw new LnAddressError(`Verify failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (data.status === 'ERROR') {
    throw new LnAddressError(`Verify error: ${data.reason ?? 'unknown'}`);
  }
  return {
    settled: data.settled === true,
    preimage: (data.preimage as string | null) ?? null,
  };
}
