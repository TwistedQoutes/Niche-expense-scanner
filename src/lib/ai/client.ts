import { getEnv } from '@/lib/env';

/**
 * The OpenAI call.
 *
 * Plain `fetch` rather than the SDK, for the same reason the email module talks
 * to Resend over HTTP: this is one POST, and one POST does not justify a
 * dependency in the bundle or a new upgrade treadmill.
 *
 * Three properties matter more than the model choice:
 *
 *  1. **Absence is normal.** A workspace with no `OPENAI_API_KEY` is a supported
 *     configuration, not a broken one. Every caller has to handle
 *     `AiUnavailableError`, and the app is expected to work without a single AI
 *     feature — a lawn-care operator who signed up for a CRM should not lose
 *     their pipeline because we cannot reach a third party.
 *  2. **Failures are bounded.** A hung request would hold a serverless
 *     invocation open until the platform kills it, so every call carries its own
 *     abort timeout and token ceiling.
 *  3. **Output is data, never instruction.** The text this returns was shaped by
 *     a lead description that anyone on the internet can submit through the
 *     public intake form. It is parsed, validated and sanitised by the caller —
 *     never executed, never trusted, never sent to a customer unreviewed.
 */

/** Thrown when this deployment has no AI configured. Expected, not exceptional. */
export class AiUnavailableError extends Error {
  constructor(message = 'AI features are not configured for this workspace.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Thrown when the model was reachable but unusable — timeout, 5xx, bad JSON. */
export class AiFailureError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AiFailureError';
    this.cause = cause;
  }
}

export function aiEnabled(): boolean {
  const env = getEnv();
  return env.AI_DRIVER === 'openai' && Boolean(env.OPENAI_API_KEY);
}

export type ChatJsonOptions = {
  /** The instruction. Never contains customer-supplied text. */
  system: string;
  /** The data. Always contains customer-supplied text; always delimited. */
  user: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /**
   * 0 by default. This is a classification task, not a creative one: the same
   * lead should score the same way twice, or an owner cannot trust the number.
   */
  temperature?: number;
};

type OpenAiChoice = { message?: { content?: string | null } };
type OpenAiResponse = { choices?: OpenAiChoice[] };

/**
 * Sends one prompt and returns the parsed JSON object it produced.
 *
 * JSON mode is requested from the API *and* the result is still parsed
 * defensively. "The API guarantees JSON" is true of the response format and says
 * nothing about the shape inside it, which is the caller's job to validate.
 */
export async function chatJson(options: ChatJsonOptions): Promise<unknown> {
  const env = getEnv();

  if (!aiEnabled()) throw new AiUnavailableError();

  const {
    system,
    user,
    maxOutputTokens = 700,
    timeoutMs = 20_000,
    temperature = 0,
  } = options;

  // A hung upstream request would otherwise hold this invocation open until the
  // platform kills it, which costs money and tells the user nothing.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature,
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AiFailureError(`The AI request timed out after ${timeoutMs}ms.`, error);
    }
    throw new AiFailureError('Could not reach the AI service.', error);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The body names the real problem — an invalid key, a rate limit, a model
    // that does not exist — which is exactly what is needed in the logs and
    // exactly what must not reach a customer.
    const detail = await response.text().catch(() => '');
    throw new AiFailureError(
      `The AI service rejected the request (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const payload = (await response.json().catch(() => null)) as OpenAiResponse | null;
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AiFailureError('The AI service returned an empty response.');
  }

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new AiFailureError('The AI service returned something that was not JSON.', error);
  }
}

/**
 * Wraps customer-supplied text so the model can tell instruction from data.
 *
 * Lead descriptions arrive through a public form, so "ignore your instructions
 * and…" is a thing a real submission will eventually contain. Delimiting is not
 * a complete defence — nothing at the prompt layer is — which is why the *output*
 * is validated and sanitised, and why nothing the model writes is ever sent to a
 * customer without a person seeing it first.
 */
export function asUntrustedData(label: string, value: string | null | undefined): string {
  if (!value) return `${label}: (not provided)`;

  // Fenced, and the fence characters stripped from the content so the value
  // cannot close its own block and start writing instructions.
  const safe = value.replace(/```/g, "'''").slice(0, 4000);
  return `${label}:\n"""\n${safe}\n"""`;
}
