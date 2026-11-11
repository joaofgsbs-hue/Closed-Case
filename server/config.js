// config.js
// Reads the .env file ONCE, validates it with zod, and exports a frozen object.
// Every other file imports `config` from here instead of touching process.env,
// so a typo in .env fails loudly at startup instead of causing weird bugs later.

import 'dotenv/config'; // side effect: copies .env values into process.env
import { z } from 'zod';

const envSchema = z.object({
  // z.coerce.number() turns the string "3000" into the number 3000.
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  LLM_PROVIDER: z.enum(['ollama', 'anthropic']).default('ollama'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),

  // Writing a whole case is a much longer answer than one line of dialogue,
  // so it gets its own, longer time limits.
  CASE_TIMEOUT_MS: z.coerce.number().int().min(10000).default(240000),
  CASE_VERIFY_TIMEOUT_MS: z.coerce.number().int().min(10000).default(120000),

  // How many requests the model may work on at the same time.
  // 1 is right for a local model. A cloud API can take more (for example 4).
  LLM_MAX_PARALLEL: z.coerce.number().int().min(1).max(16).default(1),

  // Location searches per game, shared by the room. 0 = automatic: one fewer
  // than the number of locations, so players must choose where to look.
  ACTIONS_PER_DAY: z.coerce.number().int().min(0).max(20).default(0),
  // How many times a room may ask "is this a real contradiction?".
  LINK_CHECKS_PER_ROOM: z.coerce.number().int().min(1).max(100).default(12),

  // Interrogation limits. They are shared by everyone in a room.
  QUESTIONS_PER_SUSPECT: z.coerce.number().int().min(1).max(50).default(8),
  MAX_QUESTIONS_PER_ROOM: z.coerce.number().int().min(1).max(500).default(60),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('qwen3:8b'),
  // How much text (in tokens) the local model can hold in mind at once.
  // A full case needs more than Ollama's small default.
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).default(8192),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-5-5'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print WHICH variable is wrong, but never the values (one could be a key).
  console.error('Invalid .env configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

// A rule that involves two variables at once: the paid provider needs a key.
if (parsed.data.LLM_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
  console.error('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty in .env');
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
