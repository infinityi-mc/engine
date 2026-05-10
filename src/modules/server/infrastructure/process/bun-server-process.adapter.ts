import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { getErrorMessage, getErrorName } from "../../../../shared/observability/error-utils";
import type { EventBus } from "../../../../shared/application/event-bus";
import type { ServerProcessPort, SpawnInput } from "../../domain/ports/server-process.port";
import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { ServerInstance, ServerStatus } from "../../domain/types/server-instance";
import { ServerNotFoundError } from "../../domain/errors/server-not-found.error";
import { ServerProcessError } from "../../domain/errors/server-process.error";
import { ServerProcessExited } from "../../domain/events/server-process-exited.event";

interface TrackedProcess {
  readonly subprocess: ReturnType<typeof Bun.spawn>;
  readonly instanceId: string;
}

export class BunServerProcessAdapter implements ServerProcessPort {
  private readonly processes = new Map<string, TrackedProcess>();
  private readonly instances = new Map<string, ServerInstance>();
  private readonly killedInstanceIds = new Set<string>();

  constructor(
    private readonly logger: LoggerPort,
    private readonly pidDir: string,
    private readonly eventBus: EventBus,
  ) {}

  async spawn(input: SpawnInput): Promise<ServerInstance> {
    const args = input.args ?? [];
    const commandArgs = [input.command, ...args];

    try {
      const spawnOptions = {
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.env !== undefined ? { env: { ...getEnvironment(), ...input.env } } : {}),
        stdin: "pipe" as const,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      };

      const subprocess = Bun.spawn(commandArgs, spawnOptions);
      const pid = subprocess.pid;
      const startedAt = new Date();

      const instance: ServerInstance = {
        id: input.id,
        pid,
        command: input.command,
        args,
        cwd: input.cwd,
        status: "running" as const,
        startedAt,
        stoppedAt: undefined,
      };

      this.processes.set(input.id, { subprocess, instanceId: input.id });
      this.instances.set(input.id, instance);

      await this.writePidFile(input.id, pid);

      // Monitor process exit asynchronously
      this.monitorExit(input.id, subprocess);

      this.logger.info("server.process.spawned", {
        module: "server",
        operation: "process.spawn",
        instanceId: input.id,
        pid,
        command: input.command,
        argsCount: args.length,
      });

      return instance;
    } catch (error) {
      this.logger.error("server.process.spawn_error", {
        module: "server",
        operation: "process.spawn",
        instanceId: input.id,
        command: input.command,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      });

      throw new ServerProcessError(input.id, getErrorMessage(error));
    }
  }

  async kill(instanceId: string): Promise<void> {
    const tracked = this.processes.get(instanceId);
    if (!tracked) {
      throw new ServerNotFoundError(instanceId);
    }

    const { subprocess } = tracked;

    // Mark as killed so monitorExit classifies the exit as "stopped"
    this.killedInstanceIds.add(instanceId);

    try {
      if (process.platform === "win32") {
        // On Windows, use taskkill to kill the process tree
        const killer = Bun.spawn(["taskkill", "/PID", String(subprocess.pid), "/T", "/F"], {
          stdout: "ignore",
          stderr: "ignore",
        });
        const taskkillExitCode = await killer.exited;
        if (taskkillExitCode !== 0) {
          throw new ServerProcessError(instanceId, `taskkill failed with exit code ${taskkillExitCode}`);
        }
      } else {
        // On Unix, try SIGTERM first, then SIGKILL after timeout
        try {
          subprocess.kill("SIGTERM");
          let timer: ReturnType<typeof setTimeout> | undefined;
          const exitResult = await Promise.race([
            subprocess.exited,
            new Promise<number>((resolve) => {
              timer = setTimeout(() => resolve(-1), 5000);
            }),
          ]);
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          if (exitResult === -1) {
            subprocess.kill("SIGKILL");
            await subprocess.exited;
          }
        } catch {
          // Process may have already exited
        }
      }

      await this.removePidFile(instanceId);

      this.processes.delete(instanceId);

      this.logger.info("server.process.killed", {
        module: "server",
        operation: "process.kill",
        instanceId,
        pid: subprocess.pid,
      });
    } catch (error) {
      this.killedInstanceIds.delete(instanceId);

      this.logger.error("server.process.kill_error", {
        module: "server",
        operation: "process.kill",
        instanceId,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      });

      throw new ServerProcessError(instanceId, getErrorMessage(error));
    }
  }

  /**
   * Returns the tracked subprocess for a given instance ID.
   * Used by consumer modules (e.g., minecraft) to access stdin/stdout/stderr pipes.
   * Returns undefined if the instance is not tracked.
   */
  getSubprocess(instanceId: string): ReturnType<typeof Bun.spawn> | undefined {
    const tracked = this.processes.get(instanceId);
    return tracked?.subprocess;
  }

  async reconcile(registry: ServerRegistryPort): Promise<void> {
    try {
      await mkdir(this.pidDir, { recursive: true });
      const files = await readdir(this.pidDir);
      const pidFiles = files.filter((f) => f.endsWith(".pid"));

      if (pidFiles.length === 0) {
        return;
      }

      this.logger.info("server.process.reconcile_start", {
        module: "server",
        operation: "process.reconcile",
        pidFileCount: pidFiles.length,
      });

      for (const file of pidFiles) {
        const instanceId = file.slice(0, -4); // Remove .pid extension
        const pidFilePath = path.join(this.pidDir, file);

        try {
          const pidStr = await readFile(pidFilePath, "utf8");
          const pid = Number(pidStr.trim());

          if (Number.isNaN(pid) || pid <= 0) {
            await rm(pidFilePath, { force: true });
            this.logger.warn("server.process.reconcile_invalid_pid", {
              module: "server",
              operation: "process.reconcile",
              instanceId,
              pidFile: pidFilePath,
            });
            continue;
          }

          const alive = isPidAlive(pid);
          if (alive) {
            // Adopt the running process - re-register in registry
            const instance: ServerInstance = {
              id: instanceId,
              pid,
              command: "(recovered)",
              args: [],
              cwd: undefined,
              status: "running",
              startedAt: new Date(), // Best effort — actual start time unknown
              stoppedAt: undefined,
            };

            await registry.register(instance);
            this.logger.info("server.process.reconcile_adopted", {
              module: "server",
              operation: "process.reconcile",
              instanceId,
              pid,
            });
          } else {
            // Stale PID file — process no longer exists
            await rm(pidFilePath, { force: true });
            this.logger.info("server.process.reconcile_stale", {
              module: "server",
              operation: "process.reconcile",
              instanceId,
              pid,
            });
          }
        } catch (error) {
          this.logger.warn("server.process.reconcile_error", {
            module: "server",
            operation: "process.reconcile",
            instanceId,
            errorName: getErrorName(error),
            errorMessage: getErrorMessage(error),
          });
        }
      }
    } catch (error) {
      this.logger.warn("server.process.reconcile_dir_error", {
        module: "server",
        operation: "process.reconcile",
        pidDir: this.pidDir,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      });
    }
  }

  private monitorExit(instanceId: string, subprocess: ReturnType<typeof Bun.spawn>): void {
    subprocess.exited.then((exitCode) => {
      const instance = this.instances.get(instanceId);
      const wasKilled = this.killedInstanceIds.has(instanceId);
      if (instance) {
        // If kill() was called, classify as "stopped" regardless of exit code
        // (e.g., SIGTERM produces exit code 143 on Linux, which is intentional)
        const status: ServerStatus = wasKilled || exitCode === 0 ? "stopped" : "crashed";
        this.instances.set(instanceId, {
          ...instance,
          status,
          stoppedAt: new Date(),
        });
      }

      this.processes.delete(instanceId);
      this.killedInstanceIds.delete(instanceId);
      this.removePidFile(instanceId).catch((e) => {
        this.logger.debug("server.process.pid_cleanup_failed", {
          module: "server",
          operation: "process.pid_cleanup",
          instanceId,
          error: String(e),
        });
      });

      this.eventBus.publish(
        new ServerProcessExited(instanceId, exitCode, wasKilled),
      ).catch((e) => {
        this.logger.error("server.process.event_publish_failed", {
          module: "server",
          operation: "process.exit",
          instanceId,
          error: String(e),
        });
      });

      this.logger.info("server.process.exited", {
        module: "server",
        operation: "process.exit",
        instanceId,
        pid: subprocess.pid,
        exitCode,
      });
    }).catch((error) => {
      this.logger.warn("server.process.monitor_error", {
        module: "server",
        operation: "process.monitor",
        instanceId,
        pid: subprocess.pid,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      });
    });
  }

  private async writePidFile(instanceId: string, pid: number): Promise<void> {
    await mkdir(this.pidDir, { recursive: true });
    const pidFilePath = path.join(this.pidDir, `${sanitizeId(instanceId)}.pid`);
    await writeFile(pidFilePath, String(pid), "utf8");
  }

  private async removePidFile(instanceId: string): Promise<void> {
    const pidFilePath = path.join(this.pidDir, `${sanitizeId(instanceId)}.pid`);
    try {
      await rm(pidFilePath, { force: true });
    } catch {
      // Best effort — PID file cleanup is non-critical
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function sanitizeId(id: string): string {
  return id.replaceAll(/[/\\:*?"<>|]/g, "_");
}
