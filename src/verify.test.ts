import { describe, expect, it } from 'vitest';

import type { FetchLike } from './lnaddress.js';
import { DEFAULT_CONFIG } from './types.js';
import { checkSpendSettled, checkWalletExists, issueSpendInvoice } from './verify.js';

const LNURLP_OK = {
  tag: 'payRequest',
  callback: 'https://flashapp.me/cb',
  minSendable: 1000,
  maxSendable: 100000000,
  commentAllowed: 32,
  metadata: '[]',
};

function fakeFetch(routes: Record<string, unknown | ((url: string) => unknown)>): FetchLike {
  return async (url: string) => {
    for (const [prefix, response] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return {
          ok: true,
          status: 200,
          json: async () => (typeof response === 'function' ? response(url) : response),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('checkWalletExists', () => {
  it('normalizes usernames and resolves the lightning address', async () => {
    const fetchFn = fakeFetch({ 'https://flashapp.me/.well-known/lnurlp/andre': LNURLP_OK });
    for (const input of ['andre', '@andre', 'Andre', 'andre@flashapp.me']) {
      const result = await checkWalletExists(input, DEFAULT_CONFIG, fetchFn);
      expect(result.ok, input).toBe(true);
      expect(result.lnAddress).toBe('andre@flashapp.me');
    }
  });

  it('fails cleanly for unknown usernames (HTTP 404)', async () => {
    const result = await checkWalletExists('ghost', DEFAULT_CONFIG, fakeFetch({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/404/);
  });

  it('rejects garbage before making any request', async () => {
    const result = await checkWalletExists('not a username!!', DEFAULT_CONFIG, fakeFetch({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/doesn't look like/);
  });
});

describe('issueSpendInvoice / checkSpendSettled', () => {
  const config = { ...DEFAULT_CONFIG, treasuryAddress: 'treasury@lud21.host' };
  const routes = {
    'https://lud21.host/.well-known/lnurlp/treasury': LNURLP_OK,
    'https://flashapp.me/cb': { pr: 'lnbc21n1test', verify: 'https://lud21.host/v/1' },
    'https://lud21.host/v/1': { settled: true, preimage: 'abc' },
  };

  it('issues an invoice with a verify URL against the treasury', async () => {
    const invoice = await issueSpendInvoice(config, 'memo', fakeFetch(routes));
    expect(invoice.pr).toBe('lnbc21n1test');
    expect(invoice.verifyUrl).toBe('https://lud21.host/v/1');
    expect(invoice.sats).toBe(config.spendSats);
  });

  it('polls settlement via LUD-21', async () => {
    expect(await checkSpendSettled('https://lud21.host/v/1', fakeFetch(routes))).toBe(true);
  });

  it('refuses to issue without a configured treasury', async () => {
    await expect(issueSpendInvoice(DEFAULT_CONFIG, 'memo', fakeFetch(routes))).rejects.toThrow(
      /treasuryAddress/,
    );
  });
});
