/**
 * Gemini AI Service — single provider for all AI features.
 *
 * Key design:
 *  - 1 default key + 6 fallback keys (rotated on 429 / 503 / auth errors)
 *  - Server-side only (never exposed to client via NEXT_PUBLIC_)
 *  - Circuit-breaker: after 3 consecutive failures, pauses for 30s
 *  - Models: gemini-2.5-flash (default), gemini-2.5-flash-lite (lightweight)
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type GeminiModel = 'gemini-2.5-flash' | 'gemini-2.5-flash-lite' | 'gemini-3.5-flash';

interface GeminiGenerateRequest {
  contents: Array<{
    role?: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason?: string;
  }>;
}

// ── Key pool with rotation ──

const KEY_POOL: string[] = (() => {
  const keys: string[] = [];
  const def = process.env.GEMINI_API_KEY_DEFAULT;
  if (def) keys.push(def);
  for (let i = 1; i <= 6; i++) {
    const k = process.env[`GEMINI_API_KEY_FALLBACK_${i}`];
    if (k) keys.push(k);
  }
  return keys;
})();

let currentKeyIndex = 0;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function rotateKey(): string | null {
  if (KEY_POOL.length === 0) return null;
  currentKeyIndex = (currentKeyIndex + 1) % KEY_POOL.length;
  return KEY_POOL[currentKeyIndex];
}

function currentKey(): string | null {
  if (KEY_POOL.length === 0) return null;
  return KEY_POOL[currentKeyIndex];
}

const MODEL: GeminiModel =
  (process.env.GEMINI_DEFAULT_MODEL as GeminiModel) || 'gemini-2.5-flash';

// ── Core API call with fallback ──

async function callGemini(
  body: GeminiGenerateRequest,
  model: GeminiModel = MODEL,
): Promise<string> {
  if (KEY_POOL.length === 0) throw new Error('No Gemini API keys configured');

  // Circuit breaker
  if (Date.now() < circuitOpenUntil) {
    throw new Error('Gemini circuit breaker open — too many failures');
  }

  const errors: string[] = [];
  const maxAttempts = KEY_POOL.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = currentKey();
    if (!key) break;

    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });

      if (!res.ok) {
        const status = res.status;
        const errText = await res.text().catch(() => '');
        errors.push(`key[${currentKeyIndex}] → HTTP ${status}`);

        // Rotate on rate-limit / quota / auth errors
        if (status === 429 || status === 503 || status === 403 || status === 401) {
          rotateKey();
          consecutiveFailures++;
          continue;
        }

        // Non-retryable error
        throw new Error(`Gemini HTTP ${status}: ${errText.slice(0, 200)}`);
      }

      // Success — reset failure count
      consecutiveFailures = 0;
      const data: GeminiGenerateResponse = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned empty response');
      return text;

    } catch (error: any) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        errors.push(`key[${currentKeyIndex}] → timeout`);
        rotateKey();
        consecutiveFailures++;
        continue;
      }
      // Don't retry on thrown errors (non-HTTP failures)
      throw error;
    }
  }

  // All keys exhausted — open circuit breaker
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    circuitOpenUntil = Date.now() + 30_000;
  }

  throw new Error(`All Gemini keys failed: ${errors.join('; ')}`);
}

// ── Public API ──

export interface AIPromptOptions {
  model?: GeminiModel;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

/**
 * Send a single-turn prompt to Gemini. Returns the generated text.
 * Automatically falls back across all configured API keys on failure.
 */
export async function aiPrompt(
  prompt: string,
  options: AIPromptOptions = {},
): Promise<string> {
  const body: GeminiGenerateRequest = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 1024,
    },
  };

  if (options.systemPrompt) {
    body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
  }

  return callGemini(body, options.model);
}

/**
 * Send a multi-turn conversation to Gemini. `messages` is an array of
 * { role, text } pairs. Returns the model's response text.
 */
export async function aiChat(
  messages: Array<{ role: 'user' | 'model'; text: string }>,
  options: AIPromptOptions = {},
): Promise<string> {
  const body: GeminiGenerateRequest = {
    contents: messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 1024,
    },
  };

  if (options.systemPrompt) {
    body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
  }

  return callGemini(body, options.model);
}

/** Health check — returns true if at least one key is working. */
export async function aiHealthCheck(): Promise<boolean> {
  try {
    await aiPrompt('Reply with just the word "OK".', { maxTokens: 4, temperature: 0 });
    return true;
  } catch {
    return false;
  }
}

/** Get the number of configured API keys. */
export function aiKeyCount(): number {
  return KEY_POOL.length;
}
