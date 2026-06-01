const SHEET_ID = "1Tx5wN5IWSMOLtg_60ihrkf-T6G1_darxaoIstj6on5M";
const SHEET_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
const STORAGE_KEY = "lt-trainer-progress-v1";
const SETTINGS_KEY = "lt-trainer-settings-v1";
const STATUS_NEW = "new";
const STATUS_LEARNED = "learned";
const STATUS_FORGOTTEN = "forgotten";
const EXPECTED_HEADERS = ["lithuanian", "russian", "pronunciation", "examples"];

const state = {
  cards: [],
  filteredCards: [],
  currentIndex: 0,
  revealed: false,
  deckMode: "lt-ru",
  filter: "all",
  shuffle: true,
  syncMeta: null,
  listCategory: null,
};

const elements = {
  directionSelect: document.querySelector("#direction-select"),
  statusFilter: document.querySelector("#status-filter"),
  shuffleToggle: document.querySelector("#shuffle-toggle"),
  refreshButton: document.querySelector("#refresh-button"),
  revealButton: document.querySelector("#reveal-button"),
  nextButton: document.querySelector("#next-button"),
  reviewActions: document.querySelector("#review-actions"),
  promptText: document.querySelector("#prompt-text"),
  answerText: document.querySelector("#answer-text"),
  pronunciationText: document.querySelector("#pronunciation-text"),
  examplesText: document.querySelector("#examples-text"),
  revealPanel: document.querySelector("#reveal-panel"),
  cardPosition: document.querySelector("#card-position"),
  cardDirection: document.querySelector("#card-direction"),
  syncStatus: document.querySelector("#sync-status"),
  queueStatus: document.querySelector("#queue-status"),
  currentStatusPill: document.querySelector("#current-status-pill"),
  statsGrid: document.querySelector("#stats-grid"),
  wordListPanel: document.querySelector("#word-list-panel"),
  wordListTitle: document.querySelector("#word-list-title"),
  wordListNote: document.querySelector("#word-list-note"),
  wordListItems: document.querySelector("#word-list-items"),
  wordListClose: document.querySelector("#word-list-close"),
};

const categoryLabels = {
  all: "All words",
  new: "New words",
  learned: "Learned words",
  forgotten: "Forgotten words",
};

function utcNowIso() {
  return new Date().toISOString();
}

function buildCardId(lithuanian, russian) {
  return `${lithuanian.trim().toLowerCase()}::${russian.trim().toLowerCase()}`
    .replace(/\s+/g, " ");
}

function shuffleList(list) {
  const clone = [...list];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function formatTimestamp(value) {
  if (!value) return "never";
  const date = new Date(value);
  return date.toLocaleString();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    state.deckMode = saved.deckMode || state.deckMode;
    state.filter = saved.filter || state.filter;
    state.shuffle = typeof saved.shuffle === "boolean" ? saved.shuffle : state.shuffle;
  } catch (error) {
    console.warn("Could not load settings", error);
  }
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      deckMode: state.deckMode,
      filter: state.filter,
      shuffle: state.shuffle,
    }),
  );
}

function loadProgressStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      cards: parsed.cards || {},
      meta: parsed.meta || { created_at: utcNowIso() },
    };
  } catch (error) {
    console.warn("Could not load progress store", error);
    return { cards: {}, meta: { created_at: utcNowIso() } };
  }
}

function saveProgressStore(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function loadSheetData() {
  return new Promise((resolve, reject) => {
    const callbackName = `ltTrainerSheetCallback_${Date.now()}`;
    const separator = SHEET_URL.includes("?") ? ";" : "?";
    const src = `${SHEET_URL}${separator}tqx=out:json;responseHandler:${callbackName}`;
    const script = document.createElement("script");

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    function cleanup() {
      delete window[callbackName];
      script.remove();
    }

    script.src = src;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Could not load the Google Sheet. Check network access."));
    };

    document.head.appendChild(script);
  });
}

