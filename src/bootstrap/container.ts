import path from "node:path";
import { CommandBus } from "../shared/application/command-bus";
import { EventBus } from "../shared/application/event-bus";
import { QueryBus } from "../shared/application/query-bus";
import { ConfigAdapter } from "../shared/config/config.adapter";
import type { ConfigPort } from "../shared/config/config.port";
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
import { SERVER_PROCESS_EXITED } from "../modules/server/domain/events/server-process-exited.event";
import { ServerRegistryStatusSyncHandler } from "../modules/server/application/events/server-registry-status-sync.handler";

import type { ServerProcessPort } from "../modules/server/domain/ports/server-process.port";
import type { ServerRegistryPort } from "../modules/server/domain/ports/server-registry.port";
import { CREATE_MINECRAFT_SERVER_COMMAND } from "../modules/minecraft/application/commands/create-minecraft-server.command";
import { CreateMinecraftServerHandler } from "../modules/minecraft/application/commands/create-minecraft-server.handler";
import { START_MINECRAFT_SERVER_COMMAND } from "../modules/minecraft/application/commands/start-minecraft-server.command";
import { StartMinecraftServerHandler } from "../modules/minecraft/application/commands/start-minecraft-server.handler";
import { STOP_MINECRAFT_SERVER_COMMAND } from "../modules/minecraft/application/commands/stop-minecraft-server.command";
import { StopMinecraftServerHandler } from "../modules/minecraft/application/commands/stop-minecraft-server.handler";
import { DELETE_MINECRAFT_SERVER_COMMAND } from "../modules/minecraft/application/commands/delete-minecraft-server.command";
import { DeleteMinecraftServerHandler } from "../modules/minecraft/application/commands/delete-minecraft-server.handler";
import { SEND_MINECRAFT_COMMAND_COMMAND } from "../modules/minecraft/application/commands/send-minecraft-command.command";
import { SendMinecraftCommandHandler } from "../modules/minecraft/application/commands/send-minecraft-command.handler";
import { UPDATE_MINECRAFT_SERVER_COMMAND } from "../modules/minecraft/application/commands/update-minecraft-server.command";
import { UpdateMinecraftServerHandler } from "../modules/minecraft/application/commands/update-minecraft-server.handler";
import { LIST_MINECRAFT_SERVERS_QUERY } from "../modules/minecraft/application/queries/list-minecraft-servers.query";
import { ListMinecraftServersHandler } from "../modules/minecraft/application/queries/list-minecraft-servers.handler";
import { GET_MINECRAFT_SERVER_QUERY } from "../modules/minecraft/application/queries/get-minecraft-server.query";
import { GetMinecraftServerHandler } from "../modules/minecraft/application/queries/get-minecraft-server.handler";
import { STREAM_MINECRAFT_LOGS_QUERY } from "../modules/minecraft/application/queries/stream-minecraft-logs.query";
import { StreamMinecraftLogsHandler } from "../modules/minecraft/application/queries/stream-minecraft-logs.handler";
import { GET_SERVER_METADATA_QUERY } from "../modules/minecraft/application/queries/get-server-metadata.query";
import { GetServerMetadataHandler } from "../modules/minecraft/application/queries/get-server-metadata.handler";
import { JsonMinecraftServerRepositoryAdapter } from "../modules/minecraft/infrastructure/persistence/json-minecraft-server-repository.adapter";
import { BunMinecraftStdinAdapter } from "../modules/minecraft/infrastructure/process/bun-minecraft-stdin.adapter";
import { BunMinecraftLogAdapter } from "../modules/minecraft/infrastructure/process/bun-minecraft-log.adapter";
import { waitForProcessExit } from "../modules/minecraft/infrastructure/process/wait-for-exit";
import { InMemoryPatternRegistryAdapter } from "../modules/minecraft/infrastructure/registry/in-memory-pattern-registry.adapter";
import { MinecraftLogListener } from "../modules/minecraft/infrastructure/listeners/minecraft-log.listener";

