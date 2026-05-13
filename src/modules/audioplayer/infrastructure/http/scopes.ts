export const SCOPES = {
  AUDIOPLAYER_READ: "audioplayer:read",
  AUDIOPLAYER_WRITE: "audioplayer:write",
} as const;

export type AudioPlayerScope = (typeof SCOPES)[keyof typeof SCOPES];
