import {
  requestInvoice,
  resolveLnAddress,
  verifyPayment,
  type FetchLike,
  LnAddressError,
} from './lnaddress.js';
import type { CoralConfig } from './types.js';

/**
 * Zero-credential verification, in the hustle-link tradition: no custody,
 * no API keys. Every Flash username is a lightning address, so:
 *
 * - wallet exists   → LNURL-pay lookup on username@flashapp.me resolves
 * - can receive     → the same lookup returning payRequest params proves a
 *                     live, invoice-issuing wallet
 * - first spend     → Coral issues an invoice against the community
 *                     treasury address and polls LUD-21 `verify` until the
 *                     user's payment settles (treasury must live on a
 *                     LUD-21-capable provider — Flash doesn't expose it yet)
 */

export interface WalletCheck {
  ok: boolean;
  lnAddress?: string;
  reason?: string;
}

export async function checkWalletExists(
  username: string,
  config: CoralConfig,
  fetchFn: FetchLike = fetch,
): Promise<WalletCheck> {
  const cleaned = username
    .trim()
    .replace(/^@/, '')
    .replace(new RegExp(`@${config.walletDomain.replace(/\./g, '\\.')}$`, 'i'), '');
  if (!/^[a-z0-9._-]{2,32}$/i.test(cleaned)) {
    return { ok: false, reason: `"${username}" doesn't look like a Flash username` };
  }
  const lnAddress = `${cleaned.toLowerCase()}@${config.walletDomain}`;
  try {
    await resolveLnAddress(lnAddress, fetchFn);
    return { ok: true, lnAddress };
  } catch (err) {
    if (err instanceof LnAddressError) {
      return { ok: false, lnAddress, reason: err.message };
    }
    throw err;
  }
}

export interface SpendInvoice {
  pr: string;
  verifyUrl?: string;
  sats: number;
}

/**
 * Issue the first-spend test invoice against the treasury address. The user
 * paying it from their Flash wallet is the proof of a working first spend.
 */
export async function issueSpendInvoice(
  config: CoralConfig,
  memo: string,
  fetchFn: FetchLike = fetch,
): Promise<SpendInvoice> {
  if (!config.treasuryAddress) {
    throw new LnAddressError(
      'No treasuryAddress configured — set one on a LUD-21-capable provider ' +
        '(see DEPLOYMENT.md) or use manual spend confirmation',
    );
  }
  const invoice = await requestInvoice(config.treasuryAddress, config.spendSats, {
    comment: memo,
    fetchFn,
  });
  return { pr: invoice.pr, verifyUrl: invoice.verify, sats: config.spendSats };
}

export async function checkSpendSettled(
  verifyUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<boolean> {
  const result = await verifyPayment(verifyUrl, fetchFn);
  return result.settled;
}
