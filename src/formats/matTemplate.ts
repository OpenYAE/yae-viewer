/**
 * The game's `.mat` material templates (`gameres/materials/**.mat`):
 * `template_material NAME { key value … }` blocks whose state keys decide how
 * a level mesh's `material` name is drawn — blend, alpha test, culling,
 * depth write, sort order, whether it takes the lightmap or vertex light.
 * A compact reader for the keys the viewer uses; the SDK's full grammar is
 * `packages/formats/src/mat/`.
 */
export type MatBlend = 'none' | 'blend' | 'add' | 'modulate';

export type MatTemplate = {
  name: string;
  key: string;
  /** every entry as `key → last value` (lower-cased keys) */
  entries: Map<string, string>;
  sortValue: number;
  materialType: 'opaque' | 'transparent' | 'unknown';
  blend: MatBlend;
  alphaTest: number | null;
  twoSided: boolean;
  depthWrite: boolean;
  selfIllumination: boolean;
  /** `static_light lightmap|vertex` or the `ds2compiler nolightmap` directive */
  staticLight: 'lightmap' | 'vertex' | 'none';
  /** `material` program name: lightmapped_base, vertlight_base, environment_mapping, … */
  program: string;
};

export type MatLibrary = Map<string, MatTemplate>;

function parseBlock(source: string, start: number): { entries: Map<string, string>; end: number } {
  const entries = new Map<string, string>();
  let i = start;
  let depth = 1;
  let token = '';
  const words: string[] = [];
  const flush = () => {
    if (token) words.push(token);
    token = '';
  };
  const commit = () => {
    flush();
    if (words.length > 0) {
      const key = words[0].toLowerCase();
      const value = words.slice(1).join(' ');
      const prev = entries.get(key);
      // `ds2compiler` is repeated with different directives: keep them all.
      entries.set(key, key === 'ds2compiler' && prev ? `${prev} ${value}` : value);
    }
    words.length = 0;
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      commit();
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      let j = i + 1;
      let inner = 1;
      while (j < source.length && inner > 0) {
        if (source[j] === '{') inner += 1;
        else if (source[j] === '}') inner -= 1;
        j += 1;
      }
      flush();
      words.push(source.slice(i + 1, j - 1).trim().replace(/\s+/g, ' '));
      depth -= 1;
      i = j;
      continue;
    }
    if (ch === '}') {
      commit();
      depth -= 1;
      if (depth === 0) return { entries, end: i + 1 };
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      commit();
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      flush();
      i += 1;
      continue;
    }
    token += ch;
    i += 1;
  }
  commit();
  return { entries, end: i };
}

export function parseMatSource(source: string, into: MatLibrary = new Map()): MatLibrary {
  const re = /template_material\s+([^\s{]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = m[1];
    const { entries, end } = parseBlock(source, m.index + m[0].length);
    re.lastIndex = end;
    const get = (key: string) => entries.get(key) ?? entries.get(key.toLowerCase());
    const blendRaw = (get('blend') ?? 'none').toLowerCase();
    const blend: MatBlend = blendRaw === 'add' ? 'add' : blendRaw === 'modulate' || blendRaw === 'multiply' ? 'modulate' : blendRaw === 'blend' ? 'blend' : 'none';
    const materialTypeRaw = (get('material_type') ?? '').toLowerCase();
    const alphaTestRaw = get('alphatest');
    let alphaTest: number | null = null;
    if (alphaTestRaw) {
      const num = alphaTestRaw.match(/(\d*\.?\d+)/);
      alphaTest = num ? Number(num[1]) : 0.5;
    }
    const depthWriteRaw = (get('depth_write') ?? '').toLowerCase();
    const staticLightRaw = (get('static_light') ?? '').toLowerCase();
    const compiler = (get('ds2compiler') ?? '').toLowerCase();
    const program = (get('material') ?? '').toLowerCase();
    let staticLight: MatTemplate['staticLight'] = 'lightmap';
    if (staticLightRaw === 'vertex') staticLight = 'vertex';
    else if (staticLightRaw === 'lightmap') staticLight = 'lightmap';
    else if (compiler.includes('nolightmap') || program.includes('vertlight')) staticLight = 'vertex';
    const template: MatTemplate = {
      name,
      key: name.toLowerCase(),
      entries,
      sortValue: Number(get('sort_value') ?? 5) || 5,
      materialType: materialTypeRaw === 'transparent' ? 'transparent' : materialTypeRaw === 'opaque' ? 'opaque' : 'unknown',
      blend,
      alphaTest,
      twoSided: ['cull_face', 'cull_fase'].some((k) => (get(k) ?? '').toLowerCase().startsWith('disable')),
      depthWrite: depthWriteRaw !== 'false',
      selfIllumination: (get('self_illumination') ?? '').toLowerCase() === 'true',
      staticLight,
      program,
    };
    into.set(template.key, template);
  }
  return into;
}

/** The engine's own fallback when a level names a template no `.mat` defines. */
export function templateFromName(name: string): Partial<MatTemplate> {
  const key = name.toLowerCase();
  const out: Partial<MatTemplate> = {};
  if (key.includes('add')) out.blend = 'add';
  else if (key.includes('multiply')) out.blend = 'modulate';
  else if (key.includes('trans')) out.blend = 'blend';
  if (key.includes('aref')) out.alphaTest = 0.3;
  if (key.includes('2sided') || key.includes('no_cull')) out.twoSided = true;
  if (key.endsWith('_vx') || key.includes('_vx_') || key.includes('vxa')) out.staticLight = 'vertex';
  if (key.includes('selfilum')) out.selfIllumination = true;
  return out;
}
