import type { Command } from "../../../../shared/application/command-bus";

export const DELETE_PATH_COMMAND = "system.files.delete" as const;

export class DeletePathCommand implements Command<typeof DELETE_PATH_COMMAND> {
  readonly type = DELETE_PATH_COMMAND;

  constructor(
    readonly path: string,
    readonly recursive = false,
  ) {}
}
