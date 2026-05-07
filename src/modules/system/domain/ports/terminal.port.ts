export interface TerminalOptions {
  readonly command: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly shell?: boolean;
  readonly input?: string;
}

export interface TerminalResult {
  readonly command: string;
  readonly args: string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface TerminalPort {
  execute(options: TerminalOptions): Promise<TerminalResult>;
}
