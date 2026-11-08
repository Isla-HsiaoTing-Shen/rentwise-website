// =============================================================================
// common.js – shared code: settings, data, "Where" search list and map helpers.
// Used by index.html. Load this file BEFORE js/check.js.
// (Kept separate so a future page with a search bar or map can reuse it.)
// =============================================================================


// ===== 1. Settings (change these in one place) =====

// Years in the data. When you add a new year of data, change LATEST_YEAR
// (and the year text in the footer and on about.html).
const FIRST_YEAR  = 2021;    // first year in the trend data
const LATEST_YEAR = 2025;    // the year used for "similar new leases"
const MIN_SAMPLE  = 30;      // fewer leases than this = not reliable (BR-02)

const NSW_BOUNDS = [[-37.6, 140.9], [-28.1, 153.7]];   // mainland NSW

// Map colours: orange = your area, blue = areas to compare, grey = all others
const ORANGE = "#ea580c";
const BLUE   = "#2563eb";
const GREY   = "#6b7280";


// ===== 2. Data (filled by loadCoreData and loadAreas) =====
let postcodes  = [];       // postcodes.json: one row per postcode (595)
let benchmark  = [];       // benchmark.json: rent figures for LATEST_YEAR (5,218)
let allCodes   = [];       // every postcode that has rent data (598)
let places     = [];       // suburbs.json: one row per suburb (5,214)
let areaShapes = {};       // postcode_areas.geojson: "2017" -> boundary shape (594)


// ===== 3. Load the data =====

// The files every page needs. Returns true if they loaded, false if not.
async function loadCoreData() {
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

    console.log("Loaded", postcodes.length, "postcodes,", benchmark.length, "benchmark rows,", places.length, "suburbs");
    return true;
  } catch (error) {
    console.error(error);
    return false;
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


// ===== 4. Names and small helpers =====

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

// "2347" -> "New England and North West" (the ABS region in postcodes.json, or "")
function regionOf(code) {
  const info = postcodes.find(p => p.postcode === code);
  return info && info.region ? info.region : "";
}

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

// the benchmark row for one postcode + dwelling type + bedrooms (or undefined)
// like SQL: WHERE postcode = ... AND dwelling_type = ... AND bedroom_group = ...
function findBenchmark(code, dwelling, bedrooms) {
  return benchmark.find(r =>
    r.postcode === code &&
    r.dwelling_type === dwelling &&
    r.bedroom_group === bedrooms
  );
}


// ===== 5. "Where" search list =====
// Every page uses the same ids: .where-field, #postcode-input, #suggestions

const whereField     = document.querySelector(".where-field");
const postcodeInput  = document.getElementById("postcode-input");
const suggestionsBox = document.getElementById("suggestions");
let selectedPlace = null;  // the suburb or postcode the user chose

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

  // names that appear more than once (e.g. 3 different "Red Hill"s) also show their region
  const nameCount = {};
  for (const p of results) if (p.name) nameCount[p.name] = (nameCount[p.name] || 0) + 1;

  for (const place of results) {
    const li = document.createElement("li");
    if (place.name) {
      const region = nameCount[place.name] > 1 ? regionOf(place.postcode) : "";
      li.innerHTML = `
        <div class="s-main">
          <span>📍 ${place.name}</span>
          ${region ? `<span class="s-sub">${region}</span>` : ""}
        </div>
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
// returns a place, or null if we cannot tell which place they mean
function getSelectedPlace() {
  if (selectedPlace) return selectedPlace;

  const text = postcodeInput.value.trim().toLowerCase();
  if (!text) return null;

  if (/^\d{4}$/.test(text) && allCodes.includes(text)) {
    return { name: "", postcode: text };
  }

  // "Red Hill, 2347" is exact; plain "Red Hill" is only OK if there is ONE Red Hill
  const exact = places.find(p => placeLabel(p).toLowerCase() === text);
  if (exact) return exact;
  const sameName = places.filter(p => p.name.toLowerCase() === text);
  const codes = new Set(sameName.map(p => p.postcode));
  return codes.size === 1 ? sameName[0] : null;
}

// how many different postcodes have a suburb with exactly this name ("red hill" -> 3)
function countPlacesNamed(text) {
  const t = text.trim().toLowerCase();
  return new Set(places.filter(p => p.name.toLowerCase() === t).map(p => p.postcode)).size;
}


// ===== 6. Map =====
let map;                   // the Leaflet map
let greyLayer;             // all small grey dots
let resultLayer;           // orange + blue areas and dots after a search

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
// infoHtml:   text to show when the mouse is over the area
// onClick:    what to do when the area is clicked (leave it out = not clickable)
// extraStyle: optional, e.g. { dashArray: "6 4" } for a dashed border (leave it out = solid)
function drawArea(code, colour, fillOpacity, infoHtml, onClick, extraStyle = {}) {
  const shape = areaShapes[code];
  if (!shape) return null;
  const layer = L.geoJSON(shape, {
    style: { color: colour, weight: 2, opacity: 0.8, fillColor: colour, fillOpacity: fillOpacity, ...extraStyle }
  }).addTo(resultLayer);
  layer.bindTooltip(infoHtml, { sticky: true, className: "hover-info" });   // follows the mouse
  if (onClick) layer.on("click", onClick);
  return layer;
}

// a coloured dot; if price is given, a price label is always showing above it
function drawPriceDot(coords, colour, radius, price, labelClass) {
  const dot = L.circleMarker([coords.lat, coords.lng], {
    radius: radius, color: "white", weight: 2, fillColor: colour, fillOpacity: 1
  }).addTo(resultLayer);
  if (price) {
    dot.bindTooltip(price, {
      permanent: true, direction: "top", offset: [0, -Math.min(radius, 10)], className: labelClass
    });
  }
  return dot;
}

// dots already have a price label, so show the info as a popup while the mouse is over them
function showInfoOnHover(marker, infoHtml) {
  marker.bindPopup(infoHtml, { closeButton: false, autoPan: false, offset: [0, -6] });
  marker.on("mouseover", () => marker.openPopup());
  marker.on("mouseout",  () => marker.closePopup());
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


