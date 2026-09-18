/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetName, createSongTimingFromTranscript, derivePeaks, isSongTiming, sha256Blob } from '@diffusionstudio/assets';
import { parseSubtitles } from '@diffusionstudio/runtime';
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
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
				<DialogContent class="sm:max-w-5xl" showCloseButton={!saving()}>
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
								<LyricTimingSurface audio={audio()} lines={reviewedTranscript()} onChange={(lines) => { setReviewedTranscript(lines); setReviewed(false); }} />
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

type LyricTimingSurfaceProps = {
	audio: AudioAsset | undefined;
	lines: Transcript;
	onChange(lines: Transcript): void;
};

/**
 * A local timing surface, deliberately separate from the document timeline:
 * it edits a working transcript before that transcript becomes a reusable
 * song revision. The waveform comes from the library cache already used by
 * Diffusion's timeline, and all caption edits stay in memory until Save timing.
 */
function LyricTimingSurface(props: LyricTimingSurfaceProps) {
	const library = useLibrary();
	const [zoom, setZoom] = createSignal(72);
	const [currentTime, setCurrentTime] = createSignal(0);
	const [playing, setPlaying] = createSignal(false);
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	const [measuredDuration, setMeasuredDuration] = createSignal(0);
	let audioElement: HTMLAudioElement | undefined;
	let scrollSurface: HTMLDivElement | undefined;
	let previousUrl: string | undefined;

	const duration = createMemo(() => Math.max(
		props.audio?.duration ?? 0,
		measuredDuration(),
		...props.lines.map((line) => line.end ?? 0),
		0.01,
	));
	const width = createMemo(() => Math.max(760, Math.ceil(duration() * zoom())));
	const [peaks] = createResource(
		() => props.audio?.id ?? null,
		async () => {
			const audio = props.audio;
			const lib = library();
			if (!audio || !lib) return null;
			return (await lib.cache.peaks(audio)) ?? derivePeaks(await lib.file(audio));
		},
	);
	const [audioUrl] = createResource(
		() => props.audio?.id ?? null,
		async () => {
			if (previousUrl) {
				URL.revokeObjectURL(previousUrl);
				previousUrl = undefined;
			}
			const audio = props.audio;
			const lib = library();
			if (!audio || !lib) return undefined;
			previousUrl = URL.createObjectURL(await lib.file(audio));
			return previousUrl;
		},
	);
	const tickStep = createMemo(() => duration() > 90 ? 10 : duration() > 45 ? 5 : 2);
	const ticks = createMemo(() => {
		const values: number[] = [];
		for (let time = 0; time <= duration(); time += tickStep()) values.push(time);
		return values;
	});
	const selectedLine = createMemo(() => props.lines[selectedIndex()]);

	createEffect(() => {
		if (selectedIndex() >= props.lines.length) setSelectedIndex(Math.max(0, props.lines.length - 1));
	});

	onCleanup(() => {
		if (previousUrl) URL.revokeObjectURL(previousUrl);
	});

	const timeAt = (clientX: number) => {
		if (!scrollSurface) return 0;
		const rect = scrollSurface.getBoundingClientRect();
		return clamp((clientX - rect.left + scrollSurface.scrollLeft) / zoom(), 0, duration());
	};
	const seek = (time: number) => {
		const next = clamp(time, 0, duration());
		setCurrentTime(next);
		if (audioElement) audioElement.currentTime = next;
	};
	const togglePlayback = () => {
		if (!audioElement) return;
		if (audioElement.paused) void audioElement.play().catch(() => toast.error('Could not play the local master audio.'));
		else audioElement.pause();
	};
	const updateSelected = (change: Partial<Transcript[number]>) => {
		const index = selectedIndex();
		props.onChange(props.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...change } : line));
	};
	const startDrag = (event: PointerEvent, index: number, edge: 'move' | 'start' | 'end') => {
		const line = props.lines[index];
		if (!line) return;
		event.preventDefault();
		event.stopPropagation();
		setSelectedIndex(index);
		const initialPointer = timeAt(event.clientX);
		const initialStart = line.start ?? 0;
		const initialEnd = line.end ?? initialStart + 0.1;
		const lineDuration = Math.max(0.05, initialEnd - initialStart);
		const previousEnd = props.lines[index - 1]?.end ?? 0;
		const nextStart = props.lines[index + 1]?.start ?? duration();
		const move = (pointer: PointerEvent) => {
			const delta = timeAt(pointer.clientX) - initialPointer;
			let start = initialStart;
			let end = initialEnd;
			if (edge === 'start') start = clamp(initialStart + delta, previousEnd, initialEnd - 0.05);
			if (edge === 'end') end = clamp(initialEnd + delta, initialStart + 0.05, nextStart);
			if (edge === 'move') {
				start = clamp(initialStart + delta, previousEnd, nextStart - lineDuration);
				end = start + lineDuration;
			}
			props.onChange(props.lines.map((item, itemIndex) => itemIndex === index ? { ...item, start, end } : item));
		};
		const finish = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', finish);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', finish);
	};

	return <div class="grid gap-2 rounded-md border border-border bg-background p-3">
		<Show when={audioUrl()}>{(url) => (<audio
			ref={(element) => { audioElement = element; }}
			class="hidden"
			src={url()}
			preload="metadata"
			onLoadedMetadata={(event) => setMeasuredDuration(event.currentTarget.duration)}
			onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
			onPlay={() => setPlaying(true)}
			onPause={() => setPlaying(false)}
			onEnded={() => setPlaying(false)}
		/>)}</Show>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<Button size="small" variant="secondary" disabled={!audioUrl()} onClick={togglePlayback}>{playing() ? 'Pause' : 'Play'}</Button>
				<span class="font-mono text-xxs text-muted-foreground">{formatClock(currentTime())} / {formatClock(duration())}</span>
			</div>
			<label class="flex items-center gap-2 text-xxs text-muted-foreground">
				Zoom
				<input type="range" min="32" max="180" value={zoom()} onInput={(event) => setZoom(Number(event.currentTarget.value))} />
			</label>
		</div>
		<p class="text-xxs text-muted-foreground">Click the waveform to seek. Drag a caption block to move it; drag either narrow edge to set exactly when it appears and clears.</p>
		<div ref={scrollSurface} class="overflow-x-auto rounded border border-border bg-black/30">
			<div class="relative h-44 select-none" style={{ width: `${width()}px` }} onPointerDown={(event) => seek(timeAt(event.clientX))}>
				<div class="absolute inset-x-0 top-0 h-7 border-b border-border">
					<For each={ticks()}>{(time) => <div class="absolute top-0 h-full border-l border-border/70 pl-1 text-xxs text-muted-foreground" style={{ left: `${time * zoom()}px` }}>{formatClock(time)}</div>}</For>
				</div>
				<div class="absolute inset-x-0 top-7 h-14 border-b border-border/70">
					<div class="absolute inset-1 flex items-center gap-px overflow-hidden opacity-75">
						<Show when={peaks()}>{(samples) => <For each={Array.from(samples()!)}>{(peak) => <div class="flex-1 rounded-sm bg-audio-primary" style={{ height: `${Math.max(5, (peak / 255) * 95)}%` }} />}</For>}</Show>
					</div>
				</div>
				<div class="absolute inset-x-0 top-[5.25rem] bottom-0 bg-accent/10">
					<For each={props.lines}>{(line, index) => {
						const start = () => line.start ?? 0;
						const end = () => line.end ?? start() + 0.05;
						const selected = () => selectedIndex() === index();
						return <div
							class="absolute top-4 h-12 cursor-grab overflow-hidden rounded border bg-primary/30 text-xs text-foreground active:cursor-grabbing"
							classList={{ 'border-primary ring-1 ring-primary': selected(), 'border-border-strong': !selected() }}
							style={{ left: `${start() * zoom()}px`, width: `${Math.max(16, (end() - start()) * zoom())}px` }}
							onPointerDown={(event) => startDrag(event, index(), 'move')}
						>
							<div class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-primary/60" onPointerDown={(event) => startDrag(event, index(), 'start')} />
							<span class="block truncate px-2 py-2 text-center">{line.text}</span>
							<div class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-primary/60" onPointerDown={(event) => startDrag(event, index(), 'end')} />
						</div>;
					}}</For>
				</div>
				<div class="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-white" style={{ left: `${currentTime() * zoom()}px` }} />
			</div>
		</div>
		<Show when={selectedLine()}>{(line) => <div class="grid grid-cols-[5rem_5rem_minmax(0,1fr)] gap-2 rounded bg-accent/30 p-2">
			<label class="grid gap-1 text-xxs text-muted-foreground">Start<input class="h-7 rounded border border-border-input bg-input px-1.5 text-xs text-foreground" type="number" min="0" step="0.01" value={formatSeconds(line().start ?? 0)} onInput={(event) => updateSelected({ start: parseSeconds(event.currentTarget.value, line().start ?? 0) })} /></label>
			<label class="grid gap-1 text-xxs text-muted-foreground">End<input class="h-7 rounded border border-border-input bg-input px-1.5 text-xs text-foreground" type="number" min="0" step="0.01" value={formatSeconds(line().end ?? 0)} onInput={(event) => updateSelected({ end: parseSeconds(event.currentTarget.value, line().end ?? 0) })} /></label>
			<label class="grid min-w-0 gap-1 text-xxs text-muted-foreground">Selected lyric<input class="h-7 min-w-0 rounded border border-border-input bg-input px-1.5 text-xs text-foreground" value={line().text} onInput={(event) => updateSelected({ text: event.currentTarget.value })} /></label>
		</div>}</Show>
	</div>;
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function formatClock(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
