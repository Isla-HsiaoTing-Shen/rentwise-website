// =============================================================================
// check.js – the home page (index.html): check my rent + nearby areas that fit
// Needs common.js (loaded first): data, search list, map helpers, settings.
//
// One "Weekly rent" number is used two ways:
//   1. the result card: is this rent lower than usual / about usual / higher?
//   2. nearby areas: where does this amount fit as a budget?
//
// Nearby area rules:
//   - same dwelling type + bedrooms, 30+ leases (meets_min_sample = 'Yes')
//   - "Good chance": middle rent <= budget   (typical rent here fits)
//   - "Possible":    usual range low end <= budget < middle rent (only cheaper places fit)
//   - not shown:     budget < usual range low end
//   - straight-line distance from your area: 5 km (default) or 10 km
//   - Good chance first, then Possible; nearest first in each
// =============================================================================


// ===== 1. Settings for this page =====
const LIST_STEP = 5;         // the list shows 5 areas, then "Show 5 more"
const DISTANCES = [5, 10];   // the distance buttons (same numbers as in index.html)

// map colours: light green = Good chance, light yellow (dashed) = Possible, orange = your area
// colour = the light fill, border/dot = a darker shade so the area is easy to see
const LEVEL_STYLE = {
  good:     { colour: "#4ade80", fill: 0.25, dot: "#16a34a", extra: { color: "#16a34a" } },
  possible: { colour: "#fde047", fill: 0.35, dot: "#ca8a04", extra: { color: "#ca8a04", dashArray: "6 4" } }
};

// what the listing websites call each dwelling type
const REA_TYPE    = { "Flat / Unit": "unit+apartment", "House": "house", "Terrace / Townhouse / Semi-detached": "townhouse" };
const DOMAIN_TYPE = { "Flat / Unit": "apartment-unit-flat", "House": "house", "Terrace / Townhouse / Semi-detached": "town-house" };


// ===== 2. Find the elements on the page =====
const form           = document.getElementById("search-form");
const dwellingSelect = document.getElementById("dwelling-select");
const bedroomSelect  = document.getElementById("bedroom-select");
const rentInput      = document.getElementById("rent-input");
const checkButton    = document.getElementById("check-button");
const resultBox      = document.getElementById("result");
const mapNote        = document.getElementById("map-note");

const nearbyBox      = document.getElementById("nearby");
const countTitle     = document.getElementById("find-count");
const messageBox     = document.getElementById("find-message");
const listBox        = document.getElementById("find-list");
const showMoreButton = document.getElementById("show-more");

let spread = [];           // rent_spread.json: leases per $50 of rent, latest 12 months (30+ leases)
let spreadChart = null;    // the Chart.js bar chart

let maxKm = 5;             // chosen distance (5 km when the page opens)
let lastSearch = null;     // { place, dwelling, bedrooms, rent, row } so the distance buttons can redo it
let lastResults = [];      // every nearby area that fits, in list order
let listLimit = LIST_STEP; // how many of them the list is showing
let shownLayers = {};      // postcode -> { area, dot } on the map, to highlight from the list



// ===== 3. Result card =====

// show the result card with a colour type
function showResult(type, html) {
  resultBox.className = "result-card " + type;
  resultBox.innerHTML = html;
  resultBox.hidden = false;
}


// ===== 4. Nearby areas that fit the rent (as a budget) =====

// "good" / "possible" / null (too expensive)
function affordability(row, budget) {
  if (Number(row.median_rent) <= budget) return "good";
  if (Number(row.p25_rent)    <= budget) return "possible";
  return null;
}

// every reliable area with the same dwelling + bedrooms, with its distance from "home"
// like SQL: WHERE dwelling_type = ... AND bedroom_group = ... AND meets_min_sample = 'Yes'
function reliableAreas(home, dwelling, bedrooms) {
  return benchmark
    .filter(r =>
      r.dwelling_type === dwelling &&
      r.bedroom_group === bedrooms &&
      r.meets_min_sample === "Yes"
    )
    .map(r => {
      const c = getCoords(r.postcode);
      return c ? { row: r, coords: c, km: distanceKm(home.lat, home.lng, c.lat, c.lng) } : null;
    })
    .filter(item => item !== null);
}

