/** One file of the user's asset folder, wherever it came from (directory handle, input, drop). */
export interface FileRef {
  /** basename as on disk */
  name: string;
  /** '/'-separated path relative to the chosen root, e.g. `maps/map10/med1.ds2` */
  path: string;
  /** directory part of `path` ('' at the root) */
  dir: string;
  /** lower-case extension without the dot */
  ext: string;
  size: number;
  getFile(): Promise<File>;
}

/** The kinds of file the viewer opens from the file list. */
export const OPENABLE_EXTENSIONS = new Set(['ds2', 'ds2md']);
/** Files that are loaded beside an openable one, never listed on their own. */
export const SIDECAR_EXTENSIONS = new Set(['ds2cm', 'ds2cm2', 'ds2aim', 'tga', 'dds', 'png', 'jpg', 'jpeg', 'bmp', 'mat']);
export const TEXTURE_EXTENSIONS = ['dds', 'tga', 'png', 'jpg', 'jpeg', 'bmp'] as const;

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  children: Array<FolderNode | FileNode>;
  /** openable files in this subtree */
  fileCount: number;
}

export interface FileNode {
  kind: 'file';
  id: string;
  name: string;
  path: string;
  ext: string;
  size: number;
  ref: FileRef;
}

export interface Catalog {
  /** the name of the chosen folder */
  rootName: string;
  /** how the files were obtained */
  source: 'directory-handle' | 'input' | 'drop';
  files: FileRef[];
  /** lower-case path → file */
  byPath: Map<string, FileRef>;
  /** lower-case directory → files in it */
  byDir: Map<string, FileRef[]>;
  /** lower-case stem (no extension) → texture candidates, preferred first (dds, tga, png, jpg, bmp) */
  textures: Map<string, FileRef[]>;
  /** every `.mat` file */
  mats: FileRef[];
  /** every `.exr`/`.hdr` image, offered as a background */
  hdris: FileRef[];
  /** the openable files as a folder tree (empty folders pruned) */
  tree: FolderNode;
  openableCount: number;
  handle: FileSystemDirectoryHandle | null;
}

export type ScanProgress = { files: number; openable: number; current: string };
