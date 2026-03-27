// src/server.js - AfriPay API Server
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');
const fs      = require('fs');
const path    = require('path');
const { logger } = require('./utils/logger');

const payRoutes      = require('./routes/pay');
const statusRoutes   = require('./routes/status');
const disburseRoutes = require('./routes/disburse');
const balanceRoutes  = require('./routes/balance');
const webhookRoutes  = require('./routes/webhooks');
const keysRoutes     = require('./routes/keys');
const healthRoutes   = require('./routes/health');
const billingRoutes  = require('./routes/billing');

const { rateLimiter }  = require('./middleware/rateLimiter');
const { authenticate } = require('./middleware/authenticate');
const { errorHandler } = require('./middleware/errorHandler');
const { requestId }    = require('./middleware/requestId');

const app = express();

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
// Embedded directly so deployment never depends on filesystem layout.
// In local dev, the file version is preferred if it exists.
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AfriPay — Unified Mobile Money API for Africa</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Sora:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script src="https://js.stripe.com/v3/"></script>
<style>
:root {
  --bg:       #070a0c;
  --surface:  #0d1117;
  --card:     #131920;
  --card2:    #171f27;
  --border:   rgba(255,255,255,0.06);
  --border2:  rgba(255,255,255,0.11);
  --green:    #05e27a;
  --green2:   #03b85f;
  --green-dim:#002d18;
  --amber:    #f5a623;
  --amber-dim:#2e1f00;
  --blue:     #38b6ff;
  --blue-dim: #052440;
  --red:      #ff5a5a;
  --red-dim:  #2d0a0a;
  --purple:   #a78bfa;
  --text:     #dde4ea;
  --muted:    #5a6a78;
  --muted2:   #8496a4;
  --mono:     'IBM Plex Mono', monospace;
  --sans:     'Sora', sans-serif;
  --radius:   10px;
  --sidebar-w: 230px;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.6; min-height: 100vh; overflow-x: hidden; }

/* ── LAYOUT ── */
.layout { display: grid; grid-template-columns: var(--sidebar-w) 1fr; min-height: 100vh; }

/* ── SIDEBAR ── */
.sidebar {
  background: var(--surface);
  border-right: 1px solid var(--border);
  position: sticky; top: 0; height: 100vh;
  overflow-y: auto; display: flex; flex-direction: column;
  scrollbar-width: none;
}
.sidebar::-webkit-scrollbar { display: none; }
.sidebar-logo { padding: 22px 18px 18px; border-bottom: 1px solid var(--border); }
.logo-wrap { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.logo-hex {
  width: 34px; height: 34px; background: var(--green);
  clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-weight: 700; font-size: 13px; color: #000; flex-shrink: 0;
}
.logo-info { display: flex; flex-direction: column; }
.logo-name { font-family: var(--mono); font-weight: 700; font-size: 14px; color: var(--text); }
.logo-ver { font-size: 10px; color: var(--green); font-family: var(--mono); letter-spacing:.05em; }

.nav-group { padding: 14px 10px 6px; }
.nav-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding: 0 8px 8px; font-weight: 600; font-family: var(--mono); }
.nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 10px; border-radius: 7px;
  cursor: pointer; color: var(--muted2); font-size: 13px;
  transition: all .12s; text-decoration: none; border: none; background: none; width: 100%; text-align: left;
}
.nav-item:hover { background: rgba(255,255,255,.04); color: var(--text); }
.nav-item.active { background: rgba(5,226,122,.08); color: var(--green); }
.nav-icon { width: 15px; text-align: center; font-size: 13px; flex-shrink: 0; }

.sidebar-footer { margin-top: auto; padding: 14px; border-top: 1px solid var(--border); }
.plan-badge {
  background: var(--card2); border: 1px solid var(--border);
  border-radius: 9px; padding: 12px;
}
.plan-badge-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.plan-tier { font-family: var(--mono); font-size: 11px; font-weight: 700; }
.plan-tier.free { color: var(--muted2); }
.plan-tier.starter { color: var(--blue); }
.plan-tier.pro { color: var(--amber); }
.plan-tier.ultra { color: var(--purple); }
.plan-usage-bar { height: 3px; background: rgba(255,255,255,.08); border-radius: 2px; overflow: hidden; margin-bottom: 5px; }
.plan-usage-fill { height: 100%; background: var(--green); border-radius: 2px; transition: width .6s; }
.plan-usage-text { font-size: 10px; color: var(--muted); font-family: var(--mono); }

/* ── MAIN ── */
.main { overflow-y: auto; min-height: 100vh; }

/* ── TOPBAR ── */
.topbar {
  background: var(--surface); border-bottom: 1px solid var(--border);
  padding: 0 28px; height: 52px;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 20;
}
.topbar-left { display: flex; align-items: center; gap: 16px; }
.topbar-page { font-size: 13px; font-weight: 500; color: var(--text); }
.breadcrumb { font-size: 12px; color: var(--muted); font-family: var(--mono); }
.topbar-right { display: flex; gap: 8px; align-items: center; }
.live-dot {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-family: var(--mono);
  background: var(--green-dim); color: var(--green);
  padding: 4px 10px; border-radius: 99px;
}
.live-dot::before {
  content:''; width:6px;height:6px;border-radius:50%;background:var(--green);
  animation:blink 2s infinite;
}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}

/* ── PAGE SECTIONS ── */
.page { display: none; padding: 28px; max-width: 1000px; }
.page.active { display: block; animation: fadeUp .3s ease; }
@keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

/* ── SECTION HEADER ── */
.section-hd {
  font-family: var(--mono); font-size: 10px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  margin-bottom: 14px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.section-gap { height: 32px; }

/* ── BUTTONS ── */
.btn {
  padding: 8px 16px; border-radius: 7px; font-size: 13px; font-weight: 500;
  cursor: pointer; border: none; transition: all .12s; font-family: var(--sans);
  display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
}
.btn-green { background: var(--green); color: #000; font-weight: 600; }
.btn-green:hover { background: #07ff8a; }
.btn-ghost { background: transparent; border: 1px solid var(--border2); color: var(--text); }
.btn-ghost:hover { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.18); }
.btn-red { background: var(--red-dim); border: 1px solid var(--red); color: var(--red); }
.btn-red:hover { background: rgba(255,90,90,.15); }
.btn-sm { padding: 5px 11px; font-size: 12px; }
.btn-xs { padding: 3px 8px; font-size: 11px; }
.btn:disabled { opacity: .4; cursor: not-allowed; }

/* ── CARDS ── */
.card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; margin-bottom: 16px;
}
.card-sm { padding: 14px; }

/* ── STAT CARDS ── */
.stats-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 24px; }
.stat-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 18px; position: relative; overflow: hidden;
}
.stat-card::after {
  content:''; position:absolute; top:0;left:0;right:0;height:2px;
}
.stat-card.g::after{background:var(--green);}
.stat-card.a::after{background:var(--amber);}
.stat-card.b::after{background:var(--blue);}
.stat-card.r::after{background:var(--red);}
.stat-lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing:.07em; margin-bottom:6px; font-family:var(--mono); }
.stat-val { font-family:var(--mono); font-size:24px; font-weight:700; line-height:1; margin-bottom:5px; }
.stat-card.g .stat-val{color:var(--green);}
.stat-card.a .stat-val{color:var(--amber);}
.stat-card.b .stat-val{color:var(--blue);}
.stat-card.r .stat-val{color:var(--red);}
.stat-sub { font-size:11px; color:var(--muted); }

