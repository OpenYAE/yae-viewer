import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { getEngine } from '../scene/engine';
import { useViewer } from '../state/store';
import type { HierarchyKind, HierarchyNode } from '../state/types';
import { IconButton, SearchField, SectionHeader } from './controls';
import {
  BoneIcon,
  CollapseIcon,
  CollisionIcon,
  CubeIcon,
  InstancesIcon,
  LayersIcon,
  LightIcon,
  LightmapIcon,
  MaterialIcon,
  MeshIcon,
  NavmeshIcon,
  PauseIcon,
  PlayIcon,
  TextureIcon,
  TreeIcon,
} from './icons';
import { TreeView, type TreeNode, type TreeViewHandle } from './TreeView';

type ObjectTreeNode = TreeNode & { kind: HierarchyKind; children?: ObjectTreeNode[] };

function toTreeNodes(nodes: HierarchyNode[]): ObjectTreeNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    kind: node.kind,
    badge: node.badge,
    inert: node.kind === 'empty',
    searchText: node.meta ? Object.values(node.meta).join(' ') : undefined,
    children: node.children ? toTreeNodes(node.children) : undefined,
  }));
}

function iconFor(kind: HierarchyKind, selected: boolean): ReactElement {
  const size = 13;
  switch (kind) {
    case 'mesh':
    case 'mesh-item':
      return <MeshIcon size={size} />;
    case 'material':
      return <MaterialIcon size={size} />;
    case 'texture':
      return <TextureIcon size={size} />;
    case 'bone':
      return <span className="tree-row__dot" />;
    case 'skeleton':
      return <BoneIcon size={size} />;
    case 'collision-group':
    case 'collision-shape':
    case 'overlay-collision':
      return <CollisionIcon size={size} />;
    case 'lightmaps':
    case 'lightmap':
      return <LightmapIcon size={size} />;
    case 'lights':
    case 'level-light':
      return <LightIcon size={size} style={{ color: selected ? undefined : 'var(--amber)' }} />;
    case 'overlay-navmesh':
      return <NavmeshIcon size={size} style={{ color: selected ? undefined : 'var(--teal)' }} />;
    case 'overlay-vistree':
      return <TreeIcon size={size} />;
    case 'model-instances':
    case 'model-instance':
      return <InstancesIcon size={size} />;
    case 'model':
      return <CubeIcon size={size} />;
    default:
      return <span className="tree-row__dot" />;
  }
}

export function RightSidebar(): ReactElement {
  const asset = useViewer((s) => s.asset);
  return (
    <aside className="sidebar sidebar--right">
      <div className="app-header" style={{ padding: '0 10px 0 14px', gap: 8 }}>
        <span className="app-header__title">Scene Inspector</span>
        <span className="grow" />
        <IconButton label="Frame selection" title="Frame selection (F)" disabled={!asset} onClick={() => getEngine()?.frameSelected()}>
          <CubeIcon size={14} />
        </IconButton>
      </div>
      <InfoCard />
      <InspectorTrees />
      <TransformSection />
      <AnimationsSection />
    </aside>
  );
}

