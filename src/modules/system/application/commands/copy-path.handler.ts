import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { FilesystemPort } from "../../domain/ports/filesystem.port";
import type { CopyPathCommand } from "./copy-path.command";

export class CopyPathHandler implements CommandHandler<CopyPathCommand, void> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(command: CopyPathCommand): Promise<void> {
    return this.filesystem.copy(command.source, command.destination);
  }
}
