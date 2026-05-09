import type { LlmService } from "../../../llm/application/llm.service";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { AgentDefinition, AgentRunResult, AgentSession } from "../../domain/types/agent.types";
import type { ChatMessage } from "../../../llm/domain/ports/llm.types";

export interface SingleShotDeps {
  readonly llmService: LlmService;
  readonly logger: LoggerPort;
}

export class SingleShotRuntime {
  constructor(private readonly deps: SingleShotDeps) {}

  async run(
    session: AgentSession,
    definition: AgentDefinition,
  ): Promise<AgentRunResult> {
    try {
      const request: Parameters<typeof this.deps.llmService.complete>[0] = {
        messages: session.messages,
        ...(definition.model?.provider ? { provider: definition.model.provider } : {}),
        ...(definition.model?.model ? { model: definition.model.model } : {}),
        ...(definition.maxTokens !== undefined ? { maxTokens: definition.maxTokens } : {}),
        ...(definition.temperature !== undefined ? { temperature: definition.temperature } : {}),
      };
      const response = await this.deps.llmService.complete(request);

      // Append assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.content,
      };
      session.messages.push(assistantMessage);
      session.usage = response.usage;
      session.iterationCount = 1;
      session.status = "completed";
      session.completedAt = Date.now();

      this.deps.logger.info("agent.session_completed", {
        sessionId: session.sessionId,
        agentId: definition.id,
        status: session.status,
        totalIterations: 1,
        totalTokens: response.usage.totalTokens,
      });

      return {
        content: response.content,
        reasoning: response.reasoning,
        status: session.status,
        totalIterations: 1,
        usage: response.usage,
        stopReason: response.stopReason,
      };
    } catch (error) {
      session.status = "failed";
      session.completedAt = Date.now();
      throw error;
    }
  }
}
