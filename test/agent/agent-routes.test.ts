import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { Router } from "../../src/shared/http/router";
import { JwtGuard } from "../../src/shared/http/jwt-guard";
import { registerAgentRoutes } from "../../src/modules/agent/infrastructure/http/agent-routes";
import { SCOPES } from "../../src/modules/agent/infrastructure/http/scopes";
import type { AgentService } from "../../src/modules/agent/application/agent.service";
import type { AgentDefinition, AgentRunResult } from "../../src/modules/agent/domain/types/agent.types";
import type { TokenUsage } from "../../src/modules/llm/domain/ports/llm.types";
import { AgentNotFoundError } from "../../src/modules/agent/domain/errors/agent.errors";
import { MaxIterationsReachedError, SessionTimeoutError } from "../../src/modules/agent/domain/errors/agent.errors";
import {
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
} from "../../src/modules/llm/domain/errors/llm.errors";
import { noopLogger } from "../../src/shared/observability/logger.port";

const testSecret = "test-secret-key-for-agent-route-tests";

function makeToken(scope: string): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(testSecret));
}

const fakeUsage: TokenUsage = {
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 0,
  totalTokens: 30,
};

const fakeResult: AgentRunResult = {
  sessionId: "test-session-id",
  content: "Hello!",
  reasoning: "",
  status: "completed",
  totalIterations: 1,
  usage: fakeUsage,
  stopReason: "stop",
};

const testDefinition: AgentDefinition = {
  id: "test-agent",
  name: "Test Agent",
  description: "A test agent",
  systemPrompt: "You are a test agent.",
  tools: [],
  runtime: "tool-use-loop",
};

function makeRouter(agentService: Partial<AgentService>): { router: Router } {
  const router = new Router();
  const guard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
  const service = agentService as AgentService;
  registerAgentRoutes(router, service, guard, noopLogger);
  return { router };
}

describe("agent routes", () => {
  // POST /agent/run

  test("POST /agent/run returns 200 with result on success", async () => {
    const { router } = makeRouter({
      run: async () => fakeResult,
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.content).toBe("Hello!");
    expect(body.status).toBe("completed");
    expect(body.stopReason).toBe("stop");
  });

  test("POST /agent/run returns 400 when agentId is missing", async () => {
    const { router } = makeRouter({});
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  test("POST /agent/run returns 400 when message is missing", async () => {
    const { router } = makeRouter({});
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  test("POST /agent/run returns 400 when maxIterations < 1", async () => {
    const { router } = makeRouter({});
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello", maxIterations: 0 }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("InvalidInput");
  });

  test("POST /agent/run returns 400 when timeoutMs < 1000", async () => {
    const { router } = makeRouter({});
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello", timeoutMs: 500 }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("InvalidInput");
  });

  test("POST /agent/run returns 400 when sessionId is not a valid UUID", async () => {
    const { router } = makeRouter({});
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello", sessionId: "../../etc/evil" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("InvalidInput");
    expect(body.field).toBe("sessionId");
  });

  test("POST /agent/run returns 404 for AgentNotFoundError", async () => {
    const { router } = makeRouter({
      run: async () => { throw new AgentNotFoundError("missing-agent"); },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "missing-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("AgentNotFound");
    expect(body.agentId).toBe("missing-agent");
  });

  test("POST /agent/run returns 200 with max_iterations stop reason for MaxIterationsReachedError", async () => {
    const { router } = makeRouter({
      run: async () => {
        throw new MaxIterationsReachedError(5, {
          sessionId: "test-session-id",
          content: "partial",
          reasoning: "thinking",
          status: "active",
          totalIterations: 5,
          usage: fakeUsage,
          stopReason: "tool_calls",
        });
      },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.stopReason).toBe("max_iterations");
    expect(body.content).toBe("partial");
    expect(body.reasoning).toBe("thinking");
    expect(body.warning).toContain("5");
  });

  test("POST /agent/run returns 200 with timeout stop reason for SessionTimeoutError", async () => {
    const { router } = makeRouter({
      run: async () => {
        throw new SessionTimeoutError(60_000, {
          sessionId: "test-session-id",
          content: "partial",
          reasoning: "",
          status: "active",
          totalIterations: 3,
          usage: fakeUsage,
          stopReason: "tool_calls",
        });
      },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.stopReason).toBe("timeout");
    expect(body.warning).toContain("60000");
  });

  test("POST /agent/run returns 502 for ProviderAuthError", async () => {
    const { router } = makeRouter({
      run: async () => { throw new ProviderAuthError("Invalid API key"); },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(502);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("ProviderAuthError");
  });

  test("POST /agent/run returns 502 for ProviderRateLimitError", async () => {
    const { router } = makeRouter({
      run: async () => { throw new ProviderRateLimitError("Rate limited"); },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(502);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("ProviderRateLimitError");
  });

  test("POST /agent/run returns 502 for ProviderNotFoundError", async () => {
    const { router } = makeRouter({
      run: async () => { throw new ProviderNotFoundError("openai"); },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(502);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("ProviderNotFoundError");
  });

  test("POST /agent/run returns 500 for unexpected errors", async () => {
    const { router } = makeRouter({
      run: async () => { throw new Error("Something unexpected"); },
    });
    const token = await makeToken(SCOPES.AGENT_RUN);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("Internal Server Error");
  });

  test("POST /agent/run rejects without JWT", async () => {
    const { router } = makeRouter({});

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(401);
  });

  test("POST /agent/run rejects with insufficient scope", async () => {
    const { router } = makeRouter({});
    const token = await makeToken(SCOPES.AGENT_LIST);

    const response = await router.handle(new Request("http://localhost/agent/run", {
      method: "POST",
      body: JSON.stringify({ agentId: "test-agent", message: "Hello" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(403);
  });

  // GET /agent/agents

  test("GET /agent/agents returns list of definitions", async () => {
    const { router } = makeRouter({
      listDefinitions: async () => [testDefinition],
    });
    const token = await makeToken(SCOPES.AGENT_LIST);

    const response = await router.handle(new Request("http://localhost/agent/agents", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const agents = body.agents as AgentDefinition[];
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe("test-agent");
  });

  test("GET /agent/agents rejects without JWT", async () => {
    const { router } = makeRouter({});

    const response = await router.handle(new Request("http://localhost/agent/agents", {
      method: "GET",
    }));

    expect(response.status).toBe(401);
  });

  // GET /agent/agents/:id

  test("GET /agent/agents/:id returns definition when found", async () => {
    const { router } = makeRouter({
      getDefinition: async () => testDefinition,
    });
    const token = await makeToken(SCOPES.AGENT_LIST);

    const response = await router.handle(new Request("http://localhost/agent/agents/test-agent", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.id).toBe("test-agent");
    expect(body.name).toBe("Test Agent");
  });

  test("GET /agent/agents/:id returns 404 when not found", async () => {
    const { router } = makeRouter({
      getDefinition: async () => undefined,
    });
    const token = await makeToken(SCOPES.AGENT_LIST);

    const response = await router.handle(new Request("http://localhost/agent/agents/missing", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe("AgentNotFound");
  });

  test("GET /agent/agents/:id rejects without JWT", async () => {
    const { router } = makeRouter({});

    const response = await router.handle(new Request("http://localhost/agent/agents/test-agent", {
      method: "GET",
    }));

    expect(response.status).toBe(401);
  });
});
