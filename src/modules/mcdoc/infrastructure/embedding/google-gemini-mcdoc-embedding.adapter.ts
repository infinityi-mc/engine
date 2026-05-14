import type { McdocEmbeddingPort } from "../../domain/ports/mcdoc-embedding.port";
import { fetchWithTimeout } from "../../../llm/infrastructure/providers/shared";

const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
const GOOGLE_PROVIDER_NAME = "google";
const EMBEDDING_TIMEOUT_MS = 120_000;
const MAX_BATCH_SIZE = 100;
const MAX_EMBEDDINGS_PER_MINUTE = 2_900;
const RATE_WINDOW_MS = 60_000;
const MAX_RETRIES = 4;
const DEFAULT_RETRY_MS = 20_000;

interface GeminiEmbeddingResponse {
  embeddings?: Array<{ values?: number[] }>;
  embedding?: { values?: number[] };
}

export interface GoogleGeminiMcdocEmbeddingAdapterInput {
  readonly apiKey: string;
  readonly baseUrl: string;
}

export class GoogleGeminiMcdocEmbeddingAdapter implements McdocEmbeddingPort {
  readonly model = GEMINI_EMBEDDING_MODEL;
  private windowStartedAt = Date.now();
  private embeddingsInWindow = 0;

  constructor(private readonly input: GoogleGeminiMcdocEmbeddingAdapterInput) {}

  async embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.embedBatch(texts, "RETRIEVAL_DOCUMENT");
  }

  async embedQuery(text: string): Promise<readonly number[]> {
    const [embedding] = await this.embedBatch([text], "RETRIEVAL_QUERY");
    if (!embedding) throw new Error("Gemini embedding response did not include a query embedding");
    return embedding;
  }

  private async embedBatch(
    texts: readonly string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<readonly (readonly number[])[]> {
    const results: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + MAX_BATCH_SIZE);
      await this.waitForQuota(batch.length);
      const embeddings = await this.requestBatch(batch, taskType);
      this.embeddingsInWindow += batch.length;
      results.push(...embeddings);
    }

    return results;
  }

  private async requestBatch(
    texts: readonly string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await this.sendBatchRequest(texts, taskType);

      if (response.ok) {
        const data = (await response.json()) as GeminiEmbeddingResponse;
        return this.parseEmbeddings(data, texts.length);
      }

      const body = await response.text();
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep(parseRetryMs(response, body));
        this.windowStartedAt = Date.now();
        this.embeddingsInWindow = 0;
        continue;
      }

      throw new Error(`Gemini embedding request failed: ${response.status} ${response.statusText} ${body}`);
    }

    throw new Error("Gemini embedding request failed after retries");
  }

  private async sendBatchRequest(
    texts: readonly string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<Response> {
    return fetchWithTimeout(
      GOOGLE_PROVIDER_NAME,
      `${this.input.baseUrl}/models/${this.model}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.input.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            taskType,
          })),
        }),
      },
      EMBEDDING_TIMEOUT_MS,
    );
  }

  private parseEmbeddings(data: GeminiEmbeddingResponse, expectedCount: number): number[][] {
    const embeddings = data.embeddings ?? (data.embedding ? [data.embedding] : []);
    if (embeddings.length !== expectedCount) {
      throw new Error(`Gemini embedding response count mismatch: expected ${expectedCount}, received ${embeddings.length}`);
    }

    return embeddings.map((embedding, index) => {
      if (!embedding.values || embedding.values.length === 0) {
        throw new Error(`Gemini embedding response missing vector at index ${index}`);
      }
      return embedding.values;
    });
  }

  private async waitForQuota(nextBatchSize: number): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.windowStartedAt;
    if (elapsed >= RATE_WINDOW_MS) {
      this.windowStartedAt = now;
      this.embeddingsInWindow = 0;
      return;
    }

    if (this.embeddingsInWindow + nextBatchSize <= MAX_EMBEDDINGS_PER_MINUTE) return;

    await sleep(RATE_WINDOW_MS - elapsed);
    this.windowStartedAt = Date.now();
    this.embeddingsInWindow = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryMs(response: Response, body: string): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }

  const retryDelay = /"retryDelay"\s*:\s*"(\d+)s"/.exec(body)?.[1];
  if (retryDelay) return Number.parseInt(retryDelay, 10) * 1000;

  return DEFAULT_RETRY_MS;
}
