import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { Router } from "../../src/shared/http/router";
import { JwtGuard } from "../../src/shared/http/jwt-guard";
import { QueryBus } from "../../src/shared/application/query-bus";
import { registerMcdocRoutes } from "../../src/modules/mcdoc/infrastructure/http/mcdoc-routes";
import { SCOPES } from "../../src/modules/mcdoc/infrastructure/http/scopes";
import { MCDOC_META_QUERY, McdocMetaHandler } from "../../src/modules/mcdoc/application/queries/mcdoc-meta.query";
import { LIST_MCDOC_PACKAGES_QUERY, ListMcdocPackagesHandler } from "../../src/modules/mcdoc/application/queries/list-mcdoc-packages.query";
import { SEARCH_MCDOC_QUERY, SearchMcdocHandler } from "../../src/modules/mcdoc/application/queries/search-mcdoc.query";
import { GET_MCDOC_SCHEMA_QUERY, GetMcdocSchemaHandler } from "../../src/modules/mcdoc/application/queries/get-mcdoc-schema.query";
import { GREP_MCDOC_FIELDS_QUERY, GrepMcdocFieldsHandler } from "../../src/modules/mcdoc/application/queries/grep-mcdoc-fields.query";
import { FIND_MCDOC_REFERENCES_QUERY, FindMcdocReferencesHandler } from "../../src/modules/mcdoc/application/queries/find-mcdoc-references.query";
import type { McdocRepositoryPort } from "../../src/modules/mcdoc/domain/ports/mcdoc-repository.port";
import { SchemaNotFoundError, UnsafeRegexError } from "../../src/modules/mcdoc/domain/errors/mcdoc.errors";
import { noopLogger } from "../../src/shared/observability/logger.port";

const testSecret = "test-secret-key-for-mcdoc-route-tests";

function token(scope: string): Promise<string> {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(testSecret));
}

function makeRouter(repoOverrides: Partial<McdocRepositoryPort> = {}): Router {
  const defaults: McdocRepositoryPort = {
    meta: () => ({ ref: "test-ref", schemaCount: 3, builtAt: "2025-01-01T00:00:00.000Z" }),
    listPackages: (prefix) => ({ prefix: prefix ?? "", children: ["::java"], schemas: [] }),
    getSchema: ((path: string, projection: string) => {
      if (path === "::java::Missing") throw new SchemaNotFoundError(path);
      return { path, kind: "struct", projection };
    }) as unknown as McdocRepositoryPort["getSchema"],
    search: (query) => [{ path: `::java::${query}`, kind: "struct", score: 100, matchedOn: ["path"] }],
    grepFields: (pattern) => {
      if (pattern === "(a+)+") throw new UnsafeRegexError("nested quantifier");
      return [{ path: "::java::A", fieldKey: "x" }];
    },
    findReferences: (path) => {
      if (path === "::java::Missing") throw new SchemaNotFoundError(path);
      return ["::java::B"];
    },
  };
  const repo: McdocRepositoryPort = { ...defaults, ...repoOverrides };

  const queryBus = new QueryBus();
  queryBus.register(MCDOC_META_QUERY, new McdocMetaHandler(repo));
  queryBus.register(LIST_MCDOC_PACKAGES_QUERY, new ListMcdocPackagesHandler(repo));
  queryBus.register(SEARCH_MCDOC_QUERY, new SearchMcdocHandler(repo));
  queryBus.register(GET_MCDOC_SCHEMA_QUERY, new GetMcdocSchemaHandler(repo));
  queryBus.register(GREP_MCDOC_FIELDS_QUERY, new GrepMcdocFieldsHandler(repo));
  queryBus.register(FIND_MCDOC_REFERENCES_QUERY, new FindMcdocReferencesHandler(repo));

  const router = new Router();
  const guard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
  registerMcdocRoutes(router, queryBus, guard, noopLogger);
  return router;
}

