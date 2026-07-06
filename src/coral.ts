import { assessMessage, isStalled, shouldEscalateOnFailure } from './escalate.js';
import type { FetchLike } from './lnaddress.js';
import { FUNNEL_ORDER } from './state-machine.js';
import { JsonlStore } from './store.js';
import { checkSpendSettled, checkWalletExists, issueSpendInvoice } from './verify.js';
import type { CoralConfig, CoralState, CoralUser } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Coral orchestrator — the API the agent (or CLI) drives. Deterministic
 * code owns funnel progression and verification; the LLM owns conversation
 * within a step, guided by getGuidance().
 */
export class Coral {
  readonly config: CoralConfig;
  readonly store: JsonlStore;
  private readonly fetchFn: FetchLike;

  constructor(opts: {
    dataPath: string;
    config?: Partial<CoralConfig>;
    fetchFn?: FetchLike;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.store = new JsonlStore(opts.dataPath);
    this.fetchFn = opts.fetchFn ?? (fetch as FetchLike);
  }

  /** First contact — returns the user (created if new). */
  contact(userId: string): CoralUser {
    return this.store.contact(userId);
  }

  status(userId: string): CoralUser | undefined {
    return this.store.user(userId);
  }

  greeted(userId: string): CoralUser {
    this.store.contact(userId);
    return this.store.apply(userId, { type: 'GREET_SENT' });
  }

  claimWallet(userId: string, username: string): CoralUser {
    return this.store.apply(userId, { type: 'WALLET_CLAIMED', username });
  }

  /** LNURL lookup on the claimed username; advances or records the failure. */
  async verifyWallet(userId: string): Promise<{ user: CoralUser; ok: boolean; reason?: string }> {
    const user = this.mustUser(userId);
    if (!user.username) throw new Error(`${userId} has no claimed username`);
    const check = await checkWalletExists(user.username, this.config, this.fetchFn);
    if (check.ok && check.lnAddress) {
      return {
        user: this.store.apply(userId, { type: 'WALLET_VERIFIED', lnAddress: check.lnAddress }),
        ok: true,
      };
    }
    const updated = this.store.apply(userId, {
      type: 'VERIFY_FAILED',
      step: 'wallet',
      detail: check.reason,
    });
    return { user: this.maybeAutoEscalate(updated), ok: false, reason: check.reason };
  }

  confirmReceive(userId: string, source: 'faucet' | 'manual' = 'manual'): CoralUser {
    return this.store.apply(userId, { type: 'RECEIVE_CONFIRMED', source });
  }

  /** Issue the first-spend test invoice against the treasury. */
  async startSpendCheck(userId: string): Promise<{ user: CoralUser; pr: string }> {
    const user = this.mustUser(userId);
    const memo = `Coral first-spend: ${user.username ?? userId}`.slice(0, 60);
    const invoice = await issueSpendInvoice(this.config, memo, this.fetchFn);
    const updated = this.store.apply(userId, {
      type: 'SPEND_INVOICE_ISSUED',
      pr: invoice.pr,
      verifyUrl: invoice.verifyUrl,
      sats: invoice.sats,
    });
    return { user: updated, pr: invoice.pr };
  }

  /** Poll LUD-21 for the outstanding spend invoice. */
  async pollSpend(userId: string): Promise<{ user: CoralUser; settled: boolean }> {
    const user = this.mustUser(userId);
    if (!user.spendVerifyUrl) {
      return { user, settled: false };
    }
    const settled = await checkSpendSettled(user.spendVerifyUrl, this.fetchFn);
    if (settled) {
      return {
        user: this.store.apply(userId, { type: 'SPEND_VERIFIED', source: 'lud21' }),
        settled: true,
      };
    }
    return { user, settled: false };
  }

  /** Manual confirmation path when no LUD-21 treasury is configured. */
  confirmSpendManual(userId: string): CoralUser {
    return this.store.apply(userId, { type: 'SPEND_VERIFIED', source: 'manual' });
  }

  joinedCommunity(userId: string): CoralUser {
    return this.store.apply(userId, { type: 'COMMUNITY_JOINED' });
  }

  escalate(userId: string, reason: string): CoralUser {
    this.store.contact(userId);
    return this.store.apply(userId, { type: 'ESCALATED', reason });
  }

  resume(userId: string): CoralUser {
    return this.store.apply(userId, { type: 'RESUMED' });
  }

  optOut(userId: string): CoralUser {
    this.store.contact(userId);
    return this.store.apply(userId, { type: 'OPTED_OUT' });
  }

  /**
   * Safety screen for every inbound message. Escalates when policy says so
   * and returns any mandatory warning to send first.
   */
  screen(userId: string, text: string): { user: CoralUser; warn?: string; escalated: boolean } {
    const user = this.store.contact(userId);
    const assessment = assessMessage(text, user);
    if (assessment.escalate && user.state !== 'escalated') {
      const updated = this.escalate(userId, assessment.reason ?? 'policy');
      return { user: updated, warn: assessment.warn, escalated: true };
    }
    return { user, warn: assessment.warn, escalated: false };
  }

  stalled(now: Date = new Date()): CoralUser[] {
    return this.store.users().filter((u) => isStalled(u, this.config, now));
  }

  metrics(): {
    total: number;
    byState: Record<string, number>;
    reached: Record<string, number>;
    conversionPct: Record<string, number>;
    escalatedNow: number;
    optedOut: number;
  } {
    const users = this.store.users();
    const records = this.store.records();
    const byState: Record<string, number> = {};
    for (const u of users) byState[u.state] = (byState[u.state] ?? 0) + 1;

    // "reached" = ever entered the state (from the event log), so
    // conversion is monotone even as users move on.
    const reachedSets = new Map<CoralState, Set<string>>();
    for (const s of FUNNEL_ORDER) reachedSets.set(s, new Set());
    for (const u of users) reachedSets.get('new')?.add(u.id);
    for (const r of records) {
      const set = reachedSets.get(r.to);
      if (set) set.add(r.userId);
    }
    const reached: Record<string, number> = {};
    const conversionPct: Record<string, number> = {};
    const total = users.length;
    for (const s of FUNNEL_ORDER) {
      reached[s] = reachedSets.get(s)?.size ?? 0;
      conversionPct[s] = total > 0 ? Math.round((reached[s] / total) * 100) : 0;
    }
    return {
      total,
      byState,
      reached,
      conversionPct,
      escalatedNow: byState['escalated'] ?? 0,
      optedOut: byState['opted_out'] ?? 0,
    };
  }

  private mustUser(userId: string): CoralUser {
    const user = this.store.user(userId);
    if (!user) throw new Error(`Unknown user: ${userId}`);
    return user;
  }

  private maybeAutoEscalate(user: CoralUser): CoralUser {
    if (shouldEscalateOnFailure(user, this.config) && user.state !== 'escalated') {
      return this.escalate(user.id, `${user.failedAttempts} failed verification attempts`);
    }
    return user;
  }
}

/** Step scripts the agent follows — goal, moves, and hard exit condition. */
export function getGuidance(state: CoralState): string {
  const scripts: Record<CoralState, string> = {
    new: [
      'GOAL: greet warmly and deliver the anti-scam pledge before anything else.',
      'SAY: who you are (Coral, the community onboarding helper), that you will',
      'NEVER ask for money, seed phrases, or personal documents, and that they',
      'can say "human" anytime to reach a real person.',
      'EXIT: pledge delivered -> record `greet` and move to wallet setup.',
    ].join('\n'),
    greeted: [
      'GOAL: get Flash installed and learn their username.',
      'MOVES: link the right app store for their phone; walk through signup at',
      'their pace, one step per message; when they have a username, record it',
      'with `claim <username>`.',
      'EXIT: username claimed -> run `verify-wallet`.',
    ].join('\n'),
    wallet_setup: [
      'GOAL: verify the wallet is live (LNURL lookup on their username).',
      'MOVES: run `verify-wallet`. If it fails, the username is probably',
      'mistyped — ask them to check the exact spelling in Flash settings and',
      're-claim. Three failures auto-escalates.',
      'EXIT: verification passes -> first-receive step.',
    ].join('\n'),
    first_receive: [
      'GOAL: they receive their first sats and SEE it happen.',
      'MOVES: faucet is disabled in beta — pair them with the meetup buddy or',
      'group leader to zap them a few hundred sats to <username>@flashapp.me.',
      'Have them tell you what they see in the app; celebrate the moment.',
      'CONFIRM with `confirm-receive` only after they describe the received',
      'payment (amount + notification), not just "ok".',
      'EXIT: receive confirmed -> first-spend step.',
    ].join('\n'),
    first_spend: [
      'GOAL: they make their first Lightning payment out.',
      'MOVES: run `spend-invoice` to get a small test invoice (community',
      'treasury); send it and walk them through paying from Flash. Then run',
      '`check-spend` — settlement is verified automatically when LUD-21 is',
      'configured; otherwise confirm manually per ops policy.',
      'EXIT: spend verified -> community step.',
    ].join('\n'),
    community: [
      'GOAL: land them in the community, not just the app.',
      'MOVES: share the group invite / next meetup details; introduce them to',
      'the ops group by first name (with their consent).',
      'EXIT: they joined -> record `joined`, congratulate, and set expectations',
      'for the 30-day check-in.',
    ].join('\n'),
    graduated: 'Onboarding complete. Answer questions; watch for check-in prompts from ops.',
    escalated: [
      'PAUSED for a human. Do NOT continue onboarding steps.',
      'Acknowledge, tell them a real person from the community is picking this',
      'up shortly, and answer only harmless factual questions until `resume`.',
    ].join('\n'),
    opted_out: 'User opted out. Send nothing further unless they message first.',
  };
  return scripts[state];
}
