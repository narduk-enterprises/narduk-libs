<script setup lang="ts">
/*
 * NE Base design card for NeAbsent (portal-polish L1).
 *
 * The rows worth reviewing: the mark in a table cell and in a KPI value, next
 * to a reported zero so the two can be told apart at a glance, and the block
 * form that names the field and takes one action.
 */
import NeAbsent from '../runtime/components/NeAbsent.vue'
</script>

<template>
  <section class="preview-card" data-design-card="ne-absent" data-name="Absent" data-group="Shell">
    <h2>Absent</h2>
    <p>
      A value nothing produced: the hatch, named “not reported”. Never a blank, a dash or a zero —
      each of those reads as a measurement.
    </p>
    <div class="preview-row">
      <table style="border-collapse: collapse">
        <thead>
          <tr>
            <th style="text-align: start; padding-inline-end: 1.5rem">Runner</th>
            <th style="text-align: start; padding-inline-end: 1.5rem">Jobs</th>
            <th style="text-align: start">90-day uptime</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding-inline-end: 1.5rem">ci-a</td>
            <td style="padding-inline-end: 1.5rem">0</td>
            <td>99.2%</td>
          </tr>
          <tr>
            <td style="padding-inline-end: 1.5rem">ci-b</td>
            <td style="padding-inline-end: 1.5rem">41</td>
            <td><NeAbsent label="90-day uptime" /></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="preview-row">
      <NeAbsent variant="block" label="90-day uptime">
        <a href="#propose">Where it lands</a>
      </NeAbsent>
    </div>
  </section>
</template>
