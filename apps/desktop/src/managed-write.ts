/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function isInside(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

/**
 * Proves a streaming destination stays within a selected project. The first
 * check blocks `../`; the realpath check blocks a linked directory escape.
 */
export async function prepareManagedWrite(root: string, target: string): Promise<string> {
	if (!isAbsolute(root) || !isAbsolute(target)) throw new Error('Managed writes require absolute project paths.');
	const requestedRoot = resolve(root);
	const requestedTarget = resolve(target);
	if (!isInside(requestedRoot, requestedTarget)) throw new Error('Write path leaves the selected project.');

	await mkdir(dirname(requestedTarget), { recursive: true });
	const [realRoot, realParent] = await Promise.all([realpath(requestedRoot), realpath(dirname(requestedTarget))]);
	if (!isInside(realRoot, realParent)) throw new Error('Write path leaves the selected project through a symlink.');
	return requestedTarget;
}
