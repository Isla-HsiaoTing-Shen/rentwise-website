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

// ===== 2. Places to keep the data =====
let postcodes = [];        // from postcodes.json (595 rows)
let benchmark = [];        // from benchmark.json (5,218 rows)
let allCodes  = [];        // every postcode that has rent data (598)
let places    = [];        // one row per suburb: { name: "Granville", postcode: "2142" }
let selectedPlace = null;  // the suburb the user clicked

// ===== 3. Load the data =====
async function loadData() {
  try {
    const [postcodeRes, benchmarkRes] = await Promise.all([
      fetch("data/postcodes.json"),
      fetch("data/benchmark.json")
    ]);

    if (!postcodeRes.ok || !benchmarkRes.ok) {
      throw new Error("Could not load the data files");
    }

    postcodes = await postcodeRes.json();
    benchmark = await benchmarkRes.json();

    allCodes = [...new Set(benchmark.map(row => row.postcode))].sort();
    buildPlaces();

    checkButton.disabled = false;
    checkButton.textContent = "Check my rent";
    console.log("Loaded", postcodes.length, "postcodes,", benchmark.length, "benchmark rows,", places.length, "suburbs");
  } catch (error) {
    checkButton.textContent = "Data failed to load";
    console.error(error);
  }
}

// ===== 4. Build the suburb list =====

// "SOUTH GRANVILLE" -> "South Granville"
function toTitleCase(text) {
  return text.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

// "2142 – BLAXCELL, CAMELLIA, ..." -> one row per suburb
function buildPlaces() {
  for (const code of allCodes) {
    const info  = postcodes.find(p => p.postcode === code);
    const match = info ? info.postcode_label.match(/^\d{4}\s*[–-]\s*(.+)$/) : null;

    if (!match) {                              // the 3 postcodes with no names
      places.push({ name: "", postcode: code });
      continue;
    }
    for (const suburb of match[1].split(",")) {
      const name = suburb.trim();
      if (name) places.push({ name: toTitleCase(name), postcode: code });
    }
  }
}

// { name: "Granville", postcode: "2142" } -> "Granville, 2142"
function placeLabel(place) {
  return place.name ? `${place.name}, ${place.postcode}` : `Postcode ${place.postcode}`;
}

// all suburb names in one postcode: "2142" -> ["Blaxcell", "Camellia", ...]
function suburbsOf(code) {
  return places.filter(p => p.postcode === code && p.name).map(p => p.name);
}

// ===== 5. Search list =====

// find up to 8 suburbs that match what the user typed
function searchPlaces(text) {
  const q = text.trim().toLowerCase();
  if (!q) return [];

  let results;
  if (/^\d+$/.test(q)) {
    // typed numbers: search by postcode
    results = places.filter(p => p.postcode.startsWith(q));
  } else {
    // typed letters: search by suburb name
    results = places.filter(p => p.name.toLowerCase().includes(q));
    // names that START with the text come first, then A–Z
    results.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return results.slice(0, 8);
}
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
      // typed a suburb: "📍 Granville      2142"
      li.innerHTML = `
        <span>📍 ${place.name}</span>
        <span class="s-code">${place.postcode}</span>
      `;
    } else {
      // typed a postcode: show which suburbs it includes
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

  // typed a full postcode, e.g. "2142"
  if (/^\d{4}$/.test(text) && allCodes.includes(text)) {
    return { name: "", postcode: text };
  }
  // typed a full suburb name, e.g. "granville"
  return places.find(p =>
    p.name.toLowerCase() === text || placeLabel(p).toLowerCase() === text
  ) || null;
}

// ===== 6. Small helper functions =====

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

// ===== 7. When the button is clicked =====
form.addEventListener("submit", function (event) {
  event.preventDefault();   // stop the page from reloading

  const place    = getSelectedPlace();
  const dwelling = dwellingSelect.value;
  const bedrooms = bedroomSelect.value;
  const rent     = Number(rentInput.value);

  // 7a. Check the inputs
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

  // 7b. Find the matching row (like SQL: WHERE postcode = ... AND ...)
  const row = benchmark.find(r =>
    r.postcode === code &&
    r.dwelling_type === dwelling &&
    r.bedroom_group === bedrooms
  );

  // chose a postcode: list its suburbs. chose a suburb: say it is based on the postcode
  const subs = suburbsOf(code);
  const includesLine = (!place.name && subs.length) ? `<div>Includes ${subs.join(", ")}</div>` : "";
  const basedOn      = place.name ? ` · based on postcode ${code}` : "";

  const areaLine = `
    <div class="area">
      <strong class="area-name">${placeLabel(place)}</strong>
      ${includesLine}
      <div>${dwelling} · ${bedroomText(bedrooms)}${basedOn}</div>
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

  // 7c. Compare the rent
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

  // 7d. Warning for small samples (fewer than 30 lodgements)
  const warning = row.meets_min_sample === "Yes"
    ? ""
    : `<p class="warning">⚠️ Only ${row.sample_size} lodgements – use as a rough guide</p>`;

  // 7e. Show the result
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
    <p class="sample">Compared with ${Number(row.sample_size).toLocaleString("en-AU")} similar new leases from 2025.</p>
    ${warning}
  `);
});

// ===== 8. Start =====
loadData();