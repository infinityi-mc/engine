import type { Query } from "../../../../shared/application/query-bus";
import type { AwkInput } from "../../domain/ports/filesystem.port";

export const AWK_QUERY = "system.files.awk" as const;

export class AwkQuery implements Query<typeof AWK_QUERY> {
  readonly type = AWK_QUERY;

  constructor(readonly input: AwkInput) {}
}
