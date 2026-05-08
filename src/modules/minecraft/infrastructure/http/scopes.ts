export const SCOPES = {
  /** Read-only minecraft operations: list servers, get details, stream logs */
  SERVER_READ: "minecraft:server:read",
  /** Mutating minecraft operations: create, delete, start, stop, send command */
  SERVER_WRITE: "minecraft:server:write",
} as const;

export type MinecraftScope = (typeof SCOPES)[keyof typeof SCOPES];
