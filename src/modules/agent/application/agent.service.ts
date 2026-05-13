import type { LlmService } from "../../llm/application/llm.service";
import type { ToolRegistryPort } from "../domain/ports/tool-registry.port";
import type { AgentDefinitionRepositoryPort } from "../domain/ports/agent-definition-repository.port";
import type { SessionRepositoryPort } from "../domain/ports/session-repository.port";
import type { LoggerPort } from "../../../shared/observability/logger.port";
import type { ConfigPort } from "../../../shared/config/config.port";
import type { ChatMessage } from "../../llm/domain/ports/llm.types";
import type { AgentDefinition, AgentRunResult, AgentSession, InvocationContext } from "../domain/types/agent.types";
import {
  AgentNotFoundError,
  SessionNotFoundError,
  SessionNotResumableError,
} from "../domain/errors/agent.errors";
import type { PromptBuilder } from "./prompt-builder";
import { ToolUseLoop } from "./runtime/tool-use-loop";
import { SingleShotRuntime } from "./runtime/single-shot";

export interface AgentServiceDeps {
  readonly llmService: LlmService;
  readonly toolRegistry: ToolRegistryPort;
  readonly agentDefinitions: AgentDefinitionRepositoryPort;
  readonly sessionRepository: SessionRepositoryPort;
  readonly config: ConfigPort;
  readonly logger: LoggerPort;
  readonly promptBuilder: PromptBuilder;
}

export interface RunOptions {
  maxIterations?: number;
  timeoutMs?: number;
  sessionId?: string;
}

export class AgentService {
  private readonly toolUseLoop: ToolUseLoop;
  private readonly singleShot: SingleShotRuntime;

  constructor(private readonly deps: AgentServiceDeps) {
    this.toolUseLoop = new ToolUseLoop({
      llmService: deps.llmService,
      toolRegistry: deps.toolRegistry,
      sessionRepository: deps.sessionRepository,
      logger: deps.logger,
    });

    this.singleShot = new SingleShotRuntime({
      llmService: deps.llmService,
      sessionRepository: deps.sessionRepository,
      logger: deps.logger,
    });
  }

  async run(agentId: string, userMessage: string, options?: RunOptions, context?: InvocationContext): Promise<AgentRunResult> {
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

    let session: AgentSession;

    if (options?.sessionId) {
      session = await this.resumeSession(options.sessionId, agentId, userMessage);
    } else {
      const resolvedPrompt = await this.deps.promptBuilder.build(definition, context ?? {});
      session = this.createSession(definition.id, resolvedPrompt, userMessage);
      await this.deps.sessionRepository.save(session);
    }

    this.deps.logger.info("agent.session_created", {
      sessionId: session.sessionId,
      agentId: definition.id,
      resumed: !!options?.sessionId,
    });

    if (definition.runtime === "single-shot") {
      return this.singleShot.run(session, definition);
    }

    return this.toolUseLoop.run(session, definition, maxIterations, timeoutMs, context);
  }

  async getDefinition(agentId: string): Promise<AgentDefinition | undefined> {
    return this.deps.agentDefinitions.get(agentId);
  }

  async listDefinitions(): Promise<AgentDefinition[]> {
    return this.deps.agentDefinitions.getAll();
  }

  private async resumeSession(
    sessionId: string,
    agentId: string,
    userMessage: string,
  ): Promise<AgentSession> {
    const session = await this.deps.sessionRepository.load(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    if (session.agentId !== agentId) {
      throw new SessionNotResumableError(sessionId, session.status);
    }

    if (session.status !== "completed" && session.status !== "failed") {
      throw new SessionNotResumableError(sessionId, session.status);
    }

    session.messages.push({ role: "user", content: userMessage });
    session.status = "active";
    session.completedAt = null;
    session.iterationCount = 0;

    await this.deps.sessionRepository.save(session);
    return session;
  }

  private createSession(agentId: string, systemPrompt: string, userMessage: string): AgentSession {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    return {
      sessionId: crypto.randomUUID(),
      agentId,
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
