export const SCOPES = {
  /** Read-only Minecraft mcdoc schema lookup. */
  MCDOC_READ: "mcdoc:read",
} as const;

export type McdocScope = (typeof SCOPES)[keyof typeof SCOPES];