// OTHER areas within the distance that fit: Good chance first, then Possible, nearest first
function findAreas(code, home, dwelling, bedrooms, budget) {
  const all = reliableAreas(home, dwelling, bedrooms);

  const fits = all
    .filter(a => a.km <= maxKm && a.row.postcode !== code)
    .map(a => ({ ...a, level: affordability(a.row, budget) }))
    .filter(a => a.level !== null);

  // like SQL: ORDER BY level, km
  fits.sort((a, b) => {
    if (a.level !== b.level) return a.level === "good" ? -1 : 1;
    return a.km - b.km;
  });

  return { results: fits, all };
}

// nothing fits: work out what the user could change
function suggestionText(all, budget) {
  const tips = [];

  // a bigger distance that has results
  for (const km of DISTANCES) {
    if (km <= maxKm) continue;
    if (all.some(a => a.km <= km && affordability(a.row, budget))) {
      tips.push(`<button type="button" class="link-button" data-km="${km}">${km} km</button>`);
      break;
    }
  }

  // the budget needed for at least one area at this distance ("Possible" = usual range low end)
  const near = all.filter(a => a.km <= maxKm && a.row.postcode !== lastSearch.place.postcode);
  if (near.length) {
    const lowest = Math.min(...near.map(a => Number(a.row.p25_rent)));
    tips.push(`a budget of ${formatMoney(lowest)}`);
  }

  return tips.length ? `Try ${tips.join(", or ")}.` : "Try another dwelling type or number of bedrooms.";
}

// realestate.com.au: .../rent/property-house-with-3-bedrooms-between-0-700-in-2160/list-1
// (studio cannot be filtered there, so it only filters type and price)
function reaLink(code, dwelling, bedrooms, budget) {
  const bed = bedrooms === "Studio" ? "" : `-with-${parseInt(bedrooms)}-bedrooms`;
  return `https://www.realestate.com.au/rent/property-${REA_TYPE[dwelling]}${bed}-between-0-${budget}-in-${code}/list-1`;
}

// Domain: .../rent/?postcode=2160&ptype=house&bedrooms=3&price=0-700
function domainLink(code, dwelling, bedrooms, budget) {
  const bed = bedrooms === "Studio" ? "0" : bedrooms === "4+" ? "4-any" : bedrooms;
  return `https://www.domain.com.au/rent/?postcode=${code}&ptype=${DOMAIN_TYPE[dwelling]}&bedrooms=${bed}&price=0-${budget}`;
}

function badgeHtml(level) {
  if (level === "good")     return `<span class="badge good">Good chance</span>`;
  if (level === "possible") return `<span class="badge possible">Possible</span>`;
  return `<span class="badge over">Above budget</span>`;
}

function rentalLinks(code, dwelling, bedrooms, budget) {
  return `
    <div class="area-result-links">
      Search rentals:
      <a href="${reaLink(code, dwelling, bedrooms, budget)}" target="_blank" rel="noopener">Realestate ↗</a> ·
      <a href="${domainLink(code, dwelling, bedrooms, budget)}" target="_blank" rel="noopener">Domain ↗</a>
    </div>
  `;
}

function resultCard(a, index, dwelling, bedrooms, budget) {
  const code = a.row.postcode;
  const subs = suburbsOf(code).join(", ");   // ALL suburbs (wraps onto more lines if long)

  return `
    <li class="area-result" data-postcode="${code}">
      <div class="area-result-top">
        <span class="area-result-code">${index + 1}. ${code}</span>
        ${badgeHtml(a.level)}
      </div>
      ${subs ? `<div class="area-result-name">${subs}</div>` : ""}
      <div class="area-result-numbers">
        Middle rent <strong>${formatMoney(a.row.median_rent)}</strong>
        · Usual range ${formatMoney(a.row.p25_rent)} – ${formatMoney(a.row.p75_rent)}
      </div>
      ${rentalLinks(code, dwelling, bedrooms, budget)}
    </li>
  `;
}

