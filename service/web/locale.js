/* Authored interface copy only. External/user/model/report content stays inert and unchanged. */
(() => {
  'use strict';
  const COPY = {
  "lifecycle.checking": ["로그인 확인 중", "Checking your session"],
  "lifecycle.checkingCopy": ["현재 로그인 상태를 확인한 뒤 화면을 엽니다.", "Your workspace opens after your current session is checked."],
  "lifecycle.unavailable": ["로그인을 확인하지 못했습니다. 연결을 다시 확인해 주세요.", "Your session could not be verified. Check the connection again to continue."],
  "lifecycle.retry": ["로그인 상태 다시 확인", "Check session again"],
  "voice.modeOptions": ["음성 대화 방식 선택", "Choose a voice interaction"],
  "voice.mode": ["이번에 사용할 방식", "Mode for this turn"],
  "voice.reviewMode": ["글을 검토한 뒤 직접 보내기", "Review text before sending"],
  "voice.turnMode": ["한 번 말하고 답변 듣기", "Say one turn and hear the answer"],
  "voice.turnStart": ["한 번 말하고 답변 듣기", "Start one spoken turn"],
  "voice.turnConsent": ["이번 한 번의 변환·전송·답변 읽기에 동의합니다.", "I agree to transcribe, send and read the answer for this one turn."],
  "voice.turnDisclosure": ["녹음 중지 또는60초 제한 시 같은 대화로 한 번 보내고, 새 답변을 {voice} · {language}로 읽습니다. 마이크는 꺼집니다.", "Stop or the60-second limit sends this utterance once to the same assistant and reads its new answer with {voice} · {language}. The microphone then stays off."],
  "voice.turnDraftBlocked": ["기존 입력이 있어 글을 검토한 뒤 보내는 방식을 사용합니다. 기존 글은 유지됩니다.", "A typed draft is already present. Use review-first mode so it remains under your control."],
  "voice.turnSending": ["같은 대화로 이번 말을 보내고 있습니다.", "Sending this utterance to the same conversation."],
  "voice.turnStopped": ["읽기와 다음 동작을 중지했습니다. 요청한 전송은 현재 대화에서 확인해 주세요.", "Playback and follow-up stopped. Check the issued message in the current conversation."],
  "voice.turnVoiceRequired": ["이번 답변을 읽을 언어와 이 기기의 음성을 먼저 선택해 주세요.", "Choose this turn’s reading language and an on-device voice first."],

  "voice.disclosureShort": ["녹음을 중지하면 음성을 OpenAI에 보내 글로 변환합니다.", "After Stop, audio is sent to OpenAI for transcription."],
  "voice.privacy": ["음성과 텍스트 처리 안내", "How audio and text are processed"],
  "voice.readyTitle": ["음성 입력", "Voice input"],
  "voice.listeningTitle": ["듣고 있습니다", "Listening"],
  "voice.transcribingTitle": ["글로 바꾸고 있습니다", "Transcribing"],
  "voice.reviewTitle": ["보낼 글을 확인해 주세요", "Review your text"],
  "voice.readStopped": ["음성 읽기를 중지했습니다.", "Spoken playback stopped."],
  "voice.readFinished": ["이 응답의 음성 읽기를 마쳤습니다.", "Finished reading this answer."],
  "voice.recordAgain": ["다시 녹음하기", "Record again"],
  "voice.turnAssistantUnavailable": ["지금은 AI 답변을 준비할 수 없습니다. 글을 검토하는 방식으로 입력을 이어갈 수 있습니다.", "The assistant cannot prepare an answer right now. You can continue with review-first input."],
  "voice.turnModeSummary": ["한 번 대화 · {language} · {voice}", "One spoken turn · {language} · {voice}"],
  "voice.transferCaution": ["이체 내역은 지갑 잔액이나 수익을 뜻하지 않습니다.", "Observed transfers do not establish wallet balances or profit."],
  "voice.nextTurn": ["다음 말을 이어갈까요?", "Continue with another turn?"],
  "voice.reportPending": ["연결된 작업의 결과를 아직 읽을 수 없습니다. 현재 작업 상태를 화면에서 확인해 주세요.", "The linked task report is not available to read yet. Check the current task on screen."],
  "voice.readStarting": ["선택한 기기 음성으로 읽기를 준비하고 있습니다.", "Preparing playback with the selected on-device voice."],
  "voice.nav": ["음성으로 대화", "Voice conversation"],
  "voice.eyebrow": ["말로 이어가는 같은 대화", "THE SAME CONVERSATION, BY VOICE"],
  "voice.title": ["이제, 목소리로 이어가요.", "Continue with your voice."],
  "voice.description": ["말을 글로 확인하고 같은 요청과 답변을 이어갑니다.", "Review what you said, then continue the same request and answer."],
  "voice.mic": ["음성 입력 열기", "Open voice input"],
  "voice.continue": ["채팅에서 이어가기", "Continue in chat"],
  "voice.close": ["음성 입력 닫기", "Close voice input"],
  "voice.ready": ["편하게 말씀해 주세요", "Say what you need"],
  "voice.level": ["현재 마이크 입력", "Current microphone input"],
  "voice.disclosure": ["녹음을 멈추면 음성을 OpenAI에 보내 글로 변환합니다. Floww는 녹음 파일을 대화에 첨부하지 않습니다. 전사문은 검토 후 직접 보낼 때 대화에 저장됩니다.", "After Stop, audio is sent to OpenAI for transcription. Floww does not attach recordings to the conversation. Only the reviewed text enters it when you explicitly send."],
  "voice.consent": ["이번 녹음의 음성 변환에 동의합니다.", "I agree to transcribe this recording."],
  "voice.start": ["녹음 시작", "Start recording"],
  "voice.stop": ["녹음 중지", "Stop recording"],
  "voice.cancel": ["취소", "Cancel"],
  "voice.login": ["지갑 연결", "Connect wallet"],
  "voice.transcript": ["인식된 말 · 편집 가능", "Recognized speech · editable"],
  "voice.original": ["보관 중인 기존 입력", "Your existing draft is preserved"],
  "voice.rebase": ["현재 입력과 다시 검토", "Review with the current draft"],
  "voice.preview": ["보낼 내용 미리 보기", "Preview what will be sent"],
  "voice.send": ["검토한 내용 보내기", "Send reviewed text"],
  "voice.appendSend": ["기존 입력에 덧붙여 보내기", "Append to draft and send"],
  "voice.use": ["채팅 입력에 넣기", "Use in chat draft"],
  "voice.appendUse": ["기존 입력 뒤에 넣기", "Append to chat draft"],
  "voice.answer": ["Floww의 답변", "Floww’s answer"],
  "voice.readLanguage": ["읽을 언어 직접 선택", "Choose the reading language"],
  "voice.chooseLanguage": ["언어를 선택해 주세요", "Choose a language"],
  "voice.korean": ["한국어", "Korean"],
  "voice.english": ["영어", "English"],
  "voice.readVoice": ["이 기기의 음성", "Voice on this device"],
  "voice.speak": ["이 응답 읽기", "Read this answer"],
  "voice.stopSpeaking": ["읽기 중지", "Stop reading"],
  "voice.linked": ["확정된 작업의 조건은 화면에서 확인합니다. 새 목적은 새 대화에서 시작해 주세요.", "Review the confirmed task on screen. Start a new conversation for a new purpose."],
  "voice.newContext": ["새 요청의 입력을 준비합니다", "Preparing input for a new request"],
  "voice.checking": ["음성 입력 설정을 확인하고 있습니다.", "Checking voice input configuration."],
  "voice.configured": ["녹음 시작을 선택하면 마이크 사용 여부를 확인합니다.", "Select Start recording to choose whether to allow the microphone."],
  "voice.unavailable": ["음성 입력을 아직 사용할 수 없습니다. 입력한 글은 그대로 이어갈 수 있습니다.", "Voice input is unavailable. You can continue with your typed draft."],
  "voice.guest": ["먼저 지갑을 연결해 주세요. 로그인 후 녹음 시작을 직접 선택합니다.", "Connect your wallet first, then explicitly start recording."],
  "voice.unsupported": ["이 브라우저에서 안전한 음성 녹음을 준비하지 못했습니다. 글로 계속 입력할 수 있습니다.", "This browser could not prepare safe audio capture. You can continue typing."],
  "voice.permission": ["마이크 사용 여부를 선택해 주세요. 취소해도 기존 입력은 유지됩니다.", "Choose whether to allow the microphone. Cancel keeps your existing draft."],
  "voice.ensuring": ["같은 대화에 음성 입력을 연결하고 있습니다.", "Binding voice input to the same conversation."],
  "voice.listening": ["듣고 있습니다. 끝나면 녹음 중지를 선택해 주세요.", "Listening. Select Stop recording when you finish."],
  "voice.transcribing": ["녹음을 끝냈습니다. 글로 변환하고 있습니다.", "Recording has ended. Transcribing your speech."],
  "voice.review": ["글을 확인하고 직접 보내 주세요. 아직 대화에는 보내지 않았습니다.", "Review and explicitly send the text. It has not been sent to the conversation."],
  "voice.sending": ["같은 대화로 보내고 있습니다.", "Sending through the same conversation."],
  "voice.sent": ["현재 대화의 응답과 진행 상태를 확인해 주세요.", "Review the answer and current state of this conversation."],
  "voice.notSent": ["요청의 현재 상태를 확인해 주세요. 새 음성을 반복해서 보내지 마세요.", "Check the current request state before sending more speech."],
  "voice.cancelled": ["음성 입력을 취소했습니다. 기존 입력은 유지됩니다.", "Voice input cancelled. Your existing draft is preserved."],
  "voice.interrupted": ["녹음과 읽기를 중지했습니다. 글을 확인한 뒤 다시 시작할 수 있습니다.", "Recording and playback stopped. Review your text before starting again."],
  "voice.contextChanged": ["대화나 조회 범위가 바뀌었습니다. 현재 입력을 확인한 뒤 다시 검토해 주세요.", "The conversation or scope changed. Check the current draft and review again."],
  "voice.draftChanged": ["기존 입력이 바뀌어 덧붙이지 않았습니다. 두 내용을 확인한 뒤 다시 검토해 주세요.", "Your draft changed, so nothing was appended. Review both texts before continuing."],
  "voice.tooLong": ["기존 입력과 합친 글이 2,000자를 넘습니다. 내용을 줄여 주세요.", "The combined text exceeds2,000 characters. Shorten it before continuing."],
  "voice.length": ["보낼 글 {count} / 2,000자", "Text to send: {count} / 2,000 characters"],
  "voice.empty": ["인식된 말이 없습니다. 글을 입력하거나 다시 녹음해 주세요.", "No speech was recognized. Type or explicitly record again."],
  "voice.failed": ["음성을 변환하지 못했습니다. 입력은 유지됩니다. 필요하면 새 녹음을 직접 시작해 주세요.", "Transcription could not be completed. Your draft is preserved. Explicitly start a new recording if needed."],
  "voice.denied": ["마이크 사용이 허용되지 않았습니다. 브라우저 설정을 확인하거나 글로 입력해 주세요.", "Microphone access was not allowed. Check browser settings or continue typing."],
  "voice.noDevice": ["사용할 마이크를 찾지 못했습니다. 연결을 확인하거나 글로 입력해 주세요.", "No microphone was found. Check the device or continue typing."],
  "voice.limit": ["오늘의 음성 요청 한도에 도달했습니다. 글로 계속 입력할 수 있습니다.", "The daily voice admission limit has been reached. You can continue typing."],
  "voice.consentNeeded": ["이번 녹음의 변환에 동의한 뒤 시작해 주세요.", "Agree to transcription for this recording before starting."],
  "voice.speaking": ["선택한 기기 음성으로 읽고 있습니다.", "Reading with the selected on-device voice."],
  "voice.localVoice": ["기기에서 제공하는 음성으로 읽습니다. 응답의 언어를 직접 확인해 주세요.", "Uses an on-device voice. Explicitly check the language of the answer."],
  "voice.noLocalVoice": ["선택한 언어의 기기 음성을 확인하지 못했습니다. 응답은 글로 볼 수 있습니다.", "No on-device voice was verified for that language. The answer remains available as text."],
  "voice.speechFailed": ["음성 읽기를 확인하지 못했습니다. 응답은 글로 볼 수 있습니다.", "Spoken playback could not be confirmed. The answer remains available as text."],
  "voice.noNewReply": ["새 응답을 확인하지 못했습니다. 이전 응답을 새 답변으로 읽지 않습니다.", "No new answer was confirmed. An older answer is not presented as a new reply."],

  "admin.currentPolicy": ["현재 권한", "Current policy"],
  "admin.currentPayment": ["현재 결제", "Current payment"],
  "admin.currentDelivery": ["현재 전달", "Current delivery"],
  "admin.eventStateScope": ["상태 열은 이벤트 발생 당시가 아닌 조회 시점의 작업 상태입니다.", "State columns describe the task at capture time, not at the time of the event."],
  "admin.logTruncated": ["보관 한도로 이전 관측 {count}건이 제외됐습니다.", "The retention buffer has evicted {count} earlier observations."],
  "admin.clockNote": ["시각 미측정 {count}건 · 시계 역행 관측 {regressions}회", "Unmeasured timestamps: {count} · backwards clock observations: {regressions}"],
  "admin.sourceMissing": ["아직 불러오지 않은 데이터입니다.", "This source has not been loaded."],
  "admin.eventTime": ["이벤트 시각", "Event time"],
  "admin.requestCount": ["{count}건 표시", "{count} displayed"],
  "admin.durationMissing": ["미측정", "Unmeasured"],
  "admin.processTotals": ["프로세스 누적: 응답 {completed}건 · 연결 미완료 {incomplete}건", "Process totals: {completed} responses · {incomplete} incomplete connections"],
  "admin.countersCapped": ["일부 누적 관측값이 저장 한도에 도달했습니다. 표시 수치는 하한값입니다.", "Some accumulated observations reached their counter limit. Displayed counts are lower bounds."],
  "admin.partialLoad": ["일부 데이터를 확인하지 못했습니다. 확인된 자료와 누락된 자료를 나누어 표시합니다.", "Some sources could not be checked. Available and unavailable sources are shown separately."],
  "admin.minuteValues": ["분별 관측 수치 보기", "View per-minute observations"],
  "admin.unavailableTitle": ["관리자 권한을 확인할 수 없습니다", "Administrator access is unverified"],
  "admin.navigation": ["운영 콘솔", "Operator console"],
  "admin.eyebrow": ["관리자 · 읽기 전용", "ADMINISTRATOR · READ ONLY"],
  "admin.description": ["HTTP 관측과 저장된 작업의 상태를 원본별로 확인합니다.", "Review HTTP observations and persisted task states by source."],
  "admin.menu": ["관리자 메뉴", "Administrator navigation"],
  "admin.overview": ["운영 현황", "Operations overview"],
  "admin.requests": ["HTTP 요청 기록", "HTTP request records"],
  "admin.events": ["저장된 작업 이벤트", "Retained task events"],
  "admin.readonly": ["읽기 전용", "Read only"],
  "admin.guestTitle": ["운영 콘솔은 관리자 전용입니다", "This console is for administrators"],
  "admin.guestCopy": ["지갑으로 로그인한 뒤 관리자 권한을 확인합니다.", "Sign in with your wallet to check administrator access."],
  "admin.checkingTitle": ["관리자 권한을 확인하고 있습니다", "Checking administrator access"],
  "admin.checkingCopy": ["확인 전에는 운영 기록을 불러오지 않습니다.", "Operational records are not loaded before access is verified."],
  "admin.deniedTitle": ["관리자 권한이 필요합니다", "Administrator access is required"],
  "admin.deniedCopy": ["현재 지갑으로는 운영 기록을 볼 수 없습니다. 일반 워크스페이스는 계속 이용할 수 있습니다.", "This wallet cannot view operational records. Your regular workspace remains available."],
  "admin.accessUnavailable": ["관리자 권한을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.", "Administrator access could not be verified. Check again when the connection is available."],
  "admin.return": ["워크스페이스로 돌아가기", "Return to workspace"],
  "admin.refresh": ["새로고침", "Refresh"],
  "admin.retryAccess": ["권한 다시 확인", "Check access again"],
  "admin.loading": ["권한과 원본별 상태를 새로 확인하고 있습니다.", "Checking access and refreshing each source."],
  "admin.loaded": ["각 원본의 확인 시각과 조회 범위를 함께 살펴보세요.", "Review each source's observation time and coverage."],
  "admin.loadFailed": ["운영 기록을 불러오지 못했습니다. 이전 수치를 현재값으로 표시하지 않습니다.", "Operational records could not be loaded. Previous values are not displayed as current."],
  "admin.readScope": ["상태를 확인하는 운영 공간", "OBSERVE THE CURRENT STATE"],
  "admin.attentionTitle": ["어디를 먼저 확인할까요?", "What needs attention first?"],
  "admin.attentionCopy": ["원래 거래와 자료의 상태를 나누어 살펴보세요. 이 화면은 결제나 권한을 변경하지 않습니다.", "Review the original transaction and delivery states separately. This screen changes neither payments nor authority."],
  "admin.uncertain": ["결제 결과 미확정", "Unresolved payment"],
  "admin.uncertainHelp": ["서명 준비 중이거나 결제 결과를 확인 중인 요청", "SIGNING, PENDING or UNKNOWN"],
  "admin.undelivered": ["확인된 결제 · 전달 미완료", "Payment confirmed · delivery incomplete"],
  "admin.undeliveredHelp": ["결제는 확인됐고 자료 전달은 미완료", "Confirmed payment without completed delivery"],
  "admin.noReport": ["전달 완료 · 결과 없음", "Delivery completed · no report"],
  "admin.noReportHelp": ["결제와 전달 확인 후 분석 결과가 없는 요청", "Confirmed payment and delivery without a report"],
  "admin.evidenceFlow": ["확인하는 증빙의 흐름", "Evidence to observe"],
  "admin.policy": ["권한", "Policy"],
  "admin.payment": ["결제", "Payment"],
  "admin.delivery": ["자료 전달", "Delivery"],
  "admin.report": ["분석 결과", "Report"],
  "admin.saved": ["저장된 요청", "Stored tasks"],
  "admin.savedHelp": ["현재 저장된 전체 요청 · 보관 포함", "Current persisted tasks, including archived"],
  "admin.traffic": ["HTTP 요청 흐름", "HTTP traffic"],
  "admin.trafficHelp": ["상태 점검과 관리자 조회를 포함한 HTTP 관측입니다. 작업 수요를 뜻하지 않습니다.", "HTTP observations include health probes and administrator reads. They do not measure task demand."],
  "admin.window": ["관측 구간", "Observation window"],
  "admin.window15": ["최근 최대 15분", "Up to 15 minutes"],
  "admin.window60": ["최근 최대 60분", "Up to 60 minutes"],
  "admin.httpCompleted": ["HTTP 응답 관측", "Observed HTTP response"],
  "admin.httpIncomplete": ["연결 미완료", "Incomplete connection"],
  "admin.distribution": ["저장된 결제 상태", "Persisted payment states"],
  "admin.distributionHelp": ["각 요청은 하나의 결제 상태에만 포함됩니다.", "Each task belongs to exactly one payment state."],
  "admin.otherStates": ["권한과 자료 전달 상태", "Policy and delivery states"],
  "admin.operatingDetails": ["응답 시간 · AI 호출 입장 · 실행 기록", "Response times · AI admissions · execution records"],
  "admin.latency": ["관측된 응답 시간 구간", "Observed response-time buckets"],
  "admin.latencyHelp": ["구간별 HTTP 건수이며 평균이나 백분위 추정값이 아닙니다.", "HTTP counts per interval, not estimated averages or percentiles."],
  "admin.admissions": ["AI 역할 호출 입장", "AI role-call admissions"],
  "admin.admissionHelp": ["허용된 호출 수입니다. 실제 토큰 사용량이나 비용을 뜻하지 않습니다.", "Admitted calls, not actual token usage or provider cost."],
  "admin.executions": ["실행 예약과 관측", "Execution reservations and observations"],
  "admin.executionHelp": ["전역 장부의 UTC 일자별 실행 수입니다. 금액이나 수익이 아닙니다.", "Global-ledger execution counts by UTC day, not amounts or revenue."],
  "admin.requestHelp": ["현재 프로세스에서 관측한 고정 분류와 HTTP 결과입니다. 결제 완료 내역이 아닙니다.", "Fixed request categories and HTTP outcomes observed in this process, not completed-payment records."],
  "admin.eventHelp": ["보관된 이벤트의 현재 상태 요약입니다. 전체 이력이나 결제 증명이 아닙니다.", "Current summaries of retained events, not a complete history or payment proof."],
  "admin.requestTable": ["현재 프로세스의 HTTP 요청 관측 기록", "HTTP request observations from this process"],
  "admin.eventTable": ["보관된 작업 이벤트와 상태 요약", "Retained task events and state summaries"],
  "admin.time": ["시각", "Time"],
  "admin.route": ["요청 분류", "Request category"],
  "admin.httpStatus": ["HTTP 결과", "HTTP outcome"],
  "admin.duration": ["응답 시간", "Duration"],
  "admin.requestId": ["요청 ID", "Request ID"],
  "admin.taskRef": ["작업 참조", "Task reference"],
  "admin.event": ["이벤트 · 사유", "Event · reason"],
  "admin.moreRequests": ["이 프로세스의 이전 관측 더 보기", "Show more observations from this process"],
  "admin.moreEvents": ["이전 보관 이벤트 더 보기", "Show more retained events"],
  "admin.sourceUnavailable": ["원본을 확인할 수 없습니다. 수치는 미확인으로 표시합니다.", "This source is unavailable. Its values remain unconfirmed."],
  "admin.sourceTimeout": ["원본 확인 시간이 초과됐습니다. 수치는 미확인으로 표시합니다.", "The source check timed out. Its values remain unconfirmed."],
  "admin.sourceUnsupported": ["현재 실행 환경에서는 이 원본을 확인할 수 없습니다.", "This source is unavailable in the current runtime."],
  "admin.invalidSource": ["원본의 형식이나 합계를 검증하지 못했습니다. 수치를 표시하지 않습니다.", "The source shape or totals could not be verified. Values are not displayed."],
  "admin.source": ["{scope} · 확인 시각 {time}", "{scope} · observed {time}"],
  "admin.processScope": ["현재 프로세스", "Current process"],
  "admin.taskScope": ["저장된 현재 상태 · 보관 포함", "Current persisted states · archived included"],
  "admin.usageScope": ["최근 7 UTC 일자 · 허용된 역할 호출", "Last 7 UTC days · admitted role calls"],
  "admin.executionScope": ["최근 7 UTC 일자 · 전역 실행 장부", "Last 7 UTC days · global execution ledger"],
  "admin.eventScope": ["보관된 작업 이벤트", "Retained task events"],
  "admin.requestScope": ["현재 프로세스의 최근 HTTP 관측", "Recent HTTP observations in this process"],
  "admin.noTraffic": ["관측 구간에 HTTP 요청이 0건입니다.", "No HTTP requests were observed in this window."],
  "admin.noTasks": ["저장된 요청이 0건입니다.", "There are no persisted tasks."],
  "admin.noRequests": ["이 조회 범위에 HTTP 관측 기록이 없습니다.", "No HTTP observations are present in this result."],
  "admin.noEvents": ["이 조회 범위에 보관된 작업 이벤트가 없습니다.", "No retained task events are present in this result."],
  "admin.coverage": ["실제 관측: {from}–{through}. 시작 전 구간은 관측하지 않았으며 양 끝 분은 일부만 관측됐을 수 있습니다.", "Observed: {from}–{through}. Minutes before process start were not observed; boundary minutes may be partial."],
  "admin.chartSummary": ["관측된 HTTP {count}건, 표시된 {minutes}개 분 구간", "{count} observed HTTP requests across {minutes} displayed minute intervals"],
  "admin.distributionSummary": ["전체 {total}개 요청의 결제 상태 분포", "Payment-state distribution of {total} tasks"],
  "admin.invalidRecords": ["형식 확인 필요: 상태 {states}건 · 결과 {reports}건", "Records needing format review: states {states} · reports {reports}"],
  "admin.requestRetention": ["현재 프로세스의 최근 최대 200건만 보관합니다. 프로세스 재시작 전 기록은 포함되지 않습니다.", "Retains at most the latest 200 observations in this process. Records from previous process lifetimes are not included."],
  "admin.eventRetention": ["작업별 최근 최대 100개 보관 이벤트 안에서 조회합니다. 전체 감사 이력은 아닙니다.", "Reads from at most 100 retained events per task. This is not a complete audit history."],
  "admin.moreAvailable": ["조회 한도 밖에 추가 기록이 있습니다.", "Additional records exist beyond this query limit."],
  "admin.atLimit": ["현재 화면의 조회 한도에 도달했습니다.", "This view has reached its query limit."],
  "admin.unknown": ["미확인", "Unconfirmed"],
  "admin.other": ["기타 · 형식 확인 필요", "Other · needs format review"],
  "admin.pending": ["대기", "Pending"],
  "admin.allowed": ["허용", "Allowed"],
  "admin.denied": ["거부", "Denied"],
  "admin.notStarted": ["시작 전", "Not started"],
  "admin.signing": ["서명 준비", "Signing"],
  "admin.paymentPending": ["결제 확인 중", "Payment pending"],
  "admin.paymentUnknown": ["결제 결과 미확정", "Payment unknown"],
  "admin.confirmed": ["결제 확인됨", "Payment confirmed"],
  "admin.failed": ["실패", "Failed"],
  "admin.deliveryPending": ["전달 확인 중", "Delivery pending"],
  "admin.delivered": ["전달 완료", "Delivery completed"],
  "admin.admitted": ["허용된 호출", "Admitted calls"],
  "admin.held": ["예약", "Reserved"],
  "admin.observed": ["관측", "Observed"],
  "admin.utcDay": ["UTC 일자", "UTC day"],
  "admin.dailyLimit": ["일일 입장 한도 {limit}회", "Daily admission limit: {limit}"],
  "admin.unmeasured": ["응답 시간 미측정 {count}건 · 로그 출력 누락 {suppressed}건", "Unmeasured duration: {count} · suppressed log output: {suppressed}"],
  "admin.capabilities": ["현재 프로세스의 기능 점검", "Current-process capability checks"],
  "admin.workspaceCapability": ["AI 요청 처리", "AI request processing"],
  "admin.reportCapability": ["결과 처리", "Result processing"],
  "admin.modelConfigured": ["AI 설정", "AI configuration"],
  "admin.paymentEnabled": ["Devnet 결제 설정", "Devnet payments enabled"],
  "admin.true": ["확인됨", "Confirmed"],
  "admin.false": ["사용 불가 · 비활성", "Unavailable · disabled"],
  "admin.draining": ["진행 중인 요청을 정리하고 있습니다.", "The process is draining active requests."],
  "admin.noProviderProof": ["이 점검은 실제 모델 응답이나 결제 성공을 보장하지 않습니다.", "These checks do not establish actual model responses or payment success."],
  "adapter.requestLoaded": ["요청의 현재 상태를 불러왔습니다.", "Loaded the request's current state."],
  "adapter.tasksLoaded": ["작업 목록을 불러왔습니다.", "Loaded the task list."],
  "adapter.workspaceUnavailable": ["AI 처리 기능을 잠시 사용할 수 없습니다. 입력은 유지됩니다. 기존 기록을 보거나 작업 화면에서 조회 범위를 직접 지정할 수 있습니다.", "AI processing is temporarily unavailable. Your draft is retained. Review existing records or set the scope directly in Tasks."],
  "adapter.workspaceUnknown": ["AI 요청의 준비 상태를 확인하지 못했습니다. 입력은 유지됩니다. 연결 상태를 확인한 뒤 새 요청을 진행해 주세요.", "Readiness for AI requests is unconfirmed. Your draft is retained. Check the connection status before starting a new request."],
  "adapter.reportUnavailable": ["결과 처리 기능을 잠시 사용할 수 없어 새 결제를 시작하지 않습니다. 저장된 결과와 원래 거래의 상태는 계속 확인할 수 있습니다.", "Result processing is temporarily unavailable, so new payments are paused. Saved results and the original transaction remain available to review."],
  "adapter.deliveryConfirmed": ["자료 전달은 확인됐습니다.", "Delivery is confirmed."],
  "adapter.reportUnknown": ["결과 처리의 준비 상태를 확인하지 못해 새 결제를 시작하지 않습니다. 저장된 결과와 원래 거래의 상태를 먼저 확인해 주세요.", "Result-processing readiness is unconfirmed, so new payments are paused. Review saved results and the original transaction first."],
  "adapter.workspaceTitle": ["AI 처리 기능 확인 필요", "AI processing needs attention"],
  "adapter.reportTitle": ["결과 처리 기능 확인 필요", "Result processing needs attention"],
  "adapter.configurationTitle": ["AI 연결 설정 필요", "AI connection setup needed"],
  "adapter.unknownTitle": ["처리 기능 상태 확인 필요", "Processing readiness unconfirmed"],
  "adapter.configurationHelp": ["AI 연결 설정을 준비 중입니다. 기존 기록을 보거나 작업 화면에서 조회 범위를 직접 지정할 수 있습니다.", "AI connection setup is pending. Review existing records or set the scope directly in Tasks."],
  "adapter.checked": ["요청 처리의 사전 점검을 마쳤습니다. 실제 AI 응답·자료 전달·결제 성공은 각 요청에서 별도로 확인합니다.", "Initial processing checks passed. Actual AI responses, delivery and payment success are checked separately for each request."],
  "adapter.draftHint": ["AI 요청을 잠시 사용할 수 없습니다. 입력은 그대로 유지됩니다.", "AI requests are temporarily unavailable. Your draft stays here."],
  "adapter.unknownHint": ["AI 요청의 준비 상태를 확인해 주세요. 입력은 유지됩니다.", "AI-request readiness needs checking. Your draft stays here."],
  "adapter.configurationHint": ["AI 연결 설정을 준비 중입니다. 입력은 유지됩니다.", "AI connection setup is pending. Your draft stays here."],
  "adapter.sendUnavailable": ["AI 요청 일시 중지", "AI requests paused"],
  "adapter.sendUnknown": ["연결 상태 확인 필요", "Check connection status"],
  "adapter.sendConfiguration": ["AI 연결 준비 중", "AI setup pending"],
  "adapter.workspaceStopped": ["AI 요청을 잠시 멈췄어요", "AI requests are paused"],
  "navigation.invalid": ["주소를 확인할 수 없어 새 요청 화면을 열었습니다.", "This address is unavailable. The request screen is open."],
  "navigation.signIn": ["지갑으로 로그인한 뒤 내 대화나 작업을 다시 열어 주세요.", "Sign in with your wallet, then reopen your conversation or task."],
  "navigation.unavailable": ["이 기록에 접근할 수 없습니다. 내 대화나 작업 목록에서 다시 선택해 주세요.", "This record is unavailable. Choose a conversation or task from your own list."],
  "navigation.stepPending": ["아직 이 단계의 내용이 없습니다. 현재 요청 상태를 확인해 주세요.", "This step has no content yet. Review the current request state."],
  "navigation.pending": ["이전 요청이 서버에서 처리 중일 수 있습니다. 입력 내용은 보관했습니다. 대화의 최신 상태를 확인한 뒤 이어가세요.", "The previous request may still be processing. Your draft is retained. Review the latest conversation state before continuing."],
  "design.retryPlan": ["계획 다시 시도", "Retry plan"],
  "design.transcript": ["이전 대화 펼쳐 보기", "Review the conversation"],
  "design.planReview": ["계획과 조회 범위 다시 보기", "Review the plan and scope"],
  "design.eyebrow": [
    "목적은 편하게, 조건은 분명하게",
    "YOUR INTENT. YOUR TERMS."
  ],
  "design.title": [
    "어떤 일을\n맡겨볼까요?",
    "What would you like\nto get done?"
  ],
  "design.description": [
    "원하는 결과를 말해 주세요. 자료와 비용을 확인하고, 답변의 근거까지 한곳에서 이어갑니다.",
    "Tell us what you need. Review the scope and cost, then follow the evidence to your answer."
  ],
  "design.tagline": [
    "위임의 기준을 분명하게",
    "Intent, with accountability."
  ],
  "design.connection": [
    "연결 상태",
    "Connection status"
  ],
  "design.conversation": [
    "함께 정리하는 요청",
    "YOUR REQUEST, IN CONTEXT"
  ],
  "design.placeholder": [
    "알고 싶은 내용이나 맡길 일을 편하게 적어 주세요.",
    "Describe what you need, in your own words."
  ],
  "design.supported": [
    "지금은 Solana 지갑의 이체 내역을 정리할 수 있어요. 주소와 기간은 대화에서 함께 정합니다.",
    "Currently available: Solana wallet transfer reports. We’ll clarify the address and period together."
  ],
  "design.starters": [
    "요청 예시",
    "Request starters"
  ],
  "design.summary": [
    "이체 흐름 한눈에",
    "Transfers at a glance"
  ],
  "design.summaryDetail": [
    "자산별 입금과 출금 정리",
    "Incoming and outgoing, by asset"
  ],
  "design.incoming": [
    "들어온 자산만",
    "What came in"
  ],
  "design.incomingDetail": [
    "선택한 기간의 입금 내역",
    "Focus on incoming transfers"
  ],
  "design.outgoing": [
    "나간 자산만",
    "What went out"
  ],
  "design.outgoingDetail": [
    "선택한 기간의 출금 내역",
    "Focus on outgoing transfers"
  ],
  "design.scope": [
    "주소·기간 직접 지정",
    "Set an address and period"
  ],
  "design.history": [
    "이전 대화와 기억",
    "Past conversations and memory"
  ],
  "design.requestSummary": [
    "최근 지갑 이체를 자산별로 정리해 주세요.",
    "Summarize recent wallet transfers by asset."
  ],
  "design.requestIncoming": [
    "지갑으로 들어온 이체만 자산별로 정리해 주세요.",
    "Summarize only incoming wallet transfers, grouped by asset."
  ],
  "design.requestOutgoing": [
    "지갑에서 나간 이체만 자산별로 정리해 주세요.",
    "Summarize only outgoing wallet transfers, grouped by asset."
  ],
  "design.guestHint": [
    "지갑 연결 후 이어집니다.",
    "Continues after wallet sign-in."
  ],
  "design.readyHint": [
    "조건을 확인하기 전에는 결제하지 않습니다.",
    "No payment before you review the terms."
  ],
  "승인 대기": [
    "승인 대기",
    "Awaiting approval"
  ],
  "승인됨": [
    "승인됨",
    "Approved"
  ],
  "승인되지 않음": [
    "승인되지 않음",
    "Not approved"
  ],
  "시작 전": [
    "시작 전",
    "Not started"
  ],
  "서명 준비 중": [
    "서명 준비 중",
    "Preparing signature"
  ],
  "확인 중": [
    "확인 중",
    "Checking"
  ],
  "확인 필요": [
    "확인 필요",
    "Needs review"
  ],
  "결제 확인됨": [
    "결제 확인됨",
    "Payment confirmed"
  ],
  "거래 실패": [
    "거래 실패",
    "Payment failed"
  ],
  "전달 확인 중": [
    "전달 확인 중",
    "Checking delivery"
  ],
  "전달 완료": [
    "전달 완료",
    "Delivered"
  ],
  "전달 확인 필요": [
    "전달 확인 필요",
    "Delivery needs review"
  ],
  "자료 요청 생성": [
    "자료 요청 생성",
    "Report requested"
  ],
  "결제 조건 확인": [
    "결제 조건 확인",
    "Review payment terms"
  ],
  "지출 조건 승인": [
    "지출 조건 승인",
    "Spending terms approved"
  ],
  "승인 조건 확인 필요": [
    "승인 조건 확인 필요",
    "Approval terms need review"
  ],
  "승인 취소": [
    "승인 취소",
    "Approval revoked"
  ],
  "승인 확인 및 서명 준비": [
    "승인 확인 및 서명 준비",
    "Checking approval and preparing signature"
  ],
  "결제 요청 전달": [
    "결제 요청 전달",
    "Payment submitted"
  ],
  "결제·자료 상태 확인": [
    "결제·자료 상태 확인",
    "Payment and delivery checked"
  ],
  "원래 거래 상태 재확인": [
    "원래 거래 상태 재확인",
    "Original payment rechecked"
  ],
  "분석 결과 준비 완료": [
    "분석 결과 준비 완료",
    "Analysis ready"
  ],
  "자료 검증 확인 필요": [
    "자료 검증 확인 필요",
    "Report validation needs review"
  ],
  "실행 상태 확인 필요": [
    "실행 상태 확인 필요",
    "Execution needs review"
  ],
  "이전 실행 상태 재확인 필요": [
    "이전 실행 상태 재확인 필요",
    "Previous execution needs review"
  ],
  "로그인이 필요합니다. 지갑을 다시 연결해 주세요.": [
    "로그인이 필요합니다. 지갑을 다시 연결해 주세요.",
    "Sign in again by connecting your wallet."
  ],
  "Phantom 지갑을 찾지 못했습니다. 지갑이 연결된 브라우저에서 열어 주세요.": [
    "Phantom 지갑을 찾지 못했습니다. 지갑이 연결된 브라우저에서 열어 주세요.",
    "Phantom was not found. Open this page in a browser with your wallet available."
  ],
  "지갑 승인을 취소했습니다. 준비되면 다시 연결해 주세요.": [
    "지갑 승인을 취소했습니다. 준비되면 다시 연결해 주세요.",
    "Wallet approval was cancelled. Connect again when you are ready."
  ],
  "유효한 Solana 지갑 주소를 입력해 주세요.": [
    "유효한 Solana 지갑 주소를 입력해 주세요.",
    "Enter a valid Solana wallet address."
  ],
  "요청 목적과 지갑 주소를 확인해 주세요.": [
    "요청 목적과 지갑 주소를 확인해 주세요.",
    "Check the purpose and wallet address."
  ],
  "조회 기간은 현재 이전의 최대 7일로 설정해 주세요.": [
    "조회 기간은 현재 이전의 최대 7일로 설정해 주세요.",
    "Choose a past time window of up to seven days."
  ],
  "조회 기간을 다시 확인해 주세요.": [
    "조회 기간을 다시 확인해 주세요.",
    "Check the report time window."
  ],
  "결제 조건을 읽고 동의 항목을 선택해 주세요.": [
    "결제 조건을 읽고 동의 항목을 선택해 주세요.",
    "Read the payment terms and select the acknowledgement."
  ],
  "지출 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다.": [
    "지출 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다.",
    "The spending limit is below the price or exceeds the service limit."
  ],
  "금액을 숫자로 입력하고 소수점 자릿수를 확인해 주세요.": [
    "금액을 숫자로 입력하고 소수점 자릿수를 확인해 주세요.",
    "Enter a numeric amount with the supported decimal precision."
  ],
  "결제 조건이나 승인의 기한이 지났습니다. 새 조건을 확인하고 다시 승인해 주세요.": [
    "결제 조건이나 승인의 기한이 지났습니다. 새 조건을 확인하고 다시 승인해 주세요.",
    "The quote or approval has expired. Review current terms and approve again."
  ],
  "먼저 결제 조건을 확인해 주세요.": [
    "먼저 결제 조건을 확인해 주세요.",
    "Review the payment terms first."
  ],
  "서비스 결제 지갑이 바뀌었습니다. 새 조건을 확인해 주세요.": [
    "서비스 결제 지갑이 바뀌었습니다. 새 조건을 확인해 주세요.",
    "The service payment wallet changed. Review the current terms."
  ],
  "Devnet 결제 설정을 준비 중입니다. 설정이 완료된 뒤 승인할 수 있습니다.": [
    "Devnet 결제 설정을 준비 중입니다. 설정이 완료된 뒤 승인할 수 있습니다.",
    "Devnet payment setup is pending. Approval is available after setup completes."
  ],
  "Devnet 결제 설정이 준비되지 않았습니다. 현재 요청은 실행되지 않았습니다.": [
    "Devnet 결제 설정이 준비되지 않았습니다. 현재 요청은 실행되지 않았습니다.",
    "Devnet payment setup is not ready. This request was not executed."
  ],
  "자료 제공 서비스의 연결을 준비 중입니다.": [
    "자료 제공 서비스의 연결을 준비 중입니다.",
    "The report provider connection is being prepared."
  ],
  "결제 검증 서비스에 연결하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.": [
    "결제 검증 서비스에 연결하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.",
    "The payment verification service is unavailable. Check the current status before continuing."
  ],
  "자료의 결제 조건을 가져오지 못했습니다. 잠시 후 다시 확인해 주세요.": [
    "자료의 결제 조건을 가져오지 못했습니다. 잠시 후 다시 확인해 주세요.",
    "Payment terms could not be retrieved. Check again shortly."
  ],
  "이 요청을 처리하고 있습니다. 상태가 갱신될 때까지 기다려 주세요.": [
    "이 요청을 처리하고 있습니다. 상태가 갱신될 때까지 기다려 주세요.",
    "This request is being processed. Wait for the status to update."
  ],
  "요청 상태가 바뀌었습니다. 최신 상태를 확인해 주세요.": [
    "요청 상태가 바뀌었습니다. 최신 상태를 확인해 주세요.",
    "The request changed. Review its latest status."
  ],
  "이미 시작한 실행입니다. 원래 결제의 상태를 확인해 주세요.": [
    "이미 시작한 실행입니다. 원래 결제의 상태를 확인해 주세요.",
    "Execution already started. Check the original payment."
  ],
  "요청이 잠시 많아졌습니다. 잠시 후 다시 시도해 주세요.": [
    "요청이 잠시 많아졌습니다. 잠시 후 다시 시도해 주세요.",
    "Too many requests. Try again shortly."
  ],
  "현재 보관할 수 있는 요청 수에 도달했습니다.": [
    "현재 보관할 수 있는 요청 수에 도달했습니다.",
    "The request storage limit has been reached."
  ],
  "로그인 확인이 만료됐습니다. 지갑을 다시 연결해 주세요.": [
    "로그인 확인이 만료됐습니다. 지갑을 다시 연결해 주세요.",
    "The sign-in challenge expired. Connect your wallet again."
  ],
  "지갑 서명을 확인하지 못했습니다. 다시 로그인해 주세요.": [
    "지갑 서명을 확인하지 못했습니다. 다시 로그인해 주세요.",
    "The wallet signature could not be verified. Sign in again."
  ],
  "응답을 확인하지 못했습니다. 실행을 반복하기 전에 요청의 현재 상태를 확인해 주세요.": [
    "응답을 확인하지 못했습니다. 실행을 반복하기 전에 요청의 현재 상태를 확인해 주세요.",
    "The response could not be confirmed. Check the current request before repeating an action."
  ],
  "서비스에 연결하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.": [
    "서비스에 연결하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.",
    "The service is unavailable. Check its status again shortly."
  ],
  "설정 대기": [
    "설정 대기",
    "Setup pending"
  ],
  "시간 확인 필요": [
    "시간 확인 필요",
    "Time unavailable"
  ],
  "요청을 처리하지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해 주세요.": [
    "요청을 처리하지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해 주세요.",
    "The request could not be processed. Check the current status before continuing."
  ],
  "선택한 요청": [
    "선택한 요청",
    "Selected request"
  ],
  "작업을 완료했습니다.": [
    "작업을 완료했습니다.",
    "Action completed."
  ],
  "분석 완료": [
    "분석 완료",
    "Analysis ready"
  ],
  "자료 전달됨": [
    "자료 전달됨",
    "Report delivered"
  ],
  "자료 복구 필요": [
    "자료 복구 필요",
    "Report recovery needed"
  ],
  "거래 확인 필요": [
    "거래 확인 필요",
    "Payment needs review"
  ],
  "실행 중": [
    "실행 중",
    "In progress"
  ],
  "실행 승인됨": [
    "실행 승인됨",
    "Execution approved"
  ],
  "조건 재확인 필요": [
    "조건 재확인 필요",
    "Terms need review"
  ],
  "조건 승인 대기": [
    "조건 승인 대기",
    "Awaiting terms approval"
  ],
  "가격 확인 대기": [
    "가격 확인 대기",
    "Awaiting price"
  ],
  "자료와 거래 근거를 확인했습니다. 아래에서 자산별 이체 결과를 살펴보세요.": [
    "자료와 거래 근거를 확인했습니다. 아래에서 자산별 이체 결과를 살펴보세요.",
    "Report and payment evidence are available. Review the asset transfers below."
  ],
  "결제 결과가 아직 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래의 상태를 확인합니다.": [
    "결제 결과가 아직 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래의 상태를 확인합니다.",
    "Payment is unresolved. Check the original transaction without creating a new payment."
  ],
  "결제는 확인됐습니다. 같은 결제를 사용해 자료 전달을 다시 확인할 수 있습니다.": [
    "결제는 확인됐습니다. 같은 결제를 사용해 자료 전달을 다시 확인할 수 있습니다.",
    "Payment is confirmed. Check delivery again using the same payment."
  ],
  "자료가 전달됐습니다. 내용 검증과 분석 결과의 상태를 확인해 주세요.": [
    "자료가 전달됐습니다. 내용 검증과 분석 결과의 상태를 확인해 주세요.",
    "The report was delivered. Check validation and analysis status."
  ],
  "거래 실패가 확인됐습니다. 실행 기록과 거래 상태를 검토해 주세요.": [
    "거래 실패가 확인됐습니다. 실행 기록과 거래 상태를 검토해 주세요.",
    "Payment failure was confirmed. Review the execution log and transaction status."
  ],
  "승인된 요청을 처리하고 있습니다. 같은 결제를 다시 실행하지 않고 상태를 확인합니다.": [
    "승인된 요청을 처리하고 있습니다. 같은 결제를 다시 실행하지 않고 상태를 확인합니다.",
    "The approved request is processing. Check its status without repeating the payment."
  ],
  "결제 조건의 유효 시간이 지났습니다. 최신 조건을 확인한 뒤 다시 승인해 주세요.": [
    "결제 조건의 유효 시간이 지났습니다. 최신 조건을 확인한 뒤 다시 승인해 주세요.",
    "Payment terms expired. Review current terms and approve again."
  ],
  "승인한 조건으로 실행할 준비가 됐습니다. 아래 실행 버튼을 누르면 Devnet 결제가 시작됩니다.": [
    "승인한 조건으로 실행할 준비가 됐습니다. 아래 실행 버튼을 누르면 Devnet 결제가 시작됩니다.",
    "The approved terms are ready. The execution button below starts the Devnet payment."
  ],
  "수신자와 토큰, 금액을 확인한 뒤 승인하고 실행해 주세요.": [
    "수신자와 토큰, 금액을 확인한 뒤 승인하고 실행해 주세요.",
    "Review the recipient, token and amount before approving and executing."
  ],
  "실제 자료 제공 서비스에서 결제 조건을 가져온 뒤, 승인 여부를 결정할 수 있습니다.": [
    "실제 자료 제공 서비스에서 결제 조건을 가져온 뒤, 승인 여부를 결정할 수 있습니다.",
    "Retrieve terms from the report provider, then decide whether to approve."
  ],
  "Devnet 결제 설정 준비됨": [
    "Devnet 결제 설정 준비됨",
    "Devnet payments ready"
  ],
  "Devnet 실행 설정 준비 중": [
    "Devnet 실행 설정 준비 중",
    "Devnet setup pending"
  ],
  "설정 상태 확인 중": [
    "설정 상태 확인 중",
    "Checking setup"
  ],
  "각 결제 직전에 승인과 네트워크를 다시 확인합니다.": [
    "각 결제 직전에 승인과 네트워크를 다시 확인합니다.",
    "Approval and network are checked again before each payment."
  ],
  "요청을 보관하고, 연결 준비가 끝나면 조건을 확인할 수 있습니다.": [
    "요청을 보관하고, 연결 준비가 끝나면 조건을 확인할 수 있습니다.",
    "Requests are retained. Review terms when the connection is ready."
  ],
  "현재 Devnet 환경을 확인하고 있습니다.": [
    "현재 Devnet 환경을 확인하고 있습니다.",
    "Checking the current Devnet environment."
  ],
  "보관됨 · ": [
    "보관됨 · ",
    "Archived · "
  ],
  "금액 확인 필요": [
    "금액 확인 필요",
    "Amount unavailable"
  ],
  "결제 지갑 ": [
    "결제 지갑 ",
    "Payment wallet "
  ],
  " · 수신자 ": [
    " · 수신자 ",
    " · Recipient "
  ],
  " · 토큰 mint ": [
    " · 토큰 mint ",
    " · Token mint "
  ],
  " 토큰": [
    " 토큰",
    " tokens"
  ],
  " 기본 단위": [
    " 기본 단위",
    " base units"
  ],
  "결제 지갑": [
    "결제 지갑",
    "Payment wallet"
  ],
  "수신자": [
    "수신자",
    "Recipient"
  ],
  "토큰 mint": [
    "토큰 mint",
    "Token mint"
  ],
  "네트워크": [
    "네트워크",
    "Network"
  ],
  "조건 기한": [
    "조건 기한",
    "Quote expires"
  ],
  "승인한 지출 한도 ": [
    "승인한 지출 한도 ",
    "Approved spending limit "
  ],
  " 토큰 · ": [
    " 토큰 · ",
    " tokens · "
  ],
  "까지": [
    "까지",
    " expiry"
  ],
  "실행 상태 갱신": [
    "실행 상태 갱신",
    "Execution status updated"
  ],
  "이 결과는 실제 네트워크에서 조회한 자료가 아닙니다.": [
    "이 결과는 실제 네트워크에서 조회한 자료가 아닙니다.",
    "This result uses synthetic data, rather than observations from the live network."
  ],
  "명시된 자료 범위 안에서 집계했습니다.": [
    "명시된 자료 범위 안에서 집계했습니다.",
    "Aggregated within the report's declared scope."
  ],
  "조회 자료의 일부만 확인됐습니다. 반환된 이체를 기준으로 집계합니다.": [
    "조회 자료의 일부만 확인됐습니다. 반환된 이체를 기준으로 집계합니다.",
    "Coverage is partial. Totals cover only the returned transfers."
  ],
  "분석 내용이 준비됐습니다.": [
    "분석 내용이 준비됐습니다.",
    "The analysis is ready."
  ],
  "자산별 이체": [
    "자산별 이체",
    "Transfers by asset"
  ],
  "입금": [
    "입금",
    "Incoming"
  ],
  "출금": [
    "출금",
    "Outgoing"
  ],
  "동일 지갑 이체": [
    "동일 지갑 이체",
    "Self transfer"
  ],
  "이체": [
    "이체",
    "Transfer"
  ],
  "건": [
    "건",
    " transfers"
  ],
  "자료 출처": [
    "자료 출처",
    "Report sources"
  ],
  "확인한 근거": [
    "확인한 근거",
    "Evidence references"
  ],
  "조회 범위와 참고 사항": [
    "조회 범위와 참고 사항",
    "Coverage and limitations"
  ],
  "이체 합계는 반환된 활동 내역이며 지갑 잔액이나 수익을 뜻하지 않습니다. 자료 시점: ": [
    "이체 합계는 반환된 활동 내역이며 지갑 잔액이나 수익을 뜻하지 않습니다. 자료 시점: ",
    "Transfer totals describe returned activity, not wallet balances or profit. Data as of: "
  ],
  "지갑 로그인 중": [
    "지갑 로그인 중",
    "Signing in"
  ],
  "로그인 중…": [
    "로그인 중…",
    "Signing in…"
  ],
  "지갑 연결": [
    "지갑 연결",
    "Connect wallet"
  ],
  "Phantom 지갑으로 로그인": [
    "Phantom 지갑으로 로그인",
    "Sign in with Phantom"
  ],
  "결제 조건 다시 확인": [
    "결제 조건 다시 확인",
    "Review current terms"
  ],
  "작업 상세 확인 중": [
    "작업 상세 확인 중",
    "Loading request details"
  ],
  "결제 조건 확인 중": [
    "결제 조건 확인 중",
    "Loading payment terms"
  ],
  "로그아웃 중": [
    "로그아웃 중",
    "Signing out"
  ],
  "요청 목록 확인 중": [
    "요청 목록 확인 중",
    "Loading requests"
  ],
  "보관함 확인 중": [
    "보관함 확인 중",
    "Loading archive"
  ],
  "이전 요청 확인 중": [
    "이전 요청 확인 중",
    "Loading earlier requests"
  ],
  "요청 보관 중": [
    "요청 보관 중",
    "Archiving request"
  ],
  "요청 복원 중": [
    "요청 복원 중",
    "Restoring request"
  ],
  "실행 상태 확인 중": [
    "실행 상태 확인 중",
    "Checking execution status"
  ],
  "승인한 결제 실행 중": [
    "승인한 결제 실행 중",
    "Executing approved payment"
  ],
  "승인 취소 중": [
    "승인 취소 중",
    "Revoking approval"
  ],
  "원래 결제 확인 중": [
    "원래 결제 확인 중",
    "Checking original payment"
  ],
  "같은 결제의 자료 전달 확인 중": [
    "같은 결제의 자료 전달 확인 중",
    "Checking delivery with the same payment"
  ],
  "승인한 조건으로 실행 중": [
    "승인한 조건으로 실행 중",
    "Executing approved terms"
  ],
  "분석 요청 생성 중": [
    "분석 요청 생성 중",
    "Creating report request"
  ],
  "좋은 결정은, 분명한 목적에서.": [
    "좋은 결정은, 분명한 목적에서.",
    "Good decisions start with a clear purpose."
  ],
  "목적과 근거, 실행의 흐름을 한곳에서 관리하세요.": [
    "목적과 근거, 실행의 흐름을 한곳에서 관리하세요.",
    "Manage purpose, evidence and execution in one workspace."
  ],
  "어떤 결과를 원하세요?": [
    "어떤 결과를 원하세요?",
    "What result would you like?"
  ],
  "원하는 일을 말해 주세요. 필요한 정보와 계획을 함께 정리합니다.": [
    "원하는 일을 말해 주세요. 필요한 정보와 계획을 함께 정리합니다.",
    "Tell us your goal. We will clarify the details and plan with you."
  ],
  "모든 실행에, 분명한 근거를.": [
    "모든 실행에, 분명한 근거를.",
    "Clear evidence for every action."
  ],
  "승인한 조건부터 결제·자료 전달·분석 결과까지 이어 봅니다.": [
    "승인한 조건부터 결제·자료 전달·분석 결과까지 이어 봅니다.",
    "Follow approved terms through payment, delivery and analysis."
  ],
  "다음 대화에도 이어질 맥락.": [
    "다음 대화에도 이어질 맥락.",
    "Context for your next conversation."
  ],
  "직접 저장한 선호를 관리하고 대화마다 사용 여부를 정하세요.": [
    "직접 저장한 선호를 관리하고 대화마다 사용 여부를 정하세요.",
    "Manage saved preferences and choose whether to use them in each conversation."
  ],
  "한도를 정하고, 흐름을 살피세요.": [
    "한도를 정하고, 흐름을 살피세요.",
    "Set limits and follow spending."
  ],
  "목적에 맞는 예산 권한과 예약·사용 내역을 확인하세요.": [
    "목적에 맞는 예산 권한과 예약·사용 내역을 확인하세요.",
    "Review purpose-specific budget permissions, reservations and spending."
  ],
  "변경의 흐름을 한눈에.": [
    "변경의 흐름을 한눈에.",
    "Your changes at a glance."
  ],
  "내 대화와 기억이 바뀐 시점을 확인하세요.": [
    "내 대화와 기억이 바뀐 시점을 확인하세요.",
    "See when your conversations and memories changed."
  ],
  "추가 정보 필요": [
    "추가 정보 필요",
    "More details needed"
  ],
  "계획 작성 가능": [
    "계획 작성 가능",
    "Ready to plan"
  ],
  "범위 확인 필요": [
    "범위 확인 필요",
    "Scope needs review"
  ],
  "목적 확인 중": [
    "목적 확인 중",
    "Clarifying purpose"
  ],
  "계획 검토 중": [
    "계획 검토 중",
    "Reviewing plan"
  ],
  "계획 확인 필요": [
    "계획 확인 필요",
    "Plan needs review"
  ],
  "작업 연결됨": [
    "작업 연결됨",
    "Task linked"
  ],
  "작업 연결 확인": [
    "작업 연결 확인",
    "Checking task link"
  ],
  "다시 확인 필요": [
    "다시 확인 필요",
    "Needs another review"
  ],
  "지갑을 연결하고 로그인해 주세요.": [
    "지갑을 연결하고 로그인해 주세요.",
    "Connect your wallet to sign in."
  ],
  "AI 연결을 준비 중입니다. 작업 화면에서 조회 범위를 직접 지정할 수 있습니다.": [
    "AI 연결을 준비 중입니다. 작업 화면에서 조회 범위를 직접 지정할 수 있습니다.",
    "AI setup is pending. You can enter the report scope on the Tasks page."
  ],
  "AI 응답을 받지 못했습니다. 현재 대화를 확인한 뒤 새로 요청해 주세요.": [
    "AI 응답을 받지 못했습니다. 현재 대화를 확인한 뒤 새로 요청해 주세요.",
    "No AI response was received. Review the current conversation before requesting again."
  ],
  "AI가 반환한 계획을 검증하지 못했습니다. 조건을 확인한 뒤 다시 요청해 주세요.": [
    "AI가 반환한 계획을 검증하지 못했습니다. 조건을 확인한 뒤 다시 요청해 주세요.",
    "The returned plan could not be validated. Check the conditions before requesting again."
  ],
  "분석할 지갑과 조회 기간을 구체적으로 지정해 주세요.": [
    "분석할 지갑과 조회 기간을 구체적으로 지정해 주세요.",
    "Specify the wallet and report time window."
  ],
  "요청 조건과 AI의 해석이 일치하지 않았습니다. 최신 조건을 다시 확인해 주세요.": [
    "요청 조건과 AI의 해석이 일치하지 않았습니다. 최신 조건을 다시 확인해 주세요.",
    "The interpreted scope did not match the request. Review the current conditions."
  ],
  "검토를 통과하지 못했습니다. 목적과 범위를 조정해 주세요.": [
    "검토를 통과하지 못했습니다. 목적과 범위를 조정해 주세요.",
    "The plan did not pass review. Adjust the purpose and scope."
  ],
  "선택할 자료의 연결을 준비 중입니다.": [
    "선택할 자료의 연결을 준비 중입니다.",
    "The report resource connection is being prepared."
  ],
  "요청 내용과 기억의 형식을 확인해 주세요.": [
    "요청 내용과 기억의 형식을 확인해 주세요.",
    "Check the request and memory format."
  ],
  "AI 응답 시간이 지났습니다. 대화의 현재 상태를 확인해 주세요.": [
    "AI 응답 시간이 지났습니다. 대화의 현재 상태를 확인해 주세요.",
    "The AI response timed out. Check the current conversation."
  ],
  "다른 요청으로 내용이 바뀌었습니다. 최신 상태를 불러왔습니다. 확인한 뒤 다시 진행해 주세요.": [
    "다른 요청으로 내용이 바뀌었습니다. 최신 상태를 불러왔습니다. 확인한 뒤 다시 진행해 주세요.",
    "Another request changed the content. The latest state was loaded; review it before continuing."
  ],
  "대화나 계획이 바뀌었습니다. 최신 계획을 다시 확인해 주세요.": [
    "대화나 계획이 바뀌었습니다. 최신 계획을 다시 확인해 주세요.",
    "The conversation or plan changed. Review the latest plan."
  ],
  "확정한 계획과 조회 범위가 다릅니다. 현재 계획의 조건을 확인해 주세요.": [
    "확정한 계획과 조회 범위가 다릅니다. 현재 계획의 조건을 확인해 주세요.",
    "The scope differs from the confirmed plan. Review the current plan."
  ],
  "이 대화에서 이전 요청을 처리 중입니다. 잠시 후 대화를 다시 열어 주세요.": [
    "이 대화에서 이전 요청을 처리 중입니다. 잠시 후 대화를 다시 열어 주세요.",
    "An earlier request is still processing. Reopen the conversation shortly."
  ],
  "이미 작업으로 연결한 대화입니다. 조건을 바꾸려면 새 대화를 만들어 주세요.": [
    "이미 작업으로 연결한 대화입니다. 조건을 바꾸려면 새 대화를 만들어 주세요.",
    "This conversation is already linked to a task. Start a new conversation to change its conditions."
  ],
  "이 대화의 길이 한도에 도달했습니다. 새 대화에서 이어가 주세요.": [
    "이 대화의 길이 한도에 도달했습니다. 새 대화에서 이어가 주세요.",
    "The conversation length limit was reached. Continue in a new conversation."
  ],
  "이 대화의 요청 한도에 도달했습니다. 새 대화에서 이어가 주세요.": [
    "이 대화의 요청 한도에 도달했습니다. 새 대화에서 이어가 주세요.",
    "The conversation request limit was reached. Continue in a new conversation."
  ],
  "이전 요청의 응답을 확인하지 못했습니다. 현재 조건으로 다시 요청할 수 있습니다.": [
    "이전 요청의 응답을 확인하지 못했습니다. 현재 조건으로 다시 요청할 수 있습니다.",
    "The earlier response could not be confirmed. You may request again with the current conditions."
  ],
  "작업 연결 결과를 확인해 주세요. 같은 계획으로 다시 확인하며 중복 작업을 만들지 않습니다.": [
    "작업 연결 결과를 확인해 주세요. 같은 계획으로 다시 확인하며 중복 작업을 만들지 않습니다.",
    "Check the task link. The same plan is checked again without creating a duplicate task."
  ],
  "오늘의 AI 요청 한도에 도달했습니다. 작업 화면에서 직접 조회 범위를 지정할 수 있습니다.": [
    "오늘의 AI 요청 한도에 도달했습니다. 작업 화면에서 직접 조회 범위를 지정할 수 있습니다.",
    "Today's AI request limit was reached. You can enter the scope directly on the Tasks page."
  ],
  "현재 처리 중인 요청이 있습니다. 잠시 후 다시 시도해 주세요.": [
    "현재 처리 중인 요청이 있습니다. 잠시 후 다시 시도해 주세요.",
    "A request is already processing. Try again shortly."
  ],
  "AI가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.": [
    "AI가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.",
    "AI is processing another request. Try again shortly."
  ],
  "목적과 지갑, 조회 기간을 먼저 정해 주세요.": [
    "목적과 지갑, 조회 기간을 먼저 정해 주세요.",
    "Specify the purpose, wallet and time window first."
  ],
  "비어 있거나 너무 긴 내용이 있습니다. 입력을 확인해 주세요.": [
    "비어 있거나 너무 긴 내용이 있습니다. 입력을 확인해 주세요.",
    "Some content is empty or too long. Check your input."
  ],
  "비밀키나 접근 토큰은 대화와 기억에 저장할 수 없습니다.": [
    "비밀키나 접근 토큰은 대화와 기억에 저장할 수 없습니다.",
    "Private keys and access tokens cannot be saved in conversations or memory."
  ],
  "등록된 지갑 이체 자료를 사용합니다. 외부 주소 대신 목적과 분석 지갑을 입력해 주세요.": [
    "등록된 지갑 이체 자료를 사용합니다. 외부 주소 대신 목적과 분석 지갑을 입력해 주세요.",
    "Use the registered wallet transfer report. Enter your purpose and wallet instead of an external URL."
  ],
  "날짜와 시간을 확인해 주세요.": [
    "날짜와 시간을 확인해 주세요.",
    "Check the date and time."
  ],
  "현재 이전의 최대 7일 범위로 지정해 주세요.": [
    "현재 이전의 최대 7일 범위로 지정해 주세요.",
    "Choose a past time window of up to seven days."
  ],
  "기억 보관 기한은 현재 이후 최대 90일입니다.": [
    "기억 보관 기한은 현재 이후 최대 90일입니다.",
    "Memory retention must end within the next 90 days."
  ],
  "보고서 형식이나 분석 선호를 저장해 주세요. 지갑·결제·권한 설정은 해당 화면에서 관리합니다.": [
    "보고서 형식이나 분석 선호를 저장해 주세요. 지갑·결제·권한 설정은 해당 화면에서 관리합니다.",
    "Save report format or analysis preferences. Manage wallet, payment and permissions on their respective pages."
  ],
  "기억 저장 동의 항목을 선택해 주세요.": [
    "기억 저장 동의 항목을 선택해 주세요.",
    "Select the memory storage acknowledgement."
  ],
  "사용 중인 기억이 삭제되거나 바뀌어 응답을 중단했습니다. 최신 기억으로 다시 요청해 주세요.": [
    "사용 중인 기억이 삭제되거나 바뀌어 응답을 중단했습니다. 최신 기억으로 다시 요청해 주세요.",
    "A memory in use changed or was removed, so the response stopped. Request again with the latest memory."
  ],
  "현재 보관 한도에 도달했습니다. 사용하지 않는 기억을 정리하거나 기존 대화를 이어가 주세요.": [
    "현재 보관 한도에 도달했습니다. 사용하지 않는 기억을 정리하거나 기존 대화를 이어가 주세요.",
    "The storage limit was reached. Remove unused memories or continue an existing conversation."
  ],
  "적용할 예산 권한이 만료되거나 취소됐습니다. 권한 상태를 확인해 주세요.": [
    "적용할 예산 권한이 만료되거나 취소됐습니다. 권한 상태를 확인해 주세요.",
    "The selected budget permission expired or was revoked. Check its status."
  ],
  "예산 권한이 바뀌었습니다. 최신 상태를 확인해 주세요.": [
    "예산 권한이 바뀌었습니다. 최신 상태를 확인해 주세요.",
    "The budget permission changed. Review its latest state."
  ],
  "목적·조회 범위·금액·실행 수·기한을 확인해 주세요.": [
    "목적·조회 범위·금액·실행 수·기한을 확인해 주세요.",
    "Check the purpose, scope, amount, execution count and expiry."
  ],
  "토큰 금액은 숫자와 소수점 6자리 이내로 입력해 주세요.": [
    "토큰 금액은 숫자와 소수점 6자리 이내로 입력해 주세요.",
    "Enter a numeric token amount with up to six decimal places."
  ],
  "조건을 읽고 동의 항목을 선택해 주세요.": [
    "조건을 읽고 동의 항목을 선택해 주세요.",
    "Read the conditions and select the acknowledgement."
  ],
  "응답을 확인하지 못했습니다. 새 요청을 반복하기 전에 현재 상태를 확인해 주세요.": [
    "응답을 확인하지 못했습니다. 새 요청을 반복하기 전에 현재 상태를 확인해 주세요.",
    "The response could not be confirmed. Check the current state before repeating a request."
  ],
  "동일한 요청 식별자의 조건이 다릅니다. 최신 상태를 확인해 주세요.": [
    "동일한 요청 식별자의 조건이 다릅니다. 최신 상태를 확인해 주세요.",
    "The request identifier has different conditions. Review the latest state."
  ],
  "서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.": [
    "서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    "The service is unavailable. Check again shortly."
  ],
  "새 대화를 만들었습니다": [
    "새 대화를 만들었습니다",
    "Conversation created"
  ],
  "대화 상태를 저장했습니다": [
    "대화 상태를 저장했습니다",
    "Conversation state saved"
  ],
  "기억을 저장했습니다": [
    "기억을 저장했습니다",
    "Memory saved"
  ],
  "기억을 수정했습니다": [
    "기억을 수정했습니다",
    "Memory updated"
  ],
  "기억을 삭제했습니다": [
    "기억을 삭제했습니다",
    "Memory removed"
  ],
  "요청을 완료하지 못했습니다. 입력한 조건과 현재 상태를 다시 확인해 주세요.": [
    "요청을 완료하지 못했습니다. 입력한 조건과 현재 상태를 다시 확인해 주세요.",
    "The request could not be completed. Review the input and current state."
  ],
  "자료 전달 완료": [
    "자료 전달 완료",
    "Report delivered"
  ],
  "거래 확인 중": [
    "거래 확인 중",
    "Checking payment"
  ],
  "결제 실행 대기": [
    "결제 실행 대기",
    "Awaiting payment execution"
  ],
  "조건 확인 필요": [
    "조건 확인 필요",
    "Terms need review"
  ],
  "워크스페이스 상태가 바뀌었습니다": [
    "워크스페이스 상태가 바뀌었습니다",
    "Workspace state changed"
  ],
  "기록 ": [
    "기록 ",
    "Record "
  ],
  " · 버전 ": [
    " · 버전 ",
    " · Version "
  ],
  "진행 중인 작업": [
    "진행 중인 작업",
    "Active tasks"
  ],
  "보관하지 않은 내 요청": [
    "보관하지 않은 내 요청",
    "Your unarchived requests"
  ],
  "확인된 분석 결과": [
    "확인된 분석 결과",
    "Available analyses"
  ],
  "내 작업의 자료 근거": [
    "내 작업의 자료 근거",
    "Evidence from your tasks"
  ],
  "상태 확인이 필요한 작업": [
    "상태 확인이 필요한 작업",
    "Tasks needing review"
  ],
  "원래 거래와 자료를 확인": [
    "원래 거래와 자료를 확인",
    "Check original payments and reports"
  ],
  "저장한 기억": [
    "저장한 기억",
    "Saved memories"
  ],
  "대화별로 사용 여부 선택": [
    "대화별로 사용 여부 선택",
    "Choose per conversation"
  ],
  "지갑으로 로그인하면 내 작업을 이어 볼 수 있습니다.": [
    "지갑으로 로그인하면 내 작업을 이어 볼 수 있습니다.",
    "Sign in with your wallet to continue your tasks."
  ],
  "로그인하면 내 활동 기록을 확인할 수 있습니다.": [
    "로그인하면 내 활동 기록을 확인할 수 있습니다.",
    "Sign in to view your activity."
  ],
  "아직 만든 작업이 없습니다. 새 대화에서 시작하세요.": [
    "아직 만든 작업이 없습니다. 새 대화에서 시작하세요.",
    "No tasks yet. Start with a new conversation."
  ],
  "대화와 기억의 변경 기록이 여기에 표시됩니다.": [
    "대화와 기억의 변경 기록이 여기에 표시됩니다.",
    "Changes to conversations and memories appear here."
  ],
  "등록된 자료의 연결 상태를 확인하고 있습니다.": [
    "등록된 자료의 연결 상태를 확인하고 있습니다.",
    "Checking the registered report connection."
  ],
  "로그인하면 사용 가능한 자료와 조회 범위를 확인할 수 있습니다.": [
    "로그인하면 사용 가능한 자료와 조회 범위를 확인할 수 있습니다.",
    "Sign in to view available reports and their scope."
  ],
  "Solana Devnet · 최대 ": [
    "Solana Devnet · 최대 ",
    "Solana Devnet · Up to "
  ],
  "일 · 반환된 이체 내역 범위": [
    "일 · 반환된 이체 내역 범위",
    " days · Returned transfers only"
  ],
  "조회 자료 연결됨": [
    "조회 자료 연결됨",
    "Report connected"
  ],
  "연결 설정 중": [
    "연결 설정 중",
    "Connection pending"
  ],
  "새 대화를 만들어 보세요.": [
    "새 대화를 만들어 보세요.",
    "Start a new conversation."
  ],
  "로그인 후 대화를 시작하세요.": [
    "로그인 후 대화를 시작하세요.",
    "Sign in to start a conversation."
  ],
  "상태 확인": [
    "상태 확인",
    "Check status"
  ],
  "대화 불러오는 중": [
    "대화 불러오는 중",
    "Loading conversation"
  ],
  "연결 확인 중…": [
    "연결 확인 중…",
    "Checking connection…"
  ],
  "보내기 ↑": [
    "보내기 ↑",
    "Send ↑"
  ],
  "지갑 연결하고 시작": [
    "지갑 연결하고 시작",
    "Connect wallet to start"
  ],
  "요청을 먼저 적어 두세요. 지갑 연결 후 안전하게 이어집니다.": [
    "요청을 먼저 적어 두세요. 지갑 연결 후 안전하게 이어집니다.",
    "Write your request first. Continue after connecting your wallet."
  ],
  "확정한 범위와 결과를 이 대화에서 이어갑니다.": [
    "확정한 범위와 결과를 이 대화에서 이어갑니다.",
    "Continue with the confirmed scope and results in this conversation."
  ],
  "요청을 처리하고 있습니다.": [
    "요청을 처리하고 있습니다.",
    "Your request is processing."
  ],
  "필요한 정보를 대화로 확인합니다. 결제 전 조건을 보여 드려요.": [
    "필요한 정보를 대화로 확인합니다. 결제 전 조건을 보여 드려요.",
    "We will clarify the details and show the terms before payment."
  ],
  "자료 제공자의 결제 조건 연결을 준비 중입니다. 연결 후 예산 권한을 만들 수 있습니다.": [
    "자료 제공자의 결제 조건 연결을 준비 중입니다. 연결 후 예산 권한을 만들 수 있습니다.",
    "The provider's payment terms are being connected. Budget permissions become available afterward."
  ],
  "필요한 정보를 함께 정리해요": [
    "필요한 정보를 함께 정리해요",
    "Let's clarify the details"
  ],
  "목적과 범위를 대화로 확인합니다": [
    "목적과 범위를 대화로 확인합니다",
    "We will clarify the purpose and scope in conversation."
  ],
  "요청의 목적과 범위를 확인하고 있어요": [
    "요청의 목적과 범위를 확인하고 있어요",
    "Clarifying your purpose and scope"
  ],
  "입력한 내용에서 필요한 정보를 정리합니다.": [
    "입력한 내용에서 필요한 정보를 정리합니다.",
    "Organizing the details from your request."
  ],
  "필요한 자료와 계획을 검토하고 있어요": [
    "필요한 자료와 계획을 검토하고 있어요",
    "Reviewing the report and plan"
  ],
  "같은 목적과 조회 범위에 맞는지 별도로 검토합니다.": [
    "같은 목적과 조회 범위에 맞는지 별도로 검토합니다.",
    "A separate review checks the same purpose and time window."
  ],
  "요청한 결과가 준비됐어요": [
    "요청한 결과가 준비됐어요",
    "Your result is ready"
  ],
  "분석 요약과 근거를 먼저 확인하세요. 영수증과 실행 과정은 펼쳐 볼 수 있습니다.": [
    "분석 요약과 근거를 먼저 확인하세요. 영수증과 실행 과정은 펼쳐 볼 수 있습니다.",
    "Read the summary and evidence first. Expand the receipt and execution history when needed."
  ],
  "원래 결제의 확인이 필요해요": [
    "원래 결제의 확인이 필요해요",
    "Check the original payment"
  ],
  "아직 결제 결과가 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래를 확인하세요.": [
    "아직 결제 결과가 확정되지 않았습니다. 새 결제를 만들지 않고 원래 거래를 확인하세요.",
    "Payment is unresolved. Check the original transaction without creating another payment."
  ],
  "승인한 결제를 확인하고 있어요": [
    "승인한 결제를 확인하고 있어요",
    "Checking your approved payment"
  ],
  "결제 확인과 자료 도착을 각각 확인합니다. 같은 요청을 다시 결제하지 않습니다.": [
    "결제 확인과 자료 도착을 각각 확인합니다. 같은 요청을 다시 결제하지 않습니다.",
    "Payment and delivery are checked separately. The same request is not paid again."
  ],
  "받은 자료의 분석을 확인해 주세요": [
    "받은 자료의 분석을 확인해 주세요",
    "Check the delivered report's analysis"
  ],
  "결제는 확인됐지만 자료가 아직 도착하지 않았어요": [
    "결제는 확인됐지만 자료가 아직 도착하지 않았어요",
    "Payment is confirmed; the report has not arrived"
  ],
  "같은 결제로 자료와 분석을 다시 확인할 수 있습니다. 새 결제는 필요하지 않습니다.": [
    "같은 결제로 자료와 분석을 다시 확인할 수 있습니다. 새 결제는 필요하지 않습니다.",
    "Check the report and analysis using the same payment. A new payment is not needed."
  ],
  "거래 실패를 확인했어요": [
    "거래 실패를 확인했어요",
    "Payment failure confirmed"
  ],
  "자동으로 새 결제를 만들지 않습니다. 원래 거래의 기록을 먼저 확인하세요.": [
    "자동으로 새 결제를 만들지 않습니다. 원래 거래의 기록을 먼저 확인하세요.",
    "No new payment is created automatically. Review the original transaction first."
  ],
  "이 작업의 결제 승인을 취소했어요": [
    "이 작업의 결제 승인을 취소했어요",
    "This task's payment approval was revoked"
  ],
  "이 승인으로 새 결제를 실행하지 않습니다. 계속하려면 현재 조건을 확인하고 다시 승인하세요.": [
    "이 승인으로 새 결제를 실행하지 않습니다. 계속하려면 현재 조건을 확인하고 다시 승인하세요.",
    "This approval cannot start a new payment. Review current terms and approve again to continue."
  ],
  "결제 조건의 유효 시간이 지났어요": [
    "결제 조건의 유효 시간이 지났어요",
    "The payment terms expired"
  ],
  "아직 결제하지 않았습니다. 현재 가격과 조건을 다시 확인한 뒤 승인할 수 있습니다.": [
    "아직 결제하지 않았습니다. 현재 가격과 조건을 다시 확인한 뒤 승인할 수 있습니다.",
    "Payment has not started. Review the current price and terms before approving."
  ],
  "결제 조건을 확인하고 진행해 주세요": [
    "결제 조건을 확인하고 진행해 주세요",
    "Review the payment terms to continue"
  ],
  "현재 가격은 ": [
    "현재 가격은 ",
    "The current price is "
  ],
  " 토큰입니다. 아래에서 범위·한도·기한을 확인하고 승인하면 실행합니다.": [
    " 토큰입니다. 아래에서 범위·한도·기한을 확인하고 승인하면 실행합니다.",
    " tokens. Review the scope, limit and expiry below; approving starts execution."
  ],
  "이 계획의 결제 조건을 준비하고 있어요": [
    "이 계획의 결제 조건을 준비하고 있어요",
    "Preparing this plan's payment terms"
  ],
  "요청을 저장했어요": [
    "요청을 저장했어요",
    "Your request is saved"
  ],
  "아직 결제하지 않았습니다. 현재 요청의 결제 조건을 확인할 수 있습니다.": [
    "아직 결제하지 않았습니다. 현재 요청의 결제 조건을 확인할 수 있습니다.",
    "Payment has not started. You can review terms for this request."
  ],
  "자료 제공자의 연결을 준비 중입니다. 결제는 시작하지 않았고, 같은 요청에서 이어갈 수 있습니다.": [
    "자료 제공자의 연결을 준비 중입니다. 결제는 시작하지 않았고, 같은 요청에서 이어갈 수 있습니다.",
    "The provider connection is pending. Payment has not started; continue with the same request later."
  ],
  "목적에 맞는 계획을 정리했어요": [
    "목적에 맞는 계획을 정리했어요",
    "Your plan is ready for review"
  ],
  "조회 조건을 바꿨다면 메시지로 보내 새 계획을 확인해 주세요.": [
    "조회 조건을 바꿨다면 메시지로 보내 새 계획을 확인해 주세요.",
    "If you changed the scope, send the changes in a message to review a new plan."
  ],
  "아래 범위를 확인하면 정확한 결제 조건을 준비합니다. 아직 결제하지 않습니다.": [
    "아래 범위를 확인하면 정확한 결제 조건을 준비합니다. 아직 결제하지 않습니다.",
    "Confirm the scope below to prepare exact payment terms. This does not make a payment."
  ],
  "요청을 저장하고 잠시 멈췄어요": [
    "요청을 저장하고 잠시 멈췄어요",
    "Your request is saved and paused"
  ],
  "현재 조건을 확인한 뒤 명시적으로 다시 요청할 수 있습니다. 결제는 시작되지 않았습니다.": [
    "현재 조건을 확인한 뒤 명시적으로 다시 요청할 수 있습니다. 결제는 시작되지 않았습니다.",
    "Review the current conditions before explicitly requesting again. Payment has not started."
  ],
  "분석할 지갑과 기간을 대화로 알려 주세요. 복잡한 항목을 먼저 고를 필요가 없습니다.": [
    "분석할 지갑과 기간을 대화로 알려 주세요. 복잡한 항목을 먼저 고를 필요가 없습니다.",
    "Tell us the wallet and time window. There is no need to choose technical settings first."
  ],
  "요청 이해": [
    "요청 이해",
    "Understand request"
  ],
  "계획 검토": [
    "계획 검토",
    "Review plan"
  ],
  "결제 조건·실행": [
    "결제 조건·실행",
    "Payment terms and execution"
  ],
  "결과와 근거": [
    "결과와 근거",
    "Results and evidence"
  ],
  "무엇을 알아보고 싶으세요?": [
    "무엇을 알아보고 싶으세요?",
    "What would you like to learn?"
  ],
  "대화 시작": [
    "대화 시작",
    "Start a conversation"
  ],
  "나": [
    "나",
    "You"
  ],
  "목적을 알려 주시면 조회 범위를 함께 정리합니다.": [
    "목적을 알려 주시면 조회 범위를 함께 정리합니다.",
    "Tell us your purpose and we will clarify the report scope."
  ],
  "확인할 항목: ": [
    "확인할 항목: ",
    "Details needed: "
  ],
  "목적": [
    "목적",
    "Purpose"
  ],
  "지갑": [
    "지갑",
    "Wallet"
  ],
  "시작 시간": [
    "시작 시간",
    "Start time"
  ],
  "종료 시간": [
    "종료 시간",
    "End time"
  ],
  "자료": [
    "자료",
    "Report"
  ],
  "조건": [
    "조건",
    "Condition"
  ],
  "현재 상태를 확인한 뒤 다시 요청해 주세요.": [
    "현재 상태를 확인한 뒤 다시 요청해 주세요.",
    "Check the current state before requesting again."
  ],
  "자료 선택 · ": [
    "자료 선택 · ",
    "Report selection · "
  ],
  "검토 에이전트 확인을 통과한 계획입니다.": [
    "검토 에이전트 확인을 통과한 계획입니다.",
    "This plan passed the review agent's checks."
  ],
  "조회 범위와 제한 자세히 보기": [
    "조회 범위와 제한 자세히 보기",
    "View scope and limitations"
  ],
  "모델 ": [
    "모델 ",
    "Model "
  ],
  " · 계획 버전 ": [
    " · 계획 버전 ",
    " · Plan version "
  ],
  "목적과 범위가 정해지면 AI가 자료를 선택하고 별도로 검토합니다.": [
    "목적과 범위가 정해지면 AI가 자료를 선택하고 별도로 검토합니다.",
    "Once the purpose and scope are clear, AI selects a report and reviews the plan separately."
  ],
  "작업과 결제 조건 확인 ↗": [
    "작업과 결제 조건 확인 ↗",
    "View task and payment terms ↗"
  ],
  "같은 계획으로 생성한 작업을 이어갈 수 있습니다.": [
    "같은 계획으로 생성한 작업을 이어갈 수 있습니다.",
    "Continue with the task created from this plan."
  ],
  "이번 작업의 조건을 별도 승인": [
    "이번 작업의 조건을 별도 승인",
    "Approve terms separately for this task"
  ],
  " · 남은 ": [
    " · 남은 ",
    " · Remaining "
  ],
  "아직 저장한 기억이 없습니다. 보고서 형식이나 선호를 추가해 보세요.": [
    "아직 저장한 기억이 없습니다. 보고서 형식이나 선호를 추가해 보세요.",
    "No memories yet. Add a report format or preference."
  ],
  "로그인하면 저장한 기억을 볼 수 있습니다.": [
    "로그인하면 저장한 기억을 볼 수 있습니다.",
    "Sign in to view your saved memories."
  ],
  "보관 기한 ": [
    "보관 기한 ",
    "Retain until "
  ],
  "기억 삭제": [
    "기억 삭제",
    "Delete memory"
  ],
  "기억 삭제 중": [
    "기억 삭제 중",
    "Deleting memory"
  ],
  "오늘 확인된 사용액": [
    "오늘 확인된 사용액",
    "Confirmed spending today"
  ],
  "내 Devnet 토큰 · UTC 기준": [
    "내 Devnet 토큰 · UTC 기준",
    "Your Devnet tokens · UTC day"
  ],
  "오늘 예약된 금액": [
    "오늘 예약된 금액",
    "Reserved today"
  ],
  "사용 중인 예산 권한": [
    "사용 중인 예산 권한",
    "Active budget permissions"
  ],
  "유효한 내 목적별 한도": [
    "유효한 내 목적별 한도",
    "Your active purpose-specific limits"
  ],
  "서버 일일 한도": [
    "서버 일일 한도",
    "Server daily limit"
  ],
  "모든 결제 지갑 사용자에 적용": [
    "모든 결제 지갑 사용자에 적용",
    "Applies across service payment wallet users"
  ],
  "만들어진 예산 권한이 없습니다.": [
    "만들어진 예산 권한이 없습니다.",
    "No budget permissions yet."
  ],
  "로그인하면 예산 권한을 관리할 수 있습니다.": [
    "로그인하면 예산 권한을 관리할 수 있습니다.",
    "Sign in to manage budget permissions."
  ],
  "사용 가능": [
    "사용 가능",
    "Available"
  ],
  "취소됨": [
    "취소됨",
    "Revoked"
  ],
  "기한 만료": [
    "기한 만료",
    "Expired"
  ],
  "한도 도달": [
    "한도 도달",
    "Limit reached"
  ],
  "기한 ": [
    "기한 ",
    "Expires "
  ],
  "남은 예산": [
    "남은 예산",
    "Remaining budget"
  ],
  "사용액": [
    "사용액",
    "Spent"
  ],
  "남은 실행": [
    "남은 실행",
    "Remaining executions"
  ],
  "이 예산 권한 취소": [
    "이 예산 권한 취소",
    "Revoke this budget permission"
  ],
  "예산 권한 취소 중": [
    "예산 권한 취소 중",
    "Revoking budget permission"
  ],
  "아직 결제 예산 예약 기록이 없습니다.": [
    "아직 결제 예산 예약 기록이 없습니다.",
    "No payment budget reservations yet."
  ],
  "작업": [
    "작업",
    "Task"
  ],
  "금액 · 토큰": [
    "금액 · 토큰",
    "Amount · tokens"
  ],
  "상태": [
    "상태",
    "Status"
  ],
  "예약한 날짜": [
    "예약한 날짜",
    "Reservation date"
  ],
  "확인된 사용": [
    "확인된 사용",
    "Confirmed spending"
  ],
  "예약 유지": [
    "예약 유지",
    "Reservation retained"
  ],
  "대화와 기억을 저장하면 활동 기록이 나타납니다.": [
    "대화와 기억을 저장하면 활동 기록이 나타납니다.",
    "Activity appears when conversations and memories are saved."
  ],
  "지갑 로그인 후 내 활동 기록을 확인할 수 있습니다.": [
    "지갑 로그인 후 내 활동 기록을 확인할 수 있습니다.",
    "Sign in with your wallet to view your activity."
  ],
  "대화 만드는 중": [
    "대화 만드는 중",
    "Creating conversation"
  ],
  "최근 지갑 이체를 자산별로 정리하고 싶어요.": [
    "최근 지갑 이체를 자산별로 정리하고 싶어요.",
    "Summarize recent wallet transfers by asset."
  ],
  "이전 대화 불러오는 중": [
    "이전 대화 불러오는 중",
    "Loading earlier conversations"
  ],
  "이전 메시지 불러오는 중": [
    "이전 메시지 불러오는 중",
    "Loading earlier messages"
  ],
  "필요한 자료와 계획을 검토 중…": [
    "필요한 자료와 계획을 검토 중…",
    "Reviewing the report and plan…"
  ],
  "로그인 연결을 확인하고 있습니다. 입력한 내용은 유지합니다.": [
    "로그인 연결을 확인하고 있습니다. 입력한 내용은 유지합니다.",
    "Checking sign-in readiness. Your draft is retained."
  ],
  "요청 내용을 유지합니다. 지갑 로그인 후 이어갑니다.": [
    "요청 내용을 유지합니다. 지갑 로그인 후 이어갑니다.",
    "Your draft is retained. Continue after wallet sign-in."
  ],
  "목적과 조회 범위 확인 중": [
    "목적과 조회 범위 확인 중",
    "Clarifying purpose and scope"
  ],
  "계획 작성 및 검토 중": [
    "계획 작성 및 검토 중",
    "Preparing and reviewing plan"
  ],
  "확인한 범위의 결제 조건 준비 중": [
    "확인한 범위의 결제 조건 준비 중",
    "Preparing payment terms for the confirmed scope"
  ],
  "기억 저장 중": [
    "기억 저장 중",
    "Saving memory"
  ],
  "기억 불러오는 중": [
    "기억 불러오는 중",
    "Loading memories"
  ],
  "기억 더 불러오는 중": [
    "기억 더 불러오는 중",
    "Loading more memories"
  ],
  "예산 권한 저장 중": [
    "예산 권한 저장 중",
    "Saving budget permission"
  ],
  "예산 권한 불러오는 중": [
    "예산 권한 불러오는 중",
    "Loading budget permissions"
  ],
  "활동 불러오는 중": [
    "활동 불러오는 중",
    "Loading activity"
  ],
  "목적에 맞는 자료를 요청하고, 승인한 조건과 결제·결과를 확인하는 Floww 워크스페이스": [
    "목적에 맞는 자료를 요청하고, 승인한 조건과 결제·결과를 확인하는 Floww 워크스페이스",
    "Request reports for your purpose and review approved terms, payments and results in Floww."
  ],
  "Floww · 자료 실행 워크스페이스": [
    "Floww · 자료 실행 워크스페이스",
    "Floww · Report workspace"
  ],
  "워크스페이스로 건너뛰기": [
    "워크스페이스로 건너뛰기",
    "Skip to workspace"
  ],
  "Floww 홈": [
    "Floww 홈",
    "Floww home"
  ],
  "로그아웃": [
    "로그아웃",
    "Log out"
  ],
  "워크스페이스 메뉴": [
    "워크스페이스 메뉴",
    "Workspace menu"
  ],
  "AI 어시스턴트": [
    "AI 어시스턴트",
    "AI assistant"
  ],
  "기록과 설정": [
    "기록과 설정",
    "Records and settings"
  ],
  "개요": [
    "개요",
    "Overview"
  ],
  "작업 및 결과": [
    "작업 및 결과",
    "Tasks and results"
  ],
  "나의 기억": [
    "나의 기억",
    "My memory"
  ],
  "예산 및 권한": [
    "예산 및 권한",
    "Budgets and permissions"
  ],
  "활동 기록": [
    "활동 기록",
    "Activity"
  ],
  "실행 환경": [
    "실행 환경",
    "Environment"
  ],
  "현재 연결을 확인하고 있습니다.": [
    "현재 연결을 확인하고 있습니다.",
    "Checking the current connection."
  ],
  "새 대화": [
    "새 대화",
    "New conversation"
  ],
  "알림 닫기": [
    "알림 닫기",
    "Dismiss notice"
  ],
  "워크스페이스 개요": [
    "워크스페이스 개요",
    "Workspace overview"
  ],
  "질문을 다듬고,": [
    "질문을 다듬고,",
    "Clarify your question."
  ],
  "근거를 따라 실행하세요.": [
    "근거를 따라 실행하세요.",
    "Act with evidence."
  ],
  "AI가 필요한 자료와 조회 범위를 제안합니다.": [
    "AI가 필요한 자료와 조회 범위를 제안합니다.",
    "AI suggests the report and scope you need."
  ],
  "실행 전 조건을 확인하고, 결과와 기록을 이어 보세요.": [
    "실행 전 조건을 확인하고, 결과와 기록을 이어 보세요.",
    "Review terms before execution, then follow the results and history."
  ],
  "어시스턴트와 시작하기": [
    "어시스턴트와 시작하기",
    "Start with the assistant"
  ],
  "목적, 검토, 승인, 근거의 흐름": [
    "목적, 검토, 승인, 근거의 흐름",
    "Purpose, review, approval and evidence"
  ],
  "검토": [
    "검토",
    "Review"
  ],
  "승인": [
    "승인",
    "Approval"
  ],
  "근거": [
    "근거",
    "Evidence"
  ],
  "내 작업 현황": [
    "내 작업 현황",
    "My task status"
  ],
  "바로 이어가기": [
    "바로 이어가기",
    "Continue your work"
  ],
  "모든 작업 ↗": [
    "모든 작업 ↗",
    "All tasks ↗"
  ],
  "최근 활동": [
    "최근 활동",
    "Recent activity"
  ],
  "전체 기록 ↗": [
    "전체 기록 ↗",
    "All activity ↗"
  ],
  "연결된 자료": [
    "연결된 자료",
    "Connected reports"
  ],
  "요청 진행 상태": [
    "요청 진행 상태",
    "Request progress"
  ],
  "지금 진행 중인 일": [
    "지금 진행 중인 일",
    "Current step"
  ],
  "진행 과정 보기": [
    "진행 과정 보기",
    "View progress"
  ],
  "이전 대화와 기억 설정": [
    "이전 대화와 기억 설정",
    "Conversation history and memory"
  ],
  "내 대화": [
    "내 대화",
    "My conversations"
  ],
  "새 대화 만들기": [
    "새 대화 만들기",
    "Create a conversation"
  ],
  "＋ 새로 만들기": [
    "＋ 새로 만들기",
    "＋ New conversation"
  ],
  "새 대화에서 저장한 기억 참고": [
    "새 대화에서 저장한 기억 참고",
    "Use saved memory in new conversations"
  ],
  "이전 대화 더 보기": [
    "이전 대화 더 보기",
    "Earlier conversations"
  ],
  "이전 메시지 보기": [
    "이전 메시지 보기",
    "Earlier messages"
  ],
  "AI와의 대화": [
    "AI와의 대화",
    "Conversation with AI"
  ],
  "요청 내용": [
    "요청 내용",
    "Your request"
  ],
  "알고 싶은 내용이나 수정할 조건을 입력해 주세요.": [
    "알고 싶은 내용이나 수정할 조건을 입력해 주세요.",
    "Enter your goal or the conditions you want to change."
  ],
  "원하는 일을 편하게 말해 주세요.": [
    "원하는 일을 편하게 말해 주세요.",
    "Tell us what you would like to do."
  ],
  "지금은 Solana 지갑의 이체 내역을 정리할 수 있어요.": [
    "지금은 Solana 지갑의 이체 내역을 정리할 수 있어요.",
    "You can currently analyze transfers for a Solana wallet."
  ],
  "부족한 정보는 대화로 확인하고, 결제 전 조건을 보여 드립니다.": [
    "부족한 정보는 대화로 확인하고, 결제 전 조건을 보여 드립니다.",
    "We will clarify missing details and show the terms before payment."
  ],
  "최근 지갑 이체를 자산별로 정리하고 싶어요 ↗": [
    "최근 지갑 이체를 자산별로 정리하고 싶어요 ↗",
    "Summarize recent wallet transfers by asset ↗"
  ],
  "조회 조건 직접 입력": [
    "조회 조건 직접 입력",
    "Enter report scope directly"
  ],
  "조회 범위": [
    "조회 범위",
    "Report scope"
  ],
  "주소와 시간을 직접 지정하면 다음 메시지에 함께 반영합니다.": [
    "주소와 시간을 직접 지정하면 다음 메시지에 함께 반영합니다.",
    "Addresses and times entered here are included with your next message."
  ],
  "Solana 지갑": [
    "Solana 지갑",
    "Solana wallet"
  ],
  "분석할 지갑 주소": [
    "분석할 지갑 주소",
    "Wallet address to analyze"
  ],
  "시작 · 현지 시간": [
    "시작 · 현지 시간",
    "Start · local time"
  ],
  "종료 · 현지 시간": [
    "종료 · 현지 시간",
    "End · local time"
  ],
  "실행 계획": [
    "실행 계획",
    "Execution plan"
  ],
  "계획 작성 및 검토": [
    "계획 작성 및 검토",
    "Prepare and review plan"
  ],
  "저장한 예산 권한 사용": [
    "저장한 예산 권한 사용",
    "Use a saved budget permission"
  ],
  "적용할 예산 권한": [
    "적용할 예산 권한",
    "Budget permission to apply"
  ],
  "이 범위로 결제 조건 확인 ↗": [
    "이 범위로 결제 조건 확인 ↗",
    "Review payment terms for this scope ↗"
  ],
  "아직 결제하지 않습니다. 정확한 가격을 준비한 뒤 이 대화에서 승인합니다.": [
    "아직 결제하지 않습니다. 정확한 가격을 준비한 뒤 이 대화에서 승인합니다.",
    "No payment is made yet. Review the exact price and approve here in this conversation."
  ],
  "요청한 결과와 결제 조건": [
    "요청한 결과와 결제 조건",
    "Your result and payment terms"
  ],
  "같은 작업의 현재 상태를 불러오고 있습니다.": [
    "같은 작업의 현재 상태를 불러오고 있습니다.",
    "Loading the current state of the same task."
  ],
  "자료 요청과 내 기록": [
    "자료 요청과 내 기록",
    "Report requests and history"
  ],
  "새 자료 요청": [
    "새 자료 요청",
    "New report request"
  ],
  "분석할 지갑과 기간을 정해 주세요.": [
    "분석할 지갑과 기간을 정해 주세요.",
    "Choose the wallet and report time window."
  ],
  "요청 목적": [
    "요청 목적",
    "Purpose"
  ],
  "지갑의 이체 내역을 분석하고 자산별 입출금을 정리해 주세요.": [
    "지갑의 이체 내역을 분석하고 자산별 입출금을 정리해 주세요.",
    "Analyze wallet transfers and summarize incoming and outgoing amounts by asset."
  ],
  "분석할 Solana 지갑": [
    "분석할 Solana 지갑",
    "Solana wallet to analyze"
  ],
  "Solana 지갑 주소": [
    "Solana 지갑 주소",
    "Solana wallet address"
  ],
  "조회 기간": [
    "조회 기간",
    "Time window"
  ],
  "최대 7일": [
    "최대 7일",
    "Up to seven days"
  ],
  "분석 지갑과 로그인 지갑은 다를 수 있습니다. 결제는 승인 화면에 표시된 Devnet 서비스 지갑에서 이루어집니다.": [
    "분석 지갑과 로그인 지갑은 다를 수 있습니다. 결제는 승인 화면에 표시된 Devnet 서비스 지갑에서 이루어집니다.",
    "The analysis wallet may differ from your sign-in wallet. Payment comes from the Devnet service wallet shown on the approval screen."
  ],
  "분석 요청 만들기": [
    "분석 요청 만들기",
    "Create analysis request"
  ],
  "지갑을 연결하고 로그인하면 시작할 수 있어요.": [
    "지갑을 연결하고 로그인하면 시작할 수 있어요.",
    "Connect your wallet and sign in to start."
  ],
  "내 요청": [
    "내 요청",
    "My requests"
  ],
  "새로고침": [
    "새로고침",
    "Refresh"
  ],
  "첫 번째 자료 요청을": [
    "첫 번째 자료 요청을",
    "Create your first"
  ],
  "만들어 보세요.": [
    "만들어 보세요.",
    "report request."
  ],
  "보관한 요청 포함": [
    "보관한 요청 포함",
    "Include archived requests"
  ],
  "내 분석 요청 목록": [
    "내 분석 요청 목록",
    "My analysis requests"
  ],
  "이전 요청 더 보기": [
    "이전 요청 더 보기",
    "Earlier requests"
  ],
  "실행 상태와 분석 결과": [
    "실행 상태와 분석 결과",
    "Execution status and analysis"
  ],
  "요청에서 결과까지,": [
    "요청에서 결과까지,",
    "From request to result,"
  ],
  "한곳에서 이어집니다.": [
    "한곳에서 이어집니다.",
    "all in one place."
  ],
  "왼쪽에서 새 요청을 만들거나": [
    "왼쪽에서 새 요청을 만들거나",
    "Create a new request or"
  ],
  "기존 요청을 선택해 주세요.": [
    "기존 요청을 선택해 주세요.",
    "choose an existing request."
  ],
  "자료 요청": [
    "자료 요청",
    "Request report"
  ],
  "조건 승인": [
    "조건 승인",
    "Approve terms"
  ],
  "실행과 결과 확인": [
    "실행과 결과 확인",
    "Execute and review results"
  ],
  "대기": [
    "대기",
    "Pending"
  ],
  "승인, 결제, 자료 전달 상태": [
    "승인, 결제, 자료 전달 상태",
    "Approval, payment and delivery status"
  ],
  "권한 확인": [
    "권한 확인",
    "Authorization"
  ],
  "결제": [
    "결제",
    "Payment"
  ],
  "자료 전달": [
    "자료 전달",
    "Report delivery"
  ],
  "이 자료의 결제 금액": [
    "이 자료의 결제 금액",
    "Price for this report"
  ],
  "거래 세부 조건": [
    "거래 세부 조건",
    "Transaction details"
  ],
  "수신자와 토큰 전체 주소 확인": [
    "수신자와 토큰 전체 주소 확인",
    "View full recipient and token addresses"
  ],
  "결제 조건 승인": [
    "결제 조건 승인",
    "Approve payment terms"
  ],
  "이번 작업의 최대 예산 · 토큰": [
    "이번 작업의 최대 예산 · 토큰",
    "Maximum budget for this task · tokens"
  ],
  "승인 기한 · 현지 시간": [
    "승인 기한 · 현지 시간",
    "Approval expiry · local time"
  ],
  "표시된 수신자·토큰·금액과 기한에 동의하며, Devnet 서비스 지갑의 결제를 승인합니다.": [
    "표시된 수신자·토큰·금액과 기한에 동의하며, Devnet 서비스 지갑의 결제를 승인합니다.",
    "I agree to the displayed recipient, token, amount and deadline, and authorize payment from the Devnet service wallet."
  ],
  "이 조건으로 승인하고 실행": [
    "이 조건으로 승인하고 실행",
    "Approve these terms and execute"
  ],
  "승인한 결제 실행": [
    "승인한 결제 실행",
    "Execute approved payment"
  ],
  "원래 결제 상태 확인": [
    "원래 결제 상태 확인",
    "Check original payment"
  ],
  "같은 결제로 자료 다시 받기": [
    "같은 결제로 자료 다시 받기",
    "Recover report with the same payment"
  ],
  "상태 새로고침": [
    "상태 새로고침",
    "Refresh status"
  ],
  "보관하기": [
    "보관하기",
    "Archive"
  ],
  "보관함에서 꺼내기": [
    "보관함에서 꺼내기",
    "Restore from archive"
  ],
  "실행 기록과 영수증 보기": [
    "실행 기록과 영수증 보기",
    "View execution history and receipt"
  ],
  "실행 기록": [
    "실행 기록",
    "Execution history"
  ],
  "확인된 거래": [
    "확인된 거래",
    "Confirmed transaction"
  ],
  "분석 결과": [
    "분석 결과",
    "Analysis result"
  ],
  "보고서 저장 ↓": [
    "보고서 저장 ↓",
    "Save report ↓"
  ],
  "자료 전달이 확인되면": [
    "자료 전달이 확인되면",
    "Once delivery is confirmed,"
  ],
  "분석 결과가 여기에 나타납니다.": [
    "분석 결과가 여기에 나타납니다.",
    "your analysis appears here."
  ],
  "기억 추가": [
    "기억 추가",
    "Add memory"
  ],
  "선호하는 보고서 형식이나 분석 관점을 저장하세요. 대화별로 참고 여부를 선택할 수 있습니다.": [
    "선호하는 보고서 형식이나 분석 관점을 저장하세요. 대화별로 참고 여부를 선택할 수 있습니다.",
    "Save your preferred report format or analysis perspective. Choose whether to use it in each conversation."
  ],
  "기억 이름": [
    "기억 이름",
    "Memory name"
  ],
  "예: 보고서 언어": [
    "예: 보고서 언어",
    "For example: report language"
  ],
  "기억할 내용": [
    "기억할 내용",
    "What to remember"
  ],
  "예: 한국어로 간단한 요약과 근거를 함께 보여 주세요.": [
    "예: 한국어로 간단한 요약과 근거를 함께 보여 주세요.",
    "For example: show a concise summary with evidence in English."
  ],
  "보관 기한 · 최대 90일": [
    "보관 기한 · 최대 90일",
    "Retain until · up to 90 days"
  ],
  "이 내용을 내 지갑 계정의 기억으로 저장합니다.": [
    "이 내용을 내 지갑 계정의 기억으로 저장합니다.",
    "I agree to save this content as memory for my wallet account."
  ],
  "기억 저장": [
    "기억 저장",
    "Save memory"
  ],
  "더 보기": [
    "더 보기",
    "Load more"
  ],
  "범위가 정해진 예산 권한": [
    "범위가 정해진 예산 권한",
    "Scoped budget permission"
  ],
  "목적과 조회 범위가 일치하는 작업에 적용합니다. 실제 실행마다 결제 조건을 별도로 승인합니다.": [
    "목적과 조회 범위가 일치하는 작업에 적용합니다. 실제 실행마다 결제 조건을 별도로 승인합니다.",
    "Applies to tasks with the same purpose and scope. Approve payment terms separately for each execution."
  ],
  "요청 목적 · 작업과 동일하게": [
    "요청 목적 · 작업과 동일하게",
    "Purpose · must match the task"
  ],
  "분석 지갑": [
    "분석 지갑",
    "Analysis wallet"
  ],
  "조회 시작": [
    "조회 시작",
    "Window start"
  ],
  "조회 종료": [
    "조회 종료",
    "Window end"
  ],
  "총 예산 · 토큰": [
    "총 예산 · 토큰",
    "Total budget · tokens"
  ],
  "건별 한도 · 토큰": [
    "건별 한도 · 토큰",
    "Per-purchase limit · tokens"
  ],
  "최대 실행 수": [
    "최대 실행 수",
    "Maximum executions"
  ],
  "권한 기한 · 최대 30일": [
    "권한 기한 · 최대 30일",
    "Permission expiry · up to 30 days"
  ],
  "이 목적·주소·기간과 예산 한도를 승인합니다.": [
    "이 목적·주소·기간과 예산 한도를 승인합니다.",
    "I approve this purpose, address, time window and budget limit."
  ],
  "예산 권한 만들기": [
    "예산 권한 만들기",
    "Create budget permission"
  ],
  "내 예산 권한": [
    "내 예산 권한",
    "My budget permissions"
  ],
  "결제 예산 기록": [
    "결제 예산 기록",
    "Payment budget ledger"
  ],
  "미확정 거래의 예약액은 유지됩니다. 확인된 거래는 한 번만 사용액에 반영합니다.": [
    "미확정 거래의 예약액은 유지됩니다. 확인된 거래는 한 번만 사용액에 반영합니다.",
    "Reservations remain for unresolved payments. Confirmed payments count toward spending once."
  ],
  "워크스페이스 기록": [
    "워크스페이스 기록",
    "Workspace activity"
  ],
  "대화와 기억의 변경 시점을 확인하세요. 작업별 결제·전달 기록은 해당 작업에서 볼 수 있습니다.": [
    "대화와 기억의 변경 시점을 확인하세요. 작업별 결제·전달 기록은 해당 작업에서 볼 수 있습니다.",
    "See when conversations and memories changed. Payment and delivery history is available in each task."
  ],
  "Solana Devnet · 목적과 근거를 잇는 워크스페이스": [
    "Solana Devnet · 목적과 근거를 잇는 워크스페이스",
    "Solana Devnet · A workspace connecting purpose and evidence"
  ],
  "화면 언어": [
    "화면 언어",
    "Interface language"
  ],
  "결제 승인이 거부됨": [
    "결제 승인이 거부됨",
    "Payment approval denied"
  ],
  "예산 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다. 현재 금액과 최대 예산을 확인한 뒤 다시 승인하세요. 결제는 시작하지 않았습니다.": [
    "예산 한도가 결제 금액보다 작거나 서비스 한도를 넘었습니다. 현재 금액과 최대 예산을 확인한 뒤 다시 승인하세요. 결제는 시작하지 않았습니다.",
    "The spending limit is below the price or exceeds the service limit. Review the current price and maximum budget before approving again. Payment has not started."
  ],
  "수신자·토큰·네트워크가 승인할 결제 조건과 일치하지 않습니다. 현재 조건을 다시 확인한 뒤 승인하세요. 결제는 시작하지 않았습니다.": [
    "수신자·토큰·네트워크가 승인할 결제 조건과 일치하지 않습니다. 현재 조건을 다시 확인한 뒤 승인하세요. 결제는 시작하지 않았습니다.",
    "The recipient, token or network does not match the permitted payment terms. Review the current terms before approving again. Payment has not started."
  ],
  "서버의 일일 결제 예산 한도에 도달했습니다. 원래 작업의 상태를 확인하고 한도가 이용 가능할 때 다시 진행하세요. 새 결제를 반복하지 마세요.": [
    "서버의 일일 결제 예산 한도에 도달했습니다. 원래 작업의 상태를 확인하고 한도가 이용 가능할 때 다시 진행하세요. 새 결제를 반복하지 마세요.",
    "The server daily payment budget limit was reached. Check the original task and continue when budget is available. Do not repeat payments."
  ],
  "승인 조건이 충족되지 않았습니다. 현재 결제 조건과 예산을 확인한 뒤 다시 승인하세요. 결제는 시작하지 않았습니다.": [
    "승인 조건이 충족되지 않았습니다. 현재 결제 조건과 예산을 확인한 뒤 다시 승인하세요. 결제는 시작하지 않았습니다.",
    "The approval conditions were not met. Review the current payment terms and budget before approving again. Payment has not started."
  ],
  "Intelligence workspace": [
    "자료 실행 공간",
    "Intelligence workspace"
  ],
  "WORKSPACE": [
    "워크스페이스",
    "WORKSPACE"
  ],
  "YOUR NEXT FLOW": [
    "다음으로 할 일",
    "YOUR NEXT FLOW"
  ],
  "YOUR WORKSPACE": [
    "나의 워크스페이스",
    "YOUR WORKSPACE"
  ],
  "FROM INTENT TO EVIDENCE": [
    "목적에서 근거까지",
    "FROM INTENT TO EVIDENCE"
  ],
  "EXECUTION & EVIDENCE": [
    "실행과 근거",
    "EXECUTION & EVIDENCE"
  ],
  "RESOURCE CATALOG": [
    "자료 목록",
    "RESOURCE CATALOG"
  ],
  "PURPOSE → PLAN": [
    "목적 → 계획",
    "PURPOSE → PLAN"
  ],
  "YOUR CONTEXT": [
    "나의 맥락",
    "YOUR CONTEXT"
  ],
  "BOUNDED AUTHORITY": [
    "범위가 정해진 권한",
    "BOUNDED AUTHORITY"
  ],
  "WORKSPACE ACTIVITY": [
    "워크스페이스 활동",
    "WORKSPACE ACTIVITY"
  ],
  "FLOWW ASSISTANT": [
    "플로우 어시스턴트",
    "FLOWW ASSISTANT"
  ],
  "UTC DAY": [
    "세계 표준시 기준",
    "UTC DAY"
  ],
  "FLOWW · PURPOSE BEFORE PAYMENT": [
    "FLOWW · 목적을 먼저, 결제는 그다음",
    "FLOWW · PURPOSE BEFORE PAYMENT"
  ],
  "CURRENT REQUEST": [
    "현재 요청",
    "CURRENT REQUEST"
  ],
  "task.signIn": [
    "지갑 로그인 중",
    "Signing in"
  ],
  "task.signOut": [
    "로그아웃 중",
    "Signing out"
  ],
  "task.load": [
    "작업 상세 확인 중",
    "Loading request details"
  ],
  "task.quote": [
    "결제 조건 확인 중",
    "Loading payment terms"
  ],
  "task.list": [
    "요청 목록 확인 중",
    "Loading requests"
  ],
  "task.archiveList": [
    "보관함 확인 중",
    "Loading archive"
  ],
  "task.earlier": [
    "이전 요청 확인 중",
    "Loading earlier requests"
  ],
  "task.archive": [
    "요청 보관 중",
    "Archiving request"
  ],
  "task.restore": [
    "요청 복원 중",
    "Restoring request"
  ],
  "task.refresh": [
    "실행 상태 확인 중",
    "Checking execution status"
  ],
  "task.execute": [
    "승인한 결제 실행 중",
    "Executing approved payment"
  ],
  "task.revoke": [
    "승인 취소 중",
    "Revoking approval"
  ],
  "task.reconcile": [
    "원래 결제 확인 중",
    "Checking original payment"
  ],
  "task.recover": [
    "같은 결제의 자료 전달 확인 중",
    "Checking delivery with the same payment"
  ],
  "task.approve": [
    "승인한 조건으로 실행 중",
    "Executing approved terms"
  ],
  "task.create": [
    "분석 요청 생성 중",
    "Creating report request"
  ],
  "workspace.loadConversation": [
    "대화 불러오는 중",
    "Loading conversation"
  ],
  "workspace.deleteMemory": [
    "기억 삭제 중",
    "Deleting memory"
  ],
  "workspace.revokeMandate": [
    "예산 권한 취소 중",
    "Revoking budget permission"
  ],
  "workspace.createConversation": [
    "대화 만드는 중",
    "Creating conversation"
  ],
  "workspace.earlierConversations": [
    "이전 대화 불러오는 중",
    "Loading earlier conversations"
  ],
  "workspace.earlierMessages": [
    "이전 메시지 불러오는 중",
    "Loading earlier messages"
  ],
  "workspace.refine": [
    "목적과 조회 범위 확인 중",
    "Clarifying purpose and scope"
  ],
  "workspace.plan": [
    "계획 작성 및 검토 중",
    "Preparing and reviewing plan"
  ],
  "workspace.confirm": [
    "확인한 범위의 결제 조건 준비 중",
    "Preparing payment terms for the confirmed scope"
  ],
  "workspace.saveMemory": [
    "기억 저장 중",
    "Saving memory"
  ],
  "workspace.loadMemory": [
    "기억 불러오는 중",
    "Loading memories"
  ],
  "workspace.moreMemory": [
    "기억 더 불러오는 중",
    "Loading more memories"
  ],
  "workspace.saveMandate": [
    "예산 권한 저장 중",
    "Saving budget permission"
  ],
  "workspace.loadMandates": [
    "예산 권한 불러오는 중",
    "Loading budget permissions"
  ],
  "workspace.loadActivity": [
    "활동 불러오는 중",
    "Loading activity"
  ]
};

  const STORAGE_KEY = 'floww.ui.locale';
  const supported = value => value === 'ko' || value === 'en';
  function initialLanguage() {
    try { const saved = window.localStorage?.getItem(STORAGE_KEY); if (supported(saved)) return saved; } catch { /* optional preference */ }
    const languages = window.navigator?.languages ?? [window.navigator?.language ?? 'en'];
    for (const value of languages) {
      const primary = typeof value === 'string' ? value.toLowerCase().split('-')[0] : '';
      if (supported(primary)) return primary;
    }
    return 'en';
  }
  let language = initialLanguage();
  const bindings = new WeakMap();
  const resolve = value => typeof value === 'function' ? resolve(value()) : value == null ? '' : String(value);
  function copy(key, parameters = {}) {
    if (!Object.hasOwn(COPY, key)) throw new Error('UNKNOWN_AUTHORED_COPY');
    return Object.freeze({ toString() {
      const template = COPY[key][language === 'ko' ? 0 : 1];
      return template.replace(/\{([A-Za-z]+)\}/g, (_, name) => resolve(parameters[name]));
    } });
  }
  function copyInLanguage(selectedLanguage, key, parameters = {}) {
    if (!supported(selectedLanguage) || !Object.hasOwn(COPY, key)) throw new Error('UNKNOWN_AUTHORED_COPY');
    return COPY[key][selectedLanguage === 'ko' ? 0 : 1].replace(/\{([A-Za-z]+)\}/g, (_, name) => resolve(parameters[name]));
  }
  function apply(node, attribute, binding) {
    // A binding created for a previous wallet/session cannot reintroduce its
    // private text after logout, even if the same leaf node is reused.
    if (binding.guard && binding.guard() !== binding.generation) return false;
    const value = resolve(binding.value);
    if (attribute === 'text') {
      if (node.textContent !== value) node.textContent = value;
    } else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
    return true;
  }
  function bind(node, attribute, value, guard) {
    if (!node) return node;
    const current = bindings.get(node) ?? new Map();
    const binding = { value, guard, generation: guard?.() };
    current.set(attribute, binding); bindings.set(node, current);
    node.setAttribute('data-locale-bound', ''); apply(node, attribute, binding);
    return node;
  }
  const text = (node, value, guard) => bind(node, 'text', value, guard);
  const attr = (node, name, value, guard) => bind(node, name, value, guard);
  function refresh() {
    document.documentElement.setAttribute('lang', language);
    for (const node of document.querySelectorAll('[data-locale-bound]')) {
      const current = bindings.get(node);
      if (!current) continue;
      for (const [name, binding] of current) if (!apply(node, name, binding)) current.delete(name);
      if (!current.size) node.removeAttribute('data-locale-bound');
    }
    const selector = document.getElementById('interface-language');
    if (selector) selector.value = language;
  }
  function setLanguage(value) {
    if (!supported(value)) return false;
    language = value;
    try { window.localStorage?.setItem(STORAGE_KEY, value); } catch { /* optional preference */ }
    refresh(); window.dispatchEvent(new CustomEvent('floww:locale', { detail: { language } })); return true;
  }
  function date(value) {
    if (!Number.isFinite(Date.parse(value))) return String(copy('시간 확인 필요'));
    return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(value));
  }
  window.FlowwLocale = Object.freeze({ copy, copyInLanguage, text, attr, date, setLanguage, get language() { return language; } });
  // This one-time bootstrap visits only explicitly authored copy leaves and
  // attributes. Locale changes never rescan arbitrary DOM text or input values.
  for (const node of document.querySelectorAll('[data-copy]')) text(node, copy(node.getAttribute('data-copy')));
  for (const name of ['aria-label', 'placeholder', 'title', 'content']) {
    for (const node of document.querySelectorAll('[data-copy-' + name + ']')) attr(node, name, copy(node.getAttribute('data-copy-' + name)));
  }
  const selector = document.getElementById('interface-language');
  selector?.addEventListener('change', () => { if (!setLanguage(selector.value)) selector.value = language; });
  refresh();
})();
