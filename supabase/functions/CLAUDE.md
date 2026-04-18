# Supabase Edge Functions

Deno runtime, deployed with `supabase functions deploy <name>`. These run server-side with the service role available via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`.

## Conventions

- **One function per subsystem, `action`-dispatched.** `game-service` handles every write to the games subsystem — `respond`, `roll`, etc. New game operations become new cases in the `switch (body.action)`. Grow this before spinning up a second function.
- **Authenticate the caller via their JWT.** Read the `Authorization` header, hand it to a regular (anon-key) client, call `auth.getUser()` to get the user id. All other reads/writes use the service-role admin client. Return 401 if the caller is not authenticated.
- **Writes bypass RLS.** Functions use the service-role key, so tables they mutate don't need client-writable RLS policies. Keep select policies permissive enough for the app's real-time and read paths; drop the insert/update/delete policies that exist only to support `security invoker` SQL RPCs.
- **Background tasks via `EdgeRuntime.waitUntil(promise)`** — runs after the HTTP response returns. Use for delayed work (e.g. the 3s setup finalizer) so the caller isn't held open. Make the work idempotent (re-read state, guard on expected precondition) in case the function runs twice.
- **Error shape.** Reply with `{ ok: false, error: string }` and an appropriate HTTP status. The client store surfaces a generic user-facing message — the edge function's error strings are for logs.
- **CORS is required for web callers.** Handle `OPTIONS` preflight with `Access-Control-Allow-Origin/Headers/Methods` and add the same `Access-Control-Allow-Origin` to every response. Native clients don't care, but the web app calls through the browser's fetch which enforces CORS.

## Env

Deno reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` from the function's environment (Supabase auto-provides these at deploy time).

## Type-checking

`tsconfig.json` excludes `supabase/functions` — we don't want Expo's TS config checking Deno-style imports. Edge function type errors surface at deploy time via `supabase functions deploy`.
