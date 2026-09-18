/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { renderText } from '../../utils/text';
import { findActiveGroup, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';

import type { Entity, World } from 'koota';
import type { Asset, WordGroup } from '@diffusionstudio/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 880;
const HEIGHT = 180;

/**
 * The local artist baseline. TikTok Sans is intentionally only named here:
 * unlike the stock presets, this decoder never fetches a hosted font. The
 * typography panel can point the saved caption at any installed local font.
 */
export const ARTIST_TEXT_STYLE = {
	fontFamily: 'TikTok Sans',
	fontWeight: '400',
	fontSize: 62,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	fontStyle: FontStyle.NORMAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

/**
 * A lyric line is one transcript segment. Each line appears when its first
 * sung word starts and remains until the following line starts. Intentional
 * gaps therefore stay empty instead of inheriting the previous caption.
 */
export class ArtistCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.ARTIST;
	public groups: WordGroup[] = [];
	public ready = false;
	public styled = false;

	private readonly asset: Asset;
	private currentGroupIndex = -1;

	constructor(asset: Asset) {
		this.asset = asset;
		this.init();
	}

	private async init(): Promise<void> {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = transcript.map(segment => segment.words).filter(words => words.length > 0);
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, {
			width: WIDTH,
			height: HEIGHT,
			defaultAlign: CaptionAlign.CENTER,
		});
	}

	public applyStyles(world: World, entity: Entity): boolean {
		// No generated shadow, outline, or hosted font request.
		return this.reposition(world, entity);
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			this.currentGroupIndex = -1;
			return;
		}

		if (groupIndex !== this.currentGroupIndex) {
			this.currentGroupIndex = groupIndex;
			setChars(world, entity, this.groups[groupIndex]!.map(word => word.text).join(' '));
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentGroupIndex = -1;
	}
}
