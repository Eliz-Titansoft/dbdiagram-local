import { Parser } from '@dbml/core'

// The viewer's own model: flat, serialisable, and free of the parser's class graph.
export interface Column {
  name: string
  type: string
  pk: boolean
  unique: boolean
  notNull: boolean
  default: string | null
  note: string
}

export interface Index {
  columns: string[]
  unique: boolean
  pk: boolean
  note: string
}

export interface Table {
  name: string
  group: string
  columns: Column[]
  indexes: Index[]
  note: string
}

export type Relation = '1' | '*' | '-'

export interface Ref {
  id: string
  from: { table: string; columns: string[]; relation: Relation }
  to: { table: string; columns: string[]; relation: Relation }
}

export interface EnumDef {
  name: string
  values: { name: string; note: string }[]
}

export interface Schema {
  tables: Table[]
  refs: Ref[]
  enums: EnumDef[]
  groups: string[]
}

export interface ParseError {
  message: string
  line: number
  column: number
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && 'value' in v ? String((v as { value: unknown }).value ?? '') : '')

// Tables without a TableGroup are grouped by the first word of their name, in the
// singular: orders, order_fix_allocations and order_excess_settlements then sit together.
function prefixGroup(name: string): string {
  const word = name.split('_')[0]
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1)
  return word
}

export function parseDbml(source: string): { schema: Schema } | { errors: ParseError[] } {
  let db
  try {
    db = new Parser().parse(source, 'dbmlv2')
  } catch (e: unknown) {
    const diags = (e as { diags?: { message: string; location?: { start: { line: number; column: number } } }[] }).diags
    if (diags?.length) {
      return { errors: diags.map((d) => ({ message: d.message, line: d.location?.start.line ?? 0, column: d.location?.start.column ?? 0 })) }
    }
    return { errors: [{ message: (e as Error).message ?? String(e), line: 0, column: 0 }] }
  }

  const groupOf = new Map<string, string>()
  const groups: string[] = []
  for (const s of db.schemas) {
    for (const g of s.tableGroups) {
      groups.push(g.name)
      for (const t of g.tables) groupOf.set(t.name, g.name)
    }
  }

  const tables: Table[] = []
  const refs: Ref[] = []
  const enums: EnumDef[] = []
  for (const s of db.schemas) {
    for (const t of s.tables) {
      tables.push({
        name: t.name,
        group: groupOf.get(t.name) ?? prefixGroup(t.name),
        note: text(t.note),
        columns: t.fields.map((f) => ({
          name: f.name,
          type: f.type.type_name,
          pk: !!f.pk,
          unique: !!f.unique,
          notNull: !!f.not_null,
          default: f.dbdefault ? String(f.dbdefault.value) : null,
          note: text(f.note),
        })),
        indexes: t.indexes.map((i) => ({
          columns: i.columns.map((c) => String(c.value)),
          unique: !!i.unique,
          pk: !!i.pk,
          note: text(i.note),
        })),
      })
    }
    for (const r of s.refs) {
      const [a, b] = r.endpoints
      if (!a || !b) continue
      refs.push({
        id: `${a.tableName}.${a.fieldNames.join('+')}->${b.tableName}.${b.fieldNames.join('+')}`,
        from: { table: a.tableName, columns: a.fieldNames, relation: a.relation as Relation },
        to: { table: b.tableName, columns: b.fieldNames, relation: b.relation as Relation },
      })
    }
    for (const e of s.enums) {
      enums.push({ name: e.name, values: e.values.map((v) => ({ name: v.name, note: text(v.note) })) })
    }
  }
  if (groups.length === 0) {
    for (const t of tables) if (!groups.includes(t.group)) groups.push(t.group)
  }
  return { schema: { tables, refs, enums, groups } }
}
