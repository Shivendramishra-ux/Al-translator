// Client-side translation history (Problem 10).
//
// Storage starts as localStorage, exactly as suggested in the project
// notes ("Storage can later be localStorage, backend database, or
// account-based persistence") - it persists across reloads with no
// backend changes needed, and can be swapped for a real backend/account
// store later without changing how the rest of the app calls this file.

const STORAGE_KEY = "savix_translation_history";
const MAX_ENTRIES = 50;

export function loadHistory() {

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {
    console.error("Could not read translation history:", error);
    return [];
  }
}

function persist(entries) {

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    // Storage full/unavailable (private browsing, quota, etc.) - history
    // is a nice-to-have, so fail quietly instead of breaking translation.
    console.error("Could not save translation history:", error);
  }
}

// entry: { type: 'text' | 'voice' | 'image', originalText, translation,
//          detectedLanguage, targetLanguage }
export function addHistoryEntry(entry) {

  const newEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const updated = [newEntry, ...loadHistory()].slice(0, MAX_ENTRIES);

  persist(updated);

  return updated;
}

export function clearHistory() {
  persist([]);
  return [];
}
