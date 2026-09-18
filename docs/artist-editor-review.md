# Artist Editor first-slice review

## Launch

```sh
cd "/Users/noah/Documents/My Projects/ClaudeX/artist-editor"
npm run dev:desktop
```

Use the `main` branch of `nhendyson/artist-editor`, reviewed at `0fa9d93`.
The source checkout is isolated from the stock Diffusion install; imported
media remains linked from its original location and is never added to this
repository.

When this local desktop build has no configured Supabase account, it opens the
editor directly. The inherited sign-in, billing, and cloud-generation paths do
not become available merely by launching the app; local projects, timing, and
caption work do not require an online account.

## Review the local reuse workflow

1. Create or open a Diffusion project.
2. Import one local master audio file, one local timed `.srt`, `.vtt`, or
   transcript JSON, and three video clips.
3. In **Assets**, choose **Song timing**. Select the master and the local
   transcript, name the cue span (for example `Verse 1`), review the line
   boundaries, then confirm the review checkbox and save.
4. Choose **Artist drafts**. Select the saved timing, its matching master
   audio, the section, and the three clips. The action rejects a different
   master-audio source rather than matching by name.
5. Confirm that the canvas contains three ordinary vertical scenes. Open each
   scene from the canvas/timeline and inspect:
   - one muted camera-video item;
   - one master-audio item, trimmed to the selected cue span;
   - one `Artist Lines` caption entity; and
   - editable crop, text styling, and timeline placement through the native
     Diffusion controls.

## What the slice deliberately does

- A caption line starts at its reviewed cue start and clears at its exclusive
  end. Adjacent lines switch on the incoming vocal frame. An intentional gap
  remains empty.
- A subtitle with only line-level timecodes stays line-level. The app does not
  invent word timing from spelling or character count.
- The standard artist caption baseline is centered white regular `TikTok Sans`
  with no generated shadow or outline. If that font is absent, the local-font
  UI exposes the missing selection instead of silently changing the look.
- Creating drafts produces native scenes and caption layers; it does not burn
  captions into a proxy video or contact a transcription service.

## Evidence and current limits

| Check | Status | Evidence / limitation |
|---|---|---|
| Portable timing, cue-span mapping, blank/unknown validation | PASS | `packages/assets/test/song-timing.test.ts` (6 tests) |
| Local Song timing import | PASS | Full SHA-256, exact source path, sample rate and duration are saved in timing JSON |
| Three native draft creation | BUILD-CHECKED | Desktop build and web type checks pass; needs hands-on scene review |
| Semantic line captions and local style baseline | BUILD-CHECKED | `ArtistCaptionDecoder` creates one native caption layer; visual font rendering still needs review on this Mac |
| Hover skimming | BUILD-CHECKED | Implemented through the existing timeline controller; desktop automation could not attach for visual interaction testing |
| Save/reopen and crop/style persistence | PENDING MANUAL REVIEW | Uses Diffusion's normal document editor/persistence rather than a parallel store |
| Master-audio envelope/export comparison | PENDING | Camera tracks are muted and source audio is singular by construction; no encoded-reference export comparison yet |
| Managed project writes | PASS | `apps/desktop/src/managed-write.test.ts` covers allowed nested writes plus blocked traversal and symlink escapes |
| Network-denied runtime | PENDING | Cloud captions, analytics startup, crash startup and remote fonts are disabled; a controlled offline runtime test remains |
| Advanced word builds, karaoke, Brat treatment, multi-section editing | DEFERRED | They need reviewed word timing and an artist-specific cue inspector rather than guessed timing or a generic lookalike |

## Known product limits

The first slice is a local timed-transcript importer and three-clip reuse
workflow, not Flowstage parity. It currently creates one named section from
the imported cue span. To support multiple named sections inside one complete
song revision, we need the cue/timing inspector next. Editing a draft is native
and stays local to that draft; it does not silently propagate changes to other
drafts or rewrite the saved song timing.

The upstream automatic-update mechanism remains enabled, so you retain normal
manual update access and upstream security-update behavior. It was not changed
as part of the local editing profile. Embedded Codex is constrained to the
open workspace in source, but its approval behavior still needs a hands-on
review before treating it as a completed trust boundary.
