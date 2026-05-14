import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McdocRagDocument, McdocRagManifest, McdocRagVector } from "../src/modules/mcdoc/domain/types/mcdoc-rag";

const dataDir = Bun.env.DATA_DIR ?? path.join(process.cwd(), "data");
const vectorDir = path.join(dataDir, "mcdoc", "vectors");
const manifestPath = path.join(vectorDir, "rag_manifest.json");
const documentsPath = path.join(vectorDir, "rag_documents.json");
const legacyEmbeddingsPath = path.join(vectorDir, "rag_embeddings.json");
const binaryVectorsPath = path.join(vectorDir, "rag_vectors.f32");

function printUsage(): void {
  console.log([
    "Usage: bun scripts/scratch-mcdoc-rag-migrate-vectors.ts",
    "",
    "Migrates existing mcdoc RAG vectors from JSON to Float32 binary without calling Gemini.",
    "Reads:",
    "  - data/mcdoc/vectors/rag_manifest.json",
    "  - data/mcdoc/vectors/rag_documents.json",
    "  - data/mcdoc/vectors/rag_embeddings.json",
    "Writes:",
    "  - data/mcdoc/vectors/rag_vectors.f32",
    "  - updated data/mcdoc/vectors/rag_manifest.json",
    "Deletes:",
    "  - data/mcdoc/vectors/rag_embeddings.json",
  ].join("\n"));
}

const args = new Set(Bun.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  printUsage();
  process.exit(0);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await Bun.file(filePath).text()) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const tempPath = filePath + ".tmp";
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, filePath);
}

async function writeFloat32(filePath: string, value: Float32Array): Promise<void> {
  const tempPath = filePath + ".tmp";
  await writeFile(tempPath, Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  await rename(tempPath, filePath);
}

try {
  await mkdir(vectorDir, { recursive: true });

  const existingBinary = await readFile(binaryVectorsPath).then(() => true).catch(() => false);
  const existingLegacy = await readFile(legacyEmbeddingsPath).then(() => true).catch(() => false);
  if (existingBinary && !existingLegacy) {
    console.log(JSON.stringify({ status: "ok", message: "binary vectors already exist; no legacy JSON found" }, null, 2));
    process.exit(0);
  }
  if (!existingLegacy) {
    throw new Error(`Missing legacy embeddings file: ${legacyEmbeddingsPath}`);
  }

  const [manifest, documents, legacyVectors] = await Promise.all([
    readJson<McdocRagManifest>(manifestPath),
    readJson<readonly McdocRagDocument[]>(documentsPath),
    readJson<readonly McdocRagVector[]>(legacyEmbeddingsPath),
  ]);

  const dimensions = legacyVectors[0]?.values.length ?? 0;
  if (documents.length !== legacyVectors.length) {
    throw new Error(`Document/vector count mismatch: ${documents.length} documents, ${legacyVectors.length} vectors`);
  }
  if (dimensions <= 0) {
    throw new Error("Cannot migrate empty or dimensionless vectors");
  }

  const values = new Float32Array(legacyVectors.length * dimensions);
  for (let vectorIndex = 0; vectorIndex < legacyVectors.length; vectorIndex++) {
    const vector = legacyVectors[vectorIndex];
    const document = documents[vectorIndex];
    if (!vector || !document) {
      throw new Error(`Missing vector/document at index ${vectorIndex}`);
    }
    if (vector.documentId !== document.id) {
      throw new Error(`Document/vector ID mismatch at index ${vectorIndex}: ${document.id} !== ${vector.documentId}`);
    }
    if (vector.values.length !== dimensions) {
      throw new Error(`Vector dimension mismatch at index ${vectorIndex}: expected ${dimensions}, got ${vector.values.length}`);
    }
    values.set(vector.values, vectorIndex * dimensions);
  }

  const updatedManifest: McdocRagManifest = {
    ...manifest,
    storageFormat: "f32-binary",
    vectorDimensions: dimensions,
    documentCount: documents.length,
    vectorCount: legacyVectors.length,
  };

  await writeFloat32(binaryVectorsPath, values);
  await writeJson(manifestPath, updatedManifest);
  await unlink(legacyEmbeddingsPath);

  console.log(JSON.stringify({
    status: "ok",
    message: "mcdoc RAG vectors migrated to Float32 binary",
    binaryVectorsPath,
    deleted: legacyEmbeddingsPath,
    manifest: updatedManifest,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
