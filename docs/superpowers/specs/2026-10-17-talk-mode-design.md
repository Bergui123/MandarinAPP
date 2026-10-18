# Talk mode: hands-free voice conversation tutor

## Intent

The user wants to practice Mandarin while driving, hands-free, like a phone
call: they talk, a tutor talks back, for sessions up to ~2 hours/day. It must
stay cheap at that volume and tie into the same character-tracking system the
rest of the app already uses: a word taught in conversation joins the same
tracked list Practice reads from, so it shows up there afterward with the
same decaying write/speak-100x targets as any other learned word. Talking
about a word in conversation does not itself increment its rep counts —
those still only move from deliberate reps on the Practice screen, exactly as
today. Conversation's own contribution is the word itself plus a qualitative
note on how well the user seems to know it (see Vocabulary tracking
integration below).

## Goals

- A new "Talk" mode, alongside the existing Practice (writing) screen.
- Fully hands-free once started: tap once to start, it listens, you talk, it
  replies out loud, it listens again — no taps mid-conversation. Tap once (or
  say goodbye) to end.
- The tutor speaks Mandarin at a slow, beginner-friendly pace, mostly using
  words the user already knows, and introduces new words at a random
  frequency — no artificial cap on how many per session; this intentionally
  breaks from Practice's strict one-new-character/day pacing, by the user's
  explicit choice — explaining new words, and answering the user's own
  questions, in English when needed.
- Talk mode's new-word introductions are independent of Practice's daily
  unlock. They don't share a budget and don't affect each other's pacing.
- It "remembers" the user across a session (and ideally across days) via a
  compact running summary, not by resending the full transcript.
- Cheap at 2 hours/day of daily use: no per-minute audio billing anywhere in
  the pipeline, bounded/trimmed context sent to the LLM, short tutor replies.
- A word taught in conversation joins the same tracked list the Practice
  screen reads from (same write/speak-100x decaying-target mechanic), plus a
  short free-text note on how well the user seems to know that word,
  maintained from conversation performance.

## Non-goals / anti-goals

- Not a true real-time voice-to-voice API (OpenAI Realtime, Gemini Live) —
  those bill per audio-minute and would cost tens of dollars/day at this
  usage volume, which fails the "cheap" requirement outright.
- Not pronunciation/tone scoring — out of scope per the user's earlier
  "I'll do tones later" decision for the rest of the app; Talk mode doesn't
  change that.
- Not a perfect bilingual speech recognizer — see Known limitation below.
- Not a full account/sync system — everything stays local to the device,
  consistent with the rest of the app.

## Architecture

**Pipeline, per conversational turn:**

1. On-device speech-to-text transcribes the user's spoken utterance (no
   network cost; this is a native OS capability, not an API).
2. The transcribed text, plus a compact context bundle (see below), is sent
   to DeepSeek's chat completions API. DeepSeek decides what the tutor says
   next — content only, no audio.
3. DeepSeek's text reply is spoken aloud via the same on-device
   text-to-speech already used elsewhere in the app (`expo-speech`), at a
   reduced playback rate for slow, learner-friendly pacing.
4. After playback finishes, the app automatically starts listening again —
   no user action needed. This loop continues until the user ends the call.

**Why on-device STT/TTS instead of a paid voice API:** it's free, and at 2
hours/day any per-minute audio billing would dominate the cost. The only
paid component is the short text round-trip to DeepSeek for deciding what to
say — at DeepSeek's per-token rates, a trimmed-context, short-reply
conversation should run to cents-to-low-dollars/day rather than tens of
dollars.

**Context sent to DeepSeek per turn (kept small deliberately):**

- A system prompt establishing the tutor persona: patient Mandarin tutor,
  speaks slowly and mostly in Mandarin, uses mainly words the user already
  knows, introduces new vocabulary at a random (not fixed) cadence, explains
  new words and answers the user's questions in English when asked, keeps
  replies short (a sentence or two — this is a spoken conversation, not a
  lecture).
- The user's known-word list (hanzi only, not full definitions — keeps this
  block compact even once it's grown past the initial 1500 characters).
  Builder's call: cache this block if DeepSeek's API supports prompt/context
  caching, since it's a stable, repeated prefix.
- The current running memory summary (see below).
- Only the last ~10-15 turns of raw conversation, not the whole session —
  keeps each request's size (and cost) roughly constant no matter how long
  the user has already been talking.

**Running memory (not full transcript):**

