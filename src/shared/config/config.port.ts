import type { LlmConfig, AppConfig } from "./config.types";

export interface ConfigPort {
  getConfig(): AppConfig;
  getLlmConfig(): LlmConfig;
  getAgentConfig(): AppConfig["agent"];
  getApiKey(provider: string): string;
  getBaseUrl(provider: string): string;
  onChange(listener: (config: AppConfig) => void): () => void;
  /** Stop the config file watcher. Call on application shutdown. */
  stop(): void;
}