describe("mcdoc routes", () => {
  test("GET /mcdoc/meta requires JWT", async () => {
    const router = makeRouter();
    const response = await router.handle(new Request("http://localhost/mcdoc/meta"));
    expect(response.status).toBe(401);
  });

  test("GET /mcdoc/meta rejects insufficient scope", async () => {
    const router = makeRouter();
    const t = await token("wrong:scope");
    const response = await router.handle(
      new Request("http://localhost/mcdoc/meta", { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(403);
  });

  test("GET /mcdoc/meta returns 200 with meta", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request("http://localhost/mcdoc/meta", { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { ref: string };
    expect(body.ref).toBe("test-ref");
  });

  test("GET /mcdoc/packages forwards prefix", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request("http://localhost/mcdoc/packages?prefix=::java", { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { prefix: string };
    expect(body.prefix).toBe("::java");
  });

  test("GET /mcdoc/search returns 400 when q is missing", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request("http://localhost/mcdoc/search", { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(400);
  });

  test("GET /mcdoc/search returns 400 for invalid limit", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request("http://localhost/mcdoc/search?q=Atlas&limit=0", { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(400);
  });

  test("GET /mcdoc/search returns hits", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request("http://localhost/mcdoc/search?q=Atlas&kind=struct&package=::java", {
        headers: { authorization: `Bearer ${t}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { hits: Array<{ path: string }> };
    expect(body.hits[0]?.path).toBe("::java::Atlas");
  });

  test("GET /mcdoc/schemas/:path decodes URL-encoded FQN", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const encoded = encodeURIComponent("::java::assets::atlas::Atlas");
    const response = await router.handle(
      new Request(`http://localhost/mcdoc/schemas/${encoded}?projection=summary`, {
        headers: { authorization: `Bearer ${t}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { path: string };
    expect(body.path).toBe("::java::assets::atlas::Atlas");
  });

  test("GET /mcdoc/schemas/:path 404 on missing schema", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const encoded = encodeURIComponent("::java::Missing");
    const response = await router.handle(
      new Request(`http://localhost/mcdoc/schemas/${encoded}`, { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(404);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("SchemaNotFound");
  });

  test("GET /mcdoc/schemas/:path rejects bad projection", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const encoded = encodeURIComponent("::java::A");
    const response = await router.handle(
      new Request(`http://localhost/mcdoc/schemas/${encoded}?projection=bogus`, {
        headers: { authorization: `Bearer ${t}` },
      }),
    );
    expect(response.status).toBe(400);
  });

  test("GET /mcdoc/fields 400 on unsafe regex", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request(`http://localhost/mcdoc/fields?pattern=${encodeURIComponent("(a+)+")}`, {
        headers: { authorization: `Bearer ${t}` },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("UnsafeRegex");
  });

  test("GET /mcdoc/fields returns matches", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const response = await router.handle(
      new Request("http://localhost/mcdoc/fields?pattern=x", { headers: { authorization: `Bearer ${t}` } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { matches: Array<{ path: string }> };
    expect(body.matches[0]?.path).toBe("::java::A");
  });

  test("GET /mcdoc/schemas/:path/references returns 404 for unknown path", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const encoded = encodeURIComponent("::java::Missing");
    const response = await router.handle(
      new Request(`http://localhost/mcdoc/schemas/${encoded}/references`, {
        headers: { authorization: `Bearer ${t}` },
      }),
    );
    expect(response.status).toBe(404);
  });

  test("GET /mcdoc/schemas/:path/references returns refs list", async () => {
    const router = makeRouter();
    const t = await token(SCOPES.MCDOC_READ);
    const encoded = encodeURIComponent("::java::A");
    const response = await router.handle(
      new Request(`http://localhost/mcdoc/schemas/${encoded}/references`, {
        headers: { authorization: `Bearer ${t}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { references: string[] };
    expect(body.references).toEqual(["::java::B"]);
  });
});
