import type { Command } from "../../../../shared/application/command-bus";
import type { SedInput } from "../../domain/ports/filesystem.port";

export const SED_COMMAND = "system.files.sed" as const;

export class SedCommand implements Command<typeof SED_COMMAND> {
  readonly type = SED_COMMAND;

  constructor(readonly input: SedInput) {}
}
