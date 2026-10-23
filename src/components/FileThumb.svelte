<script lang="ts">
  import { TEXT_ITEM_MIME } from '../lib/config';
  import Icon from './Icon.svelte';
  // Image files show a real preview; other kinds get the design's colored tiles.
  let {
    name,
    mime = '',
    blob,
    size = 44,
  }: { name: string; mime?: string; blob?: Blob; size?: number } = $props();

  const ext = $derived((name.includes('.') ? (name.split('.').pop() ?? '') : '').toLowerCase());
  // Received files may have no MIME type here: fall back to the extension.
  const kind = $derived.by(() => {
    if (mime === TEXT_ITEM_MIME) return 'text';
    const m = mime || '';
    if (m.startsWith('image/') || /^(jpe?g|png|gif|webp|heic|heif|avif|bmp|svg)$/.test(ext))
      return 'image';
    if (m.startsWith('video/') || /^(mp4|mov|m4v|webm|mkv|avi|3gp)$/.test(ext)) return 'video';
    if (m.startsWith('audio/') || /^(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(ext)) return 'audio';
    return 'doc';
  });
  let preview = $state<string | null>(null);
  $effect(() => {
    if (!blob || kind !== 'image' || blob.size > 25 * 1024 * 1024) return;
    const url = URL.createObjectURL(blob);
    preview = url;
    return () => URL.revokeObjectURL(url);
  });
</script>

<div class="thumb {kind}" style:width="{size}px" style:height="{size}px" aria-hidden="true">
  {#if preview}
    <img src={preview} alt="" onerror={() => (preview = null)} />
  {:else if kind === 'text'}
    <Icon name="link" size={size * 0.45} />
  {:else if kind === 'doc'}
    <span>{ext.slice(0, 4).toUpperCase() || 'FILE'}</span>
  {/if}
</div>

<style>
  .thumb {
    flex: none;
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .image {
    background: linear-gradient(140deg, #ffb48f, #f0643c);
  }
  .audio {
    background: linear-gradient(140deg, #b9e8cb, #3faf72);
  }
  .video {
    background: linear-gradient(140deg, #3a3d46, #111318);
  }
  .doc {
    background: #111318;
    color: #fff;
  }
  .doc span {
    font-size: 10px;
    font-weight: 600;
  }
  .text {
    background: var(--track);
  }
</style>
