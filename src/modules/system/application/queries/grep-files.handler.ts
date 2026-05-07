import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { FilesystemPort, GrepMatch } from "../../domain/ports/filesystem.port";
import type { GrepFilesQuery } from "./grep-files.query";

export class GrepFilesHandler implements QueryHandler<GrepFilesQuery, GrepMatch[]> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(query: GrepFilesQuery): Promise<GrepMatch[]> {
    return this.filesystem.grep(query.input);
  }
}
