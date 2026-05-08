export type ServerStatus = "running" | "stopped" | "crashed";

export interface ServerInstance {
  readonly id: string;
  readonly pid: number;
  readonly command: string;
  readonly args: string[];
  readonly cwd: string | undefined;
  readonly status: ServerStatus;
  readonly startedAt: Date;
  readonly stoppedAt: Date | undefined;
}
