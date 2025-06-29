import React from 'react';

interface LabelEditorLayerControlsProps {
    isLabelLayerVisible: boolean;
    onToggleLabelLayerVisibility: () => void;
    labelLayerOpacity: number;
    onLabelLayerOpacityChange: (opacity: number) => void;
    brushColor: string;
    setBrushColor: (color: string) => void;
    modelsWithPredictions: string[];
    predictionVisibility: Map<string, boolean>;
    predictionOpacities: Map<string, number>;
    predictionColors: Map<string, string>;
    onTogglePredictionVisibility: (modelName: string) => void;
    onPredictionOpacityChange: (modelName: string, opacity: number) => void;
    onPredictionColorChange: (modelName: string, color: string) => void;
    onLoadPredictionTiles: (modelName: string) => void;
    appContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function LabelEditorLayerControls({
    isLabelLayerVisible,
    onToggleLabelLayerVisibility,
    labelLayerOpacity,
    onLabelLayerOpacityChange,
    brushColor,
    setBrushColor,
    modelsWithPredictions,
    predictionVisibility,
    predictionOpacities,
    predictionColors,
    onTogglePredictionVisibility,
    onPredictionOpacityChange,
    onPredictionColorChange,
    onLoadPredictionTiles,
    appContainerRef
}: LabelEditorLayerControlsProps) {

    const handleFocusReturn = () => {
        appContainerRef.current?.focus();
    };

    return (
        <div
            className="absolute bottom-8 right-4 bg-gray-900/80 backdrop-blur-sm rounded-lg shadow-2xl p-3 z-30 text-xs text-white max-w-xs min-w-[280px]"
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="pb-1">
                <div className="flex items-center justify-between group/layer-item">
                    <label className="flex items-center space-x-2 cursor-pointer" title="Toggle with key '1'">
                        <input
                            type="checkbox"
                            checked={isLabelLayerVisible}
                            onChange={() => { onToggleLabelLayerVisibility(); handleFocusReturn(); }}
                            className="w-4 h-4 text-teal-500 focus:ring-teal-400 border-gray-300 rounded"
                        />
                         <div className="flex items-center space-x-1.5">
                            <span>Label</span>
                        </div>
                    </label>
                    <div className="flex items-center space-x-2 ml-2">
                        {isLabelLayerVisible && (
                            <>
                                <input
                                    type="color"
                                    value={brushColor}
                                    className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                    onChange={(e) => setBrushColor(e.target.value)}
                                />
                                <input
                                    type="range" min={0} max={1.0} step={0.05}
                                    value={labelLayerOpacity}
                                    onChange={(e) => onLabelLayerOpacityChange(parseFloat(e.target.value))}
                                    onMouseUp={handleFocusReturn}
                                    className="w-20 h-1 appearance-none bg-white/30 rounded-full outline-none cursor-pointer"
                                    title={`Opacity: ${Math.round(labelLayerOpacity * 100)}%`}
                                />
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-1 pt-1">
                <div className="flex items-center space-x-1.5 mb-2">
                    <span>Model Predictions</span>
                </div>
                <div className="pl-2 space-y-2 max-h-64 overflow-y-auto">
                    {modelsWithPredictions.length === 0 && <span className="text-gray-400 italic">No predictions in this area.</span>}
                    {modelsWithPredictions.map((modelName, index) => {
                        const isVisible = predictionVisibility.get(modelName) ?? false;
                        const opacity = predictionOpacities.get(modelName) ?? 0.7;
                        const color = predictionColors.get(modelName) ?? '#3b82f6';

                        return (
                            <div key={modelName} className="flex items-center justify-between group/layer-item">
                                <label className="flex items-center space-x-2 cursor-pointer" title={`${modelName} (toggle with key '${index+2}')`}>
                                    <input
                                        type="checkbox"
                                        checked={isVisible}
                                        onChange={() => { if (!isVisible) onLoadPredictionTiles(modelName); onTogglePredictionVisibility(modelName); handleFocusReturn(); }}
                                        className="w-4 h-4 border-gray-400 rounded"
                                        style={{accentColor: color}}
                                    />
                                    <span className="truncate max-w-[120px]">{modelName}</span>
                                </label>
                                <div className="flex items-center space-x-2 ml-2">
                                    {isVisible && (
                                        <>
                                            <input
                                                type="color"
                                                value={color}
                                                className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                                onChange={(e) => onPredictionColorChange(modelName, e.target.value)}
                                            />
                                            <input
                                                type="range" min={0} max={1.0} step={0.05}
                                                value={opacity}
                                                onChange={(e) => onPredictionOpacityChange(modelName, parseFloat(e.target.value))}
                                                onMouseUp={handleFocusReturn}
                                                className="w-20 h-1 appearance-none bg-white/30 rounded-full outline-none cursor-pointer"
                                                title={`Opacity: ${Math.round(opacity * 100)}%`}
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}