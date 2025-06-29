import type {Mode} from "../types";
import {Download, PenLine, Sparkles} from "lucide-react";

interface Props {
    currentMode: Mode;
    setMode: (m: Mode) => void;
}

export function ModeToggle({currentMode, setMode}: Props) {
    const base =
        "flex-1 text-center text-sm font-medium h-10 transition-colors rounded-full flex items-center justify-center";

    return (
        <div className="flex space-x-2 w-96 border-white-400">
            <button
                className={`${base} ${
                    currentMode === "download"
                        ? "bg-orange-500 text-white"
                        : "bg-gray-900 text-white"
                }`}
                onClick={() => setMode("download")}
            >
                <div className="flex items-center space-x-2">
                    <Download className="w-4 h-4"/>
                    <span>Download</span>
                </div>
            </button>

            <button
                className={`${base} ${
                    currentMode === "inference"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-900 text-white"
                }`}
                onClick={() => setMode("inference")}
            >
                <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4"/>
                    <span>Inference</span>
                </div>
            </button>

            <button
                className={`${base} ${
                    currentMode === "label"
                        ? "bg-teal-500 text-white"
                        : "bg-gray-900 text-white"
                }`}
                onClick={() => setMode("label")}
            >
                <div className="flex items-center space-x-2">
                    <PenLine className="w-4 h-4"/>
                    <span>Label</span>
                </div>
            </button>
        </div>
    );
}