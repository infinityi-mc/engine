import type { Query } from "../../../../shared/application/query-bus";
import type { GrepInput } from "../../domain/ports/filesystem.port";

export const GREP_FILES_QUERY = "system.files.grep" as const;

export class GrepFilesQuery implements Query<typeof GREP_FILES_QUERY> {
  readonly type = GREP_FILES_QUERY;

  constructor(readonly input: GrepInput) {}
}
