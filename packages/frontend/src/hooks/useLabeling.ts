import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Point} from '../types.ts';

type LabelingTool = 'brush' | 'erase';

export const useLabeling = (
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    brushSize: number,
    tool: LabelingTool,
) => {
    const isDrawing = useRef(false);
    const lastPoint = useRef<Point | null>(null);
    const [history, setHistory] = useState<ImageData[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const brushSizeRef = useRef(brushSize);

    // This effect tracks the latest brushSize.
    useEffect(() => {
        brushSizeRef.current = brushSize;
    }, [brushSize]);

    const context = useMemo(() => {
        if (!canvasRef.current) return null;
        return canvasRef.current.getContext('2d', {willReadFrequently: true});
    }, [canvasRef.current]);

    const pushToHistory = useCallback((imageData: ImageData) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(imageData);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }, [history, historyIndex]);

    const initialize = useCallback(() => {
        if (!context || !canvasRef.current) return;
        const initialImageData = context.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        setHistory([initialImageData]);
        setHistoryIndex(0);
    }, [context, canvasRef]);

    const onDrawMove = useCallback((point: Point) => {
        if (!isDrawing.current || !context || !lastPoint.current) return;

        context.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(lastPoint.current.x, lastPoint.current.y);
        context.lineTo(point.x, point.y);

        if (tool === 'brush') {
            context.strokeStyle = '#FFFFFF';
        } else {
            context.strokeStyle = `rgba(0, 0, 0, 1)`;
        }

        // Set the line width directly to the brush size.
        context.lineWidth = brushSizeRef.current;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.stroke();

        lastPoint.current = point;
    }, [context, tool]);

    const onDrawStart = useCallback((point: Point) => {
        if (!context) return;
        isDrawing.current = true;
        lastPoint.current = point;
        onDrawMove(point);
    }, [context, onDrawMove]);

    const onDrawEnd = useCallback(() => {
        if (!isDrawing.current || !context || !canvasRef.current) return false;
        isDrawing.current = false;
        pushToHistory(context.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height));
        return true;
    }, [context, canvasRef, pushToHistory]);

    const undo = useCallback(() => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            context?.putImageData(history[newIndex], 0, 0);
            setHistoryIndex(newIndex);
        }
    }, [context, history, historyIndex]);

    const redo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            context?.putImageData(history[newIndex], 0, 0);
            setHistoryIndex(newIndex);
        }
    }, [context, history, historyIndex]);

    const clearCanvas = useCallback(() => {
        if (!context || !canvasRef.current) return;
        context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        pushToHistory(context.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height));
    }, [context, canvasRef, pushToHistory]);


    return {
        handlers: {onDrawStart, onDrawMove, onDrawEnd},
        initialize,
        clearCanvas,
        undo,
        redo,
        canUndo: historyIndex > 0,
        canRedo: historyIndex < history.length - 1,
    };
};