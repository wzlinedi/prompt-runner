// The report's CSS, defined once: the page injects it and the HTML export inlines it (spec FR-037).
// Every rule lives under `.rpt`, which carries the colour tokens (a light set and, following the system, a dark set).
// No external fonts, images, or scripts; the gauges are drawn with CSS only.

import { tokensCss, REPORT_TOKENS } from './theme.mjs';

export const REPORT_CSS = `
${tokensCss('.rpt', REPORT_TOKENS)}
.rpt{background:var(--bg);color:var(--text);font:15px/1.55 Inter,"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;margin:0;-webkit-text-size-adjust:100%}
.rpt *{box-sizing:border-box}
.rpt .hero{background:linear-gradient(120deg,var(--hero1),var(--hero2) 55%,var(--hero3));color:var(--herotext);padding:28px 32px 70px}
.rpt .hero h1{margin:0;font-size:26px;letter-spacing:-.01em}
.rpt .facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.rpt .facts span{background:rgba(15,12,60,.28);border:1px solid rgba(255,255,255,.3);padding:3px 12px;border-radius:99px;font-size:13px}
.rpt .body{padding:0 32px 48px;margin-top:-48px}
.rpt .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}
.rpt .kpi{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;display:flex;gap:16px;align-items:center;box-shadow:var(--shadow)}
.rpt .kpi-t{font-weight:650;font-size:16px}
.rpt .kpi-s{color:var(--muted);font-size:13px}
.rpt .big{font-size:44px;font-weight:700;color:var(--accent);line-height:1;min-width:64px;text-align:center}
.rpt .ring{--c:var(--accent);border-radius:50%;display:grid;place-items:center;position:relative;flex:none;background:conic-gradient(var(--c) calc(var(--p)*1%),var(--line) 0)}
.rpt .ring::before{content:"";position:absolute;inset:var(--t,9px);background:var(--surface);border-radius:50%}
.rpt .ring span{position:relative;font-weight:700}
.rpt .ring small{font-size:.6em;font-weight:600}
.rpt .ring.lg{width:76px;height:76px;--t:9px;font-size:20px}
.rpt .ring.md{width:60px;height:60px;--t:7px;font-size:15px}
.rpt .ring.sm{width:46px;height:46px;--t:6px;font-size:13px}
.rpt .ring.good{--c:var(--good)}
.rpt .ring.mid{--c:var(--ring-mid)}
.rpt .ring.low{--c:var(--low)}
.rpt .ring.na{background:var(--line)}
.rpt .card{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:20px 22px;margin-bottom:24px;overflow-x:auto}
.rpt .card h2,.rpt .sec-t{margin:0 0 14px;font-size:17px;letter-spacing:-.005em}
.rpt table{width:100%;border-collapse:collapse}
.rpt th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
.rpt td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
.rpt tr:last-child td{border-bottom:0}
.rpt tr.avg td{font-weight:700;background:var(--surface2)}
.rpt table.sum td{padding:6px 10px}
.rpt td a{color:var(--text);text-decoration:none;font-weight:550}
.rpt td a:hover{color:var(--accent)}
.rpt td.r,.rpt th.r{text-align:right}
.rpt .params{font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
.rpt code{font:13px ui-monospace,Menlo,monospace;background:var(--surface2);padding:1px 6px;border-radius:6px}
.rpt .chip{display:inline-block;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:12px;border-radius:7px;padding:1px 7px;margin-right:4px}
.rpt .chip.lg{font-size:14px;padding:3px 10px;margin:0}
.rpt .sc{display:flex;align-items:center;gap:10px}
.rpt .bar{flex:1;height:8px;border-radius:99px;background:var(--line);overflow:hidden;min-width:60px}
.rpt .bar i{display:block;height:100%;border-radius:99px;background:var(--line)}
.rpt .bar i.good{background:var(--good)}
.rpt .bar i.mid{background:var(--ring-mid)}
.rpt .bar i.low{background:var(--low)}
.rpt .pill{display:inline-block;min-width:52px;text-align:center;font-weight:650;font-size:13px;border-radius:99px;padding:2px 10px;white-space:nowrap}
.rpt .pill.good{background:var(--goodbg);color:var(--good)}
.rpt .pill.mid{background:var(--midbg);color:var(--mid)}
.rpt .pill.low,.rpt .pill.err{background:var(--lowbg);color:var(--low)}
.rpt .pill.na{background:var(--surface2);color:var(--muted)}
.rpt details>summary{cursor:pointer;font-weight:600;color:var(--accent);list-style:none}
.rpt details>summary::before{content:"▸ "}
.rpt details[open]>summary::before{content:"▾ "}
.rpt details h4{margin:16px 0 6px;font-size:13px;color:var(--muted)}
.rpt .box{display:block;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;margin:0}
.rpt .case{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);margin-bottom:22px;overflow:hidden}
.rpt .case>header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 20px;background:linear-gradient(180deg,var(--surface2),var(--surface));border-bottom:1px solid var(--line)}
.rpt .case h3{margin:0;font-size:18px;flex:1;min-width:200px}
.rpt .badges{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:13px}
.rpt .main{display:grid;grid-template-columns:minmax(0,26fr) minmax(0,19fr) minmax(0,19fr) minmax(0,8fr) minmax(0,28fr)}
.rpt .field{padding:14px 16px;border-right:1px solid var(--line);min-width:0}
.rpt .field:last-child{border-right:0}
.rpt .fl{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px}
.rpt .fl em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:500}
.rpt .scroll{max-height:17em;overflow:auto;resize:vertical;white-space:pre-wrap;word-wrap:break-word;font-size:14px;border-radius:8px}
.rpt .scroll.mono{font:12px/1.45 ui-monospace,Menlo,monospace;background:var(--surface2);border:1px dashed var(--line);padding:8px}
.rpt .scroll.rat{max-height:9em;font-size:13.5px}
.rpt .scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rpt ins{background:var(--insbg);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;border-radius:3px}
.rpt del{background:var(--delbg);color:var(--delfg);text-decoration:line-through;border-radius:3px}
.rpt .f-sim{display:flex;flex-direction:column;align-items:flex-start}
.rpt .tag{display:inline-block;background:var(--surface2);border:1px solid var(--line);border-radius:99px;padding:1px 10px;font-size:12px;color:var(--muted)}
.rpt .alert{background:var(--lowbg);color:var(--low);border-radius:10px;padding:10px 12px;font-size:14px}
.rpt .judges{border-top:1px solid var(--line);background:var(--surface2)}
.rpt .jh,.rpt .metric{display:grid;grid-template-columns:130px 110px minmax(0,1fr);gap:14px;align-items:start;padding:10px 20px}
.rpt .jh{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650;padding-bottom:2px}
.rpt .metric{border-top:1px solid var(--line)}
.rpt .m-name{font-weight:650}
.rpt .prev{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.rpt .foot{color:var(--muted);font-size:13px;text-align:center;margin-top:8px}
@media (max-width:1100px){.rpt .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){.rpt .hero,.rpt .body{padding-left:16px;padding-right:16px}.rpt .bar{display:none}.rpt .sc{justify-content:flex-start}.rpt .main{display:block}.rpt .field{border-right:0;border-bottom:1px solid var(--line)}.rpt .jh{display:none}.rpt .metric{grid-template-columns:1fr;gap:6px}.rpt .kpis{grid-template-columns:1fr}.rpt .f-sim{flex-direction:row;align-items:center;gap:12px}}
`;
