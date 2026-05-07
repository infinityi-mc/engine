import type { Command } from "../../../../shared/application/command-bus";

export const MOVE_PATH_COMMAND = "system.files.move" as const;

export class MovePathCommand implements Command<typeof MOVE_PATH_COMMAND> {
  readonly type = MOVE_PATH_COMMAND;

  constructor(
    readonly source: string,
    readonly destination: string,
  ) {}
}
