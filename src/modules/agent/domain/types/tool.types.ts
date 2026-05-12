export interface ToolResult {
  output: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  readonly agentId: string;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly groups?: readonly string[];
  execute(input: unknown, context?: ToolContext): Promise<ToolResult>;
}
