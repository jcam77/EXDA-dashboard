import React from 'react';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';

const UnifiedModal = ({ modal, setModal }) => {
    if (!modal?.show) return null;
    const actions = Array.isArray(modal.actions) ? modal.actions : null;
    const closeModal = () => {
        if (typeof modal?.onClose === 'function') {
            modal.onClose();
            return;
        }
        setModal({ ...modal, show: false });
    };

    const getActionClasses = (variant) => {
        if (variant === 'destructive') {
            return 'bg-destructive/15 text-destructive border border-destructive/40 hover:bg-destructive/25';
        }
        if (variant === 'primary') {
            return 'bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25';
        }
        return 'bg-muted text-foreground border border-border hover:bg-muted/80';
    };

        return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-card p-6 rounded-xl border border-border w-[450px] shadow-sm flex flex-col gap-4 relative text-foreground">
                <button onClick={closeModal} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"><X size={20}/></button>
                <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${modal.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500' : 'bg-destructive/15 border-destructive/30 text-destructive'}`}>
                        {modal.type === 'success' ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold">{modal.title}</h3>
                        <div className="mt-2 text-sm text-muted-foreground">{modal.content}</div>
                    </div>
                </div>
                <div className="flex justify-end mt-2 gap-2">
                    {actions ? (
                        actions.map((action, index) => (
                            <button
                                key={index}
                                onClick={action.onClick}
                                className={`px-4 py-2 rounded-md text-sm font-bold transition ${getActionClasses(action.variant)}`}
                            >
                                {action.label}
                            </button>
                        ))
                    ) : (
                        <button onClick={closeModal} className="px-6 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md text-sm font-bold border border-border">Close</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UnifiedModal;
