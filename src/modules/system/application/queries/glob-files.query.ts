import type { Query } from "../../../../shared/application/query-bus";
import type { GlobInput } from "../../domain/ports/filesystem.port";

export const GLOB_FILES_QUERY = "system.files.glob" as const;

export class GlobFilesQuery implements Query<typeof GLOB_FILES_QUERY> {
  readonly type = GLOB_FILES_QUERY;

  constructor(readonly input: GlobInput) {}
}
