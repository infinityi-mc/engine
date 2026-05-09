import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { noopLogger } from "../../../src/shared/observability/logger.port";
import { createConfigWatcher } from "../../../src/shared/config/config-watcher";
import type { AppConfig } from "../../../src/shared/config/config.types";

describe("config-watcher", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "config-watcher-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(data: unknown): Promise<string> {
    const filePath = path.join(directory, "config.json");
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }

  function baseConfig(): unknown {
    return {
      llm: {
        defaultProvider: "test",
        defaultModel: "test-model",
        providers: {
          test: { apiKey: "TEST_WATCHER_KEY", baseUrl: "https://example.com" },
        },
      },
    };
  }

  test("detects config changes and reloads", async () => {
    const original = Bun.env.TEST_WATCHER_KEY;
    Bun.env.TEST_WATCHER_KEY = "initial-value";
    try {
      const configPath = await writeConfig(baseConfig());

      await new Promise<void>((resolve, reject) => {
        let callCount = 0;
        const watcher = createConfigWatcher({
          configPath,
          logger: noopLogger,
          onReload: (config: AppConfig) => {
            callCount++;
            if (callCount === 1) {
              expect(config.llm.defaultModel).toBe("updated-model");
              watcher.stop();
              resolve();
            }
          },
          onError: (error) => {
            watcher.stop();
            reject(error);
          },
        });

        setTimeout(async () => {
          const updated = baseConfig() as {
            llm: { defaultModel: string; providers: unknown };
          };
          updated.llm.defaultModel = "updated-model";
          await writeFile(
            configPath,
            JSON.stringify(updated, null, 2),
            "utf-8",
          );
        }, 500);

        setTimeout(() => {
          watcher.stop();
          reject(new Error("Timeout: reload not detected"));
        }, 5000);
      });
    } finally {
      if (original === undefined) delete Bun.env.TEST_WATCHER_KEY;
      else Bun.env.TEST_WATCHER_KEY = original;
    }
  });

  test("rejects invalid config gracefully without crashing", async () => {
    const original = Bun.env.TEST_WATCHER_KEY;
    Bun.env.TEST_WATCHER_KEY = "initial-value";
    try {
      const configPath = await writeConfig(baseConfig());

      await new Promise<void>((resolve, reject) => {
        const watcher = createConfigWatcher({
          configPath,
          logger: noopLogger,
          onReload: () => {
            watcher.stop();
            reject(new Error("onReload should not be called for invalid config"));
          },
          onError: (error) => {
            expect(error.message).toContain("Failed to parse config JSON");
            watcher.stop();
            resolve();
          },
        });

        setTimeout(async () => {
          await writeFile(configPath, "{ invalid json }", "utf-8");
        }, 500);

        setTimeout(() => {
          watcher.stop();
          reject(new Error("Timeout: error not detected"));
        }, 5000);
      });
    } finally {
      if (original === undefined) delete Bun.env.TEST_WATCHER_KEY;
      else Bun.env.TEST_WATCHER_KEY = original;
    }
  });

  test("stop prevents further callbacks", async () => {
    const original = Bun.env.TEST_WATCHER_KEY;
    Bun.env.TEST_WATCHER_KEY = "initial-value";
    try {
      const configPath = await writeConfig(baseConfig());
      let callCount = 0;

      const watcher = createConfigWatcher({
        configPath,
        logger: noopLogger,
        onReload: () => {
          callCount++;
        },
        onError: () => {},
      });

      watcher.stop();

      await new Promise((r) => setTimeout(r, 500));
      const updated = baseConfig() as {
        llm: { defaultModel: string; providers: unknown };
      };
      updated.llm.defaultModel = "should-not-trigger";
      await writeFile(configPath, JSON.stringify(updated, null, 2), "utf-8");

      await new Promise((r) => setTimeout(r, 500));
      expect(callCount).toBe(0);
    } finally {
      if (original === undefined) delete Bun.env.TEST_WATCHER_KEY;
      else Bun.env.TEST_WATCHER_KEY = original;
    }
  });
});