function InfoCard(): ReactElement {
  const asset = useViewer((s) => s.asset);
  const loadError = useViewer((s) => s.loadError);
  if (!asset) {
    return (
      <div className="info-card">
        <div className="info-card__head">
          <span className="info-card__icon info-card__icon--empty">
            <CubeIcon size={14} />
          </span>
          <span style={{ flexGrow: 1, minWidth: 0 }}>
            <span className="info-card__name info-card__name--empty">{loadError ? 'Could not open' : 'No selection'}</span>
            <span className="info-card__path info-card__path--empty" title={loadError ?? undefined}>
              {loadError ?? 'Pick a file to see its details'}
            </span>
          </span>
        </div>
        <div className="info-grid info-grid--dim">
          {['Format', 'Size', 'Meshes', 'Materials', 'Bones', 'Clips'].map((label) => (
            <div key={label} className="info-grid__row">
              <span className="info-grid__label">{label}</span>
              <span className="info-grid__value">—</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const isScene = asset.kind === 'level';
  return (
    <div className="info-card">
      <div className="info-card__head">
        <span className={`info-card__icon ${isScene ? 'info-card__icon--scene' : ''}`}>{isScene ? <LayersIcon size={14} /> : <CubeIcon size={14} />}</span>
        <span style={{ flexGrow: 1, minWidth: 0 }}>
          <span className="info-card__name" title={asset.fileName}>
            {asset.fileName}
          </span>
          <span className="info-card__path" title={`${asset.dir || '/'} · ${asset.name}`}>
            {asset.dir ? `${asset.dir} / ` : ''}
            {asset.name}
          </span>
        </span>
        <span className={`kind-badge ${isScene ? 'kind-badge--scene' : ''}`}>{isScene ? 'SCENE' : 'MODEL'}</span>
      </div>
      <div className="info-grid">
        {asset.rows.map(([label, value]) => (
          <div key={label} className="info-grid__row">
            <span className="info-grid__label">{label}</span>
            <span className="info-grid__value" title={value}>
              {value}
            </span>
          </div>
        ))}
      </div>
      {asset.warnings.length > 0 ? (
        <div className="info-card__warnings" title={asset.warnings.join('\n')}>
          {asset.warnings.length === 1 ? asset.warnings[0] : `${asset.warnings.length} warnings — ${asset.warnings[0]}`}
        </div>
      ) : null}
    </div>
  );
}

function InspectorTrees(): ReactElement {
  const asset = useViewer((s) => s.asset);
  const hierarchy = useViewer((s) => s.hierarchy);
  const skeleton = useViewer((s) => s.skeleton);
  const tab = useViewer((s) => s.inspectorTab);
  const setTab = useViewer((s) => s.setInspectorTab);
  const selection = useViewer((s) => s.selection);
  const hidden = useViewer((s) => s.hidden);
  const [query, setQuery] = useState('');
  const treeRef = useRef<TreeViewHandle | null>(null);
  const anchor = useRef<string | null>(null);
  const objectNodes = useMemo(() => toTreeNodes(hierarchy), [hierarchy]);
  const skeletonNodes = useMemo(() => toTreeNodes(skeleton), [skeleton]);
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);
  const boneCount = useMemo(() => {
    let n = 0;
    const walk = (nodes: HierarchyNode[]) => nodes.forEach((node) => {
      n += 1;
      if (node.children) walk(node.children);
    });
    walk(skeleton);
    return n;
  }, [skeleton]);
  const objectCount = useMemo(() => {
    let n = 0;
    const walk = (nodes: HierarchyNode[]) => nodes.forEach((node) => {
      if (node.kind === 'mesh-item' || node.kind === 'level-light' || node.kind === 'collision-shape') n += 1;
      if (node.children) walk(node.children);
    });
    walk(hierarchy);
    return n;
  }, [hierarchy]);

  const activeTab = tab === 'skeleton' && skeleton.length === 0 ? 'objects' : tab;
  const nodes = activeTab === 'skeleton' ? skeletonNodes : objectNodes;
  const initiallyExpanded = useMemo(() => {
    const ids: string[] = [];
    if (activeTab === 'skeleton') {
      // the first two levels of the rig
      for (const root of skeleton) {
        ids.push(root.id);
        for (const child of root.children ?? []) ids.push(child.id);
      }
    } else {
      for (const node of hierarchy) if (node.kind === 'mesh' || node.kind === 'lights' || node.kind === 'lightmaps') ids.push(node.id);
    }
    return ids;
  }, [activeTab, hierarchy, skeleton]);

  const select = (node: ObjectTreeNode, options: { additive: boolean; range: boolean }, visibleIds: string[]) => {
    const engine = getEngine();
    if (!engine) return;
    const current = useViewer.getState().selection;
    if (options.range && anchor.current) {
      const from = visibleIds.indexOf(anchor.current);
      const to = visibleIds.indexOf(node.id);
      if (from >= 0 && to >= 0) {
        const [a, b] = from <= to ? [from, to] : [to, from];
        const rangeIds = visibleIds.slice(a, b + 1);
        const ids = options.additive ? [...new Set([...current.ids, ...rangeIds])] : rangeIds;
        engine.select(ids, node.id);
        return;
      }
    }
    if (options.additive) {
      const ids = current.ids.includes(node.id) ? current.ids.filter((id) => id !== node.id) : [...current.ids, node.id];
      engine.select(ids, ids.includes(node.id) ? node.id : ids[ids.length - 1] ?? null);
    } else {
      engine.select([node.id], node.id);
    }
    anchor.current = node.id;
  };

  return (
    <>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === 'objects'} className={`tab ${activeTab === 'objects' ? 'tab--active' : ''}`} disabled={!asset} onClick={() => setTab('objects')}>
          Objects {asset ? <span className="tab__count">{objectCount.toLocaleString('en-US')}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'skeleton'} className={`tab ${activeTab === 'skeleton' ? 'tab--active' : ''}`} disabled={!asset || skeleton.length === 0} onClick={() => setTab('skeleton')}>
          Skeleton {skeleton.length > 0 ? <span className="tab__count">{boneCount}</span> : null}
        </button>
        <span className="grow" />
        <IconButton label="Collapse all" disabled={!asset} onClick={() => treeRef.current?.collapseAll()}>
          <CollapseIcon size={13} />
        </IconButton>
      </div>
      <SearchField id="treesearch" label={activeTab === 'skeleton' ? 'Search bones' : 'Search objects'} placeholder={activeTab === 'skeleton' ? 'Search bones' : 'Search objects'} value={query} onChange={setQuery} disabled={!asset} />
      <TreeView<ObjectTreeNode>
        key={`${asset?.fileName ?? 'none'}:${activeTab}`}
        ref={treeRef}
        nodes={nodes}
        query={query}
        selectedIds={selectedIds}
        primaryId={selection.primary}
        hiddenIds={hidden}
        renderIcon={(node, selected) => iconFor(node.kind, selected)}
        onSelect={select}
        onActivate={(node) => {
          const engine = getEngine();
          if (!engine) return;
          engine.select([node.id], node.id);
          engine.frameSelected();
        }}
        onToggleVisibility={(node, wasHidden) => getEngine()?.setNodeVisibility(node.id, wasHidden)}
        initiallyExpanded={initiallyExpanded}
        autoExpandOnFilter
        ariaLabel={activeTab === 'skeleton' ? 'Skeleton' : 'Objects'}
        emptyText={asset ? (query ? 'Nothing matches the filter.' : 'Nothing to show.') : <span>The object tree or skeleton<br />appears once a file is open.</span>}
      />
    </>
  );
}

function TransformSection(): ReactElement {
  const transform = useViewer((s) => s.selectionTransform);
  const asset = useViewer((s) => s.asset);
  const rows: Array<[string, [number, number, number]]> = transform
    ? [
        ['Position', transform.position],
        [transform.label && asset?.kind === 'level' && transform.size && transform.rotation.every((v) => v === 0) ? 'Rotation' : 'Rotation', transform.rotation],
        [transform.size ? 'Size' : 'Scale', transform.size ?? transform.scale],
      ]
    : [
        ['Position', [0, 0, 0]],
        ['Rotation', [0, 0, 0]],
        ['Scale', [1, 1, 1]],
      ];
  return (
    <div className={`transform ${transform ? '' : 'transform--empty'}`}>
      <SectionHeader title="Transform" meta={transform?.label ?? (asset ? 'No selection' : '—')} />
      <div className="transform__body">
        {rows.map(([label, values]) => (
          <div key={label} className="transform__row">
            <span className="transform__label">{label}</span>
            <span className="transform__fields">
              {(['x', 'y', 'z'] as const).map((axis, i) => (
                <span key={axis} className="axis-field" title={String(values[i])}>
                  <span className={`axis-field__axis axis-field__axis--${axis}`}>{axis.toUpperCase()}</span>
                  <span className="axis-field__value">{formatNumber(values[i])}</span>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 10000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function AnimationsSection(): ReactElement {
  const asset = useViewer((s) => s.asset);
  const anim = useViewer((s) => s.anim);
  const [query, setQuery] = useState('');
  const clips = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? anim.clips.filter((c) => c.name.toLowerCase().includes(term)) : anim.clips;
  }, [anim.clips, query]);
  const collapsed = !asset || asset.kind !== 'model' || anim.clips.length === 0;
  return (
    <div className={`animations ${collapsed ? 'animations--collapsed' : ''}`}>
      <SectionHeader title="Animations" meta={String(anim.clips.length)} />
      {collapsed ? (
        <div className="tree__empty" style={{ minHeight: 0, flex: 1 }}>
          {asset?.kind === 'level' ? 'A level has no animation clips.' : asset ? 'This model has no animations.' : 'Animation clips show up for models with a skeleton.'}
        </div>
      ) : (
        <>
          <SearchField id="animsearch" label="Search animations" placeholder="Search clips" value={query} onChange={setQuery} />
          <div className="clip-list custom-scroll">
            {clips.map((clip) => {
              const active = clip.index === anim.clipIndex;
              return (
                <button
                  key={clip.index}
                  type="button"
                  className={`clip-row ${active ? 'clip-row--active' : ''}`}
                  onClick={() => {
                    const engine = getEngine();
                    if (!engine) return;
                    if (active) engine.setPlaying(!anim.playing);
                    else engine.playClip(clip.index, true);
                  }}
                >
                  <span className="clip-row__play">{active && anim.playing ? <PauseIcon size={9} /> : <PlayIcon size={9} />}</span>
                  <span className="clip-row__text">
                    <span className="clip-row__name">{clip.name}</span>
                    <span className="clip-row__meta">
                      {clip.frames} f · {clip.duration.toFixed(2)} s · {clip.fps} fps{clip.events.length ? ` · ${clip.events.length} ev` : ''}
                    </span>
                  </span>
                  {active ? <span className={`clip-row__state ${anim.playing ? '' : 'clip-row__state--paused'}`}>{anim.playing ? 'PLAYING' : 'PAUSED'}</span> : null}
                </button>
              );
            })}
            {clips.length === 0 ? <div className="tree__empty">Nothing matches the filter.</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
