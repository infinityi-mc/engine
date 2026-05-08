import type { CommandBus } from "../../../../shared/application/command-bus";
import type { QueryBus } from "../../../../shared/application/query-bus";
import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import { getErrorMessage } from "../../../../shared/observability/error-utils";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Router } from "../../../../shared/http/router";
import { parseJson, requiredString, optionalStringProperty, optionalStringArrayProperty, optionalRecordProperty } from "../../../../shared/http/route-helpers";
import { SCOPES } from "./scopes";
import { SpawnServerCommand } from "../../application/commands/spawn-server.command";
import { KillServerCommand } from "../../application/commands/kill-server.command";
import { ListServersQuery } from "../../application/queries/list-servers.query";
import { GetServerStatusQuery } from "../../application/queries/get-server-status.query";
import { ServerNotFoundError } from "../../domain/errors/server-not-found.error";
import { ServerAlreadyExistsError } from "../../domain/errors/server-already-exists.error";
import { ServerProcessError } from "../../domain/errors/server-process.error";
import type { ServerInstance } from "../../domain/types/server-instance";

export function registerServerRoutes(
  router: Router,
  commandBus: CommandBus,
  queryBus: QueryBus,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  router.post("/server/instances", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const id = requiredString(body, "id");

    if (!id.ok) {
      return id.response;
    }

    const command = requiredString(body, "command");

    if (!command.ok) {
      return command.response;
    }

    return handleErrors(async () => {
      const instance = await commandBus.execute<SpawnServerCommand, ServerInstance>(
        new SpawnServerCommand({
          id: id.value,
          command: command.value,
          ...optionalStringArrayProperty("args", body.args),
          ...optionalStringProperty("cwd", body.cwd),
          ...optionalRecordProperty("env", body.env),
        }),
      );

      return jsonResponse(serializeInstance(instance), { status: 201 });
    }, logger);
  }, SCOPES.INSTANCE_WRITE));

  router.delete("/server/instances/:id", guard.protect(async (_request, params) => {
    const instanceId = params.id!;

    return handleErrors(async () => {
      await commandBus.execute<KillServerCommand, void>(new KillServerCommand(instanceId));
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.INSTANCE_WRITE));

  router.get("/server/instances", guard.protect(async () => {
    return handleErrors(async () => {
      const instances = await queryBus.execute<ListServersQuery, ServerInstance[]>(new ListServersQuery());
      return jsonResponse({ instances: instances.map(serializeInstance) });
    }, logger);
  }, SCOPES.INSTANCE_READ));

  router.get("/server/instances/:id", guard.protect(async (_request, params) => {
    const instanceId = params.id!;

    return handleErrors(async () => {
      const instance = await queryBus.execute<GetServerStatusQuery, ServerInstance>(
        new GetServerStatusQuery(instanceId),
      );
      return jsonResponse(serializeInstance(instance));
    }, logger);
  }, SCOPES.INSTANCE_READ));
}

function serializeInstance(instance: ServerInstance): Record<string, unknown> {
  return {
    id: instance.id,
    pid: instance.pid,
    command: instance.command,
    args: instance.args,
    ...(instance.cwd !== undefined ? { cwd: instance.cwd } : {}),
    status: instance.status,
    startedAt: instance.startedAt.toISOString(),
    ...(instance.stoppedAt !== undefined ? { stoppedAt: instance.stoppedAt.toISOString() } : {}),
  };
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ServerNotFoundError) {
      return jsonResponse({ error: "ServerNotFound", instanceId: error.instanceId, message: error.message }, { status: 404 });
    }

    if (error instanceof ServerAlreadyExistsError) {
      return jsonResponse({ error: "ServerAlreadyExists", instanceId: error.instanceId, message: error.message }, { status: 409 });
    }

    if (error instanceof ServerProcessError) {
      return jsonResponse({ error: "ServerProcessError", instanceId: error.instanceId, message: error.message }, { status: 500 });
    }

    logger.error("http.unexpected_error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return jsonResponse({ error: "Internal Server Error" }, { status: 500 });
  }
}
