import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { FilesystemPort } from "../../domain/ports/filesystem.port";
import type { TerminalResult } from "../../domain/ports/terminal.port";
import type { SedCommand } from "./sed.command";

export class SedHandler implements CommandHandler<SedCommand, TerminalResult> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(command: SedCommand): Promise<TerminalResult> {
    return this.filesystem.sed(command.input);
  }
}
