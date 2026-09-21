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

  const { success, error } = useToast();

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      setTemplates(data || []);
      if (data && data.length > 0 && !selectedTemplate) {
        setSelectedTemplate(data[0]);
      }
    } catch {
      error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [selectedTemplate, error]);

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
    const newTpl: Partial<Template> = {
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
    };
    setEditForm(newTpl);
    setIsEditing(true);
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
      loadTemplates();
    } catch (err: any) {
      error(err?.message || 'Error saving template');
    }
  };

  const handleDuplicate = async (tpl: Template) => {
    try {
      const dupData = {
        ...tpl,
        name: `${tpl.name} (Copy)`,
      };
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
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      success('Template deleted');
      loadTemplates();
    } catch (err: any) {
      error(err?.message || 'Error deleting template');
    }
  };

  return (
    <DashboardLayout
      title="Post Design Templates"
      subtitle="Craft and customize high-contrast 1080x1080 visual layouts for Instagram posts"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 5 Cols: Template List */}
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

          {loading ? (
            <div className="p-12 text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading templates...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tpl) => {
                const isSelected = selectedTemplate?.id === tpl.id;

                return (
                  <div
                    key={tpl.id}
                    onClick={() => handleSelect(tpl)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white shadow-sm flex items-center justify-between ${
                      isSelected
                        ? 'border-brand-500 ring-2 ring-brand-500/15'
                        : 'border-zinc-200/80 hover:border-zinc-300'
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
                        <div className="font-bold text-sm text-zinc-900">{tpl.name}</div>
                        <div className="text-xs text-zinc-500 line-clamp-1">{tpl.description}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStartEdit(tpl)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg"
                        title="Edit Template"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDuplicate(tpl)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg"
                        title="Duplicate"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {templates.length > 1 && (
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                          title="Delete"
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

        {/* Right 7 Cols: Live Preview & Editor */}
        <div className="lg:col-span-7 space-y-6">
          {selectedTemplate && (
            <div className="bg-white p-6 rounded-2xl border border-zinc-200/80 shadow-sm flex flex-col items-center">
              <div className="flex items-center justify-between w-full mb-5">
                <div>
                  <h3 className="text-base font-bold text-zinc-900">
                    {isEditing ? `Editing: ${editForm.name}` : selectedTemplate.name}
                  </h3>
                  <p className="text-xs text-zinc-500">Live 1080x1080 square preview with sample text</p>
                </div>

                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveTemplate}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-zinc-900 text-white text-xs font-semibold"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleStartEdit(selectedTemplate)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Customize</span>
                  </button>
                )}
              </div>

              {/* Live Scaled Preview */}
              <div className="p-4 bg-zinc-100/80 rounded-2xl flex items-center justify-center my-2">
                <PostCardPreview
                  text={SAMPLE_TEXT}
                  displayName="Rahul"
                  isAnonymous={false}
                  confessionNumber={42}
                  template={
                    isEditing ? ({ ...selectedTemplate, ...editForm } as Template) : selectedTemplate
                  }
                  scale={0.34}
                />
              </div>

              {/* Editing Form */}
              {isEditing && (
                <div className="w-full mt-6 pt-6 border-t border-zinc-100 space-y-4 text-xs font-medium text-zinc-700">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Template Name
                      </label>
                      <input
                        type="text"
                        value={editForm.name || ''}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Typography Style
                      </label>
                      <select
                        value={editForm.font_family || 'sans'}
                        onChange={(e) =>
                          setEditForm({ ...editForm, font_family: e.target.value as any })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs bg-white"
                      >
                        <option value="sans">Modern Sans (Inter)</option>
                        <option value="serif">Editorial Serif (Playfair / Georgia)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Background (CSS/Hex)
                      </label>
                      <input
                        type="text"
                        value={editForm.background || ''}
                        onChange={(e) => setEditForm({ ...editForm, background: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Text Color
                      </label>
                      <input
                        type="text"
                        value={editForm.text_color || ''}
                        onChange={(e) => setEditForm({ ...editForm, text_color: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Accent Color
                      </label>
                      <input
                        type="text"
                        value={editForm.accent_color || ''}
                        onChange={(e) => setEditForm({ ...editForm, accent_color: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-6 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.show_branding !== false}
                        onChange={(e) =>
                          setEditForm({ ...editForm, show_branding: e.target.checked })
                        }
                        className="rounded border-zinc-300 text-brand-600"
                      />
                      <span>Show Brand Name</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.show_confession_number !== false}
                        onChange={(e) =>
                          setEditForm({ ...editForm, show_confession_number: e.target.checked })
                        }
                        className="rounded border-zinc-300 text-brand-600"
                      />
                      <span>Show Confession Badge</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.show_name !== false}
                        onChange={(e) => setEditForm({ ...editForm, show_name: e.target.checked })}
                        className="rounded border-zinc-300 text-brand-600"
                      />
                      <span>Show Author Signature</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
