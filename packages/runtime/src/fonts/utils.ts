/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Web font loading (was engine/font/utils.ts, minus the app-side pieces:
// getLocalFonts needs window.queryLocalFonts, and font persistence is the
// app's IndexedDB concern; it wraps loadWebFont and re-calls it on restore).

import { WebFonts } from './fixtures';
import { FontStyle } from '../constants';

import type { World } from 'koota';
import type * as types from './types';

/**
 * Artist Editor never advertises or fetches hosted fonts. The desktop font
 * picker exposes installed fonts through the host's local-font permission.
 */
export function getWebFonts(): types.FontSources[] {
	return [];
}

export async function loadWebFont(
	world: World,
	family: keyof typeof WebFonts,
	style: FontStyle = FontStyle.NORMAL,
	weight?: string,
): Promise<types.FontSource> {
	void world;
	return {
		// A FontFace `local()` source is descriptive only here: the browser uses
		// its ordinary local fallback if the requested face is unavailable.
		source: `local(${JSON.stringify(family)})`,
		family,
		weight,
		style,
	};
}
