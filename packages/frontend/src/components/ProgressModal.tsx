import React from 'react';
import {Loader2, X} from "lucide-react";

interface ProgressModalProps {
    isOpen: boolean;
    title: string;
    message?: string;
    progress: number;
    total: number;
    onCancel?: () => void;
    cancelText?: string;
    showProgressBar?: boolean;
    showPercentage?: boolean;
}

export const ProgressModal: React.FC<ProgressModalProps> = ({
                                                                isOpen,
                                                                title,
                                                                message,
                                                                progress,
                                                                total,
                                                                onCancel,
                                                                cancelText = "Cancel",
                                                                showProgressBar = true,
                                                                showPercentage = true
                                                            }) => {
    if (!isOpen) return null;

    const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

    return (
        <div className="fixed inset-0 bg-black/60 z-[4000] flex items-center justify-center animate-fade-in">
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-md mx-4">
                <div className="flex items-center space-x-3 mb-4">
                    <div className="bg-blue-500/20 p-2 rounded-full animate-spin">
                        <Loader2 className="w-6 h-6 text-blue-400"/>
                    </div>
                    <h2 className="text-xl font-bold">{title}</h2>
                </div>

                {message && (
                    <p className="text-gray-300 mb-4">{message}</p>
                )}

                <div className="mb-4">
                    <div className="text-sm text-gray-400 mb-2 flex justify-between">
                        <span>{progress} of {total}</span>
                        {showPercentage && <span>{percentage}%</span>}
                    </div>

                    {showProgressBar && (
                        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
                                style={{width: `${percentage}%`}}
                            />
                        </div>
                    )}
                </div>

                {onCancel && (
                    <button
                        onClick={onCancel}
                        className="w-full px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors flex items-center justify-center space-x-2"
                    >
                        <X size={18}/>
                        <span>{cancelText}</span>
                    </button>
                )}
            </div>
        </div>
    );
};