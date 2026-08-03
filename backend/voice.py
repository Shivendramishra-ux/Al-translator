import os

from faster_whisper import WhisperModel

print("Loading Whisper model...")

whisper_model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8"
)

print("Whisper model ready.")


def speech_to_text(audio_file):

    # Empty/near-empty uploads (e.g. a recording that started and
    # stopped instantly) would otherwise reach Whisper as a valid but
    # silent file and fail with a confusing decoder error.
    if not os.path.exists(audio_file) or os.path.getsize(audio_file) < 100:
        raise ValueError(
            "No audio was recorded. Please try again."
        )

    try:

        segments, info = whisper_model.transcribe(
            audio_file,
            beam_size=5,
            # Filters out silence/background noise before transcription
            # instead of asking Whisper to guess words for it, which is
            # what caused unreliable results on noisy recordings.
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )

        text_parts = [segment.text for segment in segments]

    except ValueError:
        raise

    except Exception as error:
        # Corrupt/unsupported audio, decoder failures, etc. - surface a
        # clean message instead of a raw stack trace reaching the user.
        print("Whisper transcription error:", error)
        raise ValueError(
            "The recording could not be transcribed. "
            "Please try recording again."
        )

    text = " ".join(text_parts).strip()

    if not text:
        raise ValueError(
            "No speech was detected in the recording."
        )

    return {
        "text": text,
        "language": info.language
    }
