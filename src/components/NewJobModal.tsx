import React, { useState } from 'react';
import { Plus, BookOpen, Music, Trash2 } from 'lucide-react';

interface NewJobModalProps {
  onClose: () => void;
  onCreateJob: (jobData: {
    name: string;
    author?: string;
    narrator?: string;
    parts: Array<{ name: string; durationSeconds: number; sizeBytes: number; bitrate: number }>;
  }) => Promise<void>;
}

export const NewJobModal: React.FC<NewJobModalProps> = ({ onClose, onCreateJob }) => {
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [narrator, setNarrator] = useState('');
  const [parts, setParts] = useState<Array<{ name: string; durationSeconds: number; sizeBytes: number; bitrate: number }>>([
    { name: '01 - Part 1.mp3', durationSeconds: 2100, sizeBytes: 42000000, bitrate: 128 },
    { name: '02 - Part 2.mp3', durationSeconds: 2400, sizeBytes: 48000000, bitrate: 128 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddPart = () => {
    const nextIdx = parts.length + 1;
    setParts([
      ...parts,
      {
        name: `${nextIdx.toString().padStart(2, '0')} - Part ${nextIdx}.mp3`,
        durationSeconds: 1800,
        sizeBytes: 36000000,
        bitrate: 128,
      },
    ]);
  };

  const handleRemovePart = (index: number) => {
    if (parts.length <= 1) return;
    setParts(parts.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onCreateJob({
        name: name.trim(),
        author: author.trim(),
        narrator: narrator.trim(),
        parts,
      });
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to create job');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-stone-200 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900 font-bold text-base">
            <BookOpen className="w-5 h-5 text-amber-600" />
            <span>Create a new audiobook project</span>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-lg cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-stone-800 block mb-1">
              Book title *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Neuromancer"
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs bg-stone-50 focus:bg-white text-stone-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-stone-800 block mb-1">Author</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="William Gibson"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs bg-stone-50 focus:bg-white text-stone-900"
              />
            </div>
            <div>
              <label className="font-semibold text-stone-800 block mb-1">Narrator</label>
              <input
                type="text"
                value={narrator}
                onChange={(e) => setNarrator(e.target.value)}
                placeholder="Robertson Dean"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs bg-stone-50 focus:bg-white text-stone-900"
              />
            </div>
          </div>

          <p className="text-[11px] text-stone-500 -mt-2">This creates an empty project. You will choose its audio folder on the next screen.</p>
          {/* Parts list */}
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-stone-800">
                Example source files ({parts.length})
              </span>
              <button
                type="button"
                onClick={handleAddPart}
                className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 flex items-center space-x-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Part</span>
              </button>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {parts.map((p, idx) => (
                <div key={idx} className="flex items-center space-x-2 bg-white p-1.5 rounded border border-stone-200">
                  <span className="font-mono text-stone-400 w-5 text-center font-bold text-[10px]">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => {
                      const updated = [...parts];
                      updated[idx].name = e.target.value;
                      setParts(updated);
                    }}
                    className="flex-1 text-xs border-0 p-0 focus:ring-0 text-stone-900"
                  />
                  {parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemovePart(idx)}
                      className="text-stone-400 hover:text-red-600 p-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs border border-stone-300 text-stone-700 hover:bg-stone-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-1.5 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
            >
              {isSubmitting ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
