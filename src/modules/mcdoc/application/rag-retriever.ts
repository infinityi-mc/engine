import type { McdocEmbeddingPort } from "../domain/ports/mcdoc-embedding.port";
import type {
  McdocCitation,
  McdocRagDocument,
  McdocRagFilters,
  McdocRagIndex,
  McdocSearchResult,
} from "../domain/types/mcdoc-rag";

const DEFAULT_LIMIT = 8;
const MAX_CONTEXT_RESULTS = 12;
const SUBSTRING_SCORE = 100;
const TITLE_SCORE = 30;
const KEYWORD_SCORE = 4;
const REFERENCE_SCORE = 12;
const VECTOR_SCORE = 50;

function tokenize(input: string): string[] {
  return [...new Set(input
    .toLowerCase()
    .split(/[^a-z0-9:_./-]+/)
    .filter((token) => token.length > 1))];
}

function citationFor(document: McdocRagDocument): McdocCitation {
  return {
    source: document.metadata.source,
    jsonPath: document.metadata.jsonPath,
    title: document.title,
  };
}

function cosineSimilarityAtOffset(a: readonly number[], b: Float32Array, offset: number, dimensions: number): number {
  if (a.length === 0 || dimensions === 0) return 0;
  if (a.length !== dimensions) {
    throw new Error(`RAG query vector dimension mismatch: query=${a.length}, index=${dimensions}`);
  }

  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < dimensions; i++) {
    const av = a[i] ?? 0;
    const bv = b[offset + i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }

  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function matchesFilters(document: McdocRagDocument, filters?: McdocRagFilters): boolean {
  if (!filters) return true;
  if (filters.source && document.metadata.source !== filters.source) return false;
  if (filters.kind && document.metadata.kind !== filters.kind) return false;
  if (filters.version && document.metadata.version !== filters.version) return false;
  if (filters.symbolPath && document.metadata.symbolPath !== filters.symbolPath) return false;
  if (filters.registry && document.metadata.registry !== filters.registry) return false;
  if (filters.blockId && document.metadata.blockId !== filters.blockId) return false;
  return true;
}

function scoreDocument(document: McdocRagDocument, query: string, queryTokens: readonly string[]): number {
  const haystack = `${document.id}\n${document.title}\n${document.text}`.toLowerCase();
  const title = document.title.toLowerCase();
  const normalizedQuery = query.toLowerCase().trim();
  const substringScore = normalizedQuery.length > 0 && haystack.includes(normalizedQuery) ? SUBSTRING_SCORE : 0;
  const titleScore = normalizedQuery.length > 0 && title.includes(normalizedQuery) ? TITLE_SCORE : 0;
  const keywordScore = queryTokens.filter((token) => haystack.includes(token)).length * KEYWORD_SCORE;
  const referenceScore = (document.metadata.references ?? []).some((reference) => normalizedQuery.includes(reference.toLowerCase()))
    ? REFERENCE_SCORE
    : 0;
  return substringScore + titleScore + keywordScore + referenceScore;
}

export class McdocRagRetriever {
  private bySymbolPath: Map<string, McdocRagDocument> | undefined;

  constructor(
    private readonly index: McdocRagIndex,
    private readonly embedder?: McdocEmbeddingPort,
  ) {}

  async search(query: string, filters?: McdocRagFilters, limit = DEFAULT_LIMIT): Promise<McdocSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const queryTokens = tokenize(trimmed);
    const queryVector = this.embedder && this.index.vectors.values.length > 0
      ? await this.embedder.embedQuery(trimmed)
      : undefined;

    return this.index.documents
      .map((document, documentIndex) => ({ document, documentIndex }))
      .filter(({ document }) => matchesFilters(document, filters))
      .map(({ document, documentIndex }): McdocSearchResult => {
        const baseScore = scoreDocument(document, trimmed, queryTokens);
        const vectorScore = queryVector
          ? cosineSimilarityAtOffset(
            queryVector,
            this.index.vectors.values,
            documentIndex * this.index.vectors.dimensions,
            this.index.vectors.dimensions,
          ) * VECTOR_SCORE
          : 0;
        return {
          document,
          score: baseScore + vectorScore,
          citation: citationFor(document),
        };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  retrieveById(id: string): McdocRagDocument | undefined {
    return this.index.documents.find((document) => document.id === id);
  }

  buildContext(results: readonly McdocSearchResult[]): { context: string; citations: McdocCitation[] } {
    const expanded = this.expandReferences(results.map((result) => result.document));
    const selected = expanded.slice(0, MAX_CONTEXT_RESULTS);
    const citations = selected.map(citationFor);
    const context = selected
      .map((document, index) => [
        `Source ${index + 1}: ${document.title}`,
        `ID: ${document.id}`,
        `Location: ${document.metadata.source} ${document.metadata.jsonPath}`,
        document.text,
      ].join("\n"))
      .join("\n\n---\n\n");

    return { context, citations };
  }

  private expandReferences(documents: readonly McdocRagDocument[]): McdocRagDocument[] {
    const bySymbolPath = this.getSymbolPathIndex();
    const selected = new Map<string, McdocRagDocument>();

    for (const document of documents) {
      selected.set(document.id, document);
      for (const reference of document.metadata.references ?? []) {
        const referenced = bySymbolPath.get(reference);
        if (referenced) selected.set(referenced.id, referenced);
      }
    }

    return [...selected.values()];
  }

  private getSymbolPathIndex(): Map<string, McdocRagDocument> {
    if (!this.bySymbolPath) {
      this.bySymbolPath = new Map(
        this.index.documents
          .filter((document) => document.metadata.symbolPath && document.metadata.kind === "symbol")
          .map((document) => [document.metadata.symbolPath!, document]),
      );
    }
    return this.bySymbolPath;
  }
}
