/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetName, createSongTimingFromTranscript, isSongTiming, sha256Blob } from '@diffusionstudio/assets';
import { parseSubtitles } from '@diffusionstudio/runtime';
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { toast } from 'somoto';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/components/ui/dialog';
import { useLibrary } from '@/engine/library';

import type { AudioAsset, Transcript, TranscriptAsset } from '@diffusionstudio/assets';

/** Creates an approved, portable timing revision from an already local timed transcript. */
export function ArtistTimingDialog(props: { open: boolean; onOpenChange(open: boolean): void }) {
	const library = useLibrary();
	const [audioId, setAudioId] = createSignal('');
	const [transcriptId, setTranscriptId] = createSignal('');
	const [sectionLabel, setSectionLabel] = createSignal('Full track');
	const [reviewed, setReviewed] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [reviewedTranscript, setReviewedTranscript] = createSignal<Transcript>([]);

	const assets = createMemo(() => library()?.list() ?? []);
	const audioAssets = createMemo(() => assets().filter((asset): asset is AudioAsset => asset.type === 'AUDIO'));
	const transcriptAssets = createMemo(() => assets().filter((asset): asset is TranscriptAsset => asset.type === 'TRANSCRIPT'));
	const audio = createMemo(() => audioAssets().find((asset) => asset.id === audioId()));
	const transcript = createMemo(() => transcriptAssets().find((asset) => asset.id === transcriptId()));
	const [sourceTranscript] = createResource(transcript, async (asset) => {
		if (!asset || !library()) return [] as Transcript;
		const contents = await library()!.file(asset).then((file) => file.text());
		return parseLocalTranscript(contents, asset.mimeType);
	});

	createEffect(() => {
		if (!props.open) return;
		if (!audioId() && audioAssets()[0]) setAudioId(audioAssets()[0]!.id);
		if (!transcriptId() && transcriptAssets()[0]) setTranscriptId(transcriptAssets()[0]!.id);
	});

	// This is a working copy. Saving records it in the portable timing revision;
	// the imported subtitle remains the untouched transcript artifact.
	createEffect(() => {
		const lines = sourceTranscript();
		if (!props.open || !lines) return;
		setReviewedTranscript(lines.map((line) => ({
			...line,
			start: line.start ?? 0,
			end: line.end ?? 0,
			words: line.words.map((word) => ({ ...word })),
		})));
		setReviewed(false);
	});

	const updateLine = (index: number, change: Partial<Transcript[number]>) => {
		setReviewedTranscript((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...change, words: line.words } : line));
		setReviewed(false);
	};

	const holdLinesToNextStart = () => {
		setReviewedTranscript((lines) => lines.map((line, index) => {
			const next = lines[index + 1];
			return next ? { ...line, end: next.start ?? line.end ?? 0 } : line;
		}));
		setReviewed(false);
	};

	const hasInvalidLines = () => reviewedTranscript().some((line, index, lines) => {
		const start = line.start ?? Number.NaN;
		const end = line.end ?? Number.NaN;
		if (!line.text.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return true;
		const next = lines[index + 1];
		return !!next && (next.start ?? Number.NaN) < end;
	});

	const save = async () => {
		const lib = library();
		const master = audio();
		const source = transcript();
		if (!lib || !master || !source || !reviewed()) return;
		setSaving(true);
		try {
			const masterFile = await lib.file(master);
			const localTranscript = reviewedTranscript();
			if (!localTranscript.length || hasInvalidLines()) throw new Error('Fix each lyric line so it has text, a non-negative start, and an end after its start without overlapping the next line.');
			const revision = createSongTimingFromTranscript({
				id: `timing-${master.id}-${Date.now()}`,
				recording: {
					id: master.id,
					sha256: await sha256Blob(masterFile),
					sampleRate: master.sampleRate,
					durationSamples: Math.round(master.duration * master.sampleRate),
					mediaPath: master.source,
				},
				transcript: localTranscript,
				sectionLabel: sectionLabel(),
				approved: true,
			});
			await lib.store(new Blob([JSON.stringify(revision, null, 2)], { type: 'application/json' }), {
				name: `${safeName(sectionLabel())}-timing.json`,
				folder: 'artist-editor/timings',
			});
			props.onOpenChange(false);
			toast.success('Saved reusable song timing', { description: 'It is local to this project and ready for Artist drafts.' });
		} catch (error) {
			toast.error('Could not save song timing', { description: error instanceof Error ? error.message : String(error) });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogPortal>
				<DialogContent class="sm:max-w-xl" showCloseButton={!saving()}>
					<DialogHeader>
						<DialogTitle>Create reusable song timing</DialogTitle>
						<DialogDescription>Turn a local timed `.srt`, `.vtt`, or transcript JSON into one reviewable timing revision.</DialogDescription>
					</DialogHeader>
					<div class="grid gap-4 py-1">
						<TimingSelect label="Master song recording" value={audioId()} onInput={setAudioId} assets={audioAssets()} />
						<TimingSelect label="Local timed transcript" value={transcriptId()} onInput={setTranscriptId} assets={transcriptAssets()} />
						<Show when={sourceTranscript.loading}>
							<p class="text-xs text-muted-foreground">Loading local caption timing…</p>
						</Show>
						<Show when={sourceTranscript.error}>
							<p class="text-xs text-destructive">{sourceTranscript.error instanceof Error ? sourceTranscript.error.message : 'Could not read this local transcript.'}</p>
						</Show>
						<Show when={reviewedTranscript().length > 0}>
							<div class="grid gap-2">
								<div class="flex items-center justify-between gap-3">
									<div>
										<span class="text-xs font-450 text-foreground">Review lyric timing</span>
										<p class="mt-0.5 text-xxs text-muted-foreground">Starts and ends are seconds. A line is visible from its start up to, but not including, its end.</p>
									</div>
									<Button size="small" variant="secondary" onClick={holdLinesToNextStart}>Hold to next line</Button>
								</div>
								<div class="max-h-64 overflow-y-auto rounded-md border border-border">
									<For each={reviewedTranscript()}>{(line, index) => (
										<div class="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)] gap-2 border-b border-border p-2 last:border-b-0">
											<label class="grid gap-1 text-xxs text-muted-foreground">
												Start
												<input class="h-7 rounded border border-border-input bg-input px-1.5 text-xs text-foreground" type="number" min="0" step="0.01" value={formatSeconds(line.start ?? 0)} onInput={(event) => updateLine(index(), { start: parseSeconds(event.currentTarget.value, line.start ?? 0) })} />
											</label>
											<label class="grid gap-1 text-xxs text-muted-foreground">
												End
												<input class="h-7 rounded border border-border-input bg-input px-1.5 text-xs text-foreground" type="number" min="0" step="0.01" value={formatSeconds(line.end ?? 0)} onInput={(event) => updateLine(index(), { end: parseSeconds(event.currentTarget.value, line.end ?? 0) })} />
											</label>
											<label class="grid min-w-0 gap-1 text-xxs text-muted-foreground">
												Line {index() + 1}
												<input class="h-7 min-w-0 rounded border border-border-input bg-input px-1.5 text-xs text-foreground" value={line.text} onInput={(event) => updateLine(index(), { text: event.currentTarget.value })} />
											</label>
										</div>
									)}</For>
								</div>
								<Show when={hasInvalidLines()}><p class="text-xxs text-destructive">Each line needs text and a valid non-overlapping start/end range.</p></Show>
							</div>
						</Show>
						<label class="grid gap-2">
							<span class="text-xs font-450 text-foreground">Section label</span>
							<input class="h-8 rounded-md border border-border-input bg-input px-2 text-xs" value={sectionLabel()} onInput={(event) => setSectionLabel(event.currentTarget.value)} />
						</label>
						<label class="flex items-start gap-2 text-xs text-foreground">
							<input type="checkbox" checked={reviewed()} onChange={(event) => setReviewed(event.currentTarget.checked)} />
							<span>I reviewed the line boundaries and the exact master recording. Saving does not overwrite the imported subtitle.</span>
						</label>
					</div>
					<DialogFooter>
						<Button variant="secondary" onClick={() => props.onOpenChange(false)} disabled={saving()}>Cancel</Button>
						<Button onClick={() => void save()} disabled={saving() || !audio() || !transcript() || !reviewed() || !reviewedTranscript().length || hasInvalidLines()}>{saving() ? 'Saving…' : 'Save timing'}</Button>
					</DialogFooter>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}

function TimingSelect<T extends AudioAsset | TranscriptAsset>(props: { label: string; value: string; onInput(value: string): void; assets: readonly T[] }) {
	return <label class="grid gap-2">
		<span class="text-xs font-450 text-foreground">{props.label}</span>
		<select class="h-8 rounded-md border border-border-input bg-input px-2 text-xs" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)}>
			<option value="">Choose local file…</option>
			<For each={props.assets}>{(asset) => <option value={asset.id}>{assetName(asset)}</option>}</For>
		</select>
	</label>;
}

function parseLocalTranscript(contents: string, mimeType: string): Transcript {
	if (mimeType === 'application/x-subrip' || mimeType === 'text/vtt') {
		// SRT/VTT provides cue timing, not reviewed word timing. Keep the line
		// spans and leave words empty rather than turning character length into
		// a misleading lyric alignment.
		return parseSubtitles(contents).map(({ text, start, end }) => ({ text, start, end, words: [] }));
	}
	const parsed: unknown = JSON.parse(contents);
	if (isSongTiming(parsed)) throw new Error('This is already a song-timing revision. Use it directly in Artist drafts.');
	if (!Array.isArray(parsed)) throw new Error('Transcript JSON must be an array of timed lines.');
	return parsed as Transcript;
}

function safeName(value: string): string {
	return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'lyrics';
}

function formatSeconds(value: number): string {
	return value.toFixed(2);
}

function parseSeconds(value: string, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
