import { jsonResponse } from "./json-response";

export type RouteHandler = (request: Request, params: Record<string, string>) => Promise<Response> | Response;

interface Route {
  readonly method: string;
  readonly pattern: URLPattern;
  readonly handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  get(pathname: string, handler: RouteHandler): void {
    this.add("GET", pathname, handler);
  }

  post(pathname: string, handler: RouteHandler): void {
    this.add("POST", pathname, handler);
  }

  put(pathname: string, handler: RouteHandler): void {
    this.add("PUT", pathname, handler);
  }

  delete(pathname: string, handler: RouteHandler): void {
    this.add("DELETE", pathname, handler);
  }

  patch(pathname: string, handler: RouteHandler): void {
    this.add("PATCH", pathname, handler);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Basic CORS support
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const allowedMethods = new Set<string>();

    for (const route of this.routes) {
      const match = route.pattern.exec({ pathname: url.pathname });

      if (!match) {
        continue;
      }

      allowedMethods.add(route.method);

      if (route.method === request.method) {
        const response = await route.handler(request, removeUndefinedParams(match.pathname.groups));
        response.headers.set("Access-Control-Allow-Origin", "*");
        return response;
      }
    }

    if (allowedMethods.size > 0) {
      const allow = [...allowedMethods].sort().join(", ");
      const response = jsonResponse({ error: "Method Not Allowed" }, { status: 405, headers: { allow } });
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }

    const response = jsonResponse({ error: "Not Found" }, { status: 404 });
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }

  private add(method: string, pathname: string, handler: RouteHandler): void {
    this.routes.push({
      method,
      pattern: new URLPattern({ pathname }),
      handler,
    });
  }
}

function removeUndefinedParams(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
