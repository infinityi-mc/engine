import type { ToolDefinition } from "../../../llm/domain/ports/llm.types";
import type { ToolRegistryPort } from "../../domain/ports/tool-registry.port";
import type { Tool } from "../../domain/types/tool.types";
import type { LoggerPort } from "../../../../shared/observability/logger.port";

export class InMemoryToolRegistry implements ToolRegistryPort {
  private readonly tools = new Map<string, Tool>();

  constructor(private readonly logger: LoggerPort) {}

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  getDefinitions(names: readonly string[]): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        definitions.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        });
      } else {
        this.logger.warn("agent.tool_not_found_in_registry", { toolName: name });
      }
    }
    return definitions;
  }
}
