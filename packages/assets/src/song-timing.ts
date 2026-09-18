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
	const items = options.sectionId ? timingForSection(timing, options.sectionId) : timing.items.map((item) => ({
		...item,
		sourceRange: { ...displayRangeOf(item) },
		sectionRange: { ...displayRangeOf(item) },
	}));

	return items.flatMap((item) => {
		if ('kind' in item || !item.text) return [];
		const display = item.sectionRange;
		const words = transcriptWords(item, display, sampleRate);
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

function transcriptWords(item: LyricCue, display: SampleRange, sampleRate: number): TranscriptWord[] {
	const text = item.words?.map((word) => word.text) ?? item.text.split(/\s+/).filter(Boolean);
	if (!text.length) return [];

	const lengths = text.map((word) => word.length);
	const total = lengths.reduce((sum, length) => sum + length, 0);
	let elapsed = 0;
	return text.map((word, index) => {
		const start = display.startSample + (elapsed / total) * (display.endSample - display.startSample);
		elapsed += lengths[index]!;
		return {
			text: word,
			start: start / sampleRate,
			end: (display.startSample + (elapsed / total) * (display.endSample - display.startSample)) / sampleRate,
		};
	});
}