/* ── API KEY CARD ── */
.key-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px; margin-bottom:24px; }
.key-row { display:flex; align-items:center; gap:10px; }
.key-display {
  flex:1; background:var(--surface); border:1px solid var(--border);
  border-radius:7px; padding:9px 13px;
  font-family:var(--mono); font-size:13px; color:var(--green);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.key-meta { font-size:12px; color:var(--muted); margin-top:8px; display:flex; gap:16px; }
.key-meta span { display:flex; align-items:center; gap:5px; }

/* ── ENDPOINT LIST ── */
.ep-list { display:flex; flex-direction:column; gap:3px; margin-bottom:20px; }
.ep-row {
  display:grid; grid-template-columns:56px 1fr auto;
  align-items:center; gap:12px;
  padding:11px 14px; background:var(--card);
  border:1px solid var(--border); border-radius:8px;
  cursor:pointer; transition:border-color .12s;
}
.ep-row:hover { border-color:var(--border2); background:var(--card2); }
.method { font-family:var(--mono); font-size:10px; font-weight:700; padding:3px 6px; border-radius:4px; text-align:center; }
.m-post { background:rgba(5,226,122,.1); color:var(--green); }
.m-get  { background:rgba(56,182,255,.1); color:var(--blue); }
.ep-path { font-family:var(--mono); font-size:12.5px; }
.ep-desc { font-size:11px; color:var(--muted); text-align:right; }

/* ── CODE BLOCK ── */
.code-tabs { display:flex; gap:2px; }
.code-tab {
  padding:7px 13px; font-size:11px; font-family:var(--mono);
  background:var(--surface); border:1px solid var(--border);
  border-bottom:none; border-radius:6px 6px 0 0;
  cursor:pointer; color:var(--muted); transition:color .12s;
}
.code-tab.active { color:var(--green); background:var(--card); border-color:var(--border2); }
.code-block {
  background:var(--card); border:1px solid var(--border2);
  border-radius:0 8px 8px 8px; padding:18px;
  margin-bottom:20px; position:relative; overflow-x:auto;
}
.code-block pre { font-family:var(--mono); font-size:12px; line-height:1.75; color:var(--text); white-space:pre; }
.c-g{color:var(--green);} .c-a{color:var(--amber);} .c-b{color:var(--blue);} .c-m{color:var(--muted);} .c-r{color:var(--red);}
.copy-btn {
  position:absolute; top:10px; right:10px;
  background:rgba(255,255,255,.05); border:1px solid var(--border);
  color:var(--muted); padding:4px 9px; border-radius:5px;
  font-size:10px; cursor:pointer; font-family:var(--mono); transition:all .12s;
}
.copy-btn:hover { color:var(--green); border-color:var(--green); }

/* ── TRY IT ── */
.try-panel { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:24px; }
.try-hd { background:var(--surface); padding:12px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.try-title { font-family:var(--mono); font-size:12px; font-weight:700; }
.try-body { padding:18px; display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.form-group { display:flex; flex-direction:column; gap:5px; }
.form-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-weight:600; font-family:var(--mono); }
.form-input {
  background:var(--surface); border:1px solid var(--border);
  border-radius:7px; padding:8px 11px; font-size:13px;
  color:var(--text); font-family:var(--sans); outline:none; transition:border-color .12s;
}
.form-input:focus { border-color:var(--green); }
.form-input::placeholder { color:var(--muted); }
.form-select { appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235a6a78'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 10px center; padding-right:28px; }
.try-footer { padding:0 18px 18px; display:flex; align-items:center; gap:10px; }
.resp-panel {
  background:var(--surface); border:1px solid var(--border);
  border-radius:7px; padding:12px; font-family:var(--mono);
  font-size:11.5px; line-height:1.7; min-height:56px;
  flex:1; color:var(--muted); white-space:pre-wrap; max-height:160px; overflow-y:auto;
}

/* ── NETWORKS GRID ── */
.nets-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-bottom:24px; }
.net-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px; display:flex; align-items:flex-start; gap:12px; }
.net-icon { width:40px;height:40px; border-radius:8px; display:flex;align-items:center;justify-content:center; font-weight:700;font-family:var(--mono);font-size:11px; flex-shrink:0; }
.net-name { font-size:13px; font-weight:600; margin-bottom:2px; }
.net-countries { font-size:11px; color:var(--muted); margin-bottom:5px; }
.net-tags { display:flex; gap:4px; flex-wrap:wrap; }
.tag { font-size:10px; padding:2px 7px; border-radius:4px; font-family:var(--mono); font-weight:600; }

/* ── PRICING ── */
.pricing-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
.price-card {
  background:var(--card); border:1px solid var(--border);
  border-radius:var(--radius); padding:20px; position:relative;
  display:flex; flex-direction:column;
  transition: border-color .2s, transform .2s;
}
.price-card:hover { border-color: var(--border2); transform: translateY(-2px); }
.price-card.featured { border-color:var(--green); }
.price-card.featured:hover { border-color: var(--green); }
.price-pop {
  position:absolute; top:-1px; left:50%; transform:translateX(-50%);
  background:var(--green); color:#000; font-size:9px; font-weight:700;
  padding:3px 10px; border-radius:0 0 6px 6px; font-family:var(--mono); letter-spacing:.06em;
}
.price-tier { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; margin-bottom:6px; font-family:var(--mono); }
.price-amt { font-family:var(--mono); font-size:30px; font-weight:700; line-height:1; margin-bottom:2px; }
.price-amt span { font-size:13px; color:var(--muted); font-weight:400; }
.price-calls { font-size:11px; color:var(--muted); margin-bottom:14px; }
.price-feats { list-style:none; display:flex; flex-direction:column; gap:6px; flex:1; margin-bottom:16px; }
.price-feats li { font-size:12px; color:var(--muted2); display:flex; align-items:center; gap:6px; }
.price-feats li::before { content:'✓'; color:var(--green); font-weight:700; flex-shrink:0; }
.price-feats li.no::before { content:'✕'; color:var(--muted); }
.price-feats li.no { color:var(--muted); }
.subscribe-btn {
  width:100%; padding:9px; border-radius:7px; font-size:12px; font-weight:600;
  cursor:pointer; border:1px solid var(--border2); background:transparent;
  color:var(--text); font-family:var(--sans); transition:all .15s; margin-top:auto;
}
.subscribe-btn:hover { background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.2); }
.subscribe-btn.primary { background:var(--green); color:#000; border-color:var(--green); }
.subscribe-btn.primary:hover { background:#07ff8a; }
.subscribe-btn.current { background:var(--green-dim); color:var(--green); border-color:var(--green); cursor:default; }

/* ── BILLING SECTION ── */
.billing-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
.billing-stat { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px; }
.billing-stat-label { font-size:11px; color:var(--muted); font-family:var(--mono); margin-bottom:4px; }
.billing-stat-value { font-size:20px; font-weight:700; font-family:var(--mono); }
.invoice-row { display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border); font-size:12.5px; }
.invoice-row:last-child { border-bottom:none; }
.invoice-status { font-size:10px; padding:2px 8px; border-radius:4px; font-family:var(--mono); font-weight:700; }
.inv-paid { background:var(--green-dim); color:var(--green); }
.inv-pending { background:var(--amber-dim); color:var(--amber); }

/* ── DOCS PAGE ── */
.docs-layout { display:grid; grid-template-columns:200px 1fr; gap:28px; }
.docs-nav { position:sticky; top:80px; height:fit-content; }
.docs-nav-item { display:block; padding:5px 8px; font-size:12.5px; color:var(--muted2); cursor:pointer; border-radius:5px; transition:all .12s; text-decoration:none; border-left:2px solid transparent; margin-bottom:1px; }
.docs-nav-item:hover { color:var(--text); background:rgba(255,255,255,.03); }
.docs-nav-item.active { color:var(--green); border-left-color:var(--green); background:rgba(5,226,122,.05); }
.docs-nav-group { font-size:10px; color:var(--muted); font-family:var(--mono); letter-spacing:.1em; text-transform:uppercase; padding:10px 8px 4px; margin-top:6px; }
.docs-content h1 { font-family:var(--mono); font-size:22px; font-weight:700; margin-bottom:8px; }
.docs-content h2 { font-family:var(--mono); font-size:16px; font-weight:700; margin:28px 0 12px; color:var(--text); padding-top:28px; border-top:1px solid var(--border); }
.docs-content h3 { font-size:13px; font-weight:600; margin:18px 0 8px; color:var(--muted2); }
.docs-content p { font-size:13.5px; color:var(--muted2); line-height:1.75; margin-bottom:12px; }
.docs-content ul { padding-left:18px; margin-bottom:12px; }
.docs-content ul li { font-size:13px; color:var(--muted2); line-height:1.75; margin-bottom:4px; }
.docs-content a { color:var(--green); text-decoration:none; }
.docs-content a:hover { text-decoration:underline; }
.docs-lead { font-size:15px; color:var(--text); margin-bottom:20px; line-height:1.7; }
.inline-code { font-family:var(--mono); font-size:12px; background:var(--card2); border:1px solid var(--border); padding:1px 6px; border-radius:4px; color:var(--green); }
.alert-box { border-radius:8px; padding:12px 16px; margin:14px 0; font-size:13px; display:flex; gap:10px; align-items:flex-start; }
.alert-info { background:var(--blue-dim); border:1px solid rgba(56,182,255,.2); color:var(--blue); }
.alert-warn { background:var(--amber-dim); border:1px solid rgba(245,166,35,.2); color:var(--amber); }
.alert-success { background:var(--green-dim); border:1px solid rgba(5,226,122,.2); color:var(--green); }
.param-table { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:12.5px; }
.param-table th { font-family:var(--mono); font-size:10px; text-align:left; padding:7px 12px; background:var(--card2); color:var(--muted); text-transform:uppercase; letter-spacing:.07em; border:1px solid var(--border); }
.param-table td { padding:8px 12px; border:1px solid var(--border); vertical-align:top; }
.param-table td:first-child { font-family:var(--mono); font-size:12px; color:var(--green); }
.param-table td:nth-child(2) { color:var(--blue); font-family:var(--mono); font-size:11px; }
.param-table .req { color:var(--red); font-size:10px; font-family:var(--mono); }
.param-table .opt { color:var(--muted); font-size:10px; font-family:var(--mono); }
.response-schema { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:14px; font-family:var(--mono); font-size:12px; line-height:1.75; overflow-x:auto; margin-bottom:14px; }

/* ── WEBHOOK LOGS ── */
.log-row { display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:7px; background:var(--card); border:1px solid var(--border); margin-bottom:4px; font-size:12px; }
.log-method { font-family:var(--mono); font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; flex-shrink:0; }
.log-status { font-family:var(--mono); font-size:11px; flex-shrink:0; }
.log-path { font-family:var(--mono); flex:1; font-size:11.5px; color:var(--muted2); }
.log-time { font-size:11px; color:var(--muted); font-family:var(--mono); flex-shrink:0; }
.status-200 { color:var(--green); }
.status-4xx { color:var(--amber); }
.status-5xx { color:var(--red); }

/* ── MODAL ── */
.modal-backdrop {
  position:fixed; inset:0; background:rgba(0,0,0,.7);
  display:none; align-items:center; justify-content:center;
  z-index:100; backdrop-filter:blur(4px);
}
.modal-backdrop.open { display:flex; animation:fadeIn .2s; }
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal {
  background:var(--surface); border:1px solid var(--border2);
  border-radius:14px; padding:28px; max-width:440px; width:90%;
  position:relative;
}
.modal-close { position:absolute; top:16px; right:16px; background:none; border:none; color:var(--muted); cursor:pointer; font-size:18px; }
.modal-title { font-family:var(--mono); font-size:15px; font-weight:700; margin-bottom:6px; }
.modal-sub { font-size:13px; color:var(--muted2); margin-bottom:20px; }
.modal-plan-preview { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:14px; margin-bottom:18px; }
#stripe-card-element { background:var(--card); border:1px solid var(--border); border-radius:7px; padding:12px; margin-bottom:12px; }
.stripe-errors { color:var(--red); font-size:12px; margin-bottom:12px; min-height:18px; }
.stripe-secure { font-size:11px; color:var(--muted); display:flex; align-items:center; gap:5px; margin-top:8px; }

/* ── DIVIDER ── */
.divider { height:1px; background:var(--border); margin:20px 0; }

/* ── TOAST ── */
.toast {
  position:fixed; bottom:24px; right:24px;
  background:var(--card); border:1px solid var(--border2);
  border-radius:10px; padding:12px 18px;
  font-size:13px; display:flex; align-items:center; gap:10px;
  transform:translateY(80px); opacity:0;
  transition:all .3s; z-index:200; max-width:320px;
}
.toast.show { transform:translateY(0); opacity:1; }
.toast.success { border-color:var(--green); }
.toast.error { border-color:var(--red); }

/* ── RESPONSIVE ── */
@media(max-width:900px){
  .layout{grid-template-columns:1fr;}
  .sidebar{display:none;}
  .stats-row,.pricing-grid{grid-template-columns:repeat(2,1fr);}
  .nets-grid,.billing-grid{grid-template-columns:1fr;}
  .try-body{grid-template-columns:1fr;}
  .docs-layout{grid-template-columns:1fr;}
  .docs-nav{display:none;}
}
</style>
</head>
<body>

<!-- TOAST -->
<div class="toast" id="toast"><span id="toast-icon">✓</span><span id="toast-msg"></span></div>

<!-- SUBSCRIBE MODAL -->
<div class="modal-backdrop" id="subscribe-modal">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">Upgrade your plan</div>
    <div class="modal-sub">You'll be charged after confirming. Cancel anytime.</div>
    <div class="modal-plan-preview" id="modal-plan-preview"></div>
    <div id="stripe-card-element"></div>
    <div class="stripe-errors" id="stripe-errors"></div>
    <button class="btn btn-green" style="width:100%;justify-content:center;font-size:13px;" id="pay-btn" onclick="submitSubscription()">
      <span id="pay-btn-text">Subscribe & Pay</span>
    </button>
    <div class="stripe-secure">🔒 Secured by Stripe. Your card info never touches our servers.</div>
  </div>
</div>

<div class="layout">
  <!-- ── SIDEBAR ── -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <a class="logo-wrap" href="#" onclick="showPage('dashboard')">
        <div class="logo-hex">AP</div>
        <div class="logo-info">
          <div class="logo-name">AfriPay</div>
          <div class="logo-ver">v1.0 · STABLE</div>
        </div>
      </a>
    </div>

    <div class="nav-group">
      <div class="nav-label">Overview</div>
      <button class="nav-item active" onclick="showPage('dashboard')" id="nav-dashboard">
        <span class="nav-icon">◈</span> Dashboard
      </button>
      <button class="nav-item" onclick="showPage('logs')" id="nav-logs">
        <span class="nav-icon">⊟</span> Request Logs
      </button>
    </div>

    <div class="nav-group">
      <div class="nav-label">API</div>
      <button class="nav-item" onclick="showPage('explorer')" id="nav-explorer">
        <span class="nav-icon">⚡</span> API Explorer
      </button>
      <button class="nav-item" onclick="showPage('tryit')" id="nav-tryit">
        <span class="nav-icon">▷</span> Try It Live
      </button>
      <button class="nav-item" onclick="showPage('webhooks')" id="nav-webhooks">
        <span class="nav-icon">↗</span> Webhooks
      </button>
    </div>

    <div class="nav-group">
      <div class="nav-label">Networks</div>
      <button class="nav-item" onclick="showPage('networks')" id="nav-networks">
        <span class="nav-icon">◉</span> Mobile Money
      </button>
    </div>

    <div class="nav-group">
      <div class="nav-label">Account</div>
      <button class="nav-item" onclick="showPage('billing')" id="nav-billing">
        <span class="nav-icon">◈</span> Billing
      </button>
      <button class="nav-item" onclick="showPage('pricing')" id="nav-pricing">
        <span class="nav-icon">↑</span> Plans & Pricing
      </button>
      <button class="nav-item" onclick="showPage('docs')" id="nav-docs">
        <span class="nav-icon">□</span> Documentation
      </button>
    </div>

    <div class="sidebar-footer">
      <div class="plan-badge">
        <div class="plan-badge-top">
          <div class="plan-tier pro" id="sidebar-plan">PRO</div>
          <button class="btn btn-xs btn-ghost" onclick="showPage('pricing')">Upgrade</button>
        </div>
        <div class="plan-usage-bar"><div class="plan-usage-fill" id="usage-fill" style="width:8%"></div></div>
        <div class="plan-usage-text" id="usage-text">4,231 / 50,000 calls</div>
      </div>
    </div>
  </aside>

  <!-- ── MAIN ── -->
  <main class="main">
    <div class="topbar">
      <div class="topbar-left">
        <div class="topbar-page" id="topbar-title">Dashboard</div>
        <div class="breadcrumb" id="topbar-breadcrumb">afripay / overview</div>
      </div>
      <div class="topbar-right">
        <div class="live-dot">LIVE</div>
        <button class="btn btn-sm btn-ghost" onclick="showPage('docs')">📄 Docs</button>
        <button class="btn btn-sm btn-green" onclick="showPage('pricing')">↑ Upgrade</button>
      </div>
    </div>

    <!-- ─────────────────── DASHBOARD PAGE ─────────────────── -->
    <div class="page active" id="page-dashboard">
      <div style="padding:28px; max-width:1000px;">

        <div class="stats-row">
          <div class="stat-card g">
            <div class="stat-lbl">Requests Today</div>
            <div class="stat-val" id="req-today">0</div>
            <div class="stat-sub">↑ 12% from yesterday</div>
          </div>
          <div class="stat-card a">
            <div class="stat-lbl">Avg Latency</div>
            <div class="stat-val"><span id="latency">312</span>ms</div>
            <div class="stat-sub">Target: &lt;400ms</div>
          </div>
          <div class="stat-card b">
            <div class="stat-lbl">Success Rate</div>
            <div class="stat-val">98.7%</div>
            <div class="stat-sub">Last 24 hours</div>
          </div>
          <div class="stat-card r">
            <div class="stat-lbl">Errors Today</div>
            <div class="stat-val">54</div>
            <div class="stat-sub">↓ 3 from yesterday</div>
          </div>
        </div>

        <div class="section-hd">API Key <span style="color:var(--green);cursor:pointer;font-size:10px;" onclick="copyKey()">copy</span></div>
        <div class="key-card">
          <div class="key-row">
            <div class="key-display" id="api-key-display">afp_live_••••••••••••••••••••••••</div>
            <button class="btn btn-ghost btn-sm" onclick="toggleKey()">Reveal</button>
            <button class="btn btn-ghost btn-sm" onclick="copyKey()">Copy</button>
            <button class="btn btn-red btn-sm" onclick="showToast('New API key generated. Old key is now invalid.','success')">Rotate</button>
          </div>
          <div class="key-meta">
            <span>🔒 HMAC-signed</span>
            <span>📅 Created Mar 1, 2026</span>
            <span>🌍 KE · UG · GH · TZ · NG</span>
            <span>⚡ Pro tier</span>
          </div>
        </div>

        <div class="section-hd">Recent Transactions</div>
        <div id="recent-txns"></div>

        <div class="section-hd">Provider Status</div>
        <div class="nets-grid" style="grid-template-columns:repeat(4,1fr);">
          <div class="card card-sm" style="text-align:center;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono);">M-PESA</div>
            <div style="color:var(--green);font-family:var(--mono);font-size:12px;">● LIVE</div>
          </div>
          <div class="card card-sm" style="text-align:center;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono);">MTN MOMO</div>
            <div style="color:var(--green);font-family:var(--mono);font-size:12px;">● LIVE</div>
          </div>
          <div class="card card-sm" style="text-align:center;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono);">AIRTEL</div>
            <div style="color:var(--amber);font-family:var(--mono);font-size:12px;">● DEGRADED</div>
          </div>
          <div class="card card-sm" style="text-align:center;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono);">SNIPE</div>
            <div style="color:var(--green);font-family:var(--mono);font-size:12px;">● LIVE</div>
          </div>
        </div>

      </div>
    </div>

    <!-- ─────────────────── API EXPLORER PAGE ─────────────────── -->
    <div class="page" id="page-explorer">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">API Explorer — All Endpoints</div>

        <div class="ep-list">
          <div class="ep-row" onclick="setExplorerCode('pay')">
            <span class="method m-post">POST</span>
            <span class="ep-path">/v1/pay</span>
            <span class="ep-desc">Initiate payment · auto-detect network</span>
          </div>
          <div class="ep-row" onclick="setExplorerCode('status')">
            <span class="method m-get">GET</span>
            <span class="ep-path">/v1/status/:id</span>
            <span class="ep-desc">Poll transaction status</span>
          </div>
          <div class="ep-row" onclick="setExplorerCode('disburse')">
            <span class="method m-post">POST</span>
            <span class="ep-path">/v1/disburse</span>
            <span class="ep-desc">Send money to a phone number</span>
          </div>
          <div class="ep-row" onclick="setExplorerCode('balance')">
            <span class="method m-get">GET</span>
            <span class="ep-path">/v1/balance</span>
            <span class="ep-desc">All provider wallet balances</span>
          </div>
          <div class="ep-row" onclick="setExplorerCode('webhooks')">
            <span class="method m-post">POST</span>
            <span class="ep-path">/v1/webhooks/{provider}</span>
            <span class="ep-desc">Incoming callbacks (public)</span>
          </div>
          <div class="ep-row" onclick="setExplorerCode('keys')">
            <span class="method m-get">GET</span>
            <span class="ep-path">/v1/keys/me</span>
            <span class="ep-desc">API key info & tier</span>
          </div>
          <div class="ep-row" onclick="setExplorerCode('health')">
            <span class="method m-get">GET</span>
            <span class="ep-path">/health</span>
            <span class="ep-desc">Server + provider health check</span>
          </div>
        </div>

        <div class="code-tabs">
          <div class="code-tab active" onclick="switchLang('curl',this)">cURL</div>
          <div class="code-tab" onclick="switchLang('node',this)">Node.js</div>
          <div class="code-tab" onclick="switchLang('python',this)">Python</div>
          <div class="code-tab" onclick="switchLang('php',this)">PHP</div>
        </div>
        <div class="code-block">
          <button class="copy-btn" onclick="copyCode()">copy</button>
          <pre id="code-content"></pre>
        </div>
      </div>
    </div>

    <!-- ─────────────────── TRY IT PAGE ─────────────────── -->
    <div class="page" id="page-tryit">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">Try It Live — Sandbox Mode</div>
        <div class="alert-box alert-info">ℹ️ Requests below are simulated in sandbox mode. No real money moves.</div>
        <div class="try-panel">
          <div class="try-hd">
            <div class="try-title">POST /v1/pay</div>
            <div style="font-size:11px;color:var(--muted);">sandbox</div>
          </div>
          <div class="try-body">
            <div>
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label">Phone Number</label>
                <input class="form-input" id="try-phone" placeholder="+254712345678" value="+254712345678">
              </div>
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label">Amount</label>
                <input class="form-input" id="try-amount" placeholder="500" value="500" type="number">
              </div>
            </div>
            <div>
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label">Currency</label>
                <select class="form-input form-select" id="try-currency">
                  <option>KES</option><option>UGX</option><option>GHS</option>
                  <option>TZS</option><option>NGN</option><option>RWF</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label">Reference</label>
                <input class="form-input" id="try-ref" placeholder="ORDER-001" value="ORDER-001">
              </div>
            </div>
          </div>
          <div class="try-footer">
            <button class="btn btn-green" onclick="tryRequest()">▷ Send Request</button>
            <div class="resp-panel" id="try-response">Response will appear here…</div>
          </div>
        </div>

        <div class="section-hd">Test Phone Numbers</div>
        <div class="ep-list">
          <div class="ep-row" onclick="fillPhone('+254712345678')">
            <span class="method m-post" style="background:rgba(5,226,122,.1);color:var(--green);font-size:9px;">KE</span>
            <span class="ep-path">+254712345678</span>
            <span class="ep-desc">M-Pesa Kenya — success</span>
          </div>
          <div class="ep-row" onclick="fillPhone('+256771234567')">
            <span class="method m-get" style="font-size:9px;">UG</span>
            <span class="ep-path">+256771234567</span>
            <span class="ep-desc">MTN Uganda — success</span>
          </div>
          <div class="ep-row" onclick="fillPhone('+233241234567')">
            <span class="method m-get" style="font-size:9px;">GH</span>
            <span class="ep-path">+233241234567</span>
            <span class="ep-desc">MTN Ghana — success</span>
          </div>
          <div class="ep-row" onclick="fillPhone('+254731234567')">
            <span class="method m-post" style="background:rgba(255,90,90,.1);color:var(--red);font-size:9px;">FAIL</span>
            <span class="ep-path">+254731234567</span>
            <span class="ep-desc">Airtel Kenya — insufficient funds</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ─────────────────── WEBHOOKS PAGE ─────────────────── -->
    <div class="page" id="page-webhooks">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">Webhooks Configuration</div>

        <div class="card" style="margin-bottom:20px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Webhook Endpoints</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:10px 14px;">
              <span style="font-family:var(--mono);font-size:11px;color:var(--green);flex-shrink:0;">POST</span>
              <span style="font-family:var(--mono);font-size:12px;flex:1;">https://api.afripay.dev/v1/webhooks/mpesa</span>
              <span style="font-size:10px;color:var(--muted);">M-Pesa callbacks</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:10px 14px;">
              <span style="font-family:var(--mono);font-size:11px;color:var(--green);flex-shrink:0;">POST</span>
              <span style="font-family:var(--mono);font-size:12px;flex:1;">https://api.afripay.dev/v1/webhooks/mtn</span>
              <span style="font-size:10px;color:var(--muted);">MTN MoMo callbacks</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:10px 14px;">
              <span style="font-family:var(--mono);font-size:11px;color:var(--green);flex-shrink:0;">POST</span>
              <span style="font-family:var(--mono);font-size:12px;flex:1;">https://api.afripay.dev/v1/webhooks/airtel</span>
              <span style="font-size:10px;color:var(--muted);">Airtel Money callbacks</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:10px 14px;">
              <span style="font-family:var(--mono);font-size:11px;color:var(--green);flex-shrink:0;">POST</span>
              <span style="font-family:var(--mono);font-size:12px;flex:1;">https://api.afripay.dev/v1/webhooks/snipe</span>
              <span style="font-size:10px;color:var(--muted);">Snipe callbacks</span>
            </div>
          </div>
        </div>

        <div class="section-hd">Verify Webhook Signatures</div>
        <div class="code-block">
          <button class="copy-btn" onclick="copyElem('webhook-verify-code')">copy</button>
          <pre id="webhook-verify-code"><span class="c-m">// Verify AfriPay webhook signature in Node.js</span>
<span class="c-g">const</span> crypto = require(<span class="c-a">'crypto'</span>);

<span class="c-g">function</span> verifyWebhook(payload, secret, receivedSig, timestamp) {
  <span class="c-g">const</span> message = <span class="c-a">\`\${timestamp}.\${payload}\`</span>;
  <span class="c-g">const</span> expected = <span class="c-a">'sha256='</span> + crypto
    .createHmac(<span class="c-a">'sha256'</span>, secret)
    .update(message)
    .digest(<span class="c-a">'hex'</span>);
  <span class="c-g">return</span> crypto.timingSafeEqual(
    Buffer.from(receivedSig), Buffer.from(expected)
  );
}</pre>
        </div>
      </div>
    </div>

    <!-- ─────────────────── NETWORKS PAGE ─────────────────── -->
    <div class="page" id="page-networks">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">Supported Mobile Money Networks</div>
        <div class="nets-grid">
          <div class="net-card">
            <div class="net-icon" style="background:rgba(0,255,102,.1);color:#00ff66;">MP</div>
            <div>
              <div class="net-name">M-Pesa</div>
              <div class="net-countries">Kenya · Tanzania (Vodacom)</div>
              <div class="net-tags">
                <span class="tag" style="background:var(--green-dim);color:var(--green);">STK Push</span>
                <span class="tag" style="background:var(--blue-dim);color:var(--blue);">B2C</span>
                <span class="tag" style="background:var(--card2);color:var(--muted2);">Daraja v2</span>
              </div>
            </div>
          </div>
          <div class="net-card">
            <div class="net-icon" style="background:rgba(255,200,0,.08);color:#ffc800;">MTN</div>
            <div>
              <div class="net-name">MTN MoMo</div>
              <div class="net-countries">Uganda · Ghana · Rwanda · Zambia · 17 countries</div>
              <div class="net-tags">
                <span class="tag" style="background:var(--green-dim);color:var(--green);">Collect</span>
                <span class="tag" style="background:var(--blue-dim);color:var(--blue);">Disbursement</span>
                <span class="tag" style="background:var(--card2);color:var(--muted2);">MoMo API v1</span>
              </div>
            </div>
          </div>
          <div class="net-card">
            <div class="net-icon" style="background:rgba(255,60,60,.08);color:#ff3c3c;">AIR</div>
            <div>
              <div class="net-name">Airtel Money</div>
              <div class="net-countries">Kenya · Uganda · Tanzania · Ghana · Nigeria</div>
              <div class="net-tags">
                <span class="tag" style="background:var(--green-dim);color:var(--green);">USSD Push</span>
                <span class="tag" style="background:var(--blue-dim);color:var(--blue);">Disburse</span>
                <span class="tag" style="background:var(--card2);color:var(--muted2);">Airtel API v2</span>
              </div>
            </div>
          </div>
          <div class="net-card">
            <div class="net-icon" style="background:rgba(167,139,250,.08);color:var(--purple);">SNP</div>
            <div>
              <div class="net-name">Snipe</div>
              <div class="net-countries">Pan-African · Card · Mobile Money · USSD</div>
              <div class="net-tags">
                <span class="tag" style="background:var(--green-dim);color:var(--green);">Collect</span>
                <span class="tag" style="background:var(--blue-dim);color:var(--blue);">Disburse</span>
                <span class="tag" style="background:var(--card2);color:var(--muted2);">Snipe v1</span>
              </div>
            </div>
          </div>
        </div>

        <div class="section-hd">Phone Number Auto-Detection</div>
        <div class="card">
          <p style="font-size:13px;color:var(--muted2);margin-bottom:14px;">AfriPay detects the network from the phone prefix automatically. Pass <span class="inline-code">"network":"auto"</span> (default) and we handle routing.</p>
          <table class="param-table" style="font-size:12px;">
            <tr><th>Prefix</th><th>Country</th><th>Network</th><th>Currency</th></tr>
            <tr><td>+25470/71/72/79</td><td>Kenya</td><td>M-Pesa</td><td>KES</td></tr>
            <tr><td>+25473/74</td><td>Kenya</td><td>Airtel</td><td>KES</td></tr>
            <tr><td>+25677/78/76</td><td>Uganda</td><td>MTN MoMo</td><td>UGX</td></tr>
            <tr><td>+25670/75</td><td>Uganda</td><td>Airtel</td><td>UGX</td></tr>
            <tr><td>+23324/25/26</td><td>Ghana</td><td>MTN MoMo</td><td>GHS</td></tr>
            <tr><td>+25574/75/76</td><td>Tanzania</td><td>M-Pesa (Vodacom)</td><td>TZS</td></tr>
            <tr><td>+23480/81</td><td>Nigeria</td><td>Airtel</td><td>NGN</td></tr>
          </table>
        </div>
      </div>
    </div>

    <!-- ─────────────────── LOGS PAGE ─────────────────── -->
    <div class="page" id="page-logs">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">Request Logs <span style="font-size:10px;color:var(--muted);">last 50 requests</span></div>
        <div id="log-list"></div>
      </div>
    </div>

    <!-- ─────────────────── BILLING PAGE ─────────────────── -->
    <div class="page" id="page-billing">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">Billing Overview</div>

        <div class="billing-grid">
          <div class="billing-stat">
            <div class="billing-stat-label">Current Plan</div>
            <div class="billing-stat-value" style="color:var(--amber);">PRO</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">$79 / month · renews Apr 1, 2026</div>
          </div>
          <div class="billing-stat">
            <div class="billing-stat-label">API Calls This Month</div>
            <div class="billing-stat-value">4,231</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">of 50,000 included (8.5%)</div>
          </div>
          <div class="billing-stat">
            <div class="billing-stat-label">Next Invoice</div>
            <div class="billing-stat-value">$79.00</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">Due April 1, 2026</div>
          </div>
          <div class="billing-stat">
            <div class="billing-stat-label">Payment Method</div>
            <div class="billing-stat-value" style="font-size:16px;">•••• 4242</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">Visa · expires 12/27 <button class="btn btn-xs btn-ghost" onclick="openUpdateCard()" style="margin-left:6px;">Update</button></div>
          </div>
        </div>

        <div class="section-hd">Invoice History</div>
        <div class="card">
          <div class="invoice-row">
            <span>Mar 1, 2026</span>
            <span style="font-family:var(--mono);">INV-2026-003</span>
            <span>Pro Plan</span>
            <span style="font-family:var(--mono);">$79.00</span>
            <span class="invoice-status inv-paid">PAID</span>
            <button class="btn btn-xs btn-ghost">Download</button>
          </div>
          <div class="invoice-row">
            <span>Feb 1, 2026</span>
            <span style="font-family:var(--mono);">INV-2026-002</span>
            <span>Pro Plan</span>
            <span style="font-family:var(--mono);">$79.00</span>
            <span class="invoice-status inv-paid">PAID</span>
            <button class="btn btn-xs btn-ghost">Download</button>
          </div>
          <div class="invoice-row">
            <span>Jan 1, 2026</span>
            <span style="font-family:var(--mono);">INV-2026-001</span>
            <span>Starter Plan</span>
            <span style="font-family:var(--mono);">$19.00</span>
            <span class="invoice-status inv-paid">PAID</span>
            <button class="btn btn-xs btn-ghost">Download</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:8px;">
          <button class="btn btn-ghost" onclick="showPage('pricing')">↑ Upgrade Plan</button>
          <button class="btn btn-red btn-sm" onclick="showToast('To cancel, email support@afripay.dev','error')">Cancel Subscription</button>
        </div>
      </div>
    </div>

    <!-- ─────────────────── PRICING PAGE ─────────────────── -->
    <div class="page" id="page-pricing">
      <div style="padding:28px;max-width:1000px;">
        <div class="section-hd">Plans & Pricing</div>

        <div class="pricing-grid">
          <!-- FREE -->
          <div class="price-card">
            <div class="price-tier">Free</div>
            <div class="price-amt">$0<span>/mo</span></div>
            <div class="price-calls">500 calls/month</div>
            <ul class="price-feats">
              <li>Sandbox access</li>
              <li>M-Pesa (Kenya)</li>
              <li>Basic documentation</li>
              <li>Community support</li>
              <li class="no">Live payments</li>
              <li class="no">Disbursements</li>
              <li class="no">Webhooks</li>
            </ul>
            <button class="subscribe-btn current" disabled>Current Plan</button>
          </div>

          <!-- STARTER -->
          <div class="price-card">
            <div class="price-tier">Starter</div>
            <div class="price-amt">$19<span>/mo</span></div>
            <div class="price-calls">5,000 calls/month</div>
            <ul class="price-feats">
              <li>Live payments</li>
              <li>M-Pesa + MTN + Airtel</li>
              <li>Webhooks</li>
              <li>Email support</li>
              <li>3 countries</li>
              <li class="no">Disbursements</li>
              <li class="no">SLA guarantee</li>
            </ul>
            <button class="subscribe-btn" onclick="openSubscribeModal('starter','$19/mo')">Get Starter</button>
          </div>

          <!-- PRO -->
          <div class="price-card featured">
            <div class="price-pop">POPULAR</div>
            <div class="price-tier">Pro</div>
            <div class="price-amt">$79<span>/mo</span></div>
            <div class="price-calls">50,000 calls/month</div>
            <ul class="price-feats">
              <li>Everything in Starter</li>
              <li>All 4 networks + Snipe</li>
              <li>7 countries</li>
              <li>Disbursements</li>
              <li>Balance checks</li>
              <li>Priority support</li>
              <li class="no">SLA guarantee</li>
            </ul>
            <button class="subscribe-btn primary" onclick="openSubscribeModal('pro','$79/mo')">Upgrade to Pro</button>
          </div>

          <!-- ULTRA -->
          <div class="price-card">
            <div class="price-tier">Ultra</div>
            <div class="price-amt">$249<span>/mo</span></div>
            <div class="price-calls">Unlimited calls</div>
            <ul class="price-feats">
              <li>Everything in Pro</li>
              <li>All 17+ countries</li>
              <li>99.9% SLA guarantee</li>
              <li>Custom webhooks</li>
              <li>Dedicated Slack support</li>
              <li>Custom rate limits</li>
              <li>Invoice billing</li>
            </ul>
            <button class="subscribe-btn" onclick="openSubscribeModal('ultra','$249/mo')">Get Ultra</button>
          </div>
        </div>

        <div class="alert-box alert-info" style="margin-top:8px;">
          💳 All plans are billed monthly. Cancel anytime. Payments processed securely by Stripe.
        </div>
      </div>
    </div>

    <!-- ─────────────────── DOCS PAGE ─────────────────── -->
    <div class="page" id="page-docs">
      <div style="padding:28px;max-width:1000px;">
        <div class="docs-layout">

          <!-- Docs sidebar nav -->
          <nav class="docs-nav">
            <div class="docs-nav-group">Getting Started</div>
            <a class="docs-nav-item active" onclick="scrollToDoc('doc-intro')">Introduction</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-quickstart')">Quick Start</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-auth')">Authentication</a>
            <div class="docs-nav-group">API Reference</div>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-pay')">POST /v1/pay</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-status')">GET /v1/status</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-disburse')">POST /v1/disburse</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-balance')">GET /v1/balance</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-webhooks')">Webhooks</a>
            <div class="docs-nav-group">Guides</div>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-networks')">Networks & Detection</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-errors')">Error Codes</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-ratelimits')">Rate Limits</a>
            <a class="docs-nav-item" onclick="scrollToDoc('doc-testing')">Testing</a>
          </nav>

          <!-- Docs main content -->
          <div class="docs-content">

            <div id="doc-intro">
              <h1>AfriPay API Documentation</h1>
              <p class="docs-lead">AfriPay is a unified mobile money API that lets you accept and send payments across Africa with a single integration. One API key, one request format — M-Pesa, MTN MoMo, Airtel Money, and Snipe all handled for you.</p>
              <div class="alert-box alert-success">✓ Base URL: <span class="inline-code">https://api.afripay.dev</span> · Self-hosted: <span class="inline-code">http://localhost:3000</span></div>
            </div>

            <div id="doc-quickstart">
              <h2>Quick Start</h2>
              <p>Get your first payment running in under 5 minutes.</p>

              <h3>Step 1 — Get your API key</h3>
              <p>Go to the <a onclick="showPage('dashboard')">Dashboard</a>, copy your API key, and add it to your environment:</p>
              <div class="code-block" style="margin-top:8px;">
                <pre><span class="c-m"># .env</span>
<span class="c-g">AFRIPAY_KEY</span>=afp_live_your_key_here</pre>
              </div>

              <h3>Step 2 — Install the SDK (optional)</h3>
              <div class="code-block">
                <pre><span class="c-m"># Node.js</span>
npm install afripay

<span class="c-m"># Python</span>
pip install afripay

<span class="c-m"># Or use the REST API directly — no SDK needed</span></pre>
              </div>

              <h3>Step 3 — Initiate your first payment</h3>
              <div class="code-block">
                <button class="copy-btn" onclick="copyElem('qs-code')">copy</button>
                <pre id="qs-code"><span class="c-m"># cURL example — request an M-Pesa STK push</span>
<span class="c-g">curl</span> -X POST http://localhost:3000/v1/pay \\
  -H <span class="c-a">"Authorization: Bearer afp_live_your_key"</span> \\
  -H <span class="c-a">"Content-Type: application/json"</span> \\
  -d <span class="c-a">'{
    "phone":     "+254712345678",
    "amount":    500,
    "currency":  "KES",
    "reference": "ORDER-001",
    "description": "Payment for Order #001"
  }'</span></pre>
              </div>

              <h3>Step 4 — Handle the webhook callback</h3>
              <p>AfriPay sends a callback to your <span class="inline-code">callback_url</span> when the payment completes or fails. Register your endpoint and verify the signature:</p>
              <div class="code-block">
                <pre><span class="c-m">// Express.js webhook handler</span>
app.post(<span class="c-a">'/payments/callback'</span>, (req, res) => {
  <span class="c-g">const</span> { transaction_id, status, network } = req.body;

  <span class="c-g">if</span> (status === <span class="c-a">'completed'</span>) {
    <span class="c-m">// ✓ Fulfil order, send receipt</span>
    fulfillOrder(transaction_id);
  } <span class="c-g">else if</span> (status === <span class="c-a">'failed'</span>) {
    <span class="c-m">// ✕ Notify customer, retry or refund</span>
    handleFailure(transaction_id);
  }

  res.sendStatus(<span class="c-b">200</span>); <span class="c-m">// Always ACK</span>
});</pre>
              </div>
            </div>

            <div id="doc-auth">
              <h2>Authentication</h2>
              <p>All authenticated endpoints require your API key in the <span class="inline-code">Authorization</span> header as a Bearer token:</p>
              <div class="code-block">
                <pre>Authorization: Bearer afp_live_your_key_here</pre>
              </div>
              <div class="alert-box alert-warn">⚠️ Never expose your API key in client-side code or public repositories. Rotate compromised keys immediately from the Dashboard.</div>
              <h3>Key format</h3>
              <p>AfriPay keys follow this format: <span class="inline-code">afp_{tier}_{32-char-hmac-signed-token}</span></p>
              <table class="param-table">
                <tr><th>Prefix</th><th>Tier</th></tr>
                <tr><td>afp_free_</td><td>Free</td></tr>
                <tr><td>afp_start_</td><td>Starter</td></tr>
                <tr><td>afp_pro_</td><td>Pro</td></tr>
                <tr><td>afp_ultra_</td><td>Ultra</td></tr>
              </table>
            </div>

            <div id="doc-pay">
              <h2>POST /v1/pay</h2>
              <p>Initiate a mobile money payment. AfriPay automatically detects the network from the phone prefix and routes to the correct provider.</p>
              <h3>Request Parameters</h3>
              <table class="param-table">
                <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
                <tr><td>phone</td><td>string</td><td><span class="req">required</span></td><td>E.164 format e.g. +254712345678</td></tr>
                <tr><td>amount</td><td>number</td><td><span class="req">required</span></td><td>Positive number, max 150,000</td></tr>
                <tr><td>currency</td><td>string</td><td><span class="opt">optional</span></td><td>ISO 4217, e.g. KES. Auto-detected from phone if omitted.</td></tr>
                <tr><td>reference</td><td>string</td><td><span class="req">required</span></td><td>Your order/transaction ref, max 20 chars</td></tr>
                <tr><td>description</td><td>string</td><td><span class="opt">optional</span></td><td>Shown to customer, max 100 chars</td></tr>
                <tr><td>callback_url</td><td>string</td><td><span class="opt">optional</span></td><td>HTTPS URL for payment status callbacks</td></tr>
                <tr><td>network</td><td>string</td><td><span class="opt">optional</span></td><td>mpesa · mtn_momo · airtel · snipe · auto (default)</td></tr>
              </table>
              <h3>Response</h3>
              <div class="response-schema"><span class="c-b">{</span>
  <span class="c-g">"success"</span>:        <span class="c-b">true</span>,
  <span class="c-g">"transaction_id"</span>: <span class="c-a">"afp_a3f9b2c1d4e5"</span>,   <span class="c-m">// AfriPay ID — use for status checks</span>
  <span class="c-g">"provider_ref"</span>:   <span class="c-a">"ws_CO_260320261234"</span>, <span class="c-m">// Provider's own reference</span>
  <span class="c-g">"status"</span>:         <span class="c-a">"pending"</span>,
  <span class="c-g">"network"</span>:        <span class="c-a">"mpesa"</span>,
  <span class="c-g">"phone"</span>:          <span class="c-a">"254712345678"</span>,
  <span class="c-g">"amount"</span>:         <span class="c-b">500</span>,
  <span class="c-g">"currency"</span>:       <span class="c-a">"KES"</span>,
  <span class="c-g">"country"</span>:        <span class="c-a">"Kenya"</span>,
  <span class="c-g">"message"</span>:        <span class="c-a">"Customer will receive a prompt on their phone."</span>,
  <span class="c-g">"check_status"</span>:   <span class="c-a">"GET /v1/status/afp_a3f9b2c1d4e5"</span>
<span class="c-b">}</span></div>
            </div>

            <div id="doc-status">
              <h2>GET /v1/status/:id</h2>
              <p>Poll the status of a transaction using its <span class="inline-code">transaction_id</span> returned from <span class="inline-code">/v1/pay</span> or <span class="inline-code">/v1/disburse</span>.</p>
              <h3>Path Parameters</h3>
              <table class="param-table">
                <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
                <tr><td>id</td><td>string</td><td>AfriPay transaction ID starting with afp_</td></tr>
              </table>
              <h3>Status Values</h3>
              <table class="param-table">
                <tr><th>Status</th><th>Meaning</th></tr>
                <tr><td>pending</td><td>Awaiting customer action or provider confirmation</td></tr>
                <tr><td>completed</td><td>Payment successful — safe to fulfil order</td></tr>
                <tr><td>failed</td><td>Payment failed — check failure_reason</td></tr>
                <tr><td>cancelled</td><td>Customer declined or timed out</td></tr>
              </table>
            </div>

            <div id="doc-disburse">
              <h2>POST /v1/disburse</h2>
              <p>Send money from your business wallet to a mobile money number. Requires Starter plan or above.</p>
              <h3>Request Parameters</h3>
              <table class="param-table">
                <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
                <tr><td>phone</td><td>string</td><td><span class="req">required</span></td><td>Recipient phone in E.164 format</td></tr>
                <tr><td>amount</td><td>number</td><td><span class="req">required</span></td><td>Amount to send, max 500,000</td></tr>
                <tr><td>currency</td><td>string</td><td><span class="opt">optional</span></td><td>Auto-detected if omitted</td></tr>
                <tr><td>reference</td><td>string</td><td><span class="req">required</span></td><td>Your internal reference</td></tr>
                <tr><td>description</td><td>string</td><td><span class="opt">optional</span></td><td>Reason for payment</td></tr>
              </table>
            </div>

            <div id="doc-balance">
              <h2>GET /v1/balance</h2>
              <p>Returns your current available balance across all configured provider wallets. Requires Pro plan or above.</p>
              <div class="response-schema"><span class="c-b">{</span>
  <span class="c-g">"success"</span>: <span class="c-b">true</span>,
  <span class="c-g">"balances"</span>: <span class="c-b">{</span>
    <span class="c-g">"mpesa"</span>:    <span class="c-b">{ "available"</span>: <span class="c-b">125000</span>, <span class="c-g">"currency"</span>: <span class="c-a">"KES"</span>, <span class="c-g">"status"</span>: <span class="c-a">"ok"</span> <span class="c-b">}</span>,
    <span class="c-g">"mtn_momo"</span>: <span class="c-b">{ "available"</span>: <span class="c-b">450000</span>, <span class="c-g">"currency"</span>: <span class="c-a">"UGX"</span>, <span class="c-g">"status"</span>: <span class="c-a">"ok"</span> <span class="c-b">}</span>,
    <span class="c-g">"airtel"</span>:   <span class="c-b">{ "status"</span>: <span class="c-a">"error"</span>, <span class="c-g">"reason"</span>: <span class="c-a">"unavailable"</span> <span class="c-b">}</span>
  <span class="c-b">}</span>
<span class="c-b">}</span></div>
            </div>

            <div id="doc-webhooks">
              <h2>Webhooks</h2>
              <p>AfriPay sends a <span class="inline-code">POST</span> request to your <span class="inline-code">callback_url</span> when a transaction status changes. Always respond with HTTP 200 to acknowledge.</p>
              <h3>Webhook Payload</h3>
              <div class="response-schema"><span class="c-b">{</span>
  <span class="c-g">"event"</span>:          <span class="c-a">"payment.completed"</span>,
  <span class="c-g">"transaction_id"</span>: <span class="c-a">"afp_a3f9b2c1d4e5"</span>,
  <span class="c-g">"status"</span>:         <span class="c-a">"completed"</span>,
  <span class="c-g">"network"</span>:        <span class="c-a">"mpesa"</span>,
  <span class="c-g">"amount"</span>:         <span class="c-b">500</span>,
  <span class="c-g">"currency"</span>:       <span class="c-a">"KES"</span>,
  <span class="c-g">"timestamp"</span>:      <span class="c-a">"2026-03-26T09:15:00Z"</span>
<span class="c-b">}</span></div>
              <div class="alert-box alert-warn">⚠️ Always verify the <span class="inline-code">X-AfriPay-Signature</span> header before processing webhooks. See the <a onclick="showPage('webhooks')">Webhooks page</a> for verification code.</div>
            </div>

            <div id="doc-networks">
              <h2>Networks & Auto-Detection</h2>
              <p>AfriPay automatically detects the correct payment network from the phone number prefix using Rust-powered pattern matching. You never need to specify the network manually.</p>
              <p>See the full prefix table on the <a onclick="showPage('networks')">Networks page</a>.</p>
            </div>

            <div id="doc-errors">
              <h2>Error Codes</h2>
              <table class="param-table">
                <tr><th>Code</th><th>HTTP</th><th>Meaning</th></tr>
                <tr><td>VALIDATION_ERROR</td><td>400</td><td>Request body failed validation</td></tr>
                <tr><td>INVALID_PHONE</td><td>400</td><td>Phone prefix not recognised</td></tr>
                <tr><td>MISSING_API_KEY</td><td>401</td><td>Authorization header missing</td></tr>
                <tr><td>INVALID_API_KEY</td><td>401</td><td>Key is malformed or tampered</td></tr>
                <tr><td>FORBIDDEN</td><td>403</td><td>Transaction belongs to another key</td></tr>
                <tr><td>TRANSACTION_NOT_FOUND</td><td>404</td><td>No transaction with that ID</td></tr>
                <tr><td>RATE_LIMIT_EXCEEDED</td><td>429</td><td>Too many requests — check tier limits</td></tr>
                <tr><td>INSUFFICIENT_FUNDS</td><td>422</td><td>Customer wallet is empty</td></tr>
                <tr><td>PAYMENT_CANCELLED</td><td>422</td><td>Customer dismissed the prompt</td></tr>
                <tr><td>PROVIDER_TIMEOUT</td><td>504</td><td>Provider didn't respond in time</td></tr>
                <tr><td>PROVIDER_ERROR</td><td>502</td><td>Upstream provider returned an error</td></tr>
                <tr><td>INTERNAL_ERROR</td><td>500</td><td>AfriPay internal error</td></tr>
              </table>
            </div>

            <div id="doc-ratelimits">
              <h2>Rate Limits</h2>
              <table class="param-table">
                <tr><th>Plan</th><th>Requests / 15 min</th><th>Monthly calls</th></tr>
                <tr><td>Free</td><td>100</td><td>500</td></tr>
                <tr><td>Starter</td><td>500</td><td>5,000</td></tr>
                <tr><td>Pro</td><td>2,000</td><td>50,000</td></tr>
                <tr><td>Ultra</td><td>10,000</td><td>Unlimited</td></tr>
              </table>
              <p>Rate limit headers are included in every response: <span class="inline-code">RateLimit-Remaining</span>, <span class="inline-code">RateLimit-Reset</span>.</p>
            </div>

            <div id="doc-testing">
              <h2>Testing</h2>
              <p>Set <span class="inline-code">MPESA_ENV=sandbox</span>, <span class="inline-code">MTN_MOMO_ENV=sandbox</span>, and <span class="inline-code">AIRTEL_ENV=sandbox</span> in your <span class="inline-code">.env</span> file to use sandbox mode.</p>
              <h3>Running the test suite</h3>
              <div class="code-block">
                <pre><span class="c-m"># Install deps and run all tests</span>
cd afripay/node-api
npm install
npm test

<span class="c-m"># With coverage</span>
npm run test:coverage</pre>
              </div>
              <h3>Test phone numbers</h3>
              <p>Use these numbers in sandbox mode to trigger specific outcomes. Visit the <a onclick="showPage('tryit')">Try It Live</a> page to test interactively.</p>
              <table class="param-table">
                <tr><th>Phone</th><th>Network</th><th>Result</th></tr>
                <tr><td>+254712345678</td><td>M-Pesa KE</td><td>Success</td></tr>
                <tr><td>+256771234567</td><td>MTN Uganda</td><td>Success</td></tr>
                <tr><td>+233241234567</td><td>MTN Ghana</td><td>Success</td></tr>
                <tr><td>+254731234567</td><td>Airtel KE</td><td>Insufficient funds</td></tr>
              </table>
            </div>

          </div><!-- /docs-content -->
        </div><!-- /docs-layout -->
      </div>
    </div>

  </main>
</div>

<script>
// ── STATE ──────────────────────────────────────────────────────────────────────
const DEMO_KEY = 'afp_live_a3f9b2c1d4e5f6789abc0def1234';
let keyRevealed = false;
let currentPlan = { id: 'free', name: 'Free', price: 0 };
let stripe = null;
let cardElement = null;
let pendingPlan = null;

// ── STRIPE SETUP ───────────────────────────────────────────────────────────────
// Price IDs and publishable key are loaded from the server (.env) at runtime.
// Never hardcode Stripe keys in frontend HTML.
let STRIPE_CONFIG = { configured: false, publishable_key: null, prices: {} };

async function loadStripeConfig() {
  try {
    const res = await fetch('/v1/billing/config');
    if (res.ok) STRIPE_CONFIG = await res.json();
  } catch(e) {
    console.warn('Could not load Stripe config from server');
  }
}

function initStripe() {
  if (!stripe && STRIPE_CONFIG.publishable_key) {
    try {
      stripe = Stripe(STRIPE_CONFIG.publishable_key);
    } catch(e) {
      console.warn('Stripe.js failed to init:', e.message);
    }
  }
}

// ── NAVIGATION ─────────────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  const nav  = document.getElementById('nav-' + id);
  if (page) page.classList.add('active');
  if (nav)  nav.classList.add('active');

  const titles = {
    dashboard:'Dashboard', explorer:'API Explorer', tryit:'Try It Live',
    webhooks:'Webhooks', networks:'Networks', logs:'Request Logs',
    billing:'Billing', pricing:'Plans & Pricing', docs:'Documentation'
  };
  const crumbs = {
    dashboard:'afripay / overview', explorer:'afripay / api / explorer',
    tryit:'afripay / api / try-it', webhooks:'afripay / api / webhooks',
    networks:'afripay / networks', logs:'afripay / logs',
    billing:'afripay / account / billing', pricing:'afripay / account / pricing',
    docs:'afripay / docs'
  };
  document.getElementById('topbar-title').textContent = titles[id] || id;
  document.getElementById('topbar-breadcrumb').textContent = crumbs[id] || '';
  window.scrollTo(0,0);
}

// ── API KEY ───────────────────────────────────────────────────────────────────
function toggleKey() {
  keyRevealed = !keyRevealed;
  document.getElementById('api-key-display').textContent = keyRevealed
    ? DEMO_KEY : 'afp_live_••••••••••••••••••••••••••••';
}
function copyKey() {
  navigator.clipboard?.writeText(DEMO_KEY);
  showToast('API key copied to clipboard', 'success');
}

// ── CODE EXPLORER ─────────────────────────────────────────────────────────────
const CODES = {
  pay: {
    curl: \`<span class="c-m"># Initiate a payment — network auto-detected from phone prefix</span>\\n\\n<span class="c-g">curl</span> -X POST http://localhost:3000/v1/pay \\\\\\n  -H <span class="c-a">"Authorization: Bearer afp_live_your_key"</span> \\\\\\n  -H <span class="c-a">"Content-Type: application/json"</span> \\\\\\n  -d <span class="c-a">'{</span>\\n       <span class="c-a">"phone":       "+254712345678",</span>\\n       <span class="c-a">"amount":      500,</span>\\n       <span class="c-a">"currency":    "KES",</span>\\n       <span class="c-a">"reference":   "ORDER-001",</span>\\n       <span class="c-a">"callback_url":"https://yoursite.com/webhooks/afripay"</span>\\n     <span class="c-a">'}</span>\`,
    node: \`<span class="c-g">const</span> res = <span class="c-g">await</span> fetch(<span class="c-a">'http://localhost:3000/v1/pay'</span>, {\\n  method: <span class="c-a">'POST'</span>,\\n  headers: {\\n    <span class="c-a">'Authorization'</span>: <span class="c-a">\\\`Bearer \\\${process.env.AFRIPAY_KEY}\\\`</span>,\\n    <span class="c-a">'Content-Type'</span>: <span class="c-a">'application/json'</span>\\n  },\\n  body: JSON.stringify({\\n    phone: <span class="c-a">'+254712345678'</span>, amount: <span class="c-b">500</span>, currency: <span class="c-a">'KES'</span>, reference: <span class="c-a">'ORDER-001'</span>\\n  })\\n});\\n<span class="c-g">const</span> { transaction_id, network, status } = <span class="c-g">await</span> res.json();\\nconsole.log(<span class="c-a">\\\`\\\${network} payment \\\${transaction_id}: \\\${status}\\\`</span>);\`,
    python: \`import requests\\n\\nresponse = requests.post(\\n    <span class="c-a">"http://localhost:3000/v1/pay"</span>,\\n    headers={<span class="c-a">"Authorization"</span>: <span class="c-a">f"Bearer {AFRIPAY_KEY}"</span>},\\n    json={<span class="c-a">"phone"</span>: <span class="c-a">"+254712345678"</span>, <span class="c-a">"amount"</span>: <span class="c-b">500</span>, <span class="c-a">"currency"</span>: <span class="c-a">"KES"</span>, <span class="c-a">"reference"</span>: <span class="c-a">"ORDER-001"</span>}\\n)\\ndata = response.json()\\nprint(data[<span class="c-a">"transaction_id"</span>], data[<span class="c-a">"network"</span>])\`,
    php: \`$ch = curl_init(<span class="c-a">'http://localhost:3000/v1/pay'</span>);\\ncurl_setopt_array($ch, [\\n    CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,\\n    CURLOPT_HTTPHEADER => [<span class="c-a">'Authorization: Bearer '</span> . AFRIPAY_KEY, <span class="c-a">'Content-Type: application/json'</span>],\\n    CURLOPT_POSTFIELDS => json_encode([<span class="c-a">'phone'</span> => <span class="c-a">'+254712345678'</span>, <span class="c-a">'amount'</span> => <span class="c-b">500</span>, <span class="c-a">'currency'</span> => <span class="c-a">'KES'</span>, <span class="c-a">'reference'</span> => <span class="c-a">'ORDER-001'</span>])\\n]);\\n$result = json_decode(curl_exec($ch), true);\\necho $result[<span class="c-a">'transaction_id'</span>];\`
  },
  status: {
    curl: \`<span class="c-g">curl</span> http://localhost:3000/v1/status/<span class="c-a">afp_a3f9b2c1d4e5</span> \\\\\\n  -H <span class="c-a">"Authorization: Bearer afp_live_your_key"</span>\`,
    node: \`<span class="c-g">const</span> res = <span class="c-g">await</span> fetch(<span class="c-a">\\\`http://localhost:3000/v1/status/\\\${transactionId}\\\`</span>, {\\n  headers: { <span class="c-a">'Authorization'</span>: <span class="c-a">\\\`Bearer \\\${process.env.AFRIPAY_KEY}\\\`</span> }\\n});\\n<span class="c-g">const</span> { status, network, failure_reason } = <span class="c-g">await</span> res.json();\\nconsole.log(<span class="c-a">\\\`Status: \\\${status}\\\`</span>);\`,
    python: \`response = requests.get(\\n    <span class="c-a">f"http://localhost:3000/v1/status/{transaction_id}"</span>,\\n    headers={<span class="c-a">"Authorization"</span>: <span class="c-a">f"Bearer {AFRIPAY_KEY}"</span>}\\n)\\nprint(response.json()[<span class="c-a">"status"</span>])\`,
    php: \`$result = json_decode(file_get_contents(\\n    <span class="c-a">"http://localhost:3000/v1/status/" . $transactionId</span>,\\n    false, stream_context_create([<span class="c-a">'http'</span> => [<span class="c-a">'header'</span> => <span class="c-a">"Authorization: Bearer " . AFRIPAY_KEY</span>]])\\n), true);\\necho $result[<span class="c-a">'status'</span>];\`
  },
  disburse: {
    curl: \`<span class="c-m"># Send money to a phone number (B2C)</span>\\n\\n<span class="c-g">curl</span> -X POST http://localhost:3000/v1/disburse \\\\\\n  -H <span class="c-a">"Authorization: Bearer afp_live_your_key"</span> \\\\\\n  -H <span class="c-a">"Content-Type: application/json"</span> \\\\\\n  -d <span class="c-a">'{</span>\\n       <span class="c-a">"phone":     "+256771234567",</span>\\n       <span class="c-a">"amount":    15000,</span>\\n       <span class="c-a">"currency":  "UGX",</span>\\n       <span class="c-a">"reference": "PAYOUT-042"</span>\\n     <span class="c-a">'}</span>\`,
    node: \`<span class="c-g">const</span> res = <span class="c-g">await</span> fetch(<span class="c-a">'http://localhost:3000/v1/disburse'</span>, {\\n  method: <span class="c-a">'POST'</span>,\\n  headers: { <span class="c-a">'Authorization'</span>: <span class="c-a">\\\`Bearer \\\${process.env.AFRIPAY_KEY}\\\`</span>, <span class="c-a">'Content-Type'</span>: <span class="c-a">'application/json'</span> },\\n  body: JSON.stringify({ phone: <span class="c-a">'+256771234567'</span>, amount: <span class="c-b">15000</span>, currency: <span class="c-a">'UGX'</span>, reference: <span class="c-a">'PAYOUT-042'</span> })\\n});\\n<span class="c-g">const</span> data = <span class="c-g">await</span> res.json();\`,
    python: \`response = requests.post(\\n    <span class="c-a">"http://localhost:3000/v1/disburse"</span>,\\n    headers={<span class="c-a">"Authorization"</span>: <span class="c-a">f"Bearer {AFRIPAY_KEY}"</span>},\\n    json={<span class="c-a">"phone"</span>: <span class="c-a">"+256771234567"</span>, <span class="c-a">"amount"</span>: <span class="c-b">15000</span>, <span class="c-a">"currency"</span>: <span class="c-a">"UGX"</span>, <span class="c-a">"reference"</span>: <span class="c-a">"PAYOUT-042"</span>}\\n)\`,
    php: \`// Same as /pay but POST to /v1/disburse\`
  },
  balance: {
    curl: \`<span class="c-g">curl</span> http://localhost:3000/v1/balance \\\\\\n  -H <span class="c-a">"Authorization: Bearer afp_live_your_key"</span>\`,
    node: \`<span class="c-g">const</span> res = <span class="c-g">await</span> fetch(<span class="c-a">'http://localhost:3000/v1/balance'</span>, {\\n  headers: { <span class="c-a">'Authorization'</span>: <span class="c-a">\\\`Bearer \\\${process.env.AFRIPAY_KEY}\\\`</span> }\\n});\\n<span class="c-g">const</span> { balances } = <span class="c-g">await</span> res.json();\\nconsole.log(<span class="c-a">\\\`M-Pesa: \\\${balances.mpesa.available} KES\\\`</span>);\`,
    python: \`response = requests.get(<span class="c-a">"http://localhost:3000/v1/balance"</span>,\\n    headers={<span class="c-a">"Authorization"</span>: <span class="c-a">f"Bearer {AFRIPAY_KEY}"</span>})\\nprint(response.json()[<span class="c-a">"balances"</span>])\`,
    php: \`// GET /v1/balance with Authorization header\`
  },
  webhooks: {
    curl: \`<span class="c-m"># Webhook endpoints are PUBLIC — no auth needed</span>\\n<span class="c-m"># Providers POST to these automatically</span>\\n\\nPOST /v1/webhooks/mpesa   <span class="c-m">← Safaricom Daraja</span>\\nPOST /v1/webhooks/mtn     <span class="c-m">← MTN MoMo</span>\\nPOST /v1/webhooks/airtel  <span class="c-m">← Airtel Money</span>\\nPOST /v1/webhooks/snipe   <span class="c-m">← Snipe</span>\`,
    node: \`app.post(<span class="c-a">'/your-callback'</span>, (req, res) => {\\n  <span class="c-g">const</span> { transaction_id, status, network } = req.body;\\n  <span class="c-g">if</span> (status === <span class="c-a">'completed'</span>) fulfillOrder(transaction_id);\\n  res.sendStatus(<span class="c-b">200</span>); <span class="c-m">// Always ACK</span>\\n});\`,
    python: \`@app.route(<span class="c-a">'/your-callback'</span>, methods=[<span class="c-a">'POST'</span>])\\ndef webhook():\\n    data = request.json\\n    <span class="c-g">if</span> data[<span class="c-a">'status'</span>] == <span class="c-a">'completed'</span>:\\n        fulfill_order(data[<span class="c-a">'transaction_id'</span>])\\n    <span class="c-g">return</span> <span class="c-a">''</span>, <span class="c-b">200</span>\`,
    php: \`// Verify signature then process\\n$payload = file_get_contents(<span class="c-a">'php://input'</span>);\\n$data = json_decode($payload, true);\\nif ($data[<span class="c-a">'status'</span>] === <span class="c-a">'completed'</span>) fulfillOrder($data[<span class="c-a">'transaction_id'</span>]);\\nhttp_response_code(200);\`
  },
  keys: {
    curl: \`<span class="c-g">curl</span> http://localhost:3000/v1/keys/me \\\\\\n  -H <span class="c-a">"Authorization: Bearer afp_live_your_key"</span>\\n\\n<span class="c-m"># Response</span>\\n<span class="c-b">{</span>\\n  <span class="c-g">"key"</span>: {\\n    <span class="c-g">"fingerprint"</span>: <span class="c-a">"...cdef1234"</span>,\\n    <span class="c-g">"tier"</span>:        <span class="c-a">"pro"</span>,\\n    <span class="c-g">"rate_limit"</span>:  <span class="c-a">"2000 requests / 15 min"</span>,\\n    <span class="c-g">"features"</span>:   [<span class="c-a">"pay"</span>, <span class="c-a">"status"</span>, <span class="c-a">"disburse"</span>, <span class="c-a">"balance"</span>]\\n  }\\n<span class="c-b">}</span>\`,
    node: \`<span class="c-g">const</span> res = <span class="c-g">await</span> fetch(<span class="c-a">'http://localhost:3000/v1/keys/me'</span>, {\\n  headers: { <span class="c-a">'Authorization'</span>: <span class="c-a">\\\`Bearer \\\${process.env.AFRIPAY_KEY}\\\`</span> }\\n});\\n<span class="c-g">const</span> { key } = <span class="c-g">await</span> res.json();\\nconsole.log(<span class="c-a">\\\`Plan: \\\${key.tier}, Rate limit: \\\${key.rate_limit}\\\`</span>);\`,
    python: \`\`, php: \`\`
  },
  health: {
    curl: \`<span class="c-m"># Public endpoint — no auth required</span>\\n<span class="c-g">curl</span> http://localhost:3000/health\\n\\n<span class="c-b">{</span>\\n  <span class="c-g">"status"</span>:    <span class="c-a">"ok"</span>,\\n  <span class="c-g">"version"</span>:   <span class="c-a">"1.0.0"</span>,\\n  <span class="c-g">"uptime_s"</span>:  <span class="c-b">3842</span>,\\n  <span class="c-g">"providers"</span>: <span class="c-b">{ "mpesa"</span>: <span class="c-a">"configured"</span>, <span class="c-a">"mtn_momo"</span>: <span class="c-a">"configured"</span> <span class="c-b">}</span>\\n<span class="c-b">}</span>\`,
    node: \`<span class="c-g">const</span> health = <span class="c-g">await</span> fetch(<span class="c-a">'http://localhost:3000/health'</span>).then(r => r.json());\\nconsole.log(health.status, health.uptime_s + <span class="c-a">'s uptime'</span>);\`,
    python: \`print(requests.get(<span class="c-a">"http://localhost:3000/health"</span>).json())\`,
    php: \`\`
  }
};

let currentLang = 'curl';
let currentEndpoint = 'pay';

function setExplorerCode(ep) {
  currentEndpoint = ep;
  renderCode();
}
function switchLang(lang, el) {
  currentLang = lang;
  document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderCode();
}
function renderCode() {
  const code = CODES[currentEndpoint]?.[currentLang] || '<span class="c-m">// No example for this combination</span>';
  document.getElementById('code-content').innerHTML = code;
}
function copyCode() {
  const text = document.getElementById('code-content').innerText;
  navigator.clipboard?.writeText(text);
  showToast('Code copied!', 'success');
}
function copyElem(id) {
  const text = document.getElementById(id).innerText;
  navigator.clipboard?.writeText(text);
  showToast('Copied!', 'success');
}

// ── TRY IT ────────────────────────────────────────────────────────────────────
async function tryRequest() {
  const phone  = document.getElementById('try-phone').value;
  const amount = document.getElementById('try-amount').value;
  const cur    = document.getElementById('try-currency').value;
  const ref    = document.getElementById('try-ref').value;
  const panel  = document.getElementById('try-response');

  panel.style.color = 'var(--muted)';
  panel.textContent = 'Sending request…';

  await new Promise(r => setTimeout(r, 800));

  const nets = { '254': 'mpesa', '256': 'mtn_momo', '233': 'mtn_momo', '255': 'mpesa', '234': 'airtel', '250': 'mtn_momo', '260': 'mtn_momo' };
  const digits = phone.replace(/\\D/g,'');
  const cc = Object.keys(nets).find(k => digits.startsWith(k)) || '254';
  const network = nets[cc];
  const txId = 'afp_' + Math.random().toString(36).slice(2, 20);

  const isFail = phone.includes('731');
  if (isFail) {
    panel.style.color = 'var(--red)';
    panel.textContent = JSON.stringify({ success: false, error: 'INSUFFICIENT_FUNDS', message: 'The customer has insufficient funds in their mobile wallet.', request_id: 'req_' + Math.random().toString(36).slice(2,16) }, null, 2);
    return;
  }

  const resp = {
    success: true, transaction_id: txId, provider_ref: 'ws_CO_' + Date.now(),
    status: 'pending', network, phone: digits, amount: parseFloat(amount),
    currency: cur.toUpperCase(), message: 'Customer will receive a prompt on their phone.',
    check_status: \`GET /v1/status/\${txId}\`
  };
  panel.style.color = 'var(--green)';
  panel.textContent = JSON.stringify(resp, null, 2);
  addFakeLog('POST', '/v1/pay', 202);
}

function fillPhone(phone) {
  document.getElementById('try-phone').value = phone;
  showPage('tryit');
}

// ── LOGS ──────────────────────────────────────────────────────────────────────
const FAKE_LOGS = [
  { m:'POST', p:'/v1/pay',      s:202, t:'09:28:14', lat:'341ms' },
  { m:'GET',  p:'/v1/status/afp_a3f9', s:200, t:'09:27:52', lat:'89ms' },
  { m:'POST', p:'/v1/pay',      s:202, t:'09:27:41', lat:'312ms' },
  { m:'GET',  p:'/v1/balance',  s:200, t:'09:27:30', lat:'201ms' },
  { m:'POST', p:'/v1/disburse', s:202, t:'09:26:58', lat:'288ms' },
  { m:'POST', p:'/v1/pay',      s:400, t:'09:26:33', lat:'44ms'  },
  { m:'GET',  p:'/health',      s:200, t:'09:26:12', lat:'12ms'  },
  { m:'GET',  p:'/v1/keys/me',  s:200, t:'09:25:55', lat:'67ms'  },
];

function renderLogs() {
  const list = document.getElementById('log-list');
  if (!list) return;
  list.innerHTML = FAKE_LOGS.map(l => {
    const sc = l.s >= 500 ? 'status-5xx' : l.s >= 400 ? 'status-4xx' : 'status-200';
    const mc = l.m === 'POST' ? 'm-post' : 'm-get';
    return \`<div class="log-row">
      <span class="log-method method \${mc}">\${l.m}</span>
      <span class="log-path">\${l.p}</span>
      <span class="log-status \${sc}">\${l.s}</span>
      <span class="log-time">\${l.lat}</span>
      <span class="log-time">\${l.t}</span>
    </div>\`;
  }).join('');
}

function addFakeLog(m, p, s) {
  const now = new Date();
  const t = \`\${String(now.getHours()).padStart(2,'0')}:\${String(now.getMinutes()).padStart(2,'0')}:\${String(now.getSeconds()).padStart(2,'0')}\`;
  FAKE_LOGS.unshift({ m, p, s, t, lat: Math.floor(250+Math.random()*200)+'ms' });
  if (FAKE_LOGS.length > 50) FAKE_LOGS.pop();
  renderLogs();
}

// ── RECENT TRANSACTIONS ───────────────────────────────────────────────────────
function renderRecentTxns() {
  const txns = [
    { id:'afp_a3f9b2c1', net:'mpesa',    phone:'+254712345678', amt:'KES 500',    status:'completed', time:'2m ago' },
    { id:'afp_b8e2c4f1', net:'mtn_momo', phone:'+256771234567', amt:'UGX 15,000', status:'pending',   time:'5m ago' },
    { id:'afp_c1d3e5f7', net:'airtel',   phone:'+233241234567', amt:'GHS 50',     status:'completed', time:'11m ago' },
    { id:'afp_d9f0b2e4', net:'mpesa',    phone:'+254712345679', amt:'KES 2,000',  status:'failed',    time:'18m ago' },
  ];
  const colors = { completed:'var(--green)', pending:'var(--amber)', failed:'var(--red)' };
  const el = document.getElementById('recent-txns');
  if (!el) return;
  el.innerHTML = txns.map(t => \`
    <div class="log-row" style="margin-bottom:4px;">
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted2);flex-shrink:0;">\${t.id}</span>
      <span style="font-size:11px;background:var(--card2);padding:2px 7px;border-radius:4px;font-family:var(--mono);font-size:10px;color:var(--muted2);flex-shrink:0;">\${t.net}</span>
      <span class="log-path" style="font-family:var(--mono);font-size:12px;">\${t.phone}</span>
      <span style="font-family:var(--mono);font-size:12px;color:var(--text);flex-shrink:0;">\${t.amt}</span>
      <span style="font-size:10px;font-family:var(--mono);font-weight:700;color:\${colors[t.status]};flex-shrink:0;">\${t.status.toUpperCase()}</span>
      <span class="log-time">\${t.time}</span>
    </div>\`).join('');
}

// ── STRIPE BILLING ─────────────────────────────────────────────────────────────
function openSubscribeModal(planId, price) {
  const priceId = STRIPE_CONFIG.prices?.[planId];
  pendingPlan = { id: planId, price, stripePriceId: priceId };

  document.getElementById('modal-plan-preview').innerHTML = \`
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-family:var(--mono);font-size:13px;font-weight:700;text-transform:capitalize;">\${planId} Plan</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">Billed monthly · Cancel anytime</div>
      </div>
      <div style="font-family:var(--mono);font-size:20px;font-weight:700;">\${price}</div>
    </div>\`;

  document.getElementById('subscribe-modal').classList.add('open');
  document.getElementById('stripe-errors').textContent = '';

  // ── Not configured — show setup instructions ────────────────────────────
  if (!STRIPE_CONFIG.configured || !STRIPE_CONFIG.publishable_key) {
    document.getElementById('stripe-card-element').innerHTML = \`
      <div style="background:var(--amber-dim);border:1px solid rgba(245,166,35,.25);border-radius:8px;padding:14px;font-size:12px;">
        <div style="font-family:var(--mono);font-weight:700;color:var(--amber);margin-bottom:10px;">⚙️ Stripe Setup Required</div>
        <div style="color:var(--muted2);line-height:1.8;">
          Add these to your <span style="font-family:var(--mono);color:var(--green);">.env</span> file and restart the server:<br><br>
          <div style="font-family:var(--mono);font-size:11px;background:var(--surface);border-radius:6px;padding:10px;line-height:2;">
            <span style="color:var(--green);">STRIPE_PUBLISHABLE_KEY</span>=pk_live_...<br>
            <span style="color:var(--green);">STRIPE_SECRET_KEY</span>=sk_live_...<br>
            <span style="color:var(--green);">STRIPE_PRICE_STARTER</span>=price_1ABC...<br>
            <span style="color:var(--green);">STRIPE_PRICE_PRO</span>=price_1DEF...<br>
            <span style="color:var(--green);">STRIPE_PRICE_ULTRA</span>=price_1GHI...<br>
          </div>
          <div style="margin-top:10px;font-size:11px;">
            Get your keys at <a href="https://dashboard.stripe.com/apikeys" target="_blank" style="color:var(--blue);">dashboard.stripe.com/apikeys</a><br>
            Create products at <a href="https://dashboard.stripe.com/products" target="_blank" style="color:var(--blue);">dashboard.stripe.com/products</a>
          </div>
        </div>
      </div>\`;
    document.getElementById('pay-btn').style.display = 'none';
    document.querySelector('.stripe-secure').style.display = 'none';
    return;
  }

  // ── Stripe configured — mount card element ──────────────────────────────
  document.getElementById('pay-btn').style.display = '';
  document.querySelector('.stripe-secure').style.display = '';
  initStripe();

  if (stripe) {
    const elements = stripe.elements();
    cardElement = elements.create('card', {
      style: {
        base: { color: '#dde4ea', fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', '::placeholder': { color: '#5a6a78' } },
        invalid: { color: '#ff5a5a' }
      }
    });
    // Clear previous mount
    document.getElementById('stripe-card-element').innerHTML = '';
    setTimeout(() => {
      cardElement.mount('#stripe-card-element');
      cardElement.on('change', e => {
        document.getElementById('stripe-errors').textContent = e.error ? e.error.message : '';
      });
    }, 100);
  }
}

async function submitSubscription() {
  const btn = document.getElementById('pay-btn');
  const txt = document.getElementById('pay-btn-text');
  const errEl = document.getElementById('stripe-errors');

  btn.disabled = true;
  txt.textContent = 'Processing…';

  if (!stripe || !cardElement) {
    // Demo mode — simulate success
    await new Promise(r => setTimeout(r, 1200));
    closeModal();
    showToast(\`Upgraded to \${pendingPlan.id} plan successfully!\`, 'success');
    updatePlanUI(pendingPlan.id);
    btn.disabled = false;
    txt.textContent = 'Subscribe & Pay';
    return;
  }

  try {
    const { paymentMethod, error } = await stripe.createPaymentMethod({
      type: 'card',
      card: cardElement,
    });

    if (error) {
      errEl.textContent = error.message;
      btn.disabled = false;
      txt.textContent = 'Subscribe & Pay';
      return;
    }

    // Send to your backend: POST /v1/billing/subscribe
    const res = await fetch('/v1/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${DEMO_KEY}\` },
      body: JSON.stringify({ payment_method_id: paymentMethod.id, price_id: pendingPlan.stripePriceId, plan: pendingPlan.id })
    });

    const data = await res.json();

    if (data.success) {
      closeModal();
      showToast(\`Upgraded to \${pendingPlan.id} plan!\`, 'success');
      updatePlanUI(pendingPlan.id);
    } else {
      errEl.textContent = data.message || 'Payment failed. Please try again.';
    }
  } catch(e) {
    errEl.textContent = 'Network error. Please try again.';
  }

  btn.disabled = false;
  txt.textContent = 'Subscribe & Pay';
}

function updatePlanUI(planId) {
  currentPlan = { id: planId };
  const el = document.getElementById('sidebar-plan');
  if (el) { el.textContent = planId.toUpperCase(); el.className = 'plan-tier ' + planId; }
}

function openUpdateCard() {
  openSubscribeModal(currentPlan.id, 'Update card', '');
}

function closeModal() {
  document.getElementById('subscribe-modal').classList.remove('open');
  if (cardElement) { try { cardElement.unmount(); } catch(e){} cardElement = null; }
}
document.getElementById('subscribe-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ── DOCS NAV ──────────────────────────────────────────────────────────────────
function scrollToDoc(id) {
  const el = document.getElementById(id);
  if (el) { el.scrollIntoView({ behavior:'smooth', block:'start' }); }
  document.querySelectorAll('.docs-nav-item').forEach(n => n.classList.remove('active'));
  event.target.classList.add('active');
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const i = document.getElementById('toast-icon');
  const m = document.getElementById('toast-msg');
  i.textContent = type === 'success' ? '✓' : '✕';
  m.textContent = msg;
  t.className = \`toast show \${type}\`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── ANIMATIONS ────────────────────────────────────────────────────────────────
function animateCount(el, target, suffix='') {
  let cur = 0; const step = Math.ceil(target/40);
  const t = setInterval(() => {
    cur = Math.min(cur+step, target);
    el.textContent = cur.toLocaleString() + suffix;
    if (cur >= target) clearInterval(t);
  }, 25);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadStripeConfig();
  renderCode();
  renderLogs();
  renderRecentTxns();

  const reqEl = document.getElementById('req-today');
  if (reqEl) animateCount(reqEl, 4231);

  setInterval(() => {
    const el = document.getElementById('latency');
    if (el) el.textContent = 280 + Math.floor(Math.random()*120);
  }, 3000);

  // Usage bar
  const fill = document.getElementById('usage-fill');
  if (fill) setTimeout(() => fill.style.width = '8.5%', 300);
});
</script>
</body>
</html>
`;

function serveDashboard(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
}

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestId);
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ─── Public Routes ────────────────────────────────────────────────────────────
app.get('/', serveDashboard);
app.use('/health',             healthRoutes);
app.use('/v1/webhooks',        webhookRoutes);
app.use('/v1/billing/webhook', billingRoutes);
app.use('/v1/billing/config',  billingRoutes);

// ─── Authenticated Routes ─────────────────────────────────────────────────────
app.use('/v1', authenticate, rateLimiter);
app.use('/v1/pay',      payRoutes);
app.use('/v1/status',   statusRoutes);
app.use('/v1/disburse', disburseRoutes);
app.use('/v1/balance',  balanceRoutes);
app.use('/v1/keys',     keysRoutes);
app.use('/v1/billing',  billingRoutes);

// ─── Catch-all → dashboard ────────────────────────────────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/v1') || req.path.startsWith('/health')) return next();
  serveDashboard(req, res);
});

// ─── 404 & Error Handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` });
});
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`AfriPay API  →  http://localhost:${PORT}`);
  logger.info(`Dashboard    →  http://localhost:${PORT}`);
  logger.info(`Health       →  http://localhost:${PORT}/health`);
  logger.info('Dashboard: serving embedded HTML (no filesystem dependency)');
});

module.exports = app;
