import path from "node:path";
import { CommandBus } from "../shared/application/command-bus";
import { QueryBus } from "../shared/application/query-bus";
import { JwtGuard } from "../shared/http/jwt-guard";
import { ConsoleLoggerAdapter } from "../shared/observability/console-logger.adapter";
import type { LoggerPort } from "../shared/observability/logger.port";
import { COPY_PATH_COMMAND } from "../modules/system/application/commands/copy-path.command";
import { CopyPathHandler } from "../modules/system/application/commands/copy-path.handler";
import { DELETE_PATH_COMMAND } from "../modules/system/application/commands/delete-path.command";
import { DeletePathHandler } from "../modules/system/application/commands/delete-path.handler";
import { EXECUTE_TERMINAL_COMMAND } from "../modules/system/application/commands/execute-terminal.command";
import { ExecuteTerminalHandler } from "../modules/system/application/commands/execute-terminal.handler";
import { MOVE_PATH_COMMAND } from "../modules/system/application/commands/move-path.command";
import { MovePathHandler } from "../modules/system/application/commands/move-path.handler";
import { SED_COMMAND } from "../modules/system/application/commands/sed.command";
import { SedHandler } from "../modules/system/application/commands/sed.handler";
import { AWK_QUERY } from "../modules/system/application/queries/awk.query";
import { AwkHandler } from "../modules/system/application/queries/awk.handler";
import { GLOB_FILES_QUERY } from "../modules/system/application/queries/glob-files.query";
import { GlobFilesHandler } from "../modules/system/application/queries/glob-files.handler";
import { GREP_FILES_QUERY } from "../modules/system/application/queries/grep-files.query";
import { GrepFilesHandler } from "../modules/system/application/queries/grep-files.handler";
import { LIST_DIRECTORY_QUERY } from "../modules/system/application/queries/list-directory.query";
import { ListDirectoryHandler } from "../modules/system/application/queries/list-directory.handler";
import { READ_FILE_QUERY } from "../modules/system/application/queries/read-file.query";
import { ReadFileHandler } from "../modules/system/application/queries/read-file.handler";
import { NodeSystemFilesAdapter } from "../modules/system/infrastructure/filesystem/node-system-files.adapter";
import { BunTerminalAdapter } from "../modules/system/infrastructure/terminal/bun-terminal.adapter";
import { SPAWN_SERVER_COMMAND } from "../modules/server/application/commands/spawn-server.command";
import { SpawnServerHandler } from "../modules/server/application/commands/spawn-server.handler";
import { KILL_SERVER_COMMAND } from "../modules/server/application/commands/kill-server.command";
import { KillServerHandler } from "../modules/server/application/commands/kill-server.handler";
import { LIST_SERVERS_QUERY } from "../modules/server/application/queries/list-servers.query";
import { ListServersHandler } from "../modules/server/application/queries/list-servers.handler";
import { GET_SERVER_STATUS_QUERY } from "../modules/server/application/queries/get-server-status.query";
import { GetServerStatusHandler } from "../modules/server/application/queries/get-server-status.handler";
import { BunServerProcessAdapter } from "../modules/server/infrastructure/process/bun-server-process.adapter";
import { InMemoryServerRegistryAdapter } from "../modules/server/infrastructure/registry/in-memory-server-registry.adapter";

import type { ServerProcessPort } from "../modules/server/domain/ports/server-process.port";
import type { ServerRegistryPort } from "../modules/server/domain/ports/server-registry.port";

export interface AppContainer {
  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;
  readonly guard: JwtGuard;
  readonly logger: LoggerPort;
  readonly serverProcess: ServerProcessPort;
  readonly serverRegistry: ServerRegistryPort;
}

export function createContainer(): AppContainer {
  const commandBus = new CommandBus();
  const queryBus = new QueryBus();
  const logger = new ConsoleLoggerAdapter();

  const jwtSecret = Bun.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.warn("JWT_SECRET environment variable is not set. Token verification will fail for all requests.");
  }

  const guard = new JwtGuard({
    secret: jwtSecret ?? "",
    issuer: Bun.env.JWT_ISSUER,
    audience: Bun.env.JWT_AUDIENCE,
  });

  const terminal = new BunTerminalAdapter(logger);
  const systemFiles = new NodeSystemFilesAdapter(terminal, logger);

  commandBus.register(COPY_PATH_COMMAND, new CopyPathHandler(systemFiles));
  commandBus.register(DELETE_PATH_COMMAND, new DeletePathHandler(systemFiles));
  commandBus.register(EXECUTE_TERMINAL_COMMAND, new ExecuteTerminalHandler(terminal));
  commandBus.register(MOVE_PATH_COMMAND, new MovePathHandler(systemFiles));
  commandBus.register(SED_COMMAND, new SedHandler(systemFiles));

  queryBus.register(AWK_QUERY, new AwkHandler(systemFiles));
  queryBus.register(GLOB_FILES_QUERY, new GlobFilesHandler(systemFiles));
  queryBus.register(GREP_FILES_QUERY, new GrepFilesHandler(systemFiles));
  queryBus.register(LIST_DIRECTORY_QUERY, new ListDirectoryHandler(systemFiles));
  queryBus.register(READ_FILE_QUERY, new ReadFileHandler(systemFiles));

  // Server module
  const pidDir = Bun.env.PID_DIR ?? path.join(process.cwd(), "pids");
  const serverProcess = new BunServerProcessAdapter(logger, pidDir);
  const serverRegistry = new InMemoryServerRegistryAdapter();

  commandBus.register(SPAWN_SERVER_COMMAND, new SpawnServerHandler(serverProcess, serverRegistry));
  commandBus.register(KILL_SERVER_COMMAND, new KillServerHandler(serverProcess, serverRegistry));

  queryBus.register(LIST_SERVERS_QUERY, new ListServersHandler(serverRegistry));
  queryBus.register(GET_SERVER_STATUS_QUERY, new GetServerStatusHandler(serverRegistry, serverProcess));

  return {
    commandBus,
    queryBus,
    guard,
    logger,
    serverProcess,
    serverRegistry,
  };
}