Periodically during a session (e.g. roughly every 15-20 exchanges, not only
at the end — a 2-hour call shouldn't lose everything if it's interrupted),
the app asks DeepSeek to fold the recent exchanges into an updated compact
summary of "things worth remembering" (topics discussed, corrections made,
words the user struggled with, anything personal the user shared). This
summary replaces the previous one (bounded size, doesn't grow unbounded) and
is what makes the tutor seem to remember things without resending the whole
history. It persists locally (same storage as the rest of the app's state)
so it can inform future sessions too, not just the current one.

**Vocabulary tracking integration:**

A word DeepSeek introduces in conversation is added to the same learned-word
list the Practice screen already tracks (same id/dateAdded/decaying
write-speak target shape used today). This means the tracked list is no
longer limited to the static 1500-entry HSK dataset built earlier —
conversation can add arbitrary words DeepSeek introduces, each needing
hanzi/pinyin/meaning captured at the point they're taught.

The user decided these can be full words, not just single characters (e.g.
什么, 知道), not only single hanzi. This needs no data-model change —
`CharacterEntry.hanzi` is already a plain string, so a multi-character word
fits it as-is. It's a UI concern, not a storage one: the Practice row and
quiz flashcard both currently render `hanzi` at a large fixed font size
sized for one glyph, which needs to scale down or wrap gracefully for a
longer string. Left to the builder.

In addition to the existing numeric rep-count tracking, each tracked word
gets a short free-text note capturing the tutor's read on how well the user
knows it (e.g., "used correctly unprompted," "hesitated, needed a hint,"
"confused with 买"). This note is generated/updated as part of the periodic
memory-summarization call above (for words touched in that stretch of
conversation), not a separate API call.

## Platform scope: iPhone first

This design targets iOS first. Android support for Talk mode specifically
(the rest of the app stays cross-platform) is deferred — the background-audio
mechanics below are iOS-specific; an Android equivalent (a foreground service
with a persistent notification, different interruption model) would need its
own pass later.

## Background operation (screen off/locked) — highest-risk part of this build

The user confirmed Talk mode must work hands-free with the phone locked or
the screen off, not just foregrounded — this is the realistic condition
while driving. That means:

- **Background audio mode.** `app.json`'s iOS config needs
  `UIBackgroundModes: ["audio"]` so the app can keep an active audio session
  (recording + playback) while backgrounded/locked.
- **Audio session management.** The app needs to hold an `AVAudioSession` in
  a category that permits simultaneous record and playback (`playAndRecord`)
  for the whole call, and handle interruptions — most importantly an
  incoming phone call, which should pause listening/speaking and resume (or
  cleanly end the Talk session) after the interruption clears, rather than
  crash or silently stop.
- **Does the chosen STT library actually keep recognizing in the
  background/locked?** This is the real open risk, not just a permissions
  checkbox. iOS's on-device speech recognition has historically had tighter
  restrictions when the app is backgrounded than when foregrounded, and
  behavior can vary by library and iOS version. **This should be the first
  thing validated, before building the rest of the conversation pipeline on
  top of it** — a small throwaway spike (lock the phone, speak, see if a
  chosen library keeps transcribing) will tell us in minutes whether the v1
  approach holds up, versus discovering it doesn't after the full feature is
  built. If background recognition turns out to be unreliable, the fallback
  is requiring the screen to stay on (simpler, already-designed-for
  alternative from the earlier discussion), not a silent degradation.
- **Mic-in-use indicator.** iOS shows its system mic/recording indicator
  whenever the app is actively listening, including in the background —
  expected and unavoidable, just noting it so it isn't a surprise.

## Known limitation (flagged, not blocking)

On-device speech recognition typically expects one language per session.
The user has said they'll occasionally ask something in English mid-call;
that will be best-effort — DeepSeek is generally capable of making sense of
a rough or mixed transcription even if the recognizer isn't tuned for the
switch, but transcription accuracy for English asides may be lower than for
the Mandarin portions. This is accepted as a reasonable tradeoff, not solved
outright by this design.

## Technical requirements / what changes

- **Development build required.** On-device speech recognition needs native
  code, so Talk mode can no longer run in Expo Go. One-time extra setup
  (`npx expo run:ios`/`run:android` or an EAS development build); still
  free. This affects the whole app from this point on, not just Talk mode.
- **New dependency:** a native speech-recognition library (e.g.
  `expo-speech-recognition` or equivalent) — exact choice and current usage
  to be verified against live docs at implementation time, per this
  project's standing rule not to trust training-data memory of Expo/native
  APIs.
- **DeepSeek API integration:** plain HTTPS call to DeepSeek's chat
  completions endpoint (OpenAI-compatible shape) — no SDK needed. Exact
  endpoint, current model id, and whether/how context caching works will be
  verified against DeepSeek's own docs at implementation time rather than
  assumed.
- **API key storage:** the user pastes their DeepSeek key into a settings
  screen once; stored via secure on-device storage, never hardcoded or
  logged.
- **Data model:** extends the existing learned-character storage (not a
  parallel system) with: a `notes` field per entry, and support for entries
  whose hanzi/pinyin/meaning didn't come from the bundled dataset (i.e.
  originated from a conversation). No change needed to allow multi-character
  `hanzi` values — the field is already a plain string.
- **iOS background audio:** `UIBackgroundModes: ["audio"]` in `app.json`,
  an `AVAudioSession` held in `playAndRecord` for the duration of a call,
  and interruption handling (incoming calls). See Background operation
  above — this is the part of the build most likely to need a fallback.

## What's left to the builder

- A background-speech-recognition spike (lock the phone, confirm the chosen
  library keeps transcribing) before committing to the full pipeline build —
  see Background operation above.
- Exact UI layout of the Talk screen (the "call" affordance, start/end
  controls, any visual indication of listening/speaking state).
- Exact trimming window size (~10-15 turns) and memory-summarization cadence
  (~15-20 exchanges) — tune during testing, not fixed in stone by this doc.
- How the Practice row and quiz flashcard scale down or wrap a multi-character
  `hanzi` string instead of the single-glyph size they use today.
- Exact system prompt wording for the tutor persona.
- Which specific native speech-recognition library to use, confirmed against
  current Expo docs rather than assumed from this doc.
- Exact DeepSeek request/response shape, confirmed against DeepSeek's own
  docs rather than assumed from this doc.
- Android support for Talk mode (deferred — see Platform scope above).
