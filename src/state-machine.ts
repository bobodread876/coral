import type { CoralEvent, CoralState, CoralUser, FunnelRecord } from './types.js';

export class CoralTransitionError extends Error {
  constructor(
    public readonly state: CoralState,
    public readonly event: CoralEvent['type'],
  ) {
    super(`Event ${event} is not valid in state ${state}`);
  }
}

/**
 * Which events each state accepts, and where they lead.
 * `null` target = stays in the same state (progress recorded, no move).
 * ESCALATED and OPTED_OUT are handled uniformly below and are legal from
 * every non-terminal state.
 */
const TRANSITIONS: Record<CoralState, Partial<Record<CoralEvent['type'], CoralState | null>>> = {
  new: { GREET_SENT: 'greeted' },
  greeted: { WALLET_CLAIMED: 'wallet_setup' },
  wallet_setup: {
    WALLET_CLAIMED: null, // corrected username
    WALLET_VERIFIED: 'first_receive',
    VERIFY_FAILED: null,
  },
  first_receive: { RECEIVE_CONFIRMED: 'first_spend' },
  first_spend: {
    SPEND_INVOICE_ISSUED: null,
    VERIFY_FAILED: null,
    SPEND_VERIFIED: 'community',
  },
  community: { COMMUNITY_JOINED: 'graduated' },
  graduated: {},
  escalated: { RESUMED: null }, // target resolved from resumeState
  opted_out: {},
};

const TERMINAL: ReadonlySet<CoralState> = new Set(['graduated', 'opted_out']);

/**
 * Pure transition: returns the updated user plus the funnel record to
 * append, or throws CoralTransitionError. Never mutates the input.
 */
export function transition(
  user: CoralUser,
  event: CoralEvent,
  at: string = new Date().toISOString(),
): { user: CoralUser; record: FunnelRecord } {
  const from = user.state;

  let to: CoralState;
  if (event.type === 'OPTED_OUT') {
    if (TERMINAL.has(from)) throw new CoralTransitionError(from, event.type);
    to = 'opted_out';
  } else if (event.type === 'ESCALATED') {
    if (TERMINAL.has(from) || from === 'escalated') {
      throw new CoralTransitionError(from, event.type);
    }
    to = 'escalated';
  } else {
    const allowed = TRANSITIONS[from];
    if (!(event.type in allowed)) throw new CoralTransitionError(from, event.type);
    const target = allowed[event.type];
    if (event.type === 'RESUMED') {
      to = user.resumeState ?? 'greeted';
    } else {
      to = target === null ? from : (target as CoralState);
    }
  }

  const next: CoralUser = { ...user, state: to, updatedAt: at };
  if (to !== from) next.enteredStateAt = at;

  switch (event.type) {
    case 'WALLET_CLAIMED':
      next.username = event.username;
      break;
    case 'WALLET_VERIFIED':
      next.lnAddress = event.lnAddress;
      next.failedAttempts = 0;
      break;
    case 'VERIFY_FAILED':
      next.failedAttempts = user.failedAttempts + 1;
      break;
    case 'RECEIVE_CONFIRMED':
      next.receiveSource = event.source;
      next.failedAttempts = 0;
      break;
    case 'SPEND_INVOICE_ISSUED':
      next.spendInvoice = event.pr;
      next.spendVerifyUrl = event.verifyUrl;
      next.spendSats = event.sats;
      break;
    case 'SPEND_VERIFIED':
      next.spendSource = event.source;
      next.failedAttempts = 0;
      break;
    case 'ESCALATED':
      next.resumeState = from;
      next.escalations = user.escalations + 1;
      break;
    case 'RESUMED':
      next.resumeState = undefined;
      next.failedAttempts = 0;
      break;
  }

  return { user: next, record: { at, userId: user.id, event, from, to } };
}

export function newUser(id: string, at: string = new Date().toISOString()): CoralUser {
  return {
    id,
    state: 'new',
    escalations: 0,
    failedAttempts: 0,
    createdAt: at,
    updatedAt: at,
    enteredStateAt: at,
  };
}

/** Funnel order used by metrics; interrupts are reported separately. */
export const FUNNEL_ORDER: readonly CoralState[] = [
  'new',
  'greeted',
  'wallet_setup',
  'first_receive',
  'first_spend',
  'community',
  'graduated',
];
