import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FileMcdocLoader } from "../../src/modules/mcdoc/infrastructure/persistence/file-mcdoc-loader";
import { McdocRepository } from "../../src/modules/mcdoc/application/mcdoc-repository";
import { SchemaNotFoundError, UnsafeRegexError } from "../../src/modules/mcdoc/domain/errors/mcdoc.errors";
import { noopLogger } from "../../src/shared/observability/logger.port";
import { fixtureMcdoc, fixtureRef } from "./fixtures";

let workDir: string;
let symbolPath: string;
let indexDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "mcdoc-test-"));
  await mkdir(path.join(workDir, "minecraft"), { recursive: true });
  symbolPath = path.join(workDir, "minecraft", "symbol.json");
  indexDir = path.join(workDir, "minecraft", "mcdoc-index");
  await writeFile(symbolPath, JSON.stringify({ ref: fixtureRef, mcdoc: fixtureMcdoc }), "utf8");
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("McdocRepository (build + persist)", () => {
  test("builds index on first load and persists sidecar", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);

    expect(repo.meta().ref).toBe(fixtureRef);
    expect(repo.meta().schemaCount).toBe(Object.keys(fixtureMcdoc).length);

    const sidecar = path.join(indexDir, fixtureRef, "index.json");
    const persisted = JSON.parse(await readFile(sidecar, "utf8")) as { meta: { ref: string } };
    expect(persisted.meta.ref).toBe(fixtureRef);
  });

  test("loads from persisted sidecar on subsequent boot", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    expect(repo.meta().schemaCount).toBe(Object.keys(fixtureMcdoc).length);
  });

  test("listPackages returns children + schemas", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    const listing = repo.listPackages("::java::assets::atlas");
    expect(listing.schemas).toContain("::java::assets::atlas::Atlas");
  });

  test("getSchema summary / full / fields-only", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);

    const summary = repo.getSchema("::java::assets::atlas::Atlas", "summary");
    expect(summary.path).toBe("::java::assets::atlas::Atlas");

    const full = repo.getSchema("::java::assets::atlas::Atlas", "full");
    expect(full.kind).toBe("struct");

    const fields = repo.getSchema("::java::assets::atlas::Atlas", "fields-only");
    expect(fields.fields).toHaveLength(1);
  });

  test("getSchema throws SchemaNotFoundError for unknown path", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    expect(() => repo.getSchema("::java::nope", "summary")).toThrow(SchemaNotFoundError);
  });

  test("grepFields rejects unsafe regex", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    expect(() => repo.grepFields("(a+)+")).toThrow(UnsafeRegexError);
    expect(() => repo.grepFields("(a)\\1")).toThrow(UnsafeRegexError);
    expect(() => repo.grepFields("")).toThrow(UnsafeRegexError);
  });

  test("grepFields finds matching field keys", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    const matches = repo.grepFields("^pattern$");
    expect(matches.some((m) => m.path === "::java::assets::atlas::Filter")).toBe(true);
  });

  test("findReferences returns reverse-ref paths", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    const refs = repo.findReferences("::java::assets::atlas::SpriteSource");
    expect(refs).toContain("::java::assets::atlas::Atlas");
  });

  test("findReferences throws for unknown path", async () => {
    const loader = new FileMcdocLoader({ symbolPath, indexDir, logger: noopLogger });
    const repo = await McdocRepository.create(loader, noopLogger);
    expect(() => repo.findReferences("::java::nope")).toThrow(SchemaNotFoundError);
  });
});

describe("FileMcdocLoader (missing file)", () => {
  test("returns empty index when symbol.json is absent", async () => {
    const missingDir = await mkdtemp(path.join(tmpdir(), "mcdoc-empty-"));
    try {
      const loader = new FileMcdocLoader({
        symbolPath: path.join(missingDir, "symbol.json"),
        indexDir: path.join(missingDir, "mcdoc-index"),
        logger: noopLogger,
      });
      const repo = await McdocRepository.create(loader, noopLogger);
      expect(repo.meta().schemaCount).toBe(0);
      expect(repo.search("anything")).toEqual([]);
    } finally {
      await rm(missingDir, { recursive: true, force: true });
    }
  });
});
