"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function CopyInline({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ml-1 inline-flex translate-y-px items-center rounded border border-border/70 bg-background/80 px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/** Firebase-ish ids and labeled clientUserId=… snippets become copyable. */
function withCopyableIds(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re =
    /(clientUserId\s*[:=]\s*)([A-Za-z0-9_-]{16,})|(\b[A-Za-z0-9]{20,}\b)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] && match[2]) {
      parts.push(
        <span key={`id-${key++}`} className="inline-flex items-center break-all font-mono text-[12px]">
          {match[1]}
          <span className="rounded bg-background/70 px-1">{match[2]}</span>
          <CopyInline value={match[2]} />
        </span>
      );
    } else if (match[3]) {
      parts.push(
        <span key={`id-${key++}`} className="inline-flex items-center break-all font-mono text-[12px]">
          <span className="rounded bg-background/70 px-1">{match[3]}</span>
          <CopyInline value={match[3]} />
        </span>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(...withCopyableIds(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`b-${key++}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={`i-${key++}`} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`c-${key++}`}
          className="rounded bg-background/80 px-1 py-0.5 font-mono text-[12px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`a-${key++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-violet-700 underline underline-offset-2 dark:text-violet-300"
          >
            {linkMatch[1]}
          </a>
        );
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(...withCopyableIds(text.slice(last)));
  return nodes;
}

/**
 * Lightweight Markdown for Lexi replies (bold, italic, code, links, lists, paragraphs).
 * Avoids a heavy dependency while fixing raw ** markers in chat.
 */
export function LexiMarkdown({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^[-*] /.test(line) || /^\d+\. /.test(line)) {
      const items: string[] = [];
      const ordered = /^\d+\. /.test(line);
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^[-*] /.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\d+\. / : /^[-*] /, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${key++}`}
          className={cn(
            "my-1.5 space-y-1 pl-4 text-[13px] leading-relaxed",
            ordered ? "list-decimal" : "list-disc"
          )}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#{1,3}/)?.[0].length ?? 1;
      const text = line.replace(/^#{1,3} /, "");
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      blocks.push(
        <Tag key={`h-${key++}`} className="mb-1 mt-2 text-sm font-semibold tracking-tight">
          {renderInline(text)}
        </Tag>
      );
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i]) && !/^#{1,3} /.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${key++}`} className="text-[13px] leading-relaxed">
        {renderInline(para.join(" "))}
      </p>
    );
  }

  return <div className={cn("space-y-1.5", className)}>{blocks}</div>;
}
