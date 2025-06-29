import type {Mode} from '../types';
import type {KmlLayerConfig} from '../App';
import type {CombinedRenderCounts} from './MapCanvas';

interface TileStatusLegendProps {
    mode: Mode;
    counts: {
        downloaded: number;
        selected: number;
        downloading: number;
        goodNegatives: number;
        discoveries: number;
        positiveLabels: number;
    };
    showExistingTiles: boolean;
    showGoodNegatives: boolean;
    showDiscoveries: boolean;
    showLabels: boolean;
    labelsColor: string;
    negativesColor: string;
    discoveriesColor: string;
    existingColor: string;
    showGeoglyphs: boolean;
    kmlLayers: KmlLayerConfig[];
    kmlLayerVisibility: Record<string, boolean>;
    kmlGeoglyphCounts: Record<string, number>;
    renderedTileCounts: CombinedRenderCounts;
    indicatorLayersOrder: ('negatives' | 'discoveries')[];
}

export function TileStatusLegend({
                                     mode,
                                     counts,
                                     showExistingTiles,
                                     showGoodNegatives,
                                     showDiscoveries,
                                     showLabels,
                                     labelsColor,
                                     showGeoglyphs,
                                     kmlLayers,
                                     kmlLayerVisibility,
                                     kmlGeoglyphCounts,
                                     renderedTileCounts,
                                     negativesColor,
                                     discoveriesColor,
                                     existingColor,
                                     indicatorLayersOrder
                                 }: TileStatusLegendProps) {
    const hasVisibleKmlLayers = showGeoglyphs && kmlLayers.some(l => kmlLayerVisibility[l.filename]);
    const hasBaseTileStatus = showExistingTiles || counts.selected > 0 || counts.downloading > 0 || (showGoodNegatives && counts.goodNegatives > 0) || (showDiscoveries && counts.discoveries > 0) || (showLabels && counts.positiveLabels > 0);

    const indicatorLayerLegends = {
        negatives: showGoodNegatives && counts.goodNegatives > 0 && (
            <div key="negatives" className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-sm" style={{backgroundColor: negativesColor, opacity: 0.7}}/>
                <span>Negatives ({counts.goodNegatives}) R:({renderedTileCounts.goodNegatives})</span>
            </div>
        ),
        discoveries: showDiscoveries && counts.discoveries > 0 && (
            <div key="discoveries" className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-sm" style={{backgroundColor: discoveriesColor, opacity: 0.7}}/>
                <span>Discoveries ({counts.discoveries}) R:({renderedTileCounts.discoveries})</span>
            </div>
        )
    };

    return (
        <div
            className="absolute top-4 right-4 bg-black/40 backdrop-blur-sm rounded-md shadow-sm p-3 z-[1000] text-xs text-white space-y-2">
            <div className="font-semibold mb-1">Tile Status</div>

            {showLabels && counts.positiveLabels > 0 && <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-sm" style={{backgroundColor: labelsColor, opacity: 0.8}}/>
                <span>Labels ({counts.positiveLabels}) R:({renderedTileCounts.positiveLabels})</span></div>}

            {[...indicatorLayersOrder].reverse().map(layerKey => indicatorLayerLegends[layerKey])}

            {showExistingTiles && <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-sm" style={{backgroundColor: existingColor, opacity: 0.7}}/>
                <span>Downloaded ({counts.downloaded}) R:({renderedTileCounts.orange})</span></div>}

            {counts.selected > 0 && <div className="flex items-center space-x-2">
                <div
                    className={`w-3 h-3 ${mode === "download" ? "bg-green-500" : "bg-blue-500"} opacity-70 rounded-sm`}/>
                <span>Selected ({counts.selected}) R:({renderedTileCounts.selected})</span></div>}

            {counts.downloading > 0 && <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-yellow-500 opacity-70 rounded-sm animate-pulse"/>
                <span>Downloading ({counts.downloading}) R:({renderedTileCounts.downloading})</span></div>}

            {hasBaseTileStatus && hasVisibleKmlLayers && <hr className="my-1 border-white/20"/>}

            {showGeoglyphs && kmlLayers.map(layer => {
                const isVisible = kmlLayerVisibility[layer.filename];
                const count = kmlGeoglyphCounts[layer.filename];
                const renderedKmlCount = renderedTileCounts.kml[layer.filename] ?? 0;

                if (isVisible && typeof count === 'number') {
                    return (
                        <div key={layer.filename} className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded-sm"
                                 style={{backgroundColor: layer.color, opacity: 0.8}}/>
                            <span>{layer.name} ({count}) R:({renderedKmlCount})</span>
                        </div>
                    );
                }
                return null;
            })}
        </div>
    );
}