function extractSheetRows(payload) {
  const table = payload?.table;
  const rows = table?.rows || [];

  const parsedRows = rows
    .map((row) => {
      const cells = row.c || [];
      const values = cells.slice(0, 4).map((cell) => String(cell?.v || "").trim());
      while (values.length < 4) values.push("");
      return {
        lithuanian: values[0],
        russian: values[1],
        pronunciation: values[2],
        examples: values[3],
      };
    })
    .filter((row) => Object.values(row).some(Boolean));

  const firstRowHeaders = EXPECTED_HEADERS.map((key) =>
    String(parsedRows[0]?.[key] || "").trim().toLowerCase(),
  );

  const contentRows =
    JSON.stringify(firstRowHeaders) === JSON.stringify(EXPECTED_HEADERS)
      ? parsedRows.slice(1)
      : parsedRows;

  return contentRows
    .filter((row) => row.lithuanian && row.russian)
    .map((row) => ({
      ...row,
      id: buildCardId(row.lithuanian, row.russian),
    }));
}

function mergeCardsWithProgress(cards) {
  const progress = loadProgressStore();
  const progressCards = progress.cards;
  const now = utcNowIso();
  let newCardsAdded = 0;

  const mergedCards = cards.map((card) => {
    let record = progressCards[card.id];
    if (!record) {
      record = {
        status: STATUS_NEW,
        created_at: now,
        last_reviewed_at: null,
        times_seen: 0,
        success_count: 0,
        failure_count: 0,
      };
      progressCards[card.id] = record;
      newCardsAdded += 1;
    }

    return {
      ...card,
      status: record.status || STATUS_NEW,
      created_at: record.created_at || now,
      last_reviewed_at: record.last_reviewed_at || null,
      times_seen: Number(record.times_seen || 0),
      success_count: Number(record.success_count || 0),
      failure_count: Number(record.failure_count || 0),
    };
  });

  progress.meta.last_sync_at = now;
  saveProgressStore(progress);

  return {
    cards: mergedCards,
    synced_at: now,
    new_cards_added: newCardsAdded,
  };
}

function updateStoredCard(cardId, status) {
  const progress = loadProgressStore();
  const record = progress.cards[cardId];

  if (!record) {
    throw new Error("Could not find this card in local progress.");
  }

  record.status = status;
  record.last_reviewed_at = utcNowIso();
  record.times_seen = Number(record.times_seen || 0) + 1;

  if (status === STATUS_LEARNED) {
    record.success_count = Number(record.success_count || 0) + 1;
  } else if (status === STATUS_FORGOTTEN) {
    record.failure_count = Number(record.failure_count || 0) + 1;
  }

  progress.meta.last_review_at = record.last_reviewed_at;
  saveProgressStore(progress);

  return record;
}

function getCardDirection(card) {
  if (state.deckMode === "mixed") {
    return card.practiceDirection || "lt-ru";
  }
  return state.deckMode;
}

function getCardsForCategory(category) {
  const cards = state.cards.filter((card) => {
    if (category === "all") return true;
    return card.status === category;
  });

  return [...cards].sort((left, right) =>
    left.lithuanian.localeCompare(right.lithuanian, "lt", { sensitivity: "base" }),
  );
}

function getPromptAndAnswer(card) {
  const direction = getCardDirection(card);
  if (direction === "ru-lt") {
    return {
      directionLabel: "RU → LT",
      prompt: card.russian,
      answer: card.lithuanian,
    };
  }

  return {
    directionLabel: "LT → RU",
    prompt: card.lithuanian,
    answer: card.russian,
  };
}

function buildPracticeDeck(cards) {
  let list = cards.filter((card) => {
    if (state.filter === "all") return true;
    return card.status === state.filter;
  });

  if (state.deckMode === "mixed") {
    list = list.map((card, index) => ({
      ...card,
      practiceDirection: index % 2 === 0 ? "lt-ru" : "ru-lt",
    }));
  } else {
    list = list.map((card) => ({ ...card, practiceDirection: state.deckMode }));
  }

  if (state.shuffle) {
    list = shuffleList(list);
  }

  state.filteredCards = list;
  state.currentIndex = 0;
  state.revealed = false;
}

