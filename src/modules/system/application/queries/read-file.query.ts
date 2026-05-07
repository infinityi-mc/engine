import type { Query } from "../../../../shared/application/query-bus";
import type { ReadFileInput } from "../../domain/ports/filesystem.port";

export const READ_FILE_QUERY = "system.files.read" as const;

export class ReadFileQuery implements Query<typeof READ_FILE_QUERY> {
  readonly type = READ_FILE_QUERY;

  constructor(readonly input: ReadFileInput) {}
}