import type { MinecraftServerRepositoryPort } from "../modules/minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../modules/minecraft/domain/ports/minecraft-stdin.port";
import type { MinecraftLogPort } from "../modules/minecraft/domain/ports/minecraft-log.port";
import type { LlmService as LlmServiceType } from "../modules/llm/application/llm.service";
import type { LlmProviderPort } from "../modules/llm/domain/ports/llm-provider.port";
import { AnthropicAdapter } from "../modules/llm/infrastructure/providers/anthropic.adapter";
import { OpenAICompatAdapter } from "../modules/llm/infrastructure/providers/openai-compat.adapter";
import { GeminiAdapter } from "../modules/llm/infrastructure/providers/gemini.adapter";
import { LlmService } from "../modules/llm/application/llm.service";
import type { AgentService as AgentServiceType } from "../modules/agent/application/agent.service";
import type { ToolRegistryPort } from "../modules/agent/domain/ports/tool-registry.port";
import { InMemoryToolRegistry } from "../modules/agent/infrastructure/registry/tool-registry.adapter";
import { ConfigAgentDefinitionRepository } from "../modules/agent/infrastructure/persistence/agent-definition-repository.adapter";
import { RunPythonTool } from "../modules/agent/infrastructure/tools/run-python.tool";
import { ReadMinecraftLogsTool } from "../modules/agent/infrastructure/tools/read-minecraft-logs.tool";
import { MinecraftMetadataTool } from "../modules/agent/infrastructure/tools/minecraft-metadata.tool";
import { AgentService } from "../modules/agent/application/agent.service";
import { FileSessionRepository } from "../modules/agent/infrastructure/persistence/file-session-repository.adapter";
import { MinecraftSessionManagerAdapter } from "../modules/agent/infrastructure/session/minecraft-session-manager.adapter";
import { MinecraftAgentEventHandler } from "../modules/agent/application/events/minecraft-agent-event.handler";
import type { SessionRepositoryPort } from "../modules/agent/domain/ports/session-repository.port";
import { MinecraftRateLimiterAdapter } from "../modules/minecraft/infrastructure/rate-limit/minecraft-rate-limiter.adapter";
import { MINECRAFT_LOG_PATTERN_MATCHED } from "../modules/minecraft/domain/events/minecraft-log-pattern-matched.event";
import { FileMcdocLoader } from "../modules/mcdoc/infrastructure/persistence/file-mcdoc-loader";
import { McdocRepository } from "../modules/mcdoc/application/mcdoc-repository";
import { MCDOC_META_QUERY } from "../modules/mcdoc/application/queries/mcdoc-meta.query";
import { McdocMetaHandler } from "../modules/mcdoc/application/queries/mcdoc-meta.query";
import { LIST_MCDOC_PACKAGES_QUERY, ListMcdocPackagesHandler } from "../modules/mcdoc/application/queries/list-mcdoc-packages.query";
import { SEARCH_MCDOC_QUERY, SearchMcdocHandler } from "../modules/mcdoc/application/queries/search-mcdoc.query";
import { GET_MCDOC_SCHEMA_QUERY, GetMcdocSchemaHandler } from "../modules/mcdoc/application/queries/get-mcdoc-schema.query";
import { GREP_MCDOC_FIELDS_QUERY, GrepMcdocFieldsHandler } from "../modules/mcdoc/application/queries/grep-mcdoc-fields.query";
import { FIND_MCDOC_REFERENCES_QUERY, FindMcdocReferencesHandler } from "../modules/mcdoc/application/queries/find-mcdoc-references.query";
import {
  McdocMetaTool,
  McdocListPackagesTool,
  McdocSearchTool,
  McdocGetTool,
  McdocGrepFieldsTool,
  McdocFindReferencesTool,
} from "../modules/agent/infrastructure/tools/mcdoc-tools";
import type { McdocRepositoryPort } from "../modules/mcdoc/domain/ports/mcdoc-repository.port";
import { PrismarineNbtAdapter } from "../modules/minecraft/infrastructure/nbt/prismarine-nbt.adapter";
import { FileSystemServerMetadataAdapter } from "../modules/minecraft/infrastructure/metadata/server-metadata.adapter";
import {
  NbtReadTool,
  NbtGetTool,
  NbtSearchTool,
  NbtKeysTool,
  NbtStructureTool,
} from "../modules/agent/infrastructure/tools/nbt-tools";
import { SendMinecraftCommandsTool } from "../modules/agent/infrastructure/tools/send-minecraft-commands.tool";

export interface AppContainer {
  readonly commandBus: CommandBus;
  readonly eventBus: EventBus;
  readonly queryBus: QueryBus;
  readonly guard: JwtGuard;
  readonly logger: LoggerPort;
  readonly config: ConfigPort;
  readonly serverProcess: ServerProcessPort;
  readonly serverRegistry: ServerRegistryPort;
  readonly minecraftRepository: MinecraftServerRepositoryPort;
  readonly minecraftStdin: MinecraftStdinPort;
  readonly minecraftLog: MinecraftLogPort;
  readonly llmService: LlmServiceType;
  readonly agentService: AgentServiceType;
  readonly toolRegistry: ToolRegistryPort;
  readonly sessionRepository: SessionRepositoryPort;
  readonly mcdocRepository: McdocRepositoryPort;
}

