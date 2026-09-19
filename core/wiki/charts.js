/**
 * Inline SVG charts for the report.
 *
 * No library, no build step — the bundle has to open from a folder on disk
 * forever, and a CDN script tag breaks that the day the CDN moves.
 *
 * Colour follows the job, not taste:
 *   magnitude (scores, counts)  -> ink. One series, no identity to encode, and
 *                                  it keeps the report's ink-on-paper register.
 *   state (severity bands)      -> the reserved status palette, never reused as
 *                                  a series colour.
 *
 * Nothing is carried by colour alone. Every band is labelled, and in the
 * scatter the band is DERIVED from position (priority = impact x effort), so
 * the hue is redundant encoding rather than the only channel.
 *
 * @module core/wiki/charts
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Status palette — fixed, never themed, never reused for a series. */
export const BAND_COLOR = {
  critical: '#d03b3b',
  high: '#ec835a',
  medium: '#fab219',
  low: '#0ca30c',
};

export const CHART_CSS = `
.viz {
  --viz-ink: var(--ink);
  --viz-muted: var(--muted);
  --viz-faint: var(--faint);
  --viz-grid: var(--border);
  --viz-surface: var(--surface);
  margin: 18px 0 26px;
}
.viz svg { display: block; width: 100%; height: auto; overflow: visible; }
.viz .v-title {
  font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--faint); font-weight: 650; margin-bottom: 12px;
}
.viz text { font-family: var(--sans); }
.viz .v-label { font-size: 12px; fill: var(--viz-muted); }
.viz .v-value { font-size: 12px; fill: var(--viz-ink); font-variant-numeric: tabular-nums; }
.viz .v-axis { font-size: 10.5px; fill: var(--viz-faint); }
.viz .v-grid { stroke: var(--viz-grid); stroke-width: 1; }
.viz .v-track { fill: var(--viz-grid); }
.viz .v-bar { fill: var(--viz-ink); }
.viz .v-bar-dim { fill: none; stroke: var(--viz-grid); stroke-width: 2; stroke-dasharray: 3 3; }
.viz .v-dot { stroke: var(--viz-surface); stroke-width: 2; }
.viz .v-contour { stroke: var(--viz-grid); stroke-width: 1; fill: none; stroke-dasharray: 2 4; }
.viz .v-hit { fill: transparent; cursor: pointer; }
.viz .v-hit:hover + .v-dot, .viz .v-hit:focus + .v-dot { stroke: var(--viz-ink); stroke-width: 3; }

.viz-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-size: 12px; color: var(--muted); }
.viz-legend span { display: flex; align-items: center; gap: 6px; }
.viz-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; flex: none; }

.viz-tip {
  position: fixed; z-index: 50; pointer-events: none; opacity: 0;
  background: var(--ink); color: var(--bg); font-size: 12px; line-height: 1.4;
  padding: 7px 9px; border-radius: 4px; max-width: 280px; transition: opacity .1s;
}
.viz-tip.on { opacity: 1; }
.viz-tip b { display: block; font-weight: 600; margin-bottom: 2px; }

.band-strip { margin: 14px 0 22px; }
.band-strip .strip { display: flex; height: 8px; gap: 2px; }
.band-strip .seg { display: block; }
.band-strip .viz-legend { margin-top: 9px; font-size: 11.5px; }
`;

export const CHART_JS = `
(function () {
  var tip = document.createElement('div');
  tip.className = 'viz-tip';
  document.body.appendChild(tip);

  function show(e, html) {
    tip.innerHTML = html;
    tip.classList.add('on');
    var pad = 14;
    var x = e.clientX + pad, y = e.clientY + pad;
    var r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hide() { tip.classList.remove('on'); }

  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) show(e, t.getAttribute('data-tip'));
  });
  document.addEventListener('mousemove', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) show(e, t.getAttribute('data-tip')); else hide();
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-tip]')) hide();
  });
})();
`;

// ---------------------------------------------------------------------------

/**
 * Score by group — horizontal bars, worst first.
 *
 * Magnitude with no identity to encode, so one ink colour. Unmeasured groups
 * are drawn as a dashed outline rather than a zero-length bar: zero would read
 * as "scored nothing", which is the opposite of "not measured".
 *
 * @param {{name:string, score:number|null, measured:number, declared:number}[]} rows
 */
