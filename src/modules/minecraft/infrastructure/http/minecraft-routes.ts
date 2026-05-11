import type { CommandBus } from "../../../../shared/application/command-bus";
import type { QueryBus } from "../../../../shared/application/query-bus";
import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import { getErrorMessage } from "../../../../shared/observability/error-utils";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Router } from "../../../../shared/http/router";
import { parseJson, requiredString, optionalStringArrayProperty, isRecord } from "../../../../shared/http/route-helpers";
import { SCOPES } from "./scopes";
import { CreateMinecraftServerCommand } from "../../application/commands/create-minecraft-server.command";
import { StartMinecraftServerCommand } from "../../application/commands/start-minecraft-server.command";
import { StopMinecraftServerCommand } from "../../application/commands/stop-minecraft-server.command";
import { DeleteMinecraftServerCommand } from "../../application/commands/delete-minecraft-server.command";
import { SendMinecraftCommandCommand } from "../../application/commands/send-minecraft-command.command";
import { UpdateMinecraftServerCommand } from "../../application/commands/update-minecraft-server.command";
import type { MinecraftServerPatch } from "../../application/commands/update-minecraft-server.command";
import { ListMinecraftServersQuery } from "../../application/queries/list-minecraft-servers.query";
import { GetMinecraftServerQuery } from "../../application/queries/get-minecraft-server.query";
import { StreamMinecraftLogsQuery } from "../../application/queries/stream-minecraft-logs.query";
import type { MinecraftServer } from "../../domain/types/minecraft-server";
import { DEFAULT_SERVER_ARGS } from "../../domain/types/minecraft-server";
import type { MinecraftServerDetails } from "../../application/queries/get-minecraft-server.query";
import type { ServerInstance } from "../../../server/domain/types/server-instance";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerAlreadyExistsError } from "../../domain/errors/minecraft-server-already-exists.error";
import { MinecraftServerNotRunningError } from "../../domain/errors/minecraft-server-not-running.error";
import { MinecraftServerRunningError } from "../../domain/errors/minecraft-server-running.error";
import { ServerAlreadyExistsError } from "../../../server/domain/errors/server-already-exists.error";
import { ServerNotFoundError } from "../../../server/domain/errors/server-not-found.error";

