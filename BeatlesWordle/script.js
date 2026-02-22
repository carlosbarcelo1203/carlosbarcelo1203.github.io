(() => {
  "use strict";

  const DATA_FILE = "beatles.csv";
  const STORAGE_KEY = "beatles_songdle_progress_v1";
  const PACIFIC_TIME_ZONE = "America/Los_Angeles";
  const MIN_SEARCH_CHARACTERS = 3;
  const MAX_SUGGESTIONS = 12;
  const GAME_MODES = Object.freeze({
    DAILY: "daily",
    UNLIMITED_RANDOM: "unlimited_random"
  });
  const ACTIVE_GAME_MODE = GAME_MODES.UNLIMITED_RANDOM;

  const MATCH = Object.freeze({
    GRAY: "gray",
    YELLOW: "yellow",
    GREEN: "green"
  });

  const ALBUM_ORDER = [
    "Please Please Me",
    "With The Beatles",
    "A Hard Day's Night",
    "Beatles For Sale",
    "Help!",
    "Rubber Soul",
    "Revolver",
    "Sgt Pepper's Lonely Hearts Club Band",
    "Magical Mystery Tour",
    "White Album",
    "Yellow Submarine",
    "Abbey Road",
    "Let It Be"
  ];

  const ERA_ORDER = [
    "Early (<=1962)",
    "Beatlemania (1963-1965)",
    "Studio (1966-1967)",
    "Late Beatles (1968-1970)"
  ];

  const ALBUM_INDEX = Object.freeze(buildIndexMap(ALBUM_ORDER));
  const ERA_INDEX = Object.freeze(buildIndexMap(ERA_ORDER));
  const FIELD_DEFINITIONS = Object.freeze([
    { id: "wordsInTitle", label: "Words in Title" },
    { id: "album", label: "Album" },
    { id: "era", label: "Era" },
    { id: "leadVocal", label: "Lead vocal" },
    { id: "tempo", label: "Tempo" },
    { id: "chartPosition", label: "Chart Position" }
  ]);

  const ui = {
    dailyStatus: document.getElementById("daily-status"),
    guessForm: document.getElementById("guess-form"),
    guessInput: document.getElementById("guess-input"),
    searchHint: document.getElementById("search-hint"),
    suggestionsPanel: document.getElementById("suggestions-panel"),
    message: document.getElementById("message"),
    resultsBody: document.getElementById("results-body")
  };

  const state = {
    songs: [],
    songsByTitleKey: new Map(),
    guesses: [],
    guessedTitleKeys: new Set(),
    guessEvaluations: [],
    visibleSuggestions: [],
    answer: null,
    dailyKey: "",
    solved: false
  };

  init();

  async function init() {
    setMessage("Loading songs...");
    ui.guessInput.disabled = true;

    try {
      const csvText = await fetchCsv(DATA_FILE);
      const parsedRows = parseCsv(csvText);
      state.songs = parsedRows.map(normalizeSong).filter(Boolean);

      if (state.songs.length === 0) {
        throw new Error("No songs were loaded from the CSV.");
      }

      for (const song of state.songs) {
        state.songsByTitleKey.set(toTitleKey(song.title), song);
      }

      if (ACTIVE_GAME_MODE === GAME_MODES.DAILY) {
        state.dailyKey = getPacificDateKey(new Date());
        state.answer = chooseDailySong(state.dailyKey, state.songs);
      } else {
        state.dailyKey = "";
        state.answer = chooseRandomSong(state.songs);
      }

      updateDailyStatus();
      restoreProgress();
      if (state.solved) {
        ui.guessInput.disabled = true;
      } else {
        ui.guessInput.disabled = false;
        setMessage("Type at least 3 letters, then select a suggestion to submit.");
      }
    } catch (error) {
      setMessage(`Could not load game data: ${error.message}`, "error");
      ui.guessInput.disabled = true;
    }

    wireEvents();
  }

  function wireEvents() {
    ui.guessForm.addEventListener("submit", onSubmitGuess);
    ui.guessInput.addEventListener("input", onGuessInputChanged);
    ui.guessInput.addEventListener("focus", onGuessInputFocused);
    ui.guessInput.addEventListener("keydown", onGuessInputKeyDown);
    document.addEventListener("click", onDocumentClick);
  }

  function onGuessInputChanged() {
    if (state.solved || ui.guessInput.disabled) {
      return;
    }

    renderSearchSuggestions();
  }

  function onGuessInputFocused() {
    if (state.solved || ui.guessInput.disabled) {
      return;
    }

    renderSearchSuggestions();
  }

  function onGuessInputKeyDown(event) {
    if (event.key === "Escape") {
      hideSuggestionsPanel();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const rawInput = ui.guessInput.value.trim();
    const exactSong = state.songsByTitleKey.get(toTitleKey(rawInput));
    if (exactSong) {
      submitGuessSong(exactSong);
      return;
    }

    setMessage("Select a song from the suggestion list.", "error");
  }

  function onDocumentClick(event) {
    if (ui.guessForm.contains(event.target)) {
      return;
    }
    hideSuggestionsPanel();
    setSearchHint("");
  }

  function onSubmitGuess(event) {
    event.preventDefault();
    submitGuessFromInput();
  }

  function submitGuessFromInput() {
    if (state.solved) {
      if (ACTIVE_GAME_MODE === GAME_MODES.DAILY) {
        setMessage("Today is already solved. Come back tomorrow for a new song.");
      } else {
        setMessage("This random round is solved. Refresh to get a new random song.");
      }
      return;
    }

    const rawInput = ui.guessInput.value.trim();
    if (!rawInput) {
      setMessage("Enter a song title first.", "error");
      return;
    }

    const key = toTitleKey(rawInput);
    const song = state.songsByTitleKey.get(key);
    if (!song) {
      setMessage("Choose a song from the suggestion list.", "error");
      return;
    }

    submitGuessSong(song);
  }

  function submitGuessSong(song) {
    if (!song) {
      return;
    }

    const key = toTitleKey(song.title);
    if (state.guessedTitleKeys.has(key)) {
      setMessage("You already guessed that song.", "error");
      return;
    }

    applyGuess(song, true);
    ui.guessInput.value = "";
    hideSuggestionsPanel();
    setSearchHint("");
  }

  function applyGuess(song, persist) {
    const result = evaluateGuess(song, state.answer);
    state.guesses.push(song.title);
    state.guessedTitleKeys.add(toTitleKey(song.title));
    state.guessEvaluations.push({ song, result });
    appendGuessRow(song, result);

    if (song.title === state.answer.title) {
      state.solved = true;
      ui.guessInput.disabled = true;
      hideSuggestionsPanel();
      setSearchHint("");
      setMessage(`Solved in ${state.guesses.length} guess${state.guesses.length === 1 ? "" : "es"}: ${state.answer.title}`, "success");
    } else {
      setMessage(`Guess ${state.guesses.length}: keep going.`);
    }

    if (persist) {
      persistProgress();
    }
  }

  function renderSearchSuggestions() {
    const rawQuery = ui.guessInput.value.trim();
    if (!rawQuery) {
      hideSuggestionsPanel();
      setSearchHint("");
      return;
    }

    const normalizedQuery = toTitleKey(rawQuery);
    if (normalizedQuery.length < MIN_SEARCH_CHARACTERS) {
      hideSuggestionsPanel();
      setSearchHint(`Type at least ${MIN_SEARCH_CHARACTERS} letters to search.`);
      return;
    }

    const knownGreenValues = deriveKnownGreenValues();
    const candidates = state.songs
      .filter((song) => !state.guessedTitleKeys.has(toTitleKey(song.title)))
      .filter((song) => toTitleKey(song.title).includes(normalizedQuery))
      .map((song) => ({
        song,
        score: countKnownGreenMatches(song, knownGreenValues)
      }))
      .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));

    if (candidates.length === 0) {
      hideSuggestionsPanel();
      setSearchHint("No matches for that search.");
      return;
    }

    state.visibleSuggestions = candidates.slice(0, MAX_SUGGESTIONS);
    const fragment = document.createDocumentFragment();
    for (const candidate of state.visibleSuggestions) {
      fragment.appendChild(buildSuggestionOption(candidate, knownGreenValues));
    }
    ui.suggestionsPanel.replaceChildren(fragment);
    ui.suggestionsPanel.classList.remove("hidden");

    const knownCount = Object.keys(knownGreenValues).length;
    const shownCount = state.visibleSuggestions.length;
    if (knownCount === 0) {
      setSearchHint(`Showing ${shownCount} of ${candidates.length} matches. No confirmed green clues yet.`);
      return;
    }
    setSearchHint(`Showing ${shownCount} of ${candidates.length} matches, sorted by ${knownCount} confirmed green clue${knownCount === 1 ? "" : "s"}.`);
  }

  function buildSuggestionOption(candidate, knownGreenValues) {
    const { song, score } = candidate;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", `${song.title}, ${score} known green matches`);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      submitGuessSong(song);
    });

    const head = document.createElement("div");
    head.className = "suggestion-item-head";

    const title = document.createElement("span");
    title.className = "suggestion-title";
    title.textContent = song.title;

    const scoreLabel = document.createElement("span");
    scoreLabel.className = "suggestion-score";
    scoreLabel.textContent = `${score} green`;

    head.appendChild(title);
    head.appendChild(scoreLabel);

    const previewGrid = document.createElement("div");
    previewGrid.className = "suggestion-preview-grid";

    for (const field of FIELD_DEFINITIONS) {
      const value = getSongFieldDisplay(song, field.id);
      const comparable = getSongFieldComparable(song, field.id);
      const knownValue = knownGreenValues[field.id];
      const isKnownMatch = knownValue !== undefined && knownValue === comparable;
      previewGrid.appendChild(buildSuggestionPreviewCell(field.label, value, isKnownMatch));
    }

    button.appendChild(head);
    button.appendChild(previewGrid);
    return button;
  }

  function buildSuggestionPreviewCell(label, value, isKnownMatch) {
    const cell = document.createElement("span");
    cell.className = `suggestion-preview-cell ${
      isKnownMatch ? "suggestion-preview-cell-green" : "suggestion-preview-cell-neutral"
    }`;
    if (label === "Era") {
      const eraParts = splitEraValue(value);
      const main = document.createElement("span");
      main.className = "suggestion-era-main";
      main.textContent = eraParts.main;
      cell.appendChild(main);
      if (eraParts.years) {
        const years = document.createElement("span");
        years.className = "suggestion-era-years";
        years.textContent = eraParts.years;
        cell.appendChild(years);
      }
    } else {
      cell.textContent = value;
    }
    cell.title = `${label}: ${value}`;
    return cell;
  }

  function deriveKnownGreenValues() {
    const known = {};
    for (const evaluation of state.guessEvaluations) {
      for (const field of FIELD_DEFINITIONS) {
        if (evaluation.result[field.id] === MATCH.GREEN) {
          known[field.id] = getSongFieldComparable(evaluation.song, field.id);
        }
      }
    }
    return known;
  }

  function countKnownGreenMatches(song, knownGreenValues) {
    let count = 0;
    for (const field of FIELD_DEFINITIONS) {
      if (knownGreenValues[field.id] === undefined) {
        continue;
      }
      if (getSongFieldComparable(song, field.id) === knownGreenValues[field.id]) {
        count += 1;
      }
    }
    return count;
  }

  function getSongFieldComparable(song, fieldId) {
    if (fieldId === "wordsInTitle") {
      return song.wordsInTitle;
    }
    if (fieldId === "album") {
      return canonicalAlbum(song.album);
    }
    if (fieldId === "era") {
      return song.era;
    }
    if (fieldId === "leadVocal") {
      return song.leadVocalists.join("|");
    }
    if (fieldId === "tempo") {
      return song.tempo;
    }
    if (fieldId === "chartPosition") {
      return song.chartPositionValue;
    }
    return "";
  }

  function getSongFieldDisplay(song, fieldId) {
    if (fieldId === "wordsInTitle") {
      return String(song.wordsInTitle);
    }
    if (fieldId === "album") {
      return song.album;
    }
    if (fieldId === "era") {
      return song.era;
    }
    if (fieldId === "leadVocal") {
      return song.leadVocalDisplay;
    }
    if (fieldId === "tempo") {
      return song.tempo;
    }
    if (fieldId === "chartPosition") {
      return song.chartPositionDisplay;
    }
    return "";
  }

  function hideSuggestionsPanel() {
    state.visibleSuggestions = [];
    ui.suggestionsPanel.replaceChildren();
    ui.suggestionsPanel.classList.add("hidden");
  }

  function setSearchHint(text) {
    ui.searchHint.textContent = text;
  }

  function updateDailyStatus() {
    if (ACTIVE_GAME_MODE !== GAME_MODES.DAILY) {
      ui.dailyStatus.textContent = "Unlimited random mode. A new mystery song is picked each page load.";
      return;
    }

    const dateLabel = formatDateLong(state.dailyKey);
    ui.dailyStatus.textContent = `Daily song for ${dateLabel}. Resets at midnight Pacific time.`;
  }

  function restoreProgress() {
    if (ACTIVE_GAME_MODE !== GAME_MODES.DAILY) {
      return;
    }

    const saved = readStoredProgress();
    if (!saved || saved.dailyKey !== state.dailyKey) {
      return;
    }

    for (const title of saved.guesses) {
      const song = state.songsByTitleKey.get(toTitleKey(title));
      if (song && !state.guessedTitleKeys.has(toTitleKey(song.title))) {
        applyGuess(song, false);
      }
    }
  }

  function persistProgress() {
    if (ACTIVE_GAME_MODE !== GAME_MODES.DAILY) {
      return;
    }

    const payload = {
      dailyKey: state.dailyKey,
      guesses: state.guesses,
      solved: state.solved
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_error) {
      // Storage failure should not break gameplay.
    }
  }

  function readStoredProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") {
        return null;
      }
      if (!Array.isArray(data.guesses)) {
        return null;
      }
      return data;
    } catch (_error) {
      return null;
    }
  }

  function evaluateGuess(guessSong, answerSong) {
    return {
      wordsInTitle: compareNearNumeric(guessSong.wordsInTitle, answerSong.wordsInTitle, 1),
      album: compareAlbum(guessSong.album, answerSong.album),
      era: compareNearEnum(guessSong.era, answerSong.era, ERA_INDEX),
      leadVocal: compareLeadVocals(guessSong.leadVocalists, answerSong.leadVocalists),
      tempo: compareExactOnly(guessSong.tempo, answerSong.tempo),
      chartPosition: compareNearNumeric(guessSong.chartPositionValue, answerSong.chartPositionValue, 20)
    };
  }

  function compareAlbum(guessAlbumRaw, answerAlbumRaw) {
    const guessAlbum = canonicalAlbum(guessAlbumRaw);
    const answerAlbum = canonicalAlbum(answerAlbumRaw);

    if (guessAlbum === answerAlbum) {
      return MATCH.GREEN;
    }

    if (guessAlbum === "Single" || answerAlbum === "Single") {
      return MATCH.GRAY;
    }

    const guessIndex = ALBUM_INDEX[guessAlbum];
    const answerIndex = ALBUM_INDEX[answerAlbum];

    if (!Number.isInteger(guessIndex) || !Number.isInteger(answerIndex)) {
      return MATCH.GRAY;
    }

    return Math.abs(guessIndex - answerIndex) <= 1 ? MATCH.YELLOW : MATCH.GRAY;
  }

  function canonicalAlbum(album) {
    if (album === "The Beatles (White Album)") {
      return "White Album";
    }
    return album;
  }

  function compareNearEnum(guessValue, answerValue, indexMap) {
    if (guessValue === answerValue) {
      return MATCH.GREEN;
    }
    const guessIndex = indexMap[guessValue];
    const answerIndex = indexMap[answerValue];
    if (!Number.isInteger(guessIndex) || !Number.isInteger(answerIndex)) {
      return MATCH.GRAY;
    }
    return Math.abs(guessIndex - answerIndex) <= 1 ? MATCH.YELLOW : MATCH.GRAY;
  }

  function compareNearNumeric(guessValue, answerValue, threshold) {
    if (!Number.isFinite(guessValue) || !Number.isFinite(answerValue)) {
      return MATCH.GRAY;
    }
    if (guessValue === answerValue) {
      return MATCH.GREEN;
    }
    return Math.abs(guessValue - answerValue) <= threshold ? MATCH.YELLOW : MATCH.GRAY;
  }

  function compareLeadVocals(guessVocalists, answerVocalists) {
    if (!Array.isArray(guessVocalists) || !Array.isArray(answerVocalists)) {
      return MATCH.GRAY;
    }

    if (
      guessVocalists.length === answerVocalists.length &&
      guessVocalists.every((name, index) => name === answerVocalists[index])
    ) {
      return MATCH.GREEN;
    }

    const answerSet = new Set(answerVocalists);
    for (const vocalist of guessVocalists) {
      if (answerSet.has(vocalist)) {
        return MATCH.YELLOW;
      }
    }

    return MATCH.GRAY;
  }

  function compareExactOnly(guessValue, answerValue) {
    return guessValue === answerValue ? MATCH.GREEN : MATCH.GRAY;
  }

  function appendGuessRow(song, result) {
    const emptyStateRow = document.getElementById("empty-state-row");
    if (emptyStateRow) {
      emptyStateRow.remove();
    }

    const guessCard = document.createElement("article");
    guessCard.className = "guess-row";

    const title = document.createElement("h3");
    title.className = "guess-title";
    title.textContent = song.title;

    const metrics = document.createElement("div");
    metrics.className = "guess-metrics";

    metrics.appendChild(buildMetricTile("Words in Title", String(song.wordsInTitle), result.wordsInTitle));
    metrics.appendChild(buildMetricTile("Album", song.album, result.album));
    metrics.appendChild(buildMetricTile("Era", song.era, result.era));
    metrics.appendChild(buildMetricTile("Lead vocal", song.leadVocalDisplay, result.leadVocal));
    metrics.appendChild(buildMetricTile("Tempo", song.tempo, result.tempo));
    metrics.appendChild(buildMetricTile("Chart Position", song.chartPositionDisplay, result.chartPosition));

    guessCard.appendChild(title);
    guessCard.appendChild(metrics);

    ui.resultsBody.prepend(guessCard);
  }

  function buildMetricTile(label, value, resultType) {
    const tile = document.createElement("div");
    tile.className = `guess-metric result result-${resultType}`;
    tile.title = `${label}: ${value}`;

    const valueElement = document.createElement("span");
    valueElement.className = "metric-value";
    if (label === "Era") {
      const eraParts = splitEraValue(value);
      valueElement.classList.add("metric-value-era");

      const main = document.createElement("span");
      main.className = "metric-era-main";
      main.textContent = eraParts.main;
      valueElement.appendChild(main);

      if (eraParts.years) {
        const years = document.createElement("span");
        years.className = "metric-era-years";
        years.textContent = eraParts.years;
        valueElement.appendChild(years);
      }
    } else {
      valueElement.textContent = value;
    }

    tile.appendChild(valueElement);

    return tile;
  }

  function splitEraValue(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/^(.*?)(\s*\(.*\))$/);
    if (!match) {
      return { main: text, years: "" };
    }
    return {
      main: match[1].trim(),
      years: match[2].trim()
    };
  }

  async function fetchCsv(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}).`);
    }
    return response.text();
  }

  function parseCsv(csvText) {
    const rows = [];
    let currentField = "";
    let currentRow = [];
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i += 1) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentField += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentField = "";
        currentRow = [];
      } else if (char === "\r") {
        continue;
      } else {
        currentField += char;
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0].map((value, index) => {
      const cleaned = value.trim();
      return index === 0 ? cleaned.replace(/^\uFEFF/, "") : cleaned;
    });
    const records = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.every((value) => value.trim() === "")) {
        continue;
      }
      const record = {};
      for (let j = 0; j < headers.length; j += 1) {
        record[headers[j]] = (row[j] ?? "").trim();
      }
      records.push(record);
    }

    return records;
  }

  function normalizeSong(row) {
    const title = row.Title;
    const album = row.Album;
    const era = row.Era;
    const leadVocalDisplay = row["Lead vocal"];
    const tempo = row["Tempo bucket"];
    const wordsInTitle = Number.parseInt(row["Words in Title"], 10);
    const chartPositionDisplay = row["Highest chart position"];
    const chartPositionValue = parseChartPosition(chartPositionDisplay);
    const leadVocalists = parseLeadVocalists(leadVocalDisplay);

    if (!title || !album || !era || !tempo) {
      return null;
    }

    if (!Number.isFinite(wordsInTitle)) {
      return null;
    }

    return {
      title,
      album,
      era,
      leadVocalDisplay,
      leadVocalists,
      tempo,
      wordsInTitle,
      chartPositionDisplay,
      chartPositionValue
    };
  }

  function parseLeadVocalists(value) {
    if (!value) {
      return [];
    }

    const unique = new Set(
      value
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    );

    return Array.from(unique).sort();
  }

  function parseChartPosition(value) {
    if (!value) {
      return NaN;
    }
    const number = Number.parseInt(value.replace("+", ""), 10);
    return Number.isFinite(number) ? number : NaN;
  }

  function chooseDailySong(dayKey, songs) {
    const seed = hashString(dayKey);
    const random = mulberry32(seed);
    const index = Math.floor(random() * songs.length);
    return songs[index];
  }

  function chooseRandomSong(songs) {
    const index = Math.floor(Math.random() * songs.length);
    return songs[index];
  }

  function getPacificDateKey(date) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: PACIFIC_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return `${year}-${month}-${day}`;
  }

  function formatDateLong(dayKey) {
    const [year, month, day] = dayKey.split("-").map((part) => Number.parseInt(part, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }).format(date);
  }

  function setMessage(text, type = "") {
    ui.message.textContent = text;
    ui.message.className = type ? `message ${type}` : "message";
  }

  function buildIndexMap(values) {
    const map = {};
    for (let i = 0; i < values.length; i += 1) {
      map[values[i]] = i;
    }
    return map;
  }

  function toTitleKey(value) {
    return value
      .normalize("NFKD")
      .replace(/[’‘`]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function next() {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), t | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
})();
