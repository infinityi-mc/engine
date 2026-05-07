import { jwtVerify } from "jose";
import { jsonResponse } from "./json-response";
import type { RouteHandler } from "./router";

export interface JwtGuardConfig {
  readonly secret: string;
  readonly issuer: string | undefined;
  readonly audience: string | undefined;
}

interface JwtClaims {
  readonly scope?: string;
  readonly iss?: string;
  readonly aud?: string;
  readonly exp?: number;
}

export class JwtGuard {
  private readonly key: Uint8Array;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;

  constructor(config: JwtGuardConfig) {
    this.key = new TextEncoder().encode(config.secret);
    this.issuer = config.issuer;
    this.audience = config.audience;
  }

  /**
   * Wrap a RouteHandler with JWT authentication + optional scope authorization.
   * If `requiredScope` is provided, the token must include that scope.
   */
  protect(handler: RouteHandler, requiredScope?: string): RouteHandler {
    return async (request, params) => {
      const authResult = await this.verifyToken(request, requiredScope);

      if (!authResult.ok) {
        return authResult.response;
      }

      return handler(request, params);
    };
  }

  private async verifyToken(
    request: Request,
    requiredScope?: string,
  ): Promise<{ ok: true } | { ok: false; response: Response }> {
    const header = request.headers.get("authorization");

    if (!header?.startsWith("Bearer ")) {
      return {
        ok: false,
        response: jsonResponse({ error: "Missing or invalid Authorization header" }, { status: 401 }),
      };
    }

    const token = header.slice(7);

    let payload: JwtClaims;

    try {
      const verification: { payload: unknown } = await jwtVerify(token, this.key, {
        ...(this.issuer ? { issuer: this.issuer } : {}),
        ...(this.audience ? { audience: this.audience } : {}),
      });
      payload = verification.payload as JwtClaims;
    } catch {
      return {
        ok: false,
        response: jsonResponse({ error: "Invalid or expired token" }, { status: 401 }),
      };
    }

    if (requiredScope) {
      const grantedScopes = payload.scope?.split(" ") ?? [];

      if (!grantedScopes.includes(requiredScope)) {
        return {
          ok: false,
          response: jsonResponse(
            { error: "Insufficient scope", required: requiredScope, granted: grantedScopes },
            { status: 403 },
          ),
        };
      }
    }

    return { ok: true };
  }
}
