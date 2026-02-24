import React, { useEffect, useState } from 'react';

const Notes: React.FC = () => {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const response = await fetch('/api/notes');
        if (!response.ok) throw new Error('Failed to fetch notes');
        const data = await response.json();
        setNotes(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchNotes();
  }, []);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading notes...</div>;
  if (error) return <div className="p-8 text-center text-rose-500">Error: {error}</div>;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Notes</h2>
      </div>
      
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Raw Supabase Data</p>
        <pre className="bg-slate-50 p-4 rounded-xl overflow-auto text-xs font-mono text-slate-700 max-h-[500px]">
          {JSON.stringify(notes, null, 2)}
        </pre>
      </div>

      {notes.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
          <p className="text-slate-400">No notes found in the "notes" table.</p>
        </div>
      )}
    </div>
  );
};

export default Notes;