// the list shows the first "listLimit" areas, plus a "Show 5 more" button if there are more
function showList() {
  const { dwelling, bedrooms, rent } = lastSearch;
  const shown = lastResults.slice(0, listLimit);
  listBox.innerHTML = shown.map((a, i) => resultCard(a, i, dwelling, bedrooms, rent)).join("");

  // click a card (not a link) = show that area on the map (your area stays the same)
  listBox.querySelectorAll(".area-result").forEach(li => {
    li.addEventListener("click", event => {
      if (event.target.closest("a")) return;
      highlight(li.dataset.postcode, true);
    });
  });

  const left = lastResults.length - shown.length;
  showMoreButton.hidden = left <= 0;
  showMoreButton.textContent = `Show ${Math.min(LIST_STEP, left)} more`;
}

// work out the nearby areas, then show the list and the map
function showNearby() {
  const { place, dwelling, bedrooms, rent, row } = lastSearch;

  messageBox.hidden = true;
  showMoreButton.hidden = true;
  listBox.innerHTML = "";
  listLimit = LIST_STEP;

  const home = placeCoords(place);
  if (!home) {
    nearbyBox.hidden = true;
    lastResults = [];
    showOnMap(place, row, null);
    return;
  }

  const { results, all } = findAreas(place.postcode, home, dwelling, bedrooms, rent);
  lastResults = results;
  nearbyBox.hidden = false;

  if (results.length === 0) {
    countTitle.textContent = `No other areas within ${maxKm} km fit ${formatMoney(rent)} a week`;
    messageBox.className = "find-message none";
    messageBox.innerHTML = `<p>${suggestionText(all, rent)}</p>`;
    messageBox.hidden = false;
  } else {
    countTitle.textContent = `${results.length} other area${results.length > 1 ? "s" : ""} within ${maxKm} km ` +
                             `may fit ${formatMoney(rent)} a week`;
    showList();
  }

  showOnMap(place, row, home);
}


// ===== 5. Map: your area + nearby areas that fit =====
// Clicking a nearby area does NOT change "Where": you still want to live near your area,
// you are just looking. Map click -> the card in the list. Card click -> the area on the map.

// make one nearby area stand out in the list (and on the map if moveMap)
function highlight(code, moveMap) {
  listBox.querySelectorAll(".area-result").forEach(li =>
    li.classList.toggle("selected", li.dataset.postcode === code));

  const shown = shownLayers[code];
  if (moveMap && shown) {
    if (shown.area) map.fitBounds(shown.area.getBounds(), { padding: [60, 60], maxZoom: 14 });
    if (shown.dot) shown.dot.openPopup();
  }
}

