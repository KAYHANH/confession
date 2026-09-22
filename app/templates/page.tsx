'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Palette,
  Plus,
  Edit2,
  Copy,
  Trash2,
  Check,
  RefreshCw,
  Star,
} from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Template } from '@/types';
import { PostCardPreview } from '@/components/confessions/PostCardPreview';
import { useToast } from '@/components/ui/ToastContext';

const SAMPLE_TEXT =
  'I secretly leave sticky notes with motivational quotes on random library desks every Friday night. Seeing someone smile reading one made my whole semester!';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Template>>({});
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>('');
  const [settingDefault, setSettingDefault] = useState<string | null>(null);

  const { success, error, info } = useToast();

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, settingsRes] = await Promise.all([
        fetch('/api/templates'),
        fetch('/api/settings'),
      ]);
      const [data, settings] = await Promise.all([tplRes.json(), settingsRes.json()]);
      setTemplates(data || []);
      setDefaultTemplateId(settings?.default_template_id || '');
      if (data && data.length > 0) {
        const def = data.find((t: Template) => t.id === settings?.default_template_id);
        setSelectedTemplate((prev) => prev ?? def ?? data[0]);
      }
    } catch {
      error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleSelect = (tpl: Template) => {
    setSelectedTemplate(tpl);
    setIsEditing(false);
  };

  const handleStartEdit = (tpl: Template) => {
    setSelectedTemplate(tpl);
    setEditForm({ ...tpl });
    setIsEditing(true);
  };

  const handleStartCreate = () => {
    setEditForm({
      name: 'Custom Template',
      description: 'Brand new visual style',
      background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
      text_color: '#0f172a',
      accent_color: '#e1306c',
      font_family: 'sans',
      font_size: 44,
      show_branding: true,
      show_confession_number: true,
      show_name: true,
      active: true,
    });
    setSelectedTemplate(null);
    setIsEditing(true);
  };

  const handleSetDefault = async (tplId: string) => {
    setSettingDefault(tplId);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_template_id: tplId }),
      });
      if (!res.ok) throw new Error('Failed to update default template');
      setDefaultTemplateId(tplId);
      const tplName = templates.find((t) => t.id === tplId)?.name || 'Template';
      success(`"${tplName}" is now the default template for all posts`);
    } catch (err: any) {
      error(err?.message || 'Failed to set default template');
    } finally {
      setSettingDefault(null);
    }
  };

  const handleSaveTemplate = async () => {
    try {
      const isNew = !editForm.id;
      const url = isNew ? '/api/templates' : `/api/templates/${editForm.id}`;
      const method = isNew ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save template');
      }

      const saved = await res.json();
      success(`Template "${saved.name}" saved!`);
      setIsEditing(false);
      setSelectedTemplate(saved);
      await loadTemplates();

      if (saved.id === defaultTemplateId) {
        info(`Posts will use the updated "${saved.name}" template.`);
      }
    } catch (err: any) {
      error(err?.message || 'Error saving template');
    }
  };

  const handleDuplicate = async (tpl: Template) => {
    try {
      const dupData = { ...tpl, name: `${tpl.name} (Copy)` };
      delete (dupData as any).id;
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dupData),
      });
      if (!res.ok) throw new Error('Duplicate failed');
      const saved = await res.json();
      success(`Duplicated "${tpl.name}"`);
      setSelectedTemplate(saved);
      loadTemplates();
    } catch (err: any) {
      error(err?.message || 'Error duplicating template');
    }
  };

  const handleDelete = async (id: string) => {
    if (id === defaultTemplateId) {
      error('Cannot delete the default template. Set another as default first.');
      return;
    }
    if (!confirm('Delete this template?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      success('Template deleted');
      loadTemplates();
    } catch (err: any) {
      error(err?.message || 'Error deleting template');
    }
  };

  const previewTemplate = isEditing
    ? ({ ...selectedTemplate, ...editForm } as Template)
    : selectedTemplate;

  return (
    <DashboardLayout
      title="Post Design Templates"
      subtitle="Craft and customize high-contrast 1080x1080 visual layouts for Instagram posts"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Template List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-sm text-zinc-900">
              <Palette className="w-4 h-4 text-brand-500" />
              <span>{templates.length} Visual Presets</span>
            </div>
            <button
              onClick={handleStartCreate}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Template</span>
            </button>
          </div>

          {defaultTemplateId && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
              <span>
                Default: <span className="font-bold">{templates.find((t) => t.id === defaultTemplateId)?.name || '—'}</span>
                {' '}· Used for all new posts
              </span>
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading templates...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tpl) => {
                const isSelected = selectedTemplate?.id === tpl.id;
                const isDefault = tpl.id === defaultTemplateId;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => handleSelect(tpl)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white shadow-sm flex items-center justify-between ${
                      isSelected ? 'border-brand-500 ring-2 ring-brand-500/15' : 'border-zinc-200/80 hover:border-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl border border-zinc-200/60 shadow-inner flex items-center justify-center font-serif text-sm font-bold shrink-0"
                        style={{ background: tpl.background, color: tpl.text_color }}
                      >
                        Aa
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-sm text-zinc-900">{tpl.name}</span>
                          {isDefault && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">
                              <Star className="w-2.5 h-2.5 fill-amber-500" /> Default
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 line-clamp-1">{tpl.description}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleSetDefault(tpl.id)}
                        disabled={isDefault || settingDefault === tpl.id}
                        title={isDefault ? 'Currently default' : 'Set as default for all posts'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isDefault ? 'text-amber-500 cursor-default' : 'text-zinc-400 hover:text-amber-500 hover:bg-amber-50 cursor-pointer'
                        } disabled:opacity-60`}
                      >
                        {settingDefault === tpl.id
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-amber-400' : ''}`} />}
                      </button>
                      <button onClick={() => handleStartEdit(tpl)} className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer" title="Edit">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDuplicate(tpl)} className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer" title="Duplicate">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {templates.length > 1 && (
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          disabled={isDefault}
                          title={isDefault ? 'Cannot delete default template' : 'Delete'}
                          className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Preview & Editor */}
        <div className="lg:col-span-7 space-y-6">
          {previewTemplate && (
            <div className="bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm flex flex-col items-center">
              <div className="flex items-center justify-between w-full mb-5">
                <div>
                  <h3 className="text-base font-bold text-zinc-900">
                    {isEditing ? `Editing: ${editForm.name}` : selectedTemplate?.name}
                  </h3>
                  <p className="text-xs text-zinc-500">Live 1080x1080 preview</p>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing && selectedTemplate && selectedTemplate.id !== defaultTemplateId && (
                    <button
                      onClick={() => handleSetDefault(selectedTemplate.id)}
                      disabled={settingDefault === selectedTemplate.id}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-700 cursor-pointer"
                    >
                      <Star className="w-3.5 h-3.5 text-amber-500" />
                      {settingDefault === selectedTemplate.id ? 'Saving...' : 'Set as Default'}
                    </button>
                  )}
                  {!isEditing && selectedTemplate?.id === defaultTemplateId && (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-700">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" /> Active Default
                    </span>
                  )}
                  {isEditing ? (
                    <>
                      <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 cursor-pointer">Cancel</button>
                      <button onClick={handleSaveTemplate} className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-zinc-900 text-white text-xs font-semibold cursor-pointer">
                        <Check className="w-3.5 h-3.5" /> Save Changes
                      </button>
                    </>
                  ) : (
                    <button onClick={() => selectedTemplate && handleStartEdit(selectedTemplate)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 cursor-pointer">
                      <Edit2 className="w-3.5 h-3.5" /> Customize
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 bg-zinc-100/80 rounded-2xl flex items-center justify-center my-2">
                <PostCardPreview
                  text={SAMPLE_TEXT}
                  displayName="Rahul"
                  isAnonymous={false}
                  confessionNumber={42}
                  template={previewTemplate}
                  scale={0.34}
                />
              </div>

              {isEditing && (
                <div className="w-full mt-6 pt-6 border-t border-zinc-100 space-y-4 text-xs font-medium text-zinc-700">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Template Name</label>
                      <input type="text" value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Typography Style</label>
                      <select value={editForm.font_family || 'sans'} onChange={(e) => setEditForm({ ...editForm, font_family: e.target.value as any })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs bg-white">
                        <option value="sans">Modern Sans (Inter)</option>
                        <option value="serif">Editorial Serif (Playfair / Georgia)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Background (CSS/Hex)</label>
                      <input type="text" value={editForm.background || ''} onChange={(e) => setEditForm({ ...editForm, background: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Text Color</label>
                      <input type="text" value={editForm.text_color || ''} onChange={(e) => setEditForm({ ...editForm, text_color: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Accent Color</label>
                      <input type="text" value={editForm.accent_color || ''} onChange={(e) => setEditForm({ ...editForm, accent_color: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs" />
                    </div>
                  </div>

                  {/* Color Pickers */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Pick Background</label>
                      <input type="color" value={editForm.background?.startsWith('#') ? editForm.background : '#1e1b4b'} onChange={(e) => setEditForm({ ...editForm, background: e.target.value })} className="w-full h-9 rounded-xl border border-zinc-200 cursor-pointer" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Pick Text Color</label>
                      <input type="color" value={editForm.text_color || '#ffffff'} onChange={(e) => setEditForm({ ...editForm, text_color: e.target.value })} className="w-full h-9 rounded-xl border border-zinc-200 cursor-pointer" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Pick Accent Color</label>
                      <input type="color" value={editForm.accent_color || '#818cf8'} onChange={(e) => setEditForm({ ...editForm, accent_color: e.target.value })} className="w-full h-9 rounded-xl border border-zinc-200 cursor-pointer" />
                    </div>
                  </div>

                  <div className="flex items-center gap-6 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editForm.show_branding !== false} onChange={(e) => setEditForm({ ...editForm, show_branding: e.target.checked })} className="rounded border-zinc-300 text-brand-600" />
                      <span>Show Brand Name</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editForm.show_confession_number !== false} onChange={(e) => setEditForm({ ...editForm, show_confession_number: e.target.checked })} className="rounded border-zinc-300 text-brand-600" />
                      <span>Show Confession Badge</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={editForm.show_name !== false} onChange={(e) => setEditForm({ ...editForm, show_name: e.target.checked })} className="rounded border-zinc-300 text-brand-600" />
                      <span>Show Author Signature</span>
                    </label>
                  </div>

                  {editForm.id && editForm.id !== defaultTemplateId && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                      <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>After saving, click <strong>Set as Default</strong> to use this template for all future posts.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
