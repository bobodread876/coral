/**
 * Coral onboarding funnel — core types.
 *
 * The funnel is a linear progression with two interrupt states. Every
 * transition is driven by an explicit event and logged, so conversion and
 * time-in-step are always derivable from the event log alone.
 */

export type CoralState =
  | 'new' // contacted, nothing sent yet
  | 'greeted' // intro + anti-scam pledge delivered
  | 'wallet_setup' // helping install Flash / capture username
  | 'first_receive' // wallet verified; waiting on their first sats in
  | 'first_spend' // received; waiting on their first Lightning payment out
  | 'community' // spend verified; invited to the community
  | 'graduated' // joined; onboarding complete
  | 'escalated' // paused for a human (resumeState remembers where)
  | 'opted_out'; // asked to stop; terminal

export type ReceiveSource = 'faucet' | 'manual';
export type SpendSource = 'lud21' | 'manual';

export type CoralEvent =
  | { type: 'GREET_SENT' }
  | { type: 'WALLET_CLAIMED'; username: string }
  | { type: 'WALLET_VERIFIED'; lnAddress: string }
  | { type: 'VERIFY_FAILED'; step: 'wallet' | 'spend'; detail?: string }
  | { type: 'RECEIVE_CONFIRMED'; source: ReceiveSource }
  | { type: 'SPEND_INVOICE_ISSUED'; pr: string; verifyUrl?: string; sats: number }
  | { type: 'SPEND_VERIFIED'; source: SpendSource }
  | { type: 'COMMUNITY_JOINED' }
  | { type: 'ESCALATED'; reason: string }
  | { type: 'RESUMED' }
  | { type: 'OPTED_OUT' };

export interface CoralUser {
  /** Chat-scoped id — the WhatsApp JID (or any stable channel id). */
  id: string;
  name?: string;
  state: CoralState;
  /** Where to resume after an escalation is resolved. */
  resumeState?: CoralState;
  /** Flash username as claimed by the user. */
  username?: string;
  /** Verified lightning address (username@flashapp.me). */
  lnAddress?: string;
  /** Outstanding first-spend invoice, when issued. */
  spendInvoice?: string;
  spendVerifyUrl?: string;
  spendSats?: number;
  receiveSource?: ReceiveSource;
  spendSource?: SpendSource;
  escalations: number;
  /** Consecutive verification failures in the current step. */
  failedAttempts: number;
  createdAt: string;
  updatedAt: string;
  enteredStateAt: string;
}

/** One appended line in the funnel event log. */
export interface FunnelRecord {
  at: string;
  userId: string;
  event: CoralEvent;
  from: CoralState;
  to: CoralState;
}

export interface CoralConfig {
  /** Domain whose usernames become lightning addresses. */
  walletDomain: string;
  /**
   * Lightning address that first-spend invoices pay to. Must live on a
   * LUD-21-capable provider for zero-credential settlement checks (Flash
   * does not expose LUD-21 yet — see DEPLOYMENT.md).
   */
  treasuryAddress?: string;
  /** Size of the first-spend test payment. */
  spendSats: number;
  /** Hours in one step before a user counts as stalled. */
  stalledAfterHours: number;
  /** Verification failures in a step before auto-escalation. */
  maxFailedAttempts: number;
}

export const DEFAULT_CONFIG: CoralConfig = {
  walletDomain: 'flashapp.me',
  treasuryAddress: undefined,
  spendSats: 21,
  stalledAfterHours: 72,
  maxFailedAttempts: 3,
};
