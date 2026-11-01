// The API surfaces and their base paths (contracts README §1). A credential is valid on its own
// surface only; a path outside every surface has no principal (health probes, `@Public()`).

export const surfaces = ['staff', 'platform', 'driver', 'recipient', 'public'] as const;
export type Surface = (typeof surfaces)[number];

/** Surfaces whose access token is a JWT this API signs; its `aud` claim names the surface. */
export const tokenSurfaces = ['staff', 'platform', 'driver'] as const;
export type TokenSurface = (typeof tokenSurfaces)[number];

const pattern = /^\/v1\/(staff|platform|driver|recipient|public)(?:\/|$)/;

/** The surface a request path belongs to, or undefined outside `/v1/<surface>`. */
export function surfaceOf(path: string): Surface | undefined {
  return pattern.exec(path)?.[1] as Surface | undefined;
}
