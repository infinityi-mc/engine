import type { LlmService } from "../../llm/application/llm.service";
import type { ToolRegistryPort } from "../domain/ports/tool-registry.port";
import type { AgentDefinitionRepositoryPort } from "../domain/ports/agent-definition-repository.port";
import type { LoggerPort } from "../../../shared/observability/logger.port";
import type { ConfigPort } from "../../../shared/config/config.port";
import type { ChatMessage } from "../../llm/domain/ports/llm.types";
import type { AgentDefinition, AgentRunResult, AgentSession } from "../domain/types/agent.types";
import { AgentNotFoundError } from "../domain/errors/agent.errors";
import { ToolUseLoop } from "./runtime/tool-use-loop";
import { SingleShotRuntime } from "./runtime/single-shot";

export interface AgentServiceDeps {
  readonly llmService: LlmService;
  readonly toolRegistry: ToolRegistryPort;
  readonly agentDefinitions: AgentDefinitionRepositoryPort;
  readonly config: ConfigPort;
  readonly logger: LoggerPort;
}

export interface RunOptions {
  maxIterations?: number;
  timeoutMs?: number;
}

export class AgentService {
  private readonly toolUseLoop: ToolUseLoop;
  private readonly singleShot: SingleShotRuntime;

  constructor(private readonly deps: AgentServiceDeps) {
    this.toolUseLoop = new ToolUseLoop({
      llmService: deps.llmService,
      toolRegistry: deps.toolRegistry,
      logger: deps.logger,
    });

    this.singleShot = new SingleShotRuntime({
      llmService: deps.llmService,
      logger: deps.logger,
    });
  }

  async run(agentId: string, userMessage: string, options?: RunOptions): Promise<AgentRunResult> {
    const definition = await this.deps.agentDefinitions.get(agentId);
    if (!definition) {
      throw new AgentNotFoundError(agentId);
    }

    const agentConfig = this.deps.config.getAgentConfig();
    const maxIterations = options?.maxIterations
      ?? definition.maxIterations
      ?? agentConfig?.defaultMaxIterations
      ?? 10;
    const timeoutMs = options?.timeoutMs
      ?? agentConfig?.defaultTimeoutMs
      ?? 300_000;

    const session = this.createSession(definition, userMessage);

    this.deps.logger.info("agent.session_created", {
      sessionId: session.sessionId,
      agentId: definition.id,
    });

    if (definition.runtime === "single-shot") {
      return this.singleShot.run(session, definition);
    }

    return this.toolUseLoop.run(session, definition, maxIterations, timeoutMs);
  }

  async getDefinition(agentId: string): Promise<AgentDefinition | undefined> {
    return this.deps.agentDefinitions.get(agentId);
  }

  async listDefinitions(): Promise<AgentDefinition[]> {
    return this.deps.agentDefinitions.getAll();
  }

  private createSession(definition: AgentDefinition, userMessage: string): AgentSession {
    const messages: ChatMessage[] = [
      { role: "system", content: definition.systemPrompt },
      { role: "user", content: userMessage },
    ];

    return {
      sessionId: crypto.randomUUID(),
      agentId: definition.id,
      messages,
      status: "active",
      createdAt: Date.now(),
      completedAt: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
      iterationCount: 0,
    };
  }
}
