import React, {useEffect, useState} from "react";
import {AlertCircle, CheckCircle, Info, Loader2, X} from "lucide-react";


export type ToastType = "success" | "error" | "info" | "warning" | "loading";


export interface ToastMessage {
    id: string;
    type: ToastType;
    message: string | React.ReactNode;
    duration?: number | null;
}

export interface ToastUpdatePayload {
    type?: ToastType;
    message?: string | React.ReactNode;
    duration?: number | null;
}

interface ToastProps {
    toast: ToastMessage;
    onClose: (id: string) => void;
}

function Toast({toast, onClose}: ToastProps) {
    const [isExiting, setIsExiting] = useState(false);

    const handleClose = () => {
        setIsExiting(true);
    };

    useEffect(() => {
        if (toast.duration === null || typeof toast.duration === 'undefined') {
            return;
        }
        const timer = setTimeout(() => {
            handleClose();
        }, toast.duration);

        return () => clearTimeout(timer);
    }, [toast.duration]);


    const handleAnimationEnd = () => {
        // When the exit animation finishes, call the main onClose handler
        if (isExiting) {
            onClose(toast.id);
        }
    };

    const icons = {
        success: <CheckCircle className="w-5 h-5"/>,
        error: <AlertCircle className="w-5 h-5"/>,
        info: <Info className="w-5 h-5"/>,
        warning: <AlertCircle className="w-5 h-5"/>,
        loading: <Loader2 className="w-5 h-5 animate-spin"/>,
    };

    const colors = {
        success: "bg-green-500",
        error: "bg-red-500",
        info: "bg-blue-500",
        warning: "bg-yellow-500",
        loading: "bg-gray-700",
    };

    return (
        <div
            onAnimationEnd={handleAnimationEnd}
            className={`${
                colors[toast.type]
            } text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-[300px] ${
                isExiting ? 'animate-slide-out' : 'animate-slide-in'
            }`}
        >
            {icons[toast.type]}
            <span className="flex-1">{toast.message}</span>
            <button
                onClick={handleClose}
                className="hover:bg-white/20 rounded p-1 transition-colors"
            >
                <X className="w-4 h-4"/>
            </button>
        </div>
    );
}

// No changes are needed for ToastContainer or useToast
export function ToastContainer({toasts, removeToast}: { toasts: ToastMessage[]; removeToast: (id: string) => void }) {
    return (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-[2000] space-y-2">
            {toasts.map((toast) => (
                <Toast key={toast.id} toast={toast} onClose={removeToast}/>
            ))}
        </div>
    );
}

let toastCount = 0;
const generateId = () => `toast-${Date.now()}-${toastCount++}`;

export function useToast() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = (
        type: ToastType,
        message: string | React.ReactNode,
        duration: number | null = 1000
    ): string => {
        const id = generateId();
        setToasts((prev) => [...prev, {id, type, message, duration}]);
        return id;
    };

    const removeToast = (id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    };

    const updateToast = (
        id: string,
        newToastData: ToastUpdatePayload
    ) => {
        setToasts((prev) =>
            prev.map((toast) =>
                toast.id === id ? {...toast, ...newToastData} : toast
            )
        );
    };

    return {toasts, addToast, removeToast, updateToast};
}