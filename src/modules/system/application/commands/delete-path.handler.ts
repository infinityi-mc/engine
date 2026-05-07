import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { FilesystemPort } from "../../domain/ports/filesystem.port";
import type { DeletePathCommand } from "./delete-path.command";

export class DeletePathHandler implements CommandHandler<DeletePathCommand, void> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(command: DeletePathCommand): Promise<void> {
    return this.filesystem.delete(command.path, command.recursive);
  }
}
