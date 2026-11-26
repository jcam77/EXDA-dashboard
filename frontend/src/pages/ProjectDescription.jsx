import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutList, Plus, ScrollText, SquarePen, Target, Trash2 } from 'lucide-react';
import IsoDateInput from '../components/IsoDateInput';
import PageHeader from '../components/PageHeader';
import SkillPicker from '../components/SkillPicker';
import TagInput from '../components/TagInput';
import { useProjectDescription } from '../hooks/useProjectDescription';
import {
  cloneDescription, descriptionProblem, filledCount, newExtraId, sameDescription,
} from '../utils/projectDescription';

const SECTION_HEADING = 'text-lg font-bold tracking-tight uppercase';
const INPUT = 'w-full rounded-md border border-sidebar-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 disabled:opacity-60';

const AUTOSAVE_DELAY_MS = 1200;

// Standard fields (the same in every project, so projects can be compared) and
// extra fields (only this project). Saved in Plan/project_description.json,
// automatically, like the rest of EXDA. `saveRef` lets the workspace's Save Now
// save pending changes too.
const ProjectDescriptionPage = ({ apiBaseUrl, projectPath, readOnly = false, planMeta = {}, setPlanMeta, saveRef }) => {
  const data = useProjectDescription(apiBaseUrl, projectPath);
  const { save: saveDescription, fields } = data;
  // null = no edits; the page shows the saved description.
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState({ state: 'idle', message: '' });  // idle | saving | saved | error

  const current = draft || data.description;
  const dirty = Boolean(draft) && !sameDescription(draft, data.description);
  const problem = dirty ? descriptionProblem(draft, data.fields) : '';

  // Latest values for saving outside render (timers, Save Now, leaving the tab).
  const latest = useRef({ draft: null, description: null, fields: [], readOnly: false });
  useEffect(() => {
    latest.current = { draft, description: data.description, fields, readOnly };
  }, [draft, data.description, fields, readOnly]);

  // Saves the pending changes, if any. Returns { ok, error }.
  const flush = useCallback(async () => {
    const { draft: pending, description, fields: knownFields, readOnly: locked } = latest.current;
    if (!pending || sameDescription(pending, description)) return { ok: true };
    if (locked) return { ok: false, error: 'Read-only: this project is open for editing elsewhere.' };
    const issue = descriptionProblem(pending, knownFields);
    if (issue) return { ok: false, error: issue };
    setStatus({ state: 'saving', message: '' });
    const result = await saveDescription(pending);
    if (result.ok) {
      // Keep edits made while saving; they are saved next.
      setDraft((now) => (now === pending ? null : now));
      setStatus({ state: 'saved', message: '' });
    } else {
      setStatus({
        state: 'error',
        message: result.conflict
          ? `${result.error} Your changes are still here; copy anything you need, then reload the page.`
          : result.error,
      });
    }
    return result;
  }, [saveDescription]);

  // Automatic save shortly after the last change.
  useEffect(() => {
    if (!dirty || problem || readOnly) return undefined;
    const timer = setTimeout(() => { flush(); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, problem, readOnly, flush]);

  // Save Now in the workspace saves pending changes here as well.
  useEffect(() => {
    if (!saveRef) return undefined;
    saveRef.current = flush;
    return () => { if (saveRef.current === flush) saveRef.current = null; };
  }, [saveRef, flush]);

  // Leaving the tab saves pending changes instead of dropping them.
  const flushOnLeave = useRef(flush);
  useEffect(() => { flushOnLeave.current = flush; }, [flush]);
  useEffect(() => () => { flushOnLeave.current(); }, []);

  // Warn before closing the window with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const edit = (change) => {
    setDraft((previous) => {
      const next = cloneDescription(previous || data.description);
      change(next);
      return next;
    });
  };

  // Objective, description, start and deadline are part of the experiment plan
  // (the Projects page reads them there); they are saved automatically with it.
  const editPlanMeta = (key, value) => setPlanMeta?.((previous) => ({ ...previous, [key]: value }));
  const filled = current ? filledCount(current, data.fields) : 0;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background text-foreground animate-in fade-in duration-500 custom-scrollbar">
      <PageHeader icon={ScrollText} title="Project Description" subtitle="What the project is about, described the same way in every project.">
        {current && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className={problem || status.state === 'error' ? 'text-red-400' : 'text-muted-foreground'}>
              {problem
                || (status.state === 'error' && status.message)
                || (status.state === 'saving' && 'Saving…')
                || (dirty && 'Unsaved changes')
                || (status.state === 'saved' && 'All changes saved')
                || ''}
            </span>
            <span className="rounded-full border border-sidebar-border px-3 py-1 text-muted-foreground">
              {filled} of {data.fields.length} standard fields filled
            </span>
          </div>
        )}
      </PageHeader>

      {data.loading && !data.description && <div className="text-sm text-muted-foreground">Loading project description…</div>}
      {data.error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          {data.error} The file was left unchanged.
        </div>
      )}

      {current && (
        <div className="w-full max-w-5xl space-y-8 pb-8">
          {/* Project objectives (saved automatically with the experiment plan) */}
          <section className="rounded-xl border border-sidebar-border bg-card/60 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-primary">
                <Target size={18} /> Project Objectives
              </div>
              <div className="flex items-center gap-3">
                {[['startDate', 'Start'], ['deadline', 'Deadline']].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                    {label}
                    <IsoDateInput
                      value={planMeta?.[key] || ''}
                      onValueChange={(next) => editPlanMeta(key, next)}
                      disabled={readOnly}
                      aria-label={label}
                      wrapperClassName="w-36"
                      className={`${INPUT} py-1.5 pr-8 text-[13px]`}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="project-objective" className="text-[11px] font-bold uppercase text-muted-foreground">Objective (one line)</label>
                <input
                  id="project-objective"
                  value={planMeta?.objective || ''}
                  onChange={(event) => editPlanMeta('objective', event.target.value)}
                  placeholder="Primary objective (one line)"
                  disabled={readOnly}
                  className={`${INPUT} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="project-description-text" className="text-[11px] font-bold uppercase text-muted-foreground">Description (details)</label>
                <textarea
                  id="project-description-text"
                  rows={4}
                  value={planMeta?.description || ''}
                  onChange={(event) => editPlanMeta('description', event.target.value)}
                  placeholder="A longer description, scope and notes…"
                  disabled={readOnly}
                  className={`${INPUT} mt-1.5 resize-y`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Saved automatically with the experiment plan.</p>
            </div>
          </section>

          {/* Standard fields */}
          <section>
            <div className="mb-4 flex items-center gap-3 border-b border-border pb-3">
              <LayoutList size={22} className="text-primary" />
              <div>
                <h2 className={SECTION_HEADING}>Standard fields</h2>
                <p className="text-[11px] text-muted-foreground">
                  The same fields in every project, so projects can be compared. Leave a field empty if it does not apply.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {data.fields.map((field) => (
                <div key={field.id} className="grid grid-cols-1 gap-1.5 md:grid-cols-[220px_1fr] md:gap-6">
                  <div className="pt-1.5">
                    <div className="text-sm font-semibold text-foreground">{field.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {field.catalog === 'skills' ? 'From the team\'s skills list' : field.kind === 'tags' ? 'Short terms' : 'Text'}
                    </div>
                  </div>
                  {field.catalog === 'skills' ? (
                    <SkillPicker
                      label={field.label}
                      value={current.standard[field.id] || []}
                      onChange={(names) => edit((next) => { next.standard[field.id] = names; })}
                      catalog={data.skills.catalog}
                      catalogError={data.skills.error}
                      onAddSkill={readOnly ? null : data.addSkill}
                      disabled={readOnly}
                    />
                  ) : field.kind === 'tags' ? (
                    <TagInput
                      label={field.label}
                      value={current.standard[field.id] || []}
                      onChange={(tags) => edit((next) => { next.standard[field.id] = tags; })}
                      suggestions={data.suggestions[field.id] || []}
                      placeholder={field.hint}
                      disabled={readOnly}
                    />
                  ) : (
                    <textarea
                      aria-label={field.label}
                      rows={3}
                      value={current.standard[field.id] || ''}
                      onChange={(event) => { const { value } = event.target; edit((next) => { next.standard[field.id] = value; }); }}
                      placeholder={field.hint}
                      disabled={readOnly}
                      className={`${INPUT} resize-y`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Extra fields */}
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-3">
                <SquarePen size={22} className="text-primary" />
                <div>
                  <h2 className={SECTION_HEADING}>Extra fields</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Fields only this project needs. They are kept, but not used to compare projects.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => edit((next) => { next.extra.push({ id: newExtraId(next.extra), label: '', value: '' }); })}
                className="inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
              >
                <Plus size={12} /> Add field
              </button>
            </div>
            {current.extra.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extra fields. Use Add field for something only this project needs, for example the vent configuration or the ignition source.</p>
            ) : (
              <div className="space-y-4">
                {current.extra.map((item, index) => (
                  <div key={item.id} className="grid grid-cols-1 gap-1.5 md:grid-cols-[220px_1fr_auto] md:gap-6">
                    <input
                      aria-label={`Name of extra field ${index + 1}`}
                      value={item.label}
                      onChange={(event) => { const { value } = event.target; edit((next) => { next.extra[index].label = value; }); }}
                      placeholder="Field name"
                      disabled={readOnly}
                      className={`${INPUT} font-semibold`}
                    />
                    <textarea
                      aria-label={item.label || `Extra field ${index + 1}`}
                      rows={2}
                      value={item.value}
                      onChange={(event) => { const { value } = event.target; edit((next) => { next.extra[index].value = value; }); }}
                      disabled={readOnly}
                      className={`${INPUT} resize-y`}
                    />
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => edit((next) => { next.extra.splice(index, 1); })}
                      title="Remove this field"
                      aria-label={`Remove ${item.label || `extra field ${index + 1}`}`}
                      className="self-start rounded-lg border border-border px-3 py-2 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {!dirty && data.updatedAt && (
            <p className="text-[11px] text-muted-foreground">Last saved {data.updatedAt}. Earlier versions are kept in History/.</p>
          )}
        </div>
      )}

    </div>
  );
};

export default ProjectDescriptionPage;
