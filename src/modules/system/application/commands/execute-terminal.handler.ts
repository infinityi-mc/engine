import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { TerminalPort, TerminalResult } from "../../domain/ports/terminal.port";
import type { ExecuteTerminalCommand } from "./execute-terminal.command";

export class ExecuteTerminalHandler implements CommandHandler<ExecuteTerminalCommand, TerminalResult> {
  constructor(private readonly terminal: TerminalPort) {}

  handle(command: ExecuteTerminalCommand): Promise<TerminalResult> {
    return this.terminal.execute(command.options);
  }
}