export function scoreBars(rows, { title = 'Score by group' } = {}) {
  if (!rows.length) return '';
  const ROW = 26, PAD_T = 8, PAD_B = 22, LABEL = 128, VALUE = 34;
  const W = 720, plotW = W - LABEL - VALUE - 10;
  const H = PAD_T + rows.length * ROW + PAD_B;

  const ticks = [0, 25, 50, 75, 100];
  const x = (v) => LABEL + (v / 100) * plotW;

  const body = rows.map((r, i) => {
    const y = PAD_T + i * ROW;
    const barY = y + 7;
    if (r.score == null) {
      return `<g>
        <text class="v-label" x="${LABEL - 10}" y="${y + 15}" text-anchor="end">${esc(r.name)}</text>
        <rect class="v-bar-dim" x="${LABEL}" y="${barY}" width="${plotW}" height="9" rx="4"/>
        <text class="v-axis" x="${LABEL + plotW + 8}" y="${y + 15}">n/m</text>
        <rect class="v-hit" x="${LABEL}" y="${y}" width="${plotW}" height="${ROW}"
          data-tip="<b>${esc(r.name)}</b>Not measured — excluded from the score, not counted as passing."/>
      </g>`;
    }
    const w = Math.max(2, (r.score / 100) * plotW);
    return `<g>
      <text class="v-label" x="${LABEL - 10}" y="${y + 15}" text-anchor="end">${esc(r.name)}</text>
      <rect class="v-track" x="${LABEL}" y="${barY}" width="${plotW}" height="9" rx="4"/>
      <rect class="v-bar" x="${LABEL}" y="${barY}" width="${w}" height="9" rx="4"/>
      <text class="v-value" x="${LABEL + plotW + 8}" y="${y + 15}">${r.score}</text>
      <rect class="v-hit" x="${LABEL}" y="${y}" width="${plotW}" height="${ROW}"
        data-tip="<b>${esc(r.name)} — ${r.score}/100</b>${r.measured} of ${r.declared} dimensions measured"/>
    </g>`;
  }).join('');

  const grid = ticks.map((t) => `
    <line class="v-grid" x1="${x(t)}" y1="${PAD_T}" x2="${x(t)}" y2="${H - PAD_B + 4}"
      opacity="${t === 0 ? 0.9 : 0.5}"/>
    <text class="v-axis" x="${x(t)}" y="${H - PAD_B + 17}" text-anchor="middle">${t}</text>`).join('');

  return `<div class="viz"><div class="v-title">${esc(title)}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${rows.filter((r) => r.score != null).map((r) => `${r.name} ${r.score}`).join(', ')}">
${grid}${body}
</svg></div>`;
}

/**
 * Severity distribution — one stacked bar.
 *
 * State, so the reserved status palette. Every segment is labelled, and the
 * legend repeats the counts, so nothing depends on telling the hues apart.
 * A 2px surface gap separates segments per the mark spec.
 *
 * @param {Record<string, number>} bands
 */
export function severityBar(bands, { title = 'Findings by severity' } = {}) {
  const order = ['critical', 'high', 'medium', 'low'];
  const present = order.filter((b) => bands[b] > 0);
  const total = order.reduce((n, b) => n + (bands[b] || 0), 0);
  if (!total) return '';

  const W = 720, H = 56, BAR = 26, GAP = 2;
  let cursor = 0;
  const segs = present.map((band) => {
    const n = bands[band];
    const w = (n / total) * W;
    const seg = `<g>
      <rect x="${cursor}" y="0" width="${Math.max(1, w - GAP)}" height="${BAR}" rx="3" fill="${BAND_COLOR[band]}"/>
      ${w > 46 ? `<text class="v-value" x="${cursor + (w - GAP) / 2}" y="${BAR / 2 + 4}" text-anchor="middle" fill="#fff" style="font-weight:650">${n}</text>` : ''}
      <rect class="v-hit" x="${cursor}" y="0" width="${Math.max(1, w - GAP)}" height="${BAR}"
        data-tip="<b>${band} — ${n}</b>${Math.round((n / total) * 100)}% of findings"/>
    </g>`;
    cursor += w;
    return seg;
  }).join('');

  const legend = order.map((band) => `<span><i style="background:${BAND_COLOR[band]}"></i>${band} ${bands[band] || 0}</span>`).join('');

  return `<div class="viz"><div class="v-title">${esc(title)} — ${total} total</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${order.map((b) => `${b} ${bands[b] || 0}`).join(', ')}">
${segs}
</svg>
<div class="viz-legend">${legend}</div></div>`;
}

/**
 * Impact against effort, with the priority contours drawn.
 *
 * This chart exists to make the RANKING MODEL visible. priority = impact x
 * effort, so the band boundaries are hyperbolas, and drawing them turns "why is
 * this critical" from a number into a position. Top-right is
 * high-impact-and-easy; bottom-left is the stuff to leave alone.
 *
 * Colour is redundant here — the band is derived from the position — so hue
 * carries nothing the geometry does not already say.
 *
 * @param {{title:string, impact:number, effort:number, priority:number, band:string, owner:string}[]} findings
 */
