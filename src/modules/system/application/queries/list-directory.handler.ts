import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { FilesystemPort, FileEntry } from "../../domain/ports/filesystem.port";
import type { ListDirectoryQuery } from "./list-directory.query";

export class ListDirectoryHandler implements QueryHandler<ListDirectoryQuery, FileEntry[]> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(query: ListDirectoryQuery): Promise<FileEntry[]> {
    return this.filesystem.listDir(query.path);
  }
}
