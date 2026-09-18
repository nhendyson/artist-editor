/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The portable, recording-specific timing format used by Artist Editor. */
export const SONG_TIMING_SCHEMA_VERSION = 1;

import type { Transcript, TranscriptWord } from './types';

export type SampleRange = { startSample: number; endSample: number };

export type TimedWord = SampleRange & {
	id: string;
	text: string;
	/** Where its timing came from; machine suggestions must be reviewed. */
	provenance: 'manual' | 'aligned' | 'imported';
	approved: boolean;
};

export type LyricCue = {
	id: string;
	/** Blank text may only represent an explicitly unknown lyric. */
	text: string;
	unknown?: boolean;
	vocal: SampleRange;
	display: SampleRange;
	words?: TimedWord[];
};

export type IntentionalBlank = SampleRange & {
	id: string;
	kind: 'blank';
};

export type TimingItem = LyricCue | IntentionalBlank;

export type SongSection = SampleRange & {
	id: string;
	label: string;
	/** What to do if a section begins while a lyric is being held onscreen. */
	boundaryPolicy: 'include-active-line' | 'start-at-next-line';
};

export type RecordingIdentity = {
	id: string;
	sha256: string;
	sampleRate: number;
	durationSamples: number;
	mediaPath: string;
};

export type SongTiming = {
	schemaVersion: typeof SONG_TIMING_SCHEMA_VERSION;
	id: string;
	parentId?: string;
	recording: RecordingIdentity;
	approved: boolean;
	items: TimingItem[];
	sections: SongSection[];
};

export type CreateSongTimingFromTranscriptInput = {
	id: string;
	recording: RecordingIdentity;
	transcript: Transcript;
	sectionLabel: string;
	/** A user must explicitly confirm that imported timing was reviewed. */
	approved: boolean;
};

export type SectionTimingItem = TimingItem & {
	/** Original display range in the recording. */
	sourceRange: SampleRange;
	/** Portion visible inside the selected section. */
	sectionRange: SampleRange;
};

type TimingTranscriptOptions = { sectionId?: string };

const hasRange = (value: unknown): value is SampleRange => {
	if (!value || typeof value !== 'object') return false;
	const range = value as Partial<SampleRange>;
	const startSample = range.startSample;
	const endSample = range.endSample;
	return typeof startSample === 'number' && typeof endSample === 'number' && Number.isSafeInteger(startSample) && Number.isSafeInteger(endSample) && startSample >= 0 && endSample > startSample;
};

function assertRange(range: SampleRange, durationSamples: number, label: string): void {
	if (!hasRange(range) || range.endSample > durationSamples) throw new Error(`${label} must be a non-empty range inside the recording`);
}

function assertId(value: string, label: string): void {
	if (!value.trim()) throw new Error(`${label} must have an id`);
}

const displayRangeOf = (item: TimingItem): SampleRange => 'kind' in item ? item : item.display;

/** Rejects malformed or ambiguous timing before it can reach a caption renderer. */
export function validateSongTiming(timing: SongTiming): SongTiming {
	if (timing.schemaVersion !== SONG_TIMING_SCHEMA_VERSION) throw new Error(`Unsupported song timing schema: ${timing.schemaVersion}`);
	assertId(timing.id, 'Timing revision');
	assertId(timing.recording.id, 'Recording');
	if (!/^[a-f0-9]{64}$/i.test(timing.recording.sha256)) throw new Error('Recording must have a SHA-256 identity');
	if (!Number.isSafeInteger(timing.recording.sampleRate) || timing.recording.sampleRate <= 0) throw new Error('Recording must have a sample rate');
	if (!Number.isSafeInteger(timing.recording.durationSamples) || timing.recording.durationSamples <= 0) throw new Error('Recording must have a duration in samples');
	if (!timing.recording.mediaPath) throw new Error('Recording must have a media path');

	const ids = new Set<string>();
	let previousEnd = 0;
	for (const item of timing.items) {
		assertId(item.id, 'Timing item');
		if (ids.has(item.id)) throw new Error(`Duplicate timing item id: ${item.id}`);
		ids.add(item.id);
		const range = displayRangeOf(item);
		assertRange(range, timing.recording.durationSamples, `Timing item ${item.id}`);
		if (range.startSample < previousEnd) throw new Error('Timing items cannot overlap');
		previousEnd = range.endSample;

		if ('kind' in item) continue;
		assertRange(item.vocal, timing.recording.durationSamples, `Lyric ${item.id} vocal timing`);
		assertRange(item.display, timing.recording.durationSamples, `Lyric ${item.id} display timing`);
		if (!item.text && !item.unknown) throw new Error(`Blank lyric ${item.id} must be marked unknown`);
		if (item.words?.length) {
			let previousWordEnd = item.vocal.startSample;
			for (const word of item.words) {
				assertId(word.id, 'Word');
				if (!word.text) throw new Error(`Word ${word.id} cannot be blank`);
				assertRange(word, timing.recording.durationSamples, `Word ${word.id}`);
				if (word.startSample < item.vocal.startSample || word.endSample > item.vocal.endSample || word.startSample < previousWordEnd) {
					throw new Error(`Word ${word.id} must be ordered inside lyric ${item.id}`);
				}
				previousWordEnd = word.endSample;
			}
		}
	}

	const sectionIds = new Set<string>();
	for (const section of timing.sections) {
		assertId(section.id, 'Section');
		if (sectionIds.has(section.id)) throw new Error(`Duplicate section id: ${section.id}`);
		sectionIds.add(section.id);
		if (!section.label.trim()) throw new Error(`Section ${section.id} must have a label`);
		assertRange(section, timing.recording.durationSamples, `Section ${section.id}`);
	}

	return timing;
}

