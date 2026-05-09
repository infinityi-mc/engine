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

const AgentDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.object({ provider: z.string(), model: z.string() }).optional(),
  tools: z.array(z.string()),
  runtime: z.enum(["tool-use-loop", "single-shot"]).default("tool-use-loop"),
  maxIterations: z.number().positive().optional(),
  temperature: z.number().positive().optional(),
  maxTokens: z.number().positive().optional(),
});

const AgentConfigSchema = z.object({
  defaultMaxIterations: z.number().default(10),
  defaultTimeoutMs: z.number().default(300_000),
  agents: z.record(z.string(), AgentDefinitionSchema),
});

export const ConfigSchema = z.object({
  llm: LlmConfigSchema,
  agent: AgentConfigSchema.optional(),
});
