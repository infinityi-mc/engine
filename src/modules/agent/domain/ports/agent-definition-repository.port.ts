import type { AgentDefinition } from "../types/agent.types";

export interface AgentDefinitionRepositoryPort {
  get(id: string): Promise<AgentDefinition | undefined>;
  getAll(): Promise<AgentDefinition[]>;
}
