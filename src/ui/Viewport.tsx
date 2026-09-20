import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { formatBytes } from '../fs/catalog';
import { getEngine, mountEngine } from '../scene/engine';
import { isHdrFileName } from '../scene/environment';
import { UNITS_PER_METER } from '../scene/levelBuilder';
import { useViewer } from '../state/store';
import { CAMERA_PRESETS, RENDER_MODE_LABELS, type CameraPreset, type RenderMode } from '../state/types';
import { addFolder, handleDrop, openRecent } from './actions';
import { Dropdown } from './controls';
import { CameraIcon, CubeIcon, FolderIcon, HistoryIcon, MaterialIcon } from './icons';

const RENDER_ENTRIES = (Object.keys(RENDER_MODE_LABELS) as RenderMode[]).map((id) => ({ id, label: RENDER_MODE_LABELS[id], key: id === 'wireframe' ? 'W' : undefined, separatorBefore: id === 'albedo' || id === 'wireframe' }));

export function Viewport(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const asset = useViewer((s) => s.asset);
  const loading = useViewer((s) => s.loading);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    mountEngine(canvasRef.current);
  }, []);

  // Keyboard shortcuts of the viewport.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const engine = getEngine();
      if (!engine) return;
      const store = useViewer.getState();
      // arrows and space belong to the trees and buttons when those have focus
      const inViewport = !target || target === document.body || target.tagName === 'CANVAS';
      const presetByKey: Record<string, CameraPreset> = { Digit0: 'perspective', Numpad0: 'perspective', Digit7: 'top', Numpad7: 'top', Digit1: 'front', Numpad1: 'front', Digit3: 'left', Numpad3: 'left' };
      if (event.code === 'KeyF') {
        engine.frameSelected();
      } else if (event.code === 'Home') {
        engine.resetView();
      } else if (presetByKey[event.code] && !event.ctrlKey && !event.metaKey) {
        engine.setPreset(presetByKey[event.code]);
      } else if (event.code === 'KeyW' && event.shiftKey) {
        store.setRenderMode(store.renderMode === 'wireframe' ? 'ds2' : 'wireframe');
        engine.setRenderMode(useViewer.getState().renderMode);
      } else if (event.code === 'Space' && store.anim.clipIndex >= 0 && inViewport) {
        event.preventDefault();
        engine.setPlaying(!store.anim.playing);
      } else if (event.code === 'ArrowLeft' && store.anim.clipIndex >= 0 && inViewport) {
        engine.step(event.shiftKey ? -10 : -1);
      } else if (event.code === 'ArrowRight' && store.anim.clipIndex >= 0 && inViewport) {
        engine.step(event.shiftKey ? 10 : 1);
      } else if (event.code === 'Escape') {
        engine.select([], null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="viewport"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length === 1 && isHdrFileName(files[0].name)) {
          void getEngine()?.setEnvironmentFile(files[0]);
          return;
        }
        void handleDrop(event.dataTransfer);
      }}
    >
      <canvas ref={canvasRef} className="viewport__canvas" tabIndex={0} aria-label="3D viewport" />
      <ViewportControls />
      <StatsCard />
      <SelectionLabel />
      <AxisTriad />
      <CameraReadout />
      <Legend />
      {!asset && !loading ? <EmptyState /> : null}
      {loading ? <LoadingOverlay /> : null}
      {dragging ? (
        <div className="drop-overlay">
          <span className="drop-overlay__text">Drop a folder, a level, a model — or an .exr/.hdr background</span>
        </div>
      ) : null}
    </div>
  );
}

function ViewportControls(): ReactElement {
  const asset = useViewer((s) => s.asset);
  const preset = useViewer((s) => s.camera.preset);
  const renderMode = useViewer((s) => s.renderMode);
  const setRenderMode = useViewer((s) => s.setRenderMode);
  const cameraEntries = [
    ...CAMERA_PRESETS.map((p) => ({ id: p.id, label: p.label, key: p.key || undefined })),
    { id: 'frame', label: 'Frame selected', key: 'F', separatorBefore: true },
    { id: 'reset', label: 'Reset view', key: 'Home' },
  ];
  return (
    <div className="viewport__top-left">
      <Dropdown
        ariaLabel="Camera"
        icon={<CameraIcon size={14} style={{ color: 'var(--text-label)' }} />}
        label={CAMERA_PRESETS.find((p) => p.id === preset)?.label ?? 'Perspective'}
        entries={cameraEntries}
        activeId={preset}
        disabled={!asset}
        onSelect={(id) => {
          const engine = getEngine();
          if (!engine) return;
          if (id === 'frame') engine.frameSelected();
          else if (id === 'reset') engine.resetView();
          else engine.setPreset(id as CameraPreset);
        }}
      />
      <Dropdown
        ariaLabel="Render mode"
        icon={<MaterialIcon size={14} style={{ color: 'var(--text-label)' }} />}
        label={RENDER_MODE_LABELS[renderMode]}
        entries={RENDER_ENTRIES}
        activeId={renderMode}
        disabled={!asset}
        width={196}
        onSelect={(id) => {
          setRenderMode(id as RenderMode);
          getEngine()?.setRenderMode(id as RenderMode);
        }}
      />
    </div>
  );
}

