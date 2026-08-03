"""
OCR extraction for SAVIX AI Translator.

Design goals (Problems 1 & 2 from the project backlog):
  - The user never selects a source language for images - we have to
    work out the script/language ourselves.
  - Do NOT brute-force every OCR language sequentially on every image.
    The previous approach loaded and ran up to 12 separate EasyOCR
    models on every single request and picked the best result at the
    end - correct, but slow and memory hungry, especially when the
    right script was late in the list.

Strategy:
  1. Text DETECTION (finding *where* text is on the image) is
     language-independent in EasyOCR - the same CRAFT detector runs
     regardless of which languages a Reader was built with. So we run
     detection exactly ONCE (via the public `Reader.detect` method)
     and reuse those boxes for every script's recognizer afterwards
     (via the public `Reader.recognize` method), instead of repeating
     full detection+recognition for every candidate script.
  2. Text RECOGNITION does depend on script, so we still try candidate
     language groups - but each attempt now skips the expensive
     detection step, and we stop ("early exit") the moment a group
     produces a confident result instead of always testing all of them.
  3. Loaded models are cached (repeat requests are fast) but capped
     with a simple LRU eviction so we don't keep every script's model
     resident in RAM forever.

If anything about the fast (detect-once / recognize-many) path fails -
e.g. a different installed EasyOCR version with a different internal
shape - we transparently fall back to a normal, always-correct
detect+recognize pass (`readtext`) for that group, so image translation
keeps working either way, just potentially slower for that one image.
"""

import easyocr


# ============================================================
# CACHE OCR READERS (with a simple LRU cap to bound RAM)
# ============================================================

_readers = {}
_reader_lru = []  # least-recently-used name at index 0

MAX_LOADED_READERS = 4


def get_reader(name, languages):

    if name in _readers:
        _reader_lru.remove(name)
        _reader_lru.append(name)
        return _readers[name]

    print(f"Loading OCR model: {name} {languages}")

    _readers[name] = easyocr.Reader(
        languages,
        gpu=False
    )

    _reader_lru.append(name)

    # Bound memory: unload the least-recently-used reader once more than
    # MAX_LOADED_READERS are resident at the same time. ("Multiple
    # models consume RAM" from Problem 1.)
    while len(_reader_lru) > MAX_LOADED_READERS:
        oldest = _reader_lru.pop(0)
        print(f"Unloading OCR model to save memory: {oldest}")
        _readers.pop(oldest, None)

    return _readers[name]


# ============================================================
# OCR GROUPS
#
# Order is the order groups are tried in when the fast router below
# isn't confident, so the most common scripts come first. Every
# non-English script is paired with English, matching the pairing
# pattern already proven to work for this project. Codes are all
# verified against EasyOCR's supported language list (never guessed).
# ============================================================

OCR_GROUPS = {

    # Latin-script languages (also used as the shared "router" pass)
    "latin": ["en", "fr", "de", "es", "it", "pt"],

    # Devanagari
    "devanagari": ["hi", "en"],

    # Bengali script
    "bengali": ["bn", "en"],

    # Arabic
    "arabic": ["ar", "en"],

    # Persian / Farsi (Arabic-derived script, distinct character set)
    "persian": ["fa", "en"],

    # Urdu (Arabic-derived script, distinct character set)
    "urdu": ["ur", "en"],

    # Cyrillic
    "cyrillic": ["ru", "en"],

    # Japanese
    "japanese": ["ja", "en"],

    # Korean
    "korean": ["ko", "en"],

    # Simplified Chinese
    "chinese_sim": ["ch_sim", "en"],

    # Traditional Chinese
    "chinese_tra": ["ch_tra", "en"],

    # Tamil
    "tamil": ["ta", "en"],

    # Telugu
    "telugu": ["te", "en"],

    # Kannada
    "kannada": ["kn", "en"],

    # Thai
    "thai": ["th", "en"],
}


# ============================================================
# SCORE OCR RESULT
# ============================================================

MIN_OCR_CONFIDENCE = 0.20          # ignore very uncertain text fragments
EARLY_EXIT_AVG_CONFIDENCE = 0.55   # "confident enough, stop searching"
EARLY_EXIT_MIN_CHARS = 3           # don't early-exit on 1-2 stray chars


