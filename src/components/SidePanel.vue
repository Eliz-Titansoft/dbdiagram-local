<script setup lang="ts">
import { computed } from 'vue'
import { refsOf, relationFrom } from '../lib/graph'
import type { Schema, Table } from '../lib/schema'

const props = defineProps<{ schema: Schema; table: Table | null; drawer: boolean }>()
const emit = defineEmits<{ go: [table: string]; focus: [table: string]; close: [] }>()

const links = computed(() => (props.table ? refsOf(props.schema, props.table.name) : { pointsAt: [], referencedBy: [] }))
const enumOf = (type: string) => props.schema.enums.find((e) => e.name === type) ?? null
</script>

<template>
  <aside class="panel" :class="{ drawer }" aria-label="Table detail">
    <template v-if="table">
      <header class="panel-head">
        <h2>{{ table.name }}</h2>
        <div class="actions">
          <button class="btn" title="Show only this table and its neighbours" @click="emit('focus', table.name)">Focus</button>
          <button class="btn icon" aria-label="Close table detail" @click="emit('close')">×</button>
        </div>
      </header>
      <p class="group">group: {{ table.group }}</p>
      <pre v-if="table.note" class="note">{{ table.note }}</pre>

      <h3>Columns</h3>
      <table class="cols">
        <tbody>
          <tr v-for="c in table.columns" :key="c.name">
            <td class="mono" :class="{ pk: c.pk }">{{ c.name }}</td>
            <td class="mono muted type" :title="c.type">
              {{ c.type }}<span v-if="c.pk || c.unique || (c.notNull && !c.pk) || c.default !== null" class="mods">
                <template v-if="c.pk">pk</template><template v-if="c.unique"> unique</template><template v-if="c.notNull && !c.pk"> not null</template><template v-if="c.default !== null"> = {{ c.default }}</template>
              </span>
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

      <h3>Points at ({{ links.pointsAt.length }})</h3>
      <ul class="list">
        <li v-for="r in links.pointsAt" :key="r.id">
          <span class="mono">{{ r.to.columns.join(', ') }}</span> →
          <button class="link" @click="emit('go', r.from.table)">{{ r.from.table }}</button><span class="mono muted">.{{ r.from.columns.join(', ') }}</span>
          <span class="muted">, {{ relationFrom(r, table.name) }}</span>
        </li>
      </ul>
      <h3>Referenced by ({{ links.referencedBy.length }})</h3>
      <ul class="list">
        <li v-for="r in links.referencedBy" :key="r.id">
          <button class="link" @click="emit('go', r.to.table)">{{ r.to.table }}</button><span class="mono muted">.{{ r.to.columns.join(', ') }}</span>
          → <span class="mono">{{ r.from.columns.join(', ') }}</span>
          <span class="muted">, {{ relationFrom(r, r.to.table) }}</span>
        </li>
      </ul>
    </template>
    <template v-else>
      <h2 class="idle-title">Pick a table</h2>
      <p class="muted">Click a card, or Tab to one and press Enter, to read its columns, notes and references here. Double-click or Shift+Enter focuses on it and its neighbours.</p>
      <details class="enums">
        <summary>Enums ({{ schema.enums.length }})</summary>
        <ul class="list">
          <li v-for="e in schema.enums" :key="e.name"><span class="mono">{{ e.name }}</span><span class="muted">: {{ e.values.map((v) => v.name).join(', ') }}</span></li>
        </ul>
      </details>
    </template>
  </aside>
</template>

<style scoped>
.panel {
  overflow: auto;
  padding: 14px 18px 20px;
  border-left: 1px solid var(--border);
  background: var(--card);
  font-size: 13px;
}
/* Below the two-column breakpoint the panel is a sheet over the canvas. */
.panel.drawer {
  position: fixed;
  inset: auto 0 0 0;
  max-height: 62vh;
  border-left: 0;
  border-top: 1px solid var(--border);
  border-radius: 12px 12px 0 0;
  box-shadow: var(--shadow);
  z-index: 5;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.actions {
  display: flex;
  gap: 6px;
}
.btn {
  padding: 4px 10px;
  border: 1px solid var(--input);
  border-radius: 6px;
  background: var(--card);
  cursor: pointer;
}
.btn:hover {
  background: var(--bg);
}
.btn.icon {
  width: 30px;
  padding: 4px 0;
  font-size: 16px;
  line-height: 1;
}
h2 {
  margin: 0;
  font: 600 16px/1.3 var(--mono);
  overflow-wrap: anywhere;
}
.idle-title {
  font-family: var(--sans);
}
h3 {
  margin: 18px 0 6px;
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
  margin: 10px 0 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  background: var(--bg);
  border-radius: 6px;
  font: 12px/1.45 var(--sans);
}
.cols {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.cols td {
  padding: 4px 8px 4px 0;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
}
.cols td:first-child {
  width: 36%;
  overflow-wrap: anywhere;
}
.cols td.type {
  width: 27%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mods {
  display: block;
  font-size: 11.5px;
}
.cols .pk {
  font-weight: 700;
}
.note-cell {
  color: var(--fg);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.enum {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font: 12px/1.35 var(--mono);
  overflow-wrap: anywhere;
}
.enums {
  margin-top: 18px;
}
.enums summary {
  cursor: pointer;
  font: 600 12px/1 var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.enums .list {
  margin-top: 8px;
}
.list {
  margin: 0;
  padding-left: 16px;
}
.list li {
  margin: 3px 0;
  overflow-wrap: anywhere;
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
  color: var(--accent-fg);
  font-family: var(--mono);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
