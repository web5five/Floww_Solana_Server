# Voice experience: source, contract and acceptance

This records the complete voice requirement, selected implementation profile
and acceptance gates. Engineering checks and installed voice inventory do not
establish an actual recorded, recognized and audible user turn.

## Original scope

The September 30 user requests cover two connected surfaces: a voice-agent screen
at 07:12:53 KST (source 72901), then a functional chat microphone at 07:18:30
(source 73018). ChatGPT/ElevenLabs interaction was a reference. A prerecorded
guide, decorative microphone or unsupported-button state cannot complete this
scope. [USER_INTENT.md](USER_INTENT.md) preserves the original source mapping.

The earlier Client `F033D_VOICE_CONTRACT.md` describes one full voice panel and
its chat launcher, silent opening, explicit Start and owner/Task cleanup. Its
implementation is a useful interaction reference, not a transfer of its old
provider credential, EVM/pharmacy contract or live-acceptance evidence.

## One request and one authority path

Both surfaces must use the current conversation and linked Task. The intended
complete audible turn is:

1. Open the voice surface silently. Explain where audio will be processed. The
   chat microphone starts review-first. The full view also offers an explicit
   one-turn conversation mode with its language and named local voice visible.
2. Explicit Start requests microphone access. Show actual recording state,
   with Stop and Cancel; never animate a fabricated audio signal.
3. Finish recognition/transcription into visible text. In review-first mode,
   the user can keep it, edit it or cancel it before ordinary explicit Send.
   The one-turn mode instead authorizes this one utterance to enter the current
   assistant when Stop finishes recording; it must not silently send an earlier
   typed draft or a draft/scope edited during capture.
4. Both modes use the same authenticated message/refiner/planner path and
   preserve the conversation and Task identity. There is no separate voice
   agent or model instruction path.
5. Show the actual new agent answer. Review-first mode offers explicit playback;
   the authorized one-turn mode reads that new answer using the selected local
   voice. Provide immediate Stop playback. A queued synthesis call is not proof
   that playback started or was audible.

One-turn mode authorizes exactly one recording-to-answer cycle. It does not
start the next microphone automatically, add continuous listening/VAD or retry
an uncertain request. A failed or stale send cannot speak an older answer as
though it were this turn's result. Cancelling after a message was admitted
stops subsequent voice work; it cannot claim to retract the stored message.

Speech cannot set financial consent, change approved budgets/payees/expiry or
call signing, execution, reconciliation or recovery. Existing exact on-screen
approval remains required. A linked immutable Task stays read-only; changing
purpose requires an explicit new-request draft. No parallel hidden voice agent
may create a second Task or a separate payment decision.

## Current capability and grant boundary

- Capture remains off by default. Only an explicitly enabled and separately
  configured voice runtime may allow same-origin microphone access. Camera,
  geolocation, frame and other restrictions remain independent.
