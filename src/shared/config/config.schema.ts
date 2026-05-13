import { z } from "zod";
import { AUDIO_PLAYER_DEFAULTS } from "./config-defaults";

const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
});

const LlmConfigSchema = z.object({
  defaultProvider: z.string().default("none"),
  defaultModel: z.string().default("none"),
  providers: z.record(z.string(), ProviderConfigSchema),
});

const ContextBlockSchema = z.object({
  type: z.enum(["server", "player", "timestamp"]),
});

const AgentDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  context: z.array(ContextBlockSchema).optional(),
  model: z.object({ provider: z.string(), model: z.string() }).optional(),
  tools: z.array(
    z.string().refine(
      (s) => s.length > 0 && (!s.startsWith("group:") || s.length > 6),
      { message: "tool entry must be a non-empty tool name or 'group:<name>' with a non-empty name" },
    ),
  ),
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

const MinecraftAgentConfigSchema = z.object({
  messageCap: z.number().positive().default(50),
  sessionTtlMs: z.number().positive().default(172_800_000),
  playerCooldownMs: z.number().positive().default(5_000),
});

const MinecraftConfigSchema = z.object({
  agent: MinecraftAgentConfigSchema.optional(),
});

const AudioPlayerConfigSchema = z.object({
  maxDownloadSize: z.number().positive().default(AUDIO_PLAYER_DEFAULTS.maxDownloadSize),
  downloadFormat: z.string().min(1).default(AUDIO_PLAYER_DEFAULTS.downloadFormat),
  maxPlayerRequest: z.number().positive().default(AUDIO_PLAYER_DEFAULTS.maxPlayerRequest),
  playbackRange: z.number().positive().default(AUDIO_PLAYER_DEFAULTS.playbackRange),
  searchLimit: z.number().positive().default(AUDIO_PLAYER_DEFAULTS.searchLimit),
});

export const ConfigSchema = z.object({
  llm: LlmConfigSchema,
  agent: AgentConfigSchema.optional(),
  minecraft: MinecraftConfigSchema.optional(),
  audioPlayer: AudioPlayerConfigSchema.default(AUDIO_PLAYER_DEFAULTS),
});
