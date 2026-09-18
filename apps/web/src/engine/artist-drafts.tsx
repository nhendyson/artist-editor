/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The first reusable lyric workflow: one approved, recording-specific timing
 * revision becomes native caption layers in three ordinary Diffusion scenes.
 * Nothing is rendered or sent elsewhere here. The user can keep editing every
 * scene, including its crop and captions, after it is made.
 */

import { assetName, songTimingToTranscript, validateSongTiming } from '@diffusionstudio/assets';
import { Audio, Captions, Video } from '@diffusionstudio/reconciler';
import { Root, Source } from '@diffusionstudio/runtime';

import { createScene } from './new-scene';
import { getDocumentEditor } from './editor';

import type { AssetLibrary, AudioAsset, SongTiming, TranscriptAsset, VideoAsset } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';

export const ARTIST_DRAFT_FORMAT = { width: 1080, height: 1920 } as const;
const ARTIST_DRAFT_GAP = 180;

export type CreateArtistDraftsInput = {
	library: AssetLibrary;
	timing: SongTiming;
	sectionId: string;
	audio: AudioAsset;
	footage: readonly [VideoAsset, VideoAsset, VideoAsset];
};

/**
 * Builds three editable scenes from a selected section. The source camera
 * tracks are muted on purpose: the song recording stays the one audio source.
 */
export async function createArtistDrafts(
	world: World,
	input: CreateArtistDraftsInput,
): Promise<Entity[]> {
	if (!world.get(Root)?.get(Source)?.value) {
		throw new Error('Open a saved project before creating artist drafts.');
	}
	const timing = validateSongTiming(input.timing);
	const section = timing.sections.find((candidate) => candidate.id === input.sectionId);
	if (!section) throw new Error('Choose a section from the saved song timing.');
	if (!timing.approved) throw new Error('Approve the song timing before creating artist drafts.');
	if (input.audio.source !== timing.recording.mediaPath) {
		throw new Error('The selected master audio does not match this song timing revision.');
	}

	const transcript = songTimingToTranscript(timing, { sectionId: section.id });
	if (!transcript.length) throw new Error('The selected section has no visible lyric lines.');

	// One project-local transcript asset is shared by every draft. It is a
	// compact, editable derivative of the approved master timing—not another
	// audio file and not a cloud transcription request.
	const captions = await input.library.store(
		new Blob([JSON.stringify(transcript, null, 2)], { type: 'application/json' }),
		{
			name: `${safeName(section.label)}-artist-lines.json`,
			folder: 'artist-editor/timing-sections',
		},
	) as TranscriptAsset;

	const scenes: Entity[] = [];
	const editor = getDocumentEditor(world);
	for (const [index, footage] of input.footage.entries()) {
		const scene = createScene(world, ARTIST_DRAFT_FORMAT, {
			name: `Artist draft ${index + 1}: ${assetName(footage)}`,
			position: {
				x: index * (ARTIST_DRAFT_FORMAT.width + ARTIST_DRAFT_GAP) - (ARTIST_DRAFT_FORMAT.width * 3 + ARTIST_DRAFT_GAP * 2) / 2,
				y: -ARTIST_DRAFT_FORMAT.height / 2,
			},
			focus: () => {},
		});
		if (!scene) throw new Error('Could not create an artist draft scene.');

		const [video] = editor.insertElement(scene, () => (
			<Video
				name={assetName(footage)}
				src={footage.path}
				x={0}
				y={0}
				width={ARTIST_DRAFT_FORMAT.width}
				height={ARTIST_DRAFT_FORMAT.height}
				objectFit="cover"
				muted
			/>
		));
		const [masterAudio] = editor.insertElement(scene, () => (
			<Audio
				name={`Master audio: ${assetName(input.audio)}`}
				src={input.audio.path}
				sourceIn={section.startSample / timing.recording.sampleRate}
				sourceOut={section.endSample / timing.recording.sampleRate}
			/>
		));
		const [caption] = editor.insertElement(scene, () => (
			<Captions
				name={`${section.label} lyrics`}
				src={captions.path}
				preset="artist"
			/>
		));
		if (!video || !masterAudio || !caption) throw new Error('Could not add the video, master audio, and captions to a new draft.');
		scenes.push(scene);
	}

	editor.activate(scenes[0]);
	editor.select(scenes[0]);
	return scenes;
}

function safeName(value: string): string {
	return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'lyrics';
}