export async function createContainer(): Promise<AppContainer> {
  const commandBus = new CommandBus();
  const eventBus = new EventBus();
  const queryBus = new QueryBus();
  const logger = new ConsoleLoggerAdapter();

  const configPath = path.join(process.cwd(), "config.yaml");
  const config = new ConfigAdapter({ configPath, logger });

  const jwtSecret = Bun.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.warn(
      "JWT_SECRET environment variable is not set. Token verification will fail for all requests.",
    );
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
  commandBus.register(
    EXECUTE_TERMINAL_COMMAND,
    new ExecuteTerminalHandler(terminal),
  );
  commandBus.register(MOVE_PATH_COMMAND, new MovePathHandler(systemFiles));
  commandBus.register(SED_COMMAND, new SedHandler(systemFiles));

  queryBus.register(AWK_QUERY, new AwkHandler(systemFiles));
  queryBus.register(GLOB_FILES_QUERY, new GlobFilesHandler(systemFiles));
  queryBus.register(GREP_FILES_QUERY, new GrepFilesHandler(systemFiles));
  queryBus.register(
    LIST_DIRECTORY_QUERY,
    new ListDirectoryHandler(systemFiles),
  );
  queryBus.register(READ_FILE_QUERY, new ReadFileHandler(systemFiles));

  // Server module
  const pidDir = Bun.env.PID_DIR ?? path.join(process.cwd(), "data/pids");
  const serverProcess = new BunServerProcessAdapter(logger, pidDir, eventBus);
  const serverRegistry = new InMemoryServerRegistryAdapter();

  eventBus.subscribe(SERVER_PROCESS_EXITED, new ServerRegistryStatusSyncHandler(serverRegistry, logger));

  commandBus.register(
    SPAWN_SERVER_COMMAND,
    new SpawnServerHandler(serverProcess, serverRegistry),
  );
  commandBus.register(
    KILL_SERVER_COMMAND,
    new KillServerHandler(serverProcess, serverRegistry),
  );

  queryBus.register(LIST_SERVERS_QUERY, new ListServersHandler(serverRegistry));
  queryBus.register(
    GET_SERVER_STATUS_QUERY,
    new GetServerStatusHandler(serverRegistry),
  );

  // Minecraft module
  const dataDir = Bun.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const minecraftRepository = new JsonMinecraftServerRepositoryAdapter(
    logger,
    dataDir,
  );
  const minecraftStdin = new BunMinecraftStdinAdapter(serverProcess);
  const minecraftLog = new BunMinecraftLogAdapter(serverProcess, logger);
  const minecraftWaitForExit = waitForProcessExit(serverProcess);
  const patternRegistry = new InMemoryPatternRegistryAdapter();
  const minecraftLogListener = new MinecraftLogListener(minecraftLog, patternRegistry, eventBus, minecraftRepository, logger);

  patternRegistry.register("@ai", { action: "invoke_agent", payload: { agentName: "minecraft-ingame" } });

  const nbtAdapter = new PrismarineNbtAdapter(logger);
  const serverMetadata = new FileSystemServerMetadataAdapter(nbtAdapter, logger);

  commandBus.register(
    CREATE_MINECRAFT_SERVER_COMMAND,
    new CreateMinecraftServerHandler(minecraftRepository),
  );
  commandBus.register(
    UPDATE_MINECRAFT_SERVER_COMMAND,
    new UpdateMinecraftServerHandler(minecraftRepository, serverRegistry, minecraftLogListener),
  );
  commandBus.register(
    START_MINECRAFT_SERVER_COMMAND,
    new StartMinecraftServerHandler(
      minecraftRepository,
      serverProcess,
      serverRegistry,
      minecraftLogListener,
    ),
  );
  commandBus.register(
    STOP_MINECRAFT_SERVER_COMMAND,
    new StopMinecraftServerHandler(
      minecraftRepository,
      serverProcess,
      serverRegistry,
      minecraftStdin,
      minecraftWaitForExit,
      minecraftLogListener,
    ),
  );
  commandBus.register(
    DELETE_MINECRAFT_SERVER_COMMAND,
    new DeleteMinecraftServerHandler(minecraftRepository, commandBus),
  );
  commandBus.register(
    SEND_MINECRAFT_COMMAND_COMMAND,
    new SendMinecraftCommandHandler(
      minecraftRepository,
      serverRegistry,
      minecraftStdin,
    ),
  );

  queryBus.register(
    LIST_MINECRAFT_SERVERS_QUERY,
    new ListMinecraftServersHandler(minecraftRepository),
  );
  queryBus.register(
    GET_MINECRAFT_SERVER_QUERY,
    new GetMinecraftServerHandler(minecraftRepository, serverRegistry),
  );
  queryBus.register(
    STREAM_MINECRAFT_LOGS_QUERY,
    new StreamMinecraftLogsHandler(
      minecraftRepository,
      serverRegistry,
      minecraftLog,
    ),
  );
  queryBus.register(
    GET_SERVER_METADATA_QUERY,
    new GetServerMetadataHandler(minecraftRepository, serverMetadata),
  );

  // LLM module
  const providers = new Map<string, LlmProviderPort>();
  const llmConfig = config.getLlmConfig();
  for (const [name, providerConfig] of Object.entries(llmConfig.providers)) {
    switch (name) {
      case "anthropic":
        providers.set(
          name,
          new AnthropicAdapter({
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
          }),
        );
        break;
      case "google":
        providers.set(
          name,
          new GeminiAdapter({
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
          }),
        );
        break;
      default:
        // All other providers are OpenAI-compatible (openai, openrouter, lmstudio, ollama, groq, etc.)
        providers.set(
          name,
          new OpenAICompatAdapter({
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
          }),
        );
        break;
    }
  }

  const llmService = new LlmService(providers, config, logger);

  // Mcdoc module — loads + indexes the Minecraft schema registry at startup.
  const mcdocLoader = new FileMcdocLoader({
    symbolPath: path.join(dataDir, "minecraft", "symbol.json"),
    indexDir: path.join(dataDir, "minecraft", "mcdoc-index"),
    logger,
  });
  const mcdocRepository = await McdocRepository.create(mcdocLoader, logger);

  queryBus.register(MCDOC_META_QUERY, new McdocMetaHandler(mcdocRepository));
  queryBus.register(LIST_MCDOC_PACKAGES_QUERY, new ListMcdocPackagesHandler(mcdocRepository));
  queryBus.register(SEARCH_MCDOC_QUERY, new SearchMcdocHandler(mcdocRepository));
  queryBus.register(GET_MCDOC_SCHEMA_QUERY, new GetMcdocSchemaHandler(mcdocRepository));
  queryBus.register(GREP_MCDOC_FIELDS_QUERY, new GrepMcdocFieldsHandler(mcdocRepository));
  queryBus.register(FIND_MCDOC_REFERENCES_QUERY, new FindMcdocReferencesHandler(mcdocRepository));

  // Agent module
  const toolRegistry = new InMemoryToolRegistry(logger);
  toolRegistry.register(new RunPythonTool(terminal, logger));
  toolRegistry.register(new ReadMinecraftLogsTool(minecraftRepository, logger));
  toolRegistry.register(new McdocMetaTool(mcdocRepository, logger));
  toolRegistry.register(new McdocListPackagesTool(mcdocRepository, logger));
  toolRegistry.register(new McdocSearchTool(mcdocRepository, logger));
  toolRegistry.register(new McdocGetTool(mcdocRepository, logger));
  toolRegistry.register(new McdocGrepFieldsTool(mcdocRepository, logger));
  toolRegistry.register(new McdocFindReferencesTool(mcdocRepository, logger));
  toolRegistry.register(new NbtReadTool(nbtAdapter, logger));
  toolRegistry.register(new NbtGetTool(nbtAdapter, logger));
  toolRegistry.register(new NbtSearchTool(nbtAdapter, logger));
  toolRegistry.register(new NbtKeysTool(nbtAdapter, logger));
  toolRegistry.register(new NbtStructureTool(nbtAdapter, logger));
  toolRegistry.register(new MinecraftMetadataTool(queryBus, logger));
  toolRegistry.register(new SendMinecraftCommandsTool(minecraftRepository, minecraftStdin, minecraftLog, serverRegistry, logger));

  const agentDefinitions = new ConfigAgentDefinitionRepository(config, toolRegistry, logger);
  const sessionRepository = new FileSessionRepository({
    dataDir: path.join(dataDir, "sessions"),
    logger,
  });
  const agentService = new AgentService({
    llmService,
    toolRegistry,
    agentDefinitions,
    sessionRepository,
    config,
    logger,
  });

  // Minecraft agent integration
  const minecraftAgentConfig = config.getMinecraftAgentConfig();
  const minecraftSessionManager = new MinecraftSessionManagerAdapter({
    sessionRepository,
    messageCap: minecraftAgentConfig.messageCap,
    sessionTtlMs: minecraftAgentConfig.sessionTtlMs,
  });
  const minecraftRateLimiter = new MinecraftRateLimiterAdapter(minecraftAgentConfig.playerCooldownMs);
  const minecraftAgentEventHandler = new MinecraftAgentEventHandler({
    agentService,
    sessionManager: minecraftSessionManager,
    rateLimiter: minecraftRateLimiter,
    stdin: minecraftStdin,
    repository: minecraftRepository,
    logger,
  });
  eventBus.subscribe(MINECRAFT_LOG_PATTERN_MATCHED, minecraftAgentEventHandler);

  return {
    commandBus,
    eventBus,
    queryBus,
    guard,
    logger,
    config,
    serverProcess,
    serverRegistry,
    minecraftRepository,
    minecraftStdin,
    minecraftLog,
    llmService,
    agentService,
    toolRegistry,
    sessionRepository,
    mcdocRepository,
  };
}
