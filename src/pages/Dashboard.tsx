import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import { PMSearchBar } from "@/components/ui/pm-search-bar";
import { PMCard, PMCardHeader, PMCardTitle, PMCardContent, PMCardFooter } from "@/components/ui/pm-card";
import { PMButton } from "@/components/ui/pm-button";
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
  const searchRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const [greeting, setGreeting] = useState("Good morning");
  const [showTip, setShowTip] = useState(true);

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

  // Check if user has Google API tokens
  useEffect(() => {
    if (!user) return;
    const checkTokens = async () => {
      const { count } = await supabase
        .from("oauth_tokens")
        .select("id", { count: "exact", head: true })
        .eq("provider", "google");
      setHasGoogleTokens((count ?? 0) > 0);
    };
    checkTokens();
  }, [user]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Show pro tip toast
  useEffect(() => {
    if (showTip) {
      const timer = setTimeout(() => {
        toast.info("Pro tip: Press ⌘K to search anytime", { duration: 4000 });
        setShowTip(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [showTip]);

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
    <div className="min-h-screen bg-background">
      <Navbar isAuthenticated userName={displayName} />

      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Greeting */}
          <div className="text-center mb-8">
            <h1 className="text-page-title text-foreground mb-2">{greeting}, {displayName}</h1>
            <p className="text-body text-muted-foreground">Here's what's on your radar today</p>
          </div>

          {/* Google Connect Banner — shows if no tokens stored */}
          {hasGoogleTokens === false && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mb-6 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">
                  Google tokens not detected. Try signing out and signing back in to reconnect.
                </span>
              </div>
            </motion.div>
          )}

          {/* Indexing Status Banner */}
          <AnimatePresence>
            {indexing && indexProgress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-secondary-bg px-4 py-3"
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
                className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-secondary-bg px-4 py-3"
              >
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm text-foreground">
                  ✓ {indexProgress?.total || 0} documents indexed
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search Bar */}
          <div className="mb-12">
            <PMSearchBar
              ref={searchRef}
              placeholder="Ask me anything..."
              onSearch={handleSearch}
            />
          </div>

          {/* Widgets Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Upcoming Meetings */}
            <PMCard>
              <PMCardHeader>
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <PMCardTitle>Upcoming Meetings</PMCardTitle>
              </PMCardHeader>
              <PMCardContent>
                {meetingsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
                    {meetings.slice(0, 3).map((meeting) => (
                      <button
                        key={meeting.id}
                        onClick={() => navigate(`/meeting-prep/${meeting.id}`)}
                        className="w-full flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-secondary-bg transition-colors group"
                      >
                        <div className="flex flex-col items-start">
                          <span className="text-sm text-foreground">{meeting.title}</span>
                          {meeting.attendees && (
                            <span className="text-xs text-muted-foreground">
                              {Array.isArray(meeting.attendees) ? meeting.attendees.length : 0} attendees
                            </span>
                          )}
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
                  View full calendar →
                </button>
              </PMCardFooter>
            </PMCard>

            {/* Recent Searches */}
            <PMCard>
              <PMCardHeader>
                <Clock className="h-4 w-4 text-muted-foreground" />
                <PMCardTitle>Recent Searches</PMCardTitle>
              </PMCardHeader>
              <PMCardContent>
                {recentSearches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <Search className="h-6 w-6 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No searches yet</p>
                    <p className="text-xs text-muted-foreground">Try asking "Find my latest PRD" or press <kbd className="px-1.5 py-0.5 rounded bg-secondary-bg border border-border text-[10px] font-mono">⌘K</kbd></p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentSearches.map((search) => (
                      <button
                        key={search}
                        onClick={() => handleSearch(search)}
                        className="w-full text-left p-2 -mx-2 rounded-md hover:bg-secondary-bg transition-colors group"
                      >
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
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default Dashboard;
