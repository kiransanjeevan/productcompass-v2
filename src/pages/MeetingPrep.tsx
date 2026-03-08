import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import { PMCard, PMCardHeader, PMCardTitle, PMCardContent } from "@/components/ui/pm-card";
import { PMButton } from "@/components/ui/pm-button";
import { PMAvatar } from "@/components/ui/pm-avatar";
import { ArrowLeft, Calendar, Users, FileText, Copy, RefreshCw, Loader2, AlertTriangle, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";
import { format } from "date-fns";

const MeetingPrep = () => {
  const navigate = useNavigate();
  const { meetingId } = useParams();
  const { user } = useAuth();
  const displayName = getUserDisplayName(user);

  const [meeting, setMeeting] = useState<any>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefLoading, setBriefLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch meeting from database
  useEffect(() => {
    if (!meetingId) return;

    const fetchMeeting = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: meetingData, error: meetingError } = await supabase
          .from("meetings")
          .select("*")
          .eq("id", meetingId)
          .single();

        if (meetingError) throw meetingError;

        setMeeting(meetingData);

        // If meeting already has a brief, use it
        if (meetingData.brief) {
          setBrief(meetingData.brief);
        }
      } catch (err: any) {
        console.error("Failed to fetch meeting:", err);
        setError("Failed to load meeting details.");
      } finally {
        setLoading(false);
      }
    };

    fetchMeeting();
  }, [meetingId]);

  // Generate brief if meeting loaded but has no brief
  useEffect(() => {
    if (!meeting || brief || briefLoading) return;
    if (meeting.brief) return;

    const generateBrief = async () => {
      setBriefLoading(true);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("prepare-meeting", {
          body: { meeting_id: meetingId },
        });

        if (fnError) throw fnError;

        if (data?.brief) {
          setBrief(data.brief);
        }
      } catch (err: any) {
        console.error("Failed to generate brief:", err);
        toast.error("Failed to generate meeting brief.");
      } finally {
        setBriefLoading(false);
      }
    };

    generateBrief();
  }, [meeting, brief, briefLoading, meetingId]);

  const handleCopyBrief = () => {
    if (!meeting || !brief) return;

    const attendees = Array.isArray(meeting.attendees)
      ? meeting.attendees.map((a: any) => typeof a === "string" ? a : a.email || a.name || "").join(", ")
      : "";

    const text = `
Meeting: ${meeting.title}
Time: ${meeting.start_time ? format(new Date(meeting.start_time), "PPp") : "TBD"}
Attendees: ${attendees}

Brief:
${brief}
    `.trim();

    navigator.clipboard.writeText(text);
    toast.success("Brief copied to clipboard!");
  };

  const handleRefresh = async () => {
    if (!meetingId) return;
    setBriefLoading(true);
    setBrief(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("prepare-meeting", {
        body: { meeting_id: meetingId },
      });

      if (fnError) throw fnError;

      if (data?.brief) {
        setBrief(data.brief);
        toast.success("Brief refreshed!");
      }
    } catch (err: any) {
      console.error("Failed to refresh brief:", err);
      toast.error("Failed to refresh meeting brief.");
    } finally {
      setBriefLoading(false);
    }
  };

  const formatMeetingTime = (startTime: string, endTime?: string) => {
    const start = new Date(startTime);
    const timeStr = format(start, "EEEE, MMMM d · h:mm a");
    if (endTime) {
      const end = new Date(endTime);
      const duration = Math.round((end.getTime() - start.getTime()) / 60000);
      return `${timeStr} (${duration} min)`;
    }
    return timeStr;
  };

  const getAttendees = (): { name: string; role: string | null }[] => {
    if (!meeting?.attendees || !Array.isArray(meeting.attendees)) return [];
    return meeting.attendees.map((a: any) => {
      if (typeof a === "string") return { name: a, role: null };
      return { name: a.email || a.name || "Unknown", role: null };
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar isAuthenticated userName={displayName} />

      <main className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Back Button */}
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">Loading meeting details...</p>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="flex items-center gap-3 p-4 rounded-md border border-error/20 bg-error/5">
              <AlertTriangle className="h-5 w-5 text-error shrink-0" />
              <p className="text-sm text-foreground">{error}</p>
            </div>
          )}

          {/* Meeting Content */}
          {!loading && !error && meeting && (
            <>
              {/* Meeting Header */}
              <div className="mb-8">
                <div className="flex items-center gap-2 text-primary mb-2">
                  <Calendar className="h-5 w-5" />
                </div>
                <h1 className="text-page-title text-foreground mb-2">{meeting.title}</h1>
                <p className="text-muted-foreground">
                  {meeting.start_time ? formatMeetingTime(meeting.start_time, meeting.end_time) : "Time not set"}
                </p>
              </div>

              {/* Attendees */}
              {getAttendees().length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Attendees</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {getAttendees().map((attendee) => (
                      <div key={attendee.name} className="flex items-center gap-2">
                        <PMAvatar name={attendee.name} size="sm" />
                        <div>
                          <span className="text-sm text-foreground">{attendee.name}</span>
                          {attendee.role && (
                            <span className="text-small text-muted-foreground ml-1">({attendee.role})</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <hr className="border-border mb-8" />

              {/* AI Meeting Brief */}
              <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-caption text-muted-foreground">AI MEETING BRIEF</span>
                </div>

                {briefLoading && (
                  <div className="flex items-center gap-3 p-6 bg-secondary-bg rounded-md">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Generating meeting brief...</span>
                  </div>
                )}

                {!briefLoading && brief && (
                  <div className="bg-primary/5 border border-primary/20 rounded-md p-5">
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {brief}
                    </p>
                  </div>
                )}

                {!briefLoading && !brief && (
                  <div className="text-center py-8 bg-secondary-bg rounded-md">
                    <p className="text-sm text-muted-foreground">
                      No brief available for this meeting yet.
                    </p>
                  </div>
                )}
              </section>

              {/* Description if available */}
              {meeting.description && (
                <>
                  <hr className="border-border mb-8" />
                  <section className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-caption text-muted-foreground">MEETING DESCRIPTION</span>
                    </div>
                    <div className="bg-secondary-bg rounded-md p-4">
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                        {meeting.description}
                      </p>
                    </div>
                  </section>
                </>
              )}

              <hr className="border-border mb-8" />

              {/* Footer Actions */}
              <div className="flex flex-col sm:flex-row gap-3">
                <PMButton
                  variant="primary"
                  onClick={handleCopyBrief}
                  className="gap-2"
                  disabled={!brief}
                >
                  <Copy className="h-4 w-4" />
                  Copy Brief to Clipboard
                </PMButton>
                <PMButton
                  variant="secondary"
                  onClick={handleRefresh}
                  className="gap-2"
                  disabled={briefLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${briefLoading ? "animate-spin" : ""}`} />
                  {briefLoading ? "Generating..." : "Refresh"}
                </PMButton>
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default MeetingPrep;
