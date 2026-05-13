import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Router } from "../../../../shared/http/router";
import { parseJson, requiredString } from "../../../../shared/http/route-helpers";
import { SCOPES } from "./scopes";
import type { AgentService } from "../../application/agent.service";
import {
  AgentNotFoundError,
  SessionNotFoundError,
  SessionNotResumableError,
  MaxIterationsReachedError,
  SessionTimeoutError,
} from "../../domain/errors/agent.errors";
import {
  ProviderApiError,
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "../../../llm/domain/errors/llm.errors";
import type { AgentDefinition, InvocationContext } from "../../domain/types/agent.types";
import { isValidUUID } from "../../../../shared/validation/uuid";

export function registerAgentRoutes(
  router: Router,
  agentService: AgentService,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  // POST /agent/run — Run an agent session
  router.post("/agent/run", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const agentId = requiredString(body, "agentId");

    if (!agentId.ok) {
      return agentId.response;
    }

    const message = requiredString(body, "message");

    if (!message.ok) {
      return message.response;
    }

    return handleErrors(async () => {
      const options: { maxIterations?: number; timeoutMs?: number; sessionId?: string } = {};

      if (typeof body.maxIterations === "number") {
        if (!Number.isFinite(body.maxIterations) || body.maxIterations < 1) {
          return jsonResponse({ error: "InvalidInput", field: "maxIterations", message: "maxIterations must be >= 1" }, { status: 400 });
        }
        options.maxIterations = body.maxIterations;
      }
      if (typeof body.timeoutMs === "number") {
        if (!Number.isFinite(body.timeoutMs) || body.timeoutMs < 1000) {
          return jsonResponse({ error: "InvalidInput", field: "timeoutMs", message: "timeoutMs must be >= 1000" }, { status: 400 });
        }
        options.timeoutMs = body.timeoutMs;
      }
      if (typeof body.sessionId === "string" && body.sessionId.length > 0) {
        if (!isValidUUID(body.sessionId)) {
          return jsonResponse({ error: "InvalidInput", field: "sessionId", message: "sessionId must be a valid UUID" }, { status: 400 });
        }
        options.sessionId = body.sessionId;
      }

      const rawCtx = typeof body.context === "object" && body.context !== null && !Array.isArray(body.context)
        ? body.context as Record<string, unknown>
        : undefined;
      const context: InvocationContext = {
        ...(typeof rawCtx?.serverId === "string" && rawCtx.serverId.length > 0
          ? { serverId: rawCtx.serverId }
          : {}),
        ...(typeof rawCtx?.playerName === "string" && rawCtx.playerName.length > 0
          ? { playerName: rawCtx.playerName }
          : {}),
      };

      const result = await agentService.run(agentId.value, message.value, options, context);

      return jsonResponse({
        sessionId: result.sessionId,
        content: result.content,
        reasoning: result.reasoning,
        status: result.status,
        totalIterations: result.totalIterations,
        usage: result.usage,
        stopReason: result.stopReason,
      });
    }, logger);
  }, SCOPES.AGENT_RUN));

  // GET /agent/agents — List available agent definitions
  router.get("/agent/agents", guard.protect(async () => {
    return handleErrors(async () => {
      const definitions = await agentService.listDefinitions();
      return jsonResponse({ agents: definitions.map(serializeDefinition) });
    }, logger);
  }, SCOPES.AGENT_LIST));

  // GET /agent/agents/:id — Get single agent definition
  router.get("/agent/agents/:id", guard.protect(async (_request, params) => {
    const agentId = params.id!;

    return handleErrors(async () => {
      const definition = await agentService.getDefinition(agentId);
      if (!definition) {
        return jsonResponse({ error: "AgentNotFound", agentId, message: `Agent not found: ${agentId}` }, { status: 404 });
      }
      return jsonResponse(serializeDefinition(definition));
    }, logger);
  }, SCOPES.AGENT_LIST));
}

function serializeDefinition(def: AgentDefinition): Record<string, unknown> {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    ...(def.model ? { model: def.model } : {}),
    tools: def.tools,
    runtime: def.runtime,
    ...(def.maxIterations !== undefined ? { maxIterations: def.maxIterations } : {}),
    ...(def.temperature !== undefined ? { temperature: def.temperature } : {}),
    ...(def.maxTokens !== undefined ? { maxTokens: def.maxTokens } : {}),
  };
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      return jsonResponse({ error: "AgentNotFound", agentId: error.agentId, message: error.message }, { status: 404 });
    }

    if (error instanceof SessionNotFoundError) {
      return jsonResponse({ error: "SessionNotFound", sessionId: error.sessionId, message: error.message }, { status: 404 });
    }

    if (error instanceof SessionNotResumableError) {
      return jsonResponse({ error: "SessionNotResumable", sessionId: error.sessionId, status: error.currentStatus, message: error.message }, { status: 409 });
    }

    if (error instanceof MaxIterationsReachedError) {
      return jsonResponse({
        sessionId: error.partialResult.sessionId,
        content: error.partialResult.content,
        reasoning: error.partialResult.reasoning,
        status: error.partialResult.status,
        totalIterations: error.partialResult.totalIterations,
        usage: error.partialResult.usage,
        stopReason: "max_iterations",
        warning: `Agent reached maximum iterations (${error.maxIterations})`,
      }, { status: 200 });
    }

    if (error instanceof SessionTimeoutError) {
      return jsonResponse({
        sessionId: error.partialResult.sessionId,
        content: error.partialResult.content,
        reasoning: error.partialResult.reasoning,
        status: error.partialResult.status,
        totalIterations: error.partialResult.totalIterations,
        usage: error.partialResult.usage,
        stopReason: "timeout",
        warning: `Agent session timed out after ${error.timeoutMs}ms`,
      }, { status: 200 });
    }

    if (error instanceof ProviderAuthError) {
      return jsonResponse({ error: "ProviderAuthError", message: error.message }, { status: 502 });
    }

    if (error instanceof ProviderRateLimitError) {
      return jsonResponse({ error: "ProviderRateLimitError", message: error.message }, { status: 502 });
    }

    if (error instanceof ProviderNotFoundError) {
      return jsonResponse({ error: "ProviderNotFoundError", message: error.message }, { status: 502 });
    }

    if (error instanceof ProviderApiError) {
      return jsonResponse({ error: "ProviderApiError", message: error.message }, { status: 502 });
    }

    if (error instanceof ProviderTimeoutError) {
      return jsonResponse({ error: "ProviderTimeoutError", message: error.message }, { status: 504 });
    }

    logger.error("http.unexpected_error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return jsonResponse({ error: "Internal Server Error" }, { status: 500 });
  }
}
