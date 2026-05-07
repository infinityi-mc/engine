import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { FilesystemPort, FileReadResult } from "../../domain/ports/filesystem.port";
import type { ReadFileQuery } from "./read-file.query";

export class ReadFileHandler implements QueryHandler<ReadFileQuery, FileReadResult> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(query: ReadFileQuery): Promise<FileReadResult> {
    return this.filesystem.readFile(query.input);
  }
}
