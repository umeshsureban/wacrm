'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Image as ImageIcon, Loader2, Paperclip, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import {
  deleteAccountMedia,
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { MAX_ATTACHMENT_CATALOG } from '@/lib/ai/attachments';

// Same bucket the inbox composer + template manager upload to
// (literal like template-manager.tsx — importing the composer's
// CHAT_MEDIA_BUCKET would drag that whole component into this bundle).
const CHAT_MEDIA_BUCKET = 'chat-media';

interface AttachmentRow {
  id: string;
  name: string;
  description: string;
  kind: 'image' | 'document';
  url: string;
  filename: string | null;
}

// Mirrors the chat-media bucket's PDF/image allow-list (migration 023).
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

/**
 * AI attachment library — files (images / PDFs) the auto-reply agent
 * may send during conversations. Each entry pairs an uploaded file
 * with a name and a "send when…" description; the agent sees the list
 * in its system prompt and picks the relevant one.
 */
export function AiAttachmentsCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedAccountIdRef = useRef<string | null>(null);
  const t = useTranslations('Settings.aiAttachments');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/attachments');
      const data = await res.json();
      if (res.ok) setItems(data.attachments ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchItems();
  }, [accountId, fetchItems]);

  const resetForm = () => {
    setAdding(false);
    setFile(null);
    setName('');
    setDescription('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onPickFile = (picked: File | null) => {
    setFile(picked);
    // Prefill the name from the file so the admin only tweaks it.
    if (picked && !name.trim()) {
      setName(picked.name.replace(/\.[^.]+$/, '').slice(0, 80));
    }
  };

  const save = async () => {
    if (!file || !name.trim() || !description.trim()) {
      toast.error(t('fieldsRequired'));
      return;
    }
    const kind = file.type === 'application/pdf' ? 'document' : 'image';
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > maxBytes) {
      toast.error(t('fileTooLarge', { max: Math.round(maxBytes / 1024 / 1024) }));
      return;
    }
    setSaving(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      const res = await fetch('/api/ai/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          kind,
          url: publicUrl,
          storagePath: path,
          filename: kind === 'document' ? file.name : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        resetForm();
        await fetchItems();
      } else {
        // GC the freshly-uploaded object so a rejected register doesn't
        // orphan it in the public bucket (same pattern as the composer).
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/attachments/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setItems((list) => list.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const full = items.length >= MAX_ATTACHMENT_CATALOG;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {items.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground">{t('noItems')}</p>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {item.kind === 'document' ? (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">
                          {item.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
                        onClick={() => void remove(item.id)}
                        title={t('delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {adding ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-att-file">{t('file')}</Label>
                  <Input
                    id="ai-att-file"
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-att-name">{t('name')}</Label>
                  <Input
                    id="ai-att-name"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-att-desc">{t('sendWhen')}</Label>
                  <Textarea
                    id="ai-att-desc"
                    value={description}
                    maxLength={200}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('sendWhenPlaceholder')}
                    rows={2}
                    disabled={saving}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={resetForm} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('save')}
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAdding(true)}
                    disabled={full}
                    title={full ? t('fullTooltip') : undefined}
                  >
                    <Plus className="mr-2 h-4 w-4" /> {t('add')}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {items.length} / {MAX_ATTACHMENT_CATALOG}
                  </span>
                </div>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
