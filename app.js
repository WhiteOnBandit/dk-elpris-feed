const FILES = ["health.json", "backfill.json", "accuracy.json", "status.json", "forecasts/latest.json"];

const state = { zone: "DK1", latest: null };

async function loadJson(name) {
  const response = await fetch(`${name}?t=${Date.now()}`);
  if (!response.ok) throw new Error(`${name} svarede ${response.status}`);
  return response.json();
}

function text(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showBanner(message) {
  const node = document.getElementById("banner");
  node.hidden = false;
  node.textContent = message;
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  return Number(value).toLocaleString("da-DK", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function localStamp(iso) {
  if (!iso) return "ukendt tid";
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function stat(label, value) {
  return `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
}

function renderStats(health, backfill, latest) {
  const published = health && health.published ? "ude" : "mangler";
  const backfillText = backfill ? `${backfill.complete_days} / ${backfill.goal_days}` : "–";
  const version = latest && latest.model_version ? latest.model_version : "–";
  document.getElementById("stats").innerHTML = [
    stat("Forecast", published),
    stat("ECMWF-dage", backfillText),
    stat("DMI-dage", health && health.dmi_days != null ? String(health.dmi_days) : "–"),
    stat("Model", version),
  ].join("");
}

function renderJobs(status) {
  const jobs = (status && status.jobs) || {};
  const names = ["forecast", "dmi-snapshot", "ecmwf-backfill", "train"];
  document.getElementById("jobs").innerHTML = names.map((name) => {
    const job = jobs[name];
    if (!job) return `<article class="job"><b>${name}</b><span>Ingen kørsel i status.json</span></article>`;
    const tone = job.conclusion === "success" ? "ok" : job.late ? "warn" : "bad";
    const when = localStamp(job.started_at);
    const late = job.late ? " · for sen" : "";
    return `<article class="job"><b class="${tone}">${job.conclusion || job.status}</b><span>${name} · ${when}${late}</span></article>`;
  }).join("");
  if (status && status.drift_issue_open) {
    const list = document.getElementById("warnings");
    const item = document.createElement("li");
    item.textContent = "Der er et åbent drift-issue.";
    list.prepend(item);
  }
}

function renderWarnings(health) {
  const list = document.getElementById("warnings");
  const notes = [];
  if (!health) {
    notes.push("health.json kunne ikke læses.");
  } else {
    if (health.schedule_late) notes.push("Seneste planlagte forecast startede kl. 15 eller senere.");
    if (health.training_warning) notes.push(health.training_warning);
    if (health.snapshot_warning) notes.push(health.snapshot_warning);
    if (health.coverage_note) notes.push(health.coverage_note);
  }
  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = note;
    list.append(item);
  }
}

function renderCoverage(backfill, health) {
  const root = document.getElementById("coverage");
  const cards = [];
  if (backfill) {
    const pct = Math.max(0, Math.min(100, (100 * backfill.complete_days) / backfill.goal_days));
    cards.push(`<article class="bar-card"><b>ECMWF-backfill</b><span>${backfill.complete_days} af ${backfill.goal_days}. ${backfill.missing_count} mangler.</span><div class="track"><span style="width:${pct}%"></span></div></article>`);
  }
  if (health) {
    cards.push(`<article class="bar-card"><b>DMI</b><span>${health.dmi_days == null ? "–" : health.dmi_days} dage i cachen. DMI indgår ikke i forecastet.</span></article>`);
    cards.push(`<article class="bar-card"><b>Energinet vind og sol</b><span>${health.energinet_days == null ? "–" : health.energinet_days} dage. Et hul stopper ikke forecastet.</span></article>`);
  }
  root.innerHTML = cards.join("") || "<p class='muted'>Ingen dækningsfiler.</p>";
}

function renderAccuracy(accuracy) {
  text("accuracy-note", accuracy && accuracy.note ? accuracy.note : "accuracy.json er der ikke endnu. Den skrives, næste gang forecasten kører.");
  const root = document.getElementById("accuracy");
  const rolling = accuracy && accuracy.rolling && accuracy.rolling["30"];
  const methods = rolling && rolling.methods;
  if (!methods) {
    root.innerHTML = "";
    return;
  }
  const rows = [
    ["lightgbm", "LightGBM"],
    ["same_hour_yesterday", "Samme time i går"],
    ["same_hour_last_week", "Samme time sidste uge"],
  ];
  const body = rows.map(([key, label]) => {
    const method = methods[key];
    if (!method) return `<tr><td>${label}</td><td colspan="3">–</td></tr>`;
    const day2 = method.mae_by_horizon_day ? method.mae_by_horizon_day[1] : null;
    const day7 = method.mae_by_horizon_day ? method.mae_by_horizon_day[6] : null;
    return `<tr><td>${label}</td><td>${fmt(method.mae)}</td><td>${fmt(day2)}</td><td>${fmt(day7)}</td></tr>`;
  }).join("");
  root.innerHTML = `<table><thead><tr><th>30 udgivelser</th><th>MAE</th><th>Dag 2</th><th>Dag 7</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderModel(latest, health) {
  if (!latest) {
    text("model", "forecasts/latest.json kunne ikke læses.");
    return;
  }
  const source = health && health.model_source ? health.model_source : "ukendt kilde";
  const backtest = latest.backtest || {};
  const mae = backtest.mae_by_horizon_day || [];
  text(
    "model",
    `${latest.model_version || "uden version"} · ${source}. Backtesten i filen har MAE ${fmt(mae[1])} på dag 2 og ${fmt(mae[6])} på dag 7.`,
  );
}

function series(zone) {
  const payload = state.latest && state.latest.zones && state.latest.zones[zone];
  return payload ? payload.forecast || [] : [];
}

function renderChart() {
  const points = series(state.zone);
  const root = document.getElementById("chart");
  if (!points.length) {
    root.innerHTML = "<p class='muted'>Intet forecast at tegne.</p>";
    return;
  }
  const width = 920;
  const height = 280;
  const pad = 28;
  const lows = points.map((point) => point.p10_eur_mwh);
  const highs = points.map((point) => point.p90_eur_mwh);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(1, max - min);
  const x = (index) => pad + (index * (width - pad * 2)) / Math.max(1, points.length - 1);
  const y = (value) => pad + ((max - value) * (height - pad * 2)) / span;
  const band = points.map((point, index) => `${x(index)},${y(point.p10_eur_mwh)}`).concat(
    points.map((point, index) => `${x(index)},${y(point.p90_eur_mwh)}`).reverse(),
  );
  const line = points.map((point, index) => `${x(index)},${y(point.p50_eur_mwh)}`).join(" ");
  const known = points
    .map((point, index) => (point.is_known ? index : -1))
    .filter((index) => index >= 0);
  const knownLine = known.length
    ? known.map((index) => `${x(index)},${y(points[index].p50_eur_mwh)}`).join(" ")
    : "";
  const labels = [0, 24, 48, 72, 96, 120, 144, points.length - 1]
    .filter((index, position, all) => all.indexOf(index) === position && index < points.length)
    .map((index) => {
      const stamp = new Date(points[index].time);
      const label = new Intl.DateTimeFormat("da-DK", {
        timeZone: "Europe/Copenhagen",
        day: "numeric",
        month: "numeric",
        hour: "2-digit",
      }).format(stamp);
      return `<text x="${x(index)}" y="${height - 6}">${label}</text>`;
    })
    .join("");
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Forecast for ${state.zone}">
    <polygon points="${band.join(" ")}" fill="#d7efe6"></polygon>
    <polyline points="${line}" fill="none" stroke="#0f6e56" stroke-width="2"></polyline>
    ${knownLine ? `<polyline points="${knownLine}" fill="none" stroke="#1c1915" stroke-width="2.5"></polyline>` : ""}
    ${labels}
  </svg>`;
}

function bindZones() {
  document.getElementById("zones").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.zone = button.dataset.zone;
    for (const node of document.querySelectorAll("#zones button")) {
      node.classList.toggle("is-on", node === button);
    }
    renderChart();
  });
}

async function main() {
  bindZones();
  const loaded = {};
  const errors = [];
  await Promise.all(FILES.map(async (name) => {
    try {
      loaded[name] = await loadJson(name);
    } catch (error) {
      errors.push(error.message);
    }
  }));
  const health = loaded["health.json"];
  const latest = loaded["forecasts/latest.json"];
  state.latest = latest || null;
  if (health && health.generated_at) text("generated", `Health ${localStamp(health.generated_at)}`);
  else text("generated", "Health kunne ikke læses");
  if (errors.length) showBanner(errors.join(" "));
  renderStats(health, loaded["backfill.json"], latest);
  renderJobs(loaded["status.json"]);
  renderWarnings(health);
  renderCoverage(loaded["backfill.json"], health);
  renderAccuracy(loaded["accuracy.json"]);
  renderModel(latest, health);
  renderChart();
}

main();
