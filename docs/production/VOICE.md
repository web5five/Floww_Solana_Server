# Voice experience: source, contract and acceptance

This is the complete voice requirement and its acceptance plan. It is not a
claim that the current Solana workspace records, recognizes or speaks audio.

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

1. Open the voice surface silently. Explain where audio will be processed.
2. Explicit Start requests microphone access. Show actual recording state,
   with Stop and Cancel; never animate a fabricated audio signal.
3. Finish recognition/transcription into visible editable text. Editing is
   optional. The user can keep the text, revise it or cancel it.
4. Ordinary explicit Send enters the existing authenticated refiner/planner
   path. It must preserve the same conversation and Task identity.
5. Show the actual agent answer and optionally speak that answer through the
   selected, disclosed voice path. Provide an immediate Stop playback action.

Speech cannot set financial consent, change approved budgets/payees/expiry or
call signing, execution, reconciliation or recovery. Existing exact on-screen
approval remains required. A linked immutable Task stays read-only; changing
purpose requires an explicit new-request draft. No parallel hidden voice agent
may create a second Task or a separate payment decision.

## Current capability and grant boundary

- The current server sends `microphone=()` and has no capture/STT/TTS surface.
  A future narrowly reviewed policy change is needed for same-origin capture;
  camera, geolocation, frame and other restrictions must remain independent.
- The configured [GPT-5.4 Mini model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
  does not support audio. The current Python adapter sends text to Responses.
  Neither this configuration nor a successful text response proves speech.
- The current validation credential was issued as restricted Responses-only
  access. Its recorded scope is not an Audio/Realtime grant. Do not send audio,
  probe another endpoint or widen the credential merely to test availability.
- A chained server STT/text-agent/TTS profile can preserve the same authority
  path, but needs an approved provider/model, data disclosure and bounded cost.
  The current [transcription guide](https://developers.openai.com/api/docs/guides/transcription)
  distinguishes completed recordings from live-stream transcription. Old model
  names and API examples require fresh verification before implementation.
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
storage. A transcript enters durable conversation storage only through ordinary
authenticated Send. Do not auto-retry capture, provider work or a blocked request.

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

The current iteration records this full scope while implementing the separate
administrator console. It does not close the voice acceptance gate.
