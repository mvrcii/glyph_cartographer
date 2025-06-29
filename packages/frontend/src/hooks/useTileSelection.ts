import {useCallback, useEffect, useRef, useState} from "react";
import L from "leaflet";
import type {Mode, Tool} from "../types";
import {calculateTileAreaKm2, lat2tile, lon2tile, tile2lat, tile2lon, tilesInBounds} from "../utils/tileMathUtils.ts";
import type {ToastType} from "../components/Toast.tsx";

// Interface for the data returned from the tile analysis worker
interface TileAnalysisResult {
    key: string;
    value: number;
    status: 'fulfilled' | 'rejected';
}


interface UseTileSelectionProps {
    leafletMap: L.Map | null;
    tool: Tool;
    mode: Mode;
    renderer: L.Canvas | null;
    previewLayer: L.LayerGroup;
    downloaded: Set<string>;
    downloading: Set<string>;
    setSelected: (action: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    setTool: (tool: Tool) => void;
    Z: number;
    showToast: (t: ToastType, msg: string, dur?: number | null) => string;
    brightnessThreshold: number;
}

export function useTileSelection({
                                     leafletMap,
                                     tool,
                                     mode,
                                     renderer,
                                     previewLayer,
                                     downloaded,
                                     downloading,
                                     setSelected,
                                     setTool,
                                     Z,
                                     showToast,
                                     brightnessThreshold,
                                 }: UseTileSelectionProps) {
    const isInteracting = useRef(false);
    const lastTileKey = useRef<string | null>(null);

    const dragStart = useRef<L.LatLng | null>(null);
    const removeMode = useRef(false);
    const rafId = useRef<number | null>(null);
    const lastMoveEvt = useRef<L.LeafletMouseEvent | null>(null);
    const tileRects = useRef(new Map<string, L.Rectangle>());

    const workerRef = useRef<Worker | null>(null);
    const pendingAnalysis = useRef(new Map<string, (result: TileAnalysisResult) => void>());

    // New state for progress modal
    const [analysisProgress, setAnalysisProgress] = useState({isOpen: false, progress: 0, total: 0});
    const analysisAbortController = useRef<AbortController | null>(null);
    const isAnalyzing = useRef(false);

    const [tooltipData, setTooltipData] = useState({
        visible: false,
        x: 0,
        y: 0,
        tileCount: 0,
        areaKm2: 0
    });

    useEffect(() => {
        workerRef.current = new Worker('/tileAnalyzer.worker.js');
        workerRef.current.onmessage = (event: MessageEvent<TileAnalysisResult>) => {
            const {key, value, status} = event.data;
            if (pendingAnalysis.current.has(key)) {
                const resolve = pendingAnalysis.current.get(key);
                if (resolve) {
                    resolve({key, value, status});
                }
                pendingAnalysis.current.delete(key);
            }
        };
        return () => {
            workerRef.current?.terminate();
        };
    }, []);

    const updateSelection = useCallback((tileKey: string, isAdding: boolean) => {
        if (isAdding) {
            if (mode === "inference" && !downloaded.has(tileKey)) return;
            if (mode === "label" && !downloaded.has(tileKey)) return;
            if (mode === "download" && downloading.has(tileKey)) return;
        }
        setSelected(prev => {
            const out = new Set(prev);
            if (isAdding) out.add(tileKey);
            else out.delete(tileKey);
            return out;
        });
    }, [mode, downloaded, downloading, setSelected]);

    const handleBrushDown = useCallback((e: L.LeafletMouseEvent) => {
        if (e.originalEvent.button !== 0) return; // Only allow left-click for drawing
        isInteracting.current = true;
        leafletMap?.dragging.disable();
        const key = `${lon2tile(e.latlng.lng, Z)},${lat2tile(e.latlng.lat, Z)}`;
        updateSelection(key, tool === 'brush');
        lastTileKey.current = key;
    }, [leafletMap, Z, tool, updateSelection]);

    const handleBrushMove = useCallback((e: L.LeafletMouseEvent) => {
        if (!isInteracting.current) return;
        const key = `${lon2tile(e.latlng.lng, Z)},${lat2tile(e.latlng.lat, Z)}`;
        if (key !== lastTileKey.current) {
            updateSelection(key, tool === 'brush');
            lastTileKey.current = key;
        }
    }, [Z, tool, updateSelection]);

    const handleBrushUp = useCallback(() => {
        if (!isInteracting.current) return;
        isInteracting.current = false;
        lastTileKey.current = null;
        leafletMap?.dragging.enable();
    }, [leafletMap]);

    const cancelRAF = () => {
        if (rafId.current !== null) {
            cancelAnimationFrame(rafId.current);
            rafId.current = null;
        }
    };

    const handleRectDown = useCallback((e: L.LeafletMouseEvent) => {
        isInteracting.current = true;
        dragStart.current = e.latlng;
        removeMode.current = e.originalEvent.button === 2 || e.originalEvent.shiftKey;
        if (e.originalEvent.button === 2) L.DomEvent.preventDefault(e.originalEvent);
        leafletMap?.dragging.disable();
        previewLayer.clearLayers();
        tileRects.current.clear();
        setTooltipData(prev => ({...prev, visible: true}));
    }, [leafletMap, previewLayer]);

    const handleRectMove = useCallback((e: L.LeafletMouseEvent) => {
        if (!isInteracting.current || !dragStart.current) return;
        lastMoveEvt.current = e;

        // Update mouse position for tooltip
        const mouseX = e.originalEvent.clientX;
        const mouseY = e.originalEvent.clientY;

        if (rafId.current !== null) return;
        rafId.current = requestAnimationFrame(() => {
            rafId.current = null;
            if (!isInteracting.current || !dragStart.current || !lastMoveEvt.current || !renderer) return;

            const bounds = L.latLngBounds(dragStart.current, lastMoveEvt.current.latlng);
            const {xMin, xMax, yMin, yMax} = tilesInBounds(bounds, Z);

            // Calculate valid tiles based on mode
            let validTileCount = 0;
            for (let x = xMin; x <= xMax; x++) {
                for (let y = yMin; y <= yMax; y++) {
                    const tileKey = `${x},${y}`;
                    if (mode === "download") {
                        if (!downloading.has(tileKey)) validTileCount++;
                    } else if (mode === "inference" || mode === "label") {
                        if (downloaded.has(tileKey)) validTileCount++;
                    }
                }
            }

            const areaKm2 = calculateTileAreaKm2(xMin, xMax, yMin, yMax, Z);

            setTooltipData({
                visible: true,
                x: mouseX,
                y: mouseY,
                tileCount: validTileCount,
                areaKm2
            });

            const nextTiles = new Set<string>();
            const previewColor = removeMode.current ? "#ff4545" : "#32cd32";
            for (let x = xMin; x <= xMax; x++) {
                for (let y = yMin; y <= yMax; y++) {
                    const tileKey = `${x},${y}`;
                    nextTiles.add(tileKey);
                    if (tileRects.current.has(tileKey)) continue;
                    const tileBounds: L.LatLngBoundsExpression = [[tile2lat(y + 1, Z), tile2lon(x, Z)], [tile2lat(y, Z), tile2lon(x + 1, Z)]];
                    const rect = L.rectangle(tileBounds, {
                        renderer,
                        pane: "preview",
                        color: previewColor,
                        weight: 0,
                        fillColor: previewColor,
                        fillOpacity: 0.4,
                        interactive: false
                    }).addTo(previewLayer);
                    tileRects.current.set(tileKey, rect);
                }
            }
            for (const [tileKey, rect] of tileRects.current.entries()) {
                if (!nextTiles.has(tileKey)) {
                    previewLayer.removeLayer(rect);
                    tileRects.current.delete(tileKey);
                }
            }
        });
    }, [renderer, previewLayer, Z, mode, downloaded]);


    useEffect(() => {
        // Hide tooltip when tool changes to none or when switching tools
        if (tool === "none" || (tool !== "rectangle" && tooltipData.visible)) {
            setTooltipData(prev => ({...prev, visible: false}));
        }
    }, [tool]);

    const handleCancelAnalysis = useCallback(() => {
        if (analysisAbortController.current) {
            analysisAbortController.current.abort();
            pendingAnalysis.current.clear();
            setAnalysisProgress({isOpen: false, progress: 0, total: 0});
            isAnalyzing.current = false;
            analysisAbortController.current = null;
            previewLayer.clearLayers();
            tileRects.current.clear();
            dragStart.current = null;
            removeMode.current = false;

            // Hide tooltip
            setTooltipData(prev => ({...prev, visible: false}));

            setTool("none");
        }
    }, [previewLayer, setTool]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isAnalyzing.current) {
                handleCancelAnalysis();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleCancelAnalysis])

