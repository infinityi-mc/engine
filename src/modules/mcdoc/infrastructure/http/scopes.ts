export const SCOPES = {
  MCDOC_READ: "mcdoc:read",
  MCDOC_WRITE: "mcdoc:write",
} as const;

export type McdocScope = (typeof SCOPES)[keyof typeof SCOPES];
