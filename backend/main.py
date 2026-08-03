import os
import tempfile

from fastapi import (
    FastAPI,
    HTTPException,
    UploadFile,
    File,
    Form
)
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from translator import translate_text
from voice import speech_to_text
from image_ocr import extract_text_from_image
from tts import (
    text_to_speech,
    is_tts_supported,
    get_supported_languages,
    preload_languages,
    TTS_LANGUAGE_CODES,
)


# Create FastAPI application
app = FastAPI(
    title="SAVIX AI Translator API"
)


# ==========================================
# CORS
#
# Configurable via ALLOWED_ORIGINS (comma separated) so the same code
# works in local dev and once deployed, instead of only ever trusting
# http://localhost:5173 (Problem 11: "Also verify FastAPI CORS").
# ==========================================

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"

allowed_origins = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# Optional TTS preloading (Problem 5: "Consider
# preloading only common languages"). Off by
# default - opt in with a comma separated list
# of display names, e.g.:
#   TTS_PRELOAD_LANGUAGES="English,Hindi,Spanish"
# ==========================================

@app.on_event("startup")
def _preload_tts_models():

    preload_list = os.environ.get("TTS_PRELOAD_LANGUAGES", "")

    languages = [name for name in preload_list.split(",") if name.strip()]

    if languages:
        print(f"Preloading TTS models for: {languages}")
        preload_languages(languages)


class TranslationRequest(BaseModel):
    text: str
    target_language: str


class SpeakRequest(BaseModel):
    text: str
    language: str


# ==========================================
# Error handling
#
# ValueError = something about the request itself was invalid (bad
# input, unsupported language, no text found, etc.) -> 400.
# Anything else = an unexpected server-side failure -> 500, with the
# real error logged server-side but never sent to the client
# (Problem 8: useful status codes without leaking internals).
# ==========================================

def raise_for_error(error, context):

    if isinstance(error, ValueError):
        print(f"{context}:", error)
        raise HTTPException(status_code=400, detail=str(error))

    print(f"{context} (unexpected):", error)
    raise HTTPException(
        status_code=500,
        detail="Something went wrong on our end. Please try again."
    )


@app.get("/")
def home():
    return {
        "status": "SAVIX Translator API running"
    }


@app.get("/supported-speech-languages")
def supported_speech_languages():
    """
    Lets the frontend know ahead of time which languages have a speech
    voice available, so it can grey out / explain the speaker button
    instead of only finding out after a failed request (Problem 4:
    "Gracefully indicate unsupported speech languages").
    """
    return {
        "languages": get_supported_languages()
    }


@app.post("/translate")
def translate(request: TranslationRequest):
    try:
        return translate_text(
            request.text,
            request.target_language
        )

    except Exception as error:
        raise_for_error(error, "Translation error")


@app.post("/voice-translate")
async def voice_translate(
    audio: UploadFile = File(...),
    target_language: str = Form(...)
):

    temp_path = None

    try:

        extension = os.path.splitext(audio.filename or "")[1]

        if not extension:
            extension = ".webm"

        # Save browser recording temporarily
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=extension
        ) as temp_file:

            audio_bytes = await audio.read()
            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        # =====================================
        # VOICE -> TEXT
        # =====================================

        speech_result = speech_to_text(temp_path)

        original_text = speech_result["text"]
        whisper_language = speech_result["language"]

        print("Recognized text:", original_text)
        print("Whisper detected:", whisper_language)

        # =====================================
        # TEXT -> TRANSLATION
        # =====================================

        translation_result = translate_text(
            original_text,
            target_language
        )

        # =====================================
        # SEND RESULT TO REACT
        # =====================================

        return {
            "original_text": original_text,
            "translation": translation_result["translation"],
            "detected_language": translation_result["detected_language"],
            "whisper_language": whisper_language,
            "target_language": target_language
        }

    except Exception as error:
        raise_for_error(error, "Voice translation error")

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


# ==========================================
# IMAGE TRANSLATION
# ==========================================

@app.post("/image-translate")
async def image_translate(
    image: UploadFile = File(...),
    target_language: str = Form(...)
):

    temp_path = None

    try:

        # ==========================================
        # VALIDATE IMAGE
        # ==========================================

        allowed_types = ["image/jpeg", "image/png", "image/webp"]

        if image.content_type not in allowed_types:
            raise ValueError(
                "Only JPG, PNG and WEBP images are supported."
            )

        # ==========================================
        # TEMPORARY FILE
        # ==========================================

        extension = os.path.splitext(image.filename or "")[1]

        if not extension:
            extension = ".jpg"

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=extension
        ) as temp_file:

            image_bytes = await image.read()

            if not image_bytes:
                raise ValueError("The uploaded image was empty.")

            temp_file.write(image_bytes)
            temp_path = temp_file.name

        print("\nProcessing image:", image.filename)

        # ==========================================
        # AUTOMATIC MULTILINGUAL OCR
        # (fast script routing - see image_ocr.py)
        # ==========================================

        extracted_text = extract_text_from_image(temp_path)

        print("OCR text:", extracted_text)

        # ==========================================
        # LANGUAGE DETECTION + NLLB TRANSLATION
        # ==========================================

        # translate_text already performs language detection
        # for the extracted text.

        translation_result = translate_text(
            extracted_text,
            target_language
        )

        # ==========================================
        # RESPONSE
        # ==========================================

        return {
            "original_text": extracted_text,
            "translation": translation_result["translation"],
            "detected_language": translation_result["detected_language"],
            "target_language": target_language
        }

    except Exception as error:
        raise_for_error(error, "Image translation error")

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/speak")
async def speak(request: SpeakRequest):

    try:

        if not request.text.strip():
            raise ValueError("Text cannot be empty.")

        if not is_tts_supported(request.language):
            raise ValueError(
                f"Speech is not currently available for {request.language}."
            )

        language_code = TTS_LANGUAGE_CODES[request.language]

        print("Generating speech:", request.language, language_code)

        audio_buffer = text_to_speech(request.text, language_code)

        return StreamingResponse(
            audio_buffer,
            media_type="audio/wav",
            headers={
                "Content-Disposition": 'inline; filename="speech.wav"'
            }
        )

    except Exception as error:
        raise_for_error(error, "TTS error")
