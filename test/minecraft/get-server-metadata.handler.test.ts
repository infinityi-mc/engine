import { describe, expect, test, beforeEach } from "bun:test";
import { GetServerMetadataHandler } from "../../src/modules/minecraft/application/queries/get-server-metadata.handler";
import { GetServerMetadataQuery } from "../../src/modules/minecraft/application/queries/get-server-metadata.query";
import { MinecraftServerNotFoundError } from "../../src/modules/minecraft/domain/errors/minecraft-server-not-found.error";
import type { MinecraftServerRepositoryPort } from "../../src/modules/minecraft/domain/ports/minecraft-server-repository.port";
import type { ServerMetadataPort } from "../../src/modules/minecraft/domain/ports/server-metadata.port";
import type { MinecraftServer } from "../../src/modules/minecraft/domain/types/minecraft-server";
import type { ServerMetadata } from "../../src/modules/minecraft/domain/types/server-metadata";

function makeMockRepository(servers: MinecraftServer[] = []): MinecraftServerRepositoryPort {
  return {
    save: async () => {},
    remove: async () => {},
    get: async (id: string) => servers.find((s) => s.id === id),
    list: async () => servers,
  };
}

function makeMockMetadataPort(metadata: ServerMetadata): ServerMetadataPort {
  return {
    resolve: async () => metadata,
  };
}

const testServer: MinecraftServer = {
  id: "test-server",
  name: "Test Server",
  directory: "/srv/minecraft",
  javaPath: "java",
  jarFile: "server.jar",
  jvmArgs: ["-Xmx2G"],
  serverArgs: ["--nogui"],
};

const testMetadata: ServerMetadata = {
  levelName: "world",
  maxPlayers: 10,
  serverPort: 25565,
  levelInfo: {
    isRunning: true,
    worldName: "My World",
    minecraftVersion: "1.21.0",
    serverBrands: ["fabric"],
  },
};

describe("GetServerMetadataHandler", () => {
  test("returns metadata for existing server", async () => {
    const repository = makeMockRepository([testServer]);
    const metadataPort = makeMockMetadataPort(testMetadata);
    const handler = new GetServerMetadataHandler(repository, metadataPort);

    const result = await handler.handle(new GetServerMetadataQuery("test-server"));

    expect(result.levelName).toBe("world");
    expect(result.maxPlayers).toBe(10);
    expect(result.serverPort).toBe(25565);
    expect(result.levelInfo.isRunning).toBe(true);
    expect(result.levelInfo.worldName).toBe("My World");
    expect(result.levelInfo.minecraftVersion).toBe("1.21.0");
    expect(result.levelInfo.serverBrands).toEqual(["fabric"]);
  });

  test("throws MinecraftServerNotFoundError for unknown server", async () => {
    const repository = makeMockRepository([]);
    const metadataPort = makeMockMetadataPort(testMetadata);
    const handler = new GetServerMetadataHandler(repository, metadataPort);

    await expect(
      handler.handle(new GetServerMetadataQuery("unknown")),
    ).rejects.toThrow(MinecraftServerNotFoundError);
  });

  test("calls metadata port with server directory", async () => {
    const repository = makeMockRepository([testServer]);
    let resolvedPath: string | undefined;
    const metadataPort: ServerMetadataPort = {
      resolve: async (serverPath: string) => {
        resolvedPath = serverPath;
        return testMetadata;
      },
    };
    const handler = new GetServerMetadataHandler(repository, metadataPort);

    await handler.handle(new GetServerMetadataQuery("test-server"));

    expect(resolvedPath).toBe("/srv/minecraft");
  });
});