- The configured [GPT-5.4 Mini model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
  does not support audio. The current Python adapter sends text to Responses.
  Neither this configuration nor a successful text response proves speech.
- The current validation credential was issued as restricted Responses-only
  access. Its recorded scope is not an Audio/Realtime grant. Do not send audio,
  probe another endpoint or widen the credential merely to test availability.
- The selected profile uses bounded recorded speech with
  [GPT Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe),
  then the existing text agent and an explicitly selected local device voice.
  The [file-transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text)
  recommends `gpt-transcribe`; its current language hint is `languages`, not the
  singular legacy field. Actual remote transcription still needs its own grant,
  disclosed data flow and bounded validation budget.
- On-device recognition and a verified local TTS voice are an alternative only
  where the actual browser/language pack proves that capability. Browser API
  presence alone does not establish local processing. Never silently fall back
  to browser-cloud recognition or a remote voice.

The [Web Speech specification](https://webaudio.github.io/web-speech-api/#security-and-privacy-considerations)
requires clear consent and recording indication. Browser recognition can use
remote services; `processLocally` is not enabled by default, as documented for
[SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
and [processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally).
TTS locality is a separate [voice property](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

## Selected recorded-turn profile

The full voice view and compact chat microphone use one controller and one
owned conversation. Opening either surface or restoring a URL is silent and
read-only. Explicit Start may bind the existing draft through the ordinary
conversation creation path; it must not create a second voice-only record or
lose typed scope, memory choice or retry identity.

The capture graph uses [AudioWorklet](https://www.w3.org/TR/webaudio/#AudioWorklet)
with actual-rate accounting and a bounded sample buffer. A muted graph prevents
microphone monitoring. A device rate other than16kHz requires real resampling,
not a relabelled header. The canonical upload is44-byte RIFF/WAVE PCM followed
by nonempty, even PCM16 little-endian mono data at16kHz. Maximum length is60s /
960,000 samples /1,920,044 bytes. Both browser capture and server validation
bound duration from real frames/bytes rather than a client duration assertion.

`POST /api/voice/transcriptions` accepts only identity-encoded `audio/wav`, no
query, and these context headers:

- `X-Floww-Conversation-Id`: the owned conversation UUID.
- `X-Floww-Expected-Revision`: its positive safe-integer revision.
- `X-Floww-Language`: `ko` or `en`, an input hint rather than detected language.
- `X-Floww-Capture-Id`: a fresh capture UUID.
- `X-Floww-Voice-Consent: true`: the disclosed recording upload was authorized.

Host/origin/drain checks, session authentication, writable context and bounded
operation admission precede raw-body allocation. The same owner/session,
conversation/revision, unlinked state, drain and cancellation are rechecked
before provider work and before transcript release. Raw audio and returned text
are not appended to the conversation by this endpoint. A returned transcript
is plain untrusted text, at most2000 UTF-16 code units. Review-first Send or the
explicitly authorized one-turn send still applies existing scope/refinement
and plan/critic gates.

The successful versioned response contains capture ID, conversation ID,
revision, language hint, byte-derived duration and text. It does not expose
provider IDs, raw vendor errors or credentials. No prompt, memory, earlier
conversation or wallet is sent to the transcription provider. Its multipart
file is named `capture.wav` and its model is fixed server-side.

Voice uses its own atomic, durable UTC-day admission counters, separate from
model-role calls: global/owner calls and global/owner rounded-up seconds. The
selected ceilings are30 calls/600 seconds globally and10 calls/180 seconds per
owner. Reservations retained after uncertain/cancelled work are admission facts,
not a billing estimate or successful recognition count. Process-local capture-ID
refusal is bounded and temporary; it is not cross-restart exactly-once delivery.
No transcript cache or automatic vendor retry is introduced.

`FLOWW_ENABLE_VOICE` defaults off. `FLOWW_VOICE_API_KEY` is a separate server-only
credential; there is no fallback to the existing restricted Responses key.
`voiceConfigured` describes local configuration, not vendor health, microphone
permission or recognition quality. Actual key issuance/permission changes and
real audio upload are separate from implementing this reviewable code.

Reply playback passes only actual current owned assistant text to an explicitly
chosen same-language voice with `localService=true`. There is no default-voice
or cloud fallback. The native browser inventory on November7 advertised local
KO and EN voices, including유나 andSamantha; no audio was played or captured by
that inventory. Later controlled native checks observed유나/Daniel playback
start and Stop, separately recorded in [VERIFICATION.md](VERIFICATION.md).
Real microphone/provider behavior and human audibility remain acceptance checks.
The [Web Speech draft](https://webaudio.github.io/web-speech-api/#speechsynthesisvoice)
defines the local-service property. The current OpenAI
[text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
marks the legacy Speech API models for shutdown on January6,2027 and describes
a different Realtime migration workflow; that deprecated API is not introduced
for this device-playback profile.

For a linked Task, the read-only reply projection must prefer that exact current
Task's delivered structured `result.answer.answer_text` over an older planning
message. Confirmed payment, completed delivery, matching Task/conversation and
result version are required. Synthetic/partial-data notices and the fact that
observed transfer totals are not a balance or profit accompany both visible and
spoken output. Missing results remain pending/unavailable. A report appearing
does not trigger automatic playback; the user explicitly reads a saved result.

## State, privacy and cleanup acceptance

The shared controller needs idle, permission-pending, listening, finishing,
transcribing, editable-transcript, submitting, speaking, cancelled and failed
states. Scope every asynchronous callback to owner/session generation,
conversation/Task, route and capture token. Fence a late permission grant after
cancel, logout or navigation before using its tracks.

Stop owned tracks, recognition and playback on Cancel, scope/owner/session or
language change, timeout, backgrounding, pagehide and surface transition. Keep
the original draft and completed text where the current owner is unchanged;
clear private audio/text on owner change. Late responses must not repopulate it.
Audio/transcripts do not belong in URLs, history state, telemetry, logs or local
storage. A transcript enters durable conversation storage only through the
ordinary authenticated message route, after review-first Send or a disclosed
one-turn authorization. Do not auto-retry capture, provider work or a blocked
request.

Handle denied or unanswered permission prompts, missing devices, no speech,
ended tracks, unsupported codec/language, unavailable provider, timeout and
session expiry. Preserve typing as a usable path. Keyboard focus, Escape,
readable status and 44px mobile controls are part of both surfaces.

## Evidence required to close the requirement

- Independent review of the complete two-surface implementation and its actual
  authority, disclosure, cleanup and error boundaries.
- Actual secure-origin microphone permission and KO+EN speech→recognized
  text→existing agent answer→audible reply, retaining the same request/Task.
- Real cancellation/denial, navigation/backgrounding and owner/session cleanup
  on desktop and 390px. Confirm every owned track/recognizer/player ends.
- Provider/local-processing evidence and bounded cost records for the selected
  path. Injected audio ports, prerecorded narration and static UI screenshots
  remain separate engineering checks, not actual speech acceptance.

The current implementation phase retains this full scope. Actual microphone,
authorized transcription, current-agent reply and audible KO/EN acceptance must
be recorded before the voice gate can close.
