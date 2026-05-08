import type { Command } from "../../../../shared/application/command-bus";
import type { SpawnInput } from "../../domain/ports/server-process.port";

export const SPAWN_SERVER_COMMAND = "server.instance.spawn" as const;

export class SpawnServerCommand implements Command<typeof SPAWN_SERVER_COMMAND> {
  readonly type = SPAWN_SERVER_COMMAND;

  constructor(readonly input: SpawnInput) {}
}
