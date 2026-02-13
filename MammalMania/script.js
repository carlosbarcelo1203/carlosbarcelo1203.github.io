(() => {
  "use strict";

  const DATA_FILE = "mammals2026.csv";
  const ROUND_DELAY_MS = 2000;
  const REVEAL_COUNTUP_DURATION_MS = 1000;
  const MIN_RATIO_DIFFERENCE = 0.5;
  const MIN_CONSERVATION_GAP = 2;
  const MAX_CONSECUTIVE_WINS_PER_ANIMAL = 6;
  const MAX_LIVES = 3;
  const FLEX_COUNTUP_FORMAT_KEYS = new Set(["pageviews_30d", "max_speed_mph"]);
  const AUDIO_CRITERION_KEY = "sound_url";
  const AUDIO_PRIORITY_USAGE_MULTIPLIER = 0.7;
  const DAILY_SHARE_WRONG_EMOJI = "\u274C";
  const DAILY_SHARE_FALLBACK_EMOJI = "\u2B1C";
  const DAILY_SHARE_GRID_COLUMNS = 8;
  const PACIFIC_TIME_ZONE = "America/Los_Angeles";
  const DAILY_RESET_HOUR_PT = 12;
  const STORAGE_KEY = "animal_game_progress_v1";
  const GAME_MODES = Object.freeze({
    DAILY: "daily",
    UNLIMITED: "unlimited"
  });
  const MENU_CONTEXTS = Object.freeze({
    START: "start",
    DAILY_COMPLETE: "daily_complete",
    DAILY_REPLAY_COMPLETE: "daily_replay_complete",
    UNLIMITED_COMPLETE: "unlimited_complete"
  });
  const MENU_ACTIONS = Object.freeze({
    START_DAILY: "start_daily",
    PLAY_UNLIMITED: "play_unlimited",
    REPLAY_DAILY: "replay_daily",
    SHARE_DAILY: "share_daily"
  });

  const CONSERVATION_LEVELS = {
    "least concern": 1,
    "near threatened": 2,
    vulnerable: 3,
    endangered: 4,
    "critically endangered": 5,
    "extinct in the wild": 6,
    extinct: 7
  };

  const CRITERIA = [
    {
      key: "mass_kg",
      prompt: "Which mammal has greater weight?",
      highlightText: "weight",
      description: "Compares typical adult body mass in kilograms.",
      label: "Weight",
      unit: "kg",
      digits: 3
    },
    {
      key: "lifespan_yr",
      prompt: "Which mammal has longer life expectancy?",
      highlightText: "life expectancy",
      description: "Compares typical lifespan in years.",
      label: "Life expectancy",
      unit: "years",
      digits: 2
    },
    {
      key: "gestation_days",
      prompt: "Which mammal has a longer gestation period?",
      highlightText: "gestation period",
      description: "Compares how many days this mammal is pregnant before birth.",
      label: "Gestation period",
      unit: "days",
      digits: 1
    },
    {
      key: "litter_size",
      prompt: "Which mammal has a larger litter size?",
      highlightText: "litter size",
      description: "Compares the average number of offspring born per birth event.",
      label: "Average litter size",
      unit: "",
      digits: 2
    },
    {
      key: "pageviews_30d",
      prompt: "Which mammal has higher popularity?",
      highlightText: "popularity",
      description: "Compares monthly Wikipedia page views over the last 30 days.",
      label: "Monthly page views",
      unit: "views",
      digits: 0
    },
    {
      key: "population_grp_size",
      prompt: "Which mammal has larger herd size?",
      highlightText: "herd size",
      description: "Compares typical population group size for the species.",
      label: "Group size",
      unit: "individuals",
      digits: 0
    },
    {
      key: "max_speed_mph",
      prompt: "Which mammal has higher top speed?",
      highlightText: "top speed",
      description: "Compares maximum recorded speed in miles per hour.",
      label: "Top speed",
      unit: "mph",
      digits: 1
    },
    {
      key: "sound_url",
      type: "audio_target",
      prompt: "Which of these mammals makes this sound?",
      highlightText: "makes this sound",
      description: "Play the sound clip and pick the mammal that matches it.",
      label: "Sound"
    },
    {
      key: "hibernation_b",
      type: "boolean",
      prompt: "Which of these mammals hibernates?",
      highlightText: "hibernates",
      description: "Compares whether the species hibernates.",
      label: "Hibernates"
    },
    {
      key: "migration_b",
      type: "boolean",
      prompt: "Which of these mammals migrates?",
      highlightText: "migrates",
      description: "Compares whether the species has a seasonal migration pattern.",
      label: "Migrates"
    },
    {
      key: "continent",
      type: "categorical_target",
      prompt: "Which mammal is from this continent?",
      highlightText: "continent",
      description: "Compares the continent where each species is found.",
      label: "Continent"
    },
    {
      key: "conservation_status",
      prompt: "Which mammal has higher conservation risk?",
      highlightText: "conservation risk",
      description: "Compares IUCN-style conservation status levels, where higher means more endangered.",
      label: "Conservation status",
      isEnum: true
    }
  ];
  const BRIDGE_CRITERION_KEYS = new Set(["pageviews_30d", "conservation_status"]);

  const ui = {
    appRoot: document.querySelector(".app"),
    loadingMessage: document.getElementById("loading-message"),
    errorMessage: document.getElementById("error-message"),
    gameArea: document.getElementById("game-area"),
    prompt: document.getElementById("prompt"),
    criterionDescription: document.getElementById("criterion-description"),
    audioQuestionsToggle: document.getElementById("audio-questions-toggle"),
    livesDisplay: document.getElementById("lives-display"),
    soundButton: document.getElementById("sound-button"),
    streakValue: document.getElementById("streak-value"),
    dailyScoreValue: document.getElementById("daily-score-value"),
    bestValue: document.getElementById("best-value"),
    modeIndicator: document.getElementById("mode-indicator"),
    dailyMenu: document.getElementById("daily-menu"),
    dailyMenuTitle: document.getElementById("daily-menu-title"),
    menuPrimaryButton: document.getElementById("menu-primary-button"),
    menuSecondaryButton: document.getElementById("menu-secondary-button"),
    menuTertiaryButton: document.getElementById("menu-tertiary-button"),
    cards: {
      left: document.querySelector(".animal-card[data-side='left']"),
      right: document.querySelector(".animal-card[data-side='right']")
    },
    learnButtons: {
      left: document.querySelector(".animal-card[data-side='left'] [data-role='learn']"),
      right: document.querySelector(".animal-card[data-side='right'] [data-role='learn']")
    },
    removeButtons: {
      left: document.querySelector(".animal-card[data-side='left'] [data-role='remove']"),
      right: document.querySelector(".animal-card[data-side='right'] [data-role='remove']")
    }
  };

  const state = {
    animals: [],
    csvHeaders: [],
    csvRecords: [],
    csvFileHandle: null,
    currentRound: null,
    pendingCriterionKey: null,
    criterionUsage: {},
    winnerRunAnimalId: null,
    winnerRunCount: 0,
    lives: MAX_LIVES,
    streak: 0,
    best: 0,
    dailyScoresByDate: {},
    currentMode: GAME_MODES.DAILY,
    dailySeedKey: "",
    dailyRunIsReplay: false,
    seededRandomSource: null,
    menuContext: null,
    menuFeedbackTimer: null,
    dailyLastDefeatAnimalName: "",
    dailyShareEmojiTokens: [],
    locked: false,
    allowAudioQuestions: true,
    currentRoundSoundUrl: "",
    audioPlayer: null,
    lastRenderedAnimalIds: {
      left: null,
      right: null
    },
    revealAnimationFrameIds: {
      left: null,
      right: null
    },
    nextRoundTimer: null
  };

  init();

  function init() {
    initAudioPlayer();
    wireEvents();
    loadPersistentState();
    loadAnimals();
  }

  function initAudioPlayer() {
    state.audioPlayer = new Audio();
    state.audioPlayer.preload = "none";
    state.audioPlayer.addEventListener("ended", () => {
      if (ui.soundButton && !ui.soundButton.classList.contains("hidden")) {
        setSoundButtonVisualState(false);
      }
    });
  }

  function wireEvents() {
    Object.entries(ui.cards).forEach(([side, card]) => {
      card.addEventListener("click", () => handleChoice(side));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          handleChoice(side);
        }
      });
    });

    const menuButtons = [ui.menuPrimaryButton, ui.menuSecondaryButton, ui.menuTertiaryButton];
    menuButtons.forEach((button) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        handleMenuAction(button.dataset.action || "");
      });
    });

    if (ui.soundButton) {
      ui.soundButton.addEventListener("click", () => {
        toggleRoundSound();
      });
    }

    if (ui.audioQuestionsToggle) {
      ui.audioQuestionsToggle.checked = true;
      ui.audioQuestionsToggle.addEventListener("change", () => {
        handleAudioQuestionsToggleChange();
      });
    }

    Object.values(ui.learnButtons).forEach((button) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const targetUrl = button.dataset.url || "";
        if (targetUrl) {
          window.open(targetUrl, "_blank", "noopener,noreferrer");
        }
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.stopPropagation();
        }
      });
    });

  }

  function handleAudioQuestionsToggleChange() {
    const allowAudio = !ui.audioQuestionsToggle || ui.audioQuestionsToggle.checked;
    state.allowAudioQuestions = allowAudio;

    if (allowAudio) {
      return;
    }

    stopSoundPlayback();
    hideSoundButton();

    if (state.pendingCriterionKey === AUDIO_CRITERION_KEY) {
      state.pendingCriterionKey = null;
    }

    if (!state.currentRound || state.currentRound.criterion.key !== AUDIO_CRITERION_KEY) {
      return;
    }

    clearNextRoundTimer();
    const replacementRound = createInitialRound();
    if (!replacementRound) {
      disableCardSelection(true);
      showPostGameMenu();
      return;
    }

    clearCardFeedback();
    applyRoundSelection(replacementRound);
    state.locked = false;
    hideMenu();
    renderRound();
  }


  async function loadAnimals() {
    try {
      const response = await fetch(DATA_FILE, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Could not load mammals2026.csv.");
      }

      const csvText = await response.text();
      const parsedCsv = parseCsv(csvText);
      const normalizedAnimals = normalizeAnimalRecords(parsedCsv.records);

      if (normalizedAnimals.length < 2) {
        throw new Error("The dataset needs at least two valid animals.");
      }

      state.csvHeaders = parsedCsv.headers;
      state.csvRecords = parsedCsv.records;
      state.animals = normalizedAnimals;
      ui.errorMessage.classList.add("hidden");
      ui.loadingMessage.classList.add("hidden");
      ui.gameArea.classList.remove("hidden");
      if (hasPlayedDailyChallengeToday()) {
        startNewGame(GAME_MODES.UNLIMITED);
      } else {
        startNewGame(GAME_MODES.DAILY);
        showMenu(MENU_CONTEXTS.START);
      }
    } catch (error) {
      showError(error.message || "Failed to load the animal database.");
    }
  }

  function normalizeAnimalRecords(rows) {
    const animals = rows.map((row, index) => {
      const wikiId = normalizeWhitespace(row.wikidata_id);
      const rawStatus = normalizeWhitespace(row.conservation_status);
      const statusKey = rawStatus.toLowerCase();
      const hasMappedStatus = Object.prototype.hasOwnProperty.call(CONSERVATION_LEVELS, statusKey);

      return {
        id: wikiId ? `${wikiId}-${index + 1}` : `animal-${index + 1}`,
        wikidataId: wikiId || "",
        recordIndex: index,
        name:
          normalizeWhitespace(row.wikipedia_title) ||
          normalizeWhitespace(row.scientific_name) ||
          `Animal ${index + 1}`,
        scientificName: normalizeWhitespace(row.scientific_name),
        emoji: normalizeEmojiToken(row.emoji),
        wikipediaUrl: buildWikipediaUrl(row),
        imageUrl: normalizeWhitespace(row.image_url),
        mass_kg: parseNumeric(row.mass_kg),
        lifespan_yr: parseNumeric(row.lifespan_yr),
        gestation_days: parseNumeric(row.gestation_days),
        litter_size: parseNumeric(row.litter_size),
        population_grp_size: parseNumeric(row.population_grp_size),
        max_speed_mph: parseNumeric(row.max_speed_mph),
        sound_url: normalizeWhitespace(row.sound_url),
        hibernation_b: parseBinaryFlag(row.hibernation_b),
        migration_b: parseBinaryFlag(row.migration_b),
        continent: normalizeWhitespace(row.continent),
        pageviews_30d: parseNumeric(row.pageviews_30d),
        conservationStatusDisplay: rawStatus ? titleCaseWords(rawStatus) : "Unknown",
        conservationLevel: hasMappedStatus ? CONSERVATION_LEVELS[statusKey] : null
      };
    });

    return animals.filter((animal) => {
      if (Number.isFinite(animal.conservationLevel)) {
        return true;
      }

      return CRITERIA.some((criterion) => {
        return hasCriterionValue(animal, criterion);
      });
    });
  }

  function resolveGameMode(mode) {
    if (mode === GAME_MODES.UNLIMITED) {
      return GAME_MODES.UNLIMITED;
    }
    return GAME_MODES.DAILY;
  }

  function isDailyMode() {
    return state.currentMode === GAME_MODES.DAILY;
  }

  function configureRandomSourceForCurrentMode() {
    if (isDailyMode()) {
      state.dailySeedKey = getCurrentDailySeedKey();
      state.seededRandomSource = createSeededRandomSource(state.dailySeedKey);
      return;
    }

    state.dailySeedKey = "";
    state.seededRandomSource = null;
  }

  function loadPersistentState() {
    const persisted = readPersistentState();
    state.best = persisted.best;
    state.dailyScoresByDate = persisted.dailyScoresByDate;
    updateScoreboard();
  }

  function readPersistentState() {
    const fallback = {
      best: 0,
      dailyScoresByDate: {}
    };

    let rawState = "";
    try {
      rawState = localStorage.getItem(STORAGE_KEY) || "";
    } catch (error) {
      return fallback;
    }

    if (!rawState) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(rawState);
      return {
        best: normalizeStoredScore(parsed && parsed.best),
        dailyScoresByDate: normalizeStoredDailyScores(parsed && parsed.dailyScoresByDate)
      };
    } catch (error) {
      return fallback;
    }
  }

  function savePersistentState() {
    const payload = {
      best: normalizeStoredScore(state.best),
      dailyScoresByDate: normalizeStoredDailyScores(state.dailyScoresByDate)
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
    }
  }

  function normalizeStoredScore(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return 0;
    }
    return Math.trunc(numeric);
  }

  function normalizeStoredDailyScores(dailyScoresByDate) {
    const normalized = {};
    if (!dailyScoresByDate || typeof dailyScoresByDate !== "object") {
      return normalized;
    }

    for (const [dateKey, value] of Object.entries(dailyScoresByDate)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        continue;
      }
      normalized[dateKey] = normalizeStoredScore(value);
    }

    return normalized;
  }

  function hasPlayedDailyChallengeToday() {
    const todayKey = getCurrentDailySeedKey();
    return hasDailyScoreForDate(todayKey);
  }

  function getTodayDailyScore() {
    const todayKey = getCurrentDailySeedKey();
    if (!hasDailyScoreForDate(todayKey)) {
      return null;
    }
    return normalizeStoredScore(state.dailyScoresByDate[todayKey]);
  }

  function hasDailyScoreForDate(dateKey) {
    return Object.prototype.hasOwnProperty.call(state.dailyScoresByDate, dateKey);
  }

  function recordDailyScoreOnceForDate(dateKey, score) {
    if (!dateKey || hasDailyScoreForDate(dateKey)) {
      return;
    }

    const safeScore = normalizeStoredScore(score);
    state.dailyScoresByDate[dateKey] = safeScore;

    savePersistentState();
    updateScoreboard();
  }

  function updateBestIfNeeded(score) {
    const safeScore = normalizeStoredScore(score);
    if (safeScore <= state.best) {
      return;
    }

    state.best = safeScore;
    savePersistentState();
  }

  function getCurrentDailySeedKey() {
    const now = new Date();
    const pacificNow = getDatePartsInPacific(now);
    const shouldUsePreviousPacificDate = pacificNow.hour < DAILY_RESET_HOUR_PT;

    if (!shouldUsePreviousPacificDate) {
      return buildDateKey(pacificNow.year, pacificNow.month, pacificNow.day);
    }

    const utcDateForPacificDay = new Date(Date.UTC(pacificNow.year, pacificNow.month - 1, pacificNow.day));
    utcDateForPacificDay.setUTCDate(utcDateForPacificDay.getUTCDate() - 1);

    return buildDateKey(
      utcDateForPacificDay.getUTCFullYear(),
      utcDateForPacificDay.getUTCMonth() + 1,
      utcDateForPacificDay.getUTCDate()
    );
  }

  function getDatePartsInPacific(date) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: PACIFIC_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type) => {
      const part = parts.find((entry) => entry.type === type);
      return part ? part.value : "";
    };

    return {
      year: Number(getPart("year")),
      month: Number(getPart("month")),
      day: Number(getPart("day")),
      hour: Number(getPart("hour"))
    };
  }

  function buildDateKey(year, month, day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function updateModeIndicator() {
    if (!ui.modeIndicator) {
      return;
    }

    if (ui.appRoot) {
      ui.appRoot.classList.toggle("app-daily-mode", isDailyMode());
      ui.appRoot.classList.toggle("app-unlimited-mode", !isDailyMode());
    }

    if (isDailyMode()) {
      ui.modeIndicator.textContent = "Daily Challenge";
      ui.modeIndicator.title = `Seeded by ${state.dailySeedKey} (resets 12:00 PM PT)`;
      ui.modeIndicator.classList.remove("mode-indicator-unlimited");
      ui.modeIndicator.classList.add("mode-indicator-daily");
      return;
    }

    ui.modeIndicator.textContent = "Unlimited Mode";
    ui.modeIndicator.title = "No daily seed";
    ui.modeIndicator.classList.remove("mode-indicator-daily");
    ui.modeIndicator.classList.add("mode-indicator-unlimited");
  }

  function clearMenuFeedbackTimer() {
    if (state.menuFeedbackTimer !== null) {
      clearTimeout(state.menuFeedbackTimer);
      state.menuFeedbackTimer = null;
    }
  }

  function setMenuButton(button, config) {
    if (!button) {
      return;
    }

    if (!config) {
      button.classList.add("hidden");
      button.disabled = true;
      button.removeAttribute("data-action");
      return;
    }

    button.classList.remove("hidden");
    button.disabled = false;
    button.textContent = config.label;
    button.dataset.action = config.action;
    button.classList.toggle("daily-menu-primary", config.variant === "primary");
    button.classList.toggle("daily-menu-secondary", config.variant !== "primary");
  }

  function configureMenu(context) {
    state.menuContext = context;
    clearMenuFeedbackTimer();

    if (!ui.dailyMenuTitle) {
      return;
    }

    if (context === MENU_CONTEXTS.DAILY_COMPLETE) {
      ui.dailyMenuTitle.textContent = "Daily Challenge Complete";
      setMenuButton(ui.menuPrimaryButton, {
        label: "Share",
        action: MENU_ACTIONS.SHARE_DAILY,
        variant: "primary"
      });
      setMenuButton(ui.menuSecondaryButton, {
        label: "Play Unlimited",
        action: MENU_ACTIONS.PLAY_UNLIMITED,
        variant: "secondary"
      });
      setMenuButton(ui.menuTertiaryButton, {
        label: "Replay Daily Challenge",
        action: MENU_ACTIONS.REPLAY_DAILY,
        variant: "secondary"
      });
      return;
    }

    if (context === MENU_CONTEXTS.DAILY_REPLAY_COMPLETE) {
      ui.dailyMenuTitle.textContent = "Daily Replay Complete";
      setMenuButton(ui.menuPrimaryButton, {
        label: "Play Unlimited",
        action: MENU_ACTIONS.PLAY_UNLIMITED,
        variant: "primary"
      });
      setMenuButton(ui.menuSecondaryButton, {
        label: "Replay Daily Challenge",
        action: MENU_ACTIONS.REPLAY_DAILY,
        variant: "secondary"
      });
      setMenuButton(ui.menuTertiaryButton, null);
      return;
    }

    if (context === MENU_CONTEXTS.UNLIMITED_COMPLETE) {
      ui.dailyMenuTitle.textContent = "Unlimited Round Complete";
      setMenuButton(ui.menuPrimaryButton, {
        label: "Play Unlimited",
        action: MENU_ACTIONS.PLAY_UNLIMITED,
        variant: "primary"
      });
      setMenuButton(ui.menuSecondaryButton, {
        label: "Replay Daily Challenge",
        action: MENU_ACTIONS.REPLAY_DAILY,
        variant: "secondary"
      });
      setMenuButton(ui.menuTertiaryButton, null);
      return;
    }

    ui.dailyMenuTitle.textContent = "Choose Mode";
    setMenuButton(ui.menuPrimaryButton, {
      label: "Start Daily Challenge",
      action: MENU_ACTIONS.START_DAILY,
      variant: "primary"
    });
    setMenuButton(ui.menuSecondaryButton, {
      label: "Play Unlimited",
      action: MENU_ACTIONS.PLAY_UNLIMITED,
      variant: "secondary"
    });
    setMenuButton(ui.menuTertiaryButton, null);
  }

  function handleMenuAction(action) {
    if (action === MENU_ACTIONS.START_DAILY || action === MENU_ACTIONS.REPLAY_DAILY) {
      startNewGame(GAME_MODES.DAILY);
      return;
    }

    if (action === MENU_ACTIONS.PLAY_UNLIMITED) {
      startNewGame(GAME_MODES.UNLIMITED);
      return;
    }

    if (action === MENU_ACTIONS.SHARE_DAILY) {
      void handleDailyShare();
    }
  }

  function getShareMenuButton() {
    const buttons = [ui.menuPrimaryButton, ui.menuSecondaryButton, ui.menuTertiaryButton];
    return buttons.find((button) => {
      return Boolean(button && button.dataset.action === MENU_ACTIONS.SHARE_DAILY && !button.classList.contains("hidden"));
    }) || null;
  }

  function setShareMenuButtonFeedback(text) {
    const shareButton = getShareMenuButton();
    if (!shareButton) {
      return;
    }

    clearMenuFeedbackTimer();
    shareButton.textContent = text;
    state.menuFeedbackTimer = setTimeout(() => {
      if (state.menuContext !== MENU_CONTEXTS.DAILY_COMPLETE) {
        state.menuFeedbackTimer = null;
        return;
      }
      const activeShareButton = getShareMenuButton();
      if (activeShareButton) {
        activeShareButton.textContent = "Share";
      }
      clearMenuFeedbackTimer();
    }, 1600);
  }

  function buildDailyShareMessage() {
    const lostToAnimal = state.dailyLastDefeatAnimalName || "Unknown animal";
    const pageUrl = window.location.href;
    const emojiGrid = buildDailyShareEmojiGrid();
    const baseMessage = `On today's daily challenge, I got a streak of ${state.streak}, and I lost to ${lostToAnimal}.`;

    if (!emojiGrid) {
      return `${baseMessage}\n\n${pageUrl}`;
    }

    return `${baseMessage}\n\n${emojiGrid}\n\n${pageUrl}`;
  }

  function buildDailyShareEmojiGrid() {
    if (!state.dailyShareEmojiTokens.length) {
      return "";
    }

    const rows = [];
    for (let index = 0; index < state.dailyShareEmojiTokens.length; index += DAILY_SHARE_GRID_COLUMNS) {
      rows.push(state.dailyShareEmojiTokens.slice(index, index + DAILY_SHARE_GRID_COLUMNS).join(""));
    }

    return rows.join("\n");
  }

  function appendDailyShareEmojiToken(token) {
    const normalizedToken = normalizeEmojiToken(token);
    state.dailyShareEmojiTokens.push(normalizedToken || DAILY_SHARE_FALLBACK_EMOJI);
  }

  async function handleDailyShare() {
    if (!isDailyMode() || state.menuContext !== MENU_CONTEXTS.DAILY_COMPLETE) {
      return;
    }

    const shareMessage = buildDailyShareMessage();
    const shareUrl = window.location.href;
    const sharePayload = {
      text: shareMessage,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(sharePayload);
        return;
      } catch (error) {
        if (error && error.name === "AbortError") {
          return;
        }
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(shareMessage);
        setShareMenuButtonFeedback("Copied!");
        return;
      } catch (error) {
      }
    }

    window.prompt("Copy your daily result:", shareMessage);
  }

  function hideMenu() {
    clearMenuFeedbackTimer();
    if (ui.dailyMenu) {
      ui.dailyMenu.classList.add("hidden");
    }
  }

  function showMenu(context) {
    state.locked = true;
    stopSoundPlayback();
    hideSoundButton();
    disableCardSelection(true);
    configureMenu(context);
    if (ui.dailyMenu) {
      ui.dailyMenu.classList.remove("hidden");
    }
  }

  function showPostGameMenu() {
    if (isDailyMode()) {
      if (!state.dailyRunIsReplay) {
        recordDailyScoreOnceForDate(state.dailySeedKey, state.streak);
        showMenu(MENU_CONTEXTS.DAILY_COMPLETE);
        return;
      }

      showMenu(MENU_CONTEXTS.DAILY_REPLAY_COMPLETE);
      return;
    }
    showMenu(MENU_CONTEXTS.UNLIMITED_COMPLETE);
  }

  function gameRandom() {
    if (isDailyMode() && typeof state.seededRandomSource === "function") {
      return state.seededRandomSource();
    }
    return Math.random();
  }

  function createSeededRandomSource(seedKey) {
    let seed = 2166136261;
    for (let index = 0; index < seedKey.length; index += 1) {
      seed ^= seedKey.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
    let rngState = seed >>> 0;
    if (rngState === 0) {
      rngState = 0x6d2b79f5;
    }

    return () => {
      rngState += 0x6d2b79f5;
      let t = rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function startNewGame(mode) {
    state.currentMode = resolveGameMode(mode);
    configureRandomSourceForCurrentMode();
    state.dailyRunIsReplay = isDailyMode() && hasDailyScoreForDate(state.dailySeedKey);
    updateModeIndicator();
    clearNextRoundTimer();
    stopAllRevealAnimations();
    stopSoundPlayback();
    hideSoundButton();
    state.currentRound = null;
    state.streak = 0;
    state.lives = MAX_LIVES;
    state.winnerRunAnimalId = null;
    state.winnerRunCount = 0;
    state.dailyLastDefeatAnimalName = "";
    state.dailyShareEmojiTokens = [];
    state.pendingCriterionKey = null;
    state.lastRenderedAnimalIds.left = null;
    state.lastRenderedAnimalIds.right = null;
    state.menuContext = null;
    resetCriterionUsage();
    state.locked = false;
    updateScoreboard();
    updateLivesDisplay();
    hideMenu();

    if (state.animals.length < 2) {
      disableCardSelection(true);
      return;
    }

    const initialSelection = createInitialRound();
    if (!initialSelection) {
      disableCardSelection(true);
      return;
    }

    applyRoundSelection(initialSelection);
    renderRound();
  }

  function handleChoice(side) {
    if (state.locked || !state.currentRound) {
      return;
    }

    state.locked = true;
    stopSoundPlayback();
    hideSoundButton();
    disableCardSelection(true);

    const round = state.currentRound;
    const winningSide = getWinningSide(round.left, round.right, round.criterion, round.criterionContext);
    const guessedCorrect = side === winningSide;
    const winnerAnimal = winningSide === "left" ? round.left : round.right;
    const loserAnimal = winningSide === "left" ? round.right : round.left;

    revealCurrentValues();
    clearCardFeedback();
    ui.cards[winningSide].classList.add("correct");
    if (!guessedCorrect) {
      if (isDailyMode()) {
        state.dailyLastDefeatAnimalName = normalizeWhitespace(winnerAnimal.name);
        appendDailyShareEmojiToken(DAILY_SHARE_WRONG_EMOJI);
      }
      ui.cards[side].classList.add("wrong");
      showLifeLossIndicator(side);
    }

    trackWinnerRun(winnerAnimal);
    const summary = buildRoundSummary(round);

    if (guessedCorrect) {
      if (isDailyMode()) {
        appendDailyShareEmojiToken(winnerAnimal.emoji);
      }
      state.streak += 1;
      updateBestIfNeeded(state.streak);
      updateScoreboard();

      moveToNextRound(winnerAnimal, winningSide, loserAnimal.id);
      return;
    }

    state.lives -= 1;
    updateLivesDisplay();

    if (state.lives <= 0) {
      showPostGameMenu();
      return;
    }

    const lifeWord = state.lives === 1 ? "life" : "lives";
    moveToNextRound(winnerAnimal, winningSide, loserAnimal.id);
  }

  function moveToNextRound(winnerAnimal, winnerSide, loserAnimalId) {
    clearNextRoundTimer();
    state.nextRoundTimer = setTimeout(() => {
      const nextSelection = createNextRound(winnerAnimal, winnerSide, loserAnimalId);
      if (!nextSelection) {
        showPostGameMenu();
        return;
      }

      applyRoundSelection(nextSelection);
      state.locked = false;
      renderRound();
    }, ROUND_DELAY_MS);
  }

  function createInitialRound() {
    const shuffledAnchors = shuffle(state.animals.slice());

    for (const anchor of shuffledAnchors) {
      const selection = chooseComparisonForAnchor(anchor, new Set(), null);
      if (!selection) {
        continue;
      }

      if (gameRandom() < 0.5) {
        const result = {
          round: {
            left: anchor,
            right: selection.candidate,
            criterion: selection.criterion,
            criterionContext: selection.criterionContext || null
          }
        };
        if (Object.prototype.hasOwnProperty.call(selection, "pendingCriterionKey")) {
          result.pendingCriterionKey = selection.pendingCriterionKey;
        }
        return result;
      }

      const result = {
        round: {
          left: selection.candidate,
          right: anchor,
          criterion: selection.criterion,
          criterionContext: selection.criterionContext || null
        }
      };
      if (Object.prototype.hasOwnProperty.call(selection, "pendingCriterionKey")) {
        result.pendingCriterionKey = selection.pendingCriterionKey;
      }
      return result;
    }

    return null;
  }

  function createNextRound(winnerAnimal, winnerSide, loserAnimalId) {
    const disallowedCriterionKey = state.currentRound ? state.currentRound.criterion.key : null;
    const requireWinnerToLose =
      state.winnerRunAnimalId === winnerAnimal.id && state.winnerRunCount >= MAX_CONSECUTIVE_WINS_PER_ANIMAL;

    const constraints = {
      disallowedCriterionKey,
      requireAnchorToLose: requireWinnerToLose
    };

    let selection = chooseComparisonForAnchor(winnerAnimal, new Set([loserAnimalId]), constraints);
    if (!selection) {
      selection = chooseComparisonForAnchor(winnerAnimal, new Set(), constraints);
    }

    if (!selection) {
      return null;
    }

    if (winnerSide === "left") {
      const result = {
        round: {
          left: winnerAnimal,
          right: selection.candidate,
          criterion: selection.criterion,
          criterionContext: selection.criterionContext || null
        }
      };
      if (Object.prototype.hasOwnProperty.call(selection, "pendingCriterionKey")) {
        result.pendingCriterionKey = selection.pendingCriterionKey;
      }
      return result;
    }

    const result = {
      round: {
        left: selection.candidate,
        right: winnerAnimal,
        criterion: selection.criterion,
        criterionContext: selection.criterionContext || null
      }
    };
    if (Object.prototype.hasOwnProperty.call(selection, "pendingCriterionKey")) {
      result.pendingCriterionKey = selection.pendingCriterionKey;
    }
    return result;
  }

  function applyRoundSelection(selection) {
    state.currentRound = selection.round;
    if (Object.prototype.hasOwnProperty.call(selection, "pendingCriterionKey")) {
      state.pendingCriterionKey = selection.pendingCriterionKey;
    }
    recordCriterionUsage(selection.round.criterion.key);
  }

  function chooseComparisonForAnchor(anchor, exclusions, constraints) {
    const ruleSet = constraints || {};
    const candidateMap = buildCandidateMap(anchor, exclusions, ruleSet);
    const pendingKey = getEnabledPendingCriterionKey(state.pendingCriterionKey);
    if (pendingKey !== state.pendingCriterionKey) {
      state.pendingCriterionKey = pendingKey;
    }
    const priorityList = buildCriterionPriorityList(pendingKey);

    for (const criterion of priorityList) {
      if (ruleSet.disallowedCriterionKey && criterion.key === ruleSet.disallowedCriterionKey) {
        continue;
      }

      const candidates = candidateMap.get(criterion.key);
      if (candidates && candidates.length) {
        const picked = randomFrom(candidates);
        const selection = {
          candidate: picked.candidate,
          criterion,
          criterionContext: picked.criterionContext || null
        };
        if (pendingKey && criterion.key === pendingKey) {
          selection.pendingCriterionKey = null;
        }
        return selection;
      }

      if (!BRIDGE_CRITERION_KEYS.has(criterion.key)) {
        const bridgeSelection = findBridgeSelection(anchor, criterion, exclusions, ruleSet);
        if (bridgeSelection) {
          return {
            candidate: bridgeSelection.candidate,
            criterion: bridgeSelection.criterion,
            criterionContext: bridgeSelection.criterionContext || null,
            pendingCriterionKey: criterion.key
          };
        }
      }
    }

    const fallbackOptions = buildOptionsForAnchor(anchor, exclusions, ruleSet);
    if (!fallbackOptions.length) {
      return null;
    }

    const choice = randomFrom(fallbackOptions);
    const fallbackSelection = {
      candidate: choice.candidate,
      criterion: choice.criterion,
      criterionContext: choice.criterionContext || null
    };
    if (pendingKey && choice.criterion.key === pendingKey) {
      fallbackSelection.pendingCriterionKey = null;
    }
    return fallbackSelection;
  }

  function buildCandidateMap(anchor, exclusions, constraints) {
    const candidateMap = new Map();
    for (const criterion of getActiveCriteria()) {
      if (constraints && constraints.disallowedCriterionKey === criterion.key) {
        continue;
      }
      const candidates = getCandidatesForCriterion(anchor, criterion, exclusions, constraints);
      if (candidates.length) {
        candidateMap.set(criterion.key, candidates);
      }
    }
    return candidateMap;
  }

  function getCandidatesForCriterion(anchor, criterion, exclusions, constraints) {
    if (criterion.type === "categorical_target" || criterion.type === "audio_target") {
      return getTargetQuestionCandidates(anchor, criterion, exclusions, constraints);
    }

    const candidates = [];
    const ruleSet = constraints || {};

    for (const candidate of state.animals) {
      if (candidate.id === anchor.id) {
        continue;
      }
      if (exclusions && exclusions.has(candidate.id)) {
        continue;
      }
      if (!hasComparableValues(anchor, candidate, criterion)) {
        continue;
      }
      if (!passesThreshold(anchor, candidate, criterion)) {
        continue;
      }
      if (ruleSet.requireAnchorToLose && getWinningSide(anchor, candidate, criterion, null) !== "right") {
        continue;
      }
      candidates.push({ candidate, criterionContext: null });
    }

    return candidates;
  }

  function getTargetQuestionCandidates(anchor, criterion, exclusions, constraints) {
    const candidates = [];
    const ruleSet = constraints || {};
    const anchorValue = normalizeWhitespace(anchor[criterion.key]);
    const isAudioTarget = criterion.type === "audio_target";

    if (!isAudioTarget && !anchorValue) {
      return candidates;
    }

    for (const candidate of state.animals) {
      if (candidate.id === anchor.id) {
        continue;
      }
      if (exclusions && exclusions.has(candidate.id)) {
        continue;
      }

      const candidateValue = normalizeWhitespace(candidate[criterion.key]);
      const options = [];

      if (isAudioTarget) {
        const hasAnchorSound = Boolean(anchorValue);
        const hasCandidateSound = Boolean(candidateValue);

        if (!hasAnchorSound && !hasCandidateSound) {
          continue;
        }

        const sameSound = hasAnchorSound && hasCandidateSound && anchorValue === candidateValue;
        if (sameSound) {
          continue;
        }

        if (hasAnchorSound) {
          options.push({
            winningSide: "left",
            criterionContext: buildTargetQuestionContext(criterion, anchorValue)
          });
        }

        if (hasCandidateSound) {
          options.push({
            winningSide: "right",
            criterionContext: buildTargetQuestionContext(criterion, candidateValue)
          });
        }
      } else {
        if (!candidateValue || candidateValue.toLowerCase() === anchorValue.toLowerCase()) {
          continue;
        }

        options.push(
          {
            winningSide: "left",
            criterionContext: buildTargetQuestionContext(criterion, anchorValue)
          },
          {
            winningSide: "right",
            criterionContext: buildTargetQuestionContext(criterion, candidateValue)
          }
        );
      }

      for (const option of options) {
        if (ruleSet.requireAnchorToLose && option.winningSide !== "right") {
          continue;
        }
        candidates.push({
          candidate,
          criterionContext: option.criterionContext
        });
      }
    }

    return candidates;
  }

  function buildTargetQuestionContext(criterion, targetValue) {
    const cleanTarget = normalizeWhitespace(targetValue);

    if (criterion.type === "audio_target") {
      return {
        targetValue: cleanTarget,
        audioUrl: cleanTarget,
        promptText: "Which of these mammals makes this sound?",
        highlightText: "makes this sound",
        descriptionText: "Play the sound clip and choose the mammal that matches it."
      };
    }

    return {
      targetValue: cleanTarget,
      promptText: `Which mammal is from ${cleanTarget}?`,
      highlightText: cleanTarget,
      descriptionText: `Compares whether each species is found in ${cleanTarget}.`
    };
  }

  function findBridgeSelection(anchor, targetCriterion, exclusions, constraints) {
    const ruleSet = constraints || {};
    const eligibleCandidates = [];

    for (const candidate of state.animals) {
      if (candidate.id === anchor.id) {
        continue;
      }
      if (exclusions && exclusions.has(candidate.id)) {
        continue;
      }
      if (!hasCriterionValue(candidate, targetCriterion)) {
        continue;
      }
      eligibleCandidates.push(candidate);
    }

    if (!eligibleCandidates.length) {
      return null;
    }

    const bridgeCriteria = buildBridgePriorityList(ruleSet.disallowedCriterionKey);
    for (const bridgeCriterion of bridgeCriteria) {
      const preferred = [];
      const fallback = [];

      for (const candidate of eligibleCandidates) {
        if (!hasComparableValues(anchor, candidate, bridgeCriterion)) {
          continue;
        }
        if (!passesThreshold(anchor, candidate, bridgeCriterion)) {
          continue;
        }

        const winningSide = getWinningSide(anchor, candidate, bridgeCriterion, null);
        if (ruleSet.requireAnchorToLose && winningSide !== "right") {
          continue;
        }

        const entry = { candidate, criterion: bridgeCriterion };
        if (winningSide === "right") {
          preferred.push(entry);
        } else {
          fallback.push(entry);
        }
      }

      if (preferred.length) {
        return randomFrom(preferred);
      }
      if (!ruleSet.requireAnchorToLose && fallback.length) {
        return randomFrom(fallback);
      }
    }

    return null;
  }

  function buildCriterionPriorityList(pendingKey) {
    const grouped = new Map();
    for (const criterion of getActiveCriteria()) {
      const score = getCriterionPriorityScore(criterion);
      if (!grouped.has(score)) {
        grouped.set(score, []);
      }
      grouped.get(score).push(criterion);
    }

    const orderedCounts = Array.from(grouped.keys()).sort((a, b) => a - b);
    const priorityList = [];
    for (const count of orderedCounts) {
      const group = grouped.get(count);
      priorityList.push(...shuffle(group.slice()));
    }

    if (!pendingKey) {
      return priorityList;
    }

    const pendingCriterion = getActiveCriteria().find((criterion) => criterion.key === pendingKey);
    if (!pendingCriterion) {
      return priorityList;
    }

    return [pendingCriterion, ...priorityList.filter((criterion) => criterion.key !== pendingKey)];
  }

  function buildBridgePriorityList(disallowedKey) {
    const bridgeCriteria = getActiveCriteria().filter((criterion) => BRIDGE_CRITERION_KEYS.has(criterion.key));
    const grouped = new Map();
    for (const criterion of bridgeCriteria) {
      if (criterion.key === disallowedKey) {
        continue;
      }
      const score = getCriterionPriorityScore(criterion);
      if (!grouped.has(score)) {
        grouped.set(score, []);
      }
      grouped.get(score).push(criterion);
    }

    const orderedCounts = Array.from(grouped.keys()).sort((a, b) => a - b);
    const priorityList = [];
    for (const count of orderedCounts) {
      const group = grouped.get(count);
      priorityList.push(...shuffle(group.slice()));
    }

    return priorityList;
  }

  function getActiveCriteria() {
    return CRITERIA.filter((criterion) => isCriterionEnabled(criterion));
  }

  function isCriterionEnabled(criterion) {
    if (!criterion) {
      return false;
    }
    if (criterion.key === AUDIO_CRITERION_KEY) {
      return state.allowAudioQuestions;
    }
    return true;
  }

  function getEnabledPendingCriterionKey(pendingKey) {
    if (!pendingKey) {
      return null;
    }
    const pendingCriterion = CRITERIA.find((criterion) => criterion.key === pendingKey);
    if (!pendingCriterion || !isCriterionEnabled(pendingCriterion)) {
      return null;
    }
    return pendingKey;
  }

  function getCriterionPriorityScore(criterion) {
    const usage = getCriterionUsage(criterion.key);
    if (criterion.key !== AUDIO_CRITERION_KEY) {
      return usage;
    }
    return Number((usage * AUDIO_PRIORITY_USAGE_MULTIPLIER).toFixed(4));
  }

  function resetCriterionUsage() {
    state.criterionUsage = {};
    for (const criterion of CRITERIA) {
      state.criterionUsage[criterion.key] = 0;
    }
  }

  function recordCriterionUsage(criterionKey) {
    if (!criterionKey) {
      return;
    }
    state.criterionUsage[criterionKey] = getCriterionUsage(criterionKey) + 1;
  }

  function getCriterionUsage(criterionKey) {
    return state.criterionUsage[criterionKey] || 0;
  }

  function hasCriterionValue(animal, criterion) {
    if (criterion.isEnum) {
      return Number.isFinite(animal.conservationLevel);
    }
    if (criterion.type === "boolean") {
      return isValidBinaryFlag(animal[criterion.key]);
    }
    if (criterion.type === "categorical_target" || criterion.type === "audio_target") {
      return Boolean(normalizeWhitespace(animal[criterion.key]));
    }
    return isValidNumericComparisonValue(animal[criterion.key]);
  }

  function buildOptionsForAnchor(anchor, exclusions, constraints) {
    const options = [];
    const ruleSet = constraints || {};

    for (const criterion of getActiveCriteria()) {
      if (ruleSet.disallowedCriterionKey && criterion.key === ruleSet.disallowedCriterionKey) {
        continue;
      }

      const candidates = getCandidatesForCriterion(anchor, criterion, exclusions, ruleSet);
      for (const candidateEntry of candidates) {
        options.push({
          candidate: candidateEntry.candidate,
          criterion,
          criterionContext: candidateEntry.criterionContext || null
        });
      }
    }

    return options;
  }

  function hasComparableValues(animalA, animalB, criterion) {
    if (criterion.isEnum) {
      return Number.isFinite(animalA.conservationLevel) && Number.isFinite(animalB.conservationLevel);
    }
    if (criterion.type === "boolean") {
      return isValidBinaryFlag(animalA[criterion.key]) && isValidBinaryFlag(animalB[criterion.key]);
    }
    if (criterion.type === "categorical_target" || criterion.type === "audio_target") {
      const leftValue = normalizeWhitespace(animalA[criterion.key]);
      const rightValue = normalizeWhitespace(animalB[criterion.key]);
      if (criterion.type === "audio_target") {
        return Boolean(leftValue) || Boolean(rightValue);
      }
      return Boolean(leftValue) && Boolean(rightValue);
    }
    return isValidNumericComparisonValue(animalA[criterion.key]) && isValidNumericComparisonValue(animalB[criterion.key]);
  }

  function passesThreshold(animalA, animalB, criterion) {
    if (criterion.isEnum) {
      return Math.abs(animalA.conservationLevel - animalB.conservationLevel) >= MIN_CONSERVATION_GAP;
    }
    if (criterion.type === "boolean") {
      return animalA[criterion.key] !== animalB[criterion.key];
    }
    if (criterion.type === "categorical_target") {
      return normalizeWhitespace(animalA[criterion.key]).toLowerCase() !== normalizeWhitespace(animalB[criterion.key]).toLowerCase();
    }
    if (criterion.type === "audio_target") {
      const leftValue = normalizeWhitespace(animalA[criterion.key]);
      const rightValue = normalizeWhitespace(animalB[criterion.key]);
      if (!leftValue && !rightValue) {
        return false;
      }
      if (leftValue && rightValue) {
        return leftValue !== rightValue;
      }
      return true;
    }

    const leftValue = animalA[criterion.key];
    const rightValue = animalB[criterion.key];
    const difference = Math.abs(leftValue - rightValue);
    const smallerMagnitude = Math.min(Math.abs(leftValue), Math.abs(rightValue));

    if (smallerMagnitude === 0) {
      const largerMagnitude = Math.max(Math.abs(leftValue), Math.abs(rightValue));
      if (largerMagnitude === 0) {
        return false;
      }
      return difference / largerMagnitude >= MIN_RATIO_DIFFERENCE;
    }

    return difference / smallerMagnitude >= MIN_RATIO_DIFFERENCE;
  }

  function getWinningSide(leftAnimal, rightAnimal, criterion, criterionContext) {
    if (criterion.type === "categorical_target" || criterion.type === "audio_target") {
      const targetValue = normalizeWhitespace(criterionContext && criterionContext.targetValue);
      const leftValue = normalizeWhitespace(leftAnimal[criterion.key]);
      const rightValue = normalizeWhitespace(rightAnimal[criterion.key]);

      const leftMatches = criterion.type === "categorical_target"
        ? Boolean(targetValue) && leftValue.toLowerCase() === targetValue.toLowerCase()
        : Boolean(targetValue) && leftValue === targetValue;
      const rightMatches = criterion.type === "categorical_target"
        ? Boolean(targetValue) && rightValue.toLowerCase() === targetValue.toLowerCase()
        : Boolean(targetValue) && rightValue === targetValue;

      if (leftMatches === rightMatches) {
        return "left";
      }
      return leftMatches ? "left" : "right";
    }

    const leftValue = criterion.isEnum ? leftAnimal.conservationLevel : leftAnimal[criterion.key];
    const rightValue = criterion.isEnum ? rightAnimal.conservationLevel : rightAnimal[criterion.key];

    if (leftValue === rightValue) {
      return "left";
    }
    return leftValue > rightValue ? "left" : "right";
  }

  function trackWinnerRun(winnerAnimal) {
    if (state.winnerRunAnimalId === winnerAnimal.id) {
      state.winnerRunCount += 1;
      return;
    }

    state.winnerRunAnimalId = winnerAnimal.id;
    state.winnerRunCount = 1;
  }

  function renderRound() {
    if (!state.currentRound) {
      return;
    }

    stopAllRevealAnimations();
    stopSoundPlayback();
    const round = state.currentRound;
    renderPrompt(round.criterion, round.criterionContext);
    ui.criterionDescription.textContent =
      (round.criterionContext && round.criterionContext.descriptionText) || round.criterion.description || "";
    updateSoundButton(round);
    clearCardFeedback();
    const shouldAnimateLeft = state.lastRenderedAnimalIds.left !== round.left.id;
    const shouldAnimateRight = state.lastRenderedAnimalIds.right !== round.right.id;
    populateCard("left", round.left, round.criterion, shouldAnimateLeft);
    populateCard("right", round.right, round.criterion, shouldAnimateRight);
    state.lastRenderedAnimalIds.left = round.left.id;
    state.lastRenderedAnimalIds.right = round.right.id;
    disableCardSelection(false);
  }

  function updateSoundButton(round) {
    if (!ui.soundButton) {
      return;
    }

    if (!state.allowAudioQuestions || round.criterion.type !== "audio_target") {
      hideSoundButton();
      return;
    }

    const audioUrl = normalizeWhitespace(round.criterionContext && round.criterionContext.audioUrl);
    if (!audioUrl) {
      hideSoundButton();
      return;
    }

    state.currentRoundSoundUrl = audioUrl;
    ui.soundButton.classList.remove("hidden");
    setSoundButtonVisualState(false);
  }

  function hideSoundButton() {
    state.currentRoundSoundUrl = "";
    if (!ui.soundButton) {
      return;
    }
    ui.soundButton.classList.add("hidden");
    setSoundButtonVisualState(false);
  }

  function setSoundButtonVisualState(isPlaying) {
    if (!ui.soundButton) {
      return;
    }

    ui.soundButton.classList.toggle("playing", isPlaying);
    ui.soundButton.textContent = isPlaying ? "Stop" : "Play";
    ui.soundButton.setAttribute("aria-label", isPlaying ? "Stop sound clip" : "Play sound clip");
    ui.soundButton.title = isPlaying ? "Stop sound" : "Play sound";
  }

  function toggleRoundSound() {
    const audioUrl = state.currentRoundSoundUrl;
    if (!audioUrl || !state.audioPlayer) {
      return;
    }

    if (state.audioPlayer.src !== audioUrl) {
      state.audioPlayer.src = audioUrl;
    }

    if (!state.audioPlayer.paused && !state.audioPlayer.ended) {
      stopSoundPlayback({ keepButtonVisible: true });
      return;
    }

    state.audioPlayer.currentTime = 0;
    state.audioPlayer.play().then(() => {
      if (!ui.soundButton || ui.soundButton.classList.contains("hidden")) {
        return;
      }
      setSoundButtonVisualState(true);
    }).catch(() => {
    });
  }

  function stopSoundPlayback(options) {
    const keepButtonVisible = Boolean(options && options.keepButtonVisible);
    if (state.audioPlayer) {
      state.audioPlayer.pause();
      try {
        state.audioPlayer.currentTime = 0;
      } catch (error) {
        // no-op: some streams may not allow setting currentTime immediately
      }
    }

    if (!keepButtonVisible) {
      return;
    }

    if (ui.soundButton && !ui.soundButton.classList.contains("hidden")) {
      setSoundButtonVisualState(false);
    }
  }

  function renderPrompt(criterion, criterionContext) {
    ui.prompt.replaceChildren();

    const promptText = (criterionContext && criterionContext.promptText) || criterion.prompt || "";
    const highlightText = (criterionContext && criterionContext.highlightText) || criterion.highlightText || criterion.label || "";
    if (!highlightText) {
      ui.prompt.textContent = promptText;
      return;
    }

    const promptLower = promptText.toLowerCase();
    const highlightLower = highlightText.toLowerCase();
    const startIndex = promptLower.indexOf(highlightLower);

    if (startIndex < 0) {
      ui.prompt.textContent = promptText;
      return;
    }

    const endIndex = startIndex + highlightText.length;
    const beforeText = promptText.slice(0, startIndex);
    const matchedText = promptText.slice(startIndex, endIndex);
    const afterText = promptText.slice(endIndex);

    const highlightEl = document.createElement("span");
    highlightEl.className = "prompt-criterion";
    highlightEl.textContent = matchedText;

    ui.prompt.append(beforeText.trimEnd(), document.createElement("br"), highlightEl, afterText);
  }

  function populateCard(side, animal, criterion, shouldAnimate) {
    const card = ui.cards[side];
    const nameEl = card.querySelector("[data-role='name']");
    const scientificEl = card.querySelector("[data-role='scientific']");
    const learnButtonEl = card.querySelector("[data-role='learn']");
    const valueEl = card.querySelector("[data-role='value']");
    const imageEl = card.querySelector("[data-role='image']");
    const fallbackEl = card.querySelector("[data-role='fallback']");
    const lifeLossEl = card.querySelector("[data-role='life-loss']");

    nameEl.textContent = animal.name;
    scientificEl.textContent = animal.scientificName || "Scientific name unavailable";
    if (animal.wikipediaUrl) {
      learnButtonEl.dataset.url = animal.wikipediaUrl;
      learnButtonEl.classList.remove("hidden");
    } else {
      delete learnButtonEl.dataset.url;
      learnButtonEl.classList.add("hidden");
    }
    valueEl.replaceChildren();
    const valueLabelEl = document.createElement("span");
    valueLabelEl.className = "animal-value-label";
    valueLabelEl.textContent = criterion.label;
    const valueNumberEl = document.createElement("span");
    valueNumberEl.className = "animal-value-number";
    const useFixedWidthCountFormat = shouldUseFixedWidthCountFormat(criterion);
    const finalValueText = formatCriterionValue(animal, criterion, { fixedWidth: useFixedWidthCountFormat });
    const animatable = isNumericCriterion(criterion) && Number.isFinite(animal[criterion.key]);
    valueNumberEl.dataset.finalText = finalValueText;
    valueNumberEl.dataset.animatable = String(animatable);
    valueNumberEl.dataset.fixedWidth = String(useFixedWidthCountFormat);
    valueNumberEl.dataset.rawValue = animatable ? String(animal[criterion.key]) : "";
    valueNumberEl.dataset.digits = String(criterion.digits || 0);
    valueNumberEl.dataset.unit = criterion.unit || "";
    valueNumberEl.textContent = finalValueText;
    valueEl.append(valueLabelEl, valueNumberEl);
    valueEl.classList.add("hidden");
    valueNumberEl.classList.remove("counting");
    card.classList.remove("revealed");
    if (lifeLossEl) {
      lifeLossEl.classList.add("hidden");
      lifeLossEl.classList.remove("show");
    }

    // Clear stale image content first so the old photo never lingers while a new one loads.
    const requestToken = `${animal.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    card.dataset.imageRequestToken = requestToken;
    imageEl.onload = null;
    imageEl.onerror = null;
    imageEl.classList.add("hidden");
    fallbackEl.classList.add("hidden");
    imageEl.removeAttribute("src");

    if (animal.imageUrl) {
      imageEl.onload = () => {
        if (card.dataset.imageRequestToken !== requestToken) {
          return;
        }
        imageEl.classList.remove("hidden");
        fallbackEl.classList.add("hidden");
      };
      imageEl.onerror = () => {
        if (card.dataset.imageRequestToken !== requestToken) {
          return;
        }
        imageEl.classList.add("hidden");
        fallbackEl.classList.remove("hidden");
      };
      imageEl.src = animal.imageUrl;
      imageEl.alt = animal.name;
    } else {
      imageEl.removeAttribute("src");
      imageEl.classList.add("hidden");
      fallbackEl.classList.remove("hidden");
    }

    triggerCardAnimation(card, side, shouldAnimate);
  }

  function showLifeLossIndicator(side) {
    const card = ui.cards[side];
    if (!card) {
      return;
    }

    const indicator = card.querySelector("[data-role='life-loss']");
    if (!indicator) {
      return;
    }

    indicator.classList.remove("show");
    indicator.classList.add("hidden");
    void indicator.offsetWidth;
    indicator.classList.remove("hidden");
    indicator.classList.add("show");
  }

  function triggerCardAnimation(card, side, shouldAnimate) {
    card.classList.remove("entering-left", "entering-right");
    if (!shouldAnimate) {
      return;
    }

    const animationClass = side === "left" ? "entering-left" : "entering-right";
    void card.offsetWidth;
    card.classList.add(animationClass);
  }

  function revealCurrentValues() {
    Object.entries(ui.cards).forEach(([side, card]) => {
      const valueEl = card.querySelector("[data-role='value']");
      valueEl.classList.remove("hidden");
      card.classList.add("revealed");
      startRevealCountup(side, card);
    });
  }

  function startRevealCountup(side, card) {
    stopRevealCountup(side);

    const numberEl = card.querySelector(".animal-value-number");
    if (!numberEl) {
      return;
    }

    const finalText = numberEl.dataset.finalText || numberEl.textContent || "";
    const animatable = numberEl.dataset.animatable === "true";
    const fixedWidth = numberEl.dataset.fixedWidth === "true";
    const rawValue = Number(numberEl.dataset.rawValue);
    const digits = Number(numberEl.dataset.digits || 0);
    const unit = numberEl.dataset.unit || "";

    if (!animatable || !Number.isFinite(rawValue)) {
      numberEl.classList.remove("counting");
      numberEl.textContent = finalText;
      return;
    }

    numberEl.classList.add("counting");
    numberEl.textContent = formatRevealCountValue(0, digits, unit, rawValue, fixedWidth);

    const startTime = performance.now();
    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / REVEAL_COUNTUP_DURATION_MS);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const displayedValue = rawValue * easedProgress;

      numberEl.textContent = formatRevealCountValue(displayedValue, digits, unit, rawValue, fixedWidth);

      if (progress < 1) {
        state.revealAnimationFrameIds[side] = requestAnimationFrame(step);
        return;
      }

      numberEl.textContent = finalText;
      numberEl.classList.remove("counting");
      state.revealAnimationFrameIds[side] = null;
    };

    state.revealAnimationFrameIds[side] = requestAnimationFrame(step);
  }

  function stopRevealCountup(side) {
    const frameId = state.revealAnimationFrameIds[side];
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      state.revealAnimationFrameIds[side] = null;
    }
  }

  function stopAllRevealAnimations() {
    stopRevealCountup("left");
    stopRevealCountup("right");
  }

  function formatRevealCountValue(value, digits, unit, targetValue, fixedWidth) {
    const safeDigits = Number.isFinite(digits) && digits >= 0 ? digits : 0;
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    const safeTargetValue = Number.isFinite(targetValue) ? Math.max(0, targetValue) : safeValue;
    const formatted = fixedWidth
      ? formatFixedWidthNumeric(safeValue, safeDigits, safeTargetValue)
      : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: safeDigits
      }).format(safeValue);

    if (!unit) {
      return formatted;
    }
    return `${formatted} ${unit}`;
  }

  function clearCardFeedback() {
    Object.values(ui.cards).forEach((card) => {
      card.classList.remove("correct", "wrong");
    });
  }

  function disableCardSelection(disabled) {
    Object.values(ui.cards).forEach((card) => {
      card.classList.toggle("disabled", disabled);
      card.setAttribute("aria-disabled", String(disabled));
      card.tabIndex = disabled ? -1 : 0;
    });
  }

  function updateScoreboard() {
    ui.streakValue.textContent = String(state.streak);
    ui.bestValue.textContent = String(state.best);
    if (ui.dailyScoreValue) {
      const todayDailyScore = getTodayDailyScore();
      ui.dailyScoreValue.textContent = Number.isFinite(todayDailyScore) ? String(todayDailyScore) : "-";
    }
  }

  function updateLivesDisplay() {
    if (!ui.livesDisplay) {
      return;
    }

    ui.livesDisplay.replaceChildren();
    for (let index = 0; index < MAX_LIVES; index += 1) {
      const heart = document.createElement("span");
      heart.className = "life-heart";
      if (index >= state.lives) {
        heart.classList.add("lost");
      }
      heart.setAttribute("aria-hidden", "true");
      heart.innerHTML = "&#10084;";
      ui.livesDisplay.appendChild(heart);
    }

    const lifeWord = state.lives === 1 ? "life" : "lives";
    ui.livesDisplay.setAttribute("aria-label", `${state.lives} ${lifeWord} remaining`);
  }


  function buildRoundSummary(round) {
    const leftValue = formatCriterionValue(round.left, round.criterion);
    const rightValue = formatCriterionValue(round.right, round.criterion);
    return `${round.left.name}: ${leftValue} vs ${round.right.name}: ${rightValue}.`;
  }

  function formatCriterionValue(animal, criterion, options) {
    if (criterion.isEnum) {
      return animal.conservationStatusDisplay || "Unknown";
    }

    if (criterion.type === "boolean") {
      const value = animal[criterion.key];
      if (!isValidBinaryFlag(value)) {
        return "Unknown";
      }
      return value === 1 ? "Yes" : "No";
    }

    if (criterion.type === "categorical_target") {
      const value = normalizeWhitespace(animal[criterion.key]);
      return value || "Unknown";
    }

    if (criterion.type === "audio_target") {
      const value = normalizeWhitespace(animal[criterion.key]);
      return value ? "Audio clip" : " ";
    }

    const rawValue = animal[criterion.key];
    if (!isValidNumericComparisonValue(rawValue)) {
      return "Unknown";
    }

    const useFixedWidth = Boolean(options && options.fixedWidth);
    if (useFixedWidth) {
      return formatRevealCountValue(rawValue, criterion.digits, criterion.unit || "", rawValue, true);
    }

    const formattedNumber = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: criterion.digits
    }).format(rawValue);

    if (!criterion.unit) {
      return formattedNumber;
    }
    return `${formattedNumber} ${criterion.unit}`;
  }

  function shouldUseFixedWidthCountFormat(criterion) {
    return isNumericCriterion(criterion) && !FLEX_COUNTUP_FORMAT_KEYS.has(criterion.key);
  }

  function isNumericCriterion(criterion) {
    return !criterion.isEnum && !criterion.type;
  }

  function formatFixedWidthNumeric(value, digits, targetValue) {
    const safeDigits = Number.isFinite(digits) && digits >= 0 ? digits : 0;
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    const safeTargetValue = Number.isFinite(targetValue) ? Math.max(0, targetValue) : safeValue;
    const targetIntWidth = Math.max(1, Math.trunc(safeTargetValue).toString().length);

    const fixed = safeValue.toFixed(safeDigits);
    const parts = fixed.split(".");
    const paddedInt = parts[0].padStart(targetIntWidth, "0");
    const groupedInt = paddedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    if (safeDigits === 0) {
      return groupedInt;
    }
    return `${groupedInt}.${parts[1]}`;
  }

  function serializeCsv(headers, records) {
    if (!headers.length) {
      return "";
    }

    const lines = [];
    lines.push(headers.map((header) => escapeCsvField(header)).join(","));

    for (const record of records) {
      const line = headers.map((header) => escapeCsvField(record[header] ?? "")).join(",");
      lines.push(line);
    }

    return `${lines.join("\r\n")}\r\n`;
  }

  function escapeCsvField(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];

      if (char === "\"") {
        if (inQuotes && text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(field);
        field = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && text[i + 1] === "\n") {
          i += 1;
        }

        row.push(field);
        field = "";
        if (!(row.length === 1 && row[0] === "")) {
          rows.push(row);
        }
        row = [];
        continue;
      }

      field += char;
    }

    row.push(field);
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }

    if (!rows.length) {
      return { headers: [], records: [] };
    }

    const headerRow = rows[0].map((column, index) => {
      const cleaned = index === 0 ? column.replace(/^\uFEFF/, "") : column;
      return cleaned.trim();
    });

    const records = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const values = rows[rowIndex];
      const record = {};

      for (let colIndex = 0; colIndex < headerRow.length; colIndex += 1) {
        const key = headerRow[colIndex];
        record[key] = (values[colIndex] || "").trim();
      }

      records.push(record);
    }

    return {
      headers: headerRow,
      records
    };
  }

  function parseNumeric(value) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      return null;
    }

    const numeric = Number(cleaned);
    if (Number.isFinite(numeric)) {
      return numeric > 0 ? numeric : null;
    }
    return null;
  }

  function parseBinaryFlag(value) {
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) {
      return null;
    }

    if (cleaned === "1") {
      return 1;
    }
    if (cleaned === "0") {
      return 0;
    }
    return null;
  }

  function isValidNumericComparisonValue(value) {
    return Number.isFinite(value) && value > 0;
  }

  function isValidBinaryFlag(value) {
    return value === 0 || value === 1;
  }

  function normalizeWhitespace(value) {
    if (!value) {
      return "";
    }
    return String(value).replace(/\s+/g, " ").trim();
  }

  function normalizeEmojiToken(value) {
    return normalizeWhitespace(value);
  }

  function buildWikipediaUrl(row) {
    const directUrl = normalizeWhitespace(row.source_url);
    if (isValidHttpUrl(directUrl)) {
      return directUrl;
    }

    const title = normalizeWhitespace(row.wikipedia_title);
    if (!title) {
      return "";
    }

    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  }

  function isValidHttpUrl(value) {
    if (!value) {
      return false;
    }

    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function titleCaseWords(value) {
    return value
      .toLowerCase()
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ");
  }

  function randomFrom(list) {
    const index = Math.floor(gameRandom() * list.length);
    return list[index];
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(gameRandom() * (i + 1));
      const temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }

  function clearNextRoundTimer() {
    if (state.nextRoundTimer !== null) {
      clearTimeout(state.nextRoundTimer);
      state.nextRoundTimer = null;
    }
  }

  function showError(message) {
    stopSoundPlayback();
    hideSoundButton();
    ui.gameArea.classList.add("hidden");
    ui.loadingMessage.classList.add("hidden");
    ui.errorMessage.textContent = message;
    ui.errorMessage.classList.remove("hidden");
  }
})();




