'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Eye,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Phone,
  Upload,
  Video,
  X,
} from 'lucide-react';

/** Convert WhatsApp markdown (*bold*, _italic_) to inline JSX spans. */
function renderWhatsAppText(text: string): React.ReactNode {
  const parts = text.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~)/g);
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*'))
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    if (part.startsWith('_') && part.endsWith('_'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('~') && part.endsWith('~'))
      return <s key={i}>{part.slice(1, -1)}</s>;
    return part;
  });
}

type VariableType = 'static' | 'field' | 'custom_field';

interface VariableMapping {
  type: VariableType;
  value: string;
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  headerMedia: string;
  onHeaderMediaChange: (url: string) => void;
  headerMediaId: string;
  onHeaderMediaIdChange: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}

const contactFields = [
  { value: 'name', label: 'Contact Name' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email Address' },
  { value: 'company', label: 'Company' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface VariableRowProps {
  varKey: string;
  placeholder: string;
  mapping: VariableMapping;
  customFields: CustomField[];
  loadingFields: boolean;
  onUpdate: (key: string, patch: Partial<VariableMapping>) => void;
}

function VariableRow({
  varKey,
  placeholder,
  mapping,
  customFields,
  loadingFields,
  onUpdate,
}: VariableRowProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-violet-500/10 px-2 py-0.5 text-xs font-mono font-medium text-violet-400">
          {placeholder}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Mapping Type
          </label>
          <Select
            value={mapping.type}
            onValueChange={(val) =>
              onUpdate(varKey, { type: val as VariableType, value: '' })
            }
          >
            <SelectTrigger className="w-full border-slate-700 bg-slate-800 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-800">
              <SelectItem value="static">Static Value</SelectItem>
              <SelectItem value="field">Contact Field</SelectItem>
              <SelectItem value="custom_field">Custom Field</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            {mapping.type === 'static' ? 'Value' : 'Field'}
          </label>
          {mapping.type === 'static' ? (
            <Input
              value={mapping.value}
              onChange={(e) => onUpdate(varKey, { value: e.target.value })}
              placeholder="Enter value..."
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          ) : mapping.type === 'field' ? (
            <Select
              value={mapping.value || null}
              onValueChange={(val) => onUpdate(varKey, { value: val ?? '' })}
            >
              <SelectTrigger className="w-full border-slate-700 bg-slate-800 text-white">
                <SelectValue placeholder="Select field..." />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                {contactFields.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={mapping.value || null}
              onValueChange={(val) => onUpdate(varKey, { value: val ?? '' })}
            >
              <SelectTrigger className="w-full border-slate-700 bg-slate-800 text-white">
                <SelectValue
                  placeholder={
                    loadingFields
                      ? 'Loading…'
                      : customFields.length === 0
                        ? 'No custom fields'
                        : 'Select custom field…'
                  }
                />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                {customFields.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.field_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  headerMedia,
  onHeaderMediaChange,
  headerMediaId,
  onHeaderMediaIdChange,
  onNext,
  onBack,
}: Step3Props) {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [fieldsRes, contactRes] = await Promise.all([
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase
          .from('contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.data ?? []);
      setLoadingFields(false);

      const contact = contactRes.data ?? null;
      setFirstContact(contact);

      if (contact) {
        const { data: customVals } = await supabase
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of customVals ?? []) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Header placeholders use key "header_N"; body placeholders use "N".
  const headerPlaceholders = useMemo(() => {
    if (template.header_type !== 'text' || !template.header_content) return [];
    const matches = template.header_content.match(/\{\{(\d+)\}\}/g);
    return matches ? [...new Set(matches)].sort() : [];
  }, [template.header_type, template.header_content]);

  const bodyPlaceholders = useMemo(() => {
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [template.body_text]);

  /**
   * A placeholder is "unmapped" if the user hasn't picked either a
   * static value or a field/custom-field source. Blocks Next until
   * every placeholder has something — otherwise the broadcast would
   * ship with empty strings and confuse recipients.
   */
  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const placeholder of headerPlaceholders) {
      const key = `header_${placeholder.replace(/^\{\{|\}\}$/g, '')}`;
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) missing.push(`Header ${placeholder}`);
    }
    for (const placeholder of bodyPlaceholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) missing.push(placeholder);
    }
    return missing;
  }, [headerPlaceholders, bodyPlaceholders, variables]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? { type: 'static' as VariableType, value: '' };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch },
    });
  }

  function resolvePreviewValue(
    mapping: VariableMapping | undefined,
    placeholder: string,
    contact: Contact,
    customValues: Map<string, string>,
  ): string {
    if (!mapping) return placeholder;
    if (mapping.type === 'static' && mapping.value) return mapping.value;
    if (mapping.type === 'field' && mapping.value) {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[mapping.value] ?? placeholder;
    }
    if (mapping.type === 'custom_field' && mapping.value) {
      return customValues.get(mapping.value) || placeholder;
    }
    return placeholder;
  }

  /**
   * Substitute placeholders using the first real contact where
   * possible. Header uses "header_N" keys; body uses "N" keys.
   */
  const { previewHeader, previewText } = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let header: string | null = null;
    if (template.header_type === 'text' && template.header_content) {
      header = template.header_content;
      for (const placeholder of headerPlaceholders) {
        const key = `header_${placeholder.replace(/^\{\{|\}\}$/g, '')}`;
        header = header.replaceAll(
          placeholder,
          resolvePreviewValue(variables[key], placeholder, contact, customValues),
        );
      }
    }

    let text = template.body_text;
    for (const placeholder of bodyPlaceholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      text = text.replaceAll(
        placeholder,
        resolvePreviewValue(variables[key], placeholder, contact, customValues),
      );
    }

    return { previewHeader: header, previewText: text };
  }, [
    template.header_type,
    template.header_content,
    template.body_text,
    variables,
    headerPlaceholders,
    bodyPlaceholders,
    firstContact,
    firstContactCustomValues,
  ]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : 'sample data';

  const needsHeaderMedia =
    template.header_type === 'image' ||
    template.header_type === 'video' ||
    template.header_type === 'document';

  const [headerMediaInput, setHeaderMediaInput] = useState(headerMedia);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState('');

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/whatsapp/media/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onHeaderMediaIdChange(data.mediaId);
      // Clear any URL input since we now have an uploaded file
      setHeaderMediaInput('');
      onHeaderMediaChange('');
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      setLocalPreview('');
      const msg = err instanceof Error ? err.message : 'Upload failed';
      // surface the error inline — toast not imported here, use a local state flag
      alert(msg);
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-selected
      e.target.value = '';
    }
  }

  function clearHeaderMedia() {
    setHeaderMediaInput('');
    onHeaderMediaChange('');
    onHeaderMediaIdChange('');
    if (localPreview) { URL.revokeObjectURL(localPreview); setLocalPreview(''); }
  }

  const hasHeaderMedia = !!(headerMedia || headerMediaId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Personalize Message</h2>
        <p className="mt-1 text-sm text-slate-400">
          Map template variables to contact fields, custom fields, or static
          values.
        </p>
      </div>

      {headerPlaceholders.length === 0 && bodyPlaceholders.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center">
          <p className="text-sm text-slate-400">
            This template has no variables to personalize.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {headerPlaceholders.length > 0 && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Header Variables
              </p>
              {headerPlaceholders.map((placeholder) => {
                const key = `header_${placeholder.replace(/^\{\{|\}\}$/g, '')}`;
                const mapping = variables[key] ?? { type: 'static', value: '' };
                return (
                  <VariableRow
                    key={key}
                    varKey={key}
                    placeholder={placeholder}
                    mapping={mapping}
                    customFields={customFields}
                    loadingFields={loadingFields}
                    onUpdate={updateVariable}
                  />
                );
              })}
            </div>
          )}

          {bodyPlaceholders.length > 0 && (
            <div className="space-y-4">
              {headerPlaceholders.length > 0 && (
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Body Variables
                </p>
              )}
              {bodyPlaceholders.map((placeholder) => {
                const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                const mapping = variables[key] ?? { type: 'static', value: '' };
                return (
                  <VariableRow
                    key={key}
                    varKey={key}
                    placeholder={placeholder}
                    mapping={mapping}
                    customFields={customFields}
                    loadingFields={loadingFields}
                    onUpdate={updateVariable}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Header media input — shown when template needs an image/video/document */}
      {needsHeaderMedia && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-violet-500/10 px-2 py-0.5 text-xs font-mono font-medium text-violet-400 uppercase tracking-wide">
                {template.header_type} header
              </span>
            </div>
            {hasHeaderMedia && (
              <button
                onClick={clearHeaderMedia}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <X className="h-3 w-3" /> Remove
              </button>
            )}
          </div>

          {/* Show current selection if one exists */}
          {(localPreview || headerMedia) && template.header_type === 'image' && (
            <div className="overflow-hidden rounded-lg border border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={localPreview || headerMedia}
                alt="Header preview"
                className="max-h-48 w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  (e.currentTarget.nextSibling as HTMLElement | null)?.removeAttribute('hidden');
                }}
              />
              <p hidden className="px-3 py-2 text-xs text-amber-400">
                Could not load image — check the URL is publicly accessible.
              </p>
            </div>
          )}
          {headerMediaId && !localPreview && (
            <p className="text-xs text-emerald-400">
              File uploaded to WhatsApp ✓
            </p>
          )}

          {/* Upload from laptop */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Upload from laptop
            </label>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${uploading ? 'border-slate-700 opacity-60 cursor-not-allowed' : 'border-slate-700 text-slate-400 hover:border-violet-500/50 hover:text-violet-400'}`}>
              {uploading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-4 w-4" /> Choose file</>
              )}
              <input
                type="file"
                accept={template.header_type === 'image' ? 'image/jpeg,image/png,image/webp,image/gif' : template.header_type === 'video' ? 'video/mp4,video/3gpp' : 'application/pdf'}
                disabled={uploading}
                onChange={handleFileSelect}
                className="sr-only"
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-600">
              {template.header_type === 'image' ? 'JPG, PNG, WEBP, GIF · max 16 MB' : template.header_type === 'video' ? 'MP4, 3GPP · max 16 MB' : 'PDF · max 16 MB'}
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-xs text-slate-600">or paste a URL</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          {/* URL input */}
          <div>
            <div className="relative">
              <Upload className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={headerMediaInput}
                onChange={(e) => setHeaderMediaInput(e.target.value)}
                onBlur={() => { onHeaderMediaChange(headerMediaInput.trim()); if (headerMediaInput.trim()) onHeaderMediaIdChange(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onHeaderMediaChange(headerMediaInput.trim()); if (headerMediaInput.trim()) onHeaderMediaIdChange(''); }
                }}
                placeholder={
                  template.header_type === 'image'
                    ? 'https://example.com/image.jpg'
                    : template.header_type === 'video'
                      ? 'https://example.com/video.mp4'
                      : 'https://example.com/document.pdf'
                }
                className="border-slate-700 bg-slate-800 pl-9 text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          {!hasHeaderMedia && (
            <p className="text-xs text-amber-400/80">
              Upload a file or paste a URL — required before sending.
            </p>
          )}
        </div>
      )}

      {/* Live Preview — WhatsApp phone mockup */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-violet-400" />
          <p className="text-sm font-medium text-white">Live Preview</p>
          <span className="text-xs text-slate-500">({previewLabel})</span>
          {loadingPreview && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
          )}
        </div>

        <div className="flex justify-center py-2">
          {/* Phone shell */}
          <div className="relative w-[272px] overflow-hidden rounded-[38px] border-[6px] border-slate-700 bg-black shadow-2xl shadow-black/60">
            {/* Status bar */}
            <div className="flex items-center justify-between bg-[#075E54] px-5 pt-2 pb-1">
              <span className="text-[11px] font-semibold text-white">9:41</span>
              <div className="flex items-center gap-1.5">
                {/* Signal */}
                <svg viewBox="0 0 16 12" className="h-3 w-3.5 fill-white">
                  <rect x="0" y="6" width="3" height="6" rx="0.5" />
                  <rect x="4.5" y="4" width="3" height="8" rx="0.5" />
                  <rect x="9" y="2" width="3" height="10" rx="0.5" />
                  <rect x="13.5" y="0" width="2.5" height="12" rx="0.5" />
                </svg>
                {/* Wifi */}
                <svg viewBox="0 0 20 14" className="h-3 w-3.5 fill-white">
                  <path d="M10 11a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
                  <path d="M10 7.5C8.2 7.5 6.6 8.2 5.4 9.3l1.4 1.4A5 5 0 0110 9.5c1.2 0 2.3.5 3.2 1.2l1.4-1.4C13.4 8.2 11.8 7.5 10 7.5z" />
                  <path d="M10 4C7.1 4 4.5 5.1 2.6 7l1.4 1.4A8 8 0 0110 6c2.3 0 4.4.9 5.9 2.4L17.4 7C15.5 5.1 12.9 4 10 4z" />
                </svg>
                {/* Battery */}
                <div className="flex items-center gap-px">
                  <div className="relative h-[10px] w-[18px] overflow-hidden rounded-[2px] border border-white/80">
                    <div className="absolute inset-y-0 left-0 w-[75%] rounded-[1px] bg-white" />
                  </div>
                  <div className="h-[5px] w-[2px] rounded-r-sm bg-white/60" />
                </div>
              </div>
            </div>

            {/* WhatsApp nav bar */}
            <div className="flex items-center gap-2 bg-[#075E54] px-3 pb-2">
              <ChevronLeft className="h-5 w-5 text-white" />
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                WA
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold leading-tight text-white">
                  Your Business
                </p>
                <p className="text-[10px] leading-tight text-green-200">online</p>
              </div>
              <Video className="h-4 w-4 text-white" />
              <Phone className="h-4 w-4 text-white" />
              <MoreVertical className="h-4 w-4 text-white" />
            </div>

            {/* Chat area */}
            <div
              className="min-h-[340px] p-3"
              style={{ backgroundColor: '#ECE5DD' }}
            >
              {/* Message bubble */}
              <div className="max-w-[90%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm">
                {/* Header: image */}
                {template.header_type === 'image' && (
                  (localPreview || headerMedia) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={localPreview || headerMedia}
                      alt="Header"
                      className="h-40 w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex h-40 flex-col items-center justify-center gap-2 bg-slate-200">
                      <ImageIcon className="h-8 w-8 text-slate-400" />
                      <span className="text-[11px] text-slate-400">Upload or paste URL above</span>
                    </div>
                  )
                )}
                {/* Header: video placeholder */}
                {template.header_type === 'video' && (
                  <div className="flex h-40 items-center justify-center bg-slate-800">
                    <Video className="h-10 w-10 text-slate-300" />
                  </div>
                )}
                {/* Header: text */}
                {template.header_type === 'text' && previewHeader && (
                  <p className="px-3 pt-2.5 text-[13px] font-bold leading-snug text-slate-900">
                    {renderWhatsAppText(previewHeader)}
                  </p>
                )}

                {/* Body text */}
                <p className="whitespace-pre-wrap px-3 py-2 text-[13px] leading-snug text-slate-800">
                  {renderWhatsAppText(previewText)}
                </p>

                {/* Footer */}
                {template.footer_text && (
                  <p className="px-3 pb-2 text-[11px] text-slate-400">
                    {template.footer_text}
                  </p>
                )}

                {/* Timestamp */}
                <div className="flex items-center justify-end gap-1 px-3 pb-1.5">
                  <span className="text-[10px] text-slate-400">9:41 AM</span>
                  <svg viewBox="0 0 16 11" className="h-2.5 w-4 fill-[#53BDEB]">
                    <path d="M15.01.99l-8.5 8.5-3.5-3.5L1.6 7.4l4.91 4.91L16.4 2.4 15.01.99zm-4.5 0L2 9.5.61 8.11 9.12-.4 10.51.99z" />
                  </svg>
                </div>

                {/* Buttons */}
                {template.buttons && template.buttons.length > 0 && (
                  <div className="border-t border-slate-100">
                    {template.buttons.map((btn, i) => {
                      const label =
                        (btn as Record<string, unknown>).text as string ||
                        (btn as Record<string, unknown>).url_text as string ||
                        'Button';
                      return (
                        <div
                          key={i}
                          className="border-b border-slate-100 py-2 text-center text-[13px] font-medium text-[#53BDEB] last:border-b-0"
                        >
                          {label}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Home bar */}
            <div className="flex items-center justify-center bg-white py-2">
              <div className="h-1 w-20 rounded-full bg-slate-300" />
            </div>
          </div>
        </div>
      </div>

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Map every placeholder before continuing — still missing{' '}
          <span className="font-mono font-semibold">
            {unmappedKeys.join(', ')}
          </span>
          . Otherwise those placeholders will ship to Meta as empty strings.
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={unmappedKeys.length > 0 || (needsHeaderMedia && !hasHeaderMedia)}
          className="bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
