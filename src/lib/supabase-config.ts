// Client-safe check that the browser build actually received the backend
// config. These VITE_ values are inlined at build time; when a deploy is
// missing them the Supabase client throws on first use, which previously
// surfaced as a blank screen or an opaque "Failed to fetch".

export function supabaseConfigError(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return "This app isn't connected to its backend yet. Republish the app so the backend settings are included, then reload this page.";
  }
  return null;
}

export const isSupabaseConfigured = () => supabaseConfigError() === null;
