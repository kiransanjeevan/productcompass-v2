import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, FileText, Settings, Home, RefreshCw, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const RECENT_SEARCHES_KEY = "pm-compass-recent-searches";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  document_id: string;
  document_title: string;
  similarity: number;
  chunk_text: string;
}

const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Load recent searches
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await supabase.functions.invoke("search-documents", {
          body: { query },
        });
        if (data?.sources) {
          // Deduplicate by document_id
          const seen = new Set<string>();
          const deduped = data.sources.filter((s: SearchResult) => {
            if (seen.has(s.document_id)) return false;
            seen.add(s.document_id);
            return true;
          });
          setResults(deduped.slice(0, 5));
        }
      } catch {
        // Silently fail in palette
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((searchQuery: string) => {
    // Save to recent searches
    const updated = [searchQuery, ...recentSearches.filter(s => s !== searchQuery)].slice(0, 5);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));

    onOpenChange(false);
    setQuery("");
    navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
  }, [navigate, onOpenChange, recentSearches]);

  const handleAction = useCallback((path: string) => {
    onOpenChange(false);
    setQuery("");
    navigate(path);
  }, [navigate, onOpenChange]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-[640px] glass-strong rounded-lg border-border/50 shadow-modal top-[20%] translate-y-0">
        <Command className="bg-transparent" shouldFilter={false}>
          <div className="flex items-center border-b border-border px-4">
            <Search className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandInput
              placeholder="Search documents, navigate, or take action..."
              value={query}
              onValueChange={setQuery}
              className="h-14 text-base border-0 focus:ring-0 bg-transparent placeholder:text-muted-foreground/60"
            />
            <kbd className="ml-2 shrink-0 text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              ESC
            </kbd>
          </div>
          <CommandList className="max-h-[400px] p-2">
            <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
              {searching ? "Searching..." : query ? "No results found." : "Start typing to search..."}
            </CommandEmpty>

            {/* Search Results */}
            {results.length > 0 && (
              <CommandGroup heading="Documents">
                {results.map((result) => (
                  <CommandItem
                    key={result.document_id}
                    onSelect={() => handleSelect(query)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer data-[selected='true']:bg-primary/10 data-[selected='true']:text-foreground"
                  >
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{result.document_title}</p>
                      <p className="text-xs text-muted-foreground truncate">{result.chunk_text?.slice(0, 80)}...</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {Math.round((result.similarity || 0) * 100)}%
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Recent Searches */}
            {!query && recentSearches.length > 0 && (
              <CommandGroup heading="Recent Searches">
                {recentSearches.map((search) => (
                  <CommandItem
                    key={search}
                    onSelect={() => handleSelect(search)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground">{search}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!query && (
              <>
                {recentSearches.length > 0 && <CommandSeparator className="my-1" />}
                <CommandGroup heading="Quick Actions">
                  <CommandItem
                    onSelect={() => handleAction("/dashboard")}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <Home className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Dashboard</span>
                  </CommandItem>
                  <CommandItem
                    onSelect={() => handleAction("/settings")}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Settings</span>
                  </CommandItem>
                  <CommandItem
                    onSelect={() => handleAction("/settings")}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Re-index Documents</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
