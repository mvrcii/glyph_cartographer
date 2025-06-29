import React from 'react';

interface LabelEditorBrushControlsProps {
    brushSize: number;
    setBrushSize: (s: number) => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export function LabelEditorBrushControls({
    brushSize,
    setBrushSize,
    containerRef,
}: LabelEditorBrushControlsProps) {

    return (
        <div
            className="absolute top-1/2 -translate-y-1/2 right-4 bg-gray-900/80 backdrop-blur-sm text-white p-4 rounded-lg shadow-2xl flex flex-col space-y-6 z-30 w-48"
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Brush Size Control */}
            <div className="flex flex-col space-y-2">
                <label htmlFor="brush-size" className="text-sm font-medium text-center">Brush
                    Size: {brushSize}px</label>
                <input
                    id="brush-size"
                    type="range"
                    min={2}
                    max={50}
                    step={1}
                    value={brushSize}
                    onChange={e => setBrushSize(Number(e.target.value))}
                    onMouseUp={() => containerRef.current?.focus()}
                    className="w-full h-2 appearance-none bg-gray-600 rounded-full outline-none cursor-pointer"
                />
            </div>
        </div>
    );
};