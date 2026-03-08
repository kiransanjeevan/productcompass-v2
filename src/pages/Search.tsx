import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import FeedbackModal from "@/components/search/FeedbackModal";
import DocumentDetailPanel from "@/components/search/DocumentDetailPanel";
import { PMButton } from "@/components/ui/pm-button";
import { PMBadge } from "@/components/ui/pm-badge";
import { ArrowLeft, FileText, Presentation, Sheet, ExternalLink, Sparkles, X, Loader2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";


interface DocumentResult {
  id: string;
  type: "doc" | "slides" | "sheet";
  title: string;
  matchScore: number;
  lastEdited?: string;
  owner: string;
  snippet: string;
  excerpts?: string[];
  folder?: string;
  url?: string;
}

function mapDocumentType(docType: string): "doc" | "slides" | "sheet" {
  const lower = (docType || "").toLowerCase();
  if (lower.includes("slide") || lower.includes("presentation")) return "slides";
  if (lower.includes("sheet") || lower.includes("spreadsheet")) return "sheet";
  return "doc";
}

const Search = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const { user } = useAuth();
  const displayName = getUserDisplayName(user);

  const [results, setResults] = useState<DocumentResult[]>([]);
  const [aiAnswer, setAiAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSummary, setShowSummary] = useState(false);
  const [summarizingDocId, setSummarizingDocId] = useState<string | null>(null);
  const [docSummaries, setDocSummaries] = useState<Record<string, string>>({});
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentResult | null>(null);

  // Fetch search results from edge function
  useEffect(() => {
    if (!query) return;

    const fetchResults = async () => {
      setLoading(true);
      setError(null);
      setResults([]);
      setAiAnswer("");
      setShowSummary(false);

      try {
        const { data, error: fnError } = await supabase.functions.invoke("search-documents", {
          body: { query },
        });

        if (fnError) throw fnError;

        if (data?.answer) {
          setAiAnswer(data.answer);
        }

        if (data?.sources && Array.isArray(data.sources)) {
          const mapped: DocumentResult[] = data.sources.map((source: any, index: number) => ({
            id: source.document_id || String(index),
            type: mapDocumentType(source.document_type),
            title: source.document_title || "Untitled Document",
            matchScore: Math.round((source.similarity || 0) * 100),
            owner: source.document_owner || "",
            snippet: source.chunk_text || "",
            excerpts: source.chunk_text ? [source.chunk_text] : [],
            url: source.document_url,
          }));
          setResults(mapped);
        }
      } catch (err: any) {
        console.error("Search error:", err);
        setError("Failed to search documents. Please try again.");
        toast.error("Search failed. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [query]);

  const getFileIcon = (type: string) => {
    switch (type) {
      case "doc":
        return <FileText className="h-5 w-5 text-primary" />;
      case "slides":
        return <Presentation className="h-5 w-5 text-orange" />;
      case "sheet":
        return <Sheet className="h-5 w-5 text-success" />;
      default:
        return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getScoreBadgeVariant = (score: number): "high" | "medium" | "low" => {
    if (score >= 90) return "high";
    if (score >= 70) return "medium";
    return "low";
  };

  const handleSummarizeDoc = async (doc: DocumentResult) => {
    setSummarizingDocId(doc.id);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("search-documents", {
        body: { query: `Summarize the key points of ${doc.title}` },
      });
      if (fnError) throw fnError;
      if (data?.answer) {
        setDocSummaries((prev) => ({ ...prev, [doc.id]: data.answer }));
      }
    } catch (err) {
      console.error("Summarize error:", err);
      toast.error("Failed to summarize document.");
    } finally {
      setSummarizingDocId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar isAuthenticated userName={displayName} />

      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

          {/* Header */}
          <div className="mb-6">
            <div>
              <h1 className="text-page-title text-foreground mb-1">
                Results for: "{query}"
              </h1>
              {!loading && !error && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    Found {results.length} document{results.length !== 1 ? "s" : ""} · Ranked by relevance to your query
                  </p>
                  {aiAnswer && !showSummary && (
                    <PMButton variant="secondary" size="sm" onClick={() => setShowSummary(true)} className="gap-1.5">
                      <Sparkles className="h-3 w-3" />
                      Show AI Summary
                    </PMButton>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">Searching your documents...</p>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="flex items-center gap-3 p-4 rounded-md border border-error/20 bg-error/5 mb-6">
              <AlertTriangle className="h-5 w-5 text-error shrink-0" />
              <p className="text-sm text-foreground">{error}</p>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && results.length === 0 && query && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-2">No documents matched your query.</p>
              <p className="text-sm text-muted-foreground">Try a different search term or make sure your documents are indexed.</p>
            </div>
          )}

          {/* AI Summary */}
          {!loading && !error && (
            <AnimatePresence>
              {showSummary && aiAnswer && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6"
                >
                  <div className="bg-primary/5 border border-primary/20 rounded-md p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span className="font-medium text-foreground">AI Summary</span>
                      </div>
                      <button
                        onClick={() => setShowSummary(false)}
                        className="p-1 hover:bg-primary/10 rounded transition-colors"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Based on {results.length} document{results.length !== 1 ? "s" : ""} about "{query}":
                    </p>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {aiAnswer}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Document Results */}
          {!loading && !error && results.length > 0 && (
            <div className="space-y-0">
              {results.map((doc, index) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className="border-b border-border py-4 hover:bg-secondary-bg/50 -mx-4 px-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3 flex-1">
                      {getFileIcon(doc.type)}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-card-title text-foreground hover:text-primary cursor-pointer">
                          {doc.title}
                        </h3>
                        {(doc.lastEdited || doc.owner) && (
                          <p className="text-small text-muted-foreground mt-1">
                            {doc.lastEdited && `Last edited: ${doc.lastEdited}`}
                            {doc.lastEdited && doc.owner && " • "}
                            {doc.owner && `Owner: ${doc.owner}`}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {doc.snippet}
                        </p>
                        {docSummaries[doc.id] && (
                          <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded text-sm text-foreground">
                            <div className="flex items-center gap-1.5 mb-1 text-xs text-primary font-medium">
                              <Sparkles className="h-3 w-3" />
                              AI Summary
                            </div>
                            {docSummaries[doc.id]}
                          </div>
                        )}
                        <div className="flex gap-2 mt-3">
                          {doc.url && (
                            <PMButton
                              variant="ghost"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => window.open(doc.url, "_blank")}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open in Drive
                            </PMButton>
                          )}
                          <PMButton
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSummarizeDoc(doc)}
                            disabled={summarizingDocId === doc.id}
                            className="gap-1.5"
                          >
                            {summarizingDocId === doc.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3" />
                            )}
                            {summarizingDocId === doc.id ? "Summarizing..." : "Summarize"}
                          </PMButton>
                          <PMButton variant="ghost" size="sm" onClick={() => setSelectedDoc(doc)}>
                            View Details
                          </PMButton>
                        </div>
                      </div>
                    </div>
                    <PMBadge variant={getScoreBadgeVariant(doc.matchScore)}>
                      {doc.matchScore}% match
                    </PMBadge>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Feedback Link */}
          {!loading && (
            <div className="pt-6 text-center">
              <button
                onClick={() => setFeedbackOpen(true)}
                className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"
              >
                Can't find what you need?
              </button>
            </div>
          )}

          <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} query={query} />
          <DocumentDetailPanel
            doc={selectedDoc}
            open={!!selectedDoc}
            onClose={() => setSelectedDoc(null)}
            query={query}
          />
        </motion.div>
      </main>
    </div>
  );
};

export default Search;
