import type { Command } from "../../../../shared/application/command-bus";

export const COPY_PATH_COMMAND = "system.files.copy" as const;

export class CopyPathCommand implements Command<typeof COPY_PATH_COMMAND> {
  readonly type = COPY_PATH_COMMAND;

  constructor(
    readonly source: string,
    readonly destination: string,
  ) {}
}
