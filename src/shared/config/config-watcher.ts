import { existsSync, watch } from "node:fs";
import path from "node:path";
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
  let activeWatcher: FSWatcher | null = null;
  let stopped = false;
  let switchedToFile = false;

  function scheduleReload(): void {
    if (stopped) return;

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
  }

  function watchFile(): void {
    activeWatcher = watch(
      input.configPath,
      { persistent: false },
      (eventType) => {
        if (eventType !== "change" && eventType !== "rename") {
          return;
        }
        scheduleReload();
      },
    );
  }

  function watchDirectory(): void {
    const dir = path.dirname(input.configPath);
    const filename = path.basename(input.configPath);

    try {
      activeWatcher = watch(dir, { persistent: false }, (eventType, changedFilename) => {
        if (switchedToFile) return;

        const isTargetFile = changedFilename === filename || changedFilename === null;
        if (!isTargetFile) return;

        scheduleReload();
        if (existsSync(input.configPath)) {
          switchedToFile = true;
          activeWatcher?.close();
          watchFile();
        }
      });
    } catch (error) {
      input.logger.error("config.watch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (existsSync(input.configPath)) {
    watchFile();
  } else {
    watchDirectory();
  }

  return {
    stop: () => {
      stopped = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      try {
        activeWatcher?.close();
      } catch {
        // Ignore close errors (e.g. EPERM on Windows)
      }
    },
  };
}
