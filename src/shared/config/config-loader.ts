import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema } from "./config.schema";
import type { AppConfig } from "./config.types";

export interface ConfigLoaderInput {
  configPath: string;
}

export interface ConfigLoaderResult {
  config: AppConfig;
  rawConfig: unknown;
}

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    defaultProvider: "none",
    defaultModel: "none",
    providers: {
      anthropic: {
        apiKey: "ANTHROPIC_API_KEY",
        baseUrl: "https://api.anthropic.com",
      },
      openai: {
        apiKey: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com",
      },
      google: {
        apiKey: "GOOGLE_API_KEY",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
    },
  },
};

export function loadConfig(input: ConfigLoaderInput): ConfigLoaderResult {
  let content: string;
  try {
    content = readFileSync(input.configPath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return resolveDefaults();
    }
    throw new Error(
      `Failed to read config at "${input.configPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let rawConfig: unknown;
  const ext = path.extname(input.configPath).toLowerCase();
  try {
    if (ext === ".yaml" || ext === ".yml") {
      rawConfig = parseYaml(content);
    } else {
      rawConfig = JSON.parse(content);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse config at "${input.configPath}": ${message}`,
    );
  }

  const parsed = ConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error(
      `Config validation failed:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }

  const config = resolveEnvVars(parsed.data);
  return { config, rawConfig };
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
    ...(config.agent ? { agent: config.agent } : {}),
  };
}

function resolveDefaults(): ConfigLoaderResult {
  const resolvedProviders: AppConfig["llm"]["providers"] = {};

  for (const [name, provider] of Object.entries(DEFAULT_CONFIG.llm.providers)) {
    const envValue = Bun.env[provider.apiKey];
    if (envValue) {
      resolvedProviders[name] = {
        apiKey: envValue,
        baseUrl: provider.baseUrl,
      };
    }
  }

  return {
    config: {
      llm: {
        ...DEFAULT_CONFIG.llm,
        providers: resolvedProviders,
      },
    },
    rawConfig: DEFAULT_CONFIG,
  };
}
