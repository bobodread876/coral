import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { newUser, transition } from './state-machine.js';
import type { CoralEvent, CoralUser, FunnelRecord } from './types.js';

/**
 * Event-sourced funnel store. The JSONL event log is the single source of
 * truth; user state is derived by replay. Append-only keeps the pilot's
 * audit trail complete ("why did Coral do X" always has an answer) and a
 * SQLite store can replace this behind the same interface when volume
 * demands it.
 */
export interface FunnelStore {
  apply(userId: string, event: CoralEvent, at?: string): CoralUser;
  user(userId: string): CoralUser | undefined;
  users(): CoralUser[];
  records(): FunnelRecord[];
}

export class JsonlStore implements FunnelStore {
  private cache = new Map<string, CoralUser>();
  private log: FunnelRecord[] = [];

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const record = JSON.parse(line) as FunnelRecord;
        this.replay(record);
        this.log.push(record);
      }
    }
  }

  private replay(record: FunnelRecord): void {
    const existing = this.cache.get(record.userId) ?? newUser(record.userId, record.at);
    const { user } = transition(existing, record.event, record.at);
    this.cache.set(record.userId, user);
  }

  apply(userId: string, event: CoralEvent, at: string = new Date().toISOString()): CoralUser {
    const existing = this.cache.get(userId) ?? newUser(userId, at);
    const { user, record } = transition(existing, event, at);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(record) + '\n');
    this.cache.set(userId, user);
    this.log.push(record);
    return user;
  }

  /** Registers a user without an event (first contact). */
  contact(userId: string, at: string = new Date().toISOString()): CoralUser {
    const existing = this.cache.get(userId);
    if (existing) return existing;
    const user = newUser(userId, at);
    this.cache.set(userId, user);
    return user;
  }

  user(userId: string): CoralUser | undefined {
    return this.cache.get(userId);
  }

  users(): CoralUser[] {
    return [...this.cache.values()];
  }

  records(): FunnelRecord[] {
    return [...this.log];
  }
}
