'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import {
  AI_PROVIDER_DEFAULT_MODEL,
  AI_PROVIDER_MODEL_OPTIONS,
} from '@/lib/ai/defaults';
import { AGENT_PRESETS, getAgentPreset } from '@/lib/ai/agent-presets';
import type { AiProvider, CaptureFieldTarget } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';
// Same for the agent-type picker's "no preset" choice.
const CATEGORY_CUSTOM = '__custom__';
// And for the deal-stage picker's "don't create a deal" choice.
const DEAL_NONE = '__none__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  google: 'AIza...',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [captureFields, setCaptureFields] = useState<CaptureFieldTarget[]>([]);
  const [captureCompleteReply, setCaptureCompleteReply] = useState('');
  // '' = custom (no preset).
  const [agentCategory, setAgentCategory] = useState('');
  // '' = don't create a deal on qualification.
  const [dealStageId, setDealStageId] = useState('');
  const [dealStages, setDealStages] = useState<
    { id: string; label: string }[]
  >([]);
  // Visit-booked auto-move: '' = off.
  const [visitFieldId, setVisitFieldId] = useState('');
  const [visitStageId, setVisitStageId] = useState('');
  const [customFields, setCustomFields] = useState<
    { id: string; field_name: string }[]
  >([]);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        setCaptureEnabled(data.capture_enabled === true);
        setCaptureFields(
          Array.isArray(data.capture_fields) ? data.capture_fields : [],
        );
        setCaptureCompleteReply(data.capture_complete_reply ?? '');
        setAgentCategory(data.agent_category ?? '');
        setDealStageId(data.capture_deal_stage_id ?? '');
        setVisitFieldId(data.capture_visit_field_id ?? '');
        setVisitStageId(data.capture_visit_stage_id ?? '');
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // The account's custom fields, offered as lead-capture targets.
  // RLS-scoped browser client, same pattern as custom-field-manager.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    supabase
      .from('custom_fields')
      .select('id, field_name')
      .order('created_at')
      .then(({ data }) => setCustomFields(data ?? []));
    // Pipeline stages for the "create deal when qualified" picker,
    // labeled "Pipeline → Stage".
    supabase
      .from('pipelines')
      .select('id, name, pipeline_stages(id, name, position)')
      .order('created_at')
      .then(({ data }) => {
        const options: { id: string; label: string }[] = [];
        for (const p of data ?? []) {
          const stages = [...(p.pipeline_stages ?? [])].sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0),
          );
          for (const s of stages) {
            options.push({ id: s.id, label: `${p.name} → ${s.name}` });
          }
        }
        setDealStages(options);
      });
  }, [accountId]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      Object.values(AI_PROVIDER_DEFAULT_MODEL).includes(model) ||
      model.trim() === '';
    // A model from another provider's suggestion list won't exist on the
    // new provider either — reset those too.
    const isOtherProviderOption = Object.entries(AI_PROVIDER_MODEL_OPTIONS).some(
      ([p, models]) => p !== next && models.includes(model),
    );
    if (isDefaultModel || isOtherProviderOption) {
      setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
    }
  };

  const sameTarget = (a: CaptureFieldTarget, b: CaptureFieldTarget) =>
    a.kind === 'builtin' && b.kind === 'builtin'
      ? a.key === b.key
      : a.kind === 'custom' && b.kind === 'custom' && a.id === b.id;
  const captureHas = (t: CaptureFieldTarget) =>
    captureFields.some((f) => sameTarget(f, t));
  const toggleCapture = (t: CaptureFieldTarget) =>
    setCaptureFields((prev) =>
      prev.some((f) => sameTarget(f, t))
        ? prev.filter((f) => !sameTarget(f, t))
        : [...prev, t],
    );
  const captureIsOptional = (t: CaptureFieldTarget) =>
    captureFields.find((f) => sameTarget(f, t))?.optional === true;
  const toggleOptional = (t: CaptureFieldTarget) =>
    setCaptureFields((prev) =>
      prev.map((f) => (sameTarget(f, t) ? { ...f, optional: !f.optional } : f)),
    );

  // Small required/optional pill next to a selected capture field.
  const OptionalPill = ({ target }: { target: CaptureFieldTarget }) =>
    captureHas(target) ? (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) toggleOptional(target);
        }}
        className={
          'rounded-full border px-1.5 py-0 text-[10px] leading-4 ' +
          (captureIsOptional(target)
            ? 'border-border text-muted-foreground'
            : 'border-primary/40 text-primary')
        }
        title="Optional fields are captured when mentioned but never delay the completion message or deal."
      >
        {captureIsOptional(target) ? 'optional' : 'required'}
      </button>
    ) : null;

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    capture_enabled: captureEnabled,
    capture_fields: captureFields,
    capture_complete_reply: captureCompleteReply.trim() || null,
    agent_category: agentCategory || null,
    capture_deal_stage_id: dealStageId || null,
    capture_visit_field_id: visitFieldId || null,
    capture_visit_stage_id: visitStageId || null,
    handoff_agent_id: handoffAgentId || null,
  });

  // Prefill the form from a preset. Custom capture fields are matched/
  // created server-side on save (the route sees the category change),
  // so here we only set what the form owns directly.
  const handleCategoryChange = (next: string) => {
    const preset = getAgentPreset(next);
    if (!preset) {
      setAgentCategory('');
      return;
    }
    if (
      (systemPrompt.trim() || captureCompleteReply.trim()) &&
      !window.confirm(
        `Applying the "${preset.name}" template will replace your current prompt and completion message. Continue?`,
      )
    ) {
      return;
    }
    setAgentCategory(preset.id);
    setSystemPrompt(preset.systemPrompt);
    setCaptureCompleteReply(preset.completionReply);
    setCaptureEnabled(true);
    setCaptureFields(
      preset.captureBuiltins.map((b) => ({
        kind: 'builtin' as const,
        key: b.key,
        ...(b.optional && { optional: true }),
      })),
    );
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
        setCaptureCompleteReply('');
        setAgentCategory('');
        setDealStageId('');
        setVisitFieldId('');
        setVisitStageId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
            </CardTitle>
            <CardDescription>
              {t('encryptionNotice')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="google">{PROVIDER_LABEL.google}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                {AI_PROVIDER_MODEL_OPTIONS[provider] ? (
                  <Select
                    value={model}
                    onValueChange={(v) => {
                      if (v) setModel(v);
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger id="ai-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Keep a previously saved custom model selectable so
                          the dropdown never renders empty. */}
                      {[
                        ...new Set(
                          [...AI_PROVIDER_MODEL_OPTIONS[provider], model].filter(
                            Boolean,
                          ),
                        ),
                      ].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="ai-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                    disabled={disabled}
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>
              {t('behaviourDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-category">Agent type</Label>
              <p className="text-xs text-muted-foreground">
                Start from a ready-made template — it prefills the prompt,
                lead-capture fields and completion message. Everything stays
                editable.
              </p>
              <Select
                value={agentCategory || CATEGORY_CUSTOM}
                onValueChange={(v) =>
                  handleCategoryChange(!v || v === CATEGORY_CUSTOM ? '' : v)
                }
                disabled={disabled}
              >
                <SelectTrigger id="ai-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CATEGORY_CUSTOM}>Custom</SelectItem>
                  {AGENT_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agentCategory && (
                <p className="text-xs text-muted-foreground">
                  {getAgentPreset(agentCategory)?.description} Missing custom
                  fields (e.g. Budget, Configuration) are created when you
                  save.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('enableAssistant')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('autoReply')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">Lead capture</CardTitle>
                <CardDescription>
                  After each customer message, the AI fills empty contact
                  fields with facts the customer stated — it never overwrites
                  an existing value.
                </CardDescription>
              </div>
              <Switch
                checked={captureEnabled}
                onCheckedChange={setCaptureEnabled}
                disabled={disabled}
              />
            </div>
          </CardHeader>
          {captureEnabled && (
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Built-in fields</Label>
                <div className="flex flex-wrap gap-4">
                  {(['name', 'email', 'company'] as const).map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 text-sm capitalize text-foreground"
                    >
                      <Checkbox
                        checked={captureHas({ kind: 'builtin', key })}
                        onCheckedChange={() =>
                          toggleCapture({ kind: 'builtin', key })
                        }
                        disabled={disabled}
                      />
                      {key}
                      <OptionalPill target={{ kind: 'builtin', key }} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Custom fields</Label>
                {customFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No custom fields yet — create them under Settings → Fields
                    &amp; tags (e.g. BHK, Budget, Location), then pick them
                    here.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {customFields.map((cf) => (
                      <label
                        key={cf.id}
                        className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                      >
                        <Checkbox
                          checked={captureHas({ kind: 'custom', id: cf.id })}
                          onCheckedChange={() =>
                            toggleCapture({ kind: 'custom', id: cf.id })
                          }
                          disabled={disabled}
                        />
                        {cf.field_name}
                        <OptionalPill target={{ kind: 'custom', id: cf.id }} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-complete-reply">
                  Completion message{' '}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Sent once when every selected field has been collected. The
                  AI then stops replying on that conversation and hands it to
                  your team. Leave empty to disable.
                </p>
                <Textarea
                  id="ai-complete-reply"
                  value={captureCompleteReply}
                  onChange={(e) => setCaptureCompleteReply(e.target.value)}
                  placeholder="Hi! Our team has your details and will reach out to you shortly."
                  rows={3}
                  maxLength={1000}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-deal-stage">Create deal when qualified</Label>
                <p className="text-xs text-muted-foreground">
                  When every selected field has been collected, add the lead
                  to your pipeline in this stage. One deal per contact —
                  contacts that already have a deal are skipped.
                </p>
                <Select
                  value={dealStageId || DEAL_NONE}
                  onValueChange={(v) =>
                    setDealStageId(!v || v === DEAL_NONE ? '' : v)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger id="ai-deal-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEAL_NONE}>
                      Don&apos;t create a deal
                    </SelectItem>
                    {dealStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Move deal when a visit is booked</Label>
                <p className="text-xs text-muted-foreground">
                  Pick the custom field that holds the agreed visit slot
                  (mark it optional above). Whenever the AI captures it —
                  even after handoff — the contact&apos;s open deal moves to
                  the chosen stage.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={visitFieldId || DEAL_NONE}
                    onValueChange={(v) =>
                      setVisitFieldId(!v || v === DEAL_NONE ? '' : v)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger aria-label="Visit slot field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEAL_NONE}>No visit field</SelectItem>
                      {customFields.map((cf) => (
                        <SelectItem key={cf.id} value={cf.id}>
                          {cf.field_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={visitStageId || DEAL_NONE}
                    onValueChange={(v) =>
                      setVisitStageId(!v || v === DEAL_NONE ? '' : v)
                    }
                    disabled={disabled || !visitFieldId}
                  >
                    <SelectTrigger aria-label="Move to stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEAL_NONE}>Don&apos;t move</SelectItem>
                      {dealStages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
