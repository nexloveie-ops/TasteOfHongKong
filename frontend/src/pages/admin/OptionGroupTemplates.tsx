import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

interface Translation { locale: string; name: string; }
interface Category { _id: string; translations: Translation[]; }
interface MenuItemRow { _id: string; categoryId: string; price: number; translations: Translation[]; }

interface OptionChoiceData { extraPrice: number; originalPrice?: number; translations: Translation[]; }
interface OptionGroupData { required: boolean; translations: Translation[]; choices: OptionChoiceData[]; }

interface TemplateDoc {
  _id: string;
  name: string;
  enabled: boolean;
  optionGroups: OptionGroupData[];
  updatedAt?: string;
}

interface RuleDoc {
  _id: string;
  templateId: string;
  enabled: boolean;
  priority: number;
  categoryIds: string[];
  menuItemIds: string[];
  excludedMenuItemIds: string[];
}

interface FormOptionChoice { nameZh: string; nameEn: string; extraPrice: number; originalPrice: number; }
interface FormOptionGroup { nameZh: string; nameEn: string; required: boolean; choices: FormOptionChoice[]; }

const emptyTemplateForm = { _id: null as string | null, name: '', enabled: true, optionGroups: [] as FormOptionGroup[] };

const emptyRuleForm = {
  _id: null as string | null,
  templateId: '',
  enabled: true,
  priority: 100,
  categoryIds: [] as string[],
  menuItemIds: [] as string[],
  excludedMenuItemIds: [] as string[],
};

function toFormGroups(groups: OptionGroupData[] | undefined): FormOptionGroup[] {
  return (groups || []).map((g) => ({
    nameZh: g.translations.find((t) => t.locale === 'zh-CN')?.name || '',
    nameEn: g.translations.find((t) => t.locale === 'en-US')?.name || '',
    required: !!g.required,
    choices: (g.choices || []).map((c) => ({
      nameZh: c.translations.find((t) => t.locale === 'zh-CN')?.name || '',
      nameEn: c.translations.find((t) => t.locale === 'en-US')?.name || '',
      extraPrice: typeof c.extraPrice === 'number' ? c.extraPrice : 0,
      originalPrice: typeof c.originalPrice === 'number' ? c.originalPrice : 0,
    })),
  }));
}

function fromFormGroups(groups: FormOptionGroup[]): OptionGroupData[] {
  return groups.map((g) => ({
    required: g.required,
    translations: [
      { locale: 'zh-CN', name: g.nameZh },
      { locale: 'en-US', name: g.nameEn },
    ],
    choices: g.choices.map((c) => ({
      extraPrice: c.extraPrice,
      originalPrice: c.originalPrice || undefined,
      translations: [
        { locale: 'zh-CN', name: c.nameZh },
        { locale: 'en-US', name: c.nameEn },
      ],
    })),
  }));
}

