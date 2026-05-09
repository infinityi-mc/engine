import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { LoggerPort } from "../observability/logger.port";
import { loadConfig } from "./config-loader";
import type { AppConfig } from "./config.types";

export interface ConfigWatcherInput {
  configPath: string;
  onReload: (config: AppConfig) => void;
  onError: (error: Error) => void;
  logger: LoggerPort;
}

const DEBOUNCE_MS = 250;

export function createConfigWatcher(input: ConfigWatcherInput): {
  stop: () => void;
} {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher: FSWatcher = watch(
    input.configPath,
    { persistent: false },
    (eventType) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        try {
          const { config } = loadConfig({ configPath: input.configPath });
          input.onReload(config);
          input.logger.info("config.reload_success");
        } catch (error) {
          const err =
            error instanceof Error ? error : new Error(String(error));
          input.onError(err);
          input.logger.error("config.reload_failed", {
            error: err.message,
          });
        }
      }, DEBOUNCE_MS);
    },
  );

  return {
    stop: () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      try {
        watcher.close();
      } catch {
        // Ignore close errors (e.g. EPERM on Windows)
      }
    },
  };
}
