import React from 'react';

interface SelectionTooltipProps {
    x: number;
    y: number;
    tileCount: number;
    areaKm2: number;
    visible: boolean;
}

// Add to tileMathUtils.ts or create a new utility


export const SelectionTooltip: React.FC<SelectionTooltipProps> = ({
                                                                      x, y, tileCount, areaKm2, visible
                                                                  }) => {
    if (!visible) return null;

    return (
        <div
            className="fixed pointer-events-none z-[700] bg-black/80 text-white text-xs rounded-md px-2 py-1 shadow-lg"
            style={{
                left: `${x + 20}px`,
                top: `${y - 30}px`,
                transform: 'translateY(-100%)',
            }}
        >
            <div className="flex flex-col space-y-0.5">
                <span>{tileCount} tiles</span>
                <span>{areaKm2.toFixed(2)} km²</span>
            </div>
        </div>
    );
};