function renderStats() {
  const counts = { all: state.cards.length, new: 0, learned: 0, forgotten: 0 };
  for (const card of state.cards) {
    counts[card.status] += 1;
  }

  elements.statsGrid.innerHTML = `
    <button class="stat-card ${state.listCategory === "all" ? "active" : ""}" data-category="all" type="button">
      <span>Total</span><strong>${counts.all}</strong>
    </button>
    <button class="stat-card ${state.listCategory === "new" ? "active" : ""}" data-category="new" type="button">
      <span>New</span><strong>${counts.new}</strong>
    </button>
    <button class="stat-card ${state.listCategory === "learned" ? "active" : ""}" data-category="learned" type="button">
      <span>Learned</span><strong>${counts.learned}</strong>
    </button>
    <button class="stat-card ${state.listCategory === "forgotten" ? "active" : ""}" data-category="forgotten" type="button">
      <span>Forgotten</span><strong>${counts.forgotten}</strong>
    </button>
  `;

  elements.statsGrid.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.listCategory = button.dataset.category;
      renderStats();
      renderWordList();
    });
  });
}

function renderWordList() {
  const category = state.listCategory;
  if (!category) {
    elements.wordListPanel.classList.add("hidden");
    return;
  }

  const cards = getCardsForCategory(category);
  elements.wordListPanel.classList.remove("hidden");
  elements.wordListTitle.textContent = categoryLabels[category];

  if (category === "new") {
    elements.wordListNote.textContent = "These are waiting to be reviewed or assigned to another status.";
  } else if (category === "all") {
    elements.wordListNote.textContent = "Tap any reset button to move a word back into the New bucket on this device.";
  } else {
    elements.wordListNote.textContent = "Use Reset to New if you want to remove a word from this category.";
  }

  if (cards.length === 0) {
    elements.wordListItems.innerHTML = `<p class="word-list-empty">No words in this category yet.</p>`;
    return;
  }

  elements.wordListItems.innerHTML = cards
    .map((card) => {
      const resetButton =
        category !== "new"
          ? `<button class="mini-reset-button" data-reset-card="${card.id}" type="button">Reset to New</button>`
          : "";

      return `
        <article class="word-row">
          <div class="word-row-copy">
            <p class="word-row-main">${card.lithuanian}</p>
            <p class="word-row-sub">${card.russian}</p>
          </div>
          ${resetButton}
        </article>
      `;
    })
    .join("");

  elements.wordListItems.querySelectorAll("[data-reset-card]").forEach((button) => {
    button.addEventListener("click", () => {
      resetCardToNew(button.dataset.resetCard);
    });
  });
}

function resetCardToNew(cardId) {
  const stored = updateStoredCard(cardId, STATUS_NEW);
  const sharedUpdate = {
    status: STATUS_NEW,
    times_seen: stored.times_seen,
    success_count: stored.success_count,
    failure_count: stored.failure_count,
    last_reviewed_at: stored.last_reviewed_at,
  };

  state.cards = state.cards.map((item) => (item.id === cardId ? { ...item, ...sharedUpdate } : item));

  if (state.filteredCards.length > 0) {
    state.filteredCards = state.filteredCards.map((item) =>
      item.id === cardId ? { ...item, ...sharedUpdate } : item,
    );
  }

  buildPracticeDeck(state.cards);
  renderStats();
  renderWordList();
  renderCard();
}

