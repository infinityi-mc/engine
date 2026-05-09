import type { z } from "zod";
import type { ConfigSchema } from "./config.schema";

export type AppConfig = z.infer<typeof ConfigSchema>;
export type LlmConfig = AppConfig["llm"];
export type ProviderConfig = LlmConfig["providers"][string];