/**
 * Returns the portion of approved timing visible in a section. The original
 * source ranges remain attached so a draft can be mapped back without drift.
 */
export function timingForSection(timing: SongTiming, sectionId: string): SectionTimingItem[] {
	validateSongTiming(timing);
	const section = timing.sections.find((candidate) => candidate.id === sectionId);
	if (!section) throw new Error(`Unknown section: ${sectionId}`);

	return timing.items
		.filter((item) => {
			const range = displayRangeOf(item);
			return range.endSample > section.startSample && range.startSample < section.endSample;
		})
		.filter((item) => {
			if ('kind' in item || section.boundaryPolicy === 'include-active-line') return true;
			return item.display.startSample >= section.startSample;
		})
		.map((item) => ({
			...item,
			sourceRange: { ...displayRangeOf(item) },
			sectionRange: {
				startSample: Math.max(displayRangeOf(item).startSample, section.startSample),
				endSample: Math.min(displayRangeOf(item).endSample, section.endSample),
			},
		}));
}

/**
 * Converts one revision (or one named section) into Diffusion's native
 * transcript shape. The segment range is the lyric's display range, so
 * Artist Lines holds it through the intended gap until the next line.
 */
export function songTimingToTranscript(timing: SongTiming, options: TimingTranscriptOptions = {}): Transcript {
	validateSongTiming(timing);
	const sampleRate = timing.recording.sampleRate;
	const sectionOffset = options.sectionId
		? timing.sections.find((section) => section.id === options.sectionId)?.startSample
		: undefined;
	if (options.sectionId && sectionOffset === undefined) throw new Error(`Unknown section: ${options.sectionId}`);
	const items = options.sectionId ? timingForSection(timing, options.sectionId) : timing.items.map((item) => ({
		...item,
		sourceRange: { ...displayRangeOf(item) },
		sectionRange: { ...displayRangeOf(item) },
	}));

	return items.flatMap((item) => {
		if ('kind' in item || !item.text) return [];
		const sourceRange = item.sectionRange;
		const display = {
			startSample: sourceRange.startSample - (sectionOffset ?? 0),
			endSample: sourceRange.endSample - (sectionOffset ?? 0),
		};
		const words = transcriptWords(item, sampleRate, sectionOffset ?? 0);
		return [{
			text: item.text,
			words,
			start: display.startSample / sampleRate,
			end: display.endSample / sampleRate,
		}];
	});
}

/** Whether parsed JSON is the timing envelope rather than an ordinary transcript array. */
export function isSongTiming(value: unknown): value is SongTiming {
	return !!value && typeof value === 'object' && !Array.isArray(value)
		&& (value as { schemaVersion?: unknown }).schemaVersion === SONG_TIMING_SCHEMA_VERSION
		&& Array.isArray((value as { items?: unknown }).items)
		&& !!(value as { recording?: unknown }).recording;
}

/**
 * Turns a local, timed subtitle/transcript into a reviewable timing revision.
 * Cue boundaries remain display boundaries so lyric lines persist through the
 * intended gap rather than becoming word-by-word captions.
 */
export function createSongTimingFromTranscript(input: CreateSongTimingFromTranscriptInput): SongTiming {
	const { recording, transcript } = input;
	const toSamples = (seconds: number) => Math.round(seconds * recording.sampleRate);
	const items: LyricCue[] = transcript.map((segment, index) => {
		const first = segment.words[0];
		const last = segment.words.at(-1);
		const start = segment.start ?? first?.start;
		const end = segment.end ?? last?.end;
		if (!segment.text.trim() || start === undefined || end === undefined || end <= start) {
			throw new Error(`Transcript line ${index + 1} needs non-empty text and a visible time range.`);
		}
		return {
			id: `line-${index + 1}`,
			text: segment.text.trim(),
			vocal: { startSample: toSamples(start), endSample: toSamples(end) },
			display: { startSample: toSamples(start), endSample: toSamples(end) },
			words: segment.words.length ? segment.words.map((word, wordIndex) => ({
				id: `line-${index + 1}-word-${wordIndex + 1}`,
				text: word.text,
				startSample: toSamples(word.start),
				endSample: toSamples(word.end),
				provenance: 'imported' as const,
				approved: input.approved,
			})) : undefined,
		};
	});
	const first = items[0]?.display.startSample;
	const last = items.at(-1)?.display.endSample;
	if (first === undefined || last === undefined) throw new Error('The local transcript has no visible lyric lines.');
	return validateSongTiming({
		schemaVersion: SONG_TIMING_SCHEMA_VERSION,
		id: input.id,
		recording,
		approved: input.approved,
		items,
		sections: [{
			id: 'full-track',
			label: input.sectionLabel.trim() || 'Full track',
			// A verse-only subtitle file becomes a verse-only reusable section.
			// That means its master audio starts where the first lyric starts and
			// does not silently turn into an entire-song draft.
			startSample: first,
			endSample: last,
			boundaryPolicy: 'include-active-line',
		}],
	});
}

function transcriptWords(item: LyricCue, sampleRate: number, sectionOffset: number): TranscriptWord[] {
	// Line timing is useful on its own. Do not fabricate word timings from text
	// length: single-word, karaoke, and build effects must wait for reviewed or
	// explicitly imported word spans.
	return (item.words ?? []).map((word) => ({
		text: word.text,
		start: (word.startSample - sectionOffset) / sampleRate,
		end: (word.endSample - sectionOffset) / sampleRate,
	}));
}
