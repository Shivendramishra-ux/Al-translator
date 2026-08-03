"""
Text-to-speech for SAVIX AI Translator, backed by Meta's MMS-TTS models.

Problem 4 (Expand TTS Language Coverage) found that the previous
language -> model-repo mapping had never been checked against what
actually exists on Hugging Face: some entries pointed at repositories
that don't exist (e.g. "facebook/mms-tts-ita" - there is no MMS-TTS
checkpoint for Italian), and others used display names that could never
be selected from the target-language dropdown, so they were silently
unreachable.

`tts_languages.json` replaces that hand-written dict. It was generated
by cross-referencing every language in languages.json (the same NLLB
language list the rest of the app already uses) against MMS-TTS's
official, published list of ~1107 supported ISO 639-3 codes, so every
entry here is a verified, real repository id - never a guess. Languages
NLLB supports but MMS-TTS doesn't (e.g. Chinese, Japanese, Italian) are
simply absent, and are handled gracefully as "no speech available"
rather than a broken/guessed request.
"""

import io
import json
import os

import torch
import soundfile as sf

from transformers import (
    VitsModel,
    AutoTokenizer
)


# ==========================================
# Load the verified language -> MMS code map
# ==========================================

with open("tts_languages.json", "r", encoding="utf-8") as file:
    TTS_LANGUAGE_CODES = json.load(file)


def is_tts_supported(language_name):
    return language_name in TTS_LANGUAGE_CODES


def get_supported_languages():
    """Sorted display names, e.g. for the frontend to grey out the rest."""
    return sorted(TTS_LANGUAGE_CODES.keys())


# ==========================================
# Cache loaded TTS models (LRU-capped so we
# don't keep every language's model in RAM
# forever - Problem 5).
# ==========================================

tts_models = {}
_model_lru = []

MAX_LOADED_TTS_MODELS = int(os.environ.get("TTS_MAX_LOADED_MODELS", "4"))


def load_tts_model(language_code):

    model_name = f"facebook/mms-tts-{language_code}"

    print(f"Loading TTS model: {model_name}")

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = VitsModel.from_pretrained(model_name)

    model.eval()

    tts_models[language_code] = {
        "tokenizer": tokenizer,
        "model": model
    }

    _model_lru.append(language_code)

    while len(_model_lru) > MAX_LOADED_TTS_MODELS:
        oldest = _model_lru.pop(0)
        print(f"Unloading TTS model to save memory: {oldest}")
        tts_models.pop(oldest, None)

    return tokenizer, model


def _get_cached_model(language_code):

    if language_code not in tts_models:
        return None

    _model_lru.remove(language_code)
    _model_lru.append(language_code)

    return (
        tts_models[language_code]["tokenizer"],
        tts_models[language_code]["model"]
    )


def preload_languages(language_names):
    """
    Optionally warm the cache for a handful of common languages at
    startup, so the *first* real request for them doesn't have to wait
    on a model download/load. Off by default (see main.py) since it
    slows down server startup - opt in via the TTS_PRELOAD_LANGUAGES
    env var if that tradeoff is worth it for a given deployment.
    """

    for name in language_names:

        name = name.strip()

        if not name:
            continue

        if not is_tts_supported(name):
            print(f"Skipping TTS preload for unsupported language: {name}")
            continue

        try:
            load_tts_model(TTS_LANGUAGE_CODES[name])
        except Exception as error:
            print(f"Could not preload TTS model for {name}: {error}")


def text_to_speech(text, language_code):

    if not text.strip():
        raise ValueError("Text cannot be empty.")

    cached = _get_cached_model(language_code)

    if cached:
        tokenizer, model = cached
    else:
        tokenizer, model = load_tts_model(language_code)

    inputs = tokenizer(text, return_tensors="pt")

    with torch.no_grad():
        output = model(**inputs).waveform

    waveform = output.squeeze().cpu().numpy()

    sample_rate = model.config.sampling_rate

    audio_buffer = io.BytesIO()

    sf.write(audio_buffer, waveform, sample_rate, format="WAV")

    audio_buffer.seek(0)

    return audio_buffer
