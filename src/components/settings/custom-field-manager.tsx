'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, LayoutList, Type, Hash, Calendar, Link } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { CustomField } from '@/types';

const FIELD_TYPES = [
  { value: 'text', label: 'Text', icon: Type, description: 'Free-form text' },
  { value: 'number', label: 'Number', icon: Hash, description: 'Numeric value' },
  { value: 'date', label: 'Date', icon: Calendar, description: 'Date picker' },
  { value: 'url', label: 'URL', icon: Link, description: 'Web address' },
] as const;

type FieldType = (typeof FIELD_TYPES)[number]['value'];

function FieldTypeIcon({ type }: { type: string }) {
  const match = FIELD_TYPES.find((t) => t.value === type);
  const Icon = match?.icon ?? Type;
  return <Icon className="h-3.5 w-3.5" />;
}

export function CustomFieldManager() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<CustomField | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    fetchFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchFields() {
    setLoading(true);
    const { data, error } = await supabase
      .from('custom_fields')
      .select('*')
      .order('field_name');
    if (error) toast.error('Failed to load custom fields');
    setFields(data ?? []);
    setLoading(false);
  }

  async function handleCreate() {
    if (!fieldName.trim()) { toast.error('Field name is required'); return; }
    if (!user) { toast.error('Not authenticated'); return; }
    setSaving(true);
    const { error } = await supabase.from('custom_fields').insert({
      user_id: user.id,
      field_name: fieldName.trim(),
      field_type: fieldType,
    });
    setSaving(false);
    if (error) { toast.error('Failed to create custom field'); return; }
    toast.success('Custom field created');
    setDialogOpen(false);
    setFieldName('');
    setFieldType('text');
    fetchFields();
  }

  async function handleDelete() {
    if (!fieldToDelete) return;
    setDeleting(true);
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', fieldToDelete.id);
    setDeleting(false);
    if (error) { toast.error('Failed to delete field'); return; }
    toast.success('Custom field deleted');
    setFields((prev) => prev.filter((f) => f.id !== fieldToDelete.id));
    setDeleteDialogOpen(false);
    setFieldToDelete(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Custom Fields</h2>
          <p className="text-sm text-slate-400">
            Add extra data fields to every contact. Use them in broadcast
            personalization and audience filters.
          </p>
        </div>
        <Button
          onClick={() => { setFieldName(''); setFieldType('text'); setDialogOpen(true); }}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="size-4" />
          New Field
        </Button>
      </div>

      {fields.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <LayoutList className="h-8 w-8 text-slate-600" />
            <p className="text-slate-400 text-sm">No custom fields yet.</p>
            <p className="text-slate-500 text-xs">
              Create fields like &quot;City&quot;, &quot;Budget&quot;, or &quot;Signup Date&quot; to enrich contact profiles.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="pt-2">
            <div className="divide-y divide-slate-800">
              {fields.map((field) => (
                <div key={field.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                      <FieldTypeIcon type={field.field_type} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{field.field_name}</p>
                      <p className="text-xs capitalize text-slate-500">{field.field_type}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setFieldToDelete(field); setDeleteDialogOpen(true); }}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">New Custom Field</DialogTitle>
            <DialogDescription className="text-slate-400">
              This field will appear on every contact profile.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-slate-300">Field Name</Label>
              <Input
                placeholder="e.g. City, Budget, Lead Source"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Field Type</Label>
              <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                <SelectTrigger className="w-full border-slate-700 bg-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-800">
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-2">
                        <t.icon className="h-3.5 w-3.5 text-slate-400" />
                        <span>{t.label}</span>
                        <span className="text-slate-500">— {t.description}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !fieldName.trim()}
              className="bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
            >
              {saving ? <><Loader2 className="size-4 animate-spin" />Creating...</> : 'Create Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Custom Field</DialogTitle>
            <DialogDescription className="text-slate-400">
              Deleting &quot;{fieldToDelete?.field_name}&quot; will permanently remove all
              values stored under this field for every contact. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? <><Loader2 className="size-4 animate-spin" />Deleting...</> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
