import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, forwardRef } from 'react';
import type { ReactElement } from 'react';
import { ChevronRightIcon, EyeIcon, EyeOffIcon } from './icons';

export interface TreeNode {
  id: string;
  name: string;
  children?: TreeNode[];
  badge?: string;
  /** extra text the filter matches against */
  searchText?: string;
  /** rows that cannot be selected (informational) */
  inert?: boolean;
}

export interface TreeViewHandle {
  expandAll(): void;
  collapseAll(): void;
  /** expands the ancestors of `id` (and the node itself with `self`) */
  reveal(id: string, self?: boolean): void;
}

export interface TreeViewProps<T extends TreeNode> {
  nodes: T[];
  query: string;
  selectedIds: ReadonlySet<string>;
  primaryId?: string | null;
  hiddenIds?: ReadonlySet<string>;
  renderIcon: (node: T, selected: boolean) => ReactNode;
  onSelect: (node: T, options: { additive: boolean; range: boolean }, visibleIds: string[]) => void;
  onActivate?: (node: T) => void;
  onToggleVisibility?: (node: T, visible: boolean) => void;
  emptyText: ReactNode;
  /** ids expanded on first render */
  initiallyExpanded?: Iterable<string>;
  /** nodes that are always expanded in a filtered view */
  autoExpandOnFilter?: boolean;
  ariaLabel: string;
  indent?: number;
}

function findPath(nodes: TreeNode[], id: string): string[] | null {
  for (const node of nodes) {
    if (node.id === id) return [node.id];
    if (node.children) {
      const rest = findPath(node.children, id);
      if (rest) return [node.id, ...rest];
    }
  }
  return null;
}

function filterNodes<T extends TreeNode>(nodes: T[], term: string): T[] {
  const out: T[] = [];
  for (const node of nodes) {
    const matches = node.name.toLowerCase().includes(term) || (node.searchText ?? '').toLowerCase().includes(term);
    const children = node.children ? filterNodes(node.children as T[], term) : undefined;
    if (matches || (children && children.length > 0)) {
      out.push({ ...node, children: matches && (!children || children.length === 0) ? node.children : children });
    }
  }
  return out;
}

function allIds(nodes: TreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      out.add(node.id);
      allIds(node.children, out);
    }
  }
}

