import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { getEngine } from '../scene/engine';
import { useViewer } from '../state/store';
import type { TrackInfo } from '../state/types';
import { Dropdown, IconButton } from './controls';
import { FirstIcon, LastIcon, LoopIcon, NextIcon, OnionIcon, PauseIcon, PlayIcon, PrevIcon, SnapIcon, StopIcon, TimelineIcon } from './icons';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function BottomPanel(): ReactElement | null {
  const asset = useViewer((s) => s.asset);
  const anim = useViewer((s) => s.anim);
  if (!asset || asset.kind !== 'model' || anim.clips.length === 0) return null;
  return anim.timelineOpen ? <Timeline /> : <Player />;
}

function useClip() {
  const anim = useViewer((s) => s.anim);
  const clip = anim.clips[anim.clipIndex] ?? null;
  const frame = clip ? Math.round(anim.time * clip.fps) : 0;
  return { anim, clip, frame };
}

function Transport(props: { keys?: boolean; small?: boolean }): ReactElement {
  const { anim, clip } = useClip();
  const engine = getEngine();
  const disabled = !clip;
  return (
    <div className="transport">
      <IconButton label="Go to first frame" size="md" disabled={disabled} onClick={() => engine?.seek(0)}>
        <FirstIcon size={15} />
      </IconButton>
      <IconButton label={props.keys ? 'Previous key' : 'Previous frame'} size="md" disabled={disabled} onClick={() => (props.keys ? engine?.stepKey(-1) : engine?.step(-1))}>
        <PrevIcon size={15} />
      </IconButton>
      <button type="button" className={`transport__play ${props.small ? 'transport__play--small' : ''}`} aria-label={anim.playing ? 'Pause playback' : 'Play'} disabled={disabled} onClick={() => engine?.setPlaying(!anim.playing)}>
        {anim.playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
      </button>
      <IconButton label={props.keys ? 'Next key' : 'Next frame'} size="md" disabled={disabled} onClick={() => (props.keys ? engine?.stepKey(1) : engine?.step(1))}>
        <NextIcon size={15} />
      </IconButton>
      <IconButton label="Go to last frame" size="md" disabled={disabled} onClick={() => clip && engine?.seek(clip.duration)}>
        <LastIcon size={15} />
      </IconButton>
      {props.keys ? null : (
        <IconButton label="Stop playback" size="md" disabled={disabled} onClick={() => engine?.stop()}>
          <StopIcon size={13} />
        </IconButton>
      )}
      <span className="vsep" />
      <IconButton label={`Loop playback (${anim.loop ? 'on' : 'off'})`} size="md" active={anim.loop} disabled={disabled} onClick={() => engine?.setLoop(!anim.loop)}>
        <LoopIcon size={15} />
      </IconButton>
    </div>
  );
}

function SpeedDropdown(): ReactElement {
  const speed = useViewer((s) => s.anim.speed);
  return (
    <Dropdown
      ariaLabel="Playback speed"
      className="chip-button--speed"
      label={<span>{speed}×</span>}
      entries={SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))}
      activeId={String(speed)}
      width={110}
      onSelect={(id) => getEngine()?.setSpeed(Number(id))}
    />
  );
}

function Player(): ReactElement {
  const { anim, clip, frame } = useClip();
  const engine = getEngine();
  const status = anim.playing ? 'PLAYING' : anim.time > 0 ? 'PAUSED' : 'STOPPED';
  return (
    <div className="player">
      <div className="player__row">
        <Transport />
        <div className="player__clip">
          <span className="player__clip-name">{clip?.name ?? '—'}</span>
          <span className={`badge ${status === 'PLAYING' ? 'badge--playing' : status === 'PAUSED' ? 'badge--paused' : 'badge--stopped'}`}>{status}</span>
        </div>
        <span className="grow" />
        <span className="player__time">
          {formatTime(anim.time)} <span className="player__time-total">/ {formatTime(clip?.duration ?? 0)}</span>
        </span>
        <span className="vsep" />
        <IconButton label="Open timeline" size="md" active={anim.timelineOpen} onClick={() => toggleTimeline()}>
          <TimelineIcon size={15} />
        </IconButton>
        <SpeedDropdown />
      </div>
      <div className="scrub">
        <span className="scrub__frame">f {frame}</span>
        <div className="scrub__bar">
          <div className="scrub__track" />
          <div className="scrub__fill" style={{ width: `${clip && clip.duration > 0 ? (anim.time / clip.duration) * 100 : 0}%` }} />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="scrub__tick" style={{ left: `${((i + 1) / 8) * 100}%` }} />
          ))}
          {clip?.events.map((event, i) => (
            <div key={i} className="scrub__event" style={{ left: `${(event.time / Math.max(1e-6, clip.duration)) * 100}%` }} title={`${event.name} @ ${event.time.toFixed(3)} s`} />
          ))}
          <label htmlFor="scrub" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>
            Playback position
          </label>
          <input
            id="scrub"
            type="range"
            className="scrub__input"
            min={0}
            max={clip?.frames ?? 1}
            step={1}
            value={frame}
            disabled={!clip}
            onChange={(e) => {
              if (!clip) return;
              engine?.seek(Number(e.target.value) / clip.fps);
              engine?.setPlaying(false);
            }}
          />
        </div>
        <span className="scrub__frame scrub__frame--end">f {clip?.frames ?? 0}</span>
      </div>
    </div>
  );
}

