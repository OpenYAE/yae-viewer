/** The actions the UI triggers: folder access, opening files, rescans. */
import { catalogFromDirectoryHandle, catalogFromDrop, hasFileSystemAccess, pickDirectory, pickDirectoryViaInput, pickFilesViaInput } from '../fs/access';
import { ensureReadPermission, listRecent, rememberRecent, type RecentEntry } from '../fs/recent';
import type { Catalog, FileRef } from '../fs/types';
import { getEngine } from '../scene/engine';
import { useViewer } from '../state/store';

function applyCatalog(catalog: Catalog | null): void {
  const store = useViewer.getState();
  store.setScanning(null);
  if (!catalog) return;
  store.setCatalog(catalog);
  if (catalog.openableCount === 0) {
    store.pushToast('warn', `No .ds2 or .ds2md files found in "${catalog.rootName}"`);
  } else {
    store.pushToast('info', `${catalog.rootName}: ${catalog.openableCount} files, ${catalog.textures.size} textures`);
  }
}

export async function refreshRecent(): Promise<void> {
  if (!hasFileSystemAccess()) return;
  useViewer.getState().setRecent(await listRecent());
}

export async function addFolder(): Promise<void> {
  const store = useViewer.getState();
  try {
    if (hasFileSystemAccess()) {
      store.setScanning({ files: 0, openable: 0, current: '' });
      const catalog = await pickDirectory((progress) => useViewer.getState().setScanning(progress));
      applyCatalog(catalog);
      if (catalog?.handle) {
        await rememberRecent(catalog.handle);
        await refreshRecent();
      }
      return;
    }
    const catalog = await pickDirectoryViaInput();
    applyCatalog(catalog);
  } catch (error) {
    store.setScanning(null);
    store.pushToast('error', error instanceof Error ? error.message : String(error));
  }
}

export async function addFiles(): Promise<void> {
  const store = useViewer.getState();
  try {
    const catalog = await pickFilesViaInput();
    applyCatalog(catalog);
  } catch (error) {
    store.setScanning(null);
    store.pushToast('error', error instanceof Error ? error.message : String(error));
  }
}

export async function openRecent(entry: RecentEntry): Promise<void> {
  const store = useViewer.getState();
  const granted = await ensureReadPermission(entry.handle);
  if (!granted) {
    store.pushToast('warn', `Access to "${entry.name}" was not granted`);
    return;
  }
  try {
    store.setScanning({ files: 0, openable: 0, current: '' });
    const catalog = await catalogFromDirectoryHandle(entry.handle, (progress) => useViewer.getState().setScanning(progress));
    applyCatalog(catalog);
    await rememberRecent(entry.handle);
    await refreshRecent();
  } catch (error) {
    store.setScanning(null);
    store.pushToast('error', `${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function rescan(): Promise<void> {
  const store = useViewer.getState();
  const catalog = store.catalog;
  if (!catalog) return;
  if (!catalog.handle) {
    store.pushToast('info', 'This folder came from a file picker or a drop: choose it again to rescan');
    return;
  }
  try {
    store.setScanning({ files: 0, openable: 0, current: '' });
    const next = await catalogFromDirectoryHandle(catalog.handle, (progress) => useViewer.getState().setScanning(progress));
    applyCatalog(next);
  } catch (error) {
    store.setScanning(null);
    store.pushToast('error', error instanceof Error ? error.message : String(error));
  }
}

export async function handleDrop(dataTransfer: DataTransfer): Promise<void> {
  const store = useViewer.getState();
  try {
    store.setScanning({ files: 0, openable: 0, current: '' });
    const catalog = await catalogFromDrop(dataTransfer, (progress) => useViewer.getState().setScanning(progress));
    applyCatalog(catalog);
    if (catalog?.handle) {
      await rememberRecent(catalog.handle);
      await refreshRecent();
    }
    // A drop of a single openable file opens it straight away.
    if (catalog && catalog.openableCount === 1) {
      const only = catalog.files.find((f) => f.ext === 'ds2' || f.ext === 'ds2md');
      if (only) await openFile(only);
    }
  } catch (error) {
    store.setScanning(null);
    store.pushToast('error', error instanceof Error ? error.message : String(error));
  }
}

export async function openFile(ref: FileRef): Promise<void> {
  const store = useViewer.getState();
  const engine = getEngine();
  const catalog = store.catalog;
  if (!engine || !catalog) return;
  await engine.open(ref, catalog);
}

/** PWA file handling: the OS hands the installed viewer a file to open. */
export function installLaunchQueue(): void {
  const queue = (window as unknown as { launchQueue?: { setConsumer(cb: (params: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
  if (!queue) return;
  queue.setConsumer(async (params) => {
    if (!params.files || params.files.length === 0) return;
    const files: File[] = [];
    for (const handle of params.files) files.push(await handle.getFile());
    const { catalogFromFileList } = await import('../fs/access');
    const catalog = catalogFromFileList(files, 'drop');
    applyCatalog(catalog);
    const first = catalog.files.find((f) => f.ext === 'ds2' || f.ext === 'ds2md');
    if (first) await openFile(first);
  });
}

/** Harness hook: a smoke script feeds files through a plain `<input type=file>`. */
export function installTestHooks(): void {
  (window as unknown as { __yaeOpenFiles?: (files: FileList | File[], openFirst?: boolean) => Promise<void> }).__yaeOpenFiles = async (files, openFirst = true) => {
    const { catalogFromFileList } = await import('../fs/access');
    const catalog = catalogFromFileList(Array.from(files as ArrayLike<File>), 'input');
    applyCatalog(catalog);
    if (!openFirst) return;
    const first = catalog.files.find((f) => f.ext === 'ds2' || f.ext === 'ds2md');
    if (first) await openFile(first);
  };
}