export function registerMinecraftRoutes(
  router: Router,
  commandBus: CommandBus,
  queryBus: QueryBus,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  // POST /minecraft/servers — Create server definition
  router.post("/minecraft/servers", guard.protect(async (request) => {
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const body = parsed.body;
    const id = requiredString(body, "id");
    if (!id.ok) return id.response;

    const name = requiredString(body, "name");
    if (!name.ok) return name.response;

    const directory = requiredString(body, "directory");
    if (!directory.ok) return directory.response;

    const javaPath = requiredString(body, "javaPath");
    if (!javaPath.ok) return javaPath.response;

    const jarFile = requiredString(body, "jarFile");
    if (!jarFile.ok) return jarFile.response;

    return handleErrors(async () => {
      const jvmArgs = optionalStringArrayProperty("jvmArgs", body.jvmArgs);
      const serverArgs = optionalStringArrayProperty("serverArgs", body.serverArgs);
      const server: MinecraftServer = {
        id: id.value,
        name: name.value,
        directory: directory.value,
        javaPath: javaPath.value,
        jarFile: jarFile.value,
        jvmArgs: jvmArgs.jvmArgs ?? [],
        serverArgs: serverArgs.serverArgs ?? [...DEFAULT_SERVER_ARGS],
      };

      const created = await commandBus.execute<CreateMinecraftServerCommand, MinecraftServer>(
        new CreateMinecraftServerCommand(server),
      );

      return jsonResponse(serializeServer(created), { status: 201 });
    }, logger);
  }, SCOPES.SERVER_WRITE));

  // PATCH /minecraft/servers/:id — Update server definition (must be stopped)
  router.patch("/minecraft/servers/:id", guard.protect(async (request, params) => {
    const serverId = params.id!;
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    return handleErrors(async () => {
      const patch = parsePatch(parsed.body);
      const updated = await commandBus.execute<UpdateMinecraftServerCommand, MinecraftServer>(
        new UpdateMinecraftServerCommand(serverId, patch),
      );
      return jsonResponse(serializeServer(updated));
    }, logger);
  }, SCOPES.SERVER_WRITE));

  // GET /minecraft/servers — List all servers
  router.get("/minecraft/servers", guard.protect(async () => {
    return handleErrors(async () => {
      const servers = await queryBus.execute<ListMinecraftServersQuery, MinecraftServer[]>(
        new ListMinecraftServersQuery(),
      );
      return jsonResponse({ servers: servers.map(serializeServer) });
    }, logger);
  }, SCOPES.SERVER_READ));

  // GET /minecraft/servers/:id — Get server details + status
  router.get("/minecraft/servers/:id", guard.protect(async (_request, params) => {
    const serverId = params.id!;
    return handleErrors(async () => {
      const details = await queryBus.execute<GetMinecraftServerQuery, MinecraftServerDetails>(
        new GetMinecraftServerQuery(serverId),
      );
      return jsonResponse(serializeServerDetails(details));
    }, logger);
  }, SCOPES.SERVER_READ));

  // DELETE /minecraft/servers/:id — Delete server (kills if running)
  router.delete("/minecraft/servers/:id", guard.protect(async (_request, params) => {
    const serverId = params.id!;
    return handleErrors(async () => {
      await commandBus.execute<DeleteMinecraftServerCommand, void>(
        new DeleteMinecraftServerCommand(serverId),
      );
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.SERVER_WRITE));

  // POST /minecraft/servers/:id/start — Start server process
  router.post("/minecraft/servers/:id/start", guard.protect(async (_request, params) => {
    const serverId = params.id!;
    return handleErrors(async () => {
      const instance = await commandBus.execute<StartMinecraftServerCommand, ServerInstance>(
        new StartMinecraftServerCommand(serverId),
      );
      return jsonResponse(serializeInstance(instance), { status: 201 });
    }, logger);
  }, SCOPES.SERVER_WRITE));

  // POST /minecraft/servers/:id/stop — Stop server process
  router.post("/minecraft/servers/:id/stop", guard.protect(async (_request, params) => {
    const serverId = params.id!;
    return handleErrors(async () => {
      await commandBus.execute<StopMinecraftServerCommand, void>(
        new StopMinecraftServerCommand(serverId),
      );
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.SERVER_WRITE));

  // POST /minecraft/servers/:id/command — Send command to server stdin
  router.post("/minecraft/servers/:id/command", guard.protect(async (request, params) => {
    const serverId = params.id!;
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const command = requiredString(parsed.body, "command");
    if (!command.ok) return command.response;

    return handleErrors(async () => {
      await commandBus.execute<SendMinecraftCommandCommand, void>(
        new SendMinecraftCommandCommand(serverId, command.value),
      );
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.SERVER_WRITE));

  // GET /minecraft/servers/:id/logs — Stream logs (SSE)
  router.get("/minecraft/servers/:id/logs", guard.protect(async (_request, params) => {
    const serverId = params.id!;
    return handleErrors(async () => {
      const sseStream = await queryBus.execute<StreamMinecraftLogsQuery, ReadableStream<Uint8Array>>(
        new StreamMinecraftLogsQuery(serverId),
      );

      return new Response(sseStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }, logger);
  }, SCOPES.SERVER_READ));
}

function serializeServer(server: MinecraftServer): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    directory: server.directory,
    javaPath: server.javaPath,
    jarFile: server.jarFile,
    jvmArgs: server.jvmArgs,
    serverArgs: server.serverArgs,
    ...(server.players !== undefined ? { players: server.players } : {}),
    ...(server.agents !== undefined ? { agents: server.agents } : {}),
  };
}

function serializeServerDetails(details: MinecraftServerDetails): Record<string, unknown> {
  return {
    ...serializeServer(details),
    status: details.status,
    ...(details.pid !== undefined ? { pid: details.pid } : {}),
    ...(details.startedAt !== undefined ? { startedAt: details.startedAt.toISOString() } : {}),
    ...(details.stoppedAt !== undefined ? { stoppedAt: details.stoppedAt.toISOString() } : {}),
  };
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

function parsePatch(body: Record<string, unknown>): MinecraftServerPatch {
  let patch: MinecraftServerPatch = {};

  if (typeof body.name === "string") patch = { ...patch, name: body.name };
  if (typeof body.directory === "string") patch = { ...patch, directory: body.directory };
  if (typeof body.javaPath === "string") patch = { ...patch, javaPath: body.javaPath };
  if (typeof body.jarFile === "string") patch = { ...patch, jarFile: body.jarFile };

  const jvmArgs = optionalStringArrayProperty("jvmArgs", body.jvmArgs);
  if (jvmArgs.jvmArgs !== undefined) patch = { ...patch, jvmArgs: jvmArgs.jvmArgs };

  const serverArgs = optionalStringArrayProperty("serverArgs", body.serverArgs);
  if (serverArgs.serverArgs !== undefined) patch = { ...patch, serverArgs: serverArgs.serverArgs };

  if (isRecord(body.players)) {
    const teams = body.players.teams;
    if (isRecord(teams)) {
      patch = {
        ...patch,
        players: {
          teams: {
            ...(Array.isArray(teams.prefix) ? { prefix: teams.prefix.filter((s): s is string => typeof s === "string") } : {}),
            ...(Array.isArray(teams.suffix) ? { suffix: teams.suffix.filter((s): s is string => typeof s === "string") } : {}),
          },
        },
      };
    }
  }

  if (Array.isArray(body.agents)) {
    patch = {
      ...patch,
      agents: body.agents.filter(isRecord).map((a) => ({
        id: String(a.id),
        ...(Array.isArray(a.players) ? { players: a.players.filter((s): s is string => typeof s === "string") } : {}),
      })),
    };
  }

  return patch;
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof MinecraftServerNotFoundError) {
      return jsonResponse({ error: "MinecraftServerNotFound", serverId: error.serverId, message: error.message }, { status: 404 });
    }

    if (error instanceof MinecraftServerAlreadyExistsError) {
      return jsonResponse({ error: "MinecraftServerAlreadyExists", serverId: error.serverId, message: error.message }, { status: 409 });
    }

    if (error instanceof MinecraftServerNotRunningError) {
      return jsonResponse({ error: "MinecraftServerNotRunning", serverId: error.serverId, message: error.message }, { status: 409 });
    }

    if (error instanceof MinecraftServerRunningError) {
      return jsonResponse({ error: "MinecraftServerRunning", serverId: error.serverId, message: error.message }, { status: 409 });
    }

    if (error instanceof ServerAlreadyExistsError) {
      return jsonResponse({ error: "ServerAlreadyExists", instanceId: error.instanceId, message: error.message }, { status: 409 });
    }

    if (error instanceof ServerNotFoundError) {
      return jsonResponse({ error: "ServerNotFound", instanceId: error.instanceId, message: error.message }, { status: 404 });
    }

    logger.error("minecraft.http.unexpected_error", {
      module: "minecraft",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return jsonResponse({ error: "Internal Server Error" }, { status: 500 });
  }
}
