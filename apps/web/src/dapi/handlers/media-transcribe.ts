/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ToolHandler } from "../handler";

export const mediaTranscribe: ToolHandler<"media_transcribe"> = async ({ path }, ctx) => {
  void path;
  void ctx;
  throw new Error("Cloud transcription is disabled in Artist Editor. Use a local transcript or an approved song-timing revision.");
};
