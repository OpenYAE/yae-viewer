/**
 * Getting the user's asset folder into a Catalog: the File System Access API
 * when the browser has it (Chromium — the handle can be remembered and
 * re-opened), `<input webkitdirectory>` otherwise, and drag & drop of a
 * folder or of loose files on every browser.
 */
import { buildCatalog, dirOf, extensionOf } from './catalog';
import type { Catalog, FileRef, ScanProgress } from './types';

export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

type ProgressCb = (progress: ScanProgress) => void;

function makeRef(name: string, path: string, size: number, getFile: () => Promise<File>): FileRef {
  return { name, path, dir: dirOf(path), ext: extensionOf(name), size, getFile };
}

async function walkHandle(dir: FileSystemDirectoryHandle, prefix: string, out: FileRef[], progress: ScanProgress, onProgress?: ProgressCb): Promise<void> {
  // `entries()` is standard; older typings may lack it.
  const iterable = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  const subdirs: Array<[string, FileSystemDirectoryHandle]> = [];
  for await (const [name, handle] of iterable) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      subdirs.push([path, handle as FileSystemDirectoryHandle]);
      continue;
    }
    const fileHandle = handle as FileSystemFileHandle;
    // Size is read lazily: asking every file for its File object doubles the
    // scan time on a full gameres tree.
    const ref = makeRef(name, path, -1, () => fileHandle.getFile());
    out.push(ref);
    progress.files += 1;
    if (ref.ext === 'ds2' || ref.ext === 'ds2md') progress.openable += 1;
    if ((progress.files & 255) === 0) {
      progress.current = path;
      onProgress?.({ ...progress });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  for (const [path, handle] of subdirs) await walkHandle(handle, path, out, progress, onProgress);
}

/** Fills in the sizes of the openable files (the list shows them); other files stay lazy. */
async function fillOpenableSizes(files: FileRef[]): Promise<void> {
  const openable = files.filter((f) => (f.ext === 'ds2' || f.ext === 'ds2md') && f.size < 0);
  const batch = 32;
  for (let i = 0; i < openable.length; i += batch) {
    await Promise.all(
      openable.slice(i, i + batch).map(async (ref) => {
        try {
          const file = await ref.getFile();
          ref.size = file.size;
        } catch {
          ref.size = 0;
        }
      }),
    );
  }
}

export async function catalogFromDirectoryHandle(handle: FileSystemDirectoryHandle, onProgress?: ProgressCb): Promise<Catalog> {
  const files: FileRef[] = [];
  const progress: ScanProgress = { files: 0, openable: 0, current: '' };
  await walkHandle(handle, '', files, progress, onProgress);
  await fillOpenableSizes(files);
  onProgress?.({ ...progress, current: '' });
  return buildCatalog(files, handle.name, 'directory-handle', handle);
}

/** Opens the folder picker; returns null when the user cancels. */
export async function pickDirectory(onProgress?: ProgressCb): Promise<Catalog | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (options?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return null;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker.call(window, { id: 'yae-gameres', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  return catalogFromDirectoryHandle(handle, onProgress);
}

/** Wraps a `File[]` from an `<input webkitdirectory>` or a drop into a catalog. */
export function catalogFromFileList(list: Iterable<File>, source: Catalog['source'] = 'input'): Catalog {
  const files: FileRef[] = [];
  let rootName = 'Files';
  let rootDetected = false;
  for (const file of list) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = rel.split('/').filter(Boolean);
    let path: string;
    if (parts.length > 1) {
      if (!rootDetected) {
        rootName = parts[0];
        rootDetected = true;
      }
      path = parts.slice(1).join('/');
    } else {
      path = parts[0] ?? file.name;
    }
    files.push(makeRef(file.name, path, file.size, async () => file));
  }
  return buildCatalog(files, rootName, source, null);
}

/** Asks the browser for a folder through the classic input (the fallback when there is no picker). */
export function pickDirectoryViaInput(): Promise<Catalog | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (catalog: Catalog | null) => {
      input.remove();
      resolve(catalog);
    };
    input.addEventListener('change', () => {
      const list = input.files ? Array.from(input.files) : [];
      done(list.length > 0 ? catalogFromFileList(list, 'input') : null);
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Asks for individual files (used where a browser refuses folders, and by the harness). */
export function pickFilesViaInput(): Promise<Catalog | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (catalog: Catalog | null) => {
      input.remove();
      resolve(catalog);
    };
    input.addEventListener('change', () => {
      const list = input.files ? Array.from(input.files) : [];
      done(list.length > 0 ? catalogFromFileList(list, 'input') : null);
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file(cb: (file: File) => void, err?: (e: unknown) => void): void;
  createReader(): { readEntries(cb: (entries: EntryLike[]) => void, err?: (e: unknown) => void): void };
};

async function walkEntry(entry: EntryLike, prefix: string, out: FileRef[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(makeRef(entry.name, path, file.size, async () => file));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, path, out);
  }
}

/**
 * A drop: one folder becomes the catalog root; loose files or several
 * folders become a virtual root holding them all.
 */
export async function catalogFromDrop(dataTransfer: DataTransfer, onProgress?: ProgressCb): Promise<Catalog | null> {
  const items = Array.from(dataTransfer.items ?? []);
  const handles: FileSystemHandle[] = [];
  if (items.length > 0 && 'getAsFileSystemHandle' in DataTransferItem.prototype) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const handle = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> }).getAsFileSystemHandle();
      if (handle) handles.push(handle);
    }
  }
  if (handles.length === 1 && handles[0].kind === 'directory') {
    return catalogFromDirectoryHandle(handles[0] as FileSystemDirectoryHandle, onProgress);
  }
  if (handles.length > 0) {
    const files: FileRef[] = [];
    const progress: ScanProgress = { files: 0, openable: 0, current: '' };
    for (const handle of handles) {
      if (handle.kind === 'directory') {
        await walkHandle(handle as FileSystemDirectoryHandle, handle.name, files, progress, onProgress);
      } else {
        const fh = handle as FileSystemFileHandle;
        files.push(makeRef(fh.name, fh.name, -1, () => fh.getFile()));
      }
    }
    await fillOpenableSizes(files);
    return buildCatalog(files, 'Dropped files', 'drop', null);
  }
  // webkitGetAsEntry path (Firefox, Safari)
  const entries: EntryLike[] = [];
  for (const item of items) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.() as EntryLike | null | undefined;
    if (entry) entries.push(entry);
  }
  if (entries.length > 0) {
    const files: FileRef[] = [];
    if (entries.length === 1 && entries[0].isDirectory) {
      const reader = entries[0].createReader();
      for (;;) {
        const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await walkEntry(child, '', files);
      }
      return buildCatalog(files, entries[0].name, 'drop', null);
    }
    for (const entry of entries) await walkEntry(entry, '', files);
    return buildCatalog(files, 'Dropped files', 'drop', null);
  }
  const plain = Array.from(dataTransfer.files ?? []);
  if (plain.length === 0) return null;
  return catalogFromFileList(plain, 'drop');
}
