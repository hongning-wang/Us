<script lang="ts">
 export let name = 'spark'; export let size = 20;
 const paths: Record<string,string> = {
 spark:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4m-2-2h4',
 close:'m6 6 12 12M6 18 18 6', arrow:'M5 12h14m-6-6 6 6-6 6', chevron:'m9 5 7 7-7 7',
 send:'m22 2-7 20-4-9L2 9l20-7ZM22 2 11 13',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l.7 3 2.8 1 2.5 2-1.5 3 1.5 3-2.5 2-2.8 1-.7 3H9l-.7-3-2.8-1L3 15l1.5-3L3 9l2.5-2 2.8-1L9 3Z',
 check:'m5 12 4 4L19 6', image:'M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M15 7h.01',
 back:'m15 5-7 7 7 7', more:'M5 12h.01M12 12h.01M19 12h.01',
 play:'m9 5 11 7-11 7V5Z', refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3',
 heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
 chat:'M21 11.5a9 9 0 0 1-9 9H3l1.8-4.3A9 9 0 1 1 21 11.5Z',
 home:'m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z',
 search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5',
 reel:'M3 3h18v18H3V3ZM3 8h18M7 3l4 5m4-5 4 5m-9 4 6 4-6 4v-8Z',
 phone:'M5 3H3v5c0 7 6 13 13 13h5v-5l-5-2-2 3a12 12 0 0 1-7-7l3-2-2-5H5Z',
 video:'M3 5h12v14H3V5Zm12 5 6-4v12l-6-4', info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6m0-10h.01',
 plus:'M12 4v16M4 12h16', smile:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 9h.01M16 9h.01M7 14c2 4 8 4 10 0',
 mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8'
 };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] || paths.spark}/></svg>