export function impactEffortScatter(findings, { title = 'Impact against ease of fixing' } = {}) {
  const pts = findings.filter((f) => f.impact > 0 && f.effort > 0);
  if (pts.length < 3) return '';

  const W = 720, H = 420, L = 52, R = 18, T = 14, B = 46;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (effort) => L + ((effort - 0.5) / 10) * plotW;
  const y = (impact) => T + plotH - ((impact - 0.5) / 10) * plotH;

  // Band boundaries: impact x effort = 63, 40, 20.
  const contour = (p) => {
    const steps = [];
    for (let e = 0.5; e <= 10.2; e += 0.25) {
      const i = p / e;
      if (i < 0.5 || i > 10.5) continue;
      steps.push(`${steps.length ? 'L' : 'M'}${x(e).toFixed(1)},${y(i).toFixed(1)}`);
    }
    return steps.length > 1 ? `<path class="v-contour" d="${steps.join('')}"/>` : '';
  };

  // Jitter identical coordinates so overlapping findings stay countable.
  const seen = new Map();
  const dots = pts.map((f) => {
    const key = `${f.impact}-${f.effort}`;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    const angle = n * 2.4;
    const rad = n ? 4.5 + n * 0.8 : 0;
    const cx = x(f.effort) + Math.cos(angle) * rad;
    const cy = y(f.impact) + Math.sin(angle) * rad;
    return `<g>
      <circle class="v-hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11"
        data-tip="<b>${esc(f.title).slice(0, 90)}</b>priority ${f.priority} · impact ${f.impact}/10 · effort ${f.effort}/10 · ${esc(f.owner)}"/>
      <circle class="v-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${BAND_COLOR[f.band] || '#888'}"/>
    </g>`;
  }).join('');

  const gridLines = [2, 4, 6, 8, 10].map((v) => `
    <line class="v-grid" x1="${x(v)}" y1="${T}" x2="${x(v)}" y2="${T + plotH}" opacity=".45"/>
    <line class="v-grid" x1="${L}" y1="${y(v)}" x2="${L + plotW}" y2="${y(v)}" opacity=".45"/>
    <text class="v-axis" x="${x(v)}" y="${T + plotH + 16}" text-anchor="middle">${v}</text>
    <text class="v-axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');

  const legend = ['critical', 'high', 'medium', 'low']
    .map((b) => `<span><i style="background:${BAND_COLOR[b]}"></i>${b}</span>`).join('');

  return `<div class="viz"><div class="v-title">${esc(title)}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of ${pts.length} findings by impact and ease of fixing">
  <line class="v-grid" x1="${L}" y1="${T + plotH}" x2="${L + plotW}" y2="${T + plotH}"/>
  <line class="v-grid" x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}"/>
  ${gridLines}
  ${contour(63)}${contour(40)}${contour(20)}
  ${dots}
  <text class="v-axis" x="${L + plotW / 2}" y="${H - 8}" text-anchor="middle">easier to fix &#8594;</text>
  <text class="v-axis" x="14" y="${T + plotH / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + plotH / 2})">higher impact &#8594;</text>
</svg>
<div class="viz-legend">${legend}<span style="color:var(--faint)">dashed lines are the band boundaries — priority is impact &#215; ease, so top-right is where to start</span></div>
</div>`;
}

/**
 * Findings per owner — grouped bars, one row per team.
 * Magnitude again, so ink, with severity shown as stacked status segments.
 *
 * @param {{owner:string, label:string, bands:Record<string,number>, total:number}[]} rows
 */
export function ownerBars(rows, { title = 'Work by owner' } = {}) {
  return stackedBandBars(rows, { title });
}

/**
 * Findings per group, stacked by severity band.
 *
 * `ownerBars` was this chart with one caller's vocabulary baked into its name.
 * The shape — a label, a band breakdown, a total — is the same question asked
 * of owners, of GEO groups, of anything that partitions the pile, and copying
 * the drawing code per caller is how two charts of the same thing drift apart.
 *
 * @param {{label:string, bands:Record<string,number>, total:number}[]} rows
 */
export function stackedBandBars(rows, { title = 'Work by group', minRows = 2 } = {}) {
  const live = rows.filter((r) => r.total > 0);
  if (live.length < minRows) return '';
  const max = Math.max(...live.map((r) => r.total));
  const ROW = 34, PAD = 8, LABEL = 148;
  const W = 720, plotW = W - LABEL - 44;
  const H = PAD + live.length * ROW + 6;
  const order = ['critical', 'high', 'medium', 'low'];

  const body = live.map((r, i) => {
    const y = PAD + i * ROW;
    let cursor = LABEL;
    const segs = order.filter((b) => r.bands[b] > 0).map((b) => {
      const w = (r.bands[b] / max) * plotW;
      const seg = `<g><rect x="${cursor}" y="${y + 7}" width="${Math.max(1, w - 2)}" height="14" rx="3" fill="${BAND_COLOR[b]}"/>
        <rect class="v-hit" x="${cursor}" y="${y + 7}" width="${Math.max(1, w - 2)}" height="14"
          data-tip="<b>${esc(r.label)}</b>${r.bands[b]} ${b}"/></g>`;
      cursor += w;
      return seg;
    }).join('');
    return `<g>
      <text class="v-label" x="${LABEL - 10}" y="${y + 19}" text-anchor="end">${esc(r.label)}</text>
      ${segs}
      <text class="v-value" x="${cursor + 8}" y="${y + 19}">${r.total}</text>
    </g>`;
  }).join('');

  const legend = order.map((b) => `<span><i style="background:${BAND_COLOR[b]}"></i>${b}</span>`).join('');
  return `<div class="viz"><div class="v-title">${esc(title)}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${live.map((r) => `${r.label} ${r.total}`).join(', ')}">${body}</svg>
<div class="viz-legend">${legend}</div></div>`;
}

/**
 * The buy path, as steps.
 *
 * Operability is measured as STEPS, not a percentage, because an agent does not
 * get part-way into a cart — it stops at the first control it cannot see. A
 * percentage would average that into something reassuring and wrong; a ladder
 * shows exactly where it stops, which is also where the fix goes.
 *
 * State, not magnitude, so the status palette — and never colour alone: every
 * step carries its state as a word, and the stopping point is marked in the
 * geometry by the rule that cuts the track.
 *
 * @param {{step:string, state:string, detail?:string}[]} steps
 */
export function stepLadder(steps, { title = 'How far an agent gets' } = {}) {
  if (!steps?.length) return '';
  const STATE = { ok: BAND_COLOR.low, degraded: BAND_COLOR.medium, blocked: BAND_COLOR.critical };
  const WORD = { ok: 'machine-visible', degraded: 'partly visible', blocked: 'no affordance' };

  const W = 720, ROW = 46, PAD = 6;
  const H = PAD + steps.length * ROW + PAD;
  const DOT = 30, LABEL = DOT + 22;

  const stopAt = steps.findIndex((s) => s.state === 'blocked');

  const body = steps.map((s, i) => {
    const y = PAD + i * ROW + ROW / 2;
    const color = STATE[s.state] || BAND_COLOR.medium;
    const past = stopAt !== -1 && i > stopAt;
    // The track after the stopping point is dashed: those steps were never
    // reached, which is not the same as their having passed or failed.
    const connector = i < steps.length - 1
      ? `<line x1="${DOT}" y1="${y + 11}" x2="${DOT}" y2="${y + ROW - 11}" stroke="var(--viz-grid)" stroke-width="2"${i >= stopAt && stopAt !== -1 ? ' stroke-dasharray="3 4"' : ''}/>`
      : '';
    return `<g${past ? ' opacity=".5"' : ''}>
      ${connector}
      <circle cx="${DOT}" cy="${y}" r="9" fill="${past ? 'none' : color}" stroke="${color}" stroke-width="2"/>
      <text class="v-value" x="${LABEL}" y="${y - 1}">${esc(s.step)}</text>
      <text class="v-axis" x="${LABEL}" y="${y + 14}">${esc(past ? 'not reached' : WORD[s.state] || s.state)}${s.detail && !past ? ' — ' + esc(String(s.detail).slice(0, 70)) : ''}</text>
    </g>`;
  }).join('');

  const legend = ['ok', 'degraded', 'blocked']
    .filter((k) => steps.some((s) => s.state === k))
    .map((k) => `<span><i style="background:${STATE[k]}"></i>${esc(WORD[k])}</span>`).join('');

  return `<div class="viz"><div class="v-title">${esc(title)}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(steps.map((s) => `${s.step}: ${s.state}`).join(', '))}">${body}</svg>
<div class="viz-legend">${legend}</div></div>`;
}

/**
 * A compact severity strip for a page header — the band mix at a glance,
 * without spending a whole chart on it.
 *
 * @param {Record<string, number>} bands
 */
export function bandStrip(bands, { label = '' } = {}) {
  const order = ['critical', 'high', 'medium', 'low'];
  const total = order.reduce((n, b) => n + (bands[b] || 0), 0);
  if (!total) return '';
  const segs = order.filter((b) => bands[b] > 0).map((b) =>
    `<span class="seg" style="flex:${bands[b]};background:${BAND_COLOR[b]}" title="${bands[b]} ${b}"></span>`).join('');
  const words = order.filter((b) => bands[b] > 0)
    .map((b) => `<span><i style="background:${BAND_COLOR[b]}"></i>${bands[b]} ${b}</span>`).join('');
  return `<div class="band-strip">${label ? `<div class="v-title">${esc(label)}</div>` : ''}
  <div class="strip">${segs}</div>
  <div class="viz-legend">${words}</div></div>`;
}
