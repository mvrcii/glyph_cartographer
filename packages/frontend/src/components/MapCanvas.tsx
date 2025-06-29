import React, {useCallback, useEffect, useRef, useState} from "react";
import L from "leaflet";
import throttle from "lodash/throttle";
import type {Mode, Tool} from "../types";
import type {ToastType, ToastUpdatePayload} from "./Toast";
import {useTileSelection} from "../hooks/useTileSelection.ts";
import {useKmlLayers} from "../hooks/useKmlLayers";
import type {RenderCounts as MapLayerRenderCounts} from "../hooks/useMapLayers";
import {AGGREGATION_LEVELS, useMapLayers} from "../hooks/useMapLayers";
import type {KmlLayerConfig} from "../App.tsx";
import {useTileDownloader} from "../hooks/useTileDownloader.ts";
import {useTileInference} from "../hooks/useTileInference.ts";
import {TileStatusLegend} from "./TileStatusLegend.tsx";
import {LayerControls} from "./LayerControls.tsx";
import {drawTiles, type TileStyle} from "../utils/tileDrawingUtils.ts";
import {ProgressModal} from "./ProgressModal.tsx";
import {SelectionTooltip} from "./SelectionTooltip.tsx";
import {useSatelliteImageLayer} from "../hooks/useSatelliteImageLayer.ts";
import {usePredictionLayers} from "../hooks/usePredictionLayers";
import {lat2tile, lon2tile} from "../utils/tileMathUtils.ts";
import {useLabelMaskLayer} from "../hooks/useLabelMaskLayer.ts";
import {type OAITilePrediction, useOaiPredictionLayers} from "../hooks/useOAIPredictionLayers.ts";

const brushCursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%2300FF00\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"rgba(0, 255, 0, 0.3)\"></circle></svg>') 16 16, auto";
const eraseCursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23FF0000\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"rgba(255, 0, 0, 0.3)\"></circle></svg>') 16 16, auto";

export interface CombinedRenderCounts extends MapLayerRenderCounts {
    kml: Record<string, number>;
}

export type CursorPosition = {
    lat: number | null;
    lng: number | null;
    z: number | null;
    x: number | null;
    y: number | null;
};

export type NavigationTarget = {
    lat: number;
    lon: number;
    zoom?: number;
};

