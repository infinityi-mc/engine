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

  delete(pathname: string, handler: RouteHandler): void {
    this.add("DELETE", pathname, handler);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const allowedMethods = new Set<string>();

    for (const route of this.routes) {
      const match = route.pattern.exec({ pathname: url.pathname });

      if (!match) {
        continue;
      }

      allowedMethods.add(route.method);

      if (route.method === request.method) {
        return route.handler(request, removeUndefinedParams(match.pathname.groups));
      }
    }

    if (allowedMethods.size > 0) {
      const allow = [...allowedMethods].sort().join(", ");
      return jsonResponse({ error: "Method Not Allowed" }, { status: 405, headers: { allow } });
    }

    return jsonResponse({ error: "Not Found" }, { status: 404 });
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
