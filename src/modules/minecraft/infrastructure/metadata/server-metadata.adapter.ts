import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { NbtPort } from "../../domain/ports/nbt.port";
import type { ServerMetadataPort } from "../../domain/ports/server-metadata.port";
import type { ServerMetadata } from "../../domain/types/server-metadata";
import { ServerPropertiesNotFoundError } from "../../domain/errors/server-properties-not-found.error";

export class FileSystemServerMetadataAdapter implements ServerMetadataPort {
  constructor(
    private readonly nbt: NbtPort,
    private readonly logger: LoggerPort,
  ) {}

  async resolve(serverPath: string): Promise<ServerMetadata> {
    const propertiesPath = path.join(serverPath, "server.properties");
    const properties = await this.readProperties(propertiesPath);

    const levelName = properties["level-name"] ?? "world";
    const maxPlayers = Number.parseInt(properties["max-players"] ?? "20", 10) || 20;
    const serverPort = Number.parseInt(properties["server-port"] ?? "25565", 10) || 25565;

    const worldPath = path.join(serverPath, levelName);
    const levelDatPath = path.join(worldPath, "level.dat");

    const [worldName, minecraftVersion, serverBrands, isRunning] = await Promise.all([
      this.readNbtString(levelDatPath, "Data.LevelName"),
      this.readNbtString(levelDatPath, "Data.Version.Name"),
      this.readNbtStringArray(levelDatPath, "Data.ServerBrands"),
      this.checkSessionLock(worldPath),
    ]);

    this.logger.info("metadata.adapter.resolve", {
      serverPath,
      levelName,
      isRunning,
    });

    return {
      levelName,
      maxPlayers,
      serverPort,
      levelInfo: {
        isRunning,
        worldName,
        minecraftVersion,
        serverBrands,
      },
    };
  }

  private async readProperties(filePath: string): Promise<Record<string, string>> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new ServerPropertiesNotFoundError(filePath);
    }

    const content = await file.text();
    const result: Record<string, string> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replaceAll("\\=", "=");
      result[key] = value;
    }

    return result;
  }

  private async readNbtString(filePath: string, dotPath: string): Promise<string> {
    try {
      const nbtValue = await this.nbt.get(filePath, dotPath);
      if (nbtValue.value === null || nbtValue.value === undefined) return "";
      return String(nbtValue.value);
    } catch {
      return "";
    }
  }

  private async readNbtStringArray(filePath: string, dotPath: string): Promise<readonly string[]> {
    try {
      const nbtValue = await this.nbt.get(filePath, dotPath);
      if (Array.isArray(nbtValue.value)) {
        return nbtValue.value.map(String);
      }
      return [];
    } catch {
      return [];
    }
  }

  private async checkSessionLock(worldPath: string): Promise<boolean> {
    const lockPath = path.join(worldPath, "session.lock");
    return Bun.file(lockPath).exists();
  }
}
