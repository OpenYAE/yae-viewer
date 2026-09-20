import { OPENABLE_EXTENSIONS, TEXTURE_EXTENSIONS, type Catalog, type FileNode, type FileRef, type FolderNode } from './types';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
}

export function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

const TEXTURE_RANK = new Map<string, number>(TEXTURE_EXTENSIONS.map((ext, i) => [ext, i]));

/** Indexes a flat file list into the lookups the loaders use and the tree the file list shows. */
export function buildCatalog(files: FileRef[], rootName: string, source: Catalog['source'], handle: FileSystemDirectoryHandle | null): Catalog {
  const byPath = new Map<string, FileRef>();
  const byDir = new Map<string, FileRef[]>();
  const textures = new Map<string, FileRef[]>();
  const mats: FileRef[] = [];

  for (const file of files) {
    byPath.set(file.path.toLowerCase(), file);
    const dirKey = file.dir.toLowerCase();
    let list = byDir.get(dirKey);
    if (!list) byDir.set(dirKey, (list = []));
    list.push(file);
    if (TEXTURE_RANK.has(file.ext)) {
      const key = stemOf(file.name);
      let candidates = textures.get(key);
      if (!candidates) textures.set(key, (candidates = []));
      candidates.push(file);
    } else if (file.ext === 'mat') {
      mats.push(file);
    }
  }
  for (const candidates of textures.values()) {
    candidates.sort((a, b) => (TEXTURE_RANK.get(a.ext) ?? 9) - (TEXTURE_RANK.get(b.ext) ?? 9));
  }

  const root: FolderNode = { kind: 'folder', id: '', name: rootName, path: '', children: [], fileCount: 0 };
  const folders = new Map<string, FolderNode>([['', root]]);
  const folderFor = (path: string): FolderNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const parent = folderFor(dirOf(path));
    const node: FolderNode = { kind: 'folder', id: path, name: path.slice(path.lastIndexOf('/') + 1), path, children: [], fileCount: 0 };
    parent.children.push(node);
    folders.set(path, node);
    return node;
  };

  let openableCount = 0;
  for (const file of files) {
    if (!OPENABLE_EXTENSIONS.has(file.ext)) continue;
    openableCount += 1;
    const node: FileNode = { kind: 'file', id: file.path, name: file.name, path: file.path, ext: file.ext, size: file.size, ref: file };
    folderFor(file.dir).children.push(node);
  }
  const finish = (node: FolderNode): number => {
    let count = 0;
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    for (const child of node.children) count += child.kind === 'folder' ? finish(child) : 1;
    node.fileCount = count;
    return count;
  };
  finish(root);

  return { rootName, source, files, byPath, byDir, textures, mats, tree: root, openableCount, handle };
}

/** Finds a texture by the name a mesh stores (no path, no extension), preferring dds then tga. */
export function findTexture(catalog: Catalog, stem: string): FileRef | null {
  const candidates = catalog.textures.get(stem.toLowerCase());
  return candidates?.[0] ?? null;
}

/** A file beside `ref` with the given basename (case-insensitive). */
export function findSibling(catalog: Catalog, ref: FileRef, basename: string): FileRef | null {
  const siblings = catalog.byDir.get(ref.dir.toLowerCase());
  if (!siblings) return null;
  const wanted = basename.toLowerCase();
  return siblings.find((f) => f.name.toLowerCase() === wanted) ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
