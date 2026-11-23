import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { Ref, Table } from './schema'

// Card metrics. Rows carry 12px type, so 22px keeps them readable at a 0.8 zoom.
export const CARD_WIDTH = 300
// Two lines: the table name, then its group.
export const HEADER_HEIGHT = 48
export const ROW_HEIGHT = 22
export const CARD_PADDING = 8

export interface Placed {
  table: Table
  x: number
  y: number
  width: number
  height: number
}

export interface RoutedEdge {
  ref: Ref
  points: { x: number; y: number }[]
}

export interface Layout {
  nodes: Placed[]
  edges: RoutedEdge[]
  width: number
  height: number
}

export const isKeyColumn = (name: string, pk: boolean) => pk || name.endsWith('_id')

export function cardHeight(table: Table, compact: boolean): number {
  const rows = compact ? table.columns.filter((c) => isKeyColumn(c.name, c.pk)).length : table.columns.length
  return HEADER_HEIGHT + rows * ROW_HEIGHT + CARD_PADDING
}

const elk = new ELK()

export async function layoutGraph(tables: Table[], refs: Ref[], compact: boolean): Promise<Layout> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '40',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: tables.map((t) => ({ id: t.name, width: CARD_WIDTH, height: cardHeight(t, compact) })),
    edges: refs.map((r) => ({ id: r.id, sources: [r.from.table], targets: [r.to.table] })),
  }
  const out = await elk.layout(graph)
  const byName = new Map(tables.map((t) => [t.name, t]))
  const nodes: Placed[] = (out.children ?? []).map((n) => ({
    table: byName.get(n.id)!,
    x: n.x ?? 0,
    y: n.y ?? 0,
    width: n.width ?? CARD_WIDTH,
    height: n.height ?? 0,
  }))
  const byId = new Map(refs.map((r) => [r.id, r]))
  const edges: RoutedEdge[] = ((out.edges ?? []) as ElkExtendedEdge[]).map((e) => {
    const s = e.sections?.[0]
    const points = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] : []
    return { ref: byId.get(e.id)!, points }
  })
  return { nodes, edges, width: out.width ?? 0, height: out.height ?? 0 }
}
