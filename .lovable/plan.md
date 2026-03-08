
# Fix: Await Token Deletion Before Signing Out

## Root Cause
The `signOut` function in `AuthContext.tsx` deletes `oauth_tokens` as a fire-and-forget call (line 54), then immediately clears the session (lines 57-60). The auth token is removed from the client before the delete request reaches the server, so RLS blocks the request and the tokens remain in the database. On the next sign-in, the Dashboard sees existing tokens and skips the second Google authorization.

Confirmed: the `oauth_tokens` table still has a row from the previous session (verified via database query).

## Fix

### `src/contexts/AuthContext.tsx` (lines 51-72)

**Await the token deletion before clearing the session:**

```typescript
const signOut = async () => {
  // Delete oauth tokens BEFORE clearing session so RLS auth header is still present
  if (user?.id) {
    await supabase.from("oauth_tokens").delete().eq("user_id", user.id);
  }

  // Now safe to clear local state and sign out
  setUser(null);
  setSession(null);

  supabase.auth.signOut({ scope: 'local' }).catch(() => {});

  // Clear local flags
  localStorage.removeItem("pm-compass-indexed");
  localStorage.removeItem("pm-compass-recent-searches");

  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith('sb-')) {
      localStorage.removeItem(key);
    }
  });
};
```

The only change is adding `await` on the delete call (line 54) so the request completes with a valid auth header before the session is torn down.

## No other files need changes
The Dashboard redirect logic (`startGoogleTokenRedirect`) is already correct -- it just never triggers because it sees stale tokens.
