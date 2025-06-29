import React from 'react';
import {AlertTriangle, Check, X} from "lucide-react";

interface AlertModalProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
    message: string;
}

export const AlertModal: React.FC<AlertModalProps> = ({isOpen, onConfirm, onCancel, title, message}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[4000] flex items-center justify-center animate-fade-in"
             onMouseDown={onCancel}>
            <div
                className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-md mx-4 flex flex-col space-y-4"
                onMouseDown={(e) => e.stopPropagation()} // Prevent click inside from closing
            >
                <div className="flex items-center space-x-3">
                    <div className="bg-yellow-500/20 p-2 rounded-full">
                        <AlertTriangle className="w-6 h-6 text-yellow-400"/>
                    </div>
                    <h2 className="text-xl font-bold">{title}</h2>
                </div>
                <p className="text-gray-300">{message}</p>
                <div className="flex justify-end space-x-4 pt-4">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors flex items-center space-x-2"
                    >
                        <X size={18}/>
                        <span>Cancel</span>
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 transition-colors flex items-center space-x-2"
                    >
                        <Check size={18}/>
                        <span>Confirm</span>
                    </button>
                </div>
            </div>
        </div>
    );
};