    const handleRectUp = useCallback(async (e: L.LeafletMouseEvent) => {
        if (!isInteracting.current || !dragStart.current || !workerRef.current) return;
        cancelRAF();
        setTooltipData(prev => ({...prev, visible: false}));
        isInteracting.current = false;
        leafletMap?.dragging.enable();
        const isRemoving = removeMode.current;
        const bounds = L.latLngBounds(dragStart.current, e.latlng);
        const {xMin, xMax, yMin, yMax} = tilesInBounds(bounds, Z);
        const initialTiles = new Set<string>();
        for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
                const tileKey = `${x},${y}`;
                if (!isRemoving) {
                    if ((mode === "inference" || mode === 'label') && !downloaded.has(tileKey)) continue;
                    if (mode === "download" && downloading.has(tileKey)) continue;
                }
                initialTiles.add(tileKey);
            }
        }

        if (initialTiles.size === 0) {
            // Clean up the UI even when no tiles can be selected
            dragStart.current = null;
            previewLayer.clearLayers();
            tileRects.current.clear();
            setTimeout(() => setTool("none"), 0);
            return;
        }

        if (mode === "download") {
            // Prevent multiple analyses
            if (isAnalyzing.current) {
                showToast("warning", "Analysis already in progress", 2000);
                return;
            }

            isAnalyzing.current = true;
            analysisAbortController.current = new AbortController();

            // Open progress modal
            setAnalysisProgress({isOpen: true, progress: 0, total: initialTiles.size});

            const tilesArray = Array.from(initialTiles);
            let completedCount = 0;

            const analysisPromises = tilesArray.map((key, index) => {
                return new Promise<TileAnalysisResult>((resolve) => {
                    // Check if aborted
                    if (analysisAbortController.current?.signal.aborted) {
                        resolve({key, value: -1, status: 'rejected'});
                        return;
                    }

                    const [x, y] = key.split(',');
                    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`;

                    // Create a wrapped resolve that updates progress
                    const wrappedResolve = (result: TileAnalysisResult) => {
                        if (!analysisAbortController.current?.signal.aborted) {
                            completedCount++;
                            setAnalysisProgress(prev => ({...prev, progress: completedCount}));
                            resolve(result);
                        } else {
                            resolve({key, value: -1, status: 'rejected'});
                        }
                    };

                    pendingAnalysis.current.set(key, wrappedResolve);

                    // Add slight delay to prevent overwhelming the worker
                    setTimeout(() => {
                        if (!analysisAbortController.current?.signal.aborted) {
                            workerRef.current?.postMessage({key, url});
                        }
                    }, index * 10); // Stagger requests by 10ms
                });
            });

            try {
                const results = await Promise.all(analysisPromises);

                // Check if cancelled
                if (analysisAbortController.current?.signal.aborted) {
                    showToast("info", "Analysis cancelled", 2000);
                    return;
                }

                const successfulResults = results.filter(r => r.status === 'fulfilled');
                const filteredTileKeys = new Set<string>();
                successfulResults.forEach(result => {
                    if (result.value > brightnessThreshold) {
                        filteredTileKeys.add(result.key);
                    }
                });

                showToast('success', `Filtered selection: ${filteredTileKeys.size} of ${initialTiles.size} tiles remain.`, 2000);

                setSelected(prev => {
                    const out = new Set(prev);
                    filteredTileKeys.forEach(k => (isRemoving ? out.delete(k) : out.add(k)));
                    return out;
                });

            } catch (error) {
                console.error('Analysis error:', error);
                showToast('error', 'Analysis failed', 2000);
            } finally {
                // Clean up
                isAnalyzing.current = false;
                analysisAbortController.current = null;
                setAnalysisProgress({isOpen: false, progress: 0, total: 0});
                pendingAnalysis.current.clear();
            }
        } else {
            setSelected(prev => {
                const out = new Set(prev);
                initialTiles.forEach(k => (isRemoving ? out.delete(k) : out.add(k)));
                return out;
            });
        }

        dragStart.current = null;
        removeMode.current = false;
        previewLayer.clearLayers();
        tileRects.current.clear();
        setTimeout(() => setTool("none"), 0);

    }, [mode, leafletMap, Z, setTool, setSelected, brightnessThreshold, downloaded, downloading]);

    useEffect(() => {
        if (!leafletMap) return;

        leafletMap.off("mousedown", handleRectDown).off("mousemove", handleRectMove).off("mouseup", handleRectUp);
        leafletMap.off("mousedown", handleBrushDown).off("mousemove", handleBrushMove).off("mouseup", handleBrushUp);

        const contextMenuHandler = (e: MouseEvent) => e.preventDefault();

        const mapContainer = leafletMap.getContainer();

        if (tool === "rectangle") {
            leafletMap.on("mousedown", handleRectDown).on("mousemove", handleRectMove).on("mouseup", handleRectUp);
            mapContainer.addEventListener("contextmenu", contextMenuHandler);
        } else if (tool === "brush" || tool === "erase") {
            leafletMap.on("mousedown", handleBrushDown).on("mousemove", handleBrushMove).on("mouseup", handleBrushUp);
            mapContainer.addEventListener("contextmenu", contextMenuHandler);
        }

        return () => {
            leafletMap.off("mousedown", handleRectDown).off("mousemove", handleRectMove).off("mouseup", handleRectUp);
            leafletMap.off("mousedown", handleBrushDown).off("mousemove", handleBrushMove).off("mouseup", handleBrushUp);
            mapContainer.removeEventListener("contextmenu", contextMenuHandler);
            if (isInteracting.current) {
                isInteracting.current = false;
                leafletMap?.dragging.enable();
                previewLayer.clearLayers();
                tileRects.current.clear();
                cancelRAF();

                setTooltipData(prev => ({...prev, visible: false}));
            }
        };
    }, [leafletMap, tool, handleRectDown, handleRectMove, handleRectUp, handleBrushDown, handleBrushMove, handleBrushUp]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelRAF();
            if (isAnalyzing.current && analysisAbortController.current) {
                analysisAbortController.current.abort();
                pendingAnalysis.current.clear();
            }
        };
    }, []);

    // Return the progress modal
    return {
        analysisProgress,
        handleCancelAnalysis,
        tooltipData
    };
}