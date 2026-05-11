import type { ToolDefinition } from "../../../llm/domain/ports/llm.types";
import type { Tool } from "../types/tool.types";

export interface ToolRegistryPort {
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  getByGroup(groupName: string): Tool[];
  getDefinitions(names: readonly string[]): ToolDefinition[];
  register(tool: Tool): void;
}
