"use client";
// src/components/workflow/HistoryPanel.tsx
import { useState } from "react";
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { WorkflowRunRecord, NodeRunRecord } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  runs: WorkflowRunRecord[];
}

export function HistoryPanel({ runs }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <aside className="w-[268px] h-full bg-bg-2 border-l border-border flex flex-col overflow-hidden">
      <div className="px-3.5 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <Clock size={13} className="text-text-3" />
        <span className="font-display font-bold text-sm">Run History</span>
        {runs.length > 0 && (
          <span className="ml-auto font-mono text-[10px] text-text-3 bg-surface px-1.5 py-0.5 rounded">
            {runs.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {runs.length === 0 ? (
          <div className="py-10 text-center text-text-3 font-mono text-xs">
            No runs yet.
            <br />
            Execute a workflow to see history.
          </div>
        ) : (
          runs.map((run) => (
            <RunEntry
              key={run.id}
              run={run}
              isExpanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function RunEntry({
  run, isExpanded, onToggle
}: {
  run: WorkflowRunRecord; isExpanded: boolean; onToggle: () => void;
}) {
  const ts = new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dur = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "";

  return (
    <div className="border border-border rounded-lg mb-1.5 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2.5 bg-surface hover:bg-surface-2 transition-colors text-left"
      >
        <StatusIcon status={run.status} />
        <span className="font-mono text-[10px] text-text-3">#{run.id.slice(-4)}</span>
        <span className="font-mono text-[10px] text-text-3 flex-1 truncate">{run.scope}</span>
        <span className="font-mono text-[10px] text-text-3">{ts}{dur ? ` · ${dur}` : ""}</span>
        <StatusBadge status={run.status} />
        {isExpanded
          ? <ChevronDown size={11} className="text-text-3 shrink-0" />
          : <ChevronRight size={11} className="text-text-3 shrink-0" />}
      </button>

      {isExpanded && (
        <div className="bg-bg-3 border-t border-border p-2 space-y-2">
          {run.nodeRuns.length === 0 ? (
            <p className="text-[10px] font-mono text-text-3">Running…</p>
          ) : (
            run.nodeRuns.map((nr) => (
              <NodeRunLine key={nr.id} nr={nr} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Detect what kind of output a node produced ────────────────────
function getOutputType(nr: NodeRunRecord): "image" | "video" | "text" | "url" | null {
  if (!nr.output) return null;
  const out = nr.output.trim();

  // Image node or crop node output
  if (nr.nodeType === "image" || nr.nodeType === "crop") return "image";

  // Video node or extract frame output
  if (nr.nodeType === "video") return "video";
  if (nr.nodeType === "extract") return "image"; // extracted frame is an image

  // Generic URL detection for any node
  if (out.startsWith("http://") || out.startsWith("https://")) {
    const lower = out.toLowerCase().split("?")[0]; // strip query params
    if (lower.match(/\.(jpg|jpeg|png|gif|webp|avif)$/)) return "image";
    if (lower.match(/\.(mp4|webm|mov|avi)$/))           return "video";
    return "url";
  }

  return "text";
}

function NodeRunLine({ nr }: { nr: NodeRunRecord }) {
  const [imgError, setImgError] = useState(false);
  const dur     = nr.durationMs ? `${(nr.durationMs / 1000).toFixed(1)}s` : "";
  const success = nr.status === "SUCCESS";
  const outType = getOutputType(nr);

  return (
    <div className="space-y-1">
      {/* Status row */}
      <div className="flex items-center gap-1.5">
        {success
          ? <CheckCircle2 size={11} className="text-success shrink-0" />
          : <XCircle     size={11} className="text-danger  shrink-0" />}
        <span className="font-mono text-[10px] text-text-2 flex-1 truncate">{nr.nodeLabel}</span>
        <span className="font-mono text-[10px] text-text-3">{dur}</span>
      </div>

      {/* Output preview */}
      {nr.output && outType === "image" && !imgError && (
        <div className="pl-4 space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={nr.output}
            alt={`Output of ${nr.nodeLabel}`}
            className="w-full max-h-40 object-contain rounded border border-border bg-bg"
            onError={() => setImgError(true)}
          />
          <a
            href={nr.output}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[9px] text-accent hover:underline"
          >
            <ExternalLink size={9} />
            Open full size
          </a>
        </div>
      )}

      {nr.output && outType === "video" && (
        <div className="pl-4 space-y-1">
          <video
            src={nr.output}
            controls
            className="w-full max-h-40 rounded border border-border bg-bg"
          />
          <a
            href={nr.output}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[9px] text-accent hover:underline"
          >
            <ExternalLink size={9} />
            Open video
          </a>
        </div>
      )}

      {nr.output && outType === "url" && (
        <div className="pl-4">
          <a
            href={nr.output}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[9px] text-accent hover:underline break-all"
          >
            <ExternalLink size={9} className="shrink-0" />
            {nr.output.length > 50 ? nr.output.slice(0, 50) + "…" : nr.output}
          </a>
        </div>
      )}

      {nr.output && outType === "text" && (
        <p className="font-mono text-[9px] text-text-3 pl-4 mt-0.5 line-clamp-3">
          ↳ {nr.output}
        </p>
      )}

      {/* Image fallback to link if img fails to load */}
      {nr.output && outType === "image" && imgError && (
        <div className="pl-4">
          <a
            href={nr.output}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[9px] text-accent hover:underline"
          >
            <ExternalLink size={9} />
            View output image
          </a>
        </div>
      )}

      {nr.errorMsg && (
        <p className="font-mono text-[9px] text-danger pl-4 mt-0.5 line-clamp-2">
          ✕ {nr.errorMsg}
        </p>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "SUCCESS") return <CheckCircle2 size={13} className="text-success shrink-0" />;
  if (status === "FAILED")  return <XCircle      size={13} className="text-danger  shrink-0" />;
  if (status === "PARTIAL") return <CheckCircle2 size={13} className="text-warning shrink-0" />;
  return <Clock size={13} className="text-warning animate-pulse shrink-0" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    SUCCESS: "bg-success/10 text-success",
    FAILED:  "bg-danger/10  text-danger",
    PARTIAL: "bg-warning/10 text-warning",
    RUNNING: "bg-warning/20 text-warning animate-pulse",
  };
  return (
    <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide", map[status] ?? "")}>
      {status.toLowerCase()}
    </span>
  );
}