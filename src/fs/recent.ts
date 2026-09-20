/** Remembered folders (File System Access handles survive in IndexedDB). */
import { get, set } from 'idb-keyval';

export type RecentEntry = { name: string; handle: FileSystemDirectoryHandle; openedAt: number };

const KEY = 'yae-viewer.recent';
const LIMIT = 6;

export async function listRecent(): Promise<RecentEntry[]> {
  try {
    const stored = (await get<RecentEntry[]>(KEY)) ?? [];
    return stored.filter((entry) => entry && entry.handle && entry.name);
  } catch {
    return [];
  }
}

export async function rememberRecent(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const current = await listRecent();
    const kept: RecentEntry[] = [];
    for (const entry of current) {
      let same = false;
      try {
        same = await entry.handle.isSameEntry(handle);
      } catch {
        same = false;
      }
      if (!same) kept.push(entry);
    }
    kept.unshift({ name: handle.name, handle, openedAt: Date.now() });
    await set(KEY, kept.slice(0, LIMIT));
  } catch {
    // IndexedDB unavailable (private window): nothing to remember.
  }
}

/** Must run inside a user gesture: the permission prompt is only allowed there. */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  try {
    if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}
