// ===== 0. Settings (change these numbers any time) =====
const NEARBY_COUNT  = 5;     // how many nearby areas to show
const NEARBY_MAX_KM = 50;    // only areas within this distance
const NSW_BOUNDS    = [[-37.6, 140.9], [-28.1, 153.7]];   // mainland NSW
const ORANGE = "#ea580c";    // your area
const BLUE   = "#2563eb";    // nearby areas
const GREY   = "#6b7280";    // all other areas

// ===== 1. Find the elements on the page =====
const form           = document.getElementById("search-form");
const whereField     = document.querySelector(".where-field");
const postcodeInput  = document.getElementById("postcode-input");
const suggestionsBox = document.getElementById("suggestions");
const dwellingSelect = document.getElementById("dwelling-select");
const bedroomSelect  = document.getElementById("bedroom-select");
const rentInput      = document.getElementById("rent-input");
const checkButton    = document.getElementById("check-button");
const resultBox      = document.getElementById("result");
const mapNote        = document.getElementById("map-note");

// ===== 2. Places to keep the data =====
let postcodes = [];        // postcodes.json: one row per postcode (595)
let benchmark = [];        // benchmark.json: rent figures (5,218)
let allCodes  = [];        // every postcode that has rent data (598)
let places    = [];        // suburbs.json: one row per suburb (5,214)
let areaShapes = {};       // postcode_areas.geojson: "2017" -> boundary shape (594)
let selectedPlace = null;  // the suburb or postcode the user chose

let map;                   // the Leaflet map
let greyLayer;             // all small grey dots
let resultLayer;           // orange + blue areas and dots after a search

let trend = [];            // trend_yearly.json: median rent per postcode per year (30+ leases)
let trendChart = null;     // the Chart.js line chart

// ===== 3. Load the data =====
async function loadData() {
  try {
    const [postcodeRes, benchmarkRes, suburbRes] = await Promise.all([
      fetch("data/postcodes.json"),
      fetch("data/benchmark.json"),
      fetch("data/suburbs.json")
    ]);

    if (!postcodeRes.ok || !benchmarkRes.ok || !suburbRes.ok) {
      throw new Error("Could not load the data files");
    }

    postcodes = await postcodeRes.json();
    benchmark = await benchmarkRes.json();
    const suburbs = await suburbRes.json();

    allCodes = [...new Set(benchmark.map(row => row.postcode))].sort();

    // { postcode, suburb, latitude, longitude } -> { name, postcode, lat, lng }
    places = suburbs.map(s => ({
      name: s.suburb,
      postcode: s.postcode,
      lat: s.latitude,
      lng: s.longitude
    }));

    initMap();

    checkButton.disabled = false;
    checkButton.textContent = "Check my rent";
    console.log("Loaded", postcodes.length, "postcodes,", benchmark.length, "benchmark rows,", places.length, "suburbs");
  } catch (error) {
    checkButton.textContent = "Data failed to load";
    console.error(error);
  }
}

// Postcode boundaries are an EXTRA: if this file fails, the map still shows dots
async function loadAreas() {
  try {
    const res = await fetch("data/postcode_areas.geojson");
    if (!res.ok) throw new Error("Could not load postcode_areas.geojson");
    const geo = await res.json();
    for (const feature of geo.features) {
      areaShapes[feature.properties.postcode] = feature;
    }
    console.log("Loaded", Object.keys(areaShapes).length, "postcode areas");
    if (greyLayer) drawGreyDots();   // map already drawn: move the grey dots inside their areas
  } catch (error) {
    console.warn("Postcode areas not loaded – the map will show dots only.", error);
  }
}

// ===== 4. Names =====

// { name: "Granville", postcode: "2142" } -> "Granville, 2142"
function placeLabel(place) {
  return place.name ? `${place.name}, ${place.postcode}` : `Postcode ${place.postcode}`;
}

// all suburb names in one postcode: "2142" -> ["Blaxcell", "Camellia", ...]
function suburbsOf(code) {
  return places.filter(p => p.postcode === code).map(p => p.name);
}

// first 3 suburbs: "Blaxcell, Camellia, Clyde, …"
function shortSuburbs(code) {
  const subs = suburbsOf(code);
  return subs.slice(0, 3).join(", ") + (subs.length > 3 ? ", …" : "");
}

// ===== 5. Search list =====

