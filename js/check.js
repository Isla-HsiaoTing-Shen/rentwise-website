// ===== 1. Find the elements on the page =====
const form           = document.getElementById("search-form");
const postcodeInput  = document.getElementById("postcode-input");
const postcodeList   = document.getElementById("postcode-list");
const dwellingSelect = document.getElementById("dwelling-select");
const bedroomSelect  = document.getElementById("bedroom-select");
const rentInput      = document.getElementById("rent-input");
const checkButton    = document.getElementById("check-button");
const resultBox      = document.getElementById("result");

// ===== 2. Places to keep the data =====
let postcodes = [];   // from postcodes.json (595 rows)
let benchmark = [];   // from benchmark.json (5,218 rows)
let allCodes  = [];   // every postcode that has rent data (598)

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

    fillPostcodeList();

    checkButton.disabled = false;
    checkButton.textContent = "Check my rent";
    console.log("Loaded", postcodes.length, "postcodes and", benchmark.length, "benchmark rows");
  } catch (error) {
    checkButton.textContent = "Data failed to load";
    console.error(error);
  }
}

// ===== 4. Fill the "Where" search list =====
function fillPostcodeList() {
  allCodes = [...new Set(benchmark.map(row => row.postcode))].sort();

  for (const code of allCodes) {
    const option = document.createElement("option");
    option.value = getAreaName(code);
    postcodeList.appendChild(option);
  }
}

// ===== 5. Small helper functions =====

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

// show the first 3 suburbs; the rest can be opened with a click
function areaHtml(code) {
  const label = getAreaName(code);
  const match = label.match(/^\d{4}\s*[–-]\s*(.+)$/);   // "2142 – A, B, C" -> "A, B, C"
  if (!match) return label;                             // no suburb names: just the number

  const suburbs = match[1].split(", ");
  if (suburbs.length <= 3) return label;                // short enough: show all

  const firstThree = suburbs.slice(0, 3).join(", ");
  const moreCount  = suburbs.length - 3;
  return `
    <details>
      <summary>${code} – ${firstThree} <span class="more">+ ${moreCount} more</span></summary>
      <p>${suburbs.join(", ")}</p>
    </details>
  `;
}

// full name if we have it, otherwise just the number
function getAreaName(code) {
  const info = postcodes.find(p => p.postcode === code);
  return info ? info.postcode_label : code;
}

// read the "Where" box: "2017 – WATERLOO, ZETLAND" or "2017" -> "2017"
function getPostcode() {
  const match = postcodeInput.value.trim().match(/^(\d{4})(\s|$)/);
  if (match && allCodes.includes(match[1])) return match[1];
  return null;
}

// show the result card with a colour type
function showResult(type, html) {
  resultBox.className = "result-card " + type;
  resultBox.innerHTML = html;
  resultBox.hidden = false;
}

// ===== 6. When the button is clicked =====
form.addEventListener("submit", function (event) {
  event.preventDefault();   // stop the page from reloading

  const code     = getPostcode();
  const dwelling = dwellingSelect.value;
  const bedrooms = bedroomSelect.value;
  const rent     = Number(rentInput.value);

  // 6a. Check the inputs
  if (!code) {
    showResult("error", "<p>Please choose a postcode or suburb from the list.</p>");
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

  // 6b. Find the matching row (like SQL: WHERE postcode = ... AND ...)
  const row = benchmark.find(r =>
    r.postcode === code &&
    r.dwelling_type === dwelling &&
    r.bedroom_group === bedrooms
  );

    const areaLine = `
    <div class="area">
      <strong class="area-name">${getAreaName(code)}</strong>
      <div>${dwelling} · ${bedroomText(bedrooms)}</div>
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

  // 6c. Compare the rent
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

  // 6d. Warning for small samples (fewer than 30 lodgements)
  const warning = row.meets_min_sample === "Yes"
    ? ""
    : `<p class="warning">⚠️ Only ${row.sample_size} lodgements – use as a rough guide</p>`;

  // 6e. Show the result
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

// ===== 7. Start =====
loadData();