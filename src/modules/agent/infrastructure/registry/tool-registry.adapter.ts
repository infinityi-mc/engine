import type { ToolDefinition } from "../../../llm/domain/ports/llm.types";
import type { ToolRegistryPort } from "../../domain/ports/tool-registry.port";
import type { Tool } from "../../domain/types/tool.types";
import type { LoggerPort } from "../../../../shared/observability/logger.port";

export class InMemoryToolRegistry implements ToolRegistryPort {
  private readonly tools = new Map<string, Tool>();
  private readonly groupIndex = new Map<string, Set<Tool>>();

  constructor(private readonly logger: LoggerPort) {}

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  register(tool: Tool): void {
    const previous = this.tools.get(tool.name);
    if (previous) {
      for (const groupName of previous.groups ?? []) {
        const set = this.groupIndex.get(groupName);
        if (set) {
          set.delete(previous);
          if (set.size === 0) {
            this.groupIndex.delete(groupName);
          }
        }
      }
    }
    this.tools.set(tool.name, tool);
    for (const groupName of tool.groups ?? []) {
      let set = this.groupIndex.get(groupName);
      if (!set) {
        set = new Set<Tool>();
        this.groupIndex.set(groupName, set);
      }
      set.add(tool);
    }
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  getByGroup(groupName: string): Tool[] {
    const set = this.groupIndex.get(groupName);
    return set ? [...set] : [];
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
