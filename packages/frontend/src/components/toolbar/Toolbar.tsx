import React, {useEffect, useState} from "react";
import type {Mode, Tool} from "../../types.ts";
import {Download, Edit, Eraser, Layers, Paintbrush, RefreshCw, Sparkles, Square, TreePine, X} from "lucide-react";
import type {CursorPosition, NavigationTarget} from "../MapCanvas.tsx";
import type {ToastType} from "../Toast.tsx";
import {OaiModelSelector} from './OaiModelSelector.tsx';
import {CoordinateDisplay} from "./CoordinateDisplay.tsx";
import {SegmentationModelSelector} from "./SegmentationModelSelector.tsx";


export function Toolbar({
                            currentTool,
                            setTool,
                            onDownload,
                            onClear,
                            onInference,
                            onStartLabeling,
                            onSyncLabels,
                            cursorPosition,
                            onNavigate,
                            mode,
                            availableModels,
                            selectedModel,
                            setSelectedModel,
                            selectionSize,
                            brightnessThreshold,
                            setBrightnessThreshold,
                            onFetchModels,
                            useTTA,
                            setUseTTA,
                            zoomThreshold,
                            setZoomThreshold,
                            showToast,
                            useOAI,
                            setUseOAI,
                            availableOaiModels,
                            oaiModelName,
                            setOaiModelName,
                        }: {
    currentTool: Tool;
    setTool: (tool: Tool) => void;
    onDownload: () => void;
    onClear: () => void;
    onInference: () => void;
    onStartLabeling: () => void;
    onSyncLabels: () => void;
    cursorPosition: CursorPosition;
    onNavigate: (target: NavigationTarget) => void;
    mode: Mode;
    availableModels: string[];
    selectedModel: string;
    setSelectedModel: (model: string) => void;
    selectionSize: number;
    brightnessThreshold: number;
    setBrightnessThreshold: (value: number) => void;
    onFetchModels: () => void;
    useTTA: boolean;
    setUseTTA: (value: boolean) => void;
    zoomThreshold: number;
    setZoomThreshold: (value: number) => void;
    showToast: (t: ToastType, msg: string, dur?: number | null) => string;
    useOAI: boolean;
    setUseOAI: (value: boolean) => void;
    availableOaiModels: string[];
    oaiModelName: string;
    setOaiModelName: (model: string) => void;
}) {
    const inactiveStyle = "bg-white text-gray-700 border-gray-300 hover:bg-gray-100";
    const disabledStyle = "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-50";

    const greenScheme = "bg-white border-green-400 text-green-600 hover:bg-green-100";
    const activeGreenScheme = "bg-green-600 text-white border-green-600 shadow-inner";
    const redScheme = "bg-white border-red-400 text-red-600 hover:bg-red-100";
    const activeRedScheme = "bg-red-600 text-white border-red-600 shadow-inner";
    const blueScheme = "bg-white border-blue-400 text-blue-600 hover:bg-blue-100";
    const activeBlueScheme = "bg-blue-600 text-white border-blue-600 shadow-inner";
    const purpleScheme = "bg-white border-purple-400 text-purple-600 hover:bg-purple-100";

    const [sliderVal, setSliderVal] = useState(zoomThreshold);
    useEffect(() => {
        setSliderVal(zoomThreshold);
    }, [zoomThreshold]);

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSliderVal(Number(e.target.value));
    };

    const handleSliderRelease = () => {
        setZoomThreshold(sliderVal);
    };


    return (
        <div className="flex items-center space-x-2 p-2 bg-white shadow rounded">

            {mode === 'download' && currentTool === 'rectangle' && (
                <div className="flex items-center space-x-2 pr-3 border-r-2 mr-2" title="Forest Brightness Threshold">
                    <TreePine size={20} className="text-green-600" strokeWidth={3}/>
                    <input
                        type="range"
                        min="10"
                        max="100"
                        value={brightnessThreshold}
                        onChange={(e) => setBrightnessThreshold(Number(e.target.value))}
                        className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        title={`Brightness Threshold: ${brightnessThreshold}`}
                    />
                    <div className="bg-gray-200 rounded px-2 py-0.5 min-w-[40px] text-center">
                        <span className="text-sm font-mono text-gray-700">{brightnessThreshold}</span>
                    </div>
                </div>
            )}

            <div className="flex space-x-2">
                <button title="Rectangle Tool (R)" onClick={() => setTool("rectangle")}
                        className={`btn-icon ${currentTool === "rectangle" ? activeBlueScheme : blueScheme}`}>
                    <Square className="w-6 h-6"/>
                </button>

                <button title="Brush Tool (B)" onClick={() => setTool("brush")}
                        className={`btn-icon ${currentTool === "brush" ? activeGreenScheme : greenScheme}`}>
                    <Paintbrush className="w-6 h-6"/>
                </button>

                <button title="Erase Tool (E)" onClick={() => setTool("erase")}
                        className={`btn-icon ${currentTool === "erase" ? activeRedScheme : redScheme}`}>
                    <Eraser className="w-6 h-6"/>
                </button>

                <button title="Clear Selection (C)" onClick={onClear} className={`btn-icon ${inactiveStyle}`}>
                    <X className="w-6 h-6"/>
                </button>

                <div className="flex items-center mx-2">
                    <div className="w-px h-8 bg-gray-300 border-l-1"/>
                </div>

                {mode === "download" && (
                    <>
                        <button title="Download Selection (D)" onClick={onDownload}
                                className={`btn-icon ${selectionSize > 0 ? inactiveStyle : disabledStyle}`}
                                disabled={selectionSize === 0}>
                            <Download className="w-6 h-6"/>
                        </button>
                        <button
                            title="Sync ML Training Data"
                            onClick={onSyncLabels}
                            className={`btn-icon ${purpleScheme}`}>
                            <RefreshCw className="w-6 h-6"/>
                        </button>
                    </>
                )}

                {mode === "inference" && (
                    <>
                        <button title="Start Inference (I)" onClick={onInference}
                                className={`btn-icon ${selectionSize > 0 ? inactiveStyle : disabledStyle}`}
                                disabled={selectionSize === 0}>
                            <Sparkles className="w-6 h-6"/>
                        </button>
                        <button title="Toggle Test-Time Augmentation (TTA)"
                                onClick={() => setUseTTA(!useTTA)}
                                className={`btn ${useTTA ? activeBlueScheme : blueScheme}`}>
                            <span className="tracking-wide text-sm font-semibold font-mono">TTA</span>
                        </button>

                        <OaiModelSelector
                            useOAI={useOAI}
                            setUseOAI={setUseOAI}
                            availableOaiModels={availableOaiModels}
                            oaiModelName={oaiModelName}
                            setOaiModelName={setOaiModelName}
                            showToast={showToast}
                        />
                    </>
                )}

                {mode === "label" && (
                    <button title="Annotate Selection (L)" onClick={onStartLabeling}
                            className={`btn-icon ${selectionSize > 0 ? inactiveStyle : disabledStyle}`}
                            disabled={selectionSize === 0}>
                        <Edit className="w-6 h-6"/>
                    </button>
                )}
            </div>


            {mode === 'inference' && (
                <SegmentationModelSelector
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    availableModels={availableModels}
                    onFetchModels={onFetchModels}
                />
            )}

            <div className="flex items-center mx-2">
                <div className="w-px h-8 bg-gray-300 border-l-1"/>
            </div>

            <div
                className="flex items-center space-x-2 h-10 px-2 rounded-lg bg-white border-2 border-gray-300"
                title="Imagery Zoom Threshold"
            >
                <Layers size={20} className="text-gray-600 flex-shrink-0 mr-1" strokeWidth={1.5}/>
                <input
                    type="range"
                    min="14"
                    max="17"
                    step="1"
                    value={sliderVal}
                    onChange={handleSliderChange}
                    onMouseUp={handleSliderRelease}
                    onTouchEnd={handleSliderRelease}
                    className="w-24 h-0.5 cursor-pointer bg-gray-400 accent-blue-300 slider-thumb-sm"
                    title={`Imagery Zoom Threshold: ${sliderVal}`}
                />
                <div
                    className="bg-white border-0 border-gray-300 rounded-lg px-1 min-w-[32px] flex-shrink-0 flex items-center justify-center">
                    <span className="text-sm font-mono text-gray-700">{sliderVal}</span>
                </div>
            </div>

            <CoordinateDisplay cursorPosition={cursorPosition} onNavigate={onNavigate} showToast={showToast}/>
        </div>
    );
}