function toggleTimeline(): void {
  const store = useViewer.getState();
  store.setAnim({ timelineOpen: !store.anim.timelineOpen });
  getEngine()?.onTimelineToggled();
}

// ─── Timeline (read-only dope sheet) ────────────────────────────────────

const ROW = 26;
const RULER = 26;
const LEFT_PAD = 14;
const RIGHT_PAD = 14;

function Timeline(): ReactElement {
  const { anim, clip, frame } = useClip();
  const engine = getEngine();
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const selectionPrimary = useViewer((s) => s.selection.primary);
  const tracks = anim.tracks;
  useEffect(() => {
    if (tracks.length > 0 && (!selectedTrack || !tracks.some((t) => t.id === selectedTrack))) setSelectedTrack(tracks[0].id);
  }, [tracks, selectedTrack]);
  const selectTrack = (track: TrackInfo) => {
    setSelectedTrack(track.id);
    const asset = engine?.currentAsset;
    if (track.boneId >= 0 && asset) {
      const id = `${asset.entryId}:bone:${track.boneId}`;
      if (selectionPrimary !== id) engine?.select([id], id);
    }
  };
  return (
    <div className="timeline">
      <div className="timeline__toolbar">
        <Transport keys small />
        <span className="vsep" />
        <span className="timeline__clip">{clip?.name ?? '—'}</span>
        <span className="timeline__frame">
          f {frame} <span className="player__time-total">/ {clip?.frames ?? 0}</span>
        </span>
        <span className="grow" />
        <IconButton label={`Onion skin (${anim.onionSkin ? 'on' : 'off'})`} size="md" active={anim.onionSkin} onClick={() => engine?.setOnionSkin(!anim.onionSkin, anim.onionRange)}>
          <OnionIcon size={15} />
        </IconButton>
        <IconButton label={`Snap to frame (${anim.snapToFrame ? 'on' : 'off'})`} size="md" active={anim.snapToFrame} onClick={() => useViewer.getState().setAnim({ snapToFrame: !anim.snapToFrame })}>
          <SnapIcon size={15} />
        </IconButton>
        <IconButton label="Close timeline" size="md" active onClick={() => toggleTimeline()}>
          <TimelineIcon size={15} />
        </IconButton>
        <span className="vsep" />
        <SpeedDropdown />
      </div>
      {clip && tracks.length > 0 ? (
        <div className="timeline__body">
          <div className="timeline__scroll custom-scroll">
            <div className="timeline__track-list">
              <div className="timeline__tracks-head" style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                <span className="timeline__tracks-title">Tracks</span>
                <span className="timeline__tracks-count">
                  {tracks.length} / {clip.tracks * 3}
                </span>
              </div>
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className={`track-row ${track.id === selectedTrack ? 'track-row--selected' : ''} ${track.channel === 'Events' ? 'track-row--events' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectTrack(track)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') selectTrack(track);
                  }}
                >
                  <span className="track-row__dot" />
                  <span className="track-row__name" title={`${track.boneName} : ${track.channel}`}>
                    {track.channel === 'Events' ? (
                      'Events'
                    ) : (
                      <>
                        {track.boneName} <span className="track-row__sep">:</span> {track.channel}
                      </>
                    )}
                  </span>
                  <span className="track-row__count">{track.keys.length}</span>
                </div>
              ))}
            </div>
            <DopeSheet tracks={tracks} selectedTrack={selectedTrack} />
          </div>
        </div>
      ) : (
        <div className="timeline__empty">{clip ? 'This clip has no animated bones.' : 'Pick a clip to see its keys.'}</div>
      )}
    </div>
  );
}

function DopeSheet(props: { tracks: TrackInfo[]; selectedTrack: string | null }): ReactElement {
  const { anim, clip, frame } = useClip();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const dragging = useRef(false);
  const height = RULER + props.tracks.length * ROW;
  const frames = clip?.frames ?? 1;
  const fps = clip?.fps ?? 30;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, host.clientWidth)));
    ro.observe(host);
    setWidth(Math.max(200, host.clientWidth));
    return () => ro.disconnect();
  }, []);

  const xOf = useMemo(() => {
    const usable = width - LEFT_PAD - RIGHT_PAD;
    return (f: number) => LEFT_PAD + (f / Math.max(1, frames)) * usable;
  }, [width, frames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#13161B';
    ctx.fillRect(0, 0, width, height);
    // rows
    props.tracks.forEach((track, i) => {
      const y = RULER + i * ROW;
      ctx.fillStyle = track.id === props.selectedTrack ? 'rgba(76,141,246,0.14)' : i % 2 === 1 ? '#171B22' : 'transparent';
      if (ctx.fillStyle !== 'transparent') ctx.fillRect(0, y, width, ROW);
    });
    // grid every 10 frames (5 when the clip is short)
    const stepFrames = frames > 400 ? 50 : frames > 150 ? 20 : frames > 60 ? 10 : 5;
    ctx.lineWidth = 1;
    for (let f = 0; f <= frames; f += stepFrames) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.strokeStyle = f % (stepFrames * 2) === 0 ? '#2B313B' : '#22272F';
      ctx.beginPath();
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    // ruler
    ctx.fillStyle = '#171B22';
    ctx.fillRect(0, 0, width, RULER);
    ctx.strokeStyle = '#262B34';
    ctx.beginPath();
    ctx.moveTo(0, RULER - 0.5);
    ctx.lineTo(width, RULER - 0.5);
    ctx.stroke();
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#858D9C';
    ctx.textBaseline = 'alphabetic';
    for (let f = 0; f <= frames; f += stepFrames / 2) {
      const x = Math.round(xOf(f)) + 0.5;
      const major = f % stepFrames === 0;
      ctx.strokeStyle = '#3A4150';
      ctx.beginPath();
      ctx.moveTo(x, 5);
      ctx.lineTo(x, major ? 15 : 12);
      ctx.stroke();
      if (major) ctx.fillText(String(f), x + 3, 22);
    }
    // keys
    props.tracks.forEach((track, i) => {
      const y = RULER + i * ROW + ROW / 2;
      const selected = track.id === props.selectedTrack;
      for (const t of track.keys) {
        const x = xOf(t * fps);
        if (track.channel === 'Events') {
          ctx.fillStyle = '#D8A657';
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-4.5, -4.5, 9, 9);
          ctx.restore();
        } else {
          ctx.fillStyle = selected ? '#4C8DF6' : '#8FB4F2';
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-4, -4, 8, 8);
          ctx.restore();
        }
      }
    });
    // playhead
    const px = Math.round(xOf(frame)) + 0.5;
    ctx.strokeStyle = '#4C8DF6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
    const label = String(frame);
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = '#4C8DF6';
    roundRect(ctx, px - tw / 2, 2, tw, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#0D1014';
    ctx.textAlign = 'center';
    ctx.fillText(label, px, 13.5);
    ctx.textAlign = 'left';
  }, [props.tracks, props.selectedTrack, width, height, frame, frames, fps, xOf]);

  const seekAt = (clientX: number) => {
    const canvas = canvasRef.current;
    const engine = getEngine();
    if (!canvas || !engine || !clip) return;
    const rect = canvas.getBoundingClientRect();
    const usable = width - LEFT_PAD - RIGHT_PAD;
    let f = ((clientX - rect.left - LEFT_PAD) / usable) * frames;
    f = Math.max(0, Math.min(frames, f));
    if (anim.snapToFrame) f = Math.round(f);
    engine.seek(f / fps);
    engine.setPlaying(false);
  };

  return (
    <div className="dope" ref={hostRef} style={{ minHeight: height }}>
      <canvas
        ref={canvasRef}
        className="dope__canvas"
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={frames}
        aria-valuenow={frame}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekAt(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') getEngine()?.step(-1);
          if (e.key === 'ArrowRight') getEngine()?.step(1);
        }}
      />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
