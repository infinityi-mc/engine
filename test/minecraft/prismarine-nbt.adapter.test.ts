import { describe, expect, test, beforeAll } from "bun:test";
import path from "node:path";
import nbt from "prismarine-nbt";
import { PrismarineNbtAdapter } from "../../src/modules/minecraft/infrastructure/nbt/prismarine-nbt.adapter";
import { NbtFileNotFoundError } from "../../src/modules/minecraft/domain/errors/nbt-file-not-found.error";
import { NbtPathNotFoundError } from "../../src/modules/minecraft/domain/errors/nbt-path-not-found.error";
import { noopLogger } from "../../src/shared/observability/logger.port";

const FIXTURE_DIR = path.join(import.meta.dir, "..", "fixtures");
const LEVEL_DAT = path.join(FIXTURE_DIR, "test-level.dat");

function makeTestNbt(): nbt.NBT {
  return nbt.comp(
    {
      Data: nbt.comp({
        LevelName: nbt.string("TestWorld"),
        GameType: nbt.int(0),
        SpawnX: nbt.int(100),
        SpawnY: nbt.int(64),
        SpawnZ: nbt.int(-200),
        Player: nbt.comp({
          Pos: nbt.list(nbt.double(0)) as unknown as nbt.List<nbt.TagType.Double>,
          Health: nbt.float(20),
          Inventory: nbt.list(
            nbt.comp({
              id: nbt.string("minecraft:diamond_sword"),
              Count: nbt.byte(1),
              Slot: nbt.byte(0),
            }),
          ) as unknown as nbt.List<nbt.TagType.Compound>,
          Motion: nbt.list(nbt.double(0)) as unknown as nbt.List<nbt.TagType.Double>,
        }),
        WorldGenSettings: nbt.comp({
          seed: nbt.long(BigInt(12345)),
          dimensions: nbt.comp({
            "minecraft:overworld": nbt.comp({
              type: nbt.string("minecraft:overworld"),
            }),
          }),
        }),
        GameRules: nbt.comp({
          doDaylightCycle: nbt.string("true"),
          doMobSpawning: nbt.string("true"),
          keepInventory: nbt.string("false"),
        }),
      }),
      Version: nbt.comp({
        Id: nbt.int(2975),
        Name: nbt.string("1.20.4"),
        Snapshot: nbt.byte(0),
      }),
    },
    "",
  ) as unknown as nbt.NBT;
}

beforeAll(async () => {
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  if (!existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  }

  const testNbt = makeTestNbt();
  const uncompressed = nbt.writeUncompressed(testNbt);
  const compressed = (await import("node:zlib")).gzipSync(uncompressed);
  writeFileSync(LEVEL_DAT, compressed);
});

