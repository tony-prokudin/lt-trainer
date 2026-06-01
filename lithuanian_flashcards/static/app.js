const state = {
  cards: [],
  filteredCards: [],
  currentIndex: 0,
  revealed: false,
  deckMode: "lt-ru",
  filter: "all",
  shuffle: true,
  syncMeta: null,
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
};

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

function getCardDirection(card) {
  if (state.deckMode === "mixed") {
    return card.practiceDirection || "lt-ru";
  }
  return state.deckMode;
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
    <div class="stat-card"><span>Total</span><strong>${counts.all}</strong></div>
    <div class="stat-card"><span>New</span><strong>${counts.new}</strong></div>
    <div class="stat-card"><span>Learned</span><strong>${counts.learned}</strong></div>
    <div class="stat-card"><span>Forgotten</span><strong>${counts.forgotten}</strong></div>
  `;
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
  elements.queueStatus.textContent = `Last reviewed: ${formatTimestamp(card.last_reviewed_at)}`;
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

  const response = await fetch("/api/deck");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "Failed to load deck.");
  }

  state.cards = payload.cards;
  state.syncMeta = payload;

  buildPracticeDeck(state.cards);
  renderStats();
  renderCard();

  const newWords = payload.new_cards_added === 1 ? "1 new card added" : `${payload.new_cards_added} new cards added`;
  elements.syncStatus.textContent = `Synced ${payload.cards.length} cards at ${formatTimestamp(payload.synced_at)}. ${newWords}.`;
}

async function submitReview(status) {
  const card = state.filteredCards[state.currentIndex];
  if (!card) return;

  const response = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardId: card.id, status }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Failed to update card.");
  }

  const sharedUpdate = {
    status,
    times_seen: payload.record.times_seen,
    success_count: payload.record.success_count,
    failure_count: payload.record.failure_count,
    last_reviewed_at: payload.record.last_reviewed_at,
  };

  state.cards = state.cards.map((item) => (item.id === card.id ? { ...item, ...sharedUpdate } : item));
  state.filteredCards[state.currentIndex] = { ...state.filteredCards[state.currentIndex], ...sharedUpdate };

  renderStats();
  moveNext();
}

function bindEvents() {
  elements.directionSelect.addEventListener("change", () => {
    state.deckMode = elements.directionSelect.value;
    buildPracticeDeck(state.cards);
    renderCard();
  });

  elements.statusFilter.addEventListener("change", () => {
    state.filter = elements.statusFilter.value;
    buildPracticeDeck(state.cards);
    renderCard();
  });

  elements.shuffleToggle.addEventListener("change", () => {
    state.shuffle = elements.shuffleToggle.checked;
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
}

async function initialize() {
  bindEvents();
  try {
    await fetchDeck();
  } catch (error) {
    elements.syncStatus.textContent = error.message;
    renderCard();
  }
}

initialize();
