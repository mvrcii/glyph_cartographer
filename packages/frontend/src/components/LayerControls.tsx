import React from 'react';
import {ArrowDown, ArrowUp, Layers, Square} from 'lucide-react';
import type {KmlLayerConfig} from '../App';
import type {OAITilePrediction} from "../hooks/useOAIPredictionLayers.ts";
import {OpenAIIcon} from "./toolbar/OaiModelSelector.tsx";

interface LayerControlsProps {
    showExistingTiles: boolean;
    setShowExistingTiles: (v: boolean) => void;
    showGoodNegatives: boolean;
    showDiscoveries: boolean;
    showLabels: boolean;
    setShowLabels: (v: boolean) => void;
    labelsColor: string;
    setLabelsColor: (c: string) => void;
    negativesColor: string;
    setNegativesColor: (c: string) => void;
    discoveriesColor: string;
    setDiscoveriesColor: (c: string) => void;
    existingColor: string;
    setExistingColor: (c: string) => void;
    labelsOpacity: number;
    setLabelsOpacity: (o: number) => void;
    showGeoglyphs: boolean;
    setShowGeoglyphs: (v: boolean) => void;
    kmlLayers: KmlLayerConfig[];
    setKmlLayers: React.Dispatch<React.SetStateAction<KmlLayerConfig[]>>;
    kmlLayerVisibility: Record<string, boolean>;
    onToggleKmlLayerVisibility: (filename: string) => void;
    onReorderKmlLayer: (fromIndex: number, toIndex: number) => void;
    appContainerRef: React.RefObject<HTMLDivElement | null>;
    modelsWithPredictions: string[];
    predictionVisibility: Map<string, boolean>;
    predictionOpacities: Map<string, number>;
    onTogglePredictionVisibility: (modelName: string) => void;
    onPredictionOpacityChange: (modelName: string, opacity: number) => void;
    onLoadPredictionTiles: (modelName: string) => void;
    predictionColors: Map<string, string>;
    onPredictionColorChange: (modelName: string, color: string) => void;
    onToggleIndicatorLayer: (layer: 'negatives' | 'discoveries', isVisible: boolean) => void;
    oaiPredictions: Map<string, Map<string, OAITilePrediction>>;
    oaiVisibility: Map<string, boolean>;
    onToggleOaiVisibility: (modelName: string) => void;
}

