import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { JsonlStore } from './store.js';

const T = '2026-07-06T12:00:00.000Z';

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'coral-test-')), 'events.jsonl');
}

describe('JsonlStore', () => {
  it('applies events and derives user state', () => {
    const store = new JsonlStore(tempPath());
    store.apply('u1', { type: 'GREET_SENT' }, T);
    const user = store.apply('u1', { type: 'WALLET_CLAIMED', username: 'andre' }, T);
    expect(user.state).toBe('wallet_setup');
    expect(store.users()).toHaveLength(1);
    expect(store.records()).toHaveLength(2);
  });

  it('survives process restarts by replaying the log', () => {
    const path = tempPath();
    const first = new JsonlStore(path);
    first.apply('u1', { type: 'GREET_SENT' }, T);
    first.apply('u1', { type: 'WALLET_CLAIMED', username: 'andre' }, T);
    first.apply('u2', { type: 'GREET_SENT' }, T);

    const second = new JsonlStore(path);
    expect(second.user('u1')?.state).toBe('wallet_setup');
    expect(second.user('u1')?.username).toBe('andre');
    expect(second.user('u2')?.state).toBe('greeted');
    expect(second.records()).toHaveLength(3);
  });

  it('contact registers without an event and is idempotent', () => {
    const store = new JsonlStore(tempPath());
    const a = store.contact('u1', T);
    const b = store.contact('u1', '2026-07-07T00:00:00.000Z');
    expect(a.state).toBe('new');
    expect(b.createdAt).toBe(T);
    expect(store.records()).toHaveLength(0);
  });

  it('rejects invalid transitions without corrupting the log', () => {
    const path = tempPath();
    const store = new JsonlStore(path);
    store.apply('u1', { type: 'GREET_SENT' }, T);
    expect(() => store.apply('u1', { type: 'COMMUNITY_JOINED' }, T)).toThrow();

    const reloaded = new JsonlStore(path);
    expect(reloaded.user('u1')?.state).toBe('greeted');
    expect(reloaded.records()).toHaveLength(1);
  });
});
