import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ModeToggle} from "./components/ModeToggle";
import {Toolbar} from "./components/toolbar/Toolbar.tsx";
import {type CursorPosition, MapCanvas, type NavigationTarget} from "./components/MapCanvas";
import {ToastContainer, useToast} from "./components/Toast";
import type {Mode, Tool} from "./types";
import {Earth} from "lucide-react";
import {LabelEditor} from "./components/label-editor/LabelEditor.tsx";
import {getModelInfo, getShortModelName, type ModelInfo} from "./utils/modelNameUtils";
import {lat2tile, lon2tile} from "./utils/tileMathUtils.ts";
import {useLabelSync} from "./hooks/useLabelSync.ts";
import {ProgressModal} from "./components/ProgressModal.tsx";
import type {OAITilePrediction} from "./hooks/useOAIPredictionLayers.ts";

export interface KmlLayerConfig {
    name: string;
    filename: string;
    color: string;
    opacity?: number;
}

const DEFAULT_KML_LAYERS: KmlLayerConfig[] = [
    {name: "Geoglyphs", filename: "geoglyphs.kml", color: "#3388ff"},
    {name: "Legacy Geoglyphs", filename: "geoglyphs_legacy.kml", color: "#ff6a33"},
];

const KML_STORAGE_KEY = 'kmlLayerConfig';

