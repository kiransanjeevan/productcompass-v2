import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PMButton } from "@/components/ui/pm-button";
import { PMInput } from "@/components/ui/pm-input";
import { PMBadge } from "@/components/ui/pm-badge";
import { StaggerContainer, StaggerItem } from "@/components/ui/stagger-children";
import { ArrowLeft, Sparkles, FileText, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Project { id: string; name: string; }
interface Priority { value: number; label: string; }
interface Grounding { title: string; url: string | null; }
interface Draft { title: string; description: string; priority: number; projectId: string | null; }

const CreateIssue = () => {
  const navigate = useNavigate();
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [grounding, setGrounding] = useState<Grounding[]>([]);
  const [created, setCreated] = useState<{ identifier: string; url: string } | null>(null);

  const handleDraft = async () => {
    if (!instruction.trim()) return;
    setDrafting(true);
    setCreated(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-linear-issue", {
        body: { action: "draft", instruction: instruction.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDraft(data.draft);
      setTeamId(data.teamId);
      setProjects(data.projects ?? []);
      setPriorities(data.priorities ?? []);
      setGrounding(data.grounding ?? []);
    } catch (err) {
      console.error("Draft error:", err);
      toast.error("Failed to draft issue. Is Linear connected?");
    } finally {
      setDrafting(false);
    }
  };

  const handleCreate = async () => {
    if (!draft || !teamId) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-linear-issue", {
        body: {
          action: "create",
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          projectId: draft.projectId,
          teamId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCreated(data.issue);
      setDraft(null);
      setInstruction("");
      toast.success(`Created ${data.issue.identifier}`);
    } catch (err) {
      console.error("Create error:", err);
      toast.error("Failed to create issue in Linear.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-[680px] mx-auto px-6 lg:px-8 py-8">
      <StaggerContainer>
        <StaggerItem>
          <div className="flex items-center justify-between mb-8">
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
            <h1 className="text-section-title text-foreground">Create Linear Issue</h1>
          </div>
        </StaggerItem>

        {/* Instruction input */}
        <StaggerItem>
          <section className="mb-6">
            <h2 className="text-caption text-muted-foreground mb-3">WHAT DO YOU WANT TO TRACK?</h2>
            <div className="p-4 glass rounded-lg space-y-3">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Create an issue to ship native JSON/XLSX export based on the power-user interviews"
                rows={3}
                className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-small text-muted-foreground">
                The draft is grounded in your indexed docs and Linear issues — review and edit before creating.
              </p>
              <PMButton variant="primary" size="sm" onClick={handleDraft} loading={drafting} disabled={!instruction.trim()}>
                <Sparkles className="h-4 w-4 mr-1.5" />
                Draft with AI
              </PMButton>
            </div>
          </section>
        </StaggerItem>

        {/* Created confirmation */}
        {created && (
          <StaggerItem>
            <section className="mb-6">
              <div className="p-4 glass rounded-lg border-success/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" />
                  <span className="text-sm text-foreground">
                    Created <span className="font-mono">{created.identifier}</span> in Linear
                  </span>
                </div>
                <a href={created.url} target="_blank" rel="noopener noreferrer">
                  <PMButton variant="secondary" size="sm">
                    Open <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </PMButton>
                </a>
              </div>
            </section>
          </StaggerItem>
        )}

        {/* Editable draft preview */}
        {draft && (
          <StaggerItem>
            <section className="mb-6">
              <h2 className="text-caption text-muted-foreground mb-3">REVIEW DRAFT</h2>
              <div className="p-4 glass rounded-lg space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Title</label>
                  <PMInput value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Description</label>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={8}
                    className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Priority</label>
                    <select
                      value={draft.priority}
                      onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                      className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-foreground"
                    >
                      {priorities.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Project</label>
                    <select
                      value={draft.projectId ?? ""}
                      onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })}
                      className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {grounding.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-white/10">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Grounded in
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {grounding.map((g, i) => (
                        <PMBadge key={i} variant="default">{g.title}</PMBadge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <PMButton variant="primary" size="sm" onClick={handleCreate} loading={creating} disabled={!draft.title.trim()}>
                    Create in Linear
                  </PMButton>
                  <PMButton variant="secondary" size="sm" onClick={() => setDraft(null)}>
                    Discard
                  </PMButton>
                </div>
              </div>
            </section>
          </StaggerItem>
        )}
      </StaggerContainer>
    </div>
  );
};

export default CreateIssue;
