"use client";

import { useEffect } from "react";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Underline as UnderlineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FontSize } from "@/lib/tiptap-font-size";
import { cn } from "@/lib/utils";

const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
];

const FONT_SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt"];

export function toEditorHtml(value: string): string {
  if (!value) return "<p></p>";
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

type RichTextEditorProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
};

export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-[180px]",
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
    ],
    content: toEditorHtml(value),
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: cn(
          "prose prose-sm max-w-none focus:outline-none px-3 py-2",
          minHeightClassName
        ),
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      onChange(nextEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = toEditorHtml(value);
    if (editor.getHTML() !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        Loading editor...
      </div>
    );
  }

  const currentFont =
    (editor.getAttributes("textStyle").fontFamily as string | undefined) || "default";
  const currentSize =
    (editor.getAttributes("textStyle").fontSize as string | undefined) || "default";

  return (
    <div className="space-y-2">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <div className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 p-2">
          <Button
            type="button"
            size="sm"
            variant={editor.isActive("bold") ? "default" : "outline"}
            className="h-8 w-8 p-0"
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={editor.isActive("italic") ? "default" : "outline"}
            className="h-8 w-8 p-0"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={editor.isActive("underline") ? "default" : "outline"}
            className="h-8 w-8 p-0"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline"
          >
            <UnderlineIcon className="h-4 w-4" />
          </Button>

          <Select
            value={currentFont}
            onValueChange={(font) => {
              if (font === "default") {
                editor.chain().focus().unsetFontFamily().run();
              } else {
                editor.chain().focus().setFontFamily(font).run();
              }
            }}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Font family" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default font</SelectItem>
              {FONT_FAMILIES.map((font) => (
                <SelectItem key={font.label} value={font.value}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentSize}
            onValueChange={(size) => {
              if (size === "default") {
                editor.chain().focus().unsetFontSize().run();
              } else {
                editor.chain().focus().setFontSize(size).run();
              }
            }}
          >
            <SelectTrigger className="h-8 w-[96px] text-xs">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              {FONT_SIZES.map((size) => (
                <SelectItem key={size} value={size}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Color</span>
            <input
              type="color"
              className="h-8 w-10 cursor-pointer rounded border bg-background p-0.5"
              value={(editor.getAttributes("textStyle").color as string) || "#000000"}
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            />
          </label>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => editor.chain().focus().unsetColor().unsetFontFamily().unsetFontSize().run()}
          >
            Clear format
          </Button>
        </div>

        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
