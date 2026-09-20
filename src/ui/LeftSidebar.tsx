import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { formatBytes } from '../fs/catalog';
import type { FileNode, FolderNode } from '../fs/types';
import { useViewer } from '../state/store';
import type { AssetInfo, DisplayToggleKey, HierarchyKind, HierarchyNode } from '../state/types';
import { getEngine } from '../scene/engine';
import { addFolder, openFile, openRecent, rescan } from './actions';
import { IconButton, NumberRow, SearchField, SectionHeader, SliderField, ToggleRow } from './controls';
import { BoneIcon, ChevronDownIcon, CloseIcon, CollapseIcon, CubeIcon, FolderIcon, HistoryIcon, LayersIcon, MeshIcon, PlayIcon, PlusIcon, ReloadIcon } from './icons';
import { TreeView, type TreeNode, type TreeViewHandle } from './TreeView';

type FileTreeNode = TreeNode & { kind: 'folder' | 'file' | 'summary'; path?: string; ext?: string; ref?: FileNode['ref']; size?: number; groupId?: string; tab?: 'objects' | 'skeleton' };

/** The open file unfolds into what it holds; each row leads to the matching group of the Objects tree. */
function summaryRows(path: string, asset: AssetInfo, hierarchy: HierarchyNode[]): FileTreeNode[] {
  const rows: FileTreeNode[] = [];
  const group = (kind: HierarchyKind) => hierarchy.find((n) => n.kind === kind);
  const push = (name: string, badge: string, node: HierarchyNode | undefined, tab: 'objects' | 'skeleton' = 'objects') => {
    if (!node && tab === 'objects') return;
    rows.push({ id: `${path}::${name}`, name, kind: 'summary', badge, groupId: node?.id, tab, searchText: '' });
  };
  push('Meshes', group('mesh')?.badge ?? '0', group('mesh'));
  if (asset.kind === 'model') {
    if (asset.bones > 0) push('Skeleton', String(asset.bones), undefined, 'skeleton');
    push('Animations', String(asset.clips), group('mesh'));
    push('Collisions', group('collision-group')?.badge ?? '0', group('collision-group'));
  } else {
    push('Lightmaps', group('lightmaps')?.badge ?? '0', group('lightmaps'));
    push('Lights', group('lights')?.badge ?? '0', group('lights'));
    push('Collision', group('overlay-collision')?.badge ?? '', group('overlay-collision'));
    push('Navmesh', group('overlay-navmesh')?.badge ?? '', group('overlay-navmesh'));
    push('Model instances', group('model-instances')?.badge ?? '', group('model-instances'));
  }
  return rows;
}

function toTreeNodes(node: FolderNode, openPath: string | null, asset: AssetInfo | null, hierarchy: HierarchyNode[]): FileTreeNode[] {
  return node.children.map((child) => {
    if (child.kind === 'folder') {
      return { id: child.id, name: child.name, kind: 'folder', badge: String(child.fileCount), children: toTreeNodes(child, openPath, asset, hierarchy), searchText: child.path };
    }
    const open = openPath === child.path && asset;
    return {
      id: child.id,
      path: child.path,
      name: child.name,
      kind: 'file',
      ext: child.ext,
      ref: child.ref,
      size: child.size,
      badge: child.size >= 0 ? formatBytes(child.size) : '',
      searchText: child.path,
      children: open ? summaryRows(child.path, asset, hierarchy) : undefined,
    };
  });
}

const DISPLAY_TOGGLES: Array<{ key: DisplayToggleKey; label: string; tone?: 'teal'; needs?: 'model' | 'level' }> = [
  { key: 'lightmaps', label: 'Lightmaps', needs: 'level' },
  { key: 'lights', label: 'Lights', needs: 'level' },
  { key: 'shadows', label: 'Shadows', needs: 'level' },
  { key: 'navmesh', label: 'Navmesh', tone: 'teal', needs: 'level' },
  { key: 'wireframe', label: 'Wireframe' },
  { key: 'collision', label: 'Collision' },
  { key: 'boundingBoxes', label: 'Bounding boxes' },
  { key: 'grid', label: 'Ground grid' },
  { key: 'skeleton', label: 'Skeleton gizmos', needs: 'model' },
];

