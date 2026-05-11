import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import os from "node:os";
import { FileSystemServerMetadataAdapter } from "../../src/modules/minecraft/infrastructure/metadata/server-metadata.adapter";
import { PrismarineNbtAdapter } from "../../src/modules/minecraft/infrastructure/nbt/prismarine-nbt.adapter";
import { ServerPropertiesNotFoundError } from "../../src/modules/minecraft/domain/errors/server-properties-not-found.error";
import { noopLogger } from "../../src/shared/observability/logger.port";

const REAL_LEVEL_DAT = path.join(import.meta.dir, "..", "..", "data", "temp", "level.dat");

describe("FileSystemServerMetadataAdapter", () => {
  let tmpDir: string;
  let adapter: FileSystemServerMetadataAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "metadata-adapter-"));
    const nbtAdapter = new PrismarineNbtAdapter(noopLogger);
    adapter = new FileSystemServerMetadataAdapter(nbtAdapter, noopLogger);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function createServerDir(
    properties: string,
    levelName = "world",
    withLevelDat = true,
    withSessionLock = false,
  ): Promise<string> {
    const serverDir = path.join(tmpDir, "server");
    await mkdir(serverDir, { recursive: true });
    await writeFile(path.join(serverDir, "server.properties"), properties);

    if (withLevelDat) {
      const worldDir = path.join(serverDir, levelName);
      await mkdir(worldDir, { recursive: true });
      await copyFile(REAL_LEVEL_DAT, path.join(worldDir, "level.dat"));

      if (withSessionLock) {
        await writeFile(path.join(worldDir, "session.lock"), "");
      }
    }

    return serverDir;
  }

  describe("resolve", () => {
    test("resolves full metadata from server.properties and level.dat", async () => {
      const serverDir = await createServerDir(
        "level-name=world\nmax-players=10\nserver-port=25565\n",
      );

      const metadata = await adapter.resolve(serverDir);

      expect(metadata.levelName).toBe("world");
      expect(metadata.maxPlayers).toBe(10);
      expect(metadata.serverPort).toBe(25565);
      expect(metadata.levelInfo.worldName).toBe("Build the world");
      expect(metadata.levelInfo.minecraftVersion).toBe("26.1.2");
      expect(metadata.levelInfo.serverBrands).toEqual(["fabric"]);
      expect(metadata.levelInfo.isRunning).toBe(false);
    });

    test("detects running state from session.lock", async () => {
      const serverDir = await createServerDir(
        "level-name=world\n",
        "world",
        true,
        true,
      );

      const metadata = await adapter.resolve(serverDir);

      expect(metadata.levelInfo.isRunning).toBe(true);
    });

    test("uses default values when properties are missing", async () => {
      const serverDir = await createServerDir("difficulty=hard\n");

      const metadata = await adapter.resolve(serverDir);

      expect(metadata.levelName).toBe("world");
      expect(metadata.maxPlayers).toBe(20);
      expect(metadata.serverPort).toBe(25565);
    });

    test("handles custom level-name", async () => {
      const serverDir = await createServerDir(
        "level-name=my_world\nmax-players=5\nserver-port=25566\n",
        "my_world",
      );

      const metadata = await adapter.resolve(serverDir);

      expect(metadata.levelName).toBe("my_world");
      expect(metadata.maxPlayers).toBe(5);
      expect(metadata.serverPort).toBe(25566);
    });

    test("returns empty strings when level.dat is missing", async () => {
      const serverDir = await createServerDir(
        "level-name=world\n",
        "world",
        false,
      );

      const metadata = await adapter.resolve(serverDir);

      expect(metadata.levelName).toBe("world");
      expect(metadata.levelInfo.worldName).toBe("");
      expect(metadata.levelInfo.minecraftVersion).toBe("");
      expect(metadata.levelInfo.serverBrands).toEqual([]);
      expect(metadata.levelInfo.isRunning).toBe(false);
    });

    test("throws ServerPropertiesNotFoundError when file is missing", async () => {
      const serverDir = path.join(tmpDir, "nonexistent");
      await mkdir(serverDir, { recursive: true });

      await expect(adapter.resolve(serverDir)).rejects.toThrow(
        ServerPropertiesNotFoundError,
      );
    });

    test("skips comment lines and empty lines", async () => {
      const properties = [
        "#Minecraft server properties",
        "",
        "level-name=world",
        "# Another comment",
        "max-players=5",
      ].join("\n");
      const serverDir = await createServerDir(properties, "world", false);

      const metadata = await adapter.resolve(serverDir);

      expect(metadata.levelName).toBe("world");
      expect(metadata.maxPlayers).toBe(5);
    });
  });
});