const extractNumberFromName = (name: string): number => {
    const match = name.match(/-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

const MemoModeToggle = memo(ModeToggle);
const MemoToolbar = memo(Toolbar);

export default function App() {
    const [mode, setMode] = useState<Mode>("download");
    const [tool, setTool] = useState<Tool>("none");
    const [useTTA, setUseTTA] = useState(false);
    const [useOAI, setUseOAI] = useState(false);
    const [oaiModelName, setOaiModelName] = useState('gpt-4.1-mini');
    const [availableOaiModels] = useState(['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano']);
    const [selected, setSelected] = useState(new Set<string>());
    const [isLabelEditorOpen, setIsLabelEditorOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
        lat: null,
        lng: null,
        z: null,
        x: null,
        y: null
    });
    const [showExistingTiles, setShowExistingTiles] = useState(true);
    const [showGoodNegatives, setShowGoodNegatives] = useState(false);
    const [showDiscoveries, setShowDiscoveries] = useState(true);
    const [downloadTrigger, setDownloadTrigger] = useState(0);
    const [syncTrigger, setSyncTrigger] = useState(0);
    const [inferenceTrigger, setInferenceTrigger] = useState(0);
    const [clearTrigger, setClearTrigger] = useState(0);
    const {toasts, addToast, removeToast, updateToast} = useToast();
    const [kmlGeoglyphCounts, setKmlGeoglyphCounts] = useState<Record<string, number>>({});
    const [brightnessThreshold, setBrightnessThreshold] = useState(55);
    const [zoomThreshold, setZoomThreshold] = useState(16);
    const [kmlLayerVersions] = useState<Map<string, number>>(new Map());
    const [labelMaskVersion, setLabelMaskVersion] = useState(1);
    const appContainerRef = useRef<HTMLDivElement>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showGeoglyphs, setShowGeoglyphs] = useState(false);
    const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
    const initialFetchDoneRef = useRef(false);

    const [goodNegatives, setGoodNegatives] = useState<Set<string>>(new Set());
    const [discoveries, setDiscoveries] = useState<Set<string>>(new Set());
    const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
    const [allLabels, setAllLabels] = useState<Set<string>>(new Set());
    const [positiveLabels, setPositiveLabels] = useState<Set<string>>(new Set());
    const [showLabels, setShowLabels] = useState(true);
    const [labelsOpacity, setLabelsOpacity] = useState(0.7);

    const [labelsColor, setLabelsColor] = useState('#22d3ee');
    const [negativesColor, setNegativesColor] = useState('#FF0000');
    const [discoveriesColor, setDiscoveriesColor] = useState('#ffea00');
    const [existingColor, setExistingColor] = useState('#ff8c00');

    const [indicatorLayersOrder, setIndicatorLayersOrder] = useState<('negatives' | 'discoveries')[]>(['discoveries', 'negatives']);

    const [modelsWithPredictions, setModelsWithPredictions] = useState<string[]>([]);
    const [allPredictionTiles, setAllPredictionTiles] = useState<Map<string, Set<string>>>(new Map());
    const [predictionVisibility, setPredictionVisibility] = useState<Map<string, boolean>>(new Map());
    const [predictionOpacities, setPredictionOpacities] = useState<Map<string, number>>(new Map());
    const [predictionColors, setPredictionColors] = useState<Map<string, string>>(new Map());
    const [predictionTileVersions, setPredictionTileVersions] = useState(new Map<string, number>());

    const [oaiPredictions, setOaiPredictions] = useState<Map<string, Map<string, OAITilePrediction>>>(new Map());
    const [oaiVisibility, setOaiVisibility] = useState<Map<string, boolean>>(new Map());


    const [kmlLayers, setKmlLayers] = useState<KmlLayerConfig[]>(() => {
        try {
            const saved = window.localStorage.getItem(KML_STORAGE_KEY);
            const storedLayers: Array<Partial<KmlLayerConfig>> = saved ? JSON.parse(saved) : [];

            return DEFAULT_KML_LAYERS.map(defaultLayer => {
                const storedLayer = storedLayers.find(s => s.filename === defaultLayer.filename);

                if (storedLayer) {
                    return {
                        ...defaultLayer,
                        ...storedLayer,
                        name: storedLayer.name ?? defaultLayer.name,
                        filename: defaultLayer.filename,
                        color: storedLayer.color ?? defaultLayer.color,
                        opacity: storedLayer.opacity ?? defaultLayer.opacity ?? 0.4,
                    };
                }
                return defaultLayer;
            });
        } catch (error) {
            console.error("Failed to load KML layer config from localStorage", error);
            return DEFAULT_KML_LAYERS;
        }
    });

    const {
        progress: syncProgress,
        handleCancelSync
    } = useLabelSync({syncTrigger, showToast: addToast, setDownloaded});

    const handleIndicatorLayerToggle = useCallback((layer: 'negatives' | 'discoveries', isVisible: boolean) => {
        if (layer === 'negatives') {
            setShowGoodNegatives(isVisible);
        } else if (layer === 'discoveries') {
            setShowDiscoveries(isVisible);
        }

        if (isVisible) {
            setIndicatorLayersOrder(prevOrder => {
                const newOrder = prevOrder.filter(l => l !== layer);
                newOrder.push(layer);
                return newOrder as ('negatives' | 'discoveries')[];
            });
        }
    }, []);

    const handleLoadOaiPredictionTiles = useCallback((modelName: string) => {
        fetch(`/api/inference/oai/existing/${modelName}`)
            .then(res => res.json())
            .then((data: OAITilePrediction[]) => {
                // Overwrite the entire map for the model to clear out old entries.
                setOaiPredictions(prev => {
                    const newMap = new Map(prev);
                    const modelOaiPreds = new Map<string, OAITilePrediction>();
                    if (data?.length) {
                        data.forEach(p => modelOaiPreds.set(`${p.x},${p.y}`, p));
                    }
                    // Setting the map for the model, even if it's empty, ensures stale data is cleared.
                    return newMap.set(modelName, modelOaiPreds);
                });
            })
            .catch(err => {
                console.error(`Failed to load OAI predictions for ${modelName}`, err);
            });
    }, []);


    const fetchModels = useCallback(() => {
        const toastId = addToast("loading", "Fetching models...", null);
        const archivedShortNames = new Set<string>();

        fetch('/api/inference/models')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`Model fetch failed: ${res.status}`)))
            .then(data => {
                if (!data.success || !Array.isArray(data.models)) throw new Error("Invalid response from models API");
                removeToast(toastId);
                setAvailableModels(data.models);

                data.models.forEach((fullPath: string) => {
                    if (fullPath.startsWith('archive/')) archivedShortNames.add(getShortModelName(fullPath));
                });

                const sortedAndFilteredModels = data.models
                    .filter((model: string) => !model.startsWith('archive/'))
                    .map((path: string) => getModelInfo(path))
                    .sort((a: ModelInfo, b: ModelInfo) => (a.dateTime && b.dateTime) ? b.dateTime.localeCompare(a.dateTime) : a.shortName.localeCompare(b.shortName));

                setSelectedModel(prev => {
                    if (sortedAndFilteredModels.length > 0) {
                        const currentModelExists = sortedAndFilteredModels.some((m: ModelInfo) => m.fullPath === prev);
                        return (!prev || !currentModelExists) ? sortedAndFilteredModels[0].fullPath : prev;
                    }
                    return '';
                });

                return fetch('/api/inference/predictions/models');
            })
            .then(res => res.json())
            .then((predictionModels: string[]) => {
                if (Array.isArray(predictionModels)) {
                    const nonArchivedPredictionModels = predictionModels.filter(
                        shortName => shortName !== 'archive' && !archivedShortNames.has(shortName)
                    );

                    nonArchivedPredictionModels.sort((a, b) => extractNumberFromName(b) - extractNumberFromName(a));

                    setModelsWithPredictions(nonArchivedPredictionModels);
                    const initialVisibility = new Map<string, boolean>();
                    const initialOpacities = new Map<string, number>();
                    const initialColors = new Map<string, string>();
                    nonArchivedPredictionModels.forEach((modelName, index) => {
                        const isLatest = index === 0;
                        initialVisibility.set(modelName, isLatest);
                        initialOpacities.set(modelName, 1.0);
                        const defaultColors = ['#3b82f6', '#10b981', '#ef4444', '#f97316', '#8b5cf6'];
                        initialColors.set(modelName, defaultColors[index % defaultColors.length]);
                    });
                    setPredictionVisibility(initialVisibility);
                    setPredictionOpacities(initialOpacities);
                    setPredictionColors(initialColors);

                    // Fetch existing OAI predictions for all models that have predictions.
                    nonArchivedPredictionModels.forEach(modelName => {
                        handleLoadOaiPredictionTiles(modelName);
                    });
                }
            })
            .catch(err => {
                console.error("Failed to fetch model data:", err);
                updateToast(toastId, {type: 'error', message: err.message, duration: 4000});
                setAvailableModels([]);
            });
    }, [handleLoadOaiPredictionTiles]);

    useEffect(() => {
        const newPositiveLabels = new Set(
            [...allLabels].filter(key => !goodNegatives.has(key))
        );
        setPositiveLabels(newPositiveLabels);
    }, [allLabels, goodNegatives]);

    useEffect(() => {
        if (!initialFetchDoneRef.current) {
            fetchModels();

            fetch("/api/tiles/existing").then((r) => r.json()).then((d) => {
                if (Array.isArray(d.tiles)) setDownloaded(new Set<string>(d.tiles));
            }).catch((err) => {
                console.error("existing tiles fetch failed", err);
                addToast("error", "Failed to fetch existing tiles");
            });

            fetch('/api/labels/good_negatives')
                .then(res => res.json())
                .then((data: string[]) => {
                    if (Array.isArray(data)) setGoodNegatives(new Set(data));
                })
                .catch(err => console.error("Failed to fetch good negatives:", err));

            fetch('/api/discoveries')
                .then(res => res.json())
                .then((data: string[]) => {
                    if (Array.isArray(data)) setDiscoveries(new Set(data));
                })
                .catch(err => console.error("Failed to fetch discoveries:", err));

            fetch('/api/labels/all')
                .then(res => res.json())
                .then(data => {
                    if (data.success && Array.isArray(data.keys)) setAllLabels(new Set(data.keys));
                })
                .catch(err => console.error("Failed to fetch all label keys:", err));

            initialFetchDoneRef.current = true;
        }
    }, [fetchModels]);


    const handleLabelsSaved = () => {
        setLabelMaskVersion(v => v + 1);
        fetch('/api/labels/all')
            .then(res => res.json())
            .then(data => {
                if (data.success && Array.isArray(data.keys)) setAllLabels(new Set(data.keys));
            })
            .catch(err => console.error("Failed to refetch all label keys:", err));
    };

    const handleModelSelectionChange = (newModel: string) => {
        // Only show the toast if a model was already selected and the new one is different.
        if (selectedModel && newModel !== selectedModel) {
            const modelInfo = getModelInfo(newModel);
            addToast('info', `Switched to Segmentation model: ${modelInfo.shortName}`, 2500);
        }
        setSelectedModel(newModel);
    };

    const handlePredictionColorChange = useCallback((modelName: string, color: string) => setPredictionColors(prev => new Map(prev).set(modelName, color)), []);

    const handleTogglePredictionVisibility = useCallback((modelName: string) => {
        setPredictionVisibility(prev => {
            const newVisibility = new Map(prev);
            const newValue = !prev.get(modelName);
            newVisibility.set(modelName, newValue);

            // If the main layer is being turned OFF, turn the OAI layer OFF.
            if (newValue === false) {
                setOaiVisibility(prevOai => {
                    if (prevOai.get(modelName)) {
                        const newOaiVisibility = new Map(prevOai);
                        newOaiVisibility.set(modelName, false);
                        return newOaiVisibility;
                    }
                    return prevOai;
                });
            } else if (newValue === true) {
                if (oaiPredictions.has(modelName) && (oaiPredictions.get(modelName)?.size ?? 0) > 0) {
                    setOaiVisibility(prevOai => {
                        if (!prevOai.get(modelName)) { // Only update if it's currently off
                            const newOaiVisibility = new Map(prevOai);
                            newOaiVisibility.set(modelName, true);
                            return newOaiVisibility;
                        }
                        return prevOai;
                    });
                }
            }

            return newVisibility;
        });
    }, [oaiPredictions]);

    const handleSelectExclusivePredictionVisibility = useCallback((modelToToggle: string) => {
        setPredictionVisibility(prev => {
            const newVis = new Map<string, boolean>();
            const isCurrentlyOn = prev.get(modelToToggle);

            prev.forEach((_, modelName) => newVis.set(modelName, false));
            if (!isCurrentlyOn) {
                newVis.set(modelToToggle, true);
            }

            newVis.forEach((isVisible, modelName) => {
                if (isVisible === true) {
                    if (oaiPredictions.has(modelName) && (oaiPredictions.get(modelName)?.size ?? 0) > 0) {
                        setOaiVisibility(prevOai => {
                            if (!prevOai.get(modelName)) {
                                const newOai = new Map(prevOai);
                                newOai.set(modelName, true);
                                return newOai;
                            }
                            return prevOai;
                        });
                    }
                } else {
                    setOaiVisibility(prevOai => {
                        if (prevOai.get(modelName)) {
                            const newOai = new Map(prevOai);
                            newOai.set(modelName, false);
                            return newOai;
                        }
                        return prevOai;
                    });
                }
            });

            return newVis;
        });
    }, [oaiPredictions]);
    const handlePredictionOpacityChange = useCallback((modelName: string, opacity: number) => setPredictionOpacities(prev => new Map(prev).set(modelName, opacity)), []);

    const handleLoadPredictionTiles = useCallback((modelName: string) => {
        if (allPredictionTiles.has(modelName)) return;
        fetch(`/api/inference/existing/${modelName}`)
            .then(res => res.json())
            .then((tiles: string[]) => {
                if (Array.isArray(tiles)) setAllPredictionTiles(prev => new Map(prev).set(modelName, new Set(tiles)));
            })
            .catch(err => console.error(`Failed to fetch tiles for ${modelName}`, err));
    }, [allPredictionTiles]);


    const handleNewPrediction = useCallback((fullModelPath: string, newKeys: Set<string>, version: number, newOaiPredictions: OAITilePrediction[]) => {
        const shortModelName = getShortModelName(fullModelPath);

        setAllPredictionTiles(prev => {
            const newMap = new Map(prev);
            const updatedKeys = new Set([...(newMap.get(shortModelName) || new Set<string>()), ...newKeys]);
            return newMap.set(shortModelName, updatedKeys);
        });

        setPredictionTileVersions(prev => {
            const newVersions = new Map(prev);
            newKeys.forEach(key => newVersions.set(key, version));
            return newVersions;
        });

        if (newOaiPredictions) {
            // Instead of setting state from the API, trigger a reload from disk.
            // This ensures the UI is in sync with the newly saved files.
            console.log(`New OAI predictions received for ${shortModelName}. Refreshing from disk.`);
            handleLoadOaiPredictionTiles(shortModelName);

            // Also ensure the OAI layer is visible to show the new results.
            setOaiVisibility(prev => {
                if (prev.get(shortModelName) === true) {
                    return prev;
                }
                return new Map(prev).set(shortModelName, true);
            });
        }
        if (!modelsWithPredictions.includes(shortModelName)) {
            setModelsWithPredictions(prev => [...prev, shortModelName]);
            setPredictionVisibility(prev => new Map(prev).set(shortModelName, true));
            setPredictionOpacities(prev => new Map(prev).set(shortModelName, 0.7));
        }
    }, [modelsWithPredictions, handleLoadOaiPredictionTiles]);

    const handleToggleOaiVisibility = useCallback((modelName: string) => {
        setOaiVisibility(prev => {
            const newMap = new Map(prev);
            const currentValue = newMap.get(modelName) ?? false;
            newMap.set(modelName, !currentValue);
            return newMap;
        });
    }, []);

    const [kmlLayerVisibility, setKmlLayerVisibility] = useState<Record<string, boolean>>(() => Object.fromEntries(DEFAULT_KML_LAYERS.map(layer => [layer.filename, true])));
    const memoizedKmlVisibility = useMemo(() => showGeoglyphs ? kmlLayerVisibility : {}, [kmlLayerVisibility, showGeoglyphs]);
    useEffect(() => {
        const configToSave = kmlLayers.map(({filename, color, opacity, name}) => ({filename, color, opacity, name}));
        window.localStorage.setItem(KML_STORAGE_KEY, JSON.stringify(configToSave));
    }, [kmlLayers]);
    const handleReorderKmlLayer = useCallback((fromIndex: number, toIndex: number) => {
        setKmlLayers(prevLayers => {
            const newLayers = [...prevLayers];
            const [movedItem] = newLayers.splice(fromIndex, 1);
            if (toIndex >= 0 && toIndex < newLayers.length + 1) newLayers.splice(toIndex, 0, movedItem);
            return newLayers;
        });
    }, []);

    const handleCloseLabelEditor = () => {
        setIsLabelEditorOpen(false);
        setSelected(new Set());
        appContainerRef.current?.focus();

        const anyVisible = Array.from(predictionVisibility.values()).some(v => v);
        if (!anyVisible && modelsWithPredictions.length > 0) {
            const sortedModels = [...modelsWithPredictions].sort((a, b) => extractNumberFromName(b) - extractNumberFromName(a));
            setPredictionVisibility(prev => new Map(prev).set(sortedModels[0], true));
        }
    };

    const handleUpdateGoodNegatives = useCallback(async (newNegativesSet: Set<string>) => {
        const toastId = addToast("loading", "Saving good negatives...", null);
        try {
            const response = await fetch('/api/labels/good_negatives', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(Array.from(newNegativesSet))
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({detail: 'Failed to parse error response.'}));
                const msg = errorData.detail || 'Failed to save.';
                updateToast(toastId, {type: 'error', message: `Save failed: ${msg}`, duration: 4000});
                return;
            }
            setGoodNegatives(newNegativesSet);
            updateToast(toastId, {type: 'success', message: 'Good negatives saved!', duration: 2000});
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error.";
            updateToast(toastId, {type: 'error', message: `Save failed: ${msg}`, duration: 4000});
        }
    }, []);

    const handleUpdateDiscoveries = useCallback(async (newDiscoveriesSet: Set<string>) => {
        const toastId = addToast("loading", "Saving discoveries...", null);
        try {
            const response = await fetch('/api/discoveries', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(Array.from(newDiscoveriesSet))
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({detail: 'Failed to parse error response.'}));
                const msg = errorData.detail || 'Failed to save.';
                updateToast(toastId, {type: 'error', message: `Save failed: ${msg}`, duration: 4000});
                return;
            }
            setDiscoveries(newDiscoveriesSet);
            updateToast(toastId, {type: 'success', message: 'Discoveries saved!', duration: 2000});
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error.";
            updateToast(toastId, {type: 'error', message: `Save failed: ${msg}`, duration: 4000});
        }
    }, [addToast, updateToast]);

    const triggerDownload = () => setDownloadTrigger(n => n + 1);
    const triggerSync = () => setSyncTrigger(n => n + 1);
    const triggerInference = () => setInferenceTrigger(n => n + 1);
    const triggerLabeling = () => setIsLabelEditorOpen(true);
    const triggerClear = () => {
        setSelected(new Set());
        setClearTrigger(n => n + 1);
    }
    const handleCursorPositionChange = useCallback((pos: CursorPosition) => setCursorPosition(pos), []);
    const handleNavigate = useCallback((target: NavigationTarget) => {
        setNavigationTarget(target);
        if (target.lat && target.lon) {
            setCursorPosition({
                lat: target.lat,
                lng: target.lon,
                z: target.zoom ?? 17,
                x: lon2tile(target.lon, target.zoom ?? 17),
                y: lat2tile(target.lat, target.zoom ?? 17)
            });
        }
    }, []);

    useEffect(() => {
        if (mode === 'inference' || mode === 'label') {
            setSelected(prevSelected => {
                const newSelected = new Set<string>();
                for (const tile of prevSelected) {
                    if (downloaded.has(tile)) {
                        newSelected.add(tile);
                    }
                }
                return newSelected;
            });
        }
    }, [mode, downloaded]);

    useEffect(() => {
            const handler = (e: KeyboardEvent) => {
                    if (isLabelEditorOpen || isAnalyzing || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.key !== 'Tab')) return;
                    const key = e.key.toLowerCase();

                    if (isAnalyzing) {
                        if (["r", "b", "e", "c", "o", "d", "i", "h", "l", "n", "f", "escape", "tab"].includes(key) || (e.key >= '1' && e.key <= '9')) {
                            e.preventDefault();
                        }
                        return;
                    }

                    switch (key) {
                        case "tab": {
                            e.preventDefault();
                            const modes: Mode[] = ['download', 'inference', 'label'];
                            const currentIndex = modes.indexOf(mode);
                            const nextIndex = (currentIndex + 1) % modes.length;
                            setMode(modes[nextIndex]);
                            break;
                        }
                        case "escape":
                            setTool("none");
                            triggerClear();
                            break;
                        case "r":
                            setTool("rectangle");
                            break;
                        case "b":
                            setTool("brush");
                            break;
                        case "e":
                            setTool("erase");
                            break;
                        case "c":
                            triggerClear();
                            break;
                        case "o":
                            setShowExistingTiles(p => !p);
                            break;
                        case "f":
                            if (selected.size === 0) {
                                handleIndicatorLayerToggle('discoveries', !showDiscoveries);
                            }
                            break;
                        case "n":
                            if (mode === "label" && selected.size > 0) {
                                let updatedSet: Set<string>;
                                setGoodNegatives(prevNegatives => {
                                    const newNegatives = new Set(prevNegatives);
                                    const firstSelected = selected.values().next().value!;
                                    const isRemoving = newNegatives.has(firstSelected);
                                    selected.forEach(tileKey => {
                                        if (isRemoving) newNegatives.delete(tileKey);
                                        else newNegatives.add(tileKey);
                                    });
                                    updatedSet = newNegatives;
                                    return updatedSet;
                                });
                                setTimeout(() => handleUpdateGoodNegatives(updatedSet), 0);
                                setSelected(new Set());
                                handleIndicatorLayerToggle('negatives', true);
                            } else if (selected.size == 0) {
                                handleIndicatorLayerToggle('negatives', !showGoodNegatives);
                            }
                            break;
                        case "d":
                            if (mode === "download" && selected.size > 0) {
                                triggerDownload();
                            } else if (mode === "label" && selected.size > 0) {
                                let updatedSet: Set<string>;
                                setDiscoveries(prevDiscoveries => {
                                    const newDiscoveries = new Set(prevDiscoveries);
                                    const firstSelected = selected.values().next().value!;
                                    const isRemoving = newDiscoveries.has(firstSelected);
                                    selected.forEach(tileKey => {
                                        if (isRemoving) newDiscoveries.delete(tileKey);
                                        else newDiscoveries.add(tileKey);
                                    });
                                    updatedSet = newDiscoveries;
                                    return updatedSet;
                                });
                                setTimeout(() => handleUpdateDiscoveries(updatedSet), 0);
                                setSelected(new Set());
                                handleIndicatorLayerToggle('discoveries', true);
                            }
                            break;
                        case "i":
                            if (mode === "inference") triggerInference();
                            break;
                        case "l":
                            if (mode === "label" && selected.size > 0) {
                                triggerLabeling();
                            }
                            break;
                        case "h": {
                            if (cursorPosition.lat !== null && cursorPosition.lng !== null) {
                                const lat = cursorPosition.lat.toFixed(6);
                                const lng = cursorPosition.lng.toFixed(6);
                                const googleEarthUrl = `https://earth.google.com/web/@${lat},${lng},152.76025665a,50000d,0y,0h,0t,0r/`;
                                const coordsText = `${lat}, ${lng}`;
                                navigator.clipboard.writeText(coordsText).then(() => {
                                    addToast("info", (
                                        <div className="flex items-center justify-between w-full">
                                            <span className="text-white">Copied: {coordsText}</span>
                                            <button
                                                onClick={() => window.open(googleEarthUrl, '_blank', 'noopener,noreferrer')}
                                                className="ml-4 px-1 py-1 bg-green-500 hover:bg-blue-600 text-white rounded text-xs font-semibold">
                                                <Earth className="w-4 h-4 text-white"/>
                                            </button>
                                        </div>
                                    ), 1500);
                                }).catch(() => {
                                    addToast("error", "Failed to copy coordinates.", 500);
                                });
                            } else {
                                addToast("info", "No coordinates to copy. Move the mouse over the map.", 500);
                            }
                            break;
                        }
                        default:
                            if (e.key >= '1' && e.key <= '9') {
                                e.preventDefault();
                                const keyNum = parseInt(e.key, 10);
                                if (keyNum === 1) {
                                    setShowLabels(p => !p);
                                } else {
                                    const modelIndex = keyNum - 2;
                                    const sortedModels = [...modelsWithPredictions].sort((a, b) => extractNumberFromName(b) - extractNumberFromName(a));
                                    if (modelIndex >= 0 && modelIndex < sortedModels.length) {
                                        const modelToToggle = sortedModels[modelIndex];
                                        handleSelectExclusivePredictionVisibility(modelToToggle);
                                    }
                                }
                            }
                            break;
                    }
                }
            ;
            window.addEventListener("keydown", handler);
            return () => window.removeEventListener("keydown", handler);
        }, [mode, showExistingTiles, addToast, kmlLayers, cursorPosition, selected, goodNegatives, discoveries, isLabelEditorOpen, isAnalyzing, handleUpdateGoodNegatives, handleUpdateDiscoveries, handleIndicatorLayerToggle, showDiscoveries, showGoodNegatives, modelsWithPredictions]
    );

    return (
        <div
            ref={appContainerRef}
            tabIndex={-1}
            className={`flex flex-col h-screen outline-none ${
                mode === "download" ? "border-orange-500" :
                    mode === "inference" ? "border-blue-500" : "border-teal-500"
            } border-8`}>
            <div className="flex items-center justify-between p-2 bg-gray-100 shadow">
                <MemoModeToggle currentMode={mode} setMode={setMode}/>
                <MemoToolbar
                    currentTool={tool} setTool={setTool} onDownload={triggerDownload}
                    onInference={triggerInference} onStartLabeling={triggerLabeling}
                    onSyncLabels={triggerSync}
                    onClear={triggerClear} cursorPosition={cursorPosition} onNavigate={handleNavigate}
                    mode={mode} availableModels={availableModels} selectedModel={selectedModel}
                    setSelectedModel={handleModelSelectionChange} selectionSize={selected.size}
                    brightnessThreshold={brightnessThreshold} setBrightnessThreshold={setBrightnessThreshold}
                    onFetchModels={fetchModels} useTTA={useTTA} setUseTTA={setUseTTA}
                    zoomThreshold={zoomThreshold} setZoomThreshold={setZoomThreshold}
                    showToast={addToast}
                    useOAI={useOAI}
                    setUseOAI={setUseOAI}
                    availableOaiModels={availableOaiModels}
                    oaiModelName={oaiModelName}
                    setOaiModelName={setOaiModelName}
                />
            </div>
            <div className="flex-1 relative min-h-0">
                <MapCanvas
                    mode={mode} tool={tool} setTool={setTool}
                    downloadTrigger={downloadTrigger} inferenceTrigger={inferenceTrigger}
                    onCursorPositionChange={handleCursorPositionChange} clearTrigger={clearTrigger}
                    showToast={addToast} updateToast={updateToast}
                    selectedModel={selectedModel}
                    selected={selected} setSelected={setSelected}
                    goodNegatives={goodNegatives}
                    discoveries={discoveries}
                    positiveLabels={positiveLabels}
                    kmlLayerVersions={kmlLayerVersions}
                    labelMaskVersion={labelMaskVersion}
                    appContainerRef={appContainerRef}
                    brightnessThreshold={brightnessThreshold}
                    zoomThreshold={zoomThreshold}
                    onAnalysisStateChange={setIsAnalyzing}
                    allPredictionTiles={allPredictionTiles}
                    predictionVisibility={predictionVisibility}
                    predictionOpacities={predictionOpacities}
                    onNewPrediction={handleNewPrediction}
                    modelsWithPredictions={modelsWithPredictions}
                    onTogglePredictionVisibility={handleTogglePredictionVisibility}
                    onPredictionOpacityChange={handlePredictionOpacityChange}
                    onLoadPredictionTiles={handleLoadPredictionTiles}
                    downloaded={downloaded}
                    setDownloaded={setDownloaded}
                    showExistingTiles={showExistingTiles} setShowExistingTiles={setShowExistingTiles}
                    showGoodNegatives={showGoodNegatives}
                    showDiscoveries={showDiscoveries}
                    showLabels={showLabels} setShowLabels={setShowLabels}
                    negativesColor={negativesColor} setNegativesColor={setNegativesColor}
                    discoveriesColor={discoveriesColor} setDiscoveriesColor={setDiscoveriesColor}
                    existingColor={existingColor} setExistingColor={setExistingColor}
                    labelsColor={labelsColor} setLabelsColor={setLabelsColor}
                    labelsOpacity={labelsOpacity} setLabelsOpacity={setLabelsOpacity}
                    showGeoglyphs={showGeoglyphs} setShowGeoglyphs={setShowGeoglyphs}
                    kmlLayers={kmlLayers} setKmlLayers={setKmlLayers}
                    kmlLayerVisibility={memoizedKmlVisibility}
                    onToggleKmlLayerVisibility={(filename) => setKmlLayerVisibility(p => ({
                        ...p,
                        [filename]: !p[filename]
                    }))}
                    onReorderKmlLayer={handleReorderKmlLayer}
                    kmlGeoglyphCounts={kmlGeoglyphCounts} setKmlGeoglyphCounts={setKmlGeoglyphCounts}
                    predictionColors={predictionColors} onPredictionColorChange={handlePredictionColorChange}
                    navigationTarget={navigationTarget}
                    predictionTileVersions={predictionTileVersions} useTTA={useTTA}
                    indicatorLayersOrder={indicatorLayersOrder}
                    onToggleIndicatorLayer={handleIndicatorLayerToggle}
                    oaiPredictions={oaiPredictions}
                    oaiVisibility={oaiVisibility}
                    onToggleOaiVisibility={handleToggleOaiVisibility}
                    onLoadOaiPredictionTiles={handleLoadOaiPredictionTiles}
                    useOAI={useOAI}
                    oaiModelName={oaiModelName}
                />
            </div>
            <LabelEditor
                isOpen={isLabelEditorOpen} onClose={handleCloseLabelEditor} onLabelsSaved={handleLabelsSaved}
                selectedTiles={selected} labelMaskVersion={labelMaskVersion} Z={17}
                modelsWithPredictions={modelsWithPredictions} allPredictionTiles={allPredictionTiles}
                predictionVisibility={predictionVisibility} predictionOpacities={predictionOpacities}
                predictionColors={predictionColors} onLoadPredictionTiles={handleLoadPredictionTiles}
                onTogglePredictionVisibility={handleTogglePredictionVisibility}
                onPredictionOpacityChange={handlePredictionOpacityChange}
                onPredictionColorChange={handlePredictionColorChange} appContainerRef={appContainerRef}
                labelsColor={labelsColor}
            />
            <ProgressModal
                isOpen={syncProgress.isOpen}
                title={syncProgress.title}
                message={syncProgress.message}
                progress={syncProgress.progress}
                total={syncProgress.total}
                onCancel={handleCancelSync}
                cancelText="Cancel Sync"
            />
            <ToastContainer toasts={toasts} removeToast={removeToast}/>
        </div>
    );
}