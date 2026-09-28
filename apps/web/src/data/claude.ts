/**
 * Acesso às capacidades que o claude.ai dá à página publicada (contrato 0.2.60).
 * Fora do claude.ai (`npm start`, `npm run dev`) `window.claude` não existe e tudo resolve `null`.
 * Os tipos cobrem só o que este app usa.
 */

export interface DbSnapshotDoc {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DbQuerySnapshot {
  docs: DbSnapshotDoc[];
}

export interface DbDocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

export interface DbCollection {
  doc(id: string): DbDocRef;
  onSnapshot(next: (snap: DbQuerySnapshot) => void, error?: (e: { code: string; message: string }) => void): () => void;
}

export interface Db {
  collection(path: string): DbCollection;
}

export interface Assets {
  upload(blob: Blob, options?: { filename?: string }): Promise<{ id: string; url: string }>;
  delete(id: string): Promise<unknown>;
}

export interface User {
  isOwner(): boolean;
}

interface CapabilityMap {
  db: Db;
  assets: Assets;
  user: User;
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

export function claudeRuntime(): ClaudeRuntime | null {
  if (typeof window === 'undefined') return null;
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  return claude && typeof claude.use === 'function' ? claude : null;
}

/** A capacidade, ou `null` quando esta visualização não pode usá-la. Nunca rejeita. */
export async function capability<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null> {
  const claude = claudeRuntime();
  if (!claude) return null;
  try {
    return ((await claude.use(name)) as CapabilityMap[K] | null) ?? null;
  } catch {
    return null;
  }
}

export const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string' ? (error as { code: string }).code : 'unknown';
