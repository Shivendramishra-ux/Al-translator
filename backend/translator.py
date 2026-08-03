import json

from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from lingua import LanguageDetectorBuilder


MODEL_NAME = "facebook/nllb-200-distilled-600M"

print("Loading NLLB translator...")

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

print("NLLB translator ready.")


# ==========================================
# Load languages
# ==========================================

with open("languages.json", "r", encoding="utf-8") as file:
    languages = json.load(file)


# ==========================================
# Lingua detector
# ==========================================

detector = LanguageDetectorBuilder.from_all_languages().build()


# ==========================================
# Lingua -> NLLB
# ==========================================

SOURCE_MAP = {
    "AFRIKAANS": "afr_Latn",
    "ALBANIAN": "als_Latn",
    "ARABIC": "arb_Arab",
    "ARMENIAN": "hye_Armn",
    "AZERBAIJANI": "azj_Latn",
    "BASQUE": "eus_Latn",
    "BELARUSIAN": "bel_Cyrl",
    "BENGALI": "ben_Beng",
    "BOKMAL": "nob_Latn",
    "BOSNIAN": "bos_Latn",
    "BULGARIAN": "bul_Cyrl",
    "CATALAN": "cat_Latn",
    "CHINESE": "zho_Hans",
    "CROATIAN": "hrv_Latn",
    "CZECH": "ces_Latn",
    "DANISH": "dan_Latn",
    "DUTCH": "nld_Latn",
    "ENGLISH": "eng_Latn",
    "ESPERANTO": "epo_Latn",
    "ESTONIAN": "est_Latn",
    "FINNISH": "fin_Latn",
    "FRENCH": "fra_Latn",
    "GANDA": "lug_Latn",
    "GEORGIAN": "kat_Geor",
    "GERMAN": "deu_Latn",
    "GREEK": "ell_Grek",
    "GUJARATI": "guj_Gujr",
    "HEBREW": "heb_Hebr",
    "HINDI": "hin_Deva",
    "HUNGARIAN": "hun_Latn",
    "ICELANDIC": "isl_Latn",
    "INDONESIAN": "ind_Latn",
    "IRISH": "gle_Latn",
    "ITALIAN": "ita_Latn",
    "JAPANESE": "jpn_Jpan",
    "KAZAKH": "kaz_Cyrl",
    "KOREAN": "kor_Hang",
    "LATVIAN": "lvs_Latn",
    "LITHUANIAN": "lit_Latn",
    "MACEDONIAN": "mkd_Cyrl",
    "MALAY": "zsm_Latn",
    "MAORI": "mri_Latn",
    "MARATHI": "mar_Deva",
    "MONGOLIAN": "khk_Cyrl",
    "NYNORSK": "nno_Latn",
    "PERSIAN": "pes_Arab",
    "POLISH": "pol_Latn",
    "PORTUGUESE": "por_Latn",
    "PUNJABI": "pan_Guru",
    "ROMANIAN": "ron_Latn",
    "RUSSIAN": "rus_Cyrl",
    "SERBIAN": "srp_Cyrl",
    "SHONA": "sna_Latn",
    "SLOVAK": "slk_Latn",
    "SLOVENE": "slv_Latn",
    "SOMALI": "som_Latn",
    "SOTHO": "sot_Latn",
    "SPANISH": "spa_Latn",
    "SWAHILI": "swh_Latn",
    "SWEDISH": "swe_Latn",
    "TAGALOG": "tgl_Latn",
    "TAMIL": "tam_Taml",
    "TELUGU": "tel_Telu",
    "THAI": "tha_Thai",
    "TSONGA": "tso_Latn",
    "TSWANA": "tsn_Latn",
    "TURKISH": "tur_Latn",
    "UKRAINIAN": "ukr_Cyrl",
    "URDU": "urd_Arab",
    "VIETNAMESE": "vie_Latn",
    "WELSH": "cym_Latn",
    "XHOSA": "xho_Latn",
    "YORUBA": "yor_Latn",
    "ZULU": "zul_Latn",
}


# ==========================================
# Translation function
# ==========================================

def translate_text(text, target_language):

    if not text.strip():
        raise ValueError("Text cannot be empty.")

    if target_language not in languages:
        raise ValueError(
            f"Unsupported target language: {target_language}"
        )

    # Detect source language
    detected_language = detector.detect_language_of(text)

    if detected_language is None:
        raise ValueError(
            "Could not detect source language."
        )

    detected_name = detected_language.name

    if detected_name not in SOURCE_MAP:
        raise ValueError(
            f"{detected_name.title()} was detected, "
            "but it is not currently mapped to NLLB."
        )

    source_code = SOURCE_MAP[detected_name]
    target_code = languages[target_language]

    print("Detected:", detected_name)
    print("Source:", source_code)
    print("Target:", target_code)

    tokenizer.src_lang = source_code

    inputs = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512
    )

    target_token_id = tokenizer.convert_tokens_to_ids(
        target_code
    )

    translated_tokens = model.generate(
        **inputs,
        forced_bos_token_id=target_token_id,
        max_length=512
    )

    translated_text = tokenizer.batch_decode(
        translated_tokens,
        skip_special_tokens=True
    )[0]

    return {
        "translation": translated_text,
        "detected_language": detected_name.title(),
        "source_code": source_code,
        "target_code": target_code
    }