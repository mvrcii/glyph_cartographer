import {useCallback, useEffect, useRef, useState} from 'react';
import type {ToastType} from '../components/Toast';

interface UseLabelSyncProps {
    syncTrigger: number;
    showToast: (t: ToastType, msg: string, dur?: number | null) => string;
    setDownloaded: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface LabelSyncState {
    progress: {
        isOpen: boolean;
        progress: number;
        total: number;
        message: string;
        title: string;
    };
    handleCancelSync: () => void;
}

export function useLabelSync({syncTrigger, showToast, setDownloaded}: UseLabelSyncProps): LabelSyncState {
    const lastSyncTrigger = useRef(0);
    const eventSourceRef = useRef<EventSource | null>(null);
    const isActiveRef = useRef(false);

    // Use refs for functions to avoid dependency issues
    const showToastRef = useRef(showToast);
    const setDownloadedRef = useRef(setDownloaded);

    showToastRef.current = showToast;
    setDownloadedRef.current = setDownloaded;

    const [progress, setProgress] = useState({
        isOpen: false,
        progress: 0,
        total: 0,
        message: '',
        title: ''
    });

    const handleCancelSync = useCallback(() => {
        if (eventSourceRef.current) {
            const es = eventSourceRef.current;
            eventSourceRef.current = null;
            isActiveRef.current = false;
            es.close();
            showToastRef.current("warning", "Training data sync cancelled.", 1500);
        }
    }, []);

    useEffect(() => {
        if (!syncTrigger || syncTrigger === lastSyncTrigger.current) {
            return;
        }

        lastSyncTrigger.current = syncTrigger;
        isActiveRef.current = true;

        const newDownloadedTiles = new Set<string>();
        let createdMasks = 0;
        let downloadedTiles = 0;

        setProgress({
            isOpen: true,
            progress: 0,
            total: 0,
            message: 'Analyzing training data requirements...',
            title: 'Syncing Training Data'
        });

        const es = new EventSource('/api/tiles/sync-labels');
        eventSourceRef.current = es;

        const cleanup = () => {
            isActiveRef.current = false;

            if (newDownloadedTiles.size > 0) {
                setDownloadedRef.current(prev => new Set([...prev, ...newDownloadedTiles]));
            }

            setProgress({isOpen: false, progress: 0, total: 0, message: '', title: ''});
            eventSourceRef.current = null;
        };

        es.addEventListener('total', (e: MessageEvent) => {
            if (!isActiveRef.current) return;

            const total = parseInt(e.data, 10);

            if (total === 0) {
                setProgress(prev => ({
                    ...prev,
                    total: 0,
                    message: 'All training data is already synchronized!'
                }));
            } else {
                setProgress(prev => ({
                    ...prev,
                    total,
                    message: `Synchronizing ${total} training data items...`
                }));
            }
        });

        es.onmessage = (e: MessageEvent) => {
            if (!isActiveRef.current) return;
            const data = e.data.trim();
            if (!data || data === 'connected' || data === 'starting' || data.startsWith("skip") || data.startsWith("error")) {
                return;
            }

            let progressIncrement = 0;

            if (data.startsWith('mask_')) {
                createdMasks++;
                progressIncrement = createdMasks + downloadedTiles;

                setProgress(prev => ({
                    ...prev,
                    progress: progressIncrement,
                    message: prev.total > 0
                        ? `Created ${createdMasks} mask files, downloaded ${downloadedTiles} tiles (${progressIncrement}/${prev.total})`
                        : `Created ${createdMasks} mask files, downloaded ${downloadedTiles} tiles`
                }));
            } else {
                newDownloadedTiles.add(data);
                downloadedTiles++;
                progressIncrement = createdMasks + downloadedTiles;

                setProgress(prev => ({
                    ...prev,
                    progress: progressIncrement,
                    message: prev.total > 0
                        ? `Created ${createdMasks} mask files, downloaded ${downloadedTiles} tiles (${progressIncrement}/${prev.total})`
                        : `Created ${createdMasks} mask files, downloaded ${downloadedTiles} tiles`
                }));
            }
        };

        es.addEventListener('end', () => {
            if (!isActiveRef.current) return;
            es.close();

            let successMsg;
            if (createdMasks > 0 && downloadedTiles > 0) {
                successMsg = `Training data synchronized: ${createdMasks} masks created, ${downloadedTiles} tiles downloaded!`;
            } else if (createdMasks > 0) {
                successMsg = `Created ${createdMasks} missing mask files!`;
            } else if (downloadedTiles > 0) {
                successMsg = `Downloaded ${downloadedTiles} missing satellite tiles!`;
            } else {
                successMsg = "All training data is already synchronized!";
            }

            showToastRef.current("success", successMsg, 3000);
            cleanup();
        });

        es.onerror = () => {
            if (!isActiveRef.current) return;

            es.close();
            isActiveRef.current = false;
            showToastRef.current("error", "Training data sync was interrupted.", 4000);
            cleanup();
        };

    }, [syncTrigger]);

    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
                isActiveRef.current = false;
            }
        };
    }, []);

    return {progress, handleCancelSync};
}