function StatsCard(): ReactElement {
  const stats = useViewer((s) => s.stats);
  const asset = useViewer((s) => s.asset);
  const dim = !asset;
  const value = (v: string) => (dim ? '—' : v);
  return (
    <div className={`stats-card ${dim ? 'stats-card--dim' : ''}`} aria-live="off">
      <div className="stats-card__title">Scene statistics</div>
      <div className="stats-card__row">
        <span>FPS</span>
        <span className={`stats-card__value ${!dim && stats.fps >= 50 ? 'stats-card__value--good' : ''} ${!dim && stats.fps > 0 && stats.fps < 25 ? 'stats-card__value--warn' : ''}`}>{value(String(stats.fps))}</span>
      </div>
      <div className="stats-card__row">
        <span>Frame time</span>
        <span className="stats-card__value">{value(`${stats.frameMs.toFixed(1)} ms`)}</span>
      </div>
      <div className="stats-card__row">
        <span>Draw calls</span>
        <span className="stats-card__value">{dim ? '0' : stats.drawCalls.toLocaleString('en-US')}</span>
      </div>
      <div className="stats-card__row">
        <span>Vertices</span>
        <span className="stats-card__value">{dim ? '0' : compact(stats.vertices)}</span>
      </div>
      <div className="stats-card__row">
        <span>Triangles</span>
        <span className="stats-card__value">{dim ? '0' : compact(stats.triangles)}</span>
      </div>
      <div className="stats-card__row">
        <span>Texture memory</span>
        <span className={`stats-card__value ${!dim && stats.textureBytes > 900 * 1024 * 1024 ? 'stats-card__value--warn' : ''}`}>{dim ? '0 MB' : formatBytes(stats.textureBytes)}</span>
      </div>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  return n.toLocaleString('en-US');
}

function SelectionLabel(): ReactElement | null {
  const transform = useViewer((s) => s.selectionTransform);
  const primary = useViewer((s) => s.selection.primary);
  const count = useViewer((s) => s.selection.ids.length);
  if (!transform || !primary) return null;
  const meta = transform.size
    ? `${(transform.size[0] / UNITS_PER_METER).toFixed(1)} × ${(transform.size[1] / UNITS_PER_METER).toFixed(1)} × ${(transform.size[2] / UNITS_PER_METER).toFixed(1)} m`
    : `${transform.position.map((v) => v.toFixed(2)).join(', ')}`;
  return (
    <div className="selection-label" style={{ left: 14, top: 52 }}>
      <span className="selection-label__dot" />
      <span className="selection-label__name">{transform.label}</span>
      <span className="selection-label__meta">{meta}</span>
      {count > 1 ? <span className="selection-label__meta">+{count - 1}</span> : null}
    </div>
  );
}

function AxisTriad(): ReactElement {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = getEngine();
      const svg = ref.current;
      if (!engine || !svg) return;
      const triad = engine.axisTriad();
      const c = 38;
      const r = 24;
      const axes: Array<[string, { x: number; y: number; z: number }]> = [
        ['x', triad.x],
        ['y', triad.y],
        ['z', triad.z],
      ];
      axes.sort((a, b) => a[1].z - b[1].z);
      for (const [name, v] of axes) {
        const line = svg.querySelector<SVGLineElement>(`[data-axis-line="${name}"]`);
        const dot = svg.querySelector<SVGCircleElement>(`[data-axis-dot="${name}"]`);
        const text = svg.querySelector<SVGTextElement>(`[data-axis-text="${name}"]`);
        const x = c + v.x * r;
        const y = c - v.y * r;
        line?.setAttribute('x2', String(x));
        line?.setAttribute('y2', String(y));
        dot?.setAttribute('cx', String(x));
        dot?.setAttribute('cy', String(y));
        text?.setAttribute('x', String(x));
        text?.setAttribute('y', String(y + 3.5));
        const opacity = v.z < -0.2 ? '0.55' : '1';
        line?.setAttribute('opacity', opacity);
        dot?.setAttribute('opacity', opacity);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const colors = { x: '#DE6B62', y: '#5FBF84', z: '#4C8DF6' };
  return (
    <svg ref={ref} className="axis-triad" width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r="31" fill="rgba(21,24,30,0.8)" stroke="#262B34" strokeWidth="1" />
      {(['x', 'y', 'z'] as const).map((axis) => (
        <g key={axis}>
          <line data-axis-line={axis} x1="38" y1="38" x2="38" y2="14" stroke={colors[axis]} strokeWidth="2" strokeLinecap="round" />
          <circle data-axis-dot={axis} cx="38" cy="12" r="6" fill={colors[axis]} />
          <text data-axis-text={axis} x="38" y="15.5" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="8" fontWeight="500" fill="#0B0D11">
            {axis.toUpperCase()}
          </text>
        </g>
      ))}
    </svg>
  );
}

function CameraReadout(): ReactElement {
  const camera = useViewer((s) => s.camera);
  const asset = useViewer((s) => s.asset);
  return (
    <div className={`readout readout--camera ${asset ? '' : 'readout--dim'}`}>
      <span>FOV {camera.fov.toFixed(0)}°</span>
      <span className="readout__sep">|</span>
      <span>
        near {camera.near < 10 ? camera.near.toFixed(1) : camera.near.toFixed(0)} · far {camera.far >= 1000 ? `${(camera.far / 1000).toFixed(0)}k` : camera.far.toFixed(0)}
      </span>
      <span className="readout__sep">|</span>
      <span>{camera.zoom.toFixed(1)}× zoom</span>
    </div>
  );
}

function Legend(): ReactElement | null {
  const asset = useViewer((s) => s.asset);
  const display = useViewer((s) => s.display);
  const anim = useViewer((s) => s.anim);
  if (!asset) return null;
  if (asset.kind === 'model') {
    if (!anim.timelineOpen || !anim.onionSkin) return null;
    const clip = anim.clips[anim.clipIndex];
    const frame = clip ? Math.round(anim.time * clip.fps) : 0;
    return (
      <div className="readout readout--legend">
        <span>
          <span className="readout__swatch" style={{ background: 'rgba(110,144,204,0.5)' }} />f {Math.max(0, frame - anim.onionRange)}
        </span>
        <span className="readout__sep">|</span>
        <span>
          <span className="readout__swatch" style={{ background: '#9EBEFF' }} />f {frame + anim.onionRange}
        </span>
        <span className="readout__sep">|</span>
        <span style={{ color: 'var(--text-label)' }}>Onion skin ±{anim.onionRange} f</span>
      </div>
    );
  }
  const items: Array<{ color: string; label: string }> = [];
  if (display.navmesh) items.push({ color: 'rgba(63,185,168,0.4)', label: 'Navmesh' });
  if (display.collision) items.push({ color: 'rgba(34,197,94,0.45)', label: 'Collision' });
  if (display.lights) items.push({ color: '#D8A657', label: `Lights ${asset.rows.find((r) => r[0] === 'Lights')?.[1] ?? ''}` });
  if (items.length === 0) return null;
  return (
    <div className="readout readout--legend">
      {items.map((item, i) => (
        <span key={item.label} style={{ display: 'contents' }}>
          {i > 0 ? <span className="readout__sep">|</span> : null}
          <span>
            <span className="readout__swatch" style={{ background: item.color }} />
            {item.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function EmptyState(): ReactElement {
  const catalog = useViewer((s) => s.catalog);
  const recent = useViewer((s) => s.recent);
  const fsAccess = useViewer((s) => s.fsAccess);
  const [recentOpen, setRecentOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!recentOpen) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setRecentOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [recentOpen]);
  return (
    <div className="empty-state" role="region" aria-label="Nothing loaded">
      <span className="empty-state__icon">
        <CubeIcon size={26} strokeWidth={1.6} />
      </span>
      <span className="empty-state__title">{catalog ? 'Pick a file' : 'Nothing loaded'}</span>
      <span className="empty-state__text">
        {catalog
          ? `“${catalog.rootName}” is scanned: choose a level or a model in the file list, or drop one into the viewport.`
          : 'Add the folder with the unpacked game files, or drag a model or a level into the viewport, to inspect its meshes, materials, skeleton and animations. Nothing leaves your browser.'}
      </span>
      <span className="empty-state__actions" ref={ref}>
        <button type="button" className="button-primary" onClick={() => void addFolder()}>
          <FolderIcon size={14} />
          {catalog ? 'Change folder' : 'Add folder'}
        </button>
        {fsAccess ? (
          <button type="button" className="button-ghost" onClick={() => setRecentOpen((v) => !v)} disabled={recent.length === 0}>
            <HistoryIcon size={14} />
            Open recent
          </button>
        ) : null}
        {recentOpen ? (
          <div className="menu" role="menu" style={{ top: 42, left: 0, right: 0, minWidth: 0 }}>
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
      </span>
      <span className="empty-state__formats">DS2 · DS2MD · + DS2CM · DS2CM2 · DS2AIM · TGA · DDS</span>
    </div>
  );
}

function LoadingOverlay(): ReactElement | null {
  const loading = useViewer((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-card__title">{loading.title}</div>
        <div className="loading-card__detail">{loading.detail}</div>
        <div className="loading-card__bar">
          {loading.progress < 0 ? <div className="loading-card__fill loading-card__fill--indeterminate" /> : <div className="loading-card__fill" style={{ width: `${Math.round(loading.progress * 100)}%` }} />}
        </div>
      </div>
    </div>
  );
}
