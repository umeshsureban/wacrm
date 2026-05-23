'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronDown } from 'lucide-react';

const COUNTRY_CODES = [
  { country: 'AF', flag: '🇦🇫', code: '+93', name: 'Afghanistan' },
  { country: 'DZ', flag: '🇩🇿', code: '+213', name: 'Algeria' },
  { country: 'AR', flag: '🇦🇷', code: '+54', name: 'Argentina' },
  { country: 'AM', flag: '🇦🇲', code: '+374', name: 'Armenia' },
  { country: 'AU', flag: '🇦🇺', code: '+61', name: 'Australia' },
  { country: 'AT', flag: '🇦🇹', code: '+43', name: 'Austria' },
  { country: 'AZ', flag: '🇦🇿', code: '+994', name: 'Azerbaijan' },
  { country: 'BH', flag: '🇧🇭', code: '+973', name: 'Bahrain' },
  { country: 'BD', flag: '🇧🇩', code: '+880', name: 'Bangladesh' },
  { country: 'BY', flag: '🇧🇾', code: '+375', name: 'Belarus' },
  { country: 'BE', flag: '🇧🇪', code: '+32', name: 'Belgium' },
  { country: 'BA', flag: '🇧🇦', code: '+387', name: 'Bosnia' },
  { country: 'BR', flag: '🇧🇷', code: '+55', name: 'Brazil' },
  { country: 'BT', flag: '🇧🇹', code: '+975', name: 'Bhutan' },
  { country: 'CA', flag: '🇨🇦', code: '+1', name: 'Canada' },
  { country: 'CL', flag: '🇨🇱', code: '+56', name: 'Chile' },
  { country: 'CN', flag: '🇨🇳', code: '+86', name: 'China' },
  { country: 'CO', flag: '🇨🇴', code: '+57', name: 'Colombia' },
  { country: 'HR', flag: '🇭🇷', code: '+385', name: 'Croatia' },
  { country: 'CU', flag: '🇨🇺', code: '+53', name: 'Cuba' },
  { country: 'CZ', flag: '🇨🇿', code: '+420', name: 'Czech Republic' },
  { country: 'DK', flag: '🇩🇰', code: '+45', name: 'Denmark' },
  { country: 'EG', flag: '🇪🇬', code: '+20', name: 'Egypt' },
  { country: 'EE', flag: '🇪🇪', code: '+372', name: 'Estonia' },
  { country: 'ET', flag: '🇪🇹', code: '+251', name: 'Ethiopia' },
  { country: 'FI', flag: '🇫🇮', code: '+358', name: 'Finland' },
  { country: 'FR', flag: '🇫🇷', code: '+33', name: 'France' },
  { country: 'GE', flag: '🇬🇪', code: '+995', name: 'Georgia' },
  { country: 'DE', flag: '🇩🇪', code: '+49', name: 'Germany' },
  { country: 'GH', flag: '🇬🇭', code: '+233', name: 'Ghana' },
  { country: 'GR', flag: '🇬🇷', code: '+30', name: 'Greece' },
  { country: 'HU', flag: '🇭🇺', code: '+36', name: 'Hungary' },
  { country: 'IS', flag: '🇮🇸', code: '+354', name: 'Iceland' },
  { country: 'IN', flag: '🇮🇳', code: '+91', name: 'India' },
  { country: 'ID', flag: '🇮🇩', code: '+62', name: 'Indonesia' },
  { country: 'IR', flag: '🇮🇷', code: '+98', name: 'Iran' },
  { country: 'IQ', flag: '🇮🇶', code: '+964', name: 'Iraq' },
  { country: 'IE', flag: '🇮🇪', code: '+353', name: 'Ireland' },
  { country: 'IL', flag: '🇮🇱', code: '+972', name: 'Israel' },
  { country: 'IT', flag: '🇮🇹', code: '+39', name: 'Italy' },
  { country: 'JP', flag: '🇯🇵', code: '+81', name: 'Japan' },
  { country: 'JO', flag: '🇯🇴', code: '+962', name: 'Jordan' },
  { country: 'KE', flag: '🇰🇪', code: '+254', name: 'Kenya' },
  { country: 'KR', flag: '🇰🇷', code: '+82', name: 'South Korea' },
  { country: 'KW', flag: '🇰🇼', code: '+965', name: 'Kuwait' },
  { country: 'KG', flag: '🇰🇬', code: '+996', name: 'Kyrgyzstan' },
  { country: 'LV', flag: '🇱🇻', code: '+371', name: 'Latvia' },
  { country: 'LB', flag: '🇱🇧', code: '+961', name: 'Lebanon' },
  { country: 'LY', flag: '🇱🇾', code: '+218', name: 'Libya' },
  { country: 'LT', flag: '🇱🇹', code: '+370', name: 'Lithuania' },
  { country: 'LU', flag: '🇱🇺', code: '+352', name: 'Luxembourg' },
  { country: 'MY', flag: '🇲🇾', code: '+60', name: 'Malaysia' },
  { country: 'MV', flag: '🇲🇻', code: '+960', name: 'Maldives' },
  { country: 'MX', flag: '🇲🇽', code: '+52', name: 'Mexico' },
  { country: 'MN', flag: '🇲🇳', code: '+976', name: 'Mongolia' },
  { country: 'MA', flag: '🇲🇦', code: '+212', name: 'Morocco' },
  { country: 'MM', flag: '🇲🇲', code: '+95', name: 'Myanmar' },
  { country: 'NP', flag: '🇳🇵', code: '+977', name: 'Nepal' },
  { country: 'NL', flag: '🇳🇱', code: '+31', name: 'Netherlands' },
  { country: 'NZ', flag: '🇳🇿', code: '+64', name: 'New Zealand' },
  { country: 'NG', flag: '🇳🇬', code: '+234', name: 'Nigeria' },
  { country: 'NO', flag: '🇳🇴', code: '+47', name: 'Norway' },
  { country: 'OM', flag: '🇴🇲', code: '+968', name: 'Oman' },
  { country: 'PK', flag: '🇵🇰', code: '+92', name: 'Pakistan' },
  { country: 'PS', flag: '🇵🇸', code: '+970', name: 'Palestine' },
  { country: 'PE', flag: '🇵🇪', code: '+51', name: 'Peru' },
  { country: 'PH', flag: '🇵🇭', code: '+63', name: 'Philippines' },
  { country: 'PL', flag: '🇵🇱', code: '+48', name: 'Poland' },
  { country: 'PT', flag: '🇵🇹', code: '+351', name: 'Portugal' },
  { country: 'QA', flag: '🇶🇦', code: '+974', name: 'Qatar' },
  { country: 'RO', flag: '🇷🇴', code: '+40', name: 'Romania' },
  { country: 'RU', flag: '🇷🇺', code: '+7', name: 'Russia' },
  { country: 'SA', flag: '🇸🇦', code: '+966', name: 'Saudi Arabia' },
  { country: 'SN', flag: '🇸🇳', code: '+221', name: 'Senegal' },
  { country: 'RS', flag: '🇷🇸', code: '+381', name: 'Serbia' },
  { country: 'SG', flag: '🇸🇬', code: '+65', name: 'Singapore' },
  { country: 'SK', flag: '🇸🇰', code: '+421', name: 'Slovakia' },
  { country: 'SI', flag: '🇸🇮', code: '+386', name: 'Slovenia' },
  { country: 'ZA', flag: '🇿🇦', code: '+27', name: 'South Africa' },
  { country: 'ES', flag: '🇪🇸', code: '+34', name: 'Spain' },
  { country: 'LK', flag: '🇱🇰', code: '+94', name: 'Sri Lanka' },
  { country: 'SE', flag: '🇸🇪', code: '+46', name: 'Sweden' },
  { country: 'CH', flag: '🇨🇭', code: '+41', name: 'Switzerland' },
  { country: 'SY', flag: '🇸🇾', code: '+963', name: 'Syria' },
  { country: 'TW', flag: '🇹🇼', code: '+886', name: 'Taiwan' },
  { country: 'TZ', flag: '🇹🇿', code: '+255', name: 'Tanzania' },
  { country: 'TH', flag: '🇹🇭', code: '+66', name: 'Thailand' },
  { country: 'TN', flag: '🇹🇳', code: '+216', name: 'Tunisia' },
  { country: 'TR', flag: '🇹🇷', code: '+90', name: 'Turkey' },
  { country: 'UA', flag: '🇺🇦', code: '+380', name: 'Ukraine' },
  { country: 'AE', flag: '🇦🇪', code: '+971', name: 'UAE' },
  { country: 'GB', flag: '🇬🇧', code: '+44', name: 'United Kingdom' },
  { country: 'US', flag: '🇺🇸', code: '+1', name: 'United States' },
  { country: 'UG', flag: '🇺🇬', code: '+256', name: 'Uganda' },
  { country: 'UZ', flag: '🇺🇿', code: '+998', name: 'Uzbekistan' },
  { country: 'VE', flag: '🇻🇪', code: '+58', name: 'Venezuela' },
  { country: 'VN', flag: '🇻🇳', code: '+84', name: 'Vietnam' },
  { country: 'YE', flag: '🇾🇪', code: '+967', name: 'Yemen' },
  { country: 'ZM', flag: '🇿🇲', code: '+260', name: 'Zambia' },
  { country: 'ZW', flag: '🇿🇼', code: '+263', name: 'Zimbabwe' },
] as const;

