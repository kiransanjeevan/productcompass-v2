import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { linearRedirectUri } from "@/lib/linear-auth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

/**
 * Handles the redirect back from Linear's OAuth consent screen. Validates the
 * CSRF state, then hands the `code` to the linear-oauth edge function (which
 * exchanges it for a token, server-side). Always lands the user back on /settings.
 */
const LinearCallback = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against React StrictMode double-invoke
    ran.current = true;

    (async () => {
      const code = params.get("code");
      const state = params.get("state");
      const expected = sessionStorage.getItem("linear_oauth_state");
      sessionStorage.removeItem("linear_oauth_state");

      if (params.get("error")) {
        toast.error("Linear connection was cancelled.");
        return navigate("/settings");
      }
      if (!code || !state || state !== expected) {
        toast.error("Linear connection failed (invalid state).");
        return navigate("/settings");
      }

      try {
        const { data, error } = await supabase.functions.invoke("linear-oauth", {
          body: { code, redirect_uri: linearRedirectUri() },
        });
        if (error || !data?.success) throw error ?? new Error("exchange failed");
        toast.success("Linear connected!");
      } catch (err) {
        console.error("[linear-callback]", err);
        toast.error("Failed to connect Linear. Please try again.");
      }
      navigate("/settings");
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      Connecting Linear…
    </div>
  );
};

export default LinearCallback;
