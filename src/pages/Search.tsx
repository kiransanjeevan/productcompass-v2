import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import FeedbackModal from "@/components/search/FeedbackModal";
import DocumentDetailPanel from "@/components/search/DocumentDetailPanel";
import TabularSnippet from "@/components/search/TabularSnippet";
import { PMButton } from "@/components/ui/pm-button";
import { PMBadge } from "@/components/ui/pm-badge";
import { StaggerContainer, StaggerItem } from "@/components/ui/stagger-children";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { ArrowLeft, FileText, Presentation, Sheet, ExternalLink, Sparkles, X, Loader2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";


interface DocumentResult {
  id: string;
  type: "doc" | "slides" | "sheet";
  contentType: "tabular" | "prose";
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
            contentType: (source.content_type === "tabular" || mapDocumentType(source.document_type) === "sheet") ? "tabular" : "prose",
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
    <div className="max-w-[1000px] mx-auto px-6 lg:px-8 py-8">
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
        <h1 className="text-page-title text-foreground mb-1">
          Results for: "{query}"
        </h1>
        {!loading && !error && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Found {results.length} document{results.length !== 1 ? "s" : ""} · Ranked by relevance
            </p>
            {aiAnswer && !showSummary && (
              <PMButton variant="glass" size="sm" onClick={() => setShowSummary(true)} className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                Show AI Summary
              </PMButton>
            )}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-4 py-8">
          <SkeletonShimmer className="h-24 w-full rounded-lg" />
          <SkeletonShimmer className="h-20 w-full rounded-lg" />
          <SkeletonShimmer className="h-20 w-full rounded-lg" />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="flex items-center gap-3 p-4 rounded-lg glass mb-6" style={{ borderColor: "hsl(0 84% 60% / 0.3)" }}>
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
              <div className="glass rounded-lg p-5 border-l-2 border-l-purple">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple" />
                    <span className="font-medium text-foreground">AI Summary</span>
                  </div>
                  <button
                    onClick={() => setShowSummary(false)}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
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
        <StaggerContainer className="space-y-3">
          {results.map((doc) => (
            <StaggerItem key={doc.id}>
              <div className="glass rounded-lg p-4 transition-all duration-200 hover:shadow-glow hover:scale-[1.005] group">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3 flex-1">
                    <div className="mt-0.5 p-1.5 rounded-md bg-white/5 group-hover:bg-white/10 transition-colors">
                      {getFileIcon(doc.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-card-title text-foreground group-hover:text-primary cursor-pointer transition-colors">
                        {doc.title}
                      </h3>
                      {(doc.lastEdited || doc.owner) && (
                        <p className="text-small text-muted-foreground mt-1">
                          {doc.lastEdited && `Last edited: ${doc.lastEdited}`}
                          {doc.lastEdited && doc.owner && " · "}
                          {doc.owner && `Owner: ${doc.owner}`}
                        </p>
                      )}
                      {doc.contentType === "tabular" ? (
                        <TabularSnippet csv={doc.snippet} className="mt-2" />
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {doc.snippet}
                        </p>
                      )}
                      {docSummaries[doc.id] && (
                        <div className="mt-2 p-3 glass rounded-md text-sm text-foreground border-l-2 border-l-purple">
                          <div className="flex items-center gap-1.5 mb-1 text-xs text-purple font-medium">
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
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
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
    </div>
  );
};

export default Search;
