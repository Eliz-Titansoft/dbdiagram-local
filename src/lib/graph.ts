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
    keep.add(options.focus)
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

export function refsOf(schema: Schema, table: string): { outgoing: Ref[]; incoming: Ref[] } {
  return {
    outgoing: schema.refs.filter((r) => r.from.table === table),
    incoming: schema.refs.filter((r) => r.to.table === table),
  }
}

// A stable colour per group, spread round the hue wheel in group order.
export function groupColour(group: string, groups: string[]): string {
  const i = Math.max(0, groups.indexOf(group))
  const hue = Math.round((i * 137.508) % 360)
  return `hsl(${hue} 55% 45%)`
}