function TreeViewInner<T extends TreeNode>(props: TreeViewProps<T>, ref: React.ForwardedRef<TreeViewHandle>): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(props.initiallyExpanded ?? []));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const term = props.query.trim().toLowerCase();
  const filtered = useMemo(() => (term ? filterNodes(props.nodes, term) : props.nodes), [props.nodes, term]);
  const filterExpanded = useMemo(() => {
    if (!term || !props.autoExpandOnFilter) return null;
    const set = new Set<string>();
    allIds(filtered, set);
    return set;
  }, [filtered, term, props.autoExpandOnFilter]);
  const effectiveExpanded = filterExpanded ?? expanded;

  // Selecting something from the viewport reveals it.
  useEffect(() => {
    if (!props.primaryId) return;
    const path = findPath(props.nodes, props.primaryId);
    if (!path) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      path.slice(0, -1).forEach((id) => next.add(id));
      return next;
    });
    const timer = window.setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(props.primaryId ?? '')}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.primaryId, props.nodes]);

  useImperativeHandle(ref, () => ({
    expandAll: () => {
      const set = new Set<string>();
      allIds(props.nodes, set);
      setExpanded(set);
    },
    collapseAll: () => setExpanded(new Set()),
    reveal: (id: string, self = false) => {
      const path = findPath(props.nodes, id);
      if (!path) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        (self ? path : path.slice(0, -1)).forEach((p) => next.add(p));
        return next;
      });
    },
  }), [props.nodes]);

  const visibleRows = useMemo(() => {
    const rows: Array<{ node: T; depth: number }> = [];
    const walk = (nodes: T[], depth: number) => {
      for (const node of nodes) {
        rows.push({ node, depth });
        if (node.children && node.children.length > 0 && effectiveExpanded.has(node.id)) walk(node.children as T[], depth + 1);
      }
    };
    walk(filtered, 0);
    return rows;
  }, [filtered, effectiveExpanded]);
  const visibleIds = useMemo(() => visibleRows.filter((r) => !r.node.inert).map((r) => r.node.id), [visibleRows]);

  const ancestorIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of props.selectedIds) {
      const path = findPath(props.nodes, id);
      if (path) path.slice(0, -1).forEach((p) => set.add(p));
    }
    return set;
  }, [props.selectedIds, props.nodes]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent, node: T, hasChildren: boolean, isExpanded: boolean, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!node.inert) props.onSelect(node, { additive: false, range: false }, visibleIds);
    } else if (event.key === 'ArrowRight' && hasChildren && !isExpanded) {
      event.preventDefault();
      toggle(node.id);
    } else if (event.key === 'ArrowLeft' && hasChildren && isExpanded) {
      event.preventDefault();
      toggle(node.id);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = visibleRows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(next.node.id)}"]`);
        el?.focus();
        if (!next.node.inert && !event.shiftKey) props.onSelect(next.node, { additive: false, range: false }, visibleIds);
      }
    } else if (event.key === 'h' && props.onToggleVisibility) {
      event.preventDefault();
      props.onToggleVisibility(node, props.hiddenIds?.has(node.id) ?? false);
    }
  };

  const indent = props.indent ?? 14;

  return (
    <div className="tree custom-scroll" role="tree" aria-label={props.ariaLabel} ref={containerRef}>
      {visibleRows.length === 0 ? (
        <div className="tree__empty">{props.emptyText}</div>
      ) : (
        visibleRows.map(({ node, depth }, index) => {
          const hasChildren = Boolean(node.children && node.children.length > 0);
          const isExpanded = effectiveExpanded.has(node.id);
          const selected = props.selectedIds.has(node.id);
          const hidden = props.hiddenIds?.has(node.id) ?? false;
          return (
            <div
              key={node.id}
              role="treeitem"
              tabIndex={node.inert ? -1 : 0}
              aria-selected={selected || undefined}
              aria-expanded={hasChildren ? isExpanded : undefined}
              aria-level={depth + 1}
              data-node-id={node.id}
              className={`tree-row ${selected ? 'tree-row--selected' : ''} ${ancestorIds.has(node.id) && !selected ? 'tree-row--ancestor' : ''} ${hidden ? 'tree-row--hidden' : ''}`}
              style={{ paddingLeft: 8 + depth * indent, cursor: node.inert ? 'default' : undefined }}
              onClick={(event) => {
                if (node.inert) return;
                props.onSelect(node, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey }, visibleIds);
              }}
              onDoubleClick={() => {
                if (!node.inert) props.onActivate?.(node);
              }}
              onKeyDown={(event) => onKeyDown(event, node, hasChildren, isExpanded, index)}
            >
              {hasChildren ? (
                <span
                  className={`tree-row__chevron ${isExpanded ? 'tree-row__chevron--open' : ''}`}
                  role="button"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(node.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <ChevronRightIcon size={10} />
                </span>
              ) : (
                <span className="tree-row__chevron" />
              )}
              <span className="tree-row__icon">{props.renderIcon(node, selected)}</span>
              <span className="tree-row__label" title={node.name}>
                {node.name}
              </span>
              {node.badge ? <span className="tree-row__badge">{node.badge}</span> : null}
              {props.onToggleVisibility && !node.inert ? (
                <button
                  type="button"
                  className={`tree-row__eye ${hidden ? 'tree-row__eye--off' : ''}`}
                  aria-label={hidden ? 'Show' : 'Hide'}
                  title={hidden ? 'Show (h)' : 'Hide (h)'}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onToggleVisibility?.(node, hidden);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {hidden ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                </button>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

export const TreeView = forwardRef(TreeViewInner) as <T extends TreeNode>(props: TreeViewProps<T> & { ref?: React.ForwardedRef<TreeViewHandle> }) => ReactElement;
