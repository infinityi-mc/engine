import type { ServerMetadata } from "../types/server-metadata";

export interface ServerMetadataPort {
  resolve(serverPath: string): Promise<ServerMetadata>;
}
