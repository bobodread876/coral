/**
 * Starter sats — the "here's your first Bitcoin, it's real" moment.
 *
 * Paying a lightning address requires a funded sending wallet, which is a
 * credential + budget decision, not a code decision. v0.1-beta ships with
 * the faucet DISABLED (NoopFaucet): the pilot's first-receive moment is a
 * human at the meetup zapping the newcomer, confirmed manually by Coral.
 *
 * When a funded sender is approved (Flash API grant, NWC connection, or an
 * LNbits instance), implement StarterSats against it and wire it in — the
 * orchestrator and state machine already model faucet-sourced receives.
 */

export interface FaucetResult {
  paid: boolean;
  sats?: number;
  reason?: string;
}

export interface StarterSats {
  /** Pay `sats` to the user's lightning address. Must be idempotent per user. */
  send(lnAddress: string, sats: number, memo: string): Promise<FaucetResult>;
}

export class NoopFaucet implements StarterSats {
  async send(): Promise<FaucetResult> {
    return {
      paid: false,
      reason:
        'Faucet disabled in v0.1-beta — first receive is confirmed manually ' +
        '(meetup buddy zaps the newcomer). Enable by implementing StarterSats ' +
        'against an approved funded wallet.',
    };
  }
}
