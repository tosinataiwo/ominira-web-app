import { BRAND_BG } from "@/lib/config/brand-assets";

// Everything the first paint needs to decide *before* React exists. The
// reader's theme lives in localStorage (stores/reader-store.ts persists it
// with skipHydration), which the server can't see — so without this, every
// launch painted light first and only flipped to dark once ThemeProvider's
// effect rehydrated the store: the visible light→dark flash. BOOT_SCRIPT
// runs inline in <head>, synchronously, ahead of the first frame.

/** --reader-bg per theme (app/globals.css) — the browser/status-bar chrome colour outside the splash. */
export const APP_BG = { light: "#ffffff", dark: "#000000" } as const;

export const READER_PREFS_STORAGE_KEY = "ominira-reader-prefs";
export const SPLASH_SESSION_KEY = "ominira:pwa-launch-splash-shown";

/** Total time the launch splash stays up, measured from navigation start. */
export const SPLASH_DURATION_MS = 2600;
/** Matches the .app-splash opacity transition in app/globals.css. */
export const SPLASH_FADE_MS = 300;

export function setThemeColor(color: string) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

// Plain ES5, no imports at runtime — it's serialized into the HTML. Theme
// resolution mirrors reader-store (its migrate and merge): a saved
// dark (incl. never-migrated v1 names like "carbon") is always a choice; a
// saved light only counts once flagged themeExplicit (older blobs may hold
// the old default); otherwise the device's scheme, light if it has none.
//
// The splash is the installed mobile app's Home launch only: a detail URL
// opened from the app is regular navigation, and a browser tab never gets
// one. Once per session, so a reload mid-session doesn't replay it.
export const BOOT_SCRIPT = `(function(){
var d=document.documentElement,t="",s=false;
try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(READER_PREFS_STORAGE_KEY)})||"null"),st=p&&p.state;
if(st&&/^(dark|carbon|black|winter|forest)$/.test(st.theme))t="dark";
else if(st&&st.themeExplicit&&st.theme==="light")t="light"}catch(e){}
if(!t)try{t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}
d.setAttribute("data-reader-theme",t);
try{if((matchMedia("(display-mode: standalone)").matches||navigator.standalone===true)
&&matchMedia("(max-width: 767px)").matches&&location.pathname==="/home"
&&!sessionStorage.getItem(${JSON.stringify(SPLASH_SESSION_KEY)})){
sessionStorage.setItem(${JSON.stringify(SPLASH_SESSION_KEY)},"1");d.setAttribute("data-splash","");s=true}}catch(e){}
var m=document.createElement("meta");m.name="theme-color";
m.content=(s?${JSON.stringify(BRAND_BG)}:${JSON.stringify(APP_BG)})[t];
document.head.appendChild(m)})()`;