type MapCanvasProps = {
    mode: Mode;
    tool: Tool;
    setTool: (t: Tool) => void;
    downloadTrigger: number;
    inferenceTrigger: number;
    onCursorPositionChange: (pos: CursorPosition) => void;
    clearTrigger: number;
    showToast: (t: ToastType, msg: string, dur?: number | null) => string;
    updateToast: (id: string, newData: ToastUpdatePayload) => void;
    selectedModel: string;
    selected: Set<string>;
    setSelected: (s: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    goodNegatives: Set<string>;
    discoveries: Set<string>;
    positiveLabels: Set<string>;
    kmlLayerVersions: Map<string, number>;
    labelMaskVersion: number;
    brightnessThreshold: number;
    zoomThreshold: number;
    onAnalysisStateChange?: (isAnalyzing: boolean) => void;
    allPredictionTiles: Map<string, Set<string>>;
    predictionVisibility: Map<string, boolean>;
    predictionOpacities: Map<string, number>;
    onNewPrediction: (fullModelPath: string, newKeys: Set<string>, version: number, oaiPredictions: OAITilePrediction[]) => void;
    onLoadPredictionTiles: (modelName: string) => void;
    appContainerRef: React.RefObject<HTMLDivElement | null>;
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
    kmlGeoglyphCounts: Record<string, number>;
    setKmlGeoglyphCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    modelsWithPredictions: string[];
    onTogglePredictionVisibility: (modelName: string) => void;
    onPredictionOpacityChange: (modelName: string, opacity: number) => void;
    predictionColors: Map<string, string>;
    onPredictionColorChange: (modelName: string, color: string) => void;
    navigationTarget: NavigationTarget | null;
    predictionTileVersions: Map<string, number>;
    useTTA: boolean;
    indicatorLayersOrder: ('negatives' | 'discoveries')[];
    onToggleIndicatorLayer: (layer: 'negatives' | 'discoveries', isVisible: boolean) => void;
    downloaded: Set<string>;
    setDownloaded: React.Dispatch<React.SetStateAction<Set<string>>>;
    oaiPredictions: Map<string, Map<string, OAITilePrediction>>;
    oaiVisibility: Map<string, boolean>;
    onToggleOaiVisibility: (modelName: string) => void;
    onLoadOaiPredictionTiles: (modelName: string) => void;
    useOAI: boolean;
    oaiModelName: string;
};


export function MapCanvas(props: MapCanvasProps) {
    const {
        mode,
        tool,
        setTool,
        downloadTrigger,
        inferenceTrigger,
        onCursorPositionChange,
        clearTrigger,
        showToast,
        updateToast,
        selectedModel,
        selected,
        setSelected,
        goodNegatives,
        discoveries,
        positiveLabels,
        kmlLayerVersions,
        labelMaskVersion,
        brightnessThreshold,
        onAnalysisStateChange,
        allPredictionTiles,
        predictionVisibility,
        predictionOpacities,
        onNewPrediction,
        onLoadPredictionTiles,
        appContainerRef,
        showExistingTiles,
        setShowExistingTiles,
        showGoodNegatives,
        showDiscoveries,
        indicatorLayersOrder,
        onToggleIndicatorLayer,
        showLabels,
        setShowLabels,
        labelsColor,
        setLabelsColor,
        labelsOpacity,
        setLabelsOpacity,
        showGeoglyphs,
        setShowGeoglyphs,
        kmlLayers,
        setKmlLayers,
        kmlLayerVisibility,
        onToggleKmlLayerVisibility,
        onReorderKmlLayer,
        kmlGeoglyphCounts,
        setKmlGeoglyphCounts,
        modelsWithPredictions,
        onTogglePredictionVisibility,
        onPredictionOpacityChange,
        predictionColors,
        onPredictionColorChange,
        navigationTarget,
        predictionTileVersions,
        useTTA,
        negativesColor,
        setNegativesColor,
        discoveriesColor,
        setDiscoveriesColor,
        zoomThreshold,
        existingColor,
        setExistingColor,
        downloaded,
        setDownloaded,
        oaiPredictions,
        oaiVisibility,
        onToggleOaiVisibility,
        onLoadOaiPredictionTiles,
        useOAI,
        oaiModelName,
    } = props;

    const mapRef = useRef<HTMLDivElement | null>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const orangeRenderer = useRef<L.Canvas | null>(null);
    const selectedRenderer = useRef<L.Canvas | null>(null);
    const downloadingRenderer = useRef<L.Canvas | null>(null);
    const goodNegativesRenderer = useRef<L.Canvas | null>(null);
    const discoveriesRenderer = useRef<L.Canvas | null>(null);
    const labelsAggregatedRenderer = useRef<L.Canvas | null>(null);
    const kmlRenderers = useRef(new Map<string, L.Canvas>());
    const kmlGridRenderers = useRef(new Map<string, L.Canvas>());
    const orangeLayer = useRef<L.LayerGroup>(L.layerGroup());
    const selectedLayer = useRef<L.LayerGroup>(L.layerGroup());
    const downloadingLayer = useRef<L.LayerGroup>(L.layerGroup());
    const goodNegativesLayer = useRef<L.LayerGroup>(L.layerGroup());
    const discoveriesLayer = useRef<L.LayerGroup>(L.layerGroup());
    const labelsAggregatedLayer = useRef<L.LayerGroup>(L.layerGroup());
    const previewLayer = useRef<L.LayerGroup>(L.layerGroup());
    const kmlGridLayers = useRef(new Map<string, L.LayerGroup>());
    const toolRef = useRef<Tool>(tool);
    const [mapReady, setMapReady] = useState(false);
    const [downloading, setDownloading] = useState(new Set<string>());
    const [counts, setCounts] = useState({
        downloaded: 0,
        selected: 0,
        downloading: 0,
        goodNegatives: 0,
        discoveries: 0,
        positiveLabels: 0
    });
    const Z = 17;

    useEffect(() => {
        if (navigationTarget && leafletMap.current) {
            leafletMap.current.setView(
                [navigationTarget.lat, navigationTarget.lon],
                navigationTarget.zoom ?? leafletMap.current.getZoom()
            );
        }
    }, [navigationTarget]);


    useEffect(() => {
        setCounts({
            downloaded: downloaded.size,
            selected: selected.size,
            downloading: downloading.size,
            goodNegatives: goodNegatives.size,
            discoveries: discoveries.size,
            positiveLabels: positiveLabels.size,
        });
    }, [selected, downloaded, downloading, goodNegatives, discoveries, positiveLabels]);

    const [renderedTileCounts, setRenderedTileCounts] = useState<CombinedRenderCounts>({
        orange: 0, selected: 0, downloading: 0, goodNegatives: 0, discoveries: 0, positiveLabels: 0, kml: {},
    });

    const clearSelection = useCallback(() => {
        setSelected(new Set());
    }, [setSelected]);

    useEffect(() => {
        toolRef.current = tool;
    }, [tool]);

    // --- HOOKS ---
    const {analysisProgress, handleCancelAnalysis, tooltipData} = useTileSelection({
        leafletMap: leafletMap.current, tool, mode, renderer: selectedRenderer.current,
        previewLayer: previewLayer.current, downloaded: downloaded, downloading: downloading,
        setSelected: setSelected, setTool, Z, showToast: showToast,
        brightnessThreshold: brightnessThreshold
    });

    useEffect(() => {
        onAnalysisStateChange?.(analysisProgress.isOpen);
    }, [analysisProgress.isOpen, onAnalysisStateChange]);

    useTileInference({
        inferenceTrigger, mode, selected: selected, clearSelection: clearSelection,
        showToast, updateToast, selectedModel: selectedModel,
        onNewPredictions: onNewPrediction,
        useTTA: useTTA,
        useOAI: useOAI,
        oaiModelName: oaiModelName
    });

    usePredictionLayers({
        map: leafletMap.current,
        models: modelsWithPredictions,
        allTiles: allPredictionTiles,
        visibility: predictionVisibility,
        opacities: predictionOpacities,
        onLoadTiles: onLoadPredictionTiles,
        predictionTileVersions: predictionTileVersions,
        zoomThreshold: zoomThreshold
    });

    useOaiPredictionLayers({
        map: leafletMap.current,
        models: modelsWithPredictions,
        oaiPredictions: oaiPredictions,
        visibility: oaiVisibility,
        zoomThreshold: zoomThreshold,
        onLoadOaiTiles: onLoadOaiPredictionTiles,
    });

    useLabelMaskLayer({
        map: leafletMap.current,
        positiveLabels,
        showLabels,
        labelsColor,
        labelsOpacity,
        labelMaskVersion,
        zoomThreshold,
        imagePaneName: "labelMaskImagePane",
        outlinePaneName: "labelMaskOutlinePane"
    });

    const {aggregatedKmlTiles} = useKmlLayers({
        leafletMap: leafletMap.current, layersConfig: kmlLayers,
        visibility: kmlLayerVisibility, kmlRenderers, setKmlGeoglyphCounts,
        kmlLayerVersions
    });

    const handleRenderCountsChange = useCallback((counts: MapLayerRenderCounts) => {
        setRenderedTileCounts(prev => ({
            ...prev,
            orange: counts.orange,
            selected: counts.selected,
            downloading: counts.downloading,
            goodNegatives: counts.goodNegatives,
            discoveries: counts.discoveries,
            positiveLabels: counts.positiveLabels
        }));
    }, []);

    useMapLayers({
        leafletMap: leafletMap.current,
        mode,
        downloaded: downloaded,
        selected: selected,
        downloading: downloading,
        goodNegatives: goodNegatives,
        discoveries: discoveries,
        positiveLabels: positiveLabels,
        showExistingTiles,
        showGoodNegatives,
        showDiscoveries,
        showLabels,
        labelsColor,
        labelsOpacity,
        discoveriesColor,
        zoomThreshold,
        orangeLayer: orangeLayer.current,
        selectedLayer: selectedLayer.current,
        downloadingLayer: downloadingLayer.current,
        goodNegativesLayer: goodNegativesLayer.current,
        discoveriesLayer: discoveriesLayer.current,
        labelsAggregatedLayer: labelsAggregatedLayer.current,
        orangeRenderer: orangeRenderer.current,
        selectedRenderer: selectedRenderer.current,
        downloadingRenderer: downloadingRenderer.current,
        goodNegativesRenderer: goodNegativesRenderer.current,
        discoveriesRenderer: discoveriesRenderer.current,
        labelsAggregatedRenderer: labelsAggregatedRenderer.current,
        onRenderCountsChange: handleRenderCountsChange,
    });

    const {progress: downloadProgress, handleCancelDownload} = useTileDownloader({
        downloadTrigger, mode, selected: selected, clearSelection: clearSelection, downloaded: downloaded,
        setDownloaded: setDownloaded, setDownloading: setDownloading, showToast, Z
    });

    useSatelliteImageLayer({
        map: leafletMap.current,
        downloaded,
        orangeLayer: orangeLayer.current,
        showExistingTiles,
        zoomThreshold,
        imagePaneName: "satelliteImagePane",
        outlinePaneName: "satelliteOutlinePane"
    });


    // --- KML GRID TILE DRAWING LOGIC ---
    const renderedKmlGrids = useRef(new Map<string, Set<string>>());
    const lastKmlDisplayZooms = useRef(new Map<string, number>());
    useEffect(() => {
        const map = leafletMap.current;
        if (!map) return;
        const drawVisibleKmlGrids = () => {
            const currentZoom = map.getZoom() ?? 0;
            const VERY_LOW_ZOOM_CUTOFF = 9;
            const newKmlRenderedCounts: Record<string, number> = {};

            if (currentZoom >= zoomThreshold || currentZoom < VERY_LOW_ZOOM_CUTOFF) {
                kmlGridLayers.current.forEach(layer => layer.clearLayers());
                renderedKmlGrids.current.forEach((renderedSet, filename) => {
                    renderedSet.clear();
                    newKmlRenderedCounts[filename] = 0;
                });
                setRenderedTileCounts(prev => ({...prev, kml: newKmlRenderedCounts}));
                return;
            }

            let activeConfig = AGGREGATION_LEVELS[AGGREGATION_LEVELS.length - 1];
            for (let i = 0; i < AGGREGATION_LEVELS.length; i++) {
                if (currentZoom < AGGREGATION_LEVELS[i].mapZoomThreshold) break;
                activeConfig = AGGREGATION_LEVELS[i];
                if (i < AGGREGATION_LEVELS.length - 1 && currentZoom < AGGREGATION_LEVELS[i + 1].mapZoomThreshold) break;
            }
            const {displayTileZoom, padFactor} = activeConfig;

            kmlLayers.forEach(config => {
                const gridLayer = kmlGridLayers.current.get(config.filename);
                const rendered = renderedKmlGrids.current.get(config.filename);
                const gridRenderer = kmlGridRenderers.current.get(config.filename);
                const isVisible = kmlLayerVisibility[config.filename] && showGeoglyphs;
                const tileDataForZoom = aggregatedKmlTiles.get(config.filename)?.get(displayTileZoom);

                if (!gridLayer || !rendered || !gridRenderer || !tileDataForZoom) {
                    newKmlRenderedCounts[config.filename] = 0;
                    return;
                }
                if (!isVisible) {
                    gridLayer.clearLayers();
                    rendered.clear();
                    newKmlRenderedCounts[config.filename] = 0;
                    return;
                }

                const lastDisplayZoom = lastKmlDisplayZooms.current.get(config.filename);
                if (lastDisplayZoom !== displayTileZoom) {
                    gridLayer.clearLayers();
                    rendered.clear();
                    lastKmlDisplayZooms.current.set(config.filename, displayTileZoom);
                }

                let style: TileStyle | ((key: string, opacity: number) => TileStyle);
                let tilesToDraw: Map<string, number> | Set<string>;
                const configOpacity = config.opacity ?? 0.5;

                if (displayTileZoom === Z) {
                    tilesToDraw = new Set(tileDataForZoom.keys());
                    style = {
                        color: config.color, weight: 1, opacity: Math.min(1, Math.max(0.2, configOpacity * 1.8)),
                        fillColor: config.color, fillOpacity: configOpacity,
                    };
                } else {
                    tilesToDraw = tileDataForZoom;
                    style = (_key: string, densityOpacity: number): TileStyle => ({
                        color: config.color, weight: 1, opacity: Math.min(1, Math.max(0.2, configOpacity * 1.8)),
                        fillColor: config.color,
                        fillOpacity: densityOpacity,
                    });
                }

                drawTiles(map, gridLayer, tilesToDraw, rendered, style, gridRenderer, padFactor, displayTileZoom);
                newKmlRenderedCounts[config.filename] = rendered.size;
            });
            setRenderedTileCounts(prev => ({...prev, kml: newKmlRenderedCounts}));
        };
        const throttledRedraw = throttle(drawVisibleKmlGrids, 150);
        map.on("move", throttledRedraw);
        map.on("zoomend", throttledRedraw);
        drawVisibleKmlGrids();
        return () => {
            map.off("move", throttledRedraw).off("zoomend", throttledRedraw);
            (throttledRedraw as any).cancel();
        };
    }, [kmlLayers, kmlLayerVisibility, aggregatedKmlTiles, showGeoglyphs, mapReady, Z, zoomThreshold]);

    // Effect to handle dynamic style updates for KML grid layers
    useEffect(() => {
        if (!leafletMap.current) return;
        kmlLayers.forEach(config => {
            const gridLayer = kmlGridLayers.current.get(config.filename);
            if (gridLayer) {
                const fillOpacity = config.opacity ?? 0.5;
                const newStyle = {
                    color: config.color, opacity: Math.min(1, Math.max(0.2, fillOpacity * 1.8)),
                    fillColor: config.color, fillOpacity: fillOpacity,
                };
                gridLayer.eachLayer(layer => {
                    // This will only work for non-aggregated view, but redraw will fix aggregated
                    if (typeof (layer as L.Path).setStyle === 'function') (layer as L.Path).setStyle(newStyle);
                });
            }
        });
        // Trigger a redraw to apply new styles to aggregated views
        if (leafletMap.current) {
            const event = {target: leafletMap.current} as L.LeafletEvent;
            leafletMap.current.fire('moveend', event);
        }
    }, [kmlLayers]);

    // DYNAMIC PANE ORDERING EFFECT
    useEffect(() => {
        if (!leafletMap.current || !mapReady) return;

        // Base z-index for the top dynamic layers (Negatives/Discoveries)
        const baseZIndex = 450;
        indicatorLayersOrder.forEach((layerKey, index) => {
            const paneName = layerKey === 'negatives' ? 'goodNegativesPane' : 'discoveriesPane';
            const pane = leafletMap.current?.getPane(paneName);
            if (pane) {
                // The layer at the end of the array gets the highest z-index
                pane.style.zIndex = String(baseZIndex + index);
            }
        });

    }, [indicatorLayersOrder, mapReady]);

    // --- OTHER EFFECTS ---
    useEffect(() => {
        if (clearTrigger > 0) {
            setSelected(new Set());
            setRenderedTileCounts(prev => ({...prev, selected: 0}));
        }
    }, [clearTrigger, setSelected]);


    // --- MAP INITIALIZATION ---
    useEffect(() => {
        if (!mapRef.current || leafletMap.current) return;
        const container = mapRef.current;
        const init = () => {
            if (!container.getBoundingClientRect().width) {
                setTimeout(init, 50);
                return;
            }
            const map = L.map(container, {
                preferCanvas: true,
            }).setView([-8.76, -63.89], 12);
            leafletMap.current = map;

            map.createPane('satelliteImagePane').style.zIndex = '405';
            map.createPane('satelliteOutlinePane').style.zIndex = '406';
            map.createPane('orangePane').style.zIndex = '410';
            map.createPane('kmlPaneGrid_base').style.zIndex = '448';
            map.createPane('labelsAggregatedPane').style.zIndex = '440';
            map.createPane('labelMaskImagePane').style.zIndex = '441';
            map.createPane('labelMaskOutlinePane').style.zIndex = '442';
            map.createPane('goodNegativesPane').style.zIndex = '450';
            map.createPane('discoveriesPane').style.zIndex = '451';
            map.createPane('downloadingPane').style.zIndex = '460';
            map.createPane('selectedPane').style.zIndex = '470';
            map.createPane("preview").style.zIndex = "650";

            orangeRenderer.current = L.canvas({pane: 'orangePane'});
            downloadingRenderer.current = L.canvas({pane: 'downloadingPane'});
            selectedRenderer.current = L.canvas({pane: 'selectedPane'});
            goodNegativesRenderer.current = L.canvas({pane: 'goodNegativesPane'});
            discoveriesRenderer.current = L.canvas({pane: 'discoveriesPane'});
            labelsAggregatedRenderer.current = L.canvas({pane: 'labelsAggregatedPane'});

            L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                {attribution: "Esri", maxZoom: 17}).addTo(map);
            L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
                {opacity: 0.8, maxZoom: 17}).addTo(map);

            orangeLayer.current.addTo(map);
            downloadingLayer.current.addTo(map);
            selectedLayer.current.addTo(map);
            goodNegativesLayer.current.addTo(map);
            discoveriesLayer.current.addTo(map);
            labelsAggregatedLayer.current.addTo(map);
            previewLayer.current.addTo(map);

            const throttledCursor = throttle((e: L.LeafletMouseEvent) => {
                const z = e.target.getZoom();
                const {lat, lng} = e.latlng;
                const x = lon2tile(lng, z);
                const y = lat2tile(lat, z);
                onCursorPositionChange({lat, lng, z, x, y});
            }, 100);

            map.on("mousemove", throttledCursor);
            map.on("mouseout", () => onCursorPositionChange({lat: null, lng: null, z: null, x: null, y: null}));

            const ro = new ResizeObserver(() => map.invalidateSize());
            ro.observe(container);
            map.on("remove", () => ro.disconnect());
            setMapReady(true);
        };
        init();
    }, [onCursorPositionChange]);

    // Effect to create/update KML panes and renderers
    useEffect(() => {
        const map = leafletMap.current;
        if (!map || !mapReady) return;
        const currentFilenames = new Set(kmlLayers.map(l => l.filename));
        kmlGridLayers.current.forEach((layer, filename) => {
            if (!currentFilenames.has(filename)) {
                map.removeLayer(layer);
                kmlGridLayers.current.delete(filename);
                renderedKmlGrids.current.delete(filename);
                kmlGridRenderers.current.delete(filename);
                kmlRenderers.current.delete(filename);
                lastKmlDisplayZooms.current.delete(filename);
                const linePane = map.getPane(`kmlPaneLine_${filename}`);
                if (linePane) linePane.remove();
                const gridPane = map.getPane(`kmlPaneGrid_${filename}`);
                if (gridPane) gridPane.remove();
            }
        });

        const layerCount = kmlLayers.length;
        kmlLayers.forEach((config, index) => {
            const zIndex = 448 + (layerCount - 1 - index);
            const linePaneName = `kmlPaneLine_${config.filename}`;
            if (!map.getPane(linePaneName)) map.createPane(linePaneName);
            (map.getPane(linePaneName) as HTMLElement).style.zIndex = `${zIndex}`;
            const gridPaneName = `kmlPaneGrid_${config.filename}`;
            if (!map.getPane(gridPaneName)) map.createPane(gridPaneName);
            (map.getPane(gridPaneName) as HTMLElement).style.zIndex = `${zIndex}`;
            if (!kmlRenderers.current.has(config.filename)) kmlRenderers.current.set(config.filename, L.canvas({pane: linePaneName}));
            if (!kmlGridRenderers.current.has(config.filename)) kmlGridRenderers.current.set(config.filename, L.canvas({pane: gridPaneName}));
            if (!renderedKmlGrids.current.has(config.filename)) renderedKmlGrids.current.set(config.filename, new Set());
            if (!kmlGridLayers.current.has(config.filename)) {
                const gridLayer = L.layerGroup();
                kmlGridLayers.current.set(config.filename, gridLayer);
                gridLayer.addTo(map);
            }
        });

        if (map) {
            const event = {target: map} as L.LeafletEvent;
            map.fire('moveend', event);
        }
    }, [kmlLayers, mapReady]);

    const getCursorForTool = (tool: Tool) => {
        switch (tool) {
            case "rectangle":
                return "crosshair";
            case "brush":
                return brushCursor;
            case "erase":
                return eraseCursor;
            default:
                return "";
        }
    }

    useEffect(() => {
        const map = leafletMap.current;
        if (!map || (tool !== 'brush' && tool !== 'erase')) {
            return;
        }

        let isPanning = false;
        const container = map.getContainer();

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) {
                e.preventDefault();
                isPanning = true;
                map.dragging.disable();
                container.style.cursor = 'grabbing';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (isPanning) {
                map.panBy([-e.movementX, -e.movementY], {animate: false});
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (e.button === 2) {
                isPanning = false;
                map.dragging.enable();
                container.style.cursor = getCursorForTool(tool);
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        };

        container.addEventListener('mousedown', onMouseDown);
        container.addEventListener('contextmenu', e => e.preventDefault());

        return () => {
            container.removeEventListener('mousedown', onMouseDown);
            container.removeEventListener('contextmenu', e => e.preventDefault());
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (map && !map.dragging.enabled()) {
                map.dragging.enable();
            }
        };

    }, [tool, mapReady]);

    useEffect(() => {
        if (leafletMap.current) {
            const container = leafletMap.current.getContainer();
            container.style.cursor = getCursorForTool(tool);
        }
    }, [tool]);



    return (
        <div className="relative w-full h-full group/map">
            <div ref={mapRef} className="absolute inset-0 bg-gray-200"/>
            {!mapReady && <div className="absolute inset-0 flex items-center justify-center bg-gray-100"><span
                className="text-gray-600">Loading map…</span></div>}

            <TileStatusLegend
                mode={mode}
                counts={counts}
                showExistingTiles={showExistingTiles}
                showGoodNegatives={showGoodNegatives}
                showDiscoveries={showDiscoveries}
                showLabels={showLabels}
                labelsColor={labelsColor}
                negativesColor={negativesColor}
                discoveriesColor={discoveriesColor}
                existingColor={existingColor}
                showGeoglyphs={showGeoglyphs}
                kmlLayers={kmlLayers}
                kmlLayerVisibility={kmlLayerVisibility}
                kmlGeoglyphCounts={kmlGeoglyphCounts}
                renderedTileCounts={renderedTileCounts}
                indicatorLayersOrder={indicatorLayersOrder}
            />

            <LayerControls
                showExistingTiles={showExistingTiles}
                setShowExistingTiles={setShowExistingTiles}
                showGoodNegatives={showGoodNegatives}
                showDiscoveries={showDiscoveries}
                showLabels={showLabels}
                setShowLabels={setShowLabels}
                negativesColor={negativesColor} setNegativesColor={setNegativesColor}
                discoveriesColor={discoveriesColor} setDiscoveriesColor={setDiscoveriesColor}
                existingColor={existingColor} setExistingColor={setExistingColor}
                labelsColor={labelsColor}
                setLabelsColor={setLabelsColor}
                labelsOpacity={labelsOpacity}
                setLabelsOpacity={setLabelsOpacity}
                showGeoglyphs={showGeoglyphs}
                setShowGeoglyphs={setShowGeoglyphs}
                kmlLayers={kmlLayers}
                setKmlLayers={setKmlLayers}
                kmlLayerVisibility={kmlLayerVisibility}
                onToggleKmlLayerVisibility={onToggleKmlLayerVisibility}
                onReorderKmlLayer={onReorderKmlLayer}
                appContainerRef={appContainerRef}
                modelsWithPredictions={modelsWithPredictions}
                predictionVisibility={predictionVisibility}
                predictionOpacities={predictionOpacities}
                onTogglePredictionVisibility={onTogglePredictionVisibility}
                onPredictionOpacityChange={onPredictionOpacityChange}
                onLoadPredictionTiles={onLoadPredictionTiles}
                predictionColors={predictionColors}
                onPredictionColorChange={onPredictionColorChange}
                onToggleIndicatorLayer={onToggleIndicatorLayer}
                oaiPredictions={oaiPredictions}
                oaiVisibility={oaiVisibility}
                onToggleOaiVisibility={onToggleOaiVisibility}
            />

            <SelectionTooltip {...tooltipData} />

            <ProgressModal
                isOpen={analysisProgress.isOpen}
                title="Analyzing Tiles"
                message="Checking brightness levels to filter forest tiles..."
                progress={analysisProgress.progress}
                total={analysisProgress.total}
                onCancel={handleCancelAnalysis}
                cancelText="Cancel Analysis"
            />

            <ProgressModal
                isOpen={downloadProgress.isOpen}
                title="Downloading Tiles"
                message="Fetching satellite imagery from Google Maps..."
                progress={downloadProgress.progress}
                total={downloadProgress.total}
                onCancel={handleCancelDownload}
                cancelText="Cancel Download"
            />
        </div>
    );
}