import type { AgentDefinitionRepositoryPort } from "../../domain/ports/agent-definition-repository.port";
import type { ToolRegistryPort } from "../../domain/ports/tool-registry.port";
import type { AgentDefinition } from "../../domain/types/agent.types";
import type { ConfigPort } from "../../../../shared/config/config.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";

const GROUP_PREFIX = "group:";

export class ConfigAgentDefinitionRepository implements AgentDefinitionRepositoryPort {
  private definitions: Map<string, AgentDefinition> = new Map();
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigPort,
    private readonly toolRegistry: ToolRegistryPort,
    private readonly logger: LoggerPort,
  ) {
    this.loadPromise = this.loadDefinitions();

    this.config.onChange(() => {
      this.loadPromise = this.loadDefinitions().catch((err) => {
        this.logger.error("agent.definitions_reload_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  async get(id: string): Promise<AgentDefinition | undefined> {
    await this.loadPromise;
    return this.definitions.get(id);
  }

  async getAll(): Promise<AgentDefinition[]> {
    await this.loadPromise;
    return [...this.definitions.values()];
  }

  private async loadDefinitions(): Promise<void> {
    const agentConfig = this.config.getAgentConfig();
    if (!agentConfig?.agents) return;

    const newDefinitions = new Map<string, AgentDefinition>();

    for (const [id, agentConf] of Object.entries(agentConfig.agents)) {
      const systemPrompt = await this.resolveSystemPrompt(agentConf.systemPrompt);

      const definition: AgentDefinition = {
        id,
        name: agentConf.name,
        description: agentConf.description,
        systemPrompt,
        ...(agentConf.model ? { model: agentConf.model } : {}),
        tools: this.resolveTools(agentConf.tools, id),
        runtime: agentConf.runtime ?? "tool-use-loop",
        ...(agentConf.maxIterations !== undefined ? { maxIterations: agentConf.maxIterations } : {}),
        ...(agentConf.temperature !== undefined ? { temperature: agentConf.temperature } : {}),
        ...(agentConf.maxTokens !== undefined ? { maxTokens: agentConf.maxTokens } : {}),
      };

      newDefinitions.set(id, definition);
    }

    this.definitions = newDefinitions;
    this.logger.info("agent.definitions_loaded", { count: newDefinitions.size });
  }

  private async resolveSystemPrompt(prompt: string): Promise<string> {
    if (prompt.startsWith("file:")) {
      const filePath = prompt.slice(5);

      if (filePath.includes("..") || filePath.startsWith("/") || filePath.startsWith("\\") || /^[a-zA-Z]:/.test(filePath)) {
        this.logger.warn("agent.system_prompt_path_traversal_rejected", { filePath });
        return prompt;
      }

      try {
        const file = Bun.file(filePath);
        return await file.text();
      } catch {
        this.logger.warn("agent.system_prompt_file_not_found", { filePath });
        return prompt;
      }
    }
    return prompt;
  }

  private resolveTools(rawTools: readonly string[], agentId: string): string[] {
    const resolved: string[] = [];
    const seen = new Set<string>();

    for (const entry of rawTools) {
      if (entry.startsWith(GROUP_PREFIX)) {
        const groupName = entry.slice(GROUP_PREFIX.length);
        const groupTools = this.toolRegistry.getByGroup(groupName);
        if (groupTools.length === 0) {
          this.logger.warn("agent.tool_group_empty_or_unknown", { agentId, groupName });
          continue;
        }
        for (const tool of groupTools) {
          if (!seen.has(tool.name)) {
            seen.add(tool.name);
            resolved.push(tool.name);
          }
        }
      } else if (!seen.has(entry)) {
        seen.add(entry);
        resolved.push(entry);
      }
    }

    return resolved;
  }
}