function renderCard() {
  const total = state.filteredCards.length;
  const card = state.filteredCards[state.currentIndex];

  elements.cardPosition.textContent = `Card ${total === 0 ? 0 : state.currentIndex + 1} of ${total}`;
  elements.revealPanel.classList.toggle("hidden", !state.revealed);
  elements.reviewActions.classList.toggle("hidden", !state.revealed);

  if (!card) {
    elements.promptText.textContent = "No cards match this filter yet.";
    elements.answerText.textContent = "";
    elements.pronunciationText.textContent = "";
    elements.examplesText.textContent = "";
    elements.cardDirection.textContent = "—";
    elements.currentStatusPill.textContent = "Status: —";
    elements.queueStatus.textContent = "Try another filter or sync the sheet.";
    return;
  }

  const cardData = getPromptAndAnswer(card);
  elements.promptText.textContent = cardData.prompt;
  elements.answerText.textContent = cardData.answer;
  elements.pronunciationText.textContent = card.pronunciation || "—";
  elements.examplesText.textContent = card.examples || "—";
  elements.cardDirection.textContent = cardData.directionLabel;
  elements.currentStatusPill.textContent = `Status: ${card.status}`;
  elements.queueStatus.textContent = `Saved on this device. Last reviewed: ${formatTimestamp(card.last_reviewed_at)}`;
}

function moveNext() {
  if (state.filteredCards.length === 0) {
    renderCard();
    return;
  }

  state.currentIndex = (state.currentIndex + 1) % state.filteredCards.length;
  state.revealed = false;
  renderCard();
}

async function fetchDeck() {
  elements.syncStatus.textContent = "Syncing sheet…";

  const rawSheetPayload = await loadSheetData();
  const sheetCards = extractSheetRows(rawSheetPayload);
  const merged = mergeCardsWithProgress(sheetCards);

  state.cards = merged.cards;
  state.syncMeta = merged;

  buildPracticeDeck(state.cards);
  renderStats();
  renderCard();

  const newWords =
    merged.new_cards_added === 1
      ? "1 new card added"
      : `${merged.new_cards_added} new cards added`;
  elements.syncStatus.textContent =
    `Synced ${merged.cards.length} cards at ${formatTimestamp(merged.synced_at)}. ` +
    `${newWords}. Progress is stored on this device.`;
}

async function submitReview(status) {
  const card = state.filteredCards[state.currentIndex];
  if (!card) return;

  const stored = updateStoredCard(card.id, status);

  const sharedUpdate = {
    status,
    times_seen: stored.times_seen,
    success_count: stored.success_count,
    failure_count: stored.failure_count,
    last_reviewed_at: stored.last_reviewed_at,
  };

  state.cards = state.cards.map((item) => (item.id === card.id ? { ...item, ...sharedUpdate } : item));
  state.filteredCards[state.currentIndex] = { ...state.filteredCards[state.currentIndex], ...sharedUpdate };

  renderStats();
  moveNext();
}

function bindEvents() {
  elements.directionSelect.value = state.deckMode;
  elements.statusFilter.value = state.filter;
  elements.shuffleToggle.checked = state.shuffle;

  elements.directionSelect.addEventListener("change", () => {
    state.deckMode = elements.directionSelect.value;
    saveSettings();
    buildPracticeDeck(state.cards);
    renderCard();
  });

  elements.statusFilter.addEventListener("change", () => {
    state.filter = elements.statusFilter.value;
    saveSettings();
    buildPracticeDeck(state.cards);
    renderCard();
  });

  elements.shuffleToggle.addEventListener("change", () => {
    state.shuffle = elements.shuffleToggle.checked;
    saveSettings();
    buildPracticeDeck(state.cards);
    renderCard();
  });

  elements.refreshButton.addEventListener("click", async () => {
    try {
      await fetchDeck();
    } catch (error) {
      elements.syncStatus.textContent = error.message;
    }
  });

  elements.revealButton.addEventListener("click", () => {
    state.revealed = true;
    renderCard();
  });

  elements.nextButton.addEventListener("click", () => {
    moveNext();
  });

  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await submitReview(button.dataset.status);
      } catch (error) {
        elements.queueStatus.textContent = error.message;
      }
    });
  });

  elements.wordListClose.addEventListener("click", () => {
    state.listCategory = null;
    renderStats();
    renderWordList();
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function initialize() {
  loadSettings();
  bindEvents();
  registerServiceWorker();

  try {
    await fetchDeck();
  } catch (error) {
    elements.syncStatus.textContent = error.message;
    renderWordList();
    renderCard();
  }
}

initialize();
