import type { LoggerPort } from "../observability/logger.port";
import { loadConfig } from "./config-loader";
import type { ConfigPort } from "./config.port";
import type { LlmConfig, AppConfig } from "./config.types";
import { createConfigWatcher } from "./config-watcher";

export interface ConfigAdapterInput {
  configPath: string;
  logger: LoggerPort;
}

export class ConfigAdapter implements ConfigPort {
  private config: AppConfig;
  private listeners: Array<(config: AppConfig) => void> = [];
  private readonly watcher: { stop: () => void };

  constructor(input: ConfigAdapterInput) {
    const { config } = loadConfig({ configPath: input.configPath });
    this.config = config;
    const logger = input.logger;

    this.watcher = createConfigWatcher({
      configPath: input.configPath,
      onReload: (newConfig) => {
        this.config = newConfig;
        for (const listener of [...this.listeners]) {
          try {
            listener(newConfig);
          } catch (err) {
            logger.error("config.listener_error", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
      onError: () => {
        // Error already logged by watcher; keep previous config
      },
      logger: input.logger,
    });
  }

  getConfig(): AppConfig {
    return this.config;
  }

  getLlmConfig(): LlmConfig {
    return this.config.llm;
  }

  getApiKey(provider: string): string {
    const p = this.config.llm.providers[provider];
    if (!p) {
      throw new Error(`Unknown provider: "${provider}"`);
    }
    return p.apiKey;
  }

  getBaseUrl(provider: string): string {
    const p = this.config.llm.providers[provider];
    if (!p) {
      throw new Error(`Unknown provider: "${provider}"`);
    }
    return p.baseUrl;
  }

  onChange(listener: (config: AppConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  stop(): void {
    this.watcher.stop();
  }
}
