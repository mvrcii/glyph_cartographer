import {useEffect} from "react";
import type {Mode} from "../types";
import type {ToastType} from "../components/Toast";
import type {OAITilePrediction} from "./useOAIPredictionLayers.ts";

interface Prediction {
    x: number;
    y: number;
    prob_png_b64: string;
}

interface UseTileInferenceProps {
    inferenceTrigger: number;
    mode: Mode;
    selected: Set<string>;
    clearSelection: () => void;
    showToast: (t: ToastType, msg: string, dur?: number | null) => string;
    updateToast: (id: string, newData: any) => void;
    onNewPredictions: (fullModelPath: string, newKeys: Set<string>, version: number, oaiPredictions: OAITilePrediction[]) => void;
    selectedModel: string;
    useTTA: boolean;
    useOAI: boolean;
    oaiModelName: string;
}

export function useTileInference({
                                     inferenceTrigger,
                                     mode,
                                     selected,
                                     clearSelection,
                                     showToast,
                                     updateToast,
                                     onNewPredictions,
                                     selectedModel,
                                     useTTA,
                                     useOAI,
                                     oaiModelName
                                 }: UseTileInferenceProps) {
    useEffect(() => {
        if (inferenceTrigger === 0 || mode !== "inference") return;

        const tilesToInfer = Array.from(selected);

        if (tilesToInfer.length === 0) {
            showToast("info", "No tiles selected for inference.", 3000);
            return;
        }

        const toastId = showToast("info", `Starting inference for ${tilesToInfer.length} tiles...`, null);

        const payload = {
            tiles: tilesToInfer.map(key => {
                const [x, y] = key.split(',').map(Number);
                return {x, y};
            }),
            model_name: selectedModel,
            use_tta: useTTA,
            use_oai: useOAI,
            oai_model_name: oaiModelName
        };

        fetch("/api/inference", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
        })
            .then(res => {
                if (!res.ok) {
                    return res.text().then(text => {
                        throw new Error(text || "Inference request failed");
                    });
                }
                return res.json();
            })
            .then(data => {
                updateToast(toastId, {
                    type: "success",
                    message: data.message || `Inference complete!`,
                    duration: 1000,
                });
                if (data.predictions) {
                    const newPredictionKeys: Set<string> = new Set(data.predictions.map((p: Prediction) => `${p.x},${p.y}`));
                    onNewPredictions(selectedModel, newPredictionKeys, Date.now(), data.oai_predictions || []);
                }
                clearSelection();
            })
            .catch(err => {
                console.error("Inference failed", err);
                updateToast(toastId, {
                    type: "error",
                    message: `Inference failed: ${err.message}`,
                    duration: 1000,
                });
            });
    }, [inferenceTrigger]);
}