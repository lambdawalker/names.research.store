/** Minimal structural boundary for reusable source clients; does not imply a verified claim. */
export interface SourceRecord<T> {
  source: string;
  locator: string;
  retrievedAt: string;
  revision?: string;
  upstreamSource?: string;
  data: T;
}

export interface ClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  userAgent: string;
}
