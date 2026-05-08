import type { MinecraftServer } from "../types/minecraft-server";

export interface MinecraftServerRepositoryPort {
  save(server: MinecraftServer): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<MinecraftServer | undefined>;
  list(): Promise<MinecraftServer[]>;
}
