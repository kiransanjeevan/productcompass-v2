import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PMCard, PMCardHeader, PMCardTitle, PMCardContent, PMCardFooter } from "@/components/ui/pm-card";
import { PMButton } from "@/components/ui/pm-button";
import { PMBadge } from "@/components/ui/pm-badge";
import { StaggerContainer, StaggerItem } from "@/components/ui/stagger-children";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { Calendar, Clock, ChevronRight, Loader2, CheckCircle2, AlertTriangle, Search, CalendarDays } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";
import { format, isToday, isTomorrow } from "date-fns";

const RECENT_SEARCHES_KEY = "pm-compass-recent-searches";
const INDEXED_FLAG_KEY = "pm-compass-indexed";

function formatMeetingTime(startTime: string): string {
  const date = new Date(startTime);
  const timeStr = format(date, "h:mm a");
  if (isToday(date)) return `Today at ${timeStr}`;
  if (isTomorrow(date)) return `Tomorrow at ${timeStr}`;
  return format(date, "EEE") + ` at ${timeStr}`;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [greeting, setGreeting] = useState("Good morning");

  // Google API token state
  const [hasGoogleTokens, setHasGoogleTokens] = useState<boolean | null>(null);

  // Indexing state
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ processed: number; total: number } | null>(null);
  const [indexComplete, setIndexComplete] = useState(false);

  // Meetings state
  const [meetings, setMeetings] = useState<any[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);

  // Recent searches from localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const displayName = getUserDisplayName(user);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setGreeting("Good morning");
    else if (hour >= 12 && hour < 17) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  }, []);

  // Check if user has Google API tokens (with retry for post-OAuth race condition)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const checkTokens = async (attempt = 0) => {
      const { count } = await supabase
        .from("oauth_tokens")
        .select("id", { count: "exact", head: true })
        .eq("provider", "google");

      if (cancelled) return;

      if ((count ?? 0) > 0) {
        setHasGoogleTokens(true);
      } else if (attempt < 3) {
        // Session may not be ready yet after OAuth redirect — retry
        setTimeout(() => checkTokens(attempt + 1), 1000);
      } else {
        setHasGoogleTokens(false);
      }
    };

    checkTokens();
    return () => { cancelled = true; };
  }, [user]);

  // Document indexing
  const runIndexing = useCallback(async (offset = 0) => {
    setIndexing(true);
    try {
      const { data, error } = await supabase.functions.invoke("index-documents", {
        body: { offset },
      });
      if (error) throw error;

      const totalProcessed = offset + (data.processed || 0);
      setIndexProgress({ processed: totalProcessed, total: data.total || 0 });

      if (data.status === "in_progress" && data.remaining > 0) {
        await runIndexing(totalProcessed);
      } else {
        setIndexing(false);
        setIndexComplete(true);
        localStorage.setItem(INDEXED_FLAG_KEY, "true");
        setTimeout(() => setIndexComplete(false), 4000);
      }
    } catch (err: any) {
      console.error("Indexing error:", err);
      setIndexing(false);
      toast.error("Failed to index documents. Please try again from Settings.");
    }
  }, []);

  useEffect(() => {
    if (!user || !hasGoogleTokens) return;
    const alreadyIndexed = localStorage.getItem(INDEXED_FLAG_KEY);
    if (alreadyIndexed) return;

    const checkAndIndex = async () => {
      const { count } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true });

      if (count === 0) {
        runIndexing();
      } else {
        localStorage.setItem(INDEXED_FLAG_KEY, "true");
      }
    };
    checkAndIndex();
  }, [user, hasGoogleTokens, runIndexing]);

  // Sync calendar meetings
  useEffect(() => {
    if (!user || !hasGoogleTokens) return;
    const syncMeetings = async () => {
      setMeetingsLoading(true);
      setMeetingsError(null);
      try {
        const { data, error } = await supabase.functions.invoke("sync-calendar");
        if (error) {
          if (error.message?.includes("401") || error.message?.includes("expired")) {
            setMeetingsError("expired");
          } else {
            throw error;
          }
          return;
        }
        if (data?.error && (data.error.includes("expired") || data.error.includes("token"))) {
          setMeetingsError("expired");
          return;
        }
        setMeetings(data?.meetings || []);
      } catch (err) {
        console.error("Calendar sync error:", err);
        setMeetingsError("failed");
      } finally {
        setMeetingsLoading(false);
      }
    };
    syncMeetings();
  }, [user, hasGoogleTokens]);

  const handleSearch = (query: string) => {
    const updated = [query, ...recentSearches.filter((s) => s !== query)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const clearSearchHistory = () => {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  };

  return (
    <div className="max-w-[1000px] mx-auto px-6 lg:px-8 py-12">
      <StaggerContainer>
        {/* Greeting */}
        <StaggerItem>
          <div className="text-center mb-8">
            <h1 className="text-page-title text-foreground mb-2">{greeting}, {displayName}</h1>
            <p className="text-body text-muted-foreground">Here's what's on your radar today</p>
          </div>
        </StaggerItem>

        {/* Google Connect Banner */}
        {hasGoogleTokens === false && (
          <StaggerItem>
            <div className="mb-6 flex items-center justify-between rounded-lg glass px-4 py-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">
                  Google tokens not detected. Try signing out and signing back in to reconnect.
                </span>
              </div>
            </div>
          </StaggerItem>
        )}

        {/* Indexing Status Banner */}
        <AnimatePresence>
          {indexing && indexProgress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 flex items-center gap-3 rounded-lg glass px-4 py-3"
            >
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-foreground">
                Indexing your documents... ({indexProgress.processed} of {indexProgress.total} processed)
              </span>
            </motion.div>
          )}
          {indexComplete && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 flex items-center gap-3 rounded-lg glass px-4 py-3"
            >
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm text-foreground">
                {indexProgress?.total || 0} documents indexed
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search Trigger — opens command palette */}
        <StaggerItem>
          <button
            onClick={() => {
              // Dispatch Cmd+K to open command palette
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
            className="w-full mb-12 h-14 rounded-lg glass flex items-center gap-3 px-5 text-left transition-all duration-200 hover:shadow-glow group"
          >
            <Search className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-base text-muted-foreground flex-1">Search your documents...</span>
            <kbd className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              <span>{"\u2318"}</span>
              <span>K</span>
            </kbd>
          </button>
        </StaggerItem>

        {/* Widgets Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Upcoming Meetings */}
          <StaggerItem className="h-full">
            <PMCard hoverable className="flex flex-col h-full">
              <PMCardHeader>
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <PMCardTitle>Upcoming Meetings</PMCardTitle>
                <PMBadge variant="info" className="text-[10px] ml-1">Beta</PMBadge>
              </PMCardHeader>
              <PMCardContent className="flex-1">
                {meetingsLoading ? (
                  <div className="space-y-3 py-2">
                    <SkeletonShimmer className="h-10 w-full" />
                    <SkeletonShimmer className="h-10 w-full" />
                    <SkeletonShimmer className="h-10 w-3/4" />
                  </div>
                ) : meetingsError === "expired" ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-warning">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Your Google connection has expired. <button onClick={() => navigate("/settings")} className="underline hover:text-foreground">Reconnect in Settings</button>.</span>
                  </div>
                ) : meetingsError ? (
                  <p className="text-sm text-muted-foreground py-4">Failed to load meetings.</p>
                ) : meetings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <CalendarDays className="h-6 w-6 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">All clear this week</p>
                    <p className="text-xs text-muted-foreground">No meetings in the next 7 days — time for deep work</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {meetings.slice(0, 3).map((meeting, index) => (
                      <button
                        key={meeting.id}
                        onClick={() => navigate(`/meeting-prep/${meeting.id}`)}
                        className="w-full flex items-center justify-between p-2.5 -mx-2 rounded-md hover:bg-white/5 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-0.5 h-8 rounded-full ${index === 0 && isToday(new Date(meeting.start_time)) ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          <div className="flex flex-col items-start">
                            <span className="text-sm text-foreground">{meeting.title}</span>
                            {meeting.attendees && (
                              <span className="text-xs text-muted-foreground">
                                {Array.isArray(meeting.attendees) ? meeting.attendees.length : 0} attendees
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-small text-muted-foreground group-hover:text-foreground flex items-center gap-1">
                          {formatMeetingTime(meeting.start_time)}
                          <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </button>
                    ))}
                    {meetings.length > 3 && (
                      <p className="text-xs text-muted-foreground pt-1">
                        +{meetings.length - 3} more this week
                      </p>
                    )}
                  </div>
                )}
              </PMCardContent>
              <PMCardFooter>
                <button className="text-sm text-primary hover:underline">
                  View full calendar
                </button>
              </PMCardFooter>
            </PMCard>
          </StaggerItem>

          {/* Recent Searches */}
          <StaggerItem className="h-full">
            <PMCard hoverable className="flex flex-col h-full">
              <PMCardHeader>
                <Clock className="h-4 w-4 text-muted-foreground" />
                <PMCardTitle>Recent Searches</PMCardTitle>
              </PMCardHeader>
              <PMCardContent className="flex-1">
                {recentSearches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <Search className="h-6 w-6 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No searches yet</p>
                    <p className="text-xs text-muted-foreground">Try asking "Find my latest PRD" or press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">{"\u2318"}K</kbd></p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentSearches.map((search) => (
                      <button
                        key={search}
                        onClick={() => handleSearch(search)}
                        className="w-full text-left p-2.5 -mx-2 rounded-md hover:bg-white/5 transition-colors group flex items-center gap-2"
                      >
                        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground">"{search}"</span>
                      </button>
                    ))}
                  </div>
                )}
              </PMCardContent>
              <PMCardFooter>
                {recentSearches.length > 0 && (
                  <button
                    onClick={clearSearchHistory}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear history
                  </button>
                )}
              </PMCardFooter>
            </PMCard>
          </StaggerItem>
        </div>
      </StaggerContainer>
    </div>
  );
};

export default Dashboard;
