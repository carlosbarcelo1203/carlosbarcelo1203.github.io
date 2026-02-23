(() => {
  "use strict";

  const DATA_FILE = "beatlesGrid.csv";
  const GRID_DIMENSION = 3;
  const MIN_INTERSECTION_MATCHES = 3;
  const MAX_LAYOUT_ATTEMPTS = 250;
  const MAX_REPAIR_STEPS = 80;
  const MAX_SUGGESTIONS = 10;
  const MIN_QUERY_LENGTH = 1;

  const ALWAYS_INCLUDED_CATEGORY_IDS = Object.freeze([
    "titleStarts",
    "leadVocal",
    "chartPosition",
    "wordsInTitle",
    "cover"
  ]);

  const TITLE_START_OPTIONS = Object.freeze([
    { id: "A-F", label: "A-F" },
    { id: "G-L", label: "G-L" },
    { id: "M-S", label: "M-S" },
    { id: "T-Z", label: "T-Z" }
  ]);

  const LEAD_VOCAL_OPTIONS = Object.freeze([
    { id: "john", label: "John" },
    { id: "paul", label: "Paul" },
    { id: "george", label: "George" },
    { id: "ringo", label: "Ringo" }
  ]);

  const CHART_POSITION_OPTIONS = Object.freeze([
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" }
  ]);

  const COVER_OPTIONS = Object.freeze([
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" }
  ]);

  const ALBUM_ORDER = Object.freeze([
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
    "Let It Be",
    "Single"
  ]);

  const ERA_ORDER = Object.freeze([
    "Early (<=1962)",
    "Beatlemania (1963-1965)",
    "Studio (1966-1967)",
    "Late Beatles (1968-1970)"
  ]);

  const CATEGORY_DEFINITIONS = Object.freeze({
    titleStarts: Object.freeze({
      label: "Title Starts With",
      matches: (song, criterionId) => song.titleStartsBucket === criterionId
    }),
    album: Object.freeze({
      label: "Album",
      matches: (song, criterionId) => song.album === criterionId
    }),
    era: Object.freeze({
      label: "Era",
      matches: (song, criterionId) => song.era === criterionId
    }),
    leadVocal: Object.freeze({
      label: "Lead Vocal",
      matches: (song, criterionId) => song.leadVocalists.includes(criterionId)
    }),
    chartPosition: Object.freeze({
      label: "Billboard Top 100",
      matches: (song, criterionId) => song.chartPositionBucket === criterionId
    }),
    wordsInTitle: Object.freeze({
      label: "Words in Title",
      matches: (song, criterionId) => song.wordsInTitle === Number.parseInt(criterionId, 10)
    }),
    cover: Object.freeze({
      label: "Cover",
      matches: (song, criterionId) => (criterionId === "yes" ? song.isCover : !song.isCover)
    })
  });

  const ui = {
    boardMeta: document.getElementById("board-meta"),
    progressLabel: document.getElementById("progress-label"),
    matrixGrid: document.getElementById("matrix-grid"),
    guessOverlay: document.getElementById("guess-overlay"),
    overlayRule: document.getElementById("overlay-rule"),
    overlayForm: document.getElementById("overlay-form"),
    overlayInput: document.getElementById("overlay-input"),
    overlaySuggestions: document.getElementById("overlay-suggestions"),
    overlayFeedback: document.getElementById("overlay-feedback"),
    overlayClose: document.getElementById("overlay-close")
  };

  const state = {
    songs: [],
    songsByTitleKey: new Map(),
    categoryOptionsById: {},
    optionLabelsByCategory: {},
    board: null,
    cellUiById: new Map(),
    solvedCount: 0,
    activeCellId: ""
  };

  init();

  async function init() {
    setBoardMeta("Loading board...");
    ui.progressLabel.textContent = "";

    try {
      const csvText = await fetchCsv(DATA_FILE);
      const records = parseCsv(csvText);
      state.songs = records.map(normalizeSong).filter(Boolean);

      if (state.songs.length === 0) {
        throw new Error("No songs were loaded from the CSV.");
      }

      for (const song of state.songs) {
        state.songsByTitleKey.set(song.titleKey, song);
      }

      state.categoryOptionsById = buildCategoryOptions(state.songs);
      state.optionLabelsByCategory = buildOptionLabelLookup(state.categoryOptionsById);
      state.board = buildPlayableBoard(state.songs, state.categoryOptionsById);

      renderBoard(state.board);
      wireGlobalEvents();
      updateProgressLabel();

      const usingAlbum = state.board.activeCategoryIds.includes("album");
      setBoardMeta(
        `Board ready. Using ${usingAlbum ? "Album" : "Era"} (not both). Refresh for a new random grid.`
      );
    } catch (error) {
      setBoardMeta(`Could not build the board: ${error.message}`, "error");
    }
  }

  function wireGlobalEvents() {
    ui.overlayForm.addEventListener("submit", onOverlaySubmit);

    ui.overlayInput.addEventListener("input", onOverlayInputChanged);
    ui.overlayInput.addEventListener("focus", onOverlayInputChanged);
    ui.overlayInput.addEventListener("keydown", onOverlayInputKeyDown);

    ui.overlayClose.addEventListener("click", closeGuessOverlay);

    ui.guessOverlay.addEventListener("click", (event) => {
      if (event.target === ui.guessOverlay) {
        closeGuessOverlay();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !ui.guessOverlay.classList.contains("hidden")) {
        closeGuessOverlay();
      }
    });
  }

  function buildCategoryOptions(songs) {
    const albumValues = uniqueOrdered(
      songs.map((song) => song.album),
      ALBUM_ORDER
    );

    const eraValues = uniqueOrdered(
      songs.map((song) => song.era),
      ERA_ORDER
    );

    const commonWordCounts = Array.from(
      new Set(
        songs
          .map((song) => song.wordsInTitle)
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
      )
    ).sort((a, b) => a - b);
    const fallbackWordCounts = Array.from(
      new Set(
        songs
          .map((song) => song.wordsInTitle)
          .filter((value) => Number.isInteger(value) && value >= 1)
      )
    ).sort((a, b) => a - b);
    const wordsInTitleCounts = commonWordCounts.length
      ? commonWordCounts
      : fallbackWordCounts;

    return {
      titleStarts: TITLE_START_OPTIONS.slice(),
      album: albumValues.map((value) => ({ id: value, label: value })),
      era: eraValues.map((value) => ({ id: value, label: value })),
      leadVocal: LEAD_VOCAL_OPTIONS.slice(),
      chartPosition: CHART_POSITION_OPTIONS.slice(),
      wordsInTitle: wordsInTitleCounts.map((count) => ({
        id: String(count),
        label: `${count} word${count === 1 ? "" : "s"}`
      })),
      cover: COVER_OPTIONS.slice()
    };
  }

  function buildOptionLabelLookup(categoryOptionsById) {
    const labels = {};
    for (const [categoryId, options] of Object.entries(categoryOptionsById)) {
      labels[categoryId] = {};
      for (const option of options) {
        labels[categoryId][option.id] = option.label;
      }
    }
    return labels;
  }

  function buildPlayableBoard(songs, categoryOptionsById) {
    for (let layoutAttempt = 0; layoutAttempt < MAX_LAYOUT_ATTEMPTS; layoutAttempt += 1) {
      const activeCategoryIds = buildActiveCategoryIds();
      const rowCategoryIds = activeCategoryIds.slice(0, GRID_DIMENSION);
      const colCategoryIds = activeCategoryIds.slice(GRID_DIMENSION, GRID_DIMENSION * 2);
      const criteriaByCategory = {};

      for (const categoryId of activeCategoryIds) {
        const options = categoryOptionsById[categoryId];
        if (!options || options.length === 0) {
          continue;
        }
        criteriaByCategory[categoryId] = randomChoice(options).id;
      }

      for (let repairStep = 0; repairStep < MAX_REPAIR_STEPS; repairStep += 1) {
        const evaluation = evaluateBoard(
          songs,
          rowCategoryIds,
          colCategoryIds,
          criteriaByCategory,
          false
        );

        if (evaluation.isValid) {
          const solvedEvaluation = evaluateBoard(
            songs,
            rowCategoryIds,
            colCategoryIds,
            criteriaByCategory,
            true
          );

          const cellMatrix = Array.from({ length: GRID_DIMENSION }, () =>
            Array.from({ length: GRID_DIMENSION })
          );
          const cellsById = new Map();
          const cells = [];

          for (const rawCell of solvedEvaluation.cells) {
            const cell = {
              ...rawCell,
              validTitleKeys: new Set(rawCell.matches.map((song) => song.titleKey)),
              solved: false,
              solvedSong: null
            };

            cellMatrix[cell.rowIndex][cell.colIndex] = cell;
            cellsById.set(cell.id, cell);
            cells.push(cell);
          }

          return {
            activeCategoryIds,
            rowCategoryIds,
            colCategoryIds,
            criteriaByCategory,
            cellMatrix,
            cellsById,
            cells
          };
        }

        const rankedCategoryIds = rankFailingCategories(evaluation.failingCells);
        let changedCriterion = false;

        for (const categoryId of rankedCategoryIds) {
          const improvedCriterion = chooseBetterCriterion(
            categoryId,
            songs,
            rowCategoryIds,
            colCategoryIds,
            criteriaByCategory,
            categoryOptionsById
          );

          if (improvedCriterion !== criteriaByCategory[categoryId]) {
            criteriaByCategory[categoryId] = improvedCriterion;
            changedCriterion = true;
            break;
          }
        }

        if (!changedCriterion) {
          const mutableCategoryIds = rankedCategoryIds.length
            ? rankedCategoryIds
            : activeCategoryIds;
          const randomCategoryId = randomChoice(mutableCategoryIds);
          const currentCriterion = criteriaByCategory[randomCategoryId];
          const alternatives = categoryOptionsById[randomCategoryId]
            .map((option) => option.id)
            .filter((optionId) => optionId !== currentCriterion);

          if (alternatives.length === 0) {
            break;
          }

          criteriaByCategory[randomCategoryId] = randomChoice(alternatives);
        }
      }
    }

    throw new Error(
      `Unable to generate a board with at least ${MIN_INTERSECTION_MATCHES} valid songs per square.`
    );
  }

  function buildActiveCategoryIds() {
    const ids = ALWAYS_INCLUDED_CATEGORY_IDS.slice();
    ids.push(Math.random() < 0.5 ? "album" : "era");
    return shuffle(ids);
  }

  function evaluateBoard(
    songs,
    rowCategoryIds,
    colCategoryIds,
    criteriaByCategory,
    includeMatches
  ) {
    const cells = [];
    const failingCells = [];
    let minCount = Number.POSITIVE_INFINITY;
    let totalCount = 0;

    for (let rowIndex = 0; rowIndex < GRID_DIMENSION; rowIndex += 1) {
      for (let colIndex = 0; colIndex < GRID_DIMENSION; colIndex += 1) {
        const rowCategoryId = rowCategoryIds[rowIndex];
        const colCategoryId = colCategoryIds[colIndex];
        const rowCriterionId = criteriaByCategory[rowCategoryId];
        const colCriterionId = criteriaByCategory[colCategoryId];

        const matches = [];
        let count = 0;

        for (const song of songs) {
          const rowMatches = CATEGORY_DEFINITIONS[rowCategoryId].matches(song, rowCriterionId);
          if (!rowMatches) {
            continue;
          }

          const colMatches = CATEGORY_DEFINITIONS[colCategoryId].matches(song, colCriterionId);
          if (!colMatches) {
            continue;
          }

          count += 1;
          if (includeMatches) {
            matches.push(song);
          }
        }

        const cell = {
          id: `${rowIndex}-${colIndex}`,
          rowIndex,
          colIndex,
          rowCategoryId,
          colCategoryId,
          count
        };

        if (includeMatches) {
          cell.matches = matches;
        }

        cells.push(cell);
        minCount = Math.min(minCount, count);
        totalCount += count;

        if (count < MIN_INTERSECTION_MATCHES) {
          failingCells.push(cell);
        }
      }
    }

    if (!Number.isFinite(minCount)) {
      minCount = 0;
    }

    return {
      cells,
      failingCells,
      isValid: failingCells.length === 0,
      minCount,
      totalCount
    };
  }

  function rankFailingCategories(failingCells) {
    const scoreByCategory = new Map();

    for (const cell of failingCells) {
      const weight = MIN_INTERSECTION_MATCHES - cell.count;
      scoreByCategory.set(
        cell.rowCategoryId,
        (scoreByCategory.get(cell.rowCategoryId) || 0) + weight
      );
      scoreByCategory.set(
        cell.colCategoryId,
        (scoreByCategory.get(cell.colCategoryId) || 0) + weight
      );
    }

    return Array.from(scoreByCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([categoryId]) => categoryId);
  }

  function chooseBetterCriterion(
    categoryId,
    songs,
    rowCategoryIds,
    colCategoryIds,
    criteriaByCategory,
    categoryOptionsById
  ) {
    const options = categoryOptionsById[categoryId] || [];
    if (options.length === 0) {
      return criteriaByCategory[categoryId];
    }

    let bestCriterionId = criteriaByCategory[categoryId];
    let bestScore = null;

    for (const option of options) {
      const candidateCriterionId = option.id;
      const candidateCriteria = {
        ...criteriaByCategory,
        [categoryId]: candidateCriterionId
      };
      const candidateEvaluation = evaluateBoard(
        songs,
        rowCategoryIds,
        colCategoryIds,
        candidateCriteria,
        false
      );

      const score = {
        minCount: candidateEvaluation.minCount,
        failingCount: candidateEvaluation.failingCells.length,
        totalCount: candidateEvaluation.totalCount
      };

      if (!bestScore || isScoreBetter(score, bestScore)) {
        bestScore = score;
        bestCriterionId = candidateCriterionId;
        continue;
      }

      if (isSameScore(score, bestScore) && Math.random() < 0.5) {
        bestCriterionId = candidateCriterionId;
      }
    }

    return bestCriterionId;
  }

  function isScoreBetter(candidate, currentBest) {
    if (candidate.minCount !== currentBest.minCount) {
      return candidate.minCount > currentBest.minCount;
    }
    if (candidate.failingCount !== currentBest.failingCount) {
      return candidate.failingCount < currentBest.failingCount;
    }
    return candidate.totalCount > currentBest.totalCount;
  }

  function isSameScore(left, right) {
    return (
      left.minCount === right.minCount &&
      left.failingCount === right.failingCount &&
      left.totalCount === right.totalCount
    );
  }

  function renderBoard(board) {
    ui.matrixGrid.replaceChildren();
    state.cellUiById.clear();
    state.activeCellId = "";
    hideOverlaySuggestions();
    clearOverlayFeedback();
    closeGuessOverlay();

    const fragment = document.createDocumentFragment();
    fragment.appendChild(buildCornerCard());

    for (let colIndex = 0; colIndex < GRID_DIMENSION; colIndex += 1) {
      const categoryId = board.colCategoryIds[colIndex];
      const criterionId = board.criteriaByCategory[categoryId];
      fragment.appendChild(buildAxisCard("column", categoryId, criterionId));
    }

    for (let rowIndex = 0; rowIndex < GRID_DIMENSION; rowIndex += 1) {
      const categoryId = board.rowCategoryIds[rowIndex];
      const criterionId = board.criteriaByCategory[categoryId];
      fragment.appendChild(buildAxisCard("row", categoryId, criterionId));

      for (let colIndex = 0; colIndex < GRID_DIMENSION; colIndex += 1) {
        const cell = board.cellMatrix[rowIndex][colIndex];
        fragment.appendChild(buildPlayableCell(cell));
      }
    }

    ui.matrixGrid.appendChild(fragment);
  }

  function buildCornerCard() {
    const card = document.createElement("div");
    card.className = "corner-card";
    card.setAttribute("aria-hidden", "true");
    return card;
  }

  function buildAxisCard(axis, categoryId, criterionId) {
    const card = document.createElement("article");
    card.className = `axis-card axis-${axis}`;

    const category = document.createElement("span");
    category.className = "axis-category";
    category.textContent = CATEGORY_DEFINITIONS[categoryId].label;

    const value = document.createElement("span");
    value.className = "axis-value";
    value.textContent = getCriterionLabel(categoryId, criterionId);

    card.appendChild(category);
    card.appendChild(value);
    return card;
  }

  function buildPlayableCell(cell) {
    const wrapper = document.createElement("div");
    wrapper.className = "matrix-cell matrix-cell-empty";
    wrapper.classList.add(`matrix-cell-r${cell.rowIndex}`, `matrix-cell-c${cell.colIndex}`);
    wrapper.dataset.cellId = cell.id;

    const hitbox = document.createElement("button");
    hitbox.type = "button";
    hitbox.className = "cell-hitbox";
    hitbox.setAttribute("aria-label", buildCellAriaLabel(cell));
    hitbox.addEventListener("click", () => {
      openGuessOverlay(cell.id);
    });

    wrapper.appendChild(hitbox);

    state.cellUiById.set(cell.id, {
      wrapper,
      hitbox
    });

    return wrapper;
  }

  function openGuessOverlay(cellId) {
    const cell = state.board?.cellsById.get(cellId);
    if (!cell || cell.solved) {
      return;
    }

    state.activeCellId = cellId;
    for (const [id, cellUi] of state.cellUiById.entries()) {
      cellUi.wrapper.classList.toggle("matrix-cell-active", id === cellId);
    }

    ui.overlayRule.textContent = buildCellRuleText(cell);
    ui.overlayInput.value = "";
    hideOverlaySuggestions();
    clearOverlayFeedback();

    ui.guessOverlay.classList.remove("hidden");
    requestAnimationFrame(() => {
      ui.overlayInput.focus();
    });
  }

  function closeGuessOverlay() {
    state.activeCellId = "";
    hideOverlaySuggestions();
    clearOverlayFeedback();
    ui.overlayInput.value = "";
    ui.guessOverlay.classList.add("hidden");

    for (const [, cellUi] of state.cellUiById.entries()) {
      cellUi.wrapper.classList.remove("matrix-cell-active");
    }
  }

  function onOverlaySubmit(event) {
    event.preventDefault();
    submitActiveCellGuess(ui.overlayInput.value);
  }

  function onOverlayInputChanged() {
    clearOverlayFeedback();
    const query = ui.overlayInput.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      hideOverlaySuggestions();
      return;
    }

    const suggestions = findSongSuggestions(query);
    renderOverlaySuggestions(suggestions);
  }

  function onOverlayInputKeyDown(event) {
    if (event.key === "Escape") {
      closeGuessOverlay();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitActiveCellGuess(ui.overlayInput.value);
  }

  function renderOverlaySuggestions(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      hideOverlaySuggestions();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const song of suggestions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-item";
      button.setAttribute("role", "option");
      button.textContent = song.title;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", () => {
        submitActiveCellGuess(song.title);
      });
      fragment.appendChild(button);
    }

    ui.overlaySuggestions.replaceChildren(fragment);
    ui.overlaySuggestions.classList.remove("hidden");
  }

  function hideOverlaySuggestions() {
    ui.overlaySuggestions.replaceChildren();
    ui.overlaySuggestions.classList.add("hidden");
  }

  function clearOverlayFeedback() {
    ui.overlayFeedback.textContent = "";
    ui.overlayFeedback.className = "overlay-feedback";
  }

  function setOverlayFeedback(text, type = "") {
    ui.overlayFeedback.textContent = text;
    ui.overlayFeedback.className = type
      ? `overlay-feedback ${type}`
      : "overlay-feedback";
  }

  function findSongSuggestions(rawQuery) {
    const query = toTitleKey(rawQuery);
    if (!query) {
      return [];
    }

    const matches = [];
    for (const song of state.songs) {
      if (!song.titleKey.includes(query)) {
        continue;
      }
      matches.push(song);
    }

    matches.sort((a, b) => {
      const aStarts = a.titleKey.startsWith(query);
      const bStarts = b.titleKey.startsWith(query);
      if (aStarts !== bStarts) {
        return aStarts ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });

    return matches.slice(0, MAX_SUGGESTIONS);
  }

  function submitActiveCellGuess(rawInput) {
    const cellId = state.activeCellId;
    if (!cellId) {
      return;
    }

    const cell = state.board?.cellsById.get(cellId);
    const cellUi = state.cellUiById.get(cellId);
    if (!cell || !cellUi || cell.solved) {
      return;
    }

    const titleKey = toTitleKey(rawInput);
    if (!titleKey) {
      setOverlayFeedback("Type a song title first.", "error");
      return;
    }

    const song = state.songsByTitleKey.get(titleKey);
    if (!song) {
      setOverlayFeedback("Choose a Beatles song from the dropdown.", "error");
      return;
    }

    ui.overlayInput.value = song.title;
    hideOverlaySuggestions();

    if (!cell.validTitleKeys.has(song.titleKey)) {
      setOverlayFeedback(`No match for ${buildCellRuleLabel(cell)}.`, "error");
      return;
    }

    cell.solved = true;
    cell.solvedSong = song;
    state.solvedCount += 1;
    renderSolvedCell(cellId, song);
    updateProgressLabel();
    closeGuessOverlay();
  }

  function renderSolvedCell(cellId, song) {
    const cellUi = state.cellUiById.get(cellId);
    if (!cellUi) {
      return;
    }

    const tile = document.createElement("div");
    tile.className = "solved-tile";

    const title = document.createElement("span");
    title.className = "solved-title";
    title.textContent = song.title;

    const imageShell = document.createElement("span");
    imageShell.className = "solved-image-shell";

    if (song.imageUrl) {
      const image = document.createElement("img");
      image.className = "solved-image";
      image.src = song.imageUrl;
      image.alt = `${song.title} artwork`;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        imageShell.replaceChildren(buildImageFallback());
      });
      imageShell.appendChild(image);
    } else {
      imageShell.appendChild(buildImageFallback());
    }

    tile.appendChild(title);
    tile.appendChild(imageShell);

    cellUi.wrapper.classList.add("matrix-cell-solved");
    cellUi.wrapper.classList.remove("matrix-cell-empty", "matrix-cell-active");
    cellUi.wrapper.replaceChildren(tile);
    state.cellUiById.delete(cellId);
  }

  function buildImageFallback() {
    const fallback = document.createElement("span");
    fallback.className = "image-fallback";
    fallback.textContent = "No art";
    return fallback;
  }

  function updateProgressLabel() {
    ui.progressLabel.textContent = `${state.solvedCount} / ${
      GRID_DIMENSION * GRID_DIMENSION
    } solved`;

    if (state.solvedCount === GRID_DIMENSION * GRID_DIMENSION) {
      setBoardMeta("Grid complete. Refresh for a new random board.", "success");
    }
  }

  function buildCellAriaLabel(cell) {
    const rowLabel = `${CATEGORY_DEFINITIONS[cell.rowCategoryId].label}: ${getCriterionLabel(
      cell.rowCategoryId,
      state.board.criteriaByCategory[cell.rowCategoryId]
    )}`;
    const colLabel = `${CATEGORY_DEFINITIONS[cell.colCategoryId].label}: ${getCriterionLabel(
      cell.colCategoryId,
      state.board.criteriaByCategory[cell.colCategoryId]
    )}`;
    return `Guess a song for ${rowLabel} and ${colLabel}`;
  }

  function buildCellRuleText(cell) {
    const columnLabel = `${CATEGORY_DEFINITIONS[cell.colCategoryId].label}: ${getCriterionLabel(
      cell.colCategoryId,
      state.board.criteriaByCategory[cell.colCategoryId]
    )}`;
    const rowLabel = `${CATEGORY_DEFINITIONS[cell.rowCategoryId].label}: ${getCriterionLabel(
      cell.rowCategoryId,
      state.board.criteriaByCategory[cell.rowCategoryId]
    )}`;
    return `${columnLabel} x ${rowLabel}`;
  }

  function buildCellRuleLabel(cell) {
    const rowLabel = `${CATEGORY_DEFINITIONS[cell.rowCategoryId].label} (${getCriterionLabel(
      cell.rowCategoryId,
      state.board.criteriaByCategory[cell.rowCategoryId]
    )})`;
    const colLabel = `${CATEGORY_DEFINITIONS[cell.colCategoryId].label} (${getCriterionLabel(
      cell.colCategoryId,
      state.board.criteriaByCategory[cell.colCategoryId]
    )})`;
    return `${rowLabel} + ${colLabel}`;
  }

  function getCriterionLabel(categoryId, criterionId) {
    return state.optionLabelsByCategory?.[categoryId]?.[criterionId] || criterionId;
  }

  function setBoardMeta(text, type = "") {
    ui.boardMeta.textContent = text;
    ui.boardMeta.className = type ? `meta ${type}` : "meta";
  }

  function normalizeSong(row) {
    const title = cleanText(row.Title);
    const album = cleanText(row.Album);
    const era = cleanText(row.Era);
    const leadVocalRaw = cleanText(row["Lead vocal"]);
    const chartPositionRaw = cleanText(row["Highest chart position"]);
    const wordsInTitle = Number.parseInt(cleanText(row["Words in Title"]), 10);

    if (!title || !album || !era || !Number.isInteger(wordsInTitle)) {
      return null;
    }

    return {
      title,
      titleKey: toTitleKey(title),
      album,
      era,
      leadVocalists: parseLeadVocalists(leadVocalRaw),
      chartPositionBucket: categorizeChartPosition(chartPositionRaw),
      wordsInTitle,
      isCover: parseCoverFlag(row.Cover),
      titleStartsBucket: categorizeTitleStart(title),
      imageUrl: resolveImageUrl(row)
    };
  }

  function resolveImageUrl(row) {
    const candidates = [row.Image, row["Image URL"], row["Artwork"], row["Album art"], row[""]];
    for (const value of candidates) {
      const cleaned = cleanText(value);
      if (cleaned) {
        return cleaned;
      }
    }
    return "";
  }

  function parseLeadVocalists(value) {
    if (!value) {
      return [];
    }

    const allowed = new Set(["john", "paul", "george", "ringo"]);
    const unique = new Set();

    for (const rawName of value.split(",")) {
      const name = rawName.trim().toLowerCase();
      if (allowed.has(name)) {
        unique.add(name);
      }
    }

    return Array.from(unique);
  }

  function parseCoverFlag(rawValue) {
    const cleaned = cleanText(rawValue).replace(/[\u200B-\u200D\uFEFF]/g, "");
    return cleaned === "1";
  }

  function categorizeChartPosition(rawValue) {
    const cleaned = cleanText(rawValue);
    if (cleaned === "100+") {
      return "no";
    }

    const value = Number.parseInt(cleaned, 10);
    if (Number.isFinite(value) && value >= 1 && value <= 100) {
      return "yes";
    }
    return "no";
  }

  function categorizeTitleStart(title) {
    const match = title.toUpperCase().match(/[A-Z]/);
    if (!match) {
      return "T-Z";
    }

    const charCode = match[0].charCodeAt(0);
    if (charCode <= 70) {
      return "A-F";
    }
    if (charCode <= 76) {
      return "G-L";
    }
    if (charCode <= 83) {
      return "M-S";
    }
    return "T-Z";
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
        currentRow = [];
        currentField = "";
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
      const cleaned = cleanText(value);
      return index === 0 ? cleaned.replace(/^\uFEFF/, "") : cleaned;
    });

    const records = [];
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.every((value) => cleanText(value) === "")) {
        continue;
      }

      const record = {};
      for (let j = 0; j < headers.length; j += 1) {
        record[headers[j]] = cleanText(row[j] ?? "");
      }
      records.push(record);
    }

    return records;
  }

  function uniqueOrdered(values, preferredOrder) {
    const seen = new Set();
    for (const value of values) {
      const cleaned = cleanText(value);
      if (!cleaned) {
        continue;
      }
      seen.add(cleaned);
    }

    const ordered = [];
    for (const preferred of preferredOrder) {
      if (!seen.has(preferred)) {
        continue;
      }
      ordered.push(preferred);
      seen.delete(preferred);
    }

    const remaining = Array.from(seen).sort((a, b) => a.localeCompare(b));
    return ordered.concat(remaining);
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function toTitleKey(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[’‘`]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function shuffle(values) {
    const copy = values.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function randomChoice(values) {
    return values[Math.floor(Math.random() * values.length)];
  }
})();
