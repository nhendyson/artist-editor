import { describe, expect, it } from 'vitest';

import { createSongTimingFromTranscript, songTimingToTranscript, timingForSection, validateSongTiming, type SongTiming } from '../src/song-timing';
import { loadSongTiming, saveSongTiming, songTimingPath } from '../src/song-timing-store';

const timing = (): SongTiming => ({
	schemaVersion: 1,
	id: 'timing-v1',
	recording: {
		id: 'recording-v1',
		sha256: 'a'.repeat(64),
		sampleRate: 48_000,
		durationSamples: 480_000,
		mediaPath: '/media/punching-the-air.wav',
	},
	approved: false,
	items: [
		{ id: 'line-1', text: 'im punching the air', vocal: { startSample: 48_000, endSample: 96_000 }, display: { startSample: 48_000, endSample: 144_000 } },
		{ id: 'breath', kind: 'blank', startSample: 144_000, endSample: 168_000 },
		{ id: 'line-2', text: '', unknown: true, vocal: { startSample: 168_000, endSample: 216_000 }, display: { startSample: 168_000, endSample: 240_000 } },
	],
	sections: [{ id: 'verse-1', label: 'Verse 1', startSample: 72_000, endSample: 240_000, boundaryPolicy: 'include-active-line' }],
});

describe('song timing', () => {
	it('keeps source identity, a gap, and an unknown lyric intact in a section', () => {
		const section = timingForSection(timing(), 'verse-1');
		expect(section.map((item) => item.id)).toEqual(['line-1', 'breath', 'line-2']);
		expect(section[0]?.sourceRange).toEqual({ startSample: 48_000, endSample: 144_000 });
		expect(section[0]?.sectionRange.startSample).toBe(72_000);
	});

	it('does not permit overlapping items or unlabelled blank lyrics', () => {
		const overlap = timing();
		overlap.items[1] = { id: 'breath', kind: 'blank', startSample: 120_000, endSample: 168_000 };
		expect(() => validateSongTiming(overlap)).toThrow('cannot overlap');

		const blank = timing();
		(blank.items[2] as { unknown?: boolean }).unknown = false;
		expect(() => validateSongTiming(blank)).toThrow('must be marked unknown');
	});

	it('stores a portable revision inside the project and reads it back validated', async () => {
		const writes = new Map<string, Blob>();
		const fs = {
			write: async (path: string, data: Blob) => { writes.set(path, data); },
			file: async (path: string) => {
				const data = writes.get(path);
				if (!data) throw new Error(`Missing ${path}`);
				return { text: () => data.text() } as File;
			},
		};

		const value = timing();
		expect(await saveSongTiming(fs, value)).toBe('artist-editor/timings/timing-v1.json');
		expect(await loadSongTiming(fs, 'timing-v1')).toEqual(value);
		expect(() => songTimingPath('../outside-project')).toThrow('only letters');
	});

	it('converts display timing into native lyric transcript boundaries', () => {
		const transcript = songTimingToTranscript(timing());
		expect(transcript).toHaveLength(1);
		expect(transcript[0]).toMatchObject({
			text: 'im punching the air',
			start: 1,
			end: 3,
		});
		expect(transcript[0]?.words.at(-1)?.end).toBe(3);
	});

	it('rebases a selected section so it starts at zero in a new draft', () => {
		const transcript = songTimingToTranscript(timing(), { sectionId: 'verse-1' });
		expect(transcript[0]).toMatchObject({ start: 0, end: 1.5 });
	});

	it('makes a review-gated reusable timing revision from local subtitle cues', () => {
		const imported = createSongTimingFromTranscript({
			id: 'imported-v1',
			recording: timing().recording,
			sectionLabel: 'Verse 1',
			approved: true,
			transcript: [{
				text: 'hold this line',
				start: 1,
				end: 3,
				words: [
					{ text: 'hold', start: 1, end: 1.5 },
					{ text: 'this', start: 1.5, end: 2 },
					{ text: 'line', start: 2, end: 3 },
				],
			}],
		});
		expect(imported.approved).toBe(true);
		expect(imported.sections[0]?.label).toBe('Verse 1');
		expect(songTimingToTranscript(imported)[0]).toMatchObject({ text: 'hold this line', start: 1, end: 3 });
	});
});
