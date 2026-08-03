import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import languagesData from "./languages.json";
import {
  translateText,
  voiceTranslate,
  imageTranslate,
  speak,
  getSupportedSpeechLanguages,
} from "./api";
import {
  loadHistory,
  addHistoryEntry,
  clearHistory as clearHistoryStorage,
} from "./history";


// =========================================
// ALL LANGUAGES
// =========================================

const languages = Object.keys(languagesData);


function formatHistoryTime(isoString) {

  try {

    return new Date(isoString).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  } catch {

    return "";

  }

}


function historyTypeIcon(type) {

  if (type === "voice") return "🎤";
  if (type === "image") return "▣";
  return "文";

}


function App() {

  // =========================================
  // STATES
  // =========================================

  const [text, setText] = useState("");
  const [translation, setTranslation] = useState("");

  const [targetLanguage, setTargetLanguage] =
    useState("Hindi");

  const [languageSearch, setLanguageSearch] =
    useState("");

  const [showLanguages, setShowLanguages] =
    useState(false);

  const [detectedLanguage, setDetectedLanguage] =
    useState("Auto Detect");

  const [error, setError] =
    useState("");

  // ---- loading states (Problem 7: distinct states instead of one
  // generic isTranslating flag shared by every flow) ----
  const [isTranslating, setIsTranslating] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [mediaRecorder, setMediaRecorder] = useState(null);

  // ---- image preview (Problem 3) ----
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  // ---- translation history (Problem 10) ----
  // Lazy initializer: reads localStorage once on first render instead of
  // rendering empty and immediately re-rendering via an effect.
  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);

  // ---- which target languages currently have a TTS voice available
  // (Problem 4) - null means "not loaded yet, don't restrict anything" ----
  const [supportedSpeechLanguages, setSupportedSpeechLanguages] = useState(null);

  const imageInputRef = useRef(null);
  const currentAudioRef = useRef(null);
  const currentAudioUrlRef = useRef(null);
  const imagePreviewUrlRef = useRef(null);


  // =========================================
  // LOAD SUPPORTED SPEECH LANGUAGES ONCE
  // =========================================

  useEffect(() => {

    let cancelled = false;

    getSupportedSpeechLanguages()
      .then((names) => {
        if (!cancelled) setSupportedSpeechLanguages(names);
      })
      .catch((fetchError) => {
        // Non-fatal: the speak button just falls back to "assume
        // supported" and lets the backend's own error handling cover it.
        console.error("Could not load supported speech languages:", fetchError);
      });

    return () => {
      cancelled = true;
    };

  }, []);

  // Release any outstanding image preview URL when the component
  // unmounts (Problem 3: "Release temporary browser object URLs
  // correctly").
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) {
        URL.revokeObjectURL(imagePreviewUrlRef.current);
      }
    };
  }, []);


  // =========================================
  // SEARCH LANGUAGES
  // =========================================

  const filteredLanguages = useMemo(() => {

    const search = languageSearch
      .trim()
      .toLowerCase();

    if (!search) {
      return languages;
    }


    // Languages beginning with search appear first
    const startsWith = languages.filter(
      (language) =>
        language
          .toLowerCase()
          .startsWith(search)
    );


    // Then languages containing search
    const contains = languages.filter(
      (language) => {

        const name =
          language.toLowerCase();

        return (
          name.includes(search) &&
          !name.startsWith(search)
        );
      }
    );


    return [
      ...startsWith,
      ...contains
    ];

  }, [languageSearch]);


  // =========================================
  // DERIVED BUSY / AVAILABILITY FLAGS
  // (Problem 7: "Prevent duplicate requests. Disable relevant controls
  // during processing. Do not unnecessarily block unrelated UI.")
  // =========================================

  // True while a *different* action owns the request/response cycle.
  // Recording is deliberately excluded here since the mic button's own
  // job during a recording is to stop it, not to be disabled by it.
  const otherActionsBusy =
    isTranslating ||
    isProcessingVoice ||
    isReadingImage ||
    isGeneratingSpeech;

  const speechSupported =
    supportedSpeechLanguages === null ||
    supportedSpeechLanguages.includes(targetLanguage);

  const canSwap =
    Boolean(translation.trim()) &&
    Object.prototype.hasOwnProperty.call(languagesData, detectedLanguage) &&
    !otherActionsBusy &&
    !isRecording;

  const speakDisabled =
    (!translation.trim() && !isSpeaking && !isGeneratingSpeech) ||
    (!speechSupported && !isSpeaking && !isGeneratingSpeech) ||
    ((isTranslating || isProcessingVoice || isReadingImage || isRecording) &&
      !isSpeaking &&
      !isGeneratingSpeech);


  // =========================================
  // IMAGE PREVIEW HELPERS
  // =========================================

  const updateImagePreview = (newUrl) => {

    if (imagePreviewUrlRef.current) {
      URL.revokeObjectURL(imagePreviewUrlRef.current);
    }

    imagePreviewUrlRef.current = newUrl;

    setImagePreviewUrl(newUrl);

  };


  // =========================================
  // HISTORY HELPERS
  // =========================================

  const recordHistory = (type, originalText, translatedText, detected, target) => {

    setHistory(
      addHistoryEntry({
        type,
        originalText,
        translation: translatedText,
        detectedLanguage: detected,
        targetLanguage: target,
      })
    );

  };

  const handleReuseHistoryEntry = (entry) => {

    setText(entry.originalText);
    setTranslation(entry.translation);
    setDetectedLanguage(entry.detectedLanguage);
    setTargetLanguage(entry.targetLanguage);
    setError("");
    setShowHistory(false);

    // We don't store the original image bytes, so drop any stale
    // preview from a previous image translation.
    updateImagePreview(null);

  };

  const handleClearHistory = () => {
    setHistory(clearHistoryStorage());
  };


  // =========================================
  // SELECT TARGET LANGUAGE
  // =========================================

  const selectLanguage = (language) => {

    setTargetLanguage(language);

    setLanguageSearch("");

    setShowLanguages(false);

    // Remove old translation when language changes
    setTranslation("");

    setError("");

  };


  // =========================================
  // TRANSLATE
  // =========================================

  const handleTranslate = async () => {

    if (!text.trim() || otherActionsBusy || isRecording) {
      return;
    }

    const requestedTarget = targetLanguage;

    try {

      setIsTranslating(true);

      setError("");

      setTranslation("");


      const data = await translateText(text, requestedTarget);


      setTranslation(data.translation);

      setDetectedLanguage(data.detected_language);

      recordHistory(
        "text",
        text,
        data.translation,
        data.detected_language,
        requestedTarget
      );

    }

    catch (error) {

      console.error(
        "Translation error:",
        error
      );


      setError(
        error.message ||
        "Could not connect to translator."
      );

    }

    finally {

      setIsTranslating(false);

    }

  };


  // =========================================
  // COPY TRANSLATION
  // =========================================

  const handleCopy = async () => {

    if (!translation) {
      return;
    }


    try {

      await navigator.clipboard.writeText(
        translation
      );

    }

    catch (error) {

      console.error(
        "Could not copy text:",
        error
      );

    }

  };


  // =========================================
  // CLEAR
  // =========================================

  const handleClear = () => {

    setText("");

    setTranslation("");

    setDetectedLanguage(
      "Auto Detect"
    );

    setError("");

    updateImagePreview(null);

  };


  // =========================================
  // VOICE RECORDING
  // =========================================

  const handleVoiceRecording = async () => {

    // STOP RECORDING
    if (isRecording) {

      if (mediaRecorder) {
        mediaRecorder.stop();
        setIsRecording(false);
      }

      return;
    }

    // Don't allow starting a new recording while another action owns
    // the request/response cycle.
    if (otherActionsBusy) {
      return;
    }

    // START RECORDING
    try {

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });


      const recorder =
        new MediaRecorder(stream);


      const chunks = [];


      recorder.ondataavailable = (event) => {

        if (event.data.size > 0) {
          chunks.push(event.data);
        }

      };


      recorder.onstop = async () => {

        const audioBlob =
          new Blob(
            chunks,
            {
              type: recorder.mimeType
            }
          );


        stream
          .getTracks()
          .forEach(
            track => track.stop()
          );


        await sendVoiceToBackend(
          audioBlob
        );

      };


      recorder.start();


      setMediaRecorder(
        recorder
      );


      setIsRecording(true);


    }

    catch (error) {

      console.error(error);

      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {

        setError(
          "Microphone access was denied. Please allow microphone " +
          "permissions in your browser and try again."
        );

      } else if (error.name === "NotFoundError") {

        setError(
          "No microphone was found on this device."
        );

      } else {

        setError(
          "Microphone access failed."
        );

      }

    }

  };

  const sendVoiceToBackend = async (audioBlob) => {

    const requestedTarget = targetLanguage;

    try {

      setIsProcessingVoice(true);

      setError("");


      const data = await voiceTranslate(audioBlob, requestedTarget);


      // Put recognized speech in input
      setText(
        data.original_text
      );


      // Put translation in output
      setTranslation(
        data.translation
      );


      setDetectedLanguage(
        data.detected_language
      );

      recordHistory(
        "voice",
        data.original_text,
        data.translation,
        data.detected_language,
        requestedTarget
      );


    }

    catch (error) {

      console.error(error);

      setError(
        error.message ||
        "Voice translation failed."
      );

    }

    finally {

      setIsProcessingVoice(false);

    }

  };


  // =========================================
  // TEXT TO SPEECH
  // =========================================

  const handleSpeak = async () => {

    // =========================================
    // IF ALREADY SPEAKING -> STOP
    // =========================================

    if (currentAudioRef.current) {

      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;

      currentAudioRef.current = null;

      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(
          currentAudioUrlRef.current
        );

        currentAudioUrlRef.current = null;
      }

      setIsSpeaking(false);

      return;
    }

    // Already generating - avoid firing a duplicate request.
    if (isGeneratingSpeech) {
      return;
    }


    if (!translation.trim()) {

      setError(
        "There is no translation to speak."
      );

      return;
    }


    try {

      setError("");
      setIsGeneratingSpeech(true);


      const audioBlob = await speak(translation, targetLanguage);


      const audioUrl =
        URL.createObjectURL(
          audioBlob
        );


      const audio =
        new Audio(audioUrl);


      // Store current audio
      currentAudioRef.current =
        audio;

      currentAudioUrlRef.current =
        audioUrl;

      setIsGeneratingSpeech(false);
      setIsSpeaking(true);


      // =========================================
      // AUDIO FINISHED
      // =========================================

      audio.onended = () => {

        if (
          currentAudioUrlRef.current
        ) {

          URL.revokeObjectURL(
            currentAudioUrlRef.current
          );

        }

        currentAudioRef.current =
          null;

        currentAudioUrlRef.current =
          null;

        setIsSpeaking(false);

      };


      // =========================================
      // AUDIO ERROR
      // =========================================

      audio.onerror = () => {

        if (
          currentAudioUrlRef.current
        ) {

          URL.revokeObjectURL(
            currentAudioUrlRef.current
          );

        }

        currentAudioRef.current =
          null;

        currentAudioUrlRef.current =
          null;

        setIsSpeaking(false);

        setError(
          "The generated audio could not be played."
        );

      };


      await audio.play();

    }

    catch (error) {

      console.error(
        "TTS error:",
        error
      );

      currentAudioRef.current =
        null;

      currentAudioUrlRef.current =
        null;

      setIsGeneratingSpeech(false);
      setIsSpeaking(false);

      setError(
        error.message ||
        "Speech generation failed."
      );

    }

  };


  // =========================================
  // IMAGE TRANSLATION
  // =========================================

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (otherActionsBusy || isRecording) {
      event.target.value = "";
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setError(
        "Please select a JPG, PNG or WEBP image."
      );

      event.target.value = "";
      return;
    }

    const requestedTarget = targetLanguage;

    try {
      setIsReadingImage(true);
      setError("");
      setTranslation("");

      updateImagePreview(URL.createObjectURL(file));

      // We only send the TARGET language.
      // Backend automatically detects image language.
      const data = await imageTranslate(file, requestedTarget);

      // OCR result
      setText(
        data.original_text
      );

      // Translated result
      setTranslation(
        data.translation
      );

      // Automatically detected language
      setDetectedLanguage(
        data.detected_language
      );

      recordHistory(
        "image",
        data.original_text,
        data.translation,
        data.detected_language,
        requestedTarget
      );
    }

    catch (error) {
      console.error(
        "Image translation error:",
        error
      );

      setError(
        error.message ||
        "Could not translate the image."
      );
    }

    finally {
      setIsReadingImage(false);

      // Allows same image to be selected again
      event.target.value = "";
    }
  };

  const handleRemoveImage = () => {
    updateImagePreview(null);
  };


  // =========================================
  // SWAP
  // =========================================

  const handleSwap = () => {

    if (!canSwap) {
      return;
    }

    setText(translation);
    setTargetLanguage(detectedLanguage);
    setTranslation("");
    setDetectedLanguage("Auto Detect");
    setError("");

  };


  // =========================================
  // DYNAMIC PLACEHOLDERS (Problem 7)
  // =========================================

  const inputPlaceholder = isRecording
    ? "Recording... click the mic to stop"
    : "Type or paste text here...";

  const outputPlaceholder = (() => {
    if (isTranslating) return "Translating...";
    if (isProcessingVoice) return "Processing voice...";
    if (isReadingImage) return "Reading image...";
    if (isGeneratingSpeech) return "Generating speech...";
    return "Translation will appear here...";
  })();

  const speakTitle = (() => {
    if (!speechSupported && !isSpeaking && !isGeneratingSpeech) {
      return `Speech isn't available for ${targetLanguage} yet`;
    }
    if (isSpeaking) return "Stop speaking";
    if (isGeneratingSpeech) return "Generating speech...";
    return "Listen to translation";
  })();


  // =========================================
  // UI
  // =========================================

  return (

    <div className="app">


      {/* =====================================
          NAVBAR
      ===================================== */}

      <nav className="navbar">

        <div className="brand">

          <div className="logo">
            S
          </div>


          <div>

            <h2>
              SAVIX <span>AI</span>
            </h2>

            <p>
              Your Life. Your AI. Your Way.
            </p>

          </div>

        </div>


        <div className="nav-right">

          <button
            className="history-button"
            type="button"
            onClick={() => setShowHistory(true)}
          >
            History{history.length > 0 ? ` (${history.length})` : ""}
          </button>


          <div className="profile">

            <div className="avatar">
              S
            </div>

          </div>

        </div>

      </nav>


      {/* =====================================
          HISTORY PANEL
      ===================================== */}

      {showHistory && (

        <div
          className="history-overlay"
          onClick={() => setShowHistory(false)}
        >

          <div
            className="history-panel"
            onClick={(event) => event.stopPropagation()}
          >

            <div className="history-panel-header">

              <h3>Translation History</h3>

              <button
                type="button"
                className="history-close"
                title="Close"
                onClick={() => setShowHistory(false)}
              >
                ✕
              </button>

            </div>

            {history.length === 0 ? (

              <div className="history-empty">
                No translations yet. Anything you translate will show
                up here.
              </div>

            ) : (

              <>

                <div className="history-list">

                  {history.map((entry) => (

                    <button
                      type="button"
                      key={entry.id}
                      className="history-item"
                      onClick={() => handleReuseHistoryEntry(entry)}
                    >

                      <div className="history-item-top">

                        <span className="history-type-badge">
                          {historyTypeIcon(entry.type)}
                        </span>

                        <span className="history-languages">
                          {entry.detectedLanguage} → {entry.targetLanguage}
                        </span>

                        <span className="history-time">
                          {formatHistoryTime(entry.timestamp)}
                        </span>

                      </div>

                      <div className="history-item-text">
                        {entry.originalText}
                      </div>

                      <div className="history-item-translation">
                        {entry.translation}
                      </div>

                    </button>

                  ))}

                </div>

                <button
                  type="button"
                  className="history-clear"
                  onClick={handleClearHistory}
                >
                  Clear history
                </button>

              </>

            )}

          </div>

        </div>

      )}


      {/* =====================================
          MAIN CONTENT
      ===================================== */}

      <main className="main-content">


        {/* =====================================
            HERO
        ===================================== */}

        <section className="hero">

          <div className="hero-icon">
            文
          </div>


          <div>

            <h1>
              AI Translator
            </h1>

            <p>
              Translate text, voice and images
              instantly across languages.
            </p>

          </div>

        </section>


        {/* =====================================
            TRANSLATOR CARD
        ===================================== */}

        <section className="translator-card">


          {/* =====================================
              LANGUAGE SELECTORS
          ===================================== */}

          <div className="language-row">


            {/* FROM */}

            <div className="language-box">

              <label>
                FROM
              </label>


              <div className="language-value">

                <div className="language-icon auto">
                  ✦
                </div>


                <div>

                  <strong>
                    {detectedLanguage}
                  </strong>

                  <p>
                    Detect language automatically
                  </p>

                </div>

              </div>

            </div>


            {/* SWAP */}

            <button
              className="swap"
              title={
                canSwap
                  ? "Swap languages"
                  : "Translate something first to enable swap"
              }
              type="button"
              disabled={!canSwap}
              onClick={handleSwap}
            >
              ⇄
            </button>


            {/* TO */}

            <div className="language-box">

              <label>
                TO
              </label>


              <div className="language-picker">


                {/* CURRENT TARGET */}

                <button
                  type="button"
                  className="selected-language"
                  onClick={() =>
                    setShowLanguages(
                      !showLanguages
                    )
                  }
                >

                  <div className="language-icon">
                    文
                  </div>


                  <div className="selected-language-text">

                    <span>
                      {targetLanguage}
                    </span>


                    <small>
                      {
                        languagesData[
                          targetLanguage
                        ]
                      }
                    </small>

                  </div>


                  <span className="dropdown-arrow">
                    ▾
                  </span>

                </button>


                {/* =====================================
                    LANGUAGE DROPDOWN
                ===================================== */}

                {showLanguages && (

                  <div className="language-dropdown">


                    {/* SEARCH */}

                    <div className="language-search">

                      <span>
                        🔍
                      </span>


                      <input
                        autoFocus
                        type="text"
                        placeholder="Search language..."
                        value={languageSearch}
                        onChange={(e) =>
                          setLanguageSearch(
                            e.target.value
                          )
                        }
                      />

                    </div>


                    {/* RESULT COUNT */}

                    <div className="language-count">

                      {
                        filteredLanguages.length
                      } languages

                    </div>


                    {/* LANGUAGE LIST */}

                    <div className="language-list">

                      {
                        filteredLanguages.length > 0
                          ? (

                            filteredLanguages.map(
                              (language) => (

                                <button
                                  type="button"
                                  key={language}
                                  className={
                                    targetLanguage === language
                                      ? "language-option active"
                                      : "language-option"
                                  }
                                  onClick={() =>
                                    selectLanguage(
                                      language
                                    )
                                  }
                                >

                                  <div>

                                    <strong>
                                      {language}
                                    </strong>


                                    <span>
                                      {
                                        languagesData[
                                          language
                                        ]
                                      }
                                    </span>

                                  </div>


                                  {
                                    targetLanguage === language &&
                                    (
                                      <span className="check">
                                        ✓
                                      </span>
                                    )
                                  }

                                </button>

                              )
                            )

                          )
                          : (

                            <div className="no-language">

                              No language found

                            </div>

                          )
                      }

                    </div>

                  </div>

                )}

              </div>

            </div>

          </div>


          {/* =====================================
              TRANSLATION AREA
          ===================================== */}

          <div className="translation-grid">


            {/* =====================================
                INPUT
            ===================================== */}

            <div className="translation-panel">


              <div className="panel-title">

                <span>
                  Original Text
                </span>


                <button
                  type="button"
                  className="clear"
                  onClick={handleClear}
                >
                  Clear
                </button>

              </div>


              {imagePreviewUrl && (

                <div className="image-preview">

                  <img src={imagePreviewUrl} alt="Uploaded source" />

                  <button
                    type="button"
                    className="image-preview-remove"
                    title="Remove image"
                    onClick={handleRemoveImage}
                  >
                    ✕
                  </button>

                </div>

              )}


              <textarea
                placeholder={inputPlaceholder}
                value={text}
                onChange={(e) => {

                  setText(
                    e.target.value
                  );

                  setError("");

                }}
              />


              <div className="panel-footer">


                <div className="input-tools">


                  {/* VOICE */}

                  <button
                    type="button"
                    className={
                    isRecording
                    ? "tool-button recording"
                    : "tool-button"
                    }
                    title={
                    isRecording
                    ? "Stop recording"
                    : "Start recording"
                    }
                    disabled={otherActionsBusy}
                     onClick={handleVoiceRecording}
                    >
                    {isRecording ? "⏹" : "🎤"}
                  </button>


                  {/* IMAGE */}

                  <>
  <button
    type="button"
    className="tool-button"
    title="Upload image"
    disabled={otherActionsBusy || isRecording}
    onClick={() =>
      imageInputRef.current?.click()
    }
  >
    ▣
  </button>

  <input
    ref={imageInputRef}
    type="file"
    accept="image/jpeg,image/png,image/webp"
    onChange={handleImageUpload}
    style={{ display: "none" }}
  />
</>

                </div>


                <span className="character-count">

                  {text.length} characters

                </span>

              </div>

            </div>


            {/* =====================================
                OUTPUT
            ===================================== */}

            <div className="translation-panel output">


              <div className="panel-title">

                <span>
                  Translation
                </span>


                <span className="target-label">
                  {targetLanguage}
                </span>

              </div>


              <textarea
                value={translation}
                placeholder={outputPlaceholder}
                readOnly
              />


              <div className="panel-footer">


                <div className="detected">

                  {
                    translation
                      ? `${detectedLanguage} → ${targetLanguage}`
                      : "AI Translation"
                  }

                </div>


                <div className="output-tools">


                  {/* SPEAK */}

<button
  type="button"
  className="tool-button"
  title={speakTitle}
  disabled={speakDisabled}
  onClick={handleSpeak}
>
  {isGeneratingSpeech ? "◌" : isSpeaking ? "⏹" : "🔊"}
</button>



                  {/* COPY */}

                  <button
                    type="button"
                    className="tool-button"
                    title="Copy"
                    disabled={!translation}
                    onClick={handleCopy}
                  >
                    ▢
                  </button>

                </div>

              </div>

            </div>

          </div>


          {/* =====================================
              ERROR
          ===================================== */}

          {error && (

            <div className="error-message">

              {error}

            </div>

          )}


          {/* =====================================
              TRANSLATE BUTTON
          ===================================== */}

          <button
            type="button"
            className="translate-button"
            disabled={
              !text.trim() ||
              otherActionsBusy ||
              isRecording
            }
            onClick={handleTranslate}
          >

            {
              isTranslating
                ? (
                  <>
                    <span>◌</span>
                    Translating...
                  </>
                )
                : (
                  <>
                    <span>✦</span>
                    Translate to {targetLanguage}
                  </>
                )
            }

          </button>

        </section>


        {/* =====================================
            FEATURES
        ===================================== */}

        <section className="features">


          {/* TEXT */}

          <div className="feature">

            <div className="feature-icon blue">
              文
            </div>


            <div>

              <strong>
                Text Translation
              </strong>

              <p>
                Translate across 200+
                language/script combinations
              </p>

            </div>

          </div>


          {/* VOICE */}

          <div className="feature">

            <div className="feature-icon green">
              🎤
            </div>


            <div>

              <strong>
                Voice Translation
              </strong>

              <p>
                Speak naturally and translate
                your voice
              </p>

            </div>

          </div>


          {/* IMAGE */}

          <div className="feature">

            <div className="feature-icon purple">
              ▣
            </div>


            <div>

              <strong>
                Image Translation
              </strong>

              <p>
                Extract and translate text
                from images
              </p>

            </div>

          </div>

        </section>

      </main>

    </div>

  );

}

export default App;
