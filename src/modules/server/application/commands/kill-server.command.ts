import type { Command } from "../../../../shared/application/command-bus";

export const KILL_SERVER_COMMAND = "server.instance.kill" as const;

export class KillServerCommand implements Command<typeof KILL_SERVER_COMMAND> {
  readonly type = KILL_SERVER_COMMAND;

  constructor(readonly instanceId: string) {}
}
