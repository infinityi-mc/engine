import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { FilesystemPort } from "../../domain/ports/filesystem.port";
import type { GlobFilesQuery } from "./glob-files.query";

export class GlobFilesHandler implements QueryHandler<GlobFilesQuery, string[]> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(query: GlobFilesQuery): Promise<string[]> {
    return this.filesystem.glob(query.input);
  }
}