// find up to 8 matches, only ONE row per postcode
function searchPlaces(text) {
  const q = text.trim().toLowerCase();
  if (!q) return [];

  // typed numbers: one row per postcode
  if (/^\d+$/.test(q)) {
    return allCodes
      .filter(code => code.startsWith(q))
      .slice(0, 8)
      .map(code => ({ name: "", postcode: code }));
  }

  // typed letters: search by suburb name
  const matches = places.filter(p => p.name.toLowerCase().includes(q));

  // names that START with the text come first, then A–Z
  matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(q);
    const bStarts = b.name.toLowerCase().startsWith(q);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // keep only the best match for each postcode
  const seen = new Set();
  const results = [];
  for (const place of matches) {
    if (!seen.has(place.postcode)) {
      seen.add(place.postcode);
      results.push(place);
    }
  }
  return results.slice(0, 8);
}

function showSuggestions() {
  suggestionsBox.innerHTML = "";

  if (postcodeInput.value.trim() === "") {
    suggestionsBox.hidden = true;
    return;
  }

  const results = searchPlaces(postcodeInput.value);

  if (results.length === 0) {
    const li = document.createElement("li");
    li.className = "no-match";
    li.textContent = "No matching suburb or postcode";
    suggestionsBox.appendChild(li);
  }

  for (const place of results) {
    const li = document.createElement("li");
    if (place.name) {
      li.innerHTML = `
        <span>📍 ${place.name}</span>
        <span class="s-code">${place.postcode}</span>
      `;
    } else {
      const subs = suburbsOf(place.postcode);
      li.innerHTML = `
        <div class="s-main">
          <span>📍 Postcode ${place.postcode}</span>
          ${subs.length ? `<span class="s-sub">${subs.join(", ")}</span>` : ""}
        </div>
      `;
    }
    li.addEventListener("click", () => choosePlace(place));
    suggestionsBox.appendChild(li);
  }

  suggestionsBox.hidden = false;
}

function choosePlace(place) {
  selectedPlace = place;
  postcodeInput.value = placeLabel(place);
  suggestionsBox.hidden = true;
}

// when the user types: forget the old choice and show the list
postcodeInput.addEventListener("input", () => {
  selectedPlace = null;
  showSuggestions();
});

// click anywhere outside "Where": close the list
document.addEventListener("click", (event) => {
  if (!whereField.contains(event.target)) {
    suggestionsBox.hidden = true;
  }
});

// if the user typed without clicking the list, try to understand it
function getSelectedPlace() {
  if (selectedPlace) return selectedPlace;

  const text = postcodeInput.value.trim().toLowerCase();
  if (!text) return null;

  if (/^\d{4}$/.test(text) && allCodes.includes(text)) {
    return { name: "", postcode: text };
  }
  return places.find(p =>
    p.name.toLowerCase() === text || placeLabel(p).toLowerCase() === text
  ) || null;
}

// ===== 6. Map =====

// postcode point: "2142" -> { lat, lng } (or null)
// 1st choice: a point that is always INSIDE the postcode area (from postcode_areas.geojson)
// 2nd choice: the point in postcodes.json (can be outside, e.g. 2000 is in the harbour)
function getCoords(code) {
  const shape = areaShapes[code];
  if (shape && shape.properties.lat != null) {
    return { lat: shape.properties.lat, lng: shape.properties.lng };
  }
  const info = postcodes.find(p => p.postcode === code);
  if (!info || info.latitude == null || info.longitude == null) return null;
  return { lat: Number(info.latitude), lng: Number(info.longitude) };
}

// where to put the orange dot:
// chose a suburb -> that suburb's own point; chose a postcode -> the postcode point
function placeCoords(place) {
  if (place.lat != null && place.lng != null) {
    return { lat: Number(place.lat), lng: Number(place.lng) };
  }
  return getCoords(place.postcode);
}

// Haversine formula: distance between two points on Earth, in km
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;                                   // Earth radius in km
  const toRad = degrees => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function initMap() {
  map = L.map("map", { scrollWheelZoom: true });    // mouse wheel zooms the map
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
                 ' | Postal areas: <a href="https://www.abs.gov.au/">ABS</a> (CC BY 4.0)'
  }).addTo(map);
  map.fitBounds(NSW_BOUNDS);

  greyLayer   = L.layerGroup().addTo(map);
  resultLayer = L.layerGroup().addTo(map);
  drawGreyDots();
}