export function LeftSidebar(): ReactElement {
  const catalog = useViewer((s) => s.catalog);
  const scanning = useViewer((s) => s.scanning);
  const openPath = useViewer((s) => s.openPath);
  const asset = useViewer((s) => s.asset);
  const hierarchy = useViewer((s) => s.hierarchy);
  const recent = useViewer((s) => s.recent);
  const fsAccess = useViewer((s) => s.fsAccess);
  const [query, setQuery] = useState('');
  const [recentOpen, setRecentOpen] = useState(false);
  const treeRef = useRef<TreeViewHandle | null>(null);
  const recentRef = useRef<HTMLDivElement | null>(null);
  const nodes = useMemo(() => (catalog ? toTreeNodes(catalog.tree, openPath, asset, hierarchy) : []), [catalog, openPath, asset, hierarchy]);
  const initiallyExpanded = useMemo(() => {
    // open the top level, and every folder small enough to show at a glance
    const ids: string[] = [];
    if (!catalog) return ids;
    const walk = (node: FolderNode, top: boolean) => {
      if (top || node.fileCount <= 40) {
        ids.push(node.id);
        for (const child of node.children) if (child.kind === 'folder') walk(child, false);
      }
    };
    for (const child of catalog.tree.children) if (child.kind === 'folder') walk(child, true);
    return ids;
  }, [catalog]);

  useEffect(() => {
    if (!recentOpen) return;
    const onDown = (event: PointerEvent) => {
      if (recentRef.current && !recentRef.current.contains(event.target as Node)) setRecentOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [recentOpen]);

  const selected = useMemo(() => new Set(openPath ? [openPath] : []), [openPath]);
  useEffect(() => {
    if (openPath) treeRef.current?.reveal(openPath, true);
  }, [openPath, nodes]);

  return (
    <aside className="sidebar sidebar--left">
      <div className="app-header">
        <span className="app-header__logo">
          <CubeIcon size={14} strokeWidth={2} />
        </span>
        <span className="app-header__title">YAE Viewer</span>
        <span className="grow" />
        <span className="app-header__version">{__APP_VERSION__}</span>
      </div>

      <div className="file-list">
        <SectionHeader
          title="File list"
          actions={
            <>
              <IconButton label="Rescan folder" onClick={() => void rescan()} disabled={!catalog}>
                <ReloadIcon size={13} />
              </IconButton>
              <IconButton label="Collapse all folders" onClick={() => treeRef.current?.collapseAll()} disabled={!catalog}>
                <CollapseIcon size={13} />
              </IconButton>
            </>
          }
        />
        <SearchField id="filesearch" label="Search files" placeholder="Search files and folders" value={query} onChange={setQuery} disabled={!catalog} />
        {catalog ? (
          <div className="file-list__root" title={catalog.rootName}>
            {catalog.rootName} · {catalog.openableCount} files
          </div>
        ) : null}
        <TreeView<FileTreeNode>
          key={catalog?.rootName ?? 'none'}
          ref={treeRef}
          nodes={nodes}
          query={query}
          selectedIds={selected}
          primaryId={openPath}
          renderIcon={(node, isSelected) =>
            node.kind === 'folder' ? (
              <FolderIcon size={13} />
            ) : node.kind === 'summary' ? (
              node.name === 'Skeleton' ? <BoneIcon size={12} /> : node.name === 'Animations' ? <PlayIcon size={11} /> : <MeshIcon size={12} />
            ) : node.ext === 'ds2' ? (
              <LayersIcon size={13} style={{ color: isSelected ? 'var(--teal)' : undefined }} />
            ) : (
              <CubeIcon size={13} />
            )
          }
          onSelect={(node) => {
            if (node.kind === 'file' && node.ref) {
              if (node.path !== openPath) void openFile(node.ref);
              return;
            }
            if (node.kind === 'summary') {
              const engine = getEngine();
              useViewer.getState().setInspectorTab(node.tab ?? 'objects');
              if (node.groupId && engine) engine.select([node.groupId], node.groupId);
            }
          }}
          initiallyExpanded={initiallyExpanded}
          autoExpandOnFilter
          ariaLabel="Files"
          emptyText={
            scanning ? (
              <span>
                Scanning… {scanning.files.toLocaleString('en-US')} files
                {scanning.openable ? `, ${scanning.openable} openable` : ''}
              </span>
            ) : catalog ? (
              query ? 'Nothing matches the filter.' : 'No .ds2 or .ds2md files in this folder.'
            ) : (
              <span>
                Add the folder with the unpacked game files
                <br />
                (<span className="mono">gameres</span>) to list its levels and models.
              </span>
            )
          }
        />
        <div className="file-list__footer" style={{ position: 'relative' }} ref={recentRef}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="button-dashed" onClick={() => void addFolder()} disabled={Boolean(scanning)}>
              <PlusIcon size={14} />
              {catalog ? 'Change folder' : 'Add folder'}
            </button>
            {fsAccess ? (
              <button type="button" className="button-dashed" style={{ width: 44, flexShrink: 0 }} aria-label="Open recent folder" title="Open recent folder" onClick={() => setRecentOpen((v) => !v)} disabled={recent.length === 0}>
                <HistoryIcon size={14} />
                <ChevronDownIcon size={10} />
              </button>
            ) : null}
          </div>
          {recentOpen ? (
            <div className="menu" role="menu" style={{ left: 12, right: 12, bottom: 44, minWidth: 0 }}>
              {recent.map((entry) => (
                <button
                  key={`${entry.name}-${entry.openedAt}`}
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  style={{ paddingLeft: 10 }}
                  onClick={() => {
                    setRecentOpen(false);
                    void openRecent(entry);
                  }}
                >
                  <FolderIcon size={13} />
                  <span className="menu__label">{entry.name}</span>
                  <span className="menu__key">{new Date(entry.openedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <DisplaySettings />
    </aside>
  );
}

function DisplaySettings(): ReactElement {
  const display = useViewer((s) => s.display);
  const setDisplay = useViewer((s) => s.setDisplay);
  const asset = useViewer((s) => s.asset);
  const environment = useViewer((s) => s.environment);
  const enabledCount = DISPLAY_TOGGLES.filter((t) => display[t.key]).length;
  const update = (patch: Partial<typeof display>) => {
    setDisplay(patch);
    getEngine()?.applyDisplay({ ...useViewer.getState().display });
  };
  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--line)' }}>
      <SectionHeader title="Display settings" meta={`${enabledCount} / ${DISPLAY_TOGGLES.length}`} />
      <div style={{ padding: '5px 4px' }}>
        {DISPLAY_TOGGLES.map((toggle) => (
          <ToggleRow
            key={toggle.key}
            label={toggle.label}
            checked={display[toggle.key]}
            tone={toggle.tone}
            disabled={Boolean(toggle.needs && asset && asset.kind !== toggle.needs)}
            onChange={(checked) => update({ [toggle.key]: checked })}
          />
        ))}
        <span className="divider" />
        <EnvironmentRow />
        <ToggleRow label="HDR background" checked={display.hdrBackground} disabled={!environment} onChange={(checked) => update({ hdrBackground: checked })} />
        <span className="divider" />
        <SliderField id="exposure" label="Exposure" value={display.exposure} min={0} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => update({ exposure: v })} />
        <NumberRow id="gridstep" label="Grid step" value={display.gridStep} unit="m" min={0.05} onCommit={(v) => update({ gridStep: v })} />
      </div>
    </div>
  );
}

/** The HDR backdrop: a file picker, or one of the .exr/.hdr images found in the folder. */
function EnvironmentRow(): ReactElement {
  const environment = useViewer((s) => s.environment);
  const catalog = useViewer((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  const pickFile = () => {
    setOpen(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.exr,.hdr';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void getEngine()?.setEnvironmentFile(file);
    });
    input.addEventListener('cancel', () => input.remove());
    input.click();
  };
  const hdris = catalog?.hdris ?? [];
  return (
    <div className="number-row" style={{ position: 'relative', gap: 8 }} ref={ref}>
      <span className="number-row__label" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={environment ? `${environment.name} · ${environment.width}×${environment.height}` : undefined}>
        {environment ? environment.name : 'Environment'}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {environment ? (
          <IconButton label="Remove HDR background" onClick={() => getEngine()?.clearEnvironment()}>
            <CloseIcon size={12} />
          </IconButton>
        ) : null}
        <button type="button" className="chip-button chip-button--small" style={{ fontFamily: 'inherit', fontSize: 11.5 }} aria-haspopup="menu" aria-expanded={open} onClick={() => (hdris.length > 0 ? setOpen((v) => !v) : pickFile())}>
          Load HDR
          <ChevronDownIcon size={10} />
        </button>
      </span>
      {open ? (
        <div className="menu" role="menu" style={{ right: 8, top: 30, minWidth: 200, maxWidth: 260 }}>
          <button type="button" role="menuitem" className="menu__item" style={{ paddingLeft: 10 }} onClick={pickFile}>
            <span className="menu__label">Choose a file… (.exr, .hdr)</span>
          </button>
          <span className="menu__separator" />
          {hdris.slice(0, 12).map((ref) => (
            <button
              key={ref.path}
              type="button"
              role="menuitem"
              className="menu__item"
              style={{ paddingLeft: 10 }}
              title={ref.path}
              onClick={async () => {
                setOpen(false);
                const engine = getEngine();
                if (!engine) return;
                await engine.setEnvironmentFile(await ref.getFile());
              }}
            >
              <span className="menu__label">{ref.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
