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

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('qwen3:8b'),

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
