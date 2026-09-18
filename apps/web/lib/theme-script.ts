// The blocking script that paints the theme before React hydrates.
//
// A React tree cannot render a <script>: React 19 warns, and the tag would
// not run in the browser anyway. ThemeProvider inserts this string into
// <head> via useServerInsertedHTML, outside the hydrating tree.
//
// The login page cannot import this module. Its copy lives in
// apps/auth/ui/index.html and must stay equivalent.

export const THEME_STORAGE_KEY = 'portta-theme'

export const THEME_INIT_SCRIPT = `(function(){var stored;try{stored=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}var theme=stored==='light'||stored==='dark'||stored==='system'?stored:'system';var dark=theme==='dark';if(theme==='system'){try{dark=matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}}var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(dark?'dark':'light');root.style.colorScheme=dark?'dark':'light'})();`
