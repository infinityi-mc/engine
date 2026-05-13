import type { EventHandler } from "../../../../shared/application/event-bus";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { AgentService } from "../agent.service";
import type { MinecraftSessionManagerPort } from "../../../minecraft/domain/ports/minecraft-session-manager.port";
import type { MinecraftRateLimiterPort } from "../../../minecraft/domain/ports/minecraft-rate-limiter.port";
import type { MinecraftStdinPort } from "../../../minecraft/domain/ports/minecraft-stdin.port";
import type { MinecraftServerRepositoryPort } from "../../../minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftLogPatternMatched } from "../../../minecraft/domain/events/minecraft-log-pattern-matched.event";
import { MINECRAFT_LOG_PATTERN_MATCHED } from "../../../minecraft/domain/events/minecraft-log-pattern-matched.event";

const ACTION_INVOKE_AGENT = "invoke_agent";
const MC_CHAT_MAX_RESPONSE_LENGTH = 200;

interface TellrawPayload {
  agentName: string;
  playerName: string;
  tokenUsed: string;
  status: "Success" | "Error";
  response: string;
}

export interface MinecraftAgentEventHandlerDeps {
  readonly agentService: AgentService;
  readonly sessionManager: MinecraftSessionManagerPort;
  readonly rateLimiter: MinecraftRateLimiterPort;
  readonly stdin: MinecraftStdinPort;
  readonly repository: MinecraftServerRepositoryPort;
  readonly logger: LoggerPort;
}

export class MinecraftAgentEventHandler implements EventHandler<MinecraftLogPatternMatched> {
  constructor(private readonly deps: MinecraftAgentEventHandlerDeps) {}

  async handle(event: MinecraftLogPatternMatched): Promise<void> {
    if (event.action !== ACTION_INVOKE_AGENT) return;

    const { playerName, serverId, message } = event;
    const agentName = typeof event.payload?.agentName === "string" ? event.payload.agentName : "default";

    const rateLimit = this.deps.rateLimiter.isAllowed(playerName);
    if (!rateLimit.allowed) {
      const seconds = Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000);
      await this.sendTellraw(serverId, {
        agentName,
        playerName,
        tokenUsed: "N/A",
        status: "Error",
        response: `Please wait ${seconds}s before asking again.`,
      });
      return;
    }

    // Access control
    const server = await this.deps.repository.get(serverId);
    const agentAccess = server?.agents?.find((a) => a.id === agentName);

    if (!agentAccess) {
      await this.sendTellraw(serverId, {
        agentName,
        playerName,
        tokenUsed: "N/A",
        status: "Error",
        response: "Agent not available.",
      });
      return;
    }

    if (agentAccess.players && agentAccess.players.length > 0) {
      if (!agentAccess.players.includes(playerName)) {
        await this.sendTellraw(serverId, {
          agentName,
          playerName,
          tokenUsed: "N/A",
          status: "Error",
          response: "You don't have access to this agent.",
        });
        return;
      }
    }

    const definition = await this.deps.agentService.getDefinition(agentName);
    if (!definition) {
      await this.sendTellraw(serverId, {
        agentName,
        playerName,
        tokenUsed: "N/A",
        status: "Error",
        response: `Agent "${agentName}" not found.`,
      });
      return;
    }

    let session;
    try {
      session = await this.deps.sessionManager.get(serverId);
    } catch (error) {
      this.deps.logger.warn("minecraft.agent_handler.session_error", {
        module: "minecraft",
        operation: "agent_handler.session",
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendTellraw(serverId, {
        agentName,
        playerName,
        tokenUsed: "N/A",
        status: "Error",
        response: "Failed to load session.",
      });
      return;
    }

    try {
      const runOptions = {
        ...(session !== null ? { sessionId: session.sessionId } : {}),
      };
      const invocationContext = { serverId, playerName };
      const result = await this.deps.agentService.run(
        definition.id,
        message,
        runOptions,
        invocationContext,
      );

      // Track session for future calls
      this.deps.sessionManager.track(serverId, result.sessionId);

      // Trim session to message cap (agent service already saved it, so reload-trim-save)
      const updatedSession = await this.deps.sessionManager.get(serverId);
      if (updatedSession) {
        this.deps.sessionManager.trim(updatedSession);
        await this.deps.sessionManager.save(updatedSession);
      }

      await this.sendTellraw(serverId, {
        agentName,
        playerName,
        tokenUsed: String(result.usage.totalTokens),
        status: "Success",
        response: result.content || "(no response)",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.deps.logger.warn("minecraft.agent_handler.run_error", {
        module: "minecraft",
        operation: "agent_handler.run",
        serverId,
        playerName,
        agentName,
        error: errorMessage,
      });
      await this.sendTellraw(serverId, {
        agentName,
        playerName,
        tokenUsed: "N/A",
        status: "Error",
        response: "An error occurred processing your request.",
      });
    }
  }

  private async sendTellraw(
    serverId: string,
    payload: TellrawPayload,
  ): Promise<void> {
    const chunks = this.splitText(payload.response, MC_CHAT_MAX_RESPONSE_LENGTH);
    for (let i = 0; i < chunks.length; i++) {
      await this.sendSingleTellraw(serverId, { ...payload, response: chunks[i]! }, i === 0);
    }
  }

  private splitText(text: string, maxLength: number): string[] {
    const lines = text.split("\n");
    const chunks: string[] = [];

    for (const line of lines) {
      if (line.length === 0) continue;
      if (line.length <= maxLength) {
        chunks.push(line);
        continue;
      }

      let remaining = line;
      while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
          chunks.push(remaining);
          break;
        }

        let splitAt = remaining.lastIndexOf(" ", maxLength);
        if (splitAt <= 0) splitAt = maxLength;

        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
      }
    }

    return chunks;
  }

  private async sendSingleTellraw(
    serverId: string,
    payload: TellrawPayload,
    isFirstChunk: boolean,
  ): Promise<void> {
    try {
      const prefix = isFirstChunk
        ? {
            hover_event: {
              action: "show_text",
              value: [
                "",
                { color: "aqua", text: "Agent:" },
                { text: " " },
                { color: "gray", text: payload.agentName },
                { text: "\n" },
                { color: "green", text: "Token Used:" },
                { text: " " },
                { color: "gray", text: payload.tokenUsed },
                { text: "\n" },
                { color: "yellow", text: "Requested Player:" },
                { text: " " },
                { color: "gray", text: payload.playerName },
                { text: "\n" },
                { color: "red", text: "Status:" },
                { text: " " },
                { color: "gray", text: payload.status },
              ],
            },
            text: "[",
            extra: [{ color: "aqua", text: "AI" }, "]"],
          }
        : { text: "" };
      const json = JSON.stringify([
        "",
        prefix,
        { color: "gray", text: ` ${payload.response}` },
      ]);
      await this.deps.stdin.sendCommand(serverId, `tellraw @a ${json}`);
    } catch (error) {
      this.deps.logger.debug("minecraft.agent_handler.tellraw_error", {
        module: "minecraft",
        operation: "agent_handler.tellraw",
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
