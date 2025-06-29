import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Point} from '../../types.ts';
import {useLabeling} from '../../hooks/useLabeling.ts';
import {LabelEditorToolbar} from './LabelEditorToolbar.tsx';
import {AlertModal} from '../AlertModal.tsx';
import {useToast} from '../Toast.tsx';
import {LabelEditorLayerControls} from "./LabelEditorLayerControls.tsx";
import {LabelEditorBrushControls} from "./LabelEditorBrushControls.tsx";
import {hexToRgb} from "../../utils/colorUtils.ts";

interface LabelEditorProps {
    isOpen: boolean;
    onClose: () => void;
    onLabelsSaved: () => void;
    selectedTiles: Set<string>;
    labelMaskVersion: number;
    Z: number;
    modelsWithPredictions: string[];
    allPredictionTiles: Map<string, Set<string>>;
    predictionVisibility: Map<string, boolean>;
    predictionOpacities: Map<string, number>;
    predictionColors: Map<string, string>;
    onLoadPredictionTiles: (modelName: string) => void;
    onTogglePredictionVisibility: (modelName: string) => void;
    onPredictionOpacityChange: (modelName: string, opacity: number) => void;
    onPredictionColorChange: (modelName: string, color: string) => void;
    appContainerRef: React.RefObject<HTMLDivElement | null>;
    labelsColor: string;
}

const TILE_SIZE = 512;
const PADDING = 120;