const DEFAULT_COUNTRY = 'IN';

function parsePhoneNumber(phone: string): { country: string; localPhone: string } {
  if (!phone) return { country: DEFAULT_COUNTRY, localPhone: '' };
  const digits = phone.replace(/\D/g, '');
  // Try longest dial codes first to avoid false prefix matches
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const cc of sorted) {
    const ccDigits = cc.code.replace(/\D/g, '');
    if (digits.startsWith(ccDigits)) {
      return { country: cc.country, localPhone: digits.slice(ccDigits.length) };
    }
  }
  return { country: DEFAULT_COUNTRY, localPhone: digits };
}

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
}: ContactFormProps) {
  const supabase = createClient();
  const isEdit = !!contact;

  const [name, setName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(DEFAULT_COUNTRY);
  const [localPhone, setLocalPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      const parsed = parsePhoneNumber(contact?.phone ?? '');
      setSelectedCountry(parsed.country);
      setLocalPhone(parsed.localPhone);
      fetchTags();
    }
  }, [open, contact]);

  async function fetchTags() {
    setLoadingTags(true);
    const { data } = await supabase
      .from('tags')
      .select('*')
      .order('name');
    if (data) setTags(data);
    setLoadingTags(false);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const localDigits = localPhone.replace(/\D/g, '').replace(/^0+/, '');
    if (!localDigits) {
      toast.error('Phone number is required');
      return;
    }

    const countryEntry = COUNTRY_CODES.find((c) => c.country === selectedCountry);
    const fullPhone = (countryEntry?.code ?? '') + localDigits;

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      let contactId = contact?.id;

      if (isEdit && contactId) {
        const { error } = await supabase
          .from('contacts')
          .update({
            name: name.trim() || null,
            phone: fullPhone,
            email: email.trim() || null,
            company: company.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', contactId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert({
            user_id: user.id,
            name: name.trim() || null,
            phone: fullPhone,
            email: email.trim() || null,
            company: company.trim() || null,
          })
          .select('id')
          .single();
        if (error) throw error;
        contactId = data.id;
      }

      // Sync tags
      if (contactId) {
        await supabase
          .from('contact_tags')
          .delete()
          .eq('contact_id', contactId);

        if (selectedTagIds.length > 0) {
          const tagRows = selectedTagIds.map((tag_id) => ({
            contact_id: contactId!,
            tag_id,
          }));
          const { error: tagError } = await supabase
            .from('contact_tags')
            .insert(tagRows);
          if (tagError) throw tagError;
        }
      }

      toast.success(isEdit ? 'Contact updated' : 'Contact created');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save contact';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Contact' : 'Add Contact'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isEdit
              ? 'Update the contact details below.'
              : 'Fill in the details to create a new contact.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cf-name" className="text-slate-300">
              Name
            </Label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-phone" className="text-slate-300">
              Phone <span className="text-red-400">*</span>
            </Label>
            <div className="flex rounded-md border border-slate-700 bg-slate-800 overflow-hidden focus-within:ring-2 focus-within:ring-violet-500 focus-within:ring-offset-0 focus-within:border-violet-500">
              <div className="relative flex items-center border-r border-slate-700 shrink-0">
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="appearance-none bg-transparent text-white text-sm pl-2 pr-6 py-2 outline-none cursor-pointer h-full"
                  aria-label="Country code"
                >
                  {COUNTRY_CODES.map((cc) => (
                    <option
                      key={cc.country}
                      value={cc.country}
                      className="bg-slate-800 text-white"
                    >
                      {cc.flag} {cc.code} {cc.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1 size-3 text-slate-400" />
              </div>
              <input
                id="cf-phone"
                type="tel"
                value={localPhone}
                onChange={(e) => setLocalPhone(e.target.value)}
                placeholder="98765 43210"
                className="flex-1 bg-transparent text-white placeholder:text-slate-500 text-sm px-3 py-2 outline-none min-w-0"
              />
            </div>
            <p className="text-xs text-slate-500">
              {(() => {
                const cc = COUNTRY_CODES.find((c) => c.country === selectedCountry);
                const digits = localPhone.replace(/\D/g, '').replace(/^0+/, '');
                return digits
                  ? `Full number: ${cc?.code ?? ''}${digits}`
                  : `Select country code, then enter local number`;
              })()}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-email" className="text-slate-300">
              Email
            </Label>
            <Input
              id="cf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-company" className="text-slate-300">
              Company
            </Label>
            <Input
              id="cf-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Inc."
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Tags</Label>
            {loadingTags ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 className="size-3 animate-spin" />
                Loading tags...
              </div>
            ) : tags.length === 0 ? (
              <p className="text-xs text-slate-500">
                No tags available. Create tags in Settings.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'ring-2 ring-violet-500 ring-offset-1 ring-offset-slate-900'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                        borderColor: tag.color,
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
