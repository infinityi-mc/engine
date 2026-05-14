import { createContainer } from "../src/bootstrap/container";

function printUsage(): void {
  console.log([
    "Usage: bun scripts/scratch-mcdoc-rag-convert.ts",
    "",
    "Forces one real mcdoc RAG conversion using cached SpyglassMC JSON files.",
    "It reads data/mcdoc/spyglassmc/*.json, calls Gemini embeddings, and writes:",
    "  - data/mcdoc/vectors/rag_manifest.json",
    "  - data/mcdoc/vectors/rag_documents.json",
    "  - data/mcdoc/vectors/rag_vectors.f32",
    "",
    "Required environment/config:",
    "  - GOOGLE_API_KEY must be available through the existing google LLM provider config.",
    "  - Cached mcdoc JSON should already exist under DATA_DIR or ./data.",
  ].join("\n"));
}

const args = new Set(Bun.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  printUsage();
  process.exit(0);
}

const container = await createContainer();

try {
  const index = await container.mcdocService.rebuildRagIndex();
  console.log(JSON.stringify({
    status: "ok",
    message: "mcdoc RAG conversion completed",
    manifest: index.manifest,
    sampleDocumentIds: index.documents.slice(0, 5).map((document) => document.id),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  container.config.stop();
}
