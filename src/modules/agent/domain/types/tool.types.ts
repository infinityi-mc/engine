export interface ToolResult {
  output: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(input: unknown): Promise<ToolResult>;
}
