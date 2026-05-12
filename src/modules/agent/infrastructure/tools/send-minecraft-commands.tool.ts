import type { MinecraftServerRepositoryPort } from "../../../minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../../minecraft/domain/ports/minecraft-stdin.port";
import type { MinecraftLogPort } from "../../../minecraft/domain/ports/minecraft-log.port";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Tool, ToolContext, ToolResult } from "../../domain/types/tool.types";
import { toolError, jsonOk, asObject } from "./tool-helpers";

const DEFAULT_FEEDBACK_TIMEOUT_MS = 500;
const MAX_COMMANDS = 16;

export class SendMinecraftCommandsTool implements Tool {
  readonly name = "send_minecraft_commands";
  readonly description =
    "Send one or more commands to a running Minecraft server and receive the output feedback. " +
    "Commands are executed sequentially. Returns the log output captured within a short window after each command.";
  readonly groups = ["minecraft"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      serverId: {
        type: "string",
        description: "The ID of the Minecraft server.",
      },
      commands: {
        type: "array",
        items: { type: "string" },
        description: `Commands to execute sequentially (max ${MAX_COMMANDS}). Each command is sent to the server's stdin.`,
        minItems: 1,
        maxItems: MAX_COMMANDS,
      },
    },
    required: ["serverId", "commands"],
  };

  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly stdin: MinecraftStdinPort,
    private readonly logPort: MinecraftLogPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const parsed = validateInput(input);
    if (!parsed.ok) return toolError(parsed.error);

    const { serverId, commands } = parsed.value;

    const server = await this.repository.get(serverId);
    if (server === undefined) {
      return toolError(`Minecraft server not found: ${serverId}`);
    }

    const instance = await this.serverRegistry.get(serverId);
    if (instance === undefined || instance.status !== "running") {
      return toolError(`Minecraft server is not running: ${serverId}`);
    }

    if (context?.agentId) {
      const agentAccess = server.agents?.find((a) => a.id === context.agentId);
      if (agentAccess?.commands && agentAccess.commands.length > 0) {
        const blocked = commands.filter((cmd) => isCommandBlocked(cmd, agentAccess.commands!));
        if (blocked.length > 0) {
          return toolError(
            `Commands blocked by server policy: ${blocked.map((c) => `"${c}"`).join(", ")}. ` +
            `Blocked prefixes: ${agentAccess.commands.join(", ")}`,
          );
        }
      }
    }

    const results = [];
    for (const command of commands) {
      const feedback = await this.executeWithFeedback(serverId, command);
      results.push(feedback);
    }

    this.logger.info("agent.tool.send_minecraft_commands.executed", {
      serverId,
      agentId: context?.agentId,
      commandCount: commands.length,
    });

    return jsonOk({ results });
  }

  private executeWithFeedback(
    serverId: string,
    command: string,
  ): Promise<{ command: string; feedback: string[] }> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      const unsubscribe = this.logPort.onLogLine(serverId, (line) => lines.push(line));

      this.stdin.sendCommand(serverId, command).then(() => {
        setTimeout(() => {
          unsubscribe();
          resolve({ command, feedback: lines });
        }, DEFAULT_FEEDBACK_TIMEOUT_MS);
      }).catch((error: unknown) => {
        unsubscribe();
        const message = error instanceof Error ? error.message : String(error);
        resolve({ command, feedback: [`[error] Failed to send command: ${message}`] });
      });
    });
  }
}

function isCommandBlocked(command: string, blacklist: readonly string[]): boolean {
  return blacklist.some((prefix) => command.startsWith(prefix));
}

function validateInput(
  input: unknown,
):
  | { ok: true; value: { serverId: string; commands: string[] } }
  | { ok: false; error: string } {
  const obj = asObject(input);
  if (!obj) return { ok: false, error: "Input must be an object." };

  if (typeof obj.serverId !== "string" || obj.serverId.length === 0) {
    return { ok: false, error: "Missing or invalid required field: serverId (non-empty string)." };
  }

  if (!Array.isArray(obj.commands) || obj.commands.length === 0) {
    return { ok: false, error: "Missing or invalid required field: commands (non-empty array)." };
  }

  if (obj.commands.length > MAX_COMMANDS) {
    return { ok: false, error: `Too many commands: ${obj.commands.length} (max ${MAX_COMMANDS}).` };
  }

  const commands: string[] = [];
  for (let i = 0; i < obj.commands.length; i++) {
    const cmd = obj.commands[i];
    if (typeof cmd !== "string" || cmd.length === 0) {
      return { ok: false, error: `commands[${i}] must be a non-empty string.` };
    }
    commands.push(cmd);
  }

  return { ok: true, value: { serverId: obj.serverId, commands } };
}
