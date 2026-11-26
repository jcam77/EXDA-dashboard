import React, { useState } from 'react';
import { AlertTriangle, ClipboardList, ListChecks, Pencil, UserCheck } from 'lucide-react';
import ProceduresPanel, { ProceduresBadge } from '../components/ProceduresPanel';
import ChecklistEditor from '../components/ChecklistEditor';
import PageHeader from '../components/PageHeader';
import ChecklistGroupIcon from '../components/ChecklistGroupIcon';
import UnifiedModal from '../components/UnifiedModal';
import { useProcedures } from '../hooks/useProcedures';
import { useChecklistDefinition } from '../hooks/useChecklistDefinition';
import { useAppDialog } from '../hooks/useAppDialog';
import { checklistProblem, cleanForSave, cloneChecklist, itemLabel, removedItems } from '../utils/checklistDefinition';

const SMALL_BUTTON = 'inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50';

const ChecklistPage = ({
    checklistState = {},
    setChecklistState = () => {},
    apiBaseUrl = '',
    projectPath = '',
    readOnly = false,
}) => {
    const procedures = useProcedures(apiBaseUrl, projectPath);
    const scrollToProcedures = () => {
        document.getElementById('safety-procedures')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };


    const toggleItem = (id) => {
        setChecklistState(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleInputChange = (field, value) => {
        setChecklistState(prev => ({ ...prev, [field]: value }));
    };

    // Groups and checks of this project (Reports/checklist.json, or EXDA's
    // built-in checklist for older projects). Ticks are stored per item id.
    const definition = useChecklistDefinition(apiBaseUrl, projectPath);
    const checklistGroups = definition.checklist?.groups || [];
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(null);
    const [editMessage, setEditMessage] = useState('');
    const { dialogModal, setDialogModal, showConfirm } = useAppDialog();

    const startEditing = () => {
        setDraft(cloneChecklist(definition.checklist));
        setEditMessage('');
        setEditing(true);
    };

    const cancelEditing = () => {
        setEditing(false);
        setDraft(null);
        setEditMessage('');
    };

    const confirmDeleteGroup = (group) => showConfirm({
        title: 'Delete this group?',
        content: `"${group.title || 'Untitled group'}" and its ${group.items.length} check(s) are removed when you save. Until then, Cancel undoes it.`,
        confirmLabel: 'Delete group',
    });

    const saveEditing = async () => {
        const problem = checklistProblem(draft);
        if (problem) {
            setEditMessage(problem);
            return;
        }
        const cleaned = cleanForSave(draft);
        const removed = removedItems(definition.checklist, cleaned);
        if (removed.length) {
            const ok = await showConfirm({
                title: 'Save the checklist?',
                content: `${removed.length} check(s) will be removed: ${removed.map((item) => `"${item.text}"`).join(', ')}. Their ticks are kept in the project but no longer count.`,
                confirmLabel: 'Save checklist',
                confirmVariant: 'primary',
                type: 'warning',
            });
            if (!ok) return;
        }
        const result = await definition.save(cleaned);
        if (!result.ok) {
            setEditMessage(result.conflict
                ? `${result.error} Your changes are still here; Cancel and reload the project to see the other version.`
                : result.error);
            return;
        }
        cancelEditing();
    };

    const allItemIds = checklistGroups.flatMap(group => group.items.map(item => item.id));
    const totalItems = allItemIds.length;
    const completedItems = allItemIds.filter(id => checklistState[id]).length;
    const completionPercent = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;
    const hasResponsible = Boolean((checklistState['resp_name'] || '').trim()) && Boolean((checklistState['inst_init'] || '').trim());
    const isAllChecked = completedItems === totalItems && totalItems > 0;
    const isReady = isAllChecked && checklistState['final_confirm'] && hasResponsible;

    const setAllItems = (value) => {
        setChecklistState(prev => {
            const next = { ...prev };
            allItemIds.forEach(id => {
                next[id] = value;
            });
            return next;
        });
    };

    const setGroupItems = (items, value) => {
        setChecklistState(prev => {
            const next = { ...prev };
            items.forEach(item => {
                next[item.id] = value;
            });
            return next;
        });
    };

    return (
        <div className="flex flex-col h-full w-full animate-in fade-in duration-500 overflow-y-auto custom-scrollbar bg-background text-foreground">
            <PageHeader icon={ClipboardList} title="Pre-Experiment Checklist" subtitle="Safety and readiness checks to complete before each test.">
                <ProceduresBadge
                    count={procedures.documents.length}
                    missingSections={procedures.missingSections}
                    loading={procedures.loading}
                    onClick={scrollToProcedures}
                />
            </PageHeader>


            {/* Progress + sign-off */}
            <div className="mb-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-xl border border-sidebar-border bg-card/60 p-5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">Checklist Progress</div>
                            <div className="mt-2 flex items-center gap-3">
                                <span className="text-2xl font-bold text-foreground">{completionPercent}%</span>
                                <span className="text-xs text-muted-foreground">{completedItems}/{totalItems} complete</span>
                                {isReady ? (
                                    <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                                        Ready
                                    </span>
                                ) : (
                                    <span className="ml-2 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-warning">
                                        Pending
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setAllItems(true)}
                                className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary hover:border-primary/60 hover:bg-primary/20 transition"
                            >
                                Mark All
                            </button>
                            <button
                                type="button"
                                onClick={() => setAllItems(false)}
                                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-ring transition"
                            >
                                Reset All
                            </button>
                        </div>
                    </div>
                    <div className="mt-4 h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${completionPercent}%` }}
                        />
                    </div>
                    {!hasResponsible && (
                        <div className="mt-3 text-[11px] text-warning">
                            Add responsible name and initials to enable final sign-off.
                        </div>
                    )}
                </div>

                {/* Responsible Sign-off */}
                <div className="bg-card/60 border border-sidebar-border rounded-xl p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <UserCheck size={18} className="text-primary" />
                        <span className="text-[11px] font-black uppercase tracking-widest">Responsible Sign-off</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                            type="text"
                            placeholder="Responsible Name"
                            className="w-full bg-background border border-border rounded-lg p-2 text-xs outline-none focus:border-ring"
                            value={checklistState['resp_name'] || ''}
                            onChange={(e) => handleInputChange('resp_name', e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="University / Institute Initials"
                            className="w-full bg-background border border-border rounded-lg p-2 text-xs outline-none focus:border-ring"
                            value={checklistState['inst_init'] || ''}
                            onChange={(e) => handleInputChange('inst_init', e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="final-lock"
                            className="w-4 h-4 rounded border-border bg-background ![accent-color:hsl(var(--primary))]"
                            checked={checklistState['final_confirm'] || false}
                            onChange={() => toggleItem('final_confirm')}
                        />
                        <label htmlFor="final-lock" className="text-[11px] text-muted-foreground uppercase font-bold tracking-tighter">I confirm safety readiness</label>
                    </div>
                </div>
            </div>

            {/* Emergency reminder: general for every project; the project's own
                emergency actions are in its procedures (RAMS, SOPs) below. */}
            <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                <span className="flex items-center gap-2 text-destructive">
                    <AlertTriangle size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Emergency Action Cards</span>
                </span>
                <span className="text-sm text-warning italic">
                    Before each test, review the emergency action cards and safety procedures of this project with the team.
                </span>
                <button
                    type="button"
                    onClick={scrollToProcedures}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60"
                >
                    See Safety Procedures ↓
                </button>
            </div>

            {/* Checks: header with Edit, then the groups (or the editor) */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center gap-3">
                    <ListChecks size={22} className="text-primary" />
                    <div>
                        <h2 className="text-lg font-bold tracking-tight uppercase">{editing ? 'Editing Checks' : 'Checks'}</h2>
                        <p className="text-[11px] text-muted-foreground">
                            {editing
                                ? 'Rename, add, move or remove groups and checks. Nothing is saved until you click Save checklist.'
                                : 'Tick each check before the test. Numbers follow the order of the list.'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {editing ? (
                        <>
                            <button type="button" onClick={cancelEditing} className={SMALL_BUTTON} disabled={definition.saving}>Cancel</button>
                            <button type="button" onClick={saveEditing} disabled={definition.saving}
                                className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50">
                                {definition.saving ? 'Saving…' : 'Save checklist'}
                            </button>
                        </>
                    ) : (
                        <button type="button" onClick={startEditing} className={SMALL_BUTTON}
                            disabled={readOnly || !definition.checklist}
                            title={readOnly ? 'Read-only: this project is open for editing elsewhere' : 'Add, rename, move or remove groups and checks'}>
                            <Pencil size={12} /> Edit checklist
                        </button>
                    )}
                </div>
            </div>
            {editMessage && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{editMessage}</div>}
            {definition.loading && !definition.checklist && (
                <div className="mb-8 text-sm text-muted-foreground">Loading checklist…</div>
            )}
            {definition.error && (
                <div className="mb-8 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                    {definition.error} The checklist file was left unchanged.
                </div>
            )}

            {editing && draft ? (
                <>
                    <ChecklistEditor draft={draft} setDraft={setDraft} confirmDeleteGroup={confirmDeleteGroup} />
                    <div className="mb-8 flex justify-end gap-2">
                        <button type="button" onClick={cancelEditing} className={SMALL_BUTTON} disabled={definition.saving}>Cancel</button>
                        <button type="button" onClick={saveEditing} disabled={definition.saving}
                            className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50">
                            {definition.saving ? 'Saving…' : 'Save checklist'}
                        </button>
                    </div>
                </>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                {checklistGroups.map((group, gIdx) => {
                    const groupDone = group.items.filter(item => checklistState[item.id]).length;
                    const groupTotal = group.items.length;
                    const groupPercent = groupTotal ? Math.round((groupDone / groupTotal) * 100) : 0;
                    const groupComplete = groupDone === groupTotal && groupTotal > 0;

                    return (
                    <div key={group.id} className="rounded-xl border border-sidebar-border bg-card/50 p-5 hover:border-primary/50 transition">
                        <div className="flex items-center gap-3 mb-4">
                            <ChecklistGroupIcon name={group.icon} />
                            <h2 className="text-sm font-black uppercase whitespace-nowrap">Group {gIdx + 1}:</h2>
                            <h2 className="min-w-0 truncate text-sm font-black" title={group.title}>{group.title}</h2>
                            <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${
                                groupComplete
                                    ? 'border-primary/30 bg-primary/10 text-primary'
                                    : 'border-border bg-muted/40 text-muted-foreground'
                            }`}>
                                {groupDone}/{groupTotal}
                            </span>
                        </div>
                        <div className="mb-3 h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${groupPercent}%` }}
                            />
                        </div>
                        <div className="mb-3 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setGroupItems(group.items, true)}
                                className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-primary hover:border-primary/60 hover:bg-primary/20 transition"
                            >
                                Mark Group
                            </button>
                            <button
                                type="button"
                                onClick={() => setGroupItems(group.items, false)}
                                className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-ring transition"
                            >
                                Reset
                            </button>
                        </div>
                        <div className="space-y-1">
                            {group.items.length === 0 && (
                                <div className="px-3 py-2 text-xs italic text-muted-foreground">No checks yet.</div>
                            )}
                            {group.items.map((item, iIdx) => (
                                <label key={item.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted/60 cursor-pointer group transition-colors border border-transparent hover:border-border">
                                    <input 
                                        type="checkbox" 
                                        className="mt-1 w-4 h-4 rounded border-border bg-background ![accent-color:hsl(var(--primary))] focus:ring-primary"
                                        checked={checklistState[item.id] || false}
                                        onChange={() => toggleItem(item.id)}
                                    />
                                    <span className={`text-sm transition-all ${checklistState[item.id] ? 'text-foreground' : 'text-muted-foreground'}`}>
                                        {itemLabel(gIdx, iIdx)}: {item.text}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                    );
                })}
            </div>
            )}

            {/* Safety procedures from Procedures/ (RAMS, appendices, SOPs); the header badge scrolls here */}
            <ProceduresPanel apiBaseUrl={apiBaseUrl} projectPath={projectPath} procedures={procedures} />
            <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
        </div>
    );
};

export default ChecklistPage;
