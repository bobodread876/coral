import type { CoralConfig, CoralUser } from './types.js';

/**
 * Escalation & safety policy — pure functions over the incoming message and
 * user state. The agent runs every inbound message through assessMessage
 * BEFORE conversing; a hit pauses automation and pings the ops group.
 */

export interface Assessment {
  escalate: boolean;
  reason?: string;
  /** A safety warning Coral must send verbatim before anything else. */
  warn?: string;
}

/** Anything that looks like seed-phrase / private-key traffic. */
const SEED_PATTERNS: RegExp[] = [
  /\bseed\s*(phrase|words?)\b/i,
  /\brecovery\s*(phrase|words?|key)\b/i,
  /\bprivate\s*key\b/i,
  /\b(12|24)\s*(word|words)\b/i,
  /\bbackup\s*phrase\b/i,
];

const HUMAN_PATTERNS: RegExp[] = [
  /\b(real|actual)\s*(person|human|somebody)\b/i,
  /\btalk\s+to\s+(a\s+)?(human|person|agent|somebody|someone)\b/i,
  /\bis\s+this\s+a\s+bot\b/i,
];

const FRUSTRATION_PATTERNS: RegExp[] = [
  /\bnot\s+working\b/i,
  /\bdoesn'?t\s+work\b/i,
  /\bcyaa?n'?t?\s+(get|do|make)\b/i, // patois: "cyaan get it fi work"
  /\bgive\s+up\b/i,
  /\bwaste\s+(of\s+)?time\b/i,
  /\bscam+(er|ing)?\b/i,
  /\bt(h)?ief\b/i,
];

const MONEY_DISPUTE_PATTERNS: RegExp[] = [
  /\b(lost|missing|stolen|gone)\b.*\b(sats?|money|bitcoin|funds?|btc)\b/i,
  /\b(sats?|money|bitcoin|funds?|btc)\b.*\b(lost|missing|stolen|gone)\b/i,
  /\bnever\s+(get|got|receive[d]?)\b.*\b(sats?|money|payment)\b/i,
];

export const SEED_WARNING =
  'Stop — never share your seed phrase, recovery words, or private key with ' +
  'ANYONE. Not with me, not with Flash support, not with anyone claiming to ' +
  'help you. Coral will never ask for them. Anyone who does is trying to ' +
  'steal your money.';

export function assessMessage(text: string, user: CoralUser): Assessment {
  if (SEED_PATTERNS.some((p) => p.test(text))) {
    return {
      escalate: true,
      reason: 'seed-phrase topic raised — safety-critical, human follow-up required',
      warn: SEED_WARNING,
    };
  }
  if (MONEY_DISPUTE_PATTERNS.some((p) => p.test(text))) {
    return { escalate: true, reason: 'possible lost/missing funds — money dispute' };
  }
  if (HUMAN_PATTERNS.some((p) => p.test(text))) {
    return { escalate: true, reason: 'user asked for a human' };
  }
  if (FRUSTRATION_PATTERNS.some((p) => p.test(text)) && user.failedAttempts >= 1) {
    return { escalate: true, reason: 'user frustrated after failed attempts' };
  }
  return { escalate: false };
}

/** Auto-escalate when a step has failed verification too many times. */
export function shouldEscalateOnFailure(user: CoralUser, config: CoralConfig): boolean {
  return user.failedAttempts >= config.maxFailedAttempts;
}

/** Users sitting in one step longer than the stall window. */
export function isStalled(
  user: CoralUser,
  config: CoralConfig,
  now: Date = new Date(),
): boolean {
  if (['graduated', 'opted_out', 'escalated'].includes(user.state)) return false;
  const enteredAt = new Date(user.enteredStateAt).getTime();
  return now.getTime() - enteredAt > config.stalledAfterHours * 3600 * 1000;
}
