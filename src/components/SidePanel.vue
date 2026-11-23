<script setup lang="ts">
import { computed } from 'vue'
import { refsOf } from '../lib/graph'
import type { Schema, Table } from '../lib/schema'

const props = defineProps<{ schema: Schema; table: Table | null }>()
const emit = defineEmits<{ go: [table: string]; focus: [table: string]; close: [] }>()

const links = computed(() => (props.table ? refsOf(props.schema, props.table.name) : { outgoing: [], incoming: [] }))
const enumOf = (type: string) => props.schema.enums.find((e) => e.name === type) ?? null
</script>

<template>
  <aside class="panel">
    <template v-if="table">
      <header class="panel-head">
        <h2>{{ table.name }}</h2>
        <div class="actions">
          <button @click="emit('focus', table.name)" title="Show only this table and its neighbours">Focus</button>
          <button @click="emit('close')" title="Close">×</button>
        </div>
      </header>
      <p class="group">group: {{ table.group }}</p>
      <pre v-if="table.note" class="note">{{ table.note }}</pre>

      <h3>Columns</h3>
      <table class="cols">
        <tbody>
          <tr v-for="c in table.columns" :key="c.name">
            <td class="mono" :class="{ pk: c.pk }">{{ c.name }}</td>
            <td class="mono muted">
              {{ c.type }}<template v-if="c.pk"> pk</template><template v-if="c.unique"> unique</template><template v-if="c.notNull && !c.pk"> not null</template><template v-if="c.default !== null"> = {{ c.default }}</template>
            </td>
            <td class="note-cell">
              {{ c.note }}
              <span v-if="enumOf(c.type)" class="enum">{{ enumOf(c.type)!.values.map((v) => v.name).join(' | ') }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="table.indexes.length">
        <h3>Indexes</h3>
        <ul class="list">
          <li v-for="(i, n) in table.indexes" :key="n">
            <span class="mono">({{ i.columns.join(', ') }})</span>
            <span v-if="i.pk" class="muted"> pk</span><span v-else-if="i.unique" class="muted"> unique</span>
            <span v-if="i.note" class="muted"> - {{ i.note }}</span>
          </li>
        </ul>
      </template>

      <h3>References out ({{ links.outgoing.length }})</h3>
      <ul class="list">
        <li v-for="r in links.outgoing" :key="r.id">
          <span class="mono">{{ r.from.columns.join(', ') }}</span> →
          <button class="link" @click="emit('go', r.to.table)">{{ r.to.table }}</button><span class="mono muted">.{{ r.to.columns.join(', ') }}</span>
        </li>
      </ul>
      <h3>Referenced by ({{ links.incoming.length }})</h3>
      <ul class="list">
        <li v-for="r in links.incoming" :key="r.id">
          <button class="link" @click="emit('go', r.from.table)">{{ r.from.table }}</button><span class="mono muted">.{{ r.from.columns.join(', ') }}</span>
          → <span class="mono">{{ r.to.columns.join(', ') }}</span>
        </li>
      </ul>
    </template>
    <template v-else>
      <h2>No table selected</h2>
      <p class="muted">Click a table to read its columns, notes and references. Double-click to focus on it and its neighbours.</p>
      <h3>Enums ({{ schema.enums.length }})</h3>
      <ul class="list">
        <li v-for="e in schema.enums" :key="e.name"><span class="mono">{{ e.name }}</span><span class="muted">: {{ e.values.map((v) => v.name).join(', ') }}</span></li>
      </ul>
    </template>
  </aside>
</template>

<style scoped>
.panel {
  overflow: auto;
  padding: 12px 16px;
  border-left: 1px solid var(--border);
  background: var(--card);
  font-size: 13px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.actions {
  display: flex;
  gap: 4px;
}
h2 {
  margin: 0;
  font: 600 16px/1.3 var(--mono);
}
h3 {
  margin: 16px 0 6px;
  font: 600 12px/1 var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.group {
  margin: 4px 0 0;
  color: var(--muted);
}
.note {
  margin: 8px 0 0;
  padding: 8px;
  white-space: pre-wrap;
  background: var(--bg);
  border-radius: 4px;
  font: 12px/1.4 var(--sans);
}
.cols {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.cols td {
  padding: 3px 6px 3px 0;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.cols td:first-child {
  width: 34%;
}
.cols td:nth-child(2) {
  width: 30%;
}
.cols .pk {
  font-weight: 700;
}
.note-cell {
  color: var(--fg);
  font-size: 12px;
}
.enum {
  display: block;
  color: var(--muted);
  font: 11px/1.3 var(--mono);
}
.list {
  margin: 0;
  padding-left: 16px;
}
.list li {
  margin: 2px 0;
}
.mono {
  font-family: var(--mono);
}
.muted {
  color: var(--muted);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-family: var(--mono);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
