import React, {useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {getModelInfo, type ModelInfo} from "../../utils/modelNameUtils";

export function FinalGeoglyphIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            <title>Final Geoglyph Model Icon</title>
            <g transform="rotate(-15, 12, 12)">
                <rect x="8" y="8" width="8" height="8" rx="0.5"/>

                <path d="
          M 11 3 L 11 5
          M 13 3 L 13 5
          M 11 21 L 11 19
          M 13 21 L 13 19
          M 3 11 L 5 11
          M 3 13 L 5 13
          M 21 11 L 19 11
          M 21 13 L 19 13
          M 5 11 L 5 5 L 11 5
          M 13 5 L 19 5 L 19 11
          M 19 13 L 19 19 L 13 19
          M 11 19 L 5 19 L 5 13
        "/>
            </g>
        </svg>
    );
}

interface SegmentationModelSelectorProps {
    selectedModel: string;
    setSelectedModel: (model: string) => void;
    availableModels: string[];
    onFetchModels: () => void;
}

export function SegmentationModelSelector({
                                              selectedModel,
                                              setSelectedModel,
                                              availableModels,
                                              onFetchModels
                                          }: SegmentationModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

    const anchorRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const processedModels = useMemo(() => {
        return availableModels
            .filter(model => !model.startsWith('archive/'))
            .map(path => getModelInfo(path))
            .sort((a, b) => {
                if (a.dateTime && b.dateTime) {
                    return b.dateTime.localeCompare(a.dateTime);
                }
                return a.shortName.localeCompare(b.shortName);
            });
    }, [availableModels]);

    const formatOptionText = (modelInfo: ModelInfo) => {
        let text = modelInfo.shortName;
        if (modelInfo.architecture) {
            text += ` (${modelInfo.architecture})`;
        }
        if (modelInfo.valIou) {
            text += ` - IoU: ${parseFloat(modelInfo.valIou).toFixed(3)}`;
        }
        return text;
    };

    const toggle = () => {
        if (!isOpen) {
            onFetchModels();
        }
        setIsOpen((prev) => !prev);
    };

    const pick = (model: ModelInfo) => {
        setSelectedModel(model.fullPath);
        setIsOpen(false);
    };

    const selectedModelInfo = useMemo(() => {
        return processedModels.find(m => m.fullPath === selectedModel);
    }, [selectedModel, processedModels]);

    useEffect(() => {
        if (!isOpen || !anchorRef.current) return;
        const updatePos = () => {
            const rect = anchorRef.current!.getBoundingClientRect();
            setMenuPos({top: rect.bottom + 4, left: rect.left});
        };
        updatePos();
        window.addEventListener("scroll", updatePos, true);
        window.addEventListener("resize", updatePos);
        return () => {
            window.removeEventListener("scroll", updatePos, true);
            window.removeEventListener("resize", updatePos);
        };
    }, [isOpen]);

    useEffect(() => {
        const handle = (e: MouseEvent) => {
            if (anchorRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
            setIsOpen(false);
        };
        document.addEventListener("mousedown", handle);
        return () => document.removeEventListener("mousedown", handle);
    }, []);

    const hasSelection = !!selectedModelInfo;

    return (
        <>
            <div className="relative" ref={anchorRef}>
                <div className="inline-flex overflow-hidden shadow-sm">
                    <button
                        type="button"
                        onClick={toggle}
                        title="Select Segmentation Model"
                        className={`inline-flex items-center gap-1 h-10 px-2 text-sm font-medium focus:outline-none transition-colors ${
                            hasSelection
                                ? `bg-blue-600 rounded-none text-white hover:bg-blue-500 rounded-l-lg`
                                : `bg-white text-blue-600 border-2 border-blue-400 hover:bg-blue-100 rounded-lg`
                        }`}
                    >
                        <FinalGeoglyphIcon className={`w-6 h-6 shrink-0 `}/>
                    </button>

                    {hasSelection && selectedModelInfo && (
                        <span
                            title={formatOptionText(selectedModelInfo)}
                            className="flex items-center h-10 px-3 text-sm font-mono bg-white text-blue-700 border-t-2 border-b-2 border-r-2 border-blue-400 rounded-r-lg whitespace-nowrap max-w-xs overflow-hidden text-ellipsis"
                        >
              {selectedModelInfo.shortName}
            </span>
                    )}
                </div>
            </div>

            {isOpen &&
                menuPos &&
                createPortal(
                    <div
                        ref={menuRef}
                        className="fixed z-[1001] w-96 rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
                        style={{top: menuPos.top, left: menuPos.left}}
                        role="menu"
                    >
                        <div className="py-1 max-h-80 overflow-y-auto">
                            {processedModels.length === 0 ? (
                                <div className="px-4 py-2 text-sm text-gray-500">
                                    {availableModels.length > 0 ? "No usable models found" : "Click button to load models..."}
                                </div>
                            ) : (
                                processedModels.map((modelInfo) => (
                                    <button
                                        key={modelInfo.fullPath}
                                        onClick={() => pick(modelInfo)}
                                        className={`block w-full px-4 py-2 text-left text-sm ${
                                            selectedModel === modelInfo.fullPath
                                                ? "bg-blue-100 text-blue-700 font-semibold"
                                                : "bg-white text-gray-700 hover:bg-gray-100"
                                        }`}
                                        role="menuitem"
                                        title={formatOptionText(modelInfo)}
                                    >
                                        {formatOptionText(modelInfo)}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}