// clicked a nearby area on the map: show its card (open more of the list if needed)
function showInList(code) {
  const index = lastResults.findIndex(a => a.row.postcode === code);
  if (index >= listLimit) {
    const { place, row } = lastSearch;
    listLimit = Math.ceil((index + 1) / LIST_STEP) * LIST_STEP;
    showList();
    showOnMap(place, row, placeCoords(place), false);
  }
  highlight(code, false);
  const li = listBox.querySelector(`.area-result[data-postcode="${code}"]`);
  if (li) li.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// every nearby area that fits is shaded green / yellow; the areas in the list also get a price dot
// refit = true: zoom the map to show all of them (not when "Show more" is pressed)
function showOnMap(place, row, home, refit = true) {
  resultLayer.clearLayers();
  shownLayers = {};
  mapNote.hidden = true;

  if (!home) {
    map.fitBounds(NSW_BOUNDS);
    mapNote.textContent = "This postcode cannot be shown on the map.";
    mapNote.hidden = false;
    return;
  }

  // 1. areas first, so the dots sit on top of them
  for (const a of lastResults) {
    const s = LEVEL_STYLE[a.level];
    const info = popupHtml(`Postcode ${a.row.postcode}`, a.row, `${a.km.toFixed(1)} km away`);
    const area = drawArea(a.row.postcode, s.colour, s.fill, info, () => showInList(a.row.postcode), s.extra);
    shownLayers[a.row.postcode] = { area };
  }
  const homeInfo = row
    ? popupHtml(`Your area: ${placeLabel(place)}`, row)
    : `<strong>${placeLabel(place)}</strong><br>No data for this combination`;
  const homeArea = drawArea(place.postcode, ORANGE, 0.2, homeInfo);

  // 2. price dots for the areas in the list
  for (const a of lastResults.slice(0, listLimit)) {
    const dot = drawPriceDot(a.coords, LEVEL_STYLE[a.level].dot, 8, formatMoney(a.row.median_rent), "price-label");
    dot.on("click", () => showInList(a.row.postcode));
    showInfoOnHover(dot, popupHtml(`Postcode ${a.row.postcode}`, a.row, `${a.km.toFixed(1)} km away`));
    shownLayers[a.row.postcode].dot = dot;
  }

  // 3. orange dot: your area (added last so it sits on top)
  const homeDot = drawPriceDot(home, ORANGE, 11, row ? formatMoney(row.median_rent) : null, "price-label home");
  showInfoOnHover(homeDot, homeInfo);

  // 4. zoom so your whole postcode + every nearby area that fits can be seen
  if (refit) {
    const bounds = L.latLngBounds([[home.lat, home.lng]]);
    if (homeArea) bounds.extend(homeArea.getBounds());
    for (const a of lastResults) bounds.extend([a.coords.lat, a.coords.lng]);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }
}

// "Show 5 more": longer list + price dots for the new areas (the map does not move)
function showMore() {
  const { place, row } = lastSearch;
  listLimit += LIST_STEP;
  showList();
  showOnMap(place, row, placeCoords(place), false);
}


// ===== 6. "Rents in the last 12 months" chart =====
// A bar for each price band: how many new leases in the latest 12 months were in it.
// Darker bars = the usual range (P25–P75). Orange line = the rent you entered.
// Only the 5th–95th percentile is drawn (same as "Lowest · Highest" on the card),
// so a few extreme leases do not squash the chart.

// rent_spread.json is an EXTRA: if this file fails, the rent check and map still work
async function loadSpread() {
  try {
    const res = await fetch("data/rent_spread.json");
    if (!res.ok) throw new Error("Could not load rent_spread.json");
    spread = await res.json();
    console.log("Loaded", spread.length, "rent spread rows");
  } catch (error) {
    console.warn("Rent spread not loaded – the chart will be hidden.", error);
  }
}

// $50 bands for a narrow range, wider bands when the range is wide (so about 20 bars at most)
function bandWidth(lo, hi) {
  const base = meta ? meta.bin_width : 50;
  if (hi - lo <= 20 * base) return base;        // e.g. $450 – $750: $50 bands
  if (hi - lo <= 40 * base) return base * 2;    // $100 bands
  return base * 4;                              // $200 bands
}

// draws the orange "You: $720" line on top of the bars
const yourRentLine = {
  id: "yourRentLine",
  afterDatasetsDraw(chart, args, opts) {
    if (opts.rent == null) return;
    const { ctx, chartArea, scales: { x } } = chart;
    const step  = x.getPixelForValue(1) - x.getPixelForValue(0) || chartArea.width;
    const left  = x.getPixelForValue(0) - step / 2;                 // left edge of the first bar
    const right = left + step * opts.bars;
    let pos = left + (opts.rent - opts.lo) / opts.width * step;
    let label = `You: ${formatMoney(opts.rent)}`;
    if (pos < left)  { pos = left;  label = `← ${label}`; }        // cheaper than every bar
    if (pos > right) { pos = right; label = `${label} →`; }        // dearer than every bar

    ctx.save();
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pos, chartArea.top + 18);
    ctx.lineTo(pos, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ORANGE;
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = pos > right - 60 ? "right" : pos < left + 60 ? "left" : "center";
    ctx.fillText(label, pos, chartArea.top + 12);
    ctx.restore();
  }
};

function showSpread(place, dwelling, bedrooms, row, rent) {
  const section  = document.getElementById("spread");
  const titleEl  = document.getElementById("spread-title");
  const summary  = document.getElementById("spread-summary");
  const note     = document.getElementById("spread-note");
  const chartBox = document.querySelector(".spread-chart");

  if (spread.length === 0 || !row) {      // file did not load, or no data for this combination
    section.hidden = true;
    return;
  }
  section.hidden = false;
  titleEl.textContent = `${placeLabel(place)} · ${dwelling} · ${bedroomText(bedrooms)}`;

  // like SQL: WHERE postcode = ... AND dwelling_type = ... AND bedroom_group = ...
  const found = spread.find(r =>
    r.postcode === place.postcode &&
    r.dwelling_type === dwelling &&
    r.bedroom_group === bedrooms
  );

  if (!found) {                           // fewer than 30 leases: no chart (BR-02)
    chartBox.hidden = true;
    note.hidden = true;
    summary.innerHTML = `<span class="trend-nodata">Not enough leases to show where rents fall.</span>
      <span class="trend-sub">Fewer than ${MIN_SAMPLE} similar new leases in this postcode.</span>`;
    if (spreadChart) { spreadChart.destroy(); spreadChart = null; }
    return;
  }
  chartBox.hidden = false;
  note.hidden = false;
  summary.innerHTML = "";

  // the bands to draw: from the P5 band to the P95 band
  const base  = meta ? meta.bin_width : 50;
  const lo0   = Math.floor(Number(row.p05_rent) / base) * base;
  const hi0   = Math.floor(Number(row.p95_rent) / base) * base;
  const width = bandWidth(lo0, hi0);
  const lo    = Math.floor(lo0 / width) * width;
  const bars  = Math.floor((hi0 - lo) / width) + 1;

  // add the $50 counts into the bands; leases outside P5–P95 are not drawn
  const counts = new Array(bars).fill(0);
  for (const [binStart, leases] of found.bins) {
    const i = Math.floor((binStart - lo) / width);
    if (i >= 0 && i < bars) counts[i] += leases;
  }
  const starts = counts.map((_, i) => lo + i * width);

  // darker = the band overlaps the usual range (P25–P75)
  const p25 = Number(row.p25_rent), p75 = Number(row.p75_rent);
  const colours = starts.map(s => (s < p75 && s + width > p25) ? "#0f766e" : "#cbd5e1");

  // legend under the chart: same words and numbers as the result card
  note.innerHTML = `
    <span><span class="swatch swatch-usual"></span>Usual range ${formatMoney(p25)} – ${formatMoney(p75)}</span>
    <span><span class="swatch swatch-you"></span>Your rent ${formatMoney(rent)}</span>
  `;

  // draw the chart (remove the old one first)
  if (spreadChart) spreadChart.destroy();
  spreadChart = new Chart(document.getElementById("spread-chart"), {
    type: "bar",
    data: {
      labels: starts.map(formatMoney),               // "$550", "$600", ...
      datasets: [{
        label: "New leases",
        data: counts,
        backgroundColor: colours,
        borderRadius: 4,
        categoryPercentage: 0.9,
        barPercentage: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `${formatMoney(starts[items[0].dataIndex])} – ${formatMoney(starts[items[0].dataIndex] + width - 1)} a week`,
            label: item => `${item.raw} new lease${item.raw === 1 ? "" : "s"}`
          }
        },
        yourRentLine: { rent, lo, width, bars }
      },
      scales: {
        x: { grid: { display: false }, title: { display: true, text: "Weekly rent" } },
        y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "New leases" } }
      }
    },
    plugins: [yourRentLine]
  });
}


