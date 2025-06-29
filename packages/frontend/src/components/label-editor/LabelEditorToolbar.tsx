import {Eraser, Paintbrush, Redo, Save, Sparkles, Trash2, Undo, X} from 'lucide-react';
import type {LabelingTool} from './LabelEditor';

interface LabelEditorToolbarProps {
    onSave: () => void;
    isSaving: boolean;
    onClose: () => void;
    onClear: () => void;
    tool: LabelingTool;
    setTool: (tool: LabelingTool) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    isBoosted: boolean;
    setIsBoosted: (value: boolean) => void;
}

export function LabelEditorToolbar({
                                       onSave, isSaving, onClose, onClear, tool, setTool,
                                       undo, redo, canUndo, canRedo,
                                       isBoosted, setIsBoosted
                                   }: LabelEditorToolbarProps) {

    // --- Style constants adjusted for a dark background ---
    const baseStyle = "px-2.5 py-1.5 border-2 rounded-md focus:outline-none transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed";

    // Neutral buttons for Save, Undo, etc.
    const neutralStyle = "bg-gray-700/50 border-gray-600 text-gray-200 hover:bg-gray-700 hover:border-gray-500";

    // Dark-mode friendly color schemes for tools
    const greenScheme = "bg-transparent border-green-700 text-green-400 hover:bg-green-900/50";
    const activeGreenScheme = "bg-green-600 text-white border-green-500 shadow-lg";

    const redScheme = "bg-transparent border-red-700 text-red-400 hover:bg-red-900/50";
    const activeRedScheme = "bg-red-600 text-white border-red-500 shadow-lg";

    const blueScheme = "bg-transparent border-blue-700 text-blue-400 hover:bg-blue-900/50";
    const activeBlueScheme = "bg-blue-600 text-white border-blue-500 shadow-lg";

    return (
        <div
            className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/80 backdrop-blur-sm rounded-lg shadow-2xl p-2 z-40">
            <div className="flex items-center space-x-3">

                {/* --- Main Actions --- */}
                <button onClick={onSave} disabled={isSaving} className={`${baseStyle} ${neutralStyle}`}>
                    <Save size={20}/>
                    <span className="ml-2 font-semibold">{isSaving ? 'Saving...' : 'Save'}</span>
                </button>
                <button onClick={onClose} title="Close Editor (Esc)" className={`${baseStyle} ${neutralStyle}`}><X
                    size={20}/></button>

                <div className="pl-1 border-l-2 border-gray-600"/>

                {/* --- Tool Selection (Restored Order & Dark Mode Colors) --- */}
                <button title="Brush Tool (B)" onClick={() => setTool('brush')}
                        className={`${baseStyle} ${tool === 'brush' ? activeGreenScheme : greenScheme}`}>
                    <Paintbrush size={20}/>
                </button>
                <button title="Erase Tool (E)" onClick={() => setTool('erase')}
                        className={`${baseStyle} ${tool === 'erase' ? activeRedScheme : redScheme}`}>
                    <Eraser size={20}/>
                </button>
                <button title="Boost Prediction Visibility (V)" onClick={() => setIsBoosted(!isBoosted)}
                        className={`${baseStyle} ${isBoosted ? activeBlueScheme : blueScheme}`}>
                    <Sparkles size={20}/>
                </button>

                <div className="pl-1 border-l-2 border-gray-600"/>

                {/* --- History and Clear (Restored Order) --- */}
                <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                        className={`${baseStyle} ${neutralStyle}`}><Undo size={20}/></button>
                <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                        className={`${baseStyle} ${neutralStyle}`}><Redo size={20}/></button>
                <button onClick={onClear} title="Clear Canvas (C)" className={`${baseStyle} ${neutralStyle}`}><Trash2
                    size={20}/></button>

            </div>
        </div>
    );
}