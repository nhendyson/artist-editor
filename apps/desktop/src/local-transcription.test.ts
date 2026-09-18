/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateLocalTranscriptionFiles } from './local-transcription';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'local-transcription-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('validateLocalTranscriptionFiles', () => {
	it('allows a local WAV and a local Whisper model', async () => {
		const audio = join(root, 'verse.wav');
		const model = join(root, 'ggml-base.en.bin');
		await Promise.all([writeFile(audio, 'audio'), writeFile(model, 'model')]);
		await expect(validateLocalTranscriptionFiles({ inputPath: audio, modelPath: model }, { minModelBytes: 1 })).resolves.toBeUndefined();
	});

	it('blocks a non-audio input before it can reach FFmpeg or Whisper', async () => {
		const input = join(root, 'not-a-song.txt');
		const model = join(root, 'ggml-base.en.bin');
		await Promise.all([writeFile(input, 'text'), writeFile(model, 'model')]);
		await expect(validateLocalTranscriptionFiles({ inputPath: input, modelPath: model }, { minModelBytes: 1 })).rejects.toThrow('imported audio file');
	});
});
