import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../../../src/shared/config/config-loader";

describe("config-loader", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "config-loader-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(data: unknown): Promise<string> {
    const filePath = path.join(directory, "config.json");
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }

  test("loads and validates a valid config", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: "openai",
        defaultModel: "gpt-4",
        providers: {
          openai: {
            apiKey: "OPENAI_API_KEY",
            baseUrl: "https://api.openai.com",
          },
        },
      },
    });

    const original = Bun.env.OPENAI_API_KEY;
    Bun.env.OPENAI_API_KEY = "sk-test-key-123";
    try {
      const { config, rawConfig } = loadConfig({ configPath });
      expect(config.llm.defaultProvider).toBe("openai");
      expect(config.llm.providers.openai?.apiKey).toBe("sk-test-key-123");
      expect(rawConfig).toBeDefined();
    } finally {
      if (original === undefined) {
        delete Bun.env.OPENAI_API_KEY;
      } else {
        Bun.env.OPENAI_API_KEY = original;
      }
    }
  });

  test("returns default config when file is missing", () => {
    const { config, rawConfig } = loadConfig({
      configPath: path.join(directory, "nonexistent.json"),
    });

    expect(config.llm.defaultProvider).toBe("none");
    expect(config.llm.defaultModel).toBe("none");
    expect(rawConfig).toBeDefined();
  });

  test("default config includes anthropic, openai, google providers", () => {
    const { config } = loadConfig({
      configPath: path.join(directory, "nonexistent.json"),
    });

    expect(config.llm.providers.anthropic?.baseUrl).toBe("https://api.anthropic.com");
    expect(config.llm.providers.openai?.baseUrl).toBe("https://api.openai.com");
    expect(config.llm.providers.google?.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  test("default config resolves env vars for providers", () => {
    const originalA = Bun.env.ANTHROPIC_API_KEY;
    const originalO = Bun.env.OPENAI_API_KEY;
    Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    Bun.env.OPENAI_API_KEY = "test-openai-key";
    delete Bun.env.GOOGLE_API_KEY;
    try {
      const { config } = loadConfig({
        configPath: path.join(directory, "nonexistent.json"),
      });

      expect(config.llm.providers.anthropic?.apiKey).toBe("test-anthropic-key");
      expect(config.llm.providers.openai?.apiKey).toBe("test-openai-key");
      expect(config.llm.providers.google).toBeUndefined();
    } finally {
      if (originalA === undefined) delete Bun.env.ANTHROPIC_API_KEY;
      else Bun.env.ANTHROPIC_API_KEY = originalA;
      if (originalO === undefined) delete Bun.env.OPENAI_API_KEY;
      else Bun.env.OPENAI_API_KEY = originalO;
    }
  });

  test("throws on invalid JSON", async () => {
    const filePath = path.join(directory, "config.json");
    await writeFile(filePath, "{ invalid json }", "utf-8");
    expect(() => loadConfig({ configPath: filePath })).toThrow(
      "Failed to parse config",
    );
  });

  test("throws on missing required fields", async () => {
    const configPath = await writeConfig({ llm: {} });
    expect(() => loadConfig({ configPath })).toThrow("Config validation failed");
  });

  test("throws on wrong types", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: 123,
        defaultModel: true,
        providers: "not-an-object",
      },
    });
    expect(() => loadConfig({ configPath })).toThrow("Config validation failed");
  });

  test("throws on empty apiKey", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: "test",
        defaultModel: "test",
        providers: {
          test: {
            apiKey: "",
            baseUrl: "https://example.com",
          },
        },
      },
    });
    expect(() => loadConfig({ configPath })).toThrow("Config validation failed");
  });

  test("throws when env var is missing", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: "test",
        defaultModel: "test",
        providers: {
          test: {
            apiKey: "DEFINITELY_MISSING_ENV_VAR_12345",
            baseUrl: "https://example.com",
          },
        },
      },
    });

    delete Bun.env.DEFINITELY_MISSING_ENV_VAR_12345;
    expect(() => loadConfig({ configPath })).toThrow("Missing environment variable");
  });

  test("resolves multiple providers", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: "a",
        defaultModel: "m",
        providers: {
          a: { apiKey: "TEST_KEY_A", baseUrl: "https://a.example.com" },
          b: { apiKey: "TEST_KEY_B", baseUrl: "https://b.example.com" },
        },
      },
    });

    const originalA = Bun.env.TEST_KEY_A;
    const originalB = Bun.env.TEST_KEY_B;
    Bun.env.TEST_KEY_A = "resolved-a";
    Bun.env.TEST_KEY_B = "resolved-b";
    try {
      const { config } = loadConfig({ configPath });
      expect(config.llm.providers.a?.apiKey).toBe("resolved-a");
      expect(config.llm.providers.b?.apiKey).toBe("resolved-b");
    } finally {
      if (originalA === undefined) delete Bun.env.TEST_KEY_A;
      else Bun.env.TEST_KEY_A = originalA;
      if (originalB === undefined) delete Bun.env.TEST_KEY_B;
      else Bun.env.TEST_KEY_B = originalB;
    }
  });

  test("merges default providers when user config omits them", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: "anthropic",
        defaultModel: "claude-3-sonnet",
        providers: {
          custom: { apiKey: "CUSTOM_KEY", baseUrl: "https://custom.example.com" },
        },
      },
    });

    const origCustom = Bun.env.CUSTOM_KEY;
    const origAnthropic = Bun.env.ANTHROPIC_API_KEY;
    const origOpenai = Bun.env.OPENAI_API_KEY;
    const origGoogle = Bun.env.GOOGLE_API_KEY;
    Bun.env.CUSTOM_KEY = "custom-value";
    Bun.env.ANTHROPIC_API_KEY = "anthropic-value";
    delete Bun.env.OPENAI_API_KEY;
    delete Bun.env.GOOGLE_API_KEY;
    try {
      const { config } = loadConfig({ configPath });
      expect(config.llm.providers.custom?.apiKey).toBe("custom-value");
      expect(config.llm.providers.anthropic?.apiKey).toBe("anthropic-value");
      expect(config.llm.providers.anthropic?.baseUrl).toBe("https://api.anthropic.com");
      expect(config.llm.providers.openai).toBeUndefined();
    } finally {
      if (origCustom === undefined) delete Bun.env.CUSTOM_KEY;
      else Bun.env.CUSTOM_KEY = origCustom;
      if (origAnthropic === undefined) delete Bun.env.ANTHROPIC_API_KEY;
      else Bun.env.ANTHROPIC_API_KEY = origAnthropic;
      if (origOpenai === undefined) delete Bun.env.OPENAI_API_KEY;
      else Bun.env.OPENAI_API_KEY = origOpenai;
      if (origGoogle === undefined) delete Bun.env.GOOGLE_API_KEY;
      else Bun.env.GOOGLE_API_KEY = origGoogle;
    }
  });

  test("user-configured provider overrides default provider", async () => {
    const configPath = await writeConfig({
      llm: {
        defaultProvider: "anthropic",
        defaultModel: "claude-3-sonnet",
        providers: {
          anthropic: { apiKey: "CUSTOM_ANTHROPIC_KEY", baseUrl: "https://custom-anthropic.example.com" },
        },
      },
    });

    const origKey = Bun.env.CUSTOM_ANTHROPIC_KEY;
    Bun.env.CUSTOM_ANTHROPIC_KEY = "custom-anthropic-value";
    try {
      const { config } = loadConfig({ configPath });
      expect(config.llm.providers.anthropic?.apiKey).toBe("custom-anthropic-value");
      expect(config.llm.providers.anthropic?.baseUrl).toBe("https://custom-anthropic.example.com");
    } finally {
      if (origKey === undefined) delete Bun.env.CUSTOM_ANTHROPIC_KEY;
      else Bun.env.CUSTOM_ANTHROPIC_KEY = origKey;
    }
  });
});
