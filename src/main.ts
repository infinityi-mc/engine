import { createContainer } from "./bootstrap/container";
import { jsonResponse } from "./shared/http/json-response";
import { Router } from "./shared/http/router";
import { registerSystemRoutes } from "./modules/system/infrastructure/http/system-routes";

const port = Number(Bun.env.PORT ?? 3000);
const container = createContainer();
const router = new Router();

router.get("/health", () => jsonResponse({ status: "ok" }));
registerSystemRoutes(router, container.commandBus, container.queryBus, container.guard, container.logger);

const server = Bun.serve({
  port,
  fetch: (request) => router.handle(request),
});

container.logger.info("server.started", {
  module: "bootstrap",
  port: server.port,
  url: `http://localhost:${server.port}`,
});
