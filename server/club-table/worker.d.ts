/** Types for worker.js (plain JavaScript, so the Worker needs no build step). */
export interface Store {
  get(k: string): Promise<string | null>;
  put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
  delete(k: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
export const ADJECTIVES: string[];
export const CREATURES: string[];
export const LIMITS: { maxBytes: number; perWindow: number; windowS: number; pendingPerName: number };
export function isSafeName(x: unknown): boolean;
export function checkSubmission(b: unknown): string | undefined;
export function handle(request: Request, env: { STORE: Store; ADMIN_TOKEN?: string; TURNSTILE_SECRET?: string; ALLOWED_ORIGIN?: string }, now?: number): Promise<Response>;
export function kvStore(kv: unknown): Store;
export function memoryStore(map?: Map<string, string>): Store & { map: Map<string, string> };
declare const _default: { fetch(request: Request, env: unknown): Promise<Response> };
export default _default;
