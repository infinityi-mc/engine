import { readFileSync } from "node:fs";
import { ConfigSchema } from "./config.schema";
import type { AppConfig } from "./config.types";

export interface ConfigLoaderInput {
  configPath: string;
}

export interface ConfigLoaderResult {
  config: AppConfig;
  rawJson: unknown;
}

export function loadConfig(input: ConfigLoaderInput): ConfigLoaderResult {
  let content: string;
  try {
    content = readFileSync(input.configPath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Config file not found at "${input.configPath}". Create it or check the path.`,
      );
    }
    throw new Error(
      `Failed to read config at "${input.configPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse config JSON at "${input.configPath}": ${message}`,
    );
  }

  const parsed = ConfigSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new Error(
      `Config validation failed:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }

  const config = resolveEnvVars(parsed.data);
  return { config, rawJson };
}

function resolveEnvVars(config: AppConfig): AppConfig {
  const resolvedProviders: AppConfig["llm"]["providers"] = {};

  for (const [name, provider] of Object.entries(config.llm.providers)) {
    const envValue = Bun.env[provider.apiKey];
    if (!envValue) {
      throw new Error(
        `Missing environment variable "${provider.apiKey}" for provider "${name}".`,
      );
    }
    resolvedProviders[name] = {
      apiKey: envValue,
      baseUrl: provider.baseUrl,
    };
  }

  return {
    llm: {
      ...config.llm,
      providers: resolvedProviders,
    },
  };
}
