/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { validateSongTiming } from './song-timing';

import type { ProjectFS } from './fs';
import type { SongTiming } from './song-timing';

/** Project-local, portable timing revisions. Media bytes remain in the library. */
const TIMING_DIRECTORY = 'artist-editor/timings';

type TimingFS = Pick<ProjectFS, 'file' | 'write'>;

function safeId(id: string): string {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
		throw new Error('Timing revision id must contain only letters, numbers, dots, underscores, and dashes');
	}
	return id;
}

/** The project-relative path for one timing revision. */
export function songTimingPath(id: string): string {
	return `${TIMING_DIRECTORY}/${safeId(id)}.json`;
}

/**
 * Saves a validated timing revision inside the project. This is deliberately
 * separate from the source JSX document, so the exact lyric timing can be
 * reused across drafts without copying caption layers.
 */
export async function saveSongTiming(fs: TimingFS, timing: SongTiming): Promise<string> {
	validateSongTiming(timing);
	const path = songTimingPath(timing.id);
	const text = `${JSON.stringify(timing, null, 2)}\n`;
	await fs.write(path, new Blob([text], { type: 'application/json' }));
	return path;
}

/** Reads and validates one timing revision, failing closed on malformed data. */
export async function loadSongTiming(fs: TimingFS, id: string): Promise<SongTiming> {
	const file = await fs.file(songTimingPath(id));
	const parsed: unknown = JSON.parse(await file.text());
	return validateSongTiming(parsed as SongTiming);
}