export type LabelingTool = 'brush' | 'erase';
const extractNumberFromName = (name: string): number => {
    const match = name.match(/-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

export const LabelEditor: React.FC<LabelEditorProps> = (props) => {
    const {
        isOpen, onClose, onLabelsSaved, selectedTiles, labelMaskVersion, Z,
        modelsWithPredictions, allPredictionTiles, predictionVisibility,
        predictionOpacities, predictionColors, onLoadPredictionTiles,
        onTogglePredictionVisibility, onPredictionOpacityChange, onPredictionColorChange,
        appContainerRef, labelsColor
    } = props;

    const {addToast, updateToast} = useToast();
    const [viewState, setViewState] = useState({x: 0, y: 0, scale: 1});
    const [isPanning, setIsPanning] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isClearAlertOpen, setIsClearAlertOpen] = useState(false);
    const [isCloseAlertOpen, setIsCloseAlertOpen] = useState(false);
    const [isBoosted, setIsBoosted] = useState(true);
    const panStart = useRef({x: 0, y: 0});
    const imageGridRef = useRef<HTMLDivElement>(null);
    const userDrawingCanvasRef = useRef<HTMLCanvasElement>(null);
    const predictionCanvasRefs = useRef<Map<string, HTMLCanvasElement | null>>(new Map());
    const [isCanvasReady, setIsCanvasReady] = useState(false);

    const [tool, setTool] = useState<LabelingTool>('brush');
    const [brushColor, setBrushColor] = useState(labelsColor);
    const [brushSize, setBrushSize] = useState(20);
    const [labelLayerOpacity, setLabelLayerOpacity] = useState(1.0);
    const [isLabelLayerVisible, setIsLabelLayerVisible] = useState(true);

    const gridInfo = useMemo(() => {
        if (selectedTiles.size === 0) return null;
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        selectedTiles.forEach(key => {
            const [x, y] = key.split(',').map(Number);
            if (x < xMin) xMin = x;
            if (x > xMax) xMax = x;
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        });
        const width = (xMax - xMin + 1);
        const height = (yMax - yMin + 1);
        return {xMin, yMin, width, height, imageWidth: width * TILE_SIZE, imageHeight: height * TILE_SIZE};
    }, [selectedTiles]);

    const relevantModels = useMemo(() => {
        return modelsWithPredictions
            .filter(modelName => {
                const modelTiles = allPredictionTiles.get(modelName);
                if (!modelTiles) {
                    onLoadPredictionTiles(modelName);
                    return false;
                }
                for (const tile of selectedTiles) {
                    if (modelTiles.has(tile)) return true;
                }
                return false;
            })
            .sort((a, b) => extractNumberFromName(b) - extractNumberFromName(a));
    }, [modelsWithPredictions, allPredictionTiles, selectedTiles, onLoadPredictionTiles]);

    useEffect(() => {
        if (isOpen && gridInfo && appContainerRef.current) {
            const {clientWidth, clientHeight} = appContainerRef.current;
            const scale = Math.min(1, (clientWidth - PADDING * 2) / gridInfo.imageWidth, (clientHeight - PADDING * 2) / gridInfo.imageHeight);
            setViewState({
                x: (clientWidth - gridInfo.imageWidth * scale) / 2,
                y: (clientHeight - gridInfo.imageHeight * scale) / 2,
                scale
            });
            setHasUnsavedChanges(false);
            setIsLabelLayerVisible(true);
            setIsBoosted(true);
            setBrushColor(labelsColor);
        } else {
            setIsCanvasReady(false);
            setViewState({x: 0, y: 0, scale: 1});
        }
    }, [isOpen, gridInfo, appContainerRef, labelsColor]);

    const {handlers, initialize, clearCanvas, undo, redo, canUndo, canRedo} = useLabeling(
        userDrawingCanvasRef, brushSize, tool
    );

    const {brushCursor, eraseCursor} = useMemo(() => {
        const sizeOnScreen = Math.max(2, brushSize * viewState.scale);
        const half = sizeOnScreen / 2;
        const radius = half > 1 ? half - 1 : half * 0.8;
        const createCursorString = (strokeColor: string, fillColor: string) => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizeOnScreen}" height="${sizeOnScreen}" viewBox="0 0 ${sizeOnScreen} ${sizeOnScreen}"><circle cx="${half}" cy="${half}" r="${radius}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2"/></svg>`;
            const encodedSvg = svg.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23").replace(/\s+/g, ' ');
            return `url("data:image/svg+xml;charset=utf-8,${encodedSvg}") ${half} ${half}, auto`;
        };
        return {
            brushCursor: createCursorString('#00FF00', 'rgba(0, 255, 0, 0.3)'),
            eraseCursor: createCursorString('#FF0000', 'rgba(255, 0, 0, 0.3)'),
        };
    }, [brushSize, viewState.scale]);

    useEffect(() => {
        if (!isOpen || !gridInfo || !userDrawingCanvasRef.current) return;
        const canvas = userDrawingCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = gridInfo.imageWidth;
        canvas.height = gridInfo.imageHeight;
        const labelImages = Array.from(imageGridRef.current?.querySelectorAll<HTMLImageElement>('img[data-label-mask="true"]') ?? []);
        const imagePromises = labelImages.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        }));
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        Promise.all(imagePromises).then(() => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (!tempCtx) {
                initialize();
                setIsCanvasReady(true);
                return;
            }
            labelImages.forEach(img => {
                const tileKey = img.dataset.tileKey;
                if (!tileKey) return;
                const [x, y] = tileKey.split(',').map(Number);
                const dx = (x - gridInfo.xMin) * TILE_SIZE;
                const dy = (y - gridInfo.yMin) * TILE_SIZE;
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                tempCtx.drawImage(img, 0, 0);
                const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] < 20 && data[i + 1] < 20 && data[i + 2] < 20) {
                        data[i + 3] = 0;
                    }
                }
                tempCtx.putImageData(imageData, 0, 0);
                ctx.drawImage(tempCanvas, dx, dy);
            });
            initialize();
            setIsCanvasReady(true);
        });
    }, [isOpen, gridInfo, initialize]);


    useEffect(() => {
        if (!isOpen || !gridInfo) return;

        relevantModels.forEach(modelName => {
            const visibleCanvas = predictionCanvasRefs.current.get(modelName);
            const tiles = allPredictionTiles.get(modelName);
            const color = predictionColors.get(modelName) ?? '#FFFFFF';
            const rgb = hexToRgb(color);
            const isVisible = predictionVisibility.get(modelName) ?? false;

            if (!visibleCanvas || !tiles || !rgb) return;

            if (!isVisible) {
                const visibleCtx = visibleCanvas.getContext('2d');
                if (visibleCtx) {
                    visibleCanvas.width = gridInfo.imageWidth;
                    visibleCanvas.height = gridInfo.imageHeight;
                    visibleCtx.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
                }
                return;
            }

            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = gridInfo.imageWidth;
            offscreenCanvas.height = gridInfo.imageHeight;
            const offscreenCtx = offscreenCanvas.getContext('2d');
            if (!offscreenCtx) return;

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d', {willReadFrequently: true});
            if (!tempCtx) return;

            const normalThreshold = 35;
            const boostedThreshold = 60;
            const currentAlphaThreshold = isBoosted ? boostedThreshold : normalThreshold;
            const currentRemapRange = 255 - currentAlphaThreshold;

            const imageLoadPromises: Promise<void>[] = [];

            for (const tileKey of selectedTiles) {
                if (tiles.has(tileKey)) {
                    const [x, y] = tileKey.split(',').map(Number);
                    const promise = new Promise<void>((resolve) => {
                        const img = new Image();
                        img.crossOrigin = "Anonymous";
                        img.src = `/api/inference/tile/${modelName}/${Z}/${x}/${y}.png`;

                        img.onload = () => {
                            const dx = (x - gridInfo.xMin) * TILE_SIZE;
                            const dy = (y - gridInfo.yMin) * TILE_SIZE;

                            tempCanvas.width = img.naturalWidth;
                            tempCanvas.height = img.naturalHeight;

                            tempCtx.drawImage(img, 0, 0);
                            const imageData = tempCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
                            const data = imageData.data;

                            for (let i = 0; i < data.length; i += 4) {
                                const grayValue = data[i];

                                if (grayValue < currentAlphaThreshold) {
                                    data[i + 3] = 0;
                                } else {
                                    data[i] = rgb.r;
                                    data[i + 1] = rgb.g;
                                    data[i + 2] = rgb.b;

                                    const normalizedAlpha = (grayValue - currentAlphaThreshold) / currentRemapRange;
                                    const finalAlpha = isBoosted ? Math.sqrt(normalizedAlpha) * 255 : normalizedAlpha * 255;

                                    data[i + 3] = Math.min(255, finalAlpha);
                                }
                            }

                            tempCtx.putImageData(imageData, 0, 0);
                            offscreenCtx.drawImage(tempCanvas, dx, dy);
                            resolve();
                        };
                        img.onerror = () => {
                            console.error(`Failed to load prediction tile: ${img.src}`);
                            resolve();
                        };
                    });
                    imageLoadPromises.push(promise);
                }
            }
            Promise.all(imageLoadPromises).then(() => {
                const visibleCtx = visibleCanvas.getContext('2d');
                if (visibleCtx) {
                    visibleCanvas.width = gridInfo.imageWidth;
                    visibleCanvas.height = gridInfo.imageHeight;
                    visibleCtx.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
                    visibleCtx.drawImage(offscreenCanvas, 0, 0);
                }
            });
        });
    }, [isOpen, gridInfo, relevantModels, allPredictionTiles, predictionColors, predictionVisibility, Z, isBoosted]);

    const handleSave = useCallback(async () => {
        if (!userDrawingCanvasRef.current || !gridInfo || isSaving) return;
        setIsSaving(true);
        const toastId = addToast("loading", "Saving labels...", null);
        const canvas = userDrawingCanvasRef.current;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = TILE_SIZE;
        tempCanvas.height = TILE_SIZE;
        const tempCtx = tempCanvas.getContext('2d');

        if (!tempCtx) {
            setIsSaving(false);
            updateToast(toastId, {type: 'error', message: 'Could not create canvas context.', duration: 3000});
            return;
        }

        const promises: Promise<Response>[] = [];

        for (const tileKey of selectedTiles) {
            const [x, y] = tileKey.split(',').map(Number);
            const sx = (x - gridInfo.xMin) * TILE_SIZE;
            const sy = (y - gridInfo.yMin) * TILE_SIZE;

            const imageData = canvas.getContext('2d')!.getImageData(sx, sy, TILE_SIZE, TILE_SIZE);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 0) { // If pixel has any content (alpha > 0)
                    data[i] = 255;
                    data[i + 1] = 255;
                    data[i + 2] = 255;
                    data[i + 3] = 255;
                } else {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                    data[i + 3] = 255;
                }
            }
            tempCtx.putImageData(imageData, 0, 0);

            const blob = await new Promise<Blob | null>(resolve => tempCanvas.toBlob(resolve, 'image/png'));
            if (!blob) continue;

            const url = `/api/labels/image/${Z}/${x}/${y}`;
            promises.push(fetch(url, {method: 'POST', headers: {'Content-Type': 'image/png'}, body: blob}));
        }

        try {
            const responses = await Promise.all(promises);
            const allOk = responses.every(res => res.ok);
            if (!allOk) throw new Error('One or more tiles failed to save.');

            setHasUnsavedChanges(false);
            const totalTiles = selectedTiles.size;
            updateToast(toastId, {type: 'success', message: `Saved labels for ${totalTiles} tile(s).`, duration: 3000});
            onLabelsSaved();
            onClose();
        } catch (error) {
            console.error("Failed to save labels:", error);
            updateToast(toastId, {type: 'error', message: 'Failed to save labels.', duration: 3000});
        } finally {
            setIsSaving(false);
        }
    }, [gridInfo, isSaving, addToast, updateToast, selectedTiles, Z, onClose, onLabelsSaved]);

    const handleCloseRequest = () => {
        if (hasUnsavedChanges) {
            setIsCloseAlertOpen(true);
        } else {
            onClose();
        }
    };
    const handleClearRequest = () => setIsClearAlertOpen(true);
    const confirmClear = () => {
        clearCanvas();
        setHasUnsavedChanges(true);
        setIsClearAlertOpen(false);
    };
    const confirmClose = () => {
        setIsCloseAlertOpen(false);
        onClose();
    };
    const getLocalCoordinatesFromMouseEvent = useCallback((e: React.MouseEvent): Point | null => {
        if (!appContainerRef.current) return null;
        const rect = appContainerRef.current.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - viewState.x) / viewState.scale,
            y: (e.clientY - rect.top - viewState.y) / viewState.scale
        };
    }, [viewState.x, viewState.y, viewState.scale, appContainerRef]);
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            setIsPanning(true);
            panStart.current = {x: e.clientX, y: e.clientY};
        } else if (e.button === 0) {
            const point = getLocalCoordinatesFromMouseEvent(e);
            if (point) handlers.onDrawStart(point);
        }
    }, [getLocalCoordinatesFromMouseEvent, handlers]);
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isPanning) {
            const dx = e.clientX - panStart.current.x;
            const dy = e.clientY - panStart.current.y;
            setViewState(prev => ({...prev, x: prev.x + dx, y: prev.y + dy}));
            panStart.current = {x: e.clientX, y: e.clientY};
        } else {
            const point = getLocalCoordinatesFromMouseEvent(e);
            if (point) handlers.onDrawMove(point);
        }
    }, [isPanning, getLocalCoordinatesFromMouseEvent, handlers]);
    const handleMouseUp = useCallback(() => {
        if (isPanning) {
            setIsPanning(false);
        } else {
            if (handlers.onDrawEnd()) {
                setHasUnsavedChanges(true);
            }
        }
    }, [isPanning, handlers]);
    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.shiftKey) {
            const step = Math.max(2, Math.round(brushSize * 0.15));
            const scrollDirection = Math.sign(e.deltaY);
            const newSize = brushSize - (scrollDirection * step);
            const clampedSize = Math.max(2, Math.min(50, newSize));
            setBrushSize(clampedSize);
        } else {
            if (!appContainerRef.current) return;
            const rect = appContainerRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const scaleAmount = -e.deltaY * 0.001 * viewState.scale;
            const newScale = Math.max(0.1, Math.min(10, viewState.scale + scaleAmount));
            const mousePointTo = {
                x: (mouseX - viewState.x) / viewState.scale,
                y: (mouseY - viewState.y) / viewState.scale
            };
            setViewState({
                scale: newScale,
                x: mouseX - mousePointTo.x * newScale,
                y: mouseY - mousePointTo.y * newScale
            });
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
            const key = e.key.toLowerCase();
            if (key >= '1' && key <= '9') {
                e.preventDefault();
                const keyAsNum = parseInt(key, 10);
                if (keyAsNum === 1) {
                    setIsLabelLayerVisible(v => !v);
                } else {
                    const modelIndex = keyAsNum - 2;
                    if (modelIndex >= 0 && modelIndex < relevantModels.length) {
                        const modelName = relevantModels[modelIndex];
                        const isVisible = predictionVisibility.get(modelName) ?? false;
                        if (!isVisible) onLoadPredictionTiles(modelName);
                        onTogglePredictionVisibility(modelName);
                    }
                }
                return;
            }
            switch (key) {
                case 'v':
                    setIsBoosted(prev => !prev);
                    break;
                case 'escape':
                    handleCloseRequest();
                    break;
                case 'b':
                    setTool('brush');
                    break;
                case 'e':
                    setTool('erase');
                    break;
                case 's':
                    if (!isSaving) handleSave();
                    break;
                case 'c':
                    if (!isSaving) handleClearRequest();
                    break;
                case 'z':
                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && canUndo) undo();
                    break;
                case 'y':
                    if ((e.ctrlKey || e.metaKey) && canRedo) redo();
                    break;
                default:
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'z' && canRedo) redo();
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleSave, canUndo, canRedo, undo, redo, isSaving, hasUnsavedChanges, relevantModels, onTogglePredictionVisibility, predictionVisibility, onLoadPredictionTiles]);

    if (!isOpen || !gridInfo) return null;

    const renderSatelliteGrid = () => {
        const items = [];
        for (let y = 0; y < gridInfo.height; y++) {
            for (let x = 0; x < gridInfo.width; x++) {
                const tileKey = `${gridInfo.xMin + x},${gridInfo.yMin + y}`;
                const tileUrl = `/api/tiles/satellite/17/${gridInfo.xMin + x}/${gridInfo.yMin + y}.png`;
                const labelUrl = `/api/labels/image/17/${gridInfo.xMin + x}/${gridInfo.yMin + y}.png?v=${labelMaskVersion}`;
                items.push(
                    selectedTiles.has(tileKey) ? (
                        <div key={tileKey} className="relative" style={{width: TILE_SIZE, height: TILE_SIZE}}>
                            <img src={tileUrl} alt={tileKey}
                                 className="absolute inset-0 w-full h-full pointer-events-none"/>
                            <img src={labelUrl} alt={`label-${tileKey}`}
                                 className="absolute inset-0 w-full h-full pointer-events-none"
                                 style={{display: 'none'}} crossOrigin="anonymous" data-label-mask="true"
                                 data-tile-key={tileKey}/>
                        </div>
                    ) : <div key={tileKey} style={{width: TILE_SIZE, height: TILE_SIZE}} className="bg-black"/>
                );
            }
        }
        return items;
    };

    return (
        <div ref={appContainerRef as React.RefObject<HTMLDivElement>} tabIndex={-1}
             className="fixed inset-0 bg-gray-800 z-[3000] flex items-center justify-center overflow-hidden select-none outline-none"
             onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
             onMouseLeave={handleMouseUp} onContextMenu={(e) => e.preventDefault()} onWheel={handleWheel}
             style={{cursor: isPanning ? 'grabbing' : (tool === 'brush' ? brushCursor : eraseCursor)}}
        >
            <LabelEditorToolbar
                onSave={handleSave}
                isSaving={isSaving}
                onClose={handleCloseRequest}
                onClear={handleClearRequest}
                tool={tool} setTool={setTool}
                undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
                isBoosted={isBoosted}
                setIsBoosted={setIsBoosted}
            />
            <LabelEditorLayerControls
                isLabelLayerVisible={isLabelLayerVisible}
                onToggleLabelLayerVisibility={() => setIsLabelLayerVisible(v => !v)}
                labelLayerOpacity={labelLayerOpacity}
                onLabelLayerOpacityChange={setLabelLayerOpacity}
                modelsWithPredictions={relevantModels}
                predictionVisibility={predictionVisibility}
                predictionOpacities={predictionOpacities}
                predictionColors={predictionColors}
                onTogglePredictionVisibility={onTogglePredictionVisibility}
                onPredictionOpacityChange={onPredictionOpacityChange}
                onPredictionColorChange={onPredictionColorChange}
                onLoadPredictionTiles={onLoadPredictionTiles}
                appContainerRef={appContainerRef}
                brushColor={brushColor}
                setBrushColor={setBrushColor}
            />
            <LabelEditorBrushControls
                brushSize={brushSize} setBrushSize={setBrushSize}
                containerRef={appContainerRef}
            />
            <div className="absolute top-0 left-0" style={{
                transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale})`,
                transformOrigin: '0 0'
            }}>
                <div className="relative shadow-2xl bg-black"
                     style={{width: gridInfo.imageWidth, height: gridInfo.imageHeight}}>
                    <div ref={imageGridRef} className="grid absolute top-0 left-0 z-10"
                         style={{gridTemplateColumns: `repeat(${gridInfo.width}, ${TILE_SIZE}px)`}}>
                        {renderSatelliteGrid()}
                    </div>
                    <canvas
                        ref={userDrawingCanvasRef}
                        className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
                        style={{
                            opacity: isCanvasReady && isLabelLayerVisible ? labelLayerOpacity : 0,
                            filter: `drop-shadow(${brushColor} 0px 0px 0px)`,
                        }}
                    />
                    {relevantModels.map(modelName => {
                        const isVisible = predictionVisibility.get(modelName) ?? false;
                        if (!isVisible) return null;
                        const opacity = predictionOpacities.get(modelName);
                        return (
                            <canvas
                                key={modelName}
                                ref={(c) => {
                                    predictionCanvasRefs.current.set(modelName, c);
                                }}
                                className="absolute top-0 left-0 w-full h-full pointer-events-none z-30"
                                style={{opacity}}
                            />
                        );
                    })}
                </div>
            </div>
            {(!isCanvasReady || isSaving) &&
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div
                        className="text-white font-semibold bg-gray-900/80 p-4 rounded-lg">{isSaving ? 'Saving...' : 'Initializing Editor...'}</div>
                </div>}
            <AlertModal isOpen={isClearAlertOpen} onCancel={() => setIsClearAlertOpen(false)} onConfirm={confirmClear}
                        title="Clear All Labels"
                        message="Are you sure you want to delete all drawn labels on this canvas? This action cannot be undone."/>
            <AlertModal isOpen={isCloseAlertOpen} onCancel={() => setIsCloseAlertOpen(false)} onConfirm={confirmClose}
                        title="Discard Unsaved Changes?"
                        message="You have unsaved changes that will be lost. Are you sure you want to close the editor?"/>
        </div>
    );
};