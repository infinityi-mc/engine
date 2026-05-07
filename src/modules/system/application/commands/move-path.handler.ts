import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { FilesystemPort } from "../../domain/ports/filesystem.port";
import type { MovePathCommand } from "./move-path.command";

export class MovePathHandler implements CommandHandler<MovePathCommand, void> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(command: MovePathCommand): Promise<void> {
    return this.filesystem.move(command.source, command.destination);
  }
}
