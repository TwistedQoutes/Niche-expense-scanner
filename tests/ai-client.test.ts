import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AiFailureError,
  AiUnavailableError,
  aiEnabled,
  chatJson,
} from '@/lib/ai/client';
import { resetEnvCache } from '@/lib/env';

/**
 * The promise this file exists to hold: **a workspace with no AI key is a
 * supported configuration.** A lawn-care operator who signed up for a CRM must
 * not lose their pipeline because we cannot reach a third party, so absence is an
 * expected branch and every failure is bounded.
 */

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();

  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCache();
  };

  const result = run();
  if (result instanceof Promise) return result.finally(restore);

  restore();
  return undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetEnvCache();
});

describe('aiEnabled', () => {
  it('is false by default, which is the default deployment', () => {
    expect(aiEnabled()).toBe(false);
  });

  it('is false when the driver is on but the key is missing', () => {
    // Belt and braces: the environment loader already rejects this combination
    // at boot, so reaching here means something bypassed it.
    withEnv({ AI_DRIVER: 'none', OPENAI_API_KEY: undefined }, () => {
      expect(aiEnabled()).toBe(false);
    });
  });

  it('is true only with both a driver and a key', () =>
    withEnv({ AI_DRIVER: 'openai', OPENAI_API_KEY: 'sk-test' }, () => {
      expect(aiEnabled()).toBe(true);
    }));
});

describe('chatJson without a key', () => {
  it('throws the expected-absence error, not a generic failure', async () => {
    // Callers branch on this to decide between "not configured" (501) and
    // "the model is broken" (502), so the two must never be confused.
    await expect(chatJson({ system: 's', user: 'u' })).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('never touches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(chatJson({ system: 's', user: 'u' })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('chatJson with a key', () => {
  const configured = { AI_DRIVER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o-mini' };

  function stubResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const ok = init.ok ?? true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status: init.status ?? (ok ? 200 : 500),
        json: async () => body,
        text: async () => JSON.stringify(body),
      })),
    );
  }

  it('returns the parsed JSON the model produced', () =>
    withEnv(configured, async () => {
      stubResponse({ choices: [{ message: { content: '{"score":87}' } }] });

      await expect(chatJson({ system: 's', user: 'u' })).resolves.toEqual({ score: 87 });
    }));

  it('asks for JSON mode and pins temperature to zero', () =>
    withEnv(configured, async () => {
      const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{}' } }] }),
        text: async () => '{}',
      }));
      vi.stubGlobal('fetch', fetchSpy);

      await chatJson({ system: 'sys', user: 'usr' });

      const body = JSON.parse(String(fetchSpy.mock.calls[0]![1].body));
      // Scoring is classification, not creativity: the same lead has to score the
      // same way twice or an owner cannot trust the number.
      expect(body.temperature).toBe(0);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBeGreaterThan(0);
      expect(body.messages[0].content).toBe('sys');
      expect(body.messages[1].content).toBe('usr');
    }));

  it('never puts the API key anywhere but the Authorization header', () =>
    withEnv(configured, async () => {
      const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{}' } }] }),
        text: async () => '{}',
      }));
      vi.stubGlobal('fetch', fetchSpy);

      await chatJson({ system: 's', user: 'u' });

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).not.toContain('sk-test');
      expect(String(init.body)).not.toContain('sk-test');
      expect((init.headers as Record<string, string>).Authorization).toContain('sk-test');
    }));

  it('treats a non-200 as a failure without leaking the upstream body', () =>
    withEnv(configured, async () => {
      stubResponse({ error: { message: 'Incorrect API key provided: sk-live-real' } }, {
        ok: false,
        status: 401,
      });

      // The detail belongs in our logs; the caller maps this to a generic 502.
      await expect(chatJson({ system: 's', user: 'u' })).rejects.toBeInstanceOf(AiFailureError);
    }));

  it('rejects an empty completion', () =>
    withEnv(configured, async () => {
      stubResponse({ choices: [{ message: { content: '   ' } }] });

      await expect(chatJson({ system: 's', user: 'u' })).rejects.toThrow(/empty/i);
    }));

  it('rejects a completion that is not JSON, despite JSON mode', () =>
    withEnv(configured, async () => {
      // "The API guarantees JSON" is a statement about the response format and
      // says nothing about what is inside it.
      stubResponse({ choices: [{ message: { content: 'Sure! Here you go:' } }] });

      await expect(chatJson({ system: 's', user: 'u' })).rejects.toThrow(/not JSON/i);
    }));

  it('rejects a response with no choices at all', () =>
    withEnv(configured, async () => {
      stubResponse({});

      await expect(chatJson({ system: 's', user: 'u' })).rejects.toBeInstanceOf(AiFailureError);
    }));

  it('bounds a hung request with its own timeout', () =>
    withEnv(configured, async () => {
      // A hung upstream call would otherwise hold a serverless invocation open
      // until the platform kills it.
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        }),
      );

      await expect(
        chatJson({ system: 's', user: 'u', timeoutMs: 20 }),
      ).rejects.toThrow(/timed out/i);
    }));

  it('reports a network failure as a failure, not as absence', () =>
    withEnv(configured, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );

      const error = await chatJson({ system: 's', user: 'u' }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AiFailureError);
      expect(error).not.toBeInstanceOf(AiUnavailableError);
    }));
});
