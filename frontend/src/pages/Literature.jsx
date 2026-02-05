import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, Upload, FileText, CheckCircle, Trash2, Loader2, ExternalLink, Search, Folder } from 'lucide-react';

const LiteraturePage = ({ projectPath }) => {
    const [isUploading, _setIsUploading] = useState(false);
    const [papers, setPapers] = useState([]); 
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        const fetchPapers = async () => {
            if (!projectPath) return;
            setIsLoading(true);
            try {
                const res = await fetch(`http://localhost:5000/list_research_pdfs?projectPath=${encodeURIComponent(projectPath)}`);
                const data = await res.json();
                if (data.success) {
                    // Alphabetical sort by full path
                    const sorted = data.files.sort((a, b) => a.localeCompare(b));
                    setPapers(sorted.map(path => {
                        const parts = path.split('/');
                        return {
                            name: parts.pop(),
                            folder: parts.length > 0 ? parts.join('/') : 'General',
                            fullPath: path
                        };
                    }));
                }
            } catch (error) {
                console.error("Failed to load library:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchPapers();
    }, [projectPath]);

    const filteredPapers = useMemo(() => {
        return papers.filter(paper => 
            paper.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            paper.folder.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [papers, searchTerm]);

    const handleViewPdf = (fullPath) => {
        const url = `http://localhost:5000/view_resource/${encodeURIComponent(fullPath)}?projectPath=${encodeURIComponent(projectPath)}`;
        window.open(url, '_blank');
    };

    const handleDelete = async (fullPath, fileName) => {
        if (!window.confirm(`Delete ${fileName}?`)) return;
        try {
            const res = await fetch('http://localhost:5000/delete_research_pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath, fileName: fullPath })
            });
            const data = await res.json();
            if (data.success) {
                setPapers(prev => prev.filter(p => p.fullPath !== fullPath));
            }
        } catch (error) {
            console.error("Delete failed:", error);
        }
    };

    return (
        <div className="flex flex-col h-[75vh] bg-background p-6 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <BookOpen className="text-muted-foreground" size={24} />
                    <h1 className="text-xl font-bold text-foreground uppercase tracking-tight">Research Library</h1>
                    <span className="bg-card text-muted-foreground text-[10px] px-2 py-0.5 rounded-full border border-border font-mono">
                        {papers.length} DOCUMENTS
                    </span>
                </div>
                
                <div className="flex items-center gap-4">
                    {/* Integrated Search Bar */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                        <input 
                            type="text"
                            placeholder="Search by name or category..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-card border border-border text-foreground text-xs pl-9 pr-4 py-1.5 rounded-lg focus:outline-none focus:border-ring transition-all w-64"
                        />
                    </div>

                    <label className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-lg cursor-pointer transition-all border border-border">
                        {isUploading ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                        <span className="text-sm font-bold">Upload PDF</span>
                        <input type="file" className="hidden" accept=".pdf" disabled={isUploading} />
                    </label>
                </div>
            </div>

            {/* Table UI */}
            <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border bg-background">
                <div className="col-span-5">File Name</div>
                <div className="col-span-3">Category</div>
                <div className="col-span-2 text-center">AI Status</div>
                <div className="col-span-2 text-right pr-2">Actions</div>
            </div>

            {isLoading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" size={32} /></div>
            ) : (
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filteredPapers.map((paper, idx) => (
                        <div key={idx} className="grid grid-cols-12 items-center px-4 py-3 border-b border-border/60 hover:bg-muted/40 transition-colors group">
                            {/* Document Title */}
                            <div className="col-span-5 flex items-center gap-3 cursor-pointer overflow-hidden" onClick={() => handleViewPdf(paper.fullPath)}>
                                <FileText size={16} className="text-muted-foreground group-hover:text-primary shrink-0" />
                                <span className="text-sm text-foreground/80 group-hover:text-foreground truncate pr-4">{paper.name}</span>
                            </div>

                            {/* Category (Subfolder) */}
                            <div className="col-span-3 flex items-center gap-2">
                                <Folder size={12} className="text-muted-foreground" />
                                <span className={`text-[11px] font-mono truncate ${paper.folder === 'Books' ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                                    {paper.folder}
                                </span>
                            </div>

                            <div className="col-span-2 flex justify-center">
                                <span className="text-[9px] text-blue-500 font-bold uppercase tracking-widest flex items-center gap-1.5 bg-blue-500/5 px-2 py-1 rounded-md border border-blue-500/10">
                                    <CheckCircle size={10} /> Indexed
                                </span>
                            </div>

                            <div className="col-span-2 flex justify-end gap-2 pr-2">
                                <button onClick={() => handleViewPdf(paper.fullPath)} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><ExternalLink size={14}/></button>
                                <button onClick={() => handleDelete(paper.fullPath, paper.name)} className="text-zinc-600 hover:text-red-400 p-1 transition-colors"><Trash2 size={14}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default LiteraturePage;
