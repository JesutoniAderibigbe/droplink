<script lang="ts">
  import { encode } from 'uqr';

  // A QR code drawn as one SVG path (dark modules on white, with the quiet
  // zone the spec asks for) so phone cameras read it reliably.
  let { text, size = 240, label }: { text: string; size?: number; label: string } = $props();

  const qr = $derived(encode(text, { ecc: 'M', border: 3 }));
  const path = $derived.by(() => {
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return d;
  });
</script>

<svg
  class="qr"
  width={size}
  height={size}
  viewBox="0 0 {qr.size} {qr.size}"
  shape-rendering="crispEdges"
  role="img"
  aria-label={label}
>
  <rect width={qr.size} height={qr.size} fill="#fff" />
  <path d={path} fill="#111318" />
</svg>

<style>
  .qr {
    display: block;
    border-radius: 16px;
  }
</style>