const extractNumberFromName = (name: string): number => {
    const match = name.match(/-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

export function LayerControls({
                                  showExistingTiles,
                                  setShowExistingTiles,
                                  showGoodNegatives,
                                  showDiscoveries,
                                  showLabels,
                                  setShowLabels,
                                  labelsColor,
                                  setLabelsColor,
                                  negativesColor,
                                  setNegativesColor,
                                  discoveriesColor,
                                  setDiscoveriesColor,
                                  setExistingColor,
                                  existingColor,
                                  labelsOpacity,
                                  setLabelsOpacity,
                                  showGeoglyphs,
                                  setShowGeoglyphs,
                                  kmlLayers,
                                  setKmlLayers,
                                  kmlLayerVisibility,
                                  onToggleKmlLayerVisibility,
                                  onReorderKmlLayer,
                                  appContainerRef,
                                  modelsWithPredictions,
                                  predictionVisibility,
                                  predictionOpacities,
                                  onTogglePredictionVisibility,
                                  onPredictionOpacityChange,
                                  onLoadPredictionTiles,
                                  predictionColors,
                                  onPredictionColorChange,
                                  onToggleIndicatorLayer,
                                  oaiPredictions,
                                  oaiVisibility,
                                  onToggleOaiVisibility
                              }: LayerControlsProps) {

    const handleFocusReturn = () => {
        appContainerRef.current?.focus();
    };

    const sortedModels = React.useMemo(() => {
        return [...modelsWithPredictions].sort((a, b) => {
            const numA = extractNumberFromName(a);
            const numB = extractNumberFromName(b);
            return numB - numA;
        });
    }, [modelsWithPredictions]);

    return (
        <div
            className="absolute bottom-8 right-4 bg-black/40 backdrop-blur-sm rounded-md shadow-lg p-3 z-[1000] text-xs text-white max-w-xs  min-w-[280px]">

            <div className="space-y-2 mb-2">
                <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showGoodNegatives}
                            onChange={(e) => {
                                onToggleIndicatorLayer('negatives', e.target.checked);
                                handleFocusReturn();
                            }}
                            className="w-3.5 h-3.5 border-gray-400 rounded"
                            style={{accentColor: negativesColor}}
                        />
                        <Square
                            className="w-3 h-3"
                            strokeWidth={2}
                            fillOpacity={0.2}
                            style={{color: negativesColor, backgroundColor: negativesColor}}
                        />
                        <span>Show Negatives</span>
                    </label>

                    {showGoodNegatives && (
                        <div className="flex items-center space-x-2 ml-2 fixed-right">
                            <input
                                type="color"
                                value={negativesColor}
                                className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                onChange={(e) => setNegativesColor(e.target.value)}
                            />
                            <div className="w-16 h-1 bg-transparent pointer-events-none"/>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showDiscoveries}
                            onChange={(e) => {
                                onToggleIndicatorLayer('discoveries', e.target.checked);
                                handleFocusReturn();
                            }}
                            className="w-3.5 h-3.5 border-gray-400 rounded"
                            style={{accentColor: discoveriesColor}}
                        />
                        <Square
                            className="w-3 h-3"
                            strokeWidth={2}
                            fillOpacity={0.2}
                            style={{color: discoveriesColor, backgroundColor: discoveriesColor}}
                        />
                        <span>Show Discoveries</span>
                    </label>

                    {showDiscoveries && (
                        <div className="flex items-center space-x-2 ml-2 fixed-right">
                            <input
                                type="color"
                                value={discoveriesColor}
                                className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                onChange={(e) => setDiscoveriesColor(e.target.value)}
                            />
                            <div className="w-16 h-1 bg-transparent pointer-events-none"/>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer" title="Toggle with key '1'">
                        <input
                            type="checkbox"
                            checked={showLabels}
                            onChange={(e) => {
                                setShowLabels(e.target.checked);
                                handleFocusReturn();
                            }}
                            className="w-3.5 h-3.5 border-gray-400 rounded"
                            style={{accentColor: labelsColor}}
                        />
                        <Square
                            className="w-3 h-3"
                            strokeWidth={2}
                            fillOpacity={0.2}
                            style={{color: labelsColor, backgroundColor: labelsColor}}
                        />
                        <span>Show Labels</span>
                    </label>

                    {showLabels && (
                        <div className="flex items-center space-x-2 ml-2 fixed-right">
                            <input
                                type="color"
                                value={labelsColor}
                                className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                onChange={(e) => setLabelsColor(e.target.value)}
                            />
                            <input
                                type="range" min={0.05} max={1.0} step={0.05}
                                value={labelsOpacity}
                                onChange={(e) => setLabelsOpacity(parseFloat(e.target.value))}
                                className="w-16 h-1 appearance-none bg-white/30 rounded-full outline-none cursor-pointer"
                                title={`Opacity: ${Math.round(labelsOpacity * 100)}%`}
                            />
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showExistingTiles}
                            onChange={(e) => {
                                setShowExistingTiles(e.target.checked);
                                handleFocusReturn();
                            }}
                            className="w-3.5 h-3.5 border-gray-400 rounded"
                            style={{accentColor: existingColor}}
                        />
                        <Square
                            className="w-3 h-3"
                            strokeWidth={2}
                            fillOpacity={0.2}
                            style={{color: existingColor, backgroundColor: existingColor}}
                        />
                        <span>Show Downloaded</span>
                    </label>

                    {showExistingTiles && (
                        <div className="flex items-center space-x-2 ml-2 fixed-right">
                            <input
                                type="color"
                                value={existingColor}
                                className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                onChange={(e) => setExistingColor(e.target.value)}
                            />
                            <div className="w-16 h-1 bg-transparent pointer-events-none"/>
                        </div>
                    )}
                </div>
            </div>

            <div className="pt-2 border-t border-white/20">
                <div className="flex items-center space-x-1.5 mb-2">
                    <span>Model Predictions</span>
                </div>
                <div className="pl-2 space-y-2">
                    {sortedModels.length === 0 && <span className="text-gray-400 italic">No predictions found.</span>}
                    {sortedModels.map((modelName, index) => {
                        const isVisible = predictionVisibility.get(modelName) ?? false;
                        const opacity = predictionOpacities.get(modelName) ?? 0.7;
                        const color = predictionColors.get(modelName) ?? '#3b82f6';
                        const hasOai = oaiPredictions.has(modelName) && (oaiPredictions.get(modelName)?.size ?? 0) > 0;
                        const isOaiVisible = oaiVisibility.get(modelName) ?? false;

                        return (
                            <div key={modelName} className="flex items-center justify-between group/layer-item">
                                <label className="flex items-center space-x-2 cursor-pointer"
                                       title={`Toggle with '${index + 2}'`}>
                                    <input
                                        type="checkbox"
                                        checked={isVisible}
                                        onChange={() => {
                                            if (!isVisible) onLoadPredictionTiles(modelName);
                                            onTogglePredictionVisibility(modelName);
                                            handleFocusReturn();
                                        }}
                                        className="w-3.5 h-3.5 border-gray-400 rounded"
                                        style={{accentColor: color}}
                                    />
                                    <span className="truncate max-w-[120px]">{modelName}</span>
                                </label>

                                <div className="flex items-center space-x-2 ml-2">
                                    {isVisible && hasOai && (
                                        <button
                                            title="Toggle OAI Predictions"
                                            onClick={() => {
                                                onToggleOaiVisibility(modelName);
                                            }}
                                            className="p-0 rounded transition-colors"
                                        >
                                            <OpenAIIcon className={isOaiVisible ? "text-yellow-300 w-3.5 h-3.5 p-0" : "w-3.5 h-3.5 p-0 text-gray-400 hover:text-yellow-400"}/>
                                        </button>
                                    )}
                                    {isVisible && (
                                        <>
                                            <input
                                                type="color"
                                                value={color}
                                                className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                                onChange={(e) => onPredictionColorChange(modelName, e.target.value)}
                                            />
                                            <input
                                                type="range" min={0.05} max={1.0} step={0.05}
                                                value={opacity}
                                                onChange={(e) => onPredictionOpacityChange(modelName, parseFloat(e.target.value))}
                                                className="w-16 h-1 appearance-none bg-white/30 rounded-full outline-none cursor-pointer"
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

            <div className="mt-2 pt-2 border-t border-white/20">
                <label className="flex items-center space-x-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={showGeoglyphs}
                           onChange={(e) => {
                               setShowGeoglyphs(e.target.checked);
                               handleFocusReturn();
                           }}
                           className="w-4 h-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"/>
                    <div className="flex items-center space-x-1.5">
                        <Layers className="w-3 h-3"/>
                        <span>Show KML Layers</span>
                    </div>
                </label>

                {showGeoglyphs && (
                    <div className="pl-2 space-y-2">
                        {kmlLayers.map((layer, index) => {
                            const isFirst = index === 0;
                            const isLast = index === kmlLayers.length - 1;
                            return (
                                <div key={layer.filename}
                                     className="flex items-center justify-between group/layer-item">
                                    <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={kmlLayerVisibility[layer.filename]}
                                            onChange={() => {
                                                onToggleKmlLayerVisibility(layer.filename);
                                                handleFocusReturn();
                                            }}
                                            className="w-3.5 h-3.5 border-gray-400 rounded"
                                            style={{accentColor: layer.color}}
                                        />
                                        <span>{layer.name}</span>
                                    </label>
                                    <div className="flex items-center space-x-2 ml-2">
                                        <input
                                            type="color"
                                            value={layer.color}
                                            className="w-4 h-4 p-0 border-none rounded cursor-pointer bg-transparent"
                                            onChange={(e) => {
                                                const newColor = e.target.value;
                                                setKmlLayers(currentLayers => {
                                                    const newLayers = [...currentLayers];
                                                    newLayers[index] = {...newLayers[index], color: newColor};
                                                    return newLayers;
                                                });
                                            }}
                                        />
                                        <input
                                            type="range"
                                            min={0.02} max={0.8} step={0.01}
                                            value={layer.opacity ?? 0.4}
                                            onChange={(e) => {
                                                const newOpacity = parseFloat(e.target.value);
                                                setKmlLayers(currentLayers => {
                                                    const newLayers = [...currentLayers];
                                                    newLayers[index] = {...newLayers[index], opacity: newOpacity};
                                                    return newLayers;
                                                });
                                            }}
                                            className="w-16 h-1 appearance-none bg-white/30 rounded-full outline-none cursor-pointer"
                                            title={`Opacity: ${Math.round((layer.opacity ?? 0.4) * 100)}%`}
                                        />
                                        <div
                                            className="opacity-0 group-hover/layer-item:opacity-100 transition-opacity flex">
                                            {!isFirst && <ArrowUp onClick={() => onReorderKmlLayer(index, index - 1)}
                                                                  className="w-3 h-3 cursor-pointer hover:text-white"/>}
                                            {!isLast && <ArrowDown onClick={() => onReorderKmlLayer(index, index + 1)}
                                                                   className="w-3 h-3 cursor-pointer hover:text-white"/>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}