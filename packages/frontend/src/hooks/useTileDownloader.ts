import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {Mode} from '../types';
import type {ToastType} from '../components/Toast';

interface UseTileDownloaderProps {
    downloadTrigger: number;
    mode: Mode;
    selected: Set<string>;
    clearSelection: () => void;
    downloaded: Set<string>;
    setDownloaded: React.Dispatch<React.SetStateAction<Set<string>>>;
    setDownloading: React.Dispatch<React.SetStateAction<Set<string>>>;
    showToast: (t: ToastType, msg: string, dur?: number | null) => string; // Kept for final status messages
    Z: number;
}

export interface TileDownloaderState {
    progress: {
        isOpen: boolean;
        progress: number;
        total: number;
    };
    handleCancelDownload: () => void;
}

export function useTileDownloader({
    downloadTrigger,
    mode,
    selected,
    clearSelection,
    downloaded,
    setDownloaded,
    setDownloading,
    showToast,
    Z,
}: UseTileDownloaderProps): TileDownloaderState {
    const lastDownloadTrigger = useRef(0);
    const isDownloadActiveRef = useRef(false);
    const eventSourceRef = useRef<EventSource | null>(null);

    const [progress, setProgress] = useState({isOpen: false, progress: 0, total: 0});

    const selectedRef = useRef(selected);
    const downloadedRef = useRef(downloaded);

    selectedRef.current = selected;
    downloadedRef.current = downloaded;

    const handleCancelDownload = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close(); // This triggers the onerror/onend cleanup
            showToast("warning", "Download cancelled.", 500);
        }
        // Cleanup is handled in the EventSource listeners
    }, [showToast]);

    useEffect(() => {
        if (!downloadTrigger || downloadTrigger === lastDownloadTrigger.current) {
            return;
        }
        lastDownloadTrigger.current = downloadTrigger;

        if (isDownloadActiveRef.current) {
            showToast("info", "A download is already in progress.", 500);
            return;
        }

        if (mode !== "download" || selectedRef.current.size === 0) {
            if (selectedRef.current.size === 0) showToast("warning", "No tiles selected", 2000);
            return;
        }

        isDownloadActiveRef.current = true;
        const tilesToDownload = Array.from(selectedRef.current).filter((k) => !downloadedRef.current.has(k));

        if (tilesToDownload.length === 0) {
            showToast("info", "All selected tiles are already downloaded.", 2000);
            clearSelection();
            isDownloadActiveRef.current = false;
            return;
        }

        const downloadCount = tilesToDownload.length;
        setProgress({ isOpen: true, progress: 0, total: downloadCount });

        const payload = {zoom: Z, tiles: tilesToDownload.map((k) => k.split(",").map(Number))};

        setDownloading(new Set(tilesToDownload));
        clearSelection();

        const es = new EventSource(`/api/tiles/download?d=${encodeURIComponent(JSON.stringify(payload))}`);
        eventSourceRef.current = es; // Store the instance for cancellation

        let completedCount = 0;
        const newDownloadedTiles = new Set<string>();

        es.onmessage = (e) => {
            const msg = e.data.trim();
            if (!msg || msg.startsWith("error")) return;

            completedCount++;

            // Update progress
            setProgress(prev => ({ ...prev, progress: completedCount }));

            if (!msg.startsWith("skip ")) {
                newDownloadedTiles.add(msg);
            }
        };

        const cleanup = () => {
            es.close();
            isDownloadActiveRef.current = false;
            eventSourceRef.current = null;
            setProgress({ isOpen: false, progress: 0, total: 0 }); // Close modal
            setDownloading(new Set()); // Clear downloading state
            // Batch update the downloaded set once at the end
            if (newDownloadedTiles.size > 0) {
                setDownloaded(prev => new Set([...prev, ...newDownloadedTiles]));
            }
        };

        es.addEventListener("end", () => {
            cleanup();
            showToast("success", `Download complete. Added ${newDownloadedTiles.size} new tiles.`, 2000);
        });

        es.onerror = () => {
            cleanup();
            if (!isDownloadActiveRef.current) { // Check if it was a manual cancellation
                console.log("Download stream closed by cancellation.");
            } else {
                console.error("[useTileDownloader] download stream error");
                showToast("error", "Download failed. Please try again.", 3000);
            }
        };

        return () => {
             // Ensure cleanup happens on component unmount
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };

    }, [downloadTrigger, Z, mode, clearSelection, setDownloaded, setDownloading]);

    return { progress, handleCancelDownload };
}