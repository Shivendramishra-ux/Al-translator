// Central place for talking to the SAVIX backend.
//
// Problem 11: the backend URL used to be hardcoded to
// "http://127.0.0.1:8000" in four different places, which breaks the
// moment the app is deployed anywhere else. It now comes from Vite's
// environment variables (see .env / .env.example), with a same-machine
// fallback so local dev still works even if .env is missing.
//
// Problem 8: every request used to duplicate its own fetch + error
// handling. apiFetch() centralizes that - it turns network failures
// ("backend is unreachable") and non-OK responses into a single, clean
// Error with a short, user-presentable message, and never leaks a raw
// stack trace or HTML error page into the UI.

export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

if (!import.meta.env.VITE_API_URL) {
  console.warn(
    `VITE_API_URL is not set - falling back to ${API_URL}. ` +
    "Set it in a .env file before deploying (see .env.example)."
  );
}

async function apiFetch(path, options = {}, fallbackMessage = "Something went wrong.") {

  let response;

  try {
    response = await fetch(`${API_URL}${path}`, options);
  } catch (networkError) {
    console.error("Network error calling", path, networkError);
    throw new Error(
      "Could not reach the SAVIX server. Is the backend running?",
      { cause: networkError }
    );
  }

  if (!response.ok) {

    let detail = fallbackMessage;

    try {
      const data = await response.json();
      detail = data.detail || fallbackMessage;
    } catch {
      // Response body wasn't JSON (e.g. the server crashed before it
      // could return one) - keep the fallback rather than showing raw
      // HTML/text to the user.
    }

    throw new Error(detail);
  }

  return response;
}

export async function translateText(text, targetLanguage) {

  const response = await apiFetch(
    "/translate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_language: targetLanguage }),
    },
    "Translation failed."
  );

  return response.json();
}

export async function voiceTranslate(audioBlob, targetLanguage) {

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("target_language", targetLanguage);

  const response = await apiFetch(
    "/voice-translate",
    { method: "POST", body: formData },
    "Voice translation failed."
  );

  return response.json();
}

export async function imageTranslate(file, targetLanguage) {

  const formData = new FormData();
  formData.append("image", file);
  formData.append("target_language", targetLanguage);

  const response = await apiFetch(
    "/image-translate",
    { method: "POST", body: formData },
    "Image translation failed."
  );

  return response.json();
}

export async function speak(text, language) {

  const response = await apiFetch(
    "/speak",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    },
    "Could not generate speech."
  );

  return response.blob();
}

export async function getSupportedSpeechLanguages() {

  const response = await apiFetch(
    "/supported-speech-languages",
    {},
    "Could not load supported speech languages."
  );

  const data = await response.json();

  return data.languages || [];
}