// one small grey dot for every postcode; click = choose it
// (drawn again when postcode_areas.geojson arrives, so the dots sit inside their areas)
function drawGreyDots() {
  greyLayer.clearLayers();
  for (const p of postcodes) {
    const coords = getCoords(p.postcode);
    if (!coords) continue;
    const subs = shortSuburbs(p.postcode);
    L.circleMarker([coords.lat, coords.lng], {
      radius: 4, color: GREY, weight: 1, fillColor: GREY, fillOpacity: 0.6
    })
      .bindTooltip(subs ? `${p.postcode} · ${subs}` : p.postcode)
      .on("click", () => choosePlace({ name: "", postcode: p.postcode }))
      .addTo(greyLayer);
  }
}

// colour one postcode area on the map (returns the layer, or null if we have no shape)
// infoHtml: text to show when the mouse is over the area
// onClick:  what to do when the area is clicked (leave it out = not clickable)
function drawArea(code, colour, fillOpacity, infoHtml, onClick) {
  const shape = areaShapes[code];
  if (!shape) return null;
  const layer = L.geoJSON(shape, {
    style: { color: colour, weight: 2, opacity: 0.8, fillColor: colour, fillOpacity: fillOpacity }
  }).addTo(resultLayer);
  layer.bindTooltip(infoHtml, { sticky: true, className: "hover-info" });   // follows the mouse
  if (onClick) layer.on("click", onClick);
  return layer;
}

// dots already have a price label, so show the info as a popup while the mouse is over them
function showInfoOnHover(marker, infoHtml) {
  marker.bindPopup(infoHtml, { closeButton: false, autoPan: false, offset: [0, -6] });
  marker.on("mouseover", () => marker.openPopup());
  marker.on("mouseout",  () => marker.closePopup());
}

// clicked a blue area: put that postcode in "Where" and check again
// (dwelling type, bedrooms and rent stay the same)
function checkArea(code) {
  choosePlace({ name: "", postcode: code });
  form.requestSubmit();

  // on phones the card is above the map, so scroll up to show the new result
  if (window.innerWidth <= 768) {
    resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// the 5 closest areas (from the orange dot) with the same dwelling + bedrooms and 30+ leases
function findNearby(home, code, dwelling, bedrooms) {
  return benchmark
    .filter(r =>
      r.postcode !== code &&
      r.dwelling_type === dwelling &&
      r.bedroom_group === bedrooms &&
      r.meets_min_sample === "Yes"
    )
    .map(r => {
      const c = getCoords(r.postcode);
      return c ? { row: r, coords: c, km: distanceKm(home.lat, home.lng, c.lat, c.lng) } : null;
    })
    .filter(item => item && item.km <= NEARBY_MAX_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, NEARBY_COUNT);
}

// the info shown on the map (short: the card has the details)
function popupHtml(title, row, extra) {
  return `
    <strong>${title}</strong>
    <br>Middle rent ${formatMoney(row.median_rent)}
    <br>Usual range ${formatMoney(row.p25_rent)} – ${formatMoney(row.p75_rent)}
    ${extra ? `<br><span class="hover-extra">${extra}</span>` : ""}
  `;
}

function showOnMap(place, row, dwelling, bedrooms) {
  resultLayer.clearLayers();
  mapNote.hidden = true;

  const home = placeCoords(place);
  if (!home) {
    map.fitBounds(NSW_BOUNDS);
    mapNote.textContent = "This postcode cannot be shown on the map.";
    mapNote.hidden = false;
    return;
  }

  const nearby = findNearby(home, place.postcode, dwelling, bedrooms);

  // info shown when the mouse is over your area
  const homeInfo = row
    ? popupHtml(`Your area: ${placeLabel(place)}`, row)
    : `<strong>${placeLabel(place)}</strong><br>No data for this combination`;

  // 1. areas first, so the dots sit on top of them
  for (const n of nearby) {
    // light blue: nearby postcodes (hover = info, click = check this area)
    const info = popupHtml(`Postcode ${n.row.postcode}`, n.row, `${n.km.toFixed(1)} km away`);
    drawArea(n.row.postcode, BLUE, 0.08, info, () => checkArea(n.row.postcode));
  }
  const homeArea = drawArea(place.postcode, ORANGE, 0.2, homeInfo);   // light orange: your postcode

  // 2. blue dots: nearby areas, with the price always showing (hover = info, click = check this area)
  const bounds = L.latLngBounds([[home.lat, home.lng]]);
  for (const n of nearby) {
    const dot = L.circleMarker([n.coords.lat, n.coords.lng], {
      radius: 8, color: "white", weight: 2, fillColor: BLUE, fillOpacity: 1
    })
      .bindTooltip(formatMoney(n.row.median_rent), {
        permanent: true, direction: "top", offset: [0, -8], className: "price-label"
      })
      .on("click", () => checkArea(n.row.postcode))
      .addTo(resultLayer);
    showInfoOnHover(dot, popupHtml(`Postcode ${n.row.postcode}`, n.row, `${n.km.toFixed(1)} km away`));
    bounds.extend([n.coords.lat, n.coords.lng]);
  }

  // 3. orange dot: your area (added last so it sits on top)
  const homeMarker = L.circleMarker([home.lat, home.lng], {
    radius: 11, color: "white", weight: 2, fillColor: ORANGE, fillOpacity: 1
  }).addTo(resultLayer);

  if (row) {
    homeMarker.bindTooltip(formatMoney(row.median_rent), {
      permanent: true, direction: "top", offset: [0, -10], className: "price-label home"
    });
  }
  showInfoOnHover(homeMarker, homeInfo);

  // 4. zoom so your whole postcode + all blue dots fit
  if (homeArea) bounds.extend(homeArea.getBounds());
  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });

  if (nearby.length === 0) {
    mapNote.textContent = `No nearby areas within ${NEARBY_MAX_KM} km with enough data.`;
    mapNote.hidden = false;
  }
}

