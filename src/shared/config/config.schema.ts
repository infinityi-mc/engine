import { z } from "zod";

const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
});

const LlmConfigSchema = z.object({
  defaultProvider: z.string(),
  defaultModel: z.string(),
  providers: z.record(z.string(), ProviderConfigSchema),
});

export const ConfigSchema = z.object({
  llm: LlmConfigSchema,
});
