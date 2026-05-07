import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { FilesystemPort } from "../../domain/ports/filesystem.port";
import type { TerminalResult } from "../../domain/ports/terminal.port";
import type { AwkQuery } from "./awk.query";

export class AwkHandler implements QueryHandler<AwkQuery, TerminalResult> {
  constructor(private readonly filesystem: FilesystemPort) {}

  handle(query: AwkQuery): Promise<TerminalResult> {
    return this.filesystem.awk(query.input);
  }
}
