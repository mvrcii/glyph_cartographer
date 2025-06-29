import type {CursorPosition, NavigationTarget} from "../MapCanvas.tsx";
import type {ToastType} from "../Toast.tsx";
import  {useCallback, useEffect, useState} from "react";
import {lat2tile, lon2tile, parseCoordinates, tile2lat, tile2lon} from "../../utils/tileMathUtils.ts";
import {Wand2, X, Check, Edit} from "lucide-react";

const CoordinatePasteButton = ({onNavigate, showToast}: {
    onNavigate: (target: NavigationTarget) => void,
    showToast: (t: ToastType, msg: string, dur?: number | null) => string;
}) => {
    const handlePasteAndGo = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            const coords = parseCoordinates(text);
            if (coords) {
                onNavigate({lat: coords.lat, lon: coords.lon, zoom: coords.zoom});
            } else {
                showToast("error", `Could not parse coordinates from clipboard`, 2000);
            }
        } catch (error) {
            console.error('Failed to read clipboard or parse coordinates:', error);
            showToast("error", "Failed to read clipboard.", 2000);
        }
    }, [onNavigate, showToast]);

    return (
        <button
            onClick={handlePasteAndGo}
            title="Paste & Go: Paste coordinates from clipboard and navigate"
            className="btn ml-2 flex items-center justify-center space-x-1 transition-colors
                       bg-white text-purple-600 border-purple-400
                       hover:bg-purple-600 hover:text-white
                       active:bg-purple-700 active:border-purple-700"
        >
            <Wand2 size={16}/>
            <span>Go</span>
        </button>
    );
};


export const CoordinateDisplay = ({cursorPosition, onNavigate, showToast}: {
    cursorPosition: CursorPosition,
    onNavigate: (target: NavigationTarget) => void,
    showToast: (t: ToastType, msg:string, dur?: number | null) => string;
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [latInput, setLatInput] = useState("");
    const [lonInput, setLonInput] = useState("");
    const [xInput, setXInput] = useState("");
    const [yInput, setYInput] = useState("");
    const [lastEdited, setLastEdited] = useState<'latlon' | 'xy' | null>(null);
    const Z17_CONST = 17;

    useEffect(() => {
        if (!isEditing) {
            setLatInput(cursorPosition.lat?.toFixed(3) || "");
            setLonInput(cursorPosition.lng?.toFixed(3) || "");
            setXInput(cursorPosition.lng ? lon2tile(cursorPosition.lng, Z17_CONST).toString() : "");
            setYInput(cursorPosition.lat ? lat2tile(cursorPosition.lat, Z17_CONST).toString() : "");
        }
    }, [cursorPosition, isEditing]);

    const handleSave = () => {
        const lat = parseFloat(latInput);
        const lon = parseFloat(lonInput);
        const x = parseInt(xInput, 10);
        const y = parseInt(yInput, 10);

        if (lastEdited === 'xy' && !isNaN(x) && !isNaN(y)) {
            onNavigate({lat: tile2lat(y, Z17_CONST), lon: tile2lon(x, Z17_CONST), zoom: Z17_CONST});
        } else if (lastEdited === 'latlon' && !isNaN(lat) && !isNaN(lon)) {
            onNavigate({lat, lon, zoom: Z17_CONST});
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setIsEditing(false);
        // Reset inputs to their last known good state from cursorPosition
        setLatInput(cursorPosition.lat?.toFixed(3) || "");
        setLonInput(cursorPosition.lng?.toFixed(3) || "");
        setXInput(cursorPosition.lng ? lon2tile(cursorPosition.lng, Z17_CONST).toString() : "");
        setYInput(cursorPosition.lat ? lat2tile(cursorPosition.lat, Z17_CONST).toString() : "");
    };

    const chipBaseStyle = "px-2 py-0.5 rounded-md text-xs font-semibold flex items-center";
    const inlineInputBase = "bg-transparent focus:outline-none w-full";

    return (
        <div className="ml-auto flex items-center">
            <div
                onClick={!isEditing ? () => setIsEditing(true) : undefined}
                title={!isEditing ? "Click to navigate" : ""}
                className={`flex items-center justify-between h-10 w-[440px] bg-white border-2 rounded-lg transition-colors font-mono
                           ${!isEditing ? 'cursor-pointer hover:bg-gray-50 border-gray-300' : 'border-blue-500'}`}
            >
                <div className="flex items-center space-x-3 text-sm px-3">
                    {isEditing ? (
                        <div className="flex items-center text-gray-800">
                           <input type="text" value={latInput} onChange={e => {setLatInput(e.target.value); setLastEdited('latlon');}} className={`${inlineInputBase} w-20`}/>,
                           <input type="text" value={lonInput} onChange={e => {setLonInput(e.target.value); setLastEdited('latlon');}} className={`${inlineInputBase} w-20`}/>
                        </div>
                    ) : (
                        <span className="text-gray-800">{latInput}, {lonInput}</span>
                    )}

                    <div className="flex items-center space-x-1.5">
                        {/* FIX: The Z chip now always renders as text and is not editable. */}
                        <div className={`${chipBaseStyle} bg-blue-100 text-blue-800`}>
                           Z:{Z17_CONST}
                        </div>
                        <div className={`${chipBaseStyle} bg-green-100 text-green-800`}>
                            X:{isEditing ? <input type="text" value={xInput} onChange={e => {setXInput(e.target.value); setLastEdited('xy');}} className={`${inlineInputBase} w-12 ml-1`} /> : xInput}
                        </div>
                        <div className={`${chipBaseStyle} bg-red-100 text-red-800`}>
                            Y:{isEditing ? <input type="text" value={yInput} onChange={e => {setYInput(e.target.value); setLastEdited('xy');}} className={`${inlineInputBase} w-12 ml-1`} /> : yInput}
                        </div>
                    </div>
                </div>

                <div className="flex items-center pr-2">
                    {isEditing ? (
                        <>
                            <button onClick={handleSave} title="Confirm" className="h-8 w-8 rounded-md flex items-center justify-center text-green-600 hover:bg-green-100">
                                <Check className="w-5 h-5"/>
                            </button>
                            <button onClick={handleCancel} title="Cancel" className="h-8 w-8 rounded-md flex items-center justify-center text-red-600 hover:bg-red-100">
                                <X className="w-5 h-5"/>
                            </button>
                        </>
                    ) : (
                        <Edit className="w-4 h-4 text-gray-400"/>
                    )}
                </div>
            </div>
            <CoordinatePasteButton onNavigate={onNavigate} showToast={showToast}/>
        </div>
    )
}