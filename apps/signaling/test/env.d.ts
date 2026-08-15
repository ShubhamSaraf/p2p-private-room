export {};

declare module "cloudflare:test" {
  // The test runtime merges this interface with its built-in environment.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