def score_results(results):
    """
    Turns raw EasyOCR results into (score, average_confidence,
    character_count, joined_text) in a single pass. `score` rewards
    both confidence and useful text length, and is kept as a fallback
    so we can still pick the best candidate if nothing is confident
    enough to trigger an early exit.
    """

    text_parts = []
    total_confidence = 0
    total_characters = 0

    for result in results:

        if len(result) < 3:
            continue

        _, text, confidence = result

        clean_text = text.strip()

        if not clean_text or confidence < MIN_OCR_CONFIDENCE:
            continue

        character_count = len(clean_text)

        total_characters += character_count
        total_confidence += confidence * character_count

        text_parts.append(clean_text)

    if total_characters == 0:
        return 0, 0.0, 0, ""

    average_confidence = total_confidence / total_characters

    score = average_confidence * min(total_characters, 100)

    return score, average_confidence, total_characters, " ".join(text_parts).strip()


# ============================================================
# SHARED (RUN-ONCE) TEXT DETECTION
# ============================================================

def detect_text_boxes(image_path, router_reader):
    """
    Runs EasyOCR's text-region detection exactly once. Detection finds
    *where* text is, independent of language/script, so the resulting
    boxes can be reused by every recognizer tried afterwards. Returns
    None if detection isn't usable for any reason, so the caller can
    fall back to the slower but always-correct per-group readtext().
    """

    try:

        horizontal_list, free_list = router_reader.detect(image_path)

        # EasyOCR's detect() wraps results in an extra list to support
        # batches of images. We only ever pass one image, so unwrap
        # that outer level here - this mirrors what EasyOCR's own
        # readtext() does internally before calling recognize().
        if (
            isinstance(horizontal_list, list) and
            isinstance(free_list, list) and
            len(horizontal_list) == 1 and
            len(free_list) == 1
        ):
            horizontal_list = horizontal_list[0]
            free_list = free_list[0]

        return horizontal_list, free_list

    except Exception as error:

        print("Shared text detection unavailable, falling back:", error)

        return None


# ============================================================
# EXTRACT TEXT
# ============================================================

def extract_text_from_image(image_path):

    print("\nDetecting image language/script...")

    ordered_groups = list(OCR_GROUPS.items())

    best_text = ""
    best_score = 0
    best_group = None

    # ------------------------------------------------------------
    # Stage 1: detect text regions ONCE using the first ("router")
    # group, then reuse those boxes for every recognizer below. This
    # is what avoids re-running the expensive part of OCR for every
    # candidate script.
    # ------------------------------------------------------------

    router_name, router_languages = ordered_groups[0]
    router_reader = get_reader(router_name, router_languages)

    shared_boxes = detect_text_boxes(image_path, router_reader)

    if shared_boxes:
        print(
            f"Text regions detected once ({len(shared_boxes[0])} boxes), "
            "reusing across scripts instead of re-detecting per language."
        )

    # ------------------------------------------------------------
    # Stage 2: try candidate scripts, most-likely first, and stop as
    # soon as one is confidently correct ("early exit") instead of
    # always testing every remaining group.
    # ------------------------------------------------------------

    for group_name, languages in ordered_groups:

        try:

            reader = get_reader(group_name, languages)

            results = None

            if shared_boxes:

                horizontal_list, free_list = shared_boxes

                try:

                    results = reader.recognize(
                        image_path,
                        horizontal_list=horizontal_list,
                        free_list=free_list,
                        detail=1,
                        paragraph=False
                    )

                except Exception as recognize_error:

                    print(
                        f"{group_name}: fast recognize failed "
                        f"({recognize_error}), retrying with a full pass."
                    )

                    results = None

            if results is None:

                # Shared boxes weren't available, or reusing them failed
                # for this reader - fall back to a normal full pass so
                # we still get a usable result for this group.
                results = reader.readtext(
                    image_path,
                    detail=1,
                    paragraph=False
                )

            score, average_confidence, character_count, text = (
                score_results(results)
            )

            print(
                f"{group_name}: score={score:.2f} "
                f"avg_confidence={average_confidence:.2f} "
                f"chars={character_count}"
            )

            if text and score > best_score:
                best_score = score
                best_text = text
                best_group = group_name

            if (
                average_confidence >= EARLY_EXIT_AVG_CONFIDENCE and
                character_count >= EARLY_EXIT_MIN_CHARS
            ):

                print(
                    f"Confident match on '{group_name}', "
                    "skipping remaining scripts."
                )

                break

        except Exception as error:

            print(f"OCR group {group_name} failed:", error)

    if not best_text:

        raise ValueError(
            "No readable text was found in the image."
        )

    print("\nSelected OCR group:", best_group)
    print("OCR confidence score:", round(best_score, 2))
    print("Extracted text:", best_text)

    return best_text
