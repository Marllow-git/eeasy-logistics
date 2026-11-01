// The API surfaces and their base paths (contracts README §1). A credential is valid on its own
// surface only; a path outside every surface has no principal (health probes, `@Public()`).

export const surfaces = ['staff', 'platform', 'driver', 'recipient', 'public'] as const;
export type Surface = (typeof surfaces)[number];

/** Surfaces whose access token is a JWT this API signs; its `aud` claim names the surface. */
export const tokenSurfaces = ['staff', 'platform', 'driver'] as const;
export type TokenSurface = (typeof tokenSurfaces)[number];

const pattern = /^\/v1\/(staff|platform|driver|recipient|public)(?:\/|$)/;

/** The surface a path belongs to, or undefined outside `/v1/<surface>` (exact, lowercase). */
export function surfaceOf(path: string): Surface | undefined {
  return pattern.exec(path)?.[1] as Surface | undefined;
}

/**
 * The surface of a request (adversary H-1): from the matched route template when there is one,
 * which is what decided the handler, else from the lowercased path. Never the raw path: Express
 * matches case-insensitively unless told otherwise, so `/V1/STAFF/...` reaches a staff handler.
 */
export function requestSurface(request: {
  readonly path: string;
  readonly route?: unknown;
}): Surface | undefined {
  const template = (request.route as { path?: unknown } | undefined)?.path;
  if (typeof template === 'string') return surfaceOf(template.toLowerCase());
  return surfaceOf(request.path.toLowerCase());
}
