<template>
 <router-view />
</template>

<style>
:root {
 --forest-950: #173426;
 --forest-900: #1f4d37;
 --forest-800: #285f43;
 --forest-700: #326f4e;
 --forest-600: #3f7d5a;
 --forest-100: #e8f2ec;
 --forest-50: #f3f8f5;
 --sun-700: #c96f22;
 --sun-600: #dc812d;
 --sun-500: #e8943a;
 --sun-100: #fff0dc;
 --canvas: #f4f7f2;
 --surface: #ffffff;
 --text-strong: #26342b;
 --text: #435249;
 --text-muted: #718078;
 --border: #dbe6de;
 --danger: #c94c47;
 --danger-soft: #fff0ee;
 --shadow-sm: 0 2px 10px rgba(31, 77, 55, 0.07);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { width: 100%; min-height: 100%; }
body {
 font-family: "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
 color: var(--text);
 background: var(--canvas);
 letter-spacing: 0;
 -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
 outline: 2px solid var(--sun-500);
 outline-offset: 2px;
}
::selection { color: var(--forest-950); background: var(--sun-100); }
</style>
