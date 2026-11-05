/** Resolves `cloudflare:workers` to a stub, so node:test can import the Worker's modules. */
type Resolve = (
  specifier: string,
  context: unknown,
) => Promise<{ url: string; shortCircuit?: boolean }>;

export async function resolve(specifier: string, context: unknown, next: Resolve) {
  if (specifier === 'cloudflare:workers') {
    return {
      url: new URL('./stubs/cloudflare-workers.ts', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