// ===== 7. When the button is clicked =====
form.addEventListener("submit", function (event) {
  event.preventDefault();   // stop the page from reloading

  const place    = getSelectedPlace();
  const dwelling = dwellingSelect.value;
  const bedrooms = bedroomSelect.value;
  const rent     = Math.round(Number(rentInput.value));

  // 7a. Check the inputs
  let error = "";
  const sameName = countPlacesNamed(postcodeInput.value);
  if (!place && sameName > 1) {
    error = `There are ${sameName} places called ${postcodeInput.value.trim()}. Please choose one from the list.`;
    showSuggestions();         // open the list so they can pick
  }
  else if (!place)           error = "Please choose a suburb or postcode from the list.";
  else if (!dwelling)        error = "Please choose a dwelling type.";
  else if (!bedrooms)        error = "Please choose the number of bedrooms.";
  else if (!rent || rent <= 0) error = "Please enter your weekly rent or budget.";
  if (error) {
    showResult("error", `<p>${error}</p>`);
    nearbyBox.hidden = true;
    return;
  }

  const code = place.postcode;

  // 7b. Find the matching row
  const row = findBenchmark(code, dwelling, bedrooms);

  // 7c. Nearby areas, map and "where most rents fall" (all work even if there is no data for this area)
  lastSearch = { place, dwelling, bedrooms, rent, row };
  showNearby();
  showSpread(place, dwelling, bedrooms, row, rent);

  // chose a postcode: list its suburbs. chose a suburb: say it is based on the postcode
  const subs = suburbsOf(code);
  const includesLine = (!place.name && subs.length) ? `<div>Includes ${subs.join(", ")}</div>` : "";
  const basedOn      = place.name ? `Based on postcode ${code}` : "";

  // bold: "Postcode 2000 · House · 2 bedrooms"; grey underneath: suburbs or "Based on postcode"
  const areaLine = `
    <div class="area">
      <strong class="area-name">${placeLabel(place)} · ${dwelling} · ${bedroomText(bedrooms)}</strong>
      ${includesLine}
      ${basedOn ? `<div>${basedOn}</div>` : ""}
    </div>
  `;

  if (!row) {
    showResult("nodata", `
      <p class="verdict">No data for this combination</p>
      ${areaLine}
      <p>Try a different dwelling type or number of bedrooms.</p>
    `);
    return;
  }

  // 7d. Compare the rent
  const p25    = Number(row.p25_rent);
  const median = Number(row.median_rent);
  const p75    = Number(row.p75_rent);

  // "$650 a week is higher than usual" (works for a rent you pay AND a budget)
  let verdict, type;
  if (rent < p25) {
    verdict = "lower than usual";
    type    = "lower";
  } else if (rent <= p75) {
    verdict = "about usual";
    type    = "typical";
  } else {
    verdict = "higher than usual";
    type    = "higher";
  }

  // 7e. Lowest / highest without extreme leases (P5 / P95): only when there are 30+ leases
  const wideRange = (row.meets_min_sample === "Yes" && row.p05_rent != null)
    ? `<p class="wide-range">Lowest ${formatMoney(row.p05_rent)} · Highest ${formatMoney(row.p95_rent)} (excluding extremes)</p>`
    : "";

  // 7f. Warning for small samples (fewer than 30 lodgements)
  const warning = row.meets_min_sample === "Yes"
    ? ""
    : `<p class="warning">⚠️ Only ${row.sample_size} lodgements – use as a rough guide</p>`;

  // 7g. Show the result
  showResult(type, `
    <p class="verdict">${formatMoney(rent)} a week is ${verdict}</p>
    ${areaLine}
    <div class="stats">
      <div>
        <span>Usual range</span>
        <strong>${formatMoney(p25)} – ${formatMoney(p75)}</strong>
      </div>
      <div>
        <span>Middle rent</span>
        <strong>${formatMoney(median)}</strong>
      </div>
    </div>
    ${wideRange}
    ${warning}
    ${rentalLinks(code, dwelling, bedrooms, rent)}
  `);
});


