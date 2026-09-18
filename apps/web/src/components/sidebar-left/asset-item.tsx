/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onMount, onCleanup, Show, createMemo } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@diffusionstudio/koota-solid";
import { assetName } from "@diffusionstudio/assets";
import { insertAssetAtPlayhead, replaceAssetSource, saveAssetAs } from "@/engine/asset-actions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { AssetThumbnail } from "../ui/asset-thumbnail";
import { formatAssetDuration } from "@/utils";
import { useLibrary } from "@/engine/library";
import { ASSET_DRAG_TYPE } from "./folder-item";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import type { Asset } from "@diffusionstudio/assets";

export type LazyAssetItemProps = {
  asset: Asset;
  selected: boolean;
  onSelect(): void;
};

const LOCAL_WHISPER_MODEL_KEY = "artist-editor.local-whisper-model-path";

/**
 * A lazy loaded asset item. Clears the buffer when not visible.
 */
export function LazyAssetItem(props: LazyAssetItemProps) {
  const world = useWorld();
  const library = useLibrary();

  const [isVisible, setIsVisible] = createSignal(false);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const assetDuration = createMemo(() => formatAssetDuration(props.asset));
  const name = () => assetName(props.asset);

  let ref: HTMLDivElement | undefined;

  onMount(() => {
    if (!ref) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "100px" }
    );

    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  const handleDeleteAsset = async () => {
    try {
      await library()?.remove([props.asset]);
    } catch (e) {
      toast.error("Failed to delete", { description: (e as Error).message });
    }
  };

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer?.setData(ASSET_DRAG_TYPE, props.asset.id);
  };

  const commitRename = (nextName: string) => {
    if (!isRenaming()) return;
    setIsRenaming(false);
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === name()) return;
    library()?.rename(props.asset, trimmed);
  };

  const handleRenameKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsRenaming(false);
    }
  };

  const handleFocusElement = (el: HTMLInputElement) => {
    queueMicrotask(() => {
      el.focus();
      el.select();
    });
  };

  const handleReplaceMedia = async () => {
    const lib = library();
    if (lib) await replaceAssetSource(lib, props.asset);
  };

  const handleSaveAs = () => saveAssetAs(props.asset);
  const handleInsertToTimeline = () => insertAssetAtPlayhead(world, props.asset);

  const handleTranscribeLocally = async () => {
    if (props.asset.type !== "AUDIO") return;
    const lib = library();
    if (!lib) return;
    try {
      const inputPath = lib.fs.pathOf?.(await lib.file(props.asset));
      if (!inputPath) throw new Error("This audio asset does not have a local file path.");
      let modelPath = window.localStorage.getItem(LOCAL_WHISPER_MODEL_KEY);
      if (!modelPath) {
        toast("Choose your local Whisper model", { description: "This is a one-time setup. The model stays on your Mac and is never uploaded." });
        modelPath = await mainBridge.call(MAIN_CHANNELS.LOCAL_TRANSCRIPTION_PICK_MODEL, undefined);
        if (!modelPath) return;
        window.localStorage.setItem(LOCAL_WHISPER_MODEL_KEY, modelPath);
      }
      toast("Transcribing locally…", { description: "Whisper is running on this Mac. Review the timing before saving it as reusable song timing." });
      const { srt } = await mainBridge.call(MAIN_CHANNELS.LOCAL_TRANSCRIBE, { inputPath, modelPath });
      const stem = name().replace(/\.[^.]+$/, "") || "lyrics";
      await lib.store(new Blob([srt], { type: "application/x-subrip" }), {
        name: `${stem}-local-${Date.now()}.srt`,
        folder: "artist-editor/transcripts",
      });
      toast.success("Local timed lyrics added", { description: "Open Song timing, review the lyric boundaries, then save the reusable timing revision." });
    } catch (error) {
      window.localStorage.removeItem(LOCAL_WHISPER_MODEL_KEY);
      toast.error("Could not transcribe locally", { description: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        class="flex flex-col gap-1 text-left"
        data-asset-id={props.asset.id}
        draggable={true}
        onDragStart={handleDragStart}
        onClick={props.onSelect}
        onContextMenu={props.onSelect}>
        <div
          ref={ref}
          data-selected={props.selected}
          class="relative aspect-video w-full overflow-clip rounded bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded after:opacity-0 after:ring-2 after:ring-inset after:ring-ring after:z-10 data-[selected=true]:after:opacity-100"
        >
          <Show when={isVisible()}>
            <AssetThumbnail asset={props.asset} class="absolute inset-0" cache={library()?.cache} />
          </Show>
          <Show when={assetDuration()}>
            {(duration) => (
              <div class="absolute left-1 top-1 z-20 flex h-4 items-center justify-center rounded bg-overlay px-1">
                <span class="text-xxs text-primary-foreground">
                  {duration()}
                </span>
              </div>
            )}
          </Show>
        </div>
        <Show
          when={isRenaming()}
          fallback={
            <div class="text-xs text-foreground truncate select-none" title={props.asset.source}>
              {name()}
            </div>
          }
        >
          <input
            ref={handleFocusElement}
            type="text"
            name="asset-name"
            autocomplete="off"
            value={name()}
            onKeyDown={handleRenameKeyDown}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            class="text-xs text-foreground truncate bg-transparent rounded-sm outline-none ring-1 ring-primary px-0.5"
          />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[180px]">
          <ContextMenuItem onSelect={handleInsertToTimeline}>
            Insert at playhead
          </ContextMenuItem>
          <Show when={props.asset.type === "AUDIO"}>
            <ContextMenuItem onSelect={() => void handleTranscribeLocally()}>
              Transcribe locally
            </ContextMenuItem>
          </Show>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setIsRenaming(true)}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleReplaceMedia}>
            Replace
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleSaveAs}>
            Save as
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDeleteAsset}>
            Delete
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