// ===== 6b. Rent trend chart =====

// Trend data is an EXTRA: if this file fails, the rent check and map still work
async function loadTrend() {
  try {
    const res = await fetch("data/trend_yearly.json");
    if (!res.ok) throw new Error("Could not load trend_yearly.json");
    trend = await res.json();
    console.log("Loaded", trend.length, "trend rows");
  } catch (error) {
    console.warn("Trend data not loaded – the trend chart will be hidden.", error);
  }
}

// every year from 2021 to 2025, so missing years show as gaps
const TREND_YEARS = [2021, 2022, 2023, 2024, 2025];

function showTrend(place, dwelling, bedrooms) {
  const section  = document.getElementById("trend");
  const titleEl  = document.getElementById("trend-title");
  const summary  = document.getElementById("trend-summary");
  const chartBox = document.querySelector(".trend-chart");

  if (trend.length === 0) {           // trend.json did not load
    section.hidden = true;
    return;
  }

  section.hidden = false;
  titleEl.textContent = `${placeLabel(place)} · ${dwelling} · ${bedroomText(bedrooms)}`;

  // like SQL: WHERE postcode = ... AND dwelling_type = ... AND bedroom_group = ...
  const rows = trend.filter(r =>
    r.postcode === place.postcode &&
    r.dwelling_type === dwelling &&
    r.bedroom_group === bedrooms
  );

  if (rows.length < 2) {              // need at least 2 years to show a change
    chartBox.hidden = true;
    summary.innerHTML = `<span class="trend-nodata">Not enough data for a trend.</span>
      <span class="trend-sub">Fewer than 30 similar new leases each year in this postcode.</span>
      <span class="trend-sub">Try another dwelling type or number of bedrooms.</span>`;
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    return;
  }
  chartBox.hidden = false;

  // one value per year; null = fewer than 30 leases that year (a gap in the line)
  const values = TREND_YEARS.map(year => {
    const r = rows.find(row => Number(row.lodgement_year) === year);
    return r ? Number(r.median_rent) : null;
  });

  // first and last years that have data
  const firstIndex = values.findIndex(v => v !== null);
  const lastIndex  = values.length - 1 - [...values].reverse().findIndex(v => v !== null);
  const first = values[firstIndex];
  const last  = values[lastIndex];
  const change = Math.round((last - first) / first * 100);
  const word = change > 0 ? `Up ${change}%` : change < 0 ? `Down ${Math.abs(change)}%` : "No change";
  summary.textContent =
    `${word} from ${TREND_YEARS[firstIndex]} to ${TREND_YEARS[lastIndex]} (${formatMoney(first)} → ${formatMoney(last)})`;

  // draw the chart (remove the old one first)
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById("trend-chart"), {
    type: "line",
    data: {
      labels: TREND_YEARS.map(String),
      datasets: [{
        label: "Middle rent",
        data: values,
        borderColor: ORANGE,
        backgroundColor: ORANGE,
        borderWidth: 2,
        pointRadius: 4,
        tension: 0.2,
        spanGaps: false               // do not join across missing years
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label,                          // "2024"
            label: item => `Middle rent ${formatMoney(item.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: value => formatMoney(value) } }
      }
    }
  });
}

// ===== 7. Small helper functions =====

// 1050 -> "$1,050"
function formatMoney(amount) {
  return "$" + Math.round(Number(amount)).toLocaleString("en-AU");
}

// "Studio" -> "Studio", "1" -> "1 bedroom", "2" -> "2 bedrooms"
function bedroomText(group) {
  if (group === "Studio") return "Studio";
  if (group === "1") return "1 bedroom";
  return group + " bedrooms";
}

// show the result card with a colour type
function showResult(type, html) {
  resultBox.className = "result-card " + type;
  resultBox.innerHTML = html;
  resultBox.hidden = false;
}

// ===== 8. When the button is clicked =====
form.addEventListener("submit", function (event) {
  event.preventDefault();   // stop the page from reloading

  const place    = getSelectedPlace();
  const dwelling = dwellingSelect.value;
  const bedrooms = bedroomSelect.value;
  const rent     = Number(rentInput.value);

  // 8a. Check the inputs
  if (!place) {
    showResult("error", "<p>Please choose a suburb or postcode from the list.</p>");
    return;
  }
  if (!dwelling) {
    showResult("error", "<p>Please choose a dwelling type.</p>");
    return;
  }
  if (!bedrooms) {
    showResult("error", "<p>Please choose the number of bedrooms.</p>");
    return;
  }
  if (!rent || rent <= 0) {
    showResult("error", "<p>Please enter your weekly rent.</p>");
    return;
  }

  const code = place.postcode;

  // 8b. Find the matching row (like SQL: WHERE postcode = ... AND ...)
  const row = benchmark.find(r =>
    r.postcode === code &&
    r.dwelling_type === dwelling &&
    r.bedroom_group === bedrooms
  );

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

  // 8c. Update the map and the trend chart (both work even if there is no data for this area)
  showOnMap(place, row, dwelling, bedrooms);
  showTrend(place, dwelling, bedrooms);

  if (!row) {
    showResult("nodata", `
      <p class="verdict">No data for this combination</p>
      ${areaLine}
      <p>Try a different dwelling type or number of bedrooms.</p>
    `);
    return;
  }

  // 8d. Compare the rent
  const p25    = Number(row.p25_rent);
  const median = Number(row.median_rent);
  const p75    = Number(row.p75_rent);

  let verdict, type, position;
  if (rent < p25) {
    verdict  = "Lower than usual";
    type     = "lower";
    position = "below";
  } else if (rent <= p75) {
    verdict  = "About usual";
    type     = "typical";
    position = "within";
  } else {
    verdict  = "Higher than usual";
    type     = "higher";
    position = "above";
  }

  // 8e. Lowest / highest without extreme leases (P5 / P95): only when there are 30+ leases
  const wideRange = (row.meets_min_sample === "Yes" && row.p05_rent != null)
    ? `<p class="wide-range">Lowest ${formatMoney(row.p05_rent)} · Highest ${formatMoney(row.p95_rent)} (excluding extremes)</p>`
    : "";

  // 8f. Warning for small samples (fewer than 30 lodgements)
  const warning = row.meets_min_sample === "Yes"
    ? ""
    : `<p class="warning">⚠️ Only ${row.sample_size} lodgements – use as a rough guide</p>`;

  // 8g. Show the result
  showResult(type, `
    <p class="verdict">${verdict}</p>
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
    <p>Your rent of ${formatMoney(rent)} a week is <strong class="position">${position}</strong> the usual range.</p>
    ${wideRange}
    <p class="sample">Compared with ${Number(row.sample_size).toLocaleString("en-AU")} similar new leases from 2025.</p>
    ${warning}
  `);
});

// ===== 9. Start =====
loadData();
loadAreas();   // runs at the same time; the map works even if this one fails
loadTrend();   // runs at the same time; the rent check works even if this one fails

