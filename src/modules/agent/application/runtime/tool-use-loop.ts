import type { ChatMessage, CompletionResponse, ToolCall, ToolDefinition } from "../../../llm/domain/ports/llm.types";
import type { LlmService } from "../../../llm/application/llm.service";
import type { TokenUsage } from "../../../llm/domain/ports/llm.types";
import type { ToolRegistryPort } from "../../domain/ports/tool-registry.port";
import type { SessionRepositoryPort } from "../../domain/ports/session-repository.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { AgentDefinition, AgentRunResult, AgentSession, InvocationContext } from "../../domain/types/agent.types";
import {
  MaxIterationsReachedError,
  SessionTimeoutError,
} from "../../domain/errors/agent.errors";
import { saveSession } from "./save-session";

export interface ToolUseLoopDeps {
  readonly llmService: LlmService;
  readonly toolRegistry: ToolRegistryPort;
  readonly sessionRepository: SessionRepositoryPort;
  readonly logger: LoggerPort;
}

function addUsage(current: TokenUsage, incoming: TokenUsage): TokenUsage {
  return {
    inputTokens: current.inputTokens + incoming.inputTokens,
    outputTokens: current.outputTokens + incoming.outputTokens,
    reasoningTokens: current.reasoningTokens + incoming.reasoningTokens,
    totalTokens: current.totalTokens + incoming.totalTokens,
  };
}

export class ToolUseLoop {
  constructor(private readonly deps: ToolUseLoopDeps) {}

  async run(
    session: AgentSession,
    definition: AgentDefinition,
    maxIterations: number,
    timeoutMs: number,
    context?: InvocationContext,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const toolDefinitions = this.deps.toolRegistry.getDefinitions(definition.tools);

    while (session.iterationCount < maxIterations) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        session.status = "failed";
        session.completedAt = Date.now();
        await saveSession(this.deps.sessionRepository, session, this.deps.logger);
        const partial = this.buildResult(session, "timeout");
        throw new SessionTimeoutError(timeoutMs, partial);
      }

      this.deps.logger.debug("agent.iteration_started", {
        sessionId: session.sessionId,
        iteration: session.iterationCount + 1,
      });

      let response: CompletionResponse;
      try {
        const request: Parameters<typeof this.deps.llmService.complete>[0] = {
          messages: session.messages,
          ...(definition.model?.provider ? { provider: definition.model.provider } : {}),
          ...(definition.model?.model ? { model: definition.model.model } : {}),
          ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
          ...(definition.maxTokens !== undefined ? { maxTokens: definition.maxTokens } : {}),
          ...(definition.temperature !== undefined ? { temperature: definition.temperature } : {}),
        };
        response = await this.deps.llmService.complete(request);
      } catch (error) {
        session.status = "failed";
        session.completedAt = Date.now();
        try {
          await saveSession(this.deps.sessionRepository, session, this.deps.logger);
        } catch { /* swallow — don't mask the original error */ }
        throw error;
      }

      session.usage = addUsage(session.usage, response.usage);
      session.iterationCount++;

      // Append assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.content,
        ...(response.toolCalls && response.toolCalls.length > 0
          ? { toolCalls: response.toolCalls }
          : {}),
      };
      session.messages.push(assistantMessage);

      // No tool calls → final answer
      if (response.stopReason !== "tool_calls" || !response.toolCalls || response.toolCalls.length === 0) {
        session.status = "completed";
        session.completedAt = Date.now();
        await saveSession(this.deps.sessionRepository, session, this.deps.logger);

        this.deps.logger.info("agent.session_completed", {
          sessionId: session.sessionId,
          agentId: definition.id,
          status: session.status,
          totalIterations: session.iterationCount,
          totalTokens: session.usage.totalTokens,
        });

        return this.buildResult(session, response.stopReason);
      }

      // Execute tool calls in parallel
      const toolResultMessages = await this.executeToolCalls(response.toolCalls, session.sessionId, definition.id, context);

      // Append tool result messages
      session.messages.push(...toolResultMessages);

      // Eager save after each iteration
      await saveSession(this.deps.sessionRepository, session, this.deps.logger);
    }

    // Max iterations reached
    session.status = "failed";
    session.completedAt = Date.now();
    await saveSession(this.deps.sessionRepository, session, this.deps.logger);
    const partial = this.buildResult(session, "max_iterations");

    this.deps.logger.warn("agent.max_iterations_reached", {
      sessionId: session.sessionId,
      agentId: definition.id,
      maxIterations,
      totalTokens: session.usage.totalTokens,
    });

    throw new MaxIterationsReachedError(maxIterations, partial);
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    sessionId: string,
    agentId: string,
    context?: InvocationContext,
  ): Promise<ChatMessage[]> {
    const results = await Promise.allSettled(
      toolCalls.map((call) => this.executeSingleToolCall(call, sessionId, agentId, context)),
    );

    const messages: ChatMessage[] = [];
    for (let i = 0; i < results.length; i++) {
      const call = toolCalls[i];
      const result = results[i];

      if (!call || !result) continue;

      let output: string;
      let isError: boolean;

      if (result.status === "fulfilled") {
        output = result.value.output;
        isError = result.value.isError === true;
      } else {
        output = `Tool execution failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
        isError = true;
      }

      messages.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.function.name,
        content: output,
      });

      this.deps.logger.info("agent.tool_call_completed", {
        sessionId,
        toolName: call.function.name,
        isError,
      });
    }

    return messages;
  }

  private async executeSingleToolCall(
    call: ToolCall,
    sessionId: string,
    agentId: string,
    context?: InvocationContext,
  ): Promise<{ output: string; isError?: boolean }> {
    const toolName = call.function.name;
    const tool = this.deps.toolRegistry.get(toolName);

    if (!tool) {
      this.deps.logger.warn("agent.tool_not_found", {
        sessionId,
        toolName,
      });
      return {
        output: `Tool not found: ${toolName}`,
        isError: true,
      };
    }

    // Parse arguments
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      return {
        output: `Invalid JSON in tool arguments for ${toolName}: ${call.function.arguments}`,
        isError: true,
      };
    }

    this.deps.logger.debug("agent.tool_call_started", {
      sessionId,
      toolName,
    });

    return await tool.execute(input, {
      agentId,
      ...(context?.serverId !== undefined ? { serverId: context.serverId } : {}),
      ...(context?.playerName !== undefined ? { playerName: context.playerName } : {}),
    });
  }

  private buildResult(session: AgentSession, stopReason: string): AgentRunResult {
    let content = "";
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]!;
      if (msg.role === "assistant") {
        content = msg.content ?? "";
        break;
      }
    }

    return {
      sessionId: session.sessionId,
      content,
      reasoning: "",
      status: session.status,
      totalIterations: session.iterationCount,
      usage: session.usage,
      stopReason,
    };
  }
}
