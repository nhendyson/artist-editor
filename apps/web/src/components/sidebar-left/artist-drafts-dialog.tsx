/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetName, isSongTiming } from '@diffusionstudio/assets';
import { useWorld } from '@diffusionstudio/koota-solid';
import { createEffect, createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
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
import { createArtistDrafts } from '@/engine/artist-drafts';
import { useLibrary } from '@/engine/library';

import type { AudioAsset, SongTiming, TranscriptAsset, VideoAsset } from '@diffusionstudio/assets';

type TimingSelection = { asset: TranscriptAsset; timing: SongTiming };

/** A deliberately small batch entry point for the first artist workflow. */
export function ArtistDraftsDialog(props: { open: boolean; onOpenChange(open: boolean): void }) {
	const world = useWorld();
	const library = useLibrary();
	const [timingId, setTimingId] = createSignal('');
	const [audioId, setAudioId] = createSignal('');
	const [footageIds, setFootageIds] = createSignal(['', '', '']);
	const [creating, setCreating] = createSignal(false);

	const assets = createMemo(() => library()?.list() ?? []);
	const timingAssets = createMemo(() => assets().filter((asset): asset is TranscriptAsset => asset.type === 'TRANSCRIPT'));
	const audioAssets = createMemo(() => assets().filter((asset): asset is AudioAsset => asset.type === 'AUDIO'));
	const videoAssets = createMemo(() => assets().filter((asset): asset is VideoAsset => asset.type === 'VIDEO'));
	const selectedTimingAsset = createMemo(() => timingAssets().find((asset) => asset.id === timingId()));
	const [timing] = createResource(selectedTimingAsset, async (asset): Promise<TimingSelection | undefined> => {
		if (!asset || !library()) return undefined;
		const parsed: unknown = JSON.parse(await library()!.file(asset).then((file) => file.text()));
		if (!isSongTiming(parsed)) throw new Error('This transcript is not a saved Artist Editor song-timing revision.');
		return { asset, timing: parsed };
	});
	const selectedAudio = createMemo(() => audioAssets().find((asset) => asset.id === audioId()));
	const selectedFootage = createMemo(() => footageIds().map((id) => videoAssets().find((asset) => asset.id === id)));
	const validFootage = createMemo(() => {
		const clips = selectedFootage();
		return clips.every((clip): clip is VideoAsset => !!clip) && new Set(clips.map((clip) => clip!.id)).size === 3;
	});
	const sections = () => timing()?.timing.sections ?? [];
	const [sectionId, setSectionId] = createSignal('');

	createEffect(() => {
		if (!props.open) return;
		if (!timingId() && timingAssets()[0]) setTimingId(timingAssets()[0]!.id);
		if (!audioId() && audioAssets()[0]) setAudioId(audioAssets()[0]!.id);
		if (footageIds().every((id) => !id) && videoAssets().length >= 3) {
			setFootageIds(videoAssets().slice(0, 3).map((asset) => asset.id));
		}
	});

	createEffect(() => {
		const first = sections()[0]?.id;
		if (first && !sections().some((section) => section.id === sectionId())) setSectionId(first);
	});

	const updateFootage = (index: number, value: string) => {
		setFootageIds((current) => current.map((id, currentIndex) => currentIndex === index ? value : id));
	};

	const create = async () => {
		const lib = library();
		const pickedTiming = timing();
		const audio = selectedAudio();
		const clips = selectedFootage();
		if (!lib || !pickedTiming || !audio || !validFootage() || !sectionId()) return;
		setCreating(true);
		try {
			await createArtistDrafts(world, {
				library: lib,
				timing: pickedTiming.timing,
				sectionId: sectionId(),
				audio,
				footage: clips as [VideoAsset, VideoAsset, VideoAsset],
			});
			props.onOpenChange(false);
			toast.success('Created 3 artist drafts', { description: 'Each draft has muted camera audio, one master-song track, and editable Artist Lines.' });
		} catch (error) {
			toast.error('Could not create artist drafts', { description: error instanceof Error ? error.message : String(error) });
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogPortal>
				<DialogContent class="sm:max-w-xl" showCloseButton={!creating()}>
					<DialogHeader>
						<DialogTitle>Make 3 artist drafts</DialogTitle>
						<DialogDescription>
							Reuse an approved song section across three clips. This stays local and makes normal editable scenes.
						</DialogDescription>
					</DialogHeader>
					<div class="grid gap-4 py-1">
						<Field label="Saved song timing">
							<select class="h-8 rounded-md border border-border-input bg-input px-2 text-xs" value={timingId()} onInput={(event) => setTimingId(event.currentTarget.value)}>
								<option value="">Choose timing…</option>
								<For each={timingAssets()}>{(asset) => <option value={asset.id}>{assetName(asset)}</option>}</For>
							</select>
						</Field>
						<Show when={timing.error}>
							<p class="text-xs text-destructive">{timing.error instanceof Error ? timing.error.message : 'Could not read this timing file.'}</p>
						</Show>
						<Field label="Section">
							<select class="h-8 rounded-md border border-border-input bg-input px-2 text-xs" value={sectionId()} disabled={!timing()} onInput={(event) => setSectionId(event.currentTarget.value)}>
								<option value="">Choose section…</option>
								<For each={sections()}>{(section) => <option value={section.id}>{section.label}</option>}</For>
							</select>
						</Field>
						<Field label="Master song recording">
							<select class="h-8 rounded-md border border-border-input bg-input px-2 text-xs" value={audioId()} onInput={(event) => setAudioId(event.currentTarget.value)}>
								<option value="">Choose audio…</option>
								<For each={audioAssets()}>{(asset) => <option value={asset.id}>{assetName(asset)}</option>}</For>
							</select>
						</Field>
						<div class="grid gap-2">
							<span class="text-xs font-450 text-foreground">Three footage variations</span>
							<For each={[0, 1, 2]}>{(index) => (
								<select class="h-8 rounded-md border border-border-input bg-input px-2 text-xs" value={footageIds()[index]} onInput={(event) => updateFootage(index, event.currentTarget.value)}>
									<option value="">Choose clip {index + 1}…</option>
									<For each={videoAssets()}>{(asset) => <option value={asset.id}>{assetName(asset)}</option>}</For>
								</select>
							)}</For>
						</div>
						<p class="text-xxs text-muted-foreground">Camera audio is muted. The recording must match the timing revision exactly.</p>
					</div>
					<DialogFooter>
						<Button variant="secondary" onClick={() => props.onOpenChange(false)} disabled={creating()}>Cancel</Button>
						<Button onClick={() => void create()} disabled={creating() || !timing() || !sectionId() || !selectedAudio() || !validFootage()}>
							{creating() ? 'Creating…' : 'Create 3 drafts'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}

function Field(props: { label: string; children: JSX.Element }) {
	return (
		<label class="grid gap-2">
			<span class="text-xs font-450 text-foreground">{props.label}</span>
			{props.children}
		</label>
	);
}
