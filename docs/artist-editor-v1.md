# Artist Editor v1

## Goal

Extend the Diffusion editor through its native project, caption, timeline, inspector,
history, preview, and export paths. A musician can approve timing for one exact
recording and reuse a section on several one-shot drafts without losing manual work.

## First reviewable slice

- An exact recording is identified by SHA-256, sample rate, and duration.
- Versioned local timing JSON stores lines, deliberate blank intervals, a named
  section, and source-sample times.
- Each draft has one semantic Lyrics caption entity, local local-font styling, and
  a pinned timing revision.
- A single section can create three one-shot drafts. Camera audio stays muted.
- The Assets panel's **Artist drafts** action selects one approved timing file,
  its exact local master recording, one named section, and three video assets.
  It writes three ordinary 9:16 scenes, each with the same project-local
  section transcript, a muted camera track, and the selected master-song range.
- The action refuses a master-audio source that differs from the recording path
  pinned by the timing revision; it never substitutes a similarly named mix.
- The local **Song timing** action accepts only a local timed subtitle or
  transcript and the local master recording. It hashes the full master file,
  creates an approved revision only after an explicit review check, and writes
  it to the project library for reuse.
- An imported audio asset exposes **Transcribe locally**. It runs the fixed
  on-device `whisper-cli` runner against a user-selected local Whisper model,
  returns a local `.srt` asset, and never downloads a model or falls back to a
  hosted transcription provider. The first use asks for a local model file;
  its path is stored only in this app's local preferences.
- A timing made from a verse-only subtitle file defines that verse's actual
  cue span, so its reusable master-audio range does not expand to the full song.
- Caption text, times, crop, and local style survive undo, save, and reopen.
- Paused hover skimming previews without seeking or creating history. Click seeks.

## Constraints

- No second editor, renderer, agent framework, or storage service.
- No hosted transcription, remote fonts, analytics, or crash upload in the local
  profile. Codex context sharing is a separately scoped exception.
- Originals are immutable. Exports are versioned and never overwrite a source.
- Unknown lyrics and missing word times stay unknown; they are never invented.
- A local transcription is a draft: it must be reviewed before it can become
  reusable song timing. The runner is a fixed executable with fixed arguments,
  writes only a temporary output, and cannot be used as a general shell.
- Source timing remains in integer samples. The initial slice supports 1x playback.

## Edges

- Final lines have explicit ends.
- Repeated lines have distinct identifiers.
- A section beginning inside a held line exposes an explicit boundary policy.
- Replacing a clip preserves lyrics and style but flags incompatible reframing.

## Acceptance

Tests must cover: caption entity roundtrip, three-draft reuse without ASR, final-line
and blank-gap timing, undo/reopen, missing-font visibility, one master audio stream,
hover skim at zoom/scroll offsets, network-denied core flow, blocked out-of-root
write, and a short caption-boundary export.

The complete product contract, milestones, and safety review live in GitHub issue #26.