// ===== 8. Distance buttons and "Show 5 more" =====

function setDistance(km) {
  maxKm = km;
  document.querySelectorAll("#distance-chips .chip").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.km) === km));
  if (lastSearch) showNearby();
}

document.querySelectorAll("#distance-chips .chip").forEach(b =>
  b.addEventListener("click", () => setDistance(Number(b.dataset.km))));

showMoreButton.addEventListener("click", showMore);

// the "10 km" button inside the no-result message
messageBox.addEventListener("click", event => {
  const b = event.target.closest(".link-button");
  if (b) setDistance(Number(b.dataset.km));
});


// ===== 9. Start =====

// a link like index.html?postcode=2160&type=House&bedrooms=3&rent=700 fills the search bar and checks
function checkFromLink() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("postcode");
  if (!code || !allCodes.includes(code)) return;

  choosePlace({ name: "", postcode: code });
  if (params.get("type"))     dwellingSelect.value = params.get("type");
  if (params.get("bedrooms")) bedroomSelect.value  = params.get("bedrooms");
  if (params.get("rent"))     rentInput.value      = params.get("rent");
  form.requestSubmit();
}

async function startPage() {
  const ok = await loadCoreData();
  if (!ok) {
    checkButton.textContent = "Data failed to load";
    return;
  }
  initMap();
  checkButton.disabled = false;
  checkButton.textContent = "Check my rent";
  checkFromLink();
}

startPage();
loadAreas();   // runs at the same time; the map works even if this one fails
loadSpread();  // runs at the same time; the rent check works even if this one fails