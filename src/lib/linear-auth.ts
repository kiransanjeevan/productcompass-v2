// Linear OAuth — custom authorization-code flow (Linear isn't a Supabase social
// provider). connectLinear() redirects to Linear's consent screen; Linear then
// redirects back to /auth/linear/callback, which exchanges the code via the
// linear-oauth edge function. The client_id is public (it rides in the URL);
// the client secret lives only in the edge function.
const LINEAR_CLIENT_ID = import.meta.env.VITE_LINEAR_CLIENT_ID as string | undefined;
const LINEAR_SCOPES = "read,write";

export function linearRedirectUri(): string {
  return `${window.location.origin}/auth/linear/callback`;
}

export function connectLinear(): void {
  if (!LINEAR_CLIENT_ID) {
    console.error("[linear-auth] VITE_LINEAR_CLIENT_ID is not set");
  }
  // CSRF guard: round-trip a random state through Linear.
  const state = crypto.randomUUID();
  sessionStorage.setItem("linear_oauth_state", state);

  const url = new URL("https://linear.app/oauth/authorize");
  url.searchParams.set("client_id", LINEAR_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", linearRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LINEAR_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("actor", "user"); // issues created later are attributed to the user
  window.location.href = url.toString();
}
