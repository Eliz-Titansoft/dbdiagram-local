import type { Ref, Schema, Table } from './schema'

// A ref is an audit link when it points at a user table from a column that records who
// acted: created_by, updated_by, cancelled_by and the like. Nearly every table carries
// two or three of these, so drawing them turns the diagram into a star around users.
export function isAuditRef(ref: Ref): boolean {
  const side = (end: Ref['from'] | Ref['to'], other: Ref['from'] | Ref['to']) =>
    /^users?$/.test(other.table) && end.columns.every((c) => /_by$/.test(c))
  return side(ref.from, ref.to) || side(ref.to, ref.from)
}

export interface ViewOptions {
  focus: string | null
  hops: number
  hideAudit: boolean
  groups: Set<string> | null
  query: string
}

// The tables and refs the diagram shows under the current options. A focus narrows the
// graph to the focused table and everything within `hops` refs of it, walking the refs
// that are themselves shown.
export function visibleGraph(schema: Schema, options: ViewOptions): { tables: Table[]; refs: Ref[] } {
  const refs = schema.refs.filter((r) => !(options.hideAudit && isAuditRef(r)))
  let tables = schema.tables
  if (options.groups) tables = tables.filter((t) => options.groups!.has(t.group))
  const q = options.query.trim().toLowerCase()
  if (q) tables = tables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)))
  if (options.focus) {
    const names = new Set(tables.map((t) => t.name))
    const keep = neighbourhood(options.focus, options.hops, refs.filter((r) => names.has(r.from.table) && names.has(r.to.table)))
    // A filter that rules out the focus table itself leaves nothing, so the page can say so.
    if (q && !names.has(options.focus)) keep.clear()
    else keep.add(options.focus)
    tables = schema.tables.filter((t) => keep.has(t.name))
  }
  const shown = new Set(tables.map((t) => t.name))
  return { tables, refs: refs.filter((r) => shown.has(r.from.table) && shown.has(r.to.table)) }
}

function neighbourhood(start: string, hops: number, refs: Ref[]): Set<string> {
  const seen = new Set<string>([start])
  let frontier = [start]
  for (let i = 0; i < hops && frontier.length; i++) {
    const next: string[] = []
    for (const r of refs) {
      for (const [a, b] of [[r.from.table, r.to.table], [r.to.table, r.from.table]]) {
        if (frontier.includes(a) && !seen.has(b)) {
          seen.add(b)
          next.push(b)
        }
      }
    }
    frontier = next
  }
  return seen
}

// The parser puts the referenced table at the from end of every ref: from is the parent
// (one), to is the table holding the foreign key (many, or one for a one-to-one).
const side = (r: Ref['from']['relation']) => (r === '*' ? 'many' : 'one')

// The cardinality in words, read from the parent to the child.
export function relationWords(ref: Ref): string {
  return `${side(ref.from.relation)} to ${side(ref.to.relation)}`
}

// The cardinality in words, read from `table`'s own end: "many to one" on the child.
export function relationFrom(ref: Ref, table: string): string {
  return ref.to.table === table ? `${side(ref.to.relation)} to ${side(ref.from.relation)}` : relationWords(ref)
}

// pointsAt: the refs this table's own columns hold. referencedBy: refs other tables hold
// that point at this one.
export function refsOf(schema: Schema, table: string): { pointsAt: Ref[]; referencedBy: Ref[] } {
  return {
    pointsAt: schema.refs.filter((r) => r.to.table === table),
    referencedBy: schema.refs.filter((r) => r.from.table === table),
  }
}

// Card header colours, one per group in group order. Each is dark enough for white text
// at 4.5:1 and neighbours differ in hue, not only in lightness, so sixteen groups still
// tell apart. Past the end the list repeats.
const GROUP_PALETTE = [
  '#1a5cad', '#9a4708', '#0b6b63', '#6d28d9', '#b42318', '#00702f', '#be185d', '#0e7490',
  '#92400e', '#1d4ed8', '#166534', '#9f1239', '#4d7c0f', '#5b21b6', '#7c2d12', '#115e59',
  '#3f6212', '#7e22ce',
]
export function groupColour(group: string, groups: string[]): string {
  const i = Math.max(0, groups.indexOf(group))
  return GROUP_PALETTE[i % GROUP_PALETTE.length]
}
