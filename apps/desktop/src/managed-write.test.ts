import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareManagedWrite } from './managed-write';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'managed-write-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('prepareManagedWrite', () => {
	it('allows a new file below the selected project', async () => {
		expect(await prepareManagedWrite(root, join(root, 'assets', 'timing.json'))).toBe(join(root, 'assets', 'timing.json'));
	});

	it('blocks a lexical traversal before it can create a parent', async () => {
		await expect(prepareManagedWrite(root, join(root, '..', 'outside', 'timing.json'))).rejects.toThrow('leaves the selected project');
	});

	it('blocks a project symlink that points outside the root', async () => {
		const outside = await mkdtemp(join(tmpdir(), 'managed-write-outside-'));
		try {
			await mkdir(join(root, 'assets'));
			await symlink(outside, join(root, 'assets', 'escape'));
			await expect(prepareManagedWrite(root, join(root, 'assets', 'escape', 'timing.json'))).rejects.toThrow('symlink');
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});