describe("PrismarineNbtAdapter", () => {
  const adapter = new PrismarineNbtAdapter(noopLogger);

  describe("read", () => {
    test("reads and truncates to specified depth", async () => {
      const result = await adapter.read(LEVEL_DAT, 1);
      expect(result.type).toBe("compound");
      expect(typeof result.value).toBe("object");
      const value = result.value as Record<string, unknown>;
      expect(value.Data).toBeDefined();
      // At depth 1, Data should be a type hint string, not expanded
      expect(typeof value.Data).toBe("string");
    });

    test("expands deeper with higher depth", async () => {
      const result = await adapter.read(LEVEL_DAT, 3);
      const value = result.value as Record<string, unknown>;
      const data = value.Data as Record<string, unknown>;
      expect(typeof data).toBe("object");
      expect(data.LevelName).toBe("TestWorld");
      expect(data.GameType).toBe(0);
    });

    test("throws NbtFileNotFoundError for missing file", async () => {
      await expect(adapter.read("/nonexistent.dat", 3)).rejects.toThrow(
        NbtFileNotFoundError,
      );
    });
  });

  describe("get", () => {
    test("returns value at dot-separated path", async () => {
      const result = await adapter.get(LEVEL_DAT, "Data.LevelName");
      expect(result.type).toBe("string");
      expect(result.value).toBe("TestWorld");
    });

    test("returns nested compound value", async () => {
      const result = await adapter.get(LEVEL_DAT, "Data.Player.Health");
      expect(result.type).toBe("float");
      expect(result.value).toBe(20);
    });

    test("returns compound as simplified object", async () => {
      const result = await adapter.get(LEVEL_DAT, "Data.GameRules");
      expect(result.type).toBe("compound");
      const rules = result.value as Record<string, string>;
      expect(rules.doDaylightCycle).toBe("true");
      expect(rules.keepInventory).toBe("false");
    });

    test("throws NbtPathNotFoundError for invalid path", async () => {
      await expect(
        adapter.get(LEVEL_DAT, "Data.NonExistent"),
      ).rejects.toThrow(NbtPathNotFoundError);
    });

    test("throws NbtPathNotFoundError for invalid nested path", async () => {
      await expect(
        adapter.get(LEVEL_DAT, "Data.Player.BadPath"),
      ).rejects.toThrow(NbtPathNotFoundError);
    });
  });

  describe("search", () => {
    test("finds keys matching pattern", async () => {
      const matches = await adapter.search(LEVEL_DAT, "Spawn", 100);
      expect(matches).toContain("Data.SpawnX");
      expect(matches).toContain("Data.SpawnY");
      expect(matches).toContain("Data.SpawnZ");
    });

    test("case-insensitive search", async () => {
      const matches = await adapter.search(LEVEL_DAT, "levelname", 100);
      expect(matches).toContain("Data.LevelName");
    });

    test("respects limit", async () => {
      const matches = await adapter.search(LEVEL_DAT, ".", 2);
      expect(matches.length).toBeLessThanOrEqual(2);
    });

    test("returns empty array for no matches", async () => {
      const matches = await adapter.search(
        LEVEL_DAT,
        "zzznonexistent",
        100,
      );
      expect(matches).toEqual([]);
    });
  });

  describe("keys", () => {
    test("returns root keys when no path given", async () => {
      const keys = await adapter.keys(LEVEL_DAT, undefined);
      const keyNames = keys.map((k) => k.key);
      expect(keyNames).toContain("Data");
      expect(keyNames).toContain("Version");
    });

    test("returns child keys at a compound path", async () => {
      const keys = await adapter.keys(LEVEL_DAT, "Data");
      const keyNames = keys.map((k) => k.key);
      expect(keyNames).toContain("LevelName");
      expect(keyNames).toContain("Player");
      expect(keyNames).toContain("GameRules");
    });

    test("returns type info for each key", async () => {
      const keys = await adapter.keys(LEVEL_DAT, "Data");
      const levelName = keys.find((k) => k.key === "LevelName");
      expect(levelName?.type).toBe("string");

      const player = keys.find((k) => k.key === "Player");
      expect(player?.type).toBe("compound");
    });

    test("throws NbtPathNotFoundError for invalid path", async () => {
      await expect(adapter.keys(LEVEL_DAT, "Data.Bad")).rejects.toThrow(
        NbtPathNotFoundError,
      );
    });
  });

  describe("structure", () => {
    test("returns structure entries up to depth", async () => {
      const entries = await adapter.structure(LEVEL_DAT, 2);
      const paths = entries.map((e) => e.path);
      expect(paths).toContain("Data");
      expect(paths).toContain("Version");
    });

    test("includes type information", async () => {
      const entries = await adapter.structure(LEVEL_DAT, 2);
      const dataEntry = entries.find((e) => e.path === "Data");
      expect(dataEntry?.type).toBe("compound");
    });

    test("deeper depth reveals more entries", async () => {
      const shallow = await adapter.structure(LEVEL_DAT, 1);
      const deep = await adapter.structure(LEVEL_DAT, 3);
      expect(deep.length).toBeGreaterThan(shallow.length);
    });
  });
});
