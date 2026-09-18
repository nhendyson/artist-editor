/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';

const LOCAL_AUDIO_EXTENSIONS = new Set(['.aac', '.aif', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav']);
const MIN_MODEL_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_SRT_BYTES = 5 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 15 * 60 * 1000;

export type LocalTranscriptionRequest = {
	inputPath: string;
	modelPath: string;
};

/**
 * Verifies the two user-selected files before the fixed local command sees
 * them. The app never builds a shell command or accepts an output location.
 */
export async function validateLocalTranscriptionFiles(
	request: LocalTranscriptionRequest,
	options: { minModelBytes?: number } = {},
): Promise<void> {
	const input = request.inputPath;
	const model = request.modelPath;
	if (!isAbsolute(input) || !isAbsolute(model)) throw new Error('Local transcription requires files on this Mac.');
	if (!LOCAL_AUDIO_EXTENSIONS.has(extname(input).toLowerCase())) {
		throw new Error('Local transcription accepts an imported audio file such as WAV, MP3, M4A, FLAC, or OGG.');
	}
	if (extname(model).toLowerCase() !== '.bin') throw new Error('Choose a local Whisper .bin model file.');

	const [audio, whisperModel] = await Promise.all([stat(input), stat(model)]);
	if (!audio.isFile() || audio.size === 0) throw new Error('The selected audio file is unavailable.');
	if (audio.size > MAX_AUDIO_BYTES) throw new Error('The audio file is too large for one local transcription run.');
	if (!whisperModel.isFile() || whisperModel.size < (options.minModelBytes ?? MIN_MODEL_BYTES)) {
		throw new Error('The selected Whisper model is incomplete or unavailable.');
	}
}

/** Runs only the installed Whisper CLI and FFmpeg with fixed arguments. */
export async function transcribeLocalAudio(request: LocalTranscriptionRequest): Promise<string> {
	await validateLocalTranscriptionFiles(request);
	const directory = await mkdtemp(join(tmpdir(), 'artist-editor-whisper-'));
	const wavPath = join(directory, 'audio.wav');
	const outputStem = join(directory, 'transcript');

	try {
		// whisper.cpp's own docs recommend a 16 kHz mono 16-bit WAV input.
		// FFmpeg writes this transient working copy, never altering the original.
		await runFixedCommand('ffmpeg', [
			'-hide_banner', '-loglevel', 'error', '-y', '-i', request.inputPath,
			'-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath,
		], 'Could not prepare audio for local transcription');
		await runFixedCommand(process.env.ARTIST_EDITOR_WHISPER_CLI || 'whisper-cli', [
			'--model', request.modelPath,
			'--language', 'en',
			'--output-srt',
			'--output-file', outputStem,
			'--no-prints',
			'--file', wavPath,
		], 'Local Whisper transcription failed');

		const srt = await readFile(`${outputStem}.srt`);
		if (!srt.byteLength) throw new Error('Local Whisper did not produce any timed lyrics.');
		if (srt.byteLength > MAX_SRT_BYTES) throw new Error('Local Whisper produced an unexpectedly large transcript.');
		return srt.toString('utf8');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function runFixedCommand(command: string, args: readonly string[], failure: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let stderr = '';
		let timedOut = false;
		let started = false;
		const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
		}, TRANSCRIPTION_TIMEOUT_MS);
		child.once('spawn', () => { started = true; });
		child.stderr.on('data', (chunk: Buffer) => {
			if (stderr.length < 4000) stderr += chunk.toString('utf8').slice(0, 4000 - stderr.length);
		});
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(new Error(`${failure}: ${error.message}`));
		});
		child.once('close', (code) => {
			clearTimeout(timeout);
			if (timedOut) {
				reject(new Error('Local transcription took longer than 15 minutes and was stopped.'));
				return;
			}
			if (!started || code !== 0) {
				reject(new Error(`${failure}${stderr ? `: ${stderr.trim()}` : ''}`));
				return;
			}
			resolve();
		});
	});
}
