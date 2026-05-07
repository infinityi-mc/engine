import type { Command } from "../../../../shared/application/command-bus";
import type { TerminalOptions } from "../../domain/ports/terminal.port";

export const EXECUTE_TERMINAL_COMMAND = "system.terminal.execute" as const;

export class ExecuteTerminalCommand implements Command<typeof EXECUTE_TERMINAL_COMMAND> {
  readonly type = EXECUTE_TERMINAL_COMMAND;

  constructor(readonly options: TerminalOptions) {}
}
