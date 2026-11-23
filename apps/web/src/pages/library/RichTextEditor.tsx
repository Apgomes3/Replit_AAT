// Word-like article editor: headings, bold/italic/underline, lists, quotes, code, links, tables and
// images (pasted or chosen; stored inside the article). The HTML is cleaned again on the server.
import { useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import toast from 'react-hot-toast';
import {
  Bold, Code2, Columns3, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, Rows3,
  Strikethrough, Table2, Trash2, Underline, Undo2,
} from 'lucide-react';
import './library.css';

const MAX_IMAGE = 3 * 1024 * 1024;

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return reject(new Error('Use a PNG, JPG, GIF or WebP image'));
    if (file.size > MAX_IMAGE) return reject(new Error('Images can be up to 3 MB; attach bigger files instead'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read'));
    reader.readAsDataURL(file);
  });
}

async function insertImages(editor: Editor, files: File[]) {
  for (const f of files) {
    try { editor.chain().focus().setImage({ src: await readImage(f), alt: f.name.replace(/\.[^.]+$/, '') }).run(); }
    catch (e: any) { toast.error(e.message); }
  }
}

function Tool({ on, active, label, children, disabled }: { on: () => void; active?: boolean; label: string; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
    onMouseDown={e => e.preventDefault()} onClick={on}
    className={`p-1.5 rounded-md ${active ? 'bg-blue-100 text-blue-800' : 'text-stone-600 hover:bg-stone-100'} disabled:opacity-30`}>{children}</button>;
}

export default function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] } }),
      Image.configure({ allowBase64: true }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'kb-prose kb-editor', 'aria-label': 'Article text', ...(placeholder ? { 'data-placeholder': placeholder } : {}) },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
        if (!files.length || !editor) return false;
        insertImages(editor, files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
        if (!files.length || !editor) return false;
        event.preventDefault();
        insertImages(editor, files);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  });
  if (!editor) return <div className="h-64 skeleton rounded-xl" />;

  const link = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link address (https://…)', prev ?? 'https://');
    if (href === null) return;
    if (!href.trim() || href.trim() === 'https://') return editor.chain().focus().extendMarkRange('link').unsetLink().run();
    if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) return toast.error('Links start with https:// or mailto:');
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };
  const inTable = editor.isActive('table');
  const c = () => editor.chain().focus();

  return <div className="rounded-xl border border-stone-200 bg-white focus-within:ring-2 focus-within:ring-blue-500/30">
    <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-stone-100 bg-white/95 rounded-t-xl">
      <Tool label="Heading" active={editor.isActive('heading', { level: 2 })} on={() => c().toggleHeading({ level: 2 }).run()}><Heading2 className="w-4 h-4" /></Tool>
      <Tool label="Sub-heading" active={editor.isActive('heading', { level: 3 })} on={() => c().toggleHeading({ level: 3 }).run()}><Heading3 className="w-4 h-4" /></Tool>
      <span className="w-px h-5 bg-stone-200 mx-1" />
      <Tool label="Bold" active={editor.isActive('bold')} on={() => c().toggleBold().run()}><Bold className="w-4 h-4" /></Tool>
      <Tool label="Italic" active={editor.isActive('italic')} on={() => c().toggleItalic().run()}><Italic className="w-4 h-4" /></Tool>
      <Tool label="Underline" active={editor.isActive('underline')} on={() => c().toggleUnderline().run()}><Underline className="w-4 h-4" /></Tool>
      <Tool label="Strike through" active={editor.isActive('strike')} on={() => c().toggleStrike().run()}><Strikethrough className="w-4 h-4" /></Tool>
      <Tool label="Link" active={editor.isActive('link')} on={link}><Link2 className="w-4 h-4" /></Tool>
      <span className="w-px h-5 bg-stone-200 mx-1" />
      <Tool label="Bullet list" active={editor.isActive('bulletList')} on={() => c().toggleBulletList().run()}><List className="w-4 h-4" /></Tool>
      <Tool label="Numbered list" active={editor.isActive('orderedList')} on={() => c().toggleOrderedList().run()}><ListOrdered className="w-4 h-4" /></Tool>
      <Tool label="Quote or note" active={editor.isActive('blockquote')} on={() => c().toggleBlockquote().run()}><Quote className="w-4 h-4" /></Tool>
      <Tool label="Code" active={editor.isActive('codeBlock')} on={() => c().toggleCodeBlock().run()}><Code2 className="w-4 h-4" /></Tool>
      <Tool label="Divider" on={() => c().setHorizontalRule().run()}><Minus className="w-4 h-4" /></Tool>
      <span className="w-px h-5 bg-stone-200 mx-1" />
      <Tool label="Insert image" on={() => fileInput.current?.click()}><ImagePlus className="w-4 h-4" /></Tool>
      <Tool label="Insert table" active={inTable} on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="w-4 h-4" /></Tool>
      {inTable && <>
        <Tool label="Add row below" on={() => c().addRowAfter().run()}><Rows3 className="w-4 h-4" /></Tool>
        <Tool label="Add column right" on={() => c().addColumnAfter().run()}><Columns3 className="w-4 h-4" /></Tool>
        <Tool label="Delete row" on={() => c().deleteRow().run()}><span className="text-[10px] font-bold px-0.5">−row</span></Tool>
        <Tool label="Delete column" on={() => c().deleteColumn().run()}><span className="text-[10px] font-bold px-0.5">−col</span></Tool>
        <Tool label="Delete table" on={() => c().deleteTable().run()}><Trash2 className="w-4 h-4" /></Tool>
      </>}
      <span className="ml-auto" />
      <Tool label="Undo" disabled={!editor.can().undo()} on={() => c().undo().run()}><Undo2 className="w-4 h-4" /></Tool>
      <Tool label="Redo" disabled={!editor.can().redo()} on={() => c().redo().run()}><Redo2 className="w-4 h-4" /></Tool>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden
        onChange={e => { insertImages(editor, Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </div>
    <EditorContent editor={editor} />
  </div>;
}
