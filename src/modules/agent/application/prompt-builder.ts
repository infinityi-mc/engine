import type {
  AgentDefinition,
  ContextBlockConfig,
  InvocationContext,
} from "../domain/types/agent.types";
import type { MinecraftServerRepositoryPort } from "../../minecraft/domain/ports/minecraft-server-repository.port";
import type { LoggerPort } from "../../../shared/observability/logger.port";

export interface ResolvedContextBlock {
  readonly type: string;
  readonly label: string;
  readonly content: string;
}

export interface PromptBuilderDeps {
  readonly minecraftRepository: MinecraftServerRepositoryPort;
  readonly logger: LoggerPort;
}

export class PromptBuilder {
  constructor(private readonly deps: PromptBuilderDeps) {}

  /**
   * Assemble the final system prompt from the agent's base prompt +
   * any declared context blocks resolved against the invocation context.
   *
   * Blocks that cannot resolve (e.g. "server" without a serverId) are
   * silently skipped so the prompt degrades gracefully.
   */
  async build(
    definition: AgentDefinition,
    invocation: InvocationContext,
  ): Promise<string> {
    if (!definition.context || definition.context.length === 0) {
      return definition.systemPrompt;
    }

    const blocks: ResolvedContextBlock[] = [];

    for (const blockConfig of definition.context) {
      const resolved = await this.resolveBlock(blockConfig, invocation);
      if (resolved !== null) {
        blocks.push(resolved);
      }
    }

    if (blocks.length === 0) {
      return definition.systemPrompt;
    }

    const contextSection = blocks
      .map((b) => `## ${b.label}\n${b.content}`)
      .join("\n\n");

    return `${definition.systemPrompt}\n\n---\n\n# Runtime Context\n\n${contextSection}`;
  }

  private async resolveBlock(
    config: ContextBlockConfig,
    ctx: InvocationContext,
  ): Promise<ResolvedContextBlock | null> {
    switch (config.type) {
      case "server":
        return this.resolveServerBlock(ctx);
      case "player":
        return this.resolvePlayerBlock(ctx);
      case "timestamp":
        return this.resolveTimestampBlock();
      default:
        this.deps.logger.warn("prompt_builder.unknown_context_type", {
          type: config.type,
        });
        return null;
    }
  }

  private async resolveServerBlock(
    ctx: InvocationContext,
  ): Promise<ResolvedContextBlock | null> {
    if (!ctx.serverId) return null;

    const safeId = sanitizeContextValue(ctx.serverId);
    const server = await this.deps.minecraftRepository.get(ctx.serverId);

    return {
      type: "server",
      label: "Current Server",
      content: server
        ? `Server ID: ${safeId}\nServer Name: ${sanitizeContextValue(server.name)}`
        : `Server ID: ${safeId}`,
    };
  }

  private resolvePlayerBlock(
    ctx: InvocationContext,
  ): ResolvedContextBlock | null {
    if (!ctx.playerName) return null;

    return {
      type: "player",
      label: "You are talking with",
      content: `${sanitizeContextValue(ctx.playerName)}`,
    };
  }

  private resolveTimestampBlock(): ResolvedContextBlock {
    return {
      type: "timestamp",
      label: "Current Time",
      content: new Date().toISOString(),
    };
  }
}

/** Max length for context values interpolated into the system prompt. */
const MAX_CONTEXT_VALUE_LENGTH = 128;

/**
 * Strip newlines, control characters, and leading/trailing whitespace from
 * an untrusted context value before it is interpolated into the system prompt.
 * Prevents callers from injecting markdown headings or instruction-like text
 * into the prompt structure.
 */
function sanitizeContextValue(value: string): string {
  const cleaned = value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return cleaned.length > MAX_CONTEXT_VALUE_LENGTH
    ? cleaned.slice(0, MAX_CONTEXT_VALUE_LENGTH)
    : cleaned;
}