export default function OptionGroupTemplates() {
  const { t, i18n } = useTranslation();
  const { token } = useAuth();
  const lang = i18n.language;

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [templates, setTemplates] = useState<TemplateDoc[]>([]);
  const [rules, setRules] = useState<RuleDoc[]>([]);

  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [filter, setFilter] = useState('');

  const getName = (translations: Translation[]) => {
    const found = translations.find((t2) => t2.locale === lang) || translations[0];
    return found?.name || '';
  };

  const fetchAll = useCallback(async () => {
    const [catRes, itemRes, tplRes, ruleRes] = await Promise.all([
      fetch('/api/menu/categories', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/menu/items?ownOptionGroups=1', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/option-group-templates', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/option-group-templates/rules', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (catRes.ok) setCategories(await catRes.json());
    if (itemRes.ok) setMenuItems(await itemRes.json());
    if (tplRes.ok) setTemplates(await tplRes.json());
    if (ruleRes.ok) setRules(await ruleRes.json());
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter((i) => getName(i.translations).toLowerCase().includes(q));
  }, [menuItems, filter, lang]);

  const toggleInList = (list: string[], id: string, on: boolean) => {
    const set = new Set(list);
    if (on) set.add(id);
    else set.delete(id);
    return Array.from(set);
  };

  // --- Template editor helpers (same behavior as MenuItemManager) ---
  const addTemplateGroup = () => {
    setTemplateForm((prev) => ({
      ...prev,
      optionGroups: [...prev.optionGroups, { nameZh: '', nameEn: '', required: false, choices: [{ nameZh: '', nameEn: '', extraPrice: 0, originalPrice: 0 }] }],
    }));
  };
  const removeTemplateGroup = (gi: number) => {
    setTemplateForm((prev) => ({ ...prev, optionGroups: prev.optionGroups.filter((_, i) => i !== gi) }));
  };
  const updateTemplateGroup = (gi: number, field: string, value: unknown) => {
    setTemplateForm((prev) => ({
      ...prev,
      optionGroups: prev.optionGroups.map((g, i) => (i === gi ? { ...g, [field]: value } : g)),
    }));
  };
  const addTemplateChoice = (gi: number) => {
    setTemplateForm((prev) => ({
      ...prev,
      optionGroups: prev.optionGroups.map((g, i) =>
        i === gi ? { ...g, choices: [...g.choices, { nameZh: '', nameEn: '', extraPrice: 0, originalPrice: 0 }] } : g,
      ),
    }));
  };
  const removeTemplateChoice = (gi: number, ci: number) => {
    setTemplateForm((prev) => ({
      ...prev,
      optionGroups: prev.optionGroups.map((g, i) =>
        i === gi ? { ...g, choices: g.choices.filter((_, j) => j !== ci) } : g,
      ),
    }));
  };
  const updateTemplateChoice = (gi: number, ci: number, field: string, value: unknown) => {
    setTemplateForm((prev) => ({
      ...prev,
      optionGroups: prev.optionGroups.map((g, i) =>
        i === gi ? { ...g, choices: g.choices.map((c, j) => (j === ci ? { ...c, [field]: value } : c)) } : g,
      ),
    }));
  };

  const saveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const body = {
        name: templateForm.name,
        enabled: templateForm.enabled,
        optionGroups: fromFormGroups(templateForm.optionGroups),
      };
      const res = templateForm._id
        ? await fetch(`/api/admin/option-group-templates/${templateForm._id}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        : await fetch('/api/admin/option-group-templates', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error?.message || '保存失败');
        return;
      }
      setTemplateForm(emptyTemplateForm);
      setTemplateEditorOpen(false);
      fetchAll();
    } catch {
      alert('保存失败');
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm(t('common.confirm') + '?')) return;
    await fetch(`/api/admin/option-group-templates/${id}`, { method: 'DELETE', headers });
    setTemplateForm(emptyTemplateForm);
    setTemplateEditorOpen(false);
    fetchAll();
  };

  const saveRule = async () => {
    setSavingRule(true);
    try {
      if (!ruleForm.templateId) {
        alert('请选择模板');
        setSavingRule(false);
        return;
      }
      if (ruleForm.categoryIds.length === 0 && ruleForm.menuItemIds.length === 0) {
        alert('请至少选择一个分类或菜品');
        setSavingRule(false);
        return;
      }
      const body = {
        templateId: ruleForm.templateId,
        enabled: ruleForm.enabled,
        priority: Number(ruleForm.priority),
        categoryIds: ruleForm.categoryIds,
        menuItemIds: ruleForm.menuItemIds,
        excludedMenuItemIds: ruleForm.excludedMenuItemIds,
      };
      const res = ruleForm._id
        ? await fetch(`/api/admin/option-group-templates/rules/${ruleForm._id}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        : await fetch('/api/admin/option-group-templates/rules', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error?.message || '保存失败');
        return;
      }
      setRuleForm(emptyRuleForm);
      setRuleEditorOpen(false);
      fetchAll();
    } catch {
      alert('保存失败');
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (id: string) => {
    if (!confirm(t('common.confirm') + '?')) return;
    await fetch(`/api/admin/option-group-templates/rules/${id}`, { method: 'DELETE', headers });
    setRuleForm(emptyRuleForm);
    setRuleEditorOpen(false);
    fetchAll();
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{t('admin.optionGroupTemplatesTitle')}</h2>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t('admin.optionGroupTemplates')}</div>
          <button
            className="btn btn-outline"
            style={{ fontSize: 12 }}
            onClick={() => {
              setTemplateForm({ _id: null, name: '', enabled: true, optionGroups: [] });
              setTemplateEditorOpen(true);
            }}
          >
            + {t('common.add')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {templates.map((tpl) => (
            <button
              key={tpl._id}
              className="btn btn-ghost"
              style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 999, padding: '6px 10px' }}
              onClick={() => {
                setTemplateForm({ _id: tpl._id, name: tpl.name, enabled: tpl.enabled, optionGroups: toFormGroups(tpl.optionGroups) });
                setTemplateEditorOpen(true);
              }}
            >
              {tpl.name}{tpl.enabled ? '' : ` (${t('admin.enabledOff')})`}
            </button>
          ))}
        </div>

        {templateEditorOpen && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 10, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('admin.templateName')}</label>
                <input className="input" value={templateForm.name} onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('admin.enabled')}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40 }}>
                  <input type="checkbox" checked={templateForm.enabled} onChange={(e) => setTemplateForm((p) => ({ ...p, enabled: e.target.checked }))} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{templateForm.enabled ? t('admin.enabledOn') : t('admin.enabledOff')}</span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {templateForm._id && (
                  <button className="btn btn-outline" style={{ fontSize: 12, color: 'var(--red-primary)' }} onClick={() => deleteTemplate(templateForm._id!)}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </div>

            <div style={{ marginTop: 14, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t('admin.optionGroups')}</div>
                <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addTemplateGroup}>
                  + {t('admin.addOptionGroup')}
                </button>
              </div>

              {templateForm.optionGroups.map((group, gi) => (
                <div key={gi} style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, marginBottom: 10, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>#{gi + 1}</span>
                    <button className="btn btn-ghost" style={{ fontSize: 11, color: 'var(--red-primary)' }} onClick={() => removeTemplateGroup(gi)}>
                      {t('common.delete')}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-light)' }}>{t('admin.groupName')} (中文)</label>
                      <input className="input" value={group.nameZh} onChange={(e) => updateTemplateGroup(gi, 'nameZh', e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-light)' }}>{t('admin.groupName')} (EN)</label>
                      <input className="input" value={group.nameEn} onChange={(e) => updateTemplateGroup(gi, 'nameEn', e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input type="checkbox" checked={group.required} onChange={(e) => updateTemplateGroup(gi, 'required', e.target.checked)} />
                        {t('admin.required')}
                      </label>
                    </div>
                  </div>

                  {group.choices.map((choice, ci) => (
                    <div key={ci} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 90px auto', gap: 6, marginBottom: 4 }}>
                      <input className="input" placeholder={`${t('admin.choiceName')} (中文)`} value={choice.nameZh} onChange={(e) => updateTemplateChoice(gi, ci, 'nameZh', e.target.value)} style={{ fontSize: 12 }} />
                      <input className="input" placeholder={`${t('admin.choiceName')} (EN)`} value={choice.nameEn} onChange={(e) => updateTemplateChoice(gi, ci, 'nameEn', e.target.value)} style={{ fontSize: 12 }} />
                      <input className="input" type="number" placeholder={t('admin.originalPrice')} value={choice.originalPrice || ''} onChange={(e) => updateTemplateChoice(gi, ci, 'originalPrice', Number(e.target.value))} style={{ fontSize: 12 }} />
                      <input className="input" type="number" placeholder={t('admin.extraPrice')} value={choice.extraPrice} onChange={(e) => updateTemplateChoice(gi, ci, 'extraPrice', Number(e.target.value))} style={{ fontSize: 12 }} />
                      <button className="btn btn-ghost" style={{ fontSize: 14, color: 'var(--red-primary)' }} onClick={() => removeTemplateChoice(gi, ci)}>✕</button>
                    </div>
                  ))}
                  <button className="btn btn-ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={() => addTemplateChoice(gi)}>
                    + {t('admin.addChoice')}
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary" onClick={saveTemplate} disabled={savingTemplate}>
                  {savingTemplate ? t('common.loading') : t('common.save')}
                </button>
                <button className="btn btn-outline" onClick={() => { setTemplateForm(emptyTemplateForm); setTemplateEditorOpen(false); }}>{t('common.cancel')}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t('admin.optionGroupTemplateRules')}</div>
          <button
            className="btn btn-outline"
            style={{ fontSize: 12 }}
            disabled={templates.length === 0}
            onClick={() => {
              setRuleForm({ ...emptyRuleForm, templateId: templates[0]?._id || '' });
              setRuleEditorOpen(true);
            }}
          >
            + {t('common.add')}
          </button>
        </div>

        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: 8, textAlign: 'left' }}>{t('admin.priority')}</th>
                <th style={{ padding: 8, textAlign: 'left' }}>{t('admin.template')}</th>
                <th style={{ padding: 8, textAlign: 'left' }}>{t('admin.categories')}</th>
                <th style={{ padding: 8, textAlign: 'left' }}>{t('admin.targetMenuItems')}</th>
                <th style={{ padding: 8, textAlign: 'left' }}>{t('admin.excludedItems')}</th>
                <th style={{ padding: 8, textAlign: 'center' }}>{t('admin.enabled')}</th>
                <th style={{ padding: 8, textAlign: 'right' }}>{t('common.edit')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const tplName = templates.find((x) => x._id === r.templateId)?.name || r.templateId;
                return (
                  <tr key={r._id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: 8 }}>{r.priority}</td>
                    <td style={{ padding: 8 }}>{tplName}</td>
                    <td style={{ padding: 8 }}>{r.categoryIds.length}</td>
                    <td style={{ padding: 8 }}>{r.menuItemIds.length}</td>
                    <td style={{ padding: 8 }}>{r.excludedMenuItemIds.length}</td>
                    <td style={{ padding: 8, textAlign: 'center' }}>{r.enabled ? '✓' : '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => {
                        setRuleForm({
                          _id: r._id,
                          templateId: r.templateId,
                          enabled: r.enabled,
                          priority: r.priority,
                          categoryIds: r.categoryIds || [],
                          menuItemIds: r.menuItemIds || [],
                          excludedMenuItemIds: r.excludedMenuItemIds || [],
                        });
                        setRuleEditorOpen(true);
                      }}>{t('common.edit')}</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red-primary)' }} onClick={() => deleteRule(r._id)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--text-light)' }}>{t('admin.noRules')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {ruleEditorOpen && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('admin.template')}</label>
                <select className="input" value={ruleForm.templateId} onChange={(e) => setRuleForm((p) => ({ ...p, templateId: e.target.value }))}>
                  <option value="">{t('admin.pickTemplate')}</option>
                  {templates.map((tpl) => <option key={tpl._id} value={tpl._id}>{tpl.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('admin.priority')}</label>
                <input className="input" type="number" value={ruleForm.priority} onChange={(e) => setRuleForm((p) => ({ ...p, priority: Number(e.target.value) }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-light)' }}>{t('admin.enabled')}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40 }}>
                  <input type="checkbox" checked={ruleForm.enabled} onChange={(e) => setRuleForm((p) => ({ ...p, enabled: e.target.checked }))} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ruleForm.enabled ? t('admin.enabledOn') : t('admin.enabledOff')}</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('admin.ruleTargetsHelp')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 6 }}>{t('admin.categories')}</div>
                  <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                    {categories.map((c) => {
                      const checked = ruleForm.categoryIds.includes(c._id);
                      return (
                        <label key={c._id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setRuleForm((p) => ({ ...p, categoryIds: toggleInList(p.categoryIds, c._id, e.target.checked) }))}
                          />
                          <span>{getName(c.translations)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 6 }}>{t('admin.targetMenuItems')}</div>
                  <input className="input" placeholder={t('admin.itemFilter')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 8 }} />
                  <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                    {filteredItems.map((i) => {
                      const checked = ruleForm.menuItemIds.includes(i._id);
                      return (
                        <label key={i._id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setRuleForm((p) => ({ ...p, menuItemIds: toggleInList(p.menuItemIds, i._id, e.target.checked) }))}
                          />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getName(i.translations)}</span>
                          <span style={{ color: 'var(--text-light)', flexShrink: 0 }}>€{i.price}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('admin.excludedItems')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 8 }}>{t('admin.excludedItemsHelp')}</div>
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                {menuItems.map((i) => {
                  const checked = ruleForm.excludedMenuItemIds.includes(i._id);
                  return (
                    <label key={i._id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setRuleForm((p) => ({ ...p, excludedMenuItemIds: toggleInList(p.excludedMenuItemIds, i._id, e.target.checked) }))}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getName(i.translations)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={saveRule} disabled={savingRule}>
                {savingRule ? t('common.loading') : t('common.save')}
              </button>
              <button className="btn btn-outline" onClick={() => { setRuleForm(emptyRuleForm); setRuleEditorOpen(